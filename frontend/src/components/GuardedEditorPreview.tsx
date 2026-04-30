import React from "react";
import { AlertTriangle, FileText } from "lucide-react";
import type { EditorFileLoadState } from "../utils/editorFileLoader";
import { codeEditorChromeStyle } from "../utils/codeMirrorTheme";

interface GuardedEditorPreviewProps {
  file: Extract<EditorFileLoadState, { kind: "guardedPreview" | "error" }>;
}

const formatCount = (value: number): string =>
  Number.isFinite(value) && value > 0 ? value.toLocaleString() : "unknown";

export const GuardedEditorPreview: React.FC<GuardedEditorPreviewProps> = ({
  file,
}) => {
  const inspection = file.inspection;
  const content = file.kind === "guardedPreview" ? file.preview.content : "";
  const truncated = file.kind === "guardedPreview" && file.preview.truncated;
  const title =
    file.kind === "guardedPreview" ? "Guarded preview" : "File unavailable";
  const reason =
    file.kind === "guardedPreview"
      ? file.inspection.reason
      : file.message || inspection?.reason;

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      style={codeEditorChromeStyle}
      data-testid="guarded-editor-preview"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--editor-border)] bg-[var(--editor-gutter)] px-4 py-3 text-[var(--editor-text)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--editor-border)] bg-[var(--editor-surface)] text-[var(--editor-text-soft)]">
          {file.kind === "guardedPreview" ? (
            <FileText size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="truncate text-xs text-[var(--editor-text-muted)]">
            {title}
            {inspection ? ` - ${inspection.formattedSize}` : ""}
            {inspection?.lineCount
              ? ` - ${formatCount(inspection.lineCount)} lines`
              : ""}
            {inspection?.maxLineLength
              ? ` - max line ${formatCount(inspection.maxLineLength)} bytes`
              : ""}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-[var(--editor-border)] bg-[var(--editor-surface)] px-4 py-3 text-xs leading-5 text-[var(--editor-text-soft)]">
        {reason}
        {truncated ? " Preview is truncated." : ""}
      </div>

      <pre className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre bg-[var(--editor-bg)] p-4 font-mono text-[13px] leading-6 text-[var(--editor-text)]">
        {content || "No preview available."}
      </pre>
    </div>
  );
};
