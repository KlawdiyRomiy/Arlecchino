import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ExplorerState {
  expandedPaths: Set<string>;
  highlightedPath: string | null;
  revealRequestPath: string | null;
  projectPath: string;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, expanded: boolean) => void;
  isExpanded: (path: string) => boolean;
  setHighlightedPath: (path: string | null) => void;
  requestRevealFile: (path: string) => void;
  clearRevealRequest: () => void;
  setProjectPath: (path: string) => void;
}

export const useExplorerStore = create<ExplorerState>()(
  persist(
    (set, get) => ({
      expandedPaths: new Set<string>(),
      highlightedPath: null,
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

      setHighlightedPath: (path: string | null) => {
        set({ highlightedPath: path });
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
    }),
    {
      name: 'explorer-storage',
      // Convert Set to Array for JSON serialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const data = JSON.parse(str);
          return {
            ...data,
            state: {
              ...data.state,
              expandedPaths: new Set(data.state.expandedPaths || []),
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
    }
  )
);
