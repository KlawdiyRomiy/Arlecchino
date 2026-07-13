import { useEffect, useSyncExternalStore } from "react";

export const AUTO_UPDATE_STATUS_EVENT = "auto-update:status";

export type AutoUpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "staged"
  | "applying"
  | "failed"
  | "manual-required";

export interface BuildInfo {
  runtime?: string;
  mode?: string;
  packaged: boolean;
  platform?: string;
  arch?: string;
  bundlePath?: string;
  executablePath?: string;
  version?: string;
  build?: string;
  gitSha?: string;
  builtAt?: string;
  channel?: string;
  updateManifestUrl?: string;
  updatePublicKey?: string;
}

export interface AutoUpdateArtifact {
  platform?: string;
  arch?: string;
  url?: string;
  sha256?: string;
  signature?: string;
  size?: number;
  kind?: string;
}

export interface AutoUpdateManifest {
  channel?: string;
  version?: string;
  build?: string;
  artifacts?: readonly AutoUpdateArtifact[];
  releaseNotes?: string;
  mandatory?: boolean;
  url?: string;
  sha256?: string;
  signature?: string;
  notes?: string;
}

export interface AutoUpdateVerification {
  status?: string;
  reason?: string;
  channel?: string;
  version?: string;
  platform?: string;
  arch?: string;
  artifact?: AutoUpdateArtifact;
  downloadPath?: string;
  checksumVerified: boolean;
  signatureVerified: boolean;
  staged: boolean;
  installEnabled: boolean;
  mandatory: boolean;
}

export interface AutoUpdateStatus {
  version: number;
  state: AutoUpdateState;
  reason?: string;
  channel?: string;
  current: BuildInfo;
  manifestSource?: string;
  manifest?: AutoUpdateManifest;
  artifact?: AutoUpdateArtifact;
  verification: AutoUpdateVerification;
  downloadPath?: string;
  stagingDir?: string;
  stagedAppPath?: string;
  targetVersion?: string;
  targetBuild?: string;
  releaseNotes?: string;
  mandatory: boolean;
  progress: number;
  applyAvailable: boolean;
  manualUrl?: string;
  reportPath?: string;
  updatedAt: number;
  revision: number;
  loadedFromBackend: boolean;
}

export interface PrivateUpdateAuthStatus {
  provider?: string;
  repository?: string;
  manifestSource?: string;
  configured: boolean;
  source?: string;
  envOverride: boolean;
  keychainService?: string;
  keychainAccount?: string;
  reason?: string;
}

interface RuntimeEvent {
  data?: unknown;
}

interface AutoUpdateRuntimeModule {
  Call?: {
    ByName?: (methodName: string, ...args: unknown[]) => Promise<unknown>;
  };
  Events?: {
    On?: (
      eventName: string,
      callback: (event: RuntimeEvent) => void,
    ) => (() => void) | void;
  };
}

const methodNames = {
  getStatus: [
    "arlecchino/internal/app.App.GetAutoUpdateStatus",
    "main.App.GetAutoUpdateStatus",
    "arlecchino.App.GetAutoUpdateStatus",
  ],
  check: [
    "arlecchino/internal/app.App.CheckForAutoUpdate",
    "main.App.CheckForAutoUpdate",
    "arlecchino.App.CheckForAutoUpdate",
  ],
  download: [
    "arlecchino/internal/app.App.DownloadAutoUpdate",
    "main.App.DownloadAutoUpdate",
    "arlecchino.App.DownloadAutoUpdate",
  ],
  apply: [
    "arlecchino/internal/app.App.ApplyStagedAutoUpdate",
    "main.App.ApplyStagedAutoUpdate",
    "arlecchino.App.ApplyStagedAutoUpdate",
  ],
  cancel: [
    "arlecchino/internal/app.App.CancelAutoUpdate",
    "main.App.CancelAutoUpdate",
    "arlecchino.App.CancelAutoUpdate",
  ],
  buildInfo: [
    "arlecchino/internal/app.App.GetBuildInfo",
    "main.App.GetBuildInfo",
    "arlecchino.App.GetBuildInfo",
  ],
  privateAuthStatus: [
    "arlecchino/internal/app.App.GetPrivateUpdateAuthStatus",
    "main.App.GetPrivateUpdateAuthStatus",
    "arlecchino.App.GetPrivateUpdateAuthStatus",
  ],
  savePrivateToken: [
    "arlecchino/internal/app.App.SavePrivateUpdateToken",
    "main.App.SavePrivateUpdateToken",
    "arlecchino.App.SavePrivateUpdateToken",
  ],
  clearPrivateToken: [
    "arlecchino/internal/app.App.ClearPrivateUpdateToken",
    "main.App.ClearPrivateUpdateToken",
    "arlecchino.App.ClearPrivateUpdateToken",
  ],
} as const;

type MethodKey = keyof typeof methodNames;

const cachedMethodNames: Partial<Record<MethodKey, string>> = {};
const listeners = new Set<() => void>();
let runtimeEventSubscriptionStarted = false;
let startupAutoUpdateCheckStarted = false;

const fallbackBuildInfo = (): BuildInfo => ({
  packaged: false,
  mode: "dev",
  runtime: "wails-v3",
});

const fallbackVerification = (): AutoUpdateVerification => ({
  checksumVerified: false,
  signatureVerified: false,
  staged: false,
  installEnabled: false,
  mandatory: false,
});

const fallbackStatus = (): AutoUpdateStatus => ({
  version: 1,
  state: "idle",
  current: fallbackBuildInfo(),
  verification: fallbackVerification(),
  mandatory: false,
  progress: 0,
  applyAvailable: false,
  manualUrl: "https://github.com/KlawdiyRomiy/Arlecchino/releases",
  updatedAt: 0,
  revision: 0,
  loadedFromBackend: false,
});

const fallbackPrivateUpdateAuthStatus = (): PrivateUpdateAuthStatus => ({
  provider: "github-release",
  repository: "KlawdiyRomiy/Arlecchino",
  configured: false,
  envOverride: false,
  reason: "Private GitHub release access status is unavailable.",
});

let status = fallbackStatus();
let fingerprint = JSON.stringify(status);

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

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : false;

const states: readonly AutoUpdateState[] = [
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "staged",
  "applying",
  "failed",
  "manual-required",
];

const normalizeState = (value: unknown): AutoUpdateState =>
  typeof value === "string" && states.includes(value as AutoUpdateState)
    ? (value as AutoUpdateState)
    : "idle";

const normalizeBuildInfo = (value: unknown): BuildInfo => {
  if (!isRecord(value)) {
    return fallbackBuildInfo();
  }
  return {
    runtime: readString(getRecordValue(value, "runtime", "Runtime")),
    mode: readString(getRecordValue(value, "mode", "Mode")),
    packaged: readBoolean(getRecordValue(value, "packaged", "Packaged")),
    platform: readString(getRecordValue(value, "platform", "Platform")),
    arch: readString(getRecordValue(value, "arch", "Arch")),
    bundlePath: readString(getRecordValue(value, "bundlePath", "BundlePath")),
    executablePath: readString(
      getRecordValue(value, "executablePath", "Executable"),
    ),
    version: readString(getRecordValue(value, "version", "Version")),
    build: readString(getRecordValue(value, "build", "Build")),
    gitSha: readString(getRecordValue(value, "gitSha", "Commit")),
    builtAt: readString(getRecordValue(value, "builtAt", "BuiltAt")),
    channel: readString(getRecordValue(value, "channel", "Channel")),
    updateManifestUrl: readString(
      getRecordValue(value, "updateManifestUrl", "ManifestURL"),
    ),
    updatePublicKey: readString(
      getRecordValue(value, "updatePublicKey", "PublicKeyHint"),
    ),
  };
};

const normalizeArtifact = (value: unknown): AutoUpdateArtifact | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const artifact: AutoUpdateArtifact = {
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
): readonly AutoUpdateArtifact[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const artifacts = value.flatMap((item) => {
    const artifact = normalizeArtifact(item);
    return artifact ? [artifact] : [];
  });
  return artifacts.length > 0 ? artifacts : undefined;
};

const normalizeManifest = (value: unknown): AutoUpdateManifest | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const manifest: AutoUpdateManifest = {
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

const normalizeVerification = (value: unknown): AutoUpdateVerification => {
  if (!isRecord(value)) {
    return fallbackVerification();
  }
  return {
    status: readString(getRecordValue(value, "status", "Status")),
    reason: readString(getRecordValue(value, "reason", "Reason")),
    channel: readString(getRecordValue(value, "channel", "Channel")),
    version: readString(getRecordValue(value, "version", "Version")),
    platform: readString(getRecordValue(value, "platform", "Platform")),
    arch: readString(getRecordValue(value, "arch", "Arch")),
    artifact: normalizeArtifact(getRecordValue(value, "artifact", "Artifact")),
    downloadPath: readString(
      getRecordValue(value, "downloadPath", "DownloadPath"),
    ),
    checksumVerified: readBoolean(
      getRecordValue(value, "checksumVerified", "ChecksumVerified"),
    ),
    signatureVerified: readBoolean(
      getRecordValue(value, "signatureVerified", "SignatureVerified"),
    ),
    staged: readBoolean(getRecordValue(value, "staged", "Staged")),
    installEnabled: readBoolean(
      getRecordValue(value, "installEnabled", "InstallEnabled"),
    ),
    mandatory: readBoolean(getRecordValue(value, "mandatory", "Mandatory")),
  };
};

export const normalizePrivateUpdateAuthStatusPayload = (
  payload: unknown,
): PrivateUpdateAuthStatus => {
  if (!isRecord(payload)) {
    return fallbackPrivateUpdateAuthStatus();
  }
  return {
    provider: readString(getRecordValue(payload, "provider", "Provider")),
    repository: readString(getRecordValue(payload, "repository", "Repository")),
    manifestSource: readString(
      getRecordValue(payload, "manifestSource", "ManifestSource"),
    ),
    configured: readBoolean(
      getRecordValue(payload, "configured", "Configured"),
    ),
    source: readString(getRecordValue(payload, "source", "Source")),
    envOverride: readBoolean(
      getRecordValue(payload, "envOverride", "EnvOverride"),
    ),
    keychainService: readString(
      getRecordValue(payload, "keychainService", "KeychainService"),
    ),
    keychainAccount: readString(
      getRecordValue(payload, "keychainAccount", "KeychainAccount"),
    ),
    reason: readString(getRecordValue(payload, "reason", "Reason")),
  };
};

export const normalizeAutoUpdateStatusPayload = (
  payload: unknown,
): Omit<AutoUpdateStatus, "revision" | "loadedFromBackend"> => {
  if (!isRecord(payload)) {
    return fallbackStatus();
  }
  return {
    version: readNumber(getRecordValue(payload, "version", "Version")) ?? 1,
    state: normalizeState(getRecordValue(payload, "state", "State")),
    reason: readString(getRecordValue(payload, "reason", "Reason")),
    channel: readString(getRecordValue(payload, "channel", "Channel")),
    current: normalizeBuildInfo(getRecordValue(payload, "current", "Current")),
    manifestSource: readString(
      getRecordValue(payload, "manifestSource", "ManifestSource"),
    ),
    manifest: normalizeManifest(
      getRecordValue(payload, "manifest", "Manifest"),
    ),
    artifact: normalizeArtifact(
      getRecordValue(payload, "artifact", "Artifact"),
    ),
    verification: normalizeVerification(
      getRecordValue(payload, "verification", "Verification"),
    ),
    downloadPath: readString(
      getRecordValue(payload, "downloadPath", "DownloadPath"),
    ),
    stagingDir: readString(getRecordValue(payload, "stagingDir", "StagingDir")),
    stagedAppPath: readString(
      getRecordValue(payload, "stagedAppPath", "StagedAppPath"),
    ),
    targetVersion: readString(
      getRecordValue(payload, "targetVersion", "TargetVersion"),
    ),
    targetBuild: readString(
      getRecordValue(payload, "targetBuild", "TargetBuild"),
    ),
    releaseNotes: readString(
      getRecordValue(payload, "releaseNotes", "ReleaseNotes"),
    ),
    mandatory: readBoolean(getRecordValue(payload, "mandatory", "Mandatory")),
    progress: readNumber(getRecordValue(payload, "progress", "Progress")) ?? 0,
    applyAvailable: readBoolean(
      getRecordValue(payload, "applyAvailable", "ApplyAvailable"),
    ),
    manualUrl: readString(getRecordValue(payload, "manualUrl", "ManualURL")),
    reportPath: readString(getRecordValue(payload, "reportPath", "ReportPath")),
    updatedAt:
      readNumber(getRecordValue(payload, "updatedAt", "UpdatedAt")) ?? 0,
  };
};

export const syncAutoUpdateStatusFromPayload = (
  payload: unknown,
): AutoUpdateStatus => {
  const normalized = {
    ...normalizeAutoUpdateStatusPayload(payload),
    loadedFromBackend: true,
  };
  const nextFingerprint = JSON.stringify(normalized);
  if (nextFingerprint === fingerprint) {
    return status;
  }
  status = {
    ...normalized,
    revision: status.revision + 1,
  };
  fingerprint = nextFingerprint;
  listeners.forEach((listener) => listener());
  return status;
};

export const getAutoUpdateStatusSnapshot = (): AutoUpdateStatus => status;

export const subscribeAutoUpdateStatus = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const loadRuntimeModule = async (): Promise<
  AutoUpdateRuntimeModule | undefined
> => {
  try {
    return (await import("/wails/runtime.js")) as AutoUpdateRuntimeModule;
  } catch {
    return undefined;
  }
};

const callByKnownName = async (
  key: MethodKey,
  ...args: unknown[]
): Promise<unknown | undefined> => {
  const runtimeModule = await loadRuntimeModule();
  const call = runtimeModule?.Call;
  if (!call?.ByName) {
    return undefined;
  }
  const cachedName = cachedMethodNames[key];
  if (cachedName) {
    try {
      return await call.ByName(cachedName, ...args);
    } catch {
      delete cachedMethodNames[key];
    }
  }
  for (const methodName of methodNames[key]) {
    try {
      const payload = await call.ByName(methodName, ...args);
      cachedMethodNames[key] = methodName;
      return payload;
    } catch {
      // Try the next known Wails service namespace.
    }
  }
  return undefined;
};

export async function loadAutoUpdateStatusFromBackend(): Promise<AutoUpdateStatus> {
  const payload = await callByKnownName("getStatus");
  if (payload !== undefined) {
    return syncAutoUpdateStatusFromPayload(payload);
  }
  return getAutoUpdateStatusSnapshot();
}

export async function loadBuildInfoFromBackend(): Promise<BuildInfo> {
  const payload = await callByKnownName("buildInfo");
  return normalizeBuildInfo(payload);
}

export async function getPrivateUpdateAuthStatus(): Promise<PrivateUpdateAuthStatus> {
  const payload = await callByKnownName("privateAuthStatus");
  return normalizePrivateUpdateAuthStatusPayload(payload);
}

export async function savePrivateUpdateToken(
  token: string,
): Promise<PrivateUpdateAuthStatus> {
  const payload = await callByKnownName("savePrivateToken", token);
  return normalizePrivateUpdateAuthStatusPayload(payload);
}

export async function clearPrivateUpdateToken(): Promise<PrivateUpdateAuthStatus> {
  const payload = await callByKnownName("clearPrivateToken");
  return normalizePrivateUpdateAuthStatusPayload(payload);
}

export async function checkForAutoUpdate(): Promise<AutoUpdateStatus> {
  const payload = await callByKnownName("check");
  if (payload === undefined) {
    throw new Error("Auto-update backend bridge is unavailable.");
  }
  return syncAutoUpdateStatusFromPayload(payload);
}

const isPrivateGitHubReleaseManifest = (manifestURL?: string): boolean =>
  manifestURL?.trim().startsWith("github-release://") ?? false;

export const shouldRunAutoUpdateStartupCheck = (
  candidate: AutoUpdateStatus,
  alreadyStarted = startupAutoUpdateCheckStarted,
): boolean =>
  !alreadyStarted &&
  candidate.loadedFromBackend &&
  candidate.state === "idle" &&
  candidate.current.packaged &&
  Boolean(candidate.current.updateManifestUrl) &&
  !isPrivateGitHubReleaseManifest(candidate.current.updateManifestUrl);

export async function runAutoUpdateStartupCheckIfNeeded(
  candidate: AutoUpdateStatus,
  check: () => Promise<AutoUpdateStatus> = checkForAutoUpdate,
): Promise<boolean> {
  if (!shouldRunAutoUpdateStartupCheck(candidate)) {
    return false;
  }

  startupAutoUpdateCheckStarted = true;
  try {
    await check();
  } catch {
    // Startup checks are best-effort; manual checks still expose failures.
  }
  return true;
}

export function resetAutoUpdateStartupCheckForTests(): void {
  startupAutoUpdateCheckStarted = false;
}

export async function downloadAutoUpdate(): Promise<AutoUpdateStatus> {
  const payload = await callByKnownName("download");
  return payload !== undefined
    ? syncAutoUpdateStatusFromPayload(payload)
    : getAutoUpdateStatusSnapshot();
}

export async function applyStagedAutoUpdate(): Promise<AutoUpdateStatus> {
  const payload = await callByKnownName("apply");
  return payload !== undefined
    ? syncAutoUpdateStatusFromPayload(payload)
    : getAutoUpdateStatusSnapshot();
}

export async function cancelAutoUpdate(): Promise<AutoUpdateStatus> {
  const payload = await callByKnownName("cancel");
  return payload !== undefined
    ? syncAutoUpdateStatusFromPayload(payload)
    : getAutoUpdateStatusSnapshot();
}

const ensureRuntimeEventSubscription = (): void => {
  if (runtimeEventSubscriptionStarted || typeof window === "undefined") {
    return;
  }
  runtimeEventSubscriptionStarted = true;
  void (async () => {
    const runtimeModule = await loadRuntimeModule();
    runtimeModule?.Events?.On?.(AUTO_UPDATE_STATUS_EVENT, (event) => {
      syncAutoUpdateStatusFromPayload(event.data);
    });
  })();
};

export function useAutoUpdateStatus(): AutoUpdateStatus {
  return useSyncExternalStore(
    subscribeAutoUpdateStatus,
    getAutoUpdateStatusSnapshot,
    getAutoUpdateStatusSnapshot,
  );
}

export function useAutoUpdateBridge(): void {
  useEffect(() => {
    ensureRuntimeEventSubscription();
    void (async () => {
      const nextStatus = await loadAutoUpdateStatusFromBackend();
      void runAutoUpdateStartupCheckIfNeeded(nextStatus);
    })();
  }, []);
}
