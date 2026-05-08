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
  ViewPlugin,
  ViewUpdate,
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
  Transaction,
} from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
  startCompletion,
  closeCompletion,
  closeBrackets,
  completionStatus,
  completionKeymap,
  acceptCompletion,
  insertCompletionText,
  pickedCompletion,
  snippet,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileText,
  Search as SearchIcon,
  Scissors,
} from "lucide-react";
import {
  bracketMatching,
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
import rainbowBrackets from "rainbowbrackets";
import { showMinimap } from "@replit/codemirror-minimap";
import { useEditorStore } from "../stores/editorStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { useCodeMirrorAdaptiveExtensions } from "../hooks/useCodeMirrorAdaptiveExtensions";
import {
  resolveAdaptiveEditorFeatureBudget,
  usePerformanceStore,
} from "../stores/performanceStore";
import {
  findDefinitions,
  checkIfHasDefinition,
} from "../utils/laravelDefinitionProvider";
import {
  DefinitionChooserMenu,
  DefinitionItem as MenuDefinitionItem,
} from "./DefinitionChooserMenu";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";
import type {
  EditorCompletionResult,
  TextEditJSON,
} from "../../bindings/arlecchino/models";
import {
  GetEditorCompletions,
  LSPHover,
  NotifyFileOpened,
  NotifyFileClosed,
  NotifyFileChanged,
  LSPSignatureHelp,
  RecordCompletionUsage,
  RecordFileAccess,
  RevealProjectEntry,
  SearchClasses,
} from "../wails/app";
import { createCompletionOrchestrator } from "../extensions/completionOrchestrator";
import { createDiagnosticsExtension } from "../extensions/diagnosticsExtension";
import { createGitGutterExtension } from "../extensions/gitGutterExtension";
import {
  ghostExtension,
  type GhostExtensionHandle,
} from "../extensions/ghostExtension";
import {
  metricsExtension,
  type MetricsHandle,
} from "../extensions/metricsExtension";
import { createOperatorLigaturesExtension } from "../extensions/operatorLigaturesExtension";
import { useGitStore } from "../stores/gitStore";
import { createCompletionCache } from "../utils/completionCache";
import {
  getInstantAccessCompletions,
  getInstantDocumentCompletions,
  getInstantKeywordCompletions,
  mergeInstantCompletions,
} from "../utils/instantCompletions";
import {
  readClipboardTextWithFallback,
  writeClipboardTextWithFallback,
} from "../utils/clipboard";
import {
  getCodeMirrorLineCount,
  shouldEnableCodeMirrorMinimap,
  shouldUseCodeMirrorLargeDocumentMode,
} from "../utils/codeMirrorDisplay";
import {
  editorCanvasBackground,
  codeEditorStyles,
  codeEditorSurfaceClassName,
  codeEditorTheme,
} from "../utils/codeMirrorTheme";
import { codeMirrorFileSearchExtension } from "../utils/codeMirrorFileSearch";
import type { GitLineMarker } from "../utils/git";
import { createLatestRequestGuard } from "../utils/latestRequestGuard";
import { relativeProjectPath } from "../utils/projectPaths";

const GHOST_DEBOUNCE_MS = 50;
const GHOST_IDLE_DELAY_MS = 900;
const COMPLETION_FAST_BACKEND_GRACE_MS = 32;
const EMPTY_GIT_MARKERS: GitLineMarker[] = [];
const EMPTY_EXTENSION: Extension = [];
const NOOP_METRICS: MetricsHandle = {
  extension: EMPTY_EXTENSION,
  recordGhostShown: () => undefined,
  recordGhostRejected: () => undefined,
  recordCompletionAccepted: () => undefined,
  recordCompletionList: () => undefined,
  recordAutocompleteRequested: () => undefined,
  recordBackendRequestStarted: () => undefined,
  recordCacheHit: () => undefined,
  recordCacheMiss: () => undefined,
  recordInstantFallbackUsed: () => undefined,
  recordAccessChainWarmHit: () => undefined,
};
const NOOP_GHOST: GhostExtensionHandle = {
  extension: EMPTY_EXTENSION,
  keymap: EMPTY_EXTENSION,
  cleanup: () => undefined,
  ghostField: EMPTY_EXTENSION,
};
const COMPLETION_KEYMAP_WITHOUT_ESCAPE_OR_ENTER = completionKeymap.filter(
  (binding) => binding.key !== "Escape" && binding.key !== "Enter",
);

function acceptVisibleCompletion(view: EditorView): boolean {
  if (completionStatus(view.state) !== "active") {
    return false;
  }
  if (acceptCompletion(view)) {
    return true;
  }

  window.setTimeout(() => {
    if (completionStatus(view.state) === "active") {
      acceptCompletion(view);
    }
  }, COMPLETION_FAST_BACKEND_GRACE_MS);
  return true;
}

type CompletionWithInsertText = Completion & {
  __insertText: string;
  __hasAdditionalTextEdits: boolean;
};
type CompletionPayload = {
  label?: string;
  text?: string;
  insertText?: string;
  isSnippet?: boolean;
  additionalTextEdits?: TextEditJSON[];
};
type CompletionTextEditChange = {
  from: number;
  to: number;
  insert: string;
};
const SIGNATURE_HIDE_MS = 2400;
const COMPLETION_CACHE_TTL_MS = 2000;
const MINIMAP_GUTTER_SELECTOR = ":scope > .cm-minimap-gutter";
const MINIMAP_DOCK_OFFSET_PROPERTY = "--cm-minimap-dock-offset";
const editorCanvasStyle = {
  background: editorCanvasBackground,
  boxShadow: "none",
} as const;

const makePrimitiveKeyPart = (part: unknown): string => {
  if (part === null) return "null";
  if (part === undefined) return "undefined";
  return `${typeof part}:${String(part)}`;
};

const useStableReferenceKey = (parts: readonly unknown[]): string => {
  const objectIdsRef = useRef<WeakMap<object, number>>(new WeakMap());
  const nextObjectIdRef = useRef(1);

  return parts
    .map((part) => {
      if (
        (typeof part !== "object" && typeof part !== "function") ||
        part === null
      ) {
        return makePrimitiveKeyPart(part);
      }

      const objectPart = part as object;
      const existingId = objectIdsRef.current.get(objectPart);
      if (existingId !== undefined) {
        return `ref:${existingId}`;
      }

      const nextId = nextObjectIdRef.current;
      nextObjectIdRef.current += 1;
      objectIdsRef.current.set(objectPart, nextId);
      return `ref:${nextId}`;
    })
    .join("|");
};

const getEditorScaleX = (view: EditorView): number => {
  const rootScale = Number.parseFloat(
    getComputedStyle(document.documentElement)
      .getPropertyValue("--ui-scale")
      .trim(),
  );
  if (Number.isFinite(rootScale) && rootScale > 0) {
    return rootScale;
  }

  return view.scaleX || 1;
};

const getCurrentMinimapDockOffset = (gutter: HTMLElement): number => {
  const offset = Number.parseFloat(
    gutter.style.getPropertyValue(MINIMAP_DOCK_OFFSET_PROPERTY),
  );
  return Number.isFinite(offset) ? offset : 0;
};

const PANEL_LAYOUT_CONTAINER_SELECTOR =
  "[data-panel-layout-changing], [data-panel-drop-settling]";
const PANEL_LAYOUT_CHANGING_SELECTOR =
  '[data-panel-layout-changing="true"], [data-panel-drop-settling="true"]';

const minimapDockingExtension = ViewPlugin.fromClass(
  class {
    private animationFrame: number | null = null;
    private mutationObserver: MutationObserver | null = null;
    private panelLayoutObserver: MutationObserver | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private deferredPanelLayoutMeasure = false;

    constructor(private readonly view: EditorView) {
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.requestMeasure());
        this.resizeObserver.observe(view.dom);
        this.resizeObserver.observe(view.scrollDOM);
      }

      if (typeof MutationObserver !== "undefined") {
        this.mutationObserver = new MutationObserver(() =>
          this.requestMeasure(),
        );
        this.mutationObserver.observe(document.documentElement, {
          attributeFilter: ["style"],
          attributes: true,
        });
      }

      this.requestMeasure();
    }

    update(update: ViewUpdate) {
      if (update.geometryChanged || update.docChanged) {
        this.requestMeasure();
      }
    }

    requestMeasure() {
      if (this.isPanelLayoutChanging()) {
        this.deferredPanelLayoutMeasure = true;
        this.ensurePanelLayoutObserver();
        return;
      }

      if (this.animationFrame !== null) {
        return;
      }

      this.animationFrame = requestAnimationFrame(() => {
        this.animationFrame = null;
        this.updateDockOffset();
      });
    }

    private getPanelLayoutContainer(): HTMLElement | null {
      return this.view.dom.closest<HTMLElement>(
        PANEL_LAYOUT_CONTAINER_SELECTOR,
      );
    }

    private isPanelLayoutChanging(): boolean {
      return this.view.dom.closest(PANEL_LAYOUT_CHANGING_SELECTOR) !== null;
    }

    private ensurePanelLayoutObserver() {
      if (
        typeof MutationObserver === "undefined" ||
        this.panelLayoutObserver !== null
      ) {
        return;
      }

      const container = this.getPanelLayoutContainer();
      if (!container) {
        return;
      }

      this.panelLayoutObserver = new MutationObserver(() => {
        if (this.isPanelLayoutChanging()) {
          return;
        }

        this.panelLayoutObserver?.disconnect();
        this.panelLayoutObserver = null;

        if (!this.deferredPanelLayoutMeasure) {
          return;
        }

        this.deferredPanelLayoutMeasure = false;
        this.requestMeasure();
      });
      this.panelLayoutObserver.observe(container, {
        attributeFilter: [
          "data-panel-layout-changing",
          "data-panel-drop-settling",
        ],
        attributes: true,
      });
    }

    private updateDockOffset() {
      if (this.isPanelLayoutChanging()) {
        this.deferredPanelLayoutMeasure = true;
        this.ensurePanelLayoutObserver();
        return;
      }

      const gutter = this.view.scrollDOM.querySelector<HTMLElement>(
        MINIMAP_GUTTER_SELECTOR,
      );
      if (!gutter) {
        return;
      }

      const scaleX = getEditorScaleX(this.view);
      const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
      const gutterRect = gutter.getBoundingClientRect();
      const targetRight =
        scrollerRect.left + this.view.scrollDOM.clientWidth * scaleX;
      const currentOffset = getCurrentMinimapDockOffset(gutter);
      const dockOffset =
        currentOffset + (targetRight - gutterRect.right) / scaleX;

      gutter.style.setProperty(
        MINIMAP_DOCK_OFFSET_PROPERTY,
        `${Math.round(dockOffset * 100) / 100}px`,
      );
    }

    destroy() {
      if (this.animationFrame !== null) {
        cancelAnimationFrame(this.animationFrame);
      }
      this.resizeObserver?.disconnect();
      this.mutationObserver?.disconnect();
      this.panelLayoutObserver?.disconnect();
      this.panelLayoutObserver = null;
      this.deferredPanelLayoutMeasure = false;

      const gutter = this.view.scrollDOM.querySelector<HTMLElement>(
        MINIMAP_GUTTER_SELECTOR,
      );
      gutter?.style.removeProperty(MINIMAP_DOCK_OFFSET_PROPERTY);
    }
  },
  {},
);

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

  const generalAccessMatch = textBefore.match(
    /((?:\$?[A-Za-z_][\w$]*|\\?[A-Za-z_][\w$]*)(?:(?:\\|\.|::|->)[A-Za-z_][\w$]*)*(?:->|::|\.))([A-Za-z_$][\w$]*)?$/,
  );
  if (generalAccessMatch) {
    return {
      accessChain: generalAccessMatch[1],
      prefix: generalAccessMatch[2] || "",
    };
  }

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

function extractGoPackageNamePrefix(textBeforeLine: string): string | null {
  const match = textBeforeLine.match(
    /^\s*package\s+([A-Za-z_][A-Za-z0-9_]*)?$/,
  );
  return match ? (match[1] ?? "") : null;
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

function hasSnippetPlaceholder(snippetText: string): boolean {
  return /\$\d+|\$\{\d+(?::[^}]*)?\}/.test(snippetText);
}

function toCodeMirrorSnippetTemplate(snippetText: string): string {
  return snippetText.replace(/\$(\d+)/g, (_match, index: string) =>
    index === "0" ? "${}" : `\${${index}}`,
  );
}

function textEditToChange(
  state: EditorState,
  edit: TextEditJSON,
): CompletionTextEditChange {
  const startLine = state.doc.line(edit.startLine);
  const endLine = state.doc.line(edit.endLine);
  return {
    from: startLine.from + edit.startColumn - 1,
    to: endLine.from + edit.endColumn - 1,
    insert: edit.text,
  };
}

function applyAdditionalTextEdits(
  view: EditorView,
  edits?: TextEditJSON[],
): { from: (position: number, assoc?: number) => number } | null {
  if (!edits?.length) {
    return null;
  }

  const changes = edits
    .map((edit) => textEditToChange(view.state, edit))
    .sort((a, b) => a.from - b.from);
  const changeSet = view.state.changes(changes);
  view.dispatch({
    changes: changeSet,
    annotations: Transaction.userEvent.of("input.complete"),
  });

  return {
    from: (position, assoc = 1) => changeSet.mapPos(position, assoc),
  };
}

function applyBackendCompletion(
  view: EditorView,
  completionToApply: Completion,
  from: number,
  to: number,
  insertText: string,
  plainText: string,
  isSnippet: boolean,
  additionalTextEdits?: TextEditJSON[],
) {
  const mapper = applyAdditionalTextEdits(view, additionalTextEdits);
  const mappedFrom = mapper ? mapper.from(from, 1) : from;
  const mappedTo = mapper ? mapper.from(to, -1) : to;

  if (isSnippet && hasSnippetPlaceholder(insertText)) {
    snippet(toCodeMirrorSnippetTemplate(insertText))(
      view,
      completionToApply,
      mappedFrom,
      mappedTo,
    );
    return;
  }

  const completionTransaction = insertCompletionText(
    view.state,
    plainText,
    mappedFrom,
    mappedTo,
  );
  view.dispatch({
    ...completionTransaction,
    annotations: [
      pickedCompletion.of(completionToApply),
      Transaction.userEvent.of("input.complete"),
    ],
  });
}

function completionAddsUsefulText(
  prefix: string,
  insertText: string,
  additionalTextEdits?: TextEditJSON[],
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

function isProbablyLineComment(textBeforeLine: string, language: string) {
  const trimmed = textBeforeLine.trimStart();
  if (!trimmed) return false;
  if (trimmed.startsWith("//") || trimmed.startsWith("/*")) return true;
  if (
    ["python", "ruby", "bash", "shell", "yaml", "dockerfile"].includes(
      language,
    ) &&
    trimmed.startsWith("#")
  ) {
    return true;
  }
  return language === "sql" && trimmed.startsWith("--");
}

function hasOpenStringLiteral(textBeforeLine: string) {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (const char of textBeforeLine) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    }
  }

  return quote !== null;
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
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onTypingRef = useRef(onTyping);
  const onGhostShownRef = useRef(onGhostShown);
  const onGhostRejectedRef = useRef(onGhostRejected);
  const documentVersionRef = useRef<number>(0);
  const cursorSyncFrameRef = useRef<number | null>(null);
  const pendingCursorPositionRef = useRef<{ line: number; col: number } | null>(
    null,
  );
  const completionDismissedVersionRef = useRef<number | null>(null);
  const autoStartedCompletionVersionRef = useRef<number | null>(null);
  const initialDocLengthRef = useRef(content.length);
  const completionCacheRef = useRef(
    createCompletionCache(COMPLETION_CACHE_TTL_MS),
  );
  const signatureRequestGuardRef = useRef(createLatestRequestGuard());

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onTypingRef.current = onTyping;
  onGhostShownRef.current = onGhostShown;
  onGhostRejectedRef.current = onGhostRejected;

  const editorFontSize = useEditorSettingsStore(
    (state) => state.editorFontSize,
  );
  const showInlineDiagnostics = useEditorSettingsStore(
    (state) => state.showInlineDiagnostics,
  );
  const showMinimapSetting = useEditorSettingsStore(
    (state) => state.showMinimap,
  );
  const showRainbowBrackets = useEditorSettingsStore(
    (state) => state.showRainbowBrackets,
  );
  const showOperatorLigatures = useEditorSettingsStore(
    (state) => state.showOperatorLigatures,
  );
  const largeDocumentMode = useMemo(
    () => shouldUseCodeMirrorLargeDocumentMode(content),
    [content],
  );
  const contentLineCount = useMemo(
    () => getCodeMirrorLineCount(content),
    [content],
  );
  const adaptivePerformanceMode = usePerformanceStore((state) => state.mode);
  const updatePerformanceBudget = usePerformanceStore(
    (state) => state.updateBudget,
  );
  const resetActiveEditorBudget = usePerformanceStore(
    (state) => state.resetActiveEditorBudget,
  );
  const editorFeatureBudget = useMemo(
    () =>
      resolveAdaptiveEditorFeatureBudget({
        mode: adaptivePerformanceMode,
        frameGapMs: 0,
        eventPressure: 0,
        activeEditorCharCount: content.length,
        activeEditorLineCount: contentLineCount,
        activeEditorLargeDocument: largeDocumentMode,
        indexerQueueDepth: 0,
        projectFileCount: 0,
        updatedAtMs: 0,
      }),
    [
      adaptivePerformanceMode,
      content.length,
      contentLineCount,
      largeDocumentMode,
    ],
  );
  const notifyChangeDelayRef = useRef(editorFeatureBudget.notifyChangeDelayMs);
  const gitMarkers = useGitStore((state) =>
    !editorFeatureBudget.layoutStableGitGutter
      ? EMPTY_GIT_MARKERS
      : (state.fileMarkers[filePath] ?? EMPTY_GIT_MARKERS),
  );
  const refreshFileMarkers = useGitStore((state) => state.refreshFileMarkers);
  const clearFileMarkers = useGitStore((state) => state.clearFileMarkers);
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const diagnosticsExtension = useMemo(
    () =>
      !editorFeatureBudget.runtimeDiagnostics
        ? []
        : createDiagnosticsExtension({
            filePath,
            language,
            enabled: showInlineDiagnostics,
          }),
    [
      editorFeatureBudget.runtimeDiagnostics,
      filePath,
      language,
      showInlineDiagnostics,
    ],
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
    updatePerformanceBudget({
      activeEditorCharCount: content.length,
      activeEditorLineCount: contentLineCount,
      activeEditorLargeDocument: largeDocumentMode,
    });
  }, [
    content.length,
    contentLineCount,
    largeDocumentMode,
    updatePerformanceBudget,
  ]);

  useEffect(() => {
    notifyChangeDelayRef.current = editorFeatureBudget.notifyChangeDelayMs;
  }, [editorFeatureBudget.notifyChangeDelayMs]);

  useEffect(
    () => () => {
      resetActiveEditorBudget();
    },
    [resetActiveEditorBudget],
  );

  useEffect(() => {
    if (!filePath || !language) return;

    documentVersionRef.current = 1;
    completionDismissedVersionRef.current = null;
    autoStartedCompletionVersionRef.current = null;
    completionCacheRef.current.invalidate();
    signatureRequestGuardRef.current.next();
    if (!largeDocumentMode) {
      NotifyFileOpened(filePath, language, content).catch(console.warn);
    }
    RecordFileAccess(filePath).catch(() => {});

    return () => {
      if (!largeDocumentMode) {
        NotifyFileClosed(filePath, language).catch(console.warn);
      }
    };
  }, [filePath, language, largeDocumentMode]);

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
      if (!editorFeatureBudget.hover) return;
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
    [clearSignatureHelp, editorFeatureBudget.hover, filePath, language],
  );

  const metrics = useMemo(() => {
    if (!editorFeatureBudget.richEditorFeatures) {
      return NOOP_METRICS;
    }

    return metricsExtension(
      {
        onTyping: (chars) => onTypingRef.current?.(chars),
        onGhostShown: () => onGhostShownRef.current?.(),
        onGhostRejected: () => onGhostRejectedRef.current?.(),
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
    );
  }, [editorFeatureBudget.richEditorFeatures]);

  const shouldShowMinimap = useMemo(
    () =>
      editorFeatureBudget.layoutStableMinimap &&
      showMinimapSetting &&
      shouldEnableCodeMirrorMinimap(content),
    [content, editorFeatureBudget.layoutStableMinimap, showMinimapSetting],
  );

  const gitGutterExtension = useMemo(
    () => createGitGutterExtension({ markers: gitMarkers }),
    [gitMarkers],
  );

  useEffect(() => {
    if (!filePath) return;
    if (!editorFeatureBudget.runtimeGitGutter) return;

    const timer = window.setTimeout(() => {
      void refreshFileMarkers(filePath);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editorFeatureBudget.runtimeGitGutter, filePath, refreshFileMarkers]);

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
      pendingCursorPositionRef.current = {
        line: line.number,
        col: head - line.from + 1,
      };
      if (cursorSyncFrameRef.current !== null) {
        return;
      }
      cursorSyncFrameRef.current = window.requestAnimationFrame(() => {
        cursorSyncFrameRef.current = null;
        const pending = pendingCursorPositionRef.current;
        if (!pending) {
          return;
        }
        setCursorPosition(pending.line, pending.col);
      });
    },
    [setCursorPosition],
  );

  useEffect(
    () => () => {
      if (cursorSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(cursorSyncFrameRef.current);
        cursorSyncFrameRef.current = null;
      }
    },
    [],
  );
  const fileName = useMemo(
    () => filePath.split("/").pop() || filePath,
    [filePath],
  );

  const orchestrator = useMemo(() => createCompletionOrchestrator({}), []);

  const handleEditorEscape = useCallback(() => {
    completionDismissedVersionRef.current = documentVersionRef.current;
    autoStartedCompletionVersionRef.current = null;
    orchestrator.cancelPending();
    clearSignatureHelp();
  }, [clearSignatureHelp, orchestrator]);

  const ghost = useMemo(() => {
    if (!editorFeatureBudget.ghostText) {
      return NOOP_GHOST;
    }

    return ghostExtension({
      filePath,
      language,
      ghostDebounceMs: GHOST_DEBOUNCE_MS,
      ghostIdleDelayMs: GHOST_IDLE_DELAY_MS,
      buildCompletionContext,
      fetchCompletions: async (payload) => {
        const result = (await GetEditorCompletions({
          ...payload,
          version: documentVersionRef.current,
        })) as EditorCompletionResult | null;
        if (!result) {
          return null;
        }
        return {
          ...result,
          primary: result.primary ?? undefined,
        };
      },
      onGhostShown: metrics.recordGhostShown,
      onGhostRejected: metrics.recordGhostRejected,
      onCompletionAccepted: (label) => {
        if (!label) return;
        metrics.recordCompletionAccepted({ label } as Completion);
      },
      onEscape: handleEditorEscape,
      helpers: {
        firstWordOrToken,
        trimToTokenLimit,
        snippetToPlainText,
        getWordAtLinePosition,
        extractStringPrefix,
        extractAccessPrefix,
        extractKeywordPrefix,
      },
    });
  }, [
    editorFeatureBudget.ghostText,
    filePath,
    handleEditorEscape,
    language,
    metrics,
  ]);

  useEffect(() => () => ghost.cleanup(), [ghost]);

  useEffect(() => {
    const handleAutocompleteEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;

      const view = editorRef.current?.view;
      if (!view?.hasFocus) return;
      if (completionStatus(view.state) === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      handleEditorEscape();
      closeCompletion(view);
    };

    window.addEventListener("keydown", handleAutocompleteEscape, true);
    return () =>
      window.removeEventListener("keydown", handleAutocompleteEscape, true);
  }, [handleEditorEscape]);

  const fetchPendingClassCompletions = useCallback(
    async (context: CompletionContext): Promise<Completion[]> => {
      if (!editorFeatureBudget.completions) return [];
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
    [editorFeatureBudget.completions, language, metrics],
  );

  const buildInstantCompletionResult = useCallback(
    (
      context: CompletionContext,
      buildOptions: { recordMetrics?: boolean } = {},
    ): CompletionResult | null => {
      if (!editorFeatureBudget.completions) return null;
      if (context.aborted) return null;

      const pos = context.pos;
      const line = context.state.doc.lineAt(pos);
      const column = pos - line.from + 1;
      const textBeforeLine = line.text.slice(0, column - 1);
      const accessInfo = extractAccessPrefix(textBeforeLine);
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const packageNamePrefix =
        language === "go" ? extractGoPackageNamePrefix(textBeforeLine) : null;

      if (
        (stringPrefix !== null && packageNamePrefix === null) ||
        isProbablyLineComment(textBeforeLine, language) ||
        hasOpenStringLiteral(textBeforeLine)
      ) {
        return null;
      }

      const prefixMatch = getPrefixMatch(textBeforeLine, language);
      const rawPrefix =
        packageNamePrefix ?? accessInfo?.prefix ?? prefixMatch?.prefix ?? "";
      const currentPrefix = normalizePrefixForLanguage(
        rawPrefix,
        language,
        prefixMatch?.hasDollarPrefix ?? false,
      );

      if (
        !accessInfo &&
        packageNamePrefix === null &&
        currentPrefix.length === 0
      ) {
        return null;
      }

      const from =
        packageNamePrefix !== null
          ? pos - packageNamePrefix.length
          : accessInfo
            ? line.from + column - accessInfo.prefix.length - 1
            : prefixMatch
              ? line.from + prefixMatch.startColumn - 1
              : pos;

      const instantDocumentOptions =
        !accessInfo &&
        packageNamePrefix === null &&
        currentPrefix.length >= 2 &&
        context.state.doc.length <= 160_000
          ? getInstantDocumentCompletions(
              context.state.doc.toString(),
              currentPrefix,
            )
          : [];
      const completionOptions =
        packageNamePrefix !== null
          ? [
              {
                label: "main",
                detail: "package name",
                type: "keyword",
                apply: "main",
                boost: 1.25,
              } satisfies Completion,
            ].filter((item) =>
              item.label.toLowerCase().startsWith(currentPrefix.toLowerCase()),
            )
          : accessInfo
            ? getInstantAccessCompletions(
                language,
                accessInfo.accessChain,
                currentPrefix,
              )
            : mergeInstantCompletions(
                getInstantKeywordCompletions(language, currentPrefix),
                instantDocumentOptions,
              );

      if (completionOptions.length === 0) {
        return null;
      }

      if (buildOptions.recordMetrics !== false) {
        metrics.recordInstantFallbackUsed();
        metrics.recordCompletionList(completionOptions);
      }
      return {
        from,
        options: completionOptions,
        validFor: getValidForRegex(language, false),
      };
    },
    [editorFeatureBudget.completions, language, metrics],
  );

  const instantCompletionSource = useCallback(
    (context: CompletionContext): CompletionResult | null =>
      buildInstantCompletionResult(context, { recordMetrics: true }),
    [buildInstantCompletionResult],
  );

  const backendCompletionSource = useCallback(
    (context: CompletionContext) => {
      if (!editorFeatureBudget.completions) return null;
      if (context.aborted) return null;
      const pos = context.pos;
      const line = context.state.doc.lineAt(pos);
      const lineNumber = line.number;
      const column = pos - line.from + 1;
      const textBeforeLine = line.text.slice(0, column - 1);
      const accessInfo = extractAccessPrefix(textBeforeLine);
      const stringPrefix = extractStringPrefix(textBeforeLine);
      const packageNamePrefix =
        language === "go" ? extractGoPackageNamePrefix(textBeforeLine) : null;
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
        packageNamePrefix ??
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
        packageNamePrefix !== null ||
        triggerChar === "<" ||
        triggerChar === ":" ||
        triggerChar === "{";

      if (!hasExplicitCompletionTrigger) {
        return null;
      }
      const from =
        stringPrefix !== null
          ? line.from + column - stringPrefix.length - 1
          : packageNamePrefix !== null
            ? pos - packageNamePrefix.length
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
      const wasAutoStartedForVersion =
        autoStartedCompletionVersionRef.current === requestVersion;
      const isDismissedForVersion = (version: number) =>
        completionDismissedVersionRef.current === version &&
        (!context.explicit || wasAutoStartedForVersion);
      if (isDismissedForVersion(requestVersion)) return null;

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
          version: requestVersion,
          lineText,
          textBefore,
          textAfter,
          fullText,
          currentClass,
          currentMethod,
          imports,
          triggerChar,
        })) as EditorCompletionResult | null;

        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (isDismissedForVersion(versionAtRequest)) return null;
        if (result && "stale" in result && result.stale) return null;
        if (!result?.items?.length) return null;

        const pendingItems = await fetchPendingClassCompletions(context);
        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (isDismissedForVersion(versionAtRequest)) return null;

        const completions: Completion[] = result.items.flatMap(
          (item, itemIndex) => {
            let insertText = item.insertText || item.text || item.label || "";
            if (shouldStripDollar && insertText.startsWith("$")) {
              insertText = insertText.slice(1);
            }
            const resolvedInsertText =
              snippetToPlainText(insertText) || insertText;
            const isSnippet =
              item.isSnippet === true || hasSnippetPlaceholder(insertText);
            if (
              isExactSelfEchoCompletion(item, currentPrefix, resolvedInsertText)
            ) {
              return [];
            }
            const kind = item.kind || "text";
            const source = item.source || "index";
            const sourceLabel = SOURCE_LABELS[source] || source;

            const applyCompletion = (
              view: EditorView,
              completionToApply: Completion,
              from: number,
              to: number,
            ) => {
              applyBackendCompletion(
                view,
                completionToApply,
                from,
                to,
                insertText,
                resolvedInsertText,
                isSnippet,
                item.additionalTextEdits,
              );
              metrics.recordCompletionAccepted(completionToApply);
            };

            const hasAdditionalTextEdits =
              (item.additionalTextEdits?.length || 0) > 0;
            const backendPriority = item.priority || 0;
            const stableIndexTiebreak = -itemIndex / 100000;
            const richCompletionBoost =
              isSnippet || hasAdditionalTextEdits ? 1.5 : 0;

            const completion: CompletionWithInsertText = {
              label: item.label || "",
              detail: item.detail || kind,
              info: item.documentation || undefined,
              type: mapCompletionKindString(kind),
              apply: applyCompletion,
              boost:
                richCompletionBoost +
                backendPriority / 1000 +
                stableIndexTiebreak,
              __insertText: resolvedInsertText,
              __hasAdditionalTextEdits: hasAdditionalTextEdits,
            };
            (completion as unknown as Record<string, unknown>).__source =
              sourceLabel;

            return [completion];
          },
        );

        const allOptions = [...pendingItems, ...completions];
        if (context.aborted || orchestrator.isStale(requestId)) return null;
        if (versionAtRequest !== documentVersionRef.current) return null;
        if (isDismissedForVersion(versionAtRequest)) return null;

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

      const instantResult = buildInstantCompletionResult(context, {
        recordMetrics: false,
      });
      const requestId = orchestrator.nextRequestId();
      const backendPromise = buildCompletionResult(
        requestId,
        requestVersion,
      ).catch((err) => {
        console.warn("Completion error:", err);
        return null;
      });
      if (instantResult) {
        return new Promise<CompletionResult | null>((resolve) => {
          let settled = false;
          const settle = (result: CompletionResult | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            resolve(result);
          };
          const settleInstant = () => {
            metrics.recordInstantFallbackUsed();
            metrics.recordCompletionList([...instantResult.options]);
            settle(instantResult);
          };
          const timer = window.setTimeout(() => {
            settleInstant();
          }, COMPLETION_FAST_BACKEND_GRACE_MS);

          backendPromise.then((result) => {
            if (result) {
              settle(result);
            } else {
              settleInstant();
            }
          });
        });
      }

      return backendPromise;
    },
    [
      filePath,
      language,
      buildInstantCompletionResult,
      editorFeatureBudget.completions,
      fetchPendingClassCompletions,
      metrics,
      orchestrator,
    ],
  );

  const handleChange = useCallback(
    (value: string) => {
      onChangeRef.current(value);

      documentVersionRef.current += 1;
      completionDismissedVersionRef.current = null;
      autoStartedCompletionVersionRef.current = null;
      completionCacheRef.current.invalidate();
      const version = documentVersionRef.current;

      if (largeDocumentMode) {
        return;
      }

      if (notifyChangeDebounceRef.current) {
        clearTimeout(notifyChangeDebounceRef.current);
      }

      notifyChangeDebounceRef.current = setTimeout(() => {
        NotifyFileChanged(filePath, language, version, value).catch(() => {});
      }, notifyChangeDelayRef.current);
    },
    [filePath, language, largeDocumentMode],
  );

  const formatDocumentAsync = useCallback(
    async (view: EditorView) => {
      if (largeDocumentMode) {
        return false;
      }

      const contentText = view.state.doc.toString();
      const lowerPath = filePath.toLowerCase();

      try {
        const { default: prettier } = await import("prettier/standalone");
        let formatted: string | null = null;
        if (language === "php") {
          const { default: prettierPluginPhp } =
            await import("@prettier/plugin-php");
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
          const { default: prettierPluginHtml } =
            await import("prettier/plugins/html");
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
          const [
            { default: prettierPluginBabel },
            { default: prettierPluginEstree },
          ] = await Promise.all([
            import("prettier/plugins/babel"),
            import("prettier/plugins/estree"),
          ]);
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
          const [
            { default: prettierPluginTypescript },
            { default: prettierPluginEstree },
          ] = await Promise.all([
            import("prettier/plugins/typescript"),
            import("prettier/plugins/estree"),
          ]);
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
          const { default: prettierPluginPostcss } =
            await import("prettier/plugins/postcss");
          formatted = await prettier.format(contentText, {
            parser: "css",
            plugins: [prettierPluginPostcss],
            printWidth: 80,
            tabWidth: 2,
            semi: true,
            singleQuote: false,
          });
        } else if (language === "json") {
          const [
            { default: prettierPluginBabel },
            { default: prettierPluginEstree },
          ] = await Promise.all([
            import("prettier/plugins/babel"),
            import("prettier/plugins/estree"),
          ]);
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
    [filePath, language, largeDocumentMode],
  );

  const formatDocument = useCallback(
    (view: EditorView) => {
      void formatDocumentAsync(view);
      return true;
    },
    [formatDocumentAsync],
  );

  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
      ]),
    [],
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

  const getEditorView = useCallback(
    (): EditorView | null => editorRef.current?.view ?? null,
    [],
  );

  const getSelectedText = useCallback((view: EditorView): string => {
    const selections = view.state.selection.ranges
      .filter((range) => !range.empty)
      .map((range) => view.state.doc.sliceString(range.from, range.to));

    if (selections.length > 0) {
      return selections.join("\n");
    }

    const line = view.state.doc.lineAt(view.state.selection.main.head);
    return line.text;
  }, []);

  const copyEditorText = useCallback(async () => {
    const view = getEditorView();
    if (!view) {
      return;
    }

    await writeClipboardTextWithFallback(getSelectedText(view));
    view.focus();
  }, [getEditorView, getSelectedText]);

  const cutEditorSelection = useCallback(async () => {
    const view = getEditorView();
    if (!view || view.state.selection.ranges.every((range) => range.empty)) {
      return;
    }

    const copied = await writeClipboardTextWithFallback(getSelectedText(view));
    if (!copied) {
      return;
    }

    view.dispatch(view.state.replaceSelection(""));
    view.focus();
  }, [getEditorView, getSelectedText]);

  const pasteIntoEditor = useCallback(async () => {
    const view = getEditorView();
    if (!view) {
      return;
    }

    const text = await readClipboardTextWithFallback();
    if (!text) {
      return;
    }

    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }, [getEditorView]);

  const selectAllEditorText = useCallback(() => {
    const view = getEditorView();
    if (!view) {
      return;
    }

    view.dispatch({
      selection: { anchor: 0, head: view.state.doc.length },
      scrollIntoView: true,
      userEvent: "select",
    });
    view.focus();
  }, [getEditorView]);

  const copyCurrentLineReference = useCallback(async () => {
    const view = getEditorView();
    if (!view || !filePath) {
      return;
    }

    const line = view.state.doc.lineAt(view.state.selection.main.head);
    await writeClipboardTextWithFallback(`${filePath}:${line.number}`);
    view.focus();
  }, [filePath, getEditorView]);

  const copyEditorRelativePath = useCallback(async () => {
    if (!filePath) {
      return;
    }

    await writeClipboardTextWithFallback(
      relativeProjectPath(filePath, projectPath),
    );
  }, [filePath, projectPath]);

  const copyEditorAbsolutePath = useCallback(async () => {
    if (!filePath) {
      return;
    }

    await writeClipboardTextWithFallback(filePath);
  }, [filePath]);

  const revealEditorFile = useCallback(() => {
    if (!filePath) {
      return;
    }

    void RevealProjectEntry(filePath).catch((error) => {
      console.error("[Editor] Reveal file failed", error);
    });
  }, [filePath]);

  const resolveDefinitionAtPosition = useCallback(
    async (view: EditorView, pos: number, mode: "goto" | "quickLook") => {
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
    },
    [filePath, language, onOpenFile, onQuickLook, projectPath],
  );

  const runDefinitionAction = useCallback(
    (mode: "goto" | "quickLook") => {
      const view = getEditorView();
      if (!view) {
        return;
      }

      void resolveDefinitionAtPosition(
        view,
        view.state.selection.main.head,
        mode,
      );
      view.focus();
    },
    [getEditorView, resolveDefinitionAtPosition],
  );

  const handleEditorContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const view = getEditorView();
      if (!view) {
        return;
      }

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        return;
      }

      const selection = view.state.selection.main;
      if (!selection.empty && pos >= selection.from && pos <= selection.to) {
        return;
      }

      view.dispatch({ selection: { anchor: pos } });
    },
    [getEditorView],
  );

  const editorContextMenuItems = useMemo<ContextActionMenuItem[]>(
    () => [
      {
        label: "Copy",
        shortcut: "Cmd C",
        icon: <Copy size={14} />,
        onSelect: () => void copyEditorText(),
      },
      {
        label: "Cut",
        shortcut: "Cmd X",
        icon: <Scissors size={14} />,
        onSelect: () => void cutEditorSelection(),
      },
      {
        label: "Paste",
        shortcut: "Cmd V",
        icon: <ClipboardPaste size={14} />,
        onSelect: () => void pasteIntoEditor(),
      },
      {
        label: "Select All",
        shortcut: "Cmd A",
        icon: <FileText size={14} />,
        onSelect: selectAllEditorText,
      },
      { separator: true },
      {
        label: "Go to Definition",
        shortcut: "Cmd Click",
        icon: <SearchIcon size={14} />,
        disabled: !projectPath || !onOpenFile,
        onSelect: () => runDefinitionAction("goto"),
      },
      {
        label: "Quick Look Definition",
        shortcut: "Alt Click",
        icon: <SearchIcon size={14} />,
        disabled: !projectPath || !onQuickLook,
        onSelect: () => runDefinitionAction("quickLook"),
      },
      {
        label: "Format Document",
        shortcut: "Shift Alt F",
        icon: <FileText size={14} />,
        disabled: largeDocumentMode,
        onSelect: () => {
          const view = getEditorView();
          if (view) {
            void formatDocument(view);
          }
        },
      },
      { separator: true },
      {
        label: "Copy Relative Path",
        icon: <Copy size={14} />,
        onSelect: () => void copyEditorRelativePath(),
      },
      {
        label: "Copy Absolute Path",
        icon: <Copy size={14} />,
        onSelect: () => void copyEditorAbsolutePath(),
      },
      {
        label: "Copy Path:Line",
        icon: <Copy size={14} />,
        onSelect: () => void copyCurrentLineReference(),
      },
      {
        label: "Reveal in File Manager",
        icon: <ExternalLink size={14} />,
        disabled: !filePath,
        onSelect: revealEditorFile,
      },
    ],
    [
      copyCurrentLineReference,
      copyEditorAbsolutePath,
      copyEditorRelativePath,
      copyEditorText,
      cutEditorSelection,
      filePath,
      formatDocument,
      getEditorView,
      largeDocumentMode,
      onOpenFile,
      onQuickLook,
      pasteIntoEditor,
      projectPath,
      revealEditorFile,
      runDefinitionAction,
      selectAllEditorText,
    ],
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
  const operatorLigaturesExtension = useMemo(
    () => createOperatorLigaturesExtension(showOperatorLigatures),
    [showOperatorLigatures],
  );

  const definitionLinkExtension = useMemo<Extension[]>(() => {
    if (!editorFeatureBudget.hover) {
      return [];
    }

    const clearDefinitionLink = (view: EditorView) => {
      view.dispatch({ effects: setDefinitionLinkEffect.of(null) });
      view.dom.style.cursor = "";
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
            void resolveDefinitionAtPosition(view, pos, "quickLook");
            return true;
          }
          if ((event.metaKey || event.ctrlKey) && !event.altKey) {
            void resolveDefinitionAtPosition(view, pos, "goto");
            return true;
          }
          return false;
        },
      }),
    ];
  }, [
    editorFeatureBudget.hover,
    filePath,
    language,
    projectPath,
    resolveDefinitionAtPosition,
  ]);

  const hoverExtension = useMemo<Extension[]>(() => {
    if (!editorFeatureBudget.hover) {
      return [];
    }

    return [
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
    ];
  }, [editorFeatureBudget.hover, filePath, language]);

  const signatureHelpExtension = useMemo<Extension[]>(() => {
    if (!editorFeatureBudget.hover) {
      return [];
    }

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
  }, [requestSignatureHelp, clearSignatureHelp, editorFeatureBudget.hover]);

  const languageExtension = useMemo(
    () => getLanguageExtension(language),
    [language],
  );

  const rainbowBracketsExtension = useMemo<Extension>(
    () => (showRainbowBrackets && !largeDocumentMode ? rainbowBrackets() : []),
    [largeDocumentMode, showRainbowBrackets],
  );

  const adaptiveExtensions = useMemo<Extension[]>(() => {
    const nextExtensions: Extension[] = [];

    if (editorFeatureBudget.layoutStableGitGutter) {
      nextExtensions.push(gitGutterExtension);
    }

    if (editorFeatureBudget.runtimeGhostText) {
      nextExtensions.push(
        ghost.ghostField,
        ghost.extension,
        Prec.highest(ghost.keymap),
      );
    }

    if (editorFeatureBudget.runtimeRichEditorFeatures) {
      nextExtensions.push(
        metrics.extension,
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
      );
    }

    nextExtensions.push(...diagnosticsExtension);

    if (editorFeatureBudget.runtimeCompletions) {
      nextExtensions.push(
        orchestrator.extension,
        Prec.highest(
          keymap.of([
            {
              key: "Enter",
              run: acceptVisibleCompletion,
            },
            ...COMPLETION_KEYMAP_WITHOUT_ESCAPE_OR_ENTER,
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.view.composing || update.view.compositionStarted) return;

          let insertedNonWhitespace = false;
          let insertedAutocompleteWhitespace = false;
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
                const insertedText = inserted.toString();
                if (/\S/.test(insertedText)) {
                  insertedNonWhitespace = true;
                } else if (/[^\S\r\n]/.test(insertedText)) {
                  insertedAutocompleteWhitespace = true;
                }
              },
            );
          });

          const currentPos = update.state.selection.main.head;
          const currentLine = update.state.doc.lineAt(currentPos);
          const textBeforeLine = currentLine.text.slice(
            0,
            currentPos - currentLine.from,
          );
          const isWhitespaceCompletionTrigger =
            insertedAutocompleteWhitespace &&
            language === "go" &&
            extractGoPackageNamePrefix(textBeforeLine) !== null;
          if (!insertedNonWhitespace && !isWhitespaceCompletionTrigger) return;

          const recentText = update.state.doc.sliceString(
            Math.max(0, currentPos - 2),
            currentPos,
          );
          const isAccessTrigger = endsWithAccessTrigger(recentText);

          if (
            completionStatus(update.state) === "active" &&
            !isAccessTrigger &&
            !isWhitespaceCompletionTrigger
          ) {
            return;
          }

          const view = update.view;
          const docSnapshot = update.state.doc;

          queueMicrotask(() => {
            if (view.state.doc !== docSnapshot) return;
            const version = documentVersionRef.current;
            if (completionDismissedVersionRef.current === version) return;
            const status = completionStatus(view.state);
            if (
              status === "active" &&
              !isAccessTrigger &&
              !isWhitespaceCompletionTrigger
            ) {
              return;
            }
            if (view.composing || view.compositionStarted) return;
            metrics.recordAutocompleteRequested();
            autoStartedCompletionVersionRef.current = version;
            startCompletion(view);
          });
        }),
        autocompletion({
          override: [instantCompletionSource, backendCompletionSource],
          activateOnTyping: false,
          activateOnTypingDelay: 0,
          updateSyncTime: COMPLETION_FAST_BACKEND_GRACE_MS,
          maxRenderedOptions: 50,
          defaultKeymap: false,
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
      );
    }

    if (editorFeatureBudget.runtimeHover) {
      nextExtensions.push(
        ...hoverExtension,
        ...definitionLinkExtension,
        ...signatureHelpExtension,
      );
    }

    return nextExtensions;
  }, [
    backendCompletionSource,
    definitionLinkExtension,
    diagnosticsExtension,
    editorFeatureBudget.runtimeCompletions,
    editorFeatureBudget.runtimeGhostText,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.runtimeHover,
    editorFeatureBudget.runtimeRichEditorFeatures,
    ghost,
    gitGutterExtension,
    hoverExtension,
    instantCompletionSource,
    metrics,
    orchestrator,
    signatureHelpExtension,
  ]);

  const adaptiveExtensionsKey = useStableReferenceKey([
    "adaptive",
    editorFeatureBudget.runtimeCompletions,
    editorFeatureBudget.runtimeDiagnostics,
    editorFeatureBudget.runtimeGhostText,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.runtimeHover,
    editorFeatureBudget.runtimeRichEditorFeatures,
    filePath,
    language,
    backendCompletionSource,
    instantCompletionSource,
    definitionLinkExtension,
    diagnosticsExtension,
    ghost,
    gitGutterExtension,
    hoverExtension,
    metrics,
    orchestrator,
    signatureHelpExtension,
  ]);

  const {
    adaptiveCompartmentExtension,
    bindEditorView,
    reapplyAdaptiveExtensions,
    scrollGuardExtension,
  } = useCodeMirrorAdaptiveExtensions(
    adaptiveExtensions,
    adaptiveExtensionsKey,
  );

  const extensions = useMemo<Extension[]>(() => {
    const nextExtensions: Extension[] = [
      codeEditorTheme,
      codeEditorStyles,
      fontSizeExtension,
      rainbowBracketsExtension,
      operatorLigaturesExtension,
      highlightLineField,
      codeMirrorFileSearchExtension,
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
      saveKeymap,
      formatKeymap,
      scrollGuardExtension,
      adaptiveCompartmentExtension,
      EditorView.updateListener.of((update) => {
        if (!update.selectionSet && !update.docChanged) return;
        syncCursorPosition(update.state);
      }),
    ];

    if (editorFeatureBudget.layoutStableLineWrapping) {
      nextExtensions.push(EditorView.lineWrapping);
    }

    if (languageExtension) {
      nextExtensions.push(languageExtension);
    }

    if (shouldShowMinimap) {
      nextExtensions.push(
        showMinimap.compute(["doc"], () => ({
          create: () => ({ dom: document.createElement("div") }),
          displayText: "blocks",
          showOverlay: "always",
        })),
        minimapDockingExtension,
      );
    }

    return nextExtensions;
  }, [
    adaptiveCompartmentExtension,
    editorFeatureBudget.layoutStableLineWrapping,
    fontSizeExtension,
    formatKeymap,
    languageExtension,
    operatorLigaturesExtension,
    rainbowBracketsExtension,
    saveKeymap,
    scrollGuardExtension,
    shouldShowMinimap,
    syncCursorPosition,
  ]);

  const basicSetup = useMemo(
    () => ({
      lineNumbers: true,
      highlightActiveLineGutter: true,
      highlightActiveLine: true,
      foldGutter: editorFeatureBudget.layoutStableFoldGutter,
      dropCursor: true,
      allowMultipleSelections: true,
      indentOnInput: false,
      bracketMatching: false,
      closeBrackets: false,
      autocompletion: false,
      rectangularSelection: true,
      crosshairCursor: false,
      highlightSelectionMatches: false,
      searchKeymap: false,
      tabSize: 4,
    }),
    [editorFeatureBudget.layoutStableFoldGutter],
  );

  useEffect(() => {
    reapplyAdaptiveExtensions();
  }, [extensions, reapplyAdaptiveExtensions]);

  return (
    <ContextActionMenu
      items={editorContextMenuItems}
      nativeScope="editor"
      nativeSurfaceId="editor"
      nativeTargetId={filePath}
      nativeContext={{ filePath, language, projectPath }}
      onContextMenuCapture={handleEditorContextMenuCapture}
    >
      <div
        className="relative h-full w-full overflow-hidden"
        style={editorCanvasStyle}
      >
        <CodeMirror
          ref={editorRef}
          value={content}
          onChange={handleChange}
          extensions={extensions}
          basicSetup={basicSetup}
          theme="none"
          className={codeEditorSurfaceClassName}
          onCreateEditor={(view) => {
            bindEditorView(view);
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
    </ContextActionMenu>
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
