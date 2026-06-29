import React, { useRef, useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
import { Maximize2, X } from "lucide-react";
import { useCodeMirrorLanguageExtension } from "../hooks/useCodeMirrorLanguageExtension";
import { createCodeMirrorFoldExtensions } from "../utils/codeMirrorWorkflowExtensions";
import { codeEditorStyles, codeEditorTheme } from "../utils/codeMirrorTheme";
import {
  interactiveSurfaceOverlayStyle,
  useInteractiveSurfaceMotion,
} from "./ui/interactiveSurfaceMotion";
import {
  SHELL_DIALOG_PANEL_TRANSITION,
  SHELL_MODAL_PANEL_ANIMATE,
  SHELL_MODAL_PANEL_EXIT,
  SHELL_MODAL_PANEL_INITIAL,
} from "./ui/motionContracts";

interface QuickLookModalProps {
  isOpen: boolean;
  filePath: string;
  content: string;
  language: string;
  highlightLine?: number;
  onClose: () => void;
  onExpand: () => void;
}

const quickLookEditorStyles = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--editor-bg)",
  },
  ".cm-scroller": {
    backgroundColor: "var(--editor-bg)",
  },
  ".cm-content": {
    minHeight: "100%",
  },
  ".cm-gutters": {
    borderRight: "1px solid var(--editor-border)",
  },
  ".quicklook-highlight": {
    backgroundColor:
      "color-mix(in srgb, var(--status-info) 18%, transparent) !important",
  },
});

const quickLookControlsBubbleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px",
  borderRadius: 9999,
  background: "color-mix(in srgb, var(--surface-shell-soft) 74%, transparent)",
  border: "1px solid color-mix(in srgb, var(--shell-border) 72%, transparent)",
  boxShadow: "var(--shell-shadow)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
};

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

const QuickLookModal: React.FC<QuickLookModalProps> = ({
  isOpen,
  filePath,
  content,
  language,
  highlightLine,
  onClose,
  onExpand,
}) => {
  const { markMotionStart } = useInteractiveSurfaceMotion("modal", {
    preserveTransform: true,
    reduceMotion: true,
  });
  const reduceModalMotion = useReducedMotion();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<HTMLDivElement>(null);

  const [modalSize, setModalSize] = useState({ width: 800, height: 600 });
  const [isResizing, setIsResizing] = useState(false);
  const fileName = useMemo(
    () => filePath.split("/").pop() || filePath || "Preview",
    [filePath],
  );

  useEffect(() => {
    if (!isOpen) return;

    const previousShellModalOpen = document.body.dataset.shellModalOpen;
    document.body.dataset.shellModalOpen = "true";

    return () => {
      if (previousShellModalOpen === undefined) {
        delete document.body.dataset.shellModalOpen;
      } else {
        document.body.dataset.shellModalOpen = previousShellModalOpen;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc" || e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
        return;
      }

      if (e.metaKey && !e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onExpand();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, onClose, onExpand]);

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

  const languageExtension = useCodeMirrorLanguageExtension(
    isOpen ? language : "",
  );

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      codeEditorTheme,
      codeEditorStyles,
      quickLookEditorStyles,
      highlightLineField,
      EditorView.lineWrapping,
      drawSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      foldGutter(),
      ...createCodeMirrorFoldExtensions(false, true),
      search(),
      keymap.of([...defaultKeymap, ...searchKeymap, indentWithTab]),
    ];

    if (languageExtension) exts.push(languageExtension);

    return exts;
  }, [languageExtension]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={handleBackdropClick}
          style={interactiveSurfaceOverlayStyle}
          role="presentation"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        >
          <style>{`
            .quicklook-highlight {
              animation: quicklookFlash 0.6s ease-out;
            }

            @keyframes quicklookFlash {
              0%, 100% {
                background-color: color-mix(in srgb, var(--status-info) 18%, transparent);
              }
              50% {
                background-color: color-mix(in srgb, var(--status-info) 30%, transparent);
              }
            }
          `}</style>

          <motion.div
            ref={modalRef}
            className="shell-modal-surface relative flex flex-col overflow-hidden"
            initial={reduceModalMotion ? false : SHELL_MODAL_PANEL_INITIAL}
            animate={SHELL_MODAL_PANEL_ANIMATE}
            exit={
              reduceModalMotion
                ? SHELL_MODAL_PANEL_ANIMATE
                : SHELL_MODAL_PANEL_EXIT
            }
            transition={
              reduceModalMotion
                ? { duration: 0 }
                : SHELL_DIALOG_PANEL_TRANSITION
            }
            onAnimationStart={markMotionStart}
            style={{
              width: modalSize.width,
              height: modalSize.height,
              borderRadius: "30px",
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-soft) 98%, transparent), color-mix(in srgb, var(--surface-shell) 99%, transparent))",
              color: "var(--text-primary)",
              backdropFilter: "blur(18px) saturate(1.08)",
              WebkitBackdropFilter: "blur(18px) saturate(1.08)",
            }}
          >
            <div
              className="flex items-center justify-between"
              style={{
                minHeight: 56,
                padding: "8px 14px",
                borderBottom: "1px solid var(--shell-inline-divider)",
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-strong) 92%, transparent), color-mix(in srgb, var(--surface-shell) 98%, transparent))",
              }}
            >
              <div style={quickLookControlsBubbleStyle}>
                <button
                  type="button"
                  onClick={onClose}
                  className="panel-control-button panel-control-button-danger topbar-control-button"
                  title="Close (Esc)"
                  aria-label="Close preview"
                >
                  <X size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={onExpand}
                  className="panel-control-button topbar-control-button"
                  title="Open in tab (Cmd+T)"
                  aria-label="Open preview in editor tab"
                >
                  <Maximize2 size={14} aria-hidden="true" />
                </button>
              </div>

              <div
                className="min-w-0 flex-1 truncate px-3 text-center"
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
                title={filePath}
              >
                {fileName}
              </div>

              <div style={{ width: 78, flexShrink: 0 }} />
            </div>

            <div className="quicklook-scroll-fog-shell">
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
                  lintKeymap: false,
                  tabSize: 4,
                }}
                theme="none"
                className="h-full"
              />
            </div>

            <div
              ref={resizeRef}
              className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
              onMouseDown={() => {
                markMotionStart();
                setIsResizing(true);
              }}
              role="button"
              tabIndex={0}
              aria-label="Resize modal"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  markMotionStart();
                  setIsResizing(true);
                }
              }}
            >
              <div
                className="absolute bottom-1 right-1 h-3 w-3 border-b-2 border-r-2"
                style={{ borderColor: "var(--border-subtle)" }}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default QuickLookModal;
