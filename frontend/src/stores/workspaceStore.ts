import * as AppFunctions from "../wails/app";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  activateProjectScope,
  preloadProjectDiagnostics,
  resetProjectBoundStores,
} from "../utils/projectBoundState";
import { useTerminalStore } from "./terminalStore";

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
  removeProject: (id: string) => void;
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

const createWorkspaceStore = () =>
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
        },

        clearActiveProject: () =>
          set({
            activeId: null,
            activeFramework: null,
            pendingId: null,
            switchSourceId: null,
            uiBlockers: [],
          }),

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
        },

        confirmProjectSwitch: (id: string) =>
          set((state) => ({
            activeId: state.pendingId === id ? id : state.activeId,
          })),

        completeProjectSwitch: (id: string) =>
          set((state) => {
            if (state.activeId !== id) {
              return state;
            }

            return {
              pendingId: state.pendingId === id ? null : state.pendingId,
              switchSourceId: null,
              uiBlockers: [],
            };
          }),

        cancelProjectSwitch: (id?: string | null) =>
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
          }),

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

        setReady: (ready: boolean) => set({ ready }),

        setActiveFramework: (activeFramework: string | null) =>
          set({ activeFramework }),

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
        name: "workspace-storage",
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
  __arlecchinoWorkspaceStore?: WorkspaceStoreApi;
};

export const useWorkspaceStore =
  workspaceStoreGlobal.__arlecchinoWorkspaceStore ??
  (workspaceStoreGlobal.__arlecchinoWorkspaceStore = createWorkspaceStore());

export const initializeWorkspace = async () => {
  if (workspaceInitPromise) {
    return workspaceInitPromise;
  }

  const state = useWorkspaceStore.getState();
  if (state.ready) {
    return;
  }

  workspaceInitPromise = (async () => {
    await Promise.resolve(useWorkspaceStore.persist.rehydrate());

    const { activeId, projects } = useWorkspaceStore.getState();
    if (!activeId) {
      useTerminalStore.getState().setActiveProject(null);
      return;
    }

    const activeProject = projects.find((item) => item.id === activeId);
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
        await AppFunctions.OpenProject(project.path);
        useWorkspaceStore.getState().addProject(project.path);
        useTerminalStore.getState().setActiveProject(project.path);
        useWorkspaceStore
          .getState()
          .setActiveFramework(
            (await AppFunctions.GetCurrentProjectFramework()) || null,
          );
        void preloadProjectDiagnostics(project.path);
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
