import { create } from "zustand";
import { persist } from "zustand/middleware";

const STORAGE_KEY = "browser-preview-settings.v1";

const DEFAULT_ALLOWED_ORIGINS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];

export interface BrowserPreviewTarget {
  url: string;
  sessionId?: string;
  source: "terminal" | "button" | "chat" | "mcp" | "dispatcher";
  updatedAt: number;
}

interface BrowserPreviewSettings {
  autoOpenFromTerminal: boolean;
  reuseWindowPerSession: boolean;
  closeAutoOpenedOnTerminalExit: boolean;
  allowedOrigins: string[];
  lastKnownTargetByProject: Record<string, BrowserPreviewTarget>;
}

interface BrowserPreviewStoreState extends BrowserPreviewSettings {
  setAutoOpenFromTerminal: (value: boolean) => void;
  setReuseWindowPerSession: (value: boolean) => void;
  setCloseAutoOpenedOnTerminalExit: (value: boolean) => void;
  rememberProjectTarget: (
    projectPath: string,
    target: BrowserPreviewTarget,
  ) => void;
  getLastKnownTarget: (projectPath: string) => BrowserPreviewTarget | null;
}

export const useBrowserPreviewStore = create<BrowserPreviewStoreState>()(
  persist(
    (set, get) => ({
      autoOpenFromTerminal: false,
      reuseWindowPerSession: true,
      closeAutoOpenedOnTerminalExit: false,
      allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
      lastKnownTargetByProject: {},

      setAutoOpenFromTerminal: (value) => set({ autoOpenFromTerminal: value }),
      setReuseWindowPerSession: (value) =>
        set({ reuseWindowPerSession: value }),
      setCloseAutoOpenedOnTerminalExit: (value) =>
        set({ closeAutoOpenedOnTerminalExit: value }),
      rememberProjectTarget: (projectPath, target) => {
        const key = normalizeProjectPathKey(projectPath);
        if (!key || !isAllowedPreviewUrl(target.url)) {
          return;
        }

        set((state) => ({
          lastKnownTargetByProject: {
            ...state.lastKnownTargetByProject,
            [key]: target,
          },
        }));
      },
      getLastKnownTarget: (projectPath) => {
        const key = normalizeProjectPathKey(projectPath);
        if (!key) {
          return null;
        }
        return get().lastKnownTargetByProject[key] ?? null;
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        autoOpenFromTerminal: state.autoOpenFromTerminal,
        reuseWindowPerSession: state.reuseWindowPerSession,
        closeAutoOpenedOnTerminalExit: state.closeAutoOpenedOnTerminalExit,
        allowedOrigins: state.allowedOrigins,
        lastKnownTargetByProject: state.lastKnownTargetByProject,
      }),
    },
  ),
);

function normalizeProjectPathKey(projectPath: string): string {
  return projectPath.trim();
}

export function isAllowedPreviewUrl(
  url: string,
  allowedOrigins: string[] = DEFAULT_ALLOWED_ORIGINS,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return allowedOrigins.includes(parsed.hostname);
  } catch {
    return false;
  }
}
