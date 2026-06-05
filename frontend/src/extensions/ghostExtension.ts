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
  Completion,
  currentCompletions,
  selectedCompletion,
  setSelectedCompletion,
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

type GhostAIPredictionResult = {
  text?: string;
  stale?: boolean;
  requestId?: string;
  documentVersion?: string;
  providerId?: string;
  model?: string;
};

function isCompletionStatusOnly(completion: Completion | null): boolean {
  return Boolean(
    completion &&
    (completion as Completion & { __statusKind?: string }).__statusKind,
  );
}

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

type AIPredictionContextPayload = CompletionContextPayload & {
  requestId: string;
  documentVersion: string;
  baseText: string;
  effectivePrefix: string;
  from: number;
  to: number;
};

type BuildCompletionContext = (
  fullText: string,
  lineNumber: number,
) => { currentClass: string; currentMethod: string; imports: string[] };

type GhostHelpers = {
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
  fetchAIPrediction?: (
    payload: AIPredictionContextPayload,
  ) => Promise<GhostAIPredictionResult | null>;
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

type GhostCompletionMetadata = Completion & {
  __insertText?: unknown;
  __hasAdditionalTextEdits?: unknown;
};

const getCompletionLabel = (completion: Completion): string =>
  typeof completion.label === "string" ? completion.label : "";

const getCompletionInsertText = (completion: Completion): string => {
  const enriched = completion as GhostCompletionMetadata;
  if (typeof enriched.__insertText === "string" && enriched.__insertText) {
    return enriched.__insertText;
  }
  if (typeof completion.apply === "string" && completion.apply) {
    return completion.apply;
  }
  if (completion.apply === undefined && typeof completion.label === "string") {
    return completion.label;
  }
  return "";
};

const completionHasAdditionalTextEdits = (completion: Completion): boolean =>
  (completion as GhostCompletionMetadata).__hasAdditionalTextEdits === true;

const editorScrollActive = (view: EditorView): boolean =>
  view.dom.dataset.scrollActive === "true";

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
  let lastCompletionStatus: ReturnType<typeof completionStatus> = null;

  const { helpers } = options;

  const retryGhostSoon = (view: EditorView) => {
    if (ghostDebounce) {
      clearTimeout(ghostDebounce);
    }
    ghostDebounce = setTimeout(() => {
      fetchGhostCompletions(view, false);
    }, options.ghostDebounceMs);
  };

  const recordPopupGhostCandidate = (completion: Completion | null): void => {
    if (isCompletionStatusOnly(completion)) {
      lastPopupGhostKey = "";
      popupGhostStableCount = 0;
      return;
    }
    const label = completion ? getCompletionLabel(completion) : "";
    const insertText = completion ? getCompletionInsertText(completion) : "";
    const hasAdditionalTextEdits = completion
      ? completionHasAdditionalTextEdits(completion)
      : false;
    if (label && insertText) {
      const key = `${label}\n${insertText}\nae:${hasAdditionalTextEdits ? "1" : "0"}`;
      if (key === lastPopupGhostKey) {
        popupGhostStableCount += 1;
      } else {
        lastPopupGhostKey = key;
        popupGhostStableCount = 1;
      }
      return;
    }
    lastPopupGhostKey = "";
    popupGhostStableCount = 0;
  };

  const resolveGhostContext = (view: EditorView, allowEmptyPrefix = false) => {
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

    if (!effectivePrefix && !accessInfo && !allowEmptyPrefix) {
      return null;
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

    return {
      cursorPos,
      lineNumber,
      column,
      fullText,
      lineText,
      textBeforeDoc,
      textAfterDoc,
      textBeforeLine,
      effectivePrefix,
      accessInfo,
      from: line.from + startColumn - 1,
      to: line.from + endColumn - 1,
    };
  };

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

  const applyGhostText = (view: EditorView) => {
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

    if (!safeFullInsertText) {
      clearGhostText(view, false);
      return false;
    }

    clearGhostText(view, false);

    const newPos = snapshot.from + safeFullInsertText.length;
    view.dispatch({
      changes: {
        from: snapshot.from,
        to: snapshot.to,
        insert: safeFullInsertText,
      },
      selection: { anchor: newPos },
    });

    options.onCompletionAccepted?.(snapshot.label);
    return true;
  };

  const applySelectedCompletionAsGhostText = (view: EditorView): boolean => {
    if (completionStatus(view.state) !== "active") {
      return false;
    }

    const context = resolveGhostContext(view);
    if (!context?.effectivePrefix) {
      return false;
    }

    const selected = selectedCompletion(view.state);
    const candidates = [
      ...(selected ? [selected] : []),
      ...currentCompletions(view.state).filter(
        (completion) => completion !== selected,
      ),
    ];

    let candidate: {
      label: string;
      fullInsertText: string;
      displayText: string;
    } | null = null;
    for (const completion of candidates) {
      if (
        !completion ||
        isCompletionStatusOnly(completion) ||
        completionHasAdditionalTextEdits(completion)
      ) {
        continue;
      }
      const label = getCompletionLabel(completion);
      const rawInsertText = getCompletionInsertText(completion);
      if (!label || !rawInsertText) {
        continue;
      }
      const fullInsertText = helpers.snippetToPlainText(rawInsertText);
      if (!fullInsertText) {
        continue;
      }
      const lcp = longestCommonPrefix(context.effectivePrefix, fullInsertText);
      if (lcp.length < context.effectivePrefix.length) {
        continue;
      }
      const displayText = fullInsertText.slice(lcp.length);
      if (!displayText) {
        continue;
      }
      candidate = { label, fullInsertText, displayText };
      break;
    }
    if (!candidate) {
      return false;
    }

    setGhostText(
      view,
      context.to,
      candidate.displayText,
      candidate.fullInsertText,
      false,
      candidate.label,
      context.from,
      context.to,
    );
    return applyGhostText(view);
  };

  const fetchGhostCompletions = async (
    view: EditorView,
    forceIdle?: boolean,
  ) => {
    const currentVersion = ++ghostRequestVersion;
    const context = resolveGhostContext(
      view,
      Boolean(forceIdle && options.fetchAIPrediction),
    );
    if (!context) {
      clearGhostText(view, false);
      return;
    }

    if (view.composing || view.compositionStarted) {
      clearGhostText(view, false);
      return;
    }
    if (editorScrollActive(view)) {
      clearGhostText(view, false);
      return;
    }

    const status = completionStatus(view.state);
    if (status === "pending") {
      clearGhostText(view, false);
      if (!forceIdle) {
        retryGhostSoon(view);
      }
      return;
    }

    // Prefer popup-derived ghost when completion popup is active.
    // This ensures popup and ghost are always consistent.
    if (context.effectivePrefix && status === "active") {
      if (!forceIdle && context.effectivePrefix.length < 2) {
        clearGhostText(view, false);
        return;
      }
      const selected =
        selectedCompletion(view.state) || currentCompletions(view.state)[0];
      recordPopupGhostCandidate(selected || null);
      if (!forceIdle && popupGhostStableCount < 2) {
        retryGhostSoon(view);
        clearGhostText(view, false);
        return;
      }
      if (!selected) {
        clearGhostText(view, false);
        return;
      }

      const label = getCompletionLabel(selected);
      const rawInsertText = getCompletionInsertText(selected);
      if (completionHasAdditionalTextEdits(selected)) {
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
      const lcp = longestCommonPrefix(context.effectivePrefix, ghostText);
      if (lcp.length < context.effectivePrefix.length) {
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
        context.to,
        displayText,
        fullInsertText,
        false,
        label,
        context.from,
        context.to,
      );
      options.onGhostShown?.();
      return;
    }

    if (
      !forceIdle &&
      context.effectivePrefix.length < 2 &&
      !context.accessInfo &&
      helpers.extractStringPrefix(context.textBeforeLine) === null
    ) {
      clearGhostText(view, false);
      return;
    }

    const { currentClass, currentMethod, imports } =
      options.buildCompletionContext(context.fullText, context.lineNumber);

    const tryAIPredictionGhost = async (): Promise<boolean> => {
      if (!forceIdle || !options.fetchAIPrediction || status === "active") {
        return false;
      }

      try {
        const baseText = view.state.doc.sliceString(context.from, context.to);
        const result = await options.fetchAIPrediction({
          filePath: options.filePath,
          language: options.language,
          line: context.lineNumber,
          column: context.column,
          lineText: context.lineText,
          textBefore: context.textBeforeDoc,
          textAfter: context.textAfterDoc,
          fullText: context.fullText,
          currentClass,
          currentMethod,
          imports,
          triggerChar: "",
          requestId: `ghost-ai-${currentVersion}`,
          documentVersion: `${currentVersion}`,
          baseText,
          effectivePrefix: context.effectivePrefix,
          from: context.from,
          to: context.to,
        });

        if (currentVersion !== ghostRequestVersion) return true;
        if (view.state.selection.main.head !== context.cursorPos) return true;
        if (!result || result.stale) return false;

        let displayText = helpers.snippetToPlainText(result.text || "");
        displayText = helpers.trimToTokenLimit(displayText, 24);
        if (!displayText) return false;

        let insertText = `${baseText}${displayText}`;
        if (
          context.effectivePrefix &&
          displayText
            .toLowerCase()
            .startsWith(context.effectivePrefix.toLowerCase())
        ) {
          insertText = displayText;
          displayText = displayText.slice(context.effectivePrefix.length);
        }

        if (!displayText) return false;

        setGhostText(
          view,
          context.to,
          displayText,
          insertText,
          false,
          "AI prediction",
          context.from,
          context.to,
        );
        options.onGhostShown?.();
        return true;
      } catch (error) {
        console.debug("AI prediction ghost skipped:", error);
        return false;
      }
    };

    try {
      const result = await options.fetchCompletions({
        filePath: options.filePath,
        language: options.language,
        line: context.lineNumber,
        column: context.column,
        lineText: context.lineText,
        textBefore: context.textBeforeDoc,
        textAfter: context.textAfterDoc,
        fullText: context.fullText,
        currentClass,
        currentMethod,
        imports,
        triggerChar: "",
      });

      if (currentVersion !== ghostRequestVersion) return;
      if (view.state.selection.main.head !== context.cursorPos) return;

      if (
        !result ||
        result.stale ||
        !result.items ||
        result.items.length === 0
      ) {
        if (await tryAIPredictionGhost()) return;
        clearGhostText(view, false);
        return;
      }

      if (!result.showGhost || !result.ghostText) {
        if (await tryAIPredictionGhost()) return;
        clearGhostText(view, false);
        return;
      }

      const primary = (result.primary ||
        result.items[0]) as GhostCompletionItem;
      if (!primary) {
        if (await tryAIPredictionGhost()) return;
        clearGhostText(view, false);
        return;
      }

      let ghostText = helpers.snippetToPlainText(result.ghostText);
      if (!ghostText) {
        if (await tryAIPredictionGhost()) return;
        clearGhostText(view, false);
        return;
      }

      if (forceIdle) {
        ghostText = helpers.trimToTokenLimit(ghostText, 24);
      } else {
        ghostText = helpers.trimToTokenLimit(ghostText, 5);
      }

      let displayText = ghostText;
      const prefix = context.effectivePrefix || "";
      if (prefix) {
        const lcp = longestCommonPrefix(prefix, ghostText);
        displayText = ghostText.slice(lcp.length);
      }

      if (!displayText) {
        if (await tryAIPredictionGhost()) return;
        clearGhostText(view, false);
        return;
      }

      const rawInsertText =
        primary.insertText || primary.text || primary.label || "";
      const insertText = helpers.snippetToPlainText(rawInsertText);
      if (!insertText) {
        if (await tryAIPredictionGhost()) return;
        clearGhostText(view, false);
        return;
      }

      setGhostText(
        view,
        context.to,
        displayText,
        insertText,
        false,
        primary.label || "",
        context.from,
        context.to,
      );
      options.onGhostShown?.();
    } catch (error) {
      if (await tryAIPredictionGhost()) return;
      console.error("Ghost completion error:", error);
      clearGhostText(view, false);
    }
  };

  const scheduleGhostCompletions = (view: EditorView) => {
    if (ghostDebounce) {
      clearTimeout(ghostDebounce);
    }
    if (editorScrollActive(view)) {
      clearGhostText(view, false);
      ghostDebounce = null;
      return;
    }
    ghostDebounce = setTimeout(() => {
      fetchGhostCompletions(view, false);
    }, options.ghostDebounceMs);
  };

  const scheduleIdleGhost = (view: EditorView) => {
    if (ghostIdleTimer) {
      clearTimeout(ghostIdleTimer);
    }
    if (editorScrollActive(view) || completionStatus(view.state) === "active") {
      ghostIdleTimer = null;
      return;
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
    const status = completionStatus(update.state);
    const statusChanged = status !== lastCompletionStatus;
    lastCompletionStatus = status;
    if (
      !update.docChanged &&
      !update.selectionSet &&
      !update.focusChanged &&
      !statusChanged
    ) {
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
      recordPopupGhostCandidate(selected || null);
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
          const applied = applyGhostText(view);
          if (applied && popupWasActive) {
            closeCompletion(view);
          }

          if (applied) {
            return true;
          }
        }

        const popupWasActive = completionStatus(view.state) === "active";
        const appliedPopupGhost = applySelectedCompletionAsGhostText(view);
        if (appliedPopupGhost) {
          if (popupWasActive) {
            closeCompletion(view);
          }
          return true;
        }

        // Policy/UX: Tab никогда не принимает popup completion.
        // Если безопасный ghost-кандидат не найден — Tab должен вести себя как indent.
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
          const selected = selectedCompletion(view.state);
          if (isCompletionStatusOnly(selected)) {
            return true;
          }
          if (!selected) {
            const first = currentCompletions(view.state)[0];
            if (isCompletionStatusOnly(first || null)) {
              return true;
            }
            if (first) {
              view.dispatch({ effects: setSelectedCompletion(0) });
            }
          }
          if (acceptCompletion(view)) {
            clearGhostText(view, false);
            return true;
          }
        }
        if (ghostState.isVisible) {
          return applyGhostText(view);
        }
        return false;
      },
    },
    {
      key: "Alt-Tab",
      run: (view) => {
        if (ghostState.isVisible) {
          return applyGhostText(view);
        }
        return false;
      },
    },
    {
      key: "Escape",
      run: (view) => {
        cancelTimers();
        const popupOpen = completionStatus(view.state) !== null;

        if (ghostState.isVisible) {
          clearGhostText(view, true);
          if (popupOpen) {
            closeCompletion(view);
            options.onEscape?.();
            return true;
          }
          options.onEscape?.();
          return true;
        }

        if (popupOpen) {
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
