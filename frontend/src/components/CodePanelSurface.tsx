import React, { useCallback, useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { closeBrackets } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { WriteFile } from "../wails/app";
import { createAIInlinePatchExtension } from "../extensions/aiInlinePatchExtension";
import { createDiagnosticsExtension } from "../extensions/diagnosticsExtension";
import { createGitGutterExtension } from "../extensions/gitGutterExtension";
import type { AIInlinePatchPreview } from "../stores/aiInlinePatchStore";
import {
  closeEditorDocument,
  createEditorDocumentSurfaceId,
  notifyEditorDocumentChanged,
  openEditorDocument,
} from "../stores/editorDocumentObserver";
import { useEditorStore } from "../stores/editorStore";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import { useCodeMirrorAdaptiveExtensions } from "../hooks/useCodeMirrorAdaptiveExtensions";
import { useCodeMirrorLanguageExtension } from "../hooks/useCodeMirrorLanguageExtension";
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
import {
  EDITOR_FIND_IN_FILE_EVENT,
  codeMirrorFileSearchExtension,
  openEditorFileSearch,
  shouldHandleEditorFindInFile,
} from "../utils/codeMirrorFileSearch";
import {
  getCodeMirrorLineCount,
  shouldUseCodeMirrorLargeDocumentMode,
} from "../utils/codeMirrorDisplay";
import { isCodeMirrorColorToolTarget } from "../utils/codeMirrorLanguageRegistry";
import {
  createCodeMirrorColorToolExtension,
  createCodeMirrorFoldExtensions,
  createCodeMirrorIndentGuideExtension,
} from "../utils/codeMirrorWorkflowExtensions";
import { normalizePathForGit, type GitLineMarker } from "../utils/git";
import {
  isEditorFilePolicyReadOnly,
  type EditorFileLoadState,
} from "../utils/editorFileLoader";
import { useIndexingPhase } from "../hooks/useIndexingProgress";
import { useCodeMirrorCompletionProvider } from "../hooks/useCodeMirrorCompletionProvider";
import { useStableReferenceKey } from "../hooks/useStableReferenceKey";
import { BinaryEditorPreview } from "./BinaryEditorPreview";
import { EditorFileLoadingView } from "./EditorFileLoadingView";
import { GuardedEditorPreview } from "./GuardedEditorPreview";
import { ImageEditorPreview } from "./ImageEditorPreview";

interface CodePanelSurfaceProps {
  path: string;
  name: string;
  language: string;
  initialContent: string;
  projectPath?: string;
  loadState?: EditorFileLoadState;
  aiInlinePatchPreview?: AIInlinePatchPreview | null;
  aiInlinePatchBusy?: boolean;
  onAcceptAIInlinePatch?: (preview: AIInlinePatchPreview) => void;
  onRejectAIInlinePatch?: (preview: AIInlinePatchPreview) => void;
  completionProviderMode?: "full" | "off";
}

const autoSaveDelayMs = 500;
const diagnosticsSyncDelayMs = 150;
const EMPTY_GIT_MARKERS: GitLineMarker[] = [];

const makeTabID = (path: string): string =>
  `tab-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;

export const CodePanelSurface: React.FC<CodePanelSurfaceProps> = ({
  path,
  name,
  language,
  initialContent,
  projectPath,
  loadState,
  aiInlinePatchPreview,
  aiInlinePatchBusy = false,
  onAcceptAIInlinePatch,
  onRejectAIInlinePatch,
  completionProviderMode = "off",
}) => {
  const isReadOnlyByPolicy = isEditorFilePolicyReadOnly(loadState);
  const canDisplayEditor = !loadState || loadState.kind === "editable";
  const isEditable = canDisplayEditor && !isReadOnlyByPolicy;
  const ensureTab = useEditorStore((state) => state.ensureTab);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const setStatusFile = useEditorStore((state) => state.setStatusFile);
  const tabID = useMemo(() => makeTabID(path), [path]);
  const tab = useEditorStore((state) => state.tabs.get(tabID));
  const content = canDisplayEditor ? (tab?.content ?? initialContent) : "";
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
  const showFoldGutter = useEditorSettingsStore(
    (state) => state.showFoldGutter,
  );
  const showIndentGuides = useEditorSettingsStore(
    (state) => state.showIndentGuides,
  );
  const showColorTools = useEditorSettingsStore(
    (state) => state.showColorTools,
  );
  const gitProjectPath = useGitStore((state) => state.projectPath);
  const gitMarkerKey = useMemo(
    () => (gitProjectPath ? normalizePathForGit(gitProjectPath, path) : path),
    [gitProjectPath, path],
  );
  const gitMarkers = useGitStore((state) =>
    editorFeatureBudget.layoutStableGitGutter
      ? (state.fileMarkers[path] ??
        state.fileMarkers[gitMarkerKey] ??
        EMPTY_GIT_MARKERS)
      : EMPTY_GIT_MARKERS,
  );
  const refreshFileMarkers = useGitStore((state) => state.refreshFileMarkers);
  const indexingPhase = useIndexingPhase();
  const saveTimeoutRef = useRef<number | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const latestContentRef = useRef(content);
  const documentSurfaceIdRef = useRef(
    createEditorDocumentSurfaceId("code-panel"),
  );

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

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
          }),
    [editorFeatureBudget.runtimeDiagnostics, language, path],
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
    const handleFindInFile = () => {
      const view = editorViewRef.current;
      if (!view || !shouldHandleEditorFindInFile(view)) {
        return;
      }
      openEditorFileSearch(view);
    };

    window.addEventListener(EDITOR_FIND_IN_FILE_EVENT, handleFindInFile);
    return () =>
      window.removeEventListener(EDITOR_FIND_IN_FILE_EVENT, handleFindInFile);
  }, []);

  useEffect(() => {
    if (!isEditable) return;
    ensureTab(path, name, initialContent, language);
  }, [ensureTab, initialContent, isEditable, language, name, path]);

  useEffect(() => {
    if (!isEditable) return;
    openEditorDocument({
      surfaceId: documentSurfaceIdRef.current,
      path,
      language,
      content: latestContentRef.current,
      largeDocument: largeDocumentMode,
    });

    return () => {
      closeEditorDocument(documentSurfaceIdRef.current);
    };
  }, [isEditable, language, largeDocumentMode, path]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
        const contentToSave = latestContentRef.current;
        void WriteFile(path, contentToSave)
          .then(() => {
            if (latestContentRef.current === contentToSave) {
              markTabDirty(tabID, false);
            }
          })
          .catch((error) => {
            console.error("Code panel auto-save failed", error);
          });
      }
    };
  }, [markTabDirty, path, tabID]);

  const languageExtension = useCodeMirrorLanguageExtension(
    canDisplayEditor ? language : "",
  );
  const foldControlsEnabled =
    showFoldGutter && editorFeatureBudget.layoutStableFoldGutter;
  const indentGuidesEnabled =
    showIndentGuides && editorFeatureBudget.runtimeRichEditorFeatures;
  const colorToolsEnabled =
    showColorTools &&
    editorFeatureBudget.runtimeRichEditorFeatures &&
    isCodeMirrorColorToolTarget(language, path);
  const completionProviderEnabled =
    completionProviderMode === "full" && isEditable;
  const {
    extensions: completionProviderExtensions,
    extensionsKey: completionProviderExtensionsKey,
    recordDocumentChange,
  } = useCodeMirrorCompletionProvider({
    enabled: completionProviderEnabled,
    filePath: path,
    language,
    content,
    editorFeatureBudget,
    getEditorView: () => editorViewRef.current,
  });

  const adaptiveExtensions = useMemo(() => {
    const result: Extension[] = [];
    result.push(...completionProviderExtensions);
    result.push(
      ...createCodeMirrorFoldExtensions(
        foldControlsEnabled,
        foldControlsEnabled,
      ),
    );
    if (editorFeatureBudget.runtimeRichEditorFeatures) {
      result.push(
        highlightSelectionMatches(),
        createCodeMirrorIndentGuideExtension(indentGuidesEnabled),
        createCodeMirrorColorToolExtension(colorToolsEnabled),
      );
    }
    if (editorFeatureBudget.layoutStableGitGutter) {
      result.push(gitGutterExtension);
    }
    result.push(...diagnosticsExtension);
    return result;
  }, [
    colorToolsEnabled,
    completionProviderExtensions,
    diagnosticsExtension,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.runtimeRichEditorFeatures,
    foldControlsEnabled,
    gitGutterExtension,
    indentGuidesEnabled,
  ]);

  const adaptiveExtensionsKey = useStableReferenceKey([
    "code-panel-adaptive",
    completionProviderExtensionsKey,
    colorToolsEnabled,
    diagnosticsExtension,
    editorFeatureBudget.layoutStableGitGutter,
    editorFeatureBudget.layoutStableFoldGutter,
    editorFeatureBudget.runtimeRichEditorFeatures,
    foldControlsEnabled,
    gitGutterExtension,
    indentGuidesEnabled,
    language,
    path,
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

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      bindEditorView(view);
    },
    [bindEditorView],
  );

  const aiInlinePatchExtension = useMemo<Extension>(
    () =>
      createAIInlinePatchExtension({
        preview: aiInlinePatchPreview,
        filePath: path,
        projectPath,
        busy: aiInlinePatchBusy,
        onAccept: onAcceptAIInlinePatch ?? (() => undefined),
        onReject: onRejectAIInlinePatch ?? (() => undefined),
      }),
    [
      aiInlinePatchBusy,
      aiInlinePatchPreview,
      onAcceptAIInlinePatch,
      onRejectAIInlinePatch,
      path,
      projectPath,
    ],
  );

  const extensions = useMemo(() => {
    const result: Extension[] = [
      codeEditorTheme,
      codeEditorStyles,
      closeBrackets(),
      codeMirrorFileSearchExtension,
      aiInlinePatchExtension,
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
    aiInlinePatchExtension,
    editorFeatureBudget.layoutStableLineWrapping,
    languageExtension,
    scrollGuardExtension,
  ]);

  const handleChange = useCallback(
    (value: string) => {
      if (!isEditable) {
        return;
      }
      recordDocumentChange(value);
      updateTabContent(tabID, value);

      notifyEditorDocumentChanged({
        surfaceId: documentSurfaceIdRef.current,
        path,
        language,
        content: value,
        delayMs: Math.max(diagnosticsSyncDelayMs, notifyChangeDelayRef.current),
      });

      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = window.setTimeout(() => {
        saveTimeoutRef.current = null;
        void WriteFile(path, value)
          .then(() => {
            if (latestContentRef.current === value) {
              markTabDirty(tabID, false);
            }
          })
          .catch((error) => {
            console.error("Code panel auto-save failed", error);
          });
      }, autoSaveDelayMs);
    },
    [
      isEditable,
      language,
      markTabDirty,
      path,
      recordDocumentChange,
      tabID,
      updateTabContent,
    ],
  );

  useEffect(() => {
    if (!path) return;
    if (!gitProjectPath) return;
    if (!editorFeatureBudget.layoutStableGitGutter) return;

    void refreshFileMarkers(
      path,
      indexingPhase === "complete" || indexingPhase === "revealed",
    );
  }, [
    editorFeatureBudget.layoutStableGitGutter,
    gitProjectPath,
    indexingPhase,
    path,
    refreshFileMarkers,
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

  if (loadState?.kind === "guardedPreview" || loadState?.kind === "error") {
    return <GuardedEditorPreview file={loadState} />;
  }
  if (loadState?.kind === "visualPreview") {
    return <ImageEditorPreview file={loadState} />;
  }
  if (loadState?.kind === "binaryPreview") {
    return <BinaryEditorPreview file={loadState} />;
  }
  if (loadState?.kind === "loading") {
    return <EditorFileLoadingView file={loadState} />;
  }

  return (
    <div
      className="relative w-full h-full min-h-0 overflow-hidden"
      style={codeEditorChromeStyle}
      onFocusCapture={() => setStatusFile(path, name, language)}
    >
      <CodeMirror
        value={content}
        extensions={extensions}
        onChange={handleChange}
        basicSetup={basicSetup}
        theme="none"
        editable={!isReadOnlyByPolicy}
        readOnly={isReadOnlyByPolicy}
        className={codeEditorSurfaceClassName}
        onCreateEditor={handleCreateEditor}
      />
    </div>
  );
};
