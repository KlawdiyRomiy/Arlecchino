import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type ChangeDesc,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  ViewPlugin,
  showTooltip,
  type DecorationSet,
  type Rect,
  type Tooltip,
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
  sliceString(from: number, to?: number): string;
};

type InlineDiagnosticSeverity = "error" | "warning" | "info";

interface InlineDiagnosticFragment {
  from: number;
  to: number;
}

export interface InlineDiagnosticsLine {
  from: number;
  to: number;
  point: boolean;
  fragments: readonly InlineDiagnosticFragment[];
  severity: InlineDiagnosticSeverity;
  message: string;
  source: string;
  code: string;
  line: number;
  column: number;
  count: number;
}

interface DiagnosticsExtensionOptions {
  filePath: string;
  language: string;
  maxInlineDiagnostics?: number;
}

type DiagnosticPointer = {
  clientX: number;
  clientY: number;
  buttons: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  composedPath?: () => EventTarget[];
};

const EMPTY_PROBLEMS: readonly DiagnosticsProblem[] = Object.freeze([]);
const EMPTY_INLINE_SNAPSHOT: readonly InlineDiagnosticsLine[] = Object.freeze(
  [],
);
const DIAGNOSTIC_RANGE_SELECTOR = ".cm-diagnostic-range";
const DIAGNOSTIC_RANGE_HIT_PADDING_PX = 5;
const DIAGNOSTIC_LOGICAL_HIT_HORIZONTAL_PADDING_PX = 8;
const DIAGNOSTIC_LOGICAL_HIT_VERTICAL_PADDING_PX = 14;
const lastVisibleProblemsByView = new WeakMap<
  EditorView,
  readonly DiagnosticsProblem[]
>();
const DEFAULT_MAX_INLINE_DIAGNOSTICS = 0;
export const LARGE_DOCUMENT_INLINE_DIAGNOSTIC_LIMIT = 600;

const inlineSeverityPriority: Record<InlineDiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const mapSeverity = (severity: number): InlineDiagnosticSeverity => {
  if (severity === 1) {
    return "error";
  }
  if (severity === 2) {
    return "warning";
  }
  return "info";
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

const readRootNumber = (propertyName: string, fallback: number): number => {
  const parsed = Number.parseFloat(
    getComputedStyle(document.documentElement)
      .getPropertyValue(propertyName)
      .trim(),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const applyDiagnosticTooltipMetrics = (dom: HTMLElement): void => {
  const uiScale = clamp(readRootNumber("--ui-scale", 1), 0.7, 2);
  const uiFontSize = clamp(readRootNumber("--ui-font-size", 14), 10, 28);
  const minWidth = 430 * uiScale;
  const maxWidth = 760 * uiScale;
  const paddingY = 20 * uiScale;
  const paddingX = 22 * uiScale;
  const radius = 28 * uiScale;
  const fontSize = uiFontSize * uiScale;
  const iconSize = 48 * uiScale;

  dom.style.minWidth = `min(${minWidth}px, calc(100vw - 40px))`;
  dom.style.maxWidth = `min(${maxWidth}px, calc(100vw - 40px))`;
  dom.style.padding = `${paddingY}px ${paddingX}px`;
  dom.style.borderRadius = `${radius}px`;
  dom.style.fontSize = `${fontSize}px`;
  dom.style.setProperty("--diagnostic-tooltip-min-width", `${minWidth}px`);
  dom.style.setProperty("--diagnostic-tooltip-max-width", `${maxWidth}px`);
  dom.style.setProperty("--diagnostic-tooltip-padding-y", `${paddingY}px`);
  dom.style.setProperty("--diagnostic-tooltip-padding-x", `${paddingX}px`);
  dom.style.setProperty("--diagnostic-tooltip-radius", `${radius}px`);
  dom.style.setProperty("--diagnostic-tooltip-blur", `${12 * uiScale}px`);
  dom.style.setProperty("--diagnostic-tooltip-font-size", `${fontSize}px`);
  dom.style.setProperty("--diagnostic-tooltip-icon-size", `${iconSize}px`);
  dom.style.setProperty("--diagnostic-tooltip-icon-radius", "999px");
  dom.style.setProperty(
    "--diagnostic-tooltip-title-size",
    `${uiFontSize * uiScale * 1.04}px`,
  );
  dom.style.setProperty(
    "--diagnostic-tooltip-message-size",
    `${uiFontSize * uiScale * 1.08}px`,
  );
  dom.style.setProperty(
    "--diagnostic-tooltip-chip-size",
    `${uiFontSize * uiScale * 0.88}px`,
  );
  dom.style.setProperty("--diagnostic-tooltip-gap", `${15 * uiScale}px`);
  dom.style.setProperty("--diagnostic-tooltip-chip-gap", `${8 * uiScale}px`);
  dom.style.setProperty("--diagnostic-tooltip-chip-y", `${6 * uiScale}px`);
  dom.style.setProperty("--diagnostic-tooltip-chip-x", `${14 * uiScale}px`);
  dom.style.setProperty(
    "--diagnostic-tooltip-chip-height",
    `${32 * uiScale}px`,
  );
  dom.style.setProperty(
    "--diagnostic-tooltip-meta-padding",
    `${6 * uiScale}px`,
  );
};

const getLine = (doc: CodeMirrorDocLike, lineNumber: number) => {
  const safeLine = clamp(lineNumber, 1, Math.max(doc.lines, 1));
  return doc.line(safeLine);
};

const getLineAtOffset = (
  doc: CodeMirrorDocLike,
  offset: number,
): { number: number; from: number; to: number; text: string } => {
  const target = clamp(offset, 0, doc.length);
  let low = 1;
  let high = Math.max(doc.lines, 1);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = getLine(doc, mid);
    if (target < line.from) {
      high = mid - 1;
      continue;
    }
    if (target > line.to && mid < doc.lines) {
      low = mid + 1;
      continue;
    }
    return { number: mid, ...line };
  }

  const fallbackNumber = clamp(low, 1, Math.max(doc.lines, 1));
  return { number: fallbackNumber, ...getLine(doc, fallbackNumber) };
};

const getOffset = (
  doc: CodeMirrorDocLike,
  position: DiagnosticsProblem["range"]["start"],
): number => {
  const line = getLine(doc, position.line + 1);
  const column = clamp(position.character, 0, line.text.length);
  return clamp(line.from + column, line.from, line.to);
};

const hasVisibleText = (doc: CodeMirrorDocLike, from: number, to: number) =>
  doc.sliceString(from, to).replace(/[\s\r\n]/g, "").length > 0;

const isVisibleDiagnosticChar = (char: string | undefined): boolean =>
  char !== undefined && !/\s/.test(char);

const findVisibleSegmentOnLine = (
  line: { from: number; to: number; text: string },
  anchor: number,
): { from: number; to: number } | null => {
  if (line.from >= line.to || line.text.length === 0) {
    return null;
  }

  const maxIndex = line.text.length - 1;
  let index = clamp(anchor - line.from, 0, maxIndex);

  if (!isVisibleDiagnosticChar(line.text[index])) {
    let found = -1;
    for (let offset = 1; offset <= line.text.length; offset += 1) {
      const next = index + offset;
      if (next <= maxIndex && isVisibleDiagnosticChar(line.text[next])) {
        found = next;
        break;
      }
      const previous = index - offset;
      if (previous >= 0 && isVisibleDiagnosticChar(line.text[previous])) {
        found = previous;
        break;
      }
    }
    if (found === -1) {
      return null;
    }
    index = found;
  }

  let start = index;
  while (start > 0 && isVisibleDiagnosticChar(line.text[start - 1])) {
    start -= 1;
  }

  let end = index + 1;
  while (end < line.text.length && isVisibleDiagnosticChar(line.text[end])) {
    end += 1;
  }

  return {
    from: line.from + start,
    to: line.from + end,
  };
};

const buildVisibleFragments = (
  doc: CodeMirrorDocLike,
  from: number,
  to: number,
): InlineDiagnosticFragment[] => {
  if (to <= from) {
    return [];
  }

  const fragments: InlineDiagnosticFragment[] = [];
  let line = getLineAtOffset(doc, from);

  while (line.from < to) {
    const fragmentFrom = Math.max(from, line.from);
    const fragmentTo = Math.min(to, line.to);
    if (fragmentTo > fragmentFrom) {
      const text = doc.sliceString(fragmentFrom, fragmentTo);
      let runStart: number | null = null;
      for (let index = 0; index < text.length; index += 1) {
        if (isVisibleDiagnosticChar(text[index])) {
          runStart ??= fragmentFrom + index;
          continue;
        }
        if (runStart !== null) {
          fragments.push({ from: runStart, to: fragmentFrom + index });
          runStart = null;
        }
      }
      if (runStart !== null) {
        fragments.push({ from: runStart, to: fragmentTo });
      }
    }

    if (line.number >= doc.lines || line.to >= to) {
      break;
    }
    line = { number: line.number + 1, ...getLine(doc, line.number + 1) };
  }

  return fragments;
};

const normalizeDiagnosticRange = (
  doc: CodeMirrorDocLike,
  problem: DiagnosticsProblem,
): {
  from: number;
  to: number;
  point: boolean;
  fragments: readonly InlineDiagnosticFragment[];
} | null => {
  const from = getOffset(doc, problem.range.start);
  const to = clamp(getOffset(doc, problem.range.end), from, doc.length);

  if (to > from && hasVisibleText(doc, from, to)) {
    const fragments = buildVisibleFragments(doc, from, to);
    if (fragments.length > 0) {
      return {
        from,
        to,
        point: false,
        fragments,
      };
    }
  }

  const line = getLine(doc, problem.range.start.line + 1);
  if (to <= from) {
    return {
      from: clamp(from, line.from, line.to),
      to: clamp(from, line.from, line.to),
      point: true,
      fragments: [],
    };
  }

  const sameLineRange = findVisibleSegmentOnLine(line, from);
  if (sameLineRange) {
    return {
      from: sameLineRange.from,
      to: sameLineRange.to,
      point: false,
      fragments: [sameLineRange],
    };
  }

  return {
    from: clamp(from, line.from, line.to),
    to: clamp(from, line.from, line.to),
    point: true,
    fragments: [],
  };
};

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

export const buildInlineDiagnosticsSnapshot = (
  doc: CodeMirrorDocLike,
  problems: readonly DiagnosticsProblem[],
): InlineDiagnosticsLine[] =>
  problems
    .map((problem): InlineDiagnosticsLine | null => {
      const range = normalizeDiagnosticRange(doc, problem);
      if (!range) {
        return null;
      }
      return {
        from: range.from,
        to: range.to,
        point: range.point,
        fragments: range.fragments,
        severity: mapSeverity(problem.severity),
        message: problem.message,
        source: problem.source,
        code: problem.code,
        line: problem.line,
        column: problem.column,
        count: 1,
      } satisfies InlineDiagnosticsLine;
    })
    .filter((snapshot): snapshot is InlineDiagnosticsLine => snapshot !== null)
    .sort((left, right) => left.from - right.from);

const setInlineDiagnosticsEffect =
  StateEffect.define<readonly InlineDiagnosticsLine[]>();
const setDiagnosticTooltipEffect = StateEffect.define<Tooltip | null>();

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
      fragments: snapshot.fragments.map((fragment) => {
        const fragmentFrom = changes.mapPos(fragment.from, -1);
        return {
          from: fragmentFrom,
          to: Math.max(fragmentFrom, changes.mapPos(fragment.to, 1)),
        };
      }),
    };
  });

class DiagnosticPointWidget extends WidgetType {
  constructor(private readonly snapshot: InlineDiagnosticsLine) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof DiagnosticPointWidget)) {
      return false;
    }

    return (
      other.snapshot.from === this.snapshot.from &&
      other.snapshot.to === this.snapshot.to &&
      other.snapshot.severity === this.snapshot.severity &&
      other.snapshot.message === this.snapshot.message
    );
  }

  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = `cm-diagnostic-range cm-diagnostic-range-${this.snapshot.severity} cm-diagnostic-point cm-diagnostic-point-${this.snapshot.severity}`;
    marker.setAttribute("data-diagnostic-range", "true");
    marker.setAttribute("data-diagnostic-from", String(this.snapshot.from));
    marker.setAttribute("data-diagnostic-to", String(this.snapshot.to));
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
}

const buildInlineDiagnosticMarks = (
  diagnostics: readonly InlineDiagnosticsLine[],
): DecorationSet => {
  if (diagnostics.length === 0) {
    return Decoration.none;
  }

  const entries: Array<{ from: number; to: number; decoration: Decoration }> =
    [];
  for (const snapshot of diagnostics) {
    if (snapshot.point || snapshot.to <= snapshot.from) {
      entries.push({
        from: snapshot.from,
        to: snapshot.from,
        decoration: Decoration.widget({
          widget: new DiagnosticPointWidget(snapshot),
          side: 1,
        }),
      });
      continue;
    }
    for (const fragment of snapshot.fragments) {
      if (fragment.to <= fragment.from) {
        continue;
      }
      entries.push({
        from: fragment.from,
        to: fragment.to,
        decoration: Decoration.mark({
          class: `cm-diagnostic-range cm-diagnostic-range-${snapshot.severity}`,
          attributes: {
            "data-diagnostic-range": "true",
            "data-diagnostic-from": String(snapshot.from),
            "data-diagnostic-to": String(snapshot.to),
            "data-diagnostic-fragment-from": String(fragment.from),
            "data-diagnostic-fragment-to": String(fragment.to),
          },
        }),
      });
    }
  }

  entries.sort((left, right) => {
    if (left.from !== right.from) {
      return left.from - right.from;
    }
    return left.to - right.to;
  });

  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) {
    builder.add(entry.from, entry.to, entry.decoration);
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

const diagnosticTooltipField = StateField.define<Tooltip | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    let next = transaction.docChanged ? null : value;
    for (const effect of transaction.effects) {
      if (effect.is(setDiagnosticTooltipEffect)) {
        next = effect.value;
      }
    }
    return next;
  },
  provide: (field) => showTooltip.from(field),
});

const sortDiagnosticsForDisplay = (
  diagnostics: readonly InlineDiagnosticsLine[],
): InlineDiagnosticsLine[] =>
  [...diagnostics].sort((left, right) => {
    const severityDelta =
      inlineSeverityPriority[left.severity] -
      inlineSeverityPriority[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    if (left.from !== right.from) {
      return left.from - right.from;
    }
    return left.message.localeCompare(right.message);
  });

const containsHoverPosition = (
  snapshot: InlineDiagnosticsLine,
  pos: number,
  side: -1 | 1,
): boolean => {
  const from = Math.min(snapshot.from, snapshot.to);
  const to = Math.max(snapshot.from, snapshot.to);
  if (to <= from) {
    return pos === from || (side < 0 && pos - 1 === from);
  }

  const target = side < 0 ? pos - 1 : pos;
  return target >= from && target < to;
};

export const hasInlineDiagnosticAtPosition = (
  view: EditorView,
  pos: number,
): boolean => {
  const diagnostics =
    view.state.field(inlineDiagnosticsField, false) ?? EMPTY_INLINE_SNAPSHOT;
  return diagnostics.some(
    (snapshot) =>
      containsHoverPosition(snapshot, pos, 1) ||
      containsHoverPosition(snapshot, pos, -1),
  );
};

const getDiagnosticPointRect = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
): Rect | null => {
  const coords =
    view.coordsAtPos(snapshot.from, 1) ?? view.coordsAtPos(snapshot.from, -1);
  if (!coords) {
    return null;
  }

  return {
    left: coords.left - 7,
    right: coords.right + 7,
    top: coords.top - 4,
    bottom: coords.bottom + 6,
  };
};

const getRectForPositionRange = (
  view: EditorView,
  from: number,
  to: number,
): Rect | null => {
  const start = view.coordsAtPos(from, 1);
  const end = view.coordsAtPos(to, -1);
  if (!start || !end) {
    return null;
  }

  return {
    left: Math.min(start.left, end.left) - 4,
    right: Math.max(start.right, end.right) + 4,
    top: Math.min(start.top, end.top) - 5,
    bottom: Math.max(start.bottom, end.bottom) + 8,
  };
};

const getDiagnosticRangeRects = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
): Rect[] => {
  if (snapshot.point || snapshot.to <= snapshot.from) {
    const pointRect = getDiagnosticPointRect(view, snapshot);
    return pointRect ? [pointRect] : [];
  }

  const domRects = getDiagnosticDOMRects(view, snapshot);
  const rects: Rect[] = [...domRects];

  for (const fragment of snapshot.fragments) {
    for (const visibleRange of view.visibleRanges) {
      const visibleFrom = Math.max(fragment.from, visibleRange.from);
      const visibleTo = Math.min(fragment.to, visibleRange.to);
      if (visibleTo <= visibleFrom) {
        continue;
      }
      const rect = getRectForPositionRange(view, visibleFrom, visibleTo);
      if (rect) {
        rects.push(rect);
      }
    }
  }

  return rects;
};

const getDiagnosticVisiblePositionAt = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
  pos: number,
): number | null => {
  if (snapshot.point || snapshot.to <= snapshot.from) {
    return snapshot.from;
  }

  const doc = view.state.doc;
  for (const candidate of [pos, pos - 1]) {
    const fragment = snapshot.fragments.find(
      (item) => candidate >= item.from && candidate < item.to,
    );
    if (
      fragment &&
      isVisibleDiagnosticChar(doc.sliceString(candidate, candidate + 1))
    ) {
      return candidate;
    }
  }

  return null;
};

const getDiagnosticRectsNearPosition = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
  pos: number,
): Rect[] => {
  if (snapshot.point || snapshot.to <= snapshot.from) {
    const pointRect = getDiagnosticPointRect(view, snapshot);
    return pointRect ? [pointRect] : [];
  }

  const rects: Rect[] = [];
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  for (const fragment of snapshot.fragments) {
    const fragmentFrom = Math.max(fragment.from, line.from);
    const fragmentTo = Math.min(fragment.to, line.to);
    if (fragmentTo <= fragmentFrom) {
      continue;
    }
    const rect = getRectForPositionRange(view, fragmentFrom, fragmentTo);
    if (rect) {
      rects.push(rect);
    }
  }

  return rects;
};

const getDiagnosticRectNearMouse = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
  pointer: DiagnosticPointer,
  pos: number,
): Rect | null =>
  getDiagnosticRectsNearPosition(view, snapshot, pos).find((rect) =>
    rectContainsPointWithPadding(
      rect,
      pointer.clientX,
      pointer.clientY,
      DIAGNOSTIC_LOGICAL_HIT_HORIZONTAL_PADDING_PX,
      DIAGNOSTIC_LOGICAL_HIT_VERTICAL_PADDING_PX,
    ),
  ) ?? null;

const getPrimaryDiagnosticRect = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
): Rect | null => getDiagnosticRangeRects(view, snapshot)[0] ?? null;

const getDiagnosticRectAtMouse = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
  pointer: DiagnosticPointer,
): Rect | null =>
  getDiagnosticRangeRects(view, snapshot).find((rect) =>
    rectContainsPoint(
      rect,
      pointer.clientX,
      pointer.clientY,
      DIAGNOSTIC_RANGE_HIT_PADDING_PX,
    ),
  ) ?? null;

const toRect = (rect: DOMRect): Rect => ({
  left: rect.left,
  right: rect.right,
  top: rect.top,
  bottom: rect.bottom,
});

const getElementClientRects = (element: Element): Rect[] =>
  Array.from(element.getClientRects())
    .filter((rect) => rect.width > 0 || rect.height > 0)
    .map(toRect);

const getDiagnosticDOMRects = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
): Rect[] => {
  const selector = `${DIAGNOSTIC_RANGE_SELECTOR}[data-diagnostic-from="${snapshot.from}"][data-diagnostic-to="${snapshot.to}"]`;
  return Array.from(view.contentDOM.querySelectorAll(selector)).flatMap(
    getElementClientRects,
  );
};

const readDiagnosticRangeElement = (
  element: Element,
): {
  from: number;
  to: number;
} | null => {
  const from = Number.parseInt(
    element.getAttribute("data-diagnostic-from") ?? "",
    10,
  );
  const to = Number.parseInt(
    element.getAttribute("data-diagnostic-to") ?? "",
    10,
  );
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }

  return {
    from,
    to,
  };
};

const parseDiagnosticRangeElement = (
  element: Element,
  pointer: DiagnosticPointer,
): {
  from: number;
  to: number;
  rect: Rect;
  fragmentIndex: number;
} | null => {
  const bounds = readDiagnosticRangeElement(element);
  if (!bounds) {
    return null;
  }

  const rects = getElementClientRects(element);
  const fragmentIndex = rects.findIndex((rect) =>
    rectContainsPoint(
      rect,
      pointer.clientX,
      pointer.clientY,
      DIAGNOSTIC_RANGE_HIT_PADDING_PX,
    ),
  );
  if (fragmentIndex < 0) {
    return null;
  }
  return {
    ...bounds,
    rect: rects[fragmentIndex],
    fragmentIndex,
  };
};

const findDiagnosticRangeInElements = (
  view: EditorView,
  elements: Iterable<EventTarget | Element>,
  pointer: DiagnosticPointer,
): { from: number; to: number; rect: Rect; fragmentIndex: number } | null => {
  for (const target of elements) {
    if (!(target instanceof Element)) {
      continue;
    }
    const rangeElement = target.closest(DIAGNOSTIC_RANGE_SELECTOR);
    if (!rangeElement || !view.contentDOM.contains(rangeElement)) {
      continue;
    }

    const parsed = parseDiagnosticRangeElement(rangeElement, pointer);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const rectContainsPoint = (
  rect: Rect,
  clientX: number,
  clientY: number,
  padding = 0,
): boolean =>
  rectContainsPointWithPadding(rect, clientX, clientY, padding, padding);

const rectContainsPointWithPadding = (
  rect: Rect,
  clientX: number,
  clientY: number,
  horizontalPadding = 0,
  verticalPadding = horizontalPadding,
): boolean =>
  clientX >= rect.left - horizontalPadding &&
  clientX <= rect.right + horizontalPadding &&
  clientY >= rect.top - verticalPadding &&
  clientY <= rect.bottom + verticalPadding;

const quantizeRect = (rect: Rect): string =>
  [
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.right),
    Math.round(rect.bottom),
  ].join(":");

const findDiagnosticRangeAtPoint = (
  view: EditorView,
  pointer: DiagnosticPointer,
): { from: number; to: number; rect: Rect; fragmentIndex: number } | null => {
  const pathMatch = findDiagnosticRangeInElements(
    view,
    pointer.composedPath?.() ?? [],
    pointer,
  );
  if (pathMatch) {
    return pathMatch;
  }

  const pointMatch = findDiagnosticRangeInElements(
    view,
    document.elementsFromPoint(pointer.clientX, pointer.clientY),
    pointer,
  );
  if (pointMatch) {
    return pointMatch;
  }

  const visibleRanges = view.contentDOM.querySelectorAll(
    DIAGNOSTIC_RANGE_SELECTOR,
  );
  for (const rangeElement of visibleRanges) {
    const parsed = parseDiagnosticRangeElement(rangeElement, pointer);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const diagnosticsIntersectRange = (
  diagnostics: readonly InlineDiagnosticsLine[],
  from: number,
  to: number,
): InlineDiagnosticsLine[] =>
  diagnostics.filter((snapshot) => {
    if (snapshot.point || snapshot.to <= snapshot.from || to <= from) {
      return snapshot.from >= from && snapshot.from <= to;
    }

    return snapshot.from < to && snapshot.to > from;
  });

const getDiagnosticLogicalRectAtMouse = (
  view: EditorView,
  snapshot: InlineDiagnosticsLine,
  pointer: DiagnosticPointer,
  pos: number,
): Rect | null => {
  if (
    !containsHoverPosition(snapshot, pos, 1) &&
    !containsHoverPosition(snapshot, pos, -1)
  ) {
    return null;
  }

  if (snapshot.point || snapshot.to <= snapshot.from) {
    const pointRect = getDiagnosticPointRect(view, snapshot);
    return pointRect &&
      rectContainsPointWithPadding(
        pointRect,
        pointer.clientX,
        pointer.clientY,
        DIAGNOSTIC_LOGICAL_HIT_HORIZONTAL_PADDING_PX,
        DIAGNOSTIC_LOGICAL_HIT_VERTICAL_PADDING_PX,
      )
      ? pointRect
      : null;
  }

  const target = getDiagnosticVisiblePositionAt(view, snapshot, pos);
  if (target !== null) {
    const targetRect = getRectForPositionRange(view, target, target + 1);
    if (
      targetRect &&
      rectContainsPointWithPadding(
        targetRect,
        pointer.clientX,
        pointer.clientY,
        DIAGNOSTIC_LOGICAL_HIT_HORIZONTAL_PADDING_PX,
        DIAGNOSTIC_LOGICAL_HIT_VERTICAL_PADDING_PX,
      )
    ) {
      return targetRect;
    }
  }

  return getDiagnosticRectNearMouse(view, snapshot, pointer, pos);
};

const findDiagnosticsAtMouse = (
  view: EditorView,
  pointer: DiagnosticPointer,
): {
  diagnostics: InlineDiagnosticsLine[];
  anchor: number;
  rect: Rect;
  fragmentKey: string;
} | null => {
  const diagnostics =
    view.state.field(inlineDiagnosticsField, false) ?? EMPTY_INLINE_SNAPSHOT;
  if (diagnostics.length === 0) {
    return null;
  }

  let rect: Rect | null = null;
  let fragmentKey = "";
  const domRange = findDiagnosticRangeAtPoint(view, pointer);
  let matches = domRange
    ? diagnosticsIntersectRange(diagnostics, domRange.from, domRange.to)
    : [];
  if (matches.length > 0 && domRange) {
    rect = domRange.rect;
    fragmentKey = `dom:${domRange.from}:${domRange.to}:${domRange.fragmentIndex}:${quantizeRect(domRange.rect)}`;
  }

  if (matches.length === 0) {
    const rectMatches = diagnostics
      .map((snapshot) => ({
        snapshot,
        rect: getDiagnosticRectAtMouse(view, snapshot, pointer),
      }))
      .filter(
        (match): match is { snapshot: InlineDiagnosticsLine; rect: Rect } =>
          Boolean(match.rect),
      );
    if (rectMatches.length > 0) {
      matches = rectMatches.map((match) => match.snapshot);
      rect = rectMatches[0].rect;
      fragmentKey = `rect:${rectMatches[0].snapshot.from}:${rectMatches[0].snapshot.to}:${quantizeRect(rect)}`;
    }
  }
  const pos = view.posAtCoords(
    { x: pointer.clientX, y: pointer.clientY },
    false,
  );
  if (matches.length === 0 && pos !== null) {
    const logicalMatches = diagnostics
      .filter(
        (snapshot) =>
          containsHoverPosition(snapshot, pos, 1) ||
          containsHoverPosition(snapshot, pos, -1),
      )
      .map((snapshot) => ({
        snapshot,
        rect: getDiagnosticLogicalRectAtMouse(view, snapshot, pointer, pos),
      }))
      .filter(
        (match): match is { snapshot: InlineDiagnosticsLine; rect: Rect } =>
          Boolean(match.rect),
      );
    if (logicalMatches.length > 0) {
      matches = logicalMatches.map((match) => match.snapshot);
      rect = logicalMatches[0].rect;
      fragmentKey = `pos:${logicalMatches[0].snapshot.from}:${logicalMatches[0].snapshot.to}:${pos}:${quantizeRect(rect)}`;
    }
  }
  if (matches.length === 0) {
    return null;
  }

  const ordered = sortDiagnosticsForDisplay(matches);
  const primary = ordered[0];
  const anchor =
    pos === null
      ? primary.from
      : clamp(pos, primary.from, Math.max(primary.from, primary.to));
  const coords =
    view.coordsAtPos(anchor, 1) ??
    view.coordsAtPos(primary.from, 1) ??
    view.coordsAtPos(primary.to, -1);
  const tooltipRect = rect ?? coords ?? getPrimaryDiagnosticRect(view, primary);
  if (!tooltipRect) {
    return null;
  }

  return {
    diagnostics: ordered,
    anchor,
    rect: tooltipRect,
    fragmentKey: fragmentKey || `fallback:${quantizeRect(tooltipRect)}`,
  };
};

const createDiagnosticTooltipChip = (label: string): HTMLElement => {
  const chip = document.createElement("span");
  chip.className = "cm-diagnostic-tooltip-chip";
  chip.textContent = label;
  return chip;
};

const getDiagnosticTooltipTitle = (snapshot: InlineDiagnosticsLine): string => {
  const message = snapshot.message.trim();
  const knownTitle = [
    /^Cannot resolve symbol\b/i,
    /^Cannot find name\b/i,
    /^Could not import\b/i,
    /^Failed to\b/i,
  ].find((pattern) => pattern.test(message));
  if (knownTitle) {
    return message.match(knownTitle)?.[0] ?? message;
  }
  if (snapshot.severity === "warning") {
    return "Warning";
  }
  if (snapshot.severity === "info") {
    return "Info";
  }
  return "Error";
};

const createDiagnosticTooltipItem = (
  snapshot: InlineDiagnosticsLine,
): HTMLElement => {
  const item = document.createElement("div");
  item.className = `cm-diagnostic-tooltip-item cm-diagnostic-tooltip-item-${snapshot.severity}`;

  const icon = document.createElement("div");
  icon.className = "cm-diagnostic-tooltip-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  item.appendChild(icon);

  const content = document.createElement("div");
  content.className = "cm-diagnostic-tooltip-content";

  const title = document.createElement("div");
  title.className = "cm-diagnostic-tooltip-title";
  title.textContent = getDiagnosticTooltipTitle(snapshot);
  content.appendChild(title);

  const message = document.createElement("div");
  message.className = "cm-diagnostic-tooltip-message";
  message.textContent = snapshot.message;
  content.appendChild(message);

  const metadata = document.createElement("div");
  metadata.className = "cm-diagnostic-tooltip-meta";
  const chipLabels = [
    snapshot.source,
    snapshot.code,
    `Ln ${snapshot.line}`,
    `Col ${snapshot.column}`,
  ].filter((label, index, labels): label is string => {
    if (!label) {
      return false;
    }
    return labels.indexOf(label) === index;
  });

  for (const label of chipLabels) {
    metadata.appendChild(createDiagnosticTooltipChip(label));
  }
  content.appendChild(metadata);
  item.appendChild(content);

  return item;
};

const createDiagnosticTooltip = (
  diagnostics: readonly InlineDiagnosticsLine[],
  anchor: number,
  rect: Rect,
): Tooltip | null => {
  const ordered = sortDiagnosticsForDisplay(diagnostics);
  const primary = ordered[0];
  if (!primary) {
    return null;
  }

  return {
    pos: anchor,
    above: true,
    arrow: false,
    create() {
      const dom = document.createElement("div");
      dom.className = `cm-diagnostic-tooltip cm-diagnostic-tooltip-${primary.severity}`;
      applyDiagnosticTooltipMetrics(dom);
      dom.replaceChildren(...ordered.map(createDiagnosticTooltipItem));
      return {
        dom,
        getCoords: () => rect,
        offset: { x: 0, y: 8 },
      };
    },
  };
};

const getDiagnosticTooltipSignature = (
  diagnostics: readonly InlineDiagnosticsLine[],
  anchor: number,
  geometryRevision: number,
  fragmentKey: string,
): string =>
  `${geometryRevision}:${anchor}:${fragmentKey}:${diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.from}:${diagnostic.to}:${diagnostic.point}:${diagnostic.severity}:${diagnostic.message}:${diagnostic.source}:${diagnostic.code}:${diagnostic.line}:${diagnostic.column}`,
    )
    .join("\u0000")}`;

export const diagnosticsTheme = EditorView.theme({
  ".cm-diagnostic-range": {
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationThickness: "1.5px",
    textUnderlineOffset: "3px",
  },
  ".cm-diagnostic-range-error": {
    textDecorationColor: "#f87171",
    "--diagnostic-range-color": "#f87171",
  },
  ".cm-diagnostic-range-warning": {
    textDecorationColor: "#fbbf24",
    "--diagnostic-range-color": "#fbbf24",
  },
  ".cm-diagnostic-range-info": {
    textDecorationColor: "#60a5fa",
    "--diagnostic-range-color": "#60a5fa",
  },
  ".cm-diagnostic-point": {
    display: "inline-block",
    position: "relative",
    width: "0.7em",
    minWidth: "0.7em",
    height: "1em",
    marginRight: "-0.7em",
    verticalAlign: "baseline",
  },
  ".cm-diagnostic-point::after": {
    content: '" "',
    position: "absolute",
    left: "0",
    bottom: "0",
    width: "100%",
    height: "1em",
    pointerEvents: "none",
    color: "transparent",
    whiteSpace: "pre",
    textDecorationLine: "underline",
    textDecorationStyle: "wavy",
    textDecorationThickness: "1.5px",
    textDecorationColor: "var(--diagnostic-range-color)",
    textUnderlineOffset: "3px",
  },
  ".cm-tooltip:has(.cm-diagnostic-tooltip)": {
    border: "0",
    background: "transparent",
    boxShadow: "none",
    filter:
      "drop-shadow(0 30px 38px rgba(0, 0, 0, 0.42)) drop-shadow(0 10px 18px rgba(0, 0, 0, 0.22))",
    pointerEvents: "none",
  },
  ".cm-tooltip .cm-diagnostic-tooltip.cm-tooltip-section, .cm-diagnostic-tooltip":
    {
      minWidth:
        "min(var(--diagnostic-tooltip-min-width, 430px), calc(100vw - 40px))",
      maxWidth:
        "min(var(--diagnostic-tooltip-max-width, 760px), calc(100vw - 40px))",
      padding:
        "var(--diagnostic-tooltip-padding-y, 18px) var(--diagnostic-tooltip-padding-x, 22px)",
      borderRadius: "var(--diagnostic-tooltip-radius, 20px)",
      fontFamily: "var(--ui-font-family)",
      fontSize: "var(--diagnostic-tooltip-font-size, 14px)",
      letterSpacing: "0",
      lineHeight: "1.3",
      color: "var(--text-primary)",
      backgroundColor:
        "color-mix(in srgb, var(--surface-elevated) 94%, var(--surface-shell-soft))",
      border: "1px solid var(--shell-border-strong)",
      boxShadow:
        "inset 0 1px 0 var(--shell-inner-highlight), 0 34px 86px -34px rgba(0, 0, 0, 0.82), 0 14px 32px -20px rgba(0, 0, 0, 0.72), var(--shadow-overlay)",
      backdropFilter:
        "blur(var(--diagnostic-tooltip-blur, 12px)) saturate(1.18)",
      WebkitBackdropFilter:
        "blur(var(--diagnostic-tooltip-blur, 12px)) saturate(1.18)",
      pointerEvents: "none",
    },
  ".cm-tooltip .cm-diagnostic-tooltip.cm-diagnostic-tooltip-error.cm-tooltip-section, .cm-diagnostic-tooltip.cm-diagnostic-tooltip-error":
    {
      "--diagnostic-tooltip-severity": "var(--status-error)",
      "--diagnostic-tooltip-severity-surface":
        "color-mix(in srgb, var(--status-error) 12%, var(--surface-elevated))",
      "--diagnostic-tooltip-severity-border":
        "color-mix(in srgb, var(--status-error) 24%, var(--shell-border-strong))",
    },
  ".cm-tooltip .cm-diagnostic-tooltip.cm-diagnostic-tooltip-warning.cm-tooltip-section, .cm-diagnostic-tooltip.cm-diagnostic-tooltip-warning":
    {
      "--diagnostic-tooltip-severity": "var(--status-warning)",
      "--diagnostic-tooltip-severity-surface":
        "color-mix(in srgb, var(--status-warning) 14%, var(--surface-elevated))",
      "--diagnostic-tooltip-severity-border":
        "color-mix(in srgb, var(--status-warning) 26%, var(--shell-border-strong))",
    },
  ".cm-tooltip .cm-diagnostic-tooltip.cm-diagnostic-tooltip-info.cm-tooltip-section, .cm-diagnostic-tooltip.cm-diagnostic-tooltip-info":
    {
      "--diagnostic-tooltip-severity": "var(--status-info)",
      "--diagnostic-tooltip-severity-surface":
        "color-mix(in srgb, var(--status-info) 12%, var(--surface-elevated))",
      "--diagnostic-tooltip-severity-border":
        "color-mix(in srgb, var(--status-info) 24%, var(--shell-border-strong))",
    },
  ".cm-diagnostic-tooltip-item + .cm-diagnostic-tooltip-item": {
    marginTop: "var(--diagnostic-tooltip-gap, 20px)",
    paddingTop: "var(--diagnostic-tooltip-gap, 20px)",
    borderTop: "1px solid var(--shell-inline-divider)",
  },
  ".cm-diagnostic-tooltip-item": {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    columnGap: "var(--diagnostic-tooltip-gap, 20px)",
  },
  ".cm-diagnostic-tooltip-icon": {
    display: "flex",
    width: "var(--diagnostic-tooltip-icon-size, 54px)",
    height: "var(--diagnostic-tooltip-icon-size, 54px)",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--diagnostic-tooltip-icon-radius, 14px)",
    border: "1px solid var(--diagnostic-tooltip-severity-border)",
    backgroundColor: "var(--diagnostic-tooltip-severity-surface)",
    color: "var(--diagnostic-tooltip-severity)",
    fontFamily: "var(--font-mono)",
    fontSize: "calc(var(--diagnostic-tooltip-icon-size, 54px) * 0.42)",
    fontWeight: "800",
    lineHeight: "1",
    boxShadow: "inset 0 1px 0 var(--shell-inner-highlight)",
  },
  ".cm-diagnostic-tooltip-content": {
    minWidth: "0",
  },
  ".cm-diagnostic-tooltip-title": {
    fontSize: "var(--diagnostic-tooltip-title-size, 14px)",
    fontWeight: "780",
    lineHeight: "1.15",
    color: "var(--diagnostic-tooltip-severity)",
    overflowWrap: "anywhere",
  },
  ".cm-diagnostic-tooltip-message": {
    fontSize: "var(--diagnostic-tooltip-message-size, 14px)",
    fontWeight: "590",
    lineHeight: "1.38",
    marginTop: "calc(var(--diagnostic-tooltip-chip-gap, 8px) * 0.72)",
    overflowWrap: "anywhere",
  },
  ".cm-diagnostic-tooltip-meta": {
    display: "inline-flex",
    flexWrap: "wrap",
    alignItems: "center",
    maxWidth: "100%",
    gap: "var(--diagnostic-tooltip-chip-gap, 8px)",
    marginTop: "calc(var(--diagnostic-tooltip-chip-gap, 8px) * 1.8)",
    padding: "var(--diagnostic-tooltip-meta-padding, 6px)",
    borderRadius: "999px",
    border:
      "1px solid color-mix(in srgb, var(--shell-border) 78%, transparent)",
    backgroundColor:
      "color-mix(in srgb, var(--surface-shell-soft) 82%, transparent)",
    boxShadow: "inset 0 1px 0 var(--shell-inner-highlight)",
  },
  ".cm-diagnostic-tooltip-chip": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "var(--diagnostic-tooltip-chip-height, 32px)",
    borderRadius: "999px",
    border: "1px solid var(--shell-border-strong)",
    backgroundColor:
      "color-mix(in srgb, var(--surface-elevated) 76%, transparent)",
    padding: "0 var(--diagnostic-tooltip-chip-x, 14px)",
    fontSize: "var(--diagnostic-tooltip-chip-size, 12px)",
    fontWeight: "730",
    lineHeight: "1",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    boxShadow: "inset 0 1px 0 var(--shell-inner-highlight)",
  },
});

const buildInlineDiagnosticsEffects = (
  inlineSnapshot: readonly InlineDiagnosticsLine[],
) => [setInlineDiagnosticsEffect.of(inlineSnapshot)];

const selectProblemsForFile =
  (filePath: string) =>
  (state: { byFile: Map<string, { items: DiagnosticsProblem[] }> }) =>
    state.byFile.get(filePath)?.items ?? EMPTY_PROBLEMS;

const getVisibleLineRanges = (
  view: EditorView,
): Array<{ fromLine: number; toLine: number }> =>
  view.visibleRanges.map((range) => {
    const fromLine = view.state.doc.lineAt(range.from).number;
    const toLine = view.state.doc.lineAt(range.to).number;
    return { fromLine, toLine };
  });

const visibleLineRangesKey = (view: EditorView): string =>
  getVisibleLineRanges(view)
    .map((range) => `${range.fromLine}-${range.toLine}`)
    .join("|");

const problemIntersectsVisibleLines = (
  problem: DiagnosticsProblem,
  visibleLineRanges: Array<{ fromLine: number; toLine: number }>,
): boolean => {
  const startLine = problem.line;
  const endLine = Math.max(
    startLine,
    problem.range.end.line >= 0 ? problem.range.end.line + 1 : startLine,
  );
  return visibleLineRanges.some(
    (range) => startLine <= range.toLine && endLine >= range.fromLine,
  );
};

const selectInlineDiagnosticProblems = (
  view: EditorView,
  problems: readonly DiagnosticsProblem[],
  maxInlineDiagnostics: number,
): readonly DiagnosticsProblem[] => {
  if (maxInlineDiagnostics <= 0 || problems.length <= maxInlineDiagnostics) {
    return problems;
  }

  const visibleLineRanges = getVisibleLineRanges(view);
  const selected: DiagnosticsProblem[] = [];
  const seen = new Set<string>();

  for (const problem of problems) {
    if (!problemIntersectsVisibleLines(problem, visibleLineRanges)) {
      continue;
    }
    selected.push(problem);
    seen.add(problem.id);
    if (selected.length >= maxInlineDiagnostics) {
      return selected;
    }
  }

  for (const problem of problems) {
    if (seen.has(problem.id)) {
      continue;
    }
    selected.push(problem);
    if (selected.length >= maxInlineDiagnostics) {
      break;
    }
  }

  return selected;
};

class DiagnosticsBridge {
  private readonly unsubscribe: () => void;
  private readonly filePath: string;
  private readonly language: string;
  private pendingProblems: readonly DiagnosticsProblem[] = EMPTY_PROBLEMS;
  private pendingSignature = "";
  private appliedSignature = "";
  private scheduled = false;
  private destroyed = false;
  private awaitingInitialPull = false;
  private maxInlineDiagnostics = DEFAULT_MAX_INLINE_DIAGNOSTICS;
  private activeTooltipSignature = "";
  private geometryRevision = 0;
  private tooltipArmed = false;
  private suppressReopenUntilMouseMove = false;
  private lastPointer: DiagnosticPointer | null = null;
  private reanchorFrame = 0;
  private readonly handlePointerHover = (event: MouseEvent | PointerEvent) => {
    this.suppressReopenUntilMouseMove = false;
    this.lastPointer = {
      clientX: event.clientX,
      clientY: event.clientY,
      buttons: event.buttons,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
    };
    if (event.buttons !== 0) {
      this.clearDiagnosticTooltip();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      this.clearDiagnosticTooltip();
      return;
    }

    const match = findDiagnosticsAtMouse(this.view, event);
    if (!match) {
      this.clearDiagnosticTooltip();
      return;
    }

    this.applyDiagnosticTooltipMatch(match);
  };
  private readonly handleMouseLeave = () => {
    this.clearDiagnosticTooltip();
  };
  private readonly handleMouseDown = () => {
    this.clearDiagnosticTooltip();
  };
  private readonly handleMouseUp = (event: MouseEvent) => {
    if (this.suppressReopenUntilMouseMove) {
      return;
    }
    this.handlePointerHover(event);
  };
  private readonly handleBlur = () => {
    this.clearDiagnosticTooltip();
  };
  private readonly handleGeometryInvalidated = () => {
    this.geometryRevision += 1;
    if (
      !this.tooltipArmed ||
      !this.activeTooltipSignature ||
      this.suppressReopenUntilMouseMove ||
      !this.lastPointer
    ) {
      return;
    }
    this.scheduleTooltipReanchor();
  };
  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      this.suppressReopenUntilMouseMove = true;
      this.clearDiagnosticTooltip();
    }
  };

  private applyDiagnosticTooltipMatch(match: {
    diagnostics: InlineDiagnosticsLine[];
    anchor: number;
    rect: Rect;
    fragmentKey: string;
  }): void {
    const signature = getDiagnosticTooltipSignature(
      match.diagnostics,
      match.anchor,
      this.geometryRevision,
      match.fragmentKey,
    );
    this.tooltipArmed = true;
    if (Object.is(signature, this.activeTooltipSignature)) {
      return;
    }

    const tooltip = createDiagnosticTooltip(
      match.diagnostics,
      match.anchor,
      match.rect,
    );
    if (!tooltip) {
      this.clearDiagnosticTooltip();
      return;
    }
    this.activeTooltipSignature = signature;
    this.view.dispatch({
      effects: setDiagnosticTooltipEffect.of(tooltip),
    });
  }

  private scheduleTooltipReanchor(): void {
    if (this.reanchorFrame !== 0) {
      return;
    }
    this.reanchorFrame = window.requestAnimationFrame(() => {
      this.reanchorFrame = 0;
      if (
        this.destroyed ||
        !this.tooltipArmed ||
        this.suppressReopenUntilMouseMove ||
        !this.lastPointer
      ) {
        return;
      }
      if (
        this.lastPointer.buttons !== 0 ||
        this.lastPointer.metaKey ||
        this.lastPointer.ctrlKey ||
        this.lastPointer.altKey
      ) {
        this.clearDiagnosticTooltip();
        return;
      }
      const match = findDiagnosticsAtMouse(this.view, this.lastPointer);
      if (!match) {
        this.clearDiagnosticTooltip();
        return;
      }
      this.applyDiagnosticTooltipMatch(match);
    });
  }

  constructor(
    private readonly view: EditorView,
    options: DiagnosticsExtensionOptions,
  ) {
    this.filePath = options.filePath;
    this.language = options.language;
    this.maxInlineDiagnostics =
      typeof options.maxInlineDiagnostics === "number"
        ? Math.max(0, Math.trunc(options.maxInlineDiagnostics))
        : DEFAULT_MAX_INLINE_DIAGNOSTICS;
    const cachedProblems = useDiagnosticsStore
      .getState()
      .byFile.get(this.filePath)?.items;
    const hasCachedDiagnostics = cachedProblems !== undefined;
    this.awaitingInitialPull = !hasCachedDiagnostics;

    if (cachedProblems && cachedProblems.length > 0) {
      this.pendingProblems = cachedProblems;
      this.pendingSignature = this.getCurrentSignature(cachedProblems);
      this.scheduleApply();
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
        this.pendingProblems = problems;
        this.pendingSignature = this.getCurrentSignature(problems);
        this.scheduleApply();
      },
      { fireImmediately: !this.awaitingInitialPull },
    );

    this.view.dom.addEventListener(
      "pointermove",
      this.handlePointerHover,
      true,
    );
    this.view.dom.addEventListener("mousemove", this.handlePointerHover, true);
    this.view.dom.addEventListener("mouseover", this.handlePointerHover, true);
    this.view.dom.addEventListener("mouseleave", this.handleMouseLeave);
    this.view.dom.addEventListener("mousedown", this.handleMouseDown);
    this.view.dom.addEventListener("mouseup", this.handleMouseUp, true);
    this.view.scrollDOM.addEventListener(
      "scroll",
      this.handleGeometryInvalidated,
      true,
    );
    window.addEventListener("resize", this.handleGeometryInvalidated, true);
    window.addEventListener("keydown", this.handleKeyDown, true);
    window.addEventListener("blur", this.handleBlur, true);

    if (this.awaitingInitialPull) {
      void this.pullInitialDiagnostics();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.view.dom.removeEventListener(
      "pointermove",
      this.handlePointerHover,
      true,
    );
    this.view.dom.removeEventListener(
      "mousemove",
      this.handlePointerHover,
      true,
    );
    this.view.dom.removeEventListener(
      "mouseover",
      this.handlePointerHover,
      true,
    );
    this.view.dom.removeEventListener("mouseleave", this.handleMouseLeave);
    this.view.dom.removeEventListener("mousedown", this.handleMouseDown);
    this.view.dom.removeEventListener("mouseup", this.handleMouseUp, true);
    this.view.scrollDOM.removeEventListener(
      "scroll",
      this.handleGeometryInvalidated,
      true,
    );
    window.removeEventListener("resize", this.handleGeometryInvalidated, true);
    window.removeEventListener("keydown", this.handleKeyDown, true);
    window.removeEventListener("blur", this.handleBlur, true);
    if (this.reanchorFrame !== 0) {
      window.cancelAnimationFrame(this.reanchorFrame);
      this.reanchorFrame = 0;
    }
    this.clearDiagnosticTooltip();
    this.unsubscribe();
  }

  private clearDiagnosticTooltip(): void {
    this.tooltipArmed = false;
    this.lastPointer = null;
    if (!this.activeTooltipSignature) {
      return;
    }
    this.activeTooltipSignature = "";
    if (!this.destroyed) {
      this.view.dispatch({
        effects: setDiagnosticTooltipEffect.of(null),
      });
    }
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.handleGeometryInvalidated();
    }
    if (
      update.viewportChanged &&
      this.maxInlineDiagnostics > 0 &&
      this.pendingProblems.length > this.maxInlineDiagnostics
    ) {
      this.pendingSignature = this.getCurrentSignature(this.pendingProblems);
      this.scheduleApply();
    }
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

      if (Object.is(this.pendingSignature, this.appliedSignature)) {
        return;
      }

      const problems = selectInlineDiagnosticProblems(
        this.view,
        this.pendingProblems,
        this.maxInlineDiagnostics,
      );
      const inlineSnapshot = buildInlineDiagnosticsSnapshot(
        this.view.state.doc,
        problems,
      );
      this.appliedSignature = this.pendingSignature;
      if (problems.length > 0) {
        lastVisibleProblemsByView.set(this.view, problems);
      } else {
        lastVisibleProblemsByView.delete(this.view);
      }
      const shouldReanchorTooltip =
        this.tooltipArmed &&
        Boolean(this.lastPointer) &&
        this.activeTooltipSignature !== "";
      this.activeTooltipSignature = "";
      this.view.dispatch({
        effects: [
          ...buildInlineDiagnosticsEffects(inlineSnapshot),
          setDiagnosticTooltipEffect.of(null),
        ],
      });
      if (shouldReanchorTooltip) {
        this.scheduleTooltipReanchor();
      }
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

      if (Array.isArray(diagnostics) && diagnostics.length > 0) {
        useDiagnosticsStore
          .getState()
          .setFileDiagnostics(this.filePath, this.language, diagnostics);
      }
    } catch (error) {
      console.debug("[diagnostics] initial pull failed", error);
    } finally {
      this.awaitingInitialPull = false;
      if (
        !this.destroyed &&
        !useDiagnosticsStore.getState().byFile.has(this.filePath)
      ) {
        this.pendingProblems = EMPTY_PROBLEMS;
        this.pendingSignature = this.getCurrentSignature(EMPTY_PROBLEMS);
        this.scheduleApply();
      }
    }
  }

  private getCurrentSignature(problems: readonly DiagnosticsProblem[]): string {
    const base = getProblemsSignature(problems);
    if (
      this.maxInlineDiagnostics <= 0 ||
      problems.length <= this.maxInlineDiagnostics
    ) {
      return base;
    }
    return `${base}\u0000visible:${visibleLineRangesKey(this.view)}`;
  }
}

export const createDiagnosticsExtension = (
  options: DiagnosticsExtensionOptions,
): Extension[] => [
  diagnosticsTheme,
  inlineDiagnosticsField,
  diagnosticTooltipField,
  ViewPlugin.fromClass(
    class extends DiagnosticsBridge {
      constructor(view: EditorView) {
        super(view, options);
      }
    },
  ),
];
