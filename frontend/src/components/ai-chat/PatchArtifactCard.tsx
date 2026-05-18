import React, { useMemo } from "react";
import { Check, FileCode2, RotateCcw } from "lucide-react";
import {
  AIChatRunArtifact,
  AIPatchArtifactPayload,
} from "../../../bindings/arlecchino/internal/ai/models";
import { compactText } from "./aiChatPresentation";

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
  const preview = compactText(payload.unifiedDiff || "", 900);
  const statusLabel = artifact.status.replace(/_/g, " ");
  const rollbackLabel =
    checkpoints.length > 1 ? "Rollback artifact" : "Rollback file";
  const rollbackTitle =
    checkpoints.length > 1
      ? "Rollback the whole patch artifact when supported"
      : files[0]?.path
        ? `Rollback ${files[0].path}`
        : "Rollback this file checkpoint";

  const stop = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="ai-chat-patch-artifact" data-status={artifact.status}>
      <div className="ai-chat-patch-artifact__head">
        <span className="ai-chat-patch-artifact__title">
          <FileCode2 size={14} />
          {artifact.title || "Patch preview"}
        </span>
        <span className="ai-chat-patch-artifact__state">{statusLabel}</span>
      </div>

      {artifact.summary ? (
        <p className="ai-chat-patch-artifact__summary">{artifact.summary}</p>
      ) : null}

      {files.length > 0 ? (
        <div className="ai-chat-patch-artifact__files">
          {files.map((file) => (
            <span key={file.path} title={file.path}>
              {file.status}:{file.path}
            </span>
          ))}
        </div>
      ) : null}

      {payload.checkError ? (
        <div className="ai-chat-patch-artifact__error">
          {payload.checkError}
        </div>
      ) : null}

      {preview ? (
        <pre className="ai-chat-patch-artifact__diff">{preview}</pre>
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
            {rollbackLabel}
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
    </div>
  );
}
