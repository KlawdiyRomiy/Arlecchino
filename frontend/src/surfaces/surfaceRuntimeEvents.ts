import type {
  SurfaceGeometry,
  SurfaceHostMode,
  SurfaceSession,
} from "./surfaceRuntime";

export const SURFACE_RUNTIME_EVENT_TYPES = [
  "surface:open",
  "surface:focus",
  "surface:move",
  "surface:promote",
  "surface:close",
  "surface:state",
] as const;

const SURFACE_HOST_MODES: readonly SurfaceHostMode[] = [
  "main-center",
  "floating",
  "snapped",
  "fullscreen",
  "detached",
];

export type SurfaceRuntimeEventType =
  (typeof SURFACE_RUNTIME_EVENT_TYPES)[number];

export interface SurfaceRuntimeEvent {
  type: SurfaceRuntimeEventType;
  surfaceId: string;
  at: number;
  session?: SurfaceSession;
  geometry?: SurfaceGeometry;
  hostMode?: SurfaceSession["hostMode"];
  reason?: string;
  ok: boolean;
}

export interface CreateSurfaceRuntimeEventInput {
  type: SurfaceRuntimeEventType;
  surfaceId?: string;
  at?: number;
  session?: SurfaceSession;
  geometry?: SurfaceGeometry;
  hostMode?: SurfaceSession["hostMode"];
  reason?: string;
  ok?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isSurfaceRuntimeEventType = (
  value: unknown,
): value is SurfaceRuntimeEventType =>
  typeof value === "string" &&
  (SURFACE_RUNTIME_EVENT_TYPES as readonly string[]).includes(value);

const toNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const toFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isSurfaceHostMode = (value: unknown): value is SurfaceHostMode =>
  typeof value === "string" &&
  (SURFACE_HOST_MODES as readonly string[]).includes(value);

export const createSurfaceRuntimeEvent = ({
  type,
  surfaceId,
  at = Date.now(),
  session,
  geometry,
  hostMode,
  reason,
  ok = true,
}: CreateSurfaceRuntimeEventInput): SurfaceRuntimeEvent => ({
  type,
  surfaceId: surfaceId ?? session?.id ?? "",
  at,
  session,
  geometry,
  hostMode,
  reason,
  ok,
});

export const parseSurfaceRuntimeEvent = (
  payload: unknown,
): SurfaceRuntimeEvent | null => {
  if (!isRecord(payload) || !isSurfaceRuntimeEventType(payload.type)) {
    return null;
  }

  const session = isRecord(payload.session)
    ? (payload.session as unknown as SurfaceSession)
    : undefined;
  const surfaceId = toNonEmptyString(payload.surfaceId) ?? session?.id;
  if (!surfaceId) {
    return null;
  }

  return {
    type: payload.type,
    surfaceId,
    at: toFiniteNumber(payload.at) ?? Date.now(),
    session,
    geometry: isRecord(payload.geometry)
      ? (payload.geometry as unknown as SurfaceGeometry)
      : undefined,
    hostMode: isSurfaceHostMode(payload.hostMode)
      ? payload.hostMode
      : undefined,
    reason: toNonEmptyString(payload.reason),
    ok: typeof payload.ok === "boolean" ? payload.ok : true,
  };
};

export const surfaceRuntimeEventDedupeKey = (
  event: Pick<SurfaceRuntimeEvent, "type" | "surfaceId" | "at">,
): string => `${event.type}:${event.surfaceId}:${event.at}`;

export const dedupeSurfaceRuntimeEvents = (
  events: readonly SurfaceRuntimeEvent[],
): SurfaceRuntimeEvent[] => {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = surfaceRuntimeEventDedupeKey(event);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};
