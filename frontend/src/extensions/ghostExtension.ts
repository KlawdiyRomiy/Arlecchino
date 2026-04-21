import {
  EditorView,
  keymap,
  Decoration,
  DecorationSet,
  WidgetType,
} from "@codemirror/view";
import { Extension, StateEffect, StateField } from "@codemirror/state";
import { indentMore, indentWithTab } from "@codemirror/commands";
import {
  acceptCompletion,
  closeCompletion,
  completionStatus,
  startCompletion,
  Completion,
  currentCompletions,
  selectedCompletion,
} from "@codemirror/autocomplete";

type GhostCompletionItem = {
  label?: string;
  insertText?: string;
  text?: string;
  isSnippet?: boolean;
};

type GhostCompletionResult = {
  primary?: GhostCompletionItem;
  items?: GhostCompletionItem[];
  ghostText?: string;
  showGhost?: boolean;
  stale?: boolean;
};

type CompletionContextPayload = {
  filePath: string;
  language: string;
  line: number;
  column: number;
  lineText: string;
  textBefore: string;
  textAfter: string;
  fullText: string;
  currentClass: string;
  currentMethod: string;
  imports: string[];
  triggerChar: string;
};

type BuildCompletionContext = (
  fullText: string,
  lineNumber: number,
) => { currentClass: string; currentMethod: string; imports: string[] };

type GhostHelpers = {
  firstWordOrToken: (text: string) => string;
  trimToTokenLimit: (text: string, limit: number) => string;
  snippetToPlainText: (text: string) => string;
  getWordAtLinePosition: (
    lineText: string,
    column: number,
    language: string,
  ) => { word: string; startColumn: number; endColumn: number } | null;
  extractStringPrefix: (textBeforeLine: string) => string | null;
  extractAccessPrefix: (textBeforeLine: string) => { prefix: string } | null;
  extractKeywordPrefix: (textBeforeLine: string) => string | null;
};

type GhostExtensionOptions = {
  filePath: string;
  language: string;
  ghostDebounceMs: number;
  ghostIdleDelayMs: number;
  buildCompletionContext: BuildCompletionContext;
  fetchCompletions: (
    payload: CompletionContextPayload,
  ) => Promise<GhostCompletionResult | null>;
  onGhostShown?: () => void;
  onGhostRejected?: () => void;
  onCompletionAccepted?: (label: string) => void;
  onEscape?: () => void;
  helpers: GhostHelpers;
};

type GhostState = {
  isVisible: boolean;
  ghostText: string;
  insertText: string;
  isSnippet: boolean;
  from: number;
  to: number;
  label: string;
};

const setGhostTextEffect = StateEffect.define<{
  pos: number;
  text: string;
} | null>();

class GhostTextWidget extends WidgetType {
  constructor(private text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "ghost-text-suggestion";
    span.textContent = this.text;
    return span;
  }
}

const ghostTextField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    const mapped = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setGhostTextEffect)) {
        if (!effect.value) {
          return Decoration.none;
        }
        const decoration = Decoration.widget({
          widget: new GhostTextWidget(effect.value.text),
          side: 1,
        });
        return Decoration.set([decoration.range(effect.value.pos)]);
      }
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const longestCommonPrefix = (a: string, b: string): string => {
  if (!a || !b) return "";
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  const max = Math.min(lowerA.length, lowerB.length);
  let i = 0;
  for (; i < max; i += 1) {
    if (lowerA[i] !== lowerB[i]) break;
  }
  return b.slice(0, i);
};

export type GhostExtensionHandle = {
  extension: Extension;
  keymap: Extension;
  cleanup: () => void;
  ghostField: Extension;
};

export function ghostExtension(
  options: GhostExtensionOptions,
): GhostExtensionHandle {
  const ghostState: GhostState = {
    isVisible: false,
    ghostText: "",
    insertText: "",
    isSnippet: false,
    from: 0,
    to: 0,
    label: "",
  };

  let lastView: EditorView | null = null;
  let ghostDebounce: ReturnType<typeof setTimeout> | null = null;
  let ghostIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let ghostRequestVersion = 0;

  let lastPopupGhostKey = "";
  let popupGhostStableCount = 0;

  const { helpers } = options;

  const clearGhostText = (view: EditorView, recordReject: boolean) => {
    if (ghostState.isVisible && recordReject) {
      options.onGhostRejected?.();
    }

    ghostState.isVisible = false;
    ghostState.ghostText = "";
    ghostState.insertText = "";
    ghostState.isSnippet = false;
    ghostState.from = 0;
    ghostState.to = 0;
    ghostState.label = "";
    view.dispatch({ effects: setGhostTextEffect.of(null) });
  };

  const setGhostText = (
    view: EditorView,
    pos: number,
    text: string,
    insertText: string,
    isSnippet: boolean,
    label: string,
    from: number,
    to: number,
  ) => {
    ghostState.isVisible = true;
    ghostState.ghostText = text;
    ghostState.insertText = insertText;
    ghostState.isSnippet = isSnippet;
    ghostState.from = from;
    ghostState.to = to;
    ghostState.label = label;
    view.dispatch({ effects: setGhostTextEffect.of({ pos, text }) });
  };

  const applyGhostText = (view: EditorView, mode: "word" | "all") => {
    if (!ghostState.isVisible || !ghostState.insertText) return false;

    // Snapshot before clearing (clearGhostText resets from/to/label/insertText).
    const snapshot = {
      from: ghostState.from,
      to: ghostState.to,
      label: ghostState.label,
      insertText: ghostState.insertText,
    };

    // Prevent stale insertion: only apply if cursor is still at the expected end.
    if (view.state.selection.main.head !== snapshot.to) {
      clearGhostText(view, false);
      return false;
    }

    // Enforce policy: never insert snippet placeholders / default placeholder names.
    const safeFullInsertText = helpers.snippetToPlainText(snapshot.insertText);

    // Prevent stale insertion even when the cursor position matches.
    // The currently typed range must still be a prefix of what we are about to insert.
    const typedText = view.state.doc.sliceString(snapshot.from, snapshot.to);
    const lcp = longestCommonPrefix(typedText, safeFullInsertText);
    if (lcp.length < typedText.length) {
      clearGhostText(view, false);
      return false;
    }

    const safeInsertText =
      mode === "word"
        ? helpers.firstWordOrToken(safeFullInsertText)
        : safeFullInsertText;
    if (!safeInsertText) {
      clearGhostText(view, false);
      return false;
    }

    clearGhostText(view, false);

    const newPos = snapshot.from + safeInsertText.length;
    view.dispatch({
      changes: {
        from: snapshot.from,
        to: snapshot.to,
        insert: safeInsertText,
      },
      selection: { anchor: newPos },
    });

    options.onCompletionAccepted?.(snapshot.label);
    return true;
  };

  const fetchGhostCompletions = async (
    view: EditorView,
    forceIdle?: boolean,
  ) => {
    const currentVersion = ++ghostRequestVersion;
    const cursorPos = view.state.selection.main.head;
    const pos = cursorPos;
    const line = view.state.doc.lineAt(pos);
    const lineNumber = line.number;
    const column = pos - line.from + 1;
    const fullText = view.state.doc.toString();
    const lineText = line.text;
    const textBeforeDoc = fullText.slice(0, pos);
    const textAfterDoc = fullText.slice(pos);
    const textBeforeLine = lineText.slice(0, column - 1);

    const wordAtCursor = helpers.getWordAtLinePosition(
      lineText,
      column,
      options.language,
    );
    const stringPrefix = helpers.extractStringPrefix(textBeforeLine);
    const accessInfo = helpers.extractAccessPrefix(textBeforeLine);
    const effectivePrefix =
      stringPrefix ?? accessInfo?.prefix ?? wordAtCursor?.word ?? "";

    if (!effectivePrefix && !accessInfo) {
      clearGhostText(view, false);
      return;
    }

    if (view.composing || view.compositionStarted) {
      clearGhostText(view, false);
      return;
    }

    let startColumn = column;
    let endColumn = column;
    if (stringPrefix !== null) {
      startColumn = column - stringPrefix.length;
      endColumn = column;
    } else if (accessInfo) {
      startColumn = column - accessInfo.prefix.length;
      endColumn = column;
    } else if (wordAtCursor) {
      startColumn = wordAtCursor.startColumn;
      endColumn = wordAtCursor.endColumn;
    } else {
      const keywordPrefix = helpers.extractKeywordPrefix(textBeforeLine);
      if (keywordPrefix) {
        startColumn = column - keywordPrefix.length;
        endColumn = column;
      }
    }

    const from = line.from + startColumn - 1;
    const to = line.from + endColumn - 1;

    const status = completionStatus(view.state);
    if (status === "pending") {
      clearGhostText(view, false);
      return;
    }

    // Prefer popup-derived ghost when completion popup is active.
    // This ensures popup and ghost are always consistent.
    if (effectivePrefix && status === "active") {
      if (!forceIdle && effectivePrefix.length < 2) {
        clearGhostText(view, false);
        return;
      }
      if (!forceIdle && popupGhostStableCount < 1) {
        clearGhostText(view, false);
        return;
      }

      const selected =
        selectedCompletion(view.state) || currentCompletions(view.state)[0];
      if (!selected) {
        clearGhostText(view, false);
        return;
      }

      const c = selected as unknown as {
        __insertText?: unknown;
        __hasAdditionalTextEdits?: unknown;
        label?: unknown;
      };
      const label = typeof c.label === "string" ? c.label : "";
      const rawInsertText =
        typeof c.__insertText === "string" ? c.__insertText : "";
      const hasAdditionalTextEdits = c.__hasAdditionalTextEdits === true;
      if (hasAdditionalTextEdits) {
        clearGhostText(view, false);
        return;
      }
      if (!label || !rawInsertText) {
        clearGhostText(view, false);
        return;
      }

      const fullInsertText = helpers.snippetToPlainText(rawInsertText);
      if (!fullInsertText) {
        clearGhostText(view, false);
        return;
      }

      let ghostText = helpers.trimToTokenLimit(
        fullInsertText,
        forceIdle ? 24 : 5,
      );
      const lcp = longestCommonPrefix(effectivePrefix, ghostText);
      if (lcp.length < effectivePrefix.length) {
        clearGhostText(view, false);
        return;
      }

      const displayText = ghostText.slice(lcp.length);
      if (!displayText) {
        clearGhostText(view, false);
        return;
      }

      setGhostText(
        view,
        to,
        displayText,
        fullInsertText,
        false,
        label,
        from,
        to,
      );
      options.onGhostShown?.();
      return;
    }

    if (
      !forceIdle &&
      effectivePrefix.length < 2 &&
      !accessInfo &&
      !stringPrefix
    ) {
      clearGhostText(view, false);
      return;
    }

    const { currentClass, currentMethod, imports } =
      options.buildCompletionContext(fullText, lineNumber);

    try {
      const result = await options.fetchCompletions({
        filePath: options.filePath,
        language: options.language,
        line: lineNumber,
        column,
        lineText,
        textBefore: textBeforeDoc,
        textAfter: textAfterDoc,
        fullText,
        currentClass,
        currentMethod,
        imports,
        triggerChar: "",
      });

      if (currentVersion !== ghostRequestVersion) return;
      if (view.state.selection.main.head !== cursorPos) return;

      if (
        !result ||
        result.stale ||
        !result.items ||
        result.items.length === 0
      ) {
        clearGhostText(view, false);
        return;
      }

      if (!result.showGhost || !result.ghostText) {
        clearGhostText(view, false);
        return;
      }

      const primary = (result.primary ||
        result.items[0]) as GhostCompletionItem;
      if (!primary) {
        clearGhostText(view, false);
        return;
      }

      let ghostText = helpers.snippetToPlainText(result.ghostText);
      if (!ghostText) {
        clearGhostText(view, false);
        return;
      }

      if (forceIdle) {
        ghostText = helpers.trimToTokenLimit(ghostText, 24);
      } else {
        ghostText = helpers.trimToTokenLimit(ghostText, 5);
      }

      let displayText = ghostText;
      const prefix = effectivePrefix || "";
      if (prefix) {
        const lcp = longestCommonPrefix(prefix, ghostText);
        displayText = ghostText.slice(lcp.length);
      }

      if (!displayText) {
        clearGhostText(view, false);
        return;
      }

      const rawInsertText =
        primary.insertText || primary.text || primary.label || "";
      const insertText = helpers.snippetToPlainText(rawInsertText);
      if (!insertText) {
        clearGhostText(view, false);
        return;
      }

      setGhostText(
        view,
        to,
        displayText,
        insertText,
        false,
        primary.label || "",
        from,
        to,
      );
      options.onGhostShown?.();
    } catch (error) {
      console.error("Ghost completion error:", error);
      clearGhostText(view, false);
    }
  };

  const scheduleGhostCompletions = (view: EditorView) => {
    if (ghostDebounce) {
      clearTimeout(ghostDebounce);
    }
    ghostDebounce = setTimeout(() => {
      fetchGhostCompletions(view, false);
    }, options.ghostDebounceMs);
  };

  const scheduleIdleGhost = (view: EditorView) => {
    if (ghostIdleTimer) {
      clearTimeout(ghostIdleTimer);
    }
    ghostIdleTimer = setTimeout(() => {
      fetchGhostCompletions(view, true);
    }, options.ghostIdleDelayMs);
  };

  const cancelTimers = () => {
    if (ghostDebounce) {
      clearTimeout(ghostDebounce);
      ghostDebounce = null;
    }
    if (ghostIdleTimer) {
      clearTimeout(ghostIdleTimer);
      ghostIdleTimer = null;
    }
  };

  const extension = EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) {
      return;
    }
    lastView = update.view;
    if (!update.view.hasFocus) {
      if (ghostState.isVisible) {
        clearGhostText(update.view, false);
      }

      lastPopupGhostKey = "";
      popupGhostStableCount = 0;
      return;
    }

    const status = completionStatus(update.state);
    if (
      status !== "active" ||
      update.view.composing ||
      update.view.compositionStarted
    ) {
      lastPopupGhostKey = "";
      popupGhostStableCount = 0;
    } else {
      const selected =
        selectedCompletion(update.state) || currentCompletions(update.state)[0];
      const c = selected as unknown as {
        __insertText?: unknown;
        __hasAdditionalTextEdits?: unknown;
        label?: unknown;
      };
      const label = typeof c.label === "string" ? c.label : "";
      const insertText =
        typeof c.__insertText === "string" ? c.__insertText : "";
      const hasAdditionalTextEdits = c.__hasAdditionalTextEdits === true;
      if (label && insertText) {
        const key = `${label}\n${insertText}\nae:${hasAdditionalTextEdits ? "1" : "0"}`;
        if (key === lastPopupGhostKey) {
          popupGhostStableCount += 1;
        } else {
          lastPopupGhostKey = key;
          popupGhostStableCount = 1;
        }
      } else {
        lastPopupGhostKey = "";
        popupGhostStableCount = 0;
      }
    }

    scheduleGhostCompletions(update.view);
    scheduleIdleGhost(update.view);
  });

  const ghostKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => {
        if (ghostState.isVisible) {
          const popupWasActive = completionStatus(view.state) === "active";
          const applied = applyGhostText(view, "word");
          if (applied && popupWasActive) {
            setTimeout(() => startCompletion(view), 0);
          }

          if (applied) {
            return true;
          }
        }

        // Policy/UX: Tab никогда не принимает popup completion.
        // Если ghost не видим — Tab должен вести себя как indent.
        if (!(indentWithTab.run?.(view) ?? false)) {
          indentMore(view);
        }
        return true;
      },
    },
    {
      key: "Enter",
      run: (view) => {
        if (completionStatus(view.state) === "active") {
          if (acceptCompletion(view)) {
            clearGhostText(view, false);
            return true;
          }
        }
        if (ghostState.isVisible) {
          return applyGhostText(view, "all");
        }
        return false;
      },
    },
    {
      key: "Alt-Tab",
      run: (view) => {
        if (ghostState.isVisible) {
          return applyGhostText(view, "all");
        }
        return false;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        cancelTimers();
        const popupActive = completionStatus(view.state) === "active";

        if (ghostState.isVisible) {
          clearGhostText(view, true);
          if (popupActive) {
            closeCompletion(view);
            options.onEscape?.();
            return true;
          }
          options.onEscape?.();
          return true;
        }

        if (popupActive) {
          closeCompletion(view);
          options.onEscape?.();
          return true;
        }

        options.onEscape?.();
        return false;
      },
    },
  ]);

  const cleanup = () => {
    cancelTimers();
    if (lastView && ghostState.isVisible) {
      clearGhostText(lastView, false);
    }
  };

  return {
    extension,
    keymap: ghostKeymap,
    cleanup,
    ghostField: ghostTextField,
  };
}
