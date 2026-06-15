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
import type { AIInlinePatchPreview } from "../../stores/aiInlinePatchStore";
import type { PanelSnapDragCallbacks } from "../../utils/panelSnapDrag";
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

const fullscreenCapablePanelIds = new Set<PanelId>([
  "terminal",
  "aiChat",
  "git",
  "problems",
  "code",
  "markdownPreview",
]);

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
  draggingFilePanel: boolean;
  relocatingPanelIds: PanelId[];
  fullscreenTransitionPanelIds: PanelId[];
  isSlotExiting?: boolean;
  uiScale: number;
  activeProjectPath: string;
  activeStatusFilePath: string | null;
  activeEditorTabPath: string | null;
  activeCodePanelTab: CodePanelTab | null;
  activeCodePanelPatchPreview: AIInlinePatchPreview | null;
  codePanelPatchBusyId: string | null;
  codePanelTabs: CodePanelTab[];
  markdownPreviewSource: MarkdownPreviewSource | null;
  tuiModeActive: boolean;
  tuiTerminalPaneStyle: React.CSSProperties;
  terminalZIndex?: number;
  snappedOverlayInsets?: { top: number; bottom: number };
  zenTopChromeAvoidanceTop?: number;
  motionPressureActive?: boolean;
  isLogicalFullscreenPanel: (config: PanelConfig) => boolean;
  onPanelResize: (panelId: PanelId, updates: PanelResizeUpdates) => void;
  onPanelResizeStart: (panelId: PanelId) => void;
  onPanelResizeEnd: (panelId: PanelId) => void;
  onPanelDragStart: NonNullable<FloatingPanelProps["onDragStart"]>;
  onPanelDragMove: NonNullable<FloatingPanelProps["onDragMove"]>;
  onPanelDragEnd: NonNullable<FloatingPanelProps["onDragEnd"]>;
  onClosePanel: (panelId: PanelId) => void;
  onMovePanelToPosition: (panelId: PanelId, position: PanelPosition) => boolean;
  onCloseTerminalPanel: () => void;
  onPanelFullscreen: (panelId: PanelId) => void;
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
  ) => unknown | Promise<unknown>;
  filePanelSnapDrag: PanelSnapDragCallbacks;
  onOpenFileFromPath: (path: string, line?: number, column?: number) => void;
  onOpenPreviewFromTerminal: (input: OpenTerminalPreviewInput) => void;
  onPerspectiveOpen: () => void;
  onPerspectiveClose: () => void;
  onGitDiffFocusChange: (active: boolean) => void;
  onCodePanelActivate: (path: string) => void;
  onCodePanelClose: (path: string) => void;
  onCodePanelCloseOthers: (path: string) => void;
  onCodePanelDetachToPanel: (
    tab: CodePanelTab,
    point: { x: number; y: number },
    options?: { snapPosition?: PanelOpenRequest["position"] | null },
  ) => void;
  onCodePanelRevealInExplorer: (tab: CodePanelTab) => void;
  onCodePanelMoveToEditorTabs: (tab: CodePanelTab) => void;
  onCodePanelAcceptAIInlinePatch: (preview: AIInlinePatchPreview) => void;
  onCodePanelRejectAIInlinePatch: (preview: AIInlinePatchPreview) => void;
  onZenPinToggle: (panelId: PanelId) => void;
}

interface ExplorerPanelBodyProps {
  activeProjectPath: string;
  configPosition: PanelPosition;
  filePanelSnapDrag: PanelSnapDragCallbacks;
  onFileOpen: MainLayoutPanelRendererProps["onFileOpen"];
  onFileOpenInPanel: MainLayoutPanelRendererProps["onFileOpenInPanel"];
  onPerspectiveOpen: MainLayoutPanelRendererProps["onPerspectiveOpen"];
  onPerspectiveClose: MainLayoutPanelRendererProps["onPerspectiveClose"];
}

const ExplorerPanelBody = React.memo(function ExplorerPanelBody({
  activeProjectPath,
  configPosition,
  filePanelSnapDrag,
  onFileOpen,
  onFileOpenInPanel,
  onPerspectiveOpen,
  onPerspectiveClose,
}: ExplorerPanelBodyProps) {
  return (
    <FileExplorer
      projectPath={activeProjectPath}
      onFileOpen={onFileOpen}
      onFileOpenInPanel={onFileOpenInPanel}
      {...filePanelSnapDrag}
      isHorizontal={configPosition === "bottom" || configPosition === "top"}
      onPerspectiveOpen={onPerspectiveOpen}
      onPerspectiveClose={onPerspectiveClose}
    />
  );
});

interface TerminalPanelBodyProps {
  tuiModeActive: boolean;
  tuiTerminalPaneStyle: React.CSSProperties;
  onOpenFileFromPath: MainLayoutPanelRendererProps["onOpenFileFromPath"];
  onOpenPreviewFromTerminal: MainLayoutPanelRendererProps["onOpenPreviewFromTerminal"];
}

const TerminalPanelBody = React.memo(function TerminalPanelBody({
  tuiModeActive,
  tuiTerminalPaneStyle,
  onOpenFileFromPath,
  onOpenPreviewFromTerminal,
}: TerminalPanelBodyProps) {
  const handleOpenFileRef = React.useCallback(
    (path: string, line?: number, column?: number) => {
      void onOpenFileFromPath(path, line, column);
    },
    [onOpenFileFromPath],
  );
  const handleOpenPreviewUrl = React.useCallback(
    (url: string, sessionId: string) => {
      onOpenPreviewFromTerminal({
        url,
        sessionId,
        forceOpen: true,
      });
    },
    [onOpenPreviewFromTerminal],
  );

  const content = (
    <TerminalPanelContent
      onOpenFileRef={handleOpenFileRef}
      onOpenPreviewUrl={handleOpenPreviewUrl}
    />
  );

  return tuiModeActive ? (
    <div style={tuiTerminalPaneStyle}>{content}</div>
  ) : (
    content
  );
});

interface AIChatPanelBodyProps {
  activeProjectPath: string;
  presentation: "fullscreen" | "panel";
}

const AIChatPanelBody = React.memo(function AIChatPanelBody({
  activeProjectPath,
  presentation,
}: AIChatPanelBodyProps) {
  return (
    <AIChatPanelContent
      presentation={presentation}
      projectPath={activeProjectPath}
    />
  );
});

interface GitPanelBodyProps {
  activeProjectPath: string;
  configPosition: PanelPosition;
  presentationMode: "expanded" | "compact";
  onGitDiffFocusChange: MainLayoutPanelRendererProps["onGitDiffFocusChange"];
  onOpenFileFromPath: MainLayoutPanelRendererProps["onOpenFileFromPath"];
}

const GitPanelBody = React.memo(function GitPanelBody({
  activeProjectPath,
  configPosition,
  presentationMode,
  onGitDiffFocusChange,
  onOpenFileFromPath,
}: GitPanelBodyProps) {
  const handleFileOpen = React.useCallback(
    (path: string) => {
      void onOpenFileFromPath(path);
    },
    [onOpenFileFromPath],
  );

  return (
    <GitPanel
      projectPath={activeProjectPath}
      panelPosition={configPosition}
      onDiffFocusChange={onGitDiffFocusChange}
      presentationMode={presentationMode}
      onFileOpen={handleFileOpen}
    />
  );
});

interface ProblemsPanelBodyProps {
  activeFilePath: string | null;
  presentationMode: "expanded" | "compact";
  onOpenFileFromPath: MainLayoutPanelRendererProps["onOpenFileFromPath"];
}

const ProblemsPanelBody = React.memo(function ProblemsPanelBody({
  activeFilePath,
  presentationMode,
  onOpenFileFromPath,
}: ProblemsPanelBodyProps) {
  const handleNavigate = React.useCallback(
    (path: string, line?: number, column?: number) =>
      onOpenFileFromPath(path, line, column),
    [onOpenFileFromPath],
  );

  return (
    <ProblemsPanel
      activeFilePath={activeFilePath}
      onNavigate={handleNavigate}
      presentationMode={presentationMode}
    />
  );
});

interface CodePanelBodyProps {
  activeCodePanelTab: CodePanelTab | null;
  activeCodePanelPatchPreview: AIInlinePatchPreview | null;
  codePanelPatchBusyId: string | null;
  codePanelTabs: CodePanelTab[];
  activeProjectPath: string;
  filePanelSnapDrag: PanelSnapDragCallbacks;
  onCodePanelActivate: MainLayoutPanelRendererProps["onCodePanelActivate"];
  onCodePanelClose: MainLayoutPanelRendererProps["onCodePanelClose"];
  onCodePanelCloseOthers: MainLayoutPanelRendererProps["onCodePanelCloseOthers"];
  onCodePanelDetachToPanel: MainLayoutPanelRendererProps["onCodePanelDetachToPanel"];
  onCodePanelRevealInExplorer: MainLayoutPanelRendererProps["onCodePanelRevealInExplorer"];
  onCodePanelMoveToEditorTabs: MainLayoutPanelRendererProps["onCodePanelMoveToEditorTabs"];
  onCodePanelAcceptAIInlinePatch: MainLayoutPanelRendererProps["onCodePanelAcceptAIInlinePatch"];
  onCodePanelRejectAIInlinePatch: MainLayoutPanelRendererProps["onCodePanelRejectAIInlinePatch"];
}

const CodePanelBody = React.memo(function CodePanelBody({
  activeCodePanelTab,
  activeCodePanelPatchPreview,
  codePanelPatchBusyId,
  codePanelTabs,
  activeProjectPath,
  filePanelSnapDrag,
  onCodePanelActivate,
  onCodePanelClose,
  onCodePanelCloseOthers,
  onCodePanelDetachToPanel,
  onCodePanelRevealInExplorer,
  onCodePanelMoveToEditorTabs,
  onCodePanelAcceptAIInlinePatch,
  onCodePanelRejectAIInlinePatch,
}: CodePanelBodyProps) {
  if (!activeCodePanelTab) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-[var(--text-muted)]">
        Open file from Explorer to start editing in panel
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <CodePanelTabs
        tabs={codePanelTabs}
        activePath={activeCodePanelTab.path}
        projectPath={activeProjectPath}
        onActivate={onCodePanelActivate}
        onClose={onCodePanelClose}
        onCloseOthers={onCodePanelCloseOthers}
        onDetachToPanel={onCodePanelDetachToPanel}
        onRevealInExplorer={onCodePanelRevealInExplorer}
        onMoveToEditorTabs={onCodePanelMoveToEditorTabs}
        {...filePanelSnapDrag}
      />
      <div className="min-h-0 flex-1">
        <CodePanelSurface
          key={activeCodePanelTab.path}
          path={activeCodePanelTab.path}
          name={activeCodePanelTab.name}
          initialContent={activeCodePanelTab.content}
          projectPath={activeProjectPath}
          language={activeCodePanelTab.language}
          loadState={activeCodePanelTab.loadState}
          completionProviderMode="full"
          aiInlinePatchPreview={activeCodePanelPatchPreview}
          aiInlinePatchBusy={
            codePanelPatchBusyId === activeCodePanelPatchPreview?.id
          }
          onAcceptAIInlinePatch={onCodePanelAcceptAIInlinePatch}
          onRejectAIInlinePatch={onCodePanelRejectAIInlinePatch}
        />
      </div>
    </div>
  );
});

interface MarkdownPreviewPanelBodyProps {
  source: MarkdownPreviewSource | null;
  onMarkdownLinkPreviewOpen: MainLayoutPanelRendererProps["onMarkdownLinkPreviewOpen"];
}

const MarkdownPreviewPanelBody = React.memo(function MarkdownPreviewPanelBody({
  source,
  onMarkdownLinkPreviewOpen,
}: MarkdownPreviewPanelBodyProps) {
  return (
    <MarkdownPreviewPanelContent
      source={source}
      onOpenExternalLinkPreview={onMarkdownLinkPreviewOpen}
    />
  );
});

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
  draggingFilePanel,
  relocatingPanelIds,
  fullscreenTransitionPanelIds,
  isSlotExiting = false,
  uiScale,
  activeProjectPath,
  activeStatusFilePath,
  activeEditorTabPath,
  activeCodePanelTab,
  activeCodePanelPatchPreview,
  codePanelPatchBusyId,
  codePanelTabs,
  markdownPreviewSource,
  tuiModeActive,
  tuiTerminalPaneStyle,
  terminalZIndex,
  snappedOverlayInsets,
  zenTopChromeAvoidanceTop,
  motionPressureActive = false,
  isLogicalFullscreenPanel,
  onPanelResize,
  onPanelResizeStart,
  onPanelResizeEnd,
  onPanelDragStart,
  onPanelDragMove,
  onPanelDragEnd,
  onClosePanel,
  onMovePanelToPosition,
  onCloseTerminalPanel,
  onPanelFullscreen,
  onMarkdownLinkPreviewOpen,
  onFileOpen,
  onFileOpenInPanel,
  filePanelSnapDrag,
  onOpenFileFromPath,
  onOpenPreviewFromTerminal,
  onPerspectiveOpen,
  onPerspectiveClose,
  onGitDiffFocusChange,
  onCodePanelActivate,
  onCodePanelClose,
  onCodePanelCloseOthers,
  onCodePanelDetachToPanel,
  onCodePanelRevealInExplorer,
  onCodePanelMoveToEditorTabs,
  onCodePanelAcceptAIInlinePatch,
  onCodePanelRejectAIInlinePatch,
  onZenPinToggle,
}) => {
  const isVisible = panels[panelId];
  const config = panelConfigs[panelId];
  const isDropTarget =
    config.mode === "snapped" &&
    dropTargetPosition === config.position &&
    ((draggingPanel !== null && draggingPanel !== panelId) ||
      draggingPreviewWindowId !== null ||
      draggingFilePanel);
  const isFullscreen = isLogicalFullscreenPanel(config);
  const isTUITerminalPanel = panelId === "terminal" && tuiModeActive;
  const fullscreenMotionActive = fullscreenTransitionPanelIds.includes(panelId);
  const isFullscreenCapable = fullscreenCapablePanelIds.has(panelId);

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
    onDragMove: (
      draggedPanelId: string,
      targetPosition: PanelPosition | null,
    ) =>
      onPanelDragMove(
        draggedPanelId,
        isTUITerminalPanel ? null : targetPosition,
      ),
    onDragEnd: (
      draggedPanelId: string,
      targetPosition: PanelPosition | null,
      dropX?: number,
      dropY?: number,
      dropWidth?: number,
      dropHeight?: number,
    ) =>
      onPanelDragEnd(
        draggedPanelId,
        isTUITerminalPanel ? null : targetPosition,
        dropX,
        dropY,
        dropWidth,
        dropHeight,
      ),
    onMoveToPosition: isTUITerminalPanel
      ? undefined
      : (position: PanelPosition) => onMovePanelToPosition(panelId, position),
    onClose: () => onClosePanel(panelId),
    isDropTarget,
    activeDropTargetPosition:
      draggingPanel === panelId && !isTUITerminalPanel
        ? dropTargetPosition
        : null,
    adjacentPanels: getAdjacentPanels(),
    uiScale,
    isFullscreen,
    fullscreenLayoutId: isFullscreenCapable
      ? `floating-panel-fullscreen-${panelId}`
      : undefined,
    fullscreenMotionActive,
    preserveFullscreenLayoutIdentity: panelId === "code",
    isSlotExiting,
    onFullscreen: isFullscreenCapable
      ? () => onPanelFullscreen(panelId)
      : undefined,
    isRelocating: relocatingPanelIds.includes(panelId),
    motionPressureActive,
    snappedOverlayInsets,
    zenTopChromeAvoidanceTop,
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
          <ExplorerPanelBody
            activeProjectPath={activeProjectPath}
            configPosition={config.position}
            filePanelSnapDrag={filePanelSnapDrag}
            onFileOpen={onFileOpen}
            onFileOpenInPanel={onFileOpenInPanel}
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
          immersiveOverlay={tuiModeActive}
          zIndex={terminalZIndex}
        >
          <TerminalPanelBody
            tuiModeActive={tuiModeActive}
            tuiTerminalPaneStyle={tuiTerminalPaneStyle}
            onOpenFileFromPath={onOpenFileFromPath}
            onOpenPreviewFromTerminal={onOpenPreviewFromTerminal}
          />
        </FloatingPanel>
      );
    case "aiChat":
      return (
        <FloatingPanel
          key={panelId}
          id="aiChat"
          title="AI Chat"
          icon={<Sparkles size={16} />}
          minSize={280}
          maxSize={600}
          {...panelProps}
        >
          <AIChatPanelBody
            presentation={isFullscreen ? "fullscreen" : "panel"}
            activeProjectPath={activeProjectPath}
          />
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
        >
          <GitPanelBody
            activeProjectPath={activeProjectPath}
            configPosition={config.position}
            presentationMode={isFullscreen ? "expanded" : "compact"}
            onGitDiffFocusChange={onGitDiffFocusChange}
            onOpenFileFromPath={onOpenFileFromPath}
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
        >
          <ProblemsPanelBody
            activeFilePath={activeStatusFilePath ?? activeEditorTabPath}
            presentationMode={isFullscreen ? "expanded" : "compact"}
            onOpenFileFromPath={onOpenFileFromPath}
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
          <CodePanelBody
            activeCodePanelTab={activeCodePanelTab}
            activeCodePanelPatchPreview={activeCodePanelPatchPreview}
            codePanelPatchBusyId={codePanelPatchBusyId}
            codePanelTabs={codePanelTabs}
            activeProjectPath={activeProjectPath}
            filePanelSnapDrag={filePanelSnapDrag}
            onCodePanelActivate={onCodePanelActivate}
            onCodePanelClose={onCodePanelClose}
            onCodePanelCloseOthers={onCodePanelCloseOthers}
            onCodePanelDetachToPanel={onCodePanelDetachToPanel}
            onCodePanelRevealInExplorer={onCodePanelRevealInExplorer}
            onCodePanelMoveToEditorTabs={onCodePanelMoveToEditorTabs}
            onCodePanelAcceptAIInlinePatch={onCodePanelAcceptAIInlinePatch}
            onCodePanelRejectAIInlinePatch={onCodePanelRejectAIInlinePatch}
          />
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
        >
          <MarkdownPreviewPanelBody
            source={markdownPreviewSource}
            onMarkdownLinkPreviewOpen={onMarkdownLinkPreviewOpen}
          />
        </FloatingPanel>
      );
    default:
      return null;
  }
};
