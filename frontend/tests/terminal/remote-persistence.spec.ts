import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const remoteCalls: Array<{ id: string; text: string }> = [];
    const terminalCreateCalls: Array<{
      method: string;
      id: string;
      name: string;
      projectPath?: string;
    }> = [];

    const appBridge = new Proxy(
      {},
      {
        get: (_target, property: string) => {
          return async (...args: unknown[]) => {
            switch (property) {
              case "CreateTerminal": {
                const [id, name] = args as [string, string];
                terminalCreateCalls.push({
                  method: "CreateTerminal",
                  id,
                  name,
                });
                return true;
              }
              case "CreateTerminalForProject": {
                const [id, name, projectPath] = args as [
                  string,
                  string,
                  string,
                ];
                terminalCreateCalls.push({
                  method: "CreateTerminalForProject",
                  id,
                  name,
                  projectPath,
                });
                return true;
              }
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
      __terminalCreateCalls: terminalCreateCalls,
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

    const hasReopenAction =
      typeof terminalStore.reopenLastClosedTab === "function";
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

test("terminal store keeps visible tabs scoped to the active project", async ({
  page,
}) => {
  await page.goto("/");

  const scopedState = await page.evaluate(async () => {
    const module = await import(
      `/src/stores/terminalStore.ts?project-scope=${Date.now()}`
    );
    const terminalStore = module.useTerminalStore.getState() as unknown as {
      initialize: () => void;
      setActiveProject?: (projectPath: string | null) => void;
      createTerminal: (
        paneId: string,
        isDark: boolean,
        terminalName?: string,
      ) => Promise<string>;
      closeTerminal: (paneId: string, tabId: string) => Promise<void>;
      panes: Array<{ id: string; tabIds: string[]; activeTabId: string }>;
      sessions: Map<string, { id: string; projectPath: string }>;
    };

    terminalStore.initialize();

    if (typeof terminalStore.setActiveProject !== "function") {
      return {
        hasSetActiveProject: false,
      };
    }

    terminalStore.setActiveProject("/workspace/rails");
    const railsTerminalId = await terminalStore.createTerminal(
      "pane-1",
      false,
      "rails",
    );

    terminalStore.setActiveProject("/workspace/django");
    const djangoTerminalId = await terminalStore.createTerminal(
      "pane-1",
      false,
      "django",
    );

    terminalStore.setActiveProject("/workspace/rails");
    const railsPane = module.useTerminalStore
      .getState()
      .panes.find((pane) => pane.id === "pane-1");
    const railsSessionProjectPath = module.useTerminalStore
      .getState()
      .sessions.get(railsTerminalId)?.projectPath;

    terminalStore.setActiveProject("/workspace/django");
    const djangoPane = module.useTerminalStore
      .getState()
      .panes.find((pane) => pane.id === "pane-1");
    const djangoSessionProjectPath = module.useTerminalStore
      .getState()
      .sessions.get(djangoTerminalId)?.projectPath;

    terminalStore.setActiveProject("/workspace/rails");
    await terminalStore.closeTerminal("pane-1", railsTerminalId);
    terminalStore.setActiveProject("/workspace/django");
    await terminalStore.closeTerminal("pane-1", djangoTerminalId);

    return {
      hasSetActiveProject: true,
      railsVisibleTabs: railsPane?.tabIds ?? [],
      djangoVisibleTabs: djangoPane?.tabIds ?? [],
      railsSessionProjectPath: railsSessionProjectPath ?? "",
      djangoSessionProjectPath: djangoSessionProjectPath ?? "",
    };
  });

  expect(scopedState.hasSetActiveProject).toBe(true);
  expect(scopedState.railsVisibleTabs).toHaveLength(1);
  expect(scopedState.djangoVisibleTabs).toHaveLength(1);
  expect(scopedState.railsVisibleTabs).not.toEqual(
    scopedState.djangoVisibleTabs,
  );
  expect(scopedState.railsSessionProjectPath).toBe("/workspace/rails");
  expect(scopedState.djangoSessionProjectPath).toBe("/workspace/django");
});

test("terminal store creates sessions against the active project path immediately after switch", async ({
  page,
}) => {
  await page.goto("/");

  const createState = await page.evaluate(async () => {
    const module = await import(
      `/src/stores/terminalStore.ts?project-create=${Date.now()}`
    );
    const terminalStore = module.useTerminalStore.getState() as unknown as {
      initialize: () => void;
      setActiveProject: (projectPath: string | null) => void;
      createTerminal: (
        paneId: string,
        isDark: boolean,
        terminalName?: string,
      ) => Promise<string>;
      closeTerminal: (paneId: string, tabId: string) => Promise<void>;
    };

    terminalStore.initialize();
    terminalStore.setActiveProject("/workspace/current-project");
    const terminalId = await terminalStore.createTerminal(
      "pane-1",
      false,
      "project-shell",
    );
    await terminalStore.closeTerminal("pane-1", terminalId);

    return {
      calls: (
        window as unknown as {
          __terminalCreateCalls: Array<{
            method: string;
            id: string;
            name: string;
            projectPath?: string;
          }>;
        }
      ).__terminalCreateCalls,
    };
  });

  expect(createState.calls).toHaveLength(1);
  expect(createState.calls[0]).toMatchObject({
    method: "CreateTerminalForProject",
    name: "project-shell",
    projectPath: "/workspace/current-project",
  });
});

test("project switch rebinds the visible terminal session cwd to the active project", async ({
  page,
}) => {
  await page.goto("/");

  const syncedState = await page.evaluate(async () => {
    const remoteCalls = (
      window as unknown as {
        __terminalRemoteCalls: Array<{ id: string; text: string }>;
      }
    ).__terminalRemoteCalls;
    remoteCalls.length = 0;

    const module = await import(
      `/src/stores/terminalStore.ts?cwd-sync=${Date.now()}`
    );
    const terminalStore = module.useTerminalStore.getState() as unknown as {
      initialize: () => void;
      setActiveProject: (projectPath: string | null) => void;
      createTerminal: (
        paneId: string,
        isDark: boolean,
        terminalName?: string,
      ) => Promise<string>;
      closeTerminal: (paneId: string, tabId: string) => Promise<void>;
      setShellEvent: (event: {
        id: string;
        type?: string;
        cwd?: string;
        raw?: string;
      }) => void;
    };

    terminalStore.initialize();

    terminalStore.setActiveProject("/workspace/rails");
    const railsTerminalId = await terminalStore.createTerminal("pane-1", false);
    terminalStore.setShellEvent({
      id: railsTerminalId,
      type: "cwd",
      cwd: "/workspace/rails",
    });

    terminalStore.setActiveProject("/workspace/django");
    const djangoTerminalId = await terminalStore.createTerminal(
      "pane-1",
      false,
    );
    terminalStore.setShellEvent({
      id: djangoTerminalId,
      type: "cwd",
      cwd: "/tmp/old-django",
    });

    remoteCalls.length = 0;
    terminalStore.setActiveProject("/workspace/django");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const shellState = module.useTerminalStore
      .getState()
      .sessionShellState.get(djangoTerminalId);

    await terminalStore.closeTerminal("pane-1", djangoTerminalId);
    terminalStore.setActiveProject("/workspace/rails");
    await terminalStore.closeTerminal("pane-1", railsTerminalId);

    return {
      djangoTerminalId,
      remoteCalls: [...remoteCalls],
      shellCwd: shellState?.cwd ?? "",
    };
  });

  expect(syncedState.remoteCalls).toContainEqual({
    id: syncedState.djangoTerminalId,
    text: "cd '/workspace/django'\n",
  });
  expect(syncedState.shellCwd).toBe("/workspace/django");
});
