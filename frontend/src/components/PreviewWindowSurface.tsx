import React, { useEffect, useId, useMemo, useReducer, useState } from "react";

import { GetLocalPreviewURL, ReadFile } from "../wails/app";
import { useTheme } from "../hooks/useTheme";
import { useEditorStore } from "../stores/editorStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { useExplorerStore } from "../stores/explorerStore";
import { useTerminalStore } from "../stores/terminalStore";
import { getThemeColors } from "../styles/colors";
import { themeOptions as builtInThemeOptions } from "../styles/themes";
import type { Theme } from "../types/theme";
import { MAX_UI_SCALE, MIN_UI_SCALE, UI_SCALE_STEP } from "../utils/uiScale";
import { AIChatPanelContent } from "./AIChatPanel";
import { BrowserPreview } from "./BrowserPreview";
import { CodePanelSurface } from "./CodePanelSurface";
import { GitPanel } from "./GitPanel";
import type {
  AppearancePreviewState,
  PreviewWindow,
} from "../stores/previewWindowStore";

interface PreviewWindowSurfaceProps {
  window: PreviewWindow;
  appearancePreview: AppearancePreviewState | null;
  currentTheme: Theme;
  currentUiScale: number;
  onAppearancePatch: (patch: { theme?: Theme; uiScale?: number }) => void;
  onAppearanceApply: () => void;
  onAppearanceCancel: () => void;
  onFileOpen?: (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => void;
}

type PreviewFileState = {
  content: string | null;
  isLoading: boolean;
  error: string | null;
};

type PreviewFileAction =
  { type: "replace"; state: PreviewFileState } | { type: "loading" };

type BrowserLocalPreviewState = {
  path: string;
  url: string | null;
  error: string | null;
};

const initialPreviewFileState: PreviewFileState = {
  content: null,
  isLoading: false,
  error: null,
};

const previewFileReducer = (
  state: PreviewFileState,
  action: PreviewFileAction,
): PreviewFileState => {
  switch (action.type) {
    case "replace":
      return action.state;
    case "loading":
      return { content: state.content, isLoading: true, error: null };
    default:
      return state;
  }
};

const codePreviewContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const codePreviewBodyStyle: React.CSSProperties = {
  margin: 0,
  padding: "12px",
  overflow: "auto",
  flex: 1,
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 12,
  lineHeight: 1.55,
};

const appearanceContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  padding: 12,
  gap: 12,
};

const appearanceControlStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const appearanceButtonRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: "auto",
};

const terminalPreviewContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  alignItems: "center",
  gap: 10,
  padding: 16,
  textAlign: "center",
};

const terminalPreviewButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border-subtle)",
  background: "var(--bg-secondary)",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
};

const buildBrowserPreviewStatusDocument = (
  title: string,
  message: string,
): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapePreviewStatusText(title)}</title>
    <style>
      :root {
        color-scheme: light dark;
        --preview-bg: #f6f6f7;
        --panel-bg: rgba(255, 255, 255, 0.74);
        --panel-border: rgba(17, 24, 39, 0.12);
        --panel-text: #24272d;
        --panel-muted: #69707d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: var(--preview-bg);
        color: var(--panel-text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
      }
      main {
        width: min(520px, calc(100vw - 32px));
        padding: 20px 22px;
        border: 1px solid var(--panel-border);
        border-radius: 18px;
        background: var(--panel-bg);
        box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
      }
      h1 { margin: 0 0 10px; font-size: 20px; line-height: 1.25; }
      p { margin: 0; color: var(--panel-muted); line-height: 1.6; }
      @media (prefers-color-scheme: dark) {
        :root {
          --preview-bg: #101112;
          --panel-bg: rgba(31, 32, 34, 0.74);
          --panel-border: rgba(255, 255, 255, 0.11);
          --panel-text: #f2f3f5;
          --panel-muted: #9ca3af;
        }
        main {
          box-shadow: 0 20px 54px rgba(0, 0, 0, 0.34);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapePreviewStatusText(title)}</h1>
      <p>${escapePreviewStatusText(message)}</p>
    </main>
  </body>
</html>`;

const buildBrowserPreviewLoadingDocument = (): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Loading preview</title>
    <style>
      :root {
        color-scheme: light dark;
        --preview-bg: #f6f6f7;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--preview-bg);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --preview-bg: #101112;
        }
      }
    </style>
  </head>
  <body aria-busy="true"></body>
</html>`;

function escapePreviewStatusText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const PreviewWindowSurface: React.FC<PreviewWindowSurfaceProps> = ({
  window: previewWindow,
  appearancePreview,
  currentTheme,
  currentUiScale,
  onAppearancePatch,
  onAppearanceApply,
  onAppearanceCancel,
  onFileOpen,
}) => {
  const { isDark } = useTheme();
  const palette = getThemeColors(isDark);
  const aiPanelEnabled = useEditorSettingsStore(
    (state) => state.aiPanelEnabled,
  );
  const projectPath = useExplorerStore((state) => state.projectPath);
  const focusActiveTerminal = useTerminalStore(
    (state) => state.focusActiveTerminal,
  );
  const activePaneId = useEditorStore((state) => state.activePaneId);
  const activeTab = useEditorStore((state) => state.getActiveTab(activePaneId));
  const tabs = useEditorStore((state) => state.tabs);
  const [fileState, dispatchFileState] = useReducer(
    previewFileReducer,
    initialPreviewFileState,
  );
  const [browserLocalPreviewState, setBrowserLocalPreviewState] =
    useState<BrowserLocalPreviewState>({
      path: "",
      url: null,
      error: null,
    });
  const appearanceThemeSelectId = useId();
  const appearanceScaleInputId = useId();

  const filePath =
    typeof previewWindow.payload.path === "string"
      ? previewWindow.payload.path
      : "";

  useEffect(() => {
    let cancelled = false;

    if (previewWindow.surface !== "file" && previewWindow.surface !== "code") {
      dispatchFileState({ type: "replace", state: initialPreviewFileState });
      return;
    }

    const inlineContent =
      typeof previewWindow.payload.content === "string"
        ? previewWindow.payload.content
        : "";

    if (inlineContent.length > 0) {
      dispatchFileState({
        type: "replace",
        state: { content: inlineContent, isLoading: false, error: null },
      });
      return;
    }

    if (!filePath) {
      dispatchFileState({
        type: "replace",
        state: {
          content: activeTab?.content ?? "",
          isLoading: false,
          error: null,
        },
      });
      return;
    }

    dispatchFileState({ type: "loading" });

    ReadFile(filePath)
      .then((content) => {
        if (cancelled) {
          return;
        }
        dispatchFileState({
          type: "replace",
          state: { content, isLoading: false, error: null },
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        dispatchFileState({
          type: "replace",
          state: { content: null, isLoading: false, error: message },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab?.content,
    filePath,
    previewWindow.payload.content,
    previewWindow.surface,
  ]);

  const previewCode = useMemo(() => {
    const matchedTab = filePath
      ? Array.from(tabs.values()).find((tab) => tab.path === filePath)
      : null;

    if (
      typeof previewWindow.payload.content === "string" &&
      previewWindow.payload.content.length > 0
    ) {
      return previewWindow.payload.content;
    }
    if (matchedTab?.content) {
      return matchedTab.content;
    }
    if (typeof fileState.content === "string") {
      return fileState.content;
    }
    if (activeTab?.content) {
      return activeTab.content;
    }
    return "";
  }, [
    activeTab?.content,
    filePath,
    fileState.content,
    tabs,
    previewWindow.payload.content,
  ]);

  const codeLanguage = useMemo(() => {
    if (typeof previewWindow.payload.language === "string") {
      return previewWindow.payload.language;
    }
    if (filePath.includes(".")) {
      return filePath.split(".").pop() || "";
    }
    return activeTab?.language || "";
  }, [activeTab?.language, filePath, previewWindow.payload.language]);

  const appearanceTheme = appearancePreview?.theme ?? currentTheme;
  const appearanceScale = appearancePreview?.uiScale ?? currentUiScale;

  const isLocalStaticBrowserPreview =
    previewWindow.surface === "browser" &&
    previewWindow.payload.previewMode === "local-static" &&
    filePath.trim().length > 0;

  useEffect(() => {
    let cancelled = false;

    if (!isLocalStaticBrowserPreview) {
      setBrowserLocalPreviewState({
        path: "",
        url: null,
        error: null,
      });
      return;
    }

    setBrowserLocalPreviewState({
      path: filePath,
      url: null,
      error: null,
    });

    GetLocalPreviewURL(filePath)
      .then((result) => {
        if (cancelled) {
          return;
        }
        setBrowserLocalPreviewState({
          path: filePath,
          url: result.url,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setBrowserLocalPreviewState({
          path: filePath,
          url: null,
          error: message,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, isLocalStaticBrowserPreview, previewWindow.payload.revision]);

  if (previewWindow.surface === "browser") {
    const hasLocalPreviewStateForFile =
      isLocalStaticBrowserPreview && browserLocalPreviewState.path === filePath;
    const localPreviewLoading =
      isLocalStaticBrowserPreview &&
      (!hasLocalPreviewStateForFile ||
        (!browserLocalPreviewState.url && !browserLocalPreviewState.error));
    const localPreviewError =
      hasLocalPreviewStateForFile && browserLocalPreviewState.error
        ? browserLocalPreviewState.error
        : null;
    const localPreviewUrl =
      hasLocalPreviewStateForFile && browserLocalPreviewState.url
        ? browserLocalPreviewState.url
        : undefined;
    const browserUrl =
      typeof previewWindow.payload.url === "string" &&
      previewWindow.payload.url.trim()
        ? previewWindow.payload.url
        : localPreviewUrl;
    const localPreviewStatusDocument =
      isLocalStaticBrowserPreview && !localPreviewUrl
        ? localPreviewError
          ? buildBrowserPreviewStatusDocument(
              "Preview unavailable",
              localPreviewError,
            )
          : buildBrowserPreviewLoadingDocument()
        : undefined;
    const htmlContent =
      typeof previewWindow.payload.htmlContent === "string" &&
      previewWindow.payload.htmlContent.trim()
        ? previewWindow.payload.htmlContent
        : localPreviewStatusDocument;
    const sourceLabel =
      typeof previewWindow.payload.sourceLabel === "string" &&
      previewWindow.payload.sourceLabel.trim()
        ? previewWindow.payload.sourceLabel
        : undefined;
    const revision =
      typeof previewWindow.payload.revision === "number" &&
      Number.isFinite(previewWindow.payload.revision)
        ? previewWindow.payload.revision
        : undefined;

    return (
      <BrowserPreview
        initialUrl={browserUrl}
        currentUrl={browserUrl}
        htmlContent={htmlContent}
        sourceLabel={sourceLabel}
        revision={revision}
        loading={localPreviewLoading}
      />
    );
  }

  if (previewWindow.surface === "git") {
    return (
      <GitPanel
        projectPath={projectPath}
        panelPosition={previewWindow.position}
        onFileOpen={(path) => {
          onFileOpen?.(path, "", path.split("/").pop() || path);
        }}
      />
    );
  }

  if (previewWindow.surface === "chat") {
    return aiPanelEnabled ? (
      <AIChatPanelContent presentation="preview" projectPath={projectPath} />
    ) : null;
  }

  if (previewWindow.surface === "terminal") {
    return (
      <div style={terminalPreviewContainerStyle}>
        <div style={{ fontSize: 13, color: palette.textPrimary }}>
          Terminal preview is synchronized with the main terminal panel.
        </div>
        <div style={{ fontSize: 12, color: palette.textSecondary }}>
          Use the shared terminal panel to avoid rendering conflicts and
          flicker.
        </div>
        <button
          type="button"
          style={{ ...terminalPreviewButtonStyle, color: palette.textPrimary }}
          onClick={focusActiveTerminal}
        >
          Focus active terminal
        </button>
      </div>
    );
  }

  if (previewWindow.surface === "appearance") {
    return (
      <div style={appearanceContainerStyle}>
        <div
          style={{
            fontSize: 12,
            color: palette.textSecondary,
            lineHeight: 1.5,
          }}
        >
          Live preview updates IDE visuals immediately. Apply keeps global
          settings, cancel restores checkpoint.
        </div>

        <div style={appearanceControlStyle}>
          <label
            htmlFor={appearanceThemeSelectId}
            style={{ fontSize: 12, color: palette.textSecondary }}
          >
            Theme
          </label>
          <select
            id={appearanceThemeSelectId}
            value={appearanceTheme}
            onChange={(event) => {
              onAppearancePatch({ theme: event.currentTarget.value as Theme });
            }}
            style={{
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-secondary)",
              color: palette.textPrimary,
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <option value="system">System</option>
            {builtInThemeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div style={appearanceControlStyle}>
          <label
            htmlFor={appearanceScaleInputId}
            style={{ fontSize: 12, color: palette.textSecondary }}
          >
            UI scale ({appearanceScale.toFixed(2)}x)
          </label>
          <input
            id={appearanceScaleInputId}
            type="range"
            min={MIN_UI_SCALE}
            max={MAX_UI_SCALE}
            step={UI_SCALE_STEP}
            value={appearanceScale}
            onChange={(event) => {
              onAppearancePatch({ uiScale: Number(event.currentTarget.value) });
            }}
          />
        </div>

        <div style={appearanceButtonRowStyle}>
          <button
            type="button"
            style={{
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-secondary)",
              color: palette.textPrimary,
              borderRadius: 8,
              padding: "8px 10px",
              cursor: "pointer",
            }}
            onClick={onAppearanceCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              border: "1px solid var(--border-subtle)",
              background: "var(--color-primary)",
              color: "white",
              borderRadius: 8,
              padding: "8px 10px",
              cursor: "pointer",
            }}
            onClick={onAppearanceApply}
          >
            Apply globally
          </button>
        </div>
      </div>
    );
  }

  if (previewWindow.surface === "code" || previewWindow.surface === "file") {
    if (!filePath) {
      return (
        <pre
          style={{
            ...codePreviewBodyStyle,
            color: palette.textPrimary,
            background: "transparent",
          }}
        >
          {previewCode || "No file content available"}
        </pre>
      );
    }

    if (fileState.isLoading) {
      return (
        <pre
          style={{
            ...codePreviewBodyStyle,
            color: palette.textSecondary,
            background: "transparent",
          }}
        >
          Loading file preview...
        </pre>
      );
    }

    if (fileState.error) {
      return (
        <pre
          style={{
            ...codePreviewBodyStyle,
            color: palette.textPrimary,
            background: "transparent",
          }}
        >
          {`Failed to load file: ${fileState.error}`}
        </pre>
      );
    }

    return (
      <CodePanelSurface
        path={filePath}
        name={filePath.split("/").pop() || filePath}
        language={codeLanguage}
        initialContent={previewCode}
        completionProviderMode="full"
      />
    );
  }

  return (
    <div style={codePreviewContainerStyle}>
      <pre
        style={{
          ...codePreviewBodyStyle,
          color: palette.textPrimary,
          background: "transparent",
        }}
      >
        {fileState.isLoading
          ? "Loading file preview..."
          : fileState.error
            ? `Failed to load file: ${fileState.error}`
            : previewCode || "No file content available"}
      </pre>
    </div>
  );
};
