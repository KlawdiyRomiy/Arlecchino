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
        const legacyKey = normalizeProjectPathKey(projectPath);
        const key = projectPathStorageKey(projectPath);
        const persistedTarget = sanitizePreviewTargetForStorage(target);
        if (!key || !persistedTarget) {
          return;
        }

        set((state) => {
          const { [legacyKey]: _legacy, ...rest } =
            state.lastKnownTargetByProject;
          return {
            lastKnownTargetByProject: {
              ...rest,
              [key]: persistedTarget,
            },
          };
        });
      },
      getLastKnownTarget: (projectPath) => {
        const key = projectPathStorageKey(projectPath);
        if (!key) {
          return null;
        }
        const legacyKey = normalizeProjectPathKey(projectPath);
        const targets = get().lastKnownTargetByProject;
        return (
          sanitizePreviewTargetForStorage(targets[key]) ??
          sanitizePreviewTargetForStorage(targets[legacyKey])
        );
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
        lastKnownTargetByProject: sanitizedPersistedTargets(
          state.lastKnownTargetByProject,
        ),
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

export function projectPathStorageKey(projectPath: string): string {
  const normalized = normalizeProjectPathKey(projectPath);
  if (!normalized) {
    return "";
  }
  return `project:${stablePathHash(normalized)}`;
}

function isProjectPathStorageKey(key: string): boolean {
  return key.startsWith("project:");
}

function stablePathHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
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

function sanitizedPersistedTargets(
  targets: Record<string, BrowserPreviewTarget>,
): Record<string, BrowserPreviewTarget> {
  return Object.fromEntries(
    Object.entries(targets).flatMap(([key, target]) => {
      if (!isProjectPathStorageKey(key)) {
        return [];
      }
      const sanitized = sanitizePreviewTargetForStorage(target);
      return sanitized ? [[key, sanitized]] : [];
    }),
  );
}

function sanitizePreviewTargetForStorage(
  target: BrowserPreviewTarget | undefined,
): BrowserPreviewTarget | null {
  if (!target || !isAllowedPreviewUrl(target.url)) {
    return null;
  }
  try {
    const parsed = new URL(target.url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return {
      url: parsed.toString(),
      source: target.source,
      updatedAt: target.updatedAt,
    };
  } catch {
    return null;
  }
}
