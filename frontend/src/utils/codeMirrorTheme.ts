import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "thememirror";

import { radius, transitions, zIndex } from "../styles/colors";

const defaultEditorFontFamily =
  '"Arlecchino Fira Code", "JetBrains Mono", "SF Mono", "Fira Code", monospace';
const editorFontFamily = `var(--editor-font-family, ${defaultEditorFontFamily})`;
const editorFontSize = "var(--editor-font-size, 14px)";

const rainbowBracketPalette = {
  red: "var(--editor-rainbow-bracket-red, #ff5c7a)",
  orange: "var(--editor-rainbow-bracket-orange, #ff9f43)",
  yellow: "var(--editor-rainbow-bracket-yellow, #d6b300)",
  green: "var(--editor-rainbow-bracket-green, #2fd17c)",
  blue: "var(--editor-rainbow-bracket-blue, #4da3ff)",
  indigo: "var(--editor-rainbow-bracket-indigo, #9b7bff)",
  violet: "var(--editor-rainbow-bracket-violet, #e46bff)",
};

const rainbowBracketColor = (color: string) => `${color} !important`;

const rainbowBracketRules = {
  ".cm-content .rainbow-bracket-red, .cm-content .rainbow-bracket-red > span, .cm-content .rainbow-bracket-red span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.red),
    },
  ".cm-content .rainbow-bracket-orange, .cm-content .rainbow-bracket-orange > span, .cm-content .rainbow-bracket-orange span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.orange),
    },
  ".cm-content .rainbow-bracket-yellow, .cm-content .rainbow-bracket-yellow > span, .cm-content .rainbow-bracket-yellow span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.yellow),
    },
  ".cm-content .rainbow-bracket-green, .cm-content .rainbow-bracket-green > span, .cm-content .rainbow-bracket-green span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.green),
    },
  ".cm-content .rainbow-bracket-blue, .cm-content .rainbow-bracket-blue > span, .cm-content .rainbow-bracket-blue span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.blue),
    },
  ".cm-content .rainbow-bracket-indigo, .cm-content .rainbow-bracket-indigo > span, .cm-content .rainbow-bracket-indigo span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.indigo),
    },
  ".cm-content .rainbow-bracket-violet, .cm-content .rainbow-bracket-violet > span, .cm-content .rainbow-bracket-violet span":
    {
      color: rainbowBracketColor(rainbowBracketPalette.violet),
    },
};

const editorPalette = {
  background: "var(--editor-bg, #050505)",
  surface: "var(--editor-surface, #080808)",
  surfaceElevated: "var(--editor-surface-elevated, #0d0d0d)",
  gutter: "var(--editor-gutter, #070707)",
  scrollbarTrack: "var(--editor-scrollbar-track, #020202)",
  scrollbarThumb: "var(--editor-scrollbar-thumb, #4f4f4f)",
  scrollbarThumbHover: "var(--editor-scrollbar-thumb-hover, #686868)",
  border: "var(--editor-border, rgba(255, 255, 255, 0.09))",
  borderStrong: "var(--editor-border-strong, rgba(255, 255, 255, 0.14))",
  text: "var(--editor-text, #d7e0ea)",
  textSoft: "var(--editor-text-soft, #8b9bb0)",
  textMuted: "var(--editor-text-muted, #66758a)",
  caret: "var(--editor-caret, #f5f7fb)",
  activeLine: "var(--editor-active-line, rgba(255, 255, 255, 0.035))",
  activeLineGutter: "var(--editor-active-line-gutter, #aebcd0)",
  selection: "var(--editor-selection, rgba(255, 255, 255, 0.14))",
  selectionInactive:
    "var(--editor-selection-inactive, rgba(255, 255, 255, 0.1))",
  selectionMatch: "var(--editor-selection-match, rgba(255, 255, 255, 0.08))",
  bracketMatch: "var(--editor-bracket-match, rgba(255, 255, 255, 0.1))",
  searchMatch: "var(--editor-search-match, rgba(255, 255, 255, 0.06))",
  tooltipBg: "var(--editor-tooltip-bg, rgba(14, 14, 14, 0.985))",
  tooltipBgStrong: "var(--editor-tooltip-bg-strong, rgba(13, 13, 13, 0.99))",
  tooltipShadow:
    "var(--editor-tooltip-shadow, 0 18px 40px -24px rgba(0, 0, 0, 0.84))",
  ghostText: "var(--editor-ghost-text, rgba(200, 200, 200, 0.34))",
  highlight: "var(--editor-highlight, rgba(125, 211, 252, 0.14))",
  comment: "var(--syntax-comment, #5f6b7a)",
  string: "var(--syntax-string, #a8d6a2)",
  number: "var(--syntax-number, #f2b47e)",
  keyword: "var(--syntax-keyword, #8fb4ff)",
  operator: "var(--syntax-operator, #9baec5)",
  type: "var(--syntax-type, #f3cf92)",
  property: "var(--syntax-property, #8bd5ff)",
  function: "var(--syntax-function, #9ecbff)",
  variable: "var(--syntax-variable, #d7e0ea)",
  constant: "var(--syntax-constant, #f0c48a)",
  accent: "var(--editor-accent, #ffffff)",
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
      fontFamily: editorFontFamily,
      fontSize: editorFontSize,
      backgroundColor: editorPalette.background,
      letterSpacing: "0",
    },
    "&.cm-focused": {
      outline: "none",
      boxShadow: `inset 0 0 0 1px ${editorPalette.borderStrong}`,
    },
    ".cm-scroller": {
      backgroundColor: editorPalette.background,
      color: editorPalette.text,
      fontFamily: editorFontFamily,
      overflow: "auto",
      lineHeight: "1.72",
      scrollbarWidth: "thin",
      scrollbarColor: `${editorPalette.scrollbarThumb} ${editorPalette.scrollbarTrack}`,
      scrollbarGutter: "stable",
      overflowAnchor: "none",
      contain: "layout style",
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
      color: editorPalette.text,
      fontFamily: editorFontFamily,
      caretColor: editorPalette.caret,
      backgroundColor: editorPalette.background,
    },
    ".cm-line": {
      padding: "0 18px 0 14px",
      color: editorPalette.text,
      fontFamily: editorFontFamily,
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
    ".cm-panels.cm-panels-top:has(.cm-mini-search)": {
      height: "0",
      overflow: "visible",
      pointerEvents: "none",
      backgroundColor: "transparent",
      borderBottom: "0",
      zIndex: String(zIndex.tooltip),
    },
    ".cm-panels .cm-search": {
      padding: "10px 12px",
      gap: "8px",
    },
    ".cm-panels .cm-mini-search": {
      position: "absolute",
      top: "10px",
      right: "14px",
      display: "flex",
      alignItems: "center",
      width: "min(360px, calc(100vw - 48px))",
      minHeight: "36px",
      boxSizing: "border-box",
      pointerEvents: "auto",
      padding: "5px",
      gap: "4px",
      borderRadius: radius.md,
      border: `1px solid ${editorPalette.borderStrong}`,
      background:
        "color-mix(in srgb, var(--editor-tooltip-bg) 94%, transparent)",
      boxShadow: editorPalette.tooltipShadow,
      backdropFilter: "blur(18px)",
    },
    ".cm-search input, .cm-search button, .cm-search label": {
      color: editorPalette.textSoft,
    },
    ".cm-search input": {
      backgroundColor: editorPalette.background,
      border: `1px solid ${editorPalette.border}`,
      borderRadius: radius.sm,
    },
    ".cm-mini-search input": {
      minWidth: "0",
      flex: "1 1 160px",
      height: "26px",
      padding: "0 9px",
      fontSize: "12px",
      color: editorPalette.text,
      outline: "none",
    },
    ".cm-mini-search-count": {
      minWidth: "34px",
      padding: "0 5px",
      color: editorPalette.textSoft,
      fontSize: "11px",
      fontVariantNumeric: "tabular-nums",
      textAlign: "center",
      whiteSpace: "nowrap",
    },
    ".cm-mini-search[data-invalid='true'] input": {
      borderColor: "var(--status-error, #ff6b6b)",
    },
    ".cm-mini-search button": {
      height: "26px",
      minWidth: "26px",
      padding: "0 7px",
      border: `1px solid ${editorPalette.border}`,
      borderRadius: radius.sm,
      backgroundColor: "transparent",
      color: editorPalette.textSoft,
      fontSize: "13px",
      lineHeight: "24px",
    },
    ".cm-mini-search button:hover": {
      color: editorPalette.text,
      borderColor: editorPalette.borderStrong,
      backgroundColor: editorPalette.selectionMatch,
    },
    ".cm-mini-search button[name='close']": {
      position: "static !important",
      top: "auto !important",
      right: "auto !important",
      margin: "0 !important",
      border: `1px solid ${editorPalette.border}`,
      backgroundColor: "transparent",
      minWidth: "26px",
      padding: "0",
    },
    ".cm-tooltip": {
      backgroundColor: editorPalette.tooltipBg,
      border: `1px solid ${editorPalette.border}`,
      borderRadius: radius.md,
      boxShadow: editorPalette.tooltipShadow,
      zIndex: String(zIndex.tooltip),
      backfaceVisibility: "hidden",
    },
    ".cm-tooltip-autocomplete": {
      background: `linear-gradient(180deg, ${editorPalette.tooltipBg}, ${editorPalette.tooltipBgStrong})`,
      border: `1px solid ${editorPalette.borderStrong}`,
      borderRadius: "22px",
      boxShadow: editorPalette.tooltipShadow,
      boxSizing: "border-box",
      minWidth: "min(360px, calc(100vw - 32px))",
      maxWidth: "min(620px, calc(100vw - 32px))",
      width: "fit-content",
      maxHeight: "320px",
      padding: "8px",
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
      fontFamily: editorFontFamily,
      fontSize: "13px",
      lineHeight: "1.45",
      maxHeight: "282px",
      maxWidth: "100%",
      minWidth: "100%",
      width: "100%",
      boxSizing: "border-box",
      overflowY: "auto",
      overflowX: "hidden",
      scrollbarWidth: "thin",
      scrollbarColor: `${editorPalette.scrollbarThumb} ${editorPalette.scrollbarTrack}`,
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "0",
      margin: "0",
      transform: "translateZ(0)",
      willChange: "transform, opacity",
      contain: "layout paint style",
      overscrollBehavior: "contain",
      backgroundColor: "transparent",
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar": {
      width: "6px",
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-track": {
      background: "transparent",
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb": {
      background: editorPalette.scrollbarThumb,
      borderRadius: radius.full,
      border: `1px solid ${editorPalette.tooltipBgStrong}`,
    },
    ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb:hover": {
      background: editorPalette.scrollbarThumbHover,
    },
    ".cm-tooltip-autocomplete > ul > li": {
      position: "relative",
      padding: "8px 10px",
      margin: "0",
      display: "flex",
      alignItems: "center",
      gap: "9px",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
      minHeight: "46px",
      borderRadius: "17px",
      border: "1px solid transparent",
      letterSpacing: "0",
      backgroundColor: "transparent",
      minWidth: "0",
      overflow: "hidden",
      textOverflow: "clip",
      cursor: "pointer",
      transform: "translate3d(0, 0, 0)",
      contain: "layout style paint",
      transition: `background-color ${transitions.fast}, border-color ${transitions.fast}, color ${transitions.fast}, box-shadow ${transitions.fast}`,
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background: `linear-gradient(180deg, color-mix(in srgb, ${editorPalette.accent} 10%, transparent), color-mix(in srgb, ${editorPalette.accent} 6%, transparent))`,
      borderColor: editorPalette.borderStrong,
      boxShadow: "inset 0 1px 0 var(--shell-inner-highlight)",
    },
    ".cm-tooltip-autocomplete > ul > li:hover:not([aria-selected])": {
      backgroundColor: "var(--surface-hover)",
      borderColor: editorPalette.border,
    },
    ".cm-tooltip-autocomplete > ul > li::after": {
      content: '"Enter"',
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "24px",
      minWidth: "58px",
      flex: "0 0 58px",
      borderRadius: radius.full,
      border: "1px solid transparent",
      background: "transparent",
      padding: "0 11px",
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.12em",
      color: "transparent",
      textTransform: "uppercase",
      opacity: "0",
      visibility: "hidden",
      pointerEvents: "none",
      boxSizing: "border-box",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]::after": {
      borderColor: editorPalette.border,
      background: editorPalette.surface,
      color: editorPalette.textMuted,
      opacity: "1",
      visibility: "visible",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionLabel": {
      color: editorPalette.text,
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
      color: editorPalette.textSoft,
      opacity: "0.9",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionSource": {
      color: editorPalette.textSoft,
    },
    ".cm-completionIcon": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "32px",
      height: "24px",
      minWidth: "32px",
      marginRight: "0",
      border: "1px solid transparent",
      borderRadius: "12px",
      background: "transparent",
      textAlign: "center",
      fontSize: "0",
      color: editorPalette.textSoft,
      lineHeight: "1",
      opacity: "0.9",
    },
    ".cm-completionIcon::after": {
      content: '"fn"',
      fontSize: "12px",
      fontWeight: "600",
      letterSpacing: "0.02em",
      color: editorPalette.textSoft,
    },
    ".cm-completionIcon-variable::after, .cm-completionIcon-property::after": {
      content: '"var"',
      fontSize: "11px",
    },
    ".cm-completionIcon-class::after, .cm-completionIcon-interface::after": {
      content: '"type"',
      fontSize: "10px",
    },
    ".cm-completionIcon-keyword::after": {
      content: '"key"',
      fontSize: "11px",
    },
    ".cm-completionIcon-text::after": {
      content: '"abc"',
      fontSize: "10px",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon": {
      borderColor: editorPalette.border,
      background: editorPalette.surface,
    },
    ".cm-completionLabel": {
      color: editorPalette.text,
      flex: "0 1 auto",
      minWidth: "0",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "clip",
      whiteSpace: "nowrap",
      fontWeight: "500",
    },
    ".cm-completionMatchedText": {
      color: editorPalette.accent,
      fontWeight: "650",
      textDecoration: "none",
    },
    ".cm-completionDetail": {
      color: editorPalette.textMuted,
      flex: "0 1 auto",
      minWidth: "0",
      maxWidth: "260px",
      paddingLeft: "8px",
      fontSize: "12px",
      opacity: "0.78",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    },
    ".cm-completionSource": {
      color: editorPalette.textMuted,
      backgroundColor: "transparent",
      border: "0",
      borderRadius: "0",
      padding: "0",
      fontSize: "11px",
      flex: "0 0 auto",
      minWidth: "max-content",
      maxWidth: "96px",
      textAlign: "right",
      whiteSpace: "nowrap",
      marginLeft: "8px",
      overflow: "hidden",
      opacity: "0.86",
      letterSpacing: "0.01em",
    },
    ".cm-completionInfo": {
      padding: "12px 14px",
      borderTop: `1px solid ${editorPalette.border}`,
      backgroundColor: editorPalette.tooltipBgStrong,
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
      backgroundColor: editorPalette.surface,
      padding: "3px 7px",
      borderRadius: radius.sm,
      fontFamily: editorFontFamily,
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
      textDecorationColor:
        "color-mix(in srgb, var(--editor-accent) 55%, transparent)",
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
    ...rainbowBracketRules,
    ".cm-searchMatch": {
      backgroundColor: editorPalette.searchMatch,
      outline: `1px solid color-mix(in srgb, ${editorPalette.accent} 42%, transparent)`,
    },
    ".cm-searchMatch-selected": {
      backgroundColor: editorPalette.accent,
      color: editorPalette.background,
      outline: `1px solid ${editorPalette.accent}`,
    },
    ".cm-selectionMatch": {
      backgroundColor: editorPalette.selectionMatch,
    },
    ".cm-git-gutter": {
      backgroundColor: editorPalette.gutter,
    },
    ".cm-minimap-gutter": {
      transform: "translateX(var(--cm-minimap-dock-offset, 0px))",
      willChange: "transform",
      zIndex: "1",
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
    "radial-gradient(circle at top, color-mix(in srgb, var(--editor-text) 3%, transparent), transparent 24%), var(--editor-bg)",
  boxShadow: "var(--shadow-panel)",
} as const;
