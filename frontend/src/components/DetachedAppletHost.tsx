import React, { useMemo } from "react";

import { ProjectEntryActionsProvider } from "../contexts/ProjectEntryActionsContext";
import { useTerminalStore } from "../stores/terminalStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import * as AppFunctions from "../wails/app";
import { GitPanel } from "./GitPanel";
import { ProblemsPanel } from "./problems/ProblemsPanel";
import { PreviewWindowSurface } from "./PreviewWindowSurface";
import { TerminalPanelContent } from "./TerminalPanel";
import type {
  PreviewWindow,
  PreviewSurfaceType,
} from "../stores/previewWindowStore";
import type { PanelPosition } from "./ui/FloatingPanel";
import type { Theme } from "../types/theme";

interface DetachedAppletPayload {
  surfaceId?: string;
  previewWindowId?: string;
  role?: "preview" | "git-helper" | "problems-helper" | "terminal-helper";
  appletKind?: string;
  title?: string;
  pinned?: boolean;
  returnTarget?: {
    hostMode?: string;
    position?: string;
  };
  payload?: Record<string, string | number | boolean | undefined>;
}

const hostStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: "var(--bg-primary)",
};

const unsupportedStyle: React.CSSProperties = {
  margin: "auto",
  maxWidth: 420,
  padding: 20,
  color: "var(--text-secondary)",
  fontSize: 13,
  lineHeight: 1.5,
  textAlign: "center",
};

const helperHostStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
  padding: 12,
};

const helperContentStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: "hidden",
};

const decodeDetachedPayload = (): DetachedAppletPayload | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const encoded = new URLSearchParams(window.location.search).get(
    "arleDetachedHost",
  );
  if (!encoded) {
    return null;
  }
  try {
    const padded = encoded.padEnd(
      encoded.length + ((4 - (encoded.length % 4)) % 4),
      "=",
    );
    const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const payload = JSON.parse(decoded) as DetachedAppletPayload;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
};

const toPreviewSurface = (value: string | undefined): PreviewSurfaceType => {
  switch (value) {
    case "browser":
    case "file":
    case "code":
    case "git":
    case "chat":
    case "terminal":
    case "appearance":
      return value;
    default:
      return "browser";
  }
};

const buildDetachedPreviewWindow = (
  payload: DetachedAppletPayload,
): PreviewWindow => {
  const surface = toPreviewSurface(payload.appletKind);
  const now = Date.now();
  return {
    id: payload.previewWindowId || payload.surfaceId || "detached-preview",
    title: payload.title || "Detached Preview",
    surface,
    payload: { ...(payload.payload ?? {}) },
    position: "right",
    mode: "floating",
    width: 980,
    height: 720,
    x: 0,
    y: 0,
    isPinned: Boolean(payload.pinned),
    zIndex: 1,
    createdAt: now,
    updatedAt: now,
  };
};

const getPayloadString = (
  payload: DetachedAppletPayload | null,
  key: string,
): string | undefined => {
  const value = payload?.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const toPanelPosition = (value: string | undefined): PanelPosition => {
  switch (value) {
    case "left":
    case "right":
    case "top":
    case "bottom":
      return value;
    default:
      return "right";
  }
};

const DetachedHelperApplet: React.FC<{
  payload: DetachedAppletPayload;
}> = ({ payload }) => {
  const activeProjectPath = useWorkspaceStore((state) => {
    const activeProject = state.projects.find(
      (project) => project.id === state.activeId,
    );
    return activeProject?.path ?? "";
  });
  const projectPath =
    getPayloadString(payload, "projectPath") ||
    activeProjectPath ||
    useTerminalStore.getState().activeProjectPath ||
    "";
  const activeFilePath = getPayloadString(payload, "activeFilePath") ?? null;
  const panelPosition = toPanelPosition(payload.returnTarget?.position);
  const projectEntryActions = useMemo(
    () => ({
      projectPath,
      getRelativePath: (path: string) =>
        projectPath && path.startsWith(projectPath)
          ? path.slice(projectPath.length).replace(/^[/\\]+/, "")
          : path,
      copyText: async (text: string) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
      copyAbsolutePath: async (path: string) => {
        try {
          await navigator.clipboard.writeText(path);
          return true;
        } catch {
          return false;
        }
      },
      copyRelativePath: async (path: string) => {
        const relativePath =
          projectPath && path.startsWith(projectPath)
            ? path.slice(projectPath.length).replace(/^[/\\]+/, "")
            : path;
        try {
          await navigator.clipboard.writeText(relativePath);
          return true;
        } catch {
          return false;
        }
      },
      copyProjectPath: async () => {
        try {
          await navigator.clipboard.writeText(projectPath);
          return true;
        } catch {
          return false;
        }
      },
      revealEntry: async (path: string) => {
        try {
          await AppFunctions.RevealProjectEntry(path);
          return true;
        } catch {
          return false;
        }
      },
      requestCreateEntry: () => undefined,
      requestMoveEntry: async () => false,
      requestRenameEntry: () => undefined,
      requestTrashEntry: () => undefined,
      requestTrashEntries: () => undefined,
      undoProjectEntryOperation: async () => false,
      redoProjectEntryOperation: async () => false,
    }),
    [projectPath],
  );

  const openFileInMain = (path: string, line?: number, column?: number) => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:detached-open-file", {
        detail: { path, line, column },
      }),
    );
  };

  return (
    <ProjectEntryActionsProvider value={projectEntryActions}>
      <div style={helperHostStyle}>
        <div style={helperContentStyle}>
          {payload.role === "git-helper" ? (
            <GitPanel
              projectPath={projectPath}
              panelPosition={panelPosition}
              presentationMode="expanded"
              onDiffFocusChange={() => undefined}
              onFileOpen={(path) => openFileInMain(path)}
            />
          ) : payload.role === "problems-helper" ? (
            <ProblemsPanel
              activeFilePath={activeFilePath}
              presentationMode="expanded"
              onNavigate={(path, line, column) =>
                openFileInMain(path, line, column)
              }
            />
          ) : payload.role === "terminal-helper" ? (
            <TerminalPanelContent />
          ) : null}
        </div>
      </div>
    </ProjectEntryActionsProvider>
  );
};

export const DetachedAppletHost: React.FC<{
  currentTheme: Theme;
  currentUiScale: number;
}> = ({ currentTheme, currentUiScale }) => {
  const payload = useMemo(() => decodeDetachedPayload(), []);
  const windowState = useMemo(
    () =>
      payload && (!payload.role || payload.role === "preview")
        ? buildDetachedPreviewWindow(payload)
        : null,
    [payload],
  );

  if (!windowState) {
    if (
      payload?.role === "git-helper" ||
      payload?.role === "problems-helper" ||
      payload?.role === "terminal-helper"
    ) {
      return (
        <div style={hostStyle}>
          <DetachedHelperApplet payload={payload} />
        </div>
      );
    }

    return (
      <div style={hostStyle}>
        <div style={unsupportedStyle}>Detached applet payload is invalid.</div>
      </div>
    );
  }

  return (
    <div style={hostStyle}>
      <PreviewWindowSurface
        window={windowState}
        appearancePreview={null}
        currentTheme={currentTheme}
        currentUiScale={currentUiScale}
        onAppearancePatch={() => undefined}
        onAppearanceApply={() => undefined}
        onAppearanceCancel={() => undefined}
      />
    </div>
  );
};
