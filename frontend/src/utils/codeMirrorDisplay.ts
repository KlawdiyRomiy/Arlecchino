import { zIndex } from "../styles/colors";

export const LARGE_DOC_LINE_THRESHOLD = 2000;
export const LARGE_DOC_CHAR_THRESHOLD = 1_000_000;
export const CODEMIRROR_TOOLTIP_Z_INDEX = zIndex.tooltip;

type CodeMirrorDocumentLike = string | number | { lines: number };

export function getCodeMirrorLineCount(doc: CodeMirrorDocumentLike): number {
  if (typeof doc === "number") {
    return doc;
  }

  if (typeof doc === "string") {
    if (doc.length === 0) {
      return 1;
    }

    let lines = 1;
    for (let index = 0; index < doc.length; index += 1) {
      if (doc.charCodeAt(index) === 10) {
        lines += 1;
      }
    }
    return lines;
  }

  return doc.lines;
}

function getCodeMirrorCharCount(doc: CodeMirrorDocumentLike): number {
  return typeof doc === "string" ? doc.length : 0;
}

export function shouldUseCodeMirrorLargeDocumentMode(
  doc: CodeMirrorDocumentLike,
): boolean {
  if (getCodeMirrorCharCount(doc) > LARGE_DOC_CHAR_THRESHOLD) {
    return true;
  }

  return getCodeMirrorLineCount(doc) > LARGE_DOC_LINE_THRESHOLD;
}

export function shouldEnableCodeMirrorMinimap(
  doc: CodeMirrorDocumentLike,
): boolean {
  return !shouldUseCodeMirrorLargeDocumentMode(doc);
}
