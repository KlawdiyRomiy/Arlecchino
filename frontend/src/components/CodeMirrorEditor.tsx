import React, {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useState,
} from "react";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  EditorView,
  keymap,
  Decoration,
  DecorationSet,
  hoverTooltip,
  showTooltip,
  Tooltip,
} from "@codemirror/view";
import {
  EditorState,
  Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
  startCompletion,
  closeCompletion,
  completionStatus,
} from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { lintGutter } from "@codemirror/lint";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  StreamLanguage,
} from "@codemirror/language";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { r } from "@codemirror/legacy-modes/mode/r";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { clike } from "@codemirror/legacy-modes/mode/clike";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { oCaml, fSharp } from "@codemirror/legacy-modes/mode/mllike";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { cobol } from "@codemirror/legacy-modes/mode/cobol";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { javascript } from "@codemirror/lang-javascript";
import { php } from "@codemirror/lang-php";
import { go } from "@codemirror/lang-go";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "thememirror";
import rainbowBrackets from "rainbowbrackets";
import { showMinimap } from "@replit/codemirror-minimap";
import prettier from "prettier/standalone";
import prettierPluginBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import prettierPluginHtml from "prettier/plugins/html";
import prettierPluginPostcss from "prettier/plugins/postcss";
import prettierPluginTypescript from "prettier/plugins/typescript";
import prettierPluginPhp from "@prettier/plugin-php";
import { useEditorStore } from "../stores/editorStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import {
  findDefinitions,
  checkIfHasDefinition,
} from "../utils/laravelDefinitionProvider";
import {
  DefinitionChooserMenu,
  DefinitionItem as MenuDefinitionItem,
} from "./DefinitionChooserMenu";
import { DiagnosticsDonutIndicator } from "./problems/DiagnosticsDonutIndicator";
import { main as MainModels } from "../../wailsjs/go/models";
import {
  GetEditorCompletions,
  LSPHover,
  NotifyFileOpened,
  NotifyFileClosed,
  NotifyFileChanged,
  LSPSignatureHelp,
  RecordCompletionUsage,
  RecordFileAccess,
  SearchClasses,
} from "../../wailsjs/go/main/App";
import { createCompletionOrchestrator } from "../extensions/completionOrchestrator";
import { createDiagnosticsExtension } from "../extensions/diagnosticsExtension";
import { createGitGutterExtension } from "../extensions/gitGutterExtension";
import { ghostExtension } from "../extensions/ghostExtension";
import { metricsExtension } from "../extensions/metricsExtension";
import { useGitStore } from "../stores/gitStore";
import { createCompletionCache } from "../utils/completionCache";
import {
  CODEMIRROR_TOOLTIP_Z_INDEX,
  shouldEnableCodeMirrorMinimap,
} from "../utils/codeMirrorDisplay";
import { createLatestRequestGuard } from "../utils/latestRequestGuard";

const GHOST_DEBOUNCE_MS = 50;
const GHOST_IDLE_DELAY_MS = 900;

type CompletionWithInsertText = Completion & { __insertText: string };
type CompletionPayload = {
  label?: string;
  text?: string;
  insertText?: string;
  additionalTextEdits?: MainModels.TextEditJSON[];
};
const SIGNATURE_HIDE_MS = 2400;
const COMPLETION_CACHE_TTL_MS = 2000;

const KIND_ICONS: Record<string, string> = {
  method: "M",
  function: "ƒ",
  property: "P",
  variable: "V",
  class: "C",
  interface: "I",
  module: "N",
  keyword: "K",
  snippet: "S",
  text: "T",
  field: "F",
  constant: "c",
  enum: "E",
  "enum-member": "e",
  event: "⚡",
  operator: "O",
  unit: "U",
  value: "=",
  constructor: "C",
  file: "📄",
  folder: "📁",
  reference: "R",
  "type-parameter": "T",
  route: "⟿",
  view: "V",
  config: "⚙",
  model: "M",
  controller: "C",
  middleware: "→",
  migration: "↓",
  component: "◇",
  type: "T",
  struct: "S",
  package: "P",
  namespace: "N",
};

const SOURCE_LABELS: Record<string, string> = {
  lsp: "LSP",
  index: "Index",
  predictive: "Predict",
  local: "Local",
  virtual: "Virtual",
  fill_all: "Fill",
  ast: "AST",
  speculative: "Spec",
  snippet: "Snippet",
  arle: "ARLE",
};

const SOURCE_PRIORITY: Record<string, number> = {
  lsp: 100,
  local: 90,
  predictive: 80,
  arle: 75,
  index: 70,
  fill_all: 65,
  virtual: 60,
  ast: 50,
  speculative: 40,
  snippet: 30,
};

const firstWordOrToken = (text: string): string => {
  if (!text) return "";
  const match = text.match(/^(\s*\S+\s*)/);
  if (!match) return text;
  return match[0];
};

const trimToTokenLimit = (text: string, limit: number): string => {
  if (!text || limit <= 0) return "";
  const parts = text.trim().split(/\s+/);
  const slice = parts.slice(0, limit).join(" ");
  if (!slice) return "";
  return text.startsWith(" ") ? ` ${slice}` : slice;
};

const isThenable = (value: unknown): value is PromiseLike<unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const then = (value as { then?: unknown }).then;
  return typeof then === "function";
};

const blackprintTheme = createTheme({
  variant: "dark",
  settings: {
    background: "#000000",
    foreground: "#e0e0e0",
    caret: "#ffffff",
    selection: "#264f78",
    lineHighlight: "#0a0a0a",
    gutterBackground: "#000000",
    gutterForeground: "#555555",
  },
  styles: [
    { tag: t.comment, color: "#6a737d" },
    { tag: t.lineComment, color: "#6a737d" },
    { tag: t.blockComment, color: "#6a737d" },
    { tag: t.docComment, color: "#6a737d" },
    { tag: t.string, color: "#98c379" },
    { tag: t.special(t.string), color: "#98c379" },
    { tag: t.number, color: "#d19a66" },
    { tag: t.bool, color: "#d19a66" },
    { tag: t.null, color: "#d19a66" },
    { tag: t.keyword, color: "#61afef" },
    { tag: t.operator, color: "#abb2bf" },
    { tag: t.className, color: "#e5c07b" },
    { tag: t.definition(t.typeName), color: "#e5c07b" },
    { tag: t.typeName, color: "#e5c07b" },
    { tag: t.tagName, color: "#e06c75" },
    { tag: t.attributeName, color: "#d19a66" },
    { tag: t.propertyName, color: "#e06c75" },
    { tag: t.function(t.variableName), color: "#61afef" },
    { tag: t.definition(t.variableName), color: "#e06c75" },
    { tag: t.variableName, color: "#e0e0e0" },
    { tag: t.constant(t.variableName), color: "#d19a66" },
    { tag: t.labelName, color: "#e06c75" },
    { tag: t.namespace, color: "#e5c07b" },
    { tag: t.macroName, color: "#61afef" },
    { tag: t.literal, color: "#98c379" },
    { tag: t.punctuation, color: "#abb2bf" },
    { tag: t.paren, color: "#abb2bf" },
    { tag: t.squareBracket, color: "#abb2bf" },
    { tag: t.brace, color: "#abb2bf" },
    { tag: t.derefOperator, color: "#abb2bf" },
    { tag: t.self, color: "#e06c75" },
  ],
});

const editorStyles = EditorView.theme({
  "&": {
    height: "100%",
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    backgroundColor: "#000",
  },
  ".cm-scroller": {
    backgroundColor: "#000",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "8px 8px",
    caretColor: "#fff",
    backgroundColor: "#000",
  },
  ".cm-gutters": {
    backgroundColor: "#000",
    borderRight: "1px solid #1a1a1a",
    color: "#555",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "#d4a520",
  },
  ".cm-activeLine": {
    backgroundColor: "#0a0a0a",
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "#264f78 !important",
  },
  "&.cm-focused .cm-selectionBackground, &.cm-focused .cm-content ::selection":
    {
      backgroundColor: "#264f78 !important",
    },
  "& .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "#264f78 !important",
  },
  "&:not(.cm-focused) .cm-selectionBackground": {
    backgroundColor: "#264f78 !important",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-foldGutter": {
    width: "12px",
  },
  ".cm-tooltip": {
    backgroundColor: "#000000",
    border: "1px solid #2a2f36",
    borderRadius: "8px",
    boxShadow: "0 10px 24px rgba(0,0,0,0.8)",
    zIndex: String(CODEMIRROR_TOOLTIP_Z_INDEX),
  },
  ".cm-tooltip-autocomplete": {
    backgroundColor: "#000000",
    border: "1px solid #333333",
    borderRadius: "8px",
    boxShadow: "0 16px 40px rgba(0, 0, 0, 0.8), 0 4px 12px rgba(0, 0, 0, 0.6)",
    minWidth: "400px",
    maxWidth: "800px",
    width: "fit-content",
    maxHeight: "400px",
    padding: "8px",
    opacity: "1",
    transform: "translateY(0) translateZ(0)",
    willChange: "transform, opacity",
    transition: "opacity 80ms ease-out, transform 80ms ease-out",
    zIndex: String(CODEMIRROR_TOOLTIP_Z_INDEX),
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: "16px",
    lineHeight: "1.6",
    maxHeight: "380px",
    maxWidth: "none",
    minWidth: "100%",
    overflowY: "auto",
    overflowX: "hidden",
    scrollbarWidth: "thin",
    scrollbarColor: "#3a3f46 transparent",
    paddingBottom: "4px",
    transform: "translateZ(0)",
    willChange: "transform",
    contain: "content",
    overscrollBehavior: "contain",
  },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar": {
    width: "8px",
  },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-track": {
    background: "#141414",
  },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb": {
    background: "#3a3f46",
    borderRadius: "6px",
  },
  ".cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb:hover": {
    background: "#4a5058",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "8px 14px 8px 12px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "34px",
    borderRadius: "6px",
    borderLeft: "3px solid transparent",
    letterSpacing: "0.2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "pointer",
    transform: "translateZ(0)",
    contain: "layout style paint",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#1a1a1a",
    borderLeftColor: "#ffffff",
  },
  ".cm-tooltip-autocomplete > ul > li:hover:not([aria-selected])": {
    backgroundColor: "#111111",
  },
  ".cm-completionIcon": {
    width: "20px",
    minWidth: "20px",
    marginRight: "8px",
    textAlign: "center",
    fontSize: "16px",
    color: "#999999",
  },
  ".cm-completionIcon-method, .cm-completionIcon-function": {
    color: "#8b949e",
  },
  ".cm-completionIcon-class, .cm-completionIcon-constructor": {
    color: "#8b949e",
  },
  ".cm-completionIcon-interface, .cm-completionIcon-type": {
    color: "#8b949e",
  },
  ".cm-completionIcon-variable, .cm-completionIcon-field, .cm-completionIcon-property":
    {
      color: "#8b949e",
    },
  ".cm-completionIcon-constant, .cm-completionIcon-enum, .cm-completionIcon-enum-member":
    {
      color: "#8b949e",
    },
  ".cm-completionIcon-keyword": {
    color: "#8b949e",
  },
  ".cm-completionIcon-snippet": {
    color: "#8b949e",
  },
  ".cm-completionIcon-module, .cm-completionIcon-file, .cm-completionIcon-folder":
    {
      color: "#8b949e",
    },
  ".cm-completionLabel": {
    color: "#e2e8f0",
    flex: "0 1 auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-completionMatchedText": {
    color: "#ffffff",
    fontWeight: "bold",
  },
  ".cm-completionDetail": {
    color: "#8b949e",
    flex: "1 1 auto",
    paddingLeft: "12px",
    fontSize: "14px",
    fontStyle: "italic",
    opacity: "0.85",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-completionSource": {
    color: "#8b949e",
    backgroundColor: "#141414",
    border: "1px solid #2a2f36",
    borderRadius: "10px",
    padding: "2px 8px",
    fontSize: "12px",
    flexShrink: "0",
    minWidth: "max-content",
    textAlign: "right",
    whiteSpace: "nowrap",
    marginLeft: "12px",
    overflow: "hidden",
  },
  ".cm-completionInfo": {
    padding: "12px 14px",
    borderTop: "1px solid #333333",
    backgroundColor: "#141414",
    fontSize: "13px",
    color: "#cccccc",
    maxHeight: "180px",
    overflowY: "auto",
  },
  ".cm-completionInfo code": {
    backgroundColor: "#0a0a0a",
    padding: "3px 7px",
    borderRadius: "4px",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: "12px",
  },
});

const setDefinitionLinkEffect = StateEffect.define<{
  from: number;
  to: number;
} | null>();
const definitionLinkField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    const mapped = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setDefinitionLinkEffect)) {
        if (!effect.value) {
          return Decoration.none;
        }
        const decoration = Decoration.mark({
          class: "definition-link-hover",
        });
        return Decoration.set([
          decoration.range(effect.value.from, effect.value.to),
        ]);
      }
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const setHighlightLineEffect = StateEffect.define<number | null>();
const highlightLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    const mapped = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setHighlightLineEffect)) {
        if (!effect.value) {
          return Decoration.none;
        }
        const line = transaction.state.doc.line(
          Math.min(effect.value, transaction.state.doc.lines),
        );
        const decoration = Decoration.line({ class: "perspective-highlight" });
        return Decoration.set([decoration.range(line.from)]);
      }
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const setSignatureTooltipEffect = StateEffect.define<Tooltip | null>();
const signatureTooltipField = StateField.define<Tooltip | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSignatureTooltipEffect)) {
        return effect.value;
      }
    }
    return value;
  },
  provide: (field) => showTooltip.from(field),
});

interface DefinitionMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  items: MenuDefinitionItem[];
  mode: "goto" | "quickLook";
}

interface SignatureHelpResult {
  signatures: SignatureInfo[];
  activeSignature: number;
  activeParameter: number;
}

interface SignatureInfo {
  label: string;
  documentation: string;
  parameters: ParameterInfo[];
}

interface ParameterInfo {
  label: string;
  documentation: string;
}

function extractAccessPrefix(textBefore: string): {
  prefix: string;
  accessChain: string;
} | null {
  if (!textBefore) return null;

  const accessPatterns = [
    /(\$\w+)->(\w*)$/,
    /(\$this)->(\w*)$/,
    /(self)::(\w*)$/,
    /(static)::(\w*)$/,
    /([A-Z]\w*)::(\w*)$/,
    /(\w+)\.(\w*)$/,
  ];

  for (const pattern of accessPatterns) {
    const match = textBefore.match(pattern);
    if (match) {
      return {
        accessChain:
          match[1] +
          (textBefore.includes("::")
            ? "::"
            : textBefore.includes("->")
              ? "->"
              : "."),
        prefix: match[2] || "",
      };
    }
  }
  return null;
}

function extractStringPrefix(textBefore: string): string | null {
  if (!textBefore) return null;
  const stringArgPatterns = [
    /Route::get\s*\(\s*['"]([^'"]*)$/,
    /Route::post\s*\(\s*['"]([^'"]*)$/,
    /Route::put\s*\(\s*['"]([^'"]*)$/,
    /Route::patch\s*\(\s*['"]([^'"]*)$/,
    /Route::delete\s*\(\s*['"]([^'"]*)$/,
    /Route::any\s*\(\s*['"]([^'"]*)$/,
    /Route::options\s*\(\s*['"]([^'"]*)$/,
    /Route::match\s*\([^)]+,\s*['"]([^'"]*)$/,
    /view\s*\(\s*['"]([^'"]*)$/,
    /config\s*\(\s*['"]([^'"]*)$/,
    /route\s*\(\s*['"]([^'"]*)$/,
    /trans\s*\(\s*['"]([^'"]*)$/,
    /__\s*\(\s*['"]([^'"]*)$/,
    /asset\s*\(\s*['"]([^'"]*)$/,
    /url\s*\(\s*['"]([^'"]*)$/,
    /redirect\s*\(\s*['"]([^'"]*)$/,
    /env\s*\(\s*['"]([^'"]*)$/,
    /@include\s*\(\s*['"]([^'"]*)$/,
    /@extends\s*\(\s*['"]([^'"]*)$/,
    /@component\s*\(\s*['"]([^'"]*)$/,
    /->name\s*\(\s*['"]([^'"]*)$/,
    /->middleware\s*\(\s*['"]([^'"]*)$/,
    /where\s*\(\s*['"]([^'"]*)$/,
    /orderBy\s*\(\s*['"]([^'"]*)$/,
  ];
  for (const pattern of stringArgPatterns) {
    const match = textBefore.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractKeywordPrefix(textBefore: string): string | null {
  if (!textBefore) return null;
  const match = textBefore.match(/(\w+)$/);
  return match ? match[1] : null;
}

const CSS_LANGUAGES = new Set(["css", "scss", "sass", "less"]);

function getPrefixCharClass(language: string): string {
  if (CSS_LANGUAGES.has(language)) {
    return "A-Za-z0-9_#.@-";
  }
  if (
    language === "astro" ||
    language === "html" ||
    language === "blade" ||
    language === "vue" ||
    language === "svelte"
  ) {
    return "A-Za-z0-9_:@-";
  }
  if (language === "bash") {
    return "A-Za-z0-9_-";
  }
  return "A-Za-z0-9_$";
}

function getValidForRegex(
  language: string,
  inString: boolean,
  inBrace: boolean = false,
): RegExp {
  if (inString) {
    return /^[A-Za-z0-9_./:-]*$/;
  }
  if (inBrace) {
    return /^[A-Za-z0-9_#.@:$/\-\s]*$/;
  }
  if (language === "bash") {
    return /^[A-Za-z0-9_\-$]*$/;
  }
  if (CSS_LANGUAGES.has(language)) {
    return /^[A-Za-z0-9_#.@:-]*$/;
  }
  const charClass = getPrefixCharClass(language);
  return new RegExp(`^[${charClass}]*$`);
}

function getPrefixMatch(
  textBeforeLine: string,
  language: string,
): { prefix: string; startColumn: number; hasDollarPrefix: boolean } | null {
  if (!textBeforeLine) return null;
  const charClass = getPrefixCharClass(language);
  const regex = new RegExp(`[${charClass}]+$`);
  const match = textBeforeLine.match(regex);
  const prefix = match?.[0] || "";
  const startIndex = match?.index ?? textBeforeLine.length;
  let hasDollarPrefix = false;

  if (language === "bash") {
    const dollarIndex = textBeforeLine.length - prefix.length - 1;
    if (dollarIndex >= 0 && textBeforeLine[dollarIndex] === "$") {
      hasDollarPrefix = true;
    }
  }

  if (!prefix && !hasDollarPrefix) return null;
  return { prefix, startColumn: startIndex + 1, hasDollarPrefix };
}

function normalizePrefixForLanguage(
  prefix: string,
  language: string,
  hasDollarPrefix: boolean,
): string {
  if (language === "bash" && hasDollarPrefix) {
    return `$${prefix}`;
  }
  return prefix;
}

function snippetToPlainText(snippetText: string): string {
  return (
    snippetText
      // Policy: do NOT keep placeholder default values (no "methodName", "name", etc.).
      // Convert `${1:default}` -> "" (not "default").
      .replace(/\$\{[0-9]+:[^}]*\}/g, "")
      .replace(/\$\{[0-9]+\}/g, "")
      .replace(/\(\$[0-9]+\)/g, "()")
      .replace(/\$[0-9]+/g, "")
      .replace(/\{[ᴸᴿ]?[FN]?\}/g, "")
      .replace(/[\u2070-\u209F]/g, "")
  );
}

function completionAddsUsefulText(
  prefix: string,
  insertText: string,
  additionalTextEdits?: MainModels.TextEditJSON[],
): boolean {
  if (additionalTextEdits && additionalTextEdits.length > 0) {
    return true;
  }
  if (!prefix) {
    return insertText.trim().length > 0;
  }

  const prefixLower = prefix.toLowerCase();
  const insertLower = insertText.toLowerCase();
  if (!insertLower.startsWith(prefixLower)) {
    return insertLower.length > 0 && insertLower !== prefixLower;
  }

  return insertText.length > prefix.length;
}

function isExactSelfEchoCompletion(
  item: CompletionPayload,
  prefix: string,
  insertText: string,
): boolean {
  if (!prefix) {
    return false;
  }

  const labelLower = (item.label || item.text || "").toLowerCase();
  if (labelLower !== prefix.toLowerCase()) {
    return false;
  }

  return !completionAddsUsefulText(
    prefix,
    insertText,
    item.additionalTextEdits,
  );
}

function getWordAtLinePosition(
  lineText: string,
  column: number,
  language: string,
): { word: string; startColumn: number; endColumn: number } | null {
  const index = Math.max(0, Math.min(column - 1, lineText.length));
  const left = lineText.slice(0, index);
  const right = lineText.slice(index);
  const charClass = getPrefixCharClass(language);
  const leftMatch = left.match(new RegExp(`[${charClass}]+$`));
  const rightMatch = right.match(new RegExp(`^[${charClass}]+`));
  if (!leftMatch && !rightMatch) return null;
  const word = `${leftMatch?.[0] || ""}${rightMatch?.[0] || ""}`;
  const startColumn = index - (leftMatch?.[0].length || 0) + 1;
  const endColumn = index + (rightMatch?.[0].length || 0) + 1;
  return { word, startColumn, endColumn };
}

function buildCompletionContext(fullText: string, lineNumber: number) {
  let currentClass = "";
  let currentMethod = "";
  const imports: string[] = [];
  const lines = fullText.split("\n");

  lines.forEach((line, index) => {
    if (line.match(/^\s*use\s+[\w\\]+;/)) {
      const match = line.match(/use\s+([\w\\]+)/);
      if (match) imports.push(match[1]);
    }
    if (line.match(/^\s*(class|trait|interface)\s+\w+/)) {
      const match = line.match(/(class|trait|interface)\s+(\w+)/);
      if (match) currentClass = match[2];
    }
    if (line.match(/^\s*(public|private|protected)?\s*function\s+\w+/)) {
      const match = line.match(/function\s+(\w+)/);
      if (match && index + 1 < lineNumber) currentMethod = match[1];
    }
  });

  return { currentClass, currentMethod, imports };
}

function buildCompletionCacheKey(
  lineNumber: number,
  accessChain: string | null,
  inStringContext: boolean,
  inBraceContext: boolean,
) {
  return [
    lineNumber,
    accessChain || "-",
    inStringContext ? "string" : "plain",
    inBraceContext ? "brace" : "flow",
  ].join("|");
}

function endsWithAccessTrigger(text: string) {
  return text.endsWith(".") || text.endsWith("->") || text.endsWith("::");
}

function buildDefinitionContext(
  fullText: string,
  lineNumber: number,
  startColumn: number,
  endColumn: number,
) {
  const lines = fullText.split("\n");
  const startLine = Math.max(1, lineNumber - 5);
  const endLine = Math.min(lines.length, lineNumber + 5);
  let contextBefore = "";
  for (let i = startLine; i < lineNumber; i += 1) {
    contextBefore += `${lines[i - 1]} `;
  }
  const currentLine = lines[lineNumber - 1] || "";
  contextBefore += currentLine.substring(0, startColumn - 1);
  let contextAfter = currentLine.substring(endColumn - 1);
  for (let i = lineNumber + 1; i <= endLine; i += 1) {
    contextAfter += ` ${lines[i - 1]}`;
  }
  return { contextBefore, contextAfter };
}

function formatHoverContent(content: string): string {
  if (
    content.includes("function ") ||
    content.includes("class ") ||
    content.includes("->") ||
    content.includes("::") ||
    content.includes("$") ||
    content.startsWith("<?php")
  ) {
    let formatted = content.trim();
    formatted = formatted.replace(/^<\?php\s*/, "");
    return `php\n${formatted}`;
  }
  return content;
}

function formatDocumentation(doc: string): string {
  if (!doc) return "";
  if (doc.includes("```") || doc.includes("##")) {
    return doc;
  }
  return doc
    .replace(/@param\s+(\S+)\s+(\$\S+)/g, "**$2** `$1` —")
    .replace(/@return\s+(\S+)/g, "**Returns:** `$1`")
    .replace(/@throws\s+(\S+)/g, "**Throws:** `$1`")
    .replace(/@deprecated/g, "**Deprecated**")
    .replace(/@see\s+(\S+)/g, "See: `$1`");
}

function getLanguageExtension(language: string): Extension | null {
  const officialLangs: Record<string, () => Extension> = {
    javascript: () => javascript(),
    typescript: () => javascript({ typescript: true }),
    javascriptreact: () => javascript({ jsx: true }),
    typescriptreact: () => javascript({ jsx: true, typescript: true }),
    astro: () => javascript({ jsx: true, typescript: true }),
    vue: () => html(),
    svelte: () => html(),
    blade: () => html(),
    erb: () => html(),
    php: () => php(),
    go: () => go(),
    python: () => python(),
    html: () => html(),
    css: () => css(),
    scss: () => css(),
    sass: () => css(),
    less: () => css(),
    json: () => json(),
    markdown: () => markdown(),
    rust: () => rust(),
    cpp: () => cpp(),
    c: () => cpp(),
    java: () => java(),
    sql: () => sql(),
    xml: () => xml(),
    yaml: () => yaml(),
  };

  const legacyLangs: Record<string, () => Extension> = {
    ruby: () => StreamLanguage.define(ruby),
    swift: () => StreamLanguage.define(swift),
    bash: () => StreamLanguage.define(shell),
    shell: () => StreamLanguage.define(shell),
    sh: () => StreamLanguage.define(shell),
    zsh: () => StreamLanguage.define(shell),
    fish: () => StreamLanguage.define(shell),
    perl: () => StreamLanguage.define(perl),
    lua: () => StreamLanguage.define(lua),
    r: () => StreamLanguage.define(r),
    haskell: () => StreamLanguage.define(haskell),
    clojure: () => StreamLanguage.define(clojure),
    erlang: () => StreamLanguage.define(erlang),
    groovy: () => StreamLanguage.define(groovy),
    diff: () => StreamLanguage.define(diff),
    dockerfile: () => StreamLanguage.define(dockerFile),
    toml: () => StreamLanguage.define(toml),
    ini: () => StreamLanguage.define(toml),
    env: () => StreamLanguage.define(shell),
    nginx: () => StreamLanguage.define(nginx),
    protobuf: () => StreamLanguage.define(protobuf),
    powershell: () => StreamLanguage.define(powerShell),
    fortran: () => StreamLanguage.define(fortran),
    julia: () => StreamLanguage.define(julia),
    ocaml: () => StreamLanguage.define(oCaml),
    fsharp: () => StreamLanguage.define(fSharp),
    lisp: () => StreamLanguage.define(commonLisp),
    delphi: () => StreamLanguage.define(pascal),
    pascal: () => StreamLanguage.define(pascal),
    vb: () => StreamLanguage.define(vb),
    vba: () => StreamLanguage.define(vb),
    cobol: () => StreamLanguage.define(cobol),
    assembly: () => StreamLanguage.define(gas),
    kotlin: () => StreamLanguage.define(clike({ name: "kotlin" })),
    scala: () => StreamLanguage.define(clike({ name: "scala" })),
    csharp: () => StreamLanguage.define(clike({ name: "csharp" })),
    objectivec: () => StreamLanguage.define(clike({ name: "objectivec" })),
    dart: () => StreamLanguage.define(clike({ name: "dart" })),
    elixir: () => StreamLanguage.define(ruby),
    zig: () => StreamLanguage.define(clike({ name: "clike" })),
    ada: () => StreamLanguage.define(clike({ name: "clike" })),
    prolog: () => StreamLanguage.define(clike({ name: "clike" })),
    matlab: () => StreamLanguage.define(clike({ name: "clike" })),
    gleam: () => StreamLanguage.define(clike({ name: "clike" })),
    gdscript: () => python(),
    graphql: () => StreamLanguage.define(clike({ name: "clike" })),
    terraform: () => StreamLanguage.define(toml),
    makefile: () => StreamLanguage.define(shell),
    cmake: () => StreamLanguage.define(clike({ name: "clike" })),
    latex: () => markdown(),
    solidity: () => StreamLanguage.define(clike({ name: "clike" })),
    wgsl: () => StreamLanguage.define(clike({ name: "clike" })),
    glsl: () => StreamLanguage.define(clike({ name: "clike" })),
  };

  const officialFactory = officialLangs[language];
  if (officialFactory) return officialFactory();

  const legacyFactory = legacyLangs[language];
  if (legacyFactory) return legacyFactory();

  return null;
}

interface CodeMirrorEditorProps {
  filePath: string;
  content: string;
  language: string;
  onChange: (value: string | undefined) => void;
  onSave?: () => void;
  onToggleProblems?: () => void;
  onOpenFile?: (path: string, line?: number) => void;
  onQuickLook?: (path: string, line?: number) => void;
  onPerspectiveOpen?: () => void;
  onPerspectiveClose?: () => void;
  onTyping?: (chars: number) => void;
  onGhostShown?: () => void;
  onGhostRejected?: () => void;
  projectPath?: string;
  highlightLine?: number;
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  filePath,
  content,
  language,
  onChange,
  onSave,
  onToggleProblems,
  onOpenFile,
  onQuickLook,
  onPerspectiveOpen: _onPerspectiveOpen,
  onPerspectiveClose: _onPerspectiveClose,
  onTyping,
  onGhostShown,
  onGhostRejected,
  projectPath,
  highlightLine,
}) => {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const documentVersionRef = useRef<number>(0);
  const initialDocLengthRef = useRef(content.length);
  const completionCacheRef = useRef(
    createCompletionCache(COMPLETION_CACHE_TTL_MS),
  );
  const signatureRequestGuardRef = useRef(createLatestRequestGuard());
  const editorFontSize = useEditorSettingsStore(
    (state) => state.editorFontSize,
  );
  const showInlineDiagnostics = useEditorSettingsStore(
    (state) => state.showInlineDiagnostics,
  );
  const showMinimapSetting = useEditorSettingsStore(
    (state) => state.showMinimap,
  );
  const gitMarkers = useGitStore((state) => state.fileMarkers[filePath] ?? []);
  const refreshFileMarkers = useGitStore((state) => state.refreshFileMarkers);
  const clearFileMarkers = useGitStore((state) => state.clearFileMarkers);
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const diagnosticsExtension = useMemo(
    () =>
      createDiagnosticsExtension({
        filePath,
        language,
        enabled: showInlineDiagnostics,
      }),
    [filePath, language, showInlineDiagnostics],
  );

  const [definitionMenu, setDefinitionMenu] = useState<DefinitionMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    items: [],
    mode: "goto",
  });

  const signatureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (!filePath || !language) return;

    documentVersionRef.current = 1;
    completionCacheRef.current.invalidate();
    signatureRequestGuardRef.current.next();
    NotifyFileOpened(filePath, language, content).catch(console.warn);
    RecordFileAccess(filePath).catch(() => {});

    return () => {
      NotifyFileClosed(filePath, language).catch(console.warn);
    };
  }, [filePath, language]);

  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;

    if (!highlightLine || highlightLine <= 0) {
      view.dispatch({ effects: setHighlightLineEffect.of(null) });
      return;
    }

    const line = view.state.doc.line(
      Math.min(highlightLine, view.state.doc.lines),
    );
    const yMargin = Math.round(view.dom.clientHeight * 0.35);
    view.dispatch({
      effects: [
        setHighlightLineEffect.of(highlightLine),
        EditorView.scrollIntoView(line.from, {
          y: "start",
          yMargin,
        }),
      ],
      selection: { anchor: line.from },
    });

    const timer = setTimeout(() => {
      view.dispatch({ effects: setHighlightLineEffect.of(null) });
    }, 1500);

    return () => clearTimeout(timer);
  }, [highlightLine]);

  const clearSignatureHelp = useCallback(() => {
    signatureRequestGuardRef.current.next();
    const view = editorRef.current?.view;
    if (!view) return;
    view.dispatch({ effects: setSignatureTooltipEffect.of(null) });
  }, []);

  const requestSignatureHelp = useCallback(
    async (view: EditorView, pos: number) => {
      if (language !== "php") return;

      const requestId = signatureRequestGuardRef.current.next();
      const versionAtRequest = documentVersionRef.current;
      const line = view.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;
      const contentText = view.state.doc.toString();

      try {
        const result = (await LSPSignatureHelp(
          filePath,
          contentText,
          lineNumber - 1,
          column - 1,
        )) as SignatureHelpResult | null;
        if (!signatureRequestGuardRef.current.isLatest(requestId)) {
          return;
        }
        if (versionAtRequest !== documentVersionRef.current) {
          return;
        }
        if (view.state.selection.main.head !== pos) {
          return;
        }
        if (!result || !result.signatures || result.signatures.length === 0) {
          clearSignatureHelp();
          return;
        }

        const activeSignature =
          result.signatures[result.activeSignature || 0] ||
          result.signatures[0];
        const activeParamIndex = result.activeParameter || 0;

        const tooltip: Tooltip = {
          pos,
          above: true,
          create: () => {
            const dom = document.createElement("div");
            dom.className = "cm-tooltip cm-tooltip-signature";
            const label = document.createElement("div");
            label.className = "cm-signature-label";
            label.textContent = activeSignature.label;
            dom.appendChild(label);

            if (activeSignature.parameters?.length) {
              const params = document.createElement("div");
              params.className = "cm-signature-params";
              activeSignature.parameters.forEach((param, index) => {
                const paramEl = document.createElement("div");
                paramEl.className = "cm-signature-param";
                if (index === activeParamIndex) {
                  paramEl.classList.add("cm-signature-param-active");
                }
                const docText = formatDocumentation(param.documentation || "");
                paramEl.textContent = docText
                  ? `${param.label} — ${docText.replace(/\*\*|`/g, "")}`
                  : param.label;
                params.appendChild(paramEl);
              });
              dom.appendChild(params);
            } else if (activeSignature.documentation) {
              const doc = document.createElement("div");
              doc.className = "cm-signature-doc";
              doc.textContent = formatDocumentation(
                activeSignature.documentation,
              ).replace(/\*\*|`/g, "");
              dom.appendChild(doc);
            }

            return { dom };
          },
        };

        view.dispatch({ effects: setSignatureTooltipEffect.of(tooltip) });
        if (signatureTimerRef.current) {
          clearTimeout(signatureTimerRef.current);
        }
        signatureTimerRef.current = setTimeout(() => {
          if (signatureRequestGuardRef.current.isLatest(requestId)) {
            view.dispatch({ effects: setSignatureTooltipEffect.of(null) });
          }
        }, SIGNATURE_HIDE_MS);
      } catch (error) {
        console.error("SignatureHelp error:", error);
        if (signatureRequestGuardRef.current.isLatest(requestId)) {
          clearSignatureHelp();
        }
      }
    },
    [filePath, language, clearSignatureHelp],
  );

  const metrics = useMemo(
    () =>
      metricsExtension(
        {
          onTyping,
          onGhostShown,
          onGhostRejected,
          onCompletionAccepted: (item) => {
            const label = item.label || "";
            if (label) {
              RecordCompletionUsage(label).catch(() => {});
            }
          },
          onJitterUpdate: (stats) => {
            if (stats.total > 0 && stats.total % 10 === 0) {
              console.debug(
                "[AutocompleteV2][UI] jitter",
                Math.round(stats.ratio * 1000) / 10,
                "%",
              );
            }
          },
          onAutocompleteLatencyUpdate: (stats) => {
            if (stats.samples > 0 && stats.samples % 10 === 0) {
              console.debug(
                "[AutocompleteV2][UI] latency",
                `p50=${Math.round(stats.p50Ms)}ms`,
                `p95=${Math.round(stats.p95Ms)}ms`,
                `last=${Math.round(stats.lastMs)}ms`,
                `n=${stats.samples}`,
              );
            }
          },
          onRequestPressureUpdate: (stats) => {
            console.debug(
              "[AutocompleteV2][UI] pressure",
              `backend=${stats.backendRequests}`,
              `cacheHit=${stats.cacheHits}`,
              `cacheMiss=${stats.cacheMisses}`,
              `instant=${stats.instantFallbacks}`,
            );
          },
        },
        initialDocLengthRef.current,
      ),
    [onGhostRejected, onGhostShown, onTyping],
  );

  const shouldShowMinimap = useMemo(
    () => showMinimapSetting && shouldEnableCodeMirrorMinimap(content),
    [content, showMinimapSetting],
  );

  const gitGutterExtension = useMemo(
    () => createGitGutterExtension({ markers: gitMarkers }),
    [gitMarkers],
  );

  useEffect(() => {
    if (!filePath) return;

    const timer = window.setTimeout(() => {
      void refreshFileMarkers(filePath);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, filePath, refreshFileMarkers]);

  useEffect(
    () => () => {
      if (filePath) {
        clearFileMarkers(filePath);
      }
    },
    [clearFileMarkers, filePath],
  );

  const syncCursorPosition = useCallback(
    (state: EditorState) => {
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      setCursorPosition(line.number, head - line.from + 1);
    },
    [setCursorPosition],
  );
  const fileName = useMemo(
    () => filePath.split("/").pop() || filePath,
    [filePath],
  );

  const orchestrator = useMemo(() => createCompletionOrchestrator({}), []);

  const ghost = useMemo(
    () =>
      ghostExtension({
        filePath,
        language,
        ghostDebounceMs: GHOST_DEBOUNCE_MS,
        ghostIdleDelayMs: GHOST_IDLE_DELAY_MS,
        buildCompletionContext,
        fetchCompletions: async (payload) =>
          (await GetEditorCompletions(
            payload,
          )) as MainModels.EditorCompletionResult | null,
        onGhostShown: metrics.recordGhostShown,
        onGhostRejected: metrics.recordGhostRejected,
        onCompletionAccepted: (label) => {
          if (!label) return;
          metrics.recordCompletionAccepted({ label } as Completion);
        },
        onEscape: clearSignatureHelp,
        helpers: {
          firstWordOrToken,
          trimToTokenLimit,
          snippetToPlainText,
          getWordAtLinePosition,
          extractStringPrefix,
          extractAccessPrefix,
          extractKeywordPrefix,
        },
      }),
    [clearSignatureHelp, filePath, language, metrics],
  );

  useEffect(() => () => ghost.cleanup(), [ghost]);

  const fetchPendingClassCompletions = useCallback(
    async (context: CompletionContext): Promise<Completion[]> => {
      if (language !== "php") return [];

      const textUntilPosition = context.state.doc.sliceString(0, context.pos);
      const patterns = [
        /new\s+([A-Z][a-zA-Z0-9]*)$/,
        /extends\s+([A-Z][a-zA-Z0-9]*)$/,
        /implements\s+([A-Z][a-zA-Z0-9,\s]*)$/,
        /use\s+([A-Z][a-zA-Z0-9\\]*)$/,
        /([A-Z][a-zA-Z0-9]*)::$/,
      ];

      let prefix = "";
      for (const pattern of patterns) {
        const match = textUntilPosition.match(pattern);
        if (match) {
          prefix = match[1];
          break;
        }
      }

      if (!prefix || prefix.length < 2) {
        return [];
      }

      try {
        const results = await SearchClasses(prefix);
        if (!results || results.length === 0) return [];

        return results.map((result) => ({
          label: result.name,
          detail: result.pending
            ? `[PENDING] ${result.namespace}`
            : result.namespace,
          info: result.pending
            ? `This class will be created at:\n${result.filePath}`
            : `${result.namespace}\\${result.name}`,
          type: mapCompletionKindString(result.kind || "class"),
          apply: (view, _completion, from, to) => {
            view.dispatch({
              changes: { from, to, insert: result.name },
            });
            metrics.recordCompletionAccepted({
              label: result.name,
            } as Completion);
          },
          boost: result.pending ? -0.2 : 0,
        }));
      } catch {
        return [];
      }
    },
    [language, metrics],
  );

  const backendCompletionSource = useCallback(
    (context: CompletionContext) => {
      if (context.aborted) return null;
      const pos = context.pos;
      const line = context.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;
      const textBeforeLine = line.text.slice(0, column - 1);
      const accessInfo = extractAccessPrefix(textBeforeLine);
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const prefixMatch = getPrefixMatch(textBeforeLine, language);
      const braceCharClass = getPrefixCharClass(language);
      const braceTailRegex = new RegExp(
        `\\{[^\\S\\r\\n]*([${braceCharClass}]*)$`,
      );
      const braceTailMatch = textBeforeLine.match(braceTailRegex);
      const inBraceContext = braceTailMatch !== null;
      const bracePrefix = braceTailMatch?.[1] || "";
      const braceTailStartColumn = inBraceContext
        ? textBeforeLine.length - bracePrefix.length + 1
        : null;
      const recent = context.state.doc.sliceString(Math.max(0, pos - 2), pos);
      const accessTrigger =
        recent.endsWith(".") || recent.endsWith("->") || recent.endsWith("::");
      const hasAccessTrigger = accessTrigger || accessInfo !== null;

      const rawPrefix =
        stringPrefix ??
        accessInfo?.prefix ??
        (bracePrefix.length > 0 ? bracePrefix : null) ??
        prefixMatch?.prefix ??
        "";
      const hasDollarPrefix = prefixMatch?.hasDollarPrefix ?? false;
      const currentPrefix = normalizePrefixForLanguage(
        rawPrefix,
        language,
        hasDollarPrefix,
      );
      const shouldStripDollar = language === "bash" && hasDollarPrefix;
      const htmlLike =
        language === "astro" ||
        language === "html" ||
        language === "blade" ||
        language === "vue" ||
        language === "svelte";
      let triggerChar = hasAccessTrigger
        ? recent.slice(-1)
        : hasDollarPrefix
          ? "$"
          : rawPrefix.slice(-1) || "";
      const trimmedLine = textBeforeLine.replace(/\s+$/, "");
      if (htmlLike && /<\s*[A-Za-z0-9:_-]*$/.test(textBeforeLine)) {
        triggerChar = "<";
      } else if (
        CSS_LANGUAGES.has(language) &&
        /:\s*[^;]*$/.test(textBeforeLine)
      ) {
        triggerChar = ":";
      } else if (/:\s*$/.test(textBeforeLine)) {
        triggerChar = ":";
      } else if (!triggerChar && inBraceContext) {
        triggerChar = "{";
      } else if (!triggerChar && trimmedLine) {
        triggerChar = trimmedLine.slice(-1);
      }

      const hasExplicitCompletionTrigger =
        currentPrefix.length > 0 ||
        stringPrefix !== null ||
        hasDollarPrefix ||
        hasAccessTrigger ||
        triggerChar === "<" ||
        triggerChar === ":" ||
        triggerChar === "{";

      if (!hasExplicitCompletionTrigger) {
        return null;
      }
      const from =
        stringPrefix !== null
          ? line.from + column - stringPrefix.length - 1
          : accessInfo
            ? line.from + column - accessInfo.prefix.length - 1
            : braceTailStartColumn !== null
              ? line.from + braceTailStartColumn - 1
              : prefixMatch
                ? line.from + prefixMatch.startColumn - 1
                : pos;

      const cacheKey = buildCompletionCacheKey(
        lineNumber,
        accessInfo?.accessChain ?? null,
        stringPrefix !== null,
        inBraceContext,
      );
      const requestVersion = documentVersionRef.current;

      const buildCompletionResult = async (
        requestId: number,
        versionAtRequest: number,
      ): Promise<CompletionResult | null> => {
        const fullText = context.state.doc.toString();
        const lineText = line.text;
        const textBefore = fullText.slice(0, pos);
        const textAfter = fullText.slice(pos);
        const { currentClass, currentMethod, imports } = buildCompletionContext(
          fullText,
          lineNumber,
        );

        metrics.recordBackendRequestStarted();
        const result = (await GetEditorCompletions({
          filePath,
          language,
          line: lineNumber,
          column,
          lineText,
          textBefore,
          textAfter,
          fullText,
          currentClass,
          currentMethod,
          imports,
          triggerChar,
        })) as MainModels.EditorCompletionResult | null;

        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (result && "stale" in result && result.stale) return null;
        if (!result?.items?.length) return null;

        const pendingItems = await fetchPendingClassCompletions(context);
        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;

        const completions: Completion[] = result.items.flatMap((item) => {
          let insertText = item.insertText || item.text || item.label || "";
          if (shouldStripDollar && insertText.startsWith("$")) {
            insertText = insertText.slice(1);
          }
          const resolvedInsertText =
            snippetToPlainText(insertText) || insertText;
          if (
            isExactSelfEchoCompletion(item, currentPrefix, resolvedInsertText)
          ) {
            return [];
          }
          const kind = item.kind || "text";
          const source = item.source || "index";
          const kindIcon = KIND_ICONS[mapCompletionKindString(kind)] || "•";
          const sourceLabel = SOURCE_LABELS[source] || source;
          const sourceBoost = SOURCE_PRIORITY[source] || 0;

          const applyCompletion = (
            view: EditorView,
            completionToApply: Completion,
            from: number,
            to: number,
          ) => {
            const changes = [
              {
                from,
                to,
                insert: resolvedInsertText,
              },
            ];

            if (item.additionalTextEdits?.length) {
              const additionalChanges = item.additionalTextEdits
                .map((edit) => {
                  const startLine = view.state.doc.line(edit.startLine);
                  const endLine = view.state.doc.line(edit.endLine);
                  return {
                    from: startLine.from + edit.startColumn - 1,
                    to: endLine.from + edit.endColumn - 1,
                    insert: edit.text,
                  };
                })
                .sort((a, b) => a.from - b.from);

              changes.push(...additionalChanges);
            }

            const primaryInsertEnd = from + resolvedInsertText.length;
            view.dispatch({
              changes: changes.sort((a, b) => a.from - b.from),
              selection: { anchor: primaryInsertEnd },
            });

            metrics.recordCompletionAccepted(completionToApply);
          };

          const basePriority = item.priority || 0;
          let matchBonus = 0;
          const labelLower = (item.label || "").toLowerCase();
          const prefixLower = currentPrefix.toLowerCase();
          const hasUsefulCompletion = completionAddsUsefulText(
            currentPrefix,
            resolvedInsertText,
            item.additionalTextEdits,
          );
          if (prefixLower) {
            if (labelLower === prefixLower)
              matchBonus = hasUsefulCompletion ? 120 : -200;
            else if (labelLower.startsWith(prefixLower)) matchBonus = 150;
            else if (labelLower.includes(prefixLower)) matchBonus = 50;
          }
          const effectivePriority = basePriority + sourceBoost + matchBonus;

          const completion: CompletionWithInsertText = {
            label: item.label || "",
            detail: item.detail || kind,
            info: item.documentation || undefined,
            type: mapCompletionKindString(kind),
            apply: applyCompletion,
            boost: effectivePriority / 500,
            __insertText: resolvedInsertText,
          };
          (completion as unknown as Record<string, unknown>).__source =
            sourceLabel;

          return [completion];
        });

        const allOptions = [...pendingItems, ...completions];
        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;

        completionCacheRef.current.set({
          items: allOptions,
          prefix: currentPrefix,
          timestamp: Date.now(),
          filePath,
          semanticKey: cacheKey,
        });
        metrics.recordCompletionList(allOptions);
        orchestrator.markResponse(requestId);

        return {
          from,
          options: allOptions,
          validFor: getValidForRegex(
            language,
            stringPrefix !== null,
            inBraceContext,
          ),
        };
      };

      const cachedItems = completionCacheRef.current.get(
        filePath,
        cacheKey,
        currentPrefix,
      );
      if (cachedItems && cachedItems.length > 0) {
        metrics.recordCacheHit();
        if (accessInfo?.accessChain && currentPrefix.length === 0) {
          metrics.recordAccessChainWarmHit();
        }
        metrics.recordCompletionList(cachedItems);
        return {
          from,
          options: cachedItems,
          validFor: getValidForRegex(
            language,
            stringPrefix !== null,
            inBraceContext,
          ),
        };
      }

      metrics.recordCacheMiss();

      const requestId = orchestrator.nextRequestId();
      const promise = buildCompletionResult(requestId, requestVersion).catch(
        (err) => {
          console.warn("Completion error:", err);
          return null;
        },
      );

      return promise;
    },
    [filePath, language, fetchPendingClassCompletions, metrics, orchestrator],
  );

  const handleChange = useCallback(
    (value: string) => {
      onChange(value);

      documentVersionRef.current += 1;
      const version = documentVersionRef.current;

      if (notifyChangeDebounceRef.current) {
        clearTimeout(notifyChangeDebounceRef.current);
      }

      notifyChangeDebounceRef.current = setTimeout(() => {
        NotifyFileChanged(filePath, language, version, value).catch(() => {});
      }, 150);
    },
    [filePath, language, onChange],
  );

  const formatDocumentAsync = useCallback(
    async (view: EditorView) => {
      const contentText = view.state.doc.toString();
      const lowerPath = filePath.toLowerCase();

      try {
        let formatted: string | null = null;
        if (language === "php") {
          formatted = await prettier.format(contentText, {
            parser: "php",
            plugins: [prettierPluginPhp],
            printWidth: 120,
            tabWidth: 4,
            semi: true,
            trailingComma: "all",
            singleQuote: false,
          });
        } else if (language === "html" || lowerPath.endsWith(".blade.php")) {
          formatted = await prettier.format(contentText, {
            parser: "html",
            plugins: [prettierPluginHtml],
            printWidth: 120,
            tabWidth: 2,
            semi: true,
            trailingComma: "all",
            singleQuote: false,
            htmlWhitespaceSensitivity: "css",
          });
        } else if (
          language === "javascript" ||
          language === "javascriptreact"
        ) {
          formatted = await prettier.format(contentText, {
            parser: "babel",
            plugins: [prettierPluginBabel, prettierPluginEstree],
            printWidth: 80,
            tabWidth: 2,
            semi: true,
            trailingComma: "all",
            singleQuote: false,
            arrowParens: "always",
          });
        } else if (
          language === "typescript" ||
          language === "typescriptreact"
        ) {
          formatted = await prettier.format(contentText, {
            parser: "typescript",
            plugins: [prettierPluginTypescript, prettierPluginEstree],
            printWidth: 80,
            tabWidth: 2,
            semi: true,
            trailingComma: "all",
            singleQuote: false,
            arrowParens: "always",
          });
        } else if (language === "css" || language === "scss") {
          formatted = await prettier.format(contentText, {
            parser: "css",
            plugins: [prettierPluginPostcss],
            printWidth: 80,
            tabWidth: 2,
            semi: true,
            singleQuote: false,
          });
        } else if (language === "json") {
          formatted = await prettier.format(contentText, {
            parser: "json",
            plugins: [prettierPluginBabel, prettierPluginEstree],
            printWidth: 80,
            tabWidth: 2,
            trailingComma: "none",
          });
        } else {
          return false;
        }

        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: formatted },
        });
        return true;
      } catch (error) {
        console.error("Prettier formatting failed:", error);
        return false;
      }
    },
    [filePath, language],
  );

  const formatDocument = (view: EditorView) => {
    void formatDocumentAsync(view);
    return true;
  };

  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSave?.();
            return true;
          },
        },
      ]),
    [onSave],
  );

  const formatKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Shift-Alt-f",
          run: (view) => {
            void formatDocument(view);
            return true;
          },
        },
      ]),
    [formatDocument],
  );

  const fontSizeExtension = useMemo(
    () =>
      EditorView.theme({
        "&": {
          fontSize: `${editorFontSize}px`,
        },
      }),
    [editorFontSize],
  );

  const definitionLinkExtension = useMemo<Extension[]>(() => {
    const clearDefinitionLink = (view: EditorView) => {
      view.dispatch({ effects: setDefinitionLinkEffect.of(null) });
      view.dom.style.cursor = "";
    };

    const resolveDefinitionMenu = async (
      view: EditorView,
      pos: number,
      mode: "goto" | "quickLook",
    ) => {
      if (!projectPath) return;

      const line = view.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;
      const wordInfo = getWordAtLinePosition(line.text, column, language);
      if (!wordInfo) return;

      const fullText = view.state.doc.toString();
      const { contextBefore, contextAfter } = buildDefinitionContext(
        fullText,
        lineNumber,
        wordInfo.startColumn,
        wordInfo.endColumn,
      );

      const results = await findDefinitions(
        wordInfo.word,
        contextBefore,
        contextAfter,
        projectPath,
        filePath,
        fullText,
        lineNumber,
        wordInfo.startColumn - 1,
      );

      if (results.length === 0) return;
      if (results.length === 1) {
        if (mode === "quickLook") {
          onQuickLook?.(results[0].path, results[0].line);
        } else {
          onOpenFile?.(results[0].path, results[0].line);
        }
        return;
      }

      const coords = view.coordsAtPos(line.from + wordInfo.startColumn - 1);
      if (!coords) return;

      setDefinitionMenu({
        isOpen: true,
        x: coords.left,
        y: coords.bottom,
        items: results,
        mode,
      });
    };

    return [
      definitionLinkField,
      EditorView.domEventHandlers({
        mousemove: (event, view) => {
          if (!projectPath || !filePath) return false;

          const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
          if (!hasModifier) {
            clearDefinitionLink(view);
            return false;
          }

          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) {
            clearDefinitionLink(view);
            return false;
          }

          const line = view.state.doc.lineAt(pos);
          const column = pos - line.from + 1;
          const wordInfo = getWordAtLinePosition(line.text, column, language);
          if (!wordInfo) {
            clearDefinitionLink(view);
            return false;
          }

          const beforeWord = line.text.substring(0, wordInfo.startColumn - 1);
          const afterWord = line.text.substring(wordInfo.endColumn - 1);
          const hasDefinition = checkIfHasDefinition(
            wordInfo.word,
            beforeWord,
            afterWord,
          );
          if (!hasDefinition) {
            clearDefinitionLink(view);
            return false;
          }

          view.dispatch({
            effects: setDefinitionLinkEffect.of({
              from: line.from + wordInfo.startColumn - 1,
              to: line.from + wordInfo.endColumn - 1,
            }),
          });
          view.dom.style.cursor = "pointer";
          return false;
        },
        mouseleave: (_event, view) => {
          clearDefinitionLink(view);
          return false;
        },
        mousedown: (event, view) => {
          if (event.button !== 0) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;

          if (event.altKey && !event.metaKey && !event.ctrlKey) {
            resolveDefinitionMenu(view, pos, "quickLook");
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            resolveDefinitionMenu(view, pos, "goto");
            return true;
          }
          return false;
        },
      }),
    ];
  }, [filePath, onOpenFile, onQuickLook, projectPath]);

  const hoverExtension = useMemo(
    () =>
      hoverTooltip(async (view, pos) => {
        if (language !== "php") return null;

        const line = view.state.doc.lineAt(pos);
        const lineNumber = line.number;
        const column = pos - line.from + 1;

        try {
          const hoverContent = await LSPHover(
            filePath,
            view.state.doc.toString(),
            lineNumber - 1,
            column - 1,
          );
          if (!hoverContent || hoverContent.trim() === "") return null;

          const formatted = formatHoverContent(hoverContent);
          const dom = document.createElement("div");
          dom.className = "cm-tooltip cm-tooltip-hover";
          if (formatted.startsWith("php\n")) {
            const code = document.createElement("code");
            code.textContent = formatted.replace(/^php\n/, "");
            dom.appendChild(code);
          } else {
            dom.textContent = formatted;
          }

          return {
            pos,
            end: pos,
            create: () => ({ dom }),
          };
        } catch (error) {
          console.error("Hover error:", error);
          return null;
        }
      }),
    [filePath, language],
  );

  const signatureHelpExtension = useMemo<Extension[]>(() => {
    return [
      signatureTooltipField,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;

        let shouldTrigger = false;
        update.transactions.forEach((transaction) => {
          if (!transaction.isUserEvent("input")) return;
          transaction.changes.iterChanges(
            (_fromA, _toA, _fromB, _toB, inserted) => {
              const text = inserted.toString();
              if (text.includes("(") || text.includes(",")) {
                shouldTrigger = true;
              }
              if (text.includes(")")) {
                clearSignatureHelp();
              }
            },
          );
        });

        if (shouldTrigger) {
          const pos = update.state.selection.main.head;
          requestSignatureHelp(update.view, pos);
        }
      }),
    ];
  }, [requestSignatureHelp, clearSignatureHelp]);

  const extensions: Extension[] = [
    blackprintTheme,
    editorStyles,
    fontSizeExtension,
    gitGutterExtension,
    ghost.ghostField,
    highlightLineField,
    ghost.extension,
    metrics.extension,
    orchestrator.extension,
    hoverExtension,
    EditorView.lineWrapping,
    indentOnInput(),
    bracketMatching(),
    foldGutter(),
    lintGutter(),
    search(),
    Prec.highest(ghost.keymap),
    keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
    saveKeymap,
    formatKeymap,
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;
      syncCursorPosition(update.state);
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (update.view.composing || update.view.compositionStarted) return;

      let insertedNonWhitespace = false;
      update.transactions.forEach((transaction) => {
        if (!transaction.isUserEvent("input")) return;
        if (transaction.isUserEvent("input.type.compose")) return;
        if (transaction.isUserEvent("input.complete")) return;
        if (
          !transaction.isUserEvent("input.type") &&
          !transaction.isUserEvent("input.paste")
        ) {
          return;
        }
        transaction.changes.iterChanges(
          (_fromA, _toA, _fromB, _toB, inserted) => {
            if (/\S/.test(inserted.toString())) {
              insertedNonWhitespace = true;
            }
          },
        );
      });

      if (!insertedNonWhitespace) return;

      const currentPos = update.state.selection.main.head;
      const recentText = update.state.doc.sliceString(
        Math.max(0, currentPos - 2),
        currentPos,
      );
      const isAccessTrigger = endsWithAccessTrigger(recentText);

      if (completionStatus(update.state) !== null && !isAccessTrigger) return;

      const view = update.view;
      const docSnapshot = update.state.doc;

      queueMicrotask(() => {
        if (view.state.doc !== docSnapshot) return;
        const status = completionStatus(view.state);
        if (status !== null && !isAccessTrigger) return;
        if (view.composing || view.compositionStarted) return;
        if (isAccessTrigger && status !== null) {
          closeCompletion(view);
        }
        metrics.recordAutocompleteRequested();
        startCompletion(view);
      });
    }),
    autocompletion({
      override: [backendCompletionSource],
      activateOnTyping: false,
      activateOnTypingDelay: 0,
      updateSyncTime: 0,
      maxRenderedOptions: 50,
      defaultKeymap: true,
      closeOnBlur: true,
      interactionDelay: 0,
      addToOptions: [
        {
          render(completion) {
            const src = (completion as unknown as Record<string, unknown>)
              .__source as string;
            if (!src) return null;
            const el = document.createElement("span");
            el.className = "cm-completionSource";
            el.textContent = src;
            return el;
          },
          position: 90,
        },
      ],
    }),
    rainbowBrackets(),
    ...diagnosticsExtension,
  ];

  if (shouldShowMinimap) {
    extensions.push(
      showMinimap.compute(["doc"], () => ({
        create: () => ({ dom: document.createElement("div") }),
        displayText: "blocks",
        showOverlay: "always",
      })),
    );
  }

  const langExt = getLanguageExtension(language);
  if (langExt) extensions.push(langExt);
  extensions.push(...definitionLinkExtension, ...signatureHelpExtension);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <DiagnosticsDonutIndicator
        filePath={filePath}
        fileName={fileName}
        rightOffset={shouldShowMinimap ? 74 : 12}
        onClick={onToggleProblems}
      />

      <CodeMirror
        ref={editorRef}
        value={content}
        onChange={handleChange}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: false,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: false,
          bracketMatching: false,
          closeBrackets: true,
          autocompletion: false,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          searchKeymap: false,
          tabSize: 4,
        }}
        theme="none"
        className="h-full"
        onCreateEditor={(view) => {
          syncCursorPosition(view.state);
        }}
      />

      <DefinitionChooserMenu
        isOpen={definitionMenu.isOpen}
        x={definitionMenu.x}
        y={definitionMenu.y}
        items={definitionMenu.items}
        onSelect={(path, line) => {
          if (definitionMenu.mode === "quickLook" && onQuickLook) {
            onQuickLook(path, line);
          } else if (onOpenFile) {
            onOpenFile(path, line);
          }
          setDefinitionMenu({
            isOpen: false,
            x: 0,
            y: 0,
            items: [],
            mode: "goto",
          });
        }}
        onClose={() => {
          setDefinitionMenu({
            isOpen: false,
            x: 0,
            y: 0,
            items: [],
            mode: "goto",
          });
        }}
      />
    </div>
  );
};

function mapCompletionKindString(kind: string): string {
  const normalized = kind.toLowerCase();
  const kindMap: Record<string, string> = {
    text: "text",
    method: "method",
    function: "function",
    constructor: "constructor",
    field: "field",
    variable: "variable",
    class: "class",
    interface: "interface",
    module: "module",
    property: "property",
    unit: "unit",
    value: "value",
    enum: "enum",
    keyword: "keyword",
    snippet: "snippet",
    file: "file",
    reference: "reference",
    folder: "folder",
    enummember: "enum-member",
    constant: "constant",
    struct: "type",
    event: "event",
    operator: "operator",
    typeparameter: "type-parameter",
    model: "class",
    controller: "class",
    middleware: "function",
    migration: "file",
    trait: "interface",
    namespace: "module",
    package: "module",
    decorator: "function",
    test: "function",
  };
  return kindMap[normalized] || normalized || "text";
}

export default CodeMirrorEditor;
