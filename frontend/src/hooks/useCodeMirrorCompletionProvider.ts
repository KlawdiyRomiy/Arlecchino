import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  completionStatus,
  Completion,
  CompletionContext,
  CompletionResult,
  insertCompletionText,
  pickedCompletion,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState, Extension, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import type {
  EditorCompletionResolveResult,
  EditorCompletionResult,
  TextEditJSON,
} from "../../bindings/arlecchino/internal/app/models";
import {
  AIGetEditorContinuation,
  AIGetPredictionStatus,
  GetEditorCompletions,
  RecordCompletionUsage,
  ResolveEditorCompletion,
  SearchClasses,
  type AIPredictionStatus,
} from "../wails/app";
import { EventsOn } from "../wails/runtime";
import { createCompletionOrchestrator } from "../extensions/completionOrchestrator";
import {
  ghostExtension,
  type GhostExtensionHandle,
} from "../extensions/ghostExtension";
import {
  metricsExtension,
  type MetricsHandle,
} from "../extensions/metricsExtension";
import type { AdaptiveEditorFeatureBudget } from "../stores/performanceStore";
import { createCompletionCache } from "../utils/completionCache";
import {
  getInstantDocumentCompletions,
  getInstantKeywordCompletions,
  mergeInstantCompletions,
} from "../utils/instantCompletions";
import { useStableReferenceKey } from "./useStableReferenceKey";

const GHOST_DEBOUNCE_MS = 50;
const GHOST_IDLE_DELAY_MS = 900;
const COMPLETION_FAST_BACKEND_GRACE_MS = 32;
const COMPLETION_CACHE_TTL_MS = 2000;
const COMPLETION_RESOLVE_TIMEOUT_MS = 150;
const MAX_COMPLETION_TEXT_EDITS = 32;
const MAX_COMPLETION_EDIT_TEXT_LENGTH = 64_000;
const ACCESS_COMPLETION_BOOST_BASE = 0.45;
const EMPTY_EXTENSION: Extension = [];

const NOOP_METRICS: MetricsHandle = {
  extension: EMPTY_EXTENSION,
  recordGhostShown: () => undefined,
  recordGhostRejected: () => undefined,
  recordCompletionAccepted: () => undefined,
  recordCompletionList: () => undefined,
  recordAutocompleteRequested: () => undefined,
  recordBackendRequestStarted: () => undefined,
  recordCacheHit: () => undefined,
  recordCacheMiss: () => undefined,
  recordInstantFallbackUsed: () => undefined,
  recordAccessChainWarmHit: () => undefined,
};

const NOOP_GHOST: GhostExtensionHandle = {
  extension: EMPTY_EXTENSION,
  keymap: EMPTY_EXTENSION,
  cleanup: () => undefined,
  ghostField: EMPTY_EXTENSION,
};

const COMPLETION_KEYMAP_WITHOUT_ESCAPE_OR_ENTER = completionKeymap.filter(
  (binding) => binding.key !== "Escape" && binding.key !== "Enter",
);

const SOURCE_LABELS: Record<string, string> = {
  lsp: "LSP",
  index: "Index",
  predictive: "Predict",
  local: "Local",
  virtual: "Virtual",
  fill_all: "Fill",
  ast: "AST",
  speculative: "Spec",
  snippet: "Snippet",
  arle: "ARLE",
};

type CompletionWithInsertText = Completion & {
  __insertText: string;
  __filterText?: string;
  __hasAdditionalTextEdits: boolean;
  __completionId?: string;
  __stableKey?: string;
  __autoImportAllowed?: boolean;
  __requiresResolveBeforeApply?: boolean;
};

type CompletionPayload = {
  label?: string;
  text?: string;
  filterText?: string;
  insertText?: string;
  isSnippet?: boolean;
  primaryTextEdit?: PrimaryTextEditJSON;
  additionalTextEdits?: TextEditJSON[];
  resolveToken?: string;
  completionId?: string;
  stableKey?: string;
  proofKind?: string;
  autoImportAllowed?: boolean;
  primary?: boolean;
  requiresResolveBeforeApply?: boolean;
};

type CompletionRangeJSON = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

type PrimaryTextEditJSON = {
  newText: string;
  range?: CompletionRangeJSON | null;
  insert?: CompletionRangeJSON | null;
  replace?: CompletionRangeJSON | null;
};

type CompletionResolvePayload = EditorCompletionResolveResult & {
  primaryTextEdit?: PrimaryTextEditJSON | null;
};

type CompletionTextEditChange = {
  from: number;
  to: number;
  insert: string;
};

export interface CodeMirrorCompletionProviderOptions {
  enabled: boolean;
  filePath: string;
  language: string;
  content: string;
  editorFeatureBudget: AdaptiveEditorFeatureBudget;
  getEditorView: () => EditorView | null;
  onTyping?: (chars: number) => void;
  onGhostShown?: () => void;
  onGhostRejected?: () => void;
  onEscape?: () => void;
}

export interface CodeMirrorCompletionProviderHandle {
  extensions: Extension[];
  extensionsKey: string;
  recordDocumentChange: (value: string) => void;
}

function acceptVisibleCompletion(view: EditorView): boolean {
  if (completionStatus(view.state) !== "active") {
    return false;
  }
  if (acceptCompletion(view)) {
    return true;
  }

  window.setTimeout(() => {
    if (completionStatus(view.state) === "active") {
      acceptCompletion(view);
    }
  }, COMPLETION_FAST_BACKEND_GRACE_MS);
  return true;
}

function accessCompletionLabel(completion: Completion): string {
  return (completion.displayLabel || completion.label || "").toString();
}

function accessCompletionTypePriority(completion: Completion): number {
  switch ((completion.type || "").toString()) {
    case "function":
    case "method":
      return 4;
    case "property":
    case "field":
      return 3;
    case "module":
    case "namespace":
      return 2;
    case "class":
    case "interface":
    case "type":
      return 1;
    default:
      return 0;
  }
}

function sortAccessCompletionOptions(options: Completion[]): Completion[] {
  return options
    .map((completion, index) => ({ completion, index }))
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry.completion;
      const right = rightEntry.completion;
      const byBoost = (right.boost || 0) - (left.boost || 0);
      if (byBoost !== 0) return byBoost;

      const byTypePriority =
        accessCompletionTypePriority(right) -
        accessCompletionTypePriority(left);
      if (byTypePriority !== 0) return byTypePriority;

      const byLabel = accessCompletionLabel(left).localeCompare(
        accessCompletionLabel(right),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      );
      if (byLabel !== 0) return byLabel;

      const byType = (left.type || "").localeCompare(right.type || "");
      if (byType !== 0) return byType;

      const byDetail = (left.detail || "").localeCompare(right.detail || "");
      if (byDetail !== 0) return byDetail;

      return leftEntry.index - rightEntry.index;
    })
    .map(({ completion }, index) => ({
      ...completion,
      boost:
        (completion.boost || 0) + ACCESS_COMPLETION_BOOST_BASE - index / 1000,
    }));
}

const trimToTokenLimit = (text: string, limit: number): string => {
  if (!text || limit <= 0) return "";
  const parts = text.trim().split(/\s+/);
  const slice = parts.slice(0, limit).join(" ");
  if (!slice) return "";
  return text.startsWith(" ") ? ` ${slice}` : slice;
};

function extractAccessPrefix(textBefore: string): {
  prefix: string;
  accessChain: string;
} | null {
  if (!textBefore) return null;

  const generalAccessMatch = textBefore.match(
    /((?:\$?[A-Za-z_][\w$]*|\\?[A-Za-z_][\w$]*)(?:(?:\\|\.|::|->)[A-Za-z_][\w$]*)*(?:->|::|\.))([A-Za-z_$][\w$]*)?$/,
  );
  if (generalAccessMatch) {
    return {
      accessChain: generalAccessMatch[1],
      prefix: generalAccessMatch[2] || "",
    };
  }

  const accessPatterns = [
    /(\$\w+)->(\w*)$/,
    /(\$this)->(\w*)$/,
    /(self)::(\w*)$/,
    /(static)::(\w*)$/,
    /([A-Z]\w*)::(\w*)$/,
    /(\w+)\.(\w*)$/,
  ];

  for (const pattern of accessPatterns) {
    const match = textBefore.match(pattern);
    if (match) {
      return {
        accessChain:
          match[1] +
          (textBefore.includes("::")
            ? "::"
            : textBefore.includes("->")
              ? "->"
              : "."),
        prefix: match[2] || "",
      };
    }
  }
  return null;
}

function extractStringPrefix(textBefore: string): string | null {
  if (!textBefore) return null;
  const stringArgPatterns = [
    /Route::get\s*\(\s*['"]([^'"]*)$/,
    /Route::post\s*\(\s*['"]([^'"]*)$/,
    /Route::put\s*\(\s*['"]([^'"]*)$/,
    /Route::patch\s*\(\s*['"]([^'"]*)$/,
    /Route::delete\s*\(\s*['"]([^'"]*)$/,
    /Route::any\s*\(\s*['"]([^'"]*)$/,
    /Route::options\s*\(\s*['"]([^'"]*)$/,
    /Route::match\s*\([^)]+,\s*['"]([^'"]*)$/,
    /view\s*\(\s*['"]([^'"]*)$/,
    /config\s*\(\s*['"]([^'"]*)$/,
    /route\s*\(\s*['"]([^'"]*)$/,
    /trans\s*\(\s*['"]([^'"]*)$/,
    /__\s*\(\s*['"]([^'"]*)$/,
    /asset\s*\(\s*['"]([^'"]*)$/,
    /url\s*\(\s*['"]([^'"]*)$/,
    /redirect\s*\(\s*['"]([^'"]*)$/,
    /env\s*\(\s*['"]([^'"]*)$/,
    /@include\s*\(\s*['"]([^'"]*)$/,
    /@extends\s*\(\s*['"]([^'"]*)$/,
    /@component\s*\(\s*['"]([^'"]*)$/,
    /->name\s*\(\s*['"]([^'"]*)$/,
    /->middleware\s*\(\s*['"]([^'"]*)$/,
    /where\s*\(\s*['"]([^'"]*)$/,
    /orderBy\s*\(\s*['"]([^'"]*)$/,
  ];
  for (const pattern of stringArgPatterns) {
    const match = textBefore.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractKeywordPrefix(textBefore: string): string | null {
  if (!textBefore) return null;
  const match = textBefore.match(/(\w+)$/);
  return match ? match[1] : null;
}

function extractGoPackageNamePrefix(textBeforeLine: string): string | null {
  const match = textBeforeLine.match(
    /^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)?$/,
  );
  return match ? (match[1] ?? "") : null;
}

const CSS_LANGUAGES = new Set(["css", "scss", "sass", "less"]);

function getPrefixCharClass(language: string): string {
  if (CSS_LANGUAGES.has(language)) {
    return "A-Za-z0-9_#.@-";
  }
  if (
    language === "astro" ||
    language === "html" ||
    language === "blade" ||
    language === "vue" ||
    language === "svelte"
  ) {
    return "A-Za-z0-9_:@-";
  }
  if (language === "bash") {
    return "A-Za-z0-9_-";
  }
  return "A-Za-z0-9_$";
}

function getValidForRegex(
  language: string,
  inString: boolean,
  inBrace = false,
): RegExp {
  if (inString) {
    return /^[A-Za-z0-9_./:-]*$/;
  }
  if (inBrace) {
    return /^[A-Za-z0-9_#.@:$/\-\s]*$/;
  }
  if (language === "bash") {
    return /^[A-Za-z0-9_\-$]*$/;
  }
  if (CSS_LANGUAGES.has(language)) {
    return /^[A-Za-z0-9_#.@:-]*$/;
  }
  const charClass = getPrefixCharClass(language);
  return new RegExp(`^[${charClass}]*$`);
}

function getPrefixMatch(
  textBeforeLine: string,
  language: string,
): { prefix: string; startColumn: number; hasDollarPrefix: boolean } | null {
  if (!textBeforeLine) return null;
  const charClass = getPrefixCharClass(language);
  const regex = new RegExp(`[${charClass}]+$`);
  const match = textBeforeLine.match(regex);
  const prefix = match?.[0] || "";
  const startIndex = match?.index ?? textBeforeLine.length;
  let hasDollarPrefix = false;

  if (language === "bash") {
    const dollarIndex = textBeforeLine.length - prefix.length - 1;
    if (dollarIndex >= 0 && textBeforeLine[dollarIndex] === "$") {
      hasDollarPrefix = true;
    }
  }

  if (!prefix && !hasDollarPrefix) return null;
  return { prefix, startColumn: startIndex + 1, hasDollarPrefix };
}

function normalizePrefixForLanguage(
  prefix: string,
  language: string,
  hasDollarPrefix: boolean,
): string {
  if (language === "bash" && hasDollarPrefix) {
    return `$${prefix}`;
  }
  return prefix;
}

function snippetToPlainText(snippetText: string): string {
  return snippetText
    .replace(/\$\{[0-9]+:[^}]*\}/g, "")
    .replace(/\$\{[0-9]+\}/g, "")
    .replace(/\(\$[0-9]+\)/g, "()")
    .replace(/\$[0-9]+/g, "")
    .replace(/\{[ᴸᴿ]?[FN]?\}/g, "")
    .replace(/[\u2070-\u209F]/g, "");
}

function hasSnippetPlaceholder(snippetText: string): boolean {
  return /\$\d+|\$\{\d+(?::[^}]*)?\}/.test(snippetText);
}

function toCodeMirrorSnippetTemplate(snippetText: string): string {
  return snippetText.replace(/\$(\d+)/g, (_match, index: string) =>
    index === "0" ? "${}" : `\${${index}}`,
  );
}

function textEditToChange(
  state: EditorState,
  edit: TextEditJSON,
): CompletionTextEditChange | null {
  if (
    edit.startLine < 1 ||
    edit.endLine < edit.startLine ||
    edit.startLine > state.doc.lines ||
    edit.endLine > state.doc.lines ||
    edit.startColumn < 1 ||
    edit.endColumn < 1
  ) {
    return null;
  }

  const startLine = state.doc.line(edit.startLine);
  const endLine = state.doc.line(edit.endLine);
  const startColumnLimit = startLine.length + 1;
  const endColumnLimit = endLine.length + 1;
  if (
    edit.startColumn > startColumnLimit ||
    edit.endColumn > endColumnLimit ||
    (edit.startLine === edit.endLine && edit.endColumn < edit.startColumn)
  ) {
    return null;
  }

  return {
    from: startLine.from + edit.startColumn - 1,
    to: endLine.from + edit.endColumn - 1,
    insert: edit.text,
  };
}

function completionRangeToTextEdit(
  range: CompletionRangeJSON,
  text: string,
): TextEditJSON {
  return {
    startLine: range.startLine,
    startColumn: range.startColumn,
    endLine: range.endLine,
    endColumn: range.endColumn,
    text,
  };
}

function primaryTextEditToChange(
  state: EditorState,
  edit?: PrimaryTextEditJSON | null,
): CompletionTextEditChange | null {
  if (!edit) {
    return null;
  }
  const range = edit.insert || edit.range || edit.replace;
  if (!range) {
    return null;
  }
  return textEditToChange(
    state,
    completionRangeToTextEdit(range, edit.newText || ""),
  );
}

function additionalTextEditsToChanges(
  state: EditorState,
  edits?: TextEditJSON[],
): CompletionTextEditChange[] | null {
  if (!edits?.length) {
    return [];
  }
  const changes: CompletionTextEditChange[] = [];
  for (const edit of edits) {
    const change = textEditToChange(state, edit);
    if (!change) {
      return null;
    }
    changes.push(change);
  }
  return changes;
}

function applyAdditionalTextEdits(
  view: EditorView,
  edits?: TextEditJSON[],
): { from: (position: number, assoc?: number) => number } | null {
  if (!edits?.length) {
    return null;
  }

  const changes = additionalTextEditsToChanges(view.state, edits);
  if (!changes?.length) {
    return null;
  }
  const changeSet = view.state.changes(
    [...changes].sort((a, b) => a.from - b.from),
  );
  view.dispatch({
    changes: changeSet,
    annotations: Transaction.userEvent.of("input.complete"),
  });

  return {
    from: (position, assoc = 1) => changeSet.mapPos(position, assoc),
  };
}

function applyBackendCompletion(
  view: EditorView,
  completionToApply: Completion,
  from: number,
  to: number,
  insertText: string,
  plainText: string,
  isSnippet: boolean,
  primaryTextEdit?: PrimaryTextEditJSON | null,
  additionalTextEdits?: TextEditJSON[],
) {
  const additionalChanges = additionalTextEditsToChanges(
    view.state,
    additionalTextEdits,
  );
  if (!additionalChanges) {
    return;
  }
  const primaryChange = primaryTextEdit
    ? primaryTextEditToChange(view.state, primaryTextEdit)
    : null;
  if (primaryTextEdit && !primaryChange) {
    return;
  }
  if (!completionChangesAreBounded(additionalChanges, primaryChange)) {
    return;
  }

  if (isSnippet && hasSnippetPlaceholder(insertText)) {
    const mapper =
      additionalChanges.length > 0
        ? applyAdditionalTextEdits(view, additionalTextEdits)
        : null;
    const snippetFrom = primaryChange
      ? mapper
        ? mapper.from(primaryChange.from, 1)
        : primaryChange.from
      : mapper
        ? mapper.from(from, 1)
        : from;
    const snippetTo = primaryChange
      ? mapper
        ? mapper.from(primaryChange.to, -1)
        : primaryChange.to
      : mapper
        ? mapper.from(to, -1)
        : to;
    snippet(toCodeMirrorSnippetTemplate(insertText))(
      view,
      completionToApply,
      snippetFrom,
      snippetTo,
    );
    return;
  }

  if (additionalChanges.length > 0 || primaryChange) {
    const changes = [
      ...additionalChanges,
      primaryChange || { from, to, insert: plainText },
    ].sort((a, b) => a.from - b.from);
    view.dispatch({
      changes: view.state.changes(changes),
      annotations: [
        pickedCompletion.of(completionToApply),
        Transaction.userEvent.of("input.complete"),
      ],
    });
    return;
  }

  const completionTransaction = insertCompletionText(
    view.state,
    plainText,
    from,
    to,
  );
  view.dispatch({
    ...completionTransaction,
    annotations: [
      pickedCompletion.of(completionToApply),
      Transaction.userEvent.of("input.complete"),
    ],
  });
}

function completionChangesAreBounded(
  additionalChanges: CompletionTextEditChange[],
  primaryChange: CompletionTextEditChange | null,
): boolean {
  const changes = [
    ...additionalChanges,
    ...(primaryChange ? [primaryChange] : []),
  ].sort((a, b) => a.from - b.from || a.to - b.to);

  if (changes.length > MAX_COMPLETION_TEXT_EDITS) {
    return false;
  }

  let insertedTextLength = 0;
  let previousEnd = -1;
  for (const change of changes) {
    if (change.from < previousEnd) {
      return false;
    }
    insertedTextLength += change.insert.length;
    if (insertedTextLength > MAX_COMPLETION_EDIT_TEXT_LENGTH) {
      return false;
    }
    previousEnd = Math.max(previousEnd, change.to);
  }

  return true;
}

function resolveWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => window.clearTimeout(timeout));
  });
}

async function resolveEditorCompletionWithBudget(
  resolveToken: string,
): Promise<CompletionResolvePayload | null> {
  if (!resolveToken) {
    return null;
  }
  return resolveWithTimeout(
    ResolveEditorCompletion(resolveToken),
    COMPLETION_RESOLVE_TIMEOUT_MS,
  );
}

function completionAddsUsefulText(
  prefix: string,
  insertText: string,
  primaryTextEdit?: PrimaryTextEditJSON,
  additionalTextEdits?: TextEditJSON[],
  resolveToken?: string,
): boolean {
  if (
    primaryTextEdit ||
    (additionalTextEdits && additionalTextEdits.length > 0) ||
    resolveToken
  ) {
    return true;
  }
  if (!prefix) {
    return insertText.trim().length > 0;
  }

  const prefixLower = prefix.toLowerCase();
  const insertLower = insertText.toLowerCase();
  if (!insertLower.startsWith(prefixLower)) {
    return insertLower.length > 0 && insertLower !== prefixLower;
  }

  return insertText.length > prefix.length;
}

function isExactSelfEchoCompletion(
  item: CompletionPayload,
  prefix: string,
  insertText: string,
): boolean {
  if (!prefix) {
    return false;
  }

  const labelLower = (item.label || item.text || "").toLowerCase();
  if (labelLower !== prefix.toLowerCase()) {
    return false;
  }

  return !completionAddsUsefulText(
    prefix,
    insertText,
    item.primaryTextEdit,
    item.additionalTextEdits,
    item.resolveToken,
  );
}

function getWordAtLinePosition(
  lineText: string,
  column: number,
  language: string,
): { word: string; startColumn: number; endColumn: number } | null {
  const index = Math.max(0, Math.min(column - 1, lineText.length));
  const left = lineText.slice(0, index);
  const right = lineText.slice(index);
  const charClass = getPrefixCharClass(language);
  const leftMatch = left.match(new RegExp(`[${charClass}]+$`));
  const rightMatch = right.match(new RegExp(`^[${charClass}]+`));
  if (!leftMatch && !rightMatch) return null;
  const word = `${leftMatch?.[0] || ""}${rightMatch?.[0] || ""}`;
  const startColumn = index - (leftMatch?.[0].length || 0) + 1;
  const endColumn = index + (rightMatch?.[0].length || 0) + 1;
  return { word, startColumn, endColumn };
}

function buildCompletionContext(fullText: string, lineNumber: number) {
  let currentClass = "";
  let currentMethod = "";
  const imports: string[] = [];
  const lines = fullText.split("\n");

  lines.forEach((line, index) => {
    if (line.match(/^\s*use\s+[\w\\]+;/)) {
      const match = line.match(/use\s+([\w\\]+)/);
      if (match) imports.push(match[1]);
    }
    if (line.match(/^\s*(class|trait|interface)\s+\w+/)) {
      const match = line.match(/(class|trait|interface)\s+(\w+)/);
      if (match) currentClass = match[2];
    }
    if (line.match(/^\s*(public|private|protected)?\s*function\s+\w+/)) {
      const match = line.match(/function\s+(\w+)/);
      if (match && index + 1 < lineNumber) currentMethod = match[1];
    }
  });

  return { currentClass, currentMethod, imports };
}

function buildCompletionCacheKey(
  lineNumber: number,
  accessChain: string | null,
  inStringContext: boolean,
  inBraceContext: boolean,
) {
  return [
    lineNumber,
    accessChain || "-",
    inStringContext ? "string" : "plain",
    inBraceContext ? "brace" : "flow",
  ].join("|");
}

function endsWithAccessTrigger(text: string) {
  return text.endsWith(".") || text.endsWith("->") || text.endsWith("::");
}

function isProbablyLineComment(textBeforeLine: string, language: string) {
  const trimmed = textBeforeLine.trimStart();
  if (!trimmed) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return true;
  if (
    ["python", "ruby", "bash", "shell", "yaml", "dockerfile"].includes(
      language,
    ) &&
    trimmed.startsWith("#")
  ) {
    return true;
  }
  return language === "sql" && trimmed.startsWith("--");
}

function hasOpenStringLiteral(textBeforeLine: string) {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (const char of textBeforeLine) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    }
  }

  return quote !== null;
}

function mapCompletionKindString(kind: string): string {
  const normalized = kind.toLowerCase();
  const kindMap: Record<string, string> = {
    text: "text",
    method: "method",
    function: "function",
    constructor: "constructor",
    field: "field",
    variable: "variable",
    class: "class",
    interface: "interface",
    module: "module",
    property: "property",
    unit: "unit",
    value: "value",
    enum: "enum",
    keyword: "keyword",
    snippet: "snippet",
    file: "file",
    reference: "reference",
    folder: "folder",
    enummember: "enum-member",
    constant: "constant",
    struct: "type",
    event: "event",
    operator: "operator",
    typeparameter: "type-parameter",
    model: "class",
    controller: "class",
    middleware: "function",
    migration: "file",
    trait: "interface",
    namespace: "module",
    package: "module",
    decorator: "function",
    test: "function",
  };
  return kindMap[normalized] || normalized || "text";
}

export const useCodeMirrorCompletionProvider = ({
  enabled,
  filePath,
  language,
  content,
  editorFeatureBudget,
  getEditorView,
  onTyping,
  onGhostShown,
  onGhostRejected,
  onEscape,
}: CodeMirrorCompletionProviderOptions): CodeMirrorCompletionProviderHandle => {
  const onTypingRef = useRef(onTyping);
  const onGhostShownRef = useRef(onGhostShown);
  const onGhostRejectedRef = useRef(onGhostRejected);
  const onEscapeRef = useRef(onEscape);
  const getEditorViewRef = useRef(getEditorView);
  const documentVersionRef = useRef(0);
  const completionDismissedVersionRef = useRef<number | null>(null);
  const autoStartedCompletionVersionRef = useRef<number | null>(null);
  const initialDocLengthRef = useRef(content.length);
  const completionCacheRef = useRef(
    createCompletionCache(COMPLETION_CACHE_TTL_MS),
  );
  const lastContentPropRef = useRef(content);
  const lastUserChangeContentRef = useRef<string | null>(null);
  const [predictionStatus, setPredictionStatus] =
    useState<AIPredictionStatus | null>(null);

  onTypingRef.current = onTyping;
  onGhostShownRef.current = onGhostShown;
  onGhostRejectedRef.current = onGhostRejected;
  onEscapeRef.current = onEscape;
  getEditorViewRef.current = getEditorView;

  const orchestrator = useMemo(() => createCompletionOrchestrator({}), []);

  const resetCompletionState = useCallback(() => {
    completionDismissedVersionRef.current = null;
    autoStartedCompletionVersionRef.current = null;
    completionCacheRef.current.invalidate();
    orchestrator.cancelPending();
  }, [orchestrator]);

  useEffect(() => {
    if (!enabled || !filePath || !language) {
      documentVersionRef.current = 0;
      resetCompletionState();
      return;
    }

    documentVersionRef.current = 1;
    lastContentPropRef.current = content;
    lastUserChangeContentRef.current = null;
    resetCompletionState();
  }, [enabled, filePath, language, resetCompletionState]);

  useEffect(() => {
    if (!enabled) return;
    if (lastContentPropRef.current === content) return;

    lastContentPropRef.current = content;
    if (lastUserChangeContentRef.current === content) {
      lastUserChangeContentRef.current = null;
      return;
    }

    documentVersionRef.current += 1;
    resetCompletionState();
  }, [content, enabled, resetCompletionState]);

  useEffect(() => {
    if (!enabled) {
      setPredictionStatus(null);
      return;
    }

    let disposed = false;
    const loadPredictionStatus = async () => {
      try {
        const status = await AIGetPredictionStatus();
        if (!disposed) {
          setPredictionStatus(status);
        }
      } catch (error) {
        console.debug("AI prediction status unavailable:", error);
        if (!disposed) {
          setPredictionStatus(null);
        }
      }
    };

    void loadPredictionStatus();
    const unsubscribe = EventsOn<[AIPredictionStatus]>(
      "ai:prediction:settings-updated",
      (status) => {
        if (!disposed) {
          setPredictionStatus(status);
        }
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [enabled]);

  const recordDocumentChange = useCallback(
    (value: string) => {
      if (!enabled) return;
      lastUserChangeContentRef.current = value;
      documentVersionRef.current += 1;
      resetCompletionState();
    },
    [enabled, resetCompletionState],
  );

  const metrics = useMemo(() => {
    if (!enabled || !editorFeatureBudget.richEditorFeatures) {
      return NOOP_METRICS;
    }

    return metricsExtension(
      {
        onTyping: (chars) => onTypingRef.current?.(chars),
        onGhostShown: () => onGhostShownRef.current?.(),
        onGhostRejected: () => onGhostRejectedRef.current?.(),
        onCompletionAccepted: (item) => {
          const label = item.label || "";
          if (label) {
            RecordCompletionUsage(label).catch(() => {});
          }
        },
        onJitterUpdate: (stats) => {
          if (stats.total > 0 && stats.total % 10 === 0) {
            console.debug(
              "[AutocompleteV2][UI] jitter",
              Math.round(stats.ratio * 1000) / 10,
              "%",
            );
          }
        },
        onAutocompleteLatencyUpdate: (stats) => {
          if (stats.samples > 0 && stats.samples % 10 === 0) {
            console.debug(
              "[AutocompleteV2][UI] latency",
              `p50=${Math.round(stats.p50Ms)}ms`,
              `p95=${Math.round(stats.p95Ms)}ms`,
              `last=${Math.round(stats.lastMs)}ms`,
              `n=${stats.samples}`,
            );
          }
        },
        onRequestPressureUpdate: (stats) => {
          console.debug(
            "[AutocompleteV2][UI] pressure",
            `backend=${stats.backendRequests}`,
            `cacheHit=${stats.cacheHits}`,
            `cacheMiss=${stats.cacheMisses}`,
            `instant=${stats.instantFallbacks}`,
          );
        },
      },
      initialDocLengthRef.current,
    );
  }, [editorFeatureBudget.richEditorFeatures, enabled]);

  const handleProviderEscape = useCallback(() => {
    completionDismissedVersionRef.current = documentVersionRef.current;
    autoStartedCompletionVersionRef.current = null;
    orchestrator.cancelPending();
    onEscapeRef.current?.();
  }, [orchestrator]);

  const ghost = useMemo(() => {
    if (
      !enabled ||
      (!editorFeatureBudget.ghostText && !editorFeatureBudget.completions)
    ) {
      return NOOP_GHOST;
    }

    return ghostExtension({
      filePath,
      language,
      ghostDebounceMs: GHOST_DEBOUNCE_MS,
      ghostIdleDelayMs:
        predictionStatus?.settings?.enabled && predictionStatus.settings.idleMs
          ? predictionStatus.settings.idleMs
          : GHOST_IDLE_DELAY_MS,
      buildCompletionContext,
      fetchCompletions: async (payload) => {
        const result = (await GetEditorCompletions({
          ...payload,
          version: documentVersionRef.current,
        })) as EditorCompletionResult | null;
        if (!result) {
          return null;
        }
        return {
          ...result,
          primary: result.primary ?? undefined,
        };
      },
      fetchAIPrediction: async (payload) => {
        const status = predictionStatus;
        if (!status?.enabled || !status.providerReady) {
          return null;
        }

        const settings = status.settings;
        const versionAtRequest = documentVersionRef.current;
        const documentVersion = `${versionAtRequest}`;
        const response = (await AIGetEditorContinuation(
          {
            ...payload,
            requestId: `${payload.requestId}-${documentVersion}`,
            documentVersion,
            capability: "line_prediction",
            prompt: "Continue the code at the cursor.",
            includeMnemonic: false,
            includeMCP: false,
            includeSkills: false,
            includeContinuity: false,
            maxBytes: settings.maxPromptBytes,
            maxSnippets: 0,
            optInSource: "editor_prediction_background",
          } as Parameters<typeof AIGetEditorContinuation>[0],
          settings.providerId || status.providerId || "",
          settings.model || status.model || "",
        )) as {
          text?: string;
          requestId?: string;
          documentVersion?: string;
          providerId?: string;
          model?: string;
        };

        if (versionAtRequest !== documentVersionRef.current) {
          return { stale: true };
        }
        if (
          response.documentVersion &&
          response.documentVersion !== documentVersion
        ) {
          return { stale: true };
        }

        return {
          text: response.text || "",
          requestId: response.requestId,
          documentVersion: response.documentVersion,
          providerId: response.providerId,
          model: response.model,
        };
      },
      onGhostShown: metrics.recordGhostShown,
      onGhostRejected: metrics.recordGhostRejected,
      onCompletionAccepted: (label) => {
        if (!label) return;
        metrics.recordCompletionAccepted({ label } as Completion);
      },
      onEscape: handleProviderEscape,
      helpers: {
        trimToTokenLimit,
        snippetToPlainText,
        getWordAtLinePosition,
        extractStringPrefix,
        extractAccessPrefix,
        extractKeywordPrefix,
      },
    });
  }, [
    editorFeatureBudget.completions,
    editorFeatureBudget.ghostText,
    enabled,
    filePath,
    handleProviderEscape,
    language,
    metrics,
    predictionStatus,
  ]);

  useEffect(() => () => ghost.cleanup(), [ghost]);

  useEffect(() => {
    if (!enabled) return;

    const handleAutocompleteEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;

      const view = getEditorViewRef.current?.();
      if (!view?.hasFocus) return;
      if (completionStatus(view.state) === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      handleProviderEscape();
      closeCompletion(view);
    };

    window.addEventListener("keydown", handleAutocompleteEscape, true);
    return () =>
      window.removeEventListener("keydown", handleAutocompleteEscape, true);
  }, [enabled, handleProviderEscape]);

  const fetchPendingClassCompletions = useCallback(
    async (context: CompletionContext): Promise<Completion[]> => {
      if (!enabled || !editorFeatureBudget.completions) return [];
      if (language !== "php") return [];

      const textUntilPosition = context.state.doc.sliceString(0, context.pos);
      const patterns = [
        /new\s+([A-Z][a-zA-Z0-9]*)$/,
        /extends\s+([A-Z][a-zA-Z0-9]*)$/,
        /implements\s+([A-Z][a-zA-Z0-9,\s]*)$/,
        /use\s+([A-Z][a-zA-Z0-9\\]*)$/,
        /([A-Z][a-zA-Z0-9]*)::$/,
      ];

      let prefix = "";
      for (const pattern of patterns) {
        const match = textUntilPosition.match(pattern);
        if (match) {
          prefix = match[1];
          break;
        }
      }

      if (!prefix || prefix.length < 2) {
        return [];
      }

      try {
        const results = await SearchClasses(prefix);
        if (!results || results.length === 0) return [];

        return results.map((result) => ({
          label: result.name,
          detail: result.pending
            ? `[PENDING] ${result.namespace}`
            : result.namespace,
          info: result.pending
            ? `This class will be created at:\n${result.filePath}`
            : `${result.namespace}\\${result.name}`,
          type: mapCompletionKindString(result.kind || "class"),
          apply: (view, _completion, from, to) => {
            view.dispatch({
              changes: { from, to, insert: result.name },
            });
            metrics.recordCompletionAccepted({
              label: result.name,
            } as Completion);
          },
          boost: result.pending ? -0.2 : 0,
        }));
      } catch {
        return [];
      }
    },
    [editorFeatureBudget.completions, enabled, language, metrics],
  );

  const buildInstantCompletionResult = useCallback(
    (
      context: CompletionContext,
      buildOptions: { recordMetrics?: boolean } = {},
    ): CompletionResult | null => {
      if (!enabled || !editorFeatureBudget.completions) return null;
      if (context.aborted) return null;

      const pos = context.pos;
      const line = context.state.doc.lineAt(pos);
      const column = pos - line.from + 1;
      const textBeforeLine = line.text.slice(0, column - 1);
      const accessInfo = extractAccessPrefix(textBeforeLine);
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const packageNamePrefix =
        language === "go" ? extractGoPackageNamePrefix(textBeforeLine) : null;

      if (
        (stringPrefix !== null && packageNamePrefix === null) ||
        isProbablyLineComment(textBeforeLine, language) ||
        hasOpenStringLiteral(textBeforeLine)
      ) {
        return null;
      }

      const prefixMatch = getPrefixMatch(textBeforeLine, language);
      const rawPrefix =
        packageNamePrefix ?? accessInfo?.prefix ?? prefixMatch?.prefix ?? "";
      const currentPrefix = normalizePrefixForLanguage(
        rawPrefix,
        language,
        prefixMatch?.hasDollarPrefix ?? false,
      );

      if (
        !accessInfo &&
        packageNamePrefix === null &&
        currentPrefix.length === 0
      ) {
        return null;
      }

      const from =
        packageNamePrefix !== null
          ? pos - packageNamePrefix.length
          : accessInfo
            ? line.from + column - accessInfo.prefix.length - 1
            : prefixMatch
              ? line.from + prefixMatch.startColumn - 1
              : pos;

      const instantDocumentOptions =
        !accessInfo &&
        packageNamePrefix === null &&
        currentPrefix.length >= 2 &&
        context.state.doc.length <= 160_000
          ? getInstantDocumentCompletions(
              context.state.doc.toString(),
              currentPrefix,
            )
          : [];
      const completionOptions =
        packageNamePrefix !== null
          ? [
              {
                label: "main",
                detail: "package name",
                type: "keyword",
                apply: "main",
                boost: 1.25,
              } satisfies Completion,
            ].filter((item) =>
              item.label.toLowerCase().startsWith(currentPrefix.toLowerCase()),
            )
          : accessInfo
            ? []
            : mergeInstantCompletions(
                getInstantKeywordCompletions(language, currentPrefix),
                instantDocumentOptions,
              );

      if (completionOptions.length === 0) {
        return null;
      }

      if (buildOptions.recordMetrics !== false) {
        metrics.recordInstantFallbackUsed();
        metrics.recordCompletionList(completionOptions);
      }
      return {
        from,
        options: completionOptions,
        validFor: getValidForRegex(language, false),
      };
    },
    [editorFeatureBudget.completions, enabled, language, metrics],
  );

  const backendCompletionSource = useCallback(
    (context: CompletionContext) => {
      if (!enabled || !editorFeatureBudget.completions) return null;
      if (context.aborted) return null;
      const pos = context.pos;
      const line = context.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;
      const textBeforeLine = line.text.slice(0, column - 1);
      const accessInfo = extractAccessPrefix(textBeforeLine);
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const packageNamePrefix =
        language === "go" ? extractGoPackageNamePrefix(textBeforeLine) : null;
      const prefixMatch = getPrefixMatch(textBeforeLine, language);
      const braceCharClass = getPrefixCharClass(language);
      const braceTailRegex = new RegExp(
        `\\{[^\\S\\r\\n]*([${braceCharClass}]*)$`,
      );
      const braceTailMatch = textBeforeLine.match(braceTailRegex);
      const inBraceContext = braceTailMatch !== null;
      const bracePrefix = braceTailMatch?.[1] || "";
      const braceTailStartColumn = inBraceContext
        ? textBeforeLine.length - bracePrefix.length + 1
        : null;
      const recent = context.state.doc.sliceString(Math.max(0, pos - 2), pos);
      const accessTrigger =
        recent.endsWith(".") || recent.endsWith("->") || recent.endsWith("::");
      const hasAccessTrigger = accessTrigger || accessInfo !== null;

      const rawPrefix =
        stringPrefix ??
        packageNamePrefix ??
        accessInfo?.prefix ??
        (bracePrefix.length > 0 ? bracePrefix : null) ??
        prefixMatch?.prefix ??
        "";
      const hasDollarPrefix = prefixMatch?.hasDollarPrefix ?? false;
      const currentPrefix = normalizePrefixForLanguage(
        rawPrefix,
        language,
        hasDollarPrefix,
      );
      const shouldStripDollar = language === "bash" && hasDollarPrefix;
      const htmlLike =
        language === "astro" ||
        language === "html" ||
        language === "blade" ||
        language === "vue" ||
        language === "svelte";
      let triggerChar = hasAccessTrigger
        ? recent.slice(-1)
        : hasDollarPrefix
          ? "$"
          : rawPrefix.slice(-1) || "";
      const trimmedLine = textBeforeLine.replace(/\s+$/, "");
      if (htmlLike && /<\s*[A-Za-z0-9:_-]*$/.test(textBeforeLine)) {
        triggerChar = "<";
      } else if (
        CSS_LANGUAGES.has(language) &&
        /:\s*[^;]*$/.test(textBeforeLine)
      ) {
        triggerChar = ":";
      } else if (/:\s*$/.test(textBeforeLine)) {
        triggerChar = ":";
      } else if (!triggerChar && inBraceContext) {
        triggerChar = "{";
      } else if (!triggerChar && trimmedLine) {
        triggerChar = trimmedLine.slice(-1);
      }

      const hasExplicitCompletionTrigger =
        currentPrefix.length > 0 ||
        stringPrefix !== null ||
        hasDollarPrefix ||
        hasAccessTrigger ||
        packageNamePrefix !== null ||
        triggerChar === "<" ||
        triggerChar === ":" ||
        triggerChar === "{";

      if (!hasExplicitCompletionTrigger) {
        return null;
      }
      const from =
        stringPrefix !== null
          ? line.from + column - stringPrefix.length - 1
          : packageNamePrefix !== null
            ? pos - packageNamePrefix.length
            : accessInfo
              ? line.from + column - accessInfo.prefix.length - 1
              : braceTailStartColumn !== null
                ? line.from + braceTailStartColumn - 1
                : prefixMatch
                  ? line.from + prefixMatch.startColumn - 1
                  : pos;

      const cacheKey = buildCompletionCacheKey(
        lineNumber,
        accessInfo?.accessChain ?? null,
        stringPrefix !== null,
        inBraceContext,
      );
      const requestVersion = documentVersionRef.current;
      const wasAutoStartedForVersion =
        autoStartedCompletionVersionRef.current === requestVersion;
      const isDismissedForVersion = (version: number) =>
        completionDismissedVersionRef.current === version &&
        (!context.explicit || wasAutoStartedForVersion);
      if (isDismissedForVersion(requestVersion)) return null;

      const buildCompletionResult = async (
        requestId: number,
        versionAtRequest: number,
      ): Promise<CompletionResult | null> => {
        const fullText = context.state.doc.toString();
        const lineText = line.text;
        const textBefore = fullText.slice(0, pos);
        const textAfter = fullText.slice(pos);
        const { currentClass, currentMethod, imports } = buildCompletionContext(
          fullText,
          lineNumber,
        );

        metrics.recordBackendRequestStarted();
        const result = (await GetEditorCompletions({
          filePath,
          language,
          line: lineNumber,
          column,
          version: requestVersion,
          lineText,
          textBefore,
          textAfter,
          fullText,
          currentClass,
          currentMethod,
          imports,
          triggerChar,
        })) as EditorCompletionResult | null;

        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (isDismissedForVersion(versionAtRequest)) return null;
        if (result && "stale" in result && result.stale) return null;
        if (!result?.items?.length) return null;

        const pendingItems = accessInfo
          ? []
          : await fetchPendingClassCompletions(context);
        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (isDismissedForVersion(versionAtRequest)) return null;

        const completions: Completion[] = result.items.flatMap(
          (rawItem, itemIndex) => {
            const item = rawItem as typeof rawItem & CompletionPayload;
            const completionItem = item;
            let insertText = item.insertText || item.text || item.label || "";
            if (shouldStripDollar && insertText.startsWith("$")) {
              insertText = insertText.slice(1);
            }
            const resolvedInsertText =
              snippetToPlainText(insertText) || insertText;
            const isSnippet =
              item.isSnippet === true || hasSnippetPlaceholder(insertText);
            if (
              isExactSelfEchoCompletion(item, currentPrefix, resolvedInsertText)
            ) {
              return [];
            }
            const kind = item.kind || "text";
            const source = item.source || "index";
            const sourceLabel = SOURCE_LABELS[source] || source;

            const applyCompletion = (
              view: EditorView,
              completionToApply: Completion,
              applyFrom: number,
              applyTo: number,
            ) => {
              const versionAtApply = documentVersionRef.current;
              const applyResolved = (
                finalInsertText: string,
                finalIsSnippet: boolean,
                finalPrimaryTextEdit?: PrimaryTextEditJSON | null,
                finalAdditionalTextEdits?: TextEditJSON[],
              ) => {
                const finalPlainText =
                  snippetToPlainText(finalInsertText) || finalInsertText;
                applyBackendCompletion(
                  view,
                  completionToApply,
                  applyFrom,
                  applyTo,
                  finalInsertText,
                  finalPlainText,
                  finalIsSnippet,
                  finalPrimaryTextEdit,
                  finalAdditionalTextEdits,
                );
                metrics.recordCompletionAccepted(completionToApply);
              };

              const hasReadyAdditionalTextEdits =
                (item.additionalTextEdits?.length || 0) > 0;
              const shouldResolveBeforeApply =
                Boolean(item.resolveToken) &&
                (completionItem.requiresResolveBeforeApply !== false ||
                  !hasReadyAdditionalTextEdits);
              if (shouldResolveBeforeApply) {
                void (async () => {
                  const resolved = await resolveEditorCompletionWithBudget(
                    item.resolveToken || "",
                  );
                  if (versionAtApply !== documentVersionRef.current) return;
                  if (resolved) {
                    applyResolved(
                      resolved.insertText || insertText,
                      resolved.isSnippet === true || isSnippet,
                      resolved.primaryTextEdit || item.primaryTextEdit,
                      resolved.additionalTextEdits?.length
                        ? resolved.additionalTextEdits
                        : item.additionalTextEdits,
                    );
                    return;
                  }
                  if (
                    completionItem.autoImportAllowed &&
                    !hasReadyAdditionalTextEdits
                  ) {
                    return;
                  }
                  applyResolved(
                    insertText,
                    isSnippet,
                    item.primaryTextEdit,
                    item.additionalTextEdits,
                  );
                })();
                return;
              }

              applyResolved(
                insertText,
                isSnippet,
                item.primaryTextEdit,
                item.additionalTextEdits,
              );
            };

            const hasAdditionalTextEdits =
              (item.additionalTextEdits?.length || 0) > 0;
            const hasPrimaryTextEdit = Boolean(item.primaryTextEdit);
            const backendPriority = item.priority || 0;
            const stableIndexTiebreak = -itemIndex / 100000;
            const richCompletionBoost =
              isSnippet ||
              hasPrimaryTextEdit ||
              hasAdditionalTextEdits ||
              item.resolveToken
                ? 1.5
                : 0;
            const displayLabel = item.label || item.text || "";
            const filterLabel = item.filterText || displayLabel;

            const completion: CompletionWithInsertText = {
              label: filterLabel,
              displayLabel:
                displayLabel && displayLabel !== filterLabel
                  ? displayLabel
                  : undefined,
              detail: item.detail || kind,
              info: item.documentation || undefined,
              type: mapCompletionKindString(kind),
              apply: applyCompletion,
              boost:
                richCompletionBoost +
                backendPriority / 1000 +
                stableIndexTiebreak,
              __insertText: resolvedInsertText,
              __filterText: filterLabel,
              __hasAdditionalTextEdits:
                hasPrimaryTextEdit ||
                hasAdditionalTextEdits ||
                Boolean(item.resolveToken),
              __completionId: completionItem.completionId,
              __stableKey: completionItem.stableKey,
              __autoImportAllowed: completionItem.autoImportAllowed === true,
              __requiresResolveBeforeApply:
                completionItem.requiresResolveBeforeApply === true,
            };
            (completion as unknown as Record<string, unknown>).__source =
              sourceLabel;

            return [completion];
          },
        );

        const shouldStabilizeAccessList =
          accessInfo !== null && currentPrefix.length === 0;
        const allOptions = shouldStabilizeAccessList
          ? sortAccessCompletionOptions([...pendingItems, ...completions])
          : [...pendingItems, ...completions];
        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (isDismissedForVersion(versionAtRequest)) return null;

        completionCacheRef.current.set({
          items: allOptions,
          prefix: currentPrefix,
          timestamp: Date.now(),
          filePath,
          semanticKey: cacheKey,
        });
        metrics.recordCompletionList(allOptions);
        orchestrator.markResponse(requestId);

        return {
          from,
          options: allOptions,
          validFor: getValidForRegex(
            language,
            stringPrefix !== null,
            inBraceContext,
          ),
        };
      };

      const cachedItems = completionCacheRef.current.get(
        filePath,
        cacheKey,
        currentPrefix,
      );
      if (cachedItems && cachedItems.length > 0) {
        metrics.recordCacheHit();
        if (accessInfo?.accessChain && currentPrefix.length === 0) {
          metrics.recordAccessChainWarmHit();
        }
        metrics.recordCompletionList(cachedItems);
        return {
          from,
          options: cachedItems,
          validFor: getValidForRegex(
            language,
            stringPrefix !== null,
            inBraceContext,
          ),
        };
      }

      metrics.recordCacheMiss();

      const instantResult = buildInstantCompletionResult(context, {
        recordMetrics: false,
      });
      const requestId = orchestrator.nextRequestId();
      const backendPromise = buildCompletionResult(
        requestId,
        requestVersion,
      ).catch((err) => {
        console.warn("Completion error:", err);
        return null;
      });
      if (instantResult && accessInfo !== null) {
        void backendPromise;
        metrics.recordInstantFallbackUsed();
        metrics.recordCompletionList([...instantResult.options]);
        return {
          ...instantResult,
          options: instantResult.options.map((completion) => {
            const originalApply = completion.apply;
            const completionMetadata = completion as Completion & {
              __insertText?: unknown;
              __hasAdditionalTextEdits?: unknown;
              __completionId?: unknown;
              __stableKey?: unknown;
            };
            const originalInsertText =
              typeof completionMetadata.__insertText === "string" &&
              completionMetadata.__insertText
                ? completionMetadata.__insertText
                : typeof originalApply === "string"
                  ? originalApply
                  : completion.label;
            const originalStableKey =
              typeof completionMetadata.__stableKey === "string"
                ? completionMetadata.__stableKey
                : "";
            const originalCompletionId =
              typeof completionMetadata.__completionId === "string"
                ? completionMetadata.__completionId
                : "";
            return {
              ...completion,
              apply: (
                view: EditorView,
                appliedCompletion: Completion,
                applyFrom: number,
                applyTo: number,
              ) => {
                const richerCompletion =
                  originalStableKey || originalCompletionId
                    ? completionCacheRef.current
                        .get(filePath, cacheKey, currentPrefix)
                        ?.find((candidate) => {
                          const metadata = candidate as Completion & {
                            __completionId?: unknown;
                            __stableKey?: unknown;
                          };
                          return (
                            (originalCompletionId &&
                              metadata.__completionId ===
                                originalCompletionId) ||
                            (originalStableKey &&
                              metadata.__stableKey === originalStableKey)
                          );
                        })
                    : undefined;

                if (richerCompletion?.apply) {
                  if (typeof richerCompletion.apply === "function") {
                    richerCompletion.apply(
                      view,
                      richerCompletion,
                      applyFrom,
                      applyTo,
                    );
                    return;
                  }

                  const completionTransaction = insertCompletionText(
                    view.state,
                    richerCompletion.apply,
                    applyFrom,
                    applyTo,
                  );
                  view.dispatch({
                    ...completionTransaction,
                    annotations: [
                      pickedCompletion.of(richerCompletion),
                      Transaction.userEvent.of("input.complete"),
                    ],
                  });
                  metrics.recordCompletionAccepted(richerCompletion);
                  return;
                }

                if (typeof originalApply === "function") {
                  originalApply(view, appliedCompletion, applyFrom, applyTo);
                  return;
                }

                const completionTransaction = insertCompletionText(
                  view.state,
                  typeof originalApply === "string"
                    ? originalApply
                    : completion.label,
                  applyFrom,
                  applyTo,
                );
                view.dispatch({
                  ...completionTransaction,
                  annotations: [
                    pickedCompletion.of(appliedCompletion),
                    Transaction.userEvent.of("input.complete"),
                  ],
                });
                metrics.recordCompletionAccepted(appliedCompletion);
              },
              __insertText: originalInsertText,
              __hasAdditionalTextEdits:
                completionMetadata.__hasAdditionalTextEdits === true,
            } satisfies CompletionWithInsertText;
          }),
        };
      }
      if (instantResult) {
        return new Promise<CompletionResult | null>((resolve) => {
          let settled = false;
          const settle = (result: CompletionResult | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(result);
          };
          const settleInstant = () => {
            metrics.recordInstantFallbackUsed();
            metrics.recordCompletionList([...instantResult.options]);
            settle(instantResult);
          };
          const timer = window.setTimeout(() => {
            settleInstant();
          }, COMPLETION_FAST_BACKEND_GRACE_MS);

          backendPromise.then((result) => {
            if (result) {
              settle(result);
            } else {
              settleInstant();
            }
          });
        });
      }

      return backendPromise;
    },
    [
      buildInstantCompletionResult,
      editorFeatureBudget.completions,
      enabled,
      fetchPendingClassCompletions,
      filePath,
      language,
      metrics,
      orchestrator,
    ],
  );

  const extensions = useMemo<Extension[]>(() => {
    if (!enabled) {
      return [];
    }

    const result: Extension[] = [];

    if (editorFeatureBudget.runtimeGhostText) {
      result.push(ghost.ghostField, ghost.extension);
    }

    if (
      editorFeatureBudget.runtimeGhostText ||
      editorFeatureBudget.runtimeCompletions
    ) {
      result.push(Prec.highest(ghost.keymap));
    }

    if (editorFeatureBudget.runtimeRichEditorFeatures) {
      result.push(metrics.extension);
    }

    if (editorFeatureBudget.runtimeCompletions) {
      result.push(
        orchestrator.extension,
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: acceptVisibleCompletion,
            },
            ...COMPLETION_KEYMAP_WITHOUT_ESCAPE_OR_ENTER,
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.view.composing || update.view.compositionStarted) return;

          let insertedNonWhitespace = false;
          let insertedAutocompleteWhitespace = false;
          update.transactions.forEach((transaction) => {
            if (!transaction.isUserEvent("input")) return;
            if (transaction.isUserEvent("input.type.compose")) return;
            if (transaction.isUserEvent("input.complete")) return;
            if (
              !transaction.isUserEvent("input.type") &&
              !transaction.isUserEvent("input.paste")
            ) {
              return;
            }
            transaction.changes.iterChanges(
              (_fromA, _toA, _fromB, _toB, inserted) => {
                const insertedText = inserted.toString();
                if (/\S/.test(insertedText)) {
                  insertedNonWhitespace = true;
                } else if (/[^\S\r\n]/.test(insertedText)) {
                  insertedAutocompleteWhitespace = true;
                }
              },
            );
          });

          const currentPos = update.state.selection.main.head;
          const currentLine = update.state.doc.lineAt(currentPos);
          const textBeforeLine = currentLine.text.slice(
            0,
            currentPos - currentLine.from,
          );
          const isWhitespaceCompletionTrigger =
            insertedAutocompleteWhitespace &&
            language === "go" &&
            extractGoPackageNamePrefix(textBeforeLine) !== null;
          if (!insertedNonWhitespace && !isWhitespaceCompletionTrigger) return;

          const recentText = update.state.doc.sliceString(
            Math.max(0, currentPos - 2),
            currentPos,
          );
          const isAccessTrigger = endsWithAccessTrigger(recentText);

          if (
            completionStatus(update.state) === "active" &&
            !isAccessTrigger &&
            !isWhitespaceCompletionTrigger
          ) {
            return;
          }

          const view = update.view;
          const docSnapshot = update.state.doc;

          queueMicrotask(() => {
            if (view.state.doc !== docSnapshot) return;
            const version = documentVersionRef.current;
            if (completionDismissedVersionRef.current === version) return;
            const status = completionStatus(view.state);
            if (
              status === "active" &&
              !isAccessTrigger &&
              !isWhitespaceCompletionTrigger
            ) {
              return;
            }
            if (view.composing || view.compositionStarted) return;
            metrics.recordAutocompleteRequested();
            autoStartedCompletionVersionRef.current = version;
            startCompletion(view);
          });
        }),
        autocompletion({
          override: [backendCompletionSource],
          activateOnTyping: false,
          activateOnTypingDelay: 0,
          updateSyncTime: COMPLETION_FAST_BACKEND_GRACE_MS,
          maxRenderedOptions: 50,
          defaultKeymap: false,
          closeOnBlur: true,
          interactionDelay: 0,
          addToOptions: [
            {
              render(completion) {
                const src = (completion as unknown as Record<string, unknown>)
                  .__source as string;
                if (!src) return null;
                const el = document.createElement("span");
                el.className = "cm-completionSource";
                el.textContent = src;
                return el;
              },
              position: 90,
            },
          ],
        }),
      );
    }

    return result;
  }, [
    backendCompletionSource,
    editorFeatureBudget.runtimeCompletions,
    editorFeatureBudget.runtimeGhostText,
    editorFeatureBudget.runtimeRichEditorFeatures,
    enabled,
    ghost,
    language,
    metrics,
    orchestrator,
  ]);

  const extensionsKey = useStableReferenceKey([
    "completion-provider",
    enabled,
    editorFeatureBudget.runtimeCompletions,
    editorFeatureBudget.runtimeGhostText,
    editorFeatureBudget.runtimeRichEditorFeatures,
    filePath,
    language,
    backendCompletionSource,
    ghost,
    metrics,
    orchestrator,
  ]);

  return {
    extensions,
    extensionsKey,
    recordDocumentChange,
  };
};
