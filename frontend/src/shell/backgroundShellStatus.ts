import { useEffect, useSyncExternalStore } from "react";

export const BACKGROUND_SHELL_STATUS_EVENT = "shell:background:status";

export type BackgroundShellJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type BackgroundShellJobCategory = "job" | "service";

export type BackgroundShellSeverity = "info" | "success" | "warning" | "error";

export interface BackgroundShellProgress {
  percent: number;
  current?: number;
  total?: number;
}

export interface BackgroundShellAction {
  id: string;
  label: string;
  intent: string;
  jobId?: string;
  ownerSurfaceId?: string;
  enabled: boolean;
}

export interface BackgroundShellJob {
  id: string;
  kind: string;
  category: BackgroundShellJobCategory;
  title: string;
  detail?: string;
  projectPath?: string;
  sessionId?: string;
  generation?: number;
  reason?: string;
  processId?: number;
  command?: string;
  queueDepth?: number;
  workerCount?: number;
  ownerSurfaceId?: string;
  status: BackgroundShellJobStatus;
  severity: BackgroundShellSeverity;
  progress?: BackgroundShellProgress;
  cancelable: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
}

export interface BackgroundShellEvent {
  id: string;
  type: string;
  jobId: string;
  kind: string;
  severity: BackgroundShellSeverity;
  message: string;
  at: number;
}

export interface BackgroundShellNotificationCandidate {
  id: string;
  jobId: string;
  severity: BackgroundShellSeverity;
  title: string;
  body: string;
  dedupeKey: string;
  createdAt: number;
  action?: BackgroundShellAction;
}

export interface BackgroundShellStatusSnapshot {
  version: number;
  revision: number;
  source: "fallback" | "backend";
  loadedFromBackend: boolean;
  updatedAt: number;
  activeCount: number;
  serviceCount: number;
  attentionCount: number;
  jobs: BackgroundShellJob[];
  events: BackgroundShellEvent[];
  notificationCandidates: BackgroundShellNotificationCandidate[];
  actions: BackgroundShellAction[];
  nativeTrayEnabled: boolean;
  nativeNotificationsSent: boolean;
}

export interface BackgroundShellActionResult {
  handled: boolean;
  action?: BackgroundShellAction;
  snapshot: BackgroundShellStatusSnapshot;
  message?: string;
}

interface RuntimeEvent {
  data?: unknown;
}

interface BackgroundShellStatusBridge {
  GetBackgroundShellStatus?: () => Promise<unknown> | unknown;
  RunBackgroundShellAction?: (actionId: string) => Promise<unknown> | unknown;
}

interface BackgroundShellStatusRuntimeModule {
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

const FALLBACK_SNAPSHOT: BackgroundShellStatusSnapshot = {
  version: 1,
  revision: 0,
  source: "fallback",
  loadedFromBackend: false,
  updatedAt: 0,
  activeCount: 0,
  serviceCount: 0,
  attentionCount: 0,
  jobs: [],
  events: [],
  notificationCandidates: [],
  actions: [],
  nativeTrayEnabled: false,
  nativeNotificationsSent: false,
};

const listeners = new Set<() => void>();

let snapshot: BackgroundShellStatusSnapshot = FALLBACK_SNAPSHOT;
let snapshotFingerprint = "";

const JOB_STATUSES: readonly BackgroundShellJobStatus[] = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
];

const JOB_CATEGORIES: readonly BackgroundShellJobCategory[] = [
  "job",
  "service",
];

const SEVERITIES: readonly BackgroundShellSeverity[] = [
  "info",
  "success",
  "warning",
  "error",
];

const backgroundShellStatusMethodNames = [
  "arlecchino/internal/app.App.GetBackgroundShellStatus",
  "main.App.GetBackgroundShellStatus",
  "arlecchino.App.GetBackgroundShellStatus",
] as const;

const backgroundShellActionMethodNames = [
  "arlecchino/internal/app.App.RunBackgroundShellAction",
  "main.App.RunBackgroundShellAction",
  "arlecchino.App.RunBackgroundShellAction",
] as const;

let backgroundShellStatusMethodName:
  | (typeof backgroundShellStatusMethodNames)[number]
  | undefined;
let backgroundShellActionMethodName:
  | (typeof backgroundShellActionMethodNames)[number]
  | undefined;
let runtimeEventSubscriptionStarted = false;

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

const asTrimmedString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const isJobStatus = (value: unknown): value is BackgroundShellJobStatus =>
  typeof value === "string" &&
  (JOB_STATUSES as readonly string[]).includes(value);

const isJobCategory = (value: unknown): value is BackgroundShellJobCategory =>
  typeof value === "string" &&
  (JOB_CATEGORIES as readonly string[]).includes(value);

const isSeverity = (value: unknown): value is BackgroundShellSeverity =>
  typeof value === "string" &&
  (SEVERITIES as readonly string[]).includes(value);

const severityForStatus = (
  status: BackgroundShellJobStatus,
): BackgroundShellSeverity => {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
      return "error";
    case "canceled":
      return "warning";
    default:
      return "info";
  }
};

const normalizeProgress = (
  value: unknown,
): BackgroundShellProgress | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const percent = asFiniteNumber(getRecordValue(value, "percent", "Percent"));
  const current = asFiniteNumber(getRecordValue(value, "current", "Current"));
  const total = asFiniteNumber(getRecordValue(value, "total", "Total"));
  if (percent === undefined && current === undefined && total === undefined) {
    return undefined;
  }
  return {
    percent: Math.min(100, Math.max(0, percent ?? 0)),
    current,
    total,
  };
};

const normalizeAction = (value: unknown): BackgroundShellAction | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = asTrimmedString(getRecordValue(value, "id", "ID"));
  const label = asTrimmedString(getRecordValue(value, "label", "Label"));
  const intent = asTrimmedString(getRecordValue(value, "intent", "Intent"));
  if (!id || !label || !intent) {
    return undefined;
  }
  return {
    id,
    label,
    intent,
    jobId: asTrimmedString(getRecordValue(value, "jobId", "JobID")),
    ownerSurfaceId: asTrimmedString(
      getRecordValue(value, "ownerSurfaceId", "OwnerSurfaceID"),
    ),
    enabled: asBoolean(getRecordValue(value, "enabled", "Enabled")) ?? false,
  };
};

const normalizeJob = (value: unknown): BackgroundShellJob | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = asTrimmedString(getRecordValue(value, "id", "ID"));
  const status = getRecordValue(value, "status", "Status");
  if (!id || !isJobStatus(status)) {
    return undefined;
  }

  const category = getRecordValue(value, "category", "Category");
  const severity = getRecordValue(value, "severity", "Severity");
  return {
    id,
    kind: asTrimmedString(getRecordValue(value, "kind", "Kind")) ?? "unknown",
    category: isJobCategory(category) ? category : "job",
    title: asTrimmedString(getRecordValue(value, "title", "Title")) ?? id,
    detail: asTrimmedString(getRecordValue(value, "detail", "Detail")),
    projectPath: asTrimmedString(
      getRecordValue(value, "projectPath", "ProjectPath"),
    ),
    sessionId: asTrimmedString(getRecordValue(value, "sessionId", "SessionID")),
    generation: asFiniteNumber(
      getRecordValue(value, "generation", "Generation"),
    ),
    reason: asTrimmedString(getRecordValue(value, "reason", "Reason")),
    processId: asFiniteNumber(getRecordValue(value, "processId", "ProcessID")),
    command: asTrimmedString(getRecordValue(value, "command", "Command")),
    queueDepth: asFiniteNumber(
      getRecordValue(value, "queueDepth", "QueueDepth"),
    ),
    workerCount: asFiniteNumber(
      getRecordValue(value, "workerCount", "WorkerCount"),
    ),
    ownerSurfaceId: asTrimmedString(
      getRecordValue(value, "ownerSurfaceId", "OwnerSurfaceID"),
    ),
    status,
    severity: isSeverity(severity) ? severity : severityForStatus(status),
    progress: normalizeProgress(getRecordValue(value, "progress", "Progress")),
    cancelable:
      asBoolean(getRecordValue(value, "cancelable", "Cancelable")) ?? false,
    startedAt:
      asFiniteNumber(getRecordValue(value, "startedAt", "StartedAt")) ?? 0,
    updatedAt:
      asFiniteNumber(getRecordValue(value, "updatedAt", "UpdatedAt")) ?? 0,
    completedAt: asFiniteNumber(
      getRecordValue(value, "completedAt", "CompletedAt"),
    ),
    notifyOnSuccess: asBoolean(
      getRecordValue(value, "notifyOnSuccess", "NotifyOnSuccess"),
    ),
    notifyOnFailure: asBoolean(
      getRecordValue(value, "notifyOnFailure", "NotifyOnFailure"),
    ),
  };
};

const normalizeEvent = (value: unknown): BackgroundShellEvent | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = asTrimmedString(getRecordValue(value, "id", "ID"));
  const type = asTrimmedString(getRecordValue(value, "type", "Type"));
  const jobId = asTrimmedString(getRecordValue(value, "jobId", "JobID"));
  if (!id || !type || !jobId) {
    return undefined;
  }
  const severity = getRecordValue(value, "severity", "Severity");
  return {
    id,
    type,
    jobId,
    kind: asTrimmedString(getRecordValue(value, "kind", "Kind")) ?? "unknown",
    severity: isSeverity(severity) ? severity : "info",
    message:
      asTrimmedString(getRecordValue(value, "message", "Message")) ?? type,
    at: asFiniteNumber(getRecordValue(value, "at", "At")) ?? 0,
  };
};

const normalizeNotificationCandidate = (
  value: unknown,
): BackgroundShellNotificationCandidate | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = asTrimmedString(getRecordValue(value, "id", "ID"));
  const jobId = asTrimmedString(getRecordValue(value, "jobId", "JobID"));
  const title = asTrimmedString(getRecordValue(value, "title", "Title"));
  const dedupeKey = asTrimmedString(
    getRecordValue(value, "dedupeKey", "DedupeKey"),
  );
  if (!id || !jobId || !title || !dedupeKey) {
    return undefined;
  }
  const severity = getRecordValue(value, "severity", "Severity");
  return {
    id,
    jobId,
    severity: isSeverity(severity) ? severity : "info",
    title,
    body: asTrimmedString(getRecordValue(value, "body", "Body")) ?? title,
    dedupeKey,
    createdAt:
      asFiniteNumber(getRecordValue(value, "createdAt", "CreatedAt")) ?? 0,
    action: normalizeAction(getRecordValue(value, "action", "Action")),
  };
};

const normalizeList = <T>(
  value: unknown,
  normalize: (item: unknown) => T | undefined,
): T[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const normalized = normalize(item);
    return normalized ? [normalized] : [];
  });
};

export const normalizeBackgroundShellStatusPayload = (
  payload: unknown,
): BackgroundShellStatusSnapshot => {
  if (!isRecord(payload)) {
    return {
      ...FALLBACK_SNAPSHOT,
      jobs: [],
      events: [],
      notificationCandidates: [],
      actions: [],
    };
  }

  const jobs = normalizeList(
    getRecordValue(payload, "jobs", "Jobs"),
    normalizeJob,
  );
  const events = normalizeList(
    getRecordValue(payload, "events", "Events"),
    normalizeEvent,
  );
  const notificationCandidates = normalizeList(
    getRecordValue(payload, "notificationCandidates", "NotificationCandidates"),
    normalizeNotificationCandidate,
  );
  const actions = normalizeList(
    getRecordValue(payload, "actions", "Actions"),
    normalizeAction,
  );

  return {
    version:
      asFiniteNumber(getRecordValue(payload, "version", "Version")) ??
      FALLBACK_SNAPSHOT.version,
    revision:
      asFiniteNumber(getRecordValue(payload, "revision", "Revision")) ??
      snapshot.revision + 1,
    source: "backend",
    loadedFromBackend: true,
    updatedAt:
      asFiniteNumber(getRecordValue(payload, "updatedAt", "UpdatedAt")) ?? 0,
    activeCount:
      asFiniteNumber(getRecordValue(payload, "activeCount", "ActiveCount")) ??
      jobs.filter(
        (job) => job.category === "job" && isActiveJobStatus(job.status),
      ).length,
    serviceCount:
      asFiniteNumber(getRecordValue(payload, "serviceCount", "ServiceCount")) ??
      jobs.filter(
        (job) => job.category === "service" && isActiveJobStatus(job.status),
      ).length,
    attentionCount:
      asFiniteNumber(
        getRecordValue(payload, "attentionCount", "AttentionCount"),
      ) ?? jobs.filter((job) => job.status === "failed").length,
    jobs,
    events,
    notificationCandidates,
    actions,
    nativeTrayEnabled: false,
    nativeNotificationsSent: false,
  };
};

export const normalizeBackgroundShellActionResultPayload = (
  payload: unknown,
): BackgroundShellActionResult => {
  if (!isRecord(payload)) {
    return {
      handled: false,
      snapshot: getBackgroundShellStatusSnapshot(),
    };
  }

  const rawSnapshot = getRecordValue(payload, "snapshot", "Snapshot");
  const nextSnapshot = isRecord(rawSnapshot)
    ? syncBackgroundShellStatusFromPayload(rawSnapshot)
    : getBackgroundShellStatusSnapshot();

  return {
    handled: asBoolean(getRecordValue(payload, "handled", "Handled")) ?? false,
    action: normalizeAction(getRecordValue(payload, "action", "Action")),
    snapshot: nextSnapshot,
    message: asTrimmedString(getRecordValue(payload, "message", "Message")),
  };
};

const isActiveJobStatus = (status: BackgroundShellJobStatus): boolean =>
  status === "queued" || status === "running";

const cloneSnapshot = (
  value: BackgroundShellStatusSnapshot,
): BackgroundShellStatusSnapshot => ({
  ...value,
  jobs: value.jobs.map((job) => ({
    ...job,
    progress: job.progress ? { ...job.progress } : undefined,
  })),
  events: value.events.map((event) => ({ ...event })),
  notificationCandidates: value.notificationCandidates.map((candidate) => ({
    ...candidate,
    action: candidate.action ? { ...candidate.action } : undefined,
  })),
  actions: value.actions.map((action) => ({ ...action })),
});

const buildFingerprint = (value: BackgroundShellStatusSnapshot): string =>
  JSON.stringify({
    version: value.version,
    revision: value.revision,
    source: value.source,
    updatedAt: value.updatedAt,
    activeCount: value.activeCount,
    serviceCount: value.serviceCount,
    attentionCount: value.attentionCount,
    jobs: value.jobs,
    events: value.events,
    notificationCandidates: value.notificationCandidates,
    actions: value.actions,
    nativeTrayEnabled: value.nativeTrayEnabled,
    nativeNotificationsSent: value.nativeNotificationsSent,
  });

export const getFallbackBackgroundShellStatus =
  (): BackgroundShellStatusSnapshot => cloneSnapshot(FALLBACK_SNAPSHOT);

export const getBackgroundShellStatusSnapshot =
  (): BackgroundShellStatusSnapshot => snapshot;

export const subscribeBackgroundShellStatus = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const syncBackgroundShellStatusFromPayload = (
  payload: unknown,
): BackgroundShellStatusSnapshot => {
  const normalized = normalizeBackgroundShellStatusPayload(payload);
  const fingerprint = buildFingerprint(normalized);
  if (fingerprint === snapshotFingerprint) {
    return snapshot;
  }

  snapshotFingerprint = fingerprint;
  snapshot = cloneSnapshot(normalized);
  listeners.forEach((listener) => listener());
  return snapshot;
};

const loadBackgroundShellStatusPayloadFromBridge = async (
  bridge: BackgroundShellStatusBridge,
): Promise<unknown | undefined> => {
  if (typeof bridge.GetBackgroundShellStatus !== "function") {
    return undefined;
  }

  try {
    return await Promise.resolve(bridge.GetBackgroundShellStatus());
  } catch {
    return undefined;
  }
};

const loadBackgroundShellRuntimeModule = async (): Promise<
  BackgroundShellStatusRuntimeModule | undefined
> => {
  try {
    return (await import("/wails/runtime.js")) as BackgroundShellStatusRuntimeModule;
  } catch {
    return undefined;
  }
};

const loadBackgroundShellStatusPayloadByName = async (): Promise<
  unknown | undefined
> => {
  const runtimeModule = await loadBackgroundShellRuntimeModule();
  const call = runtimeModule?.Call;
  if (!call?.ByName) {
    return undefined;
  }

  if (backgroundShellStatusMethodName) {
    try {
      return await call.ByName(backgroundShellStatusMethodName);
    } catch {
      backgroundShellStatusMethodName = undefined;
    }
  }

  for (const methodName of backgroundShellStatusMethodNames) {
    try {
      const payload = await call.ByName(methodName);
      backgroundShellStatusMethodName = methodName;
      return payload;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return undefined;
};

export async function loadBackgroundShellStatusFromBackend(
  bridge?: BackgroundShellStatusBridge | null,
): Promise<BackgroundShellStatusSnapshot> {
  if (bridge) {
    const payload = await loadBackgroundShellStatusPayloadFromBridge(bridge);
    if (payload !== undefined) {
      return syncBackgroundShellStatusFromPayload(payload);
    }
  }

  if (bridge !== null) {
    const payload = await loadBackgroundShellStatusPayloadByName();
    if (payload !== undefined) {
      return syncBackgroundShellStatusFromPayload(payload);
    }
  }

  return getBackgroundShellStatusSnapshot();
}

const runBackgroundShellActionByName = async (
  actionId: string,
): Promise<unknown | undefined> => {
  const runtimeModule = await loadBackgroundShellRuntimeModule();
  const call = runtimeModule?.Call;
  if (!call?.ByName) {
    return undefined;
  }

  if (backgroundShellActionMethodName) {
    try {
      return await call.ByName(backgroundShellActionMethodName, actionId);
    } catch {
      backgroundShellActionMethodName = undefined;
    }
  }

  for (const methodName of backgroundShellActionMethodNames) {
    try {
      const payload = await call.ByName(methodName, actionId);
      backgroundShellActionMethodName = methodName;
      return payload;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return undefined;
};

export async function runBackgroundShellAction(
  actionId: string,
  bridge?: BackgroundShellStatusBridge | null,
): Promise<BackgroundShellActionResult> {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) {
    return {
      handled: false,
      snapshot: getBackgroundShellStatusSnapshot(),
      message: "Background shell action id is empty.",
    };
  }

  if (bridge?.RunBackgroundShellAction) {
    const payload = await Promise.resolve(
      bridge.RunBackgroundShellAction(normalizedActionId),
    );
    return normalizeBackgroundShellActionResultPayload(payload);
  }

  if (bridge !== null) {
    const payload = await runBackgroundShellActionByName(normalizedActionId);
    if (payload !== undefined) {
      return normalizeBackgroundShellActionResultPayload(payload);
    }
  }

  return {
    handled: false,
    snapshot: getBackgroundShellStatusSnapshot(),
    message: "Background shell action bridge is unavailable.",
  };
}

const ensureRuntimeEventSubscription = (): void => {
  if (runtimeEventSubscriptionStarted || typeof window === "undefined") {
    return;
  }

  runtimeEventSubscriptionStarted = true;
  void (async () => {
    const runtimeModule = await loadBackgroundShellRuntimeModule();
    runtimeModule?.Events?.On?.(BACKGROUND_SHELL_STATUS_EVENT, (event) => {
      syncBackgroundShellStatusFromPayload(event.data);
    });
  })();
};

export function useBackgroundShellStatus(): BackgroundShellStatusSnapshot {
  return useSyncExternalStore(
    subscribeBackgroundShellStatus,
    getBackgroundShellStatusSnapshot,
    getBackgroundShellStatusSnapshot,
  );
}

export function useBackgroundShellStatusBridge(
  getBackgroundShellStatus?: BackgroundShellStatusBridge["GetBackgroundShellStatus"],
): void {
  useEffect(() => {
    ensureRuntimeEventSubscription();
    void loadBackgroundShellStatusFromBackend(
      getBackgroundShellStatus
        ? { GetBackgroundShellStatus: getBackgroundShellStatus }
        : undefined,
    );
  }, [getBackgroundShellStatus]);
}
