import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useReducedMotion } from "framer-motion";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { MainLayoutPanelRenderer } from "./MainLayoutPanelRenderer";
import { MainPanelWorkspace } from "./MainPanelWorkspace";
import {
  NotificationToast,
  type MainLayoutNotification,
} from "./NotificationToast";
import { PanelDropZone } from "./PanelDropZone";
import { ProjectEntryDialogs } from "./ProjectEntryDialogs";
import { ProjectPathCopyConfirmation } from "./ProjectPathCopyConfirmation";
import { PreviewWindowPanelRenderer } from "./PreviewWindowPanelRenderer";
import { TUITerminalWorkspaceContent } from "./TUITerminalWorkspaceContent";
import { useIndexingPhase } from "../../hooks/useIndexingProgress";
import { useTheme } from "../../hooks/useTheme";
import { useBrowserPreviewBridge } from "../../hooks/useBrowserPreviewBridge";
import { usePreviewableContext } from "../../hooks/usePreviewableContext";
import { PreviewWindowLayer } from "./PreviewWindowLayer";
import { ExecutionDialog } from "../ExecutionDialog";
import { DependencyPolicyModal } from "../DependencyPolicyModal";
import { LaravelPlugin } from "../../plugins/LaravelPlugin";
import { SettingsModal } from "../SettingsModal";
import { CommandDispatcher } from "../CommandDispatcher";
import { useDispatcher } from "../../hooks/useDispatcher";
import { ProjectEntryActionsProvider } from "../../contexts/ProjectEntryActionsContext";
import { useEditorStore } from "../../stores/editorStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useExplorerStore } from "../../stores/explorerStore";
import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import {
  FLOATING_PANEL_LAYOUT_TRANSITION,
  FLOATING_PANEL_LAYOUT_TRANSITION_MS,
  type PanelPosition,
  type PanelSize,
} from "../ui/FloatingPanel";

import { zIndex } from "../../styles/colors";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePluginModal } from "../../contexts/PluginModalContext";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";
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
import type { ShortcutActionId } from "../../utils/keyboard";
import { SNAPPED_PANEL_OUTER_GAP } from "../../utils/layoutHelpers";
import {
  getLogicalViewportSize,
  screenToLogicalPixels,
} from "../../utils/logicalViewport";
import {
  getProjectPathBasename,
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
import { GetLanguageForFile, ReadFile, WriteTerminal } from "../../wails/app";
import { EventsOn } from "../../wails/runtime";
import {
  type ExecutionProfile,
  type ExecutionProfileSet,
  resolveExecutionProfiles,
} from "../../utils/executionProfiles";
import type {
  AssistPanelId,
  CodePanelTab,
  HeldPanelShortcut,
  HydratedPanelLayoutState,
  MainEditorFileOpenHandler,
  MainEditorFileOpenRegistrar,
  MainLayoutProps,
  PanelConfig,
  PanelConfigs,
  PanelFullscreenSnapshot,
  PanelId,
  PanelOpenRequest,
  PanelVisibility,
  ProjectEntryDeletedEvent,
  ProjectEntryRenamedEvent,
  RememberedSnappedPositions,
} from "./MainLayout.types";
import {
  buildPanelConfigForOpen,
  clonePanelConfigsValue,
  cloneRememberedSnappedPositionsValue,
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
  onPerspectiveOpen: externalPerspectiveOpen,
  onPerspectiveClose: externalPerspectiveClose,
}) => {
  const { isDark, theme: currentTheme, setTheme, resolvedThemeId } = useTheme();
  const indexingPhase = useIndexingPhase();
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const prefersReducedMotion = useReducedMotion();
  const reducePanelMotion =
    prefersReducedMotion ||
    indexingPhase === "indexing" ||
    diagnosticsPreload.active;
  const panelLayoutTransition = reducePanelMotion
    ? { duration: 0 }
    : FLOATING_PANEL_LAYOUT_TRANSITION;
  const [isPerspectiveOpen, setIsPerspectiveOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDependencyPolicyOpen, setIsDependencyPolicyOpen] = useState(false);
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
  const activeEditorTab = useEditorStore((state) =>
    state.getActiveTab(state.activePaneId),
  );
  const activeStatusFilePath = useEditorStore((state) => state.statusFile.path);
  const activePaneId = useEditorStore((state) => state.activePaneId);
  const openEditorTab = useEditorStore((state) => state.openTab);
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
  } = useTerminalStore();
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
  const browserPreviewWindows = useMemo(
    () =>
      previewWindows.filter((windowState) => windowState.surface === "browser"),
    [previewWindows],
  );
  const layeredPreviewWindows = useMemo(
    () =>
      previewWindows.filter((windowState) => windowState.surface !== "browser"),
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
  const openCanonicalBrowserPreviewRef = React.useRef<() => void>(() => {});
  const toggleCanonicalBrowserPreviewRef = React.useRef<() => void>(() => {});
  const executionProfilesRequestRef = React.useRef(0);
  const codePanelOpenRequestRef = React.useRef(0);
  const openFileFromPathRequestRef = React.useRef(0);
  const editorFileOpenHandlerRef =
    React.useRef<MainEditorFileOpenHandler | null>(null);

  const registerEditorFileOpenHandler: MainEditorFileOpenRegistrar =
    useCallback((handler) => {
      editorFileOpenHandlerRef.current = handler;
    }, []);

  const openFileInMainEditor = useCallback(
    (path: string, content: string, name: string, line?: number) => {
      const directHandler = editorFileOpenHandlerRef.current;
      if (directHandler) {
        directHandler(path, content, name, line);
        return;
      }

      onFileOpen?.(path, content, name, line);
    },
    [onFileOpen],
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
    }),
    [],
  );

  const applyPanelsState = useCallback(
    (nextPanels: PanelVisibility) => {
      const previousPanels = panelsRef.current;
      const currentActivePanelId = activePanelIdRef.current;
      const newlyVisiblePanelId = (Object.keys(nextPanels) as PanelId[]).find(
        (panelId) => nextPanels[panelId] && !previousPanels[panelId],
      );

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
    [markActivePanel],
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
    try {
      if (tuiModeActive || !panelStorageKey) return;
      localStorage.setItem(
        panelStorageKey,
        JSON.stringify({
          panels,
          panelConfigs,
          rememberedSnappedPositions,
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
        };
      });

      setTUIAssist({ active: false, panel: null, anchor: "right" });
    } else {
      const shouldHideTerminalPanel = forceHideTerminalAfterTUIExitRef.current;
      setTUIAssist({ active: false, panel: null, anchor: "right" });

      if (tuiLayoutSnapshot) {
        const normalizedSnapshot = normalizeHydratedPanelLayoutState(
          shouldHideTerminalPanel
            ? { ...tuiLayoutSnapshot.panels, terminal: false }
            : tuiLayoutSnapshot.panels,
          tuiLayoutSnapshot.panelConfigs,
          tuiLayoutSnapshot.rememberedSnappedPositions,
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
  const gitPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const problemsPreFullscreenRef = React.useRef<PanelFullscreenSnapshot | null>(
    null,
  );
  const panelWorkspaceRef = React.useRef<HTMLDivElement | null>(null);
  const [panelWorkspaceSize, setPanelWorkspaceSize] =
    React.useState(logicalViewport);
  const previousPanelWorkspaceSizeRef = React.useRef(panelWorkspaceSize);

  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);
  const [draggingPreviewWindowId, setDraggingPreviewWindowId] = useState<
    string | null
  >(null);
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
  const [panelExitPositions, setPanelExitPositions] = useState<PanelPosition[]>(
    [],
  );
  const [panelPresenceBypassPositions, setPanelPresenceBypassPositions] =
    useState<PanelPosition[]>([]);
  const panelPresenceBypassPositionsRef = useRef<PanelPosition[]>([]);
  const [floatingPresenceVersion, setFloatingPresenceVersion] = useState(0);
  const panelExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPanelCloseFrameIdsRef = useRef<number[]>([]);

  const [notification, setNotification] =
    useState<MainLayoutNotification | null>(null);

  useEffect(() => {
    return () => {
      if (panelDropSettlingTimerRef.current) {
        clearTimeout(panelDropSettlingTimerRef.current);
      }
      if (panelExitTimerRef.current) {
        clearTimeout(panelExitTimerRef.current);
      }
      if (typeof window !== "undefined") {
        pendingPanelCloseFrameIdsRef.current.forEach((frameId) =>
          window.cancelAnimationFrame(frameId),
        );
      }
      pendingPanelCloseFrameIdsRef.current = [];
      setRelocatingPanelIds([]);
      setRelocatingPreviewWindowIds([]);
      setPanelDropSettlingPositions([]);
      setPanelExitPositions([]);
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

  useSurfaceRuntimeHostSync({
    panels,
    panelConfigs,
    previewWindows,
    activePreviewWindowId: activePanelId ? null : activePreviewWindowId,
    activePanelId,
    fullscreenSurfaceIds,
  });

  const restoreOrEnterPanelFullscreen = useCallback(
    (
      panelId: "terminal" | "git" | "problems",
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

        setPanelConfigs((prev) => ({
          ...prev,
          [panelId]: {
            ...prev[panelId],
            mode: saved?.mode ?? "snapped",
            position: saved ? prev[panelId].position : fallbackPosition,
            x: saved?.x ?? 0,
            y: saved?.y ?? 0,
            size: saved?.size ?? fallbackSize,
          },
        }));
        return;
      }

      snapshotRef.current = {
        mode: currentConfig.mode,
        x: currentConfig.x,
        y: currentConfig.y,
        size: { ...currentConfig.size },
      };
      setPanelConfigs((prev) => ({
        ...prev,
        [panelId]: {
          ...prev[panelId],
          mode: "floating",
          x: 0,
          y: 0,
          size: {
            width: panelWorkspaceSize.width,
            height: panelWorkspaceSize.height,
          },
        },
      }));
    },
    [
      isLogicalFullscreenPanel,
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
    ],
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
      restoreOrEnterPanelFullscreen(
        panelId as "terminal" | "git" | "problems",
        snapshotRef,
      );
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
      return;
    }

    toggleNamedPanel(panelId);
  }

  function closePanelFullscreenFromShortcut(
    panelId: "terminal" | "git" | "problems",
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

    applyPanelConfigsState({
      ...panelConfigsRef.current,
      [panelId]: {
        ...currentConfig,
        mode: saved?.mode ?? "snapped",
        position: saved ? currentConfig.position : fallbackPosition,
        x: saved?.x ?? 0,
        y: saved?.y ?? 0,
        size: saved?.size ?? fallbackSize,
      },
    });
    applyPanelsState({ ...panelsRef.current, [panelId]: false });
    return true;
  }

  function closeActiveFullscreenPanelFromShortcut(): boolean {
    if (closePanelFullscreenFromShortcut("git", gitPreFullscreenRef)) {
      return true;
    }

    if (
      closePanelFullscreenFromShortcut("problems", problemsPreFullscreenRef)
    ) {
      return true;
    }

    if (
      !useTerminalStore.getState().tuiModeActive &&
      closePanelFullscreenFromShortcut("terminal", terminalPreFullscreenRef)
    ) {
      return true;
    }

    return false;
  }

  function togglePanelFullscreenFromShortcut(
    panelId: "git" | "problems",
    snapshotRef: React.MutableRefObject<PanelFullscreenSnapshot | null>,
  ) {
    if (closePanelFullscreenFromShortcut(panelId, snapshotRef)) {
      return;
    }

    const currentConfig = panelConfigsRef.current[panelId];
    if (panelsRef.current[panelId] && isLogicalFullscreenPanel(currentConfig)) {
      restoreOrEnterPanelFullscreen(panelId, snapshotRef);
      return;
    }

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
  const activeCodePanelTab = useMemo(
    () =>
      codePanelTabs.find((tab) => tab.path === activeCodePanelPath) ??
      codePanelTabs[0] ??
      null,
    [activeCodePanelPath, codePanelTabs],
  );
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
      return true;
    },
    [activeCodePanelTab?.path, codePanelTabs],
  );
  const showNotification = useCallback(
    (type: "success" | "error", message: string) => {
      setNotification({ type, message });
      const timeout = type === "error" ? 6000 : 3000;
      setTimeout(() => setNotification(null), timeout);
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
    remapProjectEntryDialogs,
  } = useMainLayoutProjectEntries({
    activeProjectPath,
    tuiModeActive,
    canAccessPath,
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
    const primaryProfile = executionProfiles.runProfiles.find(
      (profile) => !hasMissingTools(profile),
    );
    if (primaryProfile) {
      void executeExecutionProfile(primaryProfile);
      return;
    }

    setExecutionDialogMode("run");
  }, [executeExecutionProfile, executionProfiles.runProfiles]);

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

  const resolveAssistPanelId = useCallback(
    (panel: string): AssistPanelId | null => {
      switch (panel) {
        case "explorer":
        case "sidebar":
          return "explorer";
        case "ai":
        case "aichat":
        case "chat":
        case "aiChat":
          return "aiChat";
        case "git":
          return "git";
        default:
          return null;
      }
    },
    [],
  );

  const resolveDefaultTUIAssistPanel = useCallback((): AssistPanelId => {
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
    (panelId: AssistPanelId, request?: Partial<PanelOpenRequest> | null) => {
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
      setTimeout(() => state.focusActiveTerminal(), 80);
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
      const state = useTerminalStore.getState();
      if (!state.tuiModeActive) {
        return;
      }

      const assistPanel = request?.panel
        ? resolveAssistPanelId(request.panel)
        : resolveDefaultTUIAssistPanel();
      if (!assistPanel) {
        return;
      }

      openTUIFloatingPanel(assistPanel, request);
    },
    [openTUIFloatingPanel, resolveAssistPanelId, resolveDefaultTUIAssistPanel],
  );

  const toggleTUIAssistPanel = useCallback(
    (panel: AssistPanelId) => {
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
        pendingPanelCloseFrameIdsRef.current =
          pendingPanelCloseFrameIdsRef.current.filter(
            (currentFrameId) => currentFrameId !== frameId,
          );
        closePanel();
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
    [updatePanelPresenceBypassPositionsState],
  );

  const startSnappedSlotExit = useCallback(
    (position: PanelPosition) => {
      if (reducePanelMotion) {
        return;
      }

      if (panelExitTimerRef.current) {
        clearTimeout(panelExitTimerRef.current);
      }

      setPanelExitPositions((currentPositions) =>
        uniquePanelPositions([...currentPositions, position]),
      );
      panelExitTimerRef.current = setTimeout(() => {
        panelExitTimerRef.current = null;
        setPanelExitPositions([]);
      }, FLOATING_PANEL_LAYOUT_TRANSITION_MS + 700);
    },
    [reducePanelMotion],
  );

  const finishSnappedSlotExit = useCallback((position: PanelPosition) => {
    setPanelExitPositions((currentPositions) =>
      currentPositions.filter(
        (currentPosition) => currentPosition !== position,
      ),
    );
  }, []);

  const startPanelExitMotion = useCallback(
    (panelId: PanelId) => {
      if (!panelsRef.current[panelId]) {
        return;
      }

      const currentConfig = panelConfigsRef.current[panelId];
      if (currentConfig.mode !== "snapped") {
        return;
      }

      if (panelId === "terminal" && useTerminalStore.getState().tuiModeActive) {
        return;
      }

      startSnappedSlotExit(currentConfig.position);
    },
    [startSnappedSlotExit],
  );

  const startPreviewWindowExitMotion = useCallback(
    (windowState: PreviewWindow | undefined) => {
      if (!windowState || windowState.mode !== "snapped") {
        return;
      }

      startSnappedSlotExit(windowState.position);
    },
    [startSnappedSlotExit],
  );

  const closePanelWithMotion = useCallback(
    (panelId: PanelId) => {
      const currentConfig = panelConfigsRef.current[panelId];
      const restoredSlotPresence =
        panelsRef.current[panelId] &&
        currentConfig.mode === "snapped" &&
        !(
          panelId === "terminal" && useTerminalStore.getState().tuiModeActive
        ) &&
        restoreSnappedSlotPresence(currentConfig.position);
      const closePanel = () => {
        updatePanelsState((previous) =>
          previous[panelId] ? { ...previous, [panelId]: false } : previous,
        );
      };

      startPanelExitMotion(panelId);
      if (restoredSlotPresence && !reducePanelMotion) {
        schedulePanelCloseAfterPresenceRestore(closePanel);
        return;
      }

      closePanel();
    },
    [
      reducePanelMotion,
      restoreSnappedSlotPresence,
      schedulePanelCloseAfterPresenceRestore,
      startPanelExitMotion,
      updatePanelsState,
    ],
  );

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

  const findVisibleSnappedPanelAtPosition = (
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
  };

  const findSnappedPreviewWindowAtPosition = (
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
  };

  const isSnappedPositionOccupied = (
    position: PanelPosition,
    options: {
      exclude?: PanelId[];
      excludeWindowIds?: string[];
    } = {},
  ): boolean =>
    Boolean(findVisibleSnappedPanelAtPosition(position, options)) ||
    Boolean(findSnappedPreviewWindowAtPosition(position, options));

  const findAvailablePanelPosition = (
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
  };

  const snapPreviewWindowToPosition = (
    windowState: PreviewWindow,
    position: PanelPosition,
  ): boolean => {
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
  };

  const movePreviewWindowToPosition = (
    windowId: string,
    targetPosition: PanelPosition,
  ): boolean => {
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

      if (!fallbackPosition) {
        return false;
      }
      settlingPositions.push(fallbackPosition);

      const targetConfig = panelConfigsRef.current[targetPanel];
      const nextPanelConfigs = clonePanelConfigs(panelConfigsRef.current);
      const nextRememberedSnappedPositions = cloneRememberedSnappedPositions(
        rememberedSnappedPositionsRef.current,
      );
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

      if (!fallbackPosition) {
        return false;
      }
      settlingPositions.push(fallbackPosition);

      if (!snapPreviewWindowToPosition(targetPreviewWindow, fallbackPosition)) {
        return false;
      }
    }

    startPanelDropSettling({
      panels: relocatingPanels,
      previewWindows: relocatingPreviewWindows,
      positions: uniquePanelPositions(settlingPositions),
    });
    return snapPreviewWindowToPosition(previewWindow, targetPosition);
  };

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
    (request: SurfacePromotionRequest): SurfacePromotionResult => {
      const panelId = request.panelId ? resolvePanelId(request.panelId) : null;
      if (!panelId || !panelsRef.current[panelId]) {
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason: "Panel surface is not open.",
        });
      }

      if (request.kind === "detach") {
        const detachCommand = getSurfaceRuntimeReadModel({
          includeEvents: false,
        }).promotion.commandsBySurfaceId[request.surfaceId]?.find(
          (command) => command.kind === "detach",
        );
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason:
            detachCommand?.reason ??
            "Detached Wails window creation is disabled in this build.",
        });
      }

      const currentConfig = panelConfigsRef.current[panelId];
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
      markActivePanel,
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
      panelConfigsRef,
      panelsRef,
      rememberedSnappedPositionsRef,
      resolvePromotionSnapPosition,
    ],
  );

  const applyPreviewPromotion = useCallback(
    (request: SurfacePromotionRequest): SurfacePromotionResult => {
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
        return buildSurfacePromotionResult(request, {
          handled: false,
          reason:
            detachCommand?.reason ??
            "Detached Wails window creation is disabled in this build.",
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
      panelWorkspaceSize.height,
      panelWorkspaceSize.width,
      resolvePromotionSnapPosition,
      updatePreviewWindow,
    ],
  );

  const handleSurfacePromoteEvent = useCallback(
    (payload: unknown): SurfacePromotionResult => {
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
        return;
      }

      let language = request?.language ?? fallbackLanguage;
      let content = typeof request?.content === "string" ? request.content : "";

      if (typeof request?.content !== "string") {
        try {
          content = await ReadFile(path);
          if (codePanelOpenRequestRef.current !== requestId) {
            return;
          }
        } catch (error) {
          if (codePanelOpenRequestRef.current === requestId) {
            showNotification(
              "error",
              `[Files] ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return;
        }
      }

      if (!request?.language) {
        try {
          const languageInfo = await GetLanguageForFile(path);
          if (codePanelOpenRequestRef.current !== requestId) {
            return;
          }
          if (languageInfo?.id) {
            language = languageInfo.id;
          }
        } catch {
          if (codePanelOpenRequestRef.current !== requestId) {
            return;
          }
          language = fallbackLanguage;
        }
      }

      const nextTab: CodePanelTab = {
        path,
        name,
        content,
        language,
        line,
      };
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

      openEditorTab(activePaneId, path, name, content, language);

      const nextConfig = buildPanelConfigForOpen(
        "code",
        {
          panel: "code",
          mode: request?.mode ?? "snapped",
          position: request?.position ?? "right",
          width: request?.width ?? 560,
          height: request?.height,
          x: request?.x,
          y: request?.y,
        },
        panelConfigsRef.current.code,
      );
      const nextPanelConfigs = {
        ...panelConfigsRef.current,
        code: nextConfig,
      };
      const nextRememberedSnappedPositions = {
        ...rememberedSnappedPositionsRef.current,
        code: nextConfig.position,
      };
      const nextPanels = { ...panelsRef.current };

      (Object.keys(panelConfigsRef.current) as PanelId[]).forEach((id) => {
        if (id === "code" || !nextPanels[id]) {
          return;
        }

        const otherConfig = panelConfigsRef.current[id];
        if (
          otherConfig.mode === "snapped" &&
          otherConfig.position === nextConfig.position
        ) {
          nextPanels[id] = false;
        }
      });

      nextPanels.code = true;
      applyPanelsState(nextPanels);
      applyPanelConfigsState(nextPanelConfigs);
      applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
    },
    [
      activePaneId,
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      ensureProjectEntryAccess,
      openEditorTab,
      showNotification,
    ],
  );

  const handleFileOpen = useCallback(
    (path: string, content: string, name: string, line?: number) => {
      if (tuiModeActive) {
        const accessDecision = canAccessPath(path, "read");
        if (!accessDecision.allowed) {
          showNotification("error", `[Security] ${accessDecision.reason}`);
          return;
        }

        void handleFileOpenInPanel(path, name, line, { content });
        return;
      }

      openFileInMainEditor(path, content, name, line);
    },
    [
      canAccessPath,
      handleFileOpenInPanel,
      openFileInMainEditor,
      showNotification,
      tuiModeActive,
    ],
  );

  const openFileFromPath = useCallback(
    async (path: string, line?: number) => {
      const requestId = openFileFromPathRequestRef.current + 1;
      openFileFromPathRequestRef.current = requestId;

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
          await handleFileOpenInPanel(path, name, line);
          return;
        }

        const content = await ReadFile(path);
        if (openFileFromPathRequestRef.current !== requestId) {
          return;
        }
        const name = path.split("/").pop() || path;
        openFileInMainEditor(path, content, name, line);
      } catch (error) {
        if (openFileFromPathRequestRef.current === requestId) {
          console.error("[MainLayout] Failed to open file:", error);
        }
      }
    },
    [
      canAccessPath,
      handleFileOpenInPanel,
      openFileInMainEditor,
      showNotification,
      tuiModeActive,
    ],
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
        closeEditorTabPaths(deletedPath);
        prunePathDiagnostics(deletedPath);

        setCodePanelTabs((currentTabs) =>
          currentTabs.filter(
            (tab) => !isSameOrChildPath(tab.path, deletedPath),
          ),
        );
        setActiveCodePanelPath((currentPath) =>
          currentPath && isSameOrChildPath(currentPath, deletedPath)
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
    remapExplorerPathPrefix,
    remapProjectEntryDialogs,
    renameEditorTabPaths,
    renamePathDiagnostics,
  ]);

  const handlePerspectiveOpen = useCallback(() => {
    setIsPerspectiveOpen(true);
    if (externalPerspectiveOpen) {
      externalPerspectiveOpen();
    }
  }, [externalPerspectiveOpen]);

  const handlePerspectiveClose = useCallback(() => {
    setIsPerspectiveOpen(false);
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
      setTUIAssistRatio,
      shouldSuppressApplicationMenuAction,
      submitTerminalCommand,
      toggleCanonicalBrowserPreviewRef,
      togglePanelCompactFromShortcut,
      togglePanelFullscreenFromShortcut,
    });

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
    gitPreFullscreenRef,
    handleHeldPanelShortcutMove,
    terminalThemeId: resolvedThemeId,
    isPerspectiveOpen,
    isSettingsOpen,
    markShortcutActionHandled,
    onSwitchProject,
    openSettings,
    panelsRef,
    pressedShortcutCodesRef,
    problemsPreFullscreenRef,
    shortcutActionSuppressionRef,
    toggleCanonicalBrowserPreviewRef,
    toggleCommandDispatcher,
    toggleNamedPanel,
    togglePanelCompactFromShortcut,
    togglePanelFullscreenFromShortcut,
  });

  const togglePanel = (panel: keyof PanelVisibility) => {
    if (panelsRef.current[panel]) {
      closePanelWithMotion(panel);
      return;
    }

    updatePanelsState((previous) => ({
      ...previous,
      [panel]: true,
    }));
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

  const workspaceModel = useMainPanelWorkspaceModel({
    panels,
    panelConfigs,
    previewWindows,
    browserPreviewWindows,
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
    backgroundColor: "var(--bg-blackprint)",
  };

  const renderDropZone = (position: PanelPosition) => {
    const isPanelDragActive =
      draggingPanel !== null || draggingPreviewWindowId !== null;
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

  const handleTerminalPanelFullscreen = () => {
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
  };

  const renderPanel = (
    panelId: PanelId,
    hostMode: "overlay" | "flow" = "overlay",
  ) => (
    <MainLayoutPanelRenderer
      key={panelId}
      panelId={panelId}
      hostMode={hostMode}
      panels={panels}
      panelConfigs={panelConfigs}
      previewWindows={previewWindows}
      dropTargetPosition={dropTargetPosition}
      draggingPanel={draggingPanel}
      draggingPreviewWindowId={draggingPreviewWindowId}
      relocatingPanelIds={relocatingPanelIds}
      uiScale={uiScale}
      activeProjectPath={activeProjectPath}
      activeStatusFilePath={activeStatusFilePath}
      activeEditorTabPath={activeEditorTab?.path ?? null}
      activeCodePanelTab={activeCodePanelTab}
      codePanelTabs={codePanelTabs}
      tuiModeActive={tuiModeActive}
      tuiTerminalPaneStyle={tuiTerminalPaneStyle}
      terminalZIndex={tuiModeActive ? zIndex.tooltip + 10 : undefined}
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
      onTogglePanel={toggleNamedPanel}
      onCloseTerminalPanel={closeTerminalPanel}
      onTerminalFullscreen={handleTerminalPanelFullscreen}
      onGitFullscreen={() =>
        restoreOrEnterPanelFullscreen("git", gitPreFullscreenRef)
      }
      onProblemsFullscreen={() =>
        restoreOrEnterPanelFullscreen("problems", problemsPreFullscreenRef)
      }
      onFileOpen={handleFileOpen}
      onFileOpenInPanel={handleFileOpenInPanel}
      onOpenFileFromPath={openFileFromPath}
      onOpenPreviewFromTerminal={openPreviewFromTerminal}
      onPerspectiveOpen={handlePerspectiveOpen}
      onPerspectiveClose={handlePerspectiveClose}
      onGitDiffFocusChange={handleGitDiffFocusChange}
      onCodePanelActivate={setActiveCodePanelPath}
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
      if (!panels[id]) {
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
          draggingPreviewWindowId !== windowState.id));

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

  const topChromeStyle: React.CSSProperties = {
    maxHeight: 72,
    opacity: 1,
    overflow: "visible",
    pointerEvents: "auto",
    position: "relative",
    transform: "translateY(2px)",
    zIndex: zIndex.tooltip + 2,
  };

  const bottomChromeStyle: React.CSSProperties = {
    maxHeight: 40,
    opacity: 1,
    overflow: "hidden",
    pointerEvents: "auto",
  };

  const normalWorkspaceStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "row",
    minHeight: 0,
    minWidth: 0,
    opacity: 1,
    pointerEvents: "auto",
    isolation:
      panelDropSettling || panelExitPositions.length > 0
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
    zIndex: panelDropSettling ? 0 : undefined,
  };

  const getVerticalSlotStyle = (
    position: PanelPosition,
    width: number,
    isActive: boolean,
    isResizingSlot: boolean,
  ): React.CSSProperties => {
    const isSettlingSlot = panelDropSettlingPositions.includes(position);
    const isExitingSlot = panelExitPositions.includes(position);
    const shouldExposeSlotOverflow = isSettlingSlot || isExitingSlot;
    const slotTransitionSuspended =
      draggingPanel !== null ||
      draggingPreviewWindowId !== null ||
      isResizingSlot;
    const transition =
      reducePanelMotion || slotTransitionSuspended
        ? "none"
        : `width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), min-width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), max-width ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;

    return {
      width,
      minWidth: width,
      maxWidth: width,
      height: "100%",
      minHeight: 0,
      flexShrink: 0,
      position: "relative",
      overflow: shouldExposeSlotOverflow ? "visible" : "hidden",
      zIndex:
        shouldExposeSlotOverflow && (isActive || isExitingSlot)
          ? 120
          : undefined,
      pointerEvents: isActive ? "auto" : "none",
      transition,
      willChange: shouldExposeSlotOverflow ? "transform, opacity" : "auto",
    };
  };

  const getHorizontalSlotStyle = (
    position: PanelPosition,
    height: number,
    isActive: boolean,
    isResizingSlot: boolean,
  ): React.CSSProperties => {
    const isSettlingSlot = panelDropSettlingPositions.includes(position);
    const isExitingSlot = panelExitPositions.includes(position);
    const shouldExposeSlotOverflow = isSettlingSlot || isExitingSlot;
    const slotTransitionSuspended =
      draggingPanel !== null ||
      draggingPreviewWindowId !== null ||
      isResizingSlot;
    const transition =
      reducePanelMotion || slotTransitionSuspended
        ? "none"
        : `height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), min-height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), max-height ${FLOATING_PANEL_LAYOUT_TRANSITION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;

    return {
      height,
      minHeight: height,
      maxHeight: height,
      width: "100%",
      minWidth: 0,
      flexShrink: 0,
      position: "relative",
      overflow: shouldExposeSlotOverflow ? "visible" : "hidden",
      zIndex:
        shouldExposeSlotOverflow && (isActive || isExitingSlot)
          ? 120
          : undefined,
      pointerEvents: isActive ? "auto" : "none",
      transition,
      willChange: shouldExposeSlotOverflow ? "transform, opacity" : "auto",
    };
  };

  const tuiTerminalPaneStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--bg-blackprint)",
  };

  // Framer layout scales slot descendants here, which makes panels expand
  // instead of sliding. Slot size uses explicit CSS transitions instead.
  const workspaceLayoutMotionEnabled = false;
  const workspaceEditorContent = tuiModeActive ? (
    <TUITerminalWorkspaceContent
      paneStyle={tuiTerminalPaneStyle}
      onOpenFileRef={(path, line) => {
        void openFileFromPath(path, line);
      }}
      onOpenPreviewUrl={(url, sessionId) => {
        openPreviewFromTerminal({
          url,
          sessionId,
          forceOpen: true,
        });
      }}
    />
  ) : (
    React.cloneElement(
      children as React.ReactElement<{
        onToggleProblems?: () => void;
        onPerspectiveOpen?: () => void;
        onPerspectiveClose?: () => void;
        onEditorFileOpenReady?: MainEditorFileOpenRegistrar;
      }>,
      {
        onToggleProblems: () => togglePanel("problems"),
        onPerspectiveOpen: handlePerspectiveOpen,
        onPerspectiveClose: handlePerspectiveClose,
        onEditorFileOpenReady: registerEditorFileOpenHandler,
      },
    )
  );

  return (
    <ProjectEntryActionsProvider value={projectEntryActions}>
      <div
        style={containerStyle}
        data-testid="main-layout"
        data-tui-session-id={tuiActiveSessionId || ""}
      >
        <div style={shellFrameStyle}>
          <div style={topChromeStyle}>
            <TopBar
              onOpenSearch={openCommandDispatcher}
              onOpenSettings={openSettings}
              onToggleExplorer={() => {
                if (tuiModeActive) {
                  toggleNamedPanel("explorer");
                  return;
                }
                toggleNamedPanel("explorer");
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
                toggleNamedPanel("terminal");
              }}
              onToggleAIChat={() => {
                if (tuiModeActive) {
                  toggleNamedPanel("aiChat");
                  return;
                }
                toggleNamedPanel("aiChat");
              }}
              onToggleGit={() => {
                if (tuiModeActive) {
                  toggleNamedPanel("git");
                  return;
                }
                toggleNamedPanel("git");
              }}
              onRun={openRunDialog}
              onOpenDebug={openDebugDialog}
              onOpenPreview={openCanonicalBrowserPreview}
              onOpenDependencyPolicy={openDependencyPolicy}
              onBackToWelcome={onBackToWelcome}
              onProjectOpen={onProjectOpen}
              onSwitchProject={onSwitchProject}
              onCloseProject={onCloseProject}
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
              editorAreaTestId={
                tuiModeActive ? "tui-center-terminal" : "editor-area"
              }
              editorContent={workspaceEditorContent}
              panelDropSettling={panelDropSettling}
              draggingPanel={draggingPanel}
              draggingPreviewWindowId={draggingPreviewWindowId}
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
              isExternalPanelDragActive={draggingPanel !== null}
              onPreviewDragStart={handlePreviewWindowDragStart}
              onPreviewDragMove={handlePreviewWindowDragMove}
              onPreviewDragEnd={handlePreviewWindowDragEnd}
            />
          </div>

          <div style={bottomChromeStyle}>
            <StatusBar onToggleProblems={() => togglePanel("problems")} />
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
            onOpenFile={(path, line) => openFileFromPath(path, line)}
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

        <NotificationToast
          notification={notification}
          onClose={() => setNotification(null)}
        />
      </div>
    </ProjectEntryActionsProvider>
  );
};
