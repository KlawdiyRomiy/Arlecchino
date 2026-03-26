import * as AppFunctions from "../../wailsjs/go/main/App";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WorkspaceProject {
  id: string;
  path: string;
  name: string;
  openedAt: number;
}

interface WorkspaceState {
  projects: WorkspaceProject[];
  activeId: string | null;
  activeFramework: string | null;
  pendingId: string | null;
  ready: boolean;
  switchDirection: number;
  uiBlockers: string[];
  addProject: (path: string) => void;
  removeProject: (id: string) => void;
  clearActiveProject: () => void;
  beginProjectSwitch: (id: string, direction?: number) => void;
  confirmProjectSwitch: (id: string) => void;
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
              uiBlockers: activeId === null ? [] : state.uiBlockers,
            };
          });
        },

        clearActiveProject: () =>
          set({
            activeId: null,
            activeFramework: null,
            pendingId: null,
            uiBlockers: [],
          }),

        beginProjectSwitch: (id: string, direction?: number) => {
          const state = get();
          if (!state.projects.some((project) => project.id === id)) {
            return;
          }

          set({
            pendingId: id,
            switchDirection:
              direction ??
              resolveProjectSwitchDirection(state.projects, state.activeId, id),
          });
        },

        confirmProjectSwitch: (id: string) =>
          set((state) => ({
            activeId: id,
            pendingId: state.pendingId === id ? null : state.pendingId,
            uiBlockers: [],
          })),

        cancelProjectSwitch: (id?: string | null) =>
          set((state) => {
            if (id && state.pendingId !== id) {
              return state;
            }

            return { pendingId: null };
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
      return;
    }

    const project = projects.find((item) => item.id === activeId);
    if (!project) {
      useWorkspaceStore.getState().clearActiveProject();
      return;
    }

    try {
      await AppFunctions.OpenProject(project.path);
      useWorkspaceStore
        .getState()
        .setActiveFramework(
          (await AppFunctions.GetCurrentProjectFramework()) || null,
        );
    } catch (error) {
      console.error("Error restoring workspace:", error);
      useWorkspaceStore.getState().removeProject(activeId);
      useWorkspaceStore.getState().setActiveFramework(null);
    }
  })().finally(() => {
    useWorkspaceStore.getState().setReady(true);
    workspaceInitPromise = null;
  });

  return workspaceInitPromise;
};
