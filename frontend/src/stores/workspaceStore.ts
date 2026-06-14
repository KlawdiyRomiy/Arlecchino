import * as AppFunctions from "../wails/app";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  activateProjectScope,
  resetProjectBoundStores,
} from "../utils/projectBoundState";
import {
  readProjectSessionRoutePayload,
  setProjectSessionRoutePayloadOverride,
  workspaceStorageNameForProjectSession,
} from "../shell/projectSessionRoute";
import {
  bindProjectWindowRestoreLifecycle,
  forgetProjectWindowRestorePath,
  readProjectWindowRestorePaths,
} from "../shell/projectWindowRestore";
import { useEditorSettingsStore } from "./editorSettingsStore";
import { useTerminalStore } from "./terminalStore";
import { recordIDEContextEvent } from "./ideContextLedgerStore";

export interface WorkspaceProject {
  id: string;
  path: string;
  name: string;
  openedAt: number;
}

interface ProjectAccessInspection {
  path: string;
  accessible: boolean;
  reason: string;
}

interface WorkspaceState {
  projects: WorkspaceProject[];
  activeId: string | null;
  activeFramework: string | null;
  pendingId: string | null;
  switchSourceId: string | null;
  ready: boolean;
  switchDirection: number;
  uiBlockers: string[];
  addProject: (path: string) => void;
  beginProjectOpen: (path: string, direction?: number) => string;
  removeProject: (id: string) => void;
  reorderProjects: (ids: string[]) => void;
  clearActiveProject: () => void;
  beginProjectSwitch: (id: string, direction?: number) => void;
  confirmProjectSwitch: (id: string) => void;
  completeProjectSwitch: (id: string) => void;
  cancelProjectSwitch: (id?: string | null) => void;
  switchNextProject: () => string | null;
  switchPrevProject: () => string | null;
  setReady: (ready: boolean) => void;
  setActiveFramework: (framework: string | null) => void;
  blockProjectSwitch: (key: string) => void;
  unblockProjectSwitch: (key: string) => void;
  clearProjectSwitchBlockers: () => void;
}

const getProjectName = (path: string) => path.split("/").pop() || path;

const inspectProjectAccess = async (
  path: string,
): Promise<ProjectAccessInspection> => {
  try {
    const inspection = (await AppFunctions.InspectProjectAccess(
      path,
    )) as ProjectAccessInspection;
    if (inspection && typeof inspection.accessible === "boolean") {
      return inspection;
    }
  } catch {
    return {
      path,
      accessible: true,
      reason: "",
    };
  }

  return {
    path,
    accessible: true,
    reason: "",
  };
};

export const getProjectPathById = (
  projects: WorkspaceProject[],
  id: string | null,
) => {
  if (!id) {
    return null;
  }

  return projects.find((project) => project.id === id)?.path ?? null;
};

export const resolveDiagnosticsProjectPath = (
  projects: WorkspaceProject[],
  activeId: string | null,
  pendingId: string | null,
  switchSourceId: string | null,
) =>
  getProjectPathById(
    projects,
    pendingId && switchSourceId ? switchSourceId : activeId,
  );

export const resolveProjectSwitchDirection = (
  projects: WorkspaceProject[],
  fromId: string | null,
  toId: string,
) => {
  const fromIdx = projects.findIndex((project) => project.id === fromId);
  const toIdx = projects.findIndex((project) => project.id === toId);

  if (fromIdx === -1 || toIdx === -1) {
    return 1;
  }

  if (fromIdx === projects.length - 1 && toIdx === 0 && projects.length > 1) {
    return 1;
  }

  if (fromIdx === 0 && toIdx === projects.length - 1 && projects.length > 1) {
    return -1;
  }

  return toIdx >= fromIdx ? 1 : -1;
};

export const getAdjacentProject = (
  projects: WorkspaceProject[],
  id: string,
) => {
  const idx = projects.findIndex((project) => project.id === id);
  if (idx === -1) {
    return null;
  }

  const remaining = projects.filter((project) => project.id !== id);
  if (remaining.length === 0) {
    return null;
  }

  return idx < remaining.length
    ? remaining[idx]
    : remaining[remaining.length - 1];
};

let workspaceInitPromise: Promise<void> | null = null;
const projectSessionRoutePayload = readProjectSessionRoutePayload();
const workspaceStorageName = workspaceStorageNameForProjectSession(
  projectSessionRoutePayload,
);

const createWorkspaceStore = (storageName: string) =>
  create<WorkspaceState>()(
    persist(
      (set, get) => ({
        projects: [],
        activeId: null,
        activeFramework: null,
        pendingId: null,
        switchSourceId: null,
        ready: false,
        switchDirection: 1,
        uiBlockers: [],

        addProject: (path: string) => {
          const existing = get().projects.find(
            (project) => project.path === path,
          );
          if (existing) {
            set((state) => ({
              activeId: existing.id,
              pendingId: null,
              switchSourceId: null,
              switchDirection: resolveProjectSwitchDirection(
                state.projects,
                state.activeId,
                existing.id,
              ),
              uiBlockers: [],
            }));
            recordIDEContextEvent({
              scope: "workspace",
              type: "project.activated",
              title: "Workspace project activated",
              projectPath: existing.path,
            });
            return;
          }

          set((state) => ({
            projects: [
              ...state.projects,
              {
                id: path,
                path,
                name: getProjectName(path),
                openedAt: Date.now(),
              },
            ],
            activeId: path,
            pendingId: null,
            switchSourceId: null,
            switchDirection: 1,
            uiBlockers: [],
          }));
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.added",
            title: "Workspace project added",
            projectPath: path,
          });
        },

        beginProjectOpen: (path: string, direction = 1) => {
          const existing = get().projects.find(
            (project) => project.path === path,
          );
          if (existing) {
            get().beginProjectSwitch(existing.id, direction);
            return existing.id;
          }

          const id = path;
          set((state) => ({
            projects: [
              ...state.projects,
              {
                id,
                path,
                name: getProjectName(path),
                openedAt: Date.now(),
              },
            ],
            pendingId: id,
            switchSourceId: state.activeId,
            switchDirection: direction,
            uiBlockers: [],
          }));
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.open_started",
            title: "Workspace project open started",
            projectPath: path,
          });

          return id;
        },

        removeProject: (id: string) => {
          set((state) => {
            const idx = state.projects.findIndex(
              (project) => project.id === id,
            );
            if (idx === -1) {
              return state;
            }

            const projects = state.projects.filter(
              (project) => project.id !== id,
            );
            const activeId = state.activeId === id ? null : state.activeId;

            return {
              projects,
              activeId,
              pendingId: state.pendingId === id ? null : state.pendingId,
              switchSourceId:
                state.switchSourceId === id ? null : state.switchSourceId,
              uiBlockers: activeId === null ? [] : state.uiBlockers,
            };
          });
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.removed",
            title: "Workspace project removed",
            projectPath: id,
          });
        },

        reorderProjects: (ids: string[]) => {
          set((state) => {
            if (ids.length === 0) {
              return state;
            }
            const orderedIds = new Set(ids);
            const orderedProjects = ids
              .map((id) => state.projects.find((project) => project.id === id))
              .filter((project): project is WorkspaceProject =>
                Boolean(project),
              );
            const remainingProjects = state.projects.filter(
              (project) => !orderedIds.has(project.id),
            );
            const projects = [...orderedProjects, ...remainingProjects];
            if (
              projects.length === state.projects.length &&
              projects.every(
                (project, index) => project === state.projects[index],
              )
            ) {
              return state;
            }
            return { projects };
          });
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.reordered",
            title: "Workspace project order changed",
            metadata: { count: ids.length },
          });
        },

        clearActiveProject: () => {
          set({
            activeId: null,
            activeFramework: null,
            pendingId: null,
            switchSourceId: null,
            uiBlockers: [],
          });
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.active_cleared",
            title: "Workspace active project cleared",
          });
        },

        beginProjectSwitch: (id: string, direction?: number) => {
          const state = get();
          if (!state.projects.some((project) => project.id === id)) {
            return;
          }

          set({
            pendingId: id,
            switchSourceId: state.activeId,
            switchDirection:
              direction ??
              resolveProjectSwitchDirection(state.projects, state.activeId, id),
          });
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.switch_started",
            title: "Workspace project switch started",
            projectPath: id,
            metadata: { from: state.activeId ?? "" },
          });
        },

        confirmProjectSwitch: (id: string) => {
          set((state) => ({
            activeId: state.pendingId === id ? id : state.activeId,
          }));
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.switch_confirmed",
            title: "Workspace project switch confirmed",
            projectPath: id,
          });
        },

        completeProjectSwitch: (id: string) => {
          set((state) => {
            if (state.activeId !== id) {
              return state;
            }

            return {
              pendingId: state.pendingId === id ? null : state.pendingId,
              switchSourceId: null,
              uiBlockers: [],
            };
          });
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.switch_completed",
            title: "Workspace project switch completed",
            projectPath: id,
          });
        },

        cancelProjectSwitch: (id?: string | null) => {
          set((state) => {
            if (id && state.pendingId !== id) {
              return state;
            }

            return {
              activeId:
                state.pendingId && state.activeId === state.pendingId
                  ? state.switchSourceId
                  : state.activeId,
              pendingId: null,
              switchSourceId: null,
            };
          });
          recordIDEContextEvent({
            scope: "workspace",
            type: "project.switch_canceled",
            title: "Workspace project switch canceled",
            projectPath: id ?? "",
          });
        },

        switchNextProject: () => {
          const { projects, activeId } = get();
          if (projects.length < 2) {
            return null;
          }

          const idx = projects.findIndex((project) => project.id === activeId);
          const next = projects[(idx + 1) % projects.length];
          get().beginProjectSwitch(next.id, 1);
          return next.id;
        },

        switchPrevProject: () => {
          const { projects, activeId } = get();
          if (projects.length < 2) {
            return null;
          }

          const idx = projects.findIndex((project) => project.id === activeId);
          const prev = projects[(idx - 1 + projects.length) % projects.length];
          get().beginProjectSwitch(prev.id, -1);
          return prev.id;
        },

        setReady: (ready: boolean) => {
          set({ ready });
          recordIDEContextEvent({
            scope: "workspace",
            type: "workspace.ready_changed",
            title: "Workspace ready state changed",
            metadata: { ready },
          });
        },

        setActiveFramework: (activeFramework: string | null) => {
          set({ activeFramework });
          recordIDEContextEvent({
            scope: "workspace",
            type: "workspace.framework_changed",
            title: "Workspace framework changed",
            metadata: { framework: activeFramework ?? "" },
          });
        },

        blockProjectSwitch: (key: string) => {
          if (!key) {
            return;
          }

          set((state) => {
            if (state.uiBlockers.includes(key)) {
              return state;
            }

            return { uiBlockers: [...state.uiBlockers, key] };
          });
        },

        unblockProjectSwitch: (key: string) => {
          if (!key) {
            return;
          }

          set((state) => ({
            uiBlockers: state.uiBlockers.filter((blocker) => blocker !== key),
          }));
        },

        clearProjectSwitchBlockers: () => set({ uiBlockers: [] }),
      }),
      {
        name: storageName,
        partialize: (state) => ({
          projects: state.projects,
          activeId: state.activeId,
          switchDirection: state.switchDirection,
        }),
      },
    ),
  );

type WorkspaceStoreApi = ReturnType<typeof createWorkspaceStore>;

const workspaceStoreGlobal = globalThis as typeof globalThis & {
  __arlecchinoWorkspaceStores?: Record<string, WorkspaceStoreApi>;
};
const workspaceStores =
  workspaceStoreGlobal.__arlecchinoWorkspaceStores ??
  (workspaceStoreGlobal.__arlecchinoWorkspaceStores = {});

export const useWorkspaceStore =
  workspaceStores[workspaceStorageName] ??
  (workspaceStores[workspaceStorageName] =
    createWorkspaceStore(workspaceStorageName));

const resetWorkspaceProjectSessionState = () => {
  useWorkspaceStore.setState({
    projects: [],
    activeId: null,
    activeFramework: null,
    pendingId: null,
    switchSourceId: null,
    switchDirection: 1,
    uiBlockers: [],
  });
};

const uniqueProjectPaths = (paths: string[]): string[] =>
  Array.from(
    new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0)),
  );

const restoreProjectWindows = async (paths: string[]) => {
  for (const path of uniqueProjectPaths(paths)) {
    const access = await inspectProjectAccess(path);
    if (!access.accessible) {
      console.warn("Skipping inaccessible project window:", access.reason);
      forgetProjectWindowRestorePath(path);
      continue;
    }

    try {
      await AppFunctions.OpenProjectWindow(path);
    } catch (error) {
      console.error("Error restoring project window:", error);
    }
  }
};

const activateProjectSessionWorkspaceStorage = (sessionId: string) => {
  const payload = { sessionId };
  setProjectSessionRoutePayloadOverride(payload);
  useWorkspaceStore.persist.setOptions({
    name: workspaceStorageNameForProjectSession(payload),
  });
};

type ProjectSessionWorkspaceResolution =
  | {
      handled: true;
      session: AppFunctions.ProjectWindowSessionPayload | null;
    }
  | {
      handled: false;
      session: null;
    };

const resolveProjectSessionWorkspace =
  async (): Promise<ProjectSessionWorkspaceResolution> => {
    const routePayload = readProjectSessionRoutePayload();
    if (routePayload) {
      activateProjectSessionWorkspaceStorage(routePayload.sessionId);
      try {
        return {
          handled: true,
          session: await AppFunctions.GetProjectWindowSession(
            routePayload.sessionId,
          ),
        };
      } catch (error) {
        console.error("Error resolving project session window:", error);
        return { handled: true, session: null };
      }
    }

    const session = await AppFunctions.GetCurrentProjectWindowSession();
    if (!session) {
      return { handled: false, session: null };
    }

    activateProjectSessionWorkspaceStorage(session.sessionId);
    return { handled: true, session };
  };

const initializeProjectSessionWorkspace = async (
  session: AppFunctions.ProjectWindowSessionPayload,
) => {
  await Promise.resolve(useWorkspaceStore.persist.rehydrate());
  resetWorkspaceProjectSessionState();

  try {
    const projectPath = session.projectPath;

    bindProjectWindowRestoreLifecycle(projectPath);
    resetProjectBoundStores();
    activateProjectScope(projectPath);
    useWorkspaceStore.getState().addProject(projectPath);
    useTerminalStore.getState().setActiveProject(projectPath);
    const openProjectPromise = AppFunctions.OpenProjectWindowSession(
      session.sessionId,
      projectPath,
    );
    useWorkspaceStore.getState().setReady(true);
    const opened = await openProjectPromise;
    if (opened === false) {
      throw new Error("Project window session opener is unavailable.");
    }
    useWorkspaceStore
      .getState()
      .setActiveFramework(
        (await AppFunctions.GetCurrentProjectFramework()) || null,
      );
  } catch (error) {
    useTerminalStore.getState().setActiveProject(null);
    resetProjectBoundStores();
    useWorkspaceStore.getState().clearActiveProject();
    useWorkspaceStore.getState().setActiveFramework(null);
    console.error("Error restoring project session window:", error);
  }
};

export const initializeWorkspace = async () => {
  if (workspaceInitPromise) {
    return workspaceInitPromise;
  }

  const state = useWorkspaceStore.getState();
  if (state.ready) {
    return;
  }

  workspaceInitPromise = (async () => {
    const projectSessionResolution = await resolveProjectSessionWorkspace();
    if (projectSessionResolution.handled) {
      if (projectSessionResolution.session) {
        await initializeProjectSessionWorkspace(
          projectSessionResolution.session,
        );
      } else {
        await Promise.resolve(useWorkspaceStore.persist.rehydrate());
        resetWorkspaceProjectSessionState();
        resetProjectBoundStores();
        useTerminalStore.getState().setActiveProject(null);
        useWorkspaceStore.getState().setActiveFramework(null);
      }
      return;
    }

    await Promise.resolve(useWorkspaceStore.persist.rehydrate());
    await Promise.resolve(useEditorSettingsStore.persist.rehydrate());

    const { activeId, projects } = useWorkspaceStore.getState();
    const projectWindowMode =
      useEditorSettingsStore.getState().projectWindowMode;
    const savedProjectWindowPaths =
      projectWindowMode === "windows" ? readProjectWindowRestorePaths() : [];

    if (!activeId && savedProjectWindowPaths.length === 0) {
      useTerminalStore.getState().setActiveProject(null);
      return;
    }

    const activeProject =
      projects.find((item) => item.id === activeId) ??
      (savedProjectWindowPaths[0]
        ? {
            id: savedProjectWindowPaths[0],
            path: savedProjectWindowPaths[0],
            name: getProjectName(savedProjectWindowPaths[0]),
            openedAt: Date.now(),
          }
        : null);
    if (!activeProject) {
      useTerminalStore.getState().setActiveProject(null);
      useWorkspaceStore.getState().clearActiveProject();
      return;
    }

    const restoreCandidates = [
      activeProject,
      ...projects.filter((project) => project.id !== activeId),
    ];

    for (const project of restoreCandidates) {
      const access = await inspectProjectAccess(project.path);
      if (!access.accessible) {
        console.warn("Skipping inaccessible project:", access.reason);
        useWorkspaceStore.getState().removeProject(project.id);
        continue;
      }

      try {
        resetProjectBoundStores();
        activateProjectScope(project.path);
        useWorkspaceStore.getState().addProject(project.path);
        useTerminalStore.getState().setActiveProject(project.path);
        useWorkspaceStore.getState().setReady(true);
        await AppFunctions.OpenProject(project.path);
        useWorkspaceStore
          .getState()
          .setActiveFramework(
            (await AppFunctions.GetCurrentProjectFramework()) || null,
          );
        if (projectWindowMode === "windows") {
          const windowRestorePaths = uniqueProjectPaths([
            ...savedProjectWindowPaths,
            ...projects
              .filter((candidate) => candidate.path !== project.path)
              .map((candidate) => candidate.path),
          ]).filter((candidate) => candidate !== project.path);
          await restoreProjectWindows(windowRestorePaths);
        }
        return;
      } catch (error) {
        useTerminalStore.getState().setActiveProject(null);
        resetProjectBoundStores();
        console.error("Error restoring workspace:", error);
        useWorkspaceStore.getState().removeProject(project.id);
        useWorkspaceStore.getState().setActiveFramework(null);
      }
    }

    useTerminalStore.getState().setActiveProject(null);
    resetProjectBoundStores();
    useWorkspaceStore.getState().clearActiveProject();
    useWorkspaceStore.getState().setActiveFramework(null);
  })().finally(() => {
    useWorkspaceStore.getState().setReady(true);
    workspaceInitPromise = null;
  });

  return workspaceInitPromise;
};
