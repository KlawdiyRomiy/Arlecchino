import React from "react";
import { Binary } from "lucide-react";
import type { EditorFileLoadState } from "../utils/editorFileLoader";
import { codeEditorChromeStyle } from "../utils/codeMirrorTheme";

interface BinaryEditorPreviewProps {
  file: Extract<EditorFileLoadState, { kind: "binaryPreview" }>;
}

export const BinaryEditorPreview: React.FC<BinaryEditorPreviewProps> = ({
  file,
}) => {
  const sections = file.binary.sections ?? [];
  const stringsPreview = file.binary.stringsPreview ?? [];

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      style={codeEditorChromeStyle}
      data-testid="binary-editor-preview"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--editor-border)] bg-[var(--editor-gutter)] px-4 py-3 text-[var(--editor-text)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--editor-border)] bg-[var(--editor-surface)] text-[var(--editor-text-soft)]">
          <Binary size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="truncate text-xs text-[var(--editor-text-muted)]">
            {file.binary.format} - {file.binary.formattedSize} - read-only
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[var(--editor-bg)] text-[var(--editor-text)]">
        <div className="border-b border-[var(--editor-border)] bg-[var(--editor-surface)] px-4 py-3 text-xs leading-5 text-[var(--editor-text-soft)]">
          {file.binary.reason}
          {file.binary.truncated ? " Preview is truncated." : ""}
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(260px,34%)_1fr]">
          <div className="border-b border-[var(--editor-border)] lg:border-b-0 lg:border-r">
            {sections.map((section) => (
              <section
                key={section.title}
                className="border-b border-[var(--editor-border)] px-4 py-3 last:border-b-0"
              >
                <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--editor-text-muted)]">
                  {section.title}
                </h3>
                <dl className="space-y-2">
                  {section.rows.map((row, index) => (
                    <div
                      key={`${row.label}-${index}`}
                      className="grid grid-cols-[112px_1fr] gap-3 text-xs leading-5"
                    >
                      <dt className="truncate text-[var(--editor-text-muted)]">
                        {row.label}
                      </dt>
                      <dd className="break-words font-mono text-[var(--editor-text)]">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>

          <div className="min-w-0">
            <section className="border-b border-[var(--editor-border)] px-4 py-3">
              <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--editor-text-muted)]">
                Hex preview
              </h3>
              <pre
                className="m-0 max-h-[45vh] overflow-auto whitespace-pre font-mono text-[12px] leading-5 text-[var(--editor-text)]"
                data-testid="binary-hex-preview"
              >
                {file.binary.hexPreview || "No hex preview available."}
              </pre>
            </section>

            <section className="px-4 py-3">
              <h3 className="mb-2 text-xs font-semibold uppercase text-[var(--editor-text-muted)]">
                Strings preview
              </h3>
              {stringsPreview.length > 0 ? (
                <pre
                  className="m-0 max-h-[30vh] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-5 text-[var(--editor-text)]"
                  data-testid="binary-strings-preview"
                >
                  {stringsPreview.join("\n")}
                </pre>
              ) : (
                <div className="text-xs text-[var(--editor-text-muted)]">
                  No printable strings found in preview bytes.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
