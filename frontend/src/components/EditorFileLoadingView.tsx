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
  <output
    className="flex h-full min-h-0 w-full items-start"
    style={codeEditorChromeStyle}
    aria-label={`Opening ${file.name}`}
    data-testid="editor-file-loading"
  >
    <div className="flex h-9 w-full min-w-0 items-center gap-2 border-b border-[var(--editor-border)] bg-[var(--editor-surface)] px-3 text-[var(--editor-text-muted)]">
      <Loader2
        size={13}
        className="shrink-0 animate-spin text-[var(--editor-text-soft)]"
      />
      <span className="truncate text-xs">{file.name}</span>
    </div>
  </output>
);
