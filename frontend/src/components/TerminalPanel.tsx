import React, { useRef, useEffect, useCallback, useState } from "react";
import ReactDOM from "react-dom";
import {
  ClipboardPaste,
  Copy,
  Eraser,
  Plus,
  RotateCcw,
  Search,
  X,
  SplitSquareHorizontal,
  SplitSquareVertical,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { getThemeColors } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { useTerminalStore } from "../stores/terminalStore";
import { shortcuts } from "../utils/keyboard";
import {
  createEmptyTerminalSearchStats,
  countTerminalSearchMatches,
  getNextTerminalMatchIndex,
  readTerminalBufferLines,
  type TerminalSearchDirection,
  type TerminalSearchStats,
} from "../utils/terminalSearch";
import { TERMINAL_FIND_EVENT } from "../utils/searchEvents";
import { recordTerminalPerf } from "../utils/terminalPerf";
import {
  readClipboardTextWithFallback,
  writeClipboardTextWithFallback,
} from "../utils/clipboard";
import { CommandAutocomplete } from "./CommandAutocomplete";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";
import {
  PredictTerminalCommand,
  RecordCommandExecution,
  WriteTerminal,
  GetCurrentProjectID,
} from "../wails/app";
import { ClipboardGetText, ClipboardSetText } from "../wails/runtime";

interface TerminalPanelProps {
  onAddTab?: () => void;
  onOpenFileRef?: (path: string, line?: number, column?: number) => void;
  onOpenPreviewUrl?: (url: string, sessionId: string) => void;
}

type TerminalSearchViewState = TerminalSearchStats & {
  visible: boolean;
};

const createSearchViewState = (
  query = "",
  visible = false,
): TerminalSearchViewState => ({
  ...createEmptyTerminalSearchStats(query),
  visible,
});

const PANEL_DROP_SETTLING_CONTAINER_SELECTOR = "[data-panel-drop-settling]";
const PANEL_DROP_SETTLING_SELECTOR = '[data-panel-drop-settling="true"]';

export const TerminalPanelContent: React.FC<TerminalPanelProps> = ({
  onAddTab,
  onOpenFileRef,
  onOpenPreviewUrl,
}) => {
  const { isDark, resolvedThemeId } = useTheme();
  const theme = getThemeColors(isDark);
  const [error, setError] = useState<string | null>(null);
  const [autocompleteState, setAutocompleteState] = useState({
    visible: false,
    input: "",
    position: { x: 0, y: 0 },
  });
  const [ghostText, setGhostText] = useState<string>("");
  const [searchState, setSearchState] = useState<TerminalSearchViewState>(
    createSearchViewState(),
  );

  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const projectIDRef = useRef<string>("");
  const workDirRef = useRef<string>("");
  const activeProjectPath = useTerminalStore(
    (state) => state.activeProjectPath,
  );

  useEffect(() => {
    let disposed = false;
    workDirRef.current = activeProjectPath ?? "";
    projectIDRef.current = "";

    const loadProjectID = async () => {
      try {
        const pid = await GetCurrentProjectID();
        if (!disposed && workDirRef.current === (activeProjectPath ?? "")) {
          projectIDRef.current = pid;
        }
      } catch (err) {
        console.error("[TerminalPrediction] Failed to load context:", err);
      }
    };
    void loadProjectID();

    return () => {
      disposed = true;
    };
  }, [activeProjectPath]);

  const {
    sessions,
    panes,
    activePaneId,
    splitDirection,
    isInitialized,
    initialize,
    createTerminal,
    closeTerminal,
    reopenLastClosedTab,
    setActiveTab,
    setActivePane,
    splitPane,
    getSession,
    updateTheme,
    tuiModeActive,
    tuiActiveSessionId,
    isArlePaused,
    sessionSemanticEntries,
  } = useTerminalStore();

  const activePane = panes.find((p) => p.id === activePaneId);
  const activeTabId = activePane?.activeTabId || "";
  const activeSession = activePane
    ? sessions.get(activePane.activeTabId)
    : undefined;
  const isActiveSessionInTUI =
    !!activeSession &&
    tuiModeActive &&
    (tuiActiveSessionId === null || tuiActiveSessionId === activeSession.id);
  const panesForRender = tuiModeActive && activePane ? [activePane] : panes;

  const inputBufferRef = useRef("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchQueryRef = useRef("");
  const searchVisibleRef = useRef(false);
  const searchStatsBySessionRef = useRef<Map<string, TerminalSearchStats>>(
    new Map(),
  );
  const terminalFindHandledAtRef = useRef(0);
  const ghostTextRef = useRef<HTMLDivElement | null>(null);
  const ghostTextValueRef = useRef("");
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const injectedSkipRef = useRef(0); // skip counting chars we inject via paste
  const ghostIdleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clearGhostImmediate = useCallback(() => {
    ghostTextValueRef.current = "";
    setGhostText("");
    if (suggestDebounceRef.current) {
      clearTimeout(suggestDebounceRef.current);
      suggestDebounceRef.current = undefined;
    }
    if (ghostIdleTimerRef.current) {
      clearTimeout(ghostIdleTimerRef.current);
      ghostIdleTimerRef.current = undefined;
    }
  }, []);

  const findInTerminal = useCallback(
    (
      query: string,
      direction: TerminalSearchDirection = "next",
      reason: "input" | "navigate" = "navigate",
    ): TerminalSearchStats => {
      const active = activeSession;
      if (!active) {
        return createEmptyTerminalSearchStats(query);
      }

      return recordTerminalPerf(
        "search.navigate",
        () => {
          const normalizedQuery = query.trim();
          if (!normalizedQuery) {
            const emptyStats = createEmptyTerminalSearchStats("");
            searchStatsBySessionRef.current.set(active.id, emptyStats);
            searchQueryRef.current = "";
            setSearchState((prev) => ({
              ...prev,
              totalMatches: 0,
              currentMatch: 0,
              noMatches: false,
            }));
            return emptyStats;
          }

          const lines = readTerminalBufferLines(active.terminal, 3000);
          const totalMatches = countTerminalSearchMatches(
            lines,
            normalizedQuery,
          );
          const previousStats =
            searchStatsBySessionRef.current.get(active.id) ??
            createEmptyTerminalSearchStats();
          const queryChanged = previousStats.query !== normalizedQuery;

          const searchOptions = {
            incremental: true,
            caseSensitive: false,
          };

          const found =
            direction === "prev"
              ? active.searchAddon.findPrevious(normalizedQuery, searchOptions)
              : active.searchAddon.findNext(normalizedQuery, searchOptions);

          const hasMatches = totalMatches > 0 && found;
          const currentMatch = hasMatches
            ? queryChanged || reason === "input"
              ? 1
              : getNextTerminalMatchIndex(
                  previousStats.currentMatch,
                  totalMatches,
                  direction,
                )
            : 0;

          const nextStats: TerminalSearchStats = {
            query: normalizedQuery,
            totalMatches,
            currentMatch,
            noMatches: !hasMatches,
          };

          searchStatsBySessionRef.current.set(active.id, nextStats);
          searchQueryRef.current = normalizedQuery;
          setSearchState((prev) => ({
            ...prev,
            totalMatches: nextStats.totalMatches,
            currentMatch: nextStats.currentMatch,
            noMatches: nextStats.noMatches,
          }));

          return nextStats;
        },
        {
          direction,
          reason,
          queryLength: query.length,
          sessionId: active.id,
        },
      );
    },
    [activeSession],
  );

  const closeSearchPanel = useCallback(() => {
    setSearchState((prev) => ({ ...prev, visible: false }));
    activeSession?.terminal.focus();
  }, [activeSession]);

  const openActiveTerminalSearchFromShortcut = useCallback(() => {
    const terminal = activeSession?.terminal;
    if (!terminal) {
      return;
    }

    const selectedText = terminal.getSelection().trim();
    const nextQuery = selectedText || searchQueryRef.current;
    searchQueryRef.current = nextQuery;
    setSearchState((prev) => ({
      ...prev,
      visible: true,
      query: nextQuery,
    }));
    findInTerminal(nextQuery, "next", "input");
  }, [activeSession, findInTerminal]);

  const openTerminalSearchFromShortcut = useCallback(() => {
    const now = performance.now();
    if (now - terminalFindHandledAtRef.current < 120) {
      return;
    }
    terminalFindHandledAtRef.current = now;
    openActiveTerminalSearchFromShortcut();
  }, [openActiveTerminalSearchFromShortcut]);

  useEffect(() => {
    window.addEventListener(
      TERMINAL_FIND_EVENT,
      openTerminalSearchFromShortcut,
    );
    return () =>
      window.removeEventListener(
        TERMINAL_FIND_EVENT,
        openTerminalSearchFromShortcut,
      );
  }, [openTerminalSearchFromShortcut]);

  useEffect(() => {
    if (!activeSession) {
      const emptyStats = createEmptyTerminalSearchStats("");
      searchQueryRef.current = "";
      setSearchState((prev) => ({ ...prev, ...emptyStats }));
      return;
    }

    const sessionStats =
      searchStatsBySessionRef.current.get(activeSession.id) ??
      createEmptyTerminalSearchStats("");
    searchQueryRef.current = sessionStats.query;
    setSearchState((prev) => ({ ...prev, ...sessionStats }));
  }, [activeSession?.id]);

  useEffect(() => {
    searchVisibleRef.current = searchState.visible;
  }, [searchState.visible]);

  useEffect(() => {
    if (!searchState.visible) {
      return;
    }

    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, [searchState.visible]);

  useEffect(() => {
    if (!activeSession?.terminal) return;

    if (isActiveSessionInTUI || isArlePaused) {
      clearGhostImmediate();
      setAutocompleteState((s) => ({ ...s, visible: false, input: "" }));
      return;
    }

    const setGhostTextWithRef = (text: string) => {
      ghostTextValueRef.current = text;
      setGhostText(text);

      if (ghostIdleTimerRef.current) {
        clearTimeout(ghostIdleTimerRef.current);
        ghostIdleTimerRef.current = undefined;
      }
      if (text) {
        ghostIdleTimerRef.current = setTimeout(() => {
          clearGhostImmediate();
        }, 5000); // auto-hide ghost after idle (almost instant)
      }
    };

    // Get completion suffix for input
    // input: "php ar" -> returns "tisan" (to complete "artisan")
    // input: "php artisan make:mo" -> returns "del" (to complete "make:model")
    const getCompletionSuffix = async (input: string): Promise<string> => {
      if (!input || input.length < 2) return "";

      try {
        const response = await PredictTerminalCommand({
          input,
          workDir: workDirRef.current,
          projectID: projectIDRef.current,
        });

        if (response.predictions && response.predictions.length > 0) {
          const prediction = response.predictions[0];

          if (prediction.Output) {
            const firstLine = prediction.Output.split("\n")[0].trim();
            if (firstLine.length > 50) {
              return " → " + firstLine.slice(0, 47) + "...";
            }
            return " → " + firstLine;
          }

          const lastToken = input.split(/\s+/).pop() || "";
          const suggestion = prediction.Completion;
          if (
            suggestion &&
            suggestion.toLowerCase().startsWith(lastToken.toLowerCase()) &&
            suggestion !== lastToken
          ) {
            return suggestion.slice(lastToken.length);
          }
        }
      } catch (e) {
        console.error("[GhostText] Error:", e);
      }

      return "";
    };

    const updateGhostText = async (input: string) => {
      const suffix = await getCompletionSuffix(input);
      setGhostTextWithRef(suffix);
    };

    const disposable = activeSession.terminal.onData((data) => {
      const state = useTerminalStore.getState();
      if (
        state.isArlePaused ||
        (state.tuiModeActive && state.tuiActiveSessionId === activeSession.id)
      ) {
        clearGhostImmediate();
        setAutocompleteState((s) => ({ ...s, visible: false, input: "" }));
        return;
      }

      // If we just injected completion via paste, skip counting these chars
      if (injectedSkipRef.current > 0) {
        injectedSkipRef.current -= data.length;
        if (injectedSkipRef.current < 0) injectedSkipRef.current = 0;
        return;
      }

      // Option+Backspace - delete word (ESC + DEL sequence from Mac)
      if (data === "\x17" || data === "\x1b\x7f") {
        // Ctrl+W or Alt+Backspace
        // Delete last word from buffer
        const words = inputBufferRef.current.trimEnd().split(/\s+/);
        if (words.length > 0) {
          words.pop();
          inputBufferRef.current =
            words.join(" ") + (words.length > 0 ? " " : "");
        }
        // Let terminal handle the actual deletion
        return;
      }

      // Ctrl+U - delete entire line (received when shell processes it)
      if (data === "\x15") {
        inputBufferRef.current = "";
        clearGhostImmediate();
        return;
      }

      // Tab is handled by customKeyHandler - if we still see it here, it leaked to PTY
      if (data === "\t") {
        return;
      }

      // ESC sequences in onData come from terminal OUTPUT (prompts, colors, etc.)
      // NOT from user arrow key presses - those are handled in customKeyHandler
      // So we should NOT clear ghost text here, as it would break after command output
      if (data.startsWith("\x1b")) {
        // Just ignore terminal escape sequences in the buffer logic
        return;
      }

      // Reset on Enter, Ctrl+C, or other control sequences
      if (data === "\r" || data === "\n" || data === "\x03") {
        const finalInput = inputBufferRef.current.trim();
        if (data === "\r" && finalInput) {
          GetCurrentProjectID()
            .catch(() => projectIDRef.current)
            .then((projectID) => {
              projectIDRef.current = projectID;
              return RecordCommandExecution(
                projectID,
                finalInput,
                workDirRef.current,
              );
            })
            .catch((err) => {
              console.error("[TerminalPrediction] Record failed:", err);
            });
        }
        inputBufferRef.current = "";
        setGhostTextWithRef("");
        setAutocompleteState((s) => ({ ...s, visible: false, input: "" }));
        return;
      }

      // Handle backspace - update buffer and refresh suggestions
      if (data === "\x7f" || data === "\b") {
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        // Immediately update ghost text after backspace
        const input = inputBufferRef.current.trim();
        if (suggestDebounceRef.current) {
          clearTimeout(suggestDebounceRef.current);
        }
        suggestDebounceRef.current = setTimeout(
          () => updateGhostText(input),
          50,
        );
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        inputBufferRef.current += data;
      }

      const input = inputBufferRef.current.trim();
      if (input.length === 0) {
        clearGhostImmediate();
      }

      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
      }
      suggestDebounceRef.current = setTimeout(
        () => updateGhostText(input),
        100,
      );

      // Disable CommandAutocomplete popup - we use ghost text instead
      // Only show popup for very specific cases like after "php artisan " with space
      // For now, disable it completely to avoid confusion
      setAutocompleteState((s) => ({ ...s, visible: false }));
    });

    return () => {
      disposable.dispose();
      if (suggestDebounceRef.current) {
        clearTimeout(suggestDebounceRef.current);
      }
      if (ghostIdleTimerRef.current) {
        clearTimeout(ghostIdleTimerRef.current);
      }
    };
  }, [activeSession, clearGhostImmediate, isActiveSessionInTUI, isArlePaused]);

  const handleAutocompleteSelect = useCallback(
    (text: string) => {
      if (isActiveSessionInTUI || isArlePaused) return;
      if (!activeSession?.terminal) return;
      activeSession.terminal.paste(text + " ");
      inputBufferRef.current += text + " ";
      ghostTextValueRef.current = "";
      setGhostText("");
      setAutocompleteState((s) => ({ ...s, visible: false }));
      activeSession.terminal.focus();
    },
    [activeSession, isActiveSessionInTUI, isArlePaused],
  );

  // Handle Tab key and shortcuts using attachCustomKeyEventHandler
  useEffect(() => {
    if (!activeSession?.terminal) return;

    const terminal = activeSession.terminal;
    const keyHandlerTimers = new Set<ReturnType<typeof setTimeout>>();
    let disposed = false;
    const scheduleKeyHandlerTimeout = (
      callback: () => void | Promise<void>,
      delay: number,
    ) => {
      const timer = setTimeout(() => {
        keyHandlerTimers.delete(timer);
        if (!disposed) {
          void callback();
        }
      }, delay);
      keyHandlerTimers.add(timer);
    };

    const getCompletionSuffix = async (input: string): Promise<string> => {
      if (!input || input.length < 2) return "";

      const lastToken = input.split(/\s+/).pop() || "";
      if (!lastToken) return "";

      try {
        const response = await PredictTerminalCommand({
          input,
          workDir: workDirRef.current,
          projectID: projectIDRef.current,
        });

        if (response.predictions && response.predictions.length > 0) {
          let best: string | null = null;
          let bestSuffixLen = Number.POSITIVE_INFINITY;
          for (const pred of response.predictions) {
            const txt = pred.Completion;
            if (!txt.toLowerCase().startsWith(lastToken.toLowerCase()))
              continue;
            if (txt === lastToken) {
              return "";
            }
            const suffixLen = txt.length - lastToken.length;
            if (suffixLen < bestSuffixLen) {
              bestSuffixLen = suffixLen;
              best = txt;
            }
          }
          if (best) {
            return best.slice(lastToken.length);
          }
        }
      } catch {
        // ignore
      }

      return "";
    };

    // Read current line from terminal buffer (for history navigation sync)
    const readCurrentLineFromTerminal = (): string | null => {
      const term: any = activeSession.terminal as any;
      const buffer = term.buffer?.active;
      if (!buffer) return null;

      const cursorY = buffer.cursorY ?? 0;
      const line = buffer.getLine(buffer.baseY + cursorY);
      if (!line) return null;

      // Get the line text and trim trailing whitespace
      let text = line.translateToString(true);

      // Try to extract just the command part (after prompt)
      // Common prompt patterns: "❯ ", "> ", "$ ", "% ", "→ "
      const promptPatterns = [/^.*[❯>$%→]\s*/, /^.*:\s*/, /^[^a-zA-Z]*\s*/];
      for (const pattern of promptPatterns) {
        const match = text.match(pattern);
        if (match && match[0].length < text.length * 0.7) {
          text = text.slice(match[0].length);
          break;
        }
      }

      return text.trim();
    };

    // Custom key handler - returns false to block key, true to allow
    const sendRawToPty = (payload: string) => {
      if (!activeSession) return;
      const bytes = new TextEncoder().encode(payload);
      const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
      WriteTerminal(activeSession.id, btoa(binary));
    };

    const customKeyHandler = (e: KeyboardEvent): boolean => {
      const state = useTerminalStore.getState();
      const isActiveTUISession =
        state.tuiModeActive && state.tuiActiveSessionId === activeSession.id;
      const shouldSuppressAutocomplete =
        state.isArlePaused || isActiveTUISession;

      if (shouldSuppressAutocomplete) {
        clearGhostImmediate();
      }

      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      if (shortcuts.terminalNewTab(e)) {
        e.preventDefault();
        e.stopPropagation();
        void createTerminal(activePaneId, resolvedThemeId);
        return false;
      }

      if (shortcuts.terminalCloseTab(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (activeSession) {
          void closeTerminal(activePaneId, activeSession.id);
        }
        return false;
      }

      if (shortcuts.terminalReopenTab(e)) {
        e.preventDefault();
        e.stopPropagation();
        void reopenLastClosedTab(resolvedThemeId);
        return false;
      }

      if (shortcuts.terminalClearLine(e)) {
        e.preventDefault();
        e.stopPropagation();
        sendRawToPty("\u0015");
        inputBufferRef.current = "";
        clearGhostImmediate();
        return false;
      }

      // Handle Tab key for ghost text completion
      if (!shouldSuppressAutocomplete && e.key === "Tab" && !e.shiftKey) {
        // Only intercept Tab if we have ghost text to complete
        // Otherwise, let it pass through to shell for native completion (cd, files, etc.)
        if (ghostTextValueRef.current) {
          e.preventDefault();
          e.stopPropagation();

          // Insert the ghost text completion
          const completionText = ghostTextValueRef.current;
          // Use paste to send to PTY (shell will receive these characters)
          injectedSkipRef.current += completionText.length;
          terminal.paste(completionText);
          inputBufferRef.current += completionText;

          // Clear ghost text
          ghostTextValueRef.current = "";
          setGhostText("");

          // Cancel any pending suggestion debounce to avoid stale suffix
          if (suggestDebounceRef.current) {
            clearTimeout(suggestDebounceRef.current);
            suggestDebounceRef.current = undefined;
          }

          // Get new suggestions after a short delay
          const newInput = inputBufferRef.current.trim();
          scheduleKeyHandlerTimeout(async () => {
            const suffix = await getCompletionSuffix(newInput);
            if (disposed) {
              return;
            }
            ghostTextValueRef.current = suffix;
            setGhostText(suffix);
          }, 150);

          return false; // Block only when we handled it
        }

        // No ghost text - let Tab pass through to shell for native completion
        return true;
      }

      // Arrow/Home/End — при навигации по истории нужно обновить буфер
      if (
        !shouldSuppressAutocomplete &&
        ["ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        // Clear ghost immediately, shell will insert history command
        clearGhostImmediate();

        // After shell processes arrow, read the current line from terminal buffer
        scheduleKeyHandlerTimeout(() => {
          const currentLine = readCurrentLineFromTerminal();
          if (currentLine !== null) {
            inputBufferRef.current = currentLine;
            // Trigger ghost text update for the new line
            if (currentLine.trim().length >= 3) {
              if (suggestDebounceRef.current) {
                clearTimeout(suggestDebounceRef.current);
              }
              suggestDebounceRef.current = setTimeout(async () => {
                const suffix = await getCompletionSuffix(currentLine.trim());
                ghostTextValueRef.current = suffix;
                setGhostText(suffix);
              }, 100);
            }
          }
        }, 50); // Small delay to let shell process the arrow key

        return true;
      }

      // ArrowLeft/Right, Home/End — just clear ghost, don't update buffer
      if (
        !shouldSuppressAutocomplete &&
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
      ) {
        clearGhostImmediate();
        return true;
      }

      if (shortcuts.terminalCopy(e)) {
        const selectedText = terminal.getSelection();
        if (!selectedText) {
          return true;
        }

        e.preventDefault();
        e.stopPropagation();
        void writeClipboardTextWithFallback(
          selectedText,
          ClipboardSetText,
        ).then((ok) => {
          if (!ok) {
            console.error("[Terminal] Failed to copy selection to clipboard");
          }
        });
        terminal.clearSelection();
        return false;
      }

      if (shortcuts.terminalPaste(e)) {
        e.preventDefault();
        e.stopPropagation();
        void readClipboardTextWithFallback(ClipboardGetText)
          .then((text) => {
            if (text) {
              terminal.paste(text);
            }
          })
          .catch((error) => {
            console.error("[Terminal] Failed to read clipboard text", error);
          });
        return false;
      }

      if (shortcuts.terminalSelectAll(e)) {
        e.preventDefault();
        e.stopPropagation();
        terminal.selectAll();
        return false;
      }

      if (shortcuts.terminalClear(e)) {
        e.preventDefault();
        e.stopPropagation();
        inputBufferRef.current = "";
        clearGhostImmediate();
        terminal.clear();
        return false;
      }

      if (shortcuts.terminalFind(e)) {
        e.preventDefault();
        e.stopPropagation();
        openTerminalSearchFromShortcut();
        return false;
      }

      const findPrevious = shortcuts.terminalFindPrev(e);
      if (shortcuts.terminalFindNext(e) || findPrevious) {
        e.preventDefault();
        e.stopPropagation();

        const selectedText = terminal.getSelection().trim();
        const nextQuery = selectedText || searchQueryRef.current;
        if (!nextQuery) {
          findInTerminal("", "next", "input");
          setSearchState((prev) => ({ ...prev, visible: true, query: "" }));
          return false;
        }

        searchQueryRef.current = nextQuery;
        if (!searchVisibleRef.current) {
          setSearchState((prev) => ({
            ...prev,
            visible: true,
            query: nextQuery,
          }));
        } else {
          setSearchState((prev) => ({
            ...prev,
            query: prev.query || nextQuery,
          }));
        }

        findInTerminal(nextQuery, findPrevious ? "prev" : "next", "navigate");
        return false;
      }

      // Cmd+Z / Cmd+Shift+Z — forward as Ctrl+Z to the shell
      if (cmdKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        sendRawToPty("\u001a");
        return false;
      }

      return true;
    };

    terminal.attachCustomKeyEventHandler(customKeyHandler);

    return () => {
      disposed = true;
      keyHandlerTimers.forEach((timer) => clearTimeout(timer));
      keyHandlerTimers.clear();
      terminal.attachCustomKeyEventHandler(() => true);
    };
  }, [
    activePaneId,
    activeTabId,
    activeSession,
    clearGhostImmediate,
    closeTerminal,
    createTerminal,
    findInTerminal,
    openTerminalSearchFromShortcut,
    reopenLastClosedTab,
    resolvedThemeId,
  ]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    updateTheme(resolvedThemeId);
  }, [resolvedThemeId, updateTheme]);

  const hasCreatedInitialTerminal = useRef(false);

  useEffect(() => {
    if (!isInitialized || hasCreatedInitialTerminal.current) {
      return;
    }

    hasCreatedInitialTerminal.current = true;
    const targetPanes = panes.filter((pane) => pane.tabIds.length === 0);
    if (targetPanes.length === 0) {
      return;
    }

    Promise.all(
      targetPanes.map((pane) => createTerminal(pane.id, resolvedThemeId)),
    ).catch((err) => {
      setError(err?.message || "Failed to create terminal session");
    });
  }, [createTerminal, isInitialized, panes, resolvedThemeId]);

  const attachTerminal = useCallback(
    (tabId: string, container: HTMLDivElement | null) => {
      if (!container) return;

      const session = getSession(tabId);
      if (!session) return;

      const existingXterm = container.querySelector(".xterm");
      if (existingXterm) {
        requestAnimationFrame(() => {
          session.fitAddon.fit();
        });
        return;
      }

      const termElement = session.terminal.element;
      if (termElement && termElement.parentElement) {
        if (termElement.parentElement !== container) {
          container.appendChild(termElement);
        }
        requestAnimationFrame(() => {
          session.fitAddon.fit();
          session.terminal.focus();
        });
        return;
      }

      session.terminal.open(container);

      requestAnimationFrame(() => {
        session.fitAddon.fit();
        session.terminal.focus();
      });
    },
    [getSession],
  );

  useEffect(() => {
    let resizeFrame: number | null = null;
    let panelLayoutObserver: MutationObserver | null = null;
    let deferredPanelLayoutFit = false;

    const isPanelDropSettling = (): boolean =>
      Array.from(containerRefs.current.values()).some(
        (container) => container.closest(PANEL_DROP_SETTLING_SELECTOR) !== null,
      );

    const disconnectPanelLayoutObserver = () => {
      panelLayoutObserver?.disconnect();
      panelLayoutObserver = null;
    };

    const ensurePanelLayoutObserver = () => {
      if (
        typeof MutationObserver === "undefined" ||
        panelLayoutObserver !== null
      ) {
        return;
      }

      const observedContainer = Array.from(containerRefs.current.values())
        .map((container) =>
          container.closest<HTMLElement>(
            PANEL_DROP_SETTLING_CONTAINER_SELECTOR,
          ),
        )
        .find((container): container is HTMLElement => Boolean(container));
      if (!observedContainer) {
        return;
      }

      panelLayoutObserver = new MutationObserver(() => {
        if (isPanelDropSettling()) {
          return;
        }

        disconnectPanelLayoutObserver();
        if (!deferredPanelLayoutFit) {
          return;
        }

        deferredPanelLayoutFit = false;
        handleResize();
      });
      panelLayoutObserver.observe(observedContainer, {
        attributeFilter: ["data-panel-drop-settling"],
        attributes: true,
      });
    };

    function handleResize() {
      if (isPanelDropSettling()) {
        deferredPanelLayoutFit = true;
        ensurePanelLayoutObserver();
        return;
      }

      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        sessions.forEach((session) => {
          const element = session.terminal.element;
          if (element && element.offsetWidth > 0 && element.offsetHeight > 0) {
            session.fitAddon.fit();
          }
        });
      });
    }

    window.addEventListener("resize", handleResize);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          handleResize();
          break;
        }
      }
    });

    containerRefs.current.forEach((container) => {
      resizeObserver.observe(container);
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      disconnectPanelLayoutObserver();
      if (resizeFrame !== null) {
        cancelAnimationFrame(resizeFrame);
      }
    };
  }, [sessions, panes]);

  useEffect(() => {
    if (!tuiModeActive) {
      return;
    }

    const raf = requestAnimationFrame(() => {
      panesForRender.forEach((pane) => {
        const tabId = pane.activeTabId;
        if (!tabId) {
          return;
        }

        const session = sessions.get(tabId);
        const container = containerRefs.current.get(tabId);
        if (
          !session ||
          !container ||
          container.offsetWidth <= 0 ||
          container.offsetHeight <= 0
        ) {
          return;
        }

        session.fitAddon.fit();
      });
    });

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [panesForRender, sessions, tuiModeActive]);

  const handleCloseTab = async (paneId: string, tabId: string) => {
    await closeTerminal(paneId, tabId);
  };

  const handleSplitPane = (direction: "horizontal" | "vertical") => {
    splitPane(direction, resolvedThemeId);
  };

  const tabBarStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "6px 12px",
    backgroundColor: "var(--surface-2)",
    borderBottom: `1px solid var(--border-subtle)`,
    overflowX: "auto",
  };

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 14px",
    fontSize: "12px",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: isActive ? 500 : 400,
    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
    backgroundColor: isActive ? "var(--surface-1)" : "transparent",
    borderRadius: 10,
    cursor: "pointer",
    transition:
      "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
    border: `1px solid ${isActive ? "var(--border-default)" : "transparent"}`,
  });

  const closeTabBtnStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "16px",
    height: "16px",
    borderRadius: "4px",
    backgroundColor: "transparent",
    border: "1px solid transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    transition:
      "background-color 150ms ease, color 150ms ease, opacity 150ms ease",
    opacity: 0.6,
  };

  const actionBtnStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: 6,
    backgroundColor: "var(--surface-1)",
    border: `1px solid var(--border-subtle)`,
    color: "var(--text-secondary)",
    cursor: "pointer",
    marginLeft: "4px",
    transition:
      "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
  };

  const addTabBtnStyle: React.CSSProperties = {
    ...actionBtnStyle,
    color: "var(--text-primary)",
  };

  const copyTerminalSelection = async (tabId: string) => {
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }

    const selectedText = session.terminal.getSelection();
    if (!selectedText) {
      return;
    }

    await writeClipboardTextWithFallback(selectedText, ClipboardSetText);
    session.terminal.focus();
  };

  const pasteIntoTerminal = async (tabId: string) => {
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }

    const text = await readClipboardTextWithFallback(ClipboardGetText);
    if (text) {
      session.terminal.paste(text);
      session.terminal.focus();
    }
  };

  const selectAllTerminal = (tabId: string) => {
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }

    session.terminal.selectAll();
    session.terminal.focus();
  };

  const clearTerminal = (tabId: string) => {
    const session = sessions.get(tabId);
    if (!session) {
      return;
    }

    session.terminal.clear();
    session.terminal.focus();
  };

  const openTerminalSearch = (tabId: string) => {
    const session = sessions.get(tabId);
    const selectedText = session?.terminal.getSelection().trim() ?? "";
    const nextQuery = selectedText || searchQueryRef.current;
    searchQueryRef.current = nextQuery;
    setSearchState((prev) => ({
      ...prev,
      ...createEmptyTerminalSearchStats(nextQuery),
      visible: true,
    }));
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const getTerminalBodyContextMenuItems = (
    paneId: string,
    tabId: string,
  ): ContextActionMenuItem[] => {
    const hasSession = Boolean(tabId && sessions.has(tabId));

    return [
      {
        label: "Copy Selection",
        shortcut: "Cmd C",
        icon: <Copy size={14} />,
        disabled: !hasSession,
        onSelect: () => void copyTerminalSelection(tabId),
      },
      {
        label: "Paste",
        shortcut: "Cmd V",
        icon: <ClipboardPaste size={14} />,
        disabled: !hasSession,
        onSelect: () => void pasteIntoTerminal(tabId),
      },
      {
        label: "Select All",
        shortcut: "Cmd A",
        icon: <Copy size={14} />,
        disabled: !hasSession,
        onSelect: () => selectAllTerminal(tabId),
      },
      {
        label: "Find",
        shortcut: "Cmd F",
        icon: <Search size={14} />,
        disabled: !hasSession,
        onSelect: () => openTerminalSearch(tabId),
      },
      {
        label: "Clear",
        shortcut: "Cmd K",
        icon: <Eraser size={14} />,
        disabled: !hasSession,
        onSelect: () => clearTerminal(tabId),
      },
      { separator: true },
      {
        label: "New Terminal",
        shortcut: "Cmd T",
        icon: <Plus size={14} />,
        onSelect: () => void createTerminal(paneId, resolvedThemeId),
      },
      {
        label: "Split Down",
        icon: <SplitSquareVertical size={14} />,
        disabled: panesForRender.length > 1,
        onSelect: () => handleSplitPane("horizontal"),
      },
      {
        label: "Split Right",
        icon: <SplitSquareHorizontal size={14} />,
        disabled: panesForRender.length > 1,
        onSelect: () => handleSplitPane("vertical"),
      },
    ];
  };

  const getTerminalTabContextMenuItems = (
    paneId: string,
    tabId: string,
  ): ContextActionMenuItem[] => [
    {
      label: "Activate Terminal",
      onSelect: () => {
        const session = sessions.get(tabId);
        setActiveTab(paneId, tabId);
        window.requestAnimationFrame(() => {
          session?.fitAddon.fit();
          session?.terminal.focus();
        });
      },
    },
    {
      label: "Copy Session Name",
      icon: <Copy size={14} />,
      onSelect: () => {
        const session = sessions.get(tabId);
        if (session) {
          void writeClipboardTextWithFallback(session.name, ClipboardSetText);
        }
      },
    },
    { separator: true },
    {
      label: "New Terminal",
      icon: <Plus size={14} />,
      onSelect: () => void createTerminal(paneId, resolvedThemeId),
    },
    {
      label: "Reopen Closed Terminal",
      icon: <RotateCcw size={14} />,
      onSelect: () => void reopenLastClosedTab(resolvedThemeId),
    },
    {
      label: "Close Terminal",
      icon: <X size={14} />,
      danger: true,
      onSelect: () => void closeTerminal(paneId, tabId),
    },
  ];

  const renderPane = (pane: (typeof panes)[0]) => {
    const activeTabId = pane.activeTabId;
    const semanticEntries = activeTabId
      ? (sessionSemanticEntries.get(activeTabId) ?? [])
      : [];
    const visibleSemanticEntries = semanticEntries.slice(-5).reverse();

    return (
      <div
        key={pane.id}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          borderLeft:
            panesForRender.indexOf(pane) > 0 && splitDirection === "vertical"
              ? `1px solid ${theme.border}`
              : undefined,
          borderTop:
            panesForRender.indexOf(pane) > 0 && splitDirection === "horizontal"
              ? `1px solid ${theme.border}`
              : undefined,
        }}
        onClick={() => setActivePane(pane.id)}
      >
        <div style={tabBarStyle}>
          {pane.tabIds.map((tabId) => {
            const session = sessions.get(tabId);
            if (!session) return null;

            return (
              <ContextActionMenu
                key={tabId}
                items={getTerminalTabContextMenuItems(pane.id, tabId)}
                nativeScope="terminal-tab"
                nativeTargetId={tabId}
                nativeContext={{ paneId: pane.id, tabId }}
              >
                <div
                  style={tabStyle(tabId === activeTabId)}
                  onClick={() => {
                    setActiveTab(pane.id, tabId);
                    requestAnimationFrame(() => {
                      session.fitAddon.fit();
                      session.terminal.focus();
                    });
                  }}
                >
                  <span>{session.name}</span>
                  <button
                    style={closeTabBtnStyle}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(pane.id, tabId);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </ContextActionMenu>
            );
          })}
          <button
            style={addTabBtnStyle}
            onClick={() => createTerminal(pane.id, resolvedThemeId)}
            title="New Terminal"
          >
            <Plus size={14} />
          </button>
          {panesForRender.length === 1 && (
            <>
              <button
                style={actionBtnStyle}
                onClick={() => handleSplitPane("horizontal")}
                title="Split Horizontally"
              >
                <SplitSquareVertical size={14} />
              </button>
              <button
                style={actionBtnStyle}
                onClick={() => handleSplitPane("vertical")}
                title="Split Vertically"
              >
                <SplitSquareHorizontal size={14} />
              </button>
            </>
          )}
        </div>

        <ContextActionMenu
          items={getTerminalBodyContextMenuItems(pane.id, activeTabId)}
          nativeScope="terminal-body"
          nativeTargetId={activeTabId}
          nativeContext={{ paneId: pane.id, tabId: activeTabId }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              backgroundColor: "var(--surface-canvas)",
              display: pane.tabIds.length > 0 ? "block" : "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {pane.tabIds.map((tabId) => (
              <div
                key={tabId}
                ref={(el) => {
                  if (el) {
                    containerRefs.current.set(tabId, el);
                    if (tabId === activeTabId) {
                      attachTerminal(tabId, el);
                    }
                  }
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  display: tabId === activeTabId ? "block" : "none",
                  padding: "4px",
                  position: "relative",
                }}
              />
            ))}
            {pane.tabIds.length === 0 && (
              <div className="flex flex-col items-center gap-3 text-[var(--text-muted)]">
                <div style={{ fontSize: "13px" }}>
                  No terminal session in this pane.
                </div>
                <button
                  type="button"
                  onClick={() => createTerminal(pane.id, resolvedThemeId)}
                  style={addTabBtnStyle}
                >
                  <Plus size={13} />
                  New terminal
                </button>
              </div>
            )}
          </div>
        </ContextActionMenu>

        {!tuiModeActive && visibleSemanticEntries.length > 0 && (
          <div
            style={{
              borderTop: `1px solid ${theme.border}`,
              backgroundColor: "var(--surface-1)",
              padding: "6px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            {visibleSemanticEntries.map((entry, index) => {
              const key = `${entry.timestamp}-${entry.kind}-${index}`;
              const isFileRef = entry.kind === "file_ref" && entry.path;
              const isPreviewUrl =
                entry.kind === "preview_url" && entry.message.trim() !== "";
              const isImageRef =
                entry.kind === "image_ref" && entry.imageDataUrl !== "";
              const lineLabel = entry.line > 0 ? `:${entry.line}` : "";
              const columnLabel = entry.column > 0 ? `:${entry.column}` : "";
              const severityColor =
                entry.severity === "error"
                  ? "var(--status-error)"
                  : entry.severity === "warning"
                    ? "var(--status-warning)"
                    : theme.textMuted;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (isFileRef && onOpenFileRef) {
                      onOpenFileRef(entry.path, entry.line, entry.column);
                      return;
                    }
                    if (!isPreviewUrl || !onOpenPreviewUrl || !activeSession) {
                      return;
                    }
                    onOpenPreviewUrl(entry.message, activeSession.id);
                  }}
                  style={{
                    border:
                      isFileRef || isPreviewUrl
                        ? "1px solid var(--border-subtle)"
                        : "1px solid transparent",
                    background:
                      isFileRef || isPreviewUrl
                        ? "var(--surface-2)"
                        : "transparent",
                    textAlign: "left",
                    padding: "6px 8px",
                    margin: 0,
                    color: theme.textSecondary,
                    cursor: isFileRef || isPreviewUrl ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "11px",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  <span style={{ color: severityColor, minWidth: "56px" }}>
                    {entry.kind}
                  </span>
                  <span
                    style={{
                      color: isFileRef
                        ? "var(--status-info)"
                        : isPreviewUrl
                          ? "var(--status-info)"
                          : theme.textSecondary,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {isFileRef
                      ? `${entry.path}${lineLabel}${columnLabel}`
                      : isPreviewUrl
                        ? `open ${entry.message}`
                        : isImageRef
                          ? "inline image"
                          : entry.message}
                  </span>
                  {isImageRef && (
                    <img
                      src={entry.imageDataUrl}
                      alt="Terminal inline image"
                      style={{
                        maxWidth: "120px",
                        maxHeight: "52px",
                        objectFit: "contain",
                        borderRadius: "4px",
                        border: `1px solid var(--border-subtle)`,
                      }}
                    />
                  )}
                  {(isFileRef || isPreviewUrl) && (
                    <span
                      style={{ color: "var(--text-muted)", marginLeft: "auto" }}
                    >
                      Open
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Calculate ghost text position based on cursor using relative units
  const getGhostTextStyle = (): {
    style: React.CSSProperties;
    target: HTMLElement;
  } | null => {
    if (!ghostText) return null;
    if (!activeSession?.terminal?.element) return null;

    const activeTabId = activePane?.activeTabId;
    const container = activeTabId
      ? containerRefs.current.get(activeTabId)
      : null;
    if (!container) return null;

    const term: any = activeSession.terminal as any;

    const buffer: any = term.buffer?.active;
    if (!buffer) return null;
    const cursorX = buffer.cursorX ?? 0;
    const cursorY = buffer.cursorY ?? 0;

    // baseY is the number of lines scrolled off the top
    // cursorY is relative to the viewport (0 = first visible line)
    // So cursorY directly gives us the visible row position
    const visibleRow = cursorY;

    // Safety check: cursor should be within viewport
    const termRows = activeSession.terminal.rows || 24;
    if (visibleRow < 0 || visibleRow >= termRows) return null;

    // Find xterm viewport element to position relative to it
    const xtermScreen = container.querySelector(".xterm-screen") as HTMLElement;
    if (!xtermScreen) return null;

    // Get cell dimensions from xterm's internal dimensions
    const dims = term._core?._renderService?.dimensions;
    const cellW = dims?.css?.cell?.width || dims?.actualCellWidth;
    const cellH = dims?.css?.cell?.height || dims?.actualCellHeight;
    if (!cellW || !cellH) return null;

    // Get font settings directly from xterm options
    const termOptions = activeSession.terminal.options;
    const fontSize = termOptions?.fontSize || 13;
    const fontFamily =
      termOptions?.fontFamily ||
      "'MesloLGS NF', 'Hack Nerd Font', 'FiraCode Nerd Font', 'JetBrains Mono', 'SF Mono', Monaco, Consolas, monospace";

    // Position in CSS pixels relative to xterm-screen
    const left = cursorX * cellW;
    const top = visibleRow * cellH;

    return {
      style: {
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        height: `${cellH}px`,
        lineHeight: `${cellH}px`,
        color: "var(--text-muted)",
        backgroundColor: "transparent",
        fontFamily: fontFamily,
        fontSize: `${fontSize}px`,
        fontWeight: "normal",
        letterSpacing: "0px",
        padding: "0",
        margin: "0",
        pointerEvents: "none" as const,
        zIndex: 10,
        whiteSpace: "pre" as const,
        opacity: 0.65,
        userSelect: "none" as const,
      },
      target: xtermScreen,
    };
  };

  const ghost = getGhostTextStyle();
  const searchStatusText =
    searchState.query.trim() === ""
      ? "type to search"
      : searchState.noMatches
        ? "no matches"
        : `${searchState.currentMatch}/${searchState.totalMatches}`;
  const searchStatusColor = searchState.noMatches
    ? "var(--status-error)"
    : theme.textSecondary;

  return (
    <div
      data-testid="terminal-panel"
      style={{
        display: "flex",
        flexDirection: splitDirection === "horizontal" ? "column" : "row",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {error && (
        <div
          style={{
            color: "var(--text-muted)",
            padding: "6px 8px",
            fontSize: "12px",
          }}
        >
          {error}
        </div>
      )}
      {panesForRender.map(renderPane)}
      {!isActiveSessionInTUI &&
        !isArlePaused &&
        ghostText &&
        ghost &&
        ReactDOM.createPortal(
          <div style={ghost.style} id="terminal-ghost-text">
            {ghostText}
            <span
              style={{
                marginLeft: "4px",
                fontSize: "9px",
                opacity: 0.5,
                color: "var(--text-muted)",
              }}
            >
              ⇥
            </span>
          </div>,
          ghost.target,
        )}
      {!isActiveSessionInTUI && !isArlePaused && (
        <CommandAutocomplete
          input={autocompleteState.input}
          position={autocompleteState.position}
          visible={autocompleteState.visible}
          onSelect={handleAutocompleteSelect}
          onClose={() =>
            setAutocompleteState((s) => ({ ...s, visible: false }))
          }
        />
      )}
      {searchState.visible && (
        <div
          data-terminal-search-root="true"
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px",
            borderRadius: 6,
            border: `1px solid var(--border-default)`,
            backgroundColor: "var(--surface-overlay)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          <input
            data-terminal-search-input="true"
            ref={searchInputRef}
            value={searchState.query}
            onChange={(event) => {
              const query = event.target.value;
              searchQueryRef.current = query;
              setSearchState((prev) => ({ ...prev, query }));
              findInTerminal(query, "next", "input");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                findInTerminal(
                  searchState.query,
                  event.shiftKey ? "prev" : "next",
                  "navigate",
                );
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                closeSearchPanel();
              }
            }}
            placeholder="Find in terminal"
            style={{
              width: "220px",
              height: "30px",
              borderRadius: 6,
              border: `1px solid var(--border-subtle)`,
              backgroundColor: "var(--surface-1)",
              color: theme.textPrimary,
              padding: "0 10px",
              fontSize: "12px",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          <span
            data-testid="terminal-search-status"
            style={{
              minWidth: "84px",
              textAlign: "center",
              fontSize: "11px",
              color: searchStatusColor,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {searchStatusText}
          </span>
          <button
            type="button"
            onClick={() =>
              findInTerminal(searchState.query, "prev", "navigate")
            }
            style={actionBtnStyle}
            title="Previous match"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() =>
              findInTerminal(searchState.query, "next", "navigate")
            }
            style={actionBtnStyle}
            title="Next match"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={closeSearchPanel}
            style={actionBtnStyle}
            title="Close search"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
};

export default TerminalPanelContent;
