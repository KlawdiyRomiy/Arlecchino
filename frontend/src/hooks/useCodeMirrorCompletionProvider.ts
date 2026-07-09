import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  completionStatus,
  Completion,
  CompletionContext,
  CompletionResult,
  completeFromList,
  currentCompletions,
  insertCompletionText,
  pickedCompletion,
  selectedCompletion,
  setSelectedCompletion,
  snippet,
  startCompletion,
} from "@codemirror/autocomplete";
import {
  EditorState,
  Extension,
  Prec,
  Transaction,
  type ChangeDesc,
} from "@codemirror/state";
import { EditorView, keymap, tooltips, type Rect } from "@codemirror/view";

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
import { getEditorDocumentVersion } from "../stores/editorDocumentObserver";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import type { AdaptiveEditorFeatureBudget } from "../stores/performanceStore";
import {
  createCompletionSessionController,
  filterAccessCompletionOptions,
  incompleteAccessCompletionResult,
  lspCommitCharacters,
  stableAccessCompletionResult,
  stableCompletionResult,
  stableStatusCompletionResult,
  type CompletionSessionRecord,
  type CompletionSemanticKeyReader,
} from "../utils/codeMirrorCompletionSession";
import {
  getInstantDocumentCompletions,
  getInstantKeywordCompletionOptions,
  mergeInstantCompletions,
} from "../utils/instantCompletions";
import { useStableReferenceKey } from "./useStableReferenceKey";

const GHOST_DEBOUNCE_MS = 50;
const GHOST_IDLE_DELAY_MS = 900;
const COMPLETION_FAST_BACKEND_GRACE_MS = 32;
const COMPLETION_RESOLVE_TIMEOUT_MS = 1200;
const COMPLETION_ACCEPT_RETRY_WINDOW_MS = 2400;
const MAX_COMPLETION_TEXT_EDITS = 32;
const MAX_COMPLETION_INSERT_TEXT_LENGTH = 64_000;
const MAX_COMPLETION_EDIT_TEXT_LENGTH = 64_000;
const MAX_COMPLETION_REPLACED_TEXT_LENGTH = 2048;
const MAX_PRIMARY_COMPLETION_REPLACED_TEXT_LENGTH = 512;
const ACCESS_COMPLETION_BOOST_BASE = 0.45;
const ACCESS_TRANSIENT_RETRY_LIMIT = 1;
const ACCESS_TRANSIENT_RETRY_DELAY_MS = 150;
const COMPLETION_MAX_RENDERED_OPTIONS = 1000;
const ACCESS_PENDING_COMPLETION_LABEL = "Loading members...";
const ACCESS_EMPTY_COMPLETION_LABEL = "No LSP members";
const ACCESS_ERROR_COMPLETION_LABEL = "Completion unavailable";
const COMPLETION_TOOLTIP_MARGIN_PX = 8;
const EMPTY_EXTENSION: Extension = [];

type AccessOperatorSpec = {
  operator: string;
  triggerCharacter: string;
  languages?: readonly string[];
};

const ACCESS_OPERATOR_SPECS: readonly AccessOperatorSpec[] = [
  { operator: "?->", triggerCharacter: ">" },
  { operator: "->", triggerCharacter: ">" },
  { operator: "::", triggerCharacter: ":" },
  { operator: "?.", triggerCharacter: "." },
  { operator: "&.", triggerCharacter: "." },
  { operator: ".", triggerCharacter: "." },
  { operator: ":", triggerCharacter: ":", languages: ["lua", "luau"] },
];

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
  __sortText?: string;
  __hasAdditionalTextEdits: boolean;
  __completionId?: string;
  __stableKey?: string;
  __autoImportAllowed?: boolean;
  __requiresResolveBeforeApply?: boolean;
  __requiresSafeEditsBeforeApply?: boolean;
  __sourceKind?: string;
  __statusKind?: "pending" | "empty" | "error";
};

type CompletionPayload = {
  label?: string;
  text?: string;
  filterText?: string;
  sortText?: string;
  commitCharacters?: string[];
  insertText?: string;
  isSnippet?: boolean;
  primaryTextEdit?: PrimaryTextEditJSON;
  additionalTextEdits?: TextEditJSON[];
  resolveToken?: string;
  completionId?: string;
  stableKey?: string;
  proofKind?: string;
  accessMemberAuthoritative?: boolean;
  autoImportAllowed?: boolean;
  primary?: boolean;
  requiresResolveBeforeApply?: boolean;
  requiresSafeEditsBeforeApply?: boolean;
  command?: unknown;
  data?: unknown;
  source?: string;
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

type AccessCompletionSnapshot = {
  version: number;
  options: readonly Completion[];
};

type EditorCompletionResolveRequestPayload = {
  resolveToken: string;
  completionId?: string;
  stableKey?: string;
  documentVersion?: number;
  sessionId?: string;
  surfaceId?: string;
};

type EditorCompletionResultPayload = EditorCompletionResult & {
  isIncomplete?: boolean;
  lspTriggerCharacters?: string[];
  lspResolveProvider?: boolean;
  lspCompletionAvailable?: boolean;
  lspStatus?: string;
  sourceStatuses?: Record<string, string>;
};

type EditorCompletionRequestPayload = Parameters<
  typeof GetEditorCompletions
>[0] & {
  accessOperator?: string;
  completionTriggerKind?: number;
  sessionId?: string;
  surfaceId?: string;
};

type CompletionBuildOutcome =
  | { kind: "result"; result: CompletionResult; isIncomplete: boolean }
  | { kind: "empty"; result: CompletionResult }
  | { kind: "error"; result: CompletionResult }
  | { kind: "retry" | "stale" | "canceled" };

type AccessEmptyClassification = "empty" | "error" | "canceled";

type CompletionTextEditChange = {
  from: number;
  to: number;
  insert: string;
};

type CompletionApplyRejectReason =
  | "stale-session"
  | "missing-safe-edits"
  | "missing-additional-safe-edits"
  | "oversized-insert"
  | "invalid-additional-edit-range"
  | "invalid-primary-edit-range"
  | "unsafe-primary-edit"
  | "unsafe-edit-bounds"
  | "unsafe-import-edit"
  | "unsafe-plain-fallback"
  | "resolve-timeout-or-empty"
  | "unknown";

type CompletionApplyAttemptResult =
  { applied: true } | { applied: false; reason: CompletionApplyRejectReason };

type CompletionApplyRejectDiagnostic = {
  reason: CompletionApplyRejectReason;
  label: string;
  source: string;
  completionId?: string;
  stableKey?: string;
  resolveToken?: string;
  requiresSafeEdits: boolean;
  requiresAdditionalSafeEdits: boolean;
};

type CompletionDiagnosticsGlobal = typeof globalThis & {
  __autocompleteApplyRejectLog?: CompletionApplyRejectDiagnostic[];
};

type PendingCompletionAcceptIntent = {
  filePath: string;
  semanticKey: string;
  docAtAccept: string;
  expiresAt: number;
};

export interface CodeMirrorCompletionProviderOptions {
  enabled: boolean;
  filePath: string;
  language: string;
  content: string;
  sessionId?: string;
  surfaceId?: string;
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

function acceptVisibleCompletion(
  view: EditorView,
  options?: {
    onAccepted?: () => void;
  },
): boolean {
  const status = completionStatus(view.state);
  if (status !== "active" && status !== "pending") {
    return false;
  }
  if (acceptFirstActionableCompletion(view)) {
    options?.onAccepted?.();
    return true;
  }
  return false;
}

function completionOptionIsActionable(completion: Completion): boolean {
  return !(completion as CompletionWithInsertText).__statusKind;
}

function completionOptionsHaveActionableCompletions(
  options: readonly Completion[],
): boolean {
  return options.some(completionOptionIsActionable);
}

function firstActionableCompletionIndex(
  options: readonly CompletionWithInsertText[],
): number {
  return options.findIndex(completionOptionIsActionable);
}

function actionableCompletionIsSelected(view: EditorView): boolean {
  const selected = selectedCompletion(
    view.state,
  ) as CompletionWithInsertText | null;
  return Boolean(selected && !selected.__statusKind);
}

function retryAcceptFirstActionableCompletion(
  view: EditorView,
  docAtAccept: EditorState["doc"],
  selectionHeadAtAccept: number,
  attemptsRemaining = 4,
): void {
  const retry = () => {
    if (
      view.state.doc !== docAtAccept ||
      view.state.selection.main.head !== selectionHeadAtAccept ||
      !completionRuntimeSessionIsOpen(completionStatus(view.state))
    ) {
      return;
    }

    if (!actionableCompletionIsSelected(view)) {
      const options = currentCompletions(
        view.state,
      ) as CompletionWithInsertText[];
      const firstActionableIndex = firstActionableCompletionIndex(options);
      if (firstActionableIndex < 0) {
        return;
      }
      view.dispatch({ effects: setSelectedCompletion(firstActionableIndex) });
    }

    if (acceptCompletion(view)) {
      return;
    }
    if (attemptsRemaining <= 0) {
      return;
    }
    window.setTimeout(
      () =>
        retryAcceptFirstActionableCompletion(
          view,
          docAtAccept,
          selectionHeadAtAccept,
          attemptsRemaining - 1,
        ),
      COMPLETION_FAST_BACKEND_GRACE_MS,
    );
  };

  queueMicrotask(retry);
}

function acceptFirstActionableCompletion(view: EditorView): boolean {
  const status = completionStatus(view.state);
  if (status !== "active" && status !== "pending") {
    return false;
  }
  const options = currentCompletions(view.state) as CompletionWithInsertText[];
  const firstActionableIndex = firstActionableCompletionIndex(options);
  if (firstActionableIndex < 0) {
    return false;
  }
  if (!actionableCompletionIsSelected(view)) {
    view.dispatch({ effects: setSelectedCompletion(firstActionableIndex) });
  }
  if (acceptCompletion(view)) {
    return true;
  }
  retryAcceptFirstActionableCompletion(
    view,
    view.state.doc,
    view.state.selection.main.head,
  );
  return true;
}

function hasActionableCompletions(state: EditorState): boolean {
  return completionOptionsHaveActionableCompletions(
    currentCompletions(state) as CompletionWithInsertText[],
  );
}

function completionRuntimeSessionIsOpen(
  status: ReturnType<typeof completionStatus>,
): boolean {
  return status === "active" || status === "pending";
}

function completionTooltipSpace(view: EditorView): Rect {
  const docElement = view.dom.ownerDocument.documentElement;
  const viewportWidth =
    docElement.clientWidth ||
    view.dom.ownerDocument.defaultView?.innerWidth ||
    0;
  const viewportHeight =
    docElement.clientHeight ||
    view.dom.ownerDocument.defaultView?.innerHeight ||
    0;
  const viewportSpace = {
    top: COMPLETION_TOOLTIP_MARGIN_PX,
    left: COMPLETION_TOOLTIP_MARGIN_PX,
    bottom: Math.max(
      COMPLETION_TOOLTIP_MARGIN_PX,
      viewportHeight - COMPLETION_TOOLTIP_MARGIN_PX,
    ),
    right: Math.max(
      COMPLETION_TOOLTIP_MARGIN_PX,
      viewportWidth - COMPLETION_TOOLTIP_MARGIN_PX,
    ),
  };
  const editorRect = view.scrollDOM.getBoundingClientRect();
  const top = Math.max(viewportSpace.top, editorRect.top);
  const left = Math.max(viewportSpace.left, editorRect.left);
  const bottom = Math.min(viewportSpace.bottom, editorRect.bottom);
  const right = Math.min(viewportSpace.right, editorRect.right);

  if (bottom - top < 48 || right - left < 160) {
    return viewportSpace;
  }
  return { top, left, bottom, right };
}

function completionOutcomeResult(
  outcome: CompletionBuildOutcome,
): CompletionResult | null {
  return outcome.kind === "result" ||
    outcome.kind === "empty" ||
    outcome.kind === "error"
    ? outcome.result
    : null;
}

function completionOptionMergeKey(completion: Completion): string {
  const metadata = completion as CompletionWithInsertText;
  return (
    metadata.__stableKey ||
    metadata.__completionId ||
    `${completion.displayLabel || completion.label}:${completion.type || ""}`
  ).toLowerCase();
}

function mergeBackendAndInstantCompletionResults(
  backendResult: CompletionResult,
  instantResult: CompletionResult,
): CompletionResult {
  if (backendResult.from !== instantResult.from) {
    return backendResult;
  }

  const options: Completion[] = [];
  const seen = new Set<string>();
  for (const option of [...backendResult.options, ...instantResult.options]) {
    const key = completionOptionMergeKey(option);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push(option);
  }

  return {
    ...backendResult,
    options,
  };
}

function accessCompletionLSPStatus(
  result: EditorCompletionResultPayload | null,
): string {
  return (result?.lspStatus || result?.sourceStatuses?.lsp || "")
    .toString()
    .trim()
    .toLowerCase();
}

function isRetryableAccessNoItemsResult(
  result: EditorCompletionResultPayload | null,
): boolean {
  return accessCompletionLSPStatus(result) === "timeout";
}

function classifyAccessNoItemsResult(
  result: EditorCompletionResultPayload | null,
): AccessEmptyClassification {
  const lspStatus = accessCompletionLSPStatus(result);
  if (lspStatus === "canceled" || lspStatus === "stale") {
    return "canceled";
  }
  if (lspStatus === "empty" || lspStatus === "ok") {
    return "empty";
  }
  return "error";
}

function accessCompletionLabel(completion: Completion): string {
  return (completion.displayLabel || completion.label || "").toString();
}

function accessCompletionMembershipKey(completion: Completion): string {
  const label = accessCompletionLabel(completion).trim().toLowerCase();
  const type = (completion.type || "").toString().trim().toLowerCase();
  return `${label}:${type}`;
}

function accessCompletionHasSafeEditPayload(completion: Completion): boolean {
  const metadata = completion as CompletionWithInsertText;
  return Boolean(
    metadata.__hasAdditionalTextEdits ||
    metadata.__autoImportAllowed ||
    metadata.__requiresResolveBeforeApply ||
    metadata.__requiresSafeEditsBeforeApply,
  );
}

function preferAccessCompletionWithPayload(
  current: Completion,
  candidate: Completion,
): Completion {
  if (
    accessCompletionHasSafeEditPayload(candidate) &&
    !accessCompletionHasSafeEditPayload(current)
  ) {
    return candidate;
  }
  return current;
}

function uniqueAccessCompletionOptions(
  options: readonly Completion[],
): Completion[] {
  const result: Completion[] = [];
  const indexes = new Map<string, number>();
  for (const option of options) {
    const key = accessCompletionMembershipKey(option);
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, result.length);
      result.push(option);
      continue;
    }
    result[existingIndex] = preferAccessCompletionWithPayload(
      result[existingIndex],
      option,
    );
  }
  return result;
}

function mergeWithKnownAccessMemberOptions(
  options: readonly Completion[],
  knownOptions: readonly Completion[],
): Completion[] {
  const knownActionableOptions = uniqueAccessCompletionOptions(
    knownOptions.filter(completionOptionIsActionable),
  );
  if (knownActionableOptions.length === 0) {
    return uniqueAccessCompletionOptions(options);
  }

  const knownByKey = new Map<string, Completion>();
  for (const option of knownActionableOptions) {
    knownByKey.set(accessCompletionMembershipKey(option), option);
  }

  const merged: Completion[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    const key = accessCompletionMembershipKey(option);
    const knownOption = knownByKey.get(key);
    if (!knownOption || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(preferAccessCompletionWithPayload(option, knownOption));
  }
  for (const option of knownActionableOptions) {
    const key = accessCompletionMembershipKey(option);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(option);
  }

  return merged.length > 0 ? merged : uniqueAccessCompletionOptions(options);
}

function accessCompletionSnapshotKey(filePath: string, sessionKey: string) {
  return `${filePath}\u0000${sessionKey}`;
}

function actionableAccessOptionsFromSnapshot(
  snapshot: AccessCompletionSnapshot | undefined,
  prefix: string,
): readonly Completion[] {
  return snapshot
    ? filterAccessCompletionOptions(snapshot.options, prefix).filter(
        completionOptionIsActionable,
      )
    : [];
}

function actionableAccessOptionsFromSession(
  session: CompletionSessionRecord | null | undefined,
  prefix: string,
): readonly Completion[] {
  return session?.result && !session.isIncomplete
    ? filterAccessCompletionOptions(session.result.options, prefix).filter(
        completionOptionIsActionable,
      )
    : [];
}

function rememberableAccessCompletionOptions(
  options: readonly Completion[],
): readonly Completion[] {
  return uniqueAccessCompletionOptions(
    options.filter(completionOptionIsActionable),
  );
}

function accessCompletionOptionsCanBeRemembered(
  options: readonly Completion[],
): boolean {
  return completionOptionsHaveActionableCompletions(options);
}

function mergeAccessCompletionMemoryOptions(
  snapshotOptions: readonly Completion[],
  sessionOptions: readonly Completion[],
): readonly Completion[] {
  return uniqueAccessCompletionOptions([...snapshotOptions, ...sessionOptions]);
}

function accessCompletionOptionsForKnownScope(
  options: readonly Completion[],
  knownOptions: readonly Completion[],
): Completion[] {
  return completionOptionsHaveActionableCompletions(knownOptions)
    ? mergeWithKnownAccessMemberOptions(options, knownOptions)
    : uniqueAccessCompletionOptions(options);
}

function accessCompletionOptionsAreActionable(
  options: readonly Completion[],
): boolean {
  return options.some(completionOptionIsActionable);
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
      const byLabel = accessCompletionLabel(left).localeCompare(
        accessCompletionLabel(right),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      );
      if (byLabel !== 0) return byLabel;

      const byTypePriority =
        accessCompletionTypePriority(right) -
        accessCompletionTypePriority(left);
      if (byTypePriority !== 0) return byTypePriority;

      const byType = (left.type || "").localeCompare(right.type || "");
      if (byType !== 0) return byType;

      const byDetail = (left.detail || "").localeCompare(right.detail || "");
      if (byDetail !== 0) return byDetail;

      const leftSort = (left as CompletionWithInsertText).__sortText || "";
      const rightSort = (right as CompletionWithInsertText).__sortText || "";
      if (leftSort || rightSort) {
        const bySort = leftSort.localeCompare(rightSort, undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (bySort !== 0) return bySort;
      }

      return leftEntry.index - rightEntry.index;
    })
    .map(({ completion }, index, sortedEntries) => ({
      ...completion,
      boost: ACCESS_COMPLETION_BOOST_BASE + sortedEntries.length - index,
    }));
}

const trimToTokenLimit = (text: string, limit: number): string => {
  if (!text || limit <= 0) return "";
  const parts = text.trim().split(/\s+/);
  const slice = parts.slice(0, limit).join(" ");
  if (!slice) return "";
  return text.startsWith(" ") ? ` ${slice}` : slice;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedAccessLanguage(language?: string): string {
  return (language || "").trim().toLowerCase();
}

function accessOperatorSpecsForLanguage(language?: string) {
  const normalized = normalizedAccessLanguage(language);
  return ACCESS_OPERATOR_SPECS.filter(
    (spec) => !spec.languages || spec.languages.includes(normalized),
  );
}

function accessOperatorAlternation(language?: string): string {
  return accessOperatorSpecsForLanguage(language)
    .map((spec) => escapeRegExp(spec.operator))
    .join("|");
}

function extractAccessPrefix(
  textBefore: string,
  language?: string,
): {
  prefix: string;
  accessChain: string;
} | null {
  if (!textBefore) return null;
  const operatorPattern = accessOperatorAlternation(language);
  if (!operatorPattern) return null;

  const generalAccessMatch = textBefore.match(
    new RegExp(
      `((?:\\$?[A-Za-z_][\\w$]*|\\\\?[A-Za-z_][\\w$]*)(?:(?:\\\\|${operatorPattern})[A-Za-z_][\\w$]*)*(?:${operatorPattern}))([A-Za-z_$][\\w$]*)?$`,
    ),
  );
  if (generalAccessMatch) {
    return {
      accessChain: generalAccessMatch[1],
      prefix: generalAccessMatch[2] || "",
    };
  }
  return extractLooseAccessPrefix(textBefore, language);
}

function extractLooseAccessPrefix(
  textBefore: string,
  language?: string,
): {
  prefix: string;
  accessChain: string;
} | null {
  const trimmed = textBefore.replace(/\s+$/, "");
  if (!trimmed) return null;

  for (const spec of accessOperatorSpecsForLanguage(language)) {
    const match = trimmed.match(
      new RegExp(`^(.*${escapeRegExp(spec.operator)})([A-Za-z_$][\\w$]*)?$`),
    );
    if (!match) continue;

    const accessChain = match[1] || "";
    const receiver = accessChain.slice(0, -spec.operator.length).trim();
    if (!accessReceiverLooksPlausible(receiver)) continue;

    return {
      accessChain,
      prefix: match[2] || "",
    };
  }

  return null;
}

function accessReceiverLooksPlausible(receiver: string): boolean {
  const trimmed = receiver.trim();
  if (!trimmed) return false;
  if (/^(?:\/\/|\/\*|#|--)/.test(trimmed)) return false;
  if (/^[+-]?(?:\d+|\d*\.\d+)$/.test(trimmed)) return false;
  if (/[\s([{,:;=+\-*/%!?&|^~<>]$/.test(trimmed)) return false;
  return true;
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
const HTML_LIKE_CONTAINER_LANGUAGES = new Set([
  "astro",
  "blade",
  "html",
  "svelte",
  "vue",
]);

type EmbeddedCompletionRegion = {
  language: string;
  contentFrom: number;
  contentTo: number;
};

function htmlAttributeValue(attributes: string, name: string): string {
  const match = attributes.match(
    new RegExp(
      `\\b${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
      "i",
    ),
  );
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function htmlEmbeddedRegionInText(
  text: string,
  pos: number,
  tagName: string,
): { attributes: string; contentFrom: number; contentTo: number } | null {
  const tagPattern = new RegExp(
    `<\\s*(/?)\\s*${escapeRegExp(tagName)}\\b([^>]*)>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  let openRegion: { attributes: string; contentFrom: number } | null = null;
  while ((match = tagPattern.exec(text)) !== null) {
    if (match[1]) {
      if (openRegion && pos >= openRegion.contentFrom && pos <= match.index) {
        return {
          ...openRegion,
          contentTo: match.index,
        };
      }
      openRegion = null;
      continue;
    }
    const attributes = match[2] || "";
    openRegion = /\/\s*$/.test(attributes)
      ? null
      : { attributes, contentFrom: tagPattern.lastIndex };
  }

  if (openRegion && pos >= openRegion.contentFrom) {
    return {
      ...openRegion,
      contentTo: text.length,
    };
  }
  return null;
}

function scriptCompletionLanguage(attributes: string): string | null {
  const lang = htmlAttributeValue(attributes, "lang").toLowerCase();
  if (lang === "ts" || lang === "tsx" || lang === "typescript") {
    return "typescript";
  }
  if (lang === "js" || lang === "jsx" || lang === "javascript") {
    return "javascript";
  }

  const type = htmlAttributeValue(attributes, "type").toLowerCase();
  if (!type || type === "module") {
    return "javascript";
  }
  if (type.includes("typescript")) {
    return "typescript";
  }
  if (
    type.includes("javascript") ||
    type.includes("ecmascript") ||
    type.includes("babel")
  ) {
    return "javascript";
  }
  return null;
}

function styleCompletionLanguage(attributes: string): string | null {
  const lang = htmlAttributeValue(attributes, "lang").toLowerCase();
  if (lang === "scss" || lang === "sass" || lang === "less") {
    return lang;
  }
  if (lang === "css") {
    return "css";
  }

  const type = htmlAttributeValue(attributes, "type").toLowerCase();
  if (type.includes("scss")) return "scss";
  if (type.includes("sass")) return "sass";
  if (type.includes("less")) return "less";
  if (type.includes("css")) return "css";
  return null;
}

function embeddedCompletionLanguageAt(
  state: EditorState,
  pos: number,
  language: string,
): string {
  const region = embeddedCompletionRegionInDocument(
    state.doc.toString(),
    pos,
    language,
  );
  return region?.language ?? language;
}

function embeddedCompletionRegionInDocument(
  text: string,
  pos: number,
  language: string,
): EmbeddedCompletionRegion | null {
  if (!HTML_LIKE_CONTAINER_LANGUAGES.has(language)) {
    return null;
  }

  const scriptRegion = htmlEmbeddedRegionInText(text, pos, "script");
  if (scriptRegion !== null) {
    const scriptLanguage = scriptCompletionLanguage(scriptRegion.attributes);
    if (scriptLanguage) {
      return { language: scriptLanguage, ...scriptRegion };
    }
  }
  const styleRegion = htmlEmbeddedRegionInText(text, pos, "style");
  if (styleRegion !== null) {
    return {
      language: styleCompletionLanguage(styleRegion.attributes) ?? "css",
      ...styleRegion,
    };
  }
  return null;
}

function paddedEmbeddedCompletionDocument(
  text: string,
  region: EmbeddedCompletionRegion,
): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (index >= region.contentFrom && index < region.contentTo) {
      result += char;
    } else {
      result += char === "\n" || char === "\r" ? char : " ";
    }
  }
  return result;
}

function embeddedBackendCompletionDocument(
  state: EditorState,
  pos: number,
  language: string,
): { language: string; fullText: string } {
  const fullText = state.doc.toString();
  const region = embeddedCompletionRegionInDocument(fullText, pos, language);
  if (!region) {
    return { language, fullText };
  }
  return {
    language: region.language,
    fullText: paddedEmbeddedCompletionDocument(fullText, region),
  };
}

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
  const range = edit.replace || edit.range || edit.insert;
  if (!range) {
    return null;
  }
  return textEditToChange(
    state,
    completionRangeToTextEdit(range, edit.newText || ""),
  );
}

function primaryTextEditIsSafeForCompletionSpan(
  state: EditorState,
  change: CompletionTextEditChange | null,
  from: number,
  to: number,
  accessExpressionFrom?: number | null,
  cursorPosition?: number | null,
): boolean {
  if (!change) {
    return true;
  }
  const spanFrom = Math.min(from, to);
  const spanTo = Math.max(from, to);
  const replacedLength = change.to - change.from;
  if (replacedLength > MAX_PRIMARY_COMPLETION_REPLACED_TEXT_LENGTH) {
    return false;
  }
  const editStartLine = state.doc.lineAt(change.from).number;
  const editEndLine = state.doc.lineAt(change.to).number;
  const spanStartLine = state.doc.lineAt(spanFrom).number;
  const spanEndLine = state.doc.lineAt(spanTo).number;
  if (
    editStartLine !== editEndLine ||
    spanStartLine !== spanEndLine ||
    editStartLine !== spanStartLine
  ) {
    return false;
  }
  if (
    accessExpressionFrom !== null &&
    accessExpressionFrom !== undefined &&
    cursorPosition !== null &&
    cursorPosition !== undefined &&
    change.to > cursorPosition
  ) {
    return false;
  }
  // LSP may replace the whole access expression (for example `log.`) while
  // CodeMirror's completion span starts after the trigger character.
  if (change.from === spanFrom && change.to === spanTo) {
    return true;
  }
  if (accessExpressionFrom === null || accessExpressionFrom === undefined) {
    return false;
  }
  return change.from === accessExpressionFrom && change.to === spanTo;
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

function completionAdditionalTextEditRangeKey(edit: TextEditJSON): string {
  return `${edit.startLine}:${edit.startColumn}:${edit.endLine}:${edit.endColumn}`;
}

function mergeCompletionAdditionalTextEdits(
  itemEdits?: TextEditJSON[],
  resolvedEdits?: TextEditJSON[],
): TextEditJSON[] | undefined {
  if (!(itemEdits?.length || 0) && !(resolvedEdits?.length || 0)) {
    return undefined;
  }
  const rangeIndexes = new Map<string, number>();
  const merged: TextEditJSON[] = [];
  const appendOrReplaceByRange = (edit: TextEditJSON) => {
    const key = completionAdditionalTextEditRangeKey(edit);
    const existingIndex = rangeIndexes.get(key);
    if (existingIndex !== undefined) {
      merged[existingIndex] = edit;
      return;
    }
    rangeIndexes.set(key, merged.length);
    merged.push(edit);
  };
  for (const edit of itemEdits || []) appendOrReplaceByRange(edit);
  for (const edit of resolvedEdits || []) appendOrReplaceByRange(edit);
  return merged;
}

function applyCompletionTextEditChanges(
  view: EditorView,
  changes: CompletionTextEditChange[],
): { from: (position: number, assoc?: number) => number } | null {
  if (!changes.length) {
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

function completionSelectionAnchorAfterChange(
  mapping: ChangeDesc,
  change: CompletionTextEditChange,
): number {
  if (change.from === change.to) {
    return mapping.mapPos(change.to, 1);
  }
  return mapping.mapPos(change.to, -1);
}

function snippetInsertedTextForMapping(snippetText: string): string {
  return snippetText
    .replace(/\$\{[0-9]+:([^}]*)\}/g, "$1")
    .replace(/\$\{[0-9]+\}/g, "")
    .replace(/\$[0-9]+/g, "");
}

function mapCompletionTextEditChanges(
  changes: CompletionTextEditChange[],
  mapping: ChangeDesc,
): CompletionTextEditChange[] {
  return changes.map((change) => ({
    from: mapping.mapPos(change.from, 1),
    to: mapping.mapPos(change.to, -1),
    insert: change.insert,
  }));
}

function applyBackendCompletion(
  view: EditorView,
  language: string,
  completionToApply: Completion,
  from: number,
  to: number,
  insertText: string,
  plainText: string,
  isSnippet: boolean,
  primaryTextEdit?: PrimaryTextEditJSON | null,
  additionalTextEdits?: TextEditJSON[],
  accessExpressionFrom?: number | null,
  cursorPosition?: number | null,
): CompletionApplyAttemptResult {
  if (!completionInsertPayloadIsBounded(insertText, plainText)) {
    return { applied: false, reason: "oversized-insert" };
  }
  const additionalChanges = additionalTextEditsToChanges(
    view.state,
    additionalTextEdits,
  );
  if (!additionalChanges) {
    return { applied: false, reason: "invalid-additional-edit-range" };
  }
  const primaryChange = primaryTextEdit
    ? primaryTextEditToChange(view.state, primaryTextEdit)
    : null;
  if (primaryTextEdit && !primaryChange) {
    return { applied: false, reason: "invalid-primary-edit-range" };
  }
  if (
    !primaryTextEditIsSafeForCompletionSpan(
      view.state,
      primaryChange,
      from,
      to,
      accessExpressionFrom,
      cursorPosition,
    )
  ) {
    return { applied: false, reason: "unsafe-primary-edit" };
  }
  if (!completionChangesAreBounded(additionalChanges, primaryChange)) {
    return { applied: false, reason: "unsafe-edit-bounds" };
  }
  if (
    !completionAdditionalEditsAreSourceSafe(
      view.state,
      language,
      additionalTextEdits,
      additionalChanges,
    )
  ) {
    return { applied: false, reason: "unsafe-import-edit" };
  }

  if (isSnippet && hasSnippetPlaceholder(insertText)) {
    const snippetText = primaryChange ? primaryChange.insert : insertText;
    const snippetFrom = primaryChange ? primaryChange.from : from;
    const snippetTo = primaryChange ? primaryChange.to : to;
    const snippetMapping =
      additionalChanges.length > 0
        ? view.state.changes([
            {
              from: snippetFrom,
              to: snippetTo,
              insert: snippetInsertedTextForMapping(snippetText),
            },
          ])
        : null;
    snippet(toCodeMirrorSnippetTemplate(snippetText))(
      view,
      completionToApply,
      snippetFrom,
      snippetTo,
    );
    if (additionalChanges.length > 0) {
      applyCompletionTextEditChanges(
        view,
        snippetMapping
          ? mapCompletionTextEditChanges(additionalChanges, snippetMapping)
          : additionalChanges,
      );
    }
    return { applied: true };
  }

  if (additionalChanges.length > 0 || primaryChange) {
    const primaryCompletionChange = primaryChange || {
      from,
      to,
      insert: plainText,
    };
    const changes = [...additionalChanges, primaryCompletionChange].sort(
      (a, b) => a.from - b.from,
    );
    const changeSet = view.state.changes(changes);
    view.dispatch({
      changes: changeSet,
      selection: {
        anchor: completionSelectionAnchorAfterChange(
          changeSet,
          primaryCompletionChange,
        ),
      },
      annotations: [
        pickedCompletion.of(completionToApply),
        Transaction.userEvent.of("input.complete"),
      ],
    });
    return { applied: true };
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
  return { applied: true };
}

function completionAdditionalEditsAreSourceSafe(
  state: EditorState,
  language: string,
  edits?: TextEditJSON[],
  changes?: CompletionTextEditChange[],
): boolean {
  if (!edits?.length) {
    return true;
  }
  return edits.every((edit, index) => {
    const change = changes?.[index];
    if (!additionalEditRangeIsSourceSafe(state, language, edit, change)) {
      return false;
    }
    return (
      looksLikeImportEdit(language, edit.text) ||
      goImportSpliceEditLooksSourceSafe(state, language, edit)
    );
  });
}

function looksLikeImportEdit(language: string, text: string): boolean {
  const normalized = language.toLowerCase();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > 32) {
    return false;
  }
  if (normalized === "go") return lines.every(isGoImportEditLine);
  if (normalized === "c" || normalized === "cpp" || normalized === "c++") {
    return lines.every((line) =>
      /^#include\s+(<[^>\n]+>|"[^"\n]+")$/.test(line),
    );
  }
  if (normalized === "php" || normalized === "php-laravel") {
    return lines.every((line) => /^use\s+[^;\n]+;$/.test(line));
  }
  if (
    [
      "javascript",
      "typescript",
      "javascriptreact",
      "typescriptreact",
      "vue",
      "svelte",
      "astro",
      "solidity",
    ].includes(normalized)
  ) {
    return lines.every((line) =>
      /^import(?:\s+type)?\s+.+(?:\s+from\s+["'][^"']+["'];?|["'][^"']+["'];?)$/.test(
        line,
      ),
    );
  }
  if (normalized === "python") {
    return lines.every((line) =>
      /^(import\s+[\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*|from\s+[\w.]+\s+import\s+[\w*.,\s()]+)$/.test(
        line,
      ),
    );
  }
  if (normalized === "rust") {
    return lines.every((line) => /^use\s+[^;\n]+;$/.test(line));
  }
  if (
    [
      "java",
      "kotlin",
      "groovy",
      "scala",
      "dart",
      "haskell",
      "matlab",
      "swift",
    ].includes(normalized)
  ) {
    return lines.every((line) => /^import\s+[^;\n]+;?$/.test(line));
  }
  if (normalized === "csharp") {
    return lines.every((line) => /^using\s+[^;\n]+;?$/.test(line));
  }
  if (normalized === "julia") {
    return lines.every((line) => /^(using|import)\s+[\w.:, ]+$/.test(line));
  }
  if (normalized === "clojure") {
    return lines.every((line) =>
      /^(:import|:require|\(:import|\(:require)\s+.+\)?$/.test(line),
    );
  }
  if (normalized === "erlang") {
    return lines.every((line) => /^-import\([^)]+\)\.$/.test(line));
  }
  if (normalized === "fortran") {
    return lines.every((line) =>
      /^use\s+[\w_]+(?:\s*,\s*only\s*:\s*[\w_,\s]+)?$/i.test(line),
    );
  }
  if (normalized === "ada") {
    return lines.every((line) => /^with\s+[\w.]+;?$/.test(line));
  }
  if (normalized === "delphi" || normalized === "pascal") {
    return lines.every((line) => /^uses\s+[\w.,\s]+;?$/.test(line));
  }
  if (normalized === "latex") {
    return lines.every((line) =>
      /^\\usepackage(?:\[[^\]]+\])?\{[^}]+\}$/.test(line),
    );
  }
  if (normalized === "perl") {
    return lines.every((line) =>
      /^use\s+[\w:]+(?:\s+qw\([^)]*\))?;?$/.test(line),
    );
  }
  return false;
}

function isGoImportEditLine(line: string): boolean {
  return (
    /^import\s+(\(\s*)?$/.test(line) ||
    /^import\s+(?:[._]\s+|\w+\s+)?"[^"\n]+"$/.test(line) ||
    /^\)$/.test(line) ||
    /^(?:[._]\s+|\w+\s+)?"[^"\n]+"$/.test(line)
  );
}

function goImportSpliceEditLooksSourceSafe(
  state: EditorState,
  language: string,
  edit: TextEditJSON,
): boolean {
  if (language.toLowerCase() !== "go") {
    return false;
  }
  if (!goEditTouchesExistingImportLine(state, edit)) {
    return false;
  }
  const changedText = textEditResultForTouchedLines(state, edit);
  if (changedText === null) {
    return false;
  }
  const lines = changedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length > 0 && lines.length <= 32 && lines.every(isGoImportEditLine)
  );
}

function goEditTouchesExistingImportLine(
  state: EditorState,
  edit: TextEditJSON,
): boolean {
  for (
    let lineNumber = edit.startLine;
    lineNumber <= edit.endLine;
    lineNumber += 1
  ) {
    if (lineNumber < 1 || lineNumber > state.doc.lines) {
      return false;
    }
    const line = state.doc.line(lineNumber).text.trim();
    if (line && isGoImportEditLine(line)) {
      return true;
    }
  }
  return false;
}

function textEditResultForTouchedLines(
  state: EditorState,
  edit: TextEditJSON,
): string | null {
  if (
    edit.startLine < 1 ||
    edit.endLine < edit.startLine ||
    edit.startLine > state.doc.lines ||
    edit.endLine > state.doc.lines
  ) {
    return null;
  }
  const startLine = state.doc.line(edit.startLine);
  const endLine = state.doc.line(edit.endLine);
  if (
    edit.startColumn < 1 ||
    edit.endColumn < 1 ||
    edit.startColumn > startLine.length + 1 ||
    edit.endColumn > endLine.length + 1
  ) {
    return null;
  }
  return (
    startLine.text.slice(0, edit.startColumn - 1) +
    edit.text +
    endLine.text.slice(edit.endColumn - 1)
  );
}

function completionInsertTextIsBounded(insertText: string): boolean {
  return insertText.length <= MAX_COMPLETION_INSERT_TEXT_LENGTH;
}

function completionInsertPayloadIsBounded(
  insertText: string,
  plainText: string,
): boolean {
  return (
    completionInsertTextIsBounded(insertText) &&
    plainText.length <= MAX_COMPLETION_INSERT_TEXT_LENGTH
  );
}

function additionalEditRangeIsSourceSafe(
  state: EditorState,
  language: string,
  edit: TextEditJSON,
  change?: CompletionTextEditChange,
): boolean {
  if (!change) {
    return false;
  }
  const replacementLength = change.to - change.from;
  if (replacementLength > MAX_COMPLETION_REPLACED_TEXT_LENGTH) {
    return false;
  }
  const headerLimit = importHeaderLimitLine(state, language);
  return edit.startLine <= headerLimit && edit.endLine <= headerLimit;
}

function importHeaderLimitLine(state: EditorState, language: string): number {
  const normalized = language.toLowerCase();
  const lines = state.doc.toString().split(/\r?\n/);
  let limit = Math.min(lines.length, 80);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();
    if (trimmed === "" || isHeaderCommentLine(trimmed, normalized)) {
      continue;
    }
    if (isLanguageHeaderLine(trimmed, normalized)) {
      continue;
    }
    limit = lineNumber;
    break;
  }
  return Math.min(limit, 80);
}

function isHeaderCommentLine(line: string, language: string): boolean {
  if (line.startsWith("//") || line.startsWith("#")) return true;
  if (line.startsWith("/*") || line.startsWith("*")) return true;
  if (language === "python" && line.startsWith('"""')) return true;
  return false;
}

function isLanguageHeaderLine(line: string, language: string): boolean {
  if (language === "go") {
    return line.startsWith("package ") || looksLikeImportEdit("go", line);
  }
  if (language === "php" || language === "php-laravel") {
    return (
      line === "<?php" ||
      line.startsWith("namespace ") ||
      looksLikeImportEdit(language, line)
    );
  }
  return looksLikeImportEdit(language, line);
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
  let replacedTextLength = 0;
  let previousEnd = -1;
  for (const change of changes) {
    if (change.from < previousEnd) {
      return false;
    }
    insertedTextLength += change.insert.length;
    replacedTextLength += Math.max(0, change.to - change.from);
    if (insertedTextLength > MAX_COMPLETION_EDIT_TEXT_LENGTH) {
      return false;
    }
    if (replacedTextLength > MAX_COMPLETION_REPLACED_TEXT_LENGTH) {
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

function recordCompletionApplyReject(
  diagnostic: CompletionApplyRejectDiagnostic,
): void {
  const target = globalThis as CompletionDiagnosticsGlobal;
  target.__autocompleteApplyRejectLog = [
    ...(target.__autocompleteApplyRejectLog || []),
    diagnostic,
  ];
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[autocomplete] completion apply rejected", diagnostic);
  }
}

async function resolveEditorCompletionWithBudget(
  request: EditorCompletionResolveRequestPayload,
): Promise<CompletionResolvePayload | null> {
  if (!request.resolveToken) {
    return null;
  }
  return resolveWithTimeout(
    ResolveEditorCompletion(request),
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
  accessStage: string,
  inStringContext: boolean,
  inBraceContext: boolean,
) {
  return [
    lineNumber,
    accessChain || "-",
    accessStage || "-",
    inStringContext ? "string" : "plain",
    inBraceContext ? "brace" : "flow",
  ].join("|");
}

function buildAccessSessionKey(
  lineNumber: number,
  accessChain: string,
  inStringContext: boolean,
  inBraceContext: boolean,
) {
  return buildCompletionCacheKey(
    lineNumber,
    accessChain,
    "access",
    inStringContext,
    inBraceContext,
  );
}

function accessRequestStage(
  accessInfo: { prefix: string; accessChain: string } | null,
): string {
  if (!accessInfo) return "-";
  if (accessInfo.prefix.length === 0) return "bare";
  return `typed:${accessInfo.prefix}`;
}

function completionSemanticKeyAt(
  context: CompletionContext,
  language: string,
): string | null {
  const pos = context.pos;
  const completionLanguage = embeddedCompletionLanguageAt(
    context.state,
    pos,
    language,
  );
  const line = context.state.doc.lineAt(pos);
  const column = pos - line.from + 1;
  const textBeforeLine = line.text.slice(0, column - 1);
  const accessInfo = extractAccessPrefix(textBeforeLine, completionLanguage);
  const stringPrefix = extractStringPrefix(textBeforeLine);
  const bareAccessOperator = accessOperatorFromText(
    textBeforeLine,
    completionLanguage,
  );
  const accessIdentity =
    accessInfo?.accessChain ??
    (bareAccessOperator ? textBeforeLine.trimEnd() : null);
  const braceCharClass = getPrefixCharClass(completionLanguage);
  const inBraceContext = new RegExp(
    `\\{[^\\S\\r\\n]*([${braceCharClass}]*)$`,
  ).test(textBeforeLine);

  if (accessIdentity) {
    return buildAccessSessionKey(
      line.number,
      accessIdentity,
      stringPrefix !== null,
      inBraceContext,
    );
  }

  return buildCompletionCacheKey(
    line.number,
    null,
    "-",
    stringPrefix !== null,
    inBraceContext,
  );
}

function completionRequestKeyAt(
  context: CompletionContext,
  language: string,
): string | null {
  const pos = context.pos;
  const completionLanguage = embeddedCompletionLanguageAt(
    context.state,
    pos,
    language,
  );
  const line = context.state.doc.lineAt(pos);
  const column = pos - line.from + 1;
  const textBeforeLine = line.text.slice(0, column - 1);
  const accessInfo = extractAccessPrefix(textBeforeLine, completionLanguage);
  const stringPrefix = extractStringPrefix(textBeforeLine);
  const bareAccessOperator = accessOperatorFromText(
    textBeforeLine,
    completionLanguage,
  );
  const accessIdentity =
    accessInfo?.accessChain ??
    (bareAccessOperator ? textBeforeLine.trimEnd() : null);
  const braceCharClass = getPrefixCharClass(completionLanguage);
  const inBraceContext = new RegExp(
    `\\{[^\\S\\r\\n]*([${braceCharClass}]*)$`,
  ).test(textBeforeLine);

  return buildCompletionCacheKey(
    line.number,
    accessIdentity,
    accessInfo
      ? accessRequestStage(accessInfo)
      : bareAccessOperator
        ? "bare"
        : "-",
    stringPrefix !== null,
    inBraceContext,
  );
}

function accessIncompleteSessionKey(filePath: string, semanticKey: string) {
  return `${filePath}\u0000${semanticKey}`;
}

function completionAccessExpressionFrom(
  lineFrom: number,
  textBeforeLine: string,
  accessChain: string | null,
  prefixLength: number,
): number | null {
  if (!accessChain) {
    return null;
  }
  const leadingWhitespace = accessChain.match(/^\s*/)?.[0].length ?? 0;
  return (
    lineFrom +
    textBeforeLine.length -
    prefixLength -
    accessChain.length +
    leadingWhitespace
  );
}

function completionHasIdentifierSuffixAtPosition(
  state: EditorState,
  position: number,
  language: string,
): boolean {
  const line = state.doc.lineAt(position);
  const right = line.text.slice(position - line.from);
  if (!right) {
    return false;
  }
  const charClass = getPrefixCharClass(language);
  return new RegExp(`^[${charClass}]`).test(right);
}

function nextCompletionSessionId(seqRef: MutableRefObject<number>) {
  seqRef.current += 1;
  return `completion-${seqRef.current}`;
}

function updateLSPTriggerCharacters(
  ref: MutableRefObject<Map<string, Set<string>>>,
  language: string,
  result: EditorCompletionResultPayload | null,
) {
  if (!result?.lspTriggerCharacters?.length) return;
  ref.current.set(language, new Set(result.lspTriggerCharacters));
}

function completionTriggerKindForRequest(
  triggerChar: string,
  language: string,
  session: CompletionSessionRecord | null,
  triggerCharacters: Map<string, Set<string>>,
  forceTriggerCharacter: boolean,
  rememberedIncomplete: boolean,
) {
  if (session?.isIncomplete || rememberedIncomplete) {
    return 3;
  }
  if (forceTriggerCharacter && triggerChar) {
    return 2;
  }
  if (triggerChar && triggerCharacters.get(language)?.has(triggerChar)) {
    return 2;
  }
  return 1;
}

function endsWithAccessTrigger(text: string, language?: string) {
  return accessOperatorFromText(text, language) !== "";
}

function accessOperatorFromText(text: string, language?: string): string {
  const trimmed = text.replace(/\s+$/, "");
  for (const spec of accessOperatorSpecsForLanguage(language)) {
    if (!trimmed.endsWith(spec.operator)) continue;
    const receiver = trimmed.slice(0, -spec.operator.length);
    if (accessReceiverLooksPlausible(receiver)) return spec.operator;
  }
  return "";
}

function lspTriggerCharacterForAccessOperator(operator: string): string {
  return (
    ACCESS_OPERATOR_SPECS.find((spec) => spec.operator === operator)
      ?.triggerCharacter || ""
  );
}

function accessStatusCompletion(
  label: string,
  statusKind: NonNullable<CompletionWithInsertText["__statusKind"]>,
  detail = "LSP",
): Completion {
  const completion: CompletionWithInsertText = {
    label,
    detail,
    type: "text",
    apply: () => undefined,
    boost: ACCESS_COMPLETION_BOOST_BASE,
    __insertText: "",
    __hasAdditionalTextEdits: false,
    __sourceKind: statusKind,
    __statusKind: statusKind,
  };
  (completion as unknown as Record<string, unknown>).__source = "LSP";
  return completion;
}

function accessPendingCompletion(): Completion {
  return accessStatusCompletion(ACCESS_PENDING_COMPLETION_LABEL, "pending");
}

function accessEmptyCompletion(): Completion {
  return accessStatusCompletion(ACCESS_EMPTY_COMPLETION_LABEL, "empty");
}

function accessErrorCompletion(status?: string): Completion {
  const normalizedStatus = (status || "").trim();
  return accessStatusCompletion(
    ACCESS_ERROR_COMPLETION_LABEL,
    "error",
    normalizedStatus ? `LSP ${normalizedStatus}` : "LSP",
  );
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

function completionPayloadAllowedInAccessContext(item: CompletionPayload) {
  if (typeof item.accessMemberAuthoritative === "boolean") {
    return item.accessMemberAuthoritative;
  }
  const source = (item as CompletionPayload & { source?: string }).source || "";
  return source === "lsp";
}

function completionPayloadRequiresSafeEditsFromSource(
  item: CompletionPayload,
  source: string,
  kind: string,
): boolean {
  if (source !== "lsp" || !item.resolveToken) {
    return false;
  }
  switch (kind.toLowerCase()) {
    case "module":
    case "package":
      return true;
    default:
      return false;
  }
}

function completeFromStaticList(
  options: Completion[],
  context: CompletionContext,
): CompletionResult | null {
  const result = completeFromList(options)(context);
  if (
    result &&
    typeof (result as Promise<CompletionResult | null>).then === "function"
  ) {
    return null;
  }
  return result as CompletionResult | null;
}

export const useCodeMirrorCompletionProvider = ({
  enabled,
  filePath,
  language,
  content,
  sessionId: backendSessionIdOption,
  surfaceId: backendSurfaceIdOption,
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
  const completionSessionSeqRef = useRef(0);
  const completionSessionControllerRef = useRef(
    createCompletionSessionController(),
  );
  const accessTransientRetryCountsRef = useRef<Map<string, number>>(new Map());
  const accessIncompleteSessionsRef = useRef<Map<string, boolean>>(new Map());
  const lastCompleteAccessResultsRef = useRef<
    Map<string, AccessCompletionSnapshot>
  >(new Map());
  const lspTriggerCharactersRef = useRef<Map<string, Set<string>>>(new Map());
  const pendingCompletionAcceptIntentRef =
    useRef<PendingCompletionAcceptIntent | null>(null);
  const fallbackSurfaceIdRef = useRef(
    `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const lastContentPropRef = useRef(content);
  const lastUserChangeContentRef = useRef<string | null>(null);
  const completionRuntimeSessionOpenRef = useRef(false);
  const completionInFlightRequestsRef = useRef(0);
  const completionSourceBudgetRef = useRef(editorFeatureBudget.completions);
  const metricsRef = useRef<MetricsHandle>(NOOP_METRICS);
  const [predictionStatus, setPredictionStatus] =
    useState<AIPredictionStatus | null>(null);
  const aiPanelEnabled = useEditorSettingsStore(
    (state) => state.aiPanelEnabled,
  );

  onTypingRef.current = onTyping;
  onGhostShownRef.current = onGhostShown;
  onGhostRejectedRef.current = onGhostRejected;
  onEscapeRef.current = onEscape;
  getEditorViewRef.current = getEditorView;
  const backendSessionId = backendSessionIdOption || filePath || "completion";
  const backendSurfaceId =
    backendSurfaceIdOption || fallbackSurfaceIdRef.current;

  useEffect(() => {
    completionSourceBudgetRef.current = editorFeatureBudget.completions;
  }, [editorFeatureBudget.completions]);

  const orchestrator = useMemo(() => createCompletionOrchestrator({}), []);

  const currentDocumentVersion = useCallback(
    () =>
      Math.max(
        getEditorDocumentVersion(filePath, language) ?? 0,
        documentVersionRef.current,
      ),
    [filePath, language],
  );

  const resetCompletionState = useCallback(
    (options: { preserveSession?: boolean } = {}) => {
      completionDismissedVersionRef.current = null;
      autoStartedCompletionVersionRef.current = null;
      accessTransientRetryCountsRef.current.clear();
      accessIncompleteSessionsRef.current.clear();
      if (!options.preserveSession) {
        completionSessionControllerRef.current.clear();
        lastCompleteAccessResultsRef.current.clear();
      }
      orchestrator.cancelPending();
    },
    [orchestrator],
  );

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
    const view = getEditorViewRef.current?.();
    if (view?.state.doc.toString() === content) {
      return;
    }

    documentVersionRef.current += 1;
    resetCompletionState();
  }, [content, enabled, resetCompletionState]);

  useEffect(() => {
    if (!enabled || !aiPanelEnabled) {
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
  }, [aiPanelEnabled, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const invalidateCompletionSession = () => {
      completionSessionControllerRef.current.clear();
      lastCompleteAccessResultsRef.current.clear();
    };
    const offRuntimeRefreshed = EventsOn(
      "depsync:runtime-refreshed",
      invalidateCompletionSession,
    );
    const offLSPReady = EventsOn("lsp:ready", invalidateCompletionSession);
    return () => {
      offRuntimeRefreshed();
      offLSPReady();
    };
  }, [enabled]);

  const recordLocalDocumentChange = useCallback(
    (value: string) => {
      if (!enabled) return;
      if (lastUserChangeContentRef.current === value) return;
      lastUserChangeContentRef.current = value;
      documentVersionRef.current += 1;
      resetCompletionState({
        preserveSession: completionRuntimeSessionOpenRef.current,
      });
    },
    [enabled, resetCompletionState],
  );

  const recordDocumentChange = recordLocalDocumentChange;

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
              "[Autocomplete][UI] jitter",
              Math.round(stats.ratio * 1000) / 10,
              "%",
            );
          }
        },
        onAutocompleteLatencyUpdate: (stats) => {
          if (stats.samples > 0 && stats.samples % 10 === 0) {
            console.debug(
              "[Autocomplete][UI] latency",
              `p50=${Math.round(stats.p50Ms)}ms`,
              `p95=${Math.round(stats.p95Ms)}ms`,
              `last=${Math.round(stats.lastMs)}ms`,
              `n=${stats.samples}`,
            );
          }
        },
        onRequestPressureUpdate: (stats) => {
          console.debug(
            "[Autocomplete][UI] pressure",
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

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  const handleProviderEscape = useCallback(() => {
    pendingCompletionAcceptIntentRef.current = null;
    completionDismissedVersionRef.current = currentDocumentVersion();
    autoStartedCompletionVersionRef.current = null;
    completionSessionControllerRef.current.dismiss();
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
          version: currentDocumentVersion(),
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
        if (!aiPanelEnabled) {
          return null;
        }

        const status = predictionStatus;
        if (!status?.enabled || !status.providerReady) {
          return null;
        }

        const settings = status.settings;
        const versionAtRequest = currentDocumentVersion();
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

        if (versionAtRequest !== currentDocumentVersion()) {
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
    aiPanelEnabled,
    enabled,
    filePath,
    handleProviderEscape,
    language,
    currentDocumentVersion,
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
      const status = completionStatus(view.state);
      if (
        status === null &&
        pendingCompletionAcceptIntentRef.current === null
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      handleProviderEscape();
      if (status !== null) {
        closeCompletion(view);
      }
    };

    const handleAutocompleteFocusOut = (event: FocusEvent) => {
      const view = getEditorViewRef.current?.();
      if (!view || pendingCompletionAcceptIntentRef.current === null) return;
      const target = event.target;
      if (!(target instanceof Node) || !view.dom.contains(target)) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && view.dom.contains(relatedTarget)) {
        return;
      }
      pendingCompletionAcceptIntentRef.current = null;
    };

    window.addEventListener("keydown", handleAutocompleteEscape, true);
    window.addEventListener("focusout", handleAutocompleteFocusOut, true);
    return () => {
      window.removeEventListener("keydown", handleAutocompleteEscape, true);
      window.removeEventListener("focusout", handleAutocompleteFocusOut, true);
    };
  }, [enabled, handleProviderEscape]);

  const fetchPendingClassCompletions = useCallback(
    async (context: CompletionContext): Promise<Completion[]> => {
      if (!enabled || !completionSourceBudgetRef.current) return [];
      if (language !== "php") return [];

      const textUntilPosition = context.state.doc.sliceString(0, context.pos);
      const currentLine = context.state.doc.lineAt(context.pos);
      const textBeforeLine = currentLine.text.slice(
        0,
        context.pos - currentLine.from,
      );
      if (
        endsWithAccessTrigger(textUntilPosition, language) ||
        extractAccessPrefix(textBeforeLine, language)
      ) {
        return [];
      }
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

      if (!prefix) {
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
            metricsRef.current.recordCompletionAccepted({
              label: result.name,
            } as Completion);
          },
          boost: result.pending ? -0.2 : 0,
        }));
      } catch {
        return [];
      }
    },
    [enabled, language],
  );

  const buildInstantCompletionResult = useCallback(
    (
      context: CompletionContext,
      buildOptions: { recordMetrics?: boolean } = {},
    ): CompletionResult | null => {
      if (!enabled || !completionSourceBudgetRef.current) return null;
      if (context.aborted) return null;

      const pos = context.pos;
      const completionLanguage = embeddedCompletionLanguageAt(
        context.state,
        pos,
        language,
      );
      const line = context.state.doc.lineAt(pos);
      const column = pos - line.from + 1;
      const textBeforeLine = line.text.slice(0, column - 1);
      const accessInfo = extractAccessPrefix(
        textBeforeLine,
        completionLanguage,
      );
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const packageNamePrefix =
        completionLanguage === "go"
          ? extractGoPackageNamePrefix(textBeforeLine)
          : null;

      if (
        (stringPrefix !== null && packageNamePrefix === null) ||
        isProbablyLineComment(textBeforeLine, completionLanguage) ||
        hasOpenStringLiteral(textBeforeLine)
      ) {
        return null;
      }

      const prefixMatch = getPrefixMatch(textBeforeLine, completionLanguage);
      const rawPrefix =
        packageNamePrefix ?? accessInfo?.prefix ?? prefixMatch?.prefix ?? "";
      const currentPrefix = normalizePrefixForLanguage(
        rawPrefix,
        completionLanguage,
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
        context.state.doc.length <= 160_000
          ? getInstantDocumentCompletions(
              context.state.doc.toString(),
              currentPrefix,
            )
          : [];
      const keywordResult =
        !accessInfo && packageNamePrefix === null
          ? completeFromStaticList(
              getInstantKeywordCompletionOptions(completionLanguage),
              context,
            )
          : null;
      const keywordOptions = [...(keywordResult?.options || [])];
      const keywordOptionsMatchPrefix = keywordOptions.some((item) =>
        item.label.toLowerCase().startsWith(currentPrefix.toLowerCase()),
      );
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
            : mergeInstantCompletions(keywordOptions, instantDocumentOptions);

      const hasLexicalMatches =
        packageNamePrefix !== null
          ? completionOptions.length > 0
          : !accessInfo &&
            (keywordOptionsMatchPrefix || instantDocumentOptions.length > 0);
      if (!hasLexicalMatches) {
        return null;
      }

      if (buildOptions.recordMetrics !== false) {
        metricsRef.current.recordInstantFallbackUsed();
        metricsRef.current.recordCompletionList(completionOptions);
      }
      return {
        from,
        options: completionOptions,
        validFor: getValidForRegex(completionLanguage, false),
      };
    },
    [enabled, language],
  );

  const backendCompletionSource = useCallback(
    (context: CompletionContext) => {
      if (!enabled) return null;
      if (context.aborted) return null;
      const pos = context.pos;
      const backendDocument = embeddedBackendCompletionDocument(
        context.state,
        pos,
        language,
      );
      const completionLanguage = backendDocument.language;
      const line = context.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;
      const textBeforeLine = backendDocument.fullText.slice(line.from, pos);
      const accessInfo = extractAccessPrefix(
        textBeforeLine,
        completionLanguage,
      );
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const packageNamePrefix =
        completionLanguage === "go"
          ? extractGoPackageNamePrefix(textBeforeLine)
          : null;

      if (
        (stringPrefix !== null && packageNamePrefix === null) ||
        isProbablyLineComment(textBeforeLine, completionLanguage) ||
        hasOpenStringLiteral(textBeforeLine)
      ) {
        return null;
      }

      const prefixMatch = getPrefixMatch(textBeforeLine, completionLanguage);
      const braceCharClass = getPrefixCharClass(completionLanguage);
      const braceTailRegex = new RegExp(
        `\\{[^\\S\\r\\n]*([${braceCharClass}]*)$`,
      );
      const braceTailMatch = textBeforeLine.match(braceTailRegex);
      const inBraceContext = braceTailMatch !== null;
      const bracePrefix = braceTailMatch?.[1] || "";
      const braceTailStartColumn = inBraceContext
        ? textBeforeLine.length - bracePrefix.length + 1
        : null;
      const bareAccessOperator = accessOperatorFromText(
        textBeforeLine,
        completionLanguage,
      );
      const accessOperator = accessInfo
        ? accessOperatorFromText(accessInfo.accessChain, completionLanguage)
        : bareAccessOperator;
      const accessTrigger = bareAccessOperator !== "";
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
        completionLanguage,
        hasDollarPrefix,
      );
      const shouldStripDollar =
        completionLanguage === "bash" && hasDollarPrefix;
      const htmlLike = HTML_LIKE_CONTAINER_LANGUAGES.has(completionLanguage);
      let triggerChar = accessTrigger
        ? lspTriggerCharacterForAccessOperator(bareAccessOperator)
        : accessInfo
          ? accessInfo.prefix.slice(-1) || ""
          : hasDollarPrefix
            ? "$"
            : rawPrefix.slice(-1) || "";
      const trimmedLine = textBeforeLine.replace(/\s+$/, "");
      if (htmlLike && /<\s*[A-Za-z0-9:_-]*$/.test(textBeforeLine)) {
        triggerChar = "<";
      } else if (
        CSS_LANGUAGES.has(completionLanguage) &&
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
      const sourceBudgetAllowsCompletion =
        completionSourceBudgetRef.current ||
        completionRuntimeSessionOpenRef.current ||
        hasAccessTrigger;
      if (!sourceBudgetAllowsCompletion) {
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

      const accessIdentity =
        accessInfo?.accessChain ??
        (accessTrigger ? textBeforeLine.trimEnd() : null);
      const accessExpressionFrom = completionAccessExpressionFrom(
        line.from,
        textBeforeLine,
        accessIdentity,
        accessInfo?.prefix.length ?? 0,
      );
      const requestKey = buildCompletionCacheKey(
        lineNumber,
        accessIdentity,
        accessInfo
          ? accessRequestStage(accessInfo)
          : accessTrigger
            ? "bare"
            : "-",
        stringPrefix !== null,
        inBraceContext,
      );
      const sessionKey = accessIdentity
        ? buildAccessSessionKey(
            lineNumber,
            accessIdentity,
            stringPrefix !== null,
            inBraceContext,
          )
        : requestKey;
      const requestVersion = currentDocumentVersion();
      const isAccessCompletion = accessInfo !== null || accessTrigger;
      const readSemanticKey: CompletionSemanticKeyReader = (updateContext) =>
        completionSemanticKeyAt(updateContext, language);
      const completionValidFor = getValidForRegex(
        completionLanguage,
        stringPrefix !== null,
        inBraceContext,
      );
      const accessPrefix = accessInfo?.prefix ?? "";
      const accessMemoryKey = isAccessCompletion
        ? accessCompletionSnapshotKey(filePath, sessionKey)
        : null;
      const accessMemorySnapshot = () =>
        accessMemoryKey
          ? lastCompleteAccessResultsRef.current.get(accessMemoryKey)
          : undefined;
      const accessCompletionResultForCurrentPrefix = (
        resultOptions: readonly Completion[],
        isIncomplete: boolean,
      ): CompletionResult => {
        const resultOptionsArgs = {
          from,
          options: resultOptions,
          validFor: completionValidFor,
          semanticKey: sessionKey,
          readSemanticKey,
          initialPrefix: accessPrefix,
        };
        return isIncomplete
          ? incompleteAccessCompletionResult(resultOptionsArgs)
          : stableAccessCompletionResult(resultOptionsArgs);
      };
      const accessResultForCurrentPrefix = (
        session: CompletionSessionRecord,
      ): CompletionResult =>
        accessCompletionResultForCurrentPrefix(
          session.result?.options ?? [],
          session.isIncomplete,
        );
      const rememberedAccessResultForCurrentPrefix =
        (): CompletionResult | null => {
          const rememberedOptions = actionableAccessOptionsFromSnapshot(
            accessMemorySnapshot(),
            accessPrefix,
          );
          if (!accessCompletionOptionsAreActionable(rememberedOptions)) {
            return null;
          }
          return accessCompletionResultForCurrentPrefix(
            rememberedOptions,
            false,
          );
        };
      const accessStatusResult = (
        completion: Completion,
        keepThroughPrefix: boolean,
      ) =>
        stableStatusCompletionResult({
          from,
          options: [completion],
          semanticKey: sessionKey,
          readSemanticKey,
          keepThroughPrefix,
        });
      const accessPendingResult = () =>
        accessStatusResult(accessPendingCompletion(), true);
      const accessEmptyResult = () =>
        accessStatusResult(accessEmptyCompletion(), false);
      const accessErrorResult = (
        result?: EditorCompletionResultPayload | null,
      ) =>
        accessStatusResult(
          accessErrorCompletion(accessCompletionLSPStatus(result ?? null)),
          false,
        );
      const wasAutoStartedForVersion =
        autoStartedCompletionVersionRef.current === requestVersion;
      const isDismissedForVersion = (version: number) =>
        completionDismissedVersionRef.current === version &&
        (!context.explicit || wasAutoStartedForVersion);
      if (isDismissedForVersion(requestVersion)) return null;

      const currentSession = completionSessionControllerRef.current.matches(
        filePath,
        sessionKey,
        requestVersion,
      );
      if (
        currentSession?.status === "dismissed" &&
        requestVersion === currentSession.version
      ) {
        return null;
      }
      if (
        isAccessCompletion &&
        currentSession?.status === "pending" &&
        requestVersion === currentSession.version
      ) {
        return currentSession.result ?? accessPendingResult();
      }
      if (
        isAccessCompletion &&
        currentSession?.status === "active" &&
        currentSession.result &&
        requestVersion === currentSession.version
      ) {
        return currentSession.result;
      }
      if (
        isAccessCompletion &&
        (currentSession?.status === "empty" ||
          currentSession?.status === "error") &&
        currentSession.result &&
        requestVersion === currentSession.version
      ) {
        return currentSession.result;
      }
      const wasAccessSessionIncomplete =
        isAccessCompletion && currentSession?.isIncomplete === true;
      const buildCompletionResult = async (
        requestId: number,
        versionAtRequest: number,
        sessionId: string,
      ): Promise<CompletionBuildOutcome> => {
        const transientRetryKey = `${requestKey}@${versionAtRequest}`;
        const incompleteSessionKey = accessIncompleteSessionKey(
          filePath,
          sessionKey,
        );
        const clearRememberedAccessIncomplete = () => {
          if (isAccessCompletion) {
            accessIncompleteSessionsRef.current.delete(incompleteSessionKey);
          }
        };
        const retryTransientAccess = (
          result?: EditorCompletionResultPayload | null,
        ): CompletionBuildOutcome => {
          const attempts =
            accessTransientRetryCountsRef.current.get(transientRetryKey) ?? 0;
          if (attempts >= ACCESS_TRANSIENT_RETRY_LIMIT) {
            return {
              kind: "error",
              result: accessErrorResult(result),
            };
          }
          accessTransientRetryCountsRef.current.set(
            transientRetryKey,
            attempts + 1,
          );
          return { kind: "retry" };
        };
        const emptyOutcome = (): CompletionBuildOutcome => ({
          kind: "empty",
          result: accessEmptyResult(),
        });
        const fullText = backendDocument.fullText;
        const lineText = fullText.slice(line.from, line.to);
        const textBefore = fullText.slice(0, pos);
        const textAfter = fullText.slice(pos);
        const { currentClass, currentMethod, imports } = buildCompletionContext(
          fullText,
          lineNumber,
        );

        const exactMatchingSession =
          completionSessionControllerRef.current.matches(
            filePath,
            sessionKey,
            versionAtRequest,
          );
        const matchingSession = exactMatchingSession;
        const rememberedIncomplete =
          (isAccessCompletion &&
            (accessInfo?.prefix.length || 0) > 0 &&
            accessIncompleteSessionsRef.current.get(
              accessIncompleteSessionKey(filePath, sessionKey),
            ) === true) ||
          wasAccessSessionIncomplete;
        const completionTriggerKind = completionTriggerKindForRequest(
          triggerChar,
          completionLanguage,
          matchingSession,
          lspTriggerCharactersRef.current,
          accessTrigger,
          rememberedIncomplete,
        );
        const requestPayload = {
          filePath,
          language: completionLanguage,
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
          accessOperator,
          completionTriggerKind,
          sessionId: backendSessionId,
          surfaceId: backendSurfaceId,
        } satisfies EditorCompletionRequestPayload;

        metricsRef.current.recordBackendRequestStarted();
        completionInFlightRequestsRef.current += 1;
        completionRuntimeSessionOpenRef.current = true;
        let result: EditorCompletionResultPayload | null = null;
        try {
          result = (await GetEditorCompletions(
            requestPayload,
          )) as EditorCompletionResultPayload | null;
        } finally {
          completionInFlightRequestsRef.current = Math.max(
            0,
            completionInFlightRequestsRef.current - 1,
          );
          if (completionInFlightRequestsRef.current === 0) {
            const view = getEditorViewRef.current?.();
            completionRuntimeSessionOpenRef.current =
              view !== null &&
              view !== undefined &&
              completionRuntimeSessionIsOpen(completionStatus(view.state));
          }
        }

        updateLSPTriggerCharacters(
          lspTriggerCharactersRef,
          completionLanguage,
          result,
        );
        const sameCompletionContextStillCurrent = () => {
          if (!isAccessCompletion) {
            return (
              !context.aborted &&
              !orchestrator.isStale(requestId) &&
              versionAtRequest === currentDocumentVersion()
            );
          }
          const view = getEditorViewRef.current?.();
          if (!view) return false;
          const currentKey = completionRequestKeyAt(
            new CompletionContext(
              view.state,
              view.state.selection.main.head,
              false,
            ),
            language,
          );
          return (
            currentKey === requestKey &&
            versionAtRequest === currentDocumentVersion()
          );
        };
        if (!sameCompletionContextStillCurrent()) {
          return { kind: "canceled" };
        }
        if (isDismissedForVersion(versionAtRequest)) {
          return { kind: "canceled" };
        }
        if (result && "stale" in result && result.stale) {
          return { kind: "stale" };
        }
        if (!result?.items?.length) {
          if (!isAccessCompletion) {
            return { kind: "canceled" };
          }
          const emptyClassification = classifyAccessNoItemsResult(result);
          if (emptyClassification === "empty") {
            accessTransientRetryCountsRef.current.delete(transientRetryKey);
            clearRememberedAccessIncomplete();
            return emptyOutcome();
          }
          if (isRetryableAccessNoItemsResult(result)) {
            return retryTransientAccess(result);
          }
          if (emptyClassification === "error") {
            accessTransientRetryCountsRef.current.delete(transientRetryKey);
            clearRememberedAccessIncomplete();
            return {
              kind: "error",
              result: accessErrorResult(result),
            };
          }
          return { kind: "canceled" };
        }

        const pendingItems = isAccessCompletion
          ? []
          : await fetchPendingClassCompletions(context);
        if (!sameCompletionContextStillCurrent()) {
          return { kind: "canceled" };
        }
        if (isDismissedForVersion(versionAtRequest)) {
          return { kind: "canceled" };
        }

        const completions: Completion[] = result.items.flatMap(
          (rawItem, itemIndex) => {
            const item = rawItem as typeof rawItem & CompletionPayload;
            if (
              isAccessCompletion &&
              !completionPayloadAllowedInAccessContext(item)
            ) {
              return [];
            }
            const completionItem = item;
            let insertText = item.insertText || item.text || item.label || "";
            if (shouldStripDollar && insertText.startsWith("$")) {
              insertText = insertText.slice(1);
            }
            if (!completionInsertTextIsBounded(insertText)) {
              return [];
            }
            const resolvedInsertText =
              snippetToPlainText(insertText) || insertText;
            if (
              !completionInsertPayloadIsBounded(insertText, resolvedInsertText)
            ) {
              return [];
            }
            const isSnippet =
              item.isSnippet === true || hasSnippetPlaceholder(insertText);
            if (
              !isAccessCompletion &&
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
              const versionAtApply = currentDocumentVersion();
              const docAtApply = view.state.doc;
              const selectionHeadAtApply = view.state.selection.main.head;
              const accessSessionStillCurrent = () => {
                if (!isAccessCompletion) {
                  return true;
                }
                const session =
                  completionSessionControllerRef.current.current();
                const sessionMatchesContext =
                  session?.filePath === filePath &&
                  session.semanticKey === sessionKey &&
                  versionAtApply >= session.version &&
                  !(
                    (session.status === "empty" ||
                      session.status === "error" ||
                      session.status === "dismissed") &&
                    session.version !== versionAtApply
                  );
                return (
                  sessionMatchesContext &&
                  (session.status === "active" || session.status === "pending")
                );
              };
              const applyStillCurrent = () =>
                currentDocumentVersion() === versionAtApply &&
                view.state.doc === docAtApply &&
                view.state.selection.main.head === selectionHeadAtApply &&
                accessSessionStillCurrent();
              let lastRejectReason: CompletionApplyRejectReason = "unknown";
              const rememberRejectReason = (
                reason: CompletionApplyRejectReason,
              ): false => {
                if (
                  lastRejectReason === "unknown" ||
                  reason !== "unsafe-plain-fallback"
                ) {
                  lastRejectReason = reason;
                }
                return false;
              };
              const rejectCompletionApply = (
                reason: CompletionApplyRejectReason = lastRejectReason,
                options?: {
                  requiresSafeEdits?: boolean;
                  requiresAdditionalSafeEdits?: boolean;
                },
              ) => {
                if (!applyStillCurrent()) {
                  return;
                }
                recordCompletionApplyReject({
                  reason,
                  label:
                    completionToApply.displayLabel || completionToApply.label,
                  source,
                  completionId: item.completionId,
                  stableKey: item.stableKey,
                  resolveToken: item.resolveToken,
                  requiresSafeEdits:
                    options?.requiresSafeEdits ??
                    completionItem.requiresSafeEditsBeforeApply === true,
                  requiresAdditionalSafeEdits:
                    options?.requiresAdditionalSafeEdits ??
                    completionItem.requiresSafeEditsBeforeApply === true,
                });
                completionSessionControllerRef.current.clear();
                closeCompletion(view);
              };
              const applyResolved = (
                finalInsertText: string,
                finalIsSnippet: boolean,
                finalPrimaryTextEdit?: PrimaryTextEditJSON | null,
                finalAdditionalTextEdits?: TextEditJSON[],
                options?: {
                  requiresSafeEdits?: boolean;
                  requiresAdditionalSafeEdits?: boolean;
                },
              ): boolean => {
                if (!applyStillCurrent()) {
                  return rememberRejectReason("stale-session");
                }
                if (
                  options?.requiresAdditionalSafeEdits === true &&
                  !(finalAdditionalTextEdits?.length || 0)
                ) {
                  return rememberRejectReason("missing-additional-safe-edits");
                }
                if (
                  options?.requiresSafeEdits === true &&
                  !finalPrimaryTextEdit &&
                  !(finalAdditionalTextEdits?.length || 0)
                ) {
                  return rememberRejectReason("missing-safe-edits");
                }
                if (!completionInsertTextIsBounded(finalInsertText)) {
                  return rememberRejectReason("oversized-insert");
                }
                const finalPlainText =
                  snippetToPlainText(finalInsertText) || finalInsertText;
                if (
                  !completionInsertPayloadIsBounded(
                    finalInsertText,
                    finalPlainText,
                  )
                ) {
                  return rememberRejectReason("oversized-insert");
                }
                const attempt = applyBackendCompletion(
                  view,
                  completionLanguage,
                  completionToApply,
                  applyFrom,
                  applyTo,
                  finalInsertText,
                  finalPlainText,
                  finalIsSnippet,
                  finalPrimaryTextEdit,
                  finalAdditionalTextEdits,
                  accessExpressionFrom,
                  selectionHeadAtApply,
                );
                if (attempt.applied) {
                  metricsRef.current.recordCompletionAccepted(
                    completionToApply,
                  );
                  completionSessionControllerRef.current.clear();
                  closeCompletion(view);
                  return true;
                }
                return rememberRejectReason(attempt.reason);
              };

              const hasReadyAdditionalTextEdits =
                (item.additionalTextEdits?.length || 0) > 0;
              const hasReadyPrimaryTextEdit = item.primaryTextEdit != null;
              const hasReadyCompletionEdits =
                hasReadyPrimaryTextEdit || hasReadyAdditionalTextEdits;
              const completionRequiresSafeEditsBeforeApply =
                completionItem.requiresSafeEditsBeforeApply === true ||
                completionItem.autoImportAllowed === true ||
                hasReadyAdditionalTextEdits ||
                completionItem.command != null ||
                completionPayloadRequiresSafeEditsFromSource(
                  completionItem,
                  source,
                  kind,
                );
              const completionRequiresAdditionalSafeEditsBeforeApply =
                completionItem.requiresSafeEditsBeforeApply === true ||
                completionItem.autoImportAllowed === true ||
                completionItem.command != null ||
                completionPayloadRequiresSafeEditsFromSource(
                  completionItem,
                  source,
                  kind,
                );
              const applyItemFallback = () =>
                applyResolved(
                  insertText,
                  isSnippet,
                  item.primaryTextEdit,
                  item.additionalTextEdits,
                  {
                    requiresSafeEdits: completionRequiresSafeEditsBeforeApply,
                    requiresAdditionalSafeEdits:
                      completionRequiresAdditionalSafeEditsBeforeApply,
                  },
                );
              const applyPlainFallback = (
                fallbackInsertText: string,
                fallbackIsSnippet: boolean,
                fallbackAdditionalTextEdits?: TextEditJSON[],
                requiresSafeEdits = completionRequiresSafeEditsBeforeApply,
              ) => {
                if (
                  requiresSafeEdits &&
                  !(fallbackAdditionalTextEdits?.length || 0)
                ) {
                  return rememberRejectReason("missing-additional-safe-edits");
                }
                if (
                  isAccessCompletion &&
                  completionHasIdentifierSuffixAtPosition(
                    view.state,
                    applyTo,
                    completionLanguage,
                  )
                ) {
                  return rememberRejectReason("unsafe-plain-fallback");
                }
                return applyResolved(
                  fallbackInsertText,
                  fallbackIsSnippet,
                  null,
                  fallbackAdditionalTextEdits,
                  { requiresSafeEdits },
                );
              };
              const readyItemCanSkipResolve =
                completionItem.requiresResolveBeforeApply === false &&
                (hasReadyAdditionalTextEdits ||
                  hasReadyPrimaryTextEdit ||
                  !completionRequiresSafeEditsBeforeApply);
              const shouldResolveBeforeApply =
                Boolean(item.resolveToken) &&
                (completionItem.requiresResolveBeforeApply !== false ||
                  (completionRequiresSafeEditsBeforeApply &&
                    !readyItemCanSkipResolve));
              if (readyItemCanSkipResolve && applyItemFallback()) {
                return;
              }
              if (shouldResolveBeforeApply) {
                void (async () => {
                  const resolved = await resolveEditorCompletionWithBudget({
                    resolveToken: item.resolveToken || "",
                    completionId: item.completionId,
                    stableKey: item.stableKey,
                    documentVersion: versionAtApply,
                    sessionId: backendSessionId,
                    surfaceId: backendSurfaceId,
                  });
                  if (!applyStillCurrent()) return;
                  if (resolved) {
                    const resolvedAdditionalTextEdits =
                      mergeCompletionAdditionalTextEdits(
                        item.additionalTextEdits,
                        resolved.additionalTextEdits,
                      );
                    const resolvedRequiresSafeEdits =
                      completionRequiresSafeEditsBeforeApply ||
                      resolved.command != null;
                    const resolvedRequiresAdditionalSafeEdits =
                      completionRequiresAdditionalSafeEditsBeforeApply ||
                      resolved.command != null;
                    const applied = applyResolved(
                      resolved.insertText || insertText,
                      resolved.isSnippet === true || isSnippet,
                      resolved.primaryTextEdit || item.primaryTextEdit,
                      resolvedAdditionalTextEdits,
                      {
                        requiresSafeEdits: resolvedRequiresSafeEdits,
                        requiresAdditionalSafeEdits:
                          resolvedRequiresAdditionalSafeEdits,
                      },
                    );
                    if (applied) {
                      return;
                    }
                    if (
                      !resolvedRequiresSafeEdits &&
                      applyPlainFallback(
                        resolved.insertText || insertText,
                        resolved.isSnippet === true || isSnippet,
                        resolvedAdditionalTextEdits,
                        resolvedRequiresSafeEdits,
                      )
                    ) {
                      return;
                    }
                    if (readyItemCanSkipResolve && applyItemFallback()) {
                      return;
                    }
                    if (
                      !resolvedRequiresSafeEdits &&
                      !isAccessCompletion &&
                      applyResolved(insertText, isSnippet, null, [])
                    ) {
                      return;
                    }
                    if (
                      !resolvedRequiresSafeEdits &&
                      applyPlainFallback(insertText, isSnippet, [])
                    ) {
                      return;
                    }
                    rejectCompletionApply(lastRejectReason, {
                      requiresSafeEdits: resolvedRequiresSafeEdits,
                      requiresAdditionalSafeEdits:
                        resolvedRequiresAdditionalSafeEdits,
                    });
                    return;
                  }
                  if (readyItemCanSkipResolve && applyItemFallback()) {
                    return;
                  }
                  if (
                    !completionRequiresSafeEditsBeforeApply &&
                    !isAccessCompletion &&
                    applyResolved(insertText, isSnippet, null, [])
                  ) {
                    return;
                  }
                  if (
                    !completionRequiresSafeEditsBeforeApply &&
                    applyPlainFallback(insertText, isSnippet, [])
                  ) {
                    return;
                  }
                  rejectCompletionApply("resolve-timeout-or-empty", {
                    requiresSafeEdits: completionRequiresSafeEditsBeforeApply,
                    requiresAdditionalSafeEdits:
                      completionRequiresAdditionalSafeEditsBeforeApply,
                  });
                })();
                return;
              }

              if (
                !applyResolved(
                  insertText,
                  isSnippet,
                  item.primaryTextEdit,
                  item.additionalTextEdits,
                  {
                    requiresSafeEdits: completionRequiresSafeEditsBeforeApply,
                    requiresAdditionalSafeEdits:
                      completionRequiresAdditionalSafeEditsBeforeApply,
                  },
                )
              ) {
                if (
                  !completionRequiresSafeEditsBeforeApply &&
                  applyPlainFallback(insertText, isSnippet, [])
                ) {
                  return;
                }
                rejectCompletionApply(lastRejectReason, {
                  requiresSafeEdits: completionRequiresSafeEditsBeforeApply,
                  requiresAdditionalSafeEdits:
                    completionRequiresAdditionalSafeEditsBeforeApply,
                });
              }
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
            const sortText = item.sortText || "";
            const commitCharacters =
              source === "lsp"
                ? lspCommitCharacters(item.commitCharacters)
                : undefined;

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
              ...(commitCharacters ? { commitCharacters } : {}),
              boost:
                richCompletionBoost +
                backendPriority / 1000 +
                stableIndexTiebreak,
              __insertText: resolvedInsertText,
              __filterText: filterLabel,
              __sortText: sortText,
              __hasAdditionalTextEdits:
                hasPrimaryTextEdit ||
                hasAdditionalTextEdits ||
                Boolean(item.resolveToken),
              __completionId: completionItem.completionId,
              __stableKey: completionItem.stableKey,
              __autoImportAllowed: completionItem.autoImportAllowed === true,
              __requiresResolveBeforeApply:
                completionItem.requiresResolveBeforeApply === true,
              __requiresSafeEditsBeforeApply:
                completionItem.requiresSafeEditsBeforeApply === true,
              __sourceKind: source,
            };
            (completion as unknown as Record<string, unknown>).__source =
              sourceLabel;

            return [completion];
          },
        );

        const shouldStabilizeAccessList = isAccessCompletion;
        const previousAccessScopedOptions =
          shouldStabilizeAccessList && accessPrefix.length > 0
            ? mergeAccessCompletionMemoryOptions(
                actionableAccessOptionsFromSnapshot(
                  accessMemorySnapshot(),
                  accessPrefix,
                ),
                actionableAccessOptionsFromSession(
                  matchingSession,
                  accessPrefix,
                ),
              )
            : [];
        const accessScopedOptions = shouldStabilizeAccessList
          ? filterAccessCompletionOptions(
              sortAccessCompletionOptions([...pendingItems, ...completions]),
              accessPrefix,
            )
          : [];
        const stableAccessScopedOptions = shouldStabilizeAccessList
          ? accessCompletionOptionsForKnownScope(
              accessScopedOptions,
              previousAccessScopedOptions,
            )
          : accessScopedOptions;
        const allOptions = shouldStabilizeAccessList
          ? [...stableAccessScopedOptions]
          : [...pendingItems, ...completions];
        if (
          shouldStabilizeAccessList &&
          accessPrefix.length > 0 &&
          !completionOptionsHaveActionableCompletions(allOptions) &&
          completionOptionsHaveActionableCompletions(
            previousAccessScopedOptions,
          )
        ) {
          allOptions.push(...previousAccessScopedOptions);
        }
        if (!sameCompletionContextStillCurrent()) {
          return { kind: "canceled" };
        }
        if (isDismissedForVersion(versionAtRequest)) {
          return { kind: "canceled" };
        }
        if (allOptions.length === 0) {
          if (!isAccessCompletion) {
            return { kind: "canceled" };
          }
          if (classifyAccessNoItemsResult(result) === "empty") {
            accessTransientRetryCountsRef.current.delete(transientRetryKey);
            clearRememberedAccessIncomplete();
            return emptyOutcome();
          }
          if (isRetryableAccessNoItemsResult(result)) {
            return retryTransientAccess(result);
          }
          accessTransientRetryCountsRef.current.delete(transientRetryKey);
          clearRememberedAccessIncomplete();
          return {
            kind: "error",
            result: accessErrorResult(result),
          };
        }

        const resultIsIncomplete = result.isIncomplete === true;
        metricsRef.current.recordCompletionList(allOptions);
        orchestrator.markResponse(requestId);
        accessTransientRetryCountsRef.current.delete(transientRetryKey);

        if (resultIsIncomplete) {
          if (isAccessCompletion) {
            accessIncompleteSessionsRef.current.set(incompleteSessionKey, true);
          }
          return {
            kind: "result",
            isIncomplete: true,
            result: isAccessCompletion
              ? incompleteAccessCompletionResult({
                  from,
                  options: allOptions,
                  validFor: completionValidFor,
                  semanticKey: sessionKey,
                  readSemanticKey,
                  initialPrefix: accessPrefix,
                })
              : {
                  from,
                  options: allOptions,
                },
          };
        }

        clearRememberedAccessIncomplete();
        const stableResult = isAccessCompletion
          ? stableAccessCompletionResult({
              from,
              options: allOptions,
              validFor: completionValidFor,
              semanticKey: sessionKey,
              readSemanticKey,
              initialPrefix: accessPrefix,
            })
          : stableCompletionResult({
              from,
              options: allOptions,
              validFor: completionValidFor,
              semanticKey: sessionKey,
              readSemanticKey,
            });
        if (
          isAccessCompletion &&
          accessPrefix.length === 0 &&
          accessMemoryKey &&
          accessCompletionOptionsCanBeRemembered(allOptions)
        ) {
          lastCompleteAccessResultsRef.current.set(accessMemoryKey, {
            version: versionAtRequest,
            options: rememberableAccessCompletionOptions(allOptions),
          });
        }
        return {
          kind: "result",
          isIncomplete: false,
          result: stableResult,
        };
      };

      const requestId = orchestrator.nextRequestId();
      const sessionId =
        currentSession?.id ?? nextCompletionSessionId(completionSessionSeqRef);
      const instantResult = isAccessCompletion
        ? null
        : buildInstantCompletionResult(context, {
            recordMetrics: false,
          });

      if (
        isAccessCompletion &&
        (currentSession?.status !== "active" ||
          currentSession.isIncomplete ||
          currentSession.version !== requestVersion)
      ) {
        completionSessionControllerRef.current.beginPending({
          id: sessionId,
          filePath,
          semanticKey: sessionKey,
          version: requestVersion,
          requestId,
          isAccess: true,
        });
      }

      const refreshSameCompletionSession = () => {
        queueMicrotask(() => {
          const latestView = getEditorViewRef.current?.();
          if (!latestView) return;
          const currentKey = completionSemanticKeyAt(
            new CompletionContext(
              latestView.state,
              latestView.state.selection.main.head,
              false,
            ),
            language,
          );
          if (currentKey !== sessionKey) return;
          startCompletion(latestView);
        });
      };

      const backendPromise = buildCompletionResult(
        requestId,
        requestVersion,
        sessionId,
      ).catch((err) => {
        console.warn("Completion error:", err);
        if (isAccessCompletion) {
          return {
            kind: "error",
            result: accessErrorResult(),
          } satisfies CompletionBuildOutcome;
        }
        return { kind: "canceled" } satisfies CompletionBuildOutcome;
      });

      if (isAccessCompletion) {
        const rememberedVisibleResult =
          rememberedAccessResultForCurrentPrefix();
        const currentVisibleResult =
          currentSession?.status === "active" && currentSession.result
            ? accessResultForCurrentPrefix(currentSession)
            : null;
        const visibleResult =
          currentVisibleResult &&
          completionOptionsHaveActionableCompletions(
            currentVisibleResult.options,
          )
            ? currentVisibleResult
            : (rememberedVisibleResult ??
              currentVisibleResult ??
              accessPendingResult());
        const preservedAccessResultForPendingSession = (): {
          result: CompletionResult;
          isIncomplete: boolean;
        } | null => {
          const session = completionSessionControllerRef.current.current();
          if (
            !session ||
            session.id !== sessionId ||
            session.requestId !== requestId ||
            session.filePath !== filePath ||
            session.semanticKey !== sessionKey ||
            session.status !== "pending"
          ) {
            return null;
          }
          const result = accessResultForCurrentPrefix(session);
          if (!completionOptionsHaveActionableCompletions(result.options)) {
            const remembered = rememberedAccessResultForCurrentPrefix();
            return remembered
              ? { result: remembered, isIncomplete: false }
              : null;
          }
          return { result, isIncomplete: session.isIncomplete };
        };
        metricsRef.current.recordInstantFallbackUsed();
        metricsRef.current.recordCompletionList([...visibleResult.options]);
        backendPromise.then((outcome) => {
          if (outcome.kind === "result") {
            const updated = completionSessionControllerRef.current.activate(
              sessionId,
              outcome.result,
              {
                version: requestVersion,
                requestId,
                isIncomplete: outcome.isIncomplete,
              },
            );
            if (!updated) return;
            refreshSameCompletionSession();
            return;
          }
          if (outcome.kind === "empty") {
            const preserved = preservedAccessResultForPendingSession();
            if (preserved) {
              const updated = completionSessionControllerRef.current.activate(
                sessionId,
                preserved.result,
                {
                  version: requestVersion,
                  requestId,
                  isIncomplete: preserved.isIncomplete,
                },
              );
              if (!updated) return;
              refreshSameCompletionSession();
              return;
            }
            const updated = completionSessionControllerRef.current.finishEmpty(
              sessionId,
              outcome.result,
              { version: requestVersion, requestId },
            );
            if (!updated) return;
            refreshSameCompletionSession();
            return;
          }
          if (outcome.kind === "error") {
            const preserved = preservedAccessResultForPendingSession();
            if (preserved) {
              const updated = completionSessionControllerRef.current.activate(
                sessionId,
                preserved.result,
                {
                  version: requestVersion,
                  requestId,
                  isIncomplete: preserved.isIncomplete,
                },
              );
              if (!updated) return;
              refreshSameCompletionSession();
              return;
            }
            const updated = completionSessionControllerRef.current.finishError(
              sessionId,
              outcome.result,
              { version: requestVersion, requestId },
            );
            if (!updated) return;
            refreshSameCompletionSession();
            return;
          }
          if (outcome.kind === "retry") {
            const cleared =
              completionSessionControllerRef.current.cancelPending(sessionId, {
                requestId,
              });
            if (cleared) {
              window.setTimeout(
                refreshSameCompletionSession,
                ACCESS_TRANSIENT_RETRY_DELAY_MS,
              );
            }
            return;
          }
          if (outcome.kind === "stale" || outcome.kind === "canceled") {
            const cleared =
              completionSessionControllerRef.current.cancelPending(sessionId, {
                requestId,
              });
            if (cleared) {
              refreshSameCompletionSession();
            }
            return;
          }
        });
        return visibleResult;
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
            metricsRef.current.recordInstantFallbackUsed();
            metricsRef.current.recordCompletionList([...instantResult.options]);
            settle(instantResult);
          };
          const timer = window.setTimeout(() => {
            settleInstant();
          }, COMPLETION_FAST_BACKEND_GRACE_MS);

          backendPromise.then((outcome) => {
            const result = completionOutcomeResult(outcome);
            if (result) {
              settle(
                mergeBackendAndInstantCompletionResults(result, instantResult),
              );
            } else {
              settleInstant();
            }
          });
        });
      }

      return backendPromise.then(completionOutcomeResult);
    },
    [
      buildInstantCompletionResult,
      backendSessionId,
      backendSurfaceId,
      enabled,
      fetchPendingClassCompletions,
      filePath,
      language,
      currentDocumentVersion,
      orchestrator,
    ],
  );

  const completionShellExtensions = useMemo<Extension[]>(() => {
    if (!enabled) {
      return [];
    }

    const clearPendingCompletionAcceptIntent = () => {
      pendingCompletionAcceptIntentRef.current = null;
    };
    const pendingCompletionAcceptIntentStillCurrent = (
      view: EditorView,
    ): PendingCompletionAcceptIntent | null => {
      const intent = pendingCompletionAcceptIntentRef.current;
      if (!intent) {
        return null;
      }
      if (!view.hasFocus) {
        clearPendingCompletionAcceptIntent();
        return null;
      }
      if (Date.now() >= intent.expiresAt || intent.filePath !== filePath) {
        clearPendingCompletionAcceptIntent();
        return null;
      }
      if (view.state.doc.toString() !== intent.docAtAccept) {
        clearPendingCompletionAcceptIntent();
        return null;
      }
      const currentKey = completionSemanticKeyAt(
        new CompletionContext(
          view.state,
          view.state.selection.main.head,
          false,
        ),
        language,
      );
      if (currentKey !== intent.semanticKey) {
        clearPendingCompletionAcceptIntent();
        return null;
      }
      return intent;
    };
    const retryPendingCompletionAcceptIntent = (view: EditorView) => {
      window.setTimeout(() => {
        const intent = pendingCompletionAcceptIntentStillCurrent(view);
        if (!intent) {
          return;
        }
        if (acceptFirstActionableCompletion(view)) {
          clearPendingCompletionAcceptIntent();
          return;
        }
        retryPendingCompletionAcceptIntent(view);
      }, COMPLETION_FAST_BACKEND_GRACE_MS);
    };
    const recordPendingCompletionAcceptIntent = (
      view: EditorView,
      docAtAccept: string,
      semanticKey?: string | null,
    ): boolean => {
      const session = completionSessionControllerRef.current.current();
      const key =
        semanticKey ??
        (session?.isAccess === true ? session.semanticKey : null);
      if (!key) {
        return false;
      }
      pendingCompletionAcceptIntentRef.current = {
        filePath,
        semanticKey: key,
        docAtAccept,
        expiresAt: Date.now() + COMPLETION_ACCEPT_RETRY_WINDOW_MS,
      };
      retryPendingCompletionAcceptIntent(view);
      return true;
    };
    const acceptPendingAccessCompletion = (view: EditorView): boolean => {
      if (completionDismissedVersionRef.current === currentDocumentVersion()) {
        return false;
      }
      const pos = view.state.selection.main.head;
      const completionLanguage = embeddedCompletionLanguageAt(
        view.state,
        pos,
        language,
      );
      const line = view.state.doc.lineAt(pos);
      const textBeforeLine = line.text.slice(0, pos - line.from);
      const hasAccessIntent =
        extractAccessPrefix(textBeforeLine, completionLanguage) !== null ||
        accessOperatorFromText(textBeforeLine, completionLanguage) !== "";
      if (!hasAccessIntent) {
        return false;
      }
      const session = completionSessionControllerRef.current.current();
      const semanticKey =
        completionSemanticKeyAt(
          new CompletionContext(view.state, pos, false),
          language,
        ) ?? null;
      const docAtAccept = view.state.doc.toString();
      if (
        !recordPendingCompletionAcceptIntent(view, docAtAccept, semanticKey)
      ) {
        return false;
      }
      completionRuntimeSessionOpenRef.current = true;
      startCompletion(view);
      return true;
    };
    const runAcceptCompletion = (view: EditorView): boolean => {
      const status = completionStatus(view.state);
      if (status === "active" || status === "pending") {
        const options = currentCompletions(
          view.state,
        ) as CompletionWithInsertText[];
        if (options.length === 0) {
          return acceptPendingAccessCompletion(view);
        }
        return acceptVisibleCompletion(view, {
          onAccepted: clearPendingCompletionAcceptIntent,
        });
      }
      return acceptPendingAccessCompletion(view);
    };

    return [
      orchestrator.extension,
      Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: runAcceptCompletion,
          },
          ...COMPLETION_KEYMAP_WITHOUT_ESCAPE_OR_ENTER,
        ]),
      ),
      EditorView.updateListener.of((update) => {
        const status = completionStatus(update.state);
        completionRuntimeSessionOpenRef.current =
          completionRuntimeSessionIsOpen(status) ||
          completionInFlightRequestsRef.current > 0;
        if (!update.docChanged) return;
        if (update.view.composing || update.view.compositionStarted) return;
        recordLocalDocumentChange(update.state.doc.toString());

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
        const completionLanguage = embeddedCompletionLanguageAt(
          update.state,
          currentPos,
          language,
        );
        const isWhitespaceCompletionTrigger =
          insertedAutocompleteWhitespace &&
          completionLanguage === "go" &&
          extractGoPackageNamePrefix(textBeforeLine) !== null;
        if (!insertedNonWhitespace && !isWhitespaceCompletionTrigger) return;

        const recentText = update.state.doc.sliceString(
          Math.max(0, currentPos - 2),
          currentPos,
        );
        const isAccessTrigger = endsWithAccessTrigger(
          recentText,
          completionLanguage,
        );
        const isAccessContext =
          isAccessTrigger ||
          extractAccessPrefix(textBeforeLine, completionLanguage) !== null;
        const activeCompletionSession =
          completionSessionControllerRef.current.current();
        const activeAccessSession =
          activeCompletionSession?.isAccess === true &&
          (activeCompletionSession.status === "active" ||
            activeCompletionSession.status === "pending");

        if (
          status === "active" &&
          hasActionableCompletions(update.state) &&
          !isAccessContext &&
          !activeAccessSession &&
          !isAccessTrigger &&
          !isWhitespaceCompletionTrigger
        ) {
          return;
        }

        const view = update.view;
        const docSnapshot = update.state.doc;

        queueMicrotask(() => {
          if (view.state.doc !== docSnapshot) return;
          const version = currentDocumentVersion();
          if (completionDismissedVersionRef.current === version) return;
          const nextStatus = completionStatus(view.state);
          const nextActiveCompletionSession =
            completionSessionControllerRef.current.current();
          const nextActiveAccessSession =
            nextActiveCompletionSession?.isAccess === true &&
            (nextActiveCompletionSession.status === "active" ||
              nextActiveCompletionSession.status === "pending");
          completionRuntimeSessionOpenRef.current =
            completionRuntimeSessionIsOpen(nextStatus) ||
            completionInFlightRequestsRef.current > 0;
          if (
            nextStatus === "active" &&
            hasActionableCompletions(view.state) &&
            !isAccessContext &&
            !nextActiveAccessSession &&
            !isAccessTrigger &&
            !isWhitespaceCompletionTrigger
          ) {
            return;
          }
          if (view.composing || view.compositionStarted) return;
          metricsRef.current.recordAutocompleteRequested();
          autoStartedCompletionVersionRef.current = version;
          startCompletion(view);
        });
      }),
      tooltips({
        parent: typeof document !== "undefined" ? document.body : undefined,
        position: "fixed",
        tooltipSpace: completionTooltipSpace,
      }),
      autocompletion({
        override: [backendCompletionSource],
        activateOnTyping: false,
        activateOnTypingDelay: 0,
        updateSyncTime: COMPLETION_FAST_BACKEND_GRACE_MS,
        maxRenderedOptions: COMPLETION_MAX_RENDERED_OPTIONS,
        defaultKeymap: false,
        aboveCursor: true,
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
    ];
  }, [
    backendCompletionSource,
    enabled,
    language,
    currentDocumentVersion,
    recordLocalDocumentChange,
    orchestrator,
  ]);

  const extensions = useMemo<Extension[]>(() => {
    if (!enabled) {
      return [];
    }

    const result: Extension[] = [];

    if (editorFeatureBudget.runtimeGhostText) {
      result.push(ghost.ghostField, ghost.extension);
    }
    result.push(Prec.highest(ghost.keymap));

    if (editorFeatureBudget.runtimeRichEditorFeatures) {
      result.push(metrics.extension);
    }

    result.push(...completionShellExtensions);

    return result;
  }, [
    completionShellExtensions,
    editorFeatureBudget.runtimeGhostText,
    editorFeatureBudget.runtimeRichEditorFeatures,
    enabled,
    ghost,
    metrics,
  ]);

  const extensionsKey = useStableReferenceKey([
    "completion-provider",
    enabled,
    editorFeatureBudget.runtimeGhostText,
    editorFeatureBudget.runtimeRichEditorFeatures,
    filePath,
    language,
    completionShellExtensions,
    ghost,
    metrics,
  ]);

  return {
    extensions,
    extensionsKey,
    recordDocumentChange,
  };
};
