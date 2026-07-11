import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

const BRACKET_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "indigo",
  "violet",
] as const;

type OpeningBracket = {
  type: "(" | "[" | "{";
  from: number;
};

const matchingOpeningBracket = (
  closing: string,
): OpeningBracket["type"] | null => {
  switch (closing) {
    case ")":
      return "(";
    case "]":
      return "[";
    case "}":
      return "{";
    default:
      return null;
  }
};

const containsBracket = (value: string): boolean => /[()[\]{}]/.test(value);

const buildRainbowBracketDecorations = (view: EditorView): DecorationSet => {
  const text = view.state.doc.toString();
  const decorations = [];
  const stack: OpeningBracket[] = [];

  for (let pos = 0; pos < text.length; pos += 1) {
    const char = text[pos];
    if (char === "(" || char === "[" || char === "{") {
      stack.push({ type: char, from: pos });
      continue;
    }

    const matchingOpening = matchingOpeningBracket(char);
    if (!matchingOpening) {
      continue;
    }

    const open = stack.pop();
    if (!open || open.type !== matchingOpening) {
      continue;
    }

    const color = BRACKET_COLORS[stack.length % BRACKET_COLORS.length];
    decorations.push(
      Decoration.mark({ class: `rainbow-bracket-${color}` }).range(
        open.from,
        open.from + 1,
      ),
      Decoration.mark({ class: `rainbow-bracket-${color}` }).range(
        pos,
        pos + 1,
      ),
    );
  }

  decorations.sort((left, right) => left.from - right.from);
  return Decoration.set(decorations);
};

const updateTouchesBracket = (update: ViewUpdate): boolean => {
  let touchesBracket = false;
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (touchesBracket) {
      return;
    }
    touchesBracket =
      containsBracket(inserted.toString()) ||
      containsBracket(update.startState.doc.sliceString(fromA, toA));
  });
  return touchesBracket;
};

/**
 * Keeps bracket colors exact while avoiding a full-document scan for edits
 * that cannot affect bracket nesting. Structural bracket edits still rebuild
 * synchronously; all other edits only map the existing decorations.
 */
export const incrementalRainbowBrackets = () =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildRainbowBracketDecorations(view);
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) {
          return;
        }
        this.decorations = updateTouchesBracket(update)
          ? buildRainbowBracketDecorations(update.view)
          : this.decorations.map(update.changes);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
