import { useEffect, type MutableRefObject } from "react";

import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { usePreviewWindowStore } from "../../stores/previewWindowStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { isProjectSessionRoute } from "../../shell/projectSessionRoute";
import type { ThemeId } from "../../styles/themes";
import {
  dispatchAIChatFullscreenCommand,
  type AIChatFullscreenCommand,
} from "../../utils/aiChatFullscreenCommands";
import { shortcuts, type ShortcutActionId } from "../../utils/keyboard";
import { measurePerf } from "../../utils/perf";
import { isProjectSwitchBlocked } from "../../utils/priorityUI";
import {
  isTerminalFocusedElement,
  isTerminalShortcutContext as hasTerminalShortcutContext,
  shouldBypassGlobalFindShortcuts,
} from "../../utils/terminalFocus";
import { toggleWindowFullscreen } from "../../utils/windowFullscreen";
import type {
  PanelFullscreenSnapshot,
  PanelId,
  PanelVisibility,
} from "./MainLayout.types";

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

const isPhysicalMacProjectSwitchShortcut = (event: KeyboardEvent): boolean =>
  isMacPlatform() &&
  event.metaKey &&
  !event.ctrlKey &&
  !event.altKey &&
  event.code === "Backquote";

const AI_CHAT_FULLSCREEN_COMMAND_SHORTCUT_ACTIONS: Record<
  AIChatFullscreenCommand,
  ShortcutActionId
> = {
  "history.toggle": "ai.history",
  "sessionSearch.open": "editor.find",
  "review.toggle": "git.toggle",
  "review.expandToggle": "git.fullscreen",
};

const resolveAIChatFullscreenShortcut = (
  event: KeyboardEvent,
): AIChatFullscreenCommand | null => {
  if (shortcuts.toggleAIHistory(event)) {
    return "history.toggle";
  }
  if (shortcuts.findInFile(event)) {
    return "sessionSearch.open";
  }
  if (shortcuts.toggleGitFullscreen(event)) {
    return "review.expandToggle";
  }
  if (shortcuts.toggleGit(event)) {
    return "review.toggle";
  }
  return null;
};

interface MainLayoutKeyboardDispatcher {
  close: () => void;
  isOpen: boolean;
}

type ShortcutSuppressionRef = MutableRefObject<{
  actionId: ShortcutActionId;
  until: number;
} | null>;

type ApplicationMenuRepeatRef = MutableRefObject<{
  actionId: ShortcutActionId;
  lastAt: number;
} | null>;

interface UseMainLayoutKeyboardShortcutsOptions {
  activeModal: unknown | null;
  activateAdjacentCodePanelTab: (direction: -1 | 1) => boolean;
  applicationMenuRepeatRef: ApplicationMenuRepeatRef;
  beginHeldPanelShortcut: (
    event: KeyboardEvent,
    target:
      | { kind: "panel"; panelId: PanelId }
      | { kind: "preview"; windowId?: string },
    runTapAction: () => void,
    options?: {
      actionId?: ShortcutActionId;
      runTapActionImmediately?: boolean;
    },
  ) => void;
  clearHeldPanelShortcut: (runTapAction: boolean) => void;
  closeActiveFullscreenPanelFromShortcut: () => boolean;
  closeCreateEntryDialog: () => void;
  closeExecutionDialog: () => void;
  closeModal: () => void;
  closePreviewWindowWithMotion: (windowId: string) => void;
  closeSettings: () => void;
  closeTUIAssistPanel: () => void;
  copyProjectPathFromShortcut: () => Promise<boolean>;
  createEntryDialog: unknown | null;
  delayedShortcutActionSuppressionRef: ShortcutSuppressionRef;
  dispatcher: MainLayoutKeyboardDispatcher;
  executionDialogMode: unknown | null;
  finishHeldPanelShortcutOnKeyUp: (event: KeyboardEvent) => void;
  getShortcutEventCode: (event: KeyboardEvent) => string;
  aiChatPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  gitPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  handleHeldPanelShortcutMove: (event: KeyboardEvent) => boolean;
  isAIChatTopmostFullscreen: () => boolean;
  isPerspectiveOpenRef: MutableRefObject<boolean>;
  isSettingsOpen: boolean;
  markShortcutActionHandled: (actionId: ShortcutActionId) => void;
  onSwitchProject?: (projectId: string, direction?: number) => void;
  openSettings: () => void;
  panelsRef: MutableRefObject<PanelVisibility>;
  pressedShortcutCodesRef: MutableRefObject<Set<string>>;
  problemsPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  shortcutActionSuppressionRef: ShortcutSuppressionRef;
  terminalPreFullscreenRef: MutableRefObject<PanelFullscreenSnapshot | null>;
  toggleCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  toggleCommandDispatcher: () => void;
  terminalThemeId: ThemeId;
  togglePanelCompactFromShortcut: (
    panelId: PanelId,
    snapshotRef?: MutableRefObject<PanelFullscreenSnapshot | null>,
  ) => void;
  togglePanelFullscreenFromShortcut: (
    panelId: "terminal" | "git" | "problems" | "aiChat",
    snapshotRef: MutableRefObject<PanelFullscreenSnapshot | null>,
  ) => void;
}

export const useMainLayoutKeyboardShortcuts = ({
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
  isPerspectiveOpenRef,
  isSettingsOpen,
  markShortcutActionHandled,
  onSwitchProject,
  openSettings,
  panelsRef,
  pressedShortcutCodesRef,
  problemsPreFullscreenRef,
  shortcutActionSuppressionRef,
  terminalPreFullscreenRef,
  toggleCanonicalBrowserPreviewRef,
  toggleCommandDispatcher,
  terminalThemeId,
  togglePanelCompactFromShortcut,
  togglePanelFullscreenFromShortcut,
}: UseMainLayoutKeyboardShortcutsOptions) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const eventCode = getShortcutEventCode(e);
      if (eventCode) {
        pressedShortcutCodesRef.current.add(eventCode);
      }

      const terminalState = useTerminalStore.getState();
      const isTUIActive = terminalState.tuiModeActive;
      const panelState = panelsRef.current;
      const activeElement = document.activeElement as HTMLElement | null;
      const isTerminalFocused = isTerminalFocusedElement(activeElement);
      const activePane = terminalState.panes.find(
        (pane) => pane.id === terminalState.activePaneId,
      );
      const isTerminalPanelVisible = panelState.terminal;
      const isTerminalShortcutContext = hasTerminalShortcutContext({
        activeElement,
        tuiModeActive: isTUIActive,
        terminalPanelVisible: isTerminalPanelVisible,
      });

      if (shouldBypassGlobalFindShortcuts(e, activeElement)) {
        return;
      }

      const aiChatFullscreenCommand = resolveAIChatFullscreenShortcut(e);
      if (
        aiChatFullscreenCommand &&
        isAIChatTopmostFullscreen() &&
        !isTerminalShortcutContext &&
        !isTUIActive &&
        activeModal === null &&
        !dispatcher.isOpen &&
        !isPerspectiveOpenRef.current &&
        document.body.dataset.shortcutRecording !== "true" &&
        document.body.dataset.shellModalOpen !== "true"
      ) {
        markShortcutActionHandled(
          AI_CHAT_FULLSCREEN_COMMAND_SHORTCUT_ACTIONS[aiChatFullscreenCommand],
        );
        e.preventDefault();
        e.stopPropagation();
        dispatchAIChatFullscreenCommand(aiChatFullscreenCommand, "keyboard");
        return;
      }

      if (handleHeldPanelShortcutMove(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (
        shortcuts.toggleWindowFullscreen(e) &&
        document.body.dataset.shortcutRecording !== "true"
      ) {
        e.preventDefault();
        e.stopPropagation();
        void toggleWindowFullscreen();
        return;
      }

      if (shortcuts.closeFullscreenPanel(e)) {
        if (closeActiveFullscreenPanelFromShortcut()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (
        isTUIActive &&
        panelState.code &&
        (shortcuts.switchEditorTabNext(e) || shortcuts.switchEditorTabPrev(e))
      ) {
        const direction = shortcuts.switchEditorTabPrev(e) ? -1 : 1;
        if (activateAdjacentCodePanelTab(direction)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      if (shortcuts.terminalNewTab(e)) {
        const hasNoTabs = activePane && activePane.tabIds.length === 0;
        if (
          isTerminalShortcutContext ||
          (isTerminalPanelVisible && hasNoTabs)
        ) {
          e.preventDefault();
          if (activePane) {
            void terminalState.createTerminal(activePane.id, terminalThemeId);
          }
          return;
        }
      }

      if (isTerminalShortcutContext && shortcuts.terminalCloseTab(e)) {
        e.preventDefault();
        if (activePane?.activeTabId) {
          void terminalState
            .closeTerminal(activePane.id, activePane.activeTabId)
            .then(() => {
              setTimeout(() => terminalState.focusActiveTerminal(), 50);
            });
        }
        return;
      }

      if (isTerminalShortcutContext && shortcuts.terminalReopenTab(e)) {
        e.preventDefault();
        void terminalState.reopenLastClosedTab(terminalThemeId);
        return;
      }

      if (shortcuts.unifiedSearch(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (terminalState.isDispatcherPaused) {
          return;
        }
        toggleCommandDispatcher();
        return;
      }

      if (shortcuts.openProject(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event("arlecchino:open"));
        return;
      }

      if (shortcuts.newProject(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new Event("arlecchino:new-project"));
        return;
      }

      if (shortcuts.toggleExplorer(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        markShortcutActionHandled("explorer.toggle");
        e.preventDefault();
        e.stopPropagation();

        beginHeldPanelShortcut(
          e,
          { kind: "panel", panelId: "explorer" },
          () => togglePanelCompactFromShortcut("explorer"),
          { actionId: "explorer.toggle", runTapActionImmediately: true },
        );
        return;
      }

      if (shortcuts.switchProjectNext(e) || shortcuts.switchProjectPrev(e)) {
        const workspaceState = useWorkspaceStore.getState();
        if (
          isPhysicalMacProjectSwitchShortcut(e) &&
          (useEditorSettingsStore.getState().projectWindowMode === "windows" ||
            isProjectSessionRoute() ||
            workspaceState.projects.length < 2)
        ) {
          return;
        }

        const localProjectSwitchBlocked =
          dispatcher.isOpen ||
          activeModal !== null ||
          isPerspectiveOpenRef.current;

        if (
          isTerminalShortcutContext ||
          isTUIActive ||
          localProjectSwitchBlocked ||
          isProjectSwitchBlocked()
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const { projects, activeId: curId } = workspaceState;
        if (projects.length < 2) return;
        const idx = projects.findIndex((p) => p.id === curId);
        const isNext = !shortcuts.switchProjectPrev(e);
        const targetIdx = isNext
          ? (idx + 1) % projects.length
          : (idx - 1 + projects.length) % projects.length;
        onSwitchProject?.(projects[targetIdx].id, isNext ? 1 : -1);
        return;
      }

      if (shortcuts.toggleTerminal(e)) {
        markShortcutActionHandled("terminal.toggle");
        e.preventDefault();
        e.stopPropagation();

        beginHeldPanelShortcut(
          e,
          { kind: "panel", panelId: "terminal" },
          () => {
            if (!isTerminalShortcutContext) {
              togglePanelCompactFromShortcut("terminal");
            }
          },
          {
            actionId: "terminal.toggle",
            runTapActionImmediately: !isTerminalShortcutContext,
          },
        );
        return;
      }

      if (shortcuts.toggleTerminalFullscreen(e)) {
        if (isTUIActive) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        togglePanelFullscreenFromShortcut("terminal", terminalPreFullscreenRef);
        return;
      }

      if (shortcuts.toggleAI(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        markShortcutActionHandled("ai.toggle");
        e.preventDefault();
        e.stopPropagation();

        beginHeldPanelShortcut(
          e,
          { kind: "panel", panelId: "aiChat" },
          () => togglePanelCompactFromShortcut("aiChat"),
          { actionId: "ai.toggle", runTapActionImmediately: true },
        );
        return;
      }

      if (shortcuts.toggleAIFullscreen(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        togglePanelFullscreenFromShortcut("aiChat", aiChatPreFullscreenRef);
        return;
      }

      if (shortcuts.toggleSettings(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        if (isSettingsOpen) {
          closeSettings();
        } else {
          openSettings();
        }
        return;
      }

      if (shortcuts.toggleZenMode(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        markShortcutActionHandled("zenMode.toggle");
        e.preventDefault();
        e.stopPropagation();
        useEditorSettingsStore.getState().toggleZenMode();
        return;
      }

      if (shortcuts.copyProjectPath(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        void copyProjectPathFromShortcut();
        return;
      }

      if (shortcuts.toggleGitFullscreen(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        togglePanelFullscreenFromShortcut("git", gitPreFullscreenRef);
        return;
      }

      if (shortcuts.toggleGit(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        markShortcutActionHandled("git.toggle");
        e.preventDefault();
        e.stopPropagation();
        beginHeldPanelShortcut(
          e,
          { kind: "panel", panelId: "git" },
          () => togglePanelCompactFromShortcut("git", gitPreFullscreenRef),
          { actionId: "git.toggle", runTapActionImmediately: true },
        );
        return;
      }

      if (shortcuts.toggleProblemsFullscreen(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        togglePanelFullscreenFromShortcut("problems", problemsPreFullscreenRef);
        return;
      }

      if (shortcuts.toggleProblems(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        markShortcutActionHandled("problems.toggle");
        e.preventDefault();
        e.stopPropagation();
        beginHeldPanelShortcut(
          e,
          { kind: "panel", panelId: "problems" },
          () =>
            togglePanelCompactFromShortcut(
              "problems",
              problemsPreFullscreenRef,
            ),
          { actionId: "problems.toggle", runTapActionImmediately: true },
        );
        return;
      }

      if (shortcuts.openBrowserPreview(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        beginHeldPanelShortcut(
          e,
          { kind: "preview" },
          () => toggleCanonicalBrowserPreviewRef.current(),
          { actionId: "browser.preview", runTapActionImmediately: true },
        );
        return;
      }

      if (shortcuts.escape(e)) {
        if (isTerminalShortcutContext) {
          return;
        }

        if (document.querySelector("[data-shell-menu-content]")) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (document.body.dataset.shellModalOpen === "true") {
          return;
        }

        if (createEntryDialog) {
          closeCreateEntryDialog();
          return;
        }

        if (terminalState.tuiAssist.active) {
          closeTUIAssistPanel();
          return;
        }

        const activePreviewWindowId =
          usePreviewWindowStore.getState().activeWindowId;
        if (activePreviewWindowId) {
          closePreviewWindowWithMotion(activePreviewWindowId);
          return;
        }

        if (isSettingsOpen) {
          closeSettings();
          return;
        }

        if (executionDialogMode !== null) {
          closeExecutionDialog();
          return;
        }

        dispatcher.close();
        closeModal();
      }

      if (shortcuts.zoomIn(e)) {
        e.preventDefault();

        if (isTerminalShortcutContext) {
          measurePerf(
            "zoom",
            "shortcut.in.terminal",
            () => {
              terminalState.terminalZoomIn();
            },
            {
              source: "keyboard",
              tuiModeActive: isTUIActive,
              terminalFocused: isTerminalFocused,
            },
          );
          return;
        }

        measurePerf(
          "zoom",
          "shortcut.in",
          () => {
            useEditorSettingsStore.getState().zoomIn();
          },
          { source: "keyboard", tuiModeActive: isTUIActive },
        );
        return;
      }
      if (shortcuts.zoomOut(e)) {
        e.preventDefault();

        if (isTerminalShortcutContext) {
          measurePerf(
            "zoom",
            "shortcut.out.terminal",
            () => {
              terminalState.terminalZoomOut();
            },
            {
              source: "keyboard",
              tuiModeActive: isTUIActive,
              terminalFocused: isTerminalFocused,
            },
          );
          return;
        }

        measurePerf(
          "zoom",
          "shortcut.out",
          () => {
            useEditorSettingsStore.getState().zoomOut();
          },
          { source: "keyboard", tuiModeActive: isTUIActive },
        );
        return;
      }
      if (shortcuts.zoomReset(e)) {
        e.preventDefault();

        if (isTerminalShortcutContext) {
          measurePerf(
            "zoom",
            "shortcut.reset.terminal",
            () => {
              terminalState.terminalZoomReset();
            },
            {
              source: "keyboard",
              tuiModeActive: isTUIActive,
              terminalFocused: isTerminalFocused,
            },
          );
          return;
        }

        measurePerf(
          "zoom",
          "shortcut.reset",
          () => {
            useEditorSettingsStore.getState().resetZoom();
          },
          { source: "keyboard", tuiModeActive: isTUIActive },
        );
        return;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const eventCode = getShortcutEventCode(event);
      if (eventCode) {
        pressedShortcutCodesRef.current.delete(eventCode);
      }

      applicationMenuRepeatRef.current = null;
      finishHeldPanelShortcutOnKeyUp(event);
    };

    const handleWindowBlur = () => {
      clearHeldPanelShortcut(false);
      pressedShortcutCodesRef.current.clear();
      shortcutActionSuppressionRef.current = null;
      delayedShortcutActionSuppressionRef.current = null;
      applicationMenuRepeatRef.current = null;
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
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
    isPerspectiveOpenRef,
    isSettingsOpen,
    markShortcutActionHandled,
    onSwitchProject,
    openSettings,
    panelsRef,
    pressedShortcutCodesRef,
    problemsPreFullscreenRef,
    shortcutActionSuppressionRef,
    terminalPreFullscreenRef,
    toggleCanonicalBrowserPreviewRef,
    toggleCommandDispatcher,
    terminalThemeId,
    togglePanelCompactFromShortcut,
    togglePanelFullscreenFromShortcut,
  ]);
};
