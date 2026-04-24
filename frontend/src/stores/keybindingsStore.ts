import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  KEYBINDINGS_STORAGE_KEY,
  SHORTCUT_DEFINITIONS,
  type ShortcutActionId,
  type ShortcutDefinition,
  getEffectiveShortcuts,
  getShortcutDefinition,
  isShortcutActionId,
  normalizeShortcut,
} from "../utils/keyboard";

interface ShortcutConflict {
  actionId: ShortcutActionId;
  label: string;
}

interface SetShortcutResult {
  ok: boolean;
  conflict?: ShortcutConflict;
  error?: string;
}

interface KeybindingsState {
  overrides: Partial<Record<ShortcutActionId, string[]>>;
  setShortcut: (
    actionId: ShortcutActionId,
    shortcut: string,
  ) => SetShortcutResult;
  resetShortcut: (actionId: ShortcutActionId) => void;
  resetAllShortcuts: () => void;
  getEffectiveShortcuts: (actionId: ShortcutActionId) => string[];
}

const KEYBINDINGS_STORAGE_VERSION = 1;

const getDefinition = (actionId: ShortcutActionId): ShortcutDefinition =>
  getShortcutDefinition(actionId);

const sanitizeOverrides = (
  value: unknown,
): Partial<Record<ShortcutActionId, string[]>> => {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  const nextOverrides: Partial<Record<ShortcutActionId, string[]>> = {};

  Object.entries(value as Record<string, unknown>).forEach(
    ([id, shortcuts]) => {
      if (!isShortcutActionId(id) || !Array.isArray(shortcuts)) {
        return;
      }

      const normalized = shortcuts
        .filter((shortcut): shortcut is string => typeof shortcut === "string")
        .map((shortcut) => normalizeShortcut(shortcut))
        .filter((shortcut): shortcut is string => Boolean(shortcut));
      const deduped = Array.from(new Set(normalized));

      if (deduped.length > 0) {
        nextOverrides[id] = deduped;
      }
    },
  );

  return nextOverrides;
};

const getEffectiveShortcutsFromOverrides = (
  actionId: ShortcutActionId,
  overrides: Partial<Record<ShortcutActionId, string[]>>,
): string[] => getEffectiveShortcuts(actionId, overrides);

const findSameScopeConflict = (
  actionId: ShortcutActionId,
  shortcut: string,
  overrides: Partial<Record<ShortcutActionId, string[]>>,
): ShortcutConflict | null => {
  const definition = getDefinition(actionId);

  for (const candidate of SHORTCUT_DEFINITIONS) {
    if (candidate.id === actionId || candidate.scope !== definition.scope) {
      continue;
    }

    if (
      getEffectiveShortcutsFromOverrides(candidate.id, overrides).includes(
        shortcut,
      )
    ) {
      return {
        actionId: candidate.id,
        label: candidate.label,
      };
    }
  }

  return null;
};

export const useKeybindingsStore = create<KeybindingsState>()(
  persist(
    (set, get) => ({
      overrides: {},

      setShortcut: (actionId, shortcut) => {
        const normalized = normalizeShortcut(shortcut);
        if (!normalized) {
          return { ok: false, error: "Unsupported shortcut" };
        }

        const nextOverrides = {
          ...get().overrides,
          [actionId]: [normalized],
        };
        const conflict = findSameScopeConflict(
          actionId,
          normalized,
          nextOverrides,
        );

        if (conflict) {
          return { ok: false, conflict };
        }

        set({ overrides: nextOverrides });
        return { ok: true };
      },

      resetShortcut: (actionId) => {
        const { [actionId]: _removed, ...nextOverrides } = get().overrides;
        set({ overrides: nextOverrides });
      },

      resetAllShortcuts: () => set({ overrides: {} }),

      getEffectiveShortcuts: (actionId) =>
        getEffectiveShortcutsFromOverrides(actionId, get().overrides),
    }),
    {
      name: KEYBINDINGS_STORAGE_KEY,
      version: KEYBINDINGS_STORAGE_VERSION,
      partialize: (state) => ({
        overrides: state.overrides,
      }),
      migrate: (persistedState) => {
        if (
          typeof persistedState !== "object" ||
          persistedState === null ||
          !("overrides" in persistedState)
        ) {
          return { overrides: {} };
        }

        return {
          overrides: sanitizeOverrides(
            (persistedState as { overrides?: unknown }).overrides,
          ),
        };
      },
    },
  ),
);
