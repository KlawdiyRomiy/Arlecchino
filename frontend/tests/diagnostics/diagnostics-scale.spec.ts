import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

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
              return `${eventName}-${handlers.length}`;
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
              return `${eventName}-${handlers.length}`;
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
        get: () => async () => null,
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
