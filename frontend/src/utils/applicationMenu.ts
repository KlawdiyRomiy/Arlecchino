import {
  getEffectiveShortcuts,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
} from "./keyboard";

export const APPLICATION_MENU_ACTION_EVENT =
  "arlecchino:application-menu-action";

export interface ApplicationMenuShortcutPayload {
  actionId: ShortcutActionId;
  label: string;
  group: string;
  shortcuts: string[];
}

export interface ApplicationMenuActionDetail {
  actionId: ShortcutActionId;
}

export const getApplicationMenuShortcutPayload = (
  overrides: Partial<Record<ShortcutActionId, string[]>>,
): ApplicationMenuShortcutPayload[] =>
  SHORTCUT_DEFINITIONS.map((definition) => ({
    actionId: definition.id,
    label: definition.label,
    group: definition.group,
    shortcuts: getEffectiveShortcuts(definition.id, overrides),
  }));

export const dispatchApplicationMenuAction = (
  actionId: ShortcutActionId,
): void => {
  window.dispatchEvent(
    new CustomEvent<ApplicationMenuActionDetail>(
      APPLICATION_MENU_ACTION_EVENT,
      {
        detail: { actionId },
      },
    ),
  );
};
