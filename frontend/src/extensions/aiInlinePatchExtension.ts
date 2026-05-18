import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";

import {
  aiInlinePatchPathMatches,
  normalizeAIInlinePatchPath,
  type AIInlinePatchPreview,
} from "../stores/aiInlinePatchStore";

type AIInlinePatchLineKind = "add" | "remove";

export interface AIInlinePatchLine {
  kind: AIInlinePatchLineKind;
  line: number;
  text: string;
}

interface DiffFileBlock {
  oldPath: string;
  newPath: string;
  lines: string[];
}

const hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const cleanDiffPath = (value: string): string =>
  normalizeAIInlinePatchPath(value)
    .replace(/^---\s+/, "")
    .replace(/^\+\+\+\s+/, "")
    .replace(/^a\//, "")
    .replace(/^b\//, "")
    .trim();

const splitDiffFiles = (unifiedDiff: string): DiffFileBlock[] => {
  const lines = unifiedDiff.replace(/\r\n/g, "\n").split("\n");
  const files: DiffFileBlock[] = [];
  let current: DiffFileBlock | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) {
        files.push(current);
      }
      const parts = line.trim().split(/\s+/);
      current = {
        oldPath: cleanDiffPath(parts[2] || ""),
        newPath: cleanDiffPath(parts[3] || ""),
        lines: [line],
      };
      continue;
    }
    if (!current) {
      current = { oldPath: "", newPath: "", lines: [] };
    }
    if (line.startsWith("--- ")) {
      current.oldPath = cleanDiffPath(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      current.newPath = cleanDiffPath(line.slice(4));
    }
    current.lines.push(line);
  }

  if (current) {
    files.push(current);
  }
  return files.filter((file) =>
    file.lines.some((line) => line.startsWith("@@")),
  );
};

export const parseAIInlinePatchLines = (
  unifiedDiff: string,
  filePath: string,
): AIInlinePatchLine[] => {
  const changes: AIInlinePatchLine[] = [];
  for (const file of splitDiffFiles(unifiedDiff)) {
    const patchPath =
      file.newPath === "/dev/null" ? file.oldPath : file.newPath;
    if (!aiInlinePatchPathMatches(filePath, patchPath)) {
      continue;
    }

    let oldLine = 1;
    let newLine = 1;
    let inHunk = false;

    for (const line of file.lines) {
      const hunk = line.match(hunkHeaderPattern);
      if (hunk) {
        oldLine = Number(hunk[1] || "1");
        newLine = Number(hunk[2] || "1");
        inHunk = true;
        continue;
      }
      if (!inHunk || line.startsWith("\\ No newline")) {
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        changes.push({
          kind: "add",
          line: Math.max(1, newLine),
          text: line.slice(1),
        });
        newLine += 1;
        continue;
      }
      if (line.startsWith("-") && !line.startsWith("---")) {
        changes.push({
          kind: "remove",
          line: Math.max(1, oldLine),
          text: line.slice(1),
        });
        oldLine += 1;
        continue;
      }
      oldLine += 1;
      newLine += 1;
    }
  }
  return changes;
};

class AIInlinePatchLineWidget extends WidgetType {
  constructor(
    private readonly patchLine: AIInlinePatchLine,
    private readonly preview: AIInlinePatchPreview,
    private readonly onAccept: (preview: AIInlinePatchPreview) => void,
    private readonly onReject: (preview: AIInlinePatchPreview) => void,
    private readonly showActions: boolean,
  ) {
    super();
  }

  eq(other: AIInlinePatchLineWidget): boolean {
    return (
      other.patchLine.kind === this.patchLine.kind &&
      other.patchLine.line === this.patchLine.line &&
      other.patchLine.text === this.patchLine.text &&
      other.preview.id === this.preview.id &&
      other.preview.updatedAt === this.preview.updatedAt &&
      other.showActions === this.showActions
    );
  }

  toDOM(): HTMLElement {
    const row = document.createElement("div");
    row.className = `cm-ai-inline-patch-row cm-ai-inline-patch-row--${this.patchLine.kind}`;
    row.dataset.testid = "ai-inline-patch-line";

    const marker = document.createElement("span");
    marker.className = "cm-ai-inline-patch-marker";
    marker.textContent = this.patchLine.kind === "add" ? "+" : "-";

    const code = document.createElement("code");
    code.className = "cm-ai-inline-patch-code";
    code.textContent = this.patchLine.text || " ";

    row.append(marker, code);
    if (this.showActions) {
      row.append(
        createInlinePatchMiniActions(
          this.preview,
          this.onAccept,
          this.onReject,
        ),
      );
    }
    return row;
  }
}

const createInlinePatchMiniActions = (
  preview: AIInlinePatchPreview,
  onAccept: (preview: AIInlinePatchPreview) => void,
  onReject: (preview: AIInlinePatchPreview) => void,
): HTMLElement => {
  const actions = document.createElement("span");
  actions.className = "cm-ai-inline-patch-mini-actions";
  actions.dataset.testid = "ai-inline-patch-mini-actions";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.textContent = "Apply";
  accept.title = "Apply AI patch";
  accept.dataset.testid = "ai-inline-patch-mini-apply";
  accept.addEventListener("mousedown", stopEditorEvent);
  accept.addEventListener("click", (event) => {
    stopEditorEvent(event);
    onAccept(preview);
  });

  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = "Reject";
  reject.title = "Reject AI patch";
  reject.dataset.testid = "ai-inline-patch-mini-reject";
  reject.addEventListener("mousedown", stopEditorEvent);
  reject.addEventListener("click", (event) => {
    stopEditorEvent(event);
    onReject(preview);
  });

  actions.append(accept, reject);
  return actions;
};

class AIInlinePatchToolbarWidget extends WidgetType {
  constructor(
    private readonly preview: AIInlinePatchPreview,
    private readonly onAccept: (preview: AIInlinePatchPreview) => void,
    private readonly onReject: (preview: AIInlinePatchPreview) => void,
  ) {
    super();
  }

  eq(other: AIInlinePatchToolbarWidget): boolean {
    return (
      other.preview.id === this.preview.id &&
      other.preview.updatedAt === this.preview.updatedAt
    );
  }

  toDOM(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "cm-ai-inline-patch-toolbar";
    toolbar.dataset.testid = "ai-inline-patch-toolbar";

    const label = document.createElement("span");
    label.className = "cm-ai-inline-patch-title";
    label.textContent =
      this.preview.summary || this.preview.title || "AI patch";

    const actions = document.createElement("span");
    actions.className = "cm-ai-inline-patch-actions";

    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Apply";
    accept.dataset.testid = "ai-inline-patch-apply";
    accept.addEventListener("mousedown", stopEditorEvent);
    accept.addEventListener("click", (event) => {
      stopEditorEvent(event);
      this.onAccept(this.preview);
    });

    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = "Reject";
    reject.dataset.testid = "ai-inline-patch-reject";
    reject.addEventListener("mousedown", stopEditorEvent);
    reject.addEventListener("click", (event) => {
      stopEditorEvent(event);
      this.onReject(this.preview);
    });

    actions.append(accept, reject);
    toolbar.append(label, actions);
    return toolbar;
  }
}

const stopEditorEvent = (event: Event): void => {
  event.preventDefault();
  event.stopPropagation();
};

const lineToPosition = (state: EditorState, lineNumber: number): number => {
  if (state.doc.lines === 0) {
    return 0;
  }
  const boundedLine = Math.min(Math.max(1, lineNumber), state.doc.lines);
  if (lineNumber > state.doc.lines) {
    return state.doc.length;
  }
  return state.doc.line(boundedLine).from;
};

const buildDecorations = (
  state: EditorState,
  preview: AIInlinePatchPreview,
  filePath: string,
  onAccept: (preview: AIInlinePatchPreview) => void,
  onReject: (preview: AIInlinePatchPreview) => void,
): DecorationSet => {
  const changes = parseAIInlinePatchLines(preview.unifiedDiff, filePath);
  if (changes.length === 0) {
    return Decoration.none;
  }

  const decorations: Range<Decoration>[] = [];
  const firstLine = changes.reduce(
    (min, change) => Math.min(min, change.line),
    changes[0]?.line ?? 1,
  );
  decorations.push(
    Decoration.widget({
      widget: new AIInlinePatchToolbarWidget(preview, onAccept, onReject),
      block: true,
      side: -1,
    }).range(lineToPosition(state, firstLine)),
  );

  changes.forEach((change, index) => {
    decorations.push(
      Decoration.widget({
        widget: new AIInlinePatchLineWidget(
          change,
          preview,
          onAccept,
          onReject,
          index === 0,
        ),
        block: true,
        side: change.kind === "add" ? -1 : 0,
      }).range(lineToPosition(state, change.line)),
    );
  });

  return Decoration.set(
    decorations.sort((left, right) => left.from - right.from),
    true,
  );
};

export const createAIInlinePatchExtension = (options: {
  preview: AIInlinePatchPreview | null | undefined;
  filePath: string;
  onAccept: (preview: AIInlinePatchPreview) => void;
  onReject: (preview: AIInlinePatchPreview) => void;
}): Extension => {
  const { preview, filePath, onAccept, onReject } = options;
  if (!preview) {
    return [];
  }
  const activePreview = preview;

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(
        state,
        activePreview,
        filePath,
        onAccept,
        onReject,
      );
    },
    update(value, transaction) {
      if (!transaction.docChanged) {
        return value;
      }
      return buildDecorations(
        transaction.state,
        activePreview,
        filePath,
        onAccept,
        onReject,
      );
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  return [
    field,
    EditorView.baseTheme({
      ".cm-ai-inline-patch-toolbar": {
        alignItems: "center",
        background:
          "color-mix(in srgb, var(--bubble-bg, #f7f7f7) 92%, #ffffff)",
        border:
          "1px solid color-mix(in srgb, var(--accent, #3aa76d) 35%, transparent)",
        borderRadius: "8px",
        boxShadow: "0 8px 22px color-mix(in srgb, #000000 12%, transparent)",
        boxSizing: "border-box",
        color: "var(--text-primary, #1f2328)",
        display: "flex",
        fontFamily: "var(--ui-font-family, inherit)",
        fontSize: "12px",
        gap: "10px",
        justifyContent: "space-between",
        margin: "4px 10px 4px 2px",
        maxWidth: "min(760px, calc(100% - 24px))",
        minHeight: "32px",
        padding: "5px 7px 5px 10px",
      },
      ".cm-ai-inline-patch-title": {
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
      ".cm-ai-inline-patch-actions": {
        display: "inline-flex",
        flexShrink: "0",
        gap: "5px",
      },
      ".cm-ai-inline-patch-actions button": {
        alignItems: "center",
        border: "1px solid var(--border-primary, rgba(0,0,0,0.12))",
        borderRadius: "7px",
        cursor: "pointer",
        display: "inline-flex",
        font: "inherit",
        height: "24px",
        padding: "0 9px",
      },
      ".cm-ai-inline-patch-actions button:first-child": {
        background: "color-mix(in srgb, #28a745 14%, transparent)",
        color: "var(--success, #22863a)",
      },
      ".cm-ai-inline-patch-actions button:last-child": {
        background: "color-mix(in srgb, #d73a49 10%, transparent)",
        color: "var(--danger, #b31d28)",
      },
      ".cm-ai-inline-patch-row": {
        boxSizing: "border-box",
        display: "grid",
        fontFamily: "var(--editor-font-family, monospace)",
        fontSize: "inherit",
        gridTemplateColumns: "22px minmax(0, 1fr) auto",
        lineHeight: "1.55",
        margin: "0 10px 0 2px",
        maxWidth: "min(920px, calc(100% - 24px))",
        minHeight: "22px",
        overflow: "hidden",
        padding: "0 8px 0 0",
      },
      ".cm-ai-inline-patch-row--add": {
        background: "color-mix(in srgb, #28a745 12%, transparent)",
        borderLeft: "2px solid color-mix(in srgb, #28a745 70%, transparent)",
      },
      ".cm-ai-inline-patch-row--remove": {
        background: "color-mix(in srgb, #d73a49 10%, transparent)",
        borderLeft: "2px solid color-mix(in srgb, #d73a49 70%, transparent)",
      },
      ".cm-ai-inline-patch-marker": {
        opacity: "0.78",
        textAlign: "center",
        userSelect: "none",
      },
      ".cm-ai-inline-patch-code": {
        display: "block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "pre",
      },
      ".cm-ai-inline-patch-mini-actions": {
        alignItems: "center",
        alignSelf: "center",
        display: "inline-flex",
        gap: "4px",
        marginLeft: "8px",
        opacity: "0",
        pointerEvents: "none",
        transition: "opacity 120ms ease",
      },
      ".cm-ai-inline-patch-row:hover .cm-ai-inline-patch-mini-actions, .cm-ai-inline-patch-mini-actions:focus-within":
        {
          opacity: "1",
          pointerEvents: "auto",
        },
      ".cm-ai-inline-patch-mini-actions button": {
        border: "1px solid var(--border-primary, rgba(0,0,0,0.12))",
        borderRadius: "6px",
        cursor: "pointer",
        font: "11px var(--ui-font-family, inherit)",
        height: "20px",
        padding: "0 7px",
      },
      ".cm-ai-inline-patch-mini-actions button:first-child": {
        background: "color-mix(in srgb, #28a745 15%, transparent)",
        color: "var(--success, #22863a)",
      },
      ".cm-ai-inline-patch-mini-actions button:last-child": {
        background: "color-mix(in srgb, #d73a49 11%, transparent)",
        color: "var(--danger, #b31d28)",
      },
    }),
  ];
};
