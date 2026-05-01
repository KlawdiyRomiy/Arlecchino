import type { SurfaceAppletKind, SurfaceSession } from "./surfaceRuntime";

export type SurfaceWindowLeaseRole =
  | "preview"
  | "git-helper"
  | "problems-helper"
  | "terminal-helper";

export type SurfaceWindowLeaseStatus = "attached" | "detached" | "stale";

export type SurfaceWindowLeaseCommandKind =
  | "detach"
  | "focus-window"
  | "return-to-main"
  | "close-window";

export interface SurfaceWindowLeasePolicy {
  close: "return-to-main";
  focus: "focus-detached-window";
  return: "restore-main-host";
  stale: "cleanup-return-target";
}

export interface SurfaceWindowLeaseRecord {
  id: string;
  surfaceId: string;
  role: SurfaceWindowLeaseRole;
  appletKind: SurfaceAppletKind;
  status: SurfaceWindowLeaseStatus;
  hostMode: SurfaceSession["hostMode"];
  nativeWindowId?: string;
  updatedAt: number;
  policy: SurfaceWindowLeasePolicy;
}

export interface SurfaceWindowLeaseCommand {
  id: string;
  kind: SurfaceWindowLeaseCommandKind;
  surfaceId: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface SurfaceWindowLeaseReadModel {
  version: 1;
  detachedAvailable: boolean;
  supportedSurfaceIds: readonly string[];
  unsupportedSurfaceIds: readonly string[];
  leasesBySurfaceId: Readonly<Record<string, SurfaceWindowLeaseRecord>>;
  commandsBySurfaceId: Readonly<
    Record<string, readonly SurfaceWindowLeaseCommand[]>
  >;
  staleLeaseIds: readonly string[];
}

export interface SurfaceWindowLeaseReadOptions {
  detachedAvailable?: boolean;
  existingLeases?: Readonly<Record<string, SurfaceWindowLeaseRecord>>;
  now?: number;
}

const DEFAULT_WINDOW_LEASE_POLICY: SurfaceWindowLeasePolicy = {
  close: "return-to-main",
  focus: "focus-detached-window",
  return: "restore-main-host",
  stale: "cleanup-return-target",
};

const UNSUPPORTED_WINDOW_LEASE_REASON =
  "Surface is not supported by Window Lease System.";

const PREVIEW_ONLY_WINDOW_LEASE_REASON =
  "Native detached window spike currently supports Browser Preview only.";

const GATED_WINDOW_LEASE_REASON =
  "Detached windows require Window Lease spike mode and packaged smoke.";

const cloneLease = (
  lease: SurfaceWindowLeaseRecord,
): SurfaceWindowLeaseRecord => ({
  ...lease,
  policy: { ...lease.policy },
});

const command = (
  surfaceId: string,
  kind: SurfaceWindowLeaseCommandKind,
  label: string,
  enabled: boolean,
  reason?: string,
): SurfaceWindowLeaseCommand => ({
  id: `windowLease.${kind}:${surfaceId}`,
  kind,
  surfaceId,
  label,
  enabled,
  reason,
});

export const getSurfaceWindowLeaseRole = (
  session: SurfaceSession,
): SurfaceWindowLeaseRole | null => {
  if (session.source === "preview") {
    return "preview";
  }

  switch (session.panelId) {
    case "git":
      return "git-helper";
    case "problems":
      return "problems-helper";
    case "terminal":
      return "terminal-helper";
    default:
      return null;
  }
};

export const isSurfaceWindowLeaseSupported = (
  session: SurfaceSession,
): boolean => {
  switch (getSurfaceWindowLeaseRole(session)) {
    case "preview":
    case "git-helper":
    case "problems-helper":
    case "terminal-helper":
      return true;
    default:
      return false;
  }
};

export const buildSurfaceWindowLeaseCommands = (
  session: SurfaceSession,
  options: {
    supported?: boolean;
    detachedAvailable?: boolean;
    unsupportedReason?: string;
  } = {},
): SurfaceWindowLeaseCommand[] => {
  const supported = options.supported ?? isSurfaceWindowLeaseSupported(session);
  const detachedAvailable = options.detachedAvailable ?? false;
  const unsupportedReason =
    options.unsupportedReason ?? UNSUPPORTED_WINDOW_LEASE_REASON;

  if (!supported) {
    return [
      command(session.id, "detach", "Move to Window", false, unsupportedReason),
    ];
  }

  if (session.hostMode === "detached") {
    return [
      command(session.id, "focus-window", "Focus Window", true),
      command(session.id, "return-to-main", "Return Layout", true),
      command(session.id, "close-window", "Close Window", true),
    ];
  }

  return [
    command(
      session.id,
      "detach",
      "Move to Window",
      detachedAvailable,
      detachedAvailable ? undefined : GATED_WINDOW_LEASE_REASON,
    ),
  ];
};

export const cleanupSurfaceWindowLeases = (
  leases: Readonly<Record<string, SurfaceWindowLeaseRecord>>,
  sessions: readonly SurfaceSession[],
  now = Date.now(),
): {
  activeLeases: Record<string, SurfaceWindowLeaseRecord>;
  staleLeases: SurfaceWindowLeaseRecord[];
} => {
  const sessionIds = new Set(sessions.map((session) => session.id));
  const activeLeases: Record<string, SurfaceWindowLeaseRecord> = {};
  const staleLeases: SurfaceWindowLeaseRecord[] = [];

  Object.entries(leases).forEach(([surfaceId, lease]) => {
    if (sessionIds.has(surfaceId)) {
      activeLeases[surfaceId] = cloneLease(lease);
      return;
    }

    staleLeases.push({
      ...cloneLease(lease),
      status: "stale",
      updatedAt: now,
    });
  });

  return { activeLeases, staleLeases };
};

export const buildSurfaceWindowLeaseReadModel = (
  sessions: readonly SurfaceSession[],
  options: SurfaceWindowLeaseReadOptions = {},
): SurfaceWindowLeaseReadModel => {
  const detachedAvailable = options.detachedAvailable ?? false;
  const now = options.now ?? Date.now();
  const { activeLeases, staleLeases } = cleanupSurfaceWindowLeases(
    options.existingLeases ?? {},
    sessions,
    now,
  );
  const supportedSurfaceIds: string[] = [];
  const unsupportedSurfaceIds: string[] = [];
  const leasesBySurfaceId: Record<string, SurfaceWindowLeaseRecord> = {};
  const commandsBySurfaceId: Record<string, SurfaceWindowLeaseCommand[]> = {};

  sessions.forEach((session) => {
    const role = getSurfaceWindowLeaseRole(session);
    const supported = isSurfaceWindowLeaseSupported(session);
    if (!role || !supported) {
      unsupportedSurfaceIds.push(session.id);
      commandsBySurfaceId[session.id] = buildSurfaceWindowLeaseCommands(
        session,
        {
          supported: false,
          detachedAvailable,
          unsupportedReason: role
            ? PREVIEW_ONLY_WINDOW_LEASE_REASON
            : UNSUPPORTED_WINDOW_LEASE_REASON,
        },
      );
      return;
    }

    supportedSurfaceIds.push(session.id);
    const existingLease = activeLeases[session.id];
    leasesBySurfaceId[session.id] = existingLease
      ? {
          ...existingLease,
          role,
          appletKind: session.appletKind,
          status: session.hostMode === "detached" ? "detached" : "attached",
          hostMode: session.hostMode,
          nativeWindowId: session.nativeWindowId,
          updatedAt: now,
          policy: { ...DEFAULT_WINDOW_LEASE_POLICY },
        }
      : {
          id: `lease:${session.id}`,
          surfaceId: session.id,
          role,
          appletKind: session.appletKind,
          status: session.hostMode === "detached" ? "detached" : "attached",
          hostMode: session.hostMode,
          nativeWindowId: session.nativeWindowId,
          updatedAt: now,
          policy: { ...DEFAULT_WINDOW_LEASE_POLICY },
        };
    commandsBySurfaceId[session.id] = buildSurfaceWindowLeaseCommands(session, {
      supported: true,
      detachedAvailable,
    });
  });

  return {
    version: 1,
    detachedAvailable,
    supportedSurfaceIds,
    unsupportedSurfaceIds,
    leasesBySurfaceId,
    commandsBySurfaceId,
    staleLeaseIds: staleLeases.map((lease) => lease.id),
  };
};
