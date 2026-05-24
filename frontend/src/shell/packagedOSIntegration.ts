import { useEffect, useSyncExternalStore } from "react";

import type { ShellCapabilityStatus } from "./shellCapabilities";

export type PackagedOSAdapterId =
  | "customProtocol"
  | "fileAssociations"
  | "tray"
  | "notifications"
  | "dockBadges"
  | "autoUpdate";

export interface PackagedOSAdapter {
  id: PackagedOSAdapterId;
  label: string;
  capability: string;
  status: ShellCapabilityStatus;
  enabled: boolean;
  defaultEnabled: boolean;
  requiresPackagedBuild: boolean;
  reason: string;
  backgroundActionCount?: number;
  notificationCandidateCount?: number;
}

export interface PackagedOSBackgroundAction {
  id: string;
  label: string;
  intent: string;
  jobId?: string;
  ownerSurfaceId?: string;
  enabled: boolean;
}

export interface PackagedOSNotificationCandidate {
  id: string;
  jobId: string;
  severity: string;
  title: string;
  body: string;
  dedupeKey: string;
  createdAt: number;
  action?: PackagedOSBackgroundAction;
}

export interface PackagedOSAutoUpdateManifest {
  channel?: string;
  version?: string;
  build?: string;
  artifacts?: readonly PackagedOSAutoUpdateArtifact[];
  releaseNotes?: string;
  mandatory?: boolean;
  url?: string;
  sha256?: string;
  signature?: string;
  notes?: string;
}

export interface PackagedOSAutoUpdateArtifact {
  platform?: string;
  arch?: string;
  url?: string;
  sha256?: string;
  signature?: string;
  size?: number;
  kind?: string;
}

export interface PackagedOSIntegrationSnapshot {
  version: number;
  platform?: string;
  runtime?: string;
  packagedBuild: boolean;
  spikeEnabled: boolean;
  nativeTrayEnabled: boolean;
  nativeNotificationsSent: boolean;
  adapters: Record<PackagedOSAdapterId, PackagedOSAdapter>;
  backgroundActions: readonly PackagedOSBackgroundAction[];
  notificationCandidates: readonly PackagedOSNotificationCandidate[];
  autoUpdateManifest?: PackagedOSAutoUpdateManifest;
  revision: number;
  loadedFromBackend: boolean;
}

export interface PackagedOSActionResult {
  handled: boolean;
  adapterId?: string;
  backgroundAction?: PackagedOSBackgroundAction;
  backgroundResult?: unknown;
  message?: string;
}

interface PackagedOSBridge {
  GetPackagedOSIntegrationStatus?: () => Promise<unknown> | unknown;
  RunPackagedOSIntegrationAction?: (
    actionId: string,
  ) => Promise<unknown> | unknown;
}

interface PackagedOSRuntimeModule {
  Call?: {
    ByName?: (methodName: string, ...args: unknown[]) => Promise<unknown>;
  };
}

const PACKAGED_OS_ADAPTER_IDS: readonly PackagedOSAdapterId[] = [
  "customProtocol",
  "fileAssociations",
  "tray",
  "notifications",
  "dockBadges",
  "autoUpdate",
];

const FALLBACK_ADAPTERS: Record<PackagedOSAdapterId, PackagedOSAdapter> = {
  customProtocol: {
    id: "customProtocol",
    label: "Custom URL Protocol",
    capability: "customProtocol",
    status: "requires-build",
    enabled: false,
    defaultEnabled: false,
    requiresPackagedBuild: true,
    reason:
      "Custom protocol registration requires packaged-app smoke and strict open-intent routing.",
  },
  fileAssociations: {
    id: "fileAssociations",
    label: "File Associations",
    capability: "fileAssociations",
    status: "requires-build",
    enabled: false,
    defaultEnabled: false,
    requiresPackagedBuild: true,
    reason:
      "File associations require packaged-app smoke and open-file routing validation.",
  },
  tray: {
    id: "tray",
    label: "Tray",
    capability: "tray",
    status: "unavailable",
    enabled: false,
    defaultEnabled: false,
    requiresPackagedBuild: true,
    reason:
      "Tray adapter is prepared, but native tray remains off until packaged smoke enables it.",
  },
  notifications: {
    id: "notifications",
    label: "Notifications",
    capability: "notifications",
    status: "unavailable",
    enabled: false,
    defaultEnabled: false,
    requiresPackagedBuild: true,
    reason:
      "Notification adapter is prepared, but native delivery remains off until packaged smoke enables it.",
  },
  dockBadges: {
    id: "dockBadges",
    label: "Dock/Taskbar Badges",
    capability: "dockBadges",
    status: "platform-limited",
    enabled: false,
    defaultEnabled: false,
    requiresPackagedBuild: true,
    reason:
      "Dock/taskbar badge adapter is prepared, but native badges remain off until packaged smoke enables them.",
  },
  autoUpdate: {
    id: "autoUpdate",
    label: "Auto Update",
    capability: "autoUpdate",
    status: "unavailable",
    enabled: false,
    defaultEnabled: false,
    requiresPackagedBuild: true,
    reason:
      "Auto-update remains disabled; manifest reading is available only as a placeholder.",
  },
};

const listeners = new Set<() => void>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRecordValue = (
  record: Record<string, unknown>,
  camelKey: string,
  pascalKey: string,
): unknown =>
  Object.prototype.hasOwnProperty.call(record, camelKey)
    ? record[camelKey]
    : record[pascalKey];

const isCapabilityStatus = (value: unknown): value is ShellCapabilityStatus =>
  typeof value === "string" &&
  [
    "available",
    "unavailable",
    "experimental",
    "requires-build",
    "requires-entitlement",
    "platform-limited",
  ].includes(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : false;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const cloneAction = (
  action: PackagedOSBackgroundAction,
): PackagedOSBackgroundAction => ({ ...action });

const cloneCandidate = (
  candidate: PackagedOSNotificationCandidate,
): PackagedOSNotificationCandidate => ({
  ...candidate,
  action: candidate.action ? cloneAction(candidate.action) : undefined,
});

const cloneAdapter = (adapter: PackagedOSAdapter): PackagedOSAdapter => ({
  ...adapter,
});

const cloneAdapters = (
  adapters: Record<PackagedOSAdapterId, PackagedOSAdapter>,
): Record<PackagedOSAdapterId, PackagedOSAdapter> =>
  Object.fromEntries(
    Object.entries(adapters).map(([id, adapter]) => [
      id,
      cloneAdapter(adapter),
    ]),
  ) as Record<PackagedOSAdapterId, PackagedOSAdapter>;

const normalizeAction = (
  value: unknown,
): PackagedOSBackgroundAction | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(getRecordValue(value, "id", "ID"));
  const label = readString(getRecordValue(value, "label", "Label"));
  const intent = readString(getRecordValue(value, "intent", "Intent"));
  if (!id || !label || !intent) {
    return undefined;
  }

  return {
    id,
    label,
    intent,
    jobId: readString(getRecordValue(value, "jobId", "JobID")),
    ownerSurfaceId: readString(
      getRecordValue(value, "ownerSurfaceId", "OwnerSurfaceID"),
    ),
    enabled: readBoolean(getRecordValue(value, "enabled", "Enabled")),
  };
};

const normalizeCandidate = (
  value: unknown,
): PackagedOSNotificationCandidate | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(getRecordValue(value, "id", "ID"));
  const jobId = readString(getRecordValue(value, "jobId", "JobID"));
  const severity = readString(getRecordValue(value, "severity", "Severity"));
  const title = readString(getRecordValue(value, "title", "Title"));
  const body = readString(getRecordValue(value, "body", "Body"));
  const dedupeKey = readString(getRecordValue(value, "dedupeKey", "DedupeKey"));
  const createdAt = readNumber(getRecordValue(value, "createdAt", "CreatedAt"));
  if (
    !id ||
    !jobId ||
    !severity ||
    !title ||
    !body ||
    !dedupeKey ||
    !createdAt
  ) {
    return undefined;
  }

  return {
    id,
    jobId,
    severity,
    title,
    body,
    dedupeKey,
    createdAt,
    action: normalizeAction(getRecordValue(value, "action", "Action")),
  };
};

const normalizeAdapter = (
  id: PackagedOSAdapterId,
  value: unknown,
): PackagedOSAdapter => {
  const fallback = FALLBACK_ADAPTERS[id];
  if (!isRecord(value)) {
    return cloneAdapter(fallback);
  }

  const status = getRecordValue(value, "status", "Status");
  return {
    id,
    label:
      readString(getRecordValue(value, "label", "Label")) ?? fallback.label,
    capability:
      readString(getRecordValue(value, "capability", "Capability")) ??
      fallback.capability,
    status: isCapabilityStatus(status) ? status : fallback.status,
    enabled: readBoolean(getRecordValue(value, "enabled", "Enabled")),
    defaultEnabled: readBoolean(
      getRecordValue(value, "defaultEnabled", "DefaultEnabled"),
    ),
    requiresPackagedBuild: readBoolean(
      getRecordValue(value, "requiresPackagedBuild", "RequiresPackagedBuild"),
    ),
    reason:
      readString(getRecordValue(value, "reason", "Reason")) ?? fallback.reason,
    backgroundActionCount:
      readNumber(
        getRecordValue(value, "backgroundActionCount", "BackgroundActionCount"),
      ) ?? fallback.backgroundActionCount,
    notificationCandidateCount:
      readNumber(
        getRecordValue(
          value,
          "notificationCandidateCount",
          "NotificationCandidateCount",
        ),
      ) ?? fallback.notificationCandidateCount,
  };
};

const normalizeManifest = (
  value: unknown,
): PackagedOSAutoUpdateManifest | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const manifest = {
    channel: readString(getRecordValue(value, "channel", "Channel")),
    version: readString(getRecordValue(value, "version", "Version")),
    build: readString(getRecordValue(value, "build", "Build")),
    artifacts: normalizeArtifacts(
      getRecordValue(value, "artifacts", "Artifacts"),
    ),
    releaseNotes: readString(
      getRecordValue(value, "releaseNotes", "ReleaseNotes"),
    ),
    mandatory: readBoolean(getRecordValue(value, "mandatory", "Mandatory")),
    url: readString(getRecordValue(value, "url", "URL")),
    sha256: readString(getRecordValue(value, "sha256", "SHA256")),
    signature: readString(getRecordValue(value, "signature", "Signature")),
    notes: readString(getRecordValue(value, "notes", "Notes")),
  };
  return Object.values(manifest).some((item) =>
    Array.isArray(item) ? item.length > 0 : Boolean(item),
  )
    ? manifest
    : undefined;
};

const normalizeArtifact = (
  value: unknown,
): PackagedOSAutoUpdateArtifact | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const artifact = {
    platform: readString(getRecordValue(value, "platform", "Platform")),
    arch: readString(getRecordValue(value, "arch", "Arch")),
    url: readString(getRecordValue(value, "url", "URL")),
    sha256: readString(getRecordValue(value, "sha256", "SHA256")),
    signature: readString(getRecordValue(value, "signature", "Signature")),
    size: readNumber(getRecordValue(value, "size", "Size")),
    kind: readString(getRecordValue(value, "kind", "Kind")),
  };

  return Object.values(artifact).some(Boolean) ? artifact : undefined;
};

const normalizeArtifacts = (
  value: unknown,
): readonly PackagedOSAutoUpdateArtifact[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const artifacts = value.flatMap((item) => {
    const artifact = normalizeArtifact(item);
    return artifact ? [artifact] : [];
  });

  return artifacts.length > 0 ? artifacts : undefined;
};

const buildFallbackSnapshot = (): PackagedOSIntegrationSnapshot => ({
  version: 1,
  packagedBuild: false,
  spikeEnabled: false,
  nativeTrayEnabled: false,
  nativeNotificationsSent: false,
  adapters: cloneAdapters(FALLBACK_ADAPTERS),
  backgroundActions: [],
  notificationCandidates: [],
  revision: 0,
  loadedFromBackend: false,
});

const buildSnapshotFingerprint = (
  value: Omit<PackagedOSIntegrationSnapshot, "revision">,
): string => JSON.stringify(value);

let snapshot = buildFallbackSnapshot();
let snapshotFingerprint = buildSnapshotFingerprint(snapshot);

const cloneSnapshot = (
  value: PackagedOSIntegrationSnapshot,
): PackagedOSIntegrationSnapshot => ({
  ...value,
  adapters: cloneAdapters(value.adapters),
  backgroundActions: value.backgroundActions.map(cloneAction),
  notificationCandidates: value.notificationCandidates.map(cloneCandidate),
  autoUpdateManifest: value.autoUpdateManifest
    ? { ...value.autoUpdateManifest }
    : undefined,
});

export const getFallbackPackagedOSIntegration =
  (): PackagedOSIntegrationSnapshot => buildFallbackSnapshot();

export const getPackagedOSIntegrationSnapshot =
  (): PackagedOSIntegrationSnapshot => snapshot;

export const subscribePackagedOSIntegration = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const normalizePackagedOSIntegrationPayload = (
  payload: unknown,
): Omit<PackagedOSIntegrationSnapshot, "revision" | "loadedFromBackend"> => {
  if (!isRecord(payload)) {
    return getFallbackPackagedOSIntegration();
  }

  const adaptersValue = getRecordValue(payload, "adapters", "Adapters");
  const adaptersSource = isRecord(adaptersValue) ? adaptersValue : {};
  const adapters = PACKAGED_OS_ADAPTER_IDS.reduce<
    Record<PackagedOSAdapterId, PackagedOSAdapter>
  >(
    (accumulator, id) => {
      accumulator[id] = normalizeAdapter(id, adaptersSource[id]);
      return accumulator;
    },
    {} as Record<PackagedOSAdapterId, PackagedOSAdapter>,
  );

  const actionsValue = getRecordValue(
    payload,
    "backgroundActions",
    "BackgroundActions",
  );
  const candidatesValue = getRecordValue(
    payload,
    "notificationCandidates",
    "NotificationCandidates",
  );

  return {
    version:
      readNumber(getRecordValue(payload, "version", "Version")) ??
      packagedFallbackVersion(),
    platform: readString(getRecordValue(payload, "platform", "Platform")),
    runtime: readString(getRecordValue(payload, "runtime", "Runtime")),
    packagedBuild: readBoolean(
      getRecordValue(payload, "packagedBuild", "PackagedBuild"),
    ),
    spikeEnabled: readBoolean(
      getRecordValue(payload, "spikeEnabled", "SpikeEnabled"),
    ),
    nativeTrayEnabled: readBoolean(
      getRecordValue(payload, "nativeTrayEnabled", "NativeTrayEnabled"),
    ),
    nativeNotificationsSent: readBoolean(
      getRecordValue(
        payload,
        "nativeNotificationsSent",
        "NativeNotificationsSent",
      ),
    ),
    adapters,
    backgroundActions: Array.isArray(actionsValue)
      ? actionsValue.flatMap((action) => {
          const normalized = normalizeAction(action);
          return normalized ? [normalized] : [];
        })
      : [],
    notificationCandidates: Array.isArray(candidatesValue)
      ? candidatesValue.flatMap((candidate) => {
          const normalized = normalizeCandidate(candidate);
          return normalized ? [normalized] : [];
        })
      : [],
    autoUpdateManifest: normalizeManifest(
      getRecordValue(payload, "autoUpdateManifest", "AutoUpdateManifest"),
    ),
  };
};

const packagedFallbackVersion = (): number => 1;

export const syncPackagedOSIntegrationFromPayload = (
  payload: unknown,
): PackagedOSIntegrationSnapshot => {
  const normalized = normalizePackagedOSIntegrationPayload(payload);
  const nextWithoutRevision = {
    ...normalized,
    loadedFromBackend: true,
  };
  const nextFingerprint = buildSnapshotFingerprint(nextWithoutRevision);
  if (nextFingerprint === snapshotFingerprint) {
    return snapshot;
  }

  const next = {
    ...nextWithoutRevision,
    revision: snapshot.revision + 1,
  };
  snapshot = cloneSnapshot(next);
  snapshotFingerprint = nextFingerprint;
  listeners.forEach((listener) => listener());
  return snapshot;
};

const packagedOSMethodNames = [
  "arlecchino/internal/app.App.GetPackagedOSIntegrationStatus",
  "main.App.GetPackagedOSIntegrationStatus",
  "arlecchino.App.GetPackagedOSIntegrationStatus",
] as const;
const packagedOSActionMethodNames = [
  "arlecchino/internal/app.App.RunPackagedOSIntegrationAction",
  "main.App.RunPackagedOSIntegrationAction",
  "arlecchino.App.RunPackagedOSIntegrationAction",
] as const;

let packagedOSMethodName: (typeof packagedOSMethodNames)[number] | undefined;
let packagedOSActionMethodName:
  | (typeof packagedOSActionMethodNames)[number]
  | undefined;

const getPackagedOSBridge = (): PackagedOSBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    (window as unknown as { go?: { main?: { App?: PackagedOSBridge } } }).go
      ?.main?.App ?? null
  );
};

const loadRuntimeModule = async (): Promise<
  PackagedOSRuntimeModule | undefined
> => {
  try {
    return (await import("/wails/runtime.js")) as PackagedOSRuntimeModule;
  } catch {
    return undefined;
  }
};

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

export async function loadPackagedOSIntegrationFromBackend(
  bridge?: PackagedOSBridge | null,
): Promise<PackagedOSIntegrationSnapshot> {
  const resolvedBridge = bridge === undefined ? getPackagedOSBridge() : bridge;
  if (typeof resolvedBridge?.GetPackagedOSIntegrationStatus === "function") {
    const payload = await Promise.resolve(
      resolvedBridge.GetPackagedOSIntegrationStatus(),
    );
    return syncPackagedOSIntegrationFromPayload(payload);
  }

  if (bridge !== null) {
    const payload = await callByKnownName(
      packagedOSMethodNames,
      packagedOSMethodName,
      (value) => {
        packagedOSMethodName = value as typeof packagedOSMethodName;
      },
    );
    if (payload !== undefined) {
      return syncPackagedOSIntegrationFromPayload(payload);
    }
  }

  return getPackagedOSIntegrationSnapshot();
}

export async function runPackagedOSIntegrationAction(
  actionId: string,
  bridge?: PackagedOSBridge | null,
): Promise<PackagedOSActionResult> {
  const resolvedBridge = bridge === undefined ? getPackagedOSBridge() : bridge;
  if (typeof resolvedBridge?.RunPackagedOSIntegrationAction === "function") {
    return (await Promise.resolve(
      resolvedBridge.RunPackagedOSIntegrationAction(actionId),
    )) as PackagedOSActionResult;
  }

  if (bridge !== null) {
    const payload = await callByKnownName(
      packagedOSActionMethodNames,
      packagedOSActionMethodName,
      (value) => {
        packagedOSActionMethodName = value as typeof packagedOSActionMethodName;
      },
      actionId,
    );
    if (isRecord(payload)) {
      return payload as unknown as PackagedOSActionResult;
    }
  }

  return {
    handled: false,
    message: "Packaged OS action bridge is unavailable.",
  };
}

export function usePackagedOSIntegration(): PackagedOSIntegrationSnapshot {
  return useSyncExternalStore(
    subscribePackagedOSIntegration,
    getPackagedOSIntegrationSnapshot,
    getPackagedOSIntegrationSnapshot,
  );
}

export function usePackagedOSIntegrationBridge(
  getPackagedOSIntegrationStatus?: PackagedOSBridge["GetPackagedOSIntegrationStatus"],
): void {
  useEffect(() => {
    void loadPackagedOSIntegrationFromBackend(
      getPackagedOSIntegrationStatus
        ? { GetPackagedOSIntegrationStatus: getPackagedOSIntegrationStatus }
        : undefined,
    );
  }, [getPackagedOSIntegrationStatus]);
}
