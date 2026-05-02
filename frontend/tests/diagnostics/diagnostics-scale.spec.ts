import { expect, test, type Page } from "@playwright/test";

const editorProjectPath = "/workspace";
const editorFilePath = `${editorProjectPath}/diagnostics.ts`;

const mountEditorTab = async (
  page: Page,
  content: string,
  options: {
    constrainedPerformance?: boolean;
    showInlineDiagnostics?: boolean;
  } = {},
): Promise<void> => {
  const { constrainedPerformance = false, showInlineDiagnostics = true } =
    options;

  await page.evaluate(
    async ({
      constrainedPerformance,
      editorProjectPath,
      showInlineDiagnostics,
    }) => {
      const { useWorkspaceStore } =
        await import("/src/stores/workspaceStore.ts");
      const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
      const { useDiagnosticsStore } =
        await import("/src/stores/diagnosticsStore.ts");
      const { useEditorSettingsStore } =
        await import("/src/stores/editorSettingsStore.ts");
      const { usePerformanceStore } =
        await import("/src/stores/performanceStore.ts");

      useDiagnosticsStore.getState().reset();
      useEditorSettingsStore
        .getState()
        .setShowInlineDiagnostics(showInlineDiagnostics);
      if (constrainedPerformance) {
        usePerformanceStore.getState().updateBudget({
          activeEditorCharCount: 32_000,
          activeEditorLineCount: 200,
          activeEditorLargeDocument: false,
          eventPressure: 0,
          frameGapMs: 0,
          indexerQueueDepth: 220,
          projectFileCount: 7_500,
        });
      } else {
        usePerformanceStore.getState().resetTransientBudget();
      }
      useWorkspaceStore.setState({
        projects: [
          {
            id: editorProjectPath,
            path: editorProjectPath,
            name: "workspace",
            openedAt: 1,
          },
        ],
        activeId: editorProjectPath,
        activeFramework: null,
        pendingId: null,
        ready: true,
        switchDirection: 1,
        uiBlockers: [],
      });
      useExplorerStore.getState().setProjectPath(editorProjectPath);
    },
    { constrainedPerformance, editorProjectPath, showInlineDiagnostics },
  );

  await expect(page.getByTestId("main-layout")).toBeVisible({
    timeout: 10000,
  });

  await page.evaluate(
    async ({ content, editorFilePath }) => {
      (
        window as typeof window & {
          __diagnosticsEditorContent?: string;
          __diagnosticsEditorPath?: string;
        }
      ).__diagnosticsEditorContent = content;
      (
        window as typeof window & {
          __diagnosticsEditorContent?: string;
          __diagnosticsEditorPath?: string;
        }
      ).__diagnosticsEditorPath = editorFilePath;
    },
    { content, editorFilePath },
  );

  await page.locator(`[data-file-path="${editorFilePath}"]`).click();
  await expect(page.locator(".cm-editor").first()).toBeVisible({
    timeout: 10000,
  });

  if (constrainedPerformance) {
    await page.evaluate(async () => {
      const { usePerformanceStore } =
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
    });
  }

  await expect
    .poll(() =>
      page
        .locator(".cm-editor")
        .first()
        .evaluate((node) =>
          node.getAttribute("data-adaptive-reconfigure-count"),
        ),
    )
    .not.toBeNull();
};

const setEditorDiagnostics = async (
  page: Page,
  items: Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    severity: number;
    message: string;
    source?: string;
    code?: string;
  }>,
): Promise<void> => {
  await page.evaluate(
    async ({ editorFilePath, items }) => {
      const { useDiagnosticsStore } =
        await import("/src/stores/diagnosticsStore.ts");
      useDiagnosticsStore
        .getState()
        .setFileDiagnostics(editorFilePath, "typescript", items);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      useDiagnosticsStore
        .getState()
        .setFileDiagnostics(editorFilePath, "typescript", items);
    },
    { editorFilePath, items },
  );

  await expect
    .poll(() =>
      page.evaluate(
        async ({ editorFilePath }) => {
          const { useDiagnosticsStore } =
            await import("/src/stores/diagnosticsStore.ts");
          return (
            useDiagnosticsStore.getState().byFile.get(editorFilePath)?.items
              .length ?? 0
          );
        },
        { editorFilePath },
      ),
    )
    .toBe(items.length);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "workspace-storage",
      JSON.stringify({
        state: {
          projects: [
            {
              id: "/workspace",
              path: "/workspace",
              name: "workspace",
              openedAt: 1,
            },
          ],
          activeId: "/workspace",
          switchDirection: 1,
        },
        version: 0,
      }),
    );

    const eventHandlers = new Map<string, Array<(payload: unknown) => void>>();

    const runtimeBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "EventsOn") {
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = eventHandlers.get(eventName) ?? [];
              handlers.push(callback);
              eventHandlers.set(eventName, handlers);
              return () => {
                eventHandlers.set(
                  eventName,
                  (eventHandlers.get(eventName) ?? []).filter(
                    (handler) => handler !== callback,
                  ),
                );
              };
            };
          }

          if (property === "EventsOnMultiple") {
            return (
              eventName: string,
              callback: (payload: unknown) => void,
            ) => {
              const handlers = eventHandlers.get(eventName) ?? [];
              handlers.push(callback);
              eventHandlers.set(eventName, handlers);
              return () => {
                eventHandlers.set(
                  eventName,
                  (eventHandlers.get(eventName) ?? []).filter(
                    (handler) => handler !== callback,
                  ),
                );
              };
            };
          }

          if (property === "EventsOff") {
            return () => undefined;
          }

          return () => undefined;
        },
      },
    );

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            switch (property) {
              case "GetCurrentProjectFramework":
                return null;
              case "GetRecentProjects":
                return [];
              case "GetDevToolsStatus":
                return [];
              case "GetCurrentProjectPath":
                return "/workspace";
              case "OpenProject":
              case "CreateTerminal":
              case "WriteTerminal":
              case "SendTerminalText":
              case "CloseTerminal":
              case "ResizeTerminal":
                return true;
              case "ListFiles":
                return [];
              case "ReadDirectory":
                return [
                  {
                    name: "diagnostics.ts",
                    path: "/workspace/diagnostics.ts",
                    isDirectory: false,
                  },
                ];
              case "InspectEditorFile": {
                const path = typeof args[0] === "string" ? args[0] : "file.ts";
                const diagnosticsWindow = window as typeof window & {
                  __diagnosticsEditorContent?: string;
                  __diagnosticsEditorPath?: string;
                };
                const content =
                  diagnosticsWindow.__diagnosticsEditorPath === path &&
                  diagnosticsWindow.__diagnosticsEditorContent !== undefined
                    ? diagnosticsWindow.__diagnosticsEditorContent
                    : `// ${path}\nexport const ready = true;\n`;
                const lines = content.split("\n");
                const name = path.split("/").pop() || path;
                return {
                  path,
                  name,
                  sizeBytes: new TextEncoder().encode(content).length,
                  formattedSize: `${content.length} B`,
                  isText: true,
                  safeForEditor: true,
                  largeDocument: false,
                  reason: "safe for interactive editing",
                  lineCount: lines.length,
                  maxLineLength: Math.max(
                    ...lines.map((line) => line.length),
                    0,
                  ),
                  limitBytes: 2 * 1024 * 1024,
                  lineLimit: 20_000,
                  maxLineLengthLimit: 20_000,
                };
              }
              case "ReadFile": {
                const path = typeof args[0] === "string" ? args[0] : "file.ts";
                const diagnosticsWindow = window as typeof window & {
                  __diagnosticsEditorContent?: string;
                  __diagnosticsEditorPath?: string;
                };
                if (
                  diagnosticsWindow.__diagnosticsEditorPath === path &&
                  diagnosticsWindow.__diagnosticsEditorContent !== undefined
                ) {
                  return diagnosticsWindow.__diagnosticsEditorContent;
                }
                return `// ${path}\nexport const ready = true;\n`;
              }
              case "GetLanguageForFile":
                return "typescript";
              default:
                return null;
            }
          };
        },
      },
    );

    Object.assign(window, {
      __emitRuntimeEvent(eventName: string, payload: unknown) {
        const handlers = eventHandlers.get(eventName) ?? [];
        handlers.forEach((handler) => handler(payload));
      },
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });

  await page.goto("/");
});

test("inline diagnostics render viewport overlay without content widgets", async ({
  page,
}) => {
  const content = Array.from(
    { length: 120 },
    (_value, index) => `const value${index} = ${index};`,
  ).join("\n");
  const diagnostics = Array.from({ length: 100 }, (_value, index) => ({
    range: {
      start: { line: index, character: 6 },
      end: { line: index, character: 12 },
    },
    severity: index % 3 === 0 ? 1 : 2,
    message: `diagnostic ${index} intentionally long enough to exercise truncation and overlay rendering`,
    source: "test",
  }));

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, diagnostics);

  await expect(page.locator(".cm-diagnostic-overlay").first()).toBeVisible();
  const overlayCount = await page.locator(".cm-diagnostic-overlay").count();
  expect(overlayCount).toBeGreaterThan(0);
  expect(overlayCount).toBeLessThan(diagnostics.length);
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
});

test("inline diagnostics render under constrained performance budget", async ({
  page,
}) => {
  const content = [
    "const ok = true;",
    "const brokenValue = missingValue;",
    "const tail = true;",
  ].join("\n");

  await mountEditorTab(page, content, { constrainedPerformance: true });
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 1, character: 20 },
        end: { line: 1, character: 32 },
      },
      severity: 1,
      message: "Cannot find name 'missingValue'.",
      source: "tsserver",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(1);
  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(1);
});

test("inline diagnostics stay hidden when the editor setting is disabled", async ({
  page,
}) => {
  const content = [
    "const ok = true;",
    "const brokenValue = missingValue;",
    "const tail = true;",
  ].join("\n");

  await mountEditorTab(page, content, { showInlineDiagnostics: false });
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 1, character: 20 },
        end: { line: 1, character: 32 },
      },
      severity: 1,
      message: "Cannot find name 'missingValue'.",
      source: "tsserver",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(0);
  await expect(page.locator(".cm-diagnostic-range-error")).toHaveCount(0);
});

test("inline diagnostics stay compact until active and survive edits without inline artifacts", async ({
  page,
}) => {
  const content = [
    "const untouched = true;",
    "const padding = true;",
    'const brokenScore = "bad";',
    "const spacer = true;",
    "missingDemoFunction();",
    "const tail = true;",
  ].join("\n");

  await mountEditorTab(page, content);
  await setEditorDiagnostics(page, [
    {
      range: {
        start: { line: 2, character: 6 },
        end: { line: 2, character: 17 },
      },
      severity: 1,
      message:
        "Type 'string' is not assignable to type 'number' and should remain outside the text flow.",
      source: "tsserver",
    },
    {
      range: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 19 },
      },
      severity: 1,
      message: "Cannot find name 'missingDemoFunction'.",
      source: "tsserver",
    },
    {
      range: {
        start: { line: 4, character: 0 },
        end: { line: 4, character: 19 },
      },
      severity: 2,
      message: "Second diagnostic on the same visible line.",
      source: "eslint",
    },
  ]);

  await expect(page.locator(".cm-diagnostic-overlay")).toHaveCount(2);
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
  await expect(
    page.locator(".cm-diagnostic-overlay-count").filter({ hasText: "2" }),
  ).toHaveCount(1);

  const compactTextDisplay = await page
    .locator(".cm-diagnostic-overlay-text")
    .first()
    .evaluate((node) => window.getComputedStyle(node).display);
  expect(compactTextDisplay).toBe("none");

  await page.locator(".cm-line").nth(2).click();
  await expect(
    page.locator(".cm-diagnostic-overlay[data-diagnostic-expanded='true']"),
  ).toHaveCount(1);
  await expect(
    page.locator(
      ".cm-diagnostic-overlay[data-diagnostic-expanded='true'] .cm-diagnostic-overlay-text",
    ),
  ).toContainText("not assignable");

  await page.locator(".cm-line").first().click();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
  await expect(page.locator(".cm-diagnostic-overlay").first()).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".cm-content .cm-diagnostic-message")).toHaveCount(
    0,
  );
});

test("diagnostics store drops stale project and generation events", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/beta");
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 0);

    emit("lsp:ready", {
      generation: 2,
      projectPath: "/projects/beta",
    });
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 2);

    emit("lsp:diagnostics", {
      filePath: "/projects/alpha/src/app.ts",
      generation: 1,
      projectPath: "/projects/alpha",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 3 },
          },
          severity: 1,
          message: "alpha stale",
        },
      ],
    });

    emit("lsp:diagnostics", {
      filePath: "/projects/beta/src/stale.ts",
      generation: 1,
      projectPath: "/projects/beta",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          severity: 1,
          message: "beta stale generation",
        },
      ],
    });

    emit("lsp:diagnostics", {
      filePath: "/projects/beta/src/live.ts",
      generation: 2,
      projectPath: "/projects/beta",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 1, character: 1 },
            end: { line: 1, character: 7 },
          },
          severity: 2,
          message: "beta live",
        },
      ],
    });

    const state = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      activeProjectPath: state.activeProjectPath ?? null,
      currentGeneration: state.currentGeneration ?? 0,
      entries: Array.from(state.byFile.keys()),
      totals: Array.from(state.byFile.values()).map(
        (group) => group.summary.total,
      ),
    };
  });

  expect(result.activeProjectPath).toBe("/projects/beta");
  expect(result.currentGeneration).toBe(2);
  expect(result.entries).toEqual(["/projects/beta/src/live.ts"]);
  expect(result.totals).toEqual([1]);
});

test("preload lifecycle ignores mismatched project generations", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/beta");

    emit("lsp:ready", {
      generation: 7,
      projectPath: "/projects/beta",
    });

    emit("lsp:diagnostics:preload:start", {
      generation: 6,
      projectPath: "/projects/alpha",
    });
    const afterWrongStart = projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:start", {
      generation: 7,
      projectPath: "/projects/beta",
    });
    const afterCorrectStart =
      projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 6,
      projectPath: "/projects/alpha",
    });
    const afterWrongComplete =
      projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 7,
      projectPath: "/projects/beta",
    });
    const afterCorrectComplete =
      projectState.getProjectDiagnosticsPreloadSnapshot();

    return {
      afterWrongStart,
      afterCorrectStart,
      afterWrongComplete,
      afterCorrectComplete,
    };
  });

  expect(result.afterWrongStart).toEqual({
    active: false,
    bounded: false,
    generation: 7,
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterCorrectStart).toEqual({
    active: true,
    bounded: false,
    generation: 7,
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterWrongComplete).toEqual({
    active: true,
    bounded: false,
    generation: 7,
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterCorrectComplete).toEqual({
    active: false,
    bounded: false,
    generation: 7,
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
});

test("preload lifecycle accepts backend events before explicit scope activation", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();

    emit("lsp:ready", {
      generation: 9,
      projectPath: "/projects/gamma",
    });
    emit("lsp:diagnostics:preload:start", {
      generation: 9,
      projectPath: "/projects/gamma",
    });
    const afterStart = projectState.getProjectDiagnosticsPreloadSnapshot();

    projectState.activateProjectScope("/projects/gamma");
    const afterActivate = projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 9,
      projectPath: "/projects/gamma",
    });
    const afterComplete = projectState.getProjectDiagnosticsPreloadSnapshot();

    return {
      afterStart,
      afterActivate,
      afterComplete,
    };
  });

  expect(result.afterStart).toEqual({
    active: true,
    bounded: false,
    generation: 9,
    projectPath: "/projects/gamma",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterActivate).toEqual({
    active: true,
    bounded: false,
    generation: 9,
    projectPath: "/projects/gamma",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
  expect(result.afterComplete).toEqual({
    active: false,
    bounded: false,
    generation: 9,
    projectPath: "/projects/gamma",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
});

test("preload lifecycle carries bounded metadata for large workloads", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/huge");
    emit("lsp:ready", {
      generation: 11,
      projectPath: "/projects/huge",
    });

    emit("lsp:diagnostics:preload:start", {
      generation: 11,
      projectPath: "/projects/huge",
      bounded: true,
      totalCandidates: 120,
      selectedCandidates: 16,
      totalLanguages: 5,
      selectedLanguages: 2,
    });
    const during = projectState.getProjectDiagnosticsPreloadSnapshot();

    emit("lsp:diagnostics:preload:complete", {
      generation: 11,
      projectPath: "/projects/huge",
      bounded: true,
      totalCandidates: 120,
      selectedCandidates: 16,
      totalLanguages: 5,
      selectedLanguages: 2,
    });
    const after = projectState.getProjectDiagnosticsPreloadSnapshot();

    return { during, after };
  });

  expect(result.during).toEqual({
    active: true,
    bounded: true,
    generation: 11,
    projectPath: "/projects/huge",
    selectedCandidates: 16,
    selectedLanguages: 2,
    totalCandidates: 120,
    totalLanguages: 5,
  });
  expect(result.after).toEqual({
    active: false,
    bounded: true,
    generation: 11,
    projectPath: "/projects/huge",
    selectedCandidates: 16,
    selectedLanguages: 2,
    totalCandidates: 120,
    totalLanguages: 5,
  });
});

test("project scope activated before runtime events preserves diagnostics", async ({
  page,
}) => {
  const state = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");

    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/beta");
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 0);

    emit("lsp:ready", {
      projectPath: "/projects/beta",
      generation: 3,
    });
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/beta", 3);
    emit("lsp:diagnostics:preload:start", {
      projectPath: "/projects/beta",
      generation: 3,
    });
    emit("lsp:diagnostics", {
      projectPath: "/projects/beta",
      generation: 3,
      filePath: "/projects/beta/src/live.ts",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
          severity: 1,
          message: "project open diagnostic",
        },
      ],
    });
    emit("lsp:diagnostics:preload:complete", {
      projectPath: "/projects/beta",
      generation: 3,
    });

    const snapshot = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      activeProjectPath: snapshot.activeProjectPath ?? null,
      currentGeneration: snapshot.currentGeneration ?? 0,
      files: Array.from(snapshot.byFile.keys()),
      totals: Array.from(snapshot.byFile.values()).map(
        (group) => group.summary.total,
      ),
      preload: projectState.getProjectDiagnosticsPreloadSnapshot(),
    };
  });

  expect(state.activeProjectPath).toBe("/projects/beta");
  expect(state.currentGeneration).toBe(3);
  expect(state.files).toEqual(["/projects/beta/src/live.ts"]);
  expect(state.totals).toEqual([1]);
  expect(state.preload).toEqual({
    active: false,
    bounded: false,
    generation: 3,
    projectPath: "/projects/beta",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
});

test("diagnostics bind through runtime wrapper without legacy window runtime", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "runtime", {
      configurable: true,
      get: () => undefined,
      set: () => undefined,
    });
  });
  await page.reload();

  const state = await page.evaluate(async () => {
    const moduleKey = Date.now();
    const diagnostics = await import(
      `/src/stores/diagnosticsStore.ts?runtime-free=${moduleKey}`
    );
    const runtime = await import("/src/wails/runtime.ts");

    diagnostics.useDiagnosticsStore.getState().reset();
    diagnostics.useDiagnosticsStore
      .getState()
      .setProjectScope("/projects/runtime-free", 0);

    runtime.EventsEmit("lsp:diagnostics", {
      projectPath: "/projects/runtime-free",
      generation: 1,
      filePath: "/projects/runtime-free/src/main.ts",
      language: "typescript",
      items: [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 6 },
          },
          severity: 1,
          message: "runtime wrapper diagnostic",
        },
      ],
    });

    const snapshot = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      activeProjectPath: snapshot.activeProjectPath ?? null,
      currentGeneration: snapshot.currentGeneration ?? 0,
      files: Array.from(snapshot.byFile.keys()),
      totals: Array.from(snapshot.byFile.values()).map(
        (group) => group.summary.total,
      ),
    };
  });

  expect(state.activeProjectPath).toBe("/projects/runtime-free");
  expect(state.currentGeneration).toBe(1);
  expect(state.files).toEqual(["/projects/runtime-free/src/main.ts"]);
  expect(state.totals).toEqual([1]);
});

test("diagnostics status error shows unavailable problems state instead of false clear", async ({
  page,
}) => {
  await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const emit = (
      window as typeof window & {
        __emitRuntimeEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/workspace");
    diagnostics.useDiagnosticsStore.getState().setProjectScope("/workspace", 3);

    emit("lsp:diagnostics:status", {
      projectPath: "/workspace",
      generation: 3,
      language: "typescript",
      filePath: "/workspace/diagnostics.ts",
      state: "error",
      message: "LSP didOpen failed for diagnostics.ts",
    });
  });

  await expect(page.getByTestId("diagnostics-compact-indicator")).toBeVisible();
  await expect(page.getByTestId("diagnostics-compact-indicator")).toHaveText(
    /Unavailable/,
  );
  await page.getByTestId("diagnostics-compact-indicator").click();
  await expect(page.getByTestId("problems-panel")).toBeVisible();
  await expect(page.getByText("Diagnostics unavailable")).toBeVisible();
  await expect(
    page.getByText("LSP didOpen failed for diagnostics.ts"),
  ).toBeVisible();
  await expect(page.getByText("No matching problems")).toHaveCount(0);
});

test("preload waits for runtime listeners before backend diagnostics publish", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          if (property === "LSPPreloadProjectDiagnostics") {
            return async () => {
              const emit = (
                window as typeof window & {
                  __emitRuntimeEvent?: (
                    eventName: string,
                    payload: unknown,
                  ) => void;
                }
              ).__emitRuntimeEvent;
              if (typeof emit !== "function") {
                throw new Error("runtime event emitter unavailable");
              }

              emit("lsp:ready", {
                generation: 5,
                projectPath: "/projects/race",
              });
              emit("lsp:diagnostics:preload:start", {
                generation: 5,
                projectPath: "/projects/race",
              });
              emit("lsp:diagnostics", {
                generation: 5,
                projectPath: "/projects/race",
                filePath: "/projects/race/src/main.go",
                language: "go",
                items: [
                  {
                    range: {
                      start: { line: 0, character: 0 },
                      end: { line: 0, character: 4 },
                    },
                    severity: 1,
                    message: "race diagnostic",
                  },
                ],
              });
              emit("lsp:diagnostics:preload:complete", {
                generation: 5,
                projectPath: "/projects/race",
              });
              return true;
            };
          }

          return async () => null;
        },
      },
    );
    const goBridge = { main: { App: appBridge } };

    Object.defineProperty(window, "go", {
      configurable: true,
      get: () => goBridge,
      set: () => undefined,
    });
    Object.defineProperty(window, "runtime", {
      configurable: true,
      get: () => undefined,
      set: () => undefined,
    });
  });

  await page.reload();

  const result = await page.evaluate(async () => {
    const diagnostics = await import("/src/stores/diagnosticsStore.ts");
    const projectState = await import("/src/utils/projectBoundState.ts");
    const runtime = await import("/src/wails/runtime.ts");

    (
      window as typeof window & {
        __emitRuntimeEvent?: (eventName: string, payload: unknown) => void;
      }
    ).__emitRuntimeEvent = runtime.EventsEmit;

    projectState.resetProjectBoundStores();
    projectState.activateProjectScope("/projects/race");

    const preloadResult =
      await projectState.preloadProjectDiagnostics("/projects/race");
    const state = diagnostics.useDiagnosticsStore.getState() as {
      byFile: Map<string, { summary: { total: number } }>;
      activeProjectPath?: string | null;
      currentGeneration?: number;
    };

    return {
      preloadResult,
      activeProjectPath: state.activeProjectPath ?? null,
      currentGeneration: state.currentGeneration ?? 0,
      files: Array.from(state.byFile.keys()),
      totals: Array.from(state.byFile.values()).map(
        (group) => group.summary.total,
      ),
      preload: projectState.getProjectDiagnosticsPreloadSnapshot(),
    };
  });

  expect(result.preloadResult).toBe(true);
  expect(result.activeProjectPath).toBe("/projects/race");
  expect(result.currentGeneration).toBe(5);
  expect(result.files).toEqual(["/projects/race/src/main.go"]);
  expect(result.totals).toEqual([1]);
  expect(result.preload).toEqual({
    active: false,
    bounded: false,
    generation: 5,
    projectPath: "/projects/race",
    selectedCandidates: 0,
    selectedLanguages: 0,
    totalCandidates: 0,
    totalLanguages: 0,
  });
});
