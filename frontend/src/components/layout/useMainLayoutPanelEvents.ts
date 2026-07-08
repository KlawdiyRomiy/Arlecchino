import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { useIDEEvents } from "../../hooks/useIDEEvents";
import {
  registerOpenIntentDispatcher,
  type FocusSurfaceIntent,
  type OpenIntentPolicy,
} from "../../shell/openIntentRouter";
import {
  getSurfaceRuntimeReadModel,
  type SurfaceRuntimeReadOptions,
} from "../../surfaces/surfaceRuntimeStore";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { usePerformanceStore } from "../../stores/performanceStore";
import { useTerminalStore } from "../../stores/terminalStore";
import {
  APPLICATION_MENU_ACTION_EVENT,
  type ApplicationMenuActionDetail,
} from "../../utils/applicationMenu";
import {
  dispatchAIChatFullscreenCommand,
  type AIChatFullscreenCommand,
} from "../../utils/aiChatFullscreenCommands";
import type { ShortcutActionId } from "../../utils/keyboard";
import { measurePerf } from "../../utils/perf";
import { getProjectPathBasename } from "../../utils/projectPaths";
import {
  EDITOR_FIND_IN_FILE_EVENT,
  TERMINAL_FIND_EVENT,
} from "../../utils/searchEvents";
import { isTerminalShortcutContext } from "../../utils/terminalFocus";
import {
  flipTUIAssistAnchor,
  getTUIFloatingTerminalConfig,
  normalizeTUIAssistAnchor,
} from "../../utils/terminalLayout";
import { toggleWindowFullscreen } from "../../utils/windowFullscreen";
import { type PanelPosition } from "../ui/FloatingPanel";
import {
  FLOATING_PANEL_OPEN_MOTION_BUFFER_MS,
  getFloatingPanelMotionDurationMs,
} from "../ui/floatingPanelMotion";
import type {
  AppSurfaceAction,
  PanelConfigs,
  PanelFullscreenSnapshot,
  PanelId,
  PanelOpenRequest,
  PanelStateApplyOptions,
  PanelVisibility,
  RememberedSnappedPositions,
} from "./MainLayout.types";
import {
  computeNextPanelOpenState,
  resolveAppSurfaceAction,
  resolvePanelId,
} from "./panelLayoutModel";
import {
  parseEditorOpenRequest,
  parseEditorSplitDirection,
  parsePanelOpenRequest,
  parsePanelSideMoveRequest,
} from "./mainLayoutEventParsers";

type UnknownEventHandler = (payload: unknown) => unknown | Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseSurfaceRuntimeReadOptions = (
  payload: unknown,
): SurfaceRuntimeReadOptions => {
  if (!isRecord(payload)) {
    return {};
  }

  const eventLimit =
    typeof payload.eventLimit === "number" &&
    Number.isFinite(payload.eventLimit)
      ? payload.eventLimit
      : typeof payload.event_limit === "number" &&
          Number.isFinite(payload.event_limit)
        ? payload.event_limit
        : undefined;
  const includeEvents =
    typeof payload.includeEvents === "boolean"
      ? payload.includeEvents
      : typeof payload.include_events === "boolean"
        ? payload.include_events
        : undefined;

  return {
    eventLimit,
    includeEvents,
  };
};

const AI_CHAT_FULLSCREEN_MENU_ACTIONS: Partial<
  Record<ShortcutActionId, AIChatFullscreenCommand>
> = {
  "ai.history": "history.toggle",
  "editor.find": "sessionSearch.open",
  "git.toggle": "review.toggle",
  "git.fullscreen": "review.expandToggle",
};

interface MainLayoutPanelEventsDispatcher {
  close: () => void;
}

interface UseMainLayoutPanelEventsOptions {
  applyPanelConfigsState: (
    panelConfigs: PanelConfigs,
    options?: PanelStateApplyOptions,
  ) => void;
  applyPanelsState: (
    panels: PanelVisibility,
    options?: PanelStateApplyOptions,
  ) => void;
  applyRememberedSnappedPositionsState: (
    rememberedPositions: RememberedSnappedPositions,
  ) => void;
  closeActiveFullscreenPanelFromShortcut: () => boolean;
  closeAllPreviewWindows: () => void;
  closeExecutionDialog: () => void;
  closePanelWithMotion: (panelId: PanelId) => void;
  closeSettings: () => void;
  closeTUIAssistPanel: () => void;
  copyProjectPathFromShortcut: () => Promise<boolean>;
  dispatcher: MainLayoutPanelEventsDispatcher;
  enterTUIMode: (sessionId: string, source: "ide-event") => void;
  exitTUIMode: (sessionId: string, source: "ide-event") => void;
  ensureActiveTerminalSessionId: (
    terminalName?: string,
  ) => Promise<string | null>;
  getActiveTerminalSessionId: () => string | null;
  forceHideTerminalAfterTUIExitRef: MutableRefObject<boolean>;
  handleAppearancePreviewApplyEvent: () => void;
  handleAppearancePreviewCancelEvent: () => void;
  handleAppearancePreviewPatchEvent: UnknownEventHandler;
  handleAppearancePreviewStartEvent: UnknownEventHandler;
  handleFileOpenInPanel: (
    path: string,
    name: string,
    line?: number,
    request?: Partial<PanelOpenRequest>,
  ) => Promise<unknown> | unknown;
  handlePreviewWindowCheckpointCreateEvent: UnknownEventHandler;
  handlePreviewWindowCheckpointRestoreEvent: UnknownEventHandler;
  handlePreviewWindowCloseEvent: UnknownEventHandler;
  handlePreviewWindowFocusEvent: UnknownEventHandler;
  handlePreviewWindowOpenEvent: UnknownEventHandler;
  handlePreviewWindowUpdateEvent: UnknownEventHandler;
  handleSurfacePromoteEvent: UnknownEventHandler;
  aiPanelEnabled: boolean;
  isAIChatTopmostFullscreen: () => boolean;
  isSettingsOpen: boolean;
  logicalViewport: { width: number; height: number };
  moveBrowserPreviewToPosition: (position: PanelPosition) => boolean | void;
  moveSnappedPanelBetweenSides: (
    from: PanelPosition,
    to: PanelPosition,
  ) => boolean | void;
  prepareSnappedPanelOpen: (
    panelId: PanelId,
    position: PanelPosition,
    sourcePosition: PanelPosition | null,
  ) => boolean;
  openCanonicalBrowserPreviewRef: MutableRefObject<() => boolean>;
  openCommandDispatcher: () => void;
  openDebugDialog: () => void;
  openFileFromPath: (
    path: string,
    line?: number,
    policy?: OpenIntentPolicy,
  ) => Promise<void> | void;
  onProjectOpen?: (projectPath: string) => Promise<void> | void;
  openRunDialog: () => void;
  openSettings: () => void;
  openTUIAssistPanel: UnknownEventHandler;
  panelConfigsRef: MutableRefObject<PanelConfigs>;
  panelsRef: MutableRefObject<PanelVisibility>;
  reopenLastClosedSurface: () => boolean;
  aiChatPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  problemsPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  rememberedSnappedPositionsRef: MutableRefObject<RememberedSnappedPositions>;
  setPanelConfigs: Dispatch<SetStateAction<PanelConfigs>>;
  setActivePanelId: (panelId: PanelId | null) => void;
  startSnappedSlotEnter: (position: PanelPosition, panelId?: PanelId) => void;
  setTUIAssistRatio: (value: unknown) => void;
  shouldSuppressApplicationMenuAction: (actionId: ShortcutActionId) => boolean;
  submitTerminalCommand: (
    command: string,
    terminalName?: string,
  ) => Promise<boolean> | boolean | void;
  toggleCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  togglePanelCompactFromShortcut: (
    panelId: PanelId,
    snapshotRef?: MutableRefObject<PanelFullscreenSnapshot | null>,
  ) => void;
  togglePanelFullscreenFromShortcut: (
    panelId: "terminal" | "git" | "problems" | "aiChat",
    snapshotRef: MutableRefObject<PanelFullscreenSnapshot | null>,
  ) => void;
  gitPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  terminalPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
}

export const useMainLayoutPanelEvents = ({
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
  aiPanelEnabled,
  isAIChatTopmostFullscreen,
  isSettingsOpen,
  logicalViewport,
  moveBrowserPreviewToPosition,
  moveSnappedPanelBetweenSides,
  prepareSnappedPanelOpen,
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
  reopenLastClosedSurface,
  aiChatPreFullscreenRef,
  problemsPreFullscreenRef,
  rememberedSnappedPositionsRef,
  setPanelConfigs,
  setActivePanelId,
  startSnappedSlotEnter,
  setTUIAssistRatio,
  shouldSuppressApplicationMenuAction,
  submitTerminalCommand,
  toggleCanonicalBrowserPreviewRef,
  togglePanelCompactFromShortcut,
  togglePanelFullscreenFromShortcut,
  gitPreFullscreenRef,
  terminalPreFullscreenRef,
}: UseMainLayoutPanelEventsOptions) => {
  const closeTerminalPanel = useCallback(() => {
    const terminalState = useTerminalStore.getState();

    if (!terminalState.tuiModeActive) {
      closePanelWithMotion("terminal");
      return;
    }

    const activePane = terminalState.panes.find(
      (pane) => pane.id === terminalState.activePaneId,
    );
    const activeSessionId =
      terminalState.tuiActiveSessionId ?? activePane?.activeTabId ?? null;

    forceHideTerminalAfterTUIExitRef.current = true;

    if (activePane && activeSessionId) {
      void terminalState.closeTerminal(activePane.id, activeSessionId);
      return;
    }

    if (terminalState.tuiActiveSessionId) {
      terminalState.exitTUIMode(
        terminalState.tuiActiveSessionId,
        "panel-close",
      );
    }
  }, [closePanelWithMotion, forceHideTerminalAfterTUIExitRef]);

  const applyPanelOpenState = useCallback(
    (panelId: PanelId, request: PanelOpenRequest) => {
      const wasVisible = panelsRef.current[panelId];
      const { nextPanels, nextConfig, nextRememberedSnappedPositions } =
        computeNextPanelOpenState(
          panelId,
          request,
          panelsRef.current,
          panelConfigsRef.current,
          rememberedSnappedPositionsRef.current,
        );
      const nextPanelConfigs = {
        ...panelConfigsRef.current,
        [panelId]: nextConfig,
      };
      const sourcePosition =
        panelConfigsRef.current[panelId].mode === "snapped"
          ? panelConfigsRef.current[panelId].position
          : rememberedSnappedPositionsRef.current[panelId];

      if (
        nextPanels[panelId] &&
        nextConfig.mode === "snapped" &&
        !prepareSnappedPanelOpen(panelId, nextConfig.position, sourcePosition)
      ) {
        return panelConfigsRef.current[panelId];
      }

      if (nextPanels[panelId]) {
        usePerformanceStore
          .getState()
          .beginPanelMotionWindow(
            getFloatingPanelMotionDurationMs(
              FLOATING_PANEL_OPEN_MOTION_BUFFER_MS,
            ),
          );
      }

      applyPanelConfigsState(nextPanelConfigs, { preferredPanelId: panelId });
      if (!wasVisible && nextPanels[panelId] && nextConfig.mode === "snapped") {
        startSnappedSlotEnter(nextConfig.position, panelId);
      }
      applyPanelsState(nextPanels, { preferredPanelId: panelId });
      applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
      if (nextPanels[panelId]) {
        setActivePanelId(panelId);
      }

      return nextConfig;
    },
    [
      applyPanelConfigsState,
      applyPanelsState,
      applyRememberedSnappedPositionsState,
      panelConfigsRef,
      panelsRef,
      rememberedSnappedPositionsRef,
      prepareSnappedPanelOpen,
      setActivePanelId,
      startSnappedSlotEnter,
    ],
  );

  const executeAppSurfaceAction = useCallback(
    (action: AppSurfaceAction) => {
      switch (action.kind) {
        case "dispatcher":
          openCommandDispatcher();
          return;
        case "settings":
          openSettings();
          return;
        case "run":
          if (action.mode === "debug") {
            openDebugDialog();
            return;
          }
          openRunDialog();
          return;
        case "panel":
          if (action.panelId === "aiChat" && !aiPanelEnabled) {
            return;
          }
          applyPanelOpenState(action.panelId, { panel: action.panelId });
          if (action.panelId === "terminal") {
            setTimeout(
              () => useTerminalStore.getState().focusActiveTerminal(),
              80,
            );
          }
          return;
      }
    },
    [
      applyPanelOpenState,
      aiPanelEnabled,
      openCommandDispatcher,
      openDebugDialog,
      openRunDialog,
      openSettings,
    ],
  );

  const handlePanelCloseEvent = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      if (!request) {
        return { handled: false, reason: "Invalid panel close request." };
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction?.kind === "dispatcher") {
        dispatcher.close();
        return { handled: true };
      }
      if (appAction?.kind === "settings") {
        closeSettings();
        return { handled: true };
      }
      if (appAction?.kind === "run") {
        closeExecutionDialog();
        return { handled: true };
      }
      if (appAction?.kind === "panel") {
        if (
          appAction.panelId === "terminal" &&
          useTerminalStore.getState().tuiModeActive
        ) {
          closeTerminalPanel();
          return { handled: true };
        }
        closePanelWithMotion(appAction.panelId);
        return { handled: true };
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return { handled: false, reason: "Unknown panel." };
      }

      const terminalState = useTerminalStore.getState();
      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          closeTerminalPanel();
          return { handled: true };
        }

        closePanelWithMotion(panelId);
        if (terminalState.tuiAssist.panel === panelId) {
          terminalState.setTUIAssist({ active: false, panel: null });
        }
        return { handled: true };
      }

      closePanelWithMotion(panelId);
      return { handled: true };
    },
    [
      closeExecutionDialog,
      closePanelWithMotion,
      closeSettings,
      closeTerminalPanel,
      dispatcher,
    ],
  );

  const handlePanelMoveEvent = useCallback(
    (payload: unknown) => {
      const sideMoveRequest = parsePanelSideMoveRequest(payload);
      if (sideMoveRequest) {
        moveSnappedPanelBetweenSides(sideMoveRequest.from, sideMoveRequest.to);
        return { handled: true };
      }

      const request = parsePanelOpenRequest(payload);
      if (!request || (!request.position && !request.mode)) {
        return { handled: false, reason: "Invalid panel move request." };
      }

      if (
        (request.panel === "browser" || request.panel === "web") &&
        request.position
      ) {
        moveBrowserPreviewToPosition(request.position);
        return { handled: true };
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction?.kind === "panel") {
        if (appAction.panelId === "aiChat" && !aiPanelEnabled) {
          return { handled: false, reason: "AI Panel is disabled." };
        }

        applyPanelOpenState(appAction.panelId, {
          ...request,
          panel: appAction.panelId,
        });
        return { handled: true };
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return { handled: false, reason: "Unknown panel." };
      }

      if (panelId === "aiChat" && !aiPanelEnabled) {
        return { handled: false, reason: "AI Panel is disabled." };
      }

      const terminalState = useTerminalStore.getState();
      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          if (request.position || request.anchor) {
            terminalState.setTUIAssist({
              active: false,
              panel: null,
              anchor: normalizeTUIAssistAnchor(
                request.anchor ?? request.position,
                terminalState.tuiAssist.anchor,
              ),
            });
          }
          return { handled: true };
        }

        applyPanelOpenState(panelId, request);
        terminalState.setTUIAssist({
          active: false,
          panel: null,
          anchor: normalizeTUIAssistAnchor(
            request.anchor ?? request.position,
            terminalState.tuiAssist.anchor,
          ),
        });
        return { handled: true };
      }

      applyPanelOpenState(panelId, request);
      return { handled: true };
    },
    [
      applyPanelOpenState,
      aiPanelEnabled,
      moveBrowserPreviewToPosition,
      moveSnappedPanelBetweenSides,
    ],
  );

  const handlePanelOpenEvent = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      if (!request) {
        return { handled: false, reason: "Invalid panel open request." };
      }

      if (request.panel === "browser" || request.panel === "web") {
        const handled = openCanonicalBrowserPreviewRef.current();
        return handled
          ? { handled: true }
          : { handled: false, reason: "No browser preview is available." };
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction) {
        if (appAction.kind === "panel") {
          if (appAction.panelId === "aiChat" && !aiPanelEnabled) {
            return { handled: false, reason: "AI Panel is disabled." };
          }

          applyPanelOpenState(appAction.panelId, {
            ...request,
            panel: appAction.panelId,
          });
          if (appAction.panelId === "terminal") {
            setTimeout(
              () => useTerminalStore.getState().focusActiveTerminal(),
              80,
            );
          }
          return { handled: true };
        }
        executeAppSurfaceAction(appAction);
        return { handled: true };
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return { handled: false, reason: "Unknown panel." };
      }

      if (panelId === "aiChat" && !aiPanelEnabled) {
        return { handled: false, reason: "AI Panel is disabled." };
      }

      if (panelId === "code" && request.path) {
        const fileName =
          request.title ||
          request.name ||
          getProjectPathBasename(request.path) ||
          request.path;
        return handleFileOpenInPanel(request.path, fileName, request.line, {
          ...request,
          panel: "code",
        });
      }

      const terminalState = useTerminalStore.getState();
      if (panelId === "terminal" && request.command) {
        applyPanelOpenState(panelId, {
          ...request,
          position: request.position ?? "bottom",
          mode: request.mode ?? "snapped",
        });
        void submitTerminalCommand(
          request.command,
          request.terminalName ?? "Terminal",
        );
        return { handled: true };
      }

      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          terminalState.setTUIAssist({
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
          return { handled: true };
        }

        applyPanelOpenState(panelId, request);
        terminalState.setTUIAssist({ active: false, panel: null });
        return { handled: true };
      }

      applyPanelOpenState(panelId, request);

      if (panelId === "terminal") {
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
      }
      return { handled: true };
    },
    [
      applyPanelOpenState,
      aiPanelEnabled,
      executeAppSurfaceAction,
      handleFileOpenInPanel,
      logicalViewport.height,
      logicalViewport.width,
      openCanonicalBrowserPreviewRef,
      setPanelConfigs,
      submitTerminalCommand,
    ],
  );

  const handleEditorOpenEvent = useCallback(
    (payload: unknown) => {
      const request = parseEditorOpenRequest(payload);
      if (!request) {
        return { handled: false, reason: "Invalid editor open request." };
      }
      return openFileFromPath(request.path, request.line);
    },
    [openFileFromPath],
  );

  const handleEditorSplitEvent = useCallback((payload: unknown) => {
    const direction = parseEditorSplitDirection(payload);
    if (!direction) {
      return { handled: false, reason: "Invalid editor split request." };
    }

    window.dispatchEvent(
      new CustomEvent("arlecchino:editor-split", {
        detail: { direction },
      }),
    );
    return { handled: true };
  }, []);

  const handleOpenIntentFocusSurface = useCallback(
    (intent: FocusSurfaceIntent) => {
      const surfaceId = intent.surfaceId?.trim();
      const previewWindowId =
        intent.previewWindowId ||
        (surfaceId?.startsWith("preview:")
          ? surfaceId.slice("preview:".length)
          : undefined);
      if (previewWindowId) {
        handlePreviewWindowFocusEvent({ id: previewWindowId });
        return;
      }

      const panelId =
        intent.panelId ||
        (surfaceId?.startsWith("panel:")
          ? surfaceId.slice("panel:".length)
          : undefined);
      if (panelId) {
        handlePanelOpenEvent({ panel: panelId, focus: true });
      }
    },
    [handlePanelOpenEvent, handlePreviewWindowFocusEvent],
  );

  useEffect(() => {
    const unregister = registerOpenIntentDispatcher({
      openProject: async (projectPath, intent) => {
        if (!onProjectOpen) {
          throw new Error("Project open handler is unavailable.");
        }
        if (
          intent.requiresConfirmation &&
          !window.confirm(`Open external project?\n\n${projectPath}`)
        ) {
          return;
        }
        await onProjectOpen(projectPath);
      },
      openFile: async (path, line, intent) => {
        await openFileFromPath(path, line, intent);
      },
      openPreview: async (input) => {
        await handlePreviewWindowOpenEvent(input);
      },
      focusSurface: async (intent) => {
        handleOpenIntentFocusSurface(intent);
      },
    });
    return unregister;
  }, [
    handleOpenIntentFocusSurface,
    handlePreviewWindowOpenEvent,
    onProjectOpen,
    openFileFromPath,
  ]);

  const toggleNamedPanel = useCallback(
    (panelId: PanelId) => {
      const isVisible = panelsRef.current[panelId];
      if (isVisible) {
        if (
          panelId === "terminal" &&
          useTerminalStore.getState().tuiModeActive
        ) {
          closeTerminalPanel();
          return;
        }

        closePanelWithMotion(panelId);
        return;
      }

      applyPanelOpenState(panelId, { panel: panelId });

      if (panelId === "terminal") {
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
      }
    },
    [applyPanelOpenState, closePanelWithMotion, closeTerminalPanel, panelsRef],
  );

  const executeApplicationMenuAction = useCallback(
    (actionId: ShortcutActionId) => {
      if (shouldSuppressApplicationMenuAction(actionId)) {
        return;
      }

      if (
        !aiPanelEnabled &&
        (actionId === "ai.toggle" ||
          actionId === "ai.fullscreen" ||
          actionId === "ai.history")
      ) {
        return;
      }

      const aiChatFullscreenCommand = AI_CHAT_FULLSCREEN_MENU_ACTIONS[actionId];
      if (aiChatFullscreenCommand && isAIChatTopmostFullscreen()) {
        dispatchAIChatFullscreenCommand(aiChatFullscreenCommand, "menu");
        return;
      }

      switch (actionId) {
        case "editor.find":
          if (
            isTerminalShortcutContext({
              activeElement: document.activeElement,
              tuiModeActive: useTerminalStore.getState().tuiModeActive,
              terminalPanelVisible: panelsRef.current.terminal,
            })
          ) {
            window.dispatchEvent(new Event(TERMINAL_FIND_EVENT));
            return;
          }
          window.dispatchEvent(new Event(EDITOR_FIND_IN_FILE_EVENT));
          return;
        case "search.toggle":
          if (!useTerminalStore.getState().isDispatcherPaused) {
            openCommandDispatcher();
          }
          return;
        case "explorer.toggle":
          togglePanelCompactFromShortcut("explorer");
          return;
        case "terminal.toggle":
          togglePanelCompactFromShortcut("terminal");
          return;
        case "terminal.fullscreen":
          if (useTerminalStore.getState().tuiModeActive) {
            return;
          }
          togglePanelFullscreenFromShortcut(
            "terminal",
            terminalPreFullscreenRef,
          );
          return;
        case "ai.toggle":
          togglePanelCompactFromShortcut("aiChat");
          return;
        case "ai.fullscreen":
          togglePanelFullscreenFromShortcut("aiChat", aiChatPreFullscreenRef);
          return;
        case "settings.toggle":
          if (isSettingsOpen) {
            closeSettings();
          } else {
            openSettings();
          }
          return;
        case "zenMode.toggle":
          useEditorSettingsStore.getState().toggleZenMode();
          return;
        case "project.copyPath":
          void copyProjectPathFromShortcut();
          return;
        case "git.fullscreen":
          togglePanelFullscreenFromShortcut("git", gitPreFullscreenRef);
          return;
        case "git.toggle":
          togglePanelCompactFromShortcut("git", gitPreFullscreenRef);
          return;
        case "problems.fullscreen":
          togglePanelFullscreenFromShortcut(
            "problems",
            problemsPreFullscreenRef,
          );
          return;
        case "problems.toggle":
          togglePanelCompactFromShortcut("problems", problemsPreFullscreenRef);
          return;
        case "panel.closeFullscreen":
          closeActiveFullscreenPanelFromShortcut();
          return;
        case "panel.reopenClosed":
          reopenLastClosedSurface();
          return;
        case "browser.preview":
          toggleCanonicalBrowserPreviewRef.current();
          return;
        case "window.toggleFullscreen":
          void toggleWindowFullscreen();
          return;
      }
    },
    [
      closeActiveFullscreenPanelFromShortcut,
      closeSettings,
      copyProjectPathFromShortcut,
      aiChatPreFullscreenRef,
      aiPanelEnabled,
      gitPreFullscreenRef,
      isAIChatTopmostFullscreen,
      isSettingsOpen,
      openCommandDispatcher,
      openSettings,
      problemsPreFullscreenRef,
      reopenLastClosedSurface,
      shouldSuppressApplicationMenuAction,
      terminalPreFullscreenRef,
      toggleCanonicalBrowserPreviewRef,
      toggleNamedPanel,
      togglePanelCompactFromShortcut,
      togglePanelFullscreenFromShortcut,
    ],
  );

  useEffect(() => {
    const handleApplicationMenuAction = (event: Event) => {
      const actionId = (event as CustomEvent<ApplicationMenuActionDetail>)
        .detail?.actionId;
      if (!actionId) {
        return;
      }

      executeApplicationMenuAction(actionId);
    };

    window.addEventListener(
      APPLICATION_MENU_ACTION_EVENT,
      handleApplicationMenuAction,
    );
    return () =>
      window.removeEventListener(
        APPLICATION_MENU_ACTION_EVENT,
        handleApplicationMenuAction,
      );
  }, [executeApplicationMenuAction]);

  useIDEEvents({
    onOpenPanel: handlePanelOpenEvent,
    onClosePanel: handlePanelCloseEvent,
    onMovePanel: handlePanelMoveEvent,
    onToggle: useCallback(
      (element: string) => {
        const state = useTerminalStore.getState();
        if (state.tuiModeActive) {
          switch (element) {
            case "sidebar":
              toggleNamedPanel("explorer");
              return;
            case "terminal":
              closeTUIAssistPanel();
              setTimeout(() => state.focusActiveTerminal(), 80);
              return;
            case "ai":
              if (!aiPanelEnabled) {
                return;
              }
              toggleNamedPanel("aiChat");
              return;
          }
        }

        switch (element) {
          case "search":
            openCommandDispatcher();
            break;
          case "sidebar":
            toggleNamedPanel("explorer");
            break;
          case "terminal":
            toggleNamedPanel("terminal");
            break;
          case "ai":
            if (!aiPanelEnabled) {
              return;
            }
            toggleNamedPanel("aiChat");
            break;
        }
      },
      [
        aiPanelEnabled,
        closeTUIAssistPanel,
        openCommandDispatcher,
        toggleNamedPanel,
      ],
    ),
    onWindowOpen: handlePreviewWindowOpenEvent,
    onWindowUpdate: handlePreviewWindowUpdateEvent,
    onWindowClose: handlePreviewWindowCloseEvent,
    onWindowFocus: handlePreviewWindowFocusEvent,
    onWindowCloseAll: closeAllPreviewWindows,
    onWindowCheckpointCreate: handlePreviewWindowCheckpointCreateEvent,
    onWindowCheckpointRestore: handlePreviewWindowCheckpointRestoreEvent,
    onSurfaceRead: useCallback((payload: unknown) => {
      return getSurfaceRuntimeReadModel(
        parseSurfaceRuntimeReadOptions(payload),
      );
    }, []),
    onSurfacePromote: handleSurfacePromoteEvent,
    onAppearancePreviewStart: handleAppearancePreviewStartEvent,
    onAppearancePreviewPatch: handleAppearancePreviewPatchEvent,
    onAppearancePreviewApply: handleAppearancePreviewApplyEvent,
    onAppearancePreviewCancel: handleAppearancePreviewCancelEvent,
    onTUIEnter: useCallback(() => {
      void ensureActiveTerminalSessionId("Terminal").then((activeSessionId) => {
        if (activeSessionId) {
          enterTUIMode(activeSessionId, "ide-event");
        }
      });
    }, [ensureActiveTerminalSessionId, enterTUIMode]),
    onTUIExit: useCallback(() => {
      const activeSessionId = getActiveTerminalSessionId();
      if (activeSessionId) {
        exitTUIMode(activeSessionId, "ide-event");
      }
    }, [exitTUIMode, getActiveTerminalSessionId]),
    onTUIAssistOpenPanel: useCallback(
      (payload: unknown) => {
        return openTUIAssistPanel(payload);
      },
      [openTUIAssistPanel],
    ),
    onTUIAssistClose: useCallback(() => {
      closeTUIAssistPanel();
    }, [closeTUIAssistPanel]),
    onTUIAssistSwap: useCallback(() => {
      const state = useTerminalStore.getState();
      if (!state.tuiModeActive) {
        return;
      }

      state.setTUIAssist({
        active: true,
        anchor: flipTUIAssistAnchor(state.tuiAssist.anchor),
      });
    }, []),
    onTUIAssistRatio: useCallback(
      (ratio: number) => {
        setTUIAssistRatio(ratio);
      },
      [setTUIAssistRatio],
    ),
    onEditorOpen: handleEditorOpenEvent,
    onEditorSplit: handleEditorSplitEvent,
    onViewZoom: useCallback((action: string) => {
      const terminalState = useTerminalStore.getState();
      const applyTerminalZoom = () => {
        switch (action) {
          case "in":
            terminalState.terminalZoomIn();
            break;
          case "out":
            terminalState.terminalZoomOut();
            break;
          case "reset":
            terminalState.terminalZoomReset();
            break;
        }
      };

      switch (action) {
        case "in":
          measurePerf(
            "zoom",
            "event.in",
            () => {
              if (terminalState.tuiModeActive) {
                applyTerminalZoom();
                return;
              }
              useEditorSettingsStore.getState().zoomIn();
            },
            { source: "ide-event" },
          );
          break;
        case "out":
          measurePerf(
            "zoom",
            "event.out",
            () => {
              if (terminalState.tuiModeActive) {
                applyTerminalZoom();
                return;
              }
              useEditorSettingsStore.getState().zoomOut();
            },
            { source: "ide-event" },
          );
          break;
        case "reset":
          measurePerf(
            "zoom",
            "event.reset",
            () => {
              if (terminalState.tuiModeActive) {
                applyTerminalZoom();
                return;
              }
              useEditorSettingsStore.getState().resetZoom();
            },
            { source: "ide-event" },
          );
          break;
      }
    }, []),
    onAppSettings: openSettings,
    onAppRun: useCallback(
      (mode: unknown) => {
        if (mode === "debug") {
          openDebugDialog();
          return;
        }
        openRunDialog();
      },
      [openDebugDialog, openRunDialog],
    ),
    onGitStatus: useCallback(() => {
      applyPanelOpenState("git", { panel: "git" });
    }, [applyPanelOpenState]),
    onGitCommit: useCallback(() => {
      applyPanelOpenState("git", { panel: "git" });
    }, [applyPanelOpenState]),
  });

  return {
    applyPanelOpenState,
    closeTerminalPanel,
    toggleNamedPanel,
  };
};
