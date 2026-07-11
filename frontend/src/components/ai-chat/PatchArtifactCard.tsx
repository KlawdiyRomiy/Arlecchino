import React, { useMemo } from "react";
import { Check, FileCode2, RotateCcw } from "lucide-react";
import {
  AIChatRunArtifact,
  AIPatchArtifactPayload,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  patchFileDisplay,
  PatchFileStatus,
  summarizeUnifiedDiff,
} from "./patchSummary";

interface PatchArtifactCardProps {
  artifact: AIChatRunArtifact;
  busy: boolean;
  onApply: (artifactId: string) => void;
  onRollback: (artifactId: string) => void;
  onOpenReview: () => void;
}

function parsePatchPayload(
  artifact: AIChatRunArtifact,
): AIPatchArtifactPayload {
  try {
    return AIPatchArtifactPayload.createFrom(artifact.payloadJson || "{}");
  } catch {
    return new AIPatchArtifactPayload();
  }
}

const statusLabels: Record<PatchFileStatus, string> = {
  added: "Added",
  deleted: "Deleted",
  edited: "Edited",
  renamed: "Renamed",
};

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function PatchArtifactCard({
  artifact,
  busy,
  onApply,
  onRollback,
  onOpenReview,
}: PatchArtifactCardProps) {
  const payload = useMemo(() => parsePatchPayload(artifact), [artifact]);
  const files = payload.files ?? [];
  const checkpoints = payload.checkpointIds ?? [];
  const canApply = artifact.status === "ready" && payload.checkReady;
  const canRollback =
    artifact.status === "applied" && checkpoints.length > 0 && !busy;
  const rollbackTitle =
    checkpoints.length > 1
      ? "Undo the whole applied patch"
      : files[0]?.path
        ? `Undo changes to ${files[0].path}`
        : "Undo this applied change";
  const summaryFiles = useMemo(
    () => summarizeUnifiedDiff(payload.unifiedDiff || "", files),
    [files, payload.unifiedDiff],
  );
  const additions = summaryFiles.reduce(
    (total, file) => total + file.additions,
    0,
  );
  const deletions = summaryFiles.reduce(
    (total, file) => total + file.deletions,
    0,
  );

  const stop = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <section
      className="ai-chat-patch-artifact"
      data-status={artifact.status}
      aria-label={artifact.title || "Changed files summary"}
    >
      <div className="ai-chat-patch-artifact__head">
        <span className="ai-chat-patch-artifact__title">
          <FileCode2 size={14} />
          Summary
        </span>
        <span
          className="ai-chat-patch-artifact__state"
          aria-label={`${countLabel(summaryFiles.length, "changed file", "changed files")}, ${countLabel(additions, "addition", "additions")}, ${countLabel(deletions, "deletion", "deletions")}`}
        >
          {summaryFiles.length} {summaryFiles.length === 1 ? "file" : "files"}
          <span className="ai-chat-patch-artifact__total-additions">
            +{additions}
          </span>
          <span className="ai-chat-patch-artifact__total-deletions">
            -{deletions}
          </span>
        </span>
      </div>

      {artifact.summary ? (
        <p className="ai-chat-patch-artifact__summary">{artifact.summary}</p>
      ) : null}

      {summaryFiles.length > 0 ? (
        <ul
          className="ai-chat-patch-artifact__files"
          aria-label="Changed files"
        >
          {summaryFiles.map((file) => {
            const display = patchFileDisplay(file.path);
            const pathLabel = file.previousPath
              ? `${file.previousPath} → ${file.path}`
              : file.path;
            return (
              <li
                className="ai-chat-patch-artifact__file"
                key={file.path}
                data-status={file.status}
              >
                <span className="ai-chat-patch-artifact__file-status">
                  {statusLabels[file.status]}
                </span>
                <span className="ai-chat-patch-artifact__file-copy">
                  <span
                    className="ai-chat-patch-artifact__file-name"
                    title={pathLabel}
                  >
                    {display.name}
                  </span>
                  <span
                    className="ai-chat-patch-artifact__file-path"
                    title={pathLabel}
                  >
                    {file.previousPath ? pathLabel : display.directory}
                  </span>
                </span>
                <span
                  className="ai-chat-patch-artifact__file-changes"
                  aria-label={`${countLabel(file.additions, "addition", "additions")}, ${countLabel(file.deletions, "deletion", "deletions")}`}
                >
                  <span className="ai-chat-patch-artifact__additions">
                    +{file.additions}
                  </span>
                  <span className="ai-chat-patch-artifact__deletions">
                    -{file.deletions}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {payload.checkError ? (
        <div className="ai-chat-patch-artifact__error">
          {payload.checkError}
        </div>
      ) : null}

      <div className="ai-chat-patch-artifact__actions">
        {canApply ? (
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              stop(event);
              onApply(artifact.id);
            }}
          >
            <Check size={13} />
            Apply
          </button>
        ) : null}
        {canRollback ? (
          <button
            type="button"
            disabled={busy}
            title={rollbackTitle}
            onClick={(event) => {
              stop(event);
              onRollback(artifact.id);
            }}
          >
            <RotateCcw size={13} />
            Undo
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            stop(event);
            onOpenReview();
          }}
        >
          <FileCode2 size={13} />
          Review
        </button>
      </div>
    </section>
  );
}
