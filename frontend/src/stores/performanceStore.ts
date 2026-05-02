import { create } from "zustand";
import {
  PERF_EVENT_NAME,
  type PerfMetric,
  type PerfScope,
  nowPerf,
} from "../utils/perf";

export type AdaptivePerformanceMode = "normal" | "constrained" | "critical";

export interface PerformanceBudgetSnapshot {
  mode: AdaptivePerformanceMode;
  frameGapMs: number;
  eventPressure: number;
  activeEditorCharCount: number;
  activeEditorLineCount: number;
  activeEditorLargeDocument: boolean;
  indexerQueueDepth: number;
  projectFileCount: number;
  updatedAtMs: number;
}

export interface AdaptiveEditorFeatureBudget {
  mode: AdaptivePerformanceMode;
  layoutStableLineWrapping: boolean;
  layoutStableFoldGutter: boolean;
  layoutStableGitGutter: boolean;
  layoutStableMinimap: boolean;
  runtimeRichEditorFeatures: boolean;
  runtimeCompletions: boolean;
  runtimeDiagnostics: boolean;
  runtimeGitGutter: boolean;
  runtimeGhostText: boolean;
  runtimeHover: boolean;
  runtimeMinimap: boolean;
  richEditorFeatures: boolean;
  completions: boolean;
  diagnostics: boolean;
  gitGutter: boolean;
  ghostText: boolean;
  hover: boolean;
  languageExtensions: boolean;
  lineWrapping: boolean;
  minimap: boolean;
  notifyChangeDelayMs: number;
}

interface PerformanceState {
  mode: AdaptivePerformanceMode;
  snapshot: PerformanceBudgetSnapshot;
  updateBudget: (patch: Partial<PerformanceBudgetSnapshot>) => void;
  recordEventPressure: (scope: PerfScope, units?: number) => void;
  recordMetric: (metric: PerfMetric) => void;
  decayPressure: () => void;
  resetTransientBudget: () => void;
  resetActiveEditorBudget: () => void;
}

const defaultSnapshot = (): PerformanceBudgetSnapshot => ({
  mode: "normal",
  frameGapMs: 0,
  eventPressure: 0,
  activeEditorCharCount: 0,
  activeEditorLineCount: 0,
  activeEditorLargeDocument: false,
  indexerQueueDepth: 0,
  projectFileCount: 0,
  updatedAtMs: nowPerf(),
});

const resolveMode = (
  snapshot: PerformanceBudgetSnapshot,
): AdaptivePerformanceMode => {
  if (
    snapshot.activeEditorLargeDocument ||
    snapshot.activeEditorCharCount > 1_000_000 ||
    snapshot.activeEditorLineCount > 4_000 ||
    snapshot.eventPressure >= 80 ||
    snapshot.frameGapMs >= 80 ||
    snapshot.indexerQueueDepth >= 500
  ) {
    return "critical";
  }

  if (
    snapshot.activeEditorCharCount > 250_000 ||
    snapshot.activeEditorLineCount > 1_500 ||
    snapshot.eventPressure >= 24 ||
    snapshot.frameGapMs >= 34 ||
    snapshot.indexerQueueDepth >= 160 ||
    snapshot.projectFileCount >= 5_000
  ) {
    return "constrained";
  }

  return "normal";
};

const clampPressure = (value: number) => Math.max(0, Math.min(160, value));

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  mode: "normal",
  snapshot: defaultSnapshot(),

  updateBudget: (patch) => {
    set((state) => {
      const nextSnapshot: PerformanceBudgetSnapshot = {
        ...state.snapshot,
        ...patch,
        updatedAtMs: nowPerf(),
      };
      const nextMode = resolveMode(nextSnapshot);
      nextSnapshot.mode = nextMode;
      return { mode: nextMode, snapshot: nextSnapshot };
    });
  },

  recordEventPressure: (_scope, units = 1) => {
    const safeUnits = Number.isFinite(units) ? Math.max(1, units) : 1;
    const snapshot = get().snapshot;
    get().updateBudget({
      eventPressure: clampPressure(snapshot.eventPressure + safeUnits),
    });
  },

  recordMetric: (metric) => {
    const pressure =
      metric.durationMs >= 80 ? 12 : metric.durationMs >= 34 ? 5 : 1;
    get().recordEventPressure(metric.scope, pressure);
  },

  decayPressure: () => {
    const snapshot = get().snapshot;
    get().updateBudget({
      eventPressure: Math.floor(snapshot.eventPressure * 0.72),
      frameGapMs: Math.floor(snapshot.frameGapMs * 0.55),
    });
  },

  resetTransientBudget: () => {
    set((state) => {
      const nextSnapshot: PerformanceBudgetSnapshot = {
        ...state.snapshot,
        frameGapMs: 0,
        eventPressure: 0,
        activeEditorCharCount: 0,
        activeEditorLineCount: 0,
        activeEditorLargeDocument: false,
        updatedAtMs: nowPerf(),
      };
      const nextMode = resolveMode(nextSnapshot);
      nextSnapshot.mode = nextMode;
      return { mode: nextMode, snapshot: nextSnapshot };
    });
  },

  resetActiveEditorBudget: () => {
    set((state) => {
      const nextSnapshot: PerformanceBudgetSnapshot = {
        ...state.snapshot,
        activeEditorCharCount: 0,
        activeEditorLineCount: 0,
        activeEditorLargeDocument: false,
        updatedAtMs: nowPerf(),
      };
      const nextMode = resolveMode(nextSnapshot);
      nextSnapshot.mode = nextMode;
      return { mode: nextMode, snapshot: nextSnapshot };
    });
  },
}));

export const resolveAdaptiveEditorFeatureBudget = (
  snapshot: PerformanceBudgetSnapshot,
): AdaptiveEditorFeatureBudget => {
  const constrained =
    snapshot.mode !== "normal" || snapshot.activeEditorLargeDocument;
  const critical =
    snapshot.mode === "critical" || snapshot.activeEditorLargeDocument;
  const layoutConstrained = snapshot.activeEditorLargeDocument;
  const layoutStableLineWrapping = !layoutConstrained;
  const layoutStableFoldGutter = false;
  const layoutStableGitGutter = !layoutConstrained;
  const layoutStableMinimap = !layoutConstrained;
  const runtimeRichEditorFeatures = !constrained;
  const runtimeCompletions = !critical;
  const runtimeDiagnostics = !critical;
  const runtimeGitGutter = !constrained;
  const runtimeGhostText = !constrained;
  const runtimeHover = !constrained;
  const runtimeMinimap = !constrained;

  return {
    mode: snapshot.mode,
    layoutStableLineWrapping,
    layoutStableFoldGutter,
    layoutStableGitGutter,
    layoutStableMinimap,
    runtimeRichEditorFeatures,
    runtimeCompletions,
    runtimeDiagnostics,
    runtimeGitGutter,
    runtimeGhostText,
    runtimeHover,
    runtimeMinimap,
    richEditorFeatures: runtimeRichEditorFeatures,
    completions: runtimeCompletions,
    diagnostics: runtimeDiagnostics,
    gitGutter: runtimeGitGutter,
    ghostText: runtimeGhostText,
    hover: runtimeHover,
    languageExtensions: true,
    lineWrapping: layoutStableLineWrapping,
    minimap: runtimeMinimap,
    notifyChangeDelayMs: critical ? 900 : constrained ? 450 : 180,
  };
};

let adaptiveMonitorStarted = false;

export const startAdaptivePerformanceMonitor = (): (() => void) => {
  if (adaptiveMonitorStarted || typeof window === "undefined") {
    return () => undefined;
  }
  adaptiveMonitorStarted = true;

  let disposed = false;
  let lastFrameAt = nowPerf();
  let frameHandle = 0;

  const tick = () => {
    if (disposed) return;
    const current = nowPerf();
    const gap = current - lastFrameAt;
    lastFrameAt = current;
    if (gap >= 34) {
      usePerformanceStore.getState().updateBudget({ frameGapMs: gap });
    }
    frameHandle = window.requestAnimationFrame(tick);
  };

  const onMetric = (event: Event) => {
    const metric = (event as CustomEvent<PerfMetric>).detail;
    if (metric?.scope && typeof metric.durationMs === "number") {
      usePerformanceStore.getState().recordMetric(metric);
    }
  };

  frameHandle = window.requestAnimationFrame(tick);
  const decayTimer = window.setInterval(() => {
    usePerformanceStore.getState().decayPressure();
  }, 1_000);

  window.addEventListener(PERF_EVENT_NAME, onMetric);

  return () => {
    disposed = true;
    adaptiveMonitorStarted = false;
    window.cancelAnimationFrame(frameHandle);
    window.clearInterval(decayTimer);
    window.removeEventListener(PERF_EVENT_NAME, onMetric);
  };
};
