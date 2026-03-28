import { create } from "zustand";

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
  closeTab: (paneId: string, tabId: string) => void;
  setActiveTab: (paneId: string, tabId: string) => void;
  setActivePane: (paneId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
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
  getTab: (id: string) => EditorTab | undefined;
  getActiveTab: (paneId: string) => EditorTab | undefined;
}

const generateTabId = (path: string) =>
  `tab-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;

export const useEditorStore = create<EditorState & EditorActions>(
  (set, get) => ({
    tabs: new Map(),
    panes: [{ id: "pane-main", tabIds: [], activeTabId: "" }],
    activePaneId: "pane-main",
    splitDirection: null,
    cursorPosition: { line: 1, col: 1 },
    statusFile: { path: null, name: null, language: null },

    openTab: (paneId, path, name, content, language) => {
      const id = generateTabId(path);
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

    getTab: (id) => get().tabs.get(id),

    getActiveTab: (paneId) => {
      const state = get();
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return undefined;
      return state.tabs.get(pane.activeTabId);
    },
  }),
);
