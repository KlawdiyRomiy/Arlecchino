import { shortcuts } from "./keyboard";

export const isTerminalFocusedElement = (element: Element | null): boolean => {
  if (!element) {
    return false;
  }

  return (
    (element instanceof HTMLElement &&
      element.dataset.terminalSearchInput === "true") ||
    element.classList.contains("xterm-helper-textarea") ||
    element.classList.contains("xterm") ||
    element.closest(".xterm") !== null ||
    element.closest('[data-terminal-search-root="true"]') !== null
  );
};

export const shouldBypassGlobalFindShortcuts = (
  event: KeyboardEvent,
  activeElement: Element | null,
): boolean => {
  if (!isTerminalFocusedElement(activeElement)) {
    return false;
  }

  return shortcuts.terminalFind(event);
};

interface TerminalShortcutContextInput {
  activeElement: Element | null;
  tuiModeActive: boolean;
  terminalPanelVisible: boolean;
}

export const isTerminalShortcutContext = ({
  activeElement,
  tuiModeActive,
  terminalPanelVisible: _terminalPanelVisible,
}: TerminalShortcutContextInput): boolean => {
  if (isTerminalFocusedElement(activeElement)) {
    return true;
  }

  if (tuiModeActive) {
    return true;
  }

  return false;
};
