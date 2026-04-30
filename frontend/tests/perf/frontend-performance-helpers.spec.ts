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

    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOnMultiple") {
            return () => "sub-id";
          }
          if (property === "EventsOff") {
            return () => undefined;
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

test("calculatePanelMargins only reserves snapped panel space", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { calculatePanelMargins } =
      await import("/src/utils/layoutHelpers.ts");

    return calculatePanelMargins(
      {
        explorer: true,
        terminal: true,
        aiChat: true,
        browser: false,
      },
      {
        explorer: {
          mode: "snapped",
          position: "left",
          size: { width: 320, height: 0 },
        },
        terminal: {
          mode: "snapped",
          position: "bottom",
          size: { width: 0, height: 240 },
        },
        aiChat: {
          mode: "floating",
          position: "right",
          size: { width: 420, height: 360 },
        },
        browser: {
          mode: "snapped",
          position: "right",
          size: { width: 500, height: 0 },
        },
      },
    );
  });

  expect(result).toEqual({
    marginLeft: 320,
    marginRight: 0,
    marginBottom: 240,
    marginTop: 0,
  });
});

test("buildFileNodes filters ignored entries and sorts directories first", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { buildFileNodes, shouldIgnoreEntry } =
      await import("/src/utils/fileTreeHelpers.ts");

    const nodes = buildFileNodes(
      [
        { name: "z-last.ts", path: "/workspace/z-last.ts", isDirectory: false },
        {
          name: "node_modules",
          path: "/workspace/node_modules",
          isDirectory: true,
        },
        { name: "src", path: "/workspace/src", isDirectory: true },
        { name: "README.md", path: "/workspace/README.md", isDirectory: false },
        { name: ".git", path: "/workspace/.git", isDirectory: true },
      ],
      new Set(["/workspace/src"]),
    );

    return {
      names: nodes.map((node) => node.name),
      srcExpanded:
        nodes.find((node) => node.name === "src")?.isExpanded ?? false,
      srcChildrenLength:
        nodes.find((node) => node.name === "src")?.children?.length ?? -1,
      storageIgnored: shouldIgnoreEntry("storage/logs"),
      storageVisible: shouldIgnoreEntry("storage"),
    };
  });

  expect(result).toEqual({
    names: ["src", "README.md", "z-last.ts"],
    srcExpanded: true,
    srcChildrenLength: 0,
    storageIgnored: true,
    storageVisible: false,
  });
});

test("completion cache is instance-scoped and narrows results by prefix", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createCompletionCache } =
      await import("/src/utils/completionCache.ts");

    const cacheA = createCompletionCache();
    const cacheB = createCompletionCache();
    const timestamp = Date.now();

    cacheA.set({
      items: [{ label: "foobar" }, { label: "format" }, { label: "BarFoo" }],
      prefix: "fo",
      timestamp,
      filePath: "/workspace/test.php",
      semanticKey: "App\\User",
    });

    return {
      narrowed: (
        cacheA.get("/workspace/test.php", "App\\User", "foo") ?? []
      ).map((item) => item.label),
      otherCacheMiss:
        cacheB.get("/workspace/test.php", "App\\User", "foo") === null,
    };
  });

  expect(result).toEqual({
    narrowed: ["foobar"],
    otherCacheMiss: true,
  });
});

test("latest request guard marks only the newest request as current", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createLatestRequestGuard } =
      await import("/src/utils/latestRequestGuard.ts");

    const guard = createLatestRequestGuard();
    const first = guard.next();
    const second = guard.next();

    return {
      firstIsLatest: guard.isLatest(first),
      secondIsLatest: guard.isLatest(second),
      markedResponse: guard.mark(second),
    };
  });

  expect(result).toEqual({
    firstIsLatest: false,
    secondIsLatest: true,
    markedResponse: true,
  });
});

test("adaptive performance budget disables expensive editor features under pressure", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { resolveAdaptiveEditorFeatureBudget, usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");

    usePerformanceStore.getState().updateBudget({
      activeEditorCharCount: 1_250_000,
      activeEditorLargeDocument: true,
      eventPressure: 100,
      frameGapMs: 90,
    });

    const snapshot = usePerformanceStore.getState().snapshot;
    const budget = resolveAdaptiveEditorFeatureBudget(snapshot);

    return {
      mode: snapshot.mode,
      completions: budget.completions,
      diagnostics: budget.diagnostics,
      gitGutter: budget.gitGutter,
      minimap: budget.minimap,
      notifyChangeDelayMs: budget.notifyChangeDelayMs,
    };
  });

  expect(result).toEqual({
    mode: "critical",
    completions: false,
    diagnostics: false,
    gitGutter: false,
    minimap: false,
    notifyChangeDelayMs: 900,
  });
});

test("adaptive performance budget reacts to indexer and project pressure", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { resolveAdaptiveEditorFeatureBudget, usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");

    usePerformanceStore.getState().updateBudget({
      activeEditorCharCount: 32_000,
      activeEditorLineCount: 200,
      activeEditorLargeDocument: false,
      eventPressure: 0,
      frameGapMs: 0,
      indexerQueueDepth: 220,
      projectFileCount: 7_500,
    });

    const constrainedSnapshot = usePerformanceStore.getState().snapshot;
    const constrainedBudget =
      resolveAdaptiveEditorFeatureBudget(constrainedSnapshot);

    usePerformanceStore.getState().updateBudget({
      indexerQueueDepth: 650,
      projectFileCount: 16_000,
    });

    const criticalSnapshot = usePerformanceStore.getState().snapshot;
    const criticalBudget = resolveAdaptiveEditorFeatureBudget(criticalSnapshot);

    return {
      constrainedMode: constrainedSnapshot.mode,
      constrainedGitGutter: constrainedBudget.gitGutter,
      constrainedCompletions: constrainedBudget.completions,
      criticalMode: criticalSnapshot.mode,
      criticalCompletions: criticalBudget.completions,
      criticalNotifyDelay: criticalBudget.notifyChangeDelayMs,
    };
  });

  expect(result).toEqual({
    constrainedMode: "constrained",
    constrainedGitGutter: false,
    constrainedCompletions: true,
    criticalMode: "critical",
    criticalCompletions: false,
    criticalNotifyDelay: 900,
  });
});

test("adaptive performance budget resets transient editor pressure on project switch", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { usePerformanceStore } =
      await import("/src/stores/performanceStore.ts");

    usePerformanceStore.getState().updateBudget({
      activeEditorCharCount: 3_000_000,
      activeEditorLineCount: 30_000,
      activeEditorLargeDocument: true,
      eventPressure: 120,
      frameGapMs: 95,
      indexerQueueDepth: 0,
      projectFileCount: 0,
    });

    const criticalMode = usePerformanceStore.getState().mode;
    usePerformanceStore.getState().resetTransientBudget();
    const resetSnapshot = usePerformanceStore.getState().snapshot;

    return {
      criticalMode,
      resetMode: resetSnapshot.mode,
      activeEditorCharCount: resetSnapshot.activeEditorCharCount,
      activeEditorLargeDocument: resetSnapshot.activeEditorLargeDocument,
      eventPressure: resetSnapshot.eventPressure,
      frameGapMs: resetSnapshot.frameGapMs,
    };
  });

  expect(result).toEqual({
    criticalMode: "critical",
    resetMode: "normal",
    activeEditorCharCount: 0,
    activeEditorLargeDocument: false,
    eventPressure: 0,
    frameGapMs: 0,
  });
});
