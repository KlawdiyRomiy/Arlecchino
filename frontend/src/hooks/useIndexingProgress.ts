import { useSyncExternalStore } from "react";
import { EventsOn } from "../wails/runtime";
import { useAppNotificationStore } from "../stores/appNotificationStore";
import { usePerformanceStore } from "../stores/performanceStore";
import { getCurrentProjectSessionId } from "../shell/projectSessionRoute";

export type IndexingPhase = "idle" | "indexing" | "complete" | "revealed";

interface IndexingState {
  phase: IndexingPhase;
  current: number;
  total: number;
  percentage: number;
}

interface IndexerEventPayload {
  current?: number;
  total?: number;
  queueDepth?: number;
  projectFileCount?: number;
  sessionId?: string;
  terminal?: boolean;
  error?: string;
}

const FAILSAFE_MS = 2000;
const PROGRESS_EMIT_MIN_MS = 250;
const PROGRESS_EMIT_MAX_MS = 1500;
const PROGRESS_EMIT_MIN_PERCENT_STEP = 0.5;
const PROGRESS_SMALL_BATCH = 64;

// --- Module-level state (subscribes before React renders) ---

let state: IndexingState = {
  phase: "idle",
  current: 0,
  total: 0,
  percentage: 0,
};
const matchesCurrentProjectSession = (data?: IndexerEventPayload) => {
  const sessionId =
    typeof data?.sessionId === "string" && data.sessionId.length > 0
      ? data.sessionId
      : "main";
  return sessionId === getCurrentProjectSessionId();
};

const listeners = new Set<() => void>();
let deferredMotionNotification = false;
let pendingProgress: {
  state: IndexingState;
  data: IndexerEventPayload;
} | null = null;
let progressFlushTimer: ReturnType<typeof setTimeout> | null = null;
let lastProgressEmitAt = 0;
let lastProgressEmitPercentage = 0;

const toPercentage = (current: number, total: number) => {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (current / total) * 100));
};

function emit(next: IndexingState | ((prev: IndexingState) => IndexingState)) {
  const resolved = typeof next === "function" ? next(state) : next;
  if (
    resolved.phase === state.phase &&
    resolved.current === state.current &&
    resolved.total === state.total &&
    resolved.percentage === state.percentage
  ) {
    return;
  }
  state = resolved;
  notifyListeners();
}

function notifyListeners() {
  if (usePerformanceStore.getState().panelMotionActive) {
    deferredMotionNotification = true;
    return;
  }

  deferredMotionNotification = false;
  listeners.forEach((fn) => fn());
}

usePerformanceStore.subscribe((current, previous) => {
  if (
    previous.panelMotionActive &&
    !current.panelMotionActive &&
    deferredMotionNotification
  ) {
    notifyListeners();
  }
});

function getSnapshot(): IndexingState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getIndexingProgressSnapshot = getSnapshot;
export const subscribeIndexingProgress = subscribe;

const recordIndexerBudget = (data?: IndexerEventPayload) => {
  if (!data) {
    usePerformanceStore.getState().updateBudget({ indexerQueueDepth: 0 });
    return;
  }

  const patch: {
    indexerQueueDepth?: number;
    projectFileCount?: number;
  } = {};

  if (typeof data.queueDepth === "number") {
    patch.indexerQueueDepth = Math.max(0, data.queueDepth);
  }
  if (typeof data.projectFileCount === "number") {
    patch.projectFileCount = Math.max(0, data.projectFileCount);
  }
  if (Object.keys(patch).length > 0) {
    usePerformanceStore.getState().updateBudget(patch);
  }
};

// --- Timers ---

let failsafeTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) clearTimeout(timer);
}

function scheduleFailsafe() {
  clearTimer(failsafeTimer);
  failsafeTimer = setTimeout(() => {
    emit((prev) =>
      prev.phase === "idle" ? { ...prev, phase: "revealed" } : prev,
    );
  }, FAILSAFE_MS);
}

function clearProgressFlushTimer() {
  clearTimer(progressFlushTimer);
  progressFlushTimer = null;
  pendingProgress = null;
}

function resetProgressCoalescing() {
  clearProgressFlushTimer();
  lastProgressEmitAt = 0;
  lastProgressEmitPercentage = 0;
}

function clearAllTimers() {
  clearTimer(failsafeTimer);
  failsafeTimer = null;
  resetProgressCoalescing();
}

function transitionToComplete() {
  emit((prev) => ({
    phase: "revealed",
    current: prev.total || prev.current,
    total: prev.total,
    percentage: 100,
  }));
}

const notifyIndexingError = (data?: IndexerEventPayload) => {
  const message =
    typeof data?.error === "string" && data.error.trim().length > 0
      ? data.error.trim()
      : "Project indexing reported an error.";

  useAppNotificationStore.getState().addNotification({
    id: "indexer-error",
    kind: "error",
    title: "Indexing failed",
    message,
    source: "Indexer",
  });
};

function applyProgressState(next: IndexingState, data: IndexerEventPayload) {
  recordIndexerBudget(data);
  lastProgressEmitAt = Date.now();
  lastProgressEmitPercentage = next.percentage;
  emit(next);
}

function progressFlushDelay(next: IndexingState, now: number) {
  if (
    next.total <= PROGRESS_SMALL_BATCH ||
    next.percentage >= 100 ||
    lastProgressEmitAt === 0
  ) {
    return 0;
  }

  const elapsed = now - lastProgressEmitAt;
  if (elapsed >= PROGRESS_EMIT_MAX_MS) {
    return 0;
  }

  const percentDelta = Math.abs(next.percentage - lastProgressEmitPercentage);
  if (
    elapsed >= PROGRESS_EMIT_MIN_MS &&
    percentDelta >= PROGRESS_EMIT_MIN_PERCENT_STEP
  ) {
    return 0;
  }

  const targetDelay =
    percentDelta >= PROGRESS_EMIT_MIN_PERCENT_STEP
      ? PROGRESS_EMIT_MIN_MS
      : PROGRESS_EMIT_MAX_MS;
  return Math.max(0, targetDelay - elapsed);
}

function flushPendingProgress() {
  progressFlushTimer = null;
  const pending = pendingProgress;
  pendingProgress = null;
  if (!pending || !matchesCurrentProjectSession(pending.data)) {
    return;
  }
  applyProgressState(pending.state, pending.data);
}

function commitProgressState(next: IndexingState, data: IndexerEventPayload) {
  const delay = progressFlushDelay(next, Date.now());
  if (delay <= 0) {
    clearProgressFlushTimer();
    applyProgressState(next, data);
    return;
  }

  pendingProgress = { state: next, data };
  clearTimer(progressFlushTimer);
  progressFlushTimer = setTimeout(flushPendingProgress, delay);
}

// --- Event handlers (module-level, no stale closures) ---

EventsOn("indexer:started", (data: IndexerEventPayload) => {
  if (!matchesCurrentProjectSession(data)) {
    return;
  }
  clearAllTimers();
  recordIndexerBudget(data);

  const total = data.total ?? 0;
  lastProgressEmitAt = Date.now();
  lastProgressEmitPercentage = 0;

  emit({ phase: "indexing", current: 0, total, percentage: 0 });
});

EventsOn("indexer:progress", (data: IndexerEventPayload) => {
  if (!matchesCurrentProjectSession(data)) {
    return;
  }
  recordIndexerBudget(data);
  const current = data.current ?? 0;
  const total = data.total ?? 0;
  const boundedCurrent = total > 0 ? Math.min(Math.max(0, current), total) : 0;
  commitProgressState(
    {
      phase: "indexing",
      current: boundedCurrent,
      total,
      percentage: toPercentage(boundedCurrent, total),
    },
    data,
  );
});

EventsOn("indexer:error", (data?: IndexerEventPayload) => {
  if (!matchesCurrentProjectSession(data)) {
    return;
  }
  if (data?.terminal !== true) {
    recordIndexerBudget(data);
    return;
  }

  notifyIndexingError(data);
  recordIndexerBudget({ ...(data ?? {}), queueDepth: 0 });
  clearAllTimers();
  emit({ phase: "revealed", current: 0, total: 0, percentage: 0 });
});

EventsOn("indexer:completed", (data?: IndexerEventPayload) => {
  if (!matchesCurrentProjectSession(data)) {
    return;
  }
  recordIndexerBudget({ ...(data ?? {}), queueDepth: 0 });
  clearTimer(failsafeTimer);
  failsafeTimer = null;
  resetProgressCoalescing();

  transitionToComplete();
});

// Failsafe: if no indexing starts within 2s, reveal content
scheduleFailsafe();

// --- React hook ---

export function resetIndexingProgressState() {
  clearAllTimers();
  recordIndexerBudget();
  emit({ phase: "idle", current: 0, total: 0, percentage: 0 });
  scheduleFailsafe();
}

export function useIndexingProgress(): IndexingState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useIndexingPhase(): IndexingPhase {
  return useSyncExternalStore(subscribe, () => getSnapshot().phase);
}
