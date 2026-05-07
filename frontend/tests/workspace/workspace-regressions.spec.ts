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

test("workspace store promotes switch for animation and completes it after backend work", async ({
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
      switchSourceId?: string | null;
      switchDirection: number;
      beginProjectSwitch?: (id: string, direction?: number) => void;
      confirmProjectSwitch?: (id: string) => void;
      completeProjectSwitch?: (id: string) => void;
      cancelProjectSwitch?: (id?: string) => void;
    };

    if (
      typeof state.beginProjectSwitch !== "function" ||
      typeof state.confirmProjectSwitch !== "function" ||
      typeof state.completeProjectSwitch !== "function" ||
      typeof state.cancelProjectSwitch !== "function"
    ) {
      return {
        hasBegin: typeof state.beginProjectSwitch === "function",
        hasConfirm: typeof state.confirmProjectSwitch === "function",
        hasComplete: typeof state.completeProjectSwitch === "function",
        hasCancel: typeof state.cancelProjectSwitch === "function",
      };
    }

    const beforeActiveId = state.activeId;
    state.beginProjectSwitch("/beta", -1);

    const staged = store.getState() as {
      activeId: string | null;
      pendingId: string | null;
      switchSourceId: string | null;
      switchDirection: number;
      confirmProjectSwitch: (id: string) => void;
      completeProjectSwitch: (id: string) => void;
      cancelProjectSwitch: (id?: string) => void;
    };

    staged.confirmProjectSwitch("/beta");

    const confirmed = store.getState() as {
      activeId: string | null;
      pendingId: string | null;
      switchSourceId: string | null;
    };

    const diagnosticsDuringSwitch = workspace.resolveDiagnosticsProjectPath(
      store.getState().projects,
      confirmed.activeId,
      confirmed.pendingId,
      confirmed.switchSourceId,
    );

    staged.completeProjectSwitch("/beta");

    const completed = store.getState() as {
      activeId: string | null;
      pendingId: string | null;
      switchSourceId: string | null;
    };

    const diagnosticsAfterComplete = workspace.resolveDiagnosticsProjectPath(
      store.getState().projects,
      completed.activeId,
      completed.pendingId,
      completed.switchSourceId,
    );

    return {
      hasBegin: true,
      hasConfirm: true,
      hasComplete: true,
      hasCancel: true,
      beforeActiveId,
      stagedActiveId: staged.activeId,
      stagedPendingId: staged.pendingId,
      stagedSourceId: staged.switchSourceId,
      stagedDirection: staged.switchDirection,
      confirmedActiveId: confirmed.activeId,
      confirmedPendingId: confirmed.pendingId,
      confirmedSourceId: confirmed.switchSourceId,
      completedActiveId: completed.activeId,
      completedPendingId: completed.pendingId,
      completedSourceId: completed.switchSourceId,
      diagnosticsDuringSwitch,
      diagnosticsAfterComplete,
    };
  });

  expect(result.hasBegin).toBe(true);
  expect(result.hasConfirm).toBe(true);
  expect(result.hasComplete).toBe(true);
  expect(result.hasCancel).toBe(true);
  expect(result.beforeActiveId).toBe("/alpha");
  expect(result.stagedActiveId).toBe("/alpha");
  expect(result.stagedPendingId).toBe("/beta");
  expect(result.stagedSourceId).toBe("/alpha");
  expect(result.stagedDirection).toBe(-1);
  expect(result.confirmedActiveId).toBe("/beta");
  expect(result.confirmedPendingId).toBe("/beta");
  expect(result.confirmedSourceId).toBe("/alpha");
  expect(result.completedActiveId).toBe("/beta");
  expect(result.completedPendingId).toBeNull();
  expect(result.completedSourceId).toBeNull();
  expect(result.diagnosticsDuringSwitch).toBe("/alpha");
  expect(result.diagnosticsAfterComplete).toBe("/beta");
});

test("workspace store cancels promoted switch back to the previous project", async ({
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
      switchSourceId: null,
      switchDirection: 1,
      ready: true,
      pendingId: null,
      uiBlockers: [],
    });

    const state = store.getState() as {
      beginProjectSwitch: (id: string, direction?: number) => void;
      confirmProjectSwitch: (id: string) => void;
      cancelProjectSwitch: (id?: string) => void;
      activeId: string | null;
      pendingId: string | null;
      switchSourceId: string | null;
    };

    state.beginProjectSwitch("/beta", 1);
    state.confirmProjectSwitch("/beta");
    state.cancelProjectSwitch("/beta");

    return {
      activeId: store.getState().activeId,
      pendingId: store.getState().pendingId,
      switchSourceId: store.getState().switchSourceId,
    };
  });

  expect(result.activeId).toBe("/alpha");
  expect(result.pendingId).toBeNull();
  expect(result.switchSourceId).toBeNull();
});

test("workspace store stages newly opened projects for the transition path", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const workspace = await import("/src/stores/workspaceStore.ts");
    const store = workspace.useWorkspaceStore;

    store.setState({
      projects: [{ id: "/alpha", path: "/alpha", name: "alpha", openedAt: 1 }],
      activeId: "/alpha",
      switchSourceId: null,
      switchDirection: 1,
      ready: true,
      pendingId: null,
      uiBlockers: [],
    });

    const state = store.getState() as {
      beginProjectOpen: (path: string, direction?: number) => string;
      confirmProjectSwitch: (id: string) => void;
      completeProjectSwitch: (id: string) => void;
    };

    const openedId = state.beginProjectOpen("/gamma", 1);
    const staged = store.getState();
    state.confirmProjectSwitch(openedId);
    const confirmed = store.getState();
    state.completeProjectSwitch(openedId);
    const completed = store.getState();

    return {
      openedId,
      stagedActiveId: staged.activeId,
      stagedPendingId: staged.pendingId,
      stagedSourceId: staged.switchSourceId,
      stagedProjects: staged.projects.map((project) => project.id),
      confirmedActiveId: confirmed.activeId,
      confirmedPendingId: confirmed.pendingId,
      completedPendingId: completed.pendingId,
      completedSourceId: completed.switchSourceId,
    };
  });

  expect(result.openedId).toBe("/gamma");
  expect(result.stagedActiveId).toBe("/alpha");
  expect(result.stagedPendingId).toBe("/gamma");
  expect(result.stagedSourceId).toBe("/alpha");
  expect(result.stagedProjects).toEqual(["/alpha", "/gamma"]);
  expect(result.confirmedActiveId).toBe("/gamma");
  expect(result.confirmedPendingId).toBe("/gamma");
  expect(result.completedPendingId).toBeNull();
  expect(result.completedSourceId).toBeNull();
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

  expect(appSource).not.toMatch(/initializeWorkspace/);
  expect(indexingSource).not.toMatch(/\buseEffect\b/);
  expect(collapseSource).not.toMatch(/\buseEffect\b/);
  expect(layoutSource).not.toMatch(
    /useWorkspaceStore\.setState\(\{\s*switchDirection:/,
  );
});

test("app renders real project shells during project switch hydration", async ({
  page,
}) => {
  const [appSource, transitionSource] = await Promise.all([
    readSource(page, "/src/App.tsx"),
    readSource(page, "/src/components/layout/ProjectSwitchTransition.tsx"),
  ]);

  expect(appSource).not.toMatch(/ProjectSwitchPlaceholder/);
  expect(appSource).not.toMatch(/pendingId === activeId/);
  expect(appSource).not.toMatch(/project-switch-lightweight-shell/);
  expect(appSource).not.toMatch(/projectSwitchFallback/);
  expect(appSource).toMatch(/waitForProjectSwitchVisualSettle/);
  expect(transitionSource).not.toMatch(/lightweight/);
  expect(transitionSource).not.toMatch(/childrenMap\.current = \{\}/);
  expect(transitionSource).toMatch(
    /childrenMap\.current\[layoutKey\] = children/,
  );
  expect(transitionSource).toMatch(/useIndexingPhase/);
  expect(transitionSource).not.toMatch(/useIndexingProgress\(/);
});

test("project switching no longer clears terminal and TUI store state", async ({
  page,
}) => {
  const [appSource, scopeSource] = await Promise.all([
    readSource(page, "/src/App.tsx"),
    readSource(page, "/src/utils/projectBoundState.ts"),
  ]);

  expect(appSource).not.toMatch(/resetForProjectSwitch\(/);
  expect(scopeSource).not.toMatch(/useTerminalStore/);
  expect(scopeSource).not.toMatch(/resetForProjectSwitch\(/);
});

test("terminal context follows the active project instead of caching workdir on mount", async ({
  page,
}) => {
  const [panelSource, predictionSource] = await Promise.all([
    readSource(page, "/src/components/TerminalPanel.tsx"),
    readSource(page, "/src/hooks/useTerminalPrediction.ts"),
  ]);

  expect(panelSource).toMatch(/activeProjectPath = useTerminalStore/);
  expect(panelSource).not.toMatch(/GetCurrentWorkDir/);
  expect(predictionSource).toMatch(/activeProjectPath = useTerminalStore/);
  expect(predictionSource).not.toMatch(/GetCurrentWorkDir/);
});

test("workspace restore syncs terminal project scope to the restored project", async ({
  page,
}) => {
  const workspaceSource = await readSource(
    page,
    "/src/stores/workspaceStore.ts",
  );

  expect(workspaceSource).toMatch(
    /await AppFunctions\.OpenProject\(project\.path\);/,
  );
  expect(workspaceSource).toMatch(
    /useTerminalStore\.getState\(\)\.setActiveProject\(project\.path\);/,
  );
});

test("app and workspace restore explicitly sync terminal store to the active project", async ({
  page,
}) => {
  const [appSource, workspaceSource] = await Promise.all([
    readSource(page, "/src/App.tsx"),
    readSource(page, "/src/stores/workspaceStore.ts"),
  ]);

  expect(appSource).toMatch(/useTerminalStore/);
  expect(appSource).toMatch(/setActiveProject\(/);
  expect(workspaceSource).toMatch(/useTerminalStore/);
  expect(workspaceSource).toMatch(/setActiveProject\(/);
});

test("project switching starts backend open while preserving switch animation", async ({
  page,
}) => {
  const appSource = await readSource(page, "/src/App.tsx");

  const switchBeginIndex = appSource.indexOf("state.beginProjectSwitch(id");
  const switchScopeIndex = appSource.indexOf(
    "activateProjectScope(project.path);",
    switchBeginIndex,
  );
  const switchOpenIndex = appSource.indexOf(
    "const openProjectPromise = AppFunctions.OpenProject(project.path);",
    switchBeginIndex,
  );
  const switchConfirmIndex = appSource.indexOf(
    "workspace.confirmProjectSwitch(id);",
    switchBeginIndex,
  );
  const switchSettleIndex = appSource.indexOf(
    "await Promise.all([",
    switchBeginIndex,
  );
  const switchSettleOpenPromiseIndex = appSource.indexOf(
    "openProjectPromise,",
    switchSettleIndex,
  );
  const switchSettleAnimationIndex = appSource.indexOf(
    "waitForProjectSwitchVisualSettle(),",
    switchSettleIndex,
  );
  const switchTerminalIndex = appSource.indexOf(
    "useTerminalStore.getState().setActiveProject(project.path);",
    switchBeginIndex,
  );
  const closeBeginIndex = appSource.indexOf(
    "state.beginProjectSwitch(nextProject.id",
  );
  const closeScopeIndex = appSource.indexOf(
    "activateProjectScope(nextProject.path);",
    closeBeginIndex,
  );
  const closeOpenIndex = appSource.indexOf(
    "const openProjectPromise = AppFunctions.OpenProject(nextProject.path);",
    closeBeginIndex,
  );
  const closeConfirmIndex = appSource.indexOf(
    "workspace.confirmProjectSwitch(nextProject.id);",
    closeBeginIndex,
  );
  const closeSettleIndex = appSource.indexOf(
    "await Promise.all([",
    closeBeginIndex,
  );
  const closeSettleOpenPromiseIndex = appSource.indexOf(
    "openProjectPromise,",
    closeSettleIndex,
  );
  const closeSettleAnimationIndex = appSource.indexOf(
    "waitForProjectSwitchVisualSettle(),",
    closeSettleIndex,
  );
  const closeTerminalIndex = appSource.indexOf(
    "useTerminalStore.getState().setActiveProject(nextProject.path);",
    closeBeginIndex,
  );

  expect(switchBeginIndex).toBeGreaterThan(-1);
  expect(switchScopeIndex).toBeGreaterThan(switchBeginIndex);
  expect(switchOpenIndex).toBeGreaterThan(-1);
  expect(switchOpenIndex).toBeGreaterThan(switchScopeIndex);
  expect(switchConfirmIndex).toBeGreaterThan(switchOpenIndex);
  expect(switchSettleIndex).toBeGreaterThan(switchConfirmIndex);
  expect(switchSettleOpenPromiseIndex).toBeGreaterThan(switchSettleIndex);
  expect(switchSettleAnimationIndex).toBeGreaterThan(switchSettleIndex);
  expect(switchTerminalIndex).toBeGreaterThan(switchSettleIndex);
  expect(closeBeginIndex).toBeGreaterThan(-1);
  expect(closeScopeIndex).toBeGreaterThan(closeBeginIndex);
  expect(closeOpenIndex).toBeGreaterThan(-1);
  expect(closeOpenIndex).toBeGreaterThan(closeScopeIndex);
  expect(closeConfirmIndex).toBeGreaterThan(closeOpenIndex);
  expect(closeSettleIndex).toBeGreaterThan(closeConfirmIndex);
  expect(closeSettleOpenPromiseIndex).toBeGreaterThan(closeSettleIndex);
  expect(closeSettleAnimationIndex).toBeGreaterThan(closeSettleIndex);
  expect(closeTerminalIndex).toBeGreaterThan(closeSettleIndex);
});

test("opening a new project uses the same transition path as project switching", async ({
  page,
}) => {
  const appSource = await readSource(page, "/src/App.tsx");

  const openHandlerIndex = appSource.indexOf(
    "const handleProjectOpen = async (projectPath: string)",
  );
  const openStageIndex = appSource.indexOf(
    ".beginProjectOpen(projectPath, 1);",
    openHandlerIndex,
  );
  const openScopeIndex = appSource.indexOf(
    "activateProjectScope(projectPath);",
    openStageIndex,
  );
  const openBackendIndex = appSource.indexOf(
    "const openProjectPromise = AppFunctions.OpenProject(projectPath);",
    openStageIndex,
  );
  const openConfirmIndex = appSource.indexOf(
    "workspace.confirmProjectSwitch(openedProjectId);",
    openStageIndex,
  );
  const openSettleIndex = appSource.indexOf(
    "await Promise.all([",
    openConfirmIndex,
  );
  const openSettleBackendIndex = appSource.indexOf(
    "openProjectPromise,",
    openSettleIndex,
  );
  const openSettleAnimationIndex = appSource.indexOf(
    "waitForProjectSwitchVisualSettle(),",
    openSettleIndex,
  );
  const openCompleteIndex = appSource.indexOf(
    "useWorkspaceStore.getState().completeProjectSwitch(openedProjectId);",
    openSettleIndex,
  );
  const transitionIndex = appSource.indexOf("<ProjectSwitchTransition");
  const welcomeIndex = appSource.indexOf(
    "<WelcomeScreen onProjectOpen={handleProjectOpen} />",
    transitionIndex,
  );

  expect(openHandlerIndex).toBeGreaterThan(-1);
  expect(openStageIndex).toBeGreaterThan(openHandlerIndex);
  expect(openScopeIndex).toBeGreaterThan(openStageIndex);
  expect(openBackendIndex).toBeGreaterThan(openScopeIndex);
  expect(openConfirmIndex).toBeGreaterThan(openBackendIndex);
  expect(openSettleIndex).toBeGreaterThan(openConfirmIndex);
  expect(openSettleBackendIndex).toBeGreaterThan(openSettleIndex);
  expect(openSettleAnimationIndex).toBeGreaterThan(openSettleIndex);
  expect(openCompleteIndex).toBeGreaterThan(openSettleIndex);
  expect(transitionIndex).toBeGreaterThan(-1);
  expect(welcomeIndex).toBeGreaterThan(transitionIndex);
  expect(appSource).toContain("layoutKey");
  expect(appSource).toContain("activeProject?.path ??");
  expect(appSource).toContain("__welcome__");
});

test("workspace startup reveals the restored project before backend warmup finishes", async ({
  page,
}) => {
  const workspaceSource = await readSource(
    page,
    "/src/stores/workspaceStore.ts",
  );

  const restoreLoopIndex = workspaceSource.indexOf(
    "for (const project of restoreCandidates)",
  );
  const restoreAddIndex = workspaceSource.indexOf(
    "useWorkspaceStore.getState().addProject(project.path);",
    restoreLoopIndex,
  );
  const restoreReadyIndex = workspaceSource.indexOf(
    "useWorkspaceStore.getState().setReady(true);",
    restoreLoopIndex,
  );
  const restoreOpenIndex = workspaceSource.indexOf(
    "await AppFunctions.OpenProject(project.path);",
    restoreLoopIndex,
  );

  expect(restoreLoopIndex).toBeGreaterThan(-1);
  expect(restoreAddIndex).toBeGreaterThan(restoreLoopIndex);
  expect(restoreReadyIndex).toBeGreaterThan(restoreAddIndex);
  expect(restoreOpenIndex).toBeGreaterThan(restoreReadyIndex);
});

test("zen native window controls cleanup is guarded across layout remounts", async ({
  page,
}) => {
  const layoutSource = await readSource(
    page,
    "/src/components/layout/MainLayout.tsx",
  );

  expect(layoutSource).toMatch(
    /let nativeWindowControlsOwner: symbol \| null = null;/,
  );
  expect(layoutSource).toMatch(/nativeWindowControlsOwnerRef/);
  expect(layoutSource).toMatch(/nativeWindowControlsRestoreTimer = setTimeout/);
  expect(layoutSource).toMatch(/let nativeWindowControlsLastVisible = true/);
  expect(layoutSource).toMatch(
    /nativeWindowControlsLastVisible = nativeWindowControlsVisible/,
  );
  expect(layoutSource).toMatch(/if \(!nativeWindowControlsLastVisible\) \{/);
  expect(layoutSource).toMatch(
    /SetNativeWindowControlsVisible\(nativeWindowControlsVisible\)/,
  );
  expect(layoutSource).not.toMatch(
    /return \(\) => \{\s*void SetNativeWindowControlsVisible\(true\)/s,
  );
});

test("layout and explorer resolve the active project from workspace state", async ({
  page,
}) => {
  const [layoutSource, explorerSource] = await Promise.all([
    readSource(page, "/src/components/layout/MainLayout.tsx"),
    readSource(page, "/src/components/FileExplorer.tsx"),
  ]);

  expect(layoutSource).toMatch(
    /const activeProjectPath = workspaceProjectPath;/,
  );
  expect(layoutSource).not.toMatch(/explorerProjectPath/);
  expect(explorerSource).toMatch(/projectPath\?: string;/);
  expect(explorerSource).toMatch(/projectPath: initialProjectPath =/);
  expect(explorerSource).toMatch(/resolvedProjectPath/);
  expect(explorerSource).toMatch(/initialProjectPath \|\|/);
  expect(explorerSource).toMatch(/GetCurrentProjectPath/);
});
