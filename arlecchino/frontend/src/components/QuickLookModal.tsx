import React, { useRef, useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import {
  EditorView,
  Decoration,
  DecorationSet,
  keymap,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import { Extension, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
} from "@codemirror/language";
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

interface QuickLookModalProps {
  isOpen: boolean;
  filePath: string;
  content: string;
  language: string;
  highlightLine?: number;
  onClose: () => void;
  onExpand: () => void;
}

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
    fontSize: "14px",
    backgroundColor: "#000",
  },
  ".cm-scroller": {
    backgroundColor: "#000",
  },
  ".cm-content": {
    padding: "8px 0",
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
  ".cm-cursor": {
    borderLeftColor: "#fff",
    borderLeftWidth: "2px",
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
    padding: "0 8px",
  },
  ".cm-foldGutter": {
    width: "12px",
  },
  ".cm-tooltip": {
    backgroundColor: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "4px",
  },
  ".cm-tooltip-autocomplete": {
    backgroundColor: "#0f0f0f",
    border: "1px solid #2a2a2a",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  },
  ".cm-tooltip-autocomplete ul": {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: "13px",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "4px 8px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "#264f78",
  },
  ".cm-completionIcon": {
    marginRight: "8px",
    opacity: "0.7",
  },
  ".cm-completionLabel": {
    color: "#e0e0e0",
  },
  ".cm-completionDetail": {
    color: "#888",
    marginLeft: "8px",
    fontStyle: "italic",
  },
  ".quicklook-highlight": {
    backgroundColor: "rgba(239, 68, 68, 0.15) !important",
  },
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
        const lineNum = Math.min(effect.value, transaction.state.doc.lines);
        const line = transaction.state.doc.line(lineNum);
        const decoration = Decoration.line({ class: "quicklook-highlight" });
        return Decoration.set([decoration.range(line.from)]);
      }
    }
    return mapped;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function getLanguageExtension(language: string): Extension | null {
  const langMap: Record<string, () => Extension> = {
    javascript: () => javascript(),
    typescript: () => javascript({ typescript: true }),
    javascriptreact: () => javascript({ jsx: true }),
    typescriptreact: () => javascript({ jsx: true, typescript: true }),
    php: () => php(),
    go: () => go(),
    python: () => python(),
    html: () => html(),
    css: () => css(),
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

  const factory = langMap[language];
  return factory ? factory() : null;
}

const QuickLookModal: React.FC<QuickLookModalProps> = ({
  isOpen,
  filePath,
  content,
  language,
  highlightLine,
  onClose,
  onExpand,
}) => {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  const [modalSize, setModalSize] = useState({ width: 800, height: 600 });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const focusEditor = setTimeout(() => {
      if (editorRef.current?.view) {
        editorRef.current.view.focus();
      }
    }, 50);

    return () => clearTimeout(focusEditor);
  }, [isOpen]);

  useEffect(() => {
    if (!highlightLine || highlightLine <= 0 || !editorRef.current?.view)
      return;

    const applyHighlight = setTimeout(() => {
      if (!editorRef.current?.view) return;
      const view = editorRef.current.view;

      view.dispatch({ effects: setHighlightLineEffect.of(highlightLine) });

      const lineNum = Math.min(highlightLine, view.state.doc.lines);
      const line = view.state.doc.line(lineNum);
      view.dispatch({
        selection: { anchor: line.from },
        scrollIntoView: true,
      });

      view.focus();
    }, 100);

    return () => clearTimeout(applyHighlight);
  }, [highlightLine, isOpen, content]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX - (window.innerWidth - modalSize.width) / 2;
      const newHeight = e.clientY - (window.innerHeight - modalSize.height) / 2;

      setModalSize({
        width: Math.max(400, Math.min(window.innerWidth - 100, newWidth)),
        height: Math.max(300, Math.min(window.innerHeight - 100, newHeight)),
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, modalSize]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      blackprintTheme,
      editorStyles,
      highlightLineField,
      EditorView.lineWrapping,
      drawSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      foldGutter(),
      search(),
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
    ];

    const langExt = getLanguageExtension(language);
    if (langExt) exts.push(langExt);

    return exts;
  }, [language]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={handleBackdropClick}
          role="button"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onClose();
            }
          }}
          aria-label="Modal backdrop"
        >
          <style>{`
            .quicklook-highlight {
              background-color: rgba(239, 68, 68, 0.15) !important;
              animation: quicklookFlash 0.6s ease-out;
            }

            @keyframes quicklookFlash {
              0%, 100% { background-color: rgba(239, 68, 68, 0.15); }
              50% { background-color: rgba(239, 68, 68, 0.3); }
            }
          `}</style>

          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative flex flex-col rounded-lg shadow-2xl overflow-hidden bg-black"
            style={{
              width: modalSize.width,
              height: modalSize.height,
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a1a] bg-black">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-[#333] hover:bg-[#444] transition-colors"
                  title="Close (Esc)"
                  aria-label="Close modal"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <title>Close</title>
                    <path
                      d="M1 1L9 9M9 1L1 9"
                      stroke="#888"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onExpand}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-[#333] hover:bg-[#444] transition-colors"
                  title="Open in tab"
                  aria-label="Open in new tab"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <title>Expand</title>
                    <path
                      d="M1 5H9M5 1V9"
                      stroke="#888"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="text-sm font-medium text-[#888]">
                {filePath.split("/").pop()}
              </div>

              <div className="w-16" />
            </div>

            {/* Editor */}
            <div className="flex-1 relative overflow-hidden">
              <CodeMirror
                ref={editorRef}
                value={content}
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
                className="h-full"
              />
            </div>

            {/* Resize handle */}
            <div
              ref={resizeRef}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={() => setIsResizing(true)}
              role="button"
              tabIndex={0}
              aria-label="Resize modal"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setIsResizing(true);
                }
              }}
            >
              <div className="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-[#333]" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QuickLookModal;
