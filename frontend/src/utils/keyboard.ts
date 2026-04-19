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
    isShortcut(e, "cmd+f") || isShortcut(e, "ctrl+f"),
  openProject: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+o") || isShortcut(e, "ctrl+o"),
  newProject: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+n") || isShortcut(e, "ctrl+n"),
  quickOpen: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+p") || isShortcut(e, "ctrl+p"),
  toggleSidebar: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+b") || isShortcut(e, "ctrl+b"),
  toggleTerminal: (e: KeyboardEvent) => isShortcut(e, "ctrl+`"),
  switchProjectNext: (e: KeyboardEvent) => isShortcut(e, "cmd+`"),
  switchProjectPrev: (e: KeyboardEvent) => isShortcut(e, "cmd+shift+`"),
  toggleAI: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+r") || isShortcut(e, "ctrl+r"),
  toggleSettings: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+,") || isShortcut(e, "ctrl+,"),

  // File operations
  save: (e: KeyboardEvent) => isShortcut(e, "cmd+s") || isShortcut(e, "ctrl+s"),
  closeTab: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+w") || isShortcut(e, "ctrl+w"),
  reopenTab: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+shift+t") || isShortcut(e, "ctrl+shift+t"),
  switchEditorTabNext: (e: KeyboardEvent) =>
    e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && isKey(e, "tab"),
  switchEditorTabPrev: (e: KeyboardEvent) =>
    e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && isKey(e, "tab"),

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
  terminalCopy: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+shift+c") || isShortcut(e, "ctrl+shift+c"),
  terminalPaste: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+shift+v") || isShortcut(e, "ctrl+shift+v"),
  terminalSelectAll: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+a") || isShortcut(e, "ctrl+shift+a"),
  terminalClear: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+k") || isShortcut(e, "ctrl+shift+k"),
  terminalFind: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+f") ||
    isShortcut(e, "ctrl+f") ||
    isShortcut(e, "ctrl+shift+f"),
  terminalFindNext: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+g") || isShortcut(e, "ctrl+g") || isKey(e, "f3"),
  terminalFindPrev: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+shift+g") ||
    isShortcut(e, "ctrl+shift+g") ||
    (isKey(e, "f3") && e.shiftKey),
  terminalNewTab: (e: KeyboardEvent) =>
    isMacPlatform() ? isShortcut(e, "cmd+t") : isShortcut(e, "ctrl+t"),
  terminalCloseTab: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+w") || isShortcut(e, "ctrl+w"),
  terminalReopenTab: (e: KeyboardEvent) =>
    isMacPlatform()
      ? isShortcut(e, "cmd+shift+t")
      : isShortcut(e, "ctrl+shift+t"),
  terminalClearLine: (e: KeyboardEvent) =>
    isShortcut(e, "cmd+backspace") ||
    isShortcut(e, "cmd+delete") ||
    isShortcut(e, "ctrl+backspace"),
};
