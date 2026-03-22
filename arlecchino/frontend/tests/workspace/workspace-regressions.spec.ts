import { expect, test } from "@playwright/test";

async function readSource(
  page: Parameters<typeof test>[0]["page"],
  path: string,
) {
  return page.evaluate(async (targetPath) => {
    const response = await fetch(`${targetPath}?raw`);
    if (!response.ok) {
      return "";
    }

    return response.text();
  }, path);
}

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
          if (property === "EventsOff") {
            return () => undefined;
          }

          return () => undefined;
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

test("workspace store stages project switch until backend confirms it", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const workspace = await import("/src/stores/workspaceStore.ts");
    const store = workspace.useWorkspaceStore;

    store.setState({
      projects: [
        { id: "/alpha", path: "/alpha", name: "alpha", openedAt: 1 },
        { id: "/beta", path: "/beta", name: "beta", openedAt: 2 },
      ],
      activeId: "/alpha",
      switchDirection: 1,
      ready: true,
      pendingId: null,
      uiBlockers: [],
    });

    const state = store.getState() as {
      activeId: string | null;
      pendingId?: string | null;
      switchDirection: number;
      beginProjectSwitch?: (id: string, direction?: number) => void;
      confirmProjectSwitch?: (id: string) => void;
      cancelProjectSwitch?: (id?: string) => void;
    };

    if (
      typeof state.beginProjectSwitch !== "function" ||
      typeof state.confirmProjectSwitch !== "function" ||
      typeof state.cancelProjectSwitch !== "function"
    ) {
      return {
        hasBegin: typeof state.beginProjectSwitch === "function",
        hasConfirm: typeof state.confirmProjectSwitch === "function",
        hasCancel: typeof state.cancelProjectSwitch === "function",
      };
    }

    const beforeActiveId = state.activeId;
    state.beginProjectSwitch("/beta", -1);

    const staged = store.getState() as {
      activeId: string | null;
      pendingId: string | null;
      switchDirection: number;
      confirmProjectSwitch: (id: string) => void;
      cancelProjectSwitch: (id?: string) => void;
    };

    staged.confirmProjectSwitch("/beta");

    const confirmed = store.getState() as {
      activeId: string | null;
      pendingId: string | null;
    };

    staged.cancelProjectSwitch("/beta");

    return {
      hasBegin: true,
      hasConfirm: true,
      hasCancel: true,
      beforeActiveId,
      stagedActiveId: staged.activeId,
      stagedPendingId: staged.pendingId,
      stagedDirection: staged.switchDirection,
      confirmedActiveId: confirmed.activeId,
      confirmedPendingId: confirmed.pendingId,
    };
  });

  expect(result.hasBegin).toBe(true);
  expect(result.hasConfirm).toBe(true);
  expect(result.hasCancel).toBe(true);
  expect(result.beforeActiveId).toBe("/alpha");
  expect(result.stagedActiveId).toBe("/alpha");
  expect(result.stagedPendingId).toBe("/beta");
  expect(result.stagedDirection).toBe(-1);
  expect(result.confirmedActiveId).toBe("/beta");
  expect(result.confirmedPendingId).toBeNull();
});

test("project switch blockers are keyed store state, not a module-global counter", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const workspace = await import("/src/stores/workspaceStore.ts");
    const priority = await import("/src/utils/priorityUI.ts");

    workspace.useWorkspaceStore.setState({
      projects: [],
      activeId: null,
      switchDirection: 1,
      ready: true,
      pendingId: null,
      uiBlockers: [],
    });

    priority.blockProjectSwitch("search");
    priority.blockProjectSwitch("modal");
    priority.blockProjectSwitch("search");

    const afterBlock = workspace.useWorkspaceStore.getState() as {
      uiBlockers?: string[];
    };

    priority.unblockProjectSwitch("search");

    const afterUnblock = workspace.useWorkspaceStore.getState() as {
      uiBlockers?: string[];
    };

    return {
      blockersAfterBlock: afterBlock.uiBlockers ?? null,
      blockersAfterUnblock: afterUnblock.uiBlockers ?? null,
      blockedAfterBlock: priority.isProjectSwitchBlocked(),
      blockedAfterUnblock: priority.isProjectSwitchBlocked(),
    };
  });

  expect(result.blockersAfterBlock).toEqual(["search", "modal"]);
  expect(result.blockersAfterUnblock).toEqual(["modal"]);
  expect(result.blockedAfterBlock).toBe(true);
  expect(result.blockedAfterUnblock).toBe(true);
});

test("workspace restore and indexing progress are no longer driven by useEffect", async ({
  page,
}) => {
  const [appSource, indexingSource, collapseSource, layoutSource] =
    await Promise.all([
      readSource(page, "/src/App.tsx"),
      readSource(page, "/src/hooks/useIndexingProgress.ts"),
      readSource(page, "/src/hooks/useCollapseTimer.ts"),
      readSource(page, "/src/components/layout/MainLayout.tsx"),
    ]);

  expect(appSource).not.toMatch(/\buseEffect\b/);
  expect(indexingSource).not.toMatch(/\buseEffect\b/);
  expect(collapseSource).not.toMatch(/\buseEffect\b/);
  expect(layoutSource).not.toMatch(
    /useWorkspaceStore\.setState\(\{\s*switchDirection:/,
  );
});

test("add project menu does not wire New Project to Open Project", async ({
  page,
}) => {
  const source = await readSource(
    page,
    "/src/components/layout/AddProjectMenu.tsx",
  );
  const openHandlerUsages =
    source.match(/onSelect=\{handleOpenProject\}/g) ?? [];

  expect(openHandlerUsages).toHaveLength(1);
});
