import type { SurfaceHostMode, SurfaceSession } from "./surfaceRuntime";

export type SurfacePromotionCommandKind =
  | "promote-floating"
  | "snap"
  | "fullscreen"
  | "return-to-main"
  | "detach";

export type SurfacePromotionPosition = "left" | "right" | "top" | "bottom";

export interface SurfacePromotionRequest {
  surfaceId: string;
  kind: SurfacePromotionCommandKind;
  source: "panel" | "preview";
  panelId?: string;
  previewWindowId?: string;
  position?: SurfacePromotionPosition;
}

export interface SurfacePromotionResult {
  handled: boolean;
  surfaceId?: string;
  kind?: SurfacePromotionCommandKind;
  hostMode?: SurfaceHostMode;
  position?: SurfacePromotionPosition;
  message?: string;
  reason?: string;
}

export interface SurfacePromotionCommand {
  id: string;
  kind: SurfacePromotionCommandKind;
  surfaceId: string;
  label: string;
  targetHostMode: SurfaceHostMode;
  enabled: boolean;
  requiresDetachedWindow?: boolean;
  reason?: string;
}

export interface SurfaceReturnTarget {
  surfaceId: string;
  hostMode: SurfaceHostMode;
  session: SurfaceSession;
  recordedAt: number;
  reason: "promotion";
}

export interface SurfacePromotionReadModel {
  detachedAvailable: boolean;
  commandsBySurfaceId: Readonly<
    Record<string, readonly SurfacePromotionCommand[]>
  >;
  returnTargets: Readonly<Record<string, SurfaceReturnTarget>>;
}

export interface SurfacePromotionReadOptions {
  detachedAvailable?: boolean;
  leaseSupportedSurfaceIds?: readonly string[];
  detachReasonsBySurfaceId?: Readonly<Record<string, string | undefined>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const unwrapPayload = (value: unknown): unknown => {
  if (Array.isArray(value) && value.length === 1) {
    return unwrapPayload(value[0]);
  }
  return value;
};

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const readString = (
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = asTrimmedString(source[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
};

const normalizeSurfacePromotionKind = (
  value: unknown,
): SurfacePromotionCommandKind | undefined => {
  const normalized = asTrimmedString(value)?.toLowerCase();
  switch (normalized) {
    case "promote-floating":
    case "floating":
    case "float":
    case "surface.promotefloating":
      return "promote-floating";
    case "snap":
    case "snapped":
    case "surface.snap":
      return "snap";
    case "fullscreen":
    case "full-screen":
    case "surface.fullscreen":
      return "fullscreen";
    case "return-to-main":
    case "return":
    case "restore":
    case "surface.returntomain":
      return "return-to-main";
    case "detach":
    case "detached":
    case "surface.detach":
      return "detach";
    default:
      return undefined;
  }
};

const normalizeSurfacePromotionPosition = (
  value: unknown,
): SurfacePromotionPosition | undefined => {
  switch (asTrimmedString(value)?.toLowerCase()) {
    case "left":
    case "right":
    case "top":
    case "bottom":
      return asTrimmedString(value)?.toLowerCase() as SurfacePromotionPosition;
    default:
      return undefined;
  }
};

export const parseSurfacePromotionRequest = (
  value: unknown,
): SurfacePromotionRequest | null => {
  const payload = unwrapPayload(value);
  if (!isRecord(payload)) {
    return null;
  }

  const surfaceId = readString(
    payload,
    "surfaceId",
    "surfaceID",
    "id",
    "target",
  );
  const kind = normalizeSurfacePromotionKind(
    payload.kind ?? payload.command ?? payload.action,
  );
  if (!surfaceId || !kind) {
    return null;
  }

  if (surfaceId.startsWith("panel:")) {
    const panelId = surfaceId.slice("panel:".length).trim();
    return panelId
      ? {
          surfaceId,
          kind,
          source: "panel",
          panelId,
          position: normalizeSurfacePromotionPosition(
            payload.position ?? payload.side,
          ),
        }
      : null;
  }

  if (surfaceId.startsWith("preview:")) {
    const previewWindowId = surfaceId.slice("preview:".length).trim();
    return previewWindowId
      ? {
          surfaceId,
          kind,
          source: "preview",
          previewWindowId,
          position: normalizeSurfacePromotionPosition(
            payload.position ?? payload.side,
          ),
        }
      : null;
  }

  return null;
};

export const buildSurfacePromotionResult = (
  request: Pick<SurfacePromotionRequest, "surfaceId" | "kind"> | null,
  result: Omit<SurfacePromotionResult, "surfaceId" | "kind">,
): SurfacePromotionResult => ({
  surfaceId: request?.surfaceId,
  kind: request?.kind,
  ...result,
});

const cloneSurfaceSession = (session: SurfaceSession): SurfaceSession => ({
  ...session,
  geometry: session.geometry ? { ...session.geometry } : undefined,
  payload: session.payload ? { ...session.payload } : undefined,
});

const cloneReturnTarget = (
  target: SurfaceReturnTarget,
): SurfaceReturnTarget => ({
  ...target,
  session: cloneSurfaceSession(target.session),
});

const command = (
  surfaceId: string,
  kind: SurfacePromotionCommandKind,
  targetHostMode: SurfaceHostMode,
  label: string,
  enabled: boolean,
  extra: Partial<
    Pick<SurfacePromotionCommand, "reason" | "requiresDetachedWindow">
  > = {},
): SurfacePromotionCommand => ({
  id: `surface.${kind}:${surfaceId}`,
  kind,
  surfaceId,
  label,
  targetHostMode,
  enabled,
  ...extra,
});

export const buildSurfacePromotionCommands = (
  session: SurfaceSession,
  options: {
    hasReturnTarget?: boolean;
    detachedAvailable?: boolean;
    leaseSupported?: boolean;
    detachReason?: string;
  } = {},
): SurfacePromotionCommand[] => {
  const detachedAvailable = options.detachedAvailable ?? false;
  const leaseSupported = options.leaseSupported ?? true;
  const commands: SurfacePromotionCommand[] = [];

  if (session.source !== "main") {
    commands.push(
      command(
        session.id,
        "promote-floating",
        "floating",
        "Move to Floating",
        session.hostMode !== "floating",
      ),
      command(
        session.id,
        "snap",
        "snapped",
        "Snap to Side",
        session.hostMode !== "snapped",
      ),
      command(
        session.id,
        "fullscreen",
        "fullscreen",
        "Fullscreen",
        session.hostMode !== "fullscreen",
      ),
    );
  }

  if (options.hasReturnTarget) {
    commands.push(
      command(
        session.id,
        "return-to-main",
        "main-center",
        "Return Layout",
        true,
      ),
    );
  }

  commands.push(
    command(
      session.id,
      "detach",
      "detached",
      "Move to Window",
      leaseSupported && detachedAvailable,
      {
        reason:
          leaseSupported && detachedAvailable
            ? undefined
            : (options.detachReason ??
              (leaseSupported
                ? "Detached windows require Window Lease spike mode and packaged smoke."
                : "Surface is not supported by Window Lease System.")),
        requiresDetachedWindow: true,
      },
    ),
  );

  return commands;
};

export const buildSurfacePromotionReadModel = (
  sessions: readonly SurfaceSession[],
  returnTargets: Readonly<Record<string, SurfaceReturnTarget>>,
  options: boolean | SurfacePromotionReadOptions = false,
): SurfacePromotionReadModel => {
  const readOptions: SurfacePromotionReadOptions =
    typeof options === "boolean" ? { detachedAvailable: options } : options;
  const detachedAvailable = readOptions.detachedAvailable ?? false;
  const leaseSupportedSurfaceIds = readOptions.leaseSupportedSurfaceIds
    ? new Set(readOptions.leaseSupportedSurfaceIds)
    : null;
  const commandsBySurfaceId = sessions.reduce<
    Record<string, SurfacePromotionCommand[]>
  >((accumulator, session) => {
    accumulator[session.id] = buildSurfacePromotionCommands(session, {
      detachedAvailable,
      leaseSupported: leaseSupportedSurfaceIds
        ? leaseSupportedSurfaceIds.has(session.id)
        : true,
      detachReason: readOptions.detachReasonsBySurfaceId?.[session.id],
      hasReturnTarget: Boolean(returnTargets[session.id]),
    });
    return accumulator;
  }, {});

  const clonedReturnTargets = Object.entries(returnTargets).reduce<
    Record<string, SurfaceReturnTarget>
  >((accumulator, [surfaceId, target]) => {
    accumulator[surfaceId] = cloneReturnTarget(target);
    return accumulator;
  }, {});

  return {
    detachedAvailable,
    commandsBySurfaceId,
    returnTargets: clonedReturnTargets,
  };
};

export const updateSurfacePromotionReturnTargets = (
  previousSessions: readonly SurfaceSession[],
  nextSessions: readonly SurfaceSession[],
  currentTargets: Readonly<Record<string, SurfaceReturnTarget>>,
  recordedAt: number,
): Record<string, SurfaceReturnTarget> => {
  const nextTargets: Record<string, SurfaceReturnTarget> = {};
  Object.entries(currentTargets).forEach(([surfaceId, target]) => {
    nextTargets[surfaceId] = cloneReturnTarget(target);
  });

  const previousById = new Map(
    previousSessions.map((session) => [session.id, session]),
  );
  const nextById = new Map(
    nextSessions.map((session) => [session.id, session]),
  );

  previousSessions.forEach((previousSession) => {
    if (!nextById.has(previousSession.id)) {
      delete nextTargets[previousSession.id];
    }
  });

  nextSessions.forEach((nextSession) => {
    const previousSession = previousById.get(nextSession.id);
    if (!previousSession || previousSession.hostMode === nextSession.hostMode) {
      return;
    }

    const existingTarget = nextTargets[nextSession.id];
    if (existingTarget && existingTarget.hostMode === nextSession.hostMode) {
      delete nextTargets[nextSession.id];
      return;
    }

    nextTargets[nextSession.id] = {
      surfaceId: nextSession.id,
      hostMode: previousSession.hostMode,
      session: cloneSurfaceSession(previousSession),
      recordedAt,
      reason: "promotion",
    };
  });

  return nextTargets;
};
