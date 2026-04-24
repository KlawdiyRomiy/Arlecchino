import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
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
              case "GetCurrentProjectPath":
              case "GetCurrentWorkDir":
                return "/tmp/arlecchino-test";
              case "GetCurrentProjectID":
                return 1;
              case "GetRecentProjects":
                return [];
              case "OpenProject":
                return {
                  id: 1,
                  path: "/tmp/arlecchino-test",
                  name: "arlecchino-test",
                };
              case "InspectProject":
              case "ReadDirectory":
                return { path: "/tmp/arlecchino-test", entries: [] };
              case "ValidateEnvironment":
                return {
                  php: true,
                  composer: true,
                  node: true,
                  npm: true,
                  git: true,
                };
              case "GetDevToolsStatus":
                return false;
              case "GetLSPInstallStatus":
                return {
                  phpactor: true,
                  gopls: true,
                  pyright: true,
                  tsserver: true,
                };
              case "SelectDirectory":
                return "/tmp/arlecchino-test";
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
          if (property === "ClipboardGetText") {
            return async () => "";
          }
          if (property === "WindowIsMaximised") {
            return async () => false;
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

test("terminal zoom is independent from global UI zoom state", async ({
  page,
}) => {
  await page.goto("/");

  const zoomState = await page.evaluate(async () => {
    const { useEditorSettingsStore } =
      await import("/src/stores/editorSettingsStore.ts");
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");

    const editorStore = useEditorSettingsStore.getState();
    editorStore.resetZoom();

    const terminalStore = useTerminalStore.getState();
    terminalStore.initialize();

    const terminalId = await terminalStore.createTerminal("pane-1", false);
    const session = useTerminalStore.getState().getSession(terminalId);

    const beforeZoom = session?.terminal.options.fontSize ?? -1;
    editorStore.zoomIn();
    const afterEditorZoom = session?.terminal.options.fontSize ?? -1;

    const terminalZoomApi = useTerminalStore.getState() as unknown as {
      terminalZoomIn?: () => void;
      terminalZoomOut?: () => void;
      terminalZoomReset?: () => void;
    };
    const hasTerminalZoomApi =
      typeof terminalZoomApi.terminalZoomIn === "function" &&
      typeof terminalZoomApi.terminalZoomOut === "function" &&
      typeof terminalZoomApi.terminalZoomReset === "function";

    if (hasTerminalZoomApi) {
      terminalZoomApi.terminalZoomIn?.();
    }
    const afterTerminalZoom = session?.terminal.options.fontSize ?? -1;
    editorStore.zoomOut();

    const {
      editorFontSize: editorFontAfterZoomCycle,
      uiScale: uiScaleAfterZoomCycle,
    } = useEditorSettingsStore.getState();

    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      hasTerminalZoomApi,
      beforeZoom,
      afterEditorZoom,
      afterTerminalZoom,
      editorFontAfterZoomCycle,
      uiScaleAfterZoomCycle,
    };
  });

  expect(zoomState.hasTerminalZoomApi).toBe(true);
  expect(zoomState.beforeZoom).toBeGreaterThan(0);
  expect(zoomState.afterEditorZoom).toBe(zoomState.beforeZoom);
  expect(zoomState.afterTerminalZoom).toBeGreaterThan(zoomState.beforeZoom);
  expect(zoomState.editorFontAfterZoomCycle).toBe(14);
  expect(zoomState.uiScaleAfterZoomCycle).toBe(1);
});
