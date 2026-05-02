import React from "react";
import {
  AlertCircle,
  BookOpen,
  FileText,
  FolderTree,
  GitBranch,
  Sparkles,
  Terminal,
} from "lucide-react";
import { AIChatPanelContent } from "../AIChatPanel";
import { CodePanelSurface } from "../CodePanelSurface";
import { FileExplorer } from "../FileExplorer";
import { GitPanel } from "../GitPanel";
import { MarkdownPreviewPanelContent } from "../MarkdownPreviewPanelContent";
import { ProblemsPanel } from "../problems/ProblemsPanel";
import { TerminalPanelContent } from "../TerminalPanel";
import {
  FloatingPanel,
  type FloatingPanelProps,
  type PanelPosition,
} from "../ui/FloatingPanel";
import type { PreviewWindow } from "../../stores/previewWindowStore";
import type {
  CodePanelTab,
  MarkdownPreviewSource,
  PanelConfig,
  PanelConfigs,
  PanelId,
  PanelOpenRequest,
  PanelVisibility,
  ZenPinnedPanels,
} from "./MainLayout.types";
import { SNAPPED_PANEL_OUTER_GAP } from "../../utils/layoutHelpers";
import { CodePanelTabs } from "./CodePanelTabs";

type PanelHostMode = "overlay" | "flow";
type PanelResizeUpdates = {
  width: number;
  height: number;
  x?: number;
  y?: number;
};
type OpenTerminalPreviewInput = {
  sessionId: string;
  url: string;
  forceOpen?: boolean;
};

interface MainLayoutPanelRendererProps {
  panelId: PanelId;
  hostMode?: PanelHostMode;
  panels: PanelVisibility;
  zenPinnedPanels: ZenPinnedPanels;
  zenModeEnabled: boolean;
  panelConfigs: PanelConfigs;
  previewWindows: PreviewWindow[];
  dropTargetPosition: PanelPosition | null;
  draggingPanel: PanelId | null;
  draggingPreviewWindowId: string | null;
  relocatingPanelIds: PanelId[];
  uiScale: number;
  activeProjectPath: string;
  activeStatusFilePath: string | null;
  activeEditorTabPath: string | null;
  activeCodePanelTab: CodePanelTab | null;
  codePanelTabs: CodePanelTab[];
  markdownPreviewSource: MarkdownPreviewSource | null;
  tuiModeActive: boolean;
  tuiTerminalPaneStyle: React.CSSProperties;
  terminalZIndex?: number;
  isLogicalFullscreenPanel: (config: PanelConfig) => boolean;
  onPanelResize: (panelId: PanelId, updates: PanelResizeUpdates) => void;
  onPanelResizeStart: (panelId: PanelId) => void;
  onPanelResizeEnd: (panelId: PanelId) => void;
  onPanelDragStart: NonNullable<FloatingPanelProps["onDragStart"]>;
  onPanelDragMove: NonNullable<FloatingPanelProps["onDragMove"]>;
  onPanelDragEnd: NonNullable<FloatingPanelProps["onDragEnd"]>;
  onTogglePanel: (panelId: PanelId) => void;
  onCloseTerminalPanel: () => void;
  onTerminalFullscreen: () => void;
  onGitFullscreen: () => void;
  onProblemsFullscreen: () => void;
  onMarkdownPreviewFullscreen: () => void;
  onMarkdownLinkPreviewOpen: (url: string) => void;
  onFileOpen: (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => void;
  onFileOpenInPanel: (
    path: string,
    name: string,
    line?: number,
    request?: Partial<PanelOpenRequest>,
  ) => void | Promise<void>;
  onOpenFileFromPath: (path: string, line?: number) => void;
  onOpenPreviewFromTerminal: (input: OpenTerminalPreviewInput) => void;
  onPerspectiveOpen: () => void;
  onPerspectiveClose: () => void;
  onGitDiffFocusChange: (active: boolean) => void;
  onCodePanelActivate: (path: string) => void;
  onZenPinToggle: (panelId: PanelId) => void;
}

export const MainLayoutPanelRenderer: React.FC<
  MainLayoutPanelRendererProps
> = ({
  panelId,
  hostMode = "overlay",
  panels,
  zenPinnedPanels,
  zenModeEnabled,
  panelConfigs,
  previewWindows,
  dropTargetPosition,
  draggingPanel,
  draggingPreviewWindowId,
  relocatingPanelIds,
  uiScale,
  activeProjectPath,
  activeStatusFilePath,
  activeEditorTabPath,
  activeCodePanelTab,
  codePanelTabs,
  markdownPreviewSource,
  tuiModeActive,
  tuiTerminalPaneStyle,
  terminalZIndex,
  isLogicalFullscreenPanel,
  onPanelResize,
  onPanelResizeStart,
  onPanelResizeEnd,
  onPanelDragStart,
  onPanelDragMove,
  onPanelDragEnd,
  onTogglePanel,
  onCloseTerminalPanel,
  onTerminalFullscreen,
  onGitFullscreen,
  onProblemsFullscreen,
  onMarkdownPreviewFullscreen,
  onMarkdownLinkPreviewOpen,
  onFileOpen,
  onFileOpenInPanel,
  onOpenFileFromPath,
  onOpenPreviewFromTerminal,
  onPerspectiveOpen,
  onPerspectiveClose,
  onGitDiffFocusChange,
  onCodePanelActivate,
  onZenPinToggle,
}) => {
  const isVisible = panels[panelId];
  const config = panelConfigs[panelId];
  const isDropTarget =
    config.mode === "snapped" &&
    dropTargetPosition === config.position &&
    ((draggingPanel !== null && draggingPanel !== panelId) ||
      draggingPreviewWindowId !== null);
  const isFullscreen = isLogicalFullscreenPanel(config);

  const getAdjacentPanels = () => {
    const adjacent: {
      left?: number;
      right?: number;
      bottom?: number;
      top?: number;
    } = {};

    (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
      if (id !== panelId && panels[id]) {
        const otherConfig = panelConfigs[id];
        if (otherConfig.mode === "snapped") {
          if (otherConfig.position === "left")
            adjacent.left = otherConfig.size.width + SNAPPED_PANEL_OUTER_GAP;
          if (otherConfig.position === "right")
            adjacent.right = otherConfig.size.width + SNAPPED_PANEL_OUTER_GAP;
          if (otherConfig.position === "bottom")
            adjacent.bottom = otherConfig.size.height + SNAPPED_PANEL_OUTER_GAP;
          if (otherConfig.position === "top")
            adjacent.top = otherConfig.size.height + SNAPPED_PANEL_OUTER_GAP;
        }
      }
    });

    previewWindows.forEach((windowState) => {
      if (windowState.mode !== "snapped") {
        return;
      }

      if (windowState.position === "left") {
        adjacent.left = Math.max(
          adjacent.left ?? 0,
          windowState.width + SNAPPED_PANEL_OUTER_GAP,
        );
      }
      if (windowState.position === "right") {
        adjacent.right = Math.max(
          adjacent.right ?? 0,
          windowState.width + SNAPPED_PANEL_OUTER_GAP,
        );
      }
      if (windowState.position === "bottom") {
        adjacent.bottom = Math.max(
          adjacent.bottom ?? 0,
          windowState.height + SNAPPED_PANEL_OUTER_GAP,
        );
      }
      if (windowState.position === "top") {
        adjacent.top = Math.max(
          adjacent.top ?? 0,
          windowState.height + SNAPPED_PANEL_OUTER_GAP,
        );
      }
    });

    return adjacent;
  };

  const panelProps = {
    position: config.position,
    size: config.size,
    mode: config.mode,
    hostMode,
    x: config.x,
    y: config.y,
    isVisible,
    onResize: (updates: PanelResizeUpdates) => onPanelResize(panelId, updates),
    onResizeStart: () => onPanelResizeStart(panelId),
    onResizeEnd: () => onPanelResizeEnd(panelId),
    onDragStart: onPanelDragStart,
    onDragMove: onPanelDragMove,
    onDragEnd: onPanelDragEnd,
    onClose: () => onTogglePanel(panelId),
    isDropTarget,
    activeDropTargetPosition:
      draggingPanel === panelId ? dropTargetPosition : null,
    adjacentPanels: getAdjacentPanels(),
    uiScale,
    isFullscreen,
    isRelocating: relocatingPanelIds.includes(panelId),
    zenModeEnabled,
    isZenPinned: zenPinnedPanels[panelId],
    onZenPinToggle: () => onZenPinToggle(panelId),
  };

  switch (panelId) {
    case "explorer":
      return (
        <FloatingPanel
          key={panelId}
          id="explorer"
          title="Explorer"
          icon={<FolderTree size={16} />}
          minSize={200}
          maxSize={500}
          {...panelProps}
        >
          <FileExplorer
            projectPath={activeProjectPath}
            onFileOpen={onFileOpen}
            onFileOpenInPanel={onFileOpenInPanel}
            isHorizontal={
              config.position === "bottom" || config.position === "top"
            }
            onPerspectiveOpen={onPerspectiveOpen}
            onPerspectiveClose={onPerspectiveClose}
          />
        </FloatingPanel>
      );
    case "terminal":
      return (
        <FloatingPanel
          key={panelId}
          id="terminal"
          title="Terminal"
          icon={<Terminal size={16} />}
          minSize={150}
          maxSize={800}
          {...panelProps}
          onClose={onCloseTerminalPanel}
          useViewportPositioning={tuiModeActive}
          zIndex={terminalZIndex}
          onFullscreen={onTerminalFullscreen}
        >
          {tuiModeActive ? (
            <div style={tuiTerminalPaneStyle}>
              <TerminalPanelContent
                onOpenFileRef={(path, line) => {
                  void onOpenFileFromPath(path, line);
                }}
                onOpenPreviewUrl={(url, sessionId) => {
                  onOpenPreviewFromTerminal({
                    url,
                    sessionId,
                    forceOpen: true,
                  });
                }}
              />
            </div>
          ) : (
            <TerminalPanelContent
              onOpenFileRef={(path, line) => {
                void onOpenFileFromPath(path, line);
              }}
              onOpenPreviewUrl={(url, sessionId) => {
                onOpenPreviewFromTerminal({ url, sessionId, forceOpen: true });
              }}
            />
          )}
        </FloatingPanel>
      );
    case "aiChat":
      return (
        <FloatingPanel
          key={panelId}
          id="aiChat"
          title="AI Assistant"
          icon={<Sparkles size={16} />}
          minSize={280}
          maxSize={600}
          {...panelProps}
        >
          <AIChatPanelContent />
        </FloatingPanel>
      );
    case "git":
      return (
        <FloatingPanel
          key={panelId}
          id="git"
          title="Git"
          icon={<GitBranch size={16} />}
          minSize={200}
          maxSize={1400}
          {...panelProps}
          onFullscreen={onGitFullscreen}
        >
          <GitPanel
            projectPath={activeProjectPath}
            panelPosition={config.position}
            onDiffFocusChange={onGitDiffFocusChange}
            presentationMode={isFullscreen ? "expanded" : "compact"}
            onFileOpen={(path) => {
              void onOpenFileFromPath(path);
            }}
          />
        </FloatingPanel>
      );
    case "problems":
      return (
        <FloatingPanel
          key={panelId}
          id="problems"
          title="Problems"
          icon={<AlertCircle size={16} />}
          minSize={320}
          maxSize={1400}
          {...panelProps}
          onFullscreen={onProblemsFullscreen}
        >
          <ProblemsPanel
            activeFilePath={activeStatusFilePath ?? activeEditorTabPath}
            onNavigate={(path, line, _column) => onOpenFileFromPath(path, line)}
            presentationMode={isFullscreen ? "expanded" : "compact"}
          />
        </FloatingPanel>
      );
    case "code":
      return (
        <FloatingPanel
          key={panelId}
          id="code"
          title={
            activeCodePanelTab ? `${activeCodePanelTab.name} (Code)` : "Code"
          }
          icon={<FileText size={16} />}
          minSize={320}
          maxSize={900}
          {...panelProps}
        >
          {activeCodePanelTab ? (
            <div className="flex h-full min-h-0 w-full flex-col">
              <CodePanelTabs
                tabs={codePanelTabs}
                activePath={activeCodePanelTab.path}
                onActivate={onCodePanelActivate}
              />
              <div className="min-h-0 flex-1">
                <CodePanelSurface
                  key={activeCodePanelTab.path}
                  path={activeCodePanelTab.path}
                  name={activeCodePanelTab.name}
                  initialContent={activeCodePanelTab.content}
                  language={activeCodePanelTab.language}
                  loadState={activeCodePanelTab.loadState}
                />
              </div>
            </div>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-sm text-[var(--text-muted)]">
              Open file from Explorer to start editing in panel
            </div>
          )}
        </FloatingPanel>
      );
    case "markdownPreview":
      return (
        <FloatingPanel
          key={panelId}
          id="markdownPreview"
          title={
            markdownPreviewSource
              ? `${markdownPreviewSource.name} (Preview)`
              : "Markdown Preview"
          }
          icon={<BookOpen size={16} />}
          minSize={320}
          maxSize={1100}
          {...panelProps}
          onFullscreen={onMarkdownPreviewFullscreen}
        >
          <MarkdownPreviewPanelContent
            source={markdownPreviewSource}
            onOpenExternalLinkPreview={onMarkdownLinkPreviewOpen}
          />
        </FloatingPanel>
      );
    default:
      return null;
  }
};
