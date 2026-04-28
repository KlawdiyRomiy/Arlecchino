import { useSyncExternalStore } from "react";
import { EventsOn } from "../wails/runtime";

export type IndexingPhase = "idle" | "indexing" | "complete" | "revealed";

interface IndexingState {
  phase: IndexingPhase;
  current: number;
  total: number;
  percentage: number;
}

const MIN_INDEXING_MS = 800;
const COMPLETE_DISPLAY_MS = 1000;
const FAILSAFE_MS = 2000;

// --- Module-level state (subscribes before React renders) ---

let state: IndexingState = {
  phase: "idle",
  current: 0,
  total: 0,
  percentage: 0,
};

const listeners = new Set<() => void>();

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

// --- Timers ---

let revealTimer: ReturnType<typeof setTimeout> | null = null;
let failsafeTimer: ReturnType<typeof setTimeout> | null = null;
let minTimer: ReturnType<typeof setTimeout> | null = null;
let indexingStartedAt = 0;

function clearTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) clearTimeout(timer);
}

function clearAllTimers() {
  clearTimer(revealTimer);
  clearTimer(failsafeTimer);
  clearTimer(minTimer);
  revealTimer = null;
  failsafeTimer = null;
  minTimer = null;
}

function transitionToComplete() {
  clearTimer(minTimer);
  minTimer = null;

  emit((prev) => ({
    phase: "complete",
    current: prev.total || prev.current,
    total: prev.total,
    percentage: 100,
  }));

  clearTimer(revealTimer);
  revealTimer = setTimeout(() => {
    emit((prev) => ({ ...prev, phase: "revealed" }));
    revealTimer = null;
  }, COMPLETE_DISPLAY_MS);
}

// --- Event handlers (module-level, no stale closures) ---

EventsOn("indexer:started", (data: { total: number }) => {
  clearAllTimers();
  indexingStartedAt = Date.now();

  if (data.total === 0) {
    emit({ phase: "indexing", current: 0, total: 0, percentage: 100 });
    minTimer = setTimeout(transitionToComplete, MIN_INDEXING_MS);
    return;
  }

  emit({ phase: "indexing", current: 0, total: data.total, percentage: 0 });
});

EventsOn("indexer:progress", (data: { current: number; total: number }) => {
  const pct =
    data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
  emit({
    phase: "indexing",
    current: data.current,
    total: data.total,
    percentage: pct,
  });
});

EventsOn("indexer:completed", () => {
  clearTimer(failsafeTimer);
  failsafeTimer = null;
  clearTimer(minTimer);
  minTimer = null;

  const elapsed =
    indexingStartedAt === 0 ? MIN_INDEXING_MS : Date.now() - indexingStartedAt;
  const remaining = Math.max(0, MIN_INDEXING_MS - elapsed);

  emit((prev) => ({
    ...prev,
    current: prev.total || prev.current,
    percentage: 100,
  }));

  if (remaining > 0) {
    minTimer = setTimeout(transitionToComplete, remaining);
    return;
  }

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
