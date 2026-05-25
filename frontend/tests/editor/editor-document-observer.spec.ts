import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            calls.push({ method: property, args });
            return true;
          };
        },
      },
    );

    Object.assign(window, {
      __editorDocumentObserverCalls: calls,
      _wails: { environment: { OS: "darwin" } },
      go: { main: { App: appBridge } },
      runtime: {
        EventsOn: () => () => undefined,
        EventsOff: () => undefined,
      },
    });
  });
});

test("editor document observer refcounts duplicate surfaces and publishes monotonic changes", async ({
  page,
}) => {
  await page.goto("/");

  const calls = await page.evaluate(async () => {
    const observer = await import("/src/stores/editorDocumentObserver.ts");
    observer.resetEditorDocumentObserverForTests();
    const editorSurface = observer.createEditorDocumentSurfaceId("editor");
    const panelSurface = observer.createEditorDocumentSurfaceId("panel");

    observer.openEditorDocument({
      surfaceId: editorSurface,
      path: "/workspace/src/main.ts",
      language: "typescript",
      content: "export const value = 1;\n",
    });
    observer.openEditorDocument({
      surfaceId: panelSurface,
      path: "/workspace/src/main.ts",
      language: "typescript",
      content: "export const value = 1;\n",
    });
    observer.notifyEditorDocumentChanged({
      surfaceId: editorSurface,
      path: "/workspace/src/main.ts",
      language: "typescript",
      content: "export const value = 2;\n",
      delayMs: 0,
    });
    observer.notifyEditorDocumentChanged({
      surfaceId: panelSurface,
      path: "/workspace/src/main.ts",
      language: "typescript",
      content: "export const value = 3;\n",
      delayMs: 0,
    });
    observer.closeEditorDocument(editorSurface);
    observer.closeEditorDocument(panelSurface);

    return (
      window as unknown as {
        __editorDocumentObserverCalls: Array<{
          method: string;
          args: unknown[];
        }>;
      }
    ).__editorDocumentObserverCalls;
  });

  expect(
    calls.filter((call) => call.method === "NotifyFileOpened"),
  ).toHaveLength(1);
  expect(
    calls
      .filter((call) => call.method === "NotifyFileChanged")
      .map((call) => call.args[2]),
  ).toEqual([2, 3]);
  expect(
    calls.filter((call) => call.method === "NotifyFileClosed"),
  ).toHaveLength(1);
});

test("editor document observer folds macOS case aliases and keeps language identities distinct", async ({
  page,
}) => {
  await page.goto("/");

  const calls = await page.evaluate(async () => {
    const observer = await import("/src/stores/editorDocumentObserver.ts");
    observer.resetEditorDocumentObserverForTests();

    const upperSurface = observer.createEditorDocumentSurfaceId("editor");
    const lowerSurface = observer.createEditorDocumentSurfaceId("editor");
    const languageSurface = observer.createEditorDocumentSurfaceId("editor");

    observer.openEditorDocument({
      surfaceId: upperSurface,
      path: "/workspace/Foo.ts",
      language: "typescript",
      content: "export const upper = 1;\n",
    });
    observer.openEditorDocument({
      surfaceId: lowerSurface,
      path: "/workspace/foo.ts",
      language: "typescript",
      content: "export const lower = 1;\n",
    });
    observer.openEditorDocument({
      surfaceId: languageSurface,
      path: "/workspace/Foo.ts",
      language: "javascript",
      content: "export const js = 1;\n",
    });
    observer.closeEditorDocument(upperSurface);
    observer.closeEditorDocument(lowerSurface);
    observer.closeEditorDocument(languageSurface);

    return (
      window as unknown as {
        __editorDocumentObserverCalls: Array<{
          method: string;
          args: unknown[];
        }>;
      }
    ).__editorDocumentObserverCalls;
  });

  expect(
    calls
      .filter((call) => call.method === "NotifyFileOpened")
      .map((call) => call.args.slice(0, 2)),
  ).toEqual([
    ["/workspace/Foo.ts", "typescript"],
    ["/workspace/Foo.ts", "javascript"],
  ]);
  expect(
    calls
      .filter((call) => call.method === "NotifyFileClosed")
      .map((call) => call.args.slice(0, 2)),
  ).toEqual([
    ["/workspace/Foo.ts", "typescript"],
    ["/workspace/Foo.ts", "javascript"],
  ]);
});

test("editor document observer flushes pending changes before close", async ({
  page,
}) => {
  await page.goto("/");

  const calls = await page.evaluate(async () => {
    const observer = await import("/src/stores/editorDocumentObserver.ts");
    observer.resetEditorDocumentObserverForTests();
    const surface = observer.createEditorDocumentSurfaceId("editor");

    observer.openEditorDocument({
      surfaceId: surface,
      path: "/workspace/src/main.ts",
      language: "typescript",
      content: "export const value = 1;\n",
    });
    observer.notifyEditorDocumentChanged({
      surfaceId: surface,
      path: "/workspace/src/main.ts",
      language: "typescript",
      content: "export const value = 2;\n",
      delayMs: 10000,
    });
    observer.closeEditorDocument(surface);

    return (
      window as unknown as {
        __editorDocumentObserverCalls: Array<{
          method: string;
          args: unknown[];
        }>;
      }
    ).__editorDocumentObserverCalls;
  });

  const lifecycleCalls = calls.filter((call) =>
    [
      "NotifyFileOpened",
      "RecordFileAccess",
      "NotifyFileChanged",
      "NotifyFileClosed",
    ].includes(call.method),
  );

  expect(lifecycleCalls.map((call) => call.method)).toEqual([
    "NotifyFileOpened",
    "RecordFileAccess",
    "NotifyFileChanged",
    "NotifyFileClosed",
  ]);
  expect(
    lifecycleCalls.find((call) => call.method === "NotifyFileChanged")?.args,
  ).toEqual([
    "/workspace/src/main.ts",
    "typescript",
    2,
    "export const value = 2;\n",
  ]);
});

test("editor backing tabs survive main editor close and are pruned on release", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { makeEditorTabId, useEditorStore } =
      await import("/src/stores/editorStore.ts");
    useEditorStore.setState({
      tabs: new Map(),
      backingTabRefs: new Map(),
      panes: [{ id: "pane-main", tabIds: [], activeTabId: "" }],
      activePaneId: "pane-main",
      splitDirection: null,
      cursorPosition: { line: 1, col: 1 },
      statusFile: { path: null, name: null, language: null },
    });

    const path = "/workspace/src/main.ts";
    const tabId = makeEditorTabId(path);
    const store = useEditorStore.getState();
    store.retainBackingTab(
      path,
      "main.ts",
      "export const value = 1;\n",
      "typescript",
    );
    store.openTab(
      "pane-main",
      path,
      "main.ts",
      "export const value = 1;\n",
      "typescript",
    );
    store.closeTab("pane-main", tabId);
    const afterMainClose = useEditorStore.getState().tabs.has(tabId);
    useEditorStore.getState().releaseBackingTab(path);
    const afterBackingRelease = useEditorStore.getState().tabs.has(tabId);
    return { afterBackingRelease, afterMainClose };
  });

  expect(result).toEqual({
    afterBackingRelease: false,
    afterMainClose: true,
  });
});
