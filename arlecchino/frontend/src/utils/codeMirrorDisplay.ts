import { zIndex } from "../styles/colors";

export const LARGE_DOC_LINE_THRESHOLD = 2000;
export const CODEMIRROR_TOOLTIP_Z_INDEX = zIndex.tooltip;

type CodeMirrorDocumentLike = string | number | { lines: number };

function getCodeMirrorLineCount(doc: CodeMirrorDocumentLike): number {
  if (typeof doc === "number") {
    return doc;
  }

  if (typeof doc === "string") {
    return doc.length === 0 ? 1 : doc.split("\n").length;
  }

  return doc.lines;
}

export function shouldEnableCodeMirrorMinimap(
  doc: CodeMirrorDocumentLike,
): boolean {
  return getCodeMirrorLineCount(doc) <= LARGE_DOC_LINE_THRESHOLD;
}
