import { create } from "zustand";
import {
  PERF_EVENT_NAME,
  type PerfMetric,
  type PerfScope,
  nowPerf,
} from "../utils/perf";
import { EventsEmit } from "../wails/runtime";

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
  panelMotionActive: boolean;
  beginPanelMotionWindow: (durationMs?: number) => void;
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
    snapshot.indexerQueueDepth >= 500
  ) {
    return "critical";
  }

  if (
    snapshot.activeEditorCharCount > 250_000 ||
    snapshot.activeEditorLineCount > 1_500 ||
    snapshot.eventPressure >= 24 ||
    snapshot.indexerQueueDepth >= 160
  ) {
    return "constrained";
  }

  return "normal";
};

export const shouldReduceInteractiveMotion = (
  snapshot: PerformanceBudgetSnapshot,
): boolean => snapshot.frameGapMs >= 34 || resolveMode(snapshot) !== "normal";

const clampPressure = (value: number) => Math.max(0, Math.min(160, value));

const defaultPanelMotionWindowMs = 420;
let panelMotionTimer: ReturnType<typeof setTimeout> | null = null;

const performanceBudgetChanged = (
  current: PerformanceBudgetSnapshot,
  next: PerformanceBudgetSnapshot,
): boolean =>
  current.mode !== next.mode ||
  current.frameGapMs !== next.frameGapMs ||
  current.eventPressure !== next.eventPressure ||
  current.activeEditorCharCount !== next.activeEditorCharCount ||
  current.activeEditorLineCount !== next.activeEditorLineCount ||
  current.activeEditorLargeDocument !== next.activeEditorLargeDocument ||
  current.indexerQueueDepth !== next.indexerQueueDepth ||
  current.projectFileCount !== next.projectFileCount;

let lastPerformanceTraceAt = 0;
let lastPerformanceTraceKey = "";

const shouldTracePerformanceBudget = (
  previous: PerformanceState,
  next: PerformanceState,
): string | null => {
  const snapshot = next.snapshot;
  if (previous.mode !== next.mode) {
    return "mode-change";
  }
  if (snapshot.frameGapMs >= 50) {
    return "frame-gap";
  }
  if (snapshot.indexerQueueDepth >= 160) {
    return "indexer-queue";
  }
  if (snapshot.eventPressure >= 80) {
    return "event-pressure";
  }
  return null;
};

const maybeEmitPerformanceTrace = (
  previous: PerformanceState,
  next: PerformanceState,
) => {
  const reason = shouldTracePerformanceBudget(previous, next);
  if (reason === null) {
    return;
  }

  const now = nowPerf();
  const snapshot = next.snapshot;
  const frameGapBucket =
    reason === "frame-gap"
      ? Math.floor(snapshot.frameGapMs / 50)
      : Math.round(snapshot.frameGapMs / 10);
  const traceKey = [
    reason,
    snapshot.mode,
    frameGapBucket,
    Math.floor(snapshot.eventPressure / 10),
    Math.floor(snapshot.indexerQueueDepth / 40),
    Math.floor(snapshot.projectFileCount / 500),
    next.panelMotionActive ? "motion" : "stable",
  ].join(":");
  const minTraceIntervalMs = reason === "frame-gap" ? 15000 : 3000;
  if (
    reason === "frame-gap" &&
    now - lastPerformanceTraceAt < minTraceIntervalMs
  ) {
    return;
  }
  if (
    traceKey === lastPerformanceTraceKey &&
    now - lastPerformanceTraceAt < 3000
  ) {
    return;
  }

  lastPerformanceTraceAt = now;
  lastPerformanceTraceKey = traceKey;
  const payload = {
    reason,
    mode: snapshot.mode,
    frameGapMs: Math.round(snapshot.frameGapMs),
    eventPressure: snapshot.eventPressure,
    activeEditorCharCount: snapshot.activeEditorCharCount,
    activeEditorLineCount: snapshot.activeEditorLineCount,
    activeEditorLargeDocument: snapshot.activeEditorLargeDocument,
    indexerQueueDepth: snapshot.indexerQueueDepth,
    projectFileCount: snapshot.projectFileCount,
    panelMotionActive: next.panelMotionActive,
    updatedAtMs: Math.round(snapshot.updatedAtMs),
  };

  try {
    EventsEmit("ide:perf:trace", payload);
  } catch {
    // Perf telemetry must never affect the editor runtime.
  }
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[PerfTrace][Frontend]", payload);
  }
};

const buildBudgetState = (
  state: PerformanceState,
  patch: Partial<PerformanceBudgetSnapshot>,
): Partial<PerformanceState> | PerformanceState => {
  const candidateSnapshot: PerformanceBudgetSnapshot = {
    ...state.snapshot,
    ...patch,
  };
  const nextMode = state.panelMotionActive
    ? state.mode
    : resolveMode(candidateSnapshot);
  candidateSnapshot.mode = nextMode;

  if (
    state.mode === nextMode &&
    !performanceBudgetChanged(state.snapshot, candidateSnapshot)
  ) {
    return state;
  }

  return {
    mode: nextMode,
    snapshot: {
      ...candidateSnapshot,
      updatedAtMs: nowPerf(),
    },
  };
};

export const usePerformanceStore = create<PerformanceState>((set, get) => ({
  mode: "normal",
  snapshot: defaultSnapshot(),
  panelMotionActive: false,

  beginPanelMotionWindow: (durationMs = defaultPanelMotionWindowMs) => {
    if (panelMotionTimer !== null) {
      clearTimeout(panelMotionTimer);
    }

    set((state) =>
      state.panelMotionActive ? state : { panelMotionActive: true },
    );
    panelMotionTimer = setTimeout(
      () => {
        panelMotionTimer = null;
        set((state) => {
          const nextMode = resolveMode(state.snapshot);
          const snapshot =
            state.snapshot.mode === nextMode
              ? state.snapshot
              : {
                  ...state.snapshot,
                  mode: nextMode,
                  updatedAtMs: nowPerf(),
                };
          if (
            !state.panelMotionActive &&
            state.mode === nextMode &&
            snapshot === state.snapshot
          ) {
            return state;
          }

          return {
            panelMotionActive: false,
            mode: nextMode,
            snapshot,
          };
        });
      },
      Math.max(0, durationMs),
    );
  },

  updateBudget: (patch) => {
    const previous = get();
    const nextPatch = buildBudgetState(previous, patch);
    if (nextPatch === previous) {
      return;
    }
    const next = { ...previous, ...nextPatch };
    set(nextPatch);
    maybeEmitPerformanceTrace(previous, next);
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
    set((state) =>
      buildBudgetState(state, {
        frameGapMs: 0,
        eventPressure: 0,
        activeEditorCharCount: 0,
        activeEditorLineCount: 0,
        activeEditorLargeDocument: false,
      }),
    );
  },

  resetActiveEditorBudget: () => {
    set((state) =>
      buildBudgetState(state, {
        activeEditorCharCount: 0,
        activeEditorLineCount: 0,
        activeEditorLargeDocument: false,
      }),
    );
  },
}));

export const beginInteractiveSurfaceMotionWindow = (
  durationMs?: number,
): void => {
  usePerformanceStore.getState().beginPanelMotionWindow(durationMs);
};

export const resolveAdaptiveEditorFeatureBudget = (
  snapshot: PerformanceBudgetSnapshot,
): AdaptiveEditorFeatureBudget => {
  const constrained =
    snapshot.mode !== "normal" || snapshot.activeEditorLargeDocument;
  const critical =
    snapshot.mode === "critical" || snapshot.activeEditorLargeDocument;
  const layoutConstrained = snapshot.activeEditorLargeDocument;
  const layoutStableLineWrapping = !layoutConstrained;
  const layoutStableFoldGutter = !layoutConstrained;
  const layoutStableGitGutter = !layoutConstrained;
  const layoutStableMinimap = !layoutConstrained;
  const runtimeRichEditorFeatures = !constrained;
  const runtimeCompletions = !critical;
  const runtimeDiagnostics = true;
  const runtimeGitGutter = !snapshot.activeEditorLargeDocument;
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
const adaptiveFrameProbeIntervalMs = 1_000;

export const startAdaptivePerformanceMonitor = (): (() => void) => {
  if (adaptiveMonitorStarted || typeof window === "undefined") {
    return () => undefined;
  }
  adaptiveMonitorStarted = true;

  let disposed = false;
  let frameHandle = 0;

  const cancelPendingFrameProbe = () => {
    if (frameHandle !== 0) {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = 0;
    }
  };

  const probeFrameGap = () => {
    cancelPendingFrameProbe();
    const scheduledAt = nowPerf();
    frameHandle = window.requestAnimationFrame((firstFrameAt) => {
      if (disposed) return;
      frameHandle = window.requestAnimationFrame((secondFrameAt) => {
        frameHandle = 0;
        if (disposed) return;
        const schedulingDelay = firstFrameAt - scheduledAt;
        const frameGap = secondFrameAt - firstFrameAt;
        const observedGap = Math.max(schedulingDelay, frameGap);
        if (observedGap >= 34) {
          usePerformanceStore
            .getState()
            .updateBudget({ frameGapMs: observedGap });
        }
      });
    });
  };

  const onMetric = (event: Event) => {
    const metric = (event as CustomEvent<PerfMetric>).detail;
    if (metric?.scope && typeof metric.durationMs === "number") {
      usePerformanceStore.getState().recordMetric(metric);
    }
  };

  probeFrameGap();
  const probeTimer = window.setInterval(() => {
    probeFrameGap();
    usePerformanceStore.getState().decayPressure();
  }, adaptiveFrameProbeIntervalMs);

  window.addEventListener(PERF_EVENT_NAME, onMetric);

  return () => {
    disposed = true;
    adaptiveMonitorStarted = false;
    cancelPendingFrameProbe();
    window.clearInterval(probeTimer);
    window.removeEventListener(PERF_EVENT_NAME, onMetric);
  };
};
