import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "thememirror";

import { radius, shadows, transitions, zIndex } from "../styles/colors";

const editorPalette = {
  background: "#050505",
  surface: "#080808",
  surfaceElevated: "#0d0d0d",
  gutter: "#070707",
  scrollbarTrack: "#020202",
  scrollbarThumb: "#4f4f4f",
  scrollbarThumbHover: "#686868",
  border: "rgba(255, 255, 255, 0.09)",
  borderStrong: "rgba(255, 255, 255, 0.14)",
  text: "#d7e0ea",
  textSoft: "#8b9bb0",
  textMuted: "#66758a",
  caret: "#f5f7fb",
  activeLine: "rgba(255, 255, 255, 0.035)",
  activeLineGutter: "#aebcd0",
  selection: "rgba(255, 255, 255, 0.14)",
  selectionInactive: "rgba(255, 255, 255, 0.1)",
  selectionMatch: "rgba(255, 255, 255, 0.08)",
  bracketMatch: "rgba(255, 255, 255, 0.1)",
  searchMatch: "rgba(255, 255, 255, 0.06)",
  tooltipShadow:
    "0 14px 34px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(255, 255, 255, 0.045)",
  ghostText: "rgba(200, 200, 200, 0.34)",
  highlight: "rgba(125, 211, 252, 0.14)",
  comment: "#5f6b7a",
  string: "#a8d6a2",
  number: "#f2b47e",
  keyword: "#8fb4ff",
  operator: "#9baec5",
  type: "#f3cf92",
  property: "#8bd5ff",
  function: "#9ecbff",
  variable: "#d7e0ea",
  constant: "#f0c48a",
  accent: "#ffffff",
};

export const codeEditorTheme = createTheme({
  variant: "dark",
  settings: {
    background: editorPalette.background,
    foreground: editorPalette.text,
    caret: editorPalette.caret,
    selection: editorPalette.selection,
    lineHighlight: editorPalette.activeLine,
    gutterBackground: editorPalette.gutter,
    gutterForeground: editorPalette.textMuted,
  },
  styles: [
    {
      tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
      color: editorPalette.comment,
    },
    {
      tag: [t.string, t.special(t.string), t.literal],
      color: editorPalette.string,
    },
    { tag: [t.number, t.bool, t.null], color: editorPalette.number },
    {
      tag: [t.keyword, t.modifier, t.controlKeyword],
      color: editorPalette.keyword,
    },
    {
      tag: [
        t.operator,
        t.punctuation,
        t.paren,
        t.squareBracket,
        t.brace,
        t.derefOperator,
      ],
      color: editorPalette.operator,
    },
    {
      tag: [t.className, t.definition(t.typeName), t.typeName, t.namespace],
      color: editorPalette.type,
    },
    {
      tag: [
        t.tagName,
        t.propertyName,
        t.attributeName,
        t.labelName,
        t.definition(t.variableName),
      ],
      color: editorPalette.property,
    },
    {
      tag: [t.function(t.variableName), t.macroName],
      color: editorPalette.function,
    },
    { tag: [t.variableName, t.self], color: editorPalette.variable },
    { tag: t.constant(t.variableName), color: editorPalette.constant },
  ],
});

export const codeEditorStyles = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: editorPalette.text,
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
      backgroundColor: editorPalette.background,
      letterSpacing: "0.01em",
      transition: `background-color ${transitions.fast}, box-shadow ${transitions.fast}, border-color ${transitions.fast}`,
    },
    "&.cm-focused": {
      outline: "none",
      boxShadow: `inset 0 0 0 1px ${editorPalette.borderStrong}`,
    },
    ".cm-scroller": {
      backgroundColor: editorPalette.background,
      overflow: "auto",
      lineHeight: "1.72",
      scrollbarWidth: "thin",
      scrollbarColor: `${editorPalette.scrollbarThumb} ${editorPalette.scrollbarTrack}`,
      contain: "strict",
      backfaceVisibility: "hidden",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "10px",
      height: "10px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
      background: editorPalette.scrollbarTrack,
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      background: editorPalette.scrollbarThumb,
      borderRadius: radius.full,
      border: `2px solid ${editorPalette.scrollbarTrack}`,
      backgroundClip: "padding-box",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      background: editorPalette.scrollbarThumbHover,
      backgroundClip: "padding-box",
    },
    ".cm-content": {
      padding: "14px 0 28px",
      caretColor: editorPalette.caret,
      backgroundColor: editorPalette.background,
    },
    ".cm-line": {
      padding: "0 18px 0 14px",
    },
    ".cm-gutters": {
      backgroundColor: editorPalette.gutter,
      color: editorPalette.textMuted,
      borderRight: `1px solid ${editorPalette.border}`,
      minWidth: "42px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 12px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: editorPalette.activeLineGutter,
    },
    ".cm-activeLine": {
      backgroundColor: editorPalette.activeLine,
    },
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: `${editorPalette.selection} !important`,
    },
    "&.cm-focused .cm-selectionBackground, &.cm-focused .cm-content ::selection":
      {
        backgroundColor: `${editorPalette.selection} !important`,
      },
    "& .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: `${editorPalette.selection} !important`,
    },
    "&:not(.cm-focused) .cm-selectionBackground": {
      backgroundColor: `${editorPalette.selectionInactive} !important`,
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: editorPalette.caret,
      borderLeftWidth: "1.5px",
    },
    ".cm-foldGutter": {
      width: "12px",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: editorPalette.surface,
      border: `1px solid ${editorPalette.border}`,
      color: editorPalette.textSoft,
      borderRadius: radius.sm,
    },
    ".cm-panels": {
      backgroundColor: editorPalette.surface,
      color: editorPalette.text,
      borderBottom: `1px solid ${editorPalette.border}`,
    },
    ".cm-panels .cm-search": {
      padding: "10px 12px",
      gap: "8px",
    },
    ".cm-search input, .cm-search button, .cm-search label": {
      color: editorPalette.textSoft,
    },
    ".cm-search input": {
      backgroundColor: editorPalette.background,
      border: `1px solid ${editorPalette.border}`,
      borderRadius: radius.sm,
    },
    ".cm-tooltip": {
      backgroundColor: "rgba(0, 0, 0, 0.97)",
      border: `1px solid ${editorPalette.border}`,
      borderRadius: radius.md,
      boxShadow: editorPalette.tooltipShadow,
      zIndex: String(zIndex.tooltip),
      backfaceVisibility: "hidden",
    },
    ".cm-tooltip-autocomplete": {
      backgroundColor: "rgba(0, 0, 0, 0.985)",
      border: `1px solid ${editorPalette.border}`,
      borderRadius: "14px",
      boxShadow: editorPalette.tooltipShadow,
      minWidth: "360px",
      maxWidth: "720px",
      width: "fit-content",
      maxHeight: "420px",
      padding: "4px",
      overflow: "hidden",
      opacity: "1",
      transform: "translate3d(0, 0, 0)",
      willChange: "transform, opacity",
      transition:
        "opacity 110ms ease-out, transform 110ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
      zIndex: String(zIndex.tooltip),
      contain: "layout paint style",
      backfaceVisibility: "hidden",
      animation: "codeEditorPopupIn 150ms cubic-bezier(0.2, 0.9, 0.28, 1.03)",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
      fontSize: "14px",
      lineHeight: "1.5",
      maxHeight: "396px",
      maxWidth: "none",
      minWidth: "100%",
      overflowY: "auto",
      overflowX: "hidden",
      scrollbarWidth: "thin",
      scrollbarColor: `${editorPalette.scrollbarThumb} ${editorPalette.scrollbarTrack}`,
      padding: "2px 0",
      margin: "0",
      transform: "translateZ(0)",
      willChange: "transform, opacity",
      contain: "content",
      overscrollBehavior: "contain",
      backgroundColor: "#050505",
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar": {
      width: "8px",
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-track": {
      background: editorPalette.scrollbarTrack,
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb": {
      background: editorPalette.scrollbarThumb,
      borderRadius: radius.full,
      border: `1px solid ${editorPalette.scrollbarTrack}`,
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb:hover": {
      background: editorPalette.scrollbarThumbHover,
    },
    ".cm-tooltip-autocomplete > ul > li": {
      padding: "10px 14px 10px 12px",
      margin: "0 2px",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      minHeight: "38px",
      borderRadius: "9px",
      borderLeft: "2px solid transparent",
      letterSpacing: "0.01em",
      overflow: "hidden",
      textOverflow: "ellipsis",
      cursor: "pointer",
      transform: "translate3d(0, 0, 0)",
      contain: "layout style paint",
      transition: `background-color ${transitions.fast}, border-color ${transitions.fast}, color ${transitions.fast}`,
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background:
        "linear-gradient(180deg, rgba(255,255,255,0.085), rgba(255,255,255,0.06))",
      borderLeftColor: editorPalette.accent,
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
    },
    ".cm-tooltip-autocomplete > ul > li:hover:not([aria-selected])": {
      backgroundColor: "rgba(255, 255, 255, 0.04)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionLabel": {
      color: "#ffffff",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
      color: "#b7c4d4",
      opacity: "0.95",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionSource": {
      backgroundColor: "#101010",
      borderColor: "rgba(255,255,255,0.08)",
      color: "#d4d9e1",
    },
    ".cm-completionIcon": {
      width: "18px",
      minWidth: "18px",
      marginRight: "4px",
      textAlign: "center",
      fontSize: "12px",
      color: editorPalette.textSoft,
      opacity: "0.88",
    },
    ".cm-completionLabel": {
      color: editorPalette.text,
      flex: "0 1 auto",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      fontWeight: "500",
    },
    ".cm-completionMatchedText": {
      color: "#ffffff",
      fontWeight: "700",
      textDecoration: "underline",
      textDecorationColor: "rgba(255,255,255,0.9)",
      textDecorationThickness: "1px",
      textUnderlineOffset: "0.18em",
    },
    ".cm-completionDetail": {
      color: editorPalette.textSoft,
      flex: "1 1 auto",
      paddingLeft: "10px",
      fontSize: "12px",
      opacity: "0.82",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    ".cm-completionSource": {
      color: editorPalette.textSoft,
      backgroundColor: "#0a0a0a",
      border: `1px solid ${editorPalette.border}`,
      borderRadius: radius.full,
      padding: "3px 9px",
      fontSize: "11px",
      flexShrink: "0",
      minWidth: "max-content",
      textAlign: "right",
      whiteSpace: "nowrap",
      marginLeft: "10px",
      overflow: "hidden",
      opacity: "0.92",
      letterSpacing: "0.02em",
    },
    ".cm-completionInfo": {
      padding: "12px 14px",
      borderTop: `1px solid ${editorPalette.border}`,
      backgroundColor: "#050505",
      fontSize: "12px",
      color: editorPalette.textSoft,
      maxHeight: "180px",
      overflowY: "auto",
      scrollbarWidth: "thin",
      scrollbarColor: `${editorPalette.scrollbarThumb} ${editorPalette.scrollbarTrack}`,
    },
    ".cm-completionInfo::-webkit-scrollbar": {
      width: "8px",
    },
    ".cm-completionInfo::-webkit-scrollbar-track": {
      background: editorPalette.scrollbarTrack,
    },
    ".cm-completionInfo::-webkit-scrollbar-thumb": {
      background: editorPalette.scrollbarThumb,
      borderRadius: radius.full,
      border: `1px solid ${editorPalette.scrollbarTrack}`,
    },
    ".cm-completionInfo code": {
      backgroundColor: editorPalette.background,
      padding: "3px 7px",
      borderRadius: radius.sm,
      fontFamily: '"JetBrains Mono", "SF Mono", monospace',
      fontSize: "11px",
    },
    ".cm-tooltip-hover": {
      padding: "10px 12px",
      color: editorPalette.textSoft,
      maxWidth: "420px",
    },
    ".cm-tooltip-hover code": {
      color: editorPalette.text,
      whiteSpace: "pre-wrap",
    },
    ".cm-tooltip-signature": {
      padding: "10px 12px",
      maxWidth: "460px",
    },
    ".cm-signature-label": {
      color: editorPalette.text,
      fontWeight: "600",
      marginBottom: "6px",
    },
    ".cm-signature-params": {
      display: "grid",
      gap: "4px",
    },
    ".cm-signature-param": {
      color: editorPalette.textSoft,
      fontSize: "12px",
    },
    ".cm-signature-param-active": {
      color: editorPalette.text,
    },
    ".cm-signature-doc": {
      color: editorPalette.textSoft,
      fontSize: "12px",
    },
    ".ghost-text-suggestion": {
      color: editorPalette.ghostText,
      fontStyle: "normal",
    },
    ".definition-link-hover": {
      textDecoration: "underline",
      textDecorationColor: "rgba(120, 196, 255, 0.55)",
      textUnderlineOffset: "0.18em",
    },
    ".perspective-highlight": {
      backgroundColor: editorPalette.highlight,
      boxShadow: `inset 3px 0 0 ${editorPalette.accent}`,
    },
    ".cm-matchingBracket": {
      backgroundColor: editorPalette.bracketMatch,
      outline: `1px solid ${editorPalette.borderStrong}`,
      color: editorPalette.text,
    },
    ".cm-searchMatch": {
      backgroundColor: editorPalette.searchMatch,
      outline: `1px solid ${editorPalette.border}`,
    },
    ".cm-selectionMatch": {
      backgroundColor: editorPalette.selectionMatch,
    },
    ".cm-git-gutter": {
      backgroundColor: editorPalette.gutter,
    },
    "@keyframes codeEditorPopupIn": {
      "0%": {
        opacity: "0",
        transform: "translate3d(0, 4px, 0) scale(0.988)",
      },
      "65%": {
        opacity: "1",
        transform: "translate3d(0, -1px, 0) scale(1.004)",
      },
      "100%": {
        opacity: "1",
        transform: "translate3d(0, 0, 0) scale(1)",
      },
    },
  },
  { dark: true },
);

export const codeEditorSurfaceClassName =
  "h-full rounded-none border-0 bg-transparent shadow-none";

export const editorCanvasBackground = editorPalette.background;

export const codeEditorChromeStyle = {
  background:
    "radial-gradient(circle at top, rgba(255,255,255,0.03), transparent 24%), #050505",
  boxShadow: shadows.panelDark,
} as const;
