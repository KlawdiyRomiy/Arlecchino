import { useCallback, useEffect, useRef } from "react";

import {
  type BrowserPreviewTarget,
  isAllowedPreviewUrl,
  useBrowserPreviewStore,
} from "../stores/browserPreviewStore";
import { useExplorerStore } from "../stores/explorerStore";
import {
  type OpenPreviewWindowInput,
  usePreviewWindowStore,
} from "../stores/previewWindowStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface BrowserPreviewBridgeOptions {
  openPreviewWindow: (input: OpenPreviewWindowInput) => {
    opened: boolean;
    id?: string;
    reason?: string;
  };
  focusPreviewWindow: (id: string) => void;
  closePreviewWindow: (id: string) => void;
}

interface OpenTerminalPreviewInput {
  sessionId: string;
  url: string;
  forceOpen?: boolean;
}

interface OpenTerminalPreviewSignalOptions {
  sessionId: string;
  url: string;
  projectPath: string;
  autoOpenFromTerminal: boolean;
  reuseWindowPerSession: boolean;
  allowedOrigins: string[];
  rememberProjectTarget: (
    projectPath: string,
    target: BrowserPreviewTarget,
  ) => void;
  openPreviewWindow: (input: OpenPreviewWindowInput) => {
    opened: boolean;
    id?: string;
    reason?: string;
  };
  focusPreviewWindow: (id: string) => void;
  autoOpenedWindowIds?: Map<string, string>;
  forceOpen?: boolean;
}

export const buildTerminalPreviewWindowId = (sessionId: string): string =>
  `terminal-preview:${sessionId}`;

const buildPreviewWindowTitle = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.host ? `Preview ${parsed.host}` : "Browser Preview";
  } catch {
    return "Browser Preview";
  }
};

const buildPreviewWindowInput = (
  sessionId: string,
  url: string,
  reuseWindowPerSession: boolean,
): OpenPreviewWindowInput => {
  const title = buildPreviewWindowTitle(url);

  return {
    id: reuseWindowPerSession
      ? buildTerminalPreviewWindowId(sessionId)
      : undefined,
    surface: "browser",
    title,
    payload: { title, url },
    side: "right",
    mode: "snapped",
  };
};

export function openTerminalPreviewSignal({
  sessionId,
  url,
  projectPath,
  autoOpenFromTerminal,
  reuseWindowPerSession,
  allowedOrigins,
  rememberProjectTarget,
  openPreviewWindow,
  focusPreviewWindow,
  autoOpenedWindowIds,
  forceOpen = false,
}: OpenTerminalPreviewSignalOptions): string | null {
  const normalizedUrl = url.trim();
  if (
    !sessionId ||
    normalizedUrl === "" ||
    !isAllowedPreviewUrl(normalizedUrl, allowedOrigins)
  ) {
    return null;
  }

  if (projectPath) {
    rememberProjectTarget(projectPath, {
      url: normalizedUrl,
      sessionId,
      source: "terminal",
      updatedAt: Date.now(),
    });
  }

  if (!forceOpen && !autoOpenFromTerminal) {
    return null;
  }

  const input = buildPreviewWindowInput(
    sessionId,
    normalizedUrl,
    reuseWindowPerSession,
  );
  const openResult = openPreviewWindow(input);
  if (!openResult.opened) {
    return null;
  }

  const windowId = openResult.id ?? input.id ?? null;
  if (!windowId) {
    return null;
  }

  focusPreviewWindow(windowId);
  if (!forceOpen && autoOpenFromTerminal && autoOpenedWindowIds) {
    autoOpenedWindowIds.set(sessionId, windowId);
  }

  return windowId;
}

export function useBrowserPreviewBridge({
  openPreviewWindow,
  focusPreviewWindow,
  closePreviewWindow,
}: BrowserPreviewBridgeOptions) {
  const sessionSemanticEntries = useTerminalStore(
    (state) => state.sessionSemanticEntries,
  );
  const sessions = useTerminalStore((state) => state.sessions);
  const explorerProjectPath = useExplorerStore((state) => state.projectPath);
  const workspaceProjectPath = useWorkspaceStore((state) => {
    const activeProject = state.projects.find(
      (project) => project.id === state.activeId,
    );
    return activeProject?.path ?? "";
  });
  const {
    autoOpenFromTerminal,
    reuseWindowPerSession,
    closeAutoOpenedOnTerminalExit,
    allowedOrigins,
    rememberProjectTarget,
  } = useBrowserPreviewStore();
  const projectPath = explorerProjectPath || workspaceProjectPath;

  const processedTimestampsRef = useRef<Map<string, number>>(new Map());
  const autoOpenedWindowIdsRef = useRef<Map<string, string>>(new Map());

  const openPreviewFromTerminal = useCallback(
    ({ sessionId, url, forceOpen = false }: OpenTerminalPreviewInput) => {
      return openTerminalPreviewSignal({
        sessionId,
        url,
        projectPath,
        autoOpenFromTerminal,
        reuseWindowPerSession,
        allowedOrigins,
        rememberProjectTarget,
        openPreviewWindow,
        focusPreviewWindow,
        autoOpenedWindowIds: autoOpenedWindowIdsRef.current,
        forceOpen,
      });
    },
    [
      allowedOrigins,
      autoOpenFromTerminal,
      focusPreviewWindow,
      openPreviewWindow,
      projectPath,
      rememberProjectTarget,
      reuseWindowPerSession,
    ],
  );

  useEffect(() => {
    sessionSemanticEntries.forEach((entries, sessionId) => {
      const lastProcessedAt =
        processedTimestampsRef.current.get(sessionId) ?? 0;
      let nextProcessedAt = lastProcessedAt;
      let latestPreviewUrl = "";

      for (const entry of entries) {
        if (
          entry.timestamp <= lastProcessedAt ||
          entry.kind !== "preview_url"
        ) {
          continue;
        }

        nextProcessedAt = Math.max(nextProcessedAt, entry.timestamp);
        if (entry.message.trim()) {
          latestPreviewUrl = entry.message;
        }
      }

      if (nextProcessedAt > lastProcessedAt) {
        processedTimestampsRef.current.set(sessionId, nextProcessedAt);
      }

      if (latestPreviewUrl) {
        openPreviewFromTerminal({ sessionId, url: latestPreviewUrl });
      }
    });
  }, [openPreviewFromTerminal, sessionSemanticEntries]);

  useEffect(() => {
    const activeSessionIds = new Set(Array.from(sessions.keys()));

    autoOpenedWindowIdsRef.current.forEach((windowId, sessionId) => {
      if (activeSessionIds.has(sessionId)) {
        return;
      }

      if (closeAutoOpenedOnTerminalExit) {
        closePreviewWindow(windowId);
      }

      autoOpenedWindowIdsRef.current.delete(sessionId);
      processedTimestampsRef.current.delete(sessionId);
    });

    processedTimestampsRef.current.forEach((_timestamp, sessionId) => {
      if (!activeSessionIds.has(sessionId)) {
        processedTimestampsRef.current.delete(sessionId);
      }
    });
  }, [closeAutoOpenedOnTerminalExit, closePreviewWindow, sessions]);

  return { openPreviewFromTerminal };
}
