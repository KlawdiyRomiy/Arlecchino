import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const remoteCalls: Array<{ id: string; text: string }> = [];

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            switch (property) {
              case "CreateTerminal":
              case "WriteTerminal":
              case "ResizeTerminal":
              case "CloseTerminal":
                return true;
              case "ListTerminalSessions":
                return ["remote-1", "remote-2"];
              case "SendTerminalText": {
                const [id, text] = args as [string, string];
                remoteCalls.push({ id, text });
                return true;
              }
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
      __terminalRemoteCalls: remoteCalls,
      go: { main: { App: appBridge } },
      runtime: runtimeBridge,
    });
  });
});

test("terminal store exposes remote control actions", async ({ page }) => {
  await page.goto("/");

  const remoteState = await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState();

    const sessions = await terminalStore.listRemoteSessions();
    await terminalStore.sendRemoteText("remote-1", "pwd\n");

    return {
      sessions,
      calls: (window as unknown as { __terminalRemoteCalls: unknown[] })
        .__terminalRemoteCalls,
    };
  });

  expect(remoteState.sessions).toEqual(["remote-1", "remote-2"]);
  expect(remoteState.calls.length).toBe(1);
  expect(remoteState.calls[0]).toEqual({ id: "remote-1", text: "pwd\n" });
});

test("terminal store restores pane layout snapshot from localStorage", async ({
  page,
}) => {
  await page.goto("/");

  const layoutState = await page.evaluate(async () => {
    const snapshot = {
      paneIds: ["pane-1", "pane-secondary"],
      activePaneId: "pane-secondary",
      splitDirection: "vertical",
      version: 1,
    };

    localStorage.setItem("terminal.layout.v1", JSON.stringify(snapshot));

    const module = await import(
      `/src/stores/terminalStore.ts?layout=${Date.now()}`
    );
    const terminalState = module.useTerminalStore.getState();

    return {
      panes: terminalState.panes.map((pane: { id: string }) => pane.id),
      activePaneId: terminalState.activePaneId,
      splitDirection: terminalState.splitDirection,
    };
  });

  expect(layoutState.panes).toEqual(["pane-1", "pane-secondary"]);
  expect(layoutState.activePaneId).toBe("pane-secondary");
  expect(layoutState.splitDirection).toBe("vertical");
});

test("terminal store persists layout after closing secondary pane", async ({
  page,
}) => {
  await page.goto("/");

  const persistedLayout = await page.evaluate(async () => {
    const snapshot = {
      paneIds: ["pane-1", "pane-secondary"],
      activePaneId: "pane-secondary",
      splitDirection: "vertical",
      version: 1,
    };
    localStorage.setItem("terminal.layout.v1", JSON.stringify(snapshot));

    const module = await import(
      `/src/stores/terminalStore.ts?persist-close=${Date.now()}`
    );
    const terminalStore = module.useTerminalStore.getState();
    terminalStore.initialize();

    const primaryTerminalId = await terminalStore.createTerminal(
      "pane-1",
      false,
    );
    const secondaryTerminalId = await terminalStore.createTerminal(
      "pane-secondary",
      false,
    );
    terminalStore.setActivePane("pane-secondary");

    await terminalStore.closeTerminal("pane-secondary", secondaryTerminalId);
    await terminalStore.closeTerminal("pane-1", primaryTerminalId);

    const rawSnapshot = localStorage.getItem("terminal.layout.v1");
    return rawSnapshot ? JSON.parse(rawSnapshot) : null;
  });

  expect(persistedLayout).not.toBeNull();
  expect(persistedLayout.paneIds).toEqual(["pane-1"]);
  expect(persistedLayout.activePaneId).toBe("pane-1");
  expect(persistedLayout.splitDirection).toBeNull();
});

test("terminal store reopens last closed terminal tab", async ({ page }) => {
  await page.goto("/");

  const reopenedState = await page.evaluate(async () => {
    const { useTerminalStore } = await import("/src/stores/terminalStore.ts");
    const terminalStore = useTerminalStore.getState() as unknown as {
      initialize: () => void;
      createTerminal: (paneId: string, isDark: boolean) => Promise<string>;
      closeTerminal: (paneId: string, tabId: string) => Promise<void>;
      reopenLastClosedTab?: (isDark: boolean) => Promise<string | null>;
      panes: Array<{ id: string; tabIds: string[]; activeTabId: string }>;
    };

    terminalStore.initialize();
    const createdTabId = await terminalStore.createTerminal("pane-1", false);
    await terminalStore.closeTerminal("pane-1", createdTabId);

    const hasReopenAction = typeof terminalStore.reopenLastClosedTab === "function";
    const reopenedId = hasReopenAction
      ? await terminalStore.reopenLastClosedTab?.(false)
      : null;

    const activePane = useTerminalStore
      .getState()
      .panes.find((pane) => pane.id === "pane-1");

    if (activePane?.activeTabId) {
      await terminalStore.closeTerminal("pane-1", activePane.activeTabId);
    }

    return {
      hasReopenAction,
      reopenedId: reopenedId ?? "",
      activeTabId: activePane?.activeTabId ?? "",
      tabCount: activePane?.tabIds.length ?? 0,
    };
  });

  expect(reopenedState.hasReopenAction).toBe(true);
  expect(reopenedState.reopenedId).not.toBe("");
  expect(reopenedState.activeTabId).toBe(reopenedState.reopenedId);
  expect(reopenedState.tabCount).toBe(1);
});
