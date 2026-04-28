import { useEffect, useMemo } from "react";

import { EventsOff, EventsOn } from "../wails/runtime";
import { useKeybindingsStore } from "../stores/keybindingsStore";
import {
  dispatchApplicationMenuAction,
  getApplicationMenuShortcutPayload,
  type ApplicationMenuShortcutPayload,
} from "../utils/applicationMenu";
import { isShortcutActionId, type ShortcutActionId } from "../utils/keyboard";
import { toggleWindowFullscreen } from "../utils/windowFullscreen";

const OPEN_PROJECT_EVENT = "arlecchino:open-project";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

interface WailsAppBridge {
  SyncApplicationMenuShortcuts?: (
    shortcuts: ApplicationMenuShortcutPayload[],
  ) => Promise<void> | void;
}

interface WailsWindow {
  go?: {
    main?: {
      App?: WailsAppBridge;
    };
  };
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

export const useApplicationMenuBridge = (): void => {
  const overrides = useKeybindingsStore((state) => state.overrides);
  const menuShortcuts = useMemo(
    () => getApplicationMenuShortcutPayload(overrides),
    [overrides],
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
    const handleMenuAction = (payload: unknown) => {
      const actionId = parseMenuActionId(payload);
      if (!actionId) {
        return;
      }

      switch (actionId) {
        case "window.toggleFullscreen":
          void toggleWindowFullscreen();
          return;
        case "project.open":
          window.dispatchEvent(new Event(OPEN_PROJECT_EVENT));
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
  }, []);
};
