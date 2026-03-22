import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async () => {
            switch (property) {
              case "CreateTerminal":
              case "WriteTerminal":
              case "ResizeTerminal":
              case "CloseTerminal":
                return true;
              default:
                return null;
            }
          };
        },
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
});

test("terminal store tracks shell and semantic events", async ({ page }) => {
  await page.goto("/");

  const semanticState = await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();

    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal("pane-1", false);

    terminalStore.setShellEvent({
      id: terminalId,
      type: "cwd",
      cwd: "/tmp/semantic-test",
    });
    terminalStore.setSemanticEvent({
      id: terminalId,
      kind: "file_ref",
      path: "src/main.go",
      line: 42,
      column: 7,
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 50);
    });

    const shellState = useTerminalStore
      .getState()
      .sessionShellState.get(terminalId);
    const semanticEntries = useTerminalStore
      .getState()
      .sessionSemanticEntries.get(terminalId);

    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      cwd: shellState?.cwd ?? "",
      entries: semanticEntries ?? [],
    };
  });

  expect(semanticState.cwd).toBe("/tmp/semantic-test");
  expect(semanticState.entries.length).toBeGreaterThan(0);
  expect(semanticState.entries[0].kind).toBe("file_ref");
  expect(semanticState.entries[0].path).toBe("/tmp/semantic-test/src/main.go");
  expect(semanticState.entries[0].line).toBe(42);
});

test("terminal store parses image semantic payload", async ({ page }) => {
  await page.goto("/");

  const imageState = await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();

    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal("pane-1", false);
    const payload = "1337;File=inline=1:name=screenshot.png:aGVsbG8=";

    terminalStore.setSemanticEvent({
      id: terminalId,
      kind: "image_ref",
      message: payload,
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 50);
    });

    const semanticEntries = useTerminalStore
      .getState()
      .sessionSemanticEntries.get(terminalId);

    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      entries: semanticEntries ?? [],
    };
  });

  expect(imageState.entries.length).toBe(1);
  expect(imageState.entries[0].kind).toBe("image_ref");
  expect(imageState.entries[0].imageDataUrl).toBe(
    "data:image/png;base64,aGVsbG8=",
  );
});

test("terminal store deduplicates repeated semantic events", async ({
  page,
}) => {
  await page.goto("/");

  const dedupeState = await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();

    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal("pane-1", false);
    terminalStore.setShellEvent({
      id: terminalId,
      type: "cwd",
      cwd: "/tmp/semantic-test",
    });

    terminalStore.setSemanticEvent({
      id: terminalId,
      kind: "file_ref",
      path: "src/dup.go",
      line: 10,
      column: 1,
      severity: "error",
      message: "duplicate",
    });
    terminalStore.setSemanticEvent({
      id: terminalId,
      kind: "file_ref",
      path: "src/dup.go",
      line: 10,
      column: 1,
      severity: "error",
      message: "duplicate",
    });
    terminalStore.setSemanticEvent({
      id: terminalId,
      kind: "file_ref",
      path: "src/dup.go",
      line: 10,
      column: 1,
      severity: "error",
      message: "duplicate",
    });

    const immediateEntries = useTerminalStore
      .getState()
      .sessionSemanticEntries.get(terminalId);

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 50);
    });

    const semanticEntries = useTerminalStore
      .getState()
      .sessionSemanticEntries.get(terminalId);

    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      immediateEntries: immediateEntries ?? [],
      entries: semanticEntries ?? [],
    };
  });

  expect(dedupeState.immediateEntries.length).toBe(0);
  expect(dedupeState.entries.length).toBe(1);
});

test("preview bridge remembers last target without auto-open", async ({
  page,
}) => {
  await page.goto("/");

  const previewState = await page.evaluate(async () => {
    const { openTerminalPreviewSignal } =
      await import("/src/hooks/useBrowserPreviewBridge.ts");
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
    const { useBrowserPreviewStore } =
      await import("/src/stores/browserPreviewStore.ts");
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

    useExplorerStore.getState().setProjectPath("/tmp/browser-preview-project");
    useBrowserPreviewStore.getState().setAutoOpenFromTerminal(false);
    usePreviewWindowStore.getState().closeAllWindows();

    const terminalStore = useTerminalStore.getState();
    const browserPreviewStore = useBrowserPreviewStore.getState();
    const previewWindowStore = usePreviewWindowStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal("pane-1", false);

    openTerminalPreviewSignal({
      sessionId: terminalId,
      url: "http://localhost:3000",
      projectPath: "/tmp/browser-preview-project",
      autoOpenFromTerminal: browserPreviewStore.autoOpenFromTerminal,
      reuseWindowPerSession: browserPreviewStore.reuseWindowPerSession,
      allowedOrigins: browserPreviewStore.allowedOrigins,
      rememberProjectTarget: browserPreviewStore.rememberProjectTarget,
      openPreviewWindow: previewWindowStore.openWindow,
      focusPreviewWindow: previewWindowStore.focusWindow,
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 50);
    });

    const lastKnownTarget = useBrowserPreviewStore
      .getState()
      .getLastKnownTarget("/tmp/browser-preview-project");
    const windows = usePreviewWindowStore.getState().windows;

    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      lastKnownTarget,
      windowsCount: windows.length,
    };
  });

  expect(previewState.lastKnownTarget?.url).toBe("http://localhost:3000");
  expect(previewState.windowsCount).toBe(0);
});

test("preview bridge auto-opens and reuses window per terminal session", async ({
  page,
}) => {
  await page.goto("/");

  const previewState = await page.evaluate(async () => {
    const { openTerminalPreviewSignal } =
      await import("/src/hooks/useBrowserPreviewBridge.ts");
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const { useExplorerStore } = await import("/src/stores/explorerStore.ts");
    const { useBrowserPreviewStore } =
      await import("/src/stores/browserPreviewStore.ts");
    const { usePreviewWindowStore } =
      await import("/src/stores/previewWindowStore.ts");

    useExplorerStore.getState().setProjectPath("/tmp/browser-preview-project");
    useBrowserPreviewStore.getState().setAutoOpenFromTerminal(true);
    useBrowserPreviewStore.getState().setReuseWindowPerSession(true);
    usePreviewWindowStore.getState().closeAllWindows();

    const terminalStore = useTerminalStore.getState();
    const browserPreviewStore = useBrowserPreviewStore.getState();
    const previewWindowStore = usePreviewWindowStore.getState();
    terminalStore.initialize();
    const terminalId = await terminalStore.createTerminal("pane-1", false);

    openTerminalPreviewSignal({
      sessionId: terminalId,
      url: "http://localhost:3000",
      projectPath: "/tmp/browser-preview-project",
      autoOpenFromTerminal: browserPreviewStore.autoOpenFromTerminal,
      reuseWindowPerSession: browserPreviewStore.reuseWindowPerSession,
      allowedOrigins: browserPreviewStore.allowedOrigins,
      rememberProjectTarget: browserPreviewStore.rememberProjectTarget,
      openPreviewWindow: previewWindowStore.openWindow,
      focusPreviewWindow: previewWindowStore.focusWindow,
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 50);
    });

    openTerminalPreviewSignal({
      sessionId: terminalId,
      url: "http://localhost:3001",
      projectPath: "/tmp/browser-preview-project",
      autoOpenFromTerminal: browserPreviewStore.autoOpenFromTerminal,
      reuseWindowPerSession: browserPreviewStore.reuseWindowPerSession,
      allowedOrigins: browserPreviewStore.allowedOrigins,
      rememberProjectTarget: browserPreviewStore.rememberProjectTarget,
      openPreviewWindow: previewWindowStore.openWindow,
      focusPreviewWindow: previewWindowStore.focusWindow,
    });

    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 50);
    });

    const previewStore = usePreviewWindowStore.getState();
    const browserWindows = previewStore.windows.filter(
      (windowState) => windowState.surface === "browser",
    );
    const lastKnownTarget = useBrowserPreviewStore
      .getState()
      .getLastKnownTarget("/tmp/browser-preview-project");

    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      browserWindows,
      lastKnownTarget,
      expectedWindowId: `terminal-preview:${terminalId}`,
    };
  });

  expect(previewState.browserWindows).toHaveLength(1);
  expect(previewState.browserWindows[0].id).toBe(previewState.expectedWindowId);
  expect(previewState.browserWindows[0].payload.url).toBe(
    "http://localhost:3001",
  );
  expect(previewState.lastKnownTarget?.url).toBe("http://localhost:3001");
});
