import { create } from "zustand";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

export interface EditorPane {
  id: string;
  tabIds: string[];
  activeTabId: string;
}

export type SplitDirection = "horizontal" | "vertical" | null;

export interface CursorPosition {
  line: number;
  col: number;
}

export interface StatusFileContext {
  path: string | null;
  name: string | null;
  language: string | null;
}

interface EditorState {
  tabs: Map<string, EditorTab>;
  panes: EditorPane[];
  activePaneId: string;
  splitDirection: SplitDirection;
  cursorPosition: CursorPosition;
  statusFile: StatusFileContext;
}

interface EditorActions {
  openTab: (
    paneId: string,
    path: string,
    name: string,
    content: string,
    language: string,
  ) => void;
  syncActiveTab: (
    paneId: string,
    path: string,
    name: string,
    content: string,
    language: string,
    dirty: boolean,
  ) => void;
  closeTab: (paneId: string, tabId: string) => void;
  setActiveTab: (paneId: string, tabId: string) => void;
  setActivePane: (paneId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  replaceTabContent: (
    tabId: string,
    content: string,
    language?: string,
  ) => void;
  markTabDirty: (tabId: string, dirty: boolean) => void;
  splitPane: (direction: SplitDirection) => void;
  closeSplit: () => void;
  moveTabToPane: (tabId: string, fromPaneId: string, toPaneId: string) => void;
  setCursorPosition: (line: number, col: number) => void;
  setStatusFile: (
    path: string | null,
    name: string | null,
    language: string | null,
  ) => void;
  renamePath: (oldPath: string, newPath: string) => void;
  renamePathPrefix: (oldPrefix: string, newPrefix: string) => void;
  closePath: (path: string) => void;
  closePathPrefix: (pathPrefix: string) => void;
  getTab: (id: string) => EditorTab | undefined;
  getActiveTab: (paneId: string) => EditorTab | undefined;
}

export const makeEditorTabId = (path: string) =>
  `tab-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;

const remapStateTabs = (
  tabs: Map<string, EditorTab>,
  oldPrefix: string,
  newPrefix: string,
): Map<string, EditorTab> => {
  const nextTabs = new Map<string, EditorTab>();

  tabs.forEach((tab) => {
    const nextPath = remapProjectPathPrefix(tab.path, oldPrefix, newPrefix);
    if (!nextPath) {
      nextTabs.set(tab.id, tab);
      return;
    }

    if (nextPath === tab.path) {
      nextTabs.set(tab.id, tab);
      return;
    }

    const nextId = makeEditorTabId(nextPath);
    nextTabs.set(nextId, {
      ...tab,
      id: nextId,
      path: nextPath,
      name: getProjectPathBasename(nextPath),
    });
  });

  return nextTabs;
};

const remapPaneTabIds = (
  panes: EditorPane[],
  tabs: Map<string, EditorTab>,
  oldPrefix: string,
  newPrefix: string,
): EditorPane[] =>
  panes.map((pane) => {
    const tabIds = pane.tabIds.map((tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) {
        return tabId;
      }
      const remappedPath = remapProjectPathPrefix(
        tab.path,
        oldPrefix,
        newPrefix,
      );
      if (!remappedPath || remappedPath === tab.path) {
        return tabId;
      }
      return makeEditorTabId(remappedPath);
    });

    const activeTab = tabs.get(pane.activeTabId);
    const remappedActivePath = activeTab
      ? remapProjectPathPrefix(activeTab.path, oldPrefix, newPrefix)
      : null;
    const activeTabId =
      activeTab && remappedActivePath && remappedActivePath !== activeTab.path
        ? makeEditorTabId(remappedActivePath)
        : pane.activeTabId;

    return {
      ...pane,
      tabIds,
      activeTabId,
    };
  });

export const useEditorStore = create<EditorState & EditorActions>(
  (set, get) => ({
    tabs: new Map(),
    panes: [{ id: "pane-main", tabIds: [], activeTabId: "" }],
    activePaneId: "pane-main",
    splitDirection: null,
    cursorPosition: { line: 1, col: 1 },
    statusFile: { path: null, name: null, language: null },

    openTab: (paneId, path, name, content, language) => {
      const id = makeEditorTabId(path);
      const state = get();

      // If tab already exists, just activate it
      if (state.tabs.has(id)) {
        set((s) => ({
          panes: s.panes.map((p) =>
            p.id === paneId
              ? {
                  ...p,
                  activeTabId: id,
                  tabIds: p.tabIds.includes(id) ? p.tabIds : [...p.tabIds, id],
                }
              : p,
          ),
          activePaneId: paneId,
          cursorPosition: { line: 1, col: 1 },
        }));
        return;
      }

      const tab: EditorTab = {
        id,
        path,
        name,
        content,
        isDirty: false,
        language,
      };

      set((s) => {
        const newTabs = new Map(s.tabs);
        newTabs.set(id, tab);

        return {
          tabs: newTabs,
          panes: s.panes.map((p) =>
            p.id === paneId
              ? { ...p, tabIds: [...p.tabIds, id], activeTabId: id }
              : p,
          ),
          activePaneId: paneId,
          cursorPosition: { line: 1, col: 1 },
        };
      });
    },

    syncActiveTab: (paneId, path, name, content, language, dirty) => {
      const id = makeEditorTabId(path);
      set((s) => {
        const existingTab = s.tabs.get(id);
        const tabChanged =
          !existingTab ||
          existingTab.path !== path ||
          existingTab.name !== name ||
          existingTab.content !== content ||
          existingTab.language !== language ||
          existingTab.isDirty !== dirty;

        const nextTabs = tabChanged ? new Map(s.tabs) : s.tabs;
        if (tabChanged) {
          nextTabs.set(id, {
            id,
            path,
            name,
            content,
            isDirty: dirty,
            language,
          });
        }

        let panesChanged = false;
        const nextPanes = s.panes.map((pane) => {
          if (pane.id !== paneId) {
            return pane;
          }

          const hasTab = pane.tabIds.includes(id);
          if (hasTab && pane.activeTabId === id) {
            return pane;
          }

          panesChanged = true;
          return {
            ...pane,
            activeTabId: id,
            tabIds: hasTab ? pane.tabIds : [...pane.tabIds, id],
          };
        });

        const activePaneChanged = s.activePaneId !== paneId;
        const statusChanged =
          s.statusFile.path !== path ||
          s.statusFile.name !== name ||
          s.statusFile.language !== language;

        if (
          !tabChanged &&
          !panesChanged &&
          !activePaneChanged &&
          !statusChanged
        ) {
          return s;
        }

        return {
          tabs: nextTabs,
          panes: panesChanged ? nextPanes : s.panes,
          activePaneId: paneId,
          statusFile: { path, name, language },
          cursorPosition:
            panesChanged || activePaneChanged
              ? { line: 1, col: 1 }
              : s.cursorPosition,
        };
      });
    },

    closeTab: (paneId, tabId) => {
      set((s) => {
        const pane = s.panes.find((p) => p.id === paneId);
        if (!pane) return s;

        const newTabIds = pane.tabIds.filter((id) => id !== tabId);
        const newActiveTabId =
          pane.activeTabId === tabId
            ? newTabIds[newTabIds.length - 1] || ""
            : pane.activeTabId;

        // Check if tab is used in other panes
        const isUsedElsewhere = s.panes.some(
          (p) => p.id !== paneId && p.tabIds.includes(tabId),
        );

        const newTabs = new Map(s.tabs);
        if (!isUsedElsewhere) {
          newTabs.delete(tabId);
        }

        return {
          tabs: newTabs,
          panes: s.panes.map((p) =>
            p.id === paneId
              ? { ...p, tabIds: newTabIds, activeTabId: newActiveTabId }
              : p,
          ),
        };
      });
    },

    setActiveTab: (paneId, tabId) => {
      set((s) => ({
        panes: s.panes.map((p) =>
          p.id === paneId ? { ...p, activeTabId: tabId } : p,
        ),
        activePaneId: paneId,
        cursorPosition: { line: 1, col: 1 },
      }));
    },

    setActivePane: (paneId) => {
      set({ activePaneId: paneId });
    },

    updateTabContent: (tabId, content) => {
      set((s) => {
        const tab = s.tabs.get(tabId);
        if (!tab) return s;
        const newTabs = new Map(s.tabs);
        newTabs.set(tabId, { ...tab, content, isDirty: true });
        return { tabs: newTabs };
      });
    },

    replaceTabContent: (tabId, content, language) => {
      set((s) => {
        const tab = s.tabs.get(tabId);
        if (!tab || tab.isDirty) return s;
        const nextLanguage = language ?? tab.language;
        if (tab.content === content && tab.language === nextLanguage) return s;

        const newTabs = new Map(s.tabs);
        newTabs.set(tabId, {
          ...tab,
          content,
          language: nextLanguage,
          isDirty: false,
        });
        return { tabs: newTabs };
      });
    },

    markTabDirty: (tabId, dirty) => {
      set((s) => {
        const tab = s.tabs.get(tabId);
        if (!tab) return s;
        const newTabs = new Map(s.tabs);
        newTabs.set(tabId, { ...tab, isDirty: dirty });
        return { tabs: newTabs };
      });
    },

    splitPane: (direction) => {
      const state = get();
      if (state.panes.length >= 2) return; // Max 2 panes

      const activePane = state.panes.find((p) => p.id === state.activePaneId);
      if (!activePane || activePane.tabIds.length === 0) return;

      const newPaneId = `pane-${Date.now()}`;
      const newPane: EditorPane = {
        id: newPaneId,
        tabIds: [],
        activeTabId: "",
      };

      set({
        panes: [...state.panes, newPane],
        splitDirection: direction,
      });
    },

    closeSplit: () => {
      set((s) => {
        if (s.panes.length <= 1) return s;

        const [mainPane, secondPane] = s.panes;
        const mergedTabIds = [
          ...new Set([...mainPane.tabIds, ...secondPane.tabIds]),
        ];

        return {
          panes: [{ ...mainPane, tabIds: mergedTabIds }],
          activePaneId: mainPane.id,
          splitDirection: null,
        };
      });
    },

    moveTabToPane: (tabId, fromPaneId, toPaneId) => {
      set((s) => ({
        panes: s.panes.map((p) => {
          if (p.id === fromPaneId) {
            const newTabIds = p.tabIds.filter((id) => id !== tabId);
            return { ...p, tabIds: newTabIds, activeTabId: newTabIds[0] || "" };
          }
          if (p.id === toPaneId) {
            return { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId };
          }
          return p;
        }),
        activePaneId: toPaneId,
      }));
    },

    setCursorPosition: (line, col) => {
      set({ cursorPosition: { line, col } });
    },

    setStatusFile: (path, name, language) => {
      set({ statusFile: { path, name, language } });
    },

    renamePath: (oldPath, newPath) => {
      get().renamePathPrefix(oldPath, newPath);
    },

    renamePathPrefix: (oldPrefix, newPrefix) => {
      set((state) => {
        const nextTabs = remapStateTabs(state.tabs, oldPrefix, newPrefix);
        const nextPanes = remapPaneTabIds(
          state.panes,
          state.tabs,
          oldPrefix,
          newPrefix,
        );
        const nextStatusPath = remapProjectPathPrefix(
          state.statusFile.path,
          oldPrefix,
          newPrefix,
        );

        return {
          tabs: nextTabs,
          panes: nextPanes,
          statusFile:
            nextStatusPath && nextStatusPath !== state.statusFile.path
              ? {
                  ...state.statusFile,
                  path: nextStatusPath,
                  name: getProjectPathBasename(nextStatusPath),
                }
              : state.statusFile,
        };
      });
    },

    closePath: (path) => {
      get().closePathPrefix(path);
    },

    closePathPrefix: (pathPrefix) => {
      set((state) => {
        const removedTabIds = new Set(
          Array.from(state.tabs.values())
            .filter((tab) => isSameOrChildPath(tab.path, pathPrefix))
            .map((tab) => tab.id),
        );

        if (removedTabIds.size === 0) {
          return state;
        }

        const nextTabs = new Map(state.tabs);
        removedTabIds.forEach((tabId) => nextTabs.delete(tabId));

        const nextPanes = state.panes.map((pane) => {
          const tabIds = pane.tabIds.filter(
            (tabId) => !removedTabIds.has(tabId),
          );
          const activeTabId = removedTabIds.has(pane.activeTabId)
            ? tabIds[tabIds.length - 1] || ""
            : pane.activeTabId;
          return {
            ...pane,
            tabIds,
            activeTabId,
          };
        });

        return {
          tabs: nextTabs,
          panes: nextPanes,
          statusFile:
            state.statusFile.path &&
            isSameOrChildPath(state.statusFile.path, pathPrefix)
              ? { path: null, name: null, language: null }
              : state.statusFile,
        };
      });
    },

    getTab: (id) => get().tabs.get(id),

    getActiveTab: (paneId) => {
      const state = get();
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return undefined;
      return state.tabs.get(pane.activeTabId);
    },
  }),
);
