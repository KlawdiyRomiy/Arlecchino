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
import {
  FLOATING_PANEL_LAYOUT_TRANSITION_MS,
  type PanelPosition,
} from "../ui/FloatingPanel";
import type {
  AppSurfaceAction,
  PanelConfigs,
  PanelFullscreenSnapshot,
  PanelId,
  PanelOpenRequest,
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

type UnknownEventHandler = (payload: unknown) => void;

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

interface MainLayoutPanelEventsDispatcher {
  close: () => void;
}

interface UseMainLayoutPanelEventsOptions {
  applyPanelConfigsState: (panelConfigs: PanelConfigs) => void;
  applyPanelsState: (panels: PanelVisibility) => void;
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
  ) => Promise<void> | void;
  handlePreviewWindowCheckpointCreateEvent: UnknownEventHandler;
  handlePreviewWindowCheckpointRestoreEvent: UnknownEventHandler;
  handlePreviewWindowCloseEvent: UnknownEventHandler;
  handlePreviewWindowFocusEvent: UnknownEventHandler;
  handlePreviewWindowOpenEvent: UnknownEventHandler;
  handlePreviewWindowUpdateEvent: UnknownEventHandler;
  handleSurfacePromoteEvent: UnknownEventHandler;
  isSettingsOpen: boolean;
  logicalViewport: { width: number; height: number };
  moveBrowserPreviewToPosition: (position: PanelPosition) => boolean | void;
  moveSnappedPanelBetweenSides: (
    from: PanelPosition,
    to: PanelPosition,
  ) => boolean | void;
  openCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  openCommandDispatcher: () => void;
  openDebugDialog: () => void;
  openFileFromPath: (path: string, line?: number) => Promise<void> | void;
  onProjectOpen?: (projectPath: string) => Promise<void> | void;
  openRunDialog: () => void;
  openSettings: () => void;
  openTUIAssistPanel: UnknownEventHandler;
  panelConfigsRef: MutableRefObject<PanelConfigs>;
  panelsRef: MutableRefObject<PanelVisibility>;
  problemsPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  rememberedSnappedPositionsRef: MutableRefObject<RememberedSnappedPositions>;
  setPanelConfigs: Dispatch<SetStateAction<PanelConfigs>>;
  setActivePanelId: (panelId: PanelId | null) => void;
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
    panelId: "terminal" | "git" | "problems",
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
  setActivePanelId,
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

      if (nextPanels[panelId]) {
        usePerformanceStore
          .getState()
          .beginPanelMotionWindow(FLOATING_PANEL_LAYOUT_TRANSITION_MS + 160);
      }

      applyPanelsState(nextPanels);
      applyPanelConfigsState(nextPanelConfigs);
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
      setActivePanelId,
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
        return;
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction?.kind === "dispatcher") {
        dispatcher.close();
        return;
      }
      if (appAction?.kind === "settings") {
        closeSettings();
        return;
      }
      if (appAction?.kind === "run") {
        closeExecutionDialog();
        return;
      }
      if (appAction?.kind === "panel") {
        if (
          appAction.panelId === "terminal" &&
          useTerminalStore.getState().tuiModeActive
        ) {
          closeTerminalPanel();
          return;
        }
        closePanelWithMotion(appAction.panelId);
        return;
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return;
      }

      const terminalState = useTerminalStore.getState();
      if (terminalState.tuiModeActive) {
        if (panelId === "terminal") {
          closeTerminalPanel();
          return;
        }

        closePanelWithMotion(panelId);
        if (terminalState.tuiAssist.panel === panelId) {
          terminalState.setTUIAssist({ active: false, panel: null });
        }
        return;
      }

      closePanelWithMotion(panelId);
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
        return;
      }

      const request = parsePanelOpenRequest(payload);
      if (!request || (!request.position && !request.mode)) {
        return;
      }

      if (
        (request.panel === "browser" || request.panel === "web") &&
        request.position
      ) {
        moveBrowserPreviewToPosition(request.position);
        return;
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction?.kind === "panel") {
        applyPanelOpenState(appAction.panelId, {
          ...request,
          panel: appAction.panelId,
        });
        return;
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return;
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
          return;
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
        return;
      }

      applyPanelOpenState(panelId, request);
    },
    [
      applyPanelOpenState,
      moveBrowserPreviewToPosition,
      moveSnappedPanelBetweenSides,
    ],
  );

  const handlePanelOpenEvent = useCallback(
    (payload: unknown) => {
      const request = parsePanelOpenRequest(payload);
      if (!request) {
        return;
      }

      if (request.panel === "browser" || request.panel === "web") {
        openCanonicalBrowserPreviewRef.current();
        return;
      }

      const appAction = resolveAppSurfaceAction(request.panel);
      if (appAction) {
        if (appAction.kind === "panel") {
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
          return;
        }
        executeAppSurfaceAction(appAction);
        return;
      }

      const panelId = resolvePanelId(request.panel);
      if (!panelId) {
        return;
      }

      if (panelId === "code" && request.path) {
        const fileName =
          request.title ||
          request.name ||
          getProjectPathBasename(request.path) ||
          request.path;
        void handleFileOpenInPanel(request.path, fileName, request.line, {
          ...request,
          panel: "code",
        });
        return;
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
        return;
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
          return;
        }

        applyPanelOpenState(panelId, request);
        terminalState.setTUIAssist({ active: false, panel: null });
        return;
      }

      applyPanelOpenState(panelId, request);

      if (panelId === "terminal") {
        setTimeout(() => useTerminalStore.getState().focusActiveTerminal(), 80);
      }
    },
    [
      applyPanelOpenState,
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
        return;
      }
      void openFileFromPath(request.path, request.line);
    },
    [openFileFromPath],
  );

  const handleEditorSplitEvent = useCallback((payload: unknown) => {
    const direction = parseEditorSplitDirection(payload);
    if (!direction) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent("arlecchino:editor-split", {
        detail: { direction },
      }),
    );
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
      openProject: async (projectPath) => {
        if (!onProjectOpen) {
          throw new Error("Project open handler is unavailable.");
        }
        await onProjectOpen(projectPath);
      },
      openFile: async (path, line) => {
        await openFileFromPath(path, line);
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
      gitPreFullscreenRef,
      isSettingsOpen,
      openCommandDispatcher,
      openSettings,
      problemsPreFullscreenRef,
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
            toggleNamedPanel("aiChat");
            break;
        }
      },
      [closeTUIAssistPanel, openCommandDispatcher, toggleNamedPanel],
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
        openTUIAssistPanel(payload);
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
  });

  return {
    applyPanelOpenState,
    closeTerminalPanel,
    toggleNamedPanel,
  };
};
