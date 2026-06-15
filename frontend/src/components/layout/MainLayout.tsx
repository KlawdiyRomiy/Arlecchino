import React, {
  useState,
  useEffect,
  useEffectEvent,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useReducedMotion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { MainLayoutPanelRenderer } from "./MainLayoutPanelRenderer";
import { MainPanelWorkspace } from "./MainPanelWorkspace";
import { PanelDropZone } from "./PanelDropZone";
import { ProjectEntryDialogs } from "./ProjectEntryDialogs";
import { ProjectPathCopyConfirmation } from "./ProjectPathCopyConfirmation";
import { PreviewWindowPanelRenderer } from "./PreviewWindowPanelRenderer";
import { useTheme } from "../../hooks/useTheme";
import { useBrowserPreviewBridge } from "../../hooks/useBrowserPreviewBridge";
import { usePreviewableContext } from "../../hooks/usePreviewableContext";
import { PreviewWindowLayer } from "./PreviewWindowLayer";
import { ExecutionDialog } from "../ExecutionDialog";
import { TerminalPanelContent } from "../TerminalPanel";
import { DependencyPolicyModal } from "../DependencyPolicyModal";
import { LaravelPlugin } from "../../plugins/LaravelPlugin";
import { SettingsModal } from "../SettingsModal";
import { CommandDispatcher } from "../CommandDispatcher";
import { useDispatcher } from "../../hooks/useDispatcher";
import { ProjectEntryActionsProvider } from "../../contexts/ProjectEntryActionsContext";
import { makeEditorTabId, useEditorStore } from "../../stores/editorStore";
import { useAppNotificationStore } from "../../stores/appNotificationStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useExplorerStore } from "../../stores/explorerStore";
import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import { bindIDEContextLedger } from "../../stores/ideContextLedgerStore";
import {
  aiInlinePatchPathMatches,
  selectAIInlinePatchPreviewForPath,
  useAIInlinePatchStore,
  type AIInlinePatchPreview,
} from "../../stores/aiInlinePatchStore";
import { replaceEditorDocumentFromDisk } from "../../stores/editorDocumentObserver";
import { getCurrentProjectSessionId } from "../../shell/projectSessionRoute";
import { type PanelPosition, type PanelSize } from "../ui/FloatingPanel";
import {
  FLOATING_PANEL_LAYOUT_TRANSITION,
  FLOATING_PANEL_LAYOUT_TRANSITION_MS,
} from "../ui/floatingPanelMotion";
import { ShellContextMenuFallback } from "../ui/ShellContextMenuFallback";

import { zIndex } from "../../styles/colors";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePerformanceStore } from "../../stores/performanceStore";
import { useAIChatStore } from "../../stores/aiChatStore";
import { usePluginModal } from "../../contexts/PluginModalContext";
import {
  usePreviewWindowStore,
  type OpenPreviewWindowInput,
  type PreviewWindow,
  type UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import {
  getSurfaceRuntimeReadModel,
  useSurfaceRuntimeHostSync,
} from "../../surfaces/surfaceRuntimeStore";
import {
  panelSurfaceId,
  previewSurfaceId,
  type SurfaceSession,
} from "../../surfaces/surfaceRuntime";
import {
  buildSurfacePromotionResult,
  parseSurfacePromotionRequest,
  type SurfacePromotionPosition,
  type SurfacePromotionRequest,
  type SurfacePromotionResult,
} from "../../surfaces/surfacePromotion";
import {
  buildWindowLeaseActionId,
  runWindowLeaseAction,
  type WindowLeaseRole,
} from "../../shell/windowLeaseBridge";
import { runAutoUpdateCheckWithNotification } from "../../shell/manualUpdateNotifications";
import type { ShortcutActionId } from "../../utils/keyboard";
import type {
  AICommandPaletteActionId,
  AICommandPalettePayload,
} from "../../utils/commandPaletteAI";
import { SNAPPED_PANEL_OUTER_GAP } from "../../utils/layoutHelpers";
import {
  getLogicalViewportSize,
  screenToLogicalPixels,
} from "../../utils/logicalViewport";
import {
  getProjectPathBasename,
  normalizeProjectPathIdentity,
  normalizeProjectPath,
  remapProjectPathPrefix,
  isSameOrChildPath,
} from "../../utils/projectPaths";
import {
  isTerminalFocusedElement,
  isTerminalShortcutContext as hasTerminalShortcutContext,
  shouldBypassGlobalFindShortcuts,
} from "../../utils/terminalFocus";
import {
  getTUIFloatingTerminalConfig,
  getTUIPanelVisibility,
  normalizeTUIAssistAnchor,
} from "../../utils/terminalLayout";
import {
  AIApplyPatchArtifact,
  AIRollbackPatchCheckpoint,
  GetLanguageForFile,
  IsNativeFullscreen,
  WriteTerminal,
} from "../../wails/app";
import { EventsOn } from "../../wails/runtime";
import {
  type ExecutionProfile,
  type ExecutionProfileSet,
  resolveExecutionProfiles,
} from "../../utils/executionProfiles";
import {
  createEditorFileLoadingLoad,
  createEditableEditorFileLoad,
  coerceEditorNavigationTarget,
  createEditorNavigationTarget,
  getEditorFileName,
  isEditorFilePolicyReadOnly,
  loadEditorFile,
  type EditorFileAccessPolicy,
  type EditorFileLoadState,
  type EditorNavigationTarget,
} from "../../utils/editorFileLoader";
import type {
  CodePanelTab,
  HeldPanelShortcut,
  HydratedPanelLayoutState,
  MainEditorFileOpenHandler,
  MainEditorFileOpenRegistrar,
  MainEditorDirtyFlushRegistrar,
  MainLayoutProps,
  MarkdownPreviewSource,
  PanelConfig,
  PanelConfigs,
  PanelFullscreenSnapshot,
  PanelId,
  PanelOpenRequest,
  PanelVisibility,
  ProjectEntryDeletedEvent,
  ProjectEntryRenamedEvent,
  RememberedSnappedPositions,
  ZenPinnedPanels,
} from "./MainLayout.types";
import {
  buildPanelConfigForOpen,
  clonePanelConfigsValue,
  cloneRememberedSnappedPositionsValue,
  cloneZenPinnedPanelsValue,
  computeNextPanelOpenState,
  DEFAULT_PANEL_CONFIGS,
  formatPanelPosition,
  isPanelPosition,
  loadPersistedPanelLayoutState,
  normalizeHydratedPanelLayoutState,
  normalizePanelSizeForPosition,
  normalizePreviewWindowSizeForPosition,
  resolveSmartSnappedPosition,
  resolvePanelId,
  uniquePanelPositions,
} from "./panelLayoutModel";
import { parsePanelOpenRequest } from "./mainLayoutEventParsers";
import { getNextWrappedIndex } from "./projectEntryUtils";
import {
  commandWithWorkingDirectory,
  hasMissingTools,
} from "./shellCommandUtils";
import {
  findBlockingAIInlinePatchCandidate,
  formatAIInlinePatchCandidateName,
  getAffectedAIInlinePatchCandidates,
  isAIInlinePatchPreviewInScope,
} from "../../utils/aiInlinePatchApproval";
import type { AIChatRunArtifact } from "../../../bindings/arlecchino/internal/ai/models";
import { useMainPanelWorkspaceModel } from "./useMainPanelWorkspaceModel";
import { useMainLayoutProjectEntries } from "./useMainLayoutProjectEntries";
import { useMainLayoutPreviewEvents } from "./useMainLayoutPreviewEvents";
import { useMainLayoutPanelEvents } from "./useMainLayoutPanelEvents";
import { useMainLayoutPanelDrag } from "./useMainLayoutPanelDrag";
import { useMainLayoutShortcutBridge } from "./useMainLayoutShortcutBridge";
import { useMainLayoutKeyboardShortcuts } from "./useMainLayoutKeyboardShortcuts";

const PANEL_SHORTCUT_MOVE_POSITIONS: readonly PanelPosition[] = [
  "left",
  "right",
  "top",
  "bottom",
];
const ZEN_CHROME_HOVER_CLOSE_DELAY_MS = 140;
const ZEN_EDGE_HOVER_SIZE = 32;
const ZEN_TOP_CHROME_HOVER_SIZE = 12;
const ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS = 700;
const ZEN_TOP_CHROME_OCCLUDED_REVEAL_DELAY_MS = 1400;
const ZEN_CHROME_STATIONARY_MOVE_TOLERANCE = 6;
const ZEN_TOP_CHROME_PRE_OPEN_VETO_TARGET_SELECTOR = [
  '[data-testid="editor-tabs-history-controls"]',
  '[data-testid="editor-tabs-split-controls"]',
  '[data-testid="editor-tabs-markdown-preview-toggle"]',
].join(",");
const ZEN_TOP_CHROME_OWNED_SELECTOR = [
  '[data-zen-top-chrome="true"]',
  '[data-testid="topbar"]',
  "[data-shell-menu-content]",
].join(",");
const ZEN_TOP_CHROME_OCCLUDED_REVEAL_TARGET_SELECTOR =
  '[data-panel-drag-handle="true"]';
const ZEN_TOP_CHROME_OCCLUDED_REVEAL_BLOCK_SELECTOR = [
  '[data-panel-controls="true"]',
  '[data-panel-resize-handle="true"]',
  ZEN_TOP_CHROME_PRE_OPEN_VETO_TARGET_SELECTOR,
  "button",
  "a",
  "input",
  "textarea",
  "select",
  '[role="button"]',
].join(",");
const ZEN_TOP_CHROME_INTERACTIVE_SELECTOR = [
  '[data-testid="topbar"] button',
  '[data-testid="topbar"] a',
  '[data-testid="topbar"] input',
  '[data-testid="topbar"] [role="button"]',
  "[data-shell-menu-content]",
].join(",");
const MARKDOWN_LINK_PREVIEW_WINDOW_ID = "markdown-link-preview";
const NATIVE_FULLSCREEN_CHANGED_EVENT = "shell:native-fullscreen-changed";
const NATIVE_WINDOW_CONTROLS_OCCLUSION_WIDTH = 112;
const NATIVE_WINDOW_CONTROLS_OCCLUSION_HEIGHT = 56;
type FullscreenPanelId =
  | "terminal"
  | "aiChat"
  | "git"
  | "problems"
  | "code"
  | "markdownPreview";

interface FullscreenPanelTransitionTarget {
  panelId: PanelId;
  position: PanelPosition;
}

const getTopmostFloatingPanelId = (
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): PanelId | null => {
  const floatingPanelIds = (Object.keys(panelConfigs) as PanelId[]).filter(
    (panelId) => panels[panelId] && panelConfigs[panelId].mode === "floating",
  );
  return floatingPanelIds.at(-1) ?? null;
};

interface NativeFullscreenChangedEvent {
  fullscreen?: boolean;
}

const eventProjectSessionId = (payload: unknown): string =>
  payload &&
  typeof payload === "object" &&
  "projectSessionId" in payload &&
  typeof (payload as { projectSessionId?: unknown }).projectSessionId ===
    "string"
    ? (payload as { projectSessionId: string }).projectSessionId.trim()
    : "";

const eventMatchesCurrentProjectSession = (payload: unknown): boolean => {
  const incomingProjectSessionId = eventProjectSessionId(payload);
  const currentProjectSessionId = getCurrentProjectSessionId();
  return (
    incomingProjectSessionId.length > 0 &&
    currentProjectSessionId.length > 0 &&
    incomingProjectSessionId === currentProjectSessionId
  );
};

type ZenViewportPointerSnapshot = Pick<
  MouseEvent,
  "clientX" | "clientY" | "buttons"
>;
type ZenChromeRevealIntentSource =
  | "top-edge"
  | "top-occluded-header"
  | "bottom-edge";

interface ZenChromeRevealIntent {
  source: ZenChromeRevealIntentSource;
  clientX: number;
  clientY: number;
  timer: ReturnType<typeof setTimeout>;
}

const createEmptyZenViewportChromeState = (): Record<
  "top" | "bottom",
  boolean
> => ({
  top: false,
  bottom: false,
});

const getZenChromeRevealDelay = (
  source: ZenChromeRevealIntentSource,
): number =>
  source === "top-occluded-header"
    ? ZEN_TOP_CHROME_OCCLUDED_REVEAL_DELAY_MS
    : ZEN_CHROME_STATIONARY_REVEAL_DELAY_MS;

const getZenViewportElementsFromPoint = (
  clientX: number,
  clientY: number,
): Element[] =>
  typeof document.elementsFromPoint === "function"
    ? document.elementsFromPoint(clientX, clientY)
    : [document.elementFromPoint(clientX, clientY)].filter(
        (element): element is Element => element !== null,
      );

const isZenTopChromeOwnedAtPoint = (
  clientX: number,
  clientY: number,
): boolean => {
  const elements = getZenViewportElementsFromPoint(clientX, clientY);
  const topmostElement = elements[0];

  return Boolean(topmostElement?.closest(ZEN_TOP_CHROME_OWNED_SELECTOR));
};

const isZenTopChromePreOpenVetoAtPoint = (
  clientX: number,
  clientY: number,
): boolean => {
  const elements = getZenViewportElementsFromPoint(clientX, clientY);
  const topmostElement = elements[0];

  if (topmostElement?.closest(ZEN_TOP_CHROME_OWNED_SELECTOR)) {
    return false;
  }

  return elements.some((element) =>
    Boolean(element.closest(ZEN_TOP_CHROME_PRE_OPEN_VETO_TARGET_SELECTOR)),
  );
};

const isZenTopChromeOccludedRevealTargetAtPoint = (
  clientX: number,
  clientY: number,
): boolean => {
  const elements = getZenViewportElementsFromPoint(clientX, clientY);
  const topmostElement = elements[0];
  if (
    !topmostElement ||
    topmostElement.closest(ZEN_TOP_CHROME_OWNED_SELECTOR) ||
    topmostElement.closest(ZEN_TOP_CHROME_INTERACTIVE_SELECTOR) ||
    topmostElement.closest(ZEN_TOP_CHROME_OCCLUDED_REVEAL_BLOCK_SELECTOR)
  ) {
    return false;
  }

  const headerElement = elements
    .map((element) =>
      element.closest<HTMLElement>(
        ZEN_TOP_CHROME_OCCLUDED_REVEAL_TARGET_SELECTOR,
      ),
    )
    .find((element): element is HTMLElement => element !== null);
  if (!headerElement) {
    return false;
  }

  const panelElement = headerElement.closest<HTMLElement>("[data-panel-id]");
  const headerRect = headerElement.getBoundingClientRect();
  const panelRect = panelElement?.getBoundingClientRect() ?? headerRect;
  const pointerInsideHeader =
    clientX >= headerRect.left &&
    clientX <= headerRect.right &&
    clientY >= headerRect.top &&
    clientY <= headerRect.bottom;

  return (
    pointerInsideHeader &&
    (headerRect.top <= ZEN_EDGE_HOVER_SIZE ||
      panelRect.top <= ZEN_EDGE_HOVER_SIZE)
  );
};

const createEmptySnappedSlotSizes = (): Record<PanelPosition, number> => ({
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
});

const buildMarkdownLinkPreviewTitle = (url: string): string => {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.host ? `Preview ${parsedUrl.host}` : "Markdown Preview";
  } catch {
    return "Markdown Preview";
  }
};

const getPrimarySnappedSlotSize = (
  position: PanelPosition,
  size: PanelSize,
): number =>
  position === "left" || position === "right" ? size.width : size.height;

const coercePositiveSize = (
  value: number | undefined,
  fallback: number,
  minimum: number,
): number =>
  typeof value === "number" && value > 0 ? value : Math.max(fallback, minimum);

const getPanelPromotionFloatingSize = (
  panelId: PanelId,
  config: PanelConfig,
): PanelSize => {
  const defaultSize = DEFAULT_PANEL_CONFIGS[panelId].size;
  return {
    width: coercePositiveSize(config.size.width, defaultSize.width || 420, 260),
    height: coercePositiveSize(
      config.size.height,
      defaultSize.height || 320,
      180,
    ),
  };
};

const panelToWindowLeaseRole = (panelId: PanelId): WindowLeaseRole | null => {
  switch (panelId) {
    case "git":
      return "git-helper";
    case "problems":
      return "problems-helper";
    case "terminal":
      return "terminal-helper";
    default:
      return null;
  }
};

const getPreviewPromotionFloatingSize = (
  windowState: PreviewWindow,
): { width: number; height: number } => ({
  width: coercePositiveSize(windowState.width, 520, 260),
  height: coercePositiveSize(windowState.height, 360, 180),
});

const surfaceSessionToPanelConfig = (
  session: SurfaceSession,
  fallbackConfig: PanelConfig,
  positionOverride?: SurfacePromotionPosition,
): PanelConfig | null => {
  const geometry = session.geometry;
  if (session.hostMode === "snapped") {
    const position = positionOverride ?? geometry?.position;
    if (!isPanelPosition(position)) {
      return null;
    }
    return {
      position,
      mode: "snapped",
      x: 0,
      y: 0,
      size: normalizePanelSizeForPosition(position, {
        width: geometry?.width ?? fallbackConfig.size.width,
        height: geometry?.height ?? fallbackConfig.size.height,
      }),
    };
  }

  if (session.hostMode === "floating" || session.hostMode === "fullscreen") {
    const size = {
      width: coercePositiveSize(
        geometry?.width,
        fallbackConfig.size.width || 420,
        260,
      ),
      height: coercePositiveSize(
        geometry?.height,
        fallbackConfig.size.height || 320,
        180,
      ),
    };
    return {
      position: fallbackConfig.position,
      mode: "floating",
      x: geometry?.x ?? fallbackConfig.x,
      y: geometry?.y ?? fallbackConfig.y,
      size,
    };
  }

  return null;
};

const surfaceSessionToPreviewUpdate = (
  session: SurfaceSession,
  fallbackWindow: PreviewWindow,
  positionOverride?: SurfacePromotionPosition,
): UpdatePreviewWindowInput | null => {
  const geometry = session.geometry;
  if (session.hostMode === "snapped") {
    const position = positionOverride ?? geometry?.position;
    if (!isPanelPosition(position)) {
      return null;
    }
    const size = normalizePreviewWindowSizeForPosition(position, {
      width: geometry?.width ?? fallbackWindow.width,
      height: geometry?.height ?? fallbackWindow.height,
    });
    return {
      mode: "snapped",
      position,
      width: size.width,
      height: size.height,
    };
  }

  if (session.hostMode === "floating" || session.hostMode === "fullscreen") {
    const size = {
      width: coercePositiveSize(geometry?.width, fallbackWindow.width, 260),
      height: coercePositiveSize(geometry?.height, fallbackWindow.height, 180),
    };
    return {
      mode: "floating",
      x: geometry?.x ?? fallbackWindow.x,
      y: geometry?.y ?? fallbackWindow.y,
      width: size.width,
      height: size.height,
    };
  }

  return null;
};

export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  onFileOpen,
  onBackToWelcome,
  onProjectOpen,
  onSwitchProject,
  onCloseProject,
  onDetachProject,
  onReorderProjects,
  onPerspectiveOpen: externalPerspectiveOpen,
  onPerspectiveClose: externalPerspectiveClose,
}) => {
  const { isDark, theme: currentTheme, setTheme, resolvedThemeId } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const reducePanelMotion = prefersReducedMotion;
  const panelLayoutTransition = reducePanelMotion
    ? { duration: 0 }
    : FLOATING_PANEL_LAYOUT_TRANSITION;
  const beginPanelMotionWindow = useCallback(() => {
    if (reducePanelMotion) {
      return;
    }

    usePerformanceStore
      .getState()
      .beginPanelMotionWindow(FLOATING_PANEL_LAYOUT_TRANSITION_MS + 160);
  }, [reducePanelMotion]);
  useEffect(() => bindIDEContextLedger(), []);
  useEffect(() => {
    const handleArtifactUpdated = (artifact: unknown) => {
      if (!artifact || typeof artifact !== "object") {
        return;
      }
      if (!eventMatchesCurrentProjectSession(artifact)) {
        return;
      }
      useAIInlinePatchStore
        .getState()
        .upsertArtifact(artifact as AIChatRunArtifact, {
          projectSessionId: getCurrentProjectSessionId(),
        });
    };
    const handlePatchMutation = (payload: unknown) => {
      if (!eventMatchesCurrentProjectSession(payload)) {
        return;
      }
      const artifactId =
        payload &&
        typeof payload === "object" &&
        "artifactId" in payload &&
        typeof (payload as { artifactId?: unknown }).artifactId === "string"
          ? (payload as { artifactId: string }).artifactId
          : "";
      const source =
        payload &&
        typeof payload === "object" &&
        "source" in payload &&
        typeof (payload as { source?: unknown }).source === "string"
          ? (payload as { source: string }).source
          : "";
      if (source === "captured_direct_write") {
        return;
      }
      if (artifactId) {
        useAIInlinePatchStore.getState().removePreview(artifactId, {
          projectSessionId: getCurrentProjectSessionId(),
        });
      }
    };

    const unsubscribeArtifactUpdated = EventsOn(
      "ai:chat:artifact-updated",
      handleArtifactUpdated,
    );
    const unsubscribePatchApplied = EventsOn(
      "ai:patch:artifact-applied",
      handlePatchMutation,
    );
    const unsubscribePatchRolledBack = EventsOn(
      "ai:patch:artifact-rolled-back",
      handlePatchMutation,
    );

    return () => {
      unsubscribeArtifactUpdated();
      unsubscribePatchApplied();
      unsubscribePatchRolledBack();
    };
  }, []);
  const isPerspectiveOpenRef = useRef(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDependencyPolicyOpen, setIsDependencyPolicyOpen] = useState(false);
  const [markdownPreviewSource, setMarkdownPreviewSource] =
    useState<MarkdownPreviewSource | null>(null);
  const [executionDialogMode, setExecutionDialogMode] = useState<
    "run" | "debug" | null
  >(null);
  const [executionProfiles, setExecutionProfiles] =
    useState<ExecutionProfileSet>({
      runProfiles: [],
      debugProfiles: [],
    });
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  const setUiScale = useEditorSettingsStore((state) => state.setUiScale);
  const zenModeEnabled = useEditorSettingsStore(
    (state) => state.zenModeEnabled,
  );
  const showNativeMacWindowControls = useEditorSettingsStore(
    (state) => state.showNativeMacWindowControls,
  );
  const logicalViewport = React.useMemo(
    () => getLogicalViewportSize(uiScale),
    [uiScale],
  );
  const activeProjectId = useWorkspaceStore((s) => s.activeId);
  const workspaceProjectPath = useWorkspaceStore((state) => {
    const activeProject = state.projects.find(
      (project) => project.id === state.activeId,
    );
    return activeProject?.path ?? "";
  });
  const activeProjectPath = workspaceProjectPath;
  const currentProjectSessionId = getCurrentProjectSessionId();
  const activeEditorTab = useEditorStore((state) =>
    state.getActiveTab(state.activePaneId),
  );
  const activeStatusFilePath = useEditorStore((state) => state.statusFile.path);
  const ensureEditorTab = useEditorStore((state) => state.ensureTab);
  const retainEditorBackingTab = useEditorStore(
    (state) => state.retainBackingTab,
  );
  const releaseEditorBackingTab = useEditorStore(
    (state) => state.releaseBackingTab,
  );
  const setEditorStatusFile = useEditorStore((state) => state.setStatusFile);
  const aiInlinePatchPreviews = useAIInlinePatchStore(
    (state) => state.previews,
  );
  const aiInlinePatchBusyIds = useAIInlinePatchStore((state) => state.busyIds);
  const beginAIInlinePatchBusy = useAIInlinePatchStore(
    (state) => state.beginBusy,
  );
  const endAIInlinePatchBusy = useAIInlinePatchStore((state) => state.endBusy);
  const clearAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.clearPreview,
  );
  const acknowledgeAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.acknowledgePreview,
  );
  const dismissAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.dismissPreview,
  );
  const renameEditorTabPaths = useEditorStore(
    (state) => state.renamePathPrefix,
  );
  const closeEditorTabPaths = useEditorStore((state) => state.closePathPrefix);
  const remapExplorerPathPrefix = useExplorerStore(
    (state) => state.remapPathPrefix,
  );
  const pruneExplorerPathPrefix = useExplorerStore(
    (state) => state.prunePathPrefix,
  );
  const requestExplorerRevealFile = useExplorerStore(
    (state) => state.requestRevealFile,
  );
  const renamePathDiagnostics = useDiagnosticsStore(
    (state) => state.renamePathDiagnostics,
  );
  const prunePathDiagnostics = useDiagnosticsStore(
    (state) => state.prunePathDiagnostics,
  );
  const {
    tuiModeActive,
    tuiActiveSessionId,
    setTUIAssist,
    setPowerProfile,
    canAccessPath,
    enterTUIMode,
    exitTUIMode,
    isDispatcherPaused,
  } = useTerminalStore(
    useShallow((state) => ({
      tuiModeActive: state.tuiModeActive,
      tuiActiveSessionId: state.tuiActiveSessionId,
      setTUIAssist: state.setTUIAssist,
      setPowerProfile: state.setPowerProfile,
      canAccessPath: state.canAccessPath,
      enterTUIMode: state.enterTUIMode,
      exitTUIMode: state.exitTUIMode,
      isDispatcherPaused: state.isDispatcherPaused,
    })),
  );
  const previewWindows = usePreviewWindowStore((state) => state.windows);
  const activePreviewWindowId = usePreviewWindowStore(
    (state) => state.activeWindowId,
  );
  const [activePanelId, setActivePanelId] = useState<PanelId | null>(null);
  const activePanelIdRef = useRef<PanelId | null>(null);
  const markActivePanel = useCallback((panelId: PanelId | null) => {
    activePanelIdRef.current = panelId;
    setActivePanelId(panelId);
  }, []);
  const appearancePreview = usePreviewWindowStore(
    (state) => state.appearancePreview,
  );
  const openPreviewWindow = usePreviewWindowStore((state) => state.openWindow);
  const updatePreviewWindow = usePreviewWindowStore(
    (state) => state.updateWindow,
  );
  const closePreviewWindow = usePreviewWindowStore(
    (state) => state.closeWindow,
  );
  const closeAllPreviewWindows = usePreviewWindowStore(
    (state) => state.closeAllWindows,
  );
  const focusPreviewWindowFromStore = usePreviewWindowStore(
    (state) => state.focusWindow,
  );
  const focusPreviewWindow = useCallback(
    (windowId: string) => {
      markActivePanel(null);
      focusPreviewWindowFromStore(windowId);
    },
    [focusPreviewWindowFromStore, markActivePanel],
  );
  const previewButtonState = usePreviewableContext();
  const workspacePreviewWindows = useMemo(
    () =>
      previewWindows.filter(
        (windowState) =>
          windowState.mode === "snapped" || windowState.surface === "browser",
      ),
    [previewWindows],
  );
  const layeredPreviewWindows = useMemo(
    () =>
      previewWindows.filter(
        (windowState) =>
          windowState.mode !== "snapped" && windowState.surface !== "browser",
      ),
    [previewWindows],
  );
  const { openPreviewFromTerminal } = useBrowserPreviewBridge({
    openPreviewWindow,
    focusPreviewWindow,
    closePreviewWindow,
  });
  const dispatcher = useDispatcher();
  const { activeModal, closeModal } = usePluginModal();

  const panelStorageKey = activeProjectId
    ? `panelState:${activeProjectId}`
    : null;
  const initialPanelLayoutState = React.useMemo(
    () => loadPersistedPanelLayoutState(panelStorageKey),
    [panelStorageKey],
  );

  const [panels, setPanels] = useState<PanelVisibility>(() => {
    return { ...initialPanelLayoutState.panels };
  });

  const [panelConfigs, setPanelConfigs] = useState<PanelConfigs>(() => {
    return clonePanelConfigsValue(initialPanelLayoutState.panelConfigs);
  });
  const [rememberedSnappedPositions, setRememberedSnappedPositions] =
    useState<RememberedSnappedPositions>(() => {
      return cloneRememberedSnappedPositionsValue(
        initialPanelLayoutState.rememberedSnappedPositions,
      );
    });
  const [zenPinnedPanels, setZenPinnedPanels] = useState<ZenPinnedPanels>(
    () => {
      return cloneZenPinnedPanelsValue(initialPanelLayoutState.zenPinnedPanels);
    },
  );
  const [tuiLayoutSnapshot, setTuiLayoutSnapshot] = useState<{
    panels: PanelVisibility;
    panelConfigs: PanelConfigs;
    rememberedSnappedPositions: RememberedSnappedPositions;
  } | null>(null);
  const wasTUIActiveRef = React.useRef(false);
  const forceHideTerminalAfterTUIExitRef = React.useRef(false);
  const panelsRef = React.useRef(panels);
  const panelConfigsRef = React.useRef(panelConfigs);
  const gitDiffBaselineWidthRef = React.useRef<number | null>(null);
  const rememberedSnappedPositionsRef = React.useRef(
    rememberedSnappedPositions,
  );
  const zenPinnedPanelsRef = React.useRef(zenPinnedPanels);
  const heldPanelShortcutRef = React.useRef<HeldPanelShortcut | null>(null);
  const pressedShortcutCodesRef = React.useRef<Set<string>>(new Set());
  const shortcutActionSuppressionRef = React.useRef<{
    actionId: ShortcutActionId;
    until: number;
  } | null>(null);
  const delayedShortcutActionSuppressionRef = React.useRef<{
    actionId: ShortcutActionId;
    until: number;
  } | null>(null);
  const applicationMenuRepeatRef = React.useRef<{
    actionId: ShortcutActionId;
    lastAt: number;
  } | null>(null);
  const openCanonicalBrowserPreviewRef = React.useRef<() => boolean>(
    () => false,
  );
  const toggleCanonicalBrowserPreviewRef = React.useRef<() => void>(() => {});
  const executionProfilesRequestRef = React.useRef(0);
  const codePanelOpenRequestRef = React.useRef(0);
  const codePanelRefreshRequestRef = React.useRef<Record<string, number>>({});
  const openFileFromPathRequestRef = React.useRef(0);
  const userCreatedFileOpenRef = React.useRef<(path: string) => void>(() => {});
  const editorFileOpenLoadingTimerRef = React.useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const editorFileOpenHandlerRef =
    React.useRef<MainEditorFileOpenHandler | null>(null);
  const dirtyEditorFlushHandlerRef = React.useRef<(() => Promise<void>) | null>(
    null,
  );

  const registerEditorFileOpenHandler: MainEditorFileOpenRegistrar =
    useCallback((handler) => {
      editorFileOpenHandlerRef.current = handler;
    }, []);

  const registerDirtyEditorFlushHandler: MainEditorDirtyFlushRegistrar =
    useCallback((handler) => {
      dirtyEditorFlushHandlerRef.current = handler;
    }, []);

  const openFileInMainEditor = useCallback(
    (file: EditorFileLoadState, target?: number | EditorNavigationTarget) => {
      const navigationTarget = coerceEditorNavigationTarget(target, {
        focus: true,
      });
      const payload = {
        file,
        line: navigationTarget?.line,
        navigationTarget,
      };
      const directHandler = editorFileOpenHandlerRef.current;
      if (directHandler) {
        directHandler(payload);
        return;
      }

      onFileOpen?.(payload);
    },
    [onFileOpen],
  );

  const clearEditorFileOpenLoadingTimer = useCallback(() => {
    if (editorFileOpenLoadingTimerRef.current === null) {
      return;
    }

    clearTimeout(editorFileOpenLoadingTimerRef.current);
    editorFileOpenLoadingTimerRef.current = null;
  }, []);

  const scheduleEditorFileOpenLoading = useCallback(
    (
      requestId: number,
      path: string,
      name: string,
      navigationTarget?: EditorNavigationTarget,
      policy?: EditorFileAccessPolicy,
    ) => {
      clearEditorFileOpenLoadingTimer();
      editorFileOpenLoadingTimerRef.current = setTimeout(() => {
        editorFileOpenLoadingTimerRef.current = null;
        if (openFileFromPathRequestRef.current !== requestId) {
          return;
        }

        openFileInMainEditor(
          createEditorFileLoadingLoad(path, name, policy),
          navigationTarget,
        );
      }, 140);
    },
    [clearEditorFileOpenLoadingTimer, openFileInMainEditor],
  );

  useEffect(
    () => () => clearEditorFileOpenLoadingTimer(),
    [clearEditorFileOpenLoadingTimer],
  );

  useEffect(() => {
    const requestID = executionProfilesRequestRef.current + 1;
    executionProfilesRequestRef.current = requestID;

    void resolveExecutionProfiles({
      projectPath: activeProjectPath,
      activeTab: activeEditorTab,
    })
      .then((nextProfiles) => {
        if (executionProfilesRequestRef.current !== requestID) {
          return;
        }
        setExecutionProfiles(nextProfiles);
      })
      .catch(() => {
        if (executionProfilesRequestRef.current !== requestID) {
          return;
        }
        setExecutionProfiles({ runProfiles: [], debugProfiles: [] });
      });
  }, [activeEditorTab, activeProjectPath]);

  const clonePanelConfigs = useCallback(
    (source: PanelConfigs): PanelConfigs => {
      return {
        explorer: { ...source.explorer, size: { ...source.explorer.size } },
        terminal: { ...source.terminal, size: { ...source.terminal.size } },
        aiChat: { ...source.aiChat, size: { ...source.aiChat.size } },
        git: { ...source.git, size: { ...source.git.size } },
        problems: { ...source.problems, size: { ...source.problems.size } },
        code: { ...source.code, size: { ...source.code.size } },
        markdownPreview: {
          ...source.markdownPreview,
          size: { ...source.markdownPreview.size },
        },
      };
    },
    [],
  );

  const cloneRememberedSnappedPositions = useCallback(
    (source: RememberedSnappedPositions): RememberedSnappedPositions => ({
      explorer: source.explorer,
      terminal: source.terminal,
      aiChat: source.aiChat,
      git: source.git,
      problems: source.problems,
      code: source.code,
      markdownPreview: source.markdownPreview,
    }),
    [],
  );

  const applyZenPinnedPanelsState = useCallback(
    (nextZenPinnedPanels: ZenPinnedPanels) => {
      zenPinnedPanelsRef.current = nextZenPinnedPanels;
      setZenPinnedPanels(nextZenPinnedPanels);
    },
    [],
  );

  const updateZenPinnedPanelsState = useCallback(
    (updater: (previous: ZenPinnedPanels) => ZenPinnedPanels) => {
      const nextZenPinnedPanels = updater(zenPinnedPanelsRef.current);
      applyZenPinnedPanelsState(nextZenPinnedPanels);
      return nextZenPinnedPanels;
    },
    [applyZenPinnedPanelsState],
  );

  const applyPanelsState = useCallback(
    (nextPanels: PanelVisibility) => {
      const previousPanels = panelsRef.current;
      const currentActivePanelId = activePanelIdRef.current;
      const newlyVisiblePanelId = (Object.keys(nextPanels) as PanelId[]).find(
        (panelId) => nextPanels[panelId] && !previousPanels[panelId],
      );
      updateZenPinnedPanelsState((currentPins) => {
        let changed = false;
        const nextPins = { ...currentPins };

        (Object.keys(nextPanels) as PanelId[]).forEach((panelId) => {
          if (!nextPanels[panelId] && nextPins[panelId]) {
            nextPins[panelId] = false;
            changed = true;
          }
        });

        return changed ? nextPins : currentPins;
      });

      panelsRef.current = nextPanels;
      setPanels(nextPanels);

      if (newlyVisiblePanelId) {
        markActivePanel(newlyVisiblePanelId);
        return;
      }

      if (currentActivePanelId && !nextPanels[currentActivePanelId]) {
        markActivePanel(null);
      }
    },
    [markActivePanel, updateZenPinnedPanelsState],
  );

  const updatePanelsState = useCallback(
    (updater: (previous: PanelVisibility) => PanelVisibility) => {
      const nextPanels = updater(panelsRef.current);
      applyPanelsState(nextPanels);
      return nextPanels;
    },
    [applyPanelsState],
  );

  const applyPanelConfigsState = useCallback(
    (nextPanelConfigs: PanelConfigs) => {
      panelConfigsRef.current = nextPanelConfigs;
      setPanelConfigs(nextPanelConfigs);
    },
    [],
  );

  const applyRememberedSnappedPositionsState = useCallback(
    (nextRememberedSnappedPositions: RememberedSnappedPositions) => {
      rememberedSnappedPositionsRef.current = nextRememberedSnappedPositions;
      setRememberedSnappedPositions(nextRememberedSnappedPositions);
    },
    [],
  );

  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);

  useEffect(() => {
    panelConfigsRef.current = panelConfigs;
  }, [panelConfigs]);

  useEffect(() => {
    rememberedSnappedPositionsRef.current = rememberedSnappedPositions;
  }, [rememberedSnappedPositions]);

  useEffect(() => {
    zenPinnedPanelsRef.current = zenPinnedPanels;
  }, [zenPinnedPanels]);

  useEffect(() => {
    try {
      if (tuiModeActive || !panelStorageKey) return;
      localStorage.setItem(
        panelStorageKey,
        JSON.stringify({
          panels,
          panelConfigs,
          rememberedSnappedPositions,
          zenPinnedPanels,
        }),
      );
    } catch {
      /* quota */
    }
  }, [
    panelConfigs,
    panelStorageKey,
    panels,
    rememberedSnappedPositions,
    zenPinnedPanels,
    tuiModeActive,
  ]);

  useEffect(() => {
    setPowerProfile(tuiModeActive ? "hard_pause" : "normal");
  }, [setPowerProfile, tuiModeActive]);

  useEffect(() => {
    if (tuiModeActive === wasTUIActiveRef.current) {
      return;
    }

    if (tuiModeActive) {
      forceHideTerminalAfterTUIExitRef.current = false;
      setTuiLayoutSnapshot({
        panels: { ...panels },
        panelConfigs: clonePanelConfigs(panelConfigs),
        rememberedSnappedPositions: cloneRememberedSnappedPositions(
          rememberedSnappedPositions,
        ),
      });

      const floatingTerminalConfig = getTUIFloatingTerminalConfig({
        viewportWidth: logicalViewport.width,
        viewportHeight: logicalViewport.height,
      });
      setPanelConfigs((prev) => ({
        ...prev,
        terminal: {
          ...prev.terminal,
          ...floatingTerminalConfig,
        },
      }));

      updatePanelsState((prev) => {
        const nextPanels = getTUIPanelVisibility({ ...prev, browser: false });
        return {
          explorer: nextPanels.explorer,
          terminal: nextPanels.terminal,
          aiChat: nextPanels.aiChat,
          git: nextPanels.git,
          problems: prev.problems,
          code: prev.code,
          markdownPreview: prev.markdownPreview,
        };
      });

      setTUIAssist({ active: false, panel: null, anchor: "right" });
    } else {
      const shouldHideTerminalPanel = forceHideTerminalAfterTUIExitRef.current;
      setTUIAssist({ active: false, panel: null, anchor: "right" });

      if (tuiLayoutSnapshot) {
        const restoredPanels = shouldHideTerminalPanel
          ? { ...tuiLayoutSnapshot.panels, terminal: false }
          : { ...tuiLayoutSnapshot.panels };
        const restoredPanelConfigs = clonePanelConfigs(
          tuiLayoutSnapshot.panelConfigs,
        );
        const restoredRememberedSnappedPositions =
          cloneRememberedSnappedPositions(
            tuiLayoutSnapshot.rememberedSnappedPositions,
          );

        (Object.keys(panels) as PanelId[]).forEach((panelId) => {
          if (panelId === "terminal" || !panels[panelId]) {
            return;
          }

          restoredPanels[panelId] = true;
          restoredPanelConfigs[panelId] = panelConfigs[panelId];
          restoredRememberedSnappedPositions[panelId] =
            rememberedSnappedPositions[panelId];
        });

        const normalizedSnapshot = normalizeHydratedPanelLayoutState(
          restoredPanels,
          restoredPanelConfigs,
          restoredRememberedSnappedPositions,
        );
        applyPanelsState(normalizedSnapshot.panels);
        applyPanelConfigsState(normalizedSnapshot.panelConfigs);
        applyRememberedSnappedPositionsState(
          normalizedSnapshot.rememberedSnappedPositions,
        );
        setTuiLayoutSnapshot(null);
      } else if (shouldHideTerminalPanel) {
        updatePanelsState((prev) => ({ ...prev, terminal: false }));
      }

      forceHideTerminalAfterTUIExitRef.current = false;
    }

    wasTUIActiveRef.current = tuiModeActive;
  }, [
    applyPanelConfigsState,
    applyPanelsState,
    applyRememberedSnappedPositionsState,
    clonePanelConfigs,
    cloneRememberedSnappedPositions,
    logicalViewport.height,
    logicalViewport.width,
    panelConfigs,
    panels,
    rememberedSnappedPositions,
    setTUIAssist,
    tuiLayoutSnapshot,
    tuiModeActive,
    updatePanelsState,
  ]);

  const terminalPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const aiChatPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const gitPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const problemsPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const codePreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const markdownPreviewPreFullscreenRef =
    React.useRef<PanelFullscreenSnapshot | null>(null);
  const topChromeRef = React.useRef<HTMLDivElement | null>(null);
  const bottomChromeRef = React.useRef<HTMLDivElement | null>(null);
  const panelWorkspaceRef = React.useRef<HTMLDivElement | null>(null);
  const [panelWorkspaceSize, setPanelWorkspaceSize] =
    React.useState(logicalViewport);
  const previousPanelWorkspaceSizeRef = React.useRef(panelWorkspaceSize);
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
  const [zenTopChromeEdgeActive, setZenTopChromeEdgeActive] = useState(false);
  const [zenTopChromePointerInside, setZenTopChromePointerInside] =
    useState(false);
  const [zenTopChromePopupOpen, setZenTopChromePopupOpen] = useState(false);
  const [
    zenTopChromeOccludedHeaderActive,
    setZenTopChromeOccludedHeaderActive,
  ] = useState(false);
  const [zenTopChromeInteractionLocked, setZenTopChromeInteractionLocked] =
    useState(false);
  const [zenBottomChromeHovered, setZenBottomChromeHovered] = useState(false);
  const [nativeWindowFullscreen, setNativeWindowFullscreen] = useState(false);
  const zenBottomChromeHoverTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const zenChromeRevealIntentRef = useRef<ZenChromeRevealIntent | null>(null);
  const zenTopChromeOccludedHeaderActiveRef = useRef(false);
  const effectivePanelsRef = useRef<PanelVisibility>(panels);
  const layoutPanelsRef = useRef<PanelVisibility>(panels);
  const previousLayoutPanelsRef = useRef<PanelVisibility | null>(null);
  const zenViewportPointerRef = useRef<ZenViewportPointerSnapshot | null>(null);
  const zenViewportMouseMoveFrameRef = useRef<number | null>(null);
  const zenViewportChromeStateRef = useRef<Record<"top" | "bottom", boolean>>(
    createEmptyZenViewportChromeState(),
  );
  const zenPanelInteractionActiveRef = useRef(false);
  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [draggingPreviewWindowId, setDraggingPreviewWindowId] = useState<
    string | null
  >(null);
  const [draggingFilePanel, setDraggingFilePanel] = useState(false);
  const [resizingPanel, setResizingPanel] = useState<PanelId | null>(null);
  const [resizingPreviewWindowId, setResizingPreviewWindowId] = useState<
    string | null
  >(null);
  const [dropTargetPosition, setDropTargetPosition] =
    useState<PanelPosition | null>(null);
  const [panelDropSettling, setPanelDropSettling] = useState(false);
  const panelDropSettlingTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [relocatingPanelIds, setRelocatingPanelIds] = useState<PanelId[]>([]);
  const [relocatingPreviewWindowIds, setRelocatingPreviewWindowIds] = useState<
    string[]
  >([]);
  const [panelDropSettlingPositions, setPanelDropSettlingPositions] = useState<
    PanelPosition[]
  >([]);
  const [fullscreenPanelTransitions, setFullscreenPanelTransitions] = useState<
    FullscreenPanelTransitionTarget[]
  >([]);
  const [panelExitPositions, setPanelExitPositions] = useState<PanelPosition[]>(
    [],
  );
  const [panelExitSlotSizes, setPanelExitSlotSizes] = useState<
    Record<PanelPosition, number>
  >(createEmptySnappedSlotSizes);
  const [panelExitCollapsingPositions, setPanelExitCollapsingPositions] =
    useState<PanelPosition[]>([]);
  const [panelEnterPositions, setPanelEnterPositions] = useState<
    PanelPosition[]
  >([]);
  const [panelPresenceBypassPositions, setPanelPresenceBypassPositions] =
    useState<PanelPosition[]>([]);
  const panelPresenceBypassPositionsRef = useRef<PanelPosition[]>([]);
  const [floatingPresenceVersion, setFloatingPresenceVersion] = useState(0);
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelExitCollapseFrameRef = useRef<number | null>(null);
  const panelEnterTimerIdsRef = useRef<
    Partial<Record<PanelPosition, ReturnType<typeof setTimeout>>>
  >({});
  const pendingPanelCloseFrameIdsRef = useRef<number[]>([]);
  const fullscreenPanelTransitionTimerIdsRef = useRef<
    Partial<Record<PanelId, ReturnType<typeof setTimeout>>>
  >({});
  const panelInteractionPressureActive =
    draggingPanel !== null ||
    draggingPreviewWindowId !== null ||
    draggingFilePanel ||
    resizingPanel !== null ||
    resizingPreviewWindowId !== null;
  const panelMotionPressureActive =
    panelInteractionPressureActive ||
    panelDropSettling ||
    relocatingPanelIds.length > 0 ||
    relocatingPreviewWindowIds.length > 0 ||
    fullscreenPanelTransitions.length > 0 ||
    panelExitPositions.length > 0 ||
    panelExitCollapsingPositions.length > 0 ||
    panelEnterPositions.length > 0;

  useEffect(() => {
    return () => {
      if (panelDropSettlingTimerRef.current) {
        clearTimeout(panelDropSettlingTimerRef.current);
      }
      if (panelExitTimerRef.current) {
        clearTimeout(panelExitTimerRef.current);
      }
      Object.values(panelEnterTimerIdsRef.current).forEach((timerId) => {
        if (timerId) {
          clearTimeout(timerId);
        }
      });
      panelEnterTimerIdsRef.current = {};
      if (
        typeof window !== "undefined" &&
        panelExitCollapseFrameRef.current !== null
      ) {
        window.cancelAnimationFrame(panelExitCollapseFrameRef.current);
      }
      panelExitCollapseFrameRef.current = null;
      if (zenBottomChromeHoverTimerRef.current) {
        clearTimeout(zenBottomChromeHoverTimerRef.current);
      }
      if (zenChromeRevealIntentRef.current) {
        clearTimeout(zenChromeRevealIntentRef.current.timer);
      }
      if (typeof window !== "undefined") {
        pendingPanelCloseFrameIdsRef.current.forEach((frameId) =>
          window.cancelAnimationFrame(frameId),
        );
        if (zenViewportMouseMoveFrameRef.current !== null) {
          window.cancelAnimationFrame(zenViewportMouseMoveFrameRef.current);
        }
      }
      Object.values(fullscreenPanelTransitionTimerIdsRef.current).forEach(
        (timerId) => {
          if (timerId) {
            clearTimeout(timerId);
          }
        },
      );
      pendingPanelCloseFrameIdsRef.current = [];
      fullscreenPanelTransitionTimerIdsRef.current = {};
      zenViewportMouseMoveFrameRef.current = null;
      zenViewportPointerRef.current = null;
      zenViewportChromeStateRef.current = createEmptyZenViewportChromeState();
      zenChromeRevealIntentRef.current = null;
      zenTopChromeOccludedHeaderActiveRef.current = false;
      setRelocatingPanelIds([]);
      setRelocatingPreviewWindowIds([]);
      setPanelDropSettlingPositions([]);
      setFullscreenPanelTransitions([]);
      setPanelExitPositions([]);
      setPanelExitSlotSizes(createEmptySnappedSlotSizes());
      setPanelEnterPositions([]);
      panelPresenceBypassPositionsRef.current = [];
      setPanelPresenceBypassPositions([]);
      heldPanelShortcutRef.current = null;
      pressedShortcutCodesRef.current.clear();
    };
  }, []);

  const [projectPathCopiedVisible, setProjectPathCopiedVisible] =
    useState(false);

  const isLogicalFullscreenPanel = useCallback(
    (config: PanelConfig) =>
      config.mode === "floating" &&
      config.x === 0 &&
      config.y === 0 &&
      config.size.width >= panelWorkspaceSize.width - 1 &&
      config.size.height >= panelWorkspaceSize.height - 1,
    [panelWorkspaceSize.height, panelWorkspaceSize.width],
  );

  const isLogicalFullscreenPreviewWindow = useCallback(
    (windowState: PreviewWindow) =>
      windowState.mode === "floating" &&
      windowState.x === 0 &&
      windowState.y === 0 &&
      windowState.width >= panelWorkspaceSize.width - 1 &&
      windowState.height >= panelWorkspaceSize.height - 1,
    [panelWorkspaceSize.height, panelWorkspaceSize.width],
  );

  const fullscreenSurfaceIds = useMemo(() => {
    const ids: string[] = [];
    (Object.keys(panelConfigs) as PanelId[]).forEach((panelId) => {
      if (panels[panelId] && isLogicalFullscreenPanel(panelConfigs[panelId])) {
        ids.push(panelSurfaceId(panelId));
      }
    });
    previewWindows.forEach((windowState) => {
      if (isLogicalFullscreenPreviewWindow(windowState)) {
        ids.push(previewSurfaceId(windowState.id));
      }
    });
    return ids;
  }, [
    isLogicalFullscreenPanel,
    isLogicalFullscreenPreviewWindow,
    panelConfigs,
    panels,
    previewWindows,
  ]);

  const aiChatFullscreenMenuActive = useMemo(() => {
    const topmostFloatingPanelId = getTopmostFloatingPanelId(
      panels,
      panelConfigs,
    );
    const hasFloatingPreviewWindow = previewWindows.some(
      (windowState) => windowState.mode === "floating",
    );
    return (
      topmostFloatingPanelId === "aiChat" &&
      panels.aiChat &&
      isLogicalFullscreenPanel(panelConfigs.aiChat) &&
      !hasFloatingPreviewWindow
    );
  }, [isLogicalFullscreenPanel, panelConfigs, panels, previewWindows]);

  const isAIChatTopmostFullscreen = useCallback((): boolean => {
    const topmostFloatingPanelId = getTopmostFloatingPanelId(
      panelsRef.current,
      panelConfigsRef.current,
    );
    const hasFloatingPreviewWindow = usePreviewWindowStore
      .getState()
      .windows.some((windowState) => windowState.mode === "floating");
    return (
      topmostFloatingPanelId === "aiChat" &&
      panelsRef.current.aiChat &&
      isLogicalFullscreenPanel(panelConfigsRef.current.aiChat) &&
      !hasFloatingPreviewWindow
    );
  }, [isLogicalFullscreenPanel]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("arlecchino:menu-state", {
        detail: {
          canCloseFullscreenPanel: fullscreenSurfaceIds.length > 0,
          aiChatFullscreenActive: aiChatFullscreenMenuActive,
        },
      }),
    );
  }, [aiChatFullscreenMenuActive, fullscreenSurfaceIds.length]);

  const startFullscreenPanelTransition = useCallback(
    (panelId: FullscreenPanelId, applyTransition: () => void) => {
      if (reducePanelMotion || typeof window === "undefined") {
        applyTransition();
        return;
      }

      beginPanelMotionWindow();

      const transitionTarget: FullscreenPanelTransitionTarget = {
        panelId,
        position: panelConfigsRef.current[panelId].position,
      };
      setFullscreenPanelTransitions((currentTransitions) => [
        ...currentTransitions.filter((target) => target.panelId !== panelId),
        transitionTarget,
      ]);
      applyTransition();

      const existingTimerId =
        fullscreenPanelTransitionTimerIdsRef.current[panelId];
      if (existingTimerId) {
        clearTimeout(existingTimerId);
      }

      const timerId = window.setTimeout(() => {
        delete fullscreenPanelTransitionTimerIdsRef.current[panelId];
        setFullscreenPanelTransitions((currentTransitions) =>
          currentTransitions.filter((target) => target.panelId !== panelId),
        );
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS + 180);
      fullscreenPanelTransitionTimerIdsRef.current[panelId] = timerId;
    },
    [beginPanelMotionWindow, reducePanelMotion],
  );

  const applyRestoreOrEnterPanelFullscreen = useCallback(
    (
      panelId: FullscreenPanelId,
      snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
    ) => {
      const currentConfig = panelConfigsRef.current[panelId];
      const isFullscreenConfig = isLogicalFullscreenPanel(currentConfig);
      const shouldRestore =
        isFullscreenConfig ||
        (snapshotRef.current !== null &&
          currentConfig.mode === "floating" &&
          currentConfig.x === 0 &&
          currentConfig.y === 0);

      if (shouldRestore) {
        const saved = snapshotRef.current;
        snapshotRef.current = null;
        setFloatingPresenceVersion((version) => version + 1);
        const fallbackPosition =
          resolveSmartSnappedPosition(
            panelId,
            rememberedSnappedPositionsRef.current[panelId],
            panelsRef.current,
            panelConfigsRef.current,
          ) ?? rememberedSnappedPositionsRef.current[panelId];
        const fallbackSize = normalizePanelSizeForPosition(
          fallbackPosition,
          DEFAULT_PANEL_CONFIGS[panelId].size,
        );
        const restoredMode = saved?.mode ?? "snapped";
        const restoredPosition = saved
          ? currentConfig.position
          : fallbackPosition;
        const nextPanelConfigs = {
          ...panelConfigsRef.current,
          [panelId]: {
            ...panelConfigsRef.current[panelId],
            mode: restoredMode,
            position: restoredPosition,
            x: saved?.x ?? 0,
            y: saved?.y ?? 0,
            size: saved?.size ?? fallbackSize,
          },
        };

        applyPanelConfigsState(nextPanelConfigs);
        if (restoredMode === "snapped") {
          applyRememberedSnappedPositionsState({
            ...rememberedSnappedPositionsRef.current,
            [panelId]: restoredPosition,
          });
        }
        return;
      }

      snapshotRef.current = {
        mode: currentConfig.mode,
        x: currentConfig.x,
        y: currentConfig.y,
        size: { ...currentConfig.size },
      };
      applyPanelConfigsState({
        ...panelConfigsRef.current,
        [panelId]: {
          ...panelConfigsRef.current[panelId],
          mode: "floating",
          x: 0,
          y: 0,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        },
      });
    },
    [
      applyPanelConfigsState,
      applyRememberedSnappedPositionsState,
      isLogicalFullscreenPanel,
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
    ],
  );

  const restoreOrEnterPanelFullscreen = useCallback(
    (
      panelId: FullscreenPanelId,
      snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
    ) => {
      startFullscreenPanelTransition(panelId, () => {
        applyRestoreOrEnterPanelFullscreen(panelId, snapshotRef);
      });
    },
    [applyRestoreOrEnterPanelFullscreen, startFullscreenPanelTransition],
  );

  const pinZenPanelIfShortcutOpened = useCallback(
    (panelId: PanelId) => {
      if (!zenModeEnabled || !panelsRef.current[panelId]) {
        return;
      }

      const config = panelConfigsRef.current[panelId];
      if (config.mode !== "snapped") {
        return;
      }

      updateZenPinnedPanelsState((currentPins) =>
        currentPins[panelId]
          ? currentPins
          : {
              ...currentPins,
              [panelId]: true,
            },
      );
    },
    [updateZenPinnedPanelsState, zenModeEnabled],
  );

  const isZenHiddenSnappedPanel = useCallback(
    (panelId: PanelId) =>
      zenModeEnabled &&
      panelsRef.current[panelId] &&
      panelConfigsRef.current[panelId].mode === "snapped" &&
      !effectivePanelsRef.current[panelId],
    [zenModeEnabled],
  );

  function togglePanelCompactFromShortcut(
    panelId: PanelId,
    snapshotRef?: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ) {
    const currentConfig = panelConfigsRef.current[panelId];
    const looksFullscreen =
      currentConfig.mode === "floating" &&
      currentConfig.x === 0 &&
      currentConfig.y === 0 &&
      (isLogicalFullscreenPanel(currentConfig) ||
        snapshotRef?.current !== null);

    if (snapshotRef && panelsRef.current[panelId] && looksFullscreen) {
      const restorePosition = currentConfig.position;
      restoreOrEnterPanelFullscreen(panelId as FullscreenPanelId, snapshotRef);
      updatePanelsState((previous) => {
        let changed = false;
        const nextPanels = { ...previous };

        (Object.keys(panelConfigsRef.current) as PanelId[]).forEach((id) => {
          if (id === panelId || !nextPanels[id]) {
            return;
          }

          const otherConfig = panelConfigsRef.current[id];
          if (
            otherConfig.mode === "snapped" &&
            otherConfig.position === restorePosition
          ) {
            nextPanels[id] = false;
            changed = true;
          }
        });

        return changed ? nextPanels : previous;
      });
      pinZenPanelIfShortcutOpened(panelId);
      return;
    }

    const wasVisible = panelsRef.current[panelId];
    const isZenHiddenSnappedPanel =
      zenModeEnabled &&
      wasVisible &&
      panelConfigsRef.current[panelId].mode === "snapped" &&
      !effectivePanelsRef.current[panelId];
    if (isZenHiddenSnappedPanel) {
      pinZenPanelIfShortcutOpened(panelId);
      markActivePanel(panelId);
      return;
    }

    if (panelId === "problems" && !wasVisible) {
      openProblemsInAvailableSlot();
    } else {
      toggleNamedPanel(panelId);
    }
    if (!wasVisible) {
      pinZenPanelIfShortcutOpened(panelId);
    }
  }

  function closePanelFullscreenFromShortcut(
    panelId: FullscreenPanelId,
    snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ): boolean {
    const currentConfig = panelConfigsRef.current[panelId];
    const looksFullscreen =
      panelsRef.current[panelId] &&
      currentConfig.mode === "floating" &&
      currentConfig.x === 0 &&
      currentConfig.y === 0 &&
      (isLogicalFullscreenPanel(currentConfig) || snapshotRef.current !== null);

    if (!looksFullscreen) {
      return false;
    }

    const saved = snapshotRef.current;

    startFullscreenPanelTransition(panelId, () => {
      const latestConfig = panelConfigsRef.current[panelId];
      snapshotRef.current = null;
      setFloatingPresenceVersion((version) => version + 1);

      const fallbackPosition =
        resolveSmartSnappedPosition(
          panelId,
          rememberedSnappedPositionsRef.current[panelId],
          panelsRef.current,
          panelConfigsRef.current,
        ) ?? rememberedSnappedPositionsRef.current[panelId];
      const fallbackSize = normalizePanelSizeForPosition(
        fallbackPosition,
        DEFAULT_PANEL_CONFIGS[panelId].size,
      );
      const restoredMode = saved?.mode ?? "snapped";
      const restoredPosition = saved ? latestConfig.position : fallbackPosition;

      applyPanelConfigsState({
        ...panelConfigsRef.current,
        [panelId]: {
          ...latestConfig,
          mode: restoredMode,
          position: restoredPosition,
          x: saved?.x ?? 0,
          y: saved?.y ?? 0,
          size: saved?.size ?? fallbackSize,
        },
      });
      if (restoredMode === "snapped") {
        applyRememberedSnappedPositionsState({
          ...rememberedSnappedPositionsRef.current,
          [panelId]: restoredPosition,
        });
      }
      applyPanelsState({ ...panelsRef.current, [panelId]: false });
    });
    return true;
  }

  function closeActiveFullscreenPanelFromShortcut(): boolean {
    if (closePanelFullscreenFromShortcut("aiChat", aiChatPreFullscreenRef)) {
      return true;
    }

    if (closePanelFullscreenFromShortcut("git", gitPreFullscreenRef)) {
      return true;
    }

    if (
      closePanelFullscreenFromShortcut("problems", problemsPreFullscreenRef)
    ) {
      return true;
    }

    if (closePanelFullscreenFromShortcut("code", codePreFullscreenRef)) {
      return true;
    }

    if (
      !useTerminalStore.getState().tuiModeActive &&
      closePanelFullscreenFromShortcut("terminal", terminalPreFullscreenRef)
    ) {
      return true;
    }

    if (
      closePanelFullscreenFromShortcut(
        "markdownPreview",
        markdownPreviewPreFullscreenRef,
      )
    ) {
      return true;
    }

    return false;
  }

  function togglePanelFullscreenFromShortcut(
    panelId: FullscreenPanelId,
    snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ) {
    if (closePanelFullscreenFromShortcut(panelId, snapshotRef)) {
      return;
    }

    if (
      panelsRef.current[panelId] &&
      isLogicalFullscreenPanel(panelConfigsRef.current[panelId])
    ) {
      restoreOrEnterPanelFullscreen(panelId, snapshotRef);
      return;
    }

    startFullscreenPanelTransition(panelId, () => {
      const currentConfig = panelConfigsRef.current[panelId];
      snapshotRef.current = {
        mode: currentConfig.mode,
        x: currentConfig.x,
        y: currentConfig.y,
        size: { ...currentConfig.size },
      };

      applyPanelsState({ ...panelsRef.current, [panelId]: true });
      applyPanelConfigsState({
        ...panelConfigsRef.current,
        [panelId]: {
          ...currentConfig,
          mode: "floating",
          x: 0,
          y: 0,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        },
      });
    });
  }

  useEffect(() => {
    const workspace = panelWorkspaceRef.current;
    if (!workspace) {
      setPanelWorkspaceSize(logicalViewport);
      return;
    }

    const updatePanelWorkspaceSize = () => {
      const rect = workspace.getBoundingClientRect();
      const nextSize = {
        width: screenToLogicalPixels(rect.width, uiScale),
        height: screenToLogicalPixels(rect.height, uiScale),
      };

      setPanelWorkspaceSize((currentSize) => {
        if (
          Math.abs(currentSize.width - nextSize.width) < 0.5 &&
          Math.abs(currentSize.height - nextSize.height) < 0.5
        ) {
          return currentSize;
        }

        return nextSize;
      });
    };

    updatePanelWorkspaceSize();

    const resizeObserver = new ResizeObserver(updatePanelWorkspaceSize);
    resizeObserver.observe(workspace);

    return () => {
      resizeObserver.disconnect();
    };
  }, [logicalViewport, uiScale]);

  useEffect(() => {
    const topChrome = topChromeRef.current;
    const bottomChrome = bottomChromeRef.current;
    if (!topChrome && !bottomChrome) {
      return;
    }

    const updateChromeMeasurements = () => {
      if (topChrome) {
        const topRect = topChrome.getBoundingClientRect();
        setTopChromeHeight((currentHeight) => {
          const nextHeight = screenToLogicalPixels(topRect.height, uiScale);
          return Math.abs(currentHeight - nextHeight) < 0.5
            ? currentHeight
            : nextHeight;
        });
      }

      if (bottomChrome) {
        const bottomRect = bottomChrome.getBoundingClientRect();
        setBottomChromeHeight((currentHeight) => {
          const nextHeight = screenToLogicalPixels(bottomRect.height, uiScale);
          return Math.abs(currentHeight - nextHeight) < 0.5
            ? currentHeight
            : nextHeight;
        });
      }
    };

    updateChromeMeasurements();

    const resizeObserver = new ResizeObserver(updateChromeMeasurements);
    if (topChrome) {
      resizeObserver.observe(topChrome);
    }
    if (bottomChrome) {
      resizeObserver.observe(bottomChrome);
    }
    window.addEventListener("resize", updateChromeMeasurements);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateChromeMeasurements);
    };
  }, [uiScale]);

  const setZenTopChromeEdgeSource = useCallback((active: boolean) => {
    setZenTopChromeEdgeActive((current) =>
      current === active ? current : active,
    );
  }, []);

  const setZenTopChromePointerSource = useCallback((active: boolean) => {
    setZenTopChromePointerInside((current) =>
      current === active ? current : active,
    );
  }, []);

  const setZenTopChromeOccludedHeaderSource = useCallback((active: boolean) => {
    zenTopChromeOccludedHeaderActiveRef.current = active;
    setZenTopChromeOccludedHeaderActive((current) =>
      current === active ? current : active,
    );
  }, []);

  const clearZenChromeRevealIntent = useCallback(
    (source?: ZenChromeRevealIntentSource) => {
      const pendingIntent = zenChromeRevealIntentRef.current;
      if (!pendingIntent || (source && pendingIntent.source !== source)) {
        return;
      }

      clearTimeout(pendingIntent.timer);
      zenChromeRevealIntentRef.current = null;
    },
    [],
  );

  const showZenBottomChrome = useCallback(() => {
    if (zenBottomChromeHoverTimerRef.current) {
      clearTimeout(zenBottomChromeHoverTimerRef.current);
      zenBottomChromeHoverTimerRef.current = null;
    }
    setZenBottomChromeHovered((current) => (current ? current : true));
  }, []);

  const hideZenBottomChrome = useCallback(() => {
    if (zenBottomChromeHoverTimerRef.current) {
      clearTimeout(zenBottomChromeHoverTimerRef.current);
    }
    zenBottomChromeHoverTimerRef.current = setTimeout(() => {
      zenBottomChromeHoverTimerRef.current = null;
      setZenBottomChromeHovered((current) => (current ? false : current));
    }, ZEN_CHROME_HOVER_CLOSE_DELAY_MS);
  }, []);

  const revealZenChromeIntentSource = useCallback(
    (source: ZenChromeRevealIntentSource) => {
      if (source === "top-edge") {
        zenViewportChromeStateRef.current = {
          ...zenViewportChromeStateRef.current,
          top: true,
        };
        setZenTopChromeEdgeSource(true);
        return;
      }

      if (source === "top-occluded-header") {
        setZenTopChromeOccludedHeaderSource(true);
        return;
      }

      zenViewportChromeStateRef.current = {
        ...zenViewportChromeStateRef.current,
        bottom: true,
      };
      showZenBottomChrome();
    },
    [
      setZenTopChromeEdgeSource,
      setZenTopChromeOccludedHeaderSource,
      showZenBottomChrome,
    ],
  );

  const scheduleZenChromeRevealIntent = useCallback(
    (source: ZenChromeRevealIntentSource, clientX: number, clientY: number) => {
      const pendingIntent = zenChromeRevealIntentRef.current;
      if (pendingIntent?.source === source) {
        const distance = Math.hypot(
          clientX - pendingIntent.clientX,
          clientY - pendingIntent.clientY,
        );
        if (distance <= ZEN_CHROME_STATIONARY_MOVE_TOLERANCE) {
          return;
        }
      }

      clearZenChromeRevealIntent();

      const timer = setTimeout(() => {
        const currentIntent = zenChromeRevealIntentRef.current;
        if (!currentIntent || currentIntent.source !== source) {
          return;
        }

        zenChromeRevealIntentRef.current = null;
        revealZenChromeIntentSource(source);
      }, getZenChromeRevealDelay(source));

      zenChromeRevealIntentRef.current = {
        clientX,
        clientY,
        source,
        timer,
      };
    },
    [clearZenChromeRevealIntent, revealZenChromeIntentSource],
  );

  const clearZenTopChromeOccludedHeaderIntent = useCallback(
    (hideSource = true) => {
      clearZenChromeRevealIntent("top-occluded-header");
      if (hideSource) {
        setZenTopChromeOccludedHeaderSource(false);
      }
    },
    [clearZenChromeRevealIntent, setZenTopChromeOccludedHeaderSource],
  );

  const setZenTopChromeInteractionLock = useCallback((active: boolean) => {
    setZenTopChromeInteractionLocked((current) =>
      current === active ? current : active,
    );
  }, []);

  const handleTopChromePopupOpenChange = useCallback((open: boolean) => {
    setZenTopChromePopupOpen((current) => (current === open ? current : open));
  }, []);

  useEffect(() => {
    if (zenModeEnabled) {
      return;
    }

    setZenTopChromeEdgeActive(false);
    setZenTopChromePointerInside(false);
    setZenTopChromePopupOpen(false);
    clearZenChromeRevealIntent();
    clearZenTopChromeOccludedHeaderIntent();
    setZenBottomChromeHovered(false);
    zenViewportPointerRef.current = null;
    zenViewportChromeStateRef.current = createEmptyZenViewportChromeState();
    if (
      typeof window !== "undefined" &&
      zenViewportMouseMoveFrameRef.current !== null
    ) {
      window.cancelAnimationFrame(zenViewportMouseMoveFrameRef.current);
      zenViewportMouseMoveFrameRef.current = null;
    }
  }, [
    clearZenChromeRevealIntent,
    clearZenTopChromeOccludedHeaderIntent,
    zenModeEnabled,
  ]);

  useEffect(() => {
    const previousViewport = previousPanelWorkspaceSizeRef.current;
    previousPanelWorkspaceSizeRef.current = panelWorkspaceSize;

    if (
      Math.abs(previousViewport.width - panelWorkspaceSize.width) < 0.5 &&
      Math.abs(previousViewport.height - panelWorkspaceSize.height) < 0.5
    ) {
      return;
    }

    setPanelConfigs((currentConfigs) => {
      let changed = false;
      const nextConfigs = { ...currentConfigs };

      (Object.keys(currentConfigs) as PanelId[]).forEach((panelId) => {
        const config = currentConfigs[panelId];
        const wasFullscreen =
          config.mode === "floating" &&
          config.x === 0 &&
          config.y === 0 &&
          config.size.width >= previousViewport.width - 1 &&
          config.size.height >= previousViewport.height - 1;

        if (!wasFullscreen) {
          return;
        }

        changed = true;
        nextConfigs[panelId] = {
          ...config,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        };
      });

      return changed ? nextConfigs : currentConfigs;
    });
  }, [panelWorkspaceSize]);
  const [codePanelTabs, setCodePanelTabs] = useState<CodePanelTab[]>([]);
  const [activeCodePanelPath, setActiveCodePanelPath] = useState<string | null>(
    null,
  );
  const codePanelTabsRef = useRef<CodePanelTab[]>([]);
  useEffect(() => {
    codePanelTabsRef.current = codePanelTabs;
  }, [codePanelTabs]);
  const activeCodePanelTab = useMemo(
    () =>
      codePanelTabs.find((tab) => tab.path === activeCodePanelPath) ??
      codePanelTabs[0] ??
      null,
    [activeCodePanelPath, codePanelTabs],
  );
  const activeCodePanelPatchPreview = useMemo(
    () =>
      activeCodePanelTab
        ? selectAIInlinePatchPreviewForPath(
            aiInlinePatchPreviews,
            activeCodePanelTab.path,
            {
              projectPath: activeProjectPath,
              projectSessionId: currentProjectSessionId,
            },
          )
        : null,
    [
      activeCodePanelTab,
      activeProjectPath,
      aiInlinePatchPreviews,
      currentProjectSessionId,
    ],
  );
  const codePanelPatchBusyId =
    activeCodePanelPatchPreview &&
    aiInlinePatchBusyIds[activeCodePanelPatchPreview.id]
      ? activeCodePanelPatchPreview.id
      : null;
  const panelRuntimePayloads = useMemo(
    () => ({
      code: activeCodePanelTab
        ? {
            activePath: activeCodePanelTab.path,
            activeName: activeCodePanelTab.name,
            language: activeCodePanelTab.language,
            line: activeCodePanelTab.line,
            tabCount: codePanelTabs.length,
            tabPaths: codePanelTabs.map((tab) => tab.path).join("\n"),
          }
        : {
            tabCount: 0,
          },
      terminal: {
        tuiModeActive,
        tuiActiveSessionId: tuiActiveSessionId ?? "",
      },
    }),
    [activeCodePanelTab, codePanelTabs, tuiActiveSessionId, tuiModeActive],
  );
  const mainSurfaceSessions = useMemo<SurfaceSession[]>(
    () =>
      tuiModeActive
        ? [
            {
              id: "main:tui-terminal",
              source: "main",
              appletKind: "terminal",
              hostMode: "main-center",
              title: "Terminal TUI",
              active: true,
              pinned: false,
              payload: {
                tuiModeActive: true,
                tuiActiveSessionId: tuiActiveSessionId ?? "",
              },
              geometry: {
                width: panelWorkspaceSize.width,
                height: panelWorkspaceSize.height,
                x: 0,
                y: 0,
              },
            },
          ]
        : [],
    [
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
      tuiActiveSessionId,
      tuiModeActive,
    ],
  );

  useSurfaceRuntimeHostSync({
    panels,
    panelConfigs,
    panelPayloads: panelRuntimePayloads,
    mainSessions: mainSurfaceSessions,
    previewWindows,
    activePreviewWindowId: activePanelId ? null : activePreviewWindowId,
    activePanelId,
    fullscreenSurfaceIds,
  });

  const activateAdjacentCodePanelTab = useCallback(
    (direction: 1 | -1): boolean => {
      if (codePanelTabs.length < 2) {
        return false;
      }

      const activeIndex = Math.max(
        0,
        codePanelTabs.findIndex((tab) => tab.path === activeCodePanelTab?.path),
      );
      const nextIndex = getNextWrappedIndex(
        activeIndex,
        direction,
        codePanelTabs.length,
      );
      const nextTab = codePanelTabs[nextIndex];
      if (!nextTab) {
        return false;
      }

      setActiveCodePanelPath(nextTab.path);
      setEditorStatusFile(nextTab.path, nextTab.name, nextTab.language);
      return true;
    },
    [activeCodePanelTab?.path, codePanelTabs, setEditorStatusFile],
  );
  const activateCodePanelTab = useCallback(
    (path: string) => {
      const tab = codePanelTabsRef.current.find(
        (candidate) => candidate.path === path,
      );
      setActiveCodePanelPath(path);
      if (tab) {
        setEditorStatusFile(tab.path, tab.name, tab.language);
      }
    },
    [setEditorStatusFile],
  );
  const closeCodePanelTab = useCallback(
    (path: string) => {
      const tabIndex = codePanelTabs.findIndex((tab) => tab.path === path);
      if (tabIndex === -1) {
        return;
      }

      const nextTabs = codePanelTabs.filter((tab) => tab.path !== path);
      const nextActiveTab =
        nextTabs[Math.min(tabIndex, nextTabs.length - 1)] ?? null;
      setCodePanelTabs(nextTabs);
      if (activeCodePanelPath === path) {
        setActiveCodePanelPath(nextActiveTab?.path ?? null);
        setEditorStatusFile(
          nextActiveTab?.path ?? null,
          nextActiveTab?.name ?? null,
          nextActiveTab?.language ?? null,
        );
      }
      releaseEditorBackingTab(path);
    },
    [
      activeCodePanelPath,
      codePanelTabs,
      releaseEditorBackingTab,
      setEditorStatusFile,
    ],
  );
  const closeOtherCodePanelTabs = useCallback(
    (path: string) => {
      const tab = codePanelTabs.find((candidate) => candidate.path === path);
      if (!tab) {
        return;
      }

      codePanelTabs
        .filter((candidate) => candidate.path !== path)
        .forEach((candidate) => releaseEditorBackingTab(candidate.path));
      setCodePanelTabs([tab]);
      setActiveCodePanelPath(path);
      setEditorStatusFile(tab.path, tab.name, tab.language);
    },
    [codePanelTabs, releaseEditorBackingTab, setEditorStatusFile],
  );
  const showNotification = useCallback(
    (type: "success" | "error", message: string) => {
      if (type !== "error") {
        return;
      }

      useAppNotificationStore.getState().addNotification({
        kind: "error",
        title: "Action failed",
        message,
        source: "IDE",
      });
    },
    [],
  );

  const {
    closeCreateEntryDialog,
    createEntryDialog,
    copyProjectPathFromShortcut,
    ensureProjectEntryAccess,
    projectEntryActions,
    projectEntryDialogProps,
    pruneProjectEntryDialogs,
    redoProjectEntryOperation,
    remapProjectEntryDialogs,
    undoProjectEntryOperation,
  } = useMainLayoutProjectEntries({
    activeProjectPath,
    tuiModeActive,
    canAccessPath,
    onBeforeMoveEntry: async () => {
      await dirtyEditorFlushHandlerRef.current?.();
    },
    onUserCreatedEntry: (path, isDirectory) => {
      requestExplorerRevealFile(path);
      if (!isDirectory) {
        userCreatedFileOpenRef.current(path);
      }
    },
    showNotification,
    setProjectPathCopiedVisible,
  });

  const handlePluginCommandSuccess = useCallback(
    (message: string) => {
      showNotification("success", message);
    },
    [showNotification],
  );

  const handlePluginCommandError = useCallback(
    (message: string) => {
      showNotification("error", message);
    },
    [showNotification],
  );

  const openCommandDispatcher = useCallback(() => {
    if (tuiModeActive || isDispatcherPaused) {
      return;
    }

    dispatcher.open();
  }, [dispatcher, isDispatcherPaused, tuiModeActive]);

  const toggleCommandDispatcher = useCallback(() => {
    if (tuiModeActive || isDispatcherPaused) {
      return;
    }

    if (dispatcher.isOpen) {
      dispatcher.close();
      return;
    }

    dispatcher.open();
  }, [dispatcher, isDispatcherPaused, tuiModeActive]);

  const submitTerminalCommand = useCallback(
    async (
      command: string,
      terminalName = "Terminal",
      workingDirectory?: string,
    ) => {
      const commandToExecute = commandWithWorkingDirectory(
        command,
        workingDirectory,
      );
      if (!commandToExecute) {
        showNotification("error", "[Run] Command is empty");
        return false;
      }

      const state = useTerminalStore.getState();
      state.initialize();
      let activePane = state.panes.find(
        (pane) => pane.id === state.activePaneId,
      );

      if (!activePane && state.panes.length > 0) {
        activePane = state.panes[0];
        state.setActivePane(activePane.id);
      }

      if (!activePane) {
        showNotification("error", "[Terminal] Terminal pane is not available");
        return false;
      }

      let targetSessionId = activePane.activeTabId;
      if (!targetSessionId) {
        try {
          targetSessionId = await state.createTerminal(
            activePane.id,
            resolvedThemeId,
            terminalName,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to create terminal session";
          showNotification("error", `[Terminal] ${message}`);
          return false;
        }
      }

      const bytes = new TextEncoder().encode(commandToExecute + "\n");
      const binary = Array.from(bytes, (byte) =>
        String.fromCharCode(byte),
      ).join("");

      try {
        await WriteTerminal(targetSessionId, btoa(binary));
        updatePanelsState((previous) => ({ ...previous, terminal: true }));
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to send command to terminal";
        showNotification("error", `[Terminal] ${message}`);
        return false;
      }
    },
    [resolvedThemeId, showNotification, updatePanelsState],
  );

  const executeExecutionProfile = useCallback(
    async (profile: ExecutionProfile) => {
      if (hasMissingTools(profile)) {
        const missing = profile.missingTools?.join(", ") ?? "required tools";
        showNotification(
          "error",
          `[Run] Missing tools for profile "${profile.label}": ${missing}`,
        );
        return false;
      }

      if (profile.kind === "preview") {
        openCanonicalBrowserPreviewRef.current();
        return true;
      }

      return submitTerminalCommand(
        profile.command,
        profile.mode === "debug" ? "Debug" : "Run",
        profile.workingDirectory,
      );
    },
    [showNotification, submitTerminalCommand],
  );

  const openRunDialog = useCallback(() => {
    setExecutionDialogMode("run");
  }, []);

  const openDebugDialog = useCallback(() => {
    setExecutionDialogMode("debug");
  }, []);

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const openDependencyPolicy = useCallback(() => {
    setIsDependencyPolicyOpen(true);
  }, []);

  const checkForUpdates = useCallback(() => {
    void runAutoUpdateCheckWithNotification();
  }, []);

  const closeDependencyPolicy = useCallback(() => {
    setIsDependencyPolicyOpen(false);
  }, []);

  const closeExecutionDialog = useCallback(() => {
    setExecutionDialogMode(null);
  }, []);

  const executeCustomCommand = useCallback(
    async (command: string, mode: "run" | "debug") => {
      const submitted = await submitTerminalCommand(
        command,
        mode === "debug" ? "Debug" : "Run",
      );

      if (submitted) {
        closeExecutionDialog();
      }
    },
    [closeExecutionDialog, submitTerminalCommand],
  );

  const getActiveTerminalSessionId = useCallback((): string | null => {
    const state = useTerminalStore.getState();
    if (state.tuiActiveSessionId) {
      return state.tuiActiveSessionId;
    }

    const activePane = state.panes.find(
      (pane) => pane.id === state.activePaneId,
    );
    return activePane?.activeTabId || null;
  }, []);

  const ensureActiveTerminalSessionId = useCallback(
    async (terminalName = "Terminal"): Promise<string | null> => {
      const state = useTerminalStore.getState();
      state.initialize();

      const existingSessionId = getActiveTerminalSessionId();
      if (existingSessionId) {
        return existingSessionId;
      }

      let activePane = state.panes.find(
        (pane) => pane.id === state.activePaneId,
      );
      if (!activePane && state.panes.length > 0) {
        activePane = state.panes[0];
        state.setActivePane(activePane.id);
      }
      if (!activePane) {
        showNotification("error", "[Terminal] Terminal pane is not available");
        return null;
      }

      try {
        return await state.createTerminal(
          activePane.id,
          resolvedThemeId,
          terminalName,
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to create terminal session";
        showNotification("error", `[Terminal] ${message}`);
        return null;
      }
    },
    [getActiveTerminalSessionId, resolvedThemeId, showNotification],
  );

  const resolveTUIControllablePanelId = useCallback(
    (panel: string): PanelId | null => {
      if (panel === "browser" || panel === "web") {
        return null;
      }
      const panelId = resolvePanelId(panel);
      return panelId === "terminal" ? null : panelId;
    },
    [],
  );

  const resolveDefaultTUIAssistPanel = useCallback((): PanelId => {
    const snapshotPanels = tuiLayoutSnapshot?.panels;

    if (snapshotPanels?.git || panelsRef.current.git) {
      return "git";
    }
    if (snapshotPanels?.aiChat || panelsRef.current.aiChat) {
      return "aiChat";
    }
    if (snapshotPanels?.explorer || panelsRef.current.explorer) {
      return "explorer";
    }

    return "explorer";
  }, [tuiLayoutSnapshot]);

  const openTUIFloatingPanel = useCallback(
    (panelId: PanelId, request?: Partial<PanelOpenRequest> | null) => {
      const state = useTerminalStore.getState();
      const position = normalizeTUIAssistAnchor(
        request?.anchor ?? request?.position,
        state.tuiAssist.anchor,
      );
      const normalizedRequest: PanelOpenRequest = {
        ...request,
        panel: panelId,
        position,
        mode: request?.mode ?? "snapped",
      };
      const { nextPanels, nextConfig, nextRememberedSnappedPositions } =
        computeNextPanelOpenState(
          panelId,
          normalizedRequest,
          panelsRef.current,
          panelConfigsRef.current,
          rememberedSnappedPositionsRef.current,
        );

      applyPanelsState(nextPanels);
      applyPanelConfigsState({
        ...panelConfigsRef.current,
        [panelId]: nextConfig,
      });
      applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
      state.setTUIAssist({ active: false, panel: null, anchor: position });
      if (state.tuiModeActive) {
        setTimeout(() => state.focusActiveTerminal(), 80);
      }
    },
    [
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
    ],
  );

  const openTUIAssistPanel = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      const assistPanel = request?.panel
        ? resolveTUIControllablePanelId(request.panel)
        : resolveDefaultTUIAssistPanel();
      if (!assistPanel) {
        return { handled: false, reason: "Unknown TUI panel." };
      }

      openTUIFloatingPanel(assistPanel, request);
      return { handled: true, panel: assistPanel };
    },
    [
      openTUIFloatingPanel,
      resolveDefaultTUIAssistPanel,
      resolveTUIControllablePanelId,
    ],
  );

  const toggleTUIAssistPanel = useCallback(
    (panel: PanelId) => {
      const state = useTerminalStore.getState();
      if (!state.tuiModeActive) {
        return;
      }

      const isVisible = panelsRef.current[panel];
      if (isVisible) {
        applyPanelsState({ ...panelsRef.current, [panel]: false });
        state.setTUIAssist({ active: false, panel: null });
        setTimeout(() => state.focusActiveTerminal(), 80);
        return;
      }

      openTUIFloatingPanel(panel, {
        panel,
        position: state.tuiAssist.anchor,
        mode: "snapped",
      });
    },
    [applyPanelsState, openTUIFloatingPanel],
  );

  const closeTUIAssistPanel = useCallback(() => {
    const state = useTerminalStore.getState();
    state.setTUIAssist({
      active: false,
      panel: null,
      anchor: state.tuiAssist.anchor,
    });
    setTimeout(() => state.focusActiveTerminal(), 80);
  }, []);

  const setTUIAssistRatio = useCallback((value: unknown) => {
    let ratio: number | null = null;

    if (typeof value === "number") {
      ratio = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      "ratio" in value &&
      typeof (value as { ratio: unknown }).ratio === "number"
    ) {
      ratio = (value as { ratio: number }).ratio;
    }

    if (ratio === null) {
      return;
    }

    const state = useTerminalStore.getState();
    if (!state.tuiModeActive) {
      return;
    }

    state.setTUIAssist({ active: true, ratio, anchor: state.tuiAssist.anchor });
  }, []);

  const applyPanelPresenceBypassPositionsState = useCallback(
    (nextPositions: PanelPosition[]) => {
      panelPresenceBypassPositionsRef.current = nextPositions;
      setPanelPresenceBypassPositions(nextPositions);
    },
    [],
  );

  const updatePanelPresenceBypassPositionsState = useCallback(
    (
      updater: (currentPositions: PanelPosition[]) => PanelPosition[],
    ): PanelPosition[] => {
      const nextPositions = updater(panelPresenceBypassPositionsRef.current);
      applyPanelPresenceBypassPositionsState(nextPositions);
      return nextPositions;
    },
    [applyPanelPresenceBypassPositionsState],
  );

  const restoreSnappedSlotPresence = useCallback(
    (position: PanelPosition): boolean => {
      if (!panelPresenceBypassPositionsRef.current.includes(position)) {
        return false;
      }

      updatePanelPresenceBypassPositionsState((currentPositions) =>
        currentPositions.filter(
          (currentPosition) => currentPosition !== position,
        ),
      );
      return true;
    },
    [updatePanelPresenceBypassPositionsState],
  );

  const schedulePanelCloseAfterPresenceRestore = useCallback(
    (closePanel: () => void) => {
      if (typeof window === "undefined") {
        closePanel();
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        const closeFrameId = window.requestAnimationFrame(() => {
          pendingPanelCloseFrameIdsRef.current =
            pendingPanelCloseFrameIdsRef.current.filter(
              (currentFrameId) =>
                currentFrameId !== frameId && currentFrameId !== closeFrameId,
            );
          closePanel();
        });
        pendingPanelCloseFrameIdsRef.current = [
          ...pendingPanelCloseFrameIdsRef.current.filter(
            (currentFrameId) => currentFrameId !== frameId,
          ),
          closeFrameId,
        ];
      });
      pendingPanelCloseFrameIdsRef.current = [
        ...pendingPanelCloseFrameIdsRef.current,
        frameId,
      ];
    },
    [],
  );

  const startPanelDropSettling = useCallback(
    (
      options: {
        panels?: PanelId[];
        previewWindows?: string[];
        positions?: PanelPosition[];
      } = {},
    ) => {
      if (panelDropSettlingTimerRef.current) {
        clearTimeout(panelDropSettlingTimerRef.current);
      }

      beginPanelMotionWindow();
      setPanelDropSettling(true);
      setRelocatingPanelIds(options.panels ?? []);
      setRelocatingPreviewWindowIds(options.previewWindows ?? []);
      setPanelDropSettlingPositions(options.positions ?? []);
      updatePanelPresenceBypassPositionsState((currentPositions) =>
        uniquePanelPositions([
          ...currentPositions,
          ...(options.positions ?? []),
        ]),
      );
      panelDropSettlingTimerRef.current = setTimeout(() => {
        panelDropSettlingTimerRef.current = null;
        setPanelDropSettling(false);
        setRelocatingPanelIds([]);
        setRelocatingPreviewWindowIds([]);
        setPanelDropSettlingPositions([]);
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS + 120);
    },
    [beginPanelMotionWindow, updatePanelPresenceBypassPositionsState],
  );

  const startSnappedSlotEnter = useCallback(
    (position: PanelPosition) => {
      if (reducePanelMotion) {
        return;
      }

      beginPanelMotionWindow();
      const existingTimerId = panelEnterTimerIdsRef.current[position];
      if (existingTimerId) {
        clearTimeout(existingTimerId);
      }

      setPanelEnterPositions((currentPositions) =>
        uniquePanelPositions([...currentPositions, position]),
      );

      panelEnterTimerIdsRef.current[position] = setTimeout(() => {
        delete panelEnterTimerIdsRef.current[position];
        setPanelEnterPositions((currentPositions) =>
          currentPositions.filter(
            (currentPosition) => currentPosition !== position,
          ),
        );
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS + 120);
    },
    [beginPanelMotionWindow, reducePanelMotion],
  );

  const startSnappedSlotExit = useCallback(
    (position: PanelPosition, slotSize: number) => {
      if (reducePanelMotion) {
        return;
      }

      beginPanelMotionWindow();
      if (panelExitTimerRef.current) {
        clearTimeout(panelExitTimerRef.current);
      }
      if (
        typeof window !== "undefined" &&
        panelExitCollapseFrameRef.current !== null
      ) {
        window.cancelAnimationFrame(panelExitCollapseFrameRef.current);
      }
      const enterTimerId = panelEnterTimerIdsRef.current[position];
      if (enterTimerId) {
        clearTimeout(enterTimerId);
        delete panelEnterTimerIdsRef.current[position];
      }

      setPanelExitSlotSizes((currentSizes) => {
        if (currentSizes[position] === slotSize) {
          return currentSizes;
        }

        return { ...currentSizes, [position]: slotSize };
      });
      setPanelExitPositions((currentPositions) =>
        uniquePanelPositions([...currentPositions, position]),
      );
      panelExitCollapseFrameRef.current = window.requestAnimationFrame(() => {
        panelExitCollapseFrameRef.current = window.requestAnimationFrame(() => {
          panelExitCollapseFrameRef.current = window.requestAnimationFrame(
            () => {
              panelExitCollapseFrameRef.current = null;
              setPanelExitCollapsingPositions((currentPositions) =>
                uniquePanelPositions([...currentPositions, position]),
              );
            },
          );
        });
      });
      setPanelEnterPositions((currentPositions) =>
        currentPositions.filter(
          (currentPosition) => currentPosition !== position,
        ),
      );
      panelExitTimerRef.current = setTimeout(() => {
        panelExitTimerRef.current = null;
        setPanelExitPositions([]);
        setPanelExitCollapsingPositions([]);
        setPanelExitSlotSizes(createEmptySnappedSlotSizes());
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS + 700);
    },
    [beginPanelMotionWindow, reducePanelMotion],
  );

  const finishSnappedSlotExit = useCallback((position: PanelPosition) => {
    setPanelExitPositions((currentPositions) =>
      currentPositions.filter(
        (currentPosition) => currentPosition !== position,
      ),
    );
    setPanelExitCollapsingPositions((currentPositions) =>
      currentPositions.filter(
        (currentPosition) => currentPosition !== position,
      ),
    );
    setPanelExitSlotSizes((currentSizes) =>
      currentSizes[position] === 0
        ? currentSizes
        : { ...currentSizes, [position]: 0 },
    );
  }, []);

  const startPanelExitMotion = useCallback(
    (panelId: PanelId) => {
      if (!panelsRef.current[panelId]) {
        return;
      }

      beginPanelMotionWindow();
      const currentConfig = panelConfigsRef.current[panelId];
      if (currentConfig.mode !== "snapped") {
        return;
      }

      if (panelId === "terminal" && useTerminalStore.getState().tuiModeActive) {
        return;
      }

      if (zenModeEnabled && !layoutPanelsRef.current[panelId]) {
        return;
      }

      startSnappedSlotExit(
        currentConfig.position,
        getPrimarySnappedSlotSize(currentConfig.position, currentConfig.size),
      );
    },
    [beginPanelMotionWindow, startSnappedSlotExit, zenModeEnabled],
  );

  const startPreviewWindowExitMotion = useCallback(
    (windowState: PreviewWindow | undefined) => {
      if (!windowState || windowState.mode !== "snapped") {
        return;
      }

      startSnappedSlotExit(
        windowState.position,
        windowState.position === "left" || windowState.position === "right"
          ? windowState.width
          : windowState.height,
      );
    },
    [startSnappedSlotExit],
  );

  const effectivePanels = useMemo<PanelVisibility>(() => {
    if (tuiModeActive) {
      return {
        ...panels,
        terminal: false,
      };
    }

    if (!zenModeEnabled) {
      return panels;
    }

    const nextPanels = { ...panels };
    (Object.keys(panelConfigs) as PanelId[]).forEach((panelId) => {
      if (!panels[panelId]) {
        nextPanels[panelId] = false;
        return;
      }

      const config = panelConfigs[panelId];
      if (
        config.mode !== "snapped" ||
        (panelId === "terminal" && tuiModeActive)
      ) {
        nextPanels[panelId] = true;
        return;
      }

      nextPanels[panelId] = zenPinnedPanels[panelId];
    });

    return nextPanels;
  }, [panelConfigs, panels, tuiModeActive, zenModeEnabled, zenPinnedPanels]);

  const layoutPanels = useMemo<PanelVisibility>(() => {
    if (tuiModeActive) {
      return {
        ...panels,
        terminal: false,
      };
    }

    if (!zenModeEnabled) {
      return panels;
    }

    const nextPanels = { ...panels };
    (Object.keys(panelConfigs) as PanelId[]).forEach((panelId) => {
      if (!panels[panelId]) {
        nextPanels[panelId] = false;
        return;
      }

      const config = panelConfigs[panelId];
      if (
        config.mode !== "snapped" ||
        (panelId === "terminal" && tuiModeActive)
      ) {
        nextPanels[panelId] = true;
        return;
      }

      nextPanels[panelId] = zenPinnedPanels[panelId];
    });

    return nextPanels;
  }, [panelConfigs, panels, tuiModeActive, zenModeEnabled, zenPinnedPanels]);

  useEffect(() => {
    effectivePanelsRef.current = effectivePanels;
  }, [effectivePanels]);

  useEffect(() => {
    layoutPanelsRef.current = layoutPanels;
  }, [layoutPanels]);

  useEffect(() => {
    const previousLayoutPanels = previousLayoutPanelsRef.current;
    previousLayoutPanelsRef.current = layoutPanels;

    if (!previousLayoutPanels || !zenModeEnabled) {
      return;
    }

    (Object.keys(layoutPanels) as PanelId[]).forEach((panelId) => {
      if (
        !panels[panelId] ||
        !previousLayoutPanels[panelId] ||
        layoutPanels[panelId]
      ) {
        return;
      }

      const config = panelConfigs[panelId];
      if (config.mode !== "snapped") {
        return;
      }

      if (panelId === "terminal" && tuiModeActive) {
        return;
      }

      startSnappedSlotExit(
        config.position,
        getPrimarySnappedSlotSize(config.position, config.size),
      );
    });
  }, [
    layoutPanels,
    panelConfigs,
    panels,
    startSnappedSlotExit,
    tuiModeActive,
    zenModeEnabled,
  ]);

  const toggleZenPinnedPanel = useCallback(
    (panelId: PanelId) => {
      if (!zenModeEnabled || !panelsRef.current[panelId]) {
        return;
      }

      const config = panelConfigsRef.current[panelId];
      if (config.mode !== "snapped") {
        return;
      }

      updateZenPinnedPanelsState((currentPins) => ({
        ...currentPins,
        [panelId]: !currentPins[panelId],
      }));
    },
    [updateZenPinnedPanelsState, zenModeEnabled],
  );

  const closePanelWithMotion = useCallback(
    (panelId: PanelId) => {
      if (panelId === "code") {
        setEditorStatusFile(null, null, null);
      }
      const currentConfig = panelConfigsRef.current[panelId];
      const restoredSlotPresence =
        panelsRef.current[panelId] &&
        currentConfig.mode === "snapped" &&
        !(
          panelId === "terminal" && useTerminalStore.getState().tuiModeActive
        ) &&
        restoreSnappedSlotPresence(currentConfig.position);
      const shouldDelaySnappedClose =
        panelsRef.current[panelId] &&
        currentConfig.mode === "snapped" &&
        !(
          panelId === "terminal" && useTerminalStore.getState().tuiModeActive
        ) &&
        !reducePanelMotion;
      const closePanel = () => {
        updatePanelsState((previous) =>
          previous[panelId] ? { ...previous, [panelId]: false } : previous,
        );
      };

      startPanelExitMotion(panelId);
      if (
        (restoredSlotPresence && !reducePanelMotion) ||
        shouldDelaySnappedClose
      ) {
        schedulePanelCloseAfterPresenceRestore(closePanel);
        return;
      }

      closePanel();
    },
    [
      reducePanelMotion,
      restoreSnappedSlotPresence,
      schedulePanelCloseAfterPresenceRestore,
      setEditorStatusFile,
      startPanelExitMotion,
      updatePanelsState,
    ],
  );

  const handleMarkdownPreviewSourceChange = useCallback(
    (source: MarkdownPreviewSource | null) => {
      setMarkdownPreviewSource(source);
    },
    [],
  );

  const handleToggleMarkdownPreview = useCallback(() => {
    if (isZenHiddenSnappedPanel("markdownPreview")) {
      pinZenPanelIfShortcutOpened("markdownPreview");
      markActivePanel("markdownPreview");
      return;
    }

    if (panelsRef.current.markdownPreview) {
      closePanelWithMotion("markdownPreview");
      return;
    }

    const { nextPanels, nextConfig, nextRememberedSnappedPositions } =
      computeNextPanelOpenState(
        "markdownPreview",
        {
          panel: "markdownPreview",
          mode: "snapped",
          position: "right",
          width: 420,
        },
        panelsRef.current,
        panelConfigsRef.current,
        rememberedSnappedPositionsRef.current,
      );

    applyPanelsState(nextPanels);
    applyPanelConfigsState({
      ...panelConfigsRef.current,
      markdownPreview: nextConfig,
    });
    applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
    pinZenPanelIfShortcutOpened("markdownPreview");
  }, [
    applyPanelConfigsState,
    applyPanelsState,
    applyRememberedSnappedPositionsState,
    closePanelWithMotion,
    isZenHiddenSnappedPanel,
    markActivePanel,
    pinZenPanelIfShortcutOpened,
  ]);

  const closePreviewWindowWithMotion = useCallback(
    (windowId: string) => {
      const targetWindow = usePreviewWindowStore
        .getState()
        .windows.find((windowState) => windowState.id === windowId);
      const restoredSlotPresence =
        targetWindow?.mode === "snapped" &&
        restoreSnappedSlotPresence(targetWindow.position);

      startPreviewWindowExitMotion(targetWindow);
      if (restoredSlotPresence && !reducePanelMotion) {
        schedulePanelCloseAfterPresenceRestore(() =>
          closePreviewWindow(windowId),
        );
        return;
      }

      closePreviewWindow(windowId);
    },
    [
      closePreviewWindow,
      reducePanelMotion,
      restoreSnappedSlotPresence,
      schedulePanelCloseAfterPresenceRestore,
      startPreviewWindowExitMotion,
    ],
  );

  const findVisibleSnappedPanelAtPosition = useCallback(
    (
      position: PanelPosition,
      options: { exclude?: PanelId[] } = {},
    ): PanelId | null => {
      const excludedPanels = new Set(options.exclude ?? []);
      return (
        (Object.keys(panelConfigsRef.current) as PanelId[]).find((id) => {
          if (excludedPanels.has(id) || !panelsRef.current[id]) {
            return false;
          }

          const config = panelConfigsRef.current[id];
          return config.mode === "snapped" && config.position === position;
        }) ?? null
      );
    },
    [],
  );

  const findSnappedPreviewWindowAtPosition = useCallback(
    (
      position: PanelPosition,
      options: { excludeWindowIds?: string[] } = {},
    ): PreviewWindow | null => {
      const excludedWindowIds = new Set(options.excludeWindowIds ?? []);
      return (
        usePreviewWindowStore
          .getState()
          .windows.find(
            (windowState) =>
              !excludedWindowIds.has(windowState.id) &&
              windowState.mode === "snapped" &&
              windowState.position === position,
          ) ?? null
      );
    },
    [],
  );

  const isSnappedPositionOccupied = useCallback(
    (
      position: PanelPosition,
      options: {
        exclude?: PanelId[];
        excludeWindowIds?: string[];
      } = {},
    ): boolean =>
      Boolean(findVisibleSnappedPanelAtPosition(position, options)) ||
      Boolean(findSnappedPreviewWindowAtPosition(position, options)),
    [findSnappedPreviewWindowAtPosition, findVisibleSnappedPanelAtPosition],
  );

  const findAvailablePanelPosition = useCallback(
    (
      options: {
        preferred?: PanelPosition;
        exclude?: PanelId[];
        excludePositions?: PanelPosition[];
        excludeWindowIds?: string[];
      } = {},
    ): PanelPosition | null => {
      const excludedPositions = new Set(options.excludePositions ?? []);
      const orderedPositions = [
        options.preferred,
        ...PANEL_SHORTCUT_MOVE_POSITIONS,
      ].filter(
        (position, index, all): position is PanelPosition =>
          isPanelPosition(position) && all.indexOf(position) === index,
      );

      for (const position of orderedPositions) {
        if (excludedPositions.has(position)) {
          continue;
        }
        if (!isSnappedPositionOccupied(position, options)) {
          return position;
        }
      }

      return null;
    },
    [isSnappedPositionOccupied],
  );

  const getFloatingDisplacementFrame = useCallback(
    (
      position: PanelPosition,
      size: PanelSize,
    ): { x: number; y: number; width: number; height: number } => {
      const width =
        position === "left" || position === "right"
          ? Math.max(size.width || 380, 380)
          : Math.max(size.width || 560, 560);
      const height =
        position === "top" || position === "bottom"
          ? Math.max(size.height || 300, 300)
          : Math.max(size.height || 420, 420);
      const safeWidth = Math.min(
        width,
        Math.max(320, logicalViewport.width - 64),
      );
      const safeHeight = Math.min(
        height,
        Math.max(220, logicalViewport.height - 96),
      );
      const x =
        position === "right"
          ? Math.max(16, logicalViewport.width - safeWidth - 32)
          : position === "left"
            ? 32
            : Math.max(16, Math.round((logicalViewport.width - safeWidth) / 2));
      const y =
        position === "bottom"
          ? Math.max(64, logicalViewport.height - safeHeight - 48)
          : position === "top"
            ? 72
            : Math.max(
                64,
                Math.round((logicalViewport.height - safeHeight) / 2),
              );

      return { x, y, width: safeWidth, height: safeHeight };
    },
    [logicalViewport.height, logicalViewport.width],
  );

  const snapPreviewWindowToPosition = useCallback(
    (windowState: PreviewWindow, position: PanelPosition): boolean => {
      const normalizedSize = normalizePreviewWindowSizeForPosition(
        position,
        windowState,
      );
      return updatePreviewWindow(windowState.id, {
        mode: "snapped",
        position,
        width: normalizedSize.width,
        height: normalizedSize.height,
      });
    },
    [updatePreviewWindow],
  );

  const movePreviewWindowToPosition = useCallback(
    (windowId: string, targetPosition: PanelPosition): boolean => {
      if (useTerminalStore.getState().tuiModeActive) {
        return false;
      }

      const previewWindow = usePreviewWindowStore
        .getState()
        .windows.find((windowState) => windowState.id === windowId);
      if (!previewWindow) {
        return false;
      }

      const sourcePosition = previewWindow.position;
      const targetPanel = findVisibleSnappedPanelAtPosition(targetPosition);
      const targetPreviewWindow = targetPanel
        ? null
        : findSnappedPreviewWindowAtPosition(targetPosition, {
            excludeWindowIds: [windowId],
          });
      const relocatingPanels: PanelId[] = [];
      const relocatingPreviewWindows = [windowId];
      const settlingPositions: Array<PanelPosition | null | undefined> = [
        targetPosition,
        previewWindow.mode === "snapped" ? sourcePosition : null,
      ];

      if (
        previewWindow.mode === "snapped" &&
        sourcePosition === targetPosition &&
        !targetPanel &&
        !targetPreviewWindow
      ) {
        return true;
      }

      if (targetPanel) {
        relocatingPanels.push(targetPanel);
        const fallbackPosition =
          sourcePosition !== targetPosition &&
          !isSnappedPositionOccupied(sourcePosition, {
            exclude: [targetPanel],
            excludeWindowIds: [windowId],
          })
            ? sourcePosition
            : findAvailablePanelPosition({
                preferred: rememberedSnappedPositionsRef.current[targetPanel],
                exclude: [targetPanel],
                excludeWindowIds: [windowId],
                excludePositions: [targetPosition],
              });

        const targetConfig = panelConfigsRef.current[targetPanel];
        const nextPanelConfigs = clonePanelConfigs(panelConfigsRef.current);
        const nextRememberedSnappedPositions = cloneRememberedSnappedPositions(
          rememberedSnappedPositionsRef.current,
        );
        if (fallbackPosition) {
          settlingPositions.push(fallbackPosition);
          nextPanelConfigs[targetPanel] = {
            ...nextPanelConfigs[targetPanel],
            mode: "snapped",
            position: fallbackPosition,
            x: 0,
            y: 0,
            size: normalizePanelSizeForPosition(
              fallbackPosition,
              targetConfig.size,
            ),
          };
          nextRememberedSnappedPositions[targetPanel] = fallbackPosition;
        } else {
          const fallbackFrame = getFloatingDisplacementFrame(
            targetPosition,
            targetConfig.size,
          );
          nextPanelConfigs[targetPanel] = {
            ...nextPanelConfigs[targetPanel],
            mode: "floating",
            x: fallbackFrame.x,
            y: fallbackFrame.y,
            size: {
              width: fallbackFrame.width,
              height: fallbackFrame.height,
            },
          };
        }

        applyPanelConfigsState(nextPanelConfigs);
        applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
      } else if (targetPreviewWindow) {
        relocatingPreviewWindows.push(targetPreviewWindow.id);
        const fallbackPosition =
          sourcePosition !== targetPosition &&
          !isSnappedPositionOccupied(sourcePosition, {
            excludeWindowIds: [windowId, targetPreviewWindow.id],
          })
            ? sourcePosition
            : findAvailablePanelPosition({
                preferred: targetPreviewWindow.position,
                excludeWindowIds: [windowId, targetPreviewWindow.id],
                excludePositions: [targetPosition],
              });

        if (fallbackPosition) {
          settlingPositions.push(fallbackPosition);

          if (
            !snapPreviewWindowToPosition(targetPreviewWindow, fallbackPosition)
          ) {
            return false;
          }
        } else {
          const fallbackFrame = getFloatingDisplacementFrame(targetPosition, {
            width: targetPreviewWindow.width,
            height: targetPreviewWindow.height,
          });
          if (
            !updatePreviewWindow(targetPreviewWindow.id, {
              mode: "floating",
              x: fallbackFrame.x,
              y: fallbackFrame.y,
              width: fallbackFrame.width,
              height: fallbackFrame.height,
            })
          ) {
            return false;
          }
        }
      }

      startPanelDropSettling({
        panels: relocatingPanels,
        previewWindows: relocatingPreviewWindows,
        positions: uniquePanelPositions(settlingPositions),
      });
      return snapPreviewWindowToPosition(previewWindow, targetPosition);
    },
    [
      applyPanelConfigsState,
      applyRememberedSnappedPositionsState,
      findAvailablePanelPosition,
      findSnappedPreviewWindowAtPosition,
      findVisibleSnappedPanelAtPosition,
      getFloatingDisplacementFrame,
      isSnappedPositionOccupied,
      snapPreviewWindowToPosition,
      startPanelDropSettling,
      updatePreviewWindow,
    ],
  );

  const movePanelToPositionWithReflow = useCallback(
    (
      panelId: PanelId,
      targetPosition: PanelPosition,
      size?: Partial<PanelSize>,
    ): boolean => {
      if (useTerminalStore.getState().tuiModeActive) {
        return false;
      }

      const currentPanels = panelsRef.current;
      const currentConfigs = panelConfigsRef.current;
      const currentConfig = currentConfigs[panelId];
      const sourcePosition =
        currentPanels[panelId] && currentConfig.mode === "snapped"
          ? currentConfig.position
          : null;

      if (
        currentPanels[panelId] &&
        currentConfig.mode === "snapped" &&
        currentConfig.position === targetPosition
      ) {
        const normalizedSize = normalizePanelSizeForPosition(targetPosition, {
          width: size?.width ?? currentConfig.size.width,
          height: size?.height ?? currentConfig.size.height,
        });
        const nextSize = {
          width: size?.width ?? normalizedSize.width,
          height: size?.height ?? normalizedSize.height,
        };
        if (
          nextSize.width !== currentConfig.size.width ||
          nextSize.height !== currentConfig.size.height
        ) {
          applyPanelConfigsState({
            ...panelConfigsRef.current,
            [panelId]: {
              ...panelConfigsRef.current[panelId],
              size: nextSize,
            },
          });
        }
        return true;
      }

      const targetPanel = findVisibleSnappedPanelAtPosition(targetPosition, {
        exclude: [panelId],
      });
      const targetPreviewWindow = targetPanel
        ? null
        : findSnappedPreviewWindowAtPosition(targetPosition);
      const relocatingPanels: PanelId[] = [panelId];
      const relocatingPreviewWindows: string[] = [];
      const settlingPositions: Array<PanelPosition | null | undefined> = [
        targetPosition,
        sourcePosition,
      ];
      const nextPanels = { ...currentPanels, [panelId]: true };
      const nextPanelConfigs = clonePanelConfigs(panelConfigsRef.current);
      const nextRememberedSnappedPositions = cloneRememberedSnappedPositions(
        rememberedSnappedPositionsRef.current,
      );

      if (targetPanel) {
        relocatingPanels.push(targetPanel);
        const fallbackPosition =
          sourcePosition &&
          sourcePosition !== targetPosition &&
          !isSnappedPositionOccupied(sourcePosition, {
            exclude: [panelId, targetPanel],
          })
            ? sourcePosition
            : findAvailablePanelPosition({
                preferred: rememberedSnappedPositionsRef.current[targetPanel],
                exclude: [panelId, targetPanel],
                excludePositions: [targetPosition],
              });

        const targetConfig = panelConfigsRef.current[targetPanel];
        if (fallbackPosition) {
          settlingPositions.push(fallbackPosition);
          nextPanelConfigs[targetPanel] = {
            ...nextPanelConfigs[targetPanel],
            mode: "snapped",
            position: fallbackPosition,
            x: 0,
            y: 0,
            size: normalizePanelSizeForPosition(
              fallbackPosition,
              targetConfig.size,
            ),
          };
          nextRememberedSnappedPositions[targetPanel] = fallbackPosition;
        } else {
          const fallbackFrame = getFloatingDisplacementFrame(
            targetPosition,
            targetConfig.size,
          );
          nextPanelConfigs[targetPanel] = {
            ...nextPanelConfigs[targetPanel],
            mode: "floating",
            x: fallbackFrame.x,
            y: fallbackFrame.y,
            size: {
              width: fallbackFrame.width,
              height: fallbackFrame.height,
            },
          };
        }
        nextPanels[targetPanel] = true;
      } else if (targetPreviewWindow) {
        relocatingPreviewWindows.push(targetPreviewWindow.id);
        const fallbackPosition =
          sourcePosition &&
          sourcePosition !== targetPosition &&
          !isSnappedPositionOccupied(sourcePosition, {
            exclude: [panelId],
            excludeWindowIds: [targetPreviewWindow.id],
          })
            ? sourcePosition
            : findAvailablePanelPosition({
                preferred: targetPreviewWindow.position,
                exclude: [panelId],
                excludeWindowIds: [targetPreviewWindow.id],
                excludePositions: [targetPosition],
              });

        if (fallbackPosition) {
          settlingPositions.push(fallbackPosition);
          if (
            !snapPreviewWindowToPosition(targetPreviewWindow, fallbackPosition)
          ) {
            return false;
          }
        } else {
          const fallbackFrame = getFloatingDisplacementFrame(targetPosition, {
            width: targetPreviewWindow.width,
            height: targetPreviewWindow.height,
          });
          if (
            !updatePreviewWindow(targetPreviewWindow.id, {
              mode: "floating",
              x: fallbackFrame.x,
              y: fallbackFrame.y,
              width: fallbackFrame.width,
              height: fallbackFrame.height,
            })
          ) {
            return false;
          }
        }
      }

      const normalizedSize = normalizePanelSizeForPosition(targetPosition, {
        width: size?.width ?? currentConfig.size.width,
        height: size?.height ?? currentConfig.size.height,
      });
      nextPanelConfigs[panelId] = {
        ...nextPanelConfigs[panelId],
        mode: "snapped",
        position: targetPosition,
        x: 0,
        y: 0,
        size: {
          width: size?.width ?? normalizedSize.width,
          height: size?.height ?? normalizedSize.height,
        },
      };
      nextRememberedSnappedPositions[panelId] = targetPosition;

      if (currentPanels[panelId] && currentConfig.mode === "floating") {
        setFloatingPresenceVersion((version) => version + 1);
      }

      startPanelDropSettling({
        panels: relocatingPanels,
        previewWindows: relocatingPreviewWindows,
        positions: uniquePanelPositions(settlingPositions),
      });
      applyPanelsState(nextPanels);
      applyPanelConfigsState(nextPanelConfigs);
      applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
      markActivePanel(panelId);
      return true;
    },
    [
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      findAvailablePanelPosition,
      findSnappedPreviewWindowAtPosition,
      findVisibleSnappedPanelAtPosition,
      getFloatingDisplacementFrame,
      isSnappedPositionOccupied,
      markActivePanel,
      snapPreviewWindowToPosition,
      startPanelDropSettling,
      updatePreviewWindow,
    ],
  );

  const resolvePromotionSnapPosition = useCallback(
    (
      preferred: SurfacePromotionPosition | undefined,
      options: {
        excludePanelId?: PanelId;
        excludePreviewWindowId?: string;
      } = {},
    ): PanelPosition | null => {
      const preferredPosition = isPanelPosition(preferred)
        ? preferred
        : undefined;
      const excludedPanels = options.excludePanelId
        ? [options.excludePanelId]
        : undefined;
      const excludedPreviewWindows = options.excludePreviewWindowId
        ? [options.excludePreviewWindowId]
        : undefined;

      if (
        preferredPosition &&
        !isSnappedPositionOccupied(preferredPosition, {
          exclude: excludedPanels,
          excludeWindowIds: excludedPreviewWindows,
        })
      ) {
        return preferredPosition;
      }

      return findAvailablePanelPosition({
        preferred: preferredPosition,
        exclude: excludedPanels,
        excludeWindowIds: excludedPreviewWindows,
      });
    },
    [findAvailablePanelPosition, isSnappedPositionOccupied],
  );

  const applyPanelPromotion = useCallback(
    async (
      request: SurfacePromotionRequest,
    ): Promise<SurfacePromotionResult> => {
      const panelId = request.panelId ? resolvePanelId(request.panelId) : null;
      if (!panelId || !panelsRef.current[panelId]) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "Panel surface is not open.",
        });
      }

      const currentConfig = panelConfigsRef.current[panelId];
      if (request.kind === "detach") {
        const detachCommand = getSurfaceRuntimeReadModel({
          includeEvents: false,
        }).promotion.commandsBySurfaceId[request.surfaceId]?.find(
          (command) => command.kind === "detach",
        );
        if (!detachCommand?.enabled) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason:
              detachCommand?.reason ??
              "Detached Wails window creation is disabled in this build.",
          });
        }
        const role = panelToWindowLeaseRole(panelId);
        if (!role) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason: "Panel surface is not supported by Window Lease System.",
          });
        }
        const actionId = buildWindowLeaseActionId("detach", {
          surfaceId: request.surfaceId,
          role,
          appletKind: panelId,
          title:
            panelId === "git"
              ? "Git"
              : panelId === "problems"
                ? "Problems"
                : "Terminal",
          returnTarget: {
            hostMode: currentConfig.mode,
            position: currentConfig.position,
          },
          payload: {
            projectPath: activeProjectPath,
            activeFilePath: activeStatusFilePath ?? activeEditorTab?.path ?? "",
          },
        });
        const leaseResult = await runWindowLeaseAction(actionId);
        if (!leaseResult.handled) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason:
              leaseResult.message ??
              "Detached Wails window creation was not handled.",
          });
        }

        applyPanelsState({ ...panelsRef.current, [panelId]: false });
        if (activePanelIdRef.current === panelId) {
          markActivePanel(null);
        }
        return buildSurfacePromotionResult(request, {
          handled: true,
          hostMode: "detached",
          message: leaseResult.message ?? "Detached Wails window created.",
        });
      }

      const applyConfig = (
        nextConfig: PanelConfig,
        hostMode: "floating" | "snapped" | "fullscreen",
        position?: PanelPosition,
      ) => {
        const nextConfigs = {
          ...panelConfigsRef.current,
          [panelId]: nextConfig,
        };
        applyPanelConfigsState(nextConfigs);
        applyPanelsState({ ...panelsRef.current, [panelId]: true });
        if (nextConfig.mode === "snapped") {
          applyRememberedSnappedPositionsState({
            ...rememberedSnappedPositionsRef.current,
            [panelId]: nextConfig.position,
          });
        }
        markActivePanel(panelId);
        return buildSurfacePromotionResult(request, {
          handled: true,
          hostMode,
          position,
        });
      };

      if (request.kind === "promote-floating") {
        const size = getPanelPromotionFloatingSize(panelId, currentConfig);
        const nextConfig = buildPanelConfigForOpen(
          panelId,
          {
            panel: panelId,
            mode: "floating",
            width: size.width,
            height: size.height,
            x: currentConfig.mode === "floating" ? currentConfig.x : 96,
            y: currentConfig.mode === "floating" ? currentConfig.y : 96,
          },
          currentConfig,
        );
        return applyConfig(nextConfig, "floating");
      }

      if (request.kind === "snap") {
        const position = resolvePromotionSnapPosition(
          request.position ?? currentConfig.position,
          { excludePanelId: panelId },
        );
        if (!position) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason: "No free snapped slot is available.",
          });
        }

        const nextConfig = buildPanelConfigForOpen(
          panelId,
          {
            panel: panelId,
            mode: "snapped",
            position,
          },
          currentConfig,
        );
        return applyConfig(nextConfig, "snapped", position);
      }

      if (request.kind === "fullscreen") {
        const nextConfig: PanelConfig = {
          ...currentConfig,
          mode: "floating",
          x: 0,
          y: 0,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        };
        if (panelId === "code") {
          let result: SurfacePromotionResult | null = null;
          startFullscreenPanelTransition("code", () => {
            result = applyConfig(nextConfig, "fullscreen");
          });
          return (
            result ??
            buildSurfacePromotionResult(request, {
              handled: false,
              reason: "Code panel fullscreen transition was not applied.",
            })
          );
        }
        return applyConfig(nextConfig, "fullscreen");
      }

      const returnTarget = getSurfaceRuntimeReadModel({ includeEvents: false })
        .promotion.returnTargets[request.surfaceId];
      if (!returnTarget) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "No return target is recorded for this surface.",
        });
      }

      const preferredPosition = isPanelPosition(
        returnTarget.session.geometry?.position,
      )
        ? returnTarget.session.geometry?.position
        : request.position;
      const returnPosition =
        returnTarget.session.hostMode === "snapped"
          ? resolvePromotionSnapPosition(preferredPosition, {
              excludePanelId: panelId,
            })
          : undefined;
      if (returnTarget.session.hostMode === "snapped" && !returnPosition) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "No free snapped slot is available for return target.",
        });
      }
      const nextConfig = surfaceSessionToPanelConfig(
        returnTarget.session,
        currentConfig,
        returnPosition ?? undefined,
      );
      if (!nextConfig) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "Return target cannot be applied to this panel.",
        });
      }

      return applyConfig(
        nextConfig,
        returnTarget.hostMode === "fullscreen"
          ? "fullscreen"
          : returnTarget.hostMode === "snapped"
            ? "snapped"
            : "floating",
        nextConfig.mode === "snapped" ? nextConfig.position : undefined,
      );
    },
    [
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      activeEditorTab,
      activeProjectPath,
      activeStatusFilePath,
      markActivePanel,
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
      panelConfigsRef,
      panelsRef,
      rememberedSnappedPositionsRef,
      resolvePromotionSnapPosition,
      startFullscreenPanelTransition,
    ],
  );

  const applyPreviewPromotion = useCallback(
    async (
      request: SurfacePromotionRequest,
    ): Promise<SurfacePromotionResult> => {
      const windowId = request.previewWindowId;
      const windowState = windowId
        ? usePreviewWindowStore
            .getState()
            .windows.find((currentWindow) => currentWindow.id === windowId)
        : undefined;
      if (!windowId || !windowState) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "Preview surface is not open.",
        });
      }

      if (request.kind === "detach") {
        const detachCommand = getSurfaceRuntimeReadModel({
          includeEvents: false,
        }).promotion.commandsBySurfaceId[request.surfaceId]?.find(
          (command) => command.kind === "detach",
        );
        if (!detachCommand?.enabled) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason:
              detachCommand?.reason ??
              "Detached Wails window creation is disabled in this build.",
          });
        }
        if (windowState.surface !== "browser") {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason:
              "Native detached window spike currently supports Browser Preview only.",
          });
        }

        const actionId = buildWindowLeaseActionId("detach", {
          surfaceId: request.surfaceId,
          previewWindowId: windowId,
          role: "preview",
          appletKind: windowState.surface,
          title: windowState.title,
          url:
            typeof windowState.payload.url === "string"
              ? windowState.payload.url
              : undefined,
          pinned: windowState.isPinned,
          returnTarget: {
            hostMode: windowState.mode,
            position: windowState.position,
          },
          payload: {
            ...windowState.payload,
          },
        });
        const leaseResult = await runWindowLeaseAction(actionId);
        if (!leaseResult.handled) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason:
              leaseResult.message ??
              "Detached Wails window creation was not handled.",
          });
        }

        closePreviewWindowWithMotion(windowId);
        return buildSurfacePromotionResult(request, {
          handled: true,
          hostMode: "detached",
          message: leaseResult.message ?? "Detached Wails window created.",
        });
      }

      const applyUpdate = (
        input: UpdatePreviewWindowInput,
        hostMode: "floating" | "snapped" | "fullscreen",
        position?: PanelPosition,
      ) => {
        const updated = updatePreviewWindow(windowId, input);
        if (updated) {
          focusPreviewWindow(windowId);
        }
        return buildSurfacePromotionResult(request, {
          handled: updated,
          hostMode,
          position,
          reason: updated ? undefined : "Preview surface update failed.",
        });
      };

      if (request.kind === "promote-floating") {
        const size = getPreviewPromotionFloatingSize(windowState);
        return applyUpdate(
          {
            mode: "floating",
            width: size.width,
            height: size.height,
            x: windowState.mode === "floating" ? windowState.x : 96,
            y: windowState.mode === "floating" ? windowState.y : 96,
          },
          "floating",
        );
      }

      if (request.kind === "snap") {
        const position = resolvePromotionSnapPosition(
          request.position ?? windowState.position,
          { excludePreviewWindowId: windowId },
        );
        if (!position) {
          return buildSurfacePromotionResult(request, {
            handled: false,
            reason: "No free snapped slot is available.",
          });
        }
        const size = normalizePreviewWindowSizeForPosition(
          position,
          windowState,
        );
        return applyUpdate(
          {
            mode: "snapped",
            position,
            width: size.width,
            height: size.height,
          },
          "snapped",
          position,
        );
      }

      if (request.kind === "fullscreen") {
        return applyUpdate(
          {
            mode: "floating",
            x: 0,
            y: 0,
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
          "fullscreen",
        );
      }

      const returnTarget = getSurfaceRuntimeReadModel({ includeEvents: false })
        .promotion.returnTargets[request.surfaceId];
      if (!returnTarget) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "No return target is recorded for this surface.",
        });
      }

      const preferredPosition = isPanelPosition(
        returnTarget.session.geometry?.position,
      )
        ? returnTarget.session.geometry?.position
        : request.position;
      const returnPosition =
        returnTarget.session.hostMode === "snapped"
          ? resolvePromotionSnapPosition(preferredPosition, {
              excludePreviewWindowId: windowId,
            })
          : undefined;
      if (returnTarget.session.hostMode === "snapped" && !returnPosition) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "No free snapped slot is available for return target.",
        });
      }
      const input = surfaceSessionToPreviewUpdate(
        returnTarget.session,
        windowState,
        returnPosition ?? undefined,
      );
      if (!input) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "Return target cannot be applied to this preview.",
        });
      }

      return applyUpdate(
        input,
        returnTarget.hostMode === "fullscreen"
          ? "fullscreen"
          : returnTarget.hostMode === "snapped"
            ? "snapped"
            : "floating",
        input.mode === "snapped" ? input.position : undefined,
      );
    },
    [
      focusPreviewWindow,
      closePreviewWindowWithMotion,
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
      resolvePromotionSnapPosition,
      updatePreviewWindow,
    ],
  );

  const handleSurfacePromoteEvent = useCallback(
    (
      payload: unknown,
    ): SurfacePromotionResult | Promise<SurfacePromotionResult> => {
      const request = parseSurfacePromotionRequest(payload);
      if (!request) {
        return buildSurfacePromotionResult(null, {
          handled: false,
          reason: "Invalid surface promotion request.",
        });
      }

      return request.source === "panel"
        ? applyPanelPromotion(request)
        : applyPreviewPromotion(request);
    },
    [applyPanelPromotion, applyPreviewPromotion],
  );

  const resolveBrowserPreviewOpenInput = (
    input: OpenPreviewWindowInput,
  ): OpenPreviewWindowInput => {
    if (input.surface !== "browser") {
      return input;
    }

    const existingWindow = input.id
      ? usePreviewWindowStore
          .getState()
          .windows.find((windowState) => windowState.id === input.id)
      : null;
    if (existingWindow && input.position === undefined) {
      return input;
    }

    const requestedPosition: PanelPosition =
      input.position ?? (input.side === "left" ? "left" : "right");
    const requestedSnapped =
      input.mode === "snapped" ||
      input.position !== undefined ||
      input.side !== undefined;

    if (!requestedSnapped) {
      return input;
    }

    const resolvedPosition = !isSnappedPositionOccupied(requestedPosition)
      ? requestedPosition
      : findAvailablePanelPosition({ preferred: requestedPosition });

    if (!resolvedPosition) {
      return {
        ...input,
        mode: "floating",
        position: requestedPosition,
        side: undefined,
      };
    }

    return {
      ...input,
      mode: "snapped",
      position: resolvedPosition,
      side: undefined,
    };
  };

  const {
    beginHeldPanelShortcut,
    clearHeldPanelShortcut,
    finishHeldPanelShortcutOnKeyUp,
    getBrowserPreviewWindowForShortcut,
    getShortcutEventCode,
    handleHeldPanelShortcutMove,
    markShortcutActionHandled,
    moveBrowserPreviewToPosition,
    movePanelToPosition,
    moveSnappedPanelBetweenSides,
    shouldSuppressApplicationMenuAction,
  } = useMainLayoutShortcutBridge({
    applyPanelConfigsState,
    applyPanelsState,
    applyRememberedSnappedPositionsState,
    applicationMenuRepeatRef,
    delayedShortcutActionSuppressionRef,
    findAvailablePanelPosition,
    findSnappedPreviewWindowAtPosition,
    findVisibleSnappedPanelAtPosition,
    heldPanelShortcutRef,
    isSnappedPositionOccupied,
    movePreviewWindowToPosition,
    openCanonicalBrowserPreviewRef,
    panelConfigsRef,
    panelsRef,
    pressedShortcutCodesRef,
    rememberedSnappedPositionsRef,
    setFloatingPresenceVersion,
    shortcutActionSuppressionRef,
    showNotification,
    snapPreviewWindowToPosition,
    startPanelDropSettling,
  });

  const refreshCodePanelPathFromDisk = useCallback(async (path: string) => {
    const normalizedPath = normalizeProjectPath(path);
    const pathIdentity = normalizeProjectPathIdentity(normalizedPath);
    if (!normalizedPath) {
      return false;
    }
    const currentTab = codePanelTabsRef.current.find(
      (tab) => normalizeProjectPathIdentity(tab.path) === pathIdentity,
    );
    if (!currentTab) {
      return false;
    }
    const refreshRequestId =
      (codePanelRefreshRequestRef.current[pathIdentity] ?? 0) + 1;
    codePanelRefreshRequestRef.current[pathIdentity] = refreshRequestId;

    const editorTabId = makeEditorTabId(currentTab.path);
    const editorStore = useEditorStore.getState();
    if (editorStore.tabs.get(editorTabId)?.isDirty) {
      return false;
    }

    const fileLoadState = await loadEditorFile(currentTab.path);
    let language = currentTab.language || "text";
    try {
      const languageInfo = await GetLanguageForFile(currentTab.path);
      if (languageInfo?.id) {
        language = languageInfo.id;
      }
    } catch {
      /* keep current language */
    }

    if (codePanelRefreshRequestRef.current[pathIdentity] !== refreshRequestId) {
      return false;
    }
    const latestTab = codePanelTabsRef.current.find(
      (tab) => normalizeProjectPathIdentity(tab.path) === pathIdentity,
    );
    if (!latestTab) {
      return false;
    }
    const latestEditorTabId = makeEditorTabId(latestTab.path);
    const latestEditorStore = useEditorStore.getState();
    if (latestEditorStore.tabs.get(latestEditorTabId)?.isDirty) {
      return false;
    }

    const content =
      fileLoadState.kind === "editable" ? fileLoadState.content : "";
    useEditorStore
      .getState()
      .replaceTabContent(latestEditorTabId, content, language);
    if (
      fileLoadState.kind === "editable" &&
      !isEditorFilePolicyReadOnly(fileLoadState)
    ) {
      replaceEditorDocumentFromDisk(latestTab.path, language, content);
    }
    setCodePanelTabs((currentTabs) =>
      currentTabs.map((tab) =>
        normalizeProjectPathIdentity(tab.path) === pathIdentity
          ? {
              ...tab,
              name: fileLoadState.name || getEditorFileName(tab.path),
              content,
              language,
              loadState: fileLoadState,
            }
          : tab,
      ),
    );
    return true;
  }, []);

  const handleFileOpenInPanel = useCallback(
    async (
      path: string,
      name: string,
      line?: number,
      request?: Partial<PanelOpenRequest>,
    ) => {
      const requestId = codePanelOpenRequestRef.current + 1;
      codePanelOpenRequestRef.current = requestId;
      const fallbackLanguage = (() => {
        const normalizedPath = path.trim();
        const fileName = normalizedPath.split("/").pop()?.toLowerCase() ?? "";
        if (fileName === "dockerfile") {
          return "dockerfile";
        }
        if (!normalizedPath.includes(".")) {
          return "text";
        }
        return normalizedPath.split(".").pop()?.toLowerCase() || "text";
      })();

      if (!ensureProjectEntryAccess(path, "read")) {
        return {
          handled: false,
          reason: "File access was denied for the code panel.",
        };
      }

      let language = request?.language ?? fallbackLanguage;
      const openIntentPolicy = request?.openIntentPolicy;
      const fileLoadState =
        typeof request?.content === "string"
          ? createEditableEditorFileLoad(
              path,
              request.content,
              undefined,
              openIntentPolicy,
            )
          : await loadEditorFile(path, { policy: openIntentPolicy });
      if (codePanelOpenRequestRef.current !== requestId) {
        return {
          handled: false,
          reason: "Code panel open request was superseded.",
        };
      }
      const content =
        fileLoadState.kind === "editable" ? fileLoadState.content : "";

      if (!request?.language) {
        try {
          const languageInfo = await GetLanguageForFile(path);
          if (codePanelOpenRequestRef.current !== requestId) {
            return {
              handled: false,
              reason: "Code panel open request was superseded.",
            };
          }
          if (languageInfo?.id) {
            language = languageInfo.id;
          }
        } catch {
          if (codePanelOpenRequestRef.current !== requestId) {
            return {
              handled: false,
              reason: "Code panel open request was superseded.",
            };
          }
          language = fallbackLanguage;
        }
      }

      const nextTab: CodePanelTab = {
        path,
        name: fileLoadState.name || name,
        content,
        language,
        line,
        loadState: fileLoadState,
      };
      const alreadyOpenInCodePanel = codePanelTabsRef.current.some(
        (tab) => tab.path === path,
      );
      setCodePanelTabs((currentTabs) => {
        const existingIndex = currentTabs.findIndex((tab) => tab.path === path);
        if (existingIndex === -1) {
          return [...currentTabs, nextTab];
        }

        const updatedTabs = [...currentTabs];
        updatedTabs[existingIndex] = nextTab;
        return updatedTabs;
      });
      setActiveCodePanelPath(path);
      setEditorStatusFile(path, nextTab.name, language);

      if (
        fileLoadState.kind === "editable" &&
        !isEditorFilePolicyReadOnly(fileLoadState)
      ) {
        if (alreadyOpenInCodePanel) {
          ensureEditorTab(path, name, content, language);
        } else {
          retainEditorBackingTab(path, name, content, language);
        }
      }

      const wasCodePanelVisible = panelsRef.current.code;
      if (
        request?.reflowOnSnap &&
        request.mode === "snapped" &&
        request.position
      ) {
        if (
          movePanelToPositionWithReflow("code", request.position, {
            width: request.width,
            height: request.height,
          })
        ) {
          return { handled: true, panel: "code", path };
        }
      }

      const { nextPanels, nextConfig, nextRememberedSnappedPositions } =
        computeNextPanelOpenState(
          "code",
          {
            panel: "code",
            mode: request?.mode ?? "snapped",
            position: request?.position,
            width: request?.width ?? 560,
            height: request?.height,
            x: request?.x,
            y: request?.y,
          },
          panelsRef.current,
          panelConfigsRef.current,
          rememberedSnappedPositionsRef.current,
        );
      const nextPanelConfigs = {
        ...panelConfigsRef.current,
        code: nextConfig,
      };

      applyPanelConfigsState(nextPanelConfigs);
      if (nextPanels.code) {
        beginPanelMotionWindow();
      }
      if (
        !wasCodePanelVisible &&
        nextPanels.code &&
        nextConfig.mode === "snapped"
      ) {
        startSnappedSlotEnter(nextConfig.position);
      }
      applyPanelsState(nextPanels);
      applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
      if (nextPanels.code) {
        markActivePanel("code");
      }
      return { handled: Boolean(nextPanels.code), panel: "code", path };
    },
    [
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      beginPanelMotionWindow,
      ensureProjectEntryAccess,
      movePanelToPositionWithReflow,
      markActivePanel,
      ensureEditorTab,
      retainEditorBackingTab,
      setEditorStatusFile,
      showNotification,
      startSnappedSlotEnter,
    ],
  );

  const handleCodePanelExternalFileChange = useCallback(
    (payload: unknown) => {
      const changedPath =
        typeof payload === "string"
          ? payload
          : payload &&
              typeof payload === "object" &&
              "path" in payload &&
              typeof (payload as { path?: unknown }).path === "string"
            ? (payload as { path: string }).path
            : "";
      const normalizedChangedPath = normalizeProjectPath(changedPath);
      const changedPathIdentity = normalizeProjectPathIdentity(
        normalizedChangedPath,
      );
      if (
        !normalizedChangedPath ||
        !codePanelTabsRef.current.some(
          (tab) =>
            normalizeProjectPathIdentity(tab.path) === changedPathIdentity,
        )
      ) {
        return;
      }

      void refreshCodePanelPathFromDisk(normalizedChangedPath);
    },
    [refreshCodePanelPathFromDisk],
  );

  useEffect(() => {
    const unsubscribe = EventsOn(
      "file:changed",
      handleCodePanelExternalFileChange,
    );
    return unsubscribe;
  }, [handleCodePanelExternalFileChange]);

  useEffect(() => {
    const handlePatchMutation = (event: unknown) => {
      if (!eventMatchesCurrentProjectSession(event)) {
        return;
      }
      const files =
        event &&
        typeof event === "object" &&
        "files" in event &&
        Array.isArray((event as { files?: unknown }).files)
          ? (
              event as {
                files: Array<{ path?: unknown; absolutePath?: unknown }>;
              }
            ).files
          : [];
      if (files.length === 0) {
        return;
      }

      const affectedTabs = codePanelTabsRef.current.filter((tab) =>
        files.some((file) => {
          const path =
            typeof file.absolutePath === "string"
              ? file.absolutePath
              : typeof file.path === "string"
                ? file.path
                : "";
          return (
            path && aiInlinePatchPathMatches(tab.path, path, activeProjectPath)
          );
        }),
      );
      affectedTabs.forEach((tab) => {
        const editorTab = useEditorStore
          .getState()
          .tabs.get(makeEditorTabId(tab.path));
        if (editorTab?.isDirty) {
          useAppNotificationStore.getState().addNotification({
            id: `code-panel-ai-patch-disk-change:${tab.path}`,
            kind: "warning",
            title: "File changed on disk",
            message: `${tab.name} has unsaved editor changes.`,
            source: "AI",
            sticky: false,
            timeoutMs: 6000,
          });
          return;
        }
        void refreshCodePanelPathFromDisk(tab.path);
      });
    };

    const unsubscribeApplied = EventsOn(
      "ai:patch:artifact-applied",
      handlePatchMutation,
    );
    const unsubscribeRolledBack = EventsOn(
      "ai:patch:artifact-rolled-back",
      handlePatchMutation,
    );
    return () => {
      unsubscribeApplied();
      unsubscribeRolledBack();
    };
  }, [activeProjectPath, refreshCodePanelPathFromDisk]);

  const getAIInlinePatchDirtyCandidates = useCallback(
    () =>
      Array.from(useEditorStore.getState().tabs.values()).map((tab) => ({
        path: tab.path,
        name: tab.name,
        isDirty: tab.isDirty,
      })),
    [],
  );

  const handleAcceptCodePanelAIInlinePatch = useCallback(
    async (preview: AIInlinePatchPreview) => {
      if (aiInlinePatchBusyIds[preview.id]) {
        return;
      }
      const patchScope = {
        projectPath: activeProjectPath,
        projectSessionId: currentProjectSessionId,
      };
      if (!isAIInlinePatchPreviewInScope(preview, patchScope)) {
        dismissAIInlinePatchPreview(preview.id);
        return;
      }
      if (preview.alreadyApplied) {
        acknowledgeAIInlinePatchPreview(preview.id);
        return;
      }

      const candidates = getAIInlinePatchDirtyCandidates();
      const blockingFile = findBlockingAIInlinePatchCandidate(
        preview,
        candidates,
        patchScope,
      );
      if (blockingFile) {
        useAppNotificationStore.getState().addNotification({
          id: `code-panel-ai-inline-patch-dirty:${preview.id}`,
          kind: "warning",
          title: "Save editor changes first",
          message: `${formatAIInlinePatchCandidateName(blockingFile)} has unsaved changes.`,
          source: "AI",
          sticky: false,
          timeoutMs: 6000,
        });
        return;
      }

      const affectedTabs = getAffectedAIInlinePatchCandidates(
        preview,
        codePanelTabsRef.current,
        patchScope,
      );
      if (!beginAIInlinePatchBusy(preview.id)) {
        return;
      }
      try {
        await AIApplyPatchArtifact({ artifactId: preview.id });
        clearAIInlinePatchPreview(preview.id);
        await Promise.all(
          affectedTabs.map((tab) => refreshCodePanelPathFromDisk(tab.path)),
        );
      } catch (error) {
        useAppNotificationStore.getState().addNotification({
          id: `code-panel-ai-inline-patch-apply:${preview.id}`,
          kind: "error",
          title: "Failed to apply AI patch",
          message: error instanceof Error ? error.message : String(error),
          source: "AI",
          sticky: false,
          timeoutMs: 7000,
        });
      } finally {
        endAIInlinePatchBusy(preview.id);
      }
    },
    [
      activeProjectPath,
      acknowledgeAIInlinePatchPreview,
      aiInlinePatchBusyIds,
      beginAIInlinePatchBusy,
      clearAIInlinePatchPreview,
      currentProjectSessionId,
      dismissAIInlinePatchPreview,
      endAIInlinePatchBusy,
      getAIInlinePatchDirtyCandidates,
      refreshCodePanelPathFromDisk,
    ],
  );

  const handleRejectCodePanelAIInlinePatch = useCallback(
    async (preview: AIInlinePatchPreview) => {
      if (aiInlinePatchBusyIds[preview.id]) {
        return;
      }
      const patchScope = {
        projectPath: activeProjectPath,
        projectSessionId: currentProjectSessionId,
      };
      if (!isAIInlinePatchPreviewInScope(preview, patchScope)) {
        dismissAIInlinePatchPreview(preview.id);
        return;
      }
      if (!preview.alreadyApplied) {
        dismissAIInlinePatchPreview(preview.id);
        return;
      }

      const candidates = getAIInlinePatchDirtyCandidates();
      const blockingFile = findBlockingAIInlinePatchCandidate(
        preview,
        candidates,
        patchScope,
      );
      if (blockingFile) {
        useAppNotificationStore.getState().addNotification({
          id: `code-panel-ai-inline-patch-rollback-dirty:${preview.id}`,
          kind: "warning",
          title: "Save editor changes first",
          message: `${formatAIInlinePatchCandidateName(blockingFile)} has unsaved changes.`,
          source: "AI",
          sticky: false,
          timeoutMs: 6000,
        });
        return;
      }

      const affectedTabs = getAffectedAIInlinePatchCandidates(
        preview,
        codePanelTabsRef.current,
        patchScope,
      );
      if (!beginAIInlinePatchBusy(preview.id)) {
        return;
      }
      try {
        await AIRollbackPatchCheckpoint({
          artifactId: preview.id,
          checkpointId: "",
        });
        clearAIInlinePatchPreview(preview.id);
        await Promise.all(
          affectedTabs.map((tab) => refreshCodePanelPathFromDisk(tab.path)),
        );
      } catch (error) {
        useAppNotificationStore.getState().addNotification({
          id: `code-panel-ai-inline-patch-rollback:${preview.id}`,
          kind: "error",
          title: "Failed to rollback AI edit",
          message: error instanceof Error ? error.message : String(error),
          source: "AI",
          sticky: false,
          timeoutMs: 7000,
        });
      } finally {
        endAIInlinePatchBusy(preview.id);
      }
    },
    [
      activeProjectPath,
      aiInlinePatchBusyIds,
      beginAIInlinePatchBusy,
      clearAIInlinePatchPreview,
      currentProjectSessionId,
      dismissAIInlinePatchPreview,
      endAIInlinePatchBusy,
      getAIInlinePatchDirtyCandidates,
      refreshCodePanelPathFromDisk,
    ],
  );

  const handleFileOpen = useCallback(
    (
      path: string,
      content: string,
      name: string,
      line?: number,
      policy?: EditorFileAccessPolicy,
    ) => {
      const navigationTarget = createEditorNavigationTarget(line, undefined, {
        focus: true,
      });
      if (tuiModeActive) {
        const accessDecision = canAccessPath(path, "read");
        if (!accessDecision.allowed) {
          showNotification("error", `[Security] ${accessDecision.reason}`);
          return;
        }

        void handleFileOpenInPanel(
          path,
          name,
          line,
          content.length > 0
            ? { content, openIntentPolicy: policy }
            : { openIntentPolicy: policy },
        );
        return;
      }

      const requestId = openFileFromPathRequestRef.current + 1;
      openFileFromPathRequestRef.current = requestId;
      scheduleEditorFileOpenLoading(
        requestId,
        path,
        name,
        navigationTarget,
        policy,
      );
      void loadEditorFile(path, {
        knownContent: content.length > 0 ? content : undefined,
        policy,
      })
        .then((file) => {
          if (openFileFromPathRequestRef.current !== requestId) {
            return;
          }
          clearEditorFileOpenLoadingTimer();
          openFileInMainEditor(file, navigationTarget);
        })
        .catch((error) => {
          if (openFileFromPathRequestRef.current !== requestId) {
            return;
          }
          clearEditorFileOpenLoadingTimer();
          console.error("[MainLayout] Failed to open file:", error);
        });
    },
    [
      canAccessPath,
      clearEditorFileOpenLoadingTimer,
      handleFileOpenInPanel,
      openFileInMainEditor,
      scheduleEditorFileOpenLoading,
      showNotification,
      tuiModeActive,
    ],
  );

  const openFileFromPath = useCallback(
    async (
      path: string,
      target?: number | EditorNavigationTarget,
      policy?: EditorFileAccessPolicy,
    ) => {
      const requestId = openFileFromPathRequestRef.current + 1;
      openFileFromPathRequestRef.current = requestId;
      const navigationTarget = coerceEditorNavigationTarget(target, {
        focus: true,
      });

      if (tuiModeActive) {
        const accessDecision = canAccessPath(path, "read");
        if (!accessDecision.allowed) {
          showNotification("error", `[Security] ${accessDecision.reason}`);
          return;
        }
      }

      try {
        if (tuiModeActive) {
          const name = path.split("/").pop() || path;
          await handleFileOpenInPanel(path, name, navigationTarget?.line, {
            openIntentPolicy: policy,
          });
          return;
        }

        scheduleEditorFileOpenLoading(
          requestId,
          path,
          path.split("/").pop() || path,
          navigationTarget,
          policy,
        );
        const file = await loadEditorFile(path, { policy });
        if (openFileFromPathRequestRef.current !== requestId) {
          return;
        }
        clearEditorFileOpenLoadingTimer();
        openFileInMainEditor(file, navigationTarget);
      } catch (error) {
        if (openFileFromPathRequestRef.current === requestId) {
          clearEditorFileOpenLoadingTimer();
          console.error("[MainLayout] Failed to open file:", error);
        }
      }
    },
    [
      canAccessPath,
      clearEditorFileOpenLoadingTimer,
      handleFileOpenInPanel,
      openFileInMainEditor,
      scheduleEditorFileOpenLoading,
      showNotification,
      tuiModeActive,
    ],
  );
  userCreatedFileOpenRef.current = (path: string) => {
    void openFileFromPath(path);
  };
  const openFileLocationFromPath = useCallback(
    (path: string, line?: number, column?: number) => {
      const navigationTarget = createEditorNavigationTarget(line, column, {
        focus: true,
      });
      void openFileFromPath(path, navigationTarget ?? line);
    },
    [openFileFromPath],
  );

  useEffect(() => {
    const normalizedProjectPath = normalizeProjectPath(activeProjectPath);
    if (!normalizedProjectPath) {
      return;
    }

    const unsubscribeRenamed = EventsOn(
      "project:entry:renamed",
      (payload: ProjectEntryRenamedEvent) => {
        const oldPath = normalizeProjectPath(payload?.oldPath ?? "");
        const newPath = normalizeProjectPath(payload?.newPath ?? "");
        if (!oldPath || !newPath) {
          return;
        }

        if (
          !isSameOrChildPath(oldPath, normalizedProjectPath) &&
          !isSameOrChildPath(newPath, normalizedProjectPath)
        ) {
          return;
        }

        remapExplorerPathPrefix(oldPath, newPath);
        renameEditorTabPaths(oldPath, newPath);
        renamePathDiagnostics(oldPath, newPath);

        setCodePanelTabs((currentTabs) =>
          currentTabs.map((tab) => {
            const remappedPath = remapProjectPathPrefix(
              tab.path,
              oldPath,
              newPath,
            );
            if (!remappedPath || remappedPath === tab.path) {
              return tab;
            }

            return {
              ...tab,
              path: remappedPath,
              name: getProjectPathBasename(remappedPath),
            };
          }),
        );
        setActiveCodePanelPath((currentPath) => {
          if (!currentPath) {
            return currentPath;
          }

          return (
            remapProjectPathPrefix(currentPath, oldPath, newPath) ?? currentPath
          );
        });

        remapProjectEntryDialogs(oldPath, newPath);
      },
    );

    const unsubscribeDeleted = EventsOn(
      "project:entry:deleted",
      (payload: ProjectEntryDeletedEvent) => {
        const deletedPath = normalizeProjectPath(payload?.path ?? "");
        if (
          !deletedPath ||
          !isSameOrChildPath(deletedPath, normalizedProjectPath)
        ) {
          return;
        }

        pruneExplorerPathPrefix(deletedPath);
        closeEditorTabPaths(deletedPath, { preserveDirty: true });
        prunePathDiagnostics(deletedPath);

        const editorStore = useEditorStore.getState();
        const isDirtyCodePanelPath = (path: string): boolean => {
          const normalizedPath = normalizeProjectPath(path);
          if (!normalizedPath) {
            return false;
          }
          return (
            editorStore.tabs.get(makeEditorTabId(normalizedPath))?.isDirty ===
            true
          );
        };

        const removedCodePanelTabs = codePanelTabsRef.current.filter(
          (tab) =>
            isSameOrChildPath(tab.path, deletedPath) &&
            !isDirtyCodePanelPath(tab.path),
        );
        removedCodePanelTabs.forEach((tab) =>
          releaseEditorBackingTab(tab.path),
        );
        setCodePanelTabs((currentTabs) =>
          currentTabs.filter(
            (tab) =>
              !isSameOrChildPath(tab.path, deletedPath) ||
              isDirtyCodePanelPath(tab.path),
          ),
        );
        setActiveCodePanelPath((currentPath) =>
          currentPath &&
          isSameOrChildPath(currentPath, deletedPath) &&
          !isDirtyCodePanelPath(currentPath)
            ? null
            : currentPath,
        );
        pruneProjectEntryDialogs(deletedPath);
      },
    );

    return () => {
      unsubscribeRenamed();
      unsubscribeDeleted();
    };
  }, [
    activeProjectPath,
    closeEditorTabPaths,
    pruneExplorerPathPrefix,
    pruneProjectEntryDialogs,
    prunePathDiagnostics,
    releaseEditorBackingTab,
    remapExplorerPathPrefix,
    remapProjectEntryDialogs,
    renameEditorTabPaths,
    renamePathDiagnostics,
  ]);

  const handlePerspectiveOpen = useCallback(() => {
    isPerspectiveOpenRef.current = true;
    if (externalPerspectiveOpen) {
      externalPerspectiveOpen();
    }
  }, [externalPerspectiveOpen]);

  const handlePerspectiveClose = useCallback(() => {
    isPerspectiveOpenRef.current = false;
    if (externalPerspectiveClose) {
      externalPerspectiveClose();
    }
  }, [externalPerspectiveClose]);

  const handlePreviewFocusForSurfaceRuntime = useCallback(() => {
    markActivePanel(null);
  }, [markActivePanel]);

  const {
    handleAppearancePreviewApplyEvent,
    handleAppearancePreviewCancelEvent,
    handleAppearancePreviewPatchEvent,
    handleAppearancePreviewStartEvent,
    handlePreviewWindowCheckpointCreateEvent,
    handlePreviewWindowCheckpointRestoreEvent,
    handlePreviewWindowCloseEvent,
    handlePreviewWindowFocusEvent,
    handlePreviewWindowOpenEvent,
    handlePreviewWindowUpdateEvent,
    openCanonicalBrowserPreview,
  } = useMainLayoutPreviewEvents({
    appearancePreview,
    closePreviewWindowWithMotion,
    currentTheme,
    getBrowserPreviewWindowForShortcut,
    onPreviewFocus: handlePreviewFocusForSurfaceRuntime,
    openCanonicalBrowserPreviewRef,
    previewLaunchInput: previewButtonState.launchInput,
    resolveBrowserPreviewOpenInput,
    setTheme,
    setUiScale,
    showNotification,
    toggleCanonicalBrowserPreviewRef,
    uiScale,
  });

  const handleMarkdownLinkPreviewOpen = useCallback(
    (url: string) => {
      const title = buildMarkdownLinkPreviewTitle(url);
      handlePreviewWindowOpenEvent({
        id: MARKDOWN_LINK_PREVIEW_WINDOW_ID,
        surface: "browser",
        title,
        payload: {
          title,
          url,
          htmlContent: "",
          sourceLabel: "",
          revision: Date.now(),
        },
        mode: "floating",
      });
    },
    [handlePreviewWindowOpenEvent],
  );

  const resolveLiveCodePanelTab = useCallback((tab: CodePanelTab) => {
    const editorTab = useEditorStore
      .getState()
      .tabs.get(makeEditorTabId(tab.path));
    if (!editorTab) {
      return tab;
    }
    return {
      ...tab,
      content: editorTab.content,
      language: editorTab.language,
      name: editorTab.name || tab.name,
    };
  }, []);

  const closeTransferredCodePanelTab = useCallback(
    (path: string) => {
      closeCodePanelTab(path);
      if (codePanelTabs.length <= 1) {
        closePanelWithMotion("code");
      }
    },
    [closeCodePanelTab, closePanelWithMotion, codePanelTabs.length],
  );

  const handleCodePanelTabMoveToEditorTabs = useCallback(
    (tab: CodePanelTab) => {
      const liveTab = resolveLiveCodePanelTab(tab);
      const file =
        liveTab.loadState && liveTab.loadState.kind !== "editable"
          ? liveTab.loadState
          : createEditableEditorFileLoad(liveTab.path, liveTab.content);
      openFileInMainEditor(file, liveTab.line);
      closeTransferredCodePanelTab(liveTab.path);
    },
    [
      closeTransferredCodePanelTab,
      openFileInMainEditor,
      resolveLiveCodePanelTab,
    ],
  );

  const handleCodePanelTabRevealInExplorer = useCallback(
    (tab: CodePanelTab) => {
      const liveTab = resolveLiveCodePanelTab(tab);
      requestExplorerRevealFile(liveTab.path);
      closeTransferredCodePanelTab(liveTab.path);
    },
    [
      closeTransferredCodePanelTab,
      requestExplorerRevealFile,
      resolveLiveCodePanelTab,
    ],
  );

  const handleCodePanelTabDetachToPanel = useCallback(
    (
      tab: CodePanelTab,
      point: { x: number; y: number },
      options?: { snapPosition?: PanelOpenRequest["position"] | null },
    ) => {
      const liveTab = resolveLiveCodePanelTab(tab);
      const input: OpenPreviewWindowInput = {
        surface: "code",
        title: liveTab.name,
        payload: {
          title: liveTab.name,
          path: liveTab.path,
          content: liveTab.content,
          language: liveTab.language,
          line: liveTab.line,
        },
        mode: "floating",
        x: Math.max(16, point.x - 280),
        y: Math.max(64, point.y - 24),
        width: 560,
        height: 360,
      };

      if (options?.snapPosition) {
        const openResult = openPreviewWindow(input);
        if (!openResult.opened) {
          if (openResult.reason) {
            showNotification("error", openResult.reason);
          }
          return;
        }
        if (openResult.id) {
          focusPreviewWindow(openResult.id);
          movePreviewWindowToPosition(openResult.id, options.snapPosition);
        }
      } else {
        handlePreviewWindowOpenEvent(input);
      }
      closeTransferredCodePanelTab(liveTab.path);
    },
    [
      closeTransferredCodePanelTab,
      focusPreviewWindow,
      handlePreviewWindowOpenEvent,
      movePreviewWindowToPosition,
      openPreviewWindow,
      resolveLiveCodePanelTab,
      showNotification,
    ],
  );

  const { applyPanelOpenState, closeTerminalPanel, toggleNamedPanel } =
    useMainLayoutPanelEvents({
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      closeActiveFullscreenPanelFromShortcut,
      closeAllPreviewWindows,
      closeExecutionDialog,
      closePanelWithMotion,
      closeSettings,
      closeTUIAssistPanel,
      copyProjectPathFromShortcut,
      dispatcher,
      enterTUIMode,
      exitTUIMode,
      ensureActiveTerminalSessionId,
      forceHideTerminalAfterTUIExitRef,
      getActiveTerminalSessionId,
      aiChatPreFullscreenRef,
      gitPreFullscreenRef,
      handleAppearancePreviewApplyEvent,
      handleAppearancePreviewCancelEvent,
      handleAppearancePreviewPatchEvent,
      handleAppearancePreviewStartEvent,
      handleFileOpenInPanel,
      handlePreviewWindowCheckpointCreateEvent,
      handlePreviewWindowCheckpointRestoreEvent,
      handlePreviewWindowCloseEvent,
      handlePreviewWindowFocusEvent,
      handlePreviewWindowOpenEvent,
      handlePreviewWindowUpdateEvent,
      handleSurfacePromoteEvent,
      isAIChatTopmostFullscreen,
      isSettingsOpen,
      logicalViewport,
      moveBrowserPreviewToPosition,
      moveSnappedPanelBetweenSides,
      openCanonicalBrowserPreviewRef,
      openCommandDispatcher,
      openDebugDialog,
      openFileFromPath,
      onProjectOpen,
      openRunDialog,
      openSettings,
      openTUIAssistPanel,
      panelConfigsRef,
      panelsRef,
      problemsPreFullscreenRef,
      rememberedSnappedPositionsRef,
      setPanelConfigs,
      setActivePanelId: markActivePanel,
      startSnappedSlotEnter,
      setTUIAssistRatio,
      shouldSuppressApplicationMenuAction,
      submitTerminalCommand,
      terminalPreFullscreenRef,
      toggleCanonicalBrowserPreviewRef,
      togglePanelCompactFromShortcut,
      togglePanelFullscreenFromShortcut,
    });

  const openProblemsInAvailableSlot = useCallback(() => {
    const position = findAvailablePanelPosition({
      preferred: "bottom",
      exclude: ["problems"],
    });

    if (position) {
      applyPanelOpenState("problems", {
        panel: "problems",
        mode: "snapped",
        position,
      });
      pinZenPanelIfShortcutOpened("problems");
      return;
    }

    const currentConfig = panelConfigsRef.current.problems;
    const floatingConfig =
      currentConfig.mode === "floating"
        ? currentConfig
        : DEFAULT_PANEL_CONFIGS.problems;

    applyPanelOpenState("problems", {
      panel: "problems",
      mode: "floating",
      x: floatingConfig.x,
      y: floatingConfig.y,
      width:
        floatingConfig.size.width || DEFAULT_PANEL_CONFIGS.problems.size.width,
      height:
        floatingConfig.size.height ||
        DEFAULT_PANEL_CONFIGS.problems.size.height,
    });
  }, [
    applyPanelOpenState,
    findAvailablePanelPosition,
    pinZenPanelIfShortcutOpened,
  ]);

  const togglePanelFromExplicitAction = useCallback(
    (panelId: PanelId) => {
      const wasVisible = panelsRef.current[panelId];
      if (isZenHiddenSnappedPanel(panelId)) {
        pinZenPanelIfShortcutOpened(panelId);
        markActivePanel(panelId);
        return;
      }

      if (panelId === "problems" && !wasVisible) {
        openProblemsInAvailableSlot();
      } else {
        toggleNamedPanel(panelId);
      }
      if (!wasVisible) {
        pinZenPanelIfShortcutOpened(panelId);
      }
    },
    [
      isZenHiddenSnappedPanel,
      markActivePanel,
      openProblemsInAvailableSlot,
      pinZenPanelIfShortcutOpened,
      toggleNamedPanel,
    ],
  );

  useMainLayoutKeyboardShortcuts({
    activeModal,
    activateAdjacentCodePanelTab,
    applicationMenuRepeatRef,
    beginHeldPanelShortcut,
    clearHeldPanelShortcut,
    closeActiveFullscreenPanelFromShortcut,
    closeCreateEntryDialog,
    closeExecutionDialog,
    closeModal,
    closePreviewWindowWithMotion,
    closeSettings,
    closeTUIAssistPanel,
    copyProjectPathFromShortcut,
    createEntryDialog,
    delayedShortcutActionSuppressionRef,
    dispatcher,
    executionDialogMode,
    finishHeldPanelShortcutOnKeyUp,
    getShortcutEventCode,
    aiChatPreFullscreenRef,
    gitPreFullscreenRef,
    handleHeldPanelShortcutMove,
    isAIChatTopmostFullscreen,
    terminalThemeId: resolvedThemeId,
    isPerspectiveOpenRef,
    isSettingsOpen,
    markShortcutActionHandled,
    onSwitchProject,
    openSettings,
    redoProjectEntryOperation,
    panelsRef,
    pressedShortcutCodesRef,
    problemsPreFullscreenRef,
    shortcutActionSuppressionRef,
    terminalPreFullscreenRef,
    toggleCanonicalBrowserPreviewRef,
    toggleCommandDispatcher,
    togglePanelCompactFromShortcut,
    togglePanelFullscreenFromShortcut,
    undoProjectEntryOperation,
  });

  const togglePanel = (panel: keyof PanelVisibility) => {
    if (panelsRef.current[panel] && !isZenHiddenSnappedPanel(panel)) {
      closePanelWithMotion(panel);
      return;
    }

    togglePanelFromExplicitAction(panel);
  };

  const openAIChatFromPalette = useCallback(() => {
    if (isZenHiddenSnappedPanel("aiChat")) {
      pinZenPanelIfShortcutOpened("aiChat");
      markActivePanel("aiChat");
      return;
    }

    if (panelsRef.current.aiChat) {
      markActivePanel("aiChat");
      return;
    }

    applyPanelOpenState("aiChat", { panel: "aiChat" });
    pinZenPanelIfShortcutOpened("aiChat");
  }, [
    applyPanelOpenState,
    isZenHiddenSnappedPanel,
    markActivePanel,
    pinZenPanelIfShortcutOpened,
  ]);

  const handlePaletteAction = useCallback(
    (actionId: AICommandPaletteActionId, payload?: AICommandPalettePayload) => {
      if (!actionId.startsWith("ai.")) {
        return;
      }
      openAIChatFromPalette();
      useAIChatStore.getState().enqueueCommandIntent(actionId, payload);
    },
    [openAIChatFromPalette],
  );

  const openProblemsFromStatusBar = () => {
    if (panelsRef.current.problems && !isZenHiddenSnappedPanel("problems")) {
      closePanelWithMotion("problems");
      return;
    }

    if (isZenHiddenSnappedPanel("problems")) {
      pinZenPanelIfShortcutOpened("problems");
      markActivePanel("problems");
      return;
    }

    openProblemsInAvailableSlot();
  };

  const {
    handleDragEnd,
    handleDragMove,
    handleDragStart,
    handleGitDiffFocusChange,
    handlePanelResize,
    handlePreviewWindowDragEnd,
    handlePreviewWindowDragMove,
    handlePreviewWindowDragStart,
  } = useMainLayoutPanelDrag({
    applyPanelConfigsState,
    applyRememberedSnappedPositionsState,
    draggingPanel,
    findAvailablePanelPosition,
    findSnappedPreviewWindowAtPosition,
    focusPreviewWindow,
    gitDiffBaselineWidthRef,
    isSnappedPositionOccupied,
    movePreviewWindowToPosition,
    panelConfigs,
    panelConfigsRef,
    panelDropSettlingTimerRef,
    panels,
    rememberedSnappedPositionsRef,
    setDraggingPanel,
    setDraggingPreviewWindowId,
    setDropTargetPosition,
    setFloatingPresenceVersion,
    setPanelConfigs,
    setPanelDropSettling,
    setRelocatingPanelIds,
    setRelocatingPreviewWindowIds,
    snapPreviewWindowToPosition,
    startPanelDropSettling,
    updatePreviewWindow,
  });

  const handleFilePanelSnapDragStart = useCallback(() => {
    setDraggingPanel(null);
    setDraggingPreviewWindowId(null);
    setDraggingFilePanel(true);
    setDropTargetPosition(null);
    window.dispatchEvent(new CustomEvent("panel-drag-start"));
  }, []);

  const handleFilePanelSnapDragMove = useCallback(
    (position: PanelPosition | null) => {
      setDropTargetPosition((current) =>
        current === position ? current : position,
      );
    },
    [],
  );

  const handleFilePanelSnapDragEnd = useCallback(() => {
    setDraggingFilePanel(false);
    setDropTargetPosition(null);
    window.dispatchEvent(new CustomEvent("panel-drag-end"));
  }, []);

  const filePanelSnapDrag = useMemo(
    () => ({
      onPanelSnapDragStart: handleFilePanelSnapDragStart,
      onPanelSnapDragMove: handleFilePanelSnapDragMove,
      onPanelSnapDragEnd: handleFilePanelSnapDragEnd,
    }),
    [
      handleFilePanelSnapDragEnd,
      handleFilePanelSnapDragMove,
      handleFilePanelSnapDragStart,
    ],
  );

  const workspaceModel = useMainPanelWorkspaceModel({
    panels: layoutPanels,
    panelConfigs,
    previewWindows,
    workspacePreviewWindows,
    tuiModeActive,
    resizingPanel,
    resizingPreviewWindowId,
    isLogicalFullscreenPanel,
  });
  const { getActivePanelsAtPosition, getActivePreviewWindowAtPosition } =
    workspaceModel;

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: "100%",
    overflow: "hidden",
    padding: "8px",
    boxSizing: "border-box",
    backgroundColor: "var(--bg-blackprint)",
    color: "var(--text-primary)",
  };

  const shellFrameStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    position: "relative",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    borderRadius: "var(--radius-shell)",
    backgroundColor: "var(--surface-canvas)",
    boxShadow: "var(--shell-shadow)",
  };

  const mainAreaStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    position: "relative",
    overflow: "clip",
    minHeight: 0,
    backgroundColor: "var(--bg-blackprint)",
  };

  const editorAreaStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    zIndex: 0,
    margin: "0 8px 8px",
    boxSizing: "border-box",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--editor-border)",
    backgroundColor: "var(--editor-bg)",
    boxShadow:
      "inset 0 1px 0 var(--shell-inner-highlight), 0 18px 44px -30px rgba(0, 0, 0, 0.86)",
    contain: "layout paint style",
    transform: "translateZ(0)",
    backfaceVisibility: "hidden",
  };

  const renderDropZone = (position: PanelPosition) => {
    const isPanelDragActive =
      draggingPanel !== null ||
      draggingPreviewWindowId !== null ||
      draggingFilePanel;
    const isActive = isPanelDragActive && dropTargetPosition === position;
    const targetPanel = getActivePanelsAtPosition(position);
    const targetPreviewWindow = getActivePreviewWindowAtPosition(
      position,
      draggingPreviewWindowId,
    );
    const isSwapTarget =
      isActive &&
      ((targetPanel !== null && targetPanel !== draggingPanel) ||
        targetPreviewWindow !== null);

    return (
      <PanelDropZone
        position={position}
        isDark={isDark}
        isActive={isActive}
        isSwapTarget={isSwapTarget}
      />
    );
  };

  const fullscreenTransitionPanelIds = useMemo(
    () => fullscreenPanelTransitions.map((target) => target.panelId),
    [fullscreenPanelTransitions],
  );
  const fullscreenTransitionPositions = useMemo(
    () =>
      uniquePanelPositions(
        fullscreenPanelTransitions.map((target) => target.position),
      ),
    [fullscreenPanelTransitions],
  );
  const effectivePanelDropSettling =
    panelDropSettling ||
    fullscreenPanelTransitions.length > 0 ||
    panelEnterPositions.length > 0;
  const effectivePanelDropSettlingPositions = useMemo(
    () =>
      uniquePanelPositions([
        ...panelDropSettlingPositions,
        ...fullscreenTransitionPositions,
      ]),
    [fullscreenTransitionPositions, panelDropSettlingPositions],
  );

  const handlePanelFullscreen = useCallback(
    (panelId: PanelId) => {
      switch (panelId) {
        case "terminal": {
          if (tuiModeActive) {
            terminalPreFullscreenRef.current = null;
            const terminalState = useTerminalStore.getState();
            setTUIAssist({
              active: false,
              panel: null,
              anchor: terminalState.tuiAssist.anchor,
            });
            setPanelConfigs((previous) => ({
              ...previous,
              terminal: {
                ...previous.terminal,
                ...getTUIFloatingTerminalConfig({
                  viewportWidth: logicalViewport.width,
                  viewportHeight: logicalViewport.height,
                }),
              },
            }));
            setTimeout(() => terminalState.focusActiveTerminal(), 80);
            return;
          }

          restoreOrEnterPanelFullscreen("terminal", terminalPreFullscreenRef);
          return;
        }
        case "aiChat":
          restoreOrEnterPanelFullscreen("aiChat", aiChatPreFullscreenRef);
          return;
        case "git":
          restoreOrEnterPanelFullscreen("git", gitPreFullscreenRef);
          return;
        case "problems":
          restoreOrEnterPanelFullscreen("problems", problemsPreFullscreenRef);
          return;
        case "code":
          restoreOrEnterPanelFullscreen("code", codePreFullscreenRef);
          return;
        case "markdownPreview":
          restoreOrEnterPanelFullscreen(
            "markdownPreview",
            markdownPreviewPreFullscreenRef,
          );
          return;
        default:
          return;
      }
    },
    [
      logicalViewport.height,
      logicalViewport.width,
      restoreOrEnterPanelFullscreen,
      tuiModeActive,
    ],
  );

  const renderPanel = (
    panelId: PanelId,
    hostMode: "overlay" | "flow" = "overlay",
    isSlotExiting = false,
  ) => (
    <MainLayoutPanelRenderer
      key={panelId}
      panelId={panelId}
      hostMode={hostMode}
      isSlotExiting={isSlotExiting}
      panels={effectivePanels}
      zenPinnedPanels={zenPinnedPanels}
      zenModeEnabled={zenModeEnabled}
      panelConfigs={panelConfigs}
      previewWindows={previewWindows}
      dropTargetPosition={dropTargetPosition}
      draggingPanel={draggingPanel}
      draggingPreviewWindowId={draggingPreviewWindowId}
      draggingFilePanel={draggingFilePanel}
      relocatingPanelIds={relocatingPanelIds}
      uiScale={uiScale}
      activeProjectPath={activeProjectPath}
      activeStatusFilePath={activeStatusFilePath}
      activeEditorTabPath={activeEditorTab?.path ?? null}
      activeCodePanelTab={activeCodePanelTab}
      activeCodePanelPatchPreview={activeCodePanelPatchPreview}
      codePanelPatchBusyId={codePanelPatchBusyId}
      codePanelTabs={codePanelTabs}
      markdownPreviewSource={markdownPreviewSource}
      tuiModeActive={tuiModeActive}
      tuiTerminalPaneStyle={tuiTerminalPaneStyle}
      terminalZIndex={tuiModeActive ? zIndex.tooltip + 10 : undefined}
      snappedOverlayInsets={
        hostMode === "overlay" && panelConfigs[panelId].mode === "snapped"
          ? {
              top: 0,
              bottom: zenBottomChromeVisible ? bottomChromeHeight : 0,
            }
          : undefined
      }
      zenTopChromeAvoidanceTop={zenTopChromeAvoidanceTop}
      motionPressureActive={panelMotionPressureActive}
      isLogicalFullscreenPanel={isLogicalFullscreenPanel}
      onPanelResize={handlePanelResize}
      onPanelResizeStart={setResizingPanel}
      onPanelResizeEnd={(nextPanelId) =>
        setResizingPanel((current) =>
          current === nextPanelId ? null : current,
        )
      }
      onPanelDragStart={handleDragStart}
      onPanelDragMove={handleDragMove}
      onPanelDragEnd={handleDragEnd}
      onClosePanel={closePanelWithMotion}
      onMovePanelToPosition={movePanelToPosition}
      onCloseTerminalPanel={closeTerminalPanel}
      onPanelFullscreen={handlePanelFullscreen}
      onMarkdownLinkPreviewOpen={handleMarkdownLinkPreviewOpen}
      onFileOpen={handleFileOpen}
      onFileOpenInPanel={handleFileOpenInPanel}
      filePanelSnapDrag={filePanelSnapDrag}
      onOpenFileFromPath={openFileLocationFromPath}
      onOpenPreviewFromTerminal={openPreviewFromTerminal}
      onPerspectiveOpen={handlePerspectiveOpen}
      onPerspectiveClose={handlePerspectiveClose}
      onGitDiffFocusChange={handleGitDiffFocusChange}
      onCodePanelActivate={activateCodePanelTab}
      onCodePanelClose={closeCodePanelTab}
      onCodePanelCloseOthers={closeOtherCodePanelTabs}
      onCodePanelDetachToPanel={handleCodePanelTabDetachToPanel}
      onCodePanelRevealInExplorer={handleCodePanelTabRevealInExplorer}
      onCodePanelMoveToEditorTabs={handleCodePanelTabMoveToEditorTabs}
      onCodePanelAcceptAIInlinePatch={handleAcceptCodePanelAIInlinePatch}
      onCodePanelRejectAIInlinePatch={handleRejectCodePanelAIInlinePatch}
      onZenPinToggle={toggleZenPinnedPanel}
      fullscreenTransitionPanelIds={fullscreenTransitionPanelIds}
    />
  );

  const getPreviewWindowAdjacentPanels = (windowId: string) => {
    const adjacent: {
      left?: number;
      right?: number;
      bottom?: number;
      top?: number;
    } = {};

    (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
      if (!layoutPanels[id]) {
        return;
      }

      const config = panelConfigs[id];
      if (config.mode !== "snapped") {
        return;
      }

      if (config.position === "left") {
        adjacent.left = Math.max(
          adjacent.left ?? 0,
          config.size.width + SNAPPED_PANEL_OUTER_GAP,
        );
      }
      if (config.position === "right") {
        adjacent.right = Math.max(
          adjacent.right ?? 0,
          config.size.width + SNAPPED_PANEL_OUTER_GAP,
        );
      }
      if (config.position === "bottom") {
        adjacent.bottom = Math.max(
          adjacent.bottom ?? 0,
          config.size.height + SNAPPED_PANEL_OUTER_GAP,
        );
      }
      if (config.position === "top") {
        adjacent.top = Math.max(
          adjacent.top ?? 0,
          config.size.height + SNAPPED_PANEL_OUTER_GAP,
        );
      }
    });

    previewWindows.forEach((windowState) => {
      if (windowState.id === windowId || windowState.mode !== "snapped") {
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

  const renderPreviewWindowPanel = (
    windowState: PreviewWindow,
    hostMode: "overlay" | "flow" = "overlay",
  ) => {
    const isDropTarget =
      windowState.mode === "snapped" &&
      dropTargetPosition === windowState.position &&
      ((draggingPanel !== null && draggingPreviewWindowId !== windowState.id) ||
        (draggingPreviewWindowId !== null &&
          draggingPreviewWindowId !== windowState.id) ||
        draggingFilePanel);

    return (
      <PreviewWindowPanelRenderer
        key={windowState.id}
        windowState={windowState}
        hostMode={hostMode}
        isDropTarget={isDropTarget}
        activeDropTargetPosition={
          draggingPreviewWindowId === windowState.id ? dropTargetPosition : null
        }
        isRelocating={relocatingPreviewWindowIds.includes(windowState.id)}
        adjacentPanels={getPreviewWindowAdjacentPanels(windowState.id)}
        uiScale={uiScale}
        surfaceBackgroundColor="var(--bg-secondary)"
        appearancePreview={appearancePreview}
        currentTheme={currentTheme}
        currentUiScale={uiScale}
        motionPressureActive={panelMotionPressureActive}
        onClose={closePreviewWindowWithMotion}
        onResize={(windowId, updates) => {
          updatePreviewWindow(windowId, {
            width: updates.width,
            height: updates.height,
            x: updates.x,
            y: updates.y,
          });
        }}
        onResizeStart={setResizingPreviewWindowId}
        onResizeEnd={(windowId) =>
          setResizingPreviewWindowId((current) =>
            current === windowId ? null : current,
          )
        }
        onDragStart={handlePreviewWindowDragStart}
        onDragMove={handlePreviewWindowDragMove}
        onDragEnd={handlePreviewWindowDragEnd}
        onAppearancePatch={handleAppearancePreviewPatchEvent}
        onAppearanceApply={handleAppearancePreviewApplyEvent}
        onAppearanceCancel={handleAppearancePreviewCancelEvent}
        onFileOpen={handleFileOpen}
      />
    );
  };

  const zenTopChromeVisible =
    !zenModeEnabled ||
    zenTopChromePopupOpen ||
    (!zenTopChromeInteractionLocked &&
      (zenTopChromeEdgeActive ||
        zenTopChromePointerInside ||
        zenTopChromeOccludedHeaderActive));
  const zenBottomChromeVisible = !zenModeEnabled || zenBottomChromeHovered;
  const terminalPanelConfig = panelConfigs.terminal;
  const tuiTerminalOccludesNativeWindowControls =
    tuiModeActive &&
    panels.terminal &&
    terminalPanelConfig.mode === "floating" &&
    terminalPanelConfig.x < NATIVE_WINDOW_CONTROLS_OCCLUSION_WIDTH &&
    terminalPanelConfig.y < NATIVE_WINDOW_CONTROLS_OCCLUSION_HEIGHT &&
    terminalPanelConfig.x + terminalPanelConfig.size.width > 0 &&
    terminalPanelConfig.y + terminalPanelConfig.size.height > 0;
  const nativeWindowControlsEnabled =
    showNativeMacWindowControls &&
    !tuiTerminalOccludesNativeWindowControls &&
    (nativeWindowFullscreen || zenTopChromeVisible);
  const nativeWindowControlsVisible =
    nativeWindowControlsEnabled &&
    zenTopChromeVisible &&
    !nativeWindowFullscreen;
  const nativeWindowControlsBackdropVisible = nativeWindowControlsVisible;
  const zenTopChromeAvoidanceTop =
    zenModeEnabled && zenTopChromeVisible && !zenTopChromeInteractionLocked
      ? topChromeHeight + SNAPPED_PANEL_OUTER_GAP
      : 0;

  useEffect(() => {
    let cancelled = false;

    void IsNativeFullscreen()
      .then((fullscreen) => {
        if (!cancelled) {
          setNativeWindowFullscreen(Boolean(fullscreen));
        }
      })
      .catch(() => undefined);

    const unsubscribe = EventsOn(
      NATIVE_FULLSCREEN_CHANGED_EVENT,
      (payload: NativeFullscreenChangedEvent) => {
        setNativeWindowFullscreen(Boolean(payload?.fullscreen));
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const zenChromeTransition = reducePanelMotion
    ? "none"
    : `transform ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity 140ms ease`;

  const topChromeDragStyle = {
    "--wails-draggable": zenTopChromeVisible ? "drag" : "no-drag",
    WebkitAppRegion: zenTopChromeVisible ? "drag" : "no-drag",
  } as React.CSSProperties;

  const topChromeStyle: React.CSSProperties = {
    ...topChromeDragStyle,
    left: zenModeEnabled ? 0 : undefined,
    maxHeight: 72,
    opacity: zenTopChromeVisible ? 1 : 0,
    overflow: "visible",
    pointerEvents: zenTopChromeVisible ? "auto" : "none",
    position: zenModeEnabled ? "absolute" : "relative",
    right: zenModeEnabled ? 0 : undefined,
    top: zenModeEnabled ? 0 : undefined,
    transform: zenTopChromeVisible
      ? "translateY(2px)"
      : "translateY(calc(-100% - 12px))",
    transition: zenModeEnabled ? zenChromeTransition : undefined,
    zIndex: zIndex.tooltip + 4,
  };

  const bottomChromeStyle: React.CSSProperties = {
    bottom: zenModeEnabled ? 0 : undefined,
    left: zenModeEnabled ? 0 : undefined,
    maxHeight: 40,
    opacity: zenBottomChromeVisible ? 1 : 0,
    overflow: "hidden",
    pointerEvents: zenBottomChromeVisible ? "auto" : "none",
    position: zenModeEnabled ? "absolute" : "relative",
    right: zenModeEnabled ? 0 : undefined,
    transform: zenBottomChromeVisible
      ? "translateY(0)"
      : "translateY(calc(100% + 12px))",
    transition: zenModeEnabled ? zenChromeTransition : undefined,
    zIndex: zIndex.tooltip + 4,
  };

  const applyZenViewportChromeState = useCallback(
    (nextChrome: Record<"top" | "bottom", boolean>) => {
      if (!zenModeEnabled) {
        return;
      }

      const previousChrome = zenViewportChromeStateRef.current;
      zenViewportChromeStateRef.current = nextChrome;

      if (nextChrome.top) {
        if (!previousChrome.top) {
          setZenTopChromeEdgeSource(true);
        }
      } else if (previousChrome.top) {
        setZenTopChromeEdgeSource(false);
      }

      if (nextChrome.bottom) {
        if (!previousChrome.bottom || zenBottomChromeHoverTimerRef.current) {
          showZenBottomChrome();
        }
      } else if (previousChrome.bottom) {
        hideZenBottomChrome();
      }
    },
    [
      hideZenBottomChrome,
      setZenTopChromeEdgeSource,
      showZenBottomChrome,
      zenModeEnabled,
    ],
  );

  const handleZenViewportPointer = useCallback(
    (event: ZenViewportPointerSnapshot) => {
      if (!zenModeEnabled) {
        return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const { buttons, clientX, clientY } = event;
      const previousChrome = zenViewportChromeStateRef.current;
      const bottomReleaseBoundary =
        viewportHeight - bottomChromeHeight - ZEN_EDGE_HOVER_SIZE;
      const chromeInteractionLocked = zenPanelInteractionActiveRef.current;
      const topChromeInteractionLocked =
        !zenTopChromePopupOpen && chromeInteractionLocked;
      const topChromeOwned =
        zenTopChromeVisible && isZenTopChromeOwnedAtPoint(clientX, clientY);
      const topChromeReleaseBoundary = Math.max(
        ZEN_EDGE_HOVER_SIZE,
        topChromeHeight + SNAPPED_PANEL_OUTER_GAP,
      );
      const topChromeWithinVisibleBand =
        zenTopChromeVisible && clientY <= topChromeReleaseBoundary;
      const topChromePreOpenVetoed =
        !zenTopChromeVisible &&
        !topChromeInteractionLocked &&
        !zenTopChromePopupOpen &&
        isZenTopChromePreOpenVetoAtPoint(clientX, clientY);
      const topChromeCornerActive =
        clientY <= ZEN_EDGE_HOVER_SIZE &&
        (clientX <= ZEN_EDGE_HOVER_SIZE ||
          clientX >= viewportWidth - ZEN_EDGE_HOVER_SIZE);
      const topChromeEdgeImmediate =
        clientY <= ZEN_TOP_CHROME_HOVER_SIZE || topChromeCornerActive;
      const topChromeOccludedHeaderTarget =
        !zenTopChromeVisible &&
        !topChromeEdgeImmediate &&
        !topChromeInteractionLocked &&
        !topChromePreOpenVetoed &&
        buttons === 0 &&
        isZenTopChromeOccludedRevealTargetAtPoint(clientX, clientY);
      const bottomChromeEdgeTarget =
        clientY >= viewportHeight - ZEN_EDGE_HOVER_SIZE;
      const bottomChromeKeepActive =
        previousChrome.bottom && clientY >= bottomReleaseBoundary;
      const nextRevealIntentSource: ZenChromeRevealIntentSource | null =
        buttons !== 0 || chromeInteractionLocked
          ? null
          : !zenTopChromeVisible &&
              !zenTopChromePopupOpen &&
              !topChromePreOpenVetoed &&
              topChromeEdgeImmediate
            ? "top-edge"
            : topChromeOccludedHeaderTarget
              ? "top-occluded-header"
              : !zenBottomChromeVisible && bottomChromeEdgeTarget
                ? "bottom-edge"
                : null;

      setZenTopChromeInteractionLock(topChromeInteractionLocked);
      if (topChromeInteractionLocked || topChromePreOpenVetoed) {
        setZenTopChromePointerSource(false);
      } else {
        setZenTopChromePointerSource(
          topChromeOwned || topChromeWithinVisibleBand,
        );
      }
      if (nextRevealIntentSource) {
        scheduleZenChromeRevealIntent(nextRevealIntentSource, clientX, clientY);
      } else {
        clearZenChromeRevealIntent();
      }
      if (topChromeOccludedHeaderTarget) {
        setZenTopChromeOccludedHeaderSource(false);
      } else {
        clearZenTopChromeOccludedHeaderIntent();
      }

      applyZenViewportChromeState({
        top:
          !topChromeInteractionLocked &&
          !topChromePreOpenVetoed &&
          zenTopChromeVisible &&
          topChromeEdgeImmediate,
        bottom: bottomChromeKeepActive,
      });
    },
    [
      applyZenViewportChromeState,
      bottomChromeHeight,
      clearZenChromeRevealIntent,
      clearZenTopChromeOccludedHeaderIntent,
      scheduleZenChromeRevealIntent,
      setZenTopChromeOccludedHeaderSource,
      setZenTopChromeInteractionLock,
      setZenTopChromePointerSource,
      topChromeHeight,
      zenModeEnabled,
      zenBottomChromeVisible,
      zenTopChromeVisible,
      zenTopChromePopupOpen,
    ],
  );

  const flushZenViewportMouseMove = useCallback(() => {
    zenViewportMouseMoveFrameRef.current = null;
    const pointer = zenViewportPointerRef.current;
    if (!pointer) {
      return;
    }

    handleZenViewportPointer(pointer);
  }, [handleZenViewportPointer]);

  const handleZenViewportMouseMove = useCallback(
    (event: ZenViewportPointerSnapshot) => {
      if (!zenModeEnabled) {
        return;
      }

      zenViewportPointerRef.current = {
        buttons: event.buttons ?? 0,
        clientX: event.clientX,
        clientY: event.clientY,
      };

      if (zenViewportMouseMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(zenViewportMouseMoveFrameRef.current);
      }

      zenViewportMouseMoveFrameRef.current = window.requestAnimationFrame(
        flushZenViewportMouseMove,
      );
    },
    [flushZenViewportMouseMove, zenModeEnabled],
  );

  const handleZenViewportMouseDown = useCallback(
    (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      const preserveVisibleChrome = Boolean(
        target?.closest('[data-testid="topbar"],[data-shell-menu-content]'),
      );
      clearZenChromeRevealIntent();
      clearZenTopChromeOccludedHeaderIntent(!preserveVisibleChrome);
    },
    [clearZenChromeRevealIntent, clearZenTopChromeOccludedHeaderIntent],
  );

  const handleZenViewportMouseMoveEvent = useEffectEvent(
    (event: MouseEvent) => {
      handleZenViewportMouseMove(event);
    },
  );

  const handleZenViewportMouseDownEvent = useEffectEvent(
    (event: MouseEvent) => {
      handleZenViewportMouseDown(event);
    },
  );

  const handleVisibleTopChromeMouseMove = useEffectEvent(
    (event: MouseEvent) => {
      const releaseBoundary = Math.max(
        ZEN_EDGE_HOVER_SIZE,
        topChromeHeight + SNAPPED_PANEL_OUTER_GAP,
      );
      if (
        event.clientY <= releaseBoundary ||
        isZenTopChromeOwnedAtPoint(event.clientX, event.clientY)
      ) {
        return;
      }

      clearZenChromeRevealIntent();
      clearZenTopChromeOccludedHeaderIntent();
      zenViewportChromeStateRef.current = {
        ...zenViewportChromeStateRef.current,
        top: false,
      };
      setZenTopChromeEdgeSource(false);
      setZenTopChromePointerSource(false);
    },
  );

  const handleVisibleBottomChromeMouseMove = useEffectEvent(
    (event: MouseEvent) => {
      const releaseBoundary =
        window.innerHeight - bottomChromeHeight - ZEN_EDGE_HOVER_SIZE;
      if (event.clientY >= releaseBoundary) {
        return;
      }

      zenViewportChromeStateRef.current = {
        ...zenViewportChromeStateRef.current,
        bottom: false,
      };
      hideZenBottomChrome();
    },
  );

  const handlePanelDragStartEvent = useEffectEvent(() => {
    clearZenChromeRevealIntent();
    clearZenTopChromeOccludedHeaderIntent();
    zenPanelInteractionActiveRef.current = true;
    zenViewportChromeStateRef.current = {
      ...zenViewportChromeStateRef.current,
      top: false,
    };
    setZenTopChromeInteractionLock(true);
    setZenTopChromeEdgeSource(false);
    setZenTopChromePointerSource(false);
  });

  const handlePanelDragEndEvent = useEffectEvent(() => {
    zenPanelInteractionActiveRef.current = false;
    setZenTopChromeInteractionLock(false);
  });

  useEffect(() => {
    if (!zenModeEnabled) {
      zenPanelInteractionActiveRef.current = false;
      setZenTopChromeInteractionLock(false);
      clearZenChromeRevealIntent();
      clearZenTopChromeOccludedHeaderIntent();
      return;
    }

    window.addEventListener("mousemove", handleZenViewportMouseMoveEvent, true);
    window.addEventListener("mousedown", handleZenViewportMouseDownEvent, true);
    return () => {
      window.removeEventListener(
        "mousemove",
        handleZenViewportMouseMoveEvent,
        true,
      );
      window.removeEventListener(
        "mousedown",
        handleZenViewportMouseDownEvent,
        true,
      );
      zenViewportPointerRef.current = null;
      zenViewportChromeStateRef.current = createEmptyZenViewportChromeState();
      zenPanelInteractionActiveRef.current = false;
      setZenTopChromeInteractionLock(false);
      clearZenChromeRevealIntent();
      clearZenTopChromeOccludedHeaderIntent();
      if (zenViewportMouseMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(zenViewportMouseMoveFrameRef.current);
        zenViewportMouseMoveFrameRef.current = null;
      }
    };
  }, [
    clearZenTopChromeOccludedHeaderIntent,
    clearZenChromeRevealIntent,
    setZenTopChromeInteractionLock,
    zenModeEnabled,
  ]);

  useEffect(() => {
    if (!zenModeEnabled || !zenTopChromeVisible) {
      return;
    }

    window.addEventListener("mousemove", handleVisibleTopChromeMouseMove, true);
    return () => {
      window.removeEventListener(
        "mousemove",
        handleVisibleTopChromeMouseMove,
        true,
      );
    };
  }, [zenModeEnabled, zenTopChromeVisible]);

  useEffect(() => {
    if (!zenModeEnabled || !zenBottomChromeVisible) {
      return;
    }

    window.addEventListener(
      "mousemove",
      handleVisibleBottomChromeMouseMove,
      true,
    );
    return () => {
      window.removeEventListener(
        "mousemove",
        handleVisibleBottomChromeMouseMove,
        true,
      );
    };
  }, [zenBottomChromeVisible, zenModeEnabled]);

  useEffect(() => {
    if (!zenModeEnabled) {
      return;
    }

    const interactionActive =
      draggingPanel !== null ||
      draggingFilePanel ||
      resizingPanel !== null ||
      draggingPreviewWindowId !== null ||
      resizingPreviewWindowId !== null;

    zenPanelInteractionActiveRef.current = interactionActive;
    setZenTopChromeInteractionLock(interactionActive);

    if (!interactionActive) {
      return;
    }

    clearZenChromeRevealIntent();
    clearZenTopChromeOccludedHeaderIntent();
    zenViewportChromeStateRef.current = {
      ...zenViewportChromeStateRef.current,
      top: false,
    };
    setZenTopChromeEdgeSource(false);
    setZenTopChromePointerSource(false);
  }, [
    draggingPanel,
    draggingFilePanel,
    draggingPreviewWindowId,
    resizingPanel,
    resizingPreviewWindowId,
    clearZenChromeRevealIntent,
    clearZenTopChromeOccludedHeaderIntent,
    setZenTopChromeEdgeSource,
    setZenTopChromeInteractionLock,
    setZenTopChromePointerSource,
    zenModeEnabled,
  ]);

  useEffect(() => {
    if (!zenModeEnabled) {
      return;
    }

    window.addEventListener("panel-drag-start", handlePanelDragStartEvent);
    window.addEventListener("panel-drag-end", handlePanelDragEndEvent);
    return () => {
      window.removeEventListener("panel-drag-start", handlePanelDragStartEvent);
      window.removeEventListener("panel-drag-end", handlePanelDragEndEvent);
      zenPanelInteractionActiveRef.current = false;
      setZenTopChromeInteractionLock(false);
    };
  }, [setZenTopChromeInteractionLock, zenModeEnabled]);

  const normalWorkspaceStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0,
    opacity: 1,
    pointerEvents: "auto",
    isolation:
      effectivePanelDropSettling || panelExitPositions.length > 0
        ? "isolate"
        : undefined,
  };

  const centerWorkspaceStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    minWidth: 0,
    position: "relative",
    zIndex: effectivePanelDropSettling ? 0 : undefined,
  };

  const getVerticalSlotStyle = (
    position: PanelPosition,
    width: number,
    isActive: boolean,
    isResizingSlot: boolean,
  ): React.CSSProperties => {
    const isEnteringSlot = panelEnterPositions.includes(position);
    const isSettlingSlot =
      effectivePanelDropSettlingPositions.includes(position);
    const isExitingSlot = panelExitPositions.includes(position);
    const isCollapsingExitSlot =
      panelExitCollapsingPositions.includes(position);
    const resolvedWidth = isCollapsingExitSlot
      ? 0
      : isExitingSlot && width <= 0
        ? panelExitSlotSizes[position]
        : width;
    const shouldExposeSlotOverflow = isSettlingSlot || isExitingSlot;
    const shouldExposeTopChromeAvoidance =
      zenTopChromeAvoidanceTop > 0 && position !== "bottom" && isActive;
    const slotTransitionSuspended =
      draggingPanel !== null ||
      draggingPreviewWindowId !== null ||
      draggingFilePanel ||
      isResizingSlot;
    const shouldAnimateSlotSize =
      (isEnteringSlot || isSettlingSlot || isExitingSlot) &&
      !slotTransitionSuspended;
    const transition =
      reducePanelMotion || !shouldAnimateSlotSize
        ? "none"
        : `width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), min-width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), max-width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;

    return {
      width: resolvedWidth,
      minWidth: resolvedWidth,
      maxWidth: resolvedWidth,
      height: "100%",
      minHeight: 0,
      flexShrink: 0,
      position: "relative",
      overflow:
        shouldExposeSlotOverflow || shouldExposeTopChromeAvoidance
          ? "visible"
          : "hidden",
      zIndex:
        (shouldExposeSlotOverflow || shouldExposeTopChromeAvoidance) &&
        (isActive || isExitingSlot)
          ? 120
          : undefined,
      pointerEvents: isActive ? "auto" : "none",
      transition,
      willChange:
        shouldExposeSlotOverflow || isEnteringSlot
          ? "width, transform, opacity"
          : shouldExposeTopChromeAvoidance
            ? "transform"
            : "auto",
    };
  };

  const getHorizontalSlotStyle = (
    position: PanelPosition,
    height: number,
    isActive: boolean,
    isResizingSlot: boolean,
  ): React.CSSProperties => {
    const isEnteringSlot = panelEnterPositions.includes(position);
    const isSettlingSlot =
      effectivePanelDropSettlingPositions.includes(position);
    const isExitingSlot = panelExitPositions.includes(position);
    const isCollapsingExitSlot =
      panelExitCollapsingPositions.includes(position);
    const resolvedHeight = isCollapsingExitSlot
      ? 0
      : isExitingSlot && height <= 0
        ? panelExitSlotSizes[position]
        : height;
    const shouldExposeSlotOverflow = isSettlingSlot || isExitingSlot;
    const shouldExposeTopChromeAvoidance =
      zenTopChromeAvoidanceTop > 0 && position !== "bottom" && isActive;
    const slotTransitionSuspended =
      draggingPanel !== null ||
      draggingPreviewWindowId !== null ||
      draggingFilePanel ||
      isResizingSlot;
    const shouldAnimateSlotSize =
      (isEnteringSlot || isSettlingSlot || isExitingSlot) &&
      !slotTransitionSuspended;
    const transition =
      reducePanelMotion || !shouldAnimateSlotSize
        ? "none"
        : `height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), min-height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), max-height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;

    return {
      height: resolvedHeight,
      minHeight: resolvedHeight,
      maxHeight: resolvedHeight,
      width: "100%",
      minWidth: 0,
      flexShrink: 0,
      position: "relative",
      overflow:
        shouldExposeSlotOverflow || shouldExposeTopChromeAvoidance
          ? "visible"
          : "hidden",
      zIndex:
        (shouldExposeSlotOverflow || shouldExposeTopChromeAvoidance) &&
        (isActive || isExitingSlot)
          ? 120
          : undefined,
      pointerEvents: isActive ? "auto" : "none",
      transition,
      willChange:
        shouldExposeSlotOverflow || isEnteringSlot
          ? "height, transform, opacity"
          : shouldExposeTopChromeAvoidance
            ? "transform"
            : "auto",
    };
  };

  const tuiTerminalPaneStyle: React.CSSProperties = {
    flex: 1,
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--bg-blackprint)",
  };
  const tuiCenterTerminalContent = (
    <div data-testid="tui-center-terminal" style={tuiTerminalPaneStyle}>
      <TerminalPanelContent
        onOpenFileRef={(path, line, column) => {
          openFileLocationFromPath(path, line, column);
        }}
        onOpenPreviewUrl={(url, sessionId) => {
          openPreviewFromTerminal({ url, sessionId, forceOpen: true });
        }}
      />
    </div>
  );

  // Framer layout scales slot descendants here, which makes panels expand
  // instead of sliding. Slot size is animated with CSS while the panel keeps
  // its own slide transform.
  const workspaceLayoutMotionEnabled = false;
  const panelLayoutChanging =
    effectivePanelDropSettling || panelExitPositions.length > 0;
  const workspaceEditorContent = React.cloneElement(
    children as React.ReactElement<{
      markdownPreviewOpen?: boolean;
      onToggleProblems?: () => void;
      onToggleMarkdownPreview?: () => void;
      onMarkdownPreviewSourceChange?: (
        source: MarkdownPreviewSource | null,
      ) => void;
      onPerspectiveOpen?: () => void;
      onPerspectiveClose?: () => void;
      onEditorFileOpenReady?: MainEditorFileOpenRegistrar;
      onDirtyEditorFlushReady?: MainEditorDirtyFlushRegistrar;
      onFileOpenInPanel?: typeof handleFileOpenInPanel;
      onPanelSnapDragStart?: typeof handleFilePanelSnapDragStart;
      onPanelSnapDragMove?: typeof handleFilePanelSnapDragMove;
      onPanelSnapDragEnd?: typeof handleFilePanelSnapDragEnd;
    }>,
    {
      markdownPreviewOpen: panels.markdownPreview,
      onToggleProblems: () => togglePanel("problems"),
      onToggleMarkdownPreview: handleToggleMarkdownPreview,
      onMarkdownPreviewSourceChange: handleMarkdownPreviewSourceChange,
      onPerspectiveOpen: handlePerspectiveOpen,
      onPerspectiveClose: handlePerspectiveClose,
      onEditorFileOpenReady: registerEditorFileOpenHandler,
      onDirtyEditorFlushReady: registerDirtyEditorFlushHandler,
      onFileOpenInPanel: handleFileOpenInPanel,
      ...filePanelSnapDrag,
    },
  );
  const centerWorkspaceContent = tuiModeActive
    ? tuiCenterTerminalContent
    : workspaceEditorContent;

  return (
    <ProjectEntryActionsProvider value={projectEntryActions}>
      <div
        style={containerStyle}
        data-testid="main-layout"
        data-tui-session-id={tuiActiveSessionId || ""}
        data-tui-terminal-occludes-native-controls={
          tuiTerminalOccludesNativeWindowControls ? "true" : "false"
        }
        data-zen-mode={zenModeEnabled ? "true" : "false"}
        data-zen-topbar-visible={zenTopChromeVisible ? "true" : "false"}
        data-zen-statusbar-visible={zenBottomChromeVisible ? "true" : "false"}
      >
        <div style={shellFrameStyle}>
          <div
            ref={topChromeRef}
            data-zen-top-chrome="true"
            style={topChromeStyle}
            onMouseEnter={() => {
              if (!zenModeEnabled) {
                return;
              }
              setZenTopChromePointerSource(true);
            }}
            onMouseLeave={() => {
              if (!zenModeEnabled) {
                return;
              }
              clearZenChromeRevealIntent();
              clearZenTopChromeOccludedHeaderIntent();
              setZenTopChromeEdgeSource(false);
              setZenTopChromePointerSource(false);
            }}
          >
            <TopBar
              onChromePopupOpenChange={handleTopChromePopupOpenChange}
              onOpenSearch={openCommandDispatcher}
              onOpenSettings={openSettings}
              onToggleExplorer={() => {
                if (tuiModeActive) {
                  togglePanelFromExplicitAction("explorer");
                  return;
                }
                togglePanelFromExplicitAction("explorer");
              }}
              onToggleTerminal={() => {
                if (tuiModeActive) {
                  closeTUIAssistPanel();
                  setTimeout(
                    () => useTerminalStore.getState().focusActiveTerminal(),
                    80,
                  );
                  return;
                }
                togglePanelFromExplicitAction("terminal");
              }}
              onToggleAIChat={() => {
                if (tuiModeActive) {
                  togglePanelFromExplicitAction("aiChat");
                  return;
                }
                togglePanelFromExplicitAction("aiChat");
              }}
              onToggleGit={() => {
                if (tuiModeActive) {
                  togglePanelFromExplicitAction("git");
                  return;
                }
                togglePanelFromExplicitAction("git");
              }}
              onRun={openRunDialog}
              onOpenDebug={openDebugDialog}
              onOpenPreview={openCanonicalBrowserPreview}
              onOpenDependencyPolicy={openDependencyPolicy}
              onCheckForUpdates={checkForUpdates}
              onBackToWelcome={onBackToWelcome}
              onProjectOpen={onProjectOpen}
              onSwitchProject={onSwitchProject}
              onCloseProject={onCloseProject}
              onDetachProject={onDetachProject}
              onReorderProjects={onReorderProjects}
              windowDragEnabled={zenTopChromeVisible}
              panels={{
                explorer: panels.explorer,
                terminal: tuiModeActive ? true : panels.terminal,
                aiChat: panels.aiChat,
                git: panels.git,
              }}
              projectPath={activeProjectPath}
              previewEnabled={previewButtonState.enabled}
              previewActive={previewButtonState.active}
              previewTitle={previewButtonState.buttonTitle}
              windowControlsVisible={nativeWindowControlsVisible}
              windowControlsBackdropVisible={
                nativeWindowControlsBackdropVisible
              }
              windowControlsNativeEnabled={nativeWindowControlsEnabled}
            />
          </div>

          <div style={mainAreaStyle}>
            <MainPanelWorkspace
              panelWorkspaceRef={panelWorkspaceRef}
              workspaceLayoutMotionEnabled={workspaceLayoutMotionEnabled}
              panelLayoutTransition={panelLayoutTransition}
              normalWorkspaceStyle={normalWorkspaceStyle}
              centerWorkspaceStyle={centerWorkspaceStyle}
              editorAreaStyle={editorAreaStyle}
              editorAreaTestId="editor-area"
              editorContent={centerWorkspaceContent}
              panelLayoutChanging={panelLayoutChanging}
              panelDropSettling={effectivePanelDropSettling}
              draggingPanel={draggingPanel}
              draggingPreviewWindowId={draggingPreviewWindowId}
              draggingFilePanel={draggingFilePanel}
              panelExitPositions={panelExitPositions}
              panelPresenceBypassPositions={panelPresenceBypassPositions}
              fullscreenSnappedExitSuppression={
                workspaceModel.fullscreenSnappedExitSuppression
              }
              slots={workspaceModel.slots}
              floatingPresenceVersion={floatingPresenceVersion}
              floatingPanelIds={workspaceModel.floatingPanelIds}
              floatingBrowserPreviewWindows={
                workspaceModel.floatingBrowserPreviewWindows
              }
              renderDropZone={renderDropZone}
              renderPanel={renderPanel}
              renderPreviewWindowPanel={renderPreviewWindowPanel}
              getVerticalSlotStyle={getVerticalSlotStyle}
              getHorizontalSlotStyle={getHorizontalSlotStyle}
              finishSnappedSlotExit={finishSnappedSlotExit}
            />

            <PreviewWindowLayer
              isDark={isDark}
              windows={layeredPreviewWindows}
              appearancePreview={appearancePreview}
              currentTheme={currentTheme}
              currentUiScale={uiScale}
              onUpdateWindow={updatePreviewWindow}
              onCloseWindow={closePreviewWindowWithMotion}
              onFocusWindow={focusPreviewWindow}
              onAppearancePatch={handleAppearancePreviewPatchEvent}
              onAppearanceApply={handleAppearancePreviewApplyEvent}
              onAppearanceCancel={handleAppearancePreviewCancelEvent}
              onFileOpen={handleFileOpen}
              occupiedSlots={workspaceModel.occupiedSlots}
              mainSnappedPanels={workspaceModel.mainSnappedPanels}
              draggingWindowId={draggingPreviewWindowId}
              activeDropTargetPosition={dropTargetPosition}
              isExternalPanelDragActive={
                draggingPanel !== null || draggingFilePanel
              }
              onPreviewDragStart={handlePreviewWindowDragStart}
              onPreviewDragMove={handlePreviewWindowDragMove}
              onPreviewDragEnd={handlePreviewWindowDragEnd}
            />
          </div>

          <div
            ref={bottomChromeRef}
            style={bottomChromeStyle}
            onMouseEnter={() => {
              if (!zenModeEnabled) {
                return;
              }
              showZenBottomChrome();
            }}
            onMouseLeave={() => {
              if (!zenModeEnabled) {
                return;
              }
              hideZenBottomChrome();
            }}
          >
            <StatusBar onToggleProblems={openProblemsFromStatusBar} />
          </div>
        </div>

        {!tuiModeActive && !isDispatcherPaused && (
          <CommandDispatcher
            isOpen={dispatcher.isOpen}
            onClose={dispatcher.close}
            onExecute={async (input) => {
              const result = await dispatcher.execute(input);
              if (result) {
                if (!result.success && result.error) {
                  showNotification("error", `[Dispatcher] ${result.error}`);
                } else if (result.output) {
                  showNotification("success", `[Dispatcher] ${result.output}`);
                }
              }
              if (result?.shouldClose) {
                dispatcher.close();
              }
            }}
            onPaletteAction={handlePaletteAction}
            onOpenFile={(path, line) => openFileLocationFromPath(path, line)}
            onTerminalCommand={(command) => {
              void submitTerminalCommand(command);
            }}
            pinnedItems={dispatcher.pinnedItems}
            recentItems={dispatcher.recentItems}
            projectPath={activeProjectPath}
          />
        )}

        <LaravelPlugin
          closeDispatcher={dispatcher.close}
          onSuccess={handlePluginCommandSuccess}
          onError={handlePluginCommandError}
        />

        <SettingsModal isOpen={isSettingsOpen} onClose={closeSettings} />
        <DependencyPolicyModal
          isOpen={isDependencyPolicyOpen}
          onClose={closeDependencyPolicy}
          onNotify={showNotification}
        />
        <ExecutionDialog
          isOpen={executionDialogMode !== null}
          mode={executionDialogMode}
          profiles={[
            ...executionProfiles.runProfiles,
            ...executionProfiles.debugProfiles,
          ]}
          activeFileName={activeEditorTab?.name}
          onClose={closeExecutionDialog}
          onExecuteProfile={async (profile) => {
            const executed = await executeExecutionProfile(profile);
            if (executed) {
              closeExecutionDialog();
            }
          }}
          onExecuteCustomCommand={(command, mode) => {
            void executeCustomCommand(command, mode);
          }}
        />

        <ProjectEntryDialogs {...projectEntryDialogProps} />

        <ProjectPathCopyConfirmation
          visible={projectPathCopiedVisible}
          projectPath={activeProjectPath}
        />
        <ShellContextMenuFallback />
      </div>
    </ProjectEntryActionsProvider>
  );
};
