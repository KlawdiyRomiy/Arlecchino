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
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  defaultKeymap,
  indentWithTab,
  redoDepth,
  undoDepth,
} from "@codemirror/commands";
import { closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileText,
  Search as SearchIcon,
  Scissors,
} from "lucide-react";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import rainbowBrackets from "rainbowbrackets";
import { showMinimap } from "@replit/codemirror-minimap";
import { useEditorStore } from "../stores/editorStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { createAIInlinePatchExtension } from "../extensions/aiInlinePatchExtension";
import type { AIInlinePatchPreview } from "../stores/aiInlinePatchStore";
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
import { LSPHover, LSPSignatureHelp, RevealProjectEntry } from "../wails/app";
import {
  createDiagnosticsExtension,
  hasInlineDiagnosticAtPosition,
  LARGE_DOCUMENT_INLINE_DIAGNOSTIC_LIMIT,
} from "../extensions/diagnosticsExtension";
import { createGitGutterExtension } from "../extensions/gitGutterExtension";
import { createOperatorLigaturesExtension } from "../extensions/operatorLigaturesExtension";
import { useGitStore } from "../stores/gitStore";
import { useCodeMirrorCompletionProvider } from "../hooks/useCodeMirrorCompletionProvider";
import { useCodeMirrorLanguageExtension } from "../hooks/useCodeMirrorLanguageExtension";
import { useStableReferenceKey } from "../hooks/useStableReferenceKey";
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
import { isCodeMirrorColorToolTarget } from "../utils/codeMirrorLanguageRegistry";
import {
  closeEditorDocument,
  createEditorDocumentSurfaceId,
  notifyEditorDocumentChanged,
  openEditorDocument,
  replaceEditorDocumentFromDisk,
} from "../stores/editorDocumentObserver";
import {
  createCodeMirrorColorToolExtension,
  createCodeMirrorFoldExtensions,
  createCodeMirrorIndentGuideExtension,
} from "../utils/codeMirrorWorkflowExtensions";
import {
  EDITOR_FIND_IN_FILE_EVENT,
  codeMirrorFileSearchExtension,
  openEditorFileSearch,
  shouldHandleEditorFindInFile,
} from "../utils/codeMirrorFileSearch";
import { normalizePathForGit, type GitLineMarker } from "../utils/git";
import { createLatestRequestGuard } from "../utils/latestRequestGuard";
import { relativeProjectPath } from "../utils/projectPaths";
import { useIndexingPhase } from "../hooks/useIndexingProgress";

const EMPTY_GIT_MARKERS: GitLineMarker[] = [];
const SIGNATURE_HIDE_MS = 2400;
const MINIMAP_GUTTER_SELECTOR = ":scope > .cm-minimap-gutter";
const MINIMAP_DOCK_OFFSET_PROPERTY = "--cm-minimap-dock-offset";
const editorCanvasStyle = {
  background: editorCanvasBackground,
  boxShadow: "none",
} as const;

const buildEditorCanvasStyle = (
  fontFamily: string,
  fontSize: number,
): React.CSSProperties =>
  ({
    ...editorCanvasStyle,
    "--editor-font-family": fontFamily,
    "--editor-font-size": `${fontSize}px`,
  }) as React.CSSProperties;

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

interface DefinitionLinkRange {
  from: number;
  to: number;
}

const DEFINITION_LINK_ACTIVE_CLASS = "cm-definition-link-active";

const setDefinitionLinkEffect = StateEffect.define<DefinitionLinkRange | null>({
  map(value, mapping) {
    if (!value) {
      return null;
    }
    const from = mapping.mapPos(value.from, 1);
    const to = mapping.mapPos(value.to, -1);
    return from < to ? { from, to } : null;
  },
});
const definitionLinkField = StateField.define<DefinitionLinkRange | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    let next = value;
    if (next && transaction.docChanged) {
      const from = transaction.changes.mapPos(next.from, 1);
      const to = transaction.changes.mapPos(next.to, -1);
      next = from < to ? { from, to } : null;
    }
    for (const effect of transaction.effects) {
      if (effect.is(setDefinitionLinkEffect)) {
        return effect.value;
      }
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => {
      if (!value) {
        return Decoration.none;
      }
      const decoration = Decoration.mark({
        class: "definition-link-hover",
      });
      return Decoration.set([decoration.range(value.from, value.to)]);
    }),
    EditorView.editorAttributes.from(field, (value) =>
      value ? { class: DEFINITION_LINK_ACTIVE_CLASS } : { class: "" },
    ),
  ],
});

const definitionLinkCleanupPlugin = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.view.dom.addEventListener("mouseleave", this.handleEditorMouseLeave);
      this.view.dom.addEventListener("blur", this.handleEditorBlur, true);
      window.addEventListener("keyup", this.handleWindowKeyUp, true);
      window.addEventListener("blur", this.handleWindowBlur, true);
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
        true,
      );
    }

    destroy() {
      this.view.dom.removeEventListener(
        "mouseleave",
        this.handleEditorMouseLeave,
      );
      this.view.dom.removeEventListener("blur", this.handleEditorBlur, true);
      window.removeEventListener("keyup", this.handleWindowKeyUp, true);
      window.removeEventListener("blur", this.handleWindowBlur, true);
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange,
        true,
      );
    }

    private clear = () => {
      if (!this.view.state.field(definitionLinkField, false)) {
        return;
      }
      this.view.dispatch({ effects: setDefinitionLinkEffect.of(null) });
    };

    private handleEditorMouseLeave = () => {
      this.clear();
    };

    private handleEditorBlur = () => {
      this.clear();
    };

    private handleWindowBlur = () => {
      this.clear();
    };

    private handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        this.clear();
      }
    };

    private handleWindowKeyUp = (event: KeyboardEvent) => {
      if (
        event.key === "Meta" ||
        event.key === "Control" ||
        event.key === "Alt" ||
        (!event.metaKey && !event.ctrlKey && !event.altKey)
      ) {
        this.clear();
      }
    };
  },
);

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

function canFormatDocument(filePath: string, language: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return (
    language === "php" ||
    language === "html" ||
    lowerPath.endsWith(".blade.php") ||
    language === "javascript" ||
    language === "javascriptreact" ||
    language === "typescript" ||
    language === "typescriptreact" ||
    language === "css" ||
    language === "scss" ||
    language === "json"
  );
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
  readOnly?: boolean;
  highlightLine?: number;
  aiInlinePatchPreview?: AIInlinePatchPreview | null;
  aiInlinePatchBusy?: boolean;
  onAcceptAIInlinePatch?: (preview: AIInlinePatchPreview) => void;
  onRejectAIInlinePatch?: (preview: AIInlinePatchPreview) => void;
  onEditorViewReady?: (view: EditorView | null) => void;
  onHistoryAvailabilityChange?: (
    availability: EditorHistoryAvailability,
  ) => void;
}

export interface EditorHistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
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
  readOnly = false,
  highlightLine,
  aiInlinePatchPreview,
  aiInlinePatchBusy = false,
  onAcceptAIInlinePatch,
  onRejectAIInlinePatch,
  onEditorViewReady,
  onHistoryAvailabilityChange,
}) => {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onEditorViewReadyRef = useRef(onEditorViewReady);
  const onHistoryAvailabilityChangeRef = useRef(onHistoryAvailabilityChange);
  const lastHistoryAvailabilityRef = useRef<EditorHistoryAvailability | null>(
    null,
  );
  const documentVersionRef = useRef<number>(0);
  const cursorSyncFrameRef = useRef<number | null>(null);
  const pendingCursorPositionRef = useRef<{ line: number; col: number } | null>(
    null,
  );
  const signatureRequestGuardRef = useRef(createLatestRequestGuard());

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onEditorViewReadyRef.current = onEditorViewReady;
  onHistoryAvailabilityChangeRef.current = onHistoryAvailabilityChange;

  const editorFontSize = useEditorSettingsStore(
    (state) => state.editorFontSize,
  );
  const editorFontFamily = useEditorSettingsStore(
    (state) => state.editorFontFamily,
  );
  const showFoldGutter = useEditorSettingsStore(
    (state) => state.showFoldGutter,
  );
  const showIndentGuides = useEditorSettingsStore(
    (state) => state.showIndentGuides,
  );
  const showColorTools = useEditorSettingsStore(
    (state) => state.showColorTools,
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

  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) {
      return;
    }

    view.requestMeasure();
    void document.fonts?.ready.then(() => {
      if (editorRef.current?.view === view) {
        view.requestMeasure();
      }
    });
  }, [editorFontFamily, editorFontSize]);

  useEffect(() => {
    const handleFindInFile = () => {
      const view = editorRef.current?.view;
      if (!view || !shouldHandleEditorFindInFile(view)) {
        return;
      }
      openEditorFileSearch(view);
    };

    window.addEventListener(EDITOR_FIND_IN_FILE_EVENT, handleFindInFile);
    return () =>
      window.removeEventListener(EDITOR_FIND_IN_FILE_EVENT, handleFindInFile);
  }, []);

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
  const gitProjectPath = useGitStore((state) => state.projectPath);
  const gitMarkerKey = useMemo(
    () =>
      gitProjectPath ? normalizePathForGit(gitProjectPath, filePath) : filePath,
    [filePath, gitProjectPath],
  );
  const gitMarkers = useGitStore((state) =>
    editorFeatureBudget.layoutStableGitGutter
      ? (state.fileMarkers[filePath] ??
        state.fileMarkers[gitMarkerKey] ??
        EMPTY_GIT_MARKERS)
      : EMPTY_GIT_MARKERS,
  );
  const refreshFileMarkers = useGitStore((state) => state.refreshFileMarkers);
  const indexingPhase = useIndexingPhase();
  const setCursorPosition = useEditorStore((state) => state.setCursorPosition);
  const diagnosticsExtension = useMemo(
    () =>
      !editorFeatureBudget.runtimeDiagnostics
        ? []
        : createDiagnosticsExtension({
            filePath,
            language,
            maxInlineDiagnostics: largeDocumentMode
              ? LARGE_DOCUMENT_INLINE_DIAGNOSTIC_LIMIT
              : undefined,
          }),
    [
      editorFeatureBudget.runtimeDiagnostics,
      filePath,
      language,
      largeDocumentMode,
    ],
  );

  const [definitionMenu, setDefinitionMenu] = useState<DefinitionMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    items: [],
    mode: "goto",
  });
  const [contextMenuAvailability, setContextMenuAvailability] = useState({
    definition: false,
    selection: false,
  });
  const signatureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentSurfaceIdRef = useRef(
    createEditorDocumentSurfaceId("code-editor"),
  );
  const lastContentPropRef = useRef(content);
  const lastUserChangeContentRef = useRef<string | null>(null);

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
    lastContentPropRef.current = content;
    lastUserChangeContentRef.current = null;
    signatureRequestGuardRef.current.next();
    openEditorDocument({
      surfaceId: documentSurfaceIdRef.current,
      path: filePath,
      language,
      content,
      largeDocument: largeDocumentMode,
    });

    return () => {
      closeEditorDocument(documentSurfaceIdRef.current);
    };
  }, [filePath, language, largeDocumentMode]);

  useEffect(() => {
    if (lastContentPropRef.current === content) {
      return;
    }
    lastContentPropRef.current = content;
    documentVersionRef.current += 1;
    signatureRequestGuardRef.current.next();
    if (lastUserChangeContentRef.current === content) {
      lastUserChangeContentRef.current = null;
      return;
    }
    if (!largeDocumentMode) {
      replaceEditorDocumentFromDisk(filePath, language, content);
    }
  }, [content, filePath, language, largeDocumentMode]);

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

  const completionProvider = useCodeMirrorCompletionProvider({
    enabled: true,
    filePath,
    language,
    content,
    sessionId: filePath,
    surfaceId: documentSurfaceIdRef.current,
    editorFeatureBudget,
    getEditorView: () => editorRef.current?.view ?? null,
    onTyping,
    onGhostShown,
    onGhostRejected,
    onEscape: clearSignatureHelp,
  });
  const {
    extensions: completionProviderExtensions,
    extensionsKey: completionProviderExtensionsKey,
    recordDocumentChange,
  } = completionProvider;

  const shouldShowMinimap = useMemo(
    () =>
      editorFeatureBudget.layoutStableMinimap &&
      editorFeatureBudget.minimap &&
      showMinimapSetting &&
      shouldEnableCodeMirrorMinimap(content),
    [
      content,
      editorFeatureBudget.layoutStableMinimap,
      editorFeatureBudget.minimap,
      showMinimapSetting,
    ],
  );

  const gitGutterExtension = useMemo(
    () => createGitGutterExtension({ markers: gitMarkers }),
    [gitMarkers],
  );

  useEffect(() => {
    if (!filePath) return;
    if (!gitProjectPath) return;
    if (!editorFeatureBudget.layoutStableGitGutter) return;

    void refreshFileMarkers(
      filePath,
      indexingPhase === "complete" || indexingPhase === "revealed",
    );
  }, [
    editorFeatureBudget.layoutStableGitGutter,
    filePath,
    gitProjectPath,
    indexingPhase,
    refreshFileMarkers,
  ]);

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

  const handleChange = useCallback(
    (value: string) => {
      if (readOnly) {
        return;
      }

      recordDocumentChange(value);
      onChangeRef.current(value);
      lastUserChangeContentRef.current = value;

      documentVersionRef.current += 1;

      if (largeDocumentMode) {
        return;
      }

      notifyEditorDocumentChanged({
        surfaceId: documentSurfaceIdRef.current,
        path: filePath,
        language,
        content: value,
        delayMs: notifyChangeDelayRef.current,
      });
    },
    [filePath, language, largeDocumentMode, readOnly, recordDocumentChange],
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
      if (largeDocumentMode || !canFormatDocument(filePath, language)) {
        return false;
      }

      void formatDocumentAsync(view);
      return true;
    },
    [filePath, formatDocumentAsync, language, largeDocumentMode],
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

  const publishHistoryAvailability = useCallback((state: EditorState) => {
    const next: EditorHistoryAvailability = {
      canUndo: undoDepth(state) > 0,
      canRedo: redoDepth(state) > 0,
    };
    const previous = lastHistoryAvailabilityRef.current;
    if (
      previous?.canUndo === next.canUndo &&
      previous?.canRedo === next.canRedo
    ) {
      return;
    }

    lastHistoryAvailabilityRef.current = next;
    onHistoryAvailabilityChangeRef.current?.(next);
  }, []);

  useEffect(
    () => () => {
      lastHistoryAvailabilityRef.current = null;
      onEditorViewReadyRef.current?.(null);
      onHistoryAvailabilityChangeRef.current?.({
        canUndo: false,
        canRedo: false,
      });
    },
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

  const hasDefinitionCandidateAtPosition = useCallback(
    (view: EditorView, pos: number): boolean => {
      const line = view.state.doc.lineAt(pos);
      const column = pos - line.from + 1;
      const wordInfo = getWordAtLinePosition(line.text, column, language);
      if (!wordInfo) {
        return false;
      }

      const beforeWord = line.text.substring(0, wordInfo.startColumn - 1);
      const afterWord = line.text.substring(wordInfo.endColumn - 1);
      return checkIfHasDefinition(wordInfo.word, beforeWord, afterWord);
    },
    [language],
  );

  const handleEditorContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const view = getEditorView();
      if (!view) {
        setContextMenuAvailability({ definition: false, selection: false });
        return;
      }

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        setContextMenuAvailability({ definition: false, selection: false });
        return;
      }

      const selection = view.state.selection.main;
      if (!selection.empty && pos >= selection.from && pos <= selection.to) {
        setContextMenuAvailability({
          definition: false,
          selection: true,
        });
        return;
      }

      setContextMenuAvailability({
        definition: hasDefinitionCandidateAtPosition(view, pos),
        selection: false,
      });
      view.dispatch({ selection: { anchor: pos } });
    },
    [getEditorView, hasDefinitionCandidateAtPosition],
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
        hidden: !contextMenuAvailability.selection,
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
        hidden:
          !projectPath || !onOpenFile || !contextMenuAvailability.definition,
        onSelect: () => runDefinitionAction("goto"),
      },
      {
        label: "Quick Look Definition",
        shortcut: "Alt Click",
        icon: <SearchIcon size={14} />,
        hidden:
          !projectPath || !onQuickLook || !contextMenuAvailability.definition,
        onSelect: () => runDefinitionAction("quickLook"),
      },
      {
        label: "Format Document",
        shortcut: "Shift Alt F",
        icon: <FileText size={14} />,
        hidden: largeDocumentMode || !canFormatDocument(filePath, language),
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
        hidden: !filePath,
        onSelect: () => void copyEditorRelativePath(),
      },
      {
        label: "Copy Absolute Path",
        icon: <Copy size={14} />,
        hidden: !filePath,
        onSelect: () => void copyEditorAbsolutePath(),
      },
      {
        label: "Copy Path:Line",
        icon: <Copy size={14} />,
        hidden: !filePath,
        onSelect: () => void copyCurrentLineReference(),
      },
      {
        label: "Reveal in File Manager",
        icon: <ExternalLink size={14} />,
        hidden: !filePath,
        onSelect: revealEditorFile,
      },
    ],
    [
      copyCurrentLineReference,
      copyEditorAbsolutePath,
      copyEditorRelativePath,
      copyEditorText,
      cutEditorSelection,
      contextMenuAvailability.definition,
      contextMenuAvailability.selection,
      filePath,
      formatDocument,
      getEditorView,
      language,
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

  const operatorLigaturesExtension = useMemo(
    () => createOperatorLigaturesExtension(showOperatorLigatures),
    [showOperatorLigatures],
  );

  const definitionLinkExtension = useMemo<Extension[]>(() => {
    if (!editorFeatureBudget.hover) {
      return [];
    }

    const clearDefinitionLink = (view: EditorView) => {
      if (!view.state.field(definitionLinkField, false)) {
        return;
      }
      view.dispatch({ effects: setDefinitionLinkEffect.of(null) });
    };

    return [
      definitionLinkField,
      definitionLinkCleanupPlugin,
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
          return false;
        },
        mouseleave: (_event, view) => {
          clearDefinitionLink(view);
          return false;
        },
        keyup: (event, view) => {
          if (
            event.key === "Meta" ||
            event.key === "Control" ||
            event.key === "Alt"
          ) {
            clearDefinitionLink(view);
          }
          return false;
        },
        blur: (_event, view) => {
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
        if (hasInlineDiagnosticAtPosition(view, pos)) return null;

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

  const languageExtension = useCodeMirrorLanguageExtension(language);
  const foldControlsEnabled =
    showFoldGutter && editorFeatureBudget.layoutStableFoldGutter;
  const indentGuidesEnabled =
    showIndentGuides && editorFeatureBudget.runtimeRichEditorFeatures;
  const colorToolsEnabled =
    showColorTools &&
    editorFeatureBudget.runtimeRichEditorFeatures &&
    isCodeMirrorColorToolTarget(language, filePath);

  const rainbowBracketsExtension = useMemo<Extension>(
    () => (showRainbowBrackets && !largeDocumentMode ? rainbowBrackets() : []),
    [largeDocumentMode, showRainbowBrackets],
  );

  const adaptiveExtensions = useMemo<Extension[]>(() => {
    const nextExtensions: Extension[] = [];

    if (editorFeatureBudget.layoutStableGitGutter) {
      nextExtensions.push(gitGutterExtension);
    }

    nextExtensions.push(
      ...createCodeMirrorFoldExtensions(
        foldControlsEnabled,
        foldControlsEnabled,
      ),
    );

    nextExtensions.push(...completionProviderExtensions);

    if (editorFeatureBudget.runtimeRichEditorFeatures) {
      nextExtensions.push(
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        createCodeMirrorIndentGuideExtension(indentGuidesEnabled),
        createCodeMirrorColorToolExtension(colorToolsEnabled),
      );
    }

    nextExtensions.push(...diagnosticsExtension);

    if (editorFeatureBudget.runtimeHover) {
      nextExtensions.push(
        ...hoverExtension,
        ...definitionLinkExtension,
        ...signatureHelpExtension,
      );
    }

    return nextExtensions;
  }, [
    completionProviderExtensions,
    definitionLinkExtension,
    diagnosticsExtension,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.runtimeHover,
    editorFeatureBudget.runtimeRichEditorFeatures,
    colorToolsEnabled,
    foldControlsEnabled,
    gitGutterExtension,
    hoverExtension,
    indentGuidesEnabled,
    signatureHelpExtension,
  ]);

  const adaptiveExtensionsKey = useStableReferenceKey([
    "adaptive",
    editorFeatureBudget.runtimeDiagnostics,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.layoutStableFoldGutter,
    editorFeatureBudget.runtimeHover,
    editorFeatureBudget.runtimeRichEditorFeatures,
    editorFeatureBudget.runtimeDiagnostics,
    colorToolsEnabled,
    foldControlsEnabled,
    filePath,
    language,
    completionProviderExtensionsKey,
    definitionLinkExtension,
    diagnosticsExtension,
    gitGutterExtension,
    hoverExtension,
    indentGuidesEnabled,
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

  const aiInlinePatchExtension = useMemo<Extension>(
    () =>
      createAIInlinePatchExtension({
        preview: aiInlinePatchPreview,
        filePath,
        projectPath,
        busy: aiInlinePatchBusy,
        onAccept: onAcceptAIInlinePatch ?? (() => undefined),
        onReject: onRejectAIInlinePatch ?? (() => undefined),
      }),
    [
      aiInlinePatchPreview,
      aiInlinePatchBusy,
      filePath,
      projectPath,
      onAcceptAIInlinePatch,
      onRejectAIInlinePatch,
    ],
  );

  const extensions = useMemo<Extension[]>(() => {
    const nextExtensions: Extension[] = [
      codeEditorTheme,
      codeEditorStyles,
      rainbowBracketsExtension,
      operatorLigaturesExtension,
      closeBrackets(),
      highlightLineField,
      codeMirrorFileSearchExtension,
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
      saveKeymap,
      formatKeymap,
      scrollGuardExtension,
      adaptiveCompartmentExtension,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          publishHistoryAvailability(update.state);
        }
        if (!update.selectionSet && !update.docChanged) return;
        syncCursorPosition(update.state);
      }),
      aiInlinePatchExtension,
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
    aiInlinePatchExtension,
    editorFeatureBudget.layoutStableLineWrapping,
    formatKeymap,
    languageExtension,
    operatorLigaturesExtension,
    publishHistoryAvailability,
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
      foldGutter: false,
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
      lintKeymap: false,
      tabSize: 4,
    }),
    [],
  );

  useEffect(() => {
    reapplyAdaptiveExtensions();
  }, [extensions, reapplyAdaptiveExtensions]);

  const editorCanvasDynamicStyle = useMemo(
    () => buildEditorCanvasStyle(editorFontFamily, editorFontSize),
    [editorFontFamily, editorFontSize],
  );

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
        className="relative h-full w-full overflow-hidden bg-[var(--editor-bg)]"
        style={editorCanvasDynamicStyle}
      >
        <CodeMirror
          ref={editorRef}
          value={content}
          onChange={handleChange}
          extensions={extensions}
          basicSetup={basicSetup}
          theme="none"
          editable={!readOnly}
          readOnly={readOnly}
          className={codeEditorSurfaceClassName}
          onCreateEditor={(view) => {
            bindEditorView(view);
            syncCursorPosition(view.state);
            onEditorViewReadyRef.current?.(view);
            publishHistoryAvailability(view.state);
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

export default CodeMirrorEditor;
