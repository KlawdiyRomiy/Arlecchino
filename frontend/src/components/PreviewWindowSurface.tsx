import React, { useEffect, useId, useMemo, useReducer } from "react";

import { ReadFile } from "../wails/app";
import { useTheme } from "../hooks/useTheme";
import { useEditorStore } from "../stores/editorStore";
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
  | { type: "replace"; state: PreviewFileState }
  | { type: "loading" };

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

  if (previewWindow.surface === "browser") {
    const browserUrl =
      typeof previewWindow.payload.url === "string" &&
      previewWindow.payload.url.trim()
        ? previewWindow.payload.url
        : undefined;
    const htmlContent =
      typeof previewWindow.payload.htmlContent === "string" &&
      previewWindow.payload.htmlContent.trim()
        ? previewWindow.payload.htmlContent
        : undefined;
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
    return <AIChatPanelContent presentation="preview" />;
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
