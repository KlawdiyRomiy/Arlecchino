import React from "react";
import { Loader2 } from "lucide-react";
import type { EditorFileLoadState } from "../utils/editorFileLoader";
import { codeEditorChromeStyle } from "../utils/codeMirrorTheme";

interface EditorFileLoadingViewProps {
  file: Extract<EditorFileLoadState, { kind: "loading" }>;
}

export const EditorFileLoadingView: React.FC<EditorFileLoadingViewProps> = ({
  file,
}) => (
  <div
    className="flex h-full min-h-0 w-full items-center justify-center"
    style={codeEditorChromeStyle}
    data-testid="editor-file-loading"
  >
    <div className="flex items-center gap-3 rounded-lg border border-[var(--editor-border)] bg-[var(--editor-surface)] px-4 py-3 text-[var(--editor-text)] shadow-[var(--shadow-overlay)]">
      <Loader2
        size={16}
        className="shrink-0 animate-spin text-[var(--editor-text-soft)]"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="truncate text-xs text-[var(--editor-text-muted)]">
          Opening file...
        </div>
      </div>
    </div>
  </div>
);
