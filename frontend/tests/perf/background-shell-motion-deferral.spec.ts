import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: () => async () => null,
      },
    );

    const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOnMultiple") {
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = eventHandlers.get(eventName) ?? new Set();
              handlers.add(callback);
              eventHandlers.set(eventName, handlers);
              return () => handlers.delete(callback);
            };
          }
          if (property === "EventsEmit") {
            return (eventName: string, payload?: unknown) => {
              const handlers = eventHandlers.get(eventName) ?? new Set();
              handlers.forEach((callback) => callback(payload));
            };
          }
          if (property === "EventsOff") {
            return (eventName: string) => {
              eventHandlers.delete(eventName);
            };
          }
          return async () => undefined;
        },
      },
    );

    Object.assign(window, {
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });

  await page.goto("/");
});

test("background shell snapshots notify subscribers after panel motion settles", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");
    const {
      getBackgroundShellStatusSnapshot,
      subscribeBackgroundShellStatus,
      syncBackgroundShellStatusFromPayload,
    } = await import("/src/shell/backgroundShellStatus.ts");

    let notifyCount = 0;
    const unsubscribe = subscribeBackgroundShellStatus(() => {
      notifyCount += 1;
    });

    usePerformanceStore.getState().beginPanelMotionWindow(30);
    syncBackgroundShellStatusFromPayload({
      version: 1,
      revision: 11,
      updatedAt: 1,
      jobs: [
        {
          id: "indexing-1",
          kind: "indexing",
          category: "job",
          title: "Indexing",
          status: "running",
          severity: "info",
          projectPath: "/workspace/testproject",
          progress: { percent: 25 },
          cancelable: false,
          startedAt: 1,
          updatedAt: 1,
        },
      ],
    });
    syncBackgroundShellStatusFromPayload({
      version: 1,
      revision: 12,
      updatedAt: 2,
      jobs: [
        {
          id: "indexing-1",
          kind: "indexing",
          category: "job",
          title: "Indexing",
          status: "running",
          severity: "info",
          projectPath: "/workspace/testproject",
          progress: { percent: 70 },
          cancelable: false,
          startedAt: 1,
          updatedAt: 2,
        },
      ],
    });

    const duringMotion = {
      notifyCount,
      revision: getBackgroundShellStatusSnapshot().revision,
      progress:
        getBackgroundShellStatusSnapshot().jobs[0]?.progress?.percent ?? 0,
    };

    await new Promise((resolve) => window.setTimeout(resolve, 60));

    const afterMotion = {
      notifyCount,
      revision: getBackgroundShellStatusSnapshot().revision,
      progress:
        getBackgroundShellStatusSnapshot().jobs[0]?.progress?.percent ?? 0,
    };
    unsubscribe();

    return { duringMotion, afterMotion };
  });

  expect(result).toEqual({
    duringMotion: {
      notifyCount: 0,
      revision: 12,
      progress: 70,
    },
    afterMotion: {
      notifyCount: 1,
      revision: 12,
      progress: 70,
    },
  });
});

test("interactive surface motion helper defers background shell notifications", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { markInteractiveSurfaceMotion } =
      await import("/src/components/ui/interactiveSurfaceMotion.ts");
    const {
      getBackgroundShellStatusSnapshot,
      subscribeBackgroundShellStatus,
      syncBackgroundShellStatusFromPayload,
    } = await import("/src/shell/backgroundShellStatus.ts");

    let notifyCount = 0;
    const unsubscribe = subscribeBackgroundShellStatus(() => {
      notifyCount += 1;
    });

    markInteractiveSurfaceMotion(30);
    syncBackgroundShellStatusFromPayload({
      version: 1,
      revision: 21,
      updatedAt: 3,
      jobs: [
        {
          id: "diagnostics-1",
          kind: "diagnostics-scan",
          category: "job",
          title: "Diagnostics scan",
          status: "running",
          severity: "info",
          projectPath: "/workspace/testproject",
          progress: { percent: 40 },
          cancelable: true,
          startedAt: 3,
          updatedAt: 3,
        },
      ],
    });

    const duringMotion = {
      notifyCount,
      revision: getBackgroundShellStatusSnapshot().revision,
    };
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    const afterMotion = {
      notifyCount,
      revision: getBackgroundShellStatusSnapshot().revision,
    };
    unsubscribe();

    return { duringMotion, afterMotion };
  });

  expect(result).toEqual({
    duringMotion: {
      notifyCount: 0,
      revision: 21,
    },
    afterMotion: {
      notifyCount: 1,
      revision: 21,
    },
  });
});

test("indexing progress notifies React subscribers after panel motion settles", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { Events } = await import("/wails/runtime.js");
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");
    const {
      getIndexingProgressSnapshot,
      resetIndexingProgressState,
      subscribeIndexingProgress,
    } = await import("/src/hooks/useIndexingProgress.ts");

    resetIndexingProgressState();
    let notifyCount = 0;
    const unsubscribe = subscribeIndexingProgress(() => {
      notifyCount += 1;
    });

    usePerformanceStore.getState().beginPanelMotionWindow(30);
    Events.Emit("indexer:started", {
      sessionId: "main",
      total: 32,
      queueDepth: 32,
      projectFileCount: 32,
    });
    Events.Emit("indexer:progress", {
      sessionId: "main",
      current: 24,
      total: 32,
      queueDepth: 8,
      projectFileCount: 32,
    });

    await new Promise((resolve) => window.setTimeout(resolve, 5));
    const duringMotion = {
      notifyCount,
      snapshot: getIndexingProgressSnapshot(),
    };
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    const afterMotion = {
      notifyCount,
      snapshot: getIndexingProgressSnapshot(),
    };
    unsubscribe();

    return {
      duringMotion,
      afterMotion,
    };
  });

  expect(result.duringMotion).toEqual({
    notifyCount: 0,
    snapshot: {
      phase: "indexing",
      current: 24,
      total: 32,
      percentage: 75,
    },
  });
  expect(result.afterMotion).toEqual({
    notifyCount: 1,
    snapshot: {
      phase: "indexing",
      current: 24,
      total: 32,
      percentage: 75,
    },
  });
});
