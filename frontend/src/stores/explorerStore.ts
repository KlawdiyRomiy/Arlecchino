import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isSameOrChildPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";
import { recordIDEContextEvent } from "./ideContextLedgerStore";

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
  selectedPaths: Set<string>;
  focusedPath: string | null;
  anchorPath: string | null;
  setHighlightedPath: (path: string | null) => void;
  selectSinglePath: (path: string | null) => void;
  setSelectedPaths: (
    paths: Iterable<string>,
    options?: { focusedPath?: string | null; anchorPath?: string | null },
  ) => void;
  toggleSelectedPath: (
    path: string,
    options?: { preserveAnchor?: boolean },
  ) => void;
  clearSelection: () => void;
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
    selectedPaths: new Set<string>(),
    focusedPath: null,
    anchorPath: null,

    setHighlightedPath: (path: string | null) => {
      set({ highlightedPath: path });
      recordIDEContextEvent({
        scope: "filesystem",
        type: path
          ? "explorer.selection_changed"
          : "explorer.selection_cleared",
        title: path
          ? "Explorer selection changed"
          : "Explorer selection cleared",
        path: path ?? undefined,
      });
    },

    selectSinglePath: (path: string | null) => {
      set({
        highlightedPath: path,
        selectedPaths: path ? new Set([path]) : new Set<string>(),
        focusedPath: path,
        anchorPath: path,
      });
      recordIDEContextEvent({
        scope: "filesystem",
        type: path
          ? "explorer.selection_changed"
          : "explorer.selection_cleared",
        title: path
          ? "Explorer selection changed"
          : "Explorer selection cleared",
        path: path ?? undefined,
      });
    },

    setSelectedPaths: (paths, options) => {
      const selectedPaths = new Set(paths);
      const focusedPath =
        options?.focusedPath ?? Array.from(selectedPaths).at(-1) ?? null;
      const anchorPath = options?.anchorPath ?? focusedPath;
      set({
        selectedPaths,
        focusedPath,
        anchorPath,
        highlightedPath: focusedPath,
      });
      recordIDEContextEvent({
        scope: "filesystem",
        type: selectedPaths.size
          ? "explorer.selection_changed"
          : "explorer.selection_cleared",
        title: selectedPaths.size
          ? "Explorer selection changed"
          : "Explorer selection cleared",
        path: focusedPath ?? undefined,
      });
    },

    toggleSelectedPath: (path, options) => {
      set((state) => {
        const selectedPaths = new Set(state.selectedPaths);
        if (selectedPaths.has(path)) {
          selectedPaths.delete(path);
        } else {
          selectedPaths.add(path);
        }
        if (selectedPaths.size === 0) {
          return {
            selectedPaths,
            focusedPath: null,
            anchorPath: null,
            highlightedPath: null,
          };
        }
        const selectedList = Array.from(selectedPaths);
        const focusedPath = selectedPaths.has(path)
          ? path
          : (selectedList.at(-1) ?? null);
        const anchorPath = options?.preserveAnchor
          ? selectedPaths.has(state.anchorPath ?? "")
            ? state.anchorPath
            : focusedPath
          : focusedPath;
        return {
          selectedPaths,
          focusedPath,
          anchorPath,
          highlightedPath: focusedPath,
        };
      });
      recordIDEContextEvent({
        scope: "filesystem",
        type: "explorer.selection_changed",
        title: "Explorer selection changed",
        path,
      });
    },

    clearSelection: () => {
      set({
        selectedPaths: new Set<string>(),
        focusedPath: null,
        anchorPath: null,
        highlightedPath: null,
      });
      recordIDEContextEvent({
        scope: "filesystem",
        type: "explorer.selection_cleared",
        title: "Explorer selection cleared",
      });
    },

    remapPathPrefix: (oldPrefix: string, newPrefix: string) => {
      set((state) => {
        const remappedSelectedPaths = new Set<string>();
        state.selectedPaths.forEach((path) => {
          const remappedPath = remapProjectPathPrefix(
            path,
            oldPrefix,
            newPrefix,
          );
          if (remappedPath) {
            remappedSelectedPaths.add(remappedPath);
          }
        });

        return {
          highlightedPath: remapProjectPathPrefix(
            state.highlightedPath,
            oldPrefix,
            newPrefix,
          ),
          selectedPaths: remappedSelectedPaths,
          focusedPath: remapProjectPathPrefix(
            state.focusedPath,
            oldPrefix,
            newPrefix,
          ),
          anchorPath: remapProjectPathPrefix(
            state.anchorPath,
            oldPrefix,
            newPrefix,
          ),
        };
      });
    },

    prunePathPrefix: (pathPrefix: string) => {
      set((state) => {
        const selectedPaths = new Set<string>();
        state.selectedPaths.forEach((path) => {
          if (!isSameOrChildPath(path, pathPrefix)) {
            selectedPaths.add(path);
          }
        });
        const focusedPath =
          state.focusedPath && isSameOrChildPath(state.focusedPath, pathPrefix)
            ? null
            : state.focusedPath;
        const anchorPath =
          state.anchorPath && isSameOrChildPath(state.anchorPath, pathPrefix)
            ? focusedPath
            : state.anchorPath;
        return {
          highlightedPath:
            state.highlightedPath &&
            isSameOrChildPath(state.highlightedPath, pathPrefix)
              ? focusedPath
              : state.highlightedPath,
          selectedPaths,
          focusedPath,
          anchorPath,
        };
      });
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
        const wasExpanded = get().expandedPaths.has(path);
        set((state) => {
          const newSet = new Set(state.expandedPaths);
          if (newSet.has(path)) {
            newSet.delete(path);
          } else {
            newSet.add(path);
          }
          return { expandedPaths: newSet };
        });
        recordIDEContextEvent({
          scope: "filesystem",
          type: wasExpanded
            ? "explorer.folder_collapsed"
            : "explorer.folder_expanded",
          title: wasExpanded
            ? "Explorer folder collapsed"
            : "Explorer folder expanded",
          path,
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
        recordIDEContextEvent({
          scope: "filesystem",
          type: expanded
            ? "explorer.folder_expanded"
            : "explorer.folder_collapsed",
          title: expanded
            ? "Explorer folder expanded"
            : "Explorer folder collapsed",
          path,
        });
      },

      isExpanded: (path: string) => {
        return get().expandedPaths.has(path);
      },

      requestRevealFile: (path: string) => {
        set({ revealRequestPath: path });
        recordIDEContextEvent({
          scope: "filesystem",
          type: "explorer.reveal_requested",
          title: "Explorer reveal requested",
          path,
        });
      },

      clearRevealRequest: () => {
        set({ revealRequestPath: null });
      },

      setProjectPath: (path: string) => {
        set({ projectPath: path });
        recordIDEContextEvent({
          scope: "filesystem",
          type: "explorer.project_changed",
          title: "Explorer project changed",
          projectPath: path,
        });
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
