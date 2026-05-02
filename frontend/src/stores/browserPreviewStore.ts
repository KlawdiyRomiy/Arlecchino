import { create } from "zustand";
import { persist } from "zustand/middleware";

const STORAGE_KEY = "browser-preview-settings.v1";

const DEFAULT_ALLOWED_ORIGINS = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];
export type MarkdownLinkOpenMode = "browser" | "preview";

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
  markdownLinkOpenMode: MarkdownLinkOpenMode;
  allowedOrigins: string[];
  lastKnownTargetByProject: Record<string, BrowserPreviewTarget>;
}

interface BrowserPreviewStoreState extends BrowserPreviewSettings {
  setAutoOpenFromTerminal: (value: boolean) => void;
  setReuseWindowPerSession: (value: boolean) => void;
  setCloseAutoOpenedOnTerminalExit: (value: boolean) => void;
  setMarkdownLinkOpenMode: (value: MarkdownLinkOpenMode) => void;
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
      markdownLinkOpenMode: "browser",
      allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
      lastKnownTargetByProject: {},

      setAutoOpenFromTerminal: (value) => set({ autoOpenFromTerminal: value }),
      setReuseWindowPerSession: (value) =>
        set({ reuseWindowPerSession: value }),
      setCloseAutoOpenedOnTerminalExit: (value) =>
        set({ closeAutoOpenedOnTerminalExit: value }),
      setMarkdownLinkOpenMode: (value) => set({ markdownLinkOpenMode: value }),
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
        markdownLinkOpenMode: state.markdownLinkOpenMode,
        allowedOrigins: state.allowedOrigins,
        lastKnownTargetByProject: state.lastKnownTargetByProject,
      }),
    },
  ),
);

export function normalizeProjectPathKey(projectPath: string): string {
  const normalized = projectPath.trim().replace(/\\/g, "/");
  if (!normalized) {
    return "";
  }

  const withoutTrailingSeparators = normalized.replace(/\/+$/, "");
  return withoutTrailingSeparators || "/";
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
