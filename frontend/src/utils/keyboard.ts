/**
 * Keyboard utilities for layout-independent shortcuts
 * Works with any keyboard layout (Russian, German, etc.)
 */

// Map of KeyboardEvent.code to the letter it represents
const CODE_TO_KEY: Record<string, string> = {
  KeyA: "a",
  KeyB: "b",
  KeyC: "c",
  KeyD: "d",
  KeyE: "e",
  KeyF: "f",
  KeyG: "g",
  KeyH: "h",
  KeyI: "i",
  KeyJ: "j",
  KeyK: "k",
  KeyL: "l",
  KeyM: "m",
  KeyN: "n",
  KeyO: "o",
  KeyP: "p",
  KeyQ: "q",
  KeyR: "r",
  KeyS: "s",
  KeyT: "t",
  KeyU: "u",
  KeyV: "v",
  KeyW: "w",
  KeyX: "x",
  KeyY: "y",
  KeyZ: "z",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: " ",
  Enter: "enter",
  Escape: "escape",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
};

const MODIFIER_ORDER = ["cmd", "ctrl", "alt", "shift"] as const;
const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  cmd: "cmd",
  command: "cmd",
  meta: "cmd",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  opt: "alt",
  option: "alt",
  shift: "shift",
};
const MODIFIER_KEYS = new Set([
  "alt",
  "control",
  "ctrl",
  "meta",
  "option",
  "shift",
]);

export const KEYBINDINGS_STORAGE_KEY = "keybindings-settings.v1";

export type ShortcutModifier = (typeof MODIFIER_ORDER)[number];
export type ShortcutScope = "global" | "terminal";
export type ShortcutGroup = "Panels" | "App" | "Editor" | "Terminal";

export type ShortcutActionId =
  | "search.toggle"
  | "project.open"
  | "project.new"
  | "project.copyPath"
  | "project.switchNext"
  | "project.switchPrevious"
  | "explorer.toggle"
  | "git.toggle"
  | "git.fullscreen"
  | "problems.toggle"
  | "problems.fullscreen"
  | "terminal.toggle"
  | "ai.toggle"
  | "settings.toggle"
  | "browser.preview"
  | "editor.save"
  | "editor.closeTab"
  | "editor.reopenTab"
  | "editor.switchTabNext"
  | "editor.switchTabPrevious"
  | "terminal.copy"
  | "terminal.paste"
  | "terminal.selectAll"
  | "terminal.clear"
  | "terminal.find"
  | "terminal.findNext"
  | "terminal.findPrevious"
  | "terminal.newTab"
  | "terminal.closeTab"
  | "terminal.reopenTab"
  | "terminal.clearLine";

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  description: string;
  group: ShortcutGroup;
  scope: ShortcutScope;
  defaultShortcuts: string[];
}

export interface ParsedShortcut {
  modifiers: ShortcutModifier[];
  key: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "explorer.toggle",
    label: "Explorer",
    description: "Open or close the file explorer panel.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+e"],
  },
  {
    id: "git.toggle",
    label: "Git compact",
    description: "Open or close the compact Git panel.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+g"],
  },
  {
    id: "git.fullscreen",
    label: "Git fullscreen",
    description: "Open Git in fullscreen mode or restore it.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+shift+g"],
  },
  {
    id: "problems.toggle",
    label: "Problems compact",
    description: "Open or close the compact Problems panel.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+p"],
  },
  {
    id: "problems.fullscreen",
    label: "Problems fullscreen",
    description: "Open Problems in fullscreen mode or restore it.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+shift+p"],
  },
  {
    id: "ai.toggle",
    label: "AI panel",
    description: "Open or close the AI assistant panel.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+r", "ctrl+r"],
  },
  {
    id: "terminal.toggle",
    label: "Terminal panel",
    description: "Open or close the terminal panel.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["ctrl+`"],
  },
  {
    id: "browser.preview",
    label: "Browser preview",
    description: "Open browser preview for the active context.",
    group: "Panels",
    scope: "global",
    defaultShortcuts: ["cmd+shift+b"],
  },
  {
    id: "search.toggle",
    label: "Search",
    description: "Open the project search surface.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+f", "ctrl+f"],
  },
  {
    id: "settings.toggle",
    label: "Settings",
    description: "Open or close workspace settings.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+,", "ctrl+,"],
  },
  {
    id: "project.open",
    label: "Open project",
    description: "Open another project folder.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+o", "ctrl+o"],
  },
  {
    id: "project.new",
    label: "New project",
    description: "Create a new project.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+n", "ctrl+n"],
  },
  {
    id: "project.copyPath",
    label: "Copy project path",
    description: "Copy the active project path to the clipboard.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+shift+c"],
  },
  {
    id: "project.switchNext",
    label: "Next project",
    description: "Switch to the next open project.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+`"],
  },
  {
    id: "project.switchPrevious",
    label: "Previous project",
    description: "Switch to the previous open project.",
    group: "App",
    scope: "global",
    defaultShortcuts: ["cmd+shift+`"],
  },
  {
    id: "editor.save",
    label: "Save file",
    description: "Save the active editor tab.",
    group: "Editor",
    scope: "global",
    defaultShortcuts: ["cmd+s", "ctrl+s"],
  },
  {
    id: "editor.closeTab",
    label: "Close editor tab",
    description: "Close the active editor tab.",
    group: "Editor",
    scope: "global",
    defaultShortcuts: ["cmd+w", "ctrl+w"],
  },
  {
    id: "editor.reopenTab",
    label: "Reopen editor tab",
    description: "Reopen the last closed editor tab.",
    group: "Editor",
    scope: "global",
    defaultShortcuts: ["cmd+shift+t", "ctrl+shift+t"],
  },
  {
    id: "editor.switchTabNext",
    label: "Next editor tab",
    description: "Move focus to the next editor tab.",
    group: "Editor",
    scope: "global",
    defaultShortcuts: ["ctrl+tab"],
  },
  {
    id: "editor.switchTabPrevious",
    label: "Previous editor tab",
    description: "Move focus to the previous editor tab.",
    group: "Editor",
    scope: "global",
    defaultShortcuts: ["ctrl+shift+tab"],
  },
  {
    id: "terminal.copy",
    label: "Terminal copy",
    description: "Copy the terminal selection.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+shift+c", "ctrl+shift+c"],
  },
  {
    id: "terminal.paste",
    label: "Terminal paste",
    description: "Paste clipboard text into the terminal.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+shift+v", "ctrl+shift+v"],
  },
  {
    id: "terminal.selectAll",
    label: "Terminal select all",
    description: "Select all text in the terminal buffer.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+a", "ctrl+shift+a"],
  },
  {
    id: "terminal.clear",
    label: "Terminal clear",
    description: "Clear the terminal viewport.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+k", "ctrl+shift+k"],
  },
  {
    id: "terminal.find",
    label: "Terminal find",
    description: "Open terminal search.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+f", "ctrl+f", "ctrl+shift+f"],
  },
  {
    id: "terminal.findNext",
    label: "Terminal find next",
    description: "Jump to the next terminal search result.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+g", "ctrl+g", "f3"],
  },
  {
    id: "terminal.findPrevious",
    label: "Terminal find previous",
    description: "Jump to the previous terminal search result.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+shift+g", "ctrl+shift+g", "shift+f3"],
  },
  {
    id: "terminal.newTab",
    label: "Terminal new tab",
    description: "Create a new terminal tab.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+t"],
  },
  {
    id: "terminal.closeTab",
    label: "Terminal close tab",
    description: "Close the active terminal tab.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+w", "ctrl+w"],
  },
  {
    id: "terminal.reopenTab",
    label: "Terminal reopen tab",
    description: "Reopen the last closed terminal tab.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+shift+t"],
  },
  {
    id: "terminal.clearLine",
    label: "Terminal clear line",
    description: "Clear the current terminal input line.",
    group: "Terminal",
    scope: "terminal",
    defaultShortcuts: ["cmd+backspace", "cmd+delete", "ctrl+backspace"],
  },
];

const SHORTCUT_DEFINITIONS_BY_ID = new Map(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

const normalizeKeyToken = (token: string): string => {
  const normalized = token.trim().toLowerCase();
  if (normalized === "space") {
    return " ";
  }
  if (normalized === "esc") {
    return "escape";
  }
  if (normalized === "return") {
    return "enter";
  }
  if (normalized === "plus") {
    return "+";
  }
  return normalized;
};

const normalizeShortcutList = (shortcutsToNormalize: string[]): string[] => {
  const normalized = shortcutsToNormalize
    .map((shortcut) => normalizeShortcut(shortcut))
    .filter((shortcut): shortcut is string => Boolean(shortcut));

  return Array.from(new Set(normalized));
};

const readPersistedShortcutOverrides = (): Partial<
  Record<ShortcutActionId, string[]>
> | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(KEYBINDINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("state" in parsed)) {
      return null;
    }

    const state = (parsed as { state?: unknown }).state;
    if (
      typeof state !== "object" ||
      state === null ||
      !("overrides" in state)
    ) {
      return null;
    }

    const overrides = (state as { overrides?: unknown }).overrides;
    if (typeof overrides !== "object" || overrides === null) {
      return null;
    }

    const nextOverrides: Partial<Record<ShortcutActionId, string[]>> = {};
    Object.entries(overrides as Record<string, unknown>).forEach(
      ([id, value]) => {
        if (!isShortcutActionId(id) || !Array.isArray(value)) {
          return;
        }

        const normalized = normalizeShortcutList(
          value.filter(
            (shortcut): shortcut is string => typeof shortcut === "string",
          ),
        );
        if (normalized.length > 0) {
          nextOverrides[id] = normalized;
        }
      },
    );

    return nextOverrides;
  } catch {
    return null;
  }
};

export const isShortcutActionId = (value: string): value is ShortcutActionId =>
  SHORTCUT_DEFINITIONS_BY_ID.has(value as ShortcutActionId);

export const getShortcutDefinition = (
  id: ShortcutActionId,
): ShortcutDefinition => {
  const definition = SHORTCUT_DEFINITIONS_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown shortcut action: ${id}`);
  }
  return definition;
};

export const parseShortcut = (shortcut: string): ParsedShortcut | null => {
  const tokens = shortcut
    .trim()
    .toLowerCase()
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  const keyToken = tokens[tokens.length - 1];
  const modifierTokens = tokens.slice(0, -1);
  const modifiers = new Set<ShortcutModifier>();

  for (const token of modifierTokens) {
    const modifier = MODIFIER_ALIASES[token];
    if (!modifier) {
      return null;
    }
    modifiers.add(modifier);
  }

  const key = normalizeKeyToken(keyToken);
  if (!key || MODIFIER_KEYS.has(key)) {
    return null;
  }

  return {
    modifiers: MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  };
};

export const normalizeShortcut = (shortcut: string): string | null => {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return null;
  }

  return [...parsed.modifiers, parsed.key].join("+");
};

export const getDefaultShortcuts = (id: ShortcutActionId): string[] => [
  ...getShortcutDefinition(id).defaultShortcuts,
];

export const getEffectiveShortcuts = (
  id: ShortcutActionId,
  overrides = readPersistedShortcutOverrides(),
): string[] => {
  const normalizedOverride = normalizeShortcutList(overrides?.[id] ?? []);
  if (normalizedOverride.length > 0) {
    return normalizedOverride;
  }

  return normalizeShortcutList(getDefaultShortcuts(id));
};

export const eventToShortcut = (event: KeyboardEvent): string | null => {
  const key = normalizeKeyToken(getPhysicalKey(event));
  if (!key || MODIFIER_KEYS.has(key)) {
    return null;
  }

  const modifiers: ShortcutModifier[] = [];
  if (event.metaKey) modifiers.push("cmd");
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");

  return [...modifiers, key].join("+");
};

export const isShortcutEvent = (
  event: KeyboardEvent,
  shortcut: string,
  options: { exact?: boolean } = {},
): boolean => {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }

  const needs = new Set(parsed.modifiers);
  const exact = options.exact ?? true;

  if (exact) {
    if (event.metaKey !== needs.has("cmd")) return false;
    if (event.ctrlKey !== needs.has("ctrl")) return false;
    if (event.altKey !== needs.has("alt")) return false;
    if (event.shiftKey !== needs.has("shift")) return false;
  } else {
    if (needs.has("cmd") && !event.metaKey) return false;
    if (needs.has("ctrl") && !event.ctrlKey) return false;
    if (needs.has("alt") && !event.altKey) return false;
    if (needs.has("shift") && !event.shiftKey) return false;
  }

  return isKey(event, parsed.key);
};

export const matchesActionShortcut = (
  event: KeyboardEvent,
  id: ShortcutActionId,
  options: { exact?: boolean } = {},
): boolean =>
  getEffectiveShortcuts(id).some((shortcut) =>
    isShortcutEvent(event, shortcut, options),
  );

export const formatShortcut = (shortcut: string): string => {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return shortcut;
  }

  const labelMap: Record<string, string> = {
    cmd: "cmd",
    ctrl: "ctrl",
    alt: "alt",
    shift: "shift",
    " ": "space",
  };

  return [...parsed.modifiers, parsed.key]
    .map((part) => labelMap[part] ?? part)
    .join("+");
};

/**
 * Get the physical key pressed, independent of keyboard layout
 * Returns lowercase letter for consistency
 */
export function getPhysicalKey(e: KeyboardEvent): string {
  // First try to use code (physical key position)
  if (e.code && CODE_TO_KEY[e.code]) {
    return CODE_TO_KEY[e.code];
  }
  // Fallback to key for special keys
  return e.key.toLowerCase();
}

/**
 * Check if a specific key was pressed (layout-independent)
 */
export function isKey(e: KeyboardEvent, key: string): boolean {
  const physicalKey = getPhysicalKey(e);
  return physicalKey === key.toLowerCase();
}

/**
 * Check for keyboard shortcut (layout-independent)
 * Example: isShortcut(e, 'cmd+k') or isShortcut(e, 'ctrl+shift+f')
 */
export function isShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop() || "";
  const modifiers = parts;

  // Check modifiers
  const needsMeta = modifiers.includes("cmd") || modifiers.includes("meta");
  const needsCtrl = modifiers.includes("ctrl");
  const needsShift = modifiers.includes("shift");
  const needsAlt = modifiers.includes("alt") || modifiers.includes("opt");

  // On macOS, cmd is metaKey; on Windows/Linux, ctrl is more common
  const metaOrCtrl = modifiers.includes("cmdorctrl");

  if (metaOrCtrl) {
    if (!(e.metaKey || e.ctrlKey)) return false;
  } else {
    if (needsMeta && !e.metaKey) return false;
    if (needsCtrl && !e.ctrlKey) return false;
  }

  if (needsShift && !e.shiftKey) return false;
  if (needsAlt && !e.altKey) return false;

  // Check the actual key
  return isKey(e, key);
}

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

/**
 * Shorthand helpers for common shortcuts
 */
export const shortcuts = {
  // Navigation & UI
  unifiedSearch: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "search.toggle"),
  openProject: (e: KeyboardEvent) => matchesActionShortcut(e, "project.open"),
  newProject: (e: KeyboardEvent) => matchesActionShortcut(e, "project.new"),
  quickOpen: (e: KeyboardEvent) => matchesActionShortcut(e, "problems.toggle"),
  toggleExplorer: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "explorer.toggle"),
  toggleSidebar: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "explorer.toggle"),
  toggleTerminal: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.toggle"),
  switchProjectNext: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "project.switchNext"),
  switchProjectPrev: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "project.switchPrevious"),
  toggleAI: (e: KeyboardEvent) => matchesActionShortcut(e, "ai.toggle"),
  toggleSettings: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "settings.toggle"),
  toggleGit: (e: KeyboardEvent) => matchesActionShortcut(e, "git.toggle"),
  toggleGitFullscreen: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "git.fullscreen"),
  toggleProblems: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "problems.toggle"),
  toggleProblemsFullscreen: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "problems.fullscreen"),
  copyProjectPath: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "project.copyPath"),
  openBrowserPreview: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "browser.preview"),

  // File operations
  save: (e: KeyboardEvent) => matchesActionShortcut(e, "editor.save"),
  closeTab: (e: KeyboardEvent) => matchesActionShortcut(e, "editor.closeTab"),
  reopenTab: (e: KeyboardEvent) => matchesActionShortcut(e, "editor.reopenTab"),
  switchEditorTabNext: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "editor.switchTabNext"),
  switchEditorTabPrev: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "editor.switchTabPrevious"),

  // Zoom
  zoomIn: (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) {
      return false;
    }

    return (
      isKey(e, "=") ||
      isKey(e, "+") ||
      e.code === "NumpadAdd" ||
      e.code === "NumpadEqual"
    );
  },
  zoomOut: (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) {
      return false;
    }

    return isKey(e, "-") || e.code === "NumpadSubtract";
  },
  zoomReset: (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) {
      return false;
    }

    return isKey(e, "0") || e.code === "Numpad0";
  },

  // General
  escape: (e: KeyboardEvent) => isKey(e, "escape"),
  enter: (e: KeyboardEvent) => isKey(e, "enter"),
  tab: (e: KeyboardEvent) => isKey(e, "tab"),
  arrowUp: (e: KeyboardEvent) => isKey(e, "arrowup"),
  arrowDown: (e: KeyboardEvent) => isKey(e, "arrowdown"),

  // Completion popup
  acceptCompletion: (e: KeyboardEvent) => isKey(e, "tab"),
  nextCompletion: (e: KeyboardEvent) => isKey(e, "arrowdown"),
  prevCompletion: (e: KeyboardEvent) => isKey(e, "arrowup"),
  closeCompletion: (e: KeyboardEvent) => isKey(e, "escape"),
  cycleCompletion: (e: KeyboardEvent) =>
    isShortcut(e, "alt+]") || isShortcut(e, "ctrl+]"),
  cycleCompletionBack: (e: KeyboardEvent) =>
    isShortcut(e, "alt+[") || isShortcut(e, "ctrl+["),

  // Terminal shortcuts
  terminalCopy: (e: KeyboardEvent) => matchesActionShortcut(e, "terminal.copy"),
  terminalPaste: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.paste"),
  terminalSelectAll: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.selectAll"),
  terminalClear: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.clear"),
  terminalFind: (e: KeyboardEvent) => matchesActionShortcut(e, "terminal.find"),
  terminalFindNext: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.findNext"),
  terminalFindPrev: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.findPrevious"),
  terminalNewTab: (e: KeyboardEvent) =>
    isMacPlatform()
      ? matchesActionShortcut(e, "terminal.newTab")
      : isShortcut(e, "ctrl+t"),
  terminalCloseTab: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.closeTab"),
  terminalReopenTab: (e: KeyboardEvent) =>
    isMacPlatform()
      ? matchesActionShortcut(e, "terminal.reopenTab")
      : isShortcut(e, "ctrl+shift+t"),
  terminalClearLine: (e: KeyboardEvent) =>
    matchesActionShortcut(e, "terminal.clearLine"),
};
