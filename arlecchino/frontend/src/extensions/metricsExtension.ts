import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { completionStatus, type Completion } from "@codemirror/autocomplete";

type JitterStats = {
  total: number;
  jitter: number;
  ratio: number;
};

type MetricsCallbacks = {
  onTyping?: (delta: number) => void;
  onGhostShown?: () => void;
  onGhostRejected?: () => void;
  onCompletionAccepted?: (item: Completion) => void;
  onJitterUpdate?: (stats: JitterStats) => void;
  onAutocompleteLatencyUpdate?: (stats: {
    lastMs: number;
    p50Ms: number;
    p95Ms: number;
    samples: number;
  }) => void;
  onRequestPressureUpdate?: (stats: {
    backendRequests: number;
    cacheHits: number;
    cacheMisses: number;
    instantFallbacks: number;
  }) => void;
};

export type MetricsHandle = {
  extension: Extension;
  recordGhostShown: () => void;
  recordGhostRejected: () => void;
  recordCompletionAccepted: (item: Completion) => void;
  recordCompletionList: (items: Completion[]) => void;
  recordAutocompleteRequested: () => void;
  recordBackendRequestStarted: () => void;
  recordCacheHit: () => void;
  recordCacheMiss: () => void;
  recordInstantFallbackUsed: () => void;
};

export function metricsExtension(
  callbacks: MetricsCallbacks,
  initialDocLength: number,
): MetricsHandle {
  let lastDocLength = initialDocLength;
  let lastAutocompleteRequestedAt: number | null = null;
  let lastCompletionStatus: ReturnType<typeof completionStatus> = null;
  let lastTopLabel = "";
  let jitterCount = 0;
  let updateCount = 0;

  const latencySamples: number[] = [];
  const maxLatencySamples = 50;

  let backendRequests = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let instantFallbacks = 0;

  const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.max(
      0,
      Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1),
    );
    return sorted[idx] ?? 0;
  };

  const extension = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const currentLength = update.state.doc.length;
      const delta = Math.abs(currentLength - lastDocLength);
      lastDocLength = currentLength;
      if (delta > 0) {
        callbacks.onTyping?.(delta);
      }
    }

    const statusNow = completionStatus(update.state);
    if (statusNow !== lastCompletionStatus) {
      lastCompletionStatus = statusNow;
      if (statusNow !== null && lastAutocompleteRequestedAt !== null) {
        const dt = performance.now() - lastAutocompleteRequestedAt;
        latencySamples.push(dt);
        if (latencySamples.length > maxLatencySamples) {
          latencySamples.shift();
        }
        if (latencySamples.length >= 10) {
          const p50Ms = percentile(latencySamples, 0.5);
          const p95Ms = percentile(latencySamples, 0.95);
          callbacks.onAutocompleteLatencyUpdate?.({
            lastMs: dt,
            p50Ms,
            p95Ms,
            samples: latencySamples.length,
          });
        }
        lastAutocompleteRequestedAt = null;
      }
    }
  });

  const recordGhostShown = () => callbacks.onGhostShown?.();
  const recordGhostRejected = () => callbacks.onGhostRejected?.();
  const recordCompletionAccepted = (item: Completion) =>
    callbacks.onCompletionAccepted?.(item);

  const recordCompletionList = (items: Completion[]) => {
    if (items.length === 0) return;
    updateCount += 1;
    const topLabel = items[0]?.label ?? "";
    if (topLabel && topLabel !== lastTopLabel) {
      jitterCount += 1;
      lastTopLabel = topLabel;
    }
    callbacks.onJitterUpdate?.({
      total: updateCount,
      jitter: jitterCount,
      ratio: updateCount > 0 ? jitterCount / updateCount : 0,
    });
  };

  const recordAutocompleteRequested = () => {
    lastAutocompleteRequestedAt = performance.now();
  };

  const emitPressureUpdate = () => {
    callbacks.onRequestPressureUpdate?.({
      backendRequests,
      cacheHits,
      cacheMisses,
      instantFallbacks,
    });
  };

  const recordBackendRequestStarted = () => {
    backendRequests += 1;
    if (backendRequests % 10 === 0) {
      emitPressureUpdate();
    }
  };

  const recordCacheHit = () => {
    cacheHits += 1;
    if ((cacheHits + cacheMisses) % 25 === 0) {
      emitPressureUpdate();
    }
  };

  const recordCacheMiss = () => {
    cacheMisses += 1;
    if ((cacheHits + cacheMisses) % 25 === 0) {
      emitPressureUpdate();
    }
  };

  const recordInstantFallbackUsed = () => {
    instantFallbacks += 1;
    if (instantFallbacks % 25 === 0) {
      emitPressureUpdate();
    }
  };

  return {
    extension,
    recordGhostShown,
    recordGhostRejected,
    recordCompletionAccepted,
    recordCompletionList,
    recordAutocompleteRequested,
    recordBackendRequestStarted,
    recordCacheHit,
    recordCacheMiss,
    recordInstantFallbackUsed,
  };
}
