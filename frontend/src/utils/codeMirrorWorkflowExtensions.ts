import type { Extension } from "@codemirror/state";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { keymap } from "@codemirror/view";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { color } from "@uiw/codemirror-extensions-color";

export function createCodeMirrorFoldExtensions(
  showGutter: boolean,
  enableKeymap: boolean,
): Extension[] {
  const extensions: Extension[] = [];

  if (showGutter) {
    extensions.push(foldGutter());
  }
  if (enableKeymap) {
    extensions.push(keymap.of(foldKeymap));
  }

  return extensions;
}

export function createCodeMirrorLintExtensions(
  showGutter: boolean,
  enableNavigation: boolean,
): Extension[] {
  const extensions: Extension[] = [];

  if (showGutter) {
    extensions.push(lintGutter());
  }
  if (enableNavigation) {
    extensions.push(keymap.of(lintKeymap));
  }

  return extensions;
}

export function createCodeMirrorIndentGuideExtension(
  enabled: boolean,
): Extension {
  return enabled
    ? indentationMarkers({
        highlightActiveBlock: false,
        hideFirstIndent: true,
        markerType: "codeOnly",
        thickness: 1,
      })
    : [];
}

export function createCodeMirrorColorToolExtension(
  enabled: boolean,
): Extension {
  return enabled ? color : [];
}
