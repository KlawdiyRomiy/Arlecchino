import React from "react";
import { Image as ImageIcon } from "lucide-react";
import type { EditorFileLoadState } from "../utils/editorFileLoader";
import { codeEditorChromeStyle } from "../utils/codeMirrorTheme";

interface ImageEditorPreviewProps {
  file: Extract<EditorFileLoadState, { kind: "visualPreview" }>;
}

export const ImageEditorPreview: React.FC<ImageEditorPreviewProps> = ({
  file,
}) => (
  <div
    className="flex h-full min-h-0 w-full flex-col overflow-hidden"
    style={codeEditorChromeStyle}
    data-testid="image-editor-preview"
  >
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--editor-border)] bg-[var(--editor-gutter)] px-4 py-3 text-[var(--editor-text)]">
      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--editor-border)] bg-[var(--editor-surface)] text-[var(--editor-text-soft)]">
        <ImageIcon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="truncate text-xs text-[var(--editor-text-muted)]">
          {file.visual.mimeType} - {file.visual.formattedSize}
        </div>
      </div>
    </div>

    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[var(--editor-bg)] p-6">
      <img
        src={file.visual.dataUrl}
        alt={file.name}
        className="max-h-full max-w-full object-contain"
        draggable={false}
      />
    </div>
  </div>
);
