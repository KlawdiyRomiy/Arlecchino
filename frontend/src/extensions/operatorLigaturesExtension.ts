import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

const operatorLigatures = [
  { raw: "<==>", glyph: "⟺" },
  { raw: "==>", glyph: "⟹" },
  { raw: "<==", glyph: "⟸" },
  { raw: "<=>", glyph: "⇔" },
  { raw: "-->", glyph: "⟶" },
  { raw: "<--", glyph: "⟵" },
  { raw: "<->", glyph: "↔" },
  { raw: "!==", glyph: "≢" },
  { raw: "===", glyph: "≡" },
  { raw: "=>", glyph: "⇒" },
  { raw: "->", glyph: "→" },
  { raw: "<-", glyph: "←" },
  { raw: "<=", glyph: "≤" },
  { raw: ">=", glyph: "≥" },
  { raw: "!=", glyph: "≠" },
] as const;

type OperatorLigature = (typeof operatorLigatures)[number];

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const operatorLigatureByRaw: ReadonlyMap<string, OperatorLigature> = new Map(
  operatorLigatures.map((ligature) => [ligature.raw, ligature]),
);

const operatorLigaturePattern = new RegExp(
  operatorLigatures
    .map((ligature) => ligature.raw)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|"),
  "g",
);

class OperatorLigatureWidget extends WidgetType {
  constructor(
    private readonly raw: string,
    private readonly glyph: string,
  ) {
    super();
  }

  eq(other: OperatorLigatureWidget): boolean {
    return this.raw === other.raw && this.glyph === other.glyph;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-operatorLigature";
    span.textContent = this.glyph;
    span.style.width = `${this.raw.length}ch`;
    span.setAttribute("aria-label", this.raw);
    span.title = this.raw;
    return span;
  }
}

const selectionTouchesRange = (
  view: EditorView,
  from: number,
  to: number,
): boolean =>
  view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from <= to;
    }
    return range.from < to && range.to > from;
  });

const buildOperatorLigatureDecorations = (view: EditorView): DecorationSet => {
  const builder = new RangeSetBuilder<Decoration>();
  const addedRanges = new Set<string>();

  for (const visibleRange of view.visibleRanges) {
    let line = view.state.doc.lineAt(visibleRange.from);

    for (;;) {
      if (line.to >= visibleRange.from) {
        operatorLigaturePattern.lastIndex = 0;
        for (;;) {
          const match = operatorLigaturePattern.exec(line.text);
          if (!match) {
            break;
          }

          const raw = match[0];
          const ligature = operatorLigatureByRaw.get(raw);
          if (!ligature) {
            continue;
          }

          const from = line.from + match.index;
          const to = from + raw.length;
          if (to <= visibleRange.from || from >= visibleRange.to) {
            continue;
          }
          if (selectionTouchesRange(view, from, to)) {
            continue;
          }

          const key = `${from}:${to}`;
          if (addedRanges.has(key)) {
            continue;
          }
          addedRanges.add(key);

          builder.add(
            from,
            to,
            Decoration.replace({
              widget: new OperatorLigatureWidget(raw, ligature.glyph),
              inclusive: false,
            }),
          );
        }
      }

      if (line.to >= visibleRange.to || line.number >= view.state.doc.lines) {
        break;
      }
      line = view.state.doc.line(line.number + 1);
    }
  }

  return builder.finish();
};

class OperatorLigaturesPlugin {
  decorations: DecorationSet;

  constructor(private readonly view: EditorView) {
    this.decorations = buildOperatorLigatureDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.focusChanged
    ) {
      this.decorations = buildOperatorLigatureDecorations(this.view);
    }
  }
}

const operatorLigatureTheme = EditorView.theme({
  ".cm-content": {
    fontVariantLigatures: "contextual",
    fontFeatureSettings: '"liga" 1, "calt" 1',
  },
  ".cm-operatorLigature": {
    display: "inline-block",
    color: "inherit",
    fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
    fontVariantLigatures: "none",
    fontFeatureSettings: "normal",
    lineHeight: "inherit",
    pointerEvents: "none",
    textAlign: "center",
    verticalAlign: "baseline",
    whiteSpace: "pre",
  },
});

const disabledOperatorLigatureTheme = EditorView.theme({
  ".cm-content": {
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',
  },
});

const operatorLigaturePlugin = ViewPlugin.fromClass(OperatorLigaturesPlugin, {
  decorations: (plugin) => plugin.decorations,
});

export const createOperatorLigaturesExtension = (
  enabled: boolean,
): Extension =>
  enabled
    ? [operatorLigatureTheme, operatorLigaturePlugin]
    : disabledOperatorLigatureTheme;
