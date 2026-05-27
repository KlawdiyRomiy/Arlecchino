import { type Extension } from "@codemirror/state";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
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
  sliceString(from: number, to?: number): string;
};

interface DiagnosticsExtensionOptions {
  filePath: string;
  language: string;
}

const EMPTY_PROBLEMS: readonly DiagnosticsProblem[] = Object.freeze([]);
const TRANSIENT_EMPTY_DIAGNOSTICS_GRACE_MS = 850;
const RECENT_EDIT_EMPTY_DIAGNOSTICS_GRACE_MS = 180;
const RECENT_EDIT_WINDOW_MS = 1200;

const lastVisibleProblemsByView = new WeakMap<
  EditorView,
  readonly DiagnosticsProblem[]
>();

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

const mapSeverity = (severity: number): Diagnostic["severity"] => {
  if (severity === 1) {
    return "error";
  }
  if (severity === 2) {
    return "warning";
  }
  return "info";
};

const hasVisibleText = (doc: CodeMirrorDocLike, from: number, to: number) =>
  doc.sliceString(from, to).replace(/[\r\n]/g, "").length > 0;

const findNearestVisibleRange = (
  doc: CodeMirrorDocLike,
  anchor: number,
  preferredLineNumber: number,
): { from: number; to: number } | null => {
  if (doc.length <= 0) {
    return null;
  }

  const tryLine = (lineNumber: number): { from: number; to: number } | null => {
    if (lineNumber < 1 || lineNumber > doc.lines) {
      return null;
    }

    const line = doc.line(lineNumber);
    if (line.from >= line.to) {
      return null;
    }

    const from = clamp(anchor, line.from, line.to - 1);
    const to = Math.min(from + 1, line.to);
    return hasVisibleText(doc, from, to) ? { from, to } : null;
  };

  const currentLineRange = tryLine(preferredLineNumber);
  if (currentLineRange) {
    return currentLineRange;
  }

  for (let offset = 1; offset < doc.lines; offset += 1) {
    const nextLineRange = tryLine(preferredLineNumber + offset);
    if (nextLineRange) {
      return nextLineRange;
    }

    const previousLineRange = tryLine(preferredLineNumber - offset);
    if (previousLineRange) {
      return previousLineRange;
    }
  }

  return null;
};

const normalizeDiagnosticRange = (
  doc: CodeMirrorDocLike,
  problem: DiagnosticsProblem,
): { from: number; to: number } | null => {
  const from = getOffset(doc, problem.range.start);
  const to = clamp(getOffset(doc, problem.range.end), from, doc.length);

  if (to > from && hasVisibleText(doc, from, to)) {
    return { from, to };
  }

  return findNearestVisibleRange(doc, from, problem.range.start.line + 1);
};

const buildCodeMirrorDiagnostics = (
  doc: CodeMirrorDocLike,
  problems: readonly DiagnosticsProblem[],
): Diagnostic[] =>
  problems
    .map((problem): Diagnostic | null => {
      const range = normalizeDiagnosticRange(doc, problem);
      if (!range) {
        return null;
      }

      const sourceParts = [problem.source, problem.code].filter(Boolean);
      return {
        from: range.from,
        to: range.to,
        severity: mapSeverity(problem.severity),
        source: sourceParts.join(" "),
        message: problem.message,
      };
    })
    .filter((diagnostic): diagnostic is Diagnostic => diagnostic !== null);

const getProblemSignature = (problem: DiagnosticsProblem): string =>
  [
    problem.filePath,
    problem.language,
    problem.range.start.line,
    problem.range.start.character,
    problem.range.end.line,
    problem.range.end.character,
    problem.severity,
    problem.source,
    problem.code,
    problem.message,
  ].join("\u0001");

const getProblemsSignature = (
  problems: readonly DiagnosticsProblem[],
): string =>
  problems.length === 0
    ? "empty"
    : problems.map(getProblemSignature).join("\u0000");

const selectProblemsForFile =
  (filePath: string) =>
  (state: { byFile: Map<string, { items: DiagnosticsProblem[] }> }) =>
    state.byFile.get(filePath)?.items ?? EMPTY_PROBLEMS;

class DiagnosticsBridge {
  private readonly unsubscribe: () => void;
  private readonly filePath: string;
  private readonly language: string;
  private pendingProblems: readonly DiagnosticsProblem[] = EMPTY_PROBLEMS;
  private pendingSignature = "empty";
  private appliedSignature = "";
  private scheduled = false;
  private destroyed = false;
  private awaitingInitialPull = false;
  private emptyClearTimer: number | null = null;
  private hasVisibleDiagnostics = false;
  private lastDocChangedAt = 0;

  constructor(
    private readonly view: EditorView,
    options: DiagnosticsExtensionOptions,
  ) {
    this.filePath = options.filePath;
    this.language = options.language;
    const cachedProblems = useDiagnosticsStore
      .getState()
      .byFile.get(this.filePath)?.items;
    const hasCachedDiagnostics = cachedProblems !== undefined;
    this.awaitingInitialPull = !hasCachedDiagnostics;

    if (cachedProblems && cachedProblems.length > 0) {
      this.acceptProblems(cachedProblems);
    }

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
        this.acceptProblems(problems);
      },
      { fireImmediately: !this.awaitingInitialPull },
    );

    if (this.awaitingInitialPull) {
      void this.pullInitialDiagnostics();
    }
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.lastDocChangedAt = Date.now();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.clearEmptyTimer();
  }

  private acceptProblems(problems: readonly DiagnosticsProblem[]): void {
    this.pendingProblems = problems;
    this.pendingSignature = this.getCurrentSignature(problems);

    if (problems.length > 0) {
      this.clearEmptyTimer();
      this.scheduleApply();
      return;
    }

    if (!this.hasVisibleDiagnostics) {
      this.clearEmptyTimer();
      this.scheduleApply();
      return;
    }

    this.scheduleEmptyClear();
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
      const diagnostics = buildCodeMirrorDiagnostics(
        this.view.state.doc,
        problems,
      );
      this.appliedSignature = this.pendingSignature;
      this.hasVisibleDiagnostics = diagnostics.length > 0;

      if (problems.length > 0) {
        lastVisibleProblemsByView.set(this.view, problems);
      } else {
        lastVisibleProblemsByView.delete(this.view);
      }

      this.view.dispatch(setDiagnostics(this.view.state, diagnostics));
    });
  }

  private scheduleEmptyClear(): void {
    this.clearEmptyTimer();
    const recentlyEdited =
      Date.now() - this.lastDocChangedAt <= RECENT_EDIT_WINDOW_MS;
    const delay = recentlyEdited
      ? RECENT_EDIT_EMPTY_DIAGNOSTICS_GRACE_MS
      : TRANSIENT_EMPTY_DIAGNOSTICS_GRACE_MS;

    this.emptyClearTimer = window.setTimeout(() => {
      this.emptyClearTimer = null;
      if (this.destroyed || this.pendingProblems.length > 0) {
        return;
      }
      this.scheduleApply();
    }, delay);
  }

  private clearEmptyTimer(): void {
    if (this.emptyClearTimer === null) {
      return;
    }
    window.clearTimeout(this.emptyClearTimer);
    this.emptyClearTimer = null;
  }

  private async pullInitialDiagnostics(): Promise<void> {
    try {
      const diagnostics = (await LSPGetDiagnostics(this.filePath)) as unknown;
      if (this.destroyed) {
        return;
      }

      if (Array.isArray(diagnostics) && diagnostics.length > 0) {
        useDiagnosticsStore
          .getState()
          .setFileDiagnostics(
            this.filePath,
            this.language,
            diagnostics as DiagnosticsEventItem[],
          );
      }
    } catch (error) {
      console.debug("[diagnostics] initial pull failed", error);
    } finally {
      this.awaitingInitialPull = false;
      if (this.destroyed) {
        return;
      }

      if (!useDiagnosticsStore.getState().byFile.has(this.filePath)) {
        this.acceptProblems(EMPTY_PROBLEMS);
      }
    }
  }

  private getCurrentSignature(problems: readonly DiagnosticsProblem[]): string {
    return getProblemsSignature(problems);
  }
}

export const diagnosticsTheme = EditorView.theme({
  ".cm-lintRange, .cm-lintRange-error, .cm-lintRange-warning, .cm-lintRange-info, .cm-lintRange-hint":
    {
      textDecorationLine: "underline",
      textDecorationStyle: "wavy",
      textDecorationThickness: "1.5px",
      textUnderlineOffset: "3px",
      backgroundImage: "none",
    },
  ".cm-lintRange-error, .cm-lintRange-hint": {
    textDecorationColor: "#f87171",
  },
  ".cm-lintRange-warning": {
    textDecorationColor: "#fbbf24",
  },
  ".cm-lintRange-info": {
    textDecorationColor: "#60a5fa",
  },
  ".cm-lintRange-active": {
    backgroundColor: "rgba(248, 113, 113, 0.12)",
  },
  ".cm-tooltip-lint": {
    padding: "0",
    margin: "0",
    maxWidth: "min(520px, calc(100vw - 32px))",
    border: "1px solid var(--editor-border-strong)",
    borderRadius: "8px",
    backgroundColor: "var(--editor-tooltip-bg)",
    color: "var(--editor-text)",
    boxShadow: "var(--editor-tooltip-shadow)",
    fontFamily:
      'var(--editor-font-family, "Arlecchino Fira Code", "JetBrains Mono", "SF Mono", "Fira Code", monospace)',
    overflow: "hidden",
  },
  ".cm-tooltip-lint .cm-diagnostic": {
    padding: "12px 14px 12px 16px",
    margin: "0",
    whiteSpace: "pre-wrap",
    borderLeftWidth: "3px",
    borderLeftStyle: "solid",
    backgroundColor: "transparent",
  },
  ".cm-tooltip-lint .cm-diagnostic-error": {
    borderLeftColor: "#f87171",
  },
  ".cm-tooltip-lint .cm-diagnostic-warning": {
    borderLeftColor: "#fbbf24",
  },
  ".cm-tooltip-lint .cm-diagnostic-info": {
    borderLeftColor: "#60a5fa",
  },
  ".cm-tooltip-lint .cm-diagnosticText": {
    fontSize: "18px",
    lineHeight: "27px",
  },
  ".cm-tooltip-lint .cm-diagnosticSource": {
    marginTop: "6px",
    fontSize: "16px",
    lineHeight: "22px",
    color: "var(--editor-text-soft)",
    opacity: "1",
  },
});

export const createDiagnosticsExtension = (
  options: DiagnosticsExtensionOptions,
): Extension[] => [
  diagnosticsTheme,
  linter(null, { delay: 0 }),
  ViewPlugin.fromClass(
    class extends DiagnosticsBridge {
      constructor(view: EditorView) {
        super(view, options);
      }
    },
  ),
];
