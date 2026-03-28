import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  setDiagnostics,
  type Diagnostic as CodeMirrorDiagnostic,
} from "@codemirror/lint";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { LSPGetDiagnostics } from "../../wailsjs/go/main/App";
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
  line: number;
  severity: InlineDiagnosticSeverity;
  message: string;
  count: number;
}

interface DiagnosticsExtensionOptions {
  filePath: string;
  language: string;
  enabled: boolean;
}

const EMPTY_PROBLEMS: readonly DiagnosticsProblem[] = Object.freeze([]);
const EMPTY_INLINE_SNAPSHOT: readonly InlineDiagnosticsLine[] = Object.freeze(
  [],
);
const lastVisibleProblemsByView = new WeakMap<
  EditorView,
  readonly DiagnosticsProblem[]
>();

const severityPriority: Record<CodeMirrorDiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

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

const buildMessageText = (snapshot: InlineDiagnosticsLine): string => {
  if (snapshot.count <= 1) {
    return snapshot.message;
  }
  return `${snapshot.message} (+${snapshot.count - 1} more)`;
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
  problems: readonly DiagnosticsProblem[],
): InlineDiagnosticsLine[] => {
  const grouped = new Map<number, InlineDiagnosticsLine>();

  for (const problem of problems) {
    const severity = toInlineSeverity(mapSeverity(problem.severity));
    const line = problem.range.start.line + 1;
    const existing = grouped.get(line);

    if (!existing) {
      grouped.set(line, {
        line,
        severity,
        message: problem.message,
        count: 1,
      });
      continue;
    }

    existing.count += 1;
    if (
      inlineSeverityPriority[severity] <
      inlineSeverityPriority[existing.severity]
    ) {
      existing.severity = severity;
      existing.message = problem.message;
    }
  }

  return Array.from(grouped.values()).sort(
    (left, right) => left.line - right.line,
  );
};

class DiagnosticsMessageWidget extends WidgetType {
  constructor(private readonly snapshot: InlineDiagnosticsLine) {
    super();
  }

  eq(other: DiagnosticsMessageWidget): boolean {
    return (
      this.snapshot.line === other.snapshot.line &&
      this.snapshot.severity === other.snapshot.severity &&
      this.snapshot.message === other.snapshot.message &&
      this.snapshot.count === other.snapshot.count
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = `cm-diagnostic-message cm-diagnostic-message-${this.snapshot.severity}`;
    dom.textContent = buildMessageText(this.snapshot);
    dom.title = dom.textContent;
    return dom;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const setInlineDiagnosticsEffect =
  StateEffect.define<readonly InlineDiagnosticsLine[]>();

const inlineDiagnosticsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    const mapped = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setInlineDiagnosticsEffect)) {
        if (effect.value.length === 0) {
          return Decoration.none;
        }

        const builder = new RangeSetBuilder<Decoration>();
        for (const snapshot of effect.value) {
          const line = getLine(transaction.state.doc, snapshot.line);
          builder.add(
            line.from,
            line.from,
            Decoration.line({
              class: `cm-diagnostic-line cm-diagnostic-line-${snapshot.severity}`,
            }),
          );
          builder.add(
            line.to,
            line.to,
            Decoration.widget({
              widget: new DiagnosticsMessageWidget(snapshot),
              side: 1,
            }),
          );
        }

        return builder.finish();
      }
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const diagnosticsTheme = EditorView.theme({
  ".cm-diagnostic-line-error": {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
  ".cm-diagnostic-line-warning": {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
  },
  ".cm-diagnostic-line-info": {
    backgroundColor: "rgba(59, 130, 246, 0.06)",
  },
  ".cm-diagnostic-message": {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: "12px",
    padding: "0 10px",
    minHeight: "22px",
    borderRadius: "999px",
    fontSize: "11px",
    letterSpacing: "0.02em",
    border: "1px solid transparent",
    whiteSpace: "nowrap",
    opacity: "0.92",
  },
  ".cm-diagnostic-message-error": {
    color: "#fecaca",
    backgroundColor: "rgba(127, 29, 29, 0.45)",
    borderColor: "rgba(248, 113, 113, 0.28)",
  },
  ".cm-diagnostic-message-warning": {
    color: "#fde68a",
    backgroundColor: "rgba(120, 53, 15, 0.4)",
    borderColor: "rgba(251, 191, 36, 0.24)",
  },
  ".cm-diagnostic-message-info": {
    color: "#bfdbfe",
    backgroundColor: "rgba(30, 58, 138, 0.35)",
    borderColor: "rgba(96, 165, 250, 0.2)",
  },
});

const mergeEffects = (
  effects: StateEffect<unknown> | readonly StateEffect<unknown>[] | undefined,
  inlineSnapshot: readonly InlineDiagnosticsLine[],
) => {
  const normalized = Array.isArray(effects)
    ? [...effects]
    : effects
      ? [effects]
      : [];
  normalized.push(setInlineDiagnosticsEffect.of(inlineSnapshot));
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
  private readonly enabled: boolean;
  private pendingProblems: readonly DiagnosticsProblem[] = EMPTY_PROBLEMS;
  private pendingSignature = "";
  private appliedSignature = "";
  private scheduled = false;
  private forceApply = false;
  private destroyed = false;
  private awaitingInitialPull = false;

  constructor(
    private readonly view: EditorView,
    options: DiagnosticsExtensionOptions,
  ) {
    this.filePath = options.filePath;
    this.language = options.language;
    this.enabled = options.enabled;
    const hasCachedDiagnostics = useDiagnosticsStore
      .getState()
      .byFile.has(this.filePath);
    this.awaitingInitialPull = this.enabled && !hasCachedDiagnostics;

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

  update(update: ViewUpdate): void {
    if (!update.docChanged) {
      return;
    }
    this.forceApply = true;
    this.scheduleApply();
  }

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

      const shouldForce = this.forceApply;
      this.forceApply = false;
      if (!shouldForce && this.pendingSignature === this.appliedSignature) {
        return;
      }

      const problems = this.enabled ? this.pendingProblems : EMPTY_PROBLEMS;

      const diagnostics = buildCodeMirrorDiagnostics(
        this.view.state.doc,
        problems,
      );
      const inlineSnapshot = this.enabled
        ? buildInlineDiagnosticsSnapshot(problems)
        : EMPTY_INLINE_SNAPSHOT;
      const transaction = setDiagnostics(this.view.state, diagnostics);
      this.appliedSignature = this.pendingSignature;
      if (problems.length > 0) {
        lastVisibleProblemsByView.set(this.view, problems);
      } else {
        lastVisibleProblemsByView.delete(this.view);
      }
      this.view.dispatch({
        ...transaction,
        effects: mergeEffects(transaction.effects, inlineSnapshot),
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
    return this.enabled ? getProblemsSignature(problems) : "disabled";
  }
}

export const createDiagnosticsExtension = (
  options: DiagnosticsExtensionOptions,
): Extension[] => [
  diagnosticsTheme,
  inlineDiagnosticsField,
  ViewPlugin.fromClass(
    class extends DiagnosticsBridge {
      constructor(view: EditorView) {
        super(view, options);
      }
    },
  ),
];
