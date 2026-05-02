import { useEffect, useSyncExternalStore } from "react";

import { EventsOff, EventsOn } from "../wails/runtime";

export type WindowLeaseRole =
  | "preview"
  | "git-helper"
  | "problems-helper"
  | "terminal-helper";

export type WindowLeaseStatus = "attached" | "detached" | "stale" | "closed";

export interface WindowLeaseReturnTarget {
  hostMode?: string;
  position?: string;
}

export interface WindowLeaseActionPayload {
  surfaceId: string;
  previewWindowId?: string;
  role: WindowLeaseRole;
  appletKind?: string;
  title?: string;
  url?: string;
  pinned?: boolean;
  returnTarget?: WindowLeaseReturnTarget;
  payload?: Record<string, string | number | boolean | undefined>;
}

export interface WindowLeaseRecord {
  id: string;
  surfaceId: string;
  previewWindowId?: string;
  role: WindowLeaseRole;
  appletKind?: string;
  nativeWindowId?: string;
  status: WindowLeaseStatus;
  closePolicy: "return-to-main";
  returnTarget?: WindowLeaseReturnTarget;
  title?: string;
  url?: string;
  pinned?: boolean;
  payload?: Record<string, string | number | boolean | undefined>;
  updatedAt: number;
}

export interface WindowLeaseSnapshot {
  version: number;
  runtime?: string;
  platform?: string;
  spikeEnabled: boolean;
  detachedAvailable: boolean;
  supportedRoles: readonly WindowLeaseRole[];
  supportedSurfaceIds?: readonly string[];
  leases: readonly WindowLeaseRecord[];
  leasesBySurfaceId: Readonly<Record<string, WindowLeaseRecord>>;
  reason?: string;
  revision: number;
  loadedFromBackend: boolean;
}

export interface WindowLeaseActionResult {
  handled: boolean;
  actionId?: string;
  kind?: string;
  surfaceId?: string;
  record?: WindowLeaseRecord;
  snapshot?: WindowLeaseSnapshot;
  message?: string;
}

interface WindowLeaseBridge {
  GetWindowLeaseStatus?: () => Promise<unknown> | unknown;
  RunWindowLeaseAction?: (actionId: string) => Promise<unknown> | unknown;
}

interface WindowLeaseRuntimeModule {
  Call?: {
    ByName?: (methodName: string, ...args: unknown[]) => Promise<unknown>;
  };
}

const listeners = new Set<() => void>();
export const WINDOW_LEASE_STATUS_EVENT = "shell:window-lease:status";

const FALLBACK_SNAPSHOT: WindowLeaseSnapshot = {
  version: 2,
  runtime: "wails-v3",
  spikeEnabled: false,
  detachedAvailable: false,
  supportedRoles: ["preview", "git-helper", "problems-helper", "terminal-helper"],
  leases: [],
  leasesBySurfaceId: {},
  reason: "Detached windows require Window Lease spike mode.",
  revision: 0,
  loadedFromBackend: false,
};

let snapshot: WindowLeaseSnapshot = FALLBACK_SNAPSHOT;
let snapshotFingerprint = "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : false;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const getRecordValue = (
  record: Record<string, unknown>,
  camelKey: string,
  pascalKey: string,
): unknown =>
  Object.prototype.hasOwnProperty.call(record, camelKey)
    ? record[camelKey]
    : record[pascalKey];

const toRole = (value: unknown): WindowLeaseRole | null => {
  switch (readString(value)) {
    case "preview":
      return "preview";
    case "git-helper":
      return "git-helper";
    case "problems-helper":
      return "problems-helper";
    case "terminal-helper":
      return "terminal-helper";
    default:
      return null;
  }
};

const toStatus = (value: unknown): WindowLeaseStatus => {
  switch (readString(value)) {
    case "detached":
      return "detached";
    case "stale":
      return "stale";
    case "closed":
      return "closed";
    default:
      return "attached";
  }
};

const normalizeReturnTarget = (
  value: unknown,
): WindowLeaseReturnTarget | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    hostMode: readString(getRecordValue(value, "hostMode", "HostMode")),
    position: readString(getRecordValue(value, "position", "Position")),
  };
};

const normalizePayload = (
  value: unknown,
): Record<string, string | number | boolean | undefined> => {
  if (!isRecord(value)) {
    return {};
  }
  return Object.entries(value).reduce<
    Record<string, string | number | boolean | undefined>
  >((accumulator, [key, item]) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      accumulator[key] = item;
    }
    return accumulator;
  }, {});
};

const normalizeRecord = (value: unknown): WindowLeaseRecord | null => {
  if (!isRecord(value)) {
    return null;
  }
  const surfaceId = readString(getRecordValue(value, "surfaceId", "SurfaceID"));
  const role = toRole(getRecordValue(value, "role", "Role"));
  if (!surfaceId || !role) {
    return null;
  }

  return {
    id: readString(getRecordValue(value, "id", "ID")) ?? `lease:${surfaceId}`,
    surfaceId,
    previewWindowId: readString(
      getRecordValue(value, "previewWindowId", "PreviewWindowID"),
    ),
    role,
    appletKind: readString(getRecordValue(value, "appletKind", "AppletKind")),
    nativeWindowId: readString(
      getRecordValue(value, "nativeWindowId", "NativeWindowID"),
    ),
    status: toStatus(getRecordValue(value, "status", "Status")),
    closePolicy: "return-to-main",
    returnTarget: normalizeReturnTarget(
      getRecordValue(value, "returnTarget", "ReturnTarget"),
    ),
    title: readString(getRecordValue(value, "title", "Title")),
    url: readString(getRecordValue(value, "url", "URL")),
    pinned: readBoolean(getRecordValue(value, "pinned", "Pinned")),
    payload: normalizePayload(getRecordValue(value, "payload", "Payload")),
    updatedAt:
      readNumber(getRecordValue(value, "updatedAt", "UpdatedAt")) ?? Date.now(),
  };
};

const normalizeSnapshot = (value: unknown): WindowLeaseSnapshot => {
  if (!isRecord(value)) {
    return { ...FALLBACK_SNAPSHOT };
  }
  const rawLeases = getRecordValue(value, "leases", "Leases");
  const leases = Array.isArray(rawLeases)
    ? rawLeases
        .map((record) => normalizeRecord(record))
        .filter((record): record is WindowLeaseRecord => Boolean(record))
    : [];
  const leasesBySurfaceId = leases.reduce<Record<string, WindowLeaseRecord>>(
    (accumulator, record) => {
      accumulator[record.surfaceId] = { ...record };
      return accumulator;
    },
    {},
  );
  const rawSupportedRoles = getRecordValue(
    value,
    "supportedRoles",
    "SupportedRoles",
  );
  const supportedRoles = Array.isArray(rawSupportedRoles)
    ? rawSupportedRoles
        .map((role) => toRole(role))
        .filter((role): role is WindowLeaseRole => Boolean(role))
    : FALLBACK_SNAPSHOT.supportedRoles;

  return {
    version: readNumber(getRecordValue(value, "version", "Version")) ?? 2,
    runtime: readString(getRecordValue(value, "runtime", "Runtime")),
    platform: readString(getRecordValue(value, "platform", "Platform")),
    spikeEnabled: readBoolean(
      getRecordValue(value, "spikeEnabled", "SpikeEnabled"),
    ),
    detachedAvailable: readBoolean(
      getRecordValue(value, "detachedAvailable", "DetachedAvailable"),
    ),
    supportedRoles,
    supportedSurfaceIds: Array.isArray(
      getRecordValue(value, "supportedSurfaceIds", "SupportedSurfaceIDs"),
    )
      ? (
          getRecordValue(
            value,
            "supportedSurfaceIds",
            "SupportedSurfaceIDs",
          ) as unknown[]
        )
          .map(readString)
          .filter((surfaceId): surfaceId is string => Boolean(surfaceId))
      : [],
    leases,
    leasesBySurfaceId,
    reason: readString(getRecordValue(value, "reason", "Reason")),
    revision: snapshot.revision + 1,
    loadedFromBackend: true,
  };
};

const cloneSnapshot = (source: WindowLeaseSnapshot): WindowLeaseSnapshot => ({
  ...source,
  supportedRoles: [...source.supportedRoles],
  supportedSurfaceIds: [...(source.supportedSurfaceIds ?? [])],
  leases: source.leases.map((lease) => ({
    ...lease,
    returnTarget: lease.returnTarget ? { ...lease.returnTarget } : undefined,
    payload: lease.payload ? { ...lease.payload } : undefined,
  })),
  leasesBySurfaceId: Object.fromEntries(
    Object.entries(source.leasesBySurfaceId).map(([surfaceId, lease]) => [
      surfaceId,
      {
        ...lease,
        returnTarget: lease.returnTarget
          ? { ...lease.returnTarget }
          : undefined,
        payload: lease.payload ? { ...lease.payload } : undefined,
      },
    ]),
  ),
});

export const syncWindowLeaseStatusFromPayload = (
  payload: unknown,
): WindowLeaseSnapshot => {
  const next = normalizeSnapshot(payload);
  const fingerprint = JSON.stringify({
    detachedAvailable: next.detachedAvailable,
    spikeEnabled: next.spikeEnabled,
    leases: next.leases,
    reason: next.reason,
  });
  if (fingerprint === snapshotFingerprint) {
    return snapshot;
  }
  snapshot = cloneSnapshot(next);
  snapshotFingerprint = fingerprint;
  listeners.forEach((listener) => listener());
  return snapshot;
};

export const getWindowLeaseSnapshot = (): WindowLeaseSnapshot =>
  cloneSnapshot(snapshot);

export const subscribeWindowLeaseStatus = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getWindowLeaseBridge = (): WindowLeaseBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }
  return (
    (window as unknown as { go?: { main?: { App?: WindowLeaseBridge } } }).go
      ?.main?.App ?? null
  );
};

const loadRuntimeModule = async (): Promise<
  WindowLeaseRuntimeModule | undefined
> => {
  try {
    return (await import("/wails/runtime.js")) as WindowLeaseRuntimeModule;
  } catch {
    return undefined;
  }
};

const statusMethodNames = [
  "main.App.GetWindowLeaseStatus",
  "arlecchino.App.GetWindowLeaseStatus",
] as const;
const actionMethodNames = [
  "main.App.RunWindowLeaseAction",
  "arlecchino.App.RunWindowLeaseAction",
] as const;

let statusMethodName: (typeof statusMethodNames)[number] | undefined;
let actionMethodName: (typeof actionMethodNames)[number] | undefined;

const callByKnownName = async (
  methodNames: readonly string[],
  cachedName: string | undefined,
  setCachedName: (value: string | undefined) => void,
  ...args: unknown[]
): Promise<unknown | undefined> => {
  const runtimeModule = await loadRuntimeModule();
  const call = runtimeModule?.Call;
  if (!call?.ByName) {
    return undefined;
  }

  if (cachedName) {
    try {
      return await call.ByName(cachedName, ...args);
    } catch {
      setCachedName(undefined);
    }
  }

  for (const methodName of methodNames) {
    try {
      const payload = await call.ByName(methodName, ...args);
      setCachedName(methodName);
      return payload;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }
  return undefined;
};

export async function loadWindowLeaseStatusFromBackend(
  bridge?: WindowLeaseBridge | null,
): Promise<WindowLeaseSnapshot> {
  const resolvedBridge = bridge === undefined ? getWindowLeaseBridge() : bridge;
  if (typeof resolvedBridge?.GetWindowLeaseStatus === "function") {
    return syncWindowLeaseStatusFromPayload(
      await Promise.resolve(resolvedBridge.GetWindowLeaseStatus()),
    );
  }
  if (bridge !== null) {
    const payload = await callByKnownName(
      statusMethodNames,
      statusMethodName,
      (value) => {
        statusMethodName = value as typeof statusMethodName;
      },
    );
    if (payload !== undefined) {
      return syncWindowLeaseStatusFromPayload(payload);
    }
  }
  return getWindowLeaseSnapshot();
}

export async function runWindowLeaseAction(
  actionId: string,
  bridge?: WindowLeaseBridge | null,
): Promise<WindowLeaseActionResult> {
  const normalizeActionResult = (payload: unknown): WindowLeaseActionResult => {
    const result = isRecord(payload)
      ? (payload as unknown as WindowLeaseActionResult)
      : { handled: false, message: "Invalid Window Lease action result." };
    if (isRecord(result.snapshot)) {
      result.snapshot = syncWindowLeaseStatusFromPayload(result.snapshot);
    }
    return result;
  };
  const resolvedBridge = bridge === undefined ? getWindowLeaseBridge() : bridge;
  if (typeof resolvedBridge?.RunWindowLeaseAction === "function") {
    return normalizeActionResult(
      await Promise.resolve(resolvedBridge.RunWindowLeaseAction(actionId)),
    );
  }
  if (bridge !== null) {
    const payload = await callByKnownName(
      actionMethodNames,
      actionMethodName,
      (value) => {
        actionMethodName = value as typeof actionMethodName;
      },
      actionId,
    );
    if (isRecord(payload)) {
      return normalizeActionResult(payload);
    }
  }
  return {
    handled: false,
    message: "Window Lease action bridge is unavailable.",
  };
}

export const buildWindowLeaseActionId = (
  kind: "detach" | "focus-window" | "return-to-main" | "close-window",
  payload: WindowLeaseActionPayload,
): string => {
  const encodedSurfaceId = encodeURIComponent(payload.surfaceId);
  const binaryPayload = Array.from(
    new TextEncoder().encode(JSON.stringify(payload)),
  )
    .map((byte) => String.fromCharCode(byte))
    .join("");
  const encodedPayload = btoa(binaryPayload)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `windowLease.${kind}:${encodedSurfaceId}:${encodedPayload}`;
};

export function useWindowLeaseStatus(): WindowLeaseSnapshot {
  return useSyncExternalStore(
    subscribeWindowLeaseStatus,
    getWindowLeaseSnapshot,
    getWindowLeaseSnapshot,
  );
}

export function useWindowLeaseBridge(
  onStatusLoaded?: (snapshot: WindowLeaseSnapshot) => void,
): void {
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = EventsOn(
      WINDOW_LEASE_STATUS_EVENT,
      (payload: unknown) => {
        const loaded = syncWindowLeaseStatusFromPayload(payload);
        if (!cancelled) {
          onStatusLoaded?.(loaded);
        }
      },
    );
    void loadWindowLeaseStatusFromBackend().then((loaded) => {
      if (!cancelled) {
        onStatusLoaded?.(loaded);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      EventsOff(WINDOW_LEASE_STATUS_EVENT);
    };
  }, [onStatusLoaded]);
}
