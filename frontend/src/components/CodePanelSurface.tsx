import React, { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
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
import { createTheme } from "thememirror";

import {
  NotifyFileChanged,
  NotifyFileClosed,
  NotifyFileOpened,
  WriteFile,
} from "../../wailsjs/go/main/App";
import { createGitGutterExtension } from "../extensions/gitGutterExtension";
import { useEditorStore } from "../stores/editorStore";
import { useGitStore } from "../stores/gitStore";
import type { GitLineMarker } from "../utils/git";

interface CodePanelSurfaceProps {
  path: string;
  name: string;
  language: string;
  initialContent: string;
}

const autoSaveDelayMs = 500;
const diagnosticsSyncDelayMs = 150;
const EMPTY_GIT_MARKERS: readonly GitLineMarker[] = Object.freeze([]);

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
});

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
}) => {
  const activePaneID = useEditorStore((state) => state.activePaneId);
  const openTab = useEditorStore((state) => state.openTab);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const tabID = useMemo(() => makeTabID(path), [path]);
  const tab = useEditorStore((state) => state.tabs.get(tabID));
  const gitMarkers = useGitStore(
    (state) => state.fileMarkers[path] ?? EMPTY_GIT_MARKERS,
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

  useEffect(() => {
    openTab(activePaneID, path, name, initialContent, language);
  }, [activePaneID, initialContent, language, name, openTab, path]);

  useEffect(() => {
    diagnosticsVersionRef.current = 1;
    void NotifyFileOpened(path, language, initialContent).catch(console.warn);

    return () => {
      if (diagnosticsTimeoutRef.current !== null) {
        window.clearTimeout(diagnosticsTimeoutRef.current);
        diagnosticsTimeoutRef.current = null;
      }
      void NotifyFileClosed(path, language).catch(console.warn);
    };
  }, [initialContent, language, path]);

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

  const extensions = useMemo(() => {
    const result: Extension[] = [
      blackprintTheme,
      editorStyles,
      gitGutterExtension,
      EditorView.lineWrapping,
    ];
    const langExt = resolveLanguageExtension(language);
    if (langExt) {
      result.push(langExt);
    }
    return result;
  }, [gitGutterExtension, language]);

  const handleChange = (value: string) => {
    updateTabContent(tabID, value);

    if (diagnosticsTimeoutRef.current !== null) {
      window.clearTimeout(diagnosticsTimeoutRef.current);
    }

    const diagnosticsVersion = diagnosticsVersionRef.current + 1;
    diagnosticsVersionRef.current = diagnosticsVersion;
    diagnosticsTimeoutRef.current = window.setTimeout(() => {
      void NotifyFileChanged(path, language, diagnosticsVersion, value).catch(
        console.warn,
      );
      diagnosticsTimeoutRef.current = null;
    }, diagnosticsSyncDelayMs);

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
  };

  const content = tab?.content ?? initialContent;

  useEffect(() => {
    if (!path) return;

    const timer = window.setTimeout(() => {
      void refreshFileMarkers(path);
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, path, refreshFileMarkers]);

  useEffect(
    () => () => {
      if (path) {
        clearFileMarkers(path);
      }
    },
    [clearFileMarkers, path],
  );

  return (
    <div className="w-full h-full min-h-0">
      <CodeMirror
        value={content}
        extensions={extensions}
        onChange={handleChange}
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
      />
    </div>
  );
};
