import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isSameOrChildPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";

interface ExplorerState {
  expandedPaths: Set<string>;
  revealRequestPath: string | null;
  projectPath: string;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  isExpanded: (path: string) => boolean;
  requestRevealFile: (path: string) => void;
  clearRevealRequest: () => void;
  setProjectPath: (path: string) => void;
  remapPathPrefix: (oldPrefix: string, newPrefix: string) => void;
  prunePathPrefix: (pathPrefix: string) => void;
}

interface ExplorerSelectionState {
  highlightedPath: string | null;
  setHighlightedPath: (path: string | null) => void;
  remapPathPrefix: (oldPrefix: string, newPrefix: string) => void;
  prunePathPrefix: (pathPrefix: string) => void;
}

type ExplorerPersistedState = Pick<
  ExplorerState,
  "expandedPaths" | "projectPath"
>;

export const useExplorerSelectionStore = create<ExplorerSelectionState>(
  (set) => ({
    highlightedPath: null,

    setHighlightedPath: (path: string | null) => {
      set({ highlightedPath: path });
    },

    remapPathPrefix: (oldPrefix: string, newPrefix: string) => {
      set((state) => ({
        highlightedPath: remapProjectPathPrefix(
          state.highlightedPath,
          oldPrefix,
          newPrefix,
        ),
      }));
    },

    prunePathPrefix: (pathPrefix: string) => {
      set((state) => ({
        highlightedPath:
          state.highlightedPath &&
          isSameOrChildPath(state.highlightedPath, pathPrefix)
            ? null
            : state.highlightedPath,
      }));
    },
  }),
);

export const useExplorerStore = create<ExplorerState>()(
  persist<ExplorerState, [], [], ExplorerPersistedState>(
    (set, get) => ({
      expandedPaths: new Set<string>(),
      projectPath: "",
      revealRequestPath: null,

      toggleExpanded: (path: string) => {
        set((state) => {
          const newSet = new Set(state.expandedPaths);
          if (newSet.has(path)) {
            newSet.delete(path);
          } else {
            newSet.add(path);
          }
          return { expandedPaths: newSet };
        });
      },

      setExpanded: (path: string, expanded: boolean) => {
        set((state) => {
          const newSet = new Set(state.expandedPaths);
          if (expanded) {
            newSet.add(path);
          } else {
            newSet.delete(path);
          }
          return { expandedPaths: newSet };
        });
      },

      isExpanded: (path: string) => {
        return get().expandedPaths.has(path);
      },

      requestRevealFile: (path: string) => {
        set({ revealRequestPath: path });
      },

      clearRevealRequest: () => {
        set({ revealRequestPath: null });
      },

      setProjectPath: (path: string) => {
        set({ projectPath: path });
      },

      remapPathPrefix: (oldPrefix: string, newPrefix: string) => {
        set((state) => {
          const remappedExpandedPaths = new Set<string>();
          state.expandedPaths.forEach((path) => {
            const remappedPath = remapProjectPathPrefix(
              path,
              oldPrefix,
              newPrefix,
            );
            if (remappedPath) {
              remappedExpandedPaths.add(remappedPath);
            }
          });

          useExplorerSelectionStore
            .getState()
            .remapPathPrefix(oldPrefix, newPrefix);

          return {
            expandedPaths: remappedExpandedPaths,
            revealRequestPath: remapProjectPathPrefix(
              state.revealRequestPath,
              oldPrefix,
              newPrefix,
            ),
          };
        });
      },

      prunePathPrefix: (pathPrefix: string) => {
        set((state) => {
          const nextExpandedPaths = new Set<string>();
          state.expandedPaths.forEach((path) => {
            if (!isSameOrChildPath(path, pathPrefix)) {
              nextExpandedPaths.add(path);
            }
          });

          useExplorerSelectionStore.getState().prunePathPrefix(pathPrefix);

          return {
            expandedPaths: nextExpandedPaths,
            revealRequestPath:
              state.revealRequestPath &&
              isSameOrChildPath(state.revealRequestPath, pathPrefix)
                ? null
                : state.revealRequestPath,
          };
        });
      },
    }),
    {
      name: "explorer-storage",
      // Convert Set to Array for JSON serialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const data = JSON.parse(str);
          const state = data.state || {};
          return {
            ...data,
            state: {
              expandedPaths: new Set(state.expandedPaths || []),
              projectPath: state.projectPath || "",
            },
          };
        },
        setItem: (name, value) => {
          const data = {
            ...value,
            state: {
              ...value.state,
              expandedPaths: Array.from(value.state.expandedPaths || []),
            },
          };
          localStorage.setItem(name, JSON.stringify(data));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
      partialize: (state) => ({
        expandedPaths: state.expandedPaths,
        projectPath: state.projectPath,
      }),
    },
  ),
);
