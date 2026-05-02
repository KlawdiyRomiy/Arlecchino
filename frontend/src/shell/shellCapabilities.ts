import { useEffect, useSyncExternalStore } from "react";

export type ShellCapabilityStatus =
  | "available"
  | "unavailable"
  | "experimental"
  | "requires-build"
  | "requires-entitlement"
  | "platform-limited";

export type ShellCapabilitySource = "fallback" | "runtime" | "backend";

export type ShellCapabilityName =
  | "multiWindow"
  | "nativeMenu"
  | "contextMenu"
  | "tray"
  | "notifications"
  | "backgroundStatus"
  | "clipboard"
  | "dialogs"
  | "customProtocol"
  | "fileAssociations"
  | "singleInstance"
  | "autoUpdate"
  | "materialBackdrop"
  | "dockBadges"
  | "browserOpenURL";

export interface ShellCapabilityDescriptor {
  status: ShellCapabilityStatus;
  reason: string;
  source: ShellCapabilitySource;
}

export type ShellCapabilities = Record<
  ShellCapabilityName,
  ShellCapabilityDescriptor
>;

export interface ShellCapabilitiesSnapshot {
  capabilities: ShellCapabilities;
  revision: number;
  loadedFromBackend: boolean;
  platform?: string;
  runtime?: string;
  version?: number;
}

type ShellCapabilityOverride = Omit<ShellCapabilityDescriptor, "source"> &
  Partial<Pick<ShellCapabilityDescriptor, "source">>;

const listeners = new Set<() => void>();

const cloneDescriptor = (
  descriptor: ShellCapabilityDescriptor,
): ShellCapabilityDescriptor => ({ ...descriptor });

const cloneCapabilities = (
  capabilities: ShellCapabilities,
): ShellCapabilities =>
  Object.fromEntries(
    Object.entries(capabilities).map(([name, descriptor]) => [
      name,
      cloneDescriptor(descriptor),
    ]),
  ) as ShellCapabilities;

const createDescriptor = (
  status: ShellCapabilityStatus,
  reason: string,
): ShellCapabilityDescriptor => ({
  status,
  reason,
  source: "fallback",
});

const FALLBACK_CAPABILITIES: ShellCapabilities = {
  multiWindow: createDescriptor(
    "experimental",
    "Wails v3 multi-window is a spike-only path until window leases and focus are verified.",
  ),
  nativeMenu: createDescriptor(
    "available",
    "Application menu actions are already bridged through the shell menu layer.",
  ),
  contextMenu: createDescriptor(
    "unavailable",
    "Native context menu routing is not wired yet; DOM scoped menus remain the fallback.",
  ),
  tray: createDescriptor(
    "unavailable",
    "Tray integration stays disabled while Background Shell Status runs as a read model.",
  ),
  notifications: createDescriptor(
    "unavailable",
    "Native notification delivery stays disabled; Background Shell Status only produces rate-limited candidates.",
  ),
  backgroundStatus: createDescriptor(
    "available",
    "Background Shell Status read model is available for future tray and notification consumers.",
  ),
  clipboard: createDescriptor(
    "available",
    "Clipboard read/write is available through the frontend runtime wrapper.",
  ),
  dialogs: createDescriptor(
    "unavailable",
    "Generic shell dialog capability is not exposed through a typed frontend boundary yet.",
  ),
  customProtocol: createDescriptor(
    "requires-build",
    "Custom protocol handling requires packaged-app registration and strict intent routing.",
  ),
  fileAssociations: createDescriptor(
    "requires-build",
    "File associations require packaged-app registration and open-request routing.",
  ),
  singleInstance: createDescriptor(
    "requires-build",
    "Single-instance routing requires packaged-app launch/open-file handling before it is enabled.",
  ),
  autoUpdate: createDescriptor(
    "experimental",
    "Auto-update can verify signed ZIP artifacts and apply user-confirmed relaunch installs without Developer ID.",
  ),
  materialBackdrop: createDescriptor(
    "platform-limited",
    "Backdrop/material behavior is platform-specific and must be verified per window role.",
  ),
  dockBadges: createDescriptor(
    "platform-limited",
    "Dock or taskbar badges are platform-specific and deferred until job state is centralized.",
  ),
  browserOpenURL: createDescriptor(
    "available",
    "External browser opening is available through the frontend runtime wrapper.",
  ),
};

type ShellCapabilitiesMetadata = Pick<
  ShellCapabilitiesSnapshot,
  "loadedFromBackend" | "platform" | "runtime" | "version"
>;

const FALLBACK_METADATA: ShellCapabilitiesMetadata = {
  loadedFromBackend: false,
};

const buildSnapshotFingerprint = (
  capabilities: ShellCapabilities,
  metadata: ShellCapabilitiesMetadata,
): string =>
  JSON.stringify({
    capabilities,
    loadedFromBackend: metadata.loadedFromBackend,
    platform: metadata.platform ?? null,
    runtime: metadata.runtime ?? null,
    version: metadata.version ?? null,
  });

const INITIAL_SNAPSHOT: ShellCapabilitiesSnapshot = {
  capabilities: cloneCapabilities(FALLBACK_CAPABILITIES),
  revision: 0,
  ...FALLBACK_METADATA,
};

let snapshotFingerprint = buildSnapshotFingerprint(
  FALLBACK_CAPABILITIES,
  FALLBACK_METADATA,
);
let snapshot: ShellCapabilitiesSnapshot = INITIAL_SNAPSHOT;

const buildSnapshot = (
  capabilities: ShellCapabilities,
  metadata: ShellCapabilitiesMetadata,
): ShellCapabilitiesSnapshot => ({
  capabilities: cloneCapabilities(capabilities),
  revision: snapshot.revision + 1,
  ...metadata,
});

export const getFallbackShellCapabilities = (): ShellCapabilities =>
  cloneCapabilities(FALLBACK_CAPABILITIES);

export const getShellCapabilitiesSnapshot = (): ShellCapabilitiesSnapshot =>
  snapshot;

export const subscribeShellCapabilities = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const SHELL_CAPABILITY_NAMES: readonly ShellCapabilityName[] = [
  "multiWindow",
  "nativeMenu",
  "contextMenu",
  "tray",
  "notifications",
  "backgroundStatus",
  "clipboard",
  "dialogs",
  "customProtocol",
  "fileAssociations",
  "singleInstance",
  "autoUpdate",
  "materialBackdrop",
  "dockBadges",
  "browserOpenURL",
];

const SHELL_CAPABILITY_STATUSES: readonly ShellCapabilityStatus[] = [
  "available",
  "unavailable",
  "experimental",
  "requires-build",
  "requires-entitlement",
  "platform-limited",
];

const SHELL_CAPABILITY_SOURCES: readonly ShellCapabilitySource[] = [
  "fallback",
  "runtime",
  "backend",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isShellCapabilityName = (value: string): value is ShellCapabilityName =>
  (SHELL_CAPABILITY_NAMES as readonly string[]).includes(value);

const isShellCapabilityStatus = (
  value: unknown,
): value is ShellCapabilityStatus =>
  typeof value === "string" &&
  (SHELL_CAPABILITY_STATUSES as readonly string[]).includes(value);

const isShellCapabilitySource = (
  value: unknown,
): value is ShellCapabilitySource =>
  typeof value === "string" &&
  (SHELL_CAPABILITY_SOURCES as readonly string[]).includes(value);

const getRecordValue = (
  record: Record<string, unknown>,
  camelKey: string,
  pascalKey: string,
): unknown =>
  Object.prototype.hasOwnProperty.call(record, camelKey)
    ? record[camelKey]
    : record[pascalKey];

const normalizeCapabilityOverrides = (
  value: unknown,
  defaultSource: ShellCapabilitySource,
): Partial<Record<ShellCapabilityName, ShellCapabilityOverride>> => {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<
    Partial<Record<ShellCapabilityName, ShellCapabilityOverride>>
  >((accumulator, [name, descriptor]) => {
    if (!isShellCapabilityName(name) || !isRecord(descriptor)) {
      return accumulator;
    }

    const status = getRecordValue(descriptor, "status", "Status");
    if (!isShellCapabilityStatus(status)) {
      return accumulator;
    }

    const reason = getRecordValue(descriptor, "reason", "Reason");
    const source = getRecordValue(descriptor, "source", "Source");
    accumulator[name] = {
      status,
      reason:
        typeof reason === "string" && reason.trim()
          ? reason.trim()
          : FALLBACK_CAPABILITIES[name].reason,
      source: isShellCapabilitySource(source) ? source : defaultSource,
    };
    return accumulator;
  }, {});
};

export const normalizeShellCapabilitiesPayload = (
  payload: unknown,
): {
  capabilities: Partial<Record<ShellCapabilityName, ShellCapabilityOverride>>;
  platform?: string;
  runtime?: string;
  version?: number;
} => {
  if (!isRecord(payload)) {
    return { capabilities: {} };
  }

  const capabilitiesValue = getRecordValue(
    payload,
    "capabilities",
    "Capabilities",
  );
  const capabilitiesSource = isRecord(capabilitiesValue)
    ? capabilitiesValue
    : payload;
  const platform = getRecordValue(payload, "platform", "Platform");
  const runtime = getRecordValue(payload, "runtime", "Runtime");
  const version = getRecordValue(payload, "version", "Version");

  return {
    capabilities: normalizeCapabilityOverrides(capabilitiesSource, "backend"),
    platform:
      typeof platform === "string" && platform.trim()
        ? platform.trim()
        : undefined,
    runtime:
      typeof runtime === "string" && runtime.trim()
        ? runtime.trim()
        : undefined,
    version:
      typeof version === "number" && Number.isFinite(version)
        ? version
        : undefined,
  };
};

const syncShellCapabilitiesSnapshot = (
  capabilities: Partial<Record<ShellCapabilityName, ShellCapabilityOverride>>,
  metadata: ShellCapabilitiesMetadata,
  defaultSource: ShellCapabilitySource,
): ShellCapabilitiesSnapshot => {
  const nextCapabilities = cloneCapabilities(FALLBACK_CAPABILITIES);
  for (const [name, descriptor] of Object.entries(capabilities)) {
    if (!isShellCapabilityName(name) || !descriptor) {
      continue;
    }

    nextCapabilities[name] = {
      status: descriptor.status,
      reason: descriptor.reason.trim() || FALLBACK_CAPABILITIES[name].reason,
      source: descriptor.source ?? defaultSource,
    };
  }

  const nextFingerprint = buildSnapshotFingerprint(nextCapabilities, metadata);
  if (nextFingerprint === snapshotFingerprint) {
    return snapshot;
  }

  snapshotFingerprint = nextFingerprint;
  snapshot = buildSnapshot(nextCapabilities, metadata);
  listeners.forEach((listener) => listener());
  return snapshot;
};

export const syncShellCapabilities = (
  capabilities: Partial<Record<ShellCapabilityName, ShellCapabilityOverride>>,
): ShellCapabilitiesSnapshot =>
  syncShellCapabilitiesSnapshot(
    capabilities,
    {
      loadedFromBackend: false,
      platform: snapshot.platform,
      runtime: snapshot.runtime,
      version: snapshot.version,
    },
    "runtime",
  );

export const syncShellCapabilitiesFromPayload = (
  payload: unknown,
): ShellCapabilitiesSnapshot => {
  const normalized = normalizeShellCapabilitiesPayload(payload);
  return syncShellCapabilitiesSnapshot(
    normalized.capabilities,
    {
      loadedFromBackend: true,
      platform: normalized.platform,
      runtime: normalized.runtime,
      version: normalized.version,
    },
    "backend",
  );
};

export const isShellCapabilityUsable = (
  capability: ShellCapabilityDescriptor,
): boolean =>
  capability.status === "available" || capability.status === "experimental";

export const canUseShellCapability = (name: ShellCapabilityName): boolean =>
  isShellCapabilityUsable(snapshot.capabilities[name]);

export function useShellCapabilities(): ShellCapabilitiesSnapshot {
  return useSyncExternalStore(
    subscribeShellCapabilities,
    getShellCapabilitiesSnapshot,
    getShellCapabilitiesSnapshot,
  );
}

interface ShellCapabilitiesBridge {
  GetShellCapabilities?: () => Promise<unknown> | unknown;
}

interface ShellCapabilitiesRuntimeModule {
  Call?: {
    ByName?: (methodName: string, ...args: unknown[]) => Promise<unknown>;
  };
}

const shellCapabilitiesMethodNames = [
  "main.App.GetShellCapabilities",
  "arlecchino.App.GetShellCapabilities",
] as const;

let shellCapabilitiesMethodName:
  | (typeof shellCapabilitiesMethodNames)[number]
  | undefined;

const getShellCapabilitiesBridge = (): ShellCapabilitiesBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as unknown as {
    go?: {
      main?: {
        App?: ShellCapabilitiesBridge;
      };
    };
  };

  return maybeWindow.go?.main?.App ?? null;
};

const loadShellCapabilitiesPayloadFromBridge = async (
  bridge: ShellCapabilitiesBridge,
): Promise<unknown | undefined> => {
  if (typeof bridge.GetShellCapabilities !== "function") {
    return undefined;
  }

  try {
    return await Promise.resolve(bridge.GetShellCapabilities());
  } catch {
    return undefined;
  }
};

const loadShellCapabilitiesPayloadByName = async (): Promise<
  unknown | undefined
> => {
  let runtimeModule: ShellCapabilitiesRuntimeModule;
  try {
    runtimeModule =
      (await import("/wails/runtime.js")) as ShellCapabilitiesRuntimeModule;
  } catch {
    return undefined;
  }

  const call = runtimeModule.Call;
  if (!call?.ByName) {
    return undefined;
  }

  if (shellCapabilitiesMethodName) {
    try {
      return await call.ByName(shellCapabilitiesMethodName);
    } catch {
      shellCapabilitiesMethodName = undefined;
    }
  }

  for (const methodName of shellCapabilitiesMethodNames) {
    try {
      const payload = await call.ByName(methodName);
      shellCapabilitiesMethodName = methodName;
      return payload;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return undefined;
};

export async function loadShellCapabilitiesFromBackend(
  bridge?: ShellCapabilitiesBridge | null,
): Promise<ShellCapabilitiesSnapshot> {
  const resolvedBridge =
    bridge === undefined ? getShellCapabilitiesBridge() : bridge;
  if (resolvedBridge) {
    const payload =
      await loadShellCapabilitiesPayloadFromBridge(resolvedBridge);
    if (payload !== undefined) {
      return syncShellCapabilitiesFromPayload(payload);
    }
  }

  if (bridge !== null) {
    const payload = await loadShellCapabilitiesPayloadByName();
    if (payload !== undefined) {
      return syncShellCapabilitiesFromPayload(payload);
    }
  }

  return getShellCapabilitiesSnapshot();
}

export function useShellCapabilitiesBridge(
  getShellCapabilities?: ShellCapabilitiesBridge["GetShellCapabilities"],
): void {
  useEffect(() => {
    void loadShellCapabilitiesFromBackend(
      getShellCapabilities
        ? { GetShellCapabilities: getShellCapabilities }
        : undefined,
    );
  }, [getShellCapabilities]);
}
