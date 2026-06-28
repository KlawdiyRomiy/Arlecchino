import { useEffect, useMemo, useState } from "react";

import { EventsOff, EventsOn } from "../wails/runtime";
import { useAIChatStore } from "../stores/aiChatStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { useGitStore } from "../stores/gitStore";
import { useKeybindingsStore } from "../stores/keybindingsStore";
import {
  dispatchApplicationMenuAction,
  getApplicationMenuShortcutPayload,
  type ApplicationMenuShortcutPayload,
} from "../utils/applicationMenu";
import { isShortcutActionId, type ShortcutActionId } from "../utils/keyboard";
import { toggleWindowFullscreen } from "../utils/windowFullscreen";

const OPEN_TARGET_EVENT = "arlecchino:open";
const NEW_PROJECT_EVENT = "arlecchino:new-project";
const MENU_STATE_EVENT = "arlecchino:menu-state";

interface WailsAppBridge {
  SyncApplicationMenuShortcuts?: (
    shortcuts: ApplicationMenuShortcutPayload[],
  ) => Promise<void> | void;
  SyncApplicationMenuState?: (
    state: ShellMenuStatePayload,
  ) => Promise<void> | void;
}

interface WailsWindow {
  go?: {
    main?: {
      App?: WailsAppBridge;
    };
  };
}

interface ShellMenuStatePayload {
  hasSelection: boolean;
  aiPanelEnabled: boolean;
  canCloseFullscreenPanel: boolean;
  aiChatFullscreenActive: boolean;
  canStopAgent: boolean;
  canCommit: boolean;
  hasGitChanges: boolean;
}

interface ApplicationMenuStateDetail {
  canCloseFullscreenPanel?: boolean;
  aiChatFullscreenActive?: boolean;
}

const parseMenuActionId = (payload: unknown): ShortcutActionId | null => {
  if (typeof payload === "string" && isShortcutActionId(payload)) {
    return payload;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    "actionId" in payload &&
    typeof (payload as { actionId: unknown }).actionId === "string" &&
    isShortcutActionId((payload as { actionId: string }).actionId)
  ) {
    return (payload as { actionId: ShortcutActionId }).actionId;
  }

  return null;
};

const isAIApplicationMenuAction = (actionId: ShortcutActionId): boolean =>
  actionId === "ai.toggle" ||
  actionId === "ai.fullscreen" ||
  actionId === "ai.history";

export const useApplicationMenuBridge = (): void => {
  const overrides = useKeybindingsStore((state) => state.overrides);
  const aiPanelEnabled = useEditorSettingsStore(
    (state) => state.aiPanelEnabled,
  );
  const runs = useAIChatStore((state) => state.runs);
  const activeRunId = useAIChatStore((state) => state.activeRunId);
  const gitBusy = useGitStore((state) => state.busy);
  const isRepositoryMissing = useGitStore((state) => state.isRepositoryMissing);
  const stagedFiles = useGitStore((state) => state.stagedFiles);
  const unstagedFiles = useGitStore((state) => state.unstagedFiles);
  const conflictedFiles = useGitStore((state) => state.conflictedFiles);
  const [canCloseFullscreenPanel, setCanCloseFullscreenPanel] = useState(false);
  const [aiChatFullscreenActive, setAIChatFullscreenActive] = useState(false);
  const menuShortcuts = useMemo(
    () =>
      getApplicationMenuShortcutPayload(overrides).filter(
        (shortcut) =>
          aiPanelEnabled || !isAIApplicationMenuAction(shortcut.actionId),
      ),
    [aiPanelEnabled, overrides],
  );
  const canStopAgent = useMemo(() => {
    if (!aiPanelEnabled) {
      return false;
    }

    const active = activeRunId
      ? runs.find((run) => run.id === activeRunId)
      : undefined;
    return runs.some((run) => {
      if (active && run.id !== active.id && active.status === "running") {
        return false;
      }
      return run.status === "running" || run.status === "queued";
    });
  }, [activeRunId, aiPanelEnabled, runs]);
  const hasGitChanges =
    stagedFiles.length > 0 ||
    unstagedFiles.length > 0 ||
    conflictedFiles.length > 0;
  const canCommit = hasGitChanges && !gitBusy && !isRepositoryMissing;
  const shellMenuState = useMemo<ShellMenuStatePayload>(
    () => ({
      hasSelection: false,
      aiPanelEnabled,
      canCloseFullscreenPanel,
      aiChatFullscreenActive: aiPanelEnabled && aiChatFullscreenActive,
      canStopAgent,
      canCommit,
      hasGitChanges,
    }),
    [
      aiPanelEnabled,
      aiChatFullscreenActive,
      canCloseFullscreenPanel,
      canCommit,
      canStopAgent,
      hasGitChanges,
    ],
  );

  useEffect(() => {
    const syncApplicationMenuShortcuts = (window as WailsWindow).go?.main?.App
      ?.SyncApplicationMenuShortcuts;
    if (!syncApplicationMenuShortcuts) {
      return;
    }

    void Promise.resolve(syncApplicationMenuShortcuts(menuShortcuts)).catch(
      (error) => {
        console.error("[ApplicationMenu] Failed to sync shortcuts:", error);
      },
    );
  }, [menuShortcuts]);

  useEffect(() => {
    const syncApplicationMenuState = (window as WailsWindow).go?.main?.App
      ?.SyncApplicationMenuState;
    if (!syncApplicationMenuState) {
      return;
    }

    void Promise.resolve(syncApplicationMenuState(shellMenuState)).catch(
      (error) => {
        console.error("[ApplicationMenu] Failed to sync state:", error);
      },
    );
  }, [shellMenuState]);

  useEffect(() => {
    const handleMenuState = (event: Event) => {
      const detail = (event as CustomEvent<ApplicationMenuStateDetail>).detail;
      if (!detail) return;
      if (typeof detail.canCloseFullscreenPanel === "boolean") {
        setCanCloseFullscreenPanel(detail.canCloseFullscreenPanel);
      }
      if (typeof detail.aiChatFullscreenActive === "boolean") {
        setAIChatFullscreenActive(detail.aiChatFullscreenActive);
      }
    };

    window.addEventListener(MENU_STATE_EVENT, handleMenuState);
    return () => window.removeEventListener(MENU_STATE_EVENT, handleMenuState);
  }, []);

  useEffect(() => {
    const handleMenuAction = (payload: unknown) => {
      const actionId = parseMenuActionId(payload);
      if (!actionId) {
        return;
      }

      if (!aiPanelEnabled && isAIApplicationMenuAction(actionId)) {
        return;
      }

      switch (actionId) {
        case "window.toggleFullscreen":
          void toggleWindowFullscreen();
          return;
        case "project.open":
          window.dispatchEvent(new Event(OPEN_TARGET_EVENT));
          return;
        case "project.new":
          window.dispatchEvent(new Event(NEW_PROJECT_EVENT));
          return;
        default:
          dispatchApplicationMenuAction(actionId);
      }
    };

    EventsOn("ide:menu:action", handleMenuAction);
    return () => EventsOff("ide:menu:action");
  }, [aiPanelEnabled]);
};
