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

const toPercentage = (current: number, total: number) => {
  if (total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (current / total) * 100));
};

function emit(next: IndexingState | ((prev: IndexingState) => IndexingState)) {
  state = typeof next === "function" ? next(state) : next;
  listeners.forEach((fn) => fn());
}

function getSnapshot(): IndexingState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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

function clearAllTimers() {
  clearTimer(failsafeTimer);
  failsafeTimer = null;
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

// --- Event handlers (module-level, no stale closures) ---

EventsOn("indexer:started", (data: IndexerEventPayload) => {
  if (!matchesCurrentProjectSession(data)) {
    return;
  }
  clearAllTimers();
  recordIndexerBudget(data);

  const total = data.total ?? 0;

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
  emit({
    phase: "indexing",
    current: boundedCurrent,
    total,
    percentage: toPercentage(boundedCurrent, total),
  });
});

EventsOn("indexer:error", (data?: IndexerEventPayload) => {
  if (!matchesCurrentProjectSession(data)) {
    return;
  }
  notifyIndexingError(data);
  if (data?.terminal !== true) {
    recordIndexerBudget(data);
    return;
  }

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

  transitionToComplete();
});

// Failsafe: if no indexing starts within 2s, reveal content
failsafeTimer = setTimeout(() => {
  emit((prev) =>
    prev.phase === "idle" ? { ...prev, phase: "revealed" } : prev,
  );
}, FAILSAFE_MS);

// --- React hook ---

export function useIndexingProgress(): IndexingState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useIndexingPhase(): IndexingPhase {
  return useSyncExternalStore(subscribe, () => getSnapshot().phase);
}
