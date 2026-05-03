import { type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const enabledOperatorLigatureTheme = EditorView.theme({
  "&": {
    fontVariantLigatures: "common-ligatures contextual !important",
    fontFeatureSettings: '"liga" 1, "calt" 1 !important',
  },
  ".cm-scroller": {
    fontVariantLigatures: "common-ligatures contextual !important",
    fontFeatureSettings: '"liga" 1, "calt" 1 !important',
  },
  ".cm-content": {
    fontVariantLigatures: "common-ligatures contextual !important",
    fontFeatureSettings: '"liga" 1, "calt" 1 !important',
  },
  ".cm-line": {
    fontVariantLigatures: "common-ligatures contextual !important",
    fontFeatureSettings: '"liga" 1, "calt" 1 !important',
  },
});

const disabledOperatorLigatureTheme = EditorView.theme({
  "&": {
    fontVariantLigatures: "none !important",
    fontFeatureSettings: '"liga" 0, "calt" 0 !important',
  },
  ".cm-scroller": {
    fontVariantLigatures: "none !important",
    fontFeatureSettings: '"liga" 0, "calt" 0 !important',
  },
  ".cm-content": {
    fontVariantLigatures: "none !important",
    fontFeatureSettings: '"liga" 0, "calt" 0 !important',
  },
  ".cm-line": {
    fontVariantLigatures: "none !important",
    fontFeatureSettings: '"liga" 0, "calt" 0 !important',
  },
});

export const createOperatorLigaturesExtension = (
  enabled: boolean,
): Extension =>
  enabled ? enabledOperatorLigatureTheme : disabledOperatorLigatureTheme;
