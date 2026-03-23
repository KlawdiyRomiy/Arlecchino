export const PERF_EVENT_NAME = "arlecchino:perf-metric";

export type PerfScope = "zoom" | "preview" | "terminal";

type PerfDetails = Record<string, string | number | boolean | null | undefined>;

export interface PerfMetric {
  scope: PerfScope;
  name: string;
  durationMs: number;
  timestampMs: number;
  details?: PerfDetails;
}

const getNow = (): number => {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }

  return Date.now();
};

export const emitPerfMetric = (
  metric: Omit<PerfMetric, "timestampMs">,
): PerfMetric => {
  const nextMetric: PerfMetric = {
    ...metric,
    timestampMs: getNow(),
  };

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PERF_EVENT_NAME, {
        detail: nextMetric,
      }),
    );
  }

  return nextMetric;
};

export const measurePerf = <T>(
  scope: PerfScope,
  name: string,
  operation: () => T,
  details?: PerfDetails,
): T => {
  const startedAt = getNow();
  const result = operation();
  const finishedAt = getNow();

  emitPerfMetric({
    scope,
    name,
    durationMs: finishedAt - startedAt,
    details,
  });

  return result;
};

export const nowPerf = (): number => getNow();
