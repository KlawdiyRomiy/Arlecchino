import React, { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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

import {
  NotifyFileChanged,
  NotifyFileClosed,
  NotifyFileOpened,
  WriteFile,
} from "../wails/app";
import { createDiagnosticsExtension } from "../extensions/diagnosticsExtension";
import { createGitGutterExtension } from "../extensions/gitGutterExtension";
import { useEditorStore } from "../stores/editorStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { useCodeMirrorAdaptiveExtensions } from "../hooks/useCodeMirrorAdaptiveExtensions";
import {
  resolveAdaptiveEditorFeatureBudget,
  usePerformanceStore,
} from "../stores/performanceStore";
import { useGitStore } from "../stores/gitStore";
import {
  codeEditorChromeStyle,
  codeEditorStyles,
  codeEditorSurfaceClassName,
  codeEditorTheme,
} from "../utils/codeMirrorTheme";
import { codeMirrorFileSearchExtension } from "../utils/codeMirrorFileSearch";
import {
  getCodeMirrorLineCount,
  shouldUseCodeMirrorLargeDocumentMode,
} from "../utils/codeMirrorDisplay";
import type { GitLineMarker } from "../utils/git";
import type { EditorFileLoadState } from "../utils/editorFileLoader";
import { EditorFileLoadingView } from "./EditorFileLoadingView";
import { GuardedEditorPreview } from "./GuardedEditorPreview";
import { ImageEditorPreview } from "./ImageEditorPreview";

interface CodePanelSurfaceProps {
  path: string;
  name: string;
  language: string;
  initialContent: string;
  loadState?: EditorFileLoadState;
}

const autoSaveDelayMs = 500;
const diagnosticsSyncDelayMs = 150;
const EMPTY_GIT_MARKERS: GitLineMarker[] = [];

const makeTabID = (path: string): string =>
  `tab-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;

const resolveLanguageExtension = (language: string): Extension | null => {
  const normalized = language.trim().toLowerCase();
  switch (normalized) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "javascriptreact":
    case "jsx":
      return javascript({ jsx: true });
    case "typescriptreact":
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "php":
      return php();
    case "go":
      return go();
    case "python":
      return python();
    case "html":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "markdown":
      return markdown();
    case "rust":
      return rust();
    case "c":
    case "cpp":
      return cpp();
    case "java":
      return java();
    case "sql":
      return sql();
    case "xml":
      return xml();
    case "yaml":
    case "yml":
      return yaml();
    default:
      return null;
  }
};

export const CodePanelSurface: React.FC<CodePanelSurfaceProps> = ({
  path,
  name,
  language,
  initialContent,
  loadState,
}) => {
  const isEditable = !loadState || loadState.kind === "editable";
  const activePaneID = useEditorStore((state) => state.activePaneId);
  const openTab = useEditorStore((state) => state.openTab);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const tabID = useMemo(() => makeTabID(path), [path]);
  const tab = useEditorStore((state) => state.tabs.get(tabID));
  const content = isEditable ? (tab?.content ?? initialContent) : "";
  const largeDocumentMode = useMemo(
    () => shouldUseCodeMirrorLargeDocumentMode(content),
    [content],
  );
  const contentLineCount = useMemo(
    () => getCodeMirrorLineCount(content),
    [content],
  );
  const performanceSnapshot = usePerformanceStore((state) => state.snapshot);
  const updatePerformanceBudget = usePerformanceStore(
    (state) => state.updateBudget,
  );
  const editorFeatureBudget = useMemo(
    () =>
      resolveAdaptiveEditorFeatureBudget({
        ...performanceSnapshot,
        activeEditorCharCount: content.length,
        activeEditorLineCount: contentLineCount,
        activeEditorLargeDocument: largeDocumentMode,
      }),
    [content.length, contentLineCount, largeDocumentMode, performanceSnapshot],
  );
  const notifyChangeDelayRef = useRef(editorFeatureBudget.notifyChangeDelayMs);
  const showInlineDiagnostics = useEditorSettingsStore(
    (state) => state.showInlineDiagnostics,
  );
  const gitMarkers = useGitStore((state) =>
    editorFeatureBudget.layoutStableGitGutter
      ? (state.fileMarkers[path] ?? EMPTY_GIT_MARKERS)
      : EMPTY_GIT_MARKERS,
  );
  const refreshFileMarkers = useGitStore((state) => state.refreshFileMarkers);
  const clearFileMarkers = useGitStore((state) => state.clearFileMarkers);
  const saveTimeoutRef = useRef<number | null>(null);
  const diagnosticsTimeoutRef = useRef<number | null>(null);
  const diagnosticsVersionRef = useRef(1);

  const gitGutterExtension = useMemo(
    () => createGitGutterExtension({ markers: gitMarkers }),
    [gitMarkers],
  );
  const diagnosticsExtension = useMemo(
    () =>
      !editorFeatureBudget.runtimeDiagnostics
        ? []
        : createDiagnosticsExtension({
            filePath: path,
            language,
            enabled: showInlineDiagnostics,
          }),
    [
      editorFeatureBudget.runtimeDiagnostics,
      language,
      path,
      showInlineDiagnostics,
    ],
  );

  useEffect(() => {
    if (!isEditable) return;
    updatePerformanceBudget({
      activeEditorCharCount: content.length,
      activeEditorLineCount: contentLineCount,
      activeEditorLargeDocument: largeDocumentMode,
    });
  }, [
    content.length,
    contentLineCount,
    isEditable,
    largeDocumentMode,
    updatePerformanceBudget,
  ]);

  useEffect(() => {
    notifyChangeDelayRef.current = editorFeatureBudget.notifyChangeDelayMs;
  }, [editorFeatureBudget.notifyChangeDelayMs]);

  useEffect(() => {
    if (!isEditable) return;
    openTab(activePaneID, path, name, initialContent, language);
  }, [activePaneID, initialContent, isEditable, language, name, openTab, path]);

  useEffect(() => {
    if (!isEditable) return;
    diagnosticsVersionRef.current = 1;
    void NotifyFileOpened(path, language, initialContent).catch(console.warn);

    return () => {
      if (diagnosticsTimeoutRef.current !== null) {
        window.clearTimeout(diagnosticsTimeoutRef.current);
        diagnosticsTimeoutRef.current = null;
      }
      void NotifyFileClosed(path, language).catch(console.warn);
    };
  }, [initialContent, isEditable, language, path]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }
      if (diagnosticsTimeoutRef.current !== null) {
        window.clearTimeout(diagnosticsTimeoutRef.current);
      }
    };
  }, []);

  const languageExtension = useMemo(
    () => resolveLanguageExtension(language),
    [language],
  );

  const adaptiveExtensions = useMemo(() => {
    const result: Extension[] = [];
    if (editorFeatureBudget.runtimeRichEditorFeatures) {
      result.push(closeBrackets(), highlightSelectionMatches());
    }
    if (editorFeatureBudget.layoutStableGitGutter) {
      result.push(gitGutterExtension);
    }
    result.push(...diagnosticsExtension);
    return result;
  }, [
    diagnosticsExtension,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.runtimeRichEditorFeatures,
    gitGutterExtension,
  ]);

  const {
    adaptiveCompartmentExtension,
    bindEditorView,
    reapplyAdaptiveExtensions,
    scrollGuardExtension,
  } = useCodeMirrorAdaptiveExtensions(adaptiveExtensions);

  const extensions = useMemo(() => {
    const result: Extension[] = [
      codeEditorTheme,
      codeEditorStyles,
      codeMirrorFileSearchExtension,
      keymap.of(searchKeymap),
      scrollGuardExtension,
      adaptiveCompartmentExtension,
    ];
    if (editorFeatureBudget.layoutStableLineWrapping) {
      result.push(EditorView.lineWrapping);
    }
    if (languageExtension) {
      result.push(languageExtension);
    }
    return result;
  }, [
    adaptiveCompartmentExtension,
    editorFeatureBudget.layoutStableLineWrapping,
    languageExtension,
    scrollGuardExtension,
  ]);

  const handleChange = useCallback(
    (value: string) => {
      if (!isEditable) {
        return;
      }
      updateTabContent(tabID, value);

      if (diagnosticsTimeoutRef.current !== null) {
        window.clearTimeout(diagnosticsTimeoutRef.current);
      }

      const diagnosticsVersion = diagnosticsVersionRef.current + 1;
      diagnosticsVersionRef.current = diagnosticsVersion;
      diagnosticsTimeoutRef.current = window.setTimeout(
        () => {
          void NotifyFileChanged(
            path,
            language,
            diagnosticsVersion,
            value,
          ).catch(console.warn);
          diagnosticsTimeoutRef.current = null;
        },
        Math.max(diagnosticsSyncDelayMs, notifyChangeDelayRef.current),
      );

      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(() => {
        void WriteFile(path, value)
          .then(() => {
            markTabDirty(tabID, false);
          })
          .catch((error) => {
            console.error("Code panel auto-save failed", error);
          });
      }, autoSaveDelayMs);
    },
    [isEditable, language, markTabDirty, path, tabID, updateTabContent],
  );

  useEffect(() => {
    if (!path) return;
    if (!editorFeatureBudget.runtimeGitGutter) return;

    const timer = window.setTimeout(() => {
      void refreshFileMarkers(path);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [editorFeatureBudget.runtimeGitGutter, path, refreshFileMarkers]);

  useEffect(
    () => () => {
      if (path) {
        clearFileMarkers(path);
      }
    },
    [clearFileMarkers, path],
  );

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

  if (loadState?.kind === "guardedPreview" || loadState?.kind === "error") {
    return <GuardedEditorPreview file={loadState} />;
  }
  if (loadState?.kind === "visualPreview") {
    return <ImageEditorPreview file={loadState} />;
  }
  if (loadState?.kind === "loading") {
    return <EditorFileLoadingView file={loadState} />;
  }

  return (
    <div
      className="relative w-full h-full min-h-0 overflow-hidden"
      style={codeEditorChromeStyle}
    >
      <CodeMirror
        value={content}
        extensions={extensions}
        onChange={handleChange}
        basicSetup={basicSetup}
        theme="none"
        className={codeEditorSurfaceClassName}
        onCreateEditor={bindEditorView}
      />
    </div>
  );
};
