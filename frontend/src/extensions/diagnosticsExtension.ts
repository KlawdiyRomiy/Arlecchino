import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type ChangeDesc,
} from "@codemirror/state";
import {
  setDiagnostics,
  type Diagnostic as CodeMirrorDiagnostic,
} from "@codemirror/lint";
import {
  Decoration,
  EditorView,
  layer,
  ViewPlugin,
  type DecorationSet,
  type LayerMarker,
  type ViewUpdate,
} from "@codemirror/view";
import { LSPGetDiagnostics } from "../wails/app";
import {
  useDiagnosticsStore,
  type DiagnosticsEventItem,
  type DiagnosticsProblem,
} from "../stores/diagnosticsStore";

type CodeMirrorDocLike = {
  line(number: number): { from: number; to: number; text: string };
  lines: number;
  length: number;
};

type CodeMirrorDiagnosticSeverity = CodeMirrorDiagnostic["severity"];
type InlineDiagnosticSeverity = Exclude<CodeMirrorDiagnosticSeverity, "hint">;

export interface InlineDiagnosticsLine {
  from: number;
  to: number;
  severity: InlineDiagnosticSeverity;
  message: string;
  source: string;
  count: number;
}

interface DiagnosticsExtensionOptions {
  filePath: string;
  language: string;
  showInlineMessages: boolean;
}

const EMPTY_PROBLEMS: readonly DiagnosticsProblem[] = Object.freeze([]);
const EMPTY_INLINE_SNAPSHOT: readonly InlineDiagnosticsLine[] = Object.freeze(
  [],
);
const INLINE_DIAGNOSTIC_MARKER_HEIGHT = 25;
const INLINE_DIAGNOSTIC_VIEWPORT_PADDING = 16;
const INLINE_DIAGNOSTIC_MIN_READABLE_WIDTH = 420;
const lastVisibleProblemsByView = new WeakMap<
  EditorView,
  readonly DiagnosticsProblem[]
>();

const inlineSeverityPriority: Record<InlineDiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const mapSeverity = (severity: number): CodeMirrorDiagnosticSeverity => {
  if (severity === 1) {
    return "error";
  }
  if (severity === 2) {
    return "warning";
  }
  if (severity === 4) {
    return "hint";
  }
  return "info";
};

const toInlineSeverity = (
  severity: CodeMirrorDiagnosticSeverity,
): InlineDiagnosticSeverity => {
  if (severity === "hint") {
    return "info";
  }
  return severity;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const getLine = (doc: CodeMirrorDocLike, lineNumber: number) => {
  const safeLine = clamp(lineNumber, 1, Math.max(doc.lines, 1));
  return doc.line(safeLine);
};

const getOffset = (
  doc: CodeMirrorDocLike,
  position: DiagnosticsProblem["range"]["start"],
): number => {
  const line = getLine(doc, position.line + 1);
  const column = clamp(position.character, 0, line.text.length);
  return clamp(line.from + column, line.from, line.to);
};

const buildExpandedMessageText = (snapshot: InlineDiagnosticsLine): string => {
  const parts = [snapshot.message];
  if (snapshot.count > 1) {
    parts.push(`+${snapshot.count - 1} more`);
  }
  if (snapshot.source) {
    parts.push(snapshot.source);
  }
  return parts.join(" - ");
};

const buildFullMessageText = (snapshot: InlineDiagnosticsLine): string => {
  const parts = [snapshot.message];
  if (snapshot.count > 1) {
    parts.push(`+${snapshot.count - 1} more`);
  }
  if (snapshot.source) {
    parts.push(snapshot.source);
  }
  return parts.join(" - ");
};

const getProblemsSignature = (
  problems: readonly DiagnosticsProblem[],
): string => problems.map((problem) => problem.id).join("\u0000");

export const buildCodeMirrorDiagnostics = (
  doc: CodeMirrorDocLike,
  problems: readonly DiagnosticsProblem[],
): CodeMirrorDiagnostic[] => {
  return problems.map((problem) => {
    const from = getOffset(doc, problem.range.start);
    const to = Math.max(from, getOffset(doc, problem.range.end));
    return {
      from,
      to,
      severity: mapSeverity(problem.severity),
      message: problem.message,
      source: problem.source || undefined,
    } satisfies CodeMirrorDiagnostic;
  });
};

export const buildInlineDiagnosticsSnapshot = (
  doc: CodeMirrorDocLike,
  problems: readonly DiagnosticsProblem[],
): InlineDiagnosticsLine[] => {
  return problems
    .map((problem) => {
      const severity = toInlineSeverity(mapSeverity(problem.severity));
      const from = getOffset(doc, problem.range.start);
      const to = Math.max(from, getOffset(doc, problem.range.end));
      return {
        from,
        to,
        severity,
        message: problem.message,
        source: problem.source,
        count: 1,
      } satisfies InlineDiagnosticsLine;
    })
    .sort((left, right) => left.from - right.from);
};

const setInlineDiagnosticsEffect =
  StateEffect.define<readonly InlineDiagnosticsLine[]>();
const setInlineDiagnosticsMessagesVisibleEffect = StateEffect.define<boolean>();

const mapInlineDiagnostics = (
  diagnostics: readonly InlineDiagnosticsLine[],
  changes: ChangeDesc,
): readonly InlineDiagnosticsLine[] =>
  diagnostics.map((snapshot) => {
    const from = changes.mapPos(snapshot.from, -1);
    const to = Math.max(from, changes.mapPos(snapshot.to, 1));
    return {
      ...snapshot,
      from,
      to,
    };
  });

const buildInlineDiagnosticMarks = (
  diagnostics: readonly InlineDiagnosticsLine[],
): DecorationSet => {
  if (diagnostics.length === 0) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const snapshot of diagnostics) {
    if (snapshot.to <= snapshot.from) {
      continue;
    }
    builder.add(
      snapshot.from,
      snapshot.to,
      Decoration.mark({
        class: `cm-diagnostic-range cm-diagnostic-range-${snapshot.severity}`,
      }),
    );
  }

  return builder.finish();
};

const inlineDiagnosticsField = StateField.define<
  readonly InlineDiagnosticsLine[]
>({
  create() {
    return EMPTY_INLINE_SNAPSHOT;
  },
  update(value, transaction) {
    let next = transaction.docChanged
      ? mapInlineDiagnostics(value, transaction.changes)
      : value;

    for (const effect of transaction.effects) {
      if (effect.is(setInlineDiagnosticsEffect)) {
        next = effect.value;
      }
    }

    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, buildInlineDiagnosticMarks),
});

const inlineDiagnosticsMessagesVisibleField = StateField.define<boolean>({
  create() {
    return true;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setInlineDiagnosticsMessagesVisibleEffect)) {
        return effect.value;
      }
    }

    return value;
  },
});

class DiagnosticsOverlayMarker implements LayerMarker {
  constructor(
    private readonly snapshot: InlineDiagnosticsLine,
    private readonly left: number,
    private readonly top: number,
    private readonly maxWidth: number,
    private readonly expanded: boolean,
    private readonly lineNumber: number,
  ) {}

  eq(other: LayerMarker): boolean {
    return (
      other instanceof DiagnosticsOverlayMarker &&
      this.left === other.left &&
      this.top === other.top &&
      this.maxWidth === other.maxWidth &&
      this.expanded === other.expanded &&
      this.lineNumber === other.lineNumber &&
      this.snapshot.from === other.snapshot.from &&
      this.snapshot.to === other.snapshot.to &&
      this.snapshot.severity === other.snapshot.severity &&
      this.snapshot.message === other.snapshot.message &&
      this.snapshot.source === other.snapshot.source &&
      this.snapshot.count === other.snapshot.count
    );
  }

  draw(): HTMLElement {
    const dom = document.createElement("div");
    this.updateDOM(dom);
    return dom;
  }

  update(dom: HTMLElement, previous: LayerMarker): boolean {
    if (!(previous instanceof DiagnosticsOverlayMarker)) {
      return false;
    }
    this.updateDOM(dom);
    return true;
  }

  private updateDOM(dom: HTMLElement): void {
    dom.className = `cm-diagnostic-overlay cm-diagnostic-overlay-${this.snapshot.severity}`;
    dom.style.left = `${this.left}px`;
    dom.style.top = `${this.top}px`;
    dom.style.maxWidth = `${this.maxWidth}px`;
    dom.style.setProperty(
      "--cm-diagnostic-overlay-readable-width",
      `${this.maxWidth}px`,
    );
    dom.dataset.diagnosticExpanded = this.expanded ? "true" : "false";
    dom.dataset.diagnosticLine = String(this.lineNumber);
    dom.title = buildFullMessageText(this.snapshot);
    dom.replaceChildren(
      this.createDot(),
      this.createCount(),
      this.createMessageText(),
    );
  }

  private createDot(): HTMLElement {
    const dot = document.createElement("span");
    dot.className = "cm-diagnostic-overlay-dot";
    return dot;
  }

  private createCount(): HTMLElement {
    const count = document.createElement("span");
    count.className = "cm-diagnostic-overlay-count";
    count.textContent =
      this.snapshot.count > 1 ? String(this.snapshot.count) : "";
    return count;
  }

  private createMessageText(): HTMLElement {
    const text = document.createElement("span");
    text.className = "cm-diagnostic-overlay-text";
    text.textContent = buildExpandedMessageText(this.snapshot);
    return text;
  }
}

const getLayerBase = (view: EditorView): { left: number; top: number } => {
  const rect = view.scrollDOM.getBoundingClientRect();
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  };
};

const isSnapshotVisible = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
): boolean =>
  view.visibleRanges.some(
    (range) => snapshot.to >= range.from && snapshot.from <= range.to,
  );

const buildInlineDiagnosticMarkers = (
  view: EditorView,
): readonly LayerMarker[] => {
  if (!view.state.field(inlineDiagnosticsMessagesVisibleField)) {
    return [];
  }

  const diagnostics = view.state.field(inlineDiagnosticsField);
  if (diagnostics.length === 0) {
    return [];
  }

  const base = getLayerBase(view);
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head);
  const grouped = new Map<
    number,
    { lineNumber: number; snapshot: InlineDiagnosticsLine }
  >();
  const markers: LayerMarker[] = [];

  for (const snapshot of diagnostics) {
    if (!isSnapshotVisible(view, snapshot)) {
      continue;
    }

    const line = view.state.doc.lineAt(
      clamp(snapshot.from, 0, view.state.doc.length),
    );
    const existing = grouped.get(line.number);
    if (!existing) {
      grouped.set(line.number, {
        lineNumber: line.number,
        snapshot: { ...snapshot },
      });
      continue;
    }

    const count = existing.snapshot.count + snapshot.count;
    if (
      inlineSeverityPriority[snapshot.severity] <
      inlineSeverityPriority[existing.snapshot.severity]
    ) {
      grouped.set(line.number, {
        lineNumber: line.number,
        snapshot: { ...snapshot, count },
      });
    } else {
      existing.snapshot = { ...existing.snapshot, count };
    }
  }

  for (const { lineNumber, snapshot } of grouped.values()) {
    const line = view.state.doc.lineAt(
      clamp(snapshot.from, 0, view.state.doc.length),
    );
    const coords =
      view.coordsAtPos(line.to, -1) ??
      view.coordsAtPos(snapshot.to, 1) ??
      view.coordsAtPos(snapshot.from, 1);
    if (!coords) {
      continue;
    }

    const lineHeight = Math.max(coords.bottom - coords.top, 1);
    const preferredLeft = coords.right - base.left + 10;
    const visiblePreferredLeft = preferredLeft - view.scrollDOM.scrollLeft;
    const maxViewportWidth = Math.max(
      44,
      view.scrollDOM.clientWidth - INLINE_DIAGNOSTIC_VIEWPORT_PADDING * 2,
    );
    const readableWidth = Math.min(
      INLINE_DIAGNOSTIC_MIN_READABLE_WIDTH,
      maxViewportWidth,
    );
    const hasReadableRightSpace =
      view.scrollDOM.clientWidth -
        visiblePreferredLeft -
        INLINE_DIAGNOSTIC_VIEWPORT_PADDING >=
      readableWidth;
    const visibleLeft = hasReadableRightSpace
      ? Math.max(INLINE_DIAGNOSTIC_VIEWPORT_PADDING, visiblePreferredLeft)
      : INLINE_DIAGNOSTIC_VIEWPORT_PADDING;
    const left = view.scrollDOM.scrollLeft + visibleLeft;
    const top =
      coords.top -
      base.top +
      Math.max((lineHeight - INLINE_DIAGNOSTIC_MARKER_HEIGHT) / 2, 0);
    const maxWidth = Math.max(
      44,
      view.scrollDOM.clientWidth -
        visibleLeft -
        INLINE_DIAGNOSTIC_VIEWPORT_PADDING,
    );

    markers.push(
      new DiagnosticsOverlayMarker(
        snapshot,
        left,
        top,
        maxWidth,
        line.number === activeLine.number,
        lineNumber,
      ),
    );
  }

  return markers;
};

const inlineDiagnosticsLayer = layer({
  above: true,
  class: "cm-diagnostic-overlay-layer",
  update(update): boolean {
    return (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.startState.field(inlineDiagnosticsMessagesVisibleField) !==
        update.state.field(inlineDiagnosticsMessagesVisibleField) ||
      update.startState.field(inlineDiagnosticsField) !==
        update.state.field(inlineDiagnosticsField)
    );
  },
  markers: buildInlineDiagnosticMarkers,
});

export const diagnosticsTheme = EditorView.theme({
  ".cm-diagnostic-range": {
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
  },
  ".cm-diagnostic-range-error": {
    textDecorationColor: "#f87171",
  },
  ".cm-diagnostic-range-warning": {
    textDecorationColor: "#fbbf24",
  },
  ".cm-diagnostic-range-info": {
    textDecorationColor: "#60a5fa",
  },
  ".cm-diagnostic-overlay-layer": {
    pointerEvents: "none",
    zIndex: "4",
  },
  ".cm-diagnostic-overlay": {
    display: "inline-flex",
    alignItems: "flex-start",
    gap: "8px",
    minWidth: "22px",
    minHeight: `${INLINE_DIAGNOSTIC_MARKER_HEIGHT}px`,
    padding: "0 10px",
    borderRadius: "999px",
    fontSize: "18px",
    letterSpacing: "0",
    lineHeight: "21px",
    whiteSpace: "normal",
    overflow: "visible",
    textOverflow: "clip",
    pointerEvents: "auto",
    userSelect: "none",
    border: "1px solid transparent",
    boxSizing: "border-box",
    opacity: "0.92",
    transform: "translateY(1px)",
  },
  ".cm-diagnostic-overlay:hover, .cm-diagnostic-overlay[data-diagnostic-expanded='true']":
    {
      width: "var(--cm-diagnostic-overlay-readable-width)",
      borderRadius: "14px",
    },
  ".cm-diagnostic-overlay-dot": {
    width: "8px",
    height: "8px",
    flex: "0 0 auto",
    borderRadius: "999px",
    marginTop: "8px",
  },
  ".cm-diagnostic-overlay-count": {
    display: "none",
    minWidth: "18px",
    fontSize: "16px",
    fontWeight: "700",
    textAlign: "center",
    lineHeight: "21px",
  },
  ".cm-diagnostic-overlay-count:not(:empty)": {
    display: "inline-block",
  },
  ".cm-diagnostic-overlay-text": {
    display: "none",
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "visible",
    overflowWrap: "break-word",
    textOverflow: "clip",
    wordBreak: "normal",
  },
  ".cm-diagnostic-overlay:hover .cm-diagnostic-overlay-text, .cm-diagnostic-overlay[data-diagnostic-expanded='true'] .cm-diagnostic-overlay-text":
    {
      display: "inline-block",
    },
  ".cm-diagnostic-overlay-error": {
    color: "#fecaca",
    backgroundColor: "rgba(127, 29, 29, 0.86)",
    borderColor: "rgba(248, 113, 113, 0.48)",
  },
  ".cm-diagnostic-overlay-warning": {
    color: "#fde68a",
    backgroundColor: "rgba(120, 53, 15, 0.82)",
    borderColor: "rgba(251, 191, 36, 0.44)",
  },
  ".cm-diagnostic-overlay-info": {
    color: "#bfdbfe",
    backgroundColor: "rgba(30, 58, 138, 0.78)",
    borderColor: "rgba(96, 165, 250, 0.38)",
  },
  ".cm-diagnostic-overlay-error .cm-diagnostic-overlay-dot": {
    backgroundColor: "#f87171",
  },
  ".cm-diagnostic-overlay-warning .cm-diagnostic-overlay-dot": {
    backgroundColor: "#fbbf24",
  },
  ".cm-diagnostic-overlay-info .cm-diagnostic-overlay-dot": {
    backgroundColor: "#60a5fa",
  },
});

const mergeEffects = (
  effects: StateEffect<unknown> | readonly StateEffect<unknown>[] | undefined,
  inlineSnapshot: readonly InlineDiagnosticsLine[],
  showInlineMessages: boolean,
) => {
  const normalized = Array.isArray(effects)
    ? [...effects]
    : effects
      ? [effects]
      : [];
  normalized.push(setInlineDiagnosticsEffect.of(inlineSnapshot));
  normalized.push(
    setInlineDiagnosticsMessagesVisibleEffect.of(showInlineMessages),
  );
  return normalized;
};

const selectProblemsForFile =
  (filePath: string) =>
  (state: { byFile: Map<string, { items: DiagnosticsProblem[] }> }) =>
    state.byFile.get(filePath)?.items ?? EMPTY_PROBLEMS;

class DiagnosticsBridge {
  private readonly unsubscribe: () => void;
  private readonly filePath: string;
  private readonly language: string;
  private readonly showInlineMessages: boolean;
  private pendingProblems: readonly DiagnosticsProblem[] = EMPTY_PROBLEMS;
  private pendingSignature = "";
  private appliedSignature = "";
  private scheduled = false;
  private destroyed = false;
  private awaitingInitialPull = false;

  constructor(
    private readonly view: EditorView,
    options: DiagnosticsExtensionOptions,
  ) {
    this.filePath = options.filePath;
    this.language = options.language;
    this.showInlineMessages = options.showInlineMessages;
    const hasCachedDiagnostics = useDiagnosticsStore
      .getState()
      .byFile.has(this.filePath);
    this.awaitingInitialPull = !hasCachedDiagnostics;

    if (this.awaitingInitialPull) {
      const preservedProblems = lastVisibleProblemsByView.get(this.view);
      if (preservedProblems && preservedProblems.length > 0) {
        this.pendingProblems = preservedProblems;
        this.pendingSignature = `preserved:${getProblemsSignature(preservedProblems)}`;
        this.scheduleApply();
      }
    }

    this.unsubscribe = useDiagnosticsStore.subscribe(
      selectProblemsForFile(this.filePath),
      (problems) => {
        this.pendingProblems = problems;
        this.pendingSignature = this.getCurrentSignature(problems);
        this.scheduleApply();
      },
      { fireImmediately: !this.awaitingInitialPull },
    );

    if (this.awaitingInitialPull) {
      void this.pullInitialDiagnostics();
    }
  }

  update(_update: ViewUpdate): void {}

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
  }

  private scheduleApply(): void {
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.destroyed) {
        return;
      }

      if (this.pendingSignature === this.appliedSignature) {
        return;
      }

      const problems = this.pendingProblems;

      const diagnostics = this.showInlineMessages
        ? buildCodeMirrorDiagnostics(this.view.state.doc, problems)
        : [];
      const inlineSnapshot = buildInlineDiagnosticsSnapshot(
        this.view.state.doc,
        problems,
      );
      const transaction = setDiagnostics(this.view.state, diagnostics);
      this.appliedSignature = this.pendingSignature;
      if (problems.length > 0) {
        lastVisibleProblemsByView.set(this.view, problems);
      } else {
        lastVisibleProblemsByView.delete(this.view);
      }
      this.view.dispatch({
        ...transaction,
        effects: mergeEffects(
          transaction.effects,
          inlineSnapshot,
          this.showInlineMessages,
        ),
      });
    });
  }

  private async pullInitialDiagnostics(): Promise<void> {
    try {
      const diagnostics = (await LSPGetDiagnostics(
        this.filePath,
      )) as DiagnosticsEventItem[];
      if (this.destroyed) {
        return;
      }

      if (diagnostics.length > 0) {
        useDiagnosticsStore
          .getState()
          .setFileDiagnostics(this.filePath, this.language, diagnostics);
      }
    } catch (error) {
      console.debug("[diagnostics] initial pull failed", error);
    } finally {
      this.awaitingInitialPull = false;
      if (this.destroyed) {
        return;
      }

      if (!useDiagnosticsStore.getState().byFile.has(this.filePath)) {
        this.pendingProblems = EMPTY_PROBLEMS;
        this.pendingSignature = this.getCurrentSignature(EMPTY_PROBLEMS);
        this.scheduleApply();
      }
    }
  }

  private getCurrentSignature(problems: readonly DiagnosticsProblem[]): string {
    return `${this.showInlineMessages ? "messages:on" : "messages:off"}:${getProblemsSignature(problems)}`;
  }
}

export const createDiagnosticsExtension = (
  options: DiagnosticsExtensionOptions,
): Extension[] => [
  diagnosticsTheme,
  inlineDiagnosticsField,
  inlineDiagnosticsMessagesVisibleField,
  inlineDiagnosticsLayer,
  ViewPlugin.fromClass(
    class extends DiagnosticsBridge {
      constructor(view: EditorView) {
        super(view, options);
      }
    },
  ),
];
