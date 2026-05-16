import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import type {
  AIChatAction,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
} from "../../../bindings/arlecchino/internal/ai/models";
import { AIChatRunArtifactKind } from "../../../bindings/arlecchino/internal/ai/models";
import {
  compactText,
  formatRunTime,
  getActionMeta,
  runStatusLabel,
} from "./aiChatPresentation";
import { ContextSummary } from "./ContextSummary";
import { PatchArtifactCard } from "./PatchArtifactCard";
import { ToolProposalCard } from "./ToolProposalCard";

interface RunCardProps {
  envelope: AIChatRunEnvelope;
  run: AIChatRun | null;
  active: boolean;
  compact: boolean;
  maxWidth: number;
  streamingText: string;
  artifacts?: AIChatRunArtifact[];
  artifactBusyId?: string | null;
  onSelect: (runId: string) => void;
  onApplyPatchArtifact?: (artifactId: string) => void;
  onRollbackPatchCheckpoint?: (checkpointId: string) => void;
  onOpenReview?: () => void;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running" || status === "queued")
    return <Loader2 size={15} className="spin" />;
  if (status === "completed") return <CheckCircle2 size={15} />;
  if (status === "error") return <AlertCircle size={15} />;
  if (status === "canceled") return <XCircle size={15} />;
  return <Clock size={15} />;
}

function normalizeGeneratedSpacing(value: string): string {
  return value
    .replace(/(\d+)\.(?=\p{L})/gu, "$1. ")
    .replace(/([.!?,;:])(?=\p{L})/gu, "$1 ");
}

function cleanAssistantText(value: string, prompt: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const assistantMarker = /<\|?im_start\|?>\s*assistant/i.exec(raw);
  const afterAssistant = assistantMarker
    ? raw.slice(assistantMarker.index + assistantMarker[0].length)
    : raw;
  const cleanedLines: string[] = [];
  for (const line of afterAssistant
    .replace(/<\|?(?:im|lim)_(?:start|end)\|?>/gi, "\n")
    .split(/\r?\n/)) {
    const trimmedLine = line.trimEnd();
    const semanticLine = trimmedLine.trim();
    if (/^(user|assistant|system)\s*:?\s*$/i.test(semanticLine)) {
      continue;
    }
    if (/^(?:user\s+)?intent\s*:/i.test(semanticLine)) {
      continue;
    }
    cleanedLines.push(trimmedLine);
  }
  const cleaned = cleanedLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const normalizedCleaned = cleaned.replace(/\s+/g, " ").trim();
  if (
    normalizedPrompt &&
    (normalizedCleaned === normalizedPrompt ||
      normalizedCleaned === `User intent: ${normalizedPrompt}`)
  ) {
    return "";
  }
  return normalizeGeneratedSpacing(
    cleaned.replace(/^(?:User\s+)?intent:\s*\n?/i, "").trim(),
  );
}

function friendlyRunError(value?: string): string {
  const message = value?.trim() ?? "";
  if (!message) return "";
  if (
    /context deadline exceeded|Client\.Timeout|context cancellation/i.test(
      message,
    )
  ) {
    return "Local provider timed out before finishing. Restart the server or try a smaller model/context.";
  }
  return message;
}

export function RunCard({
  envelope,
  run,
  active,
  compact,
  maxWidth,
  streamingText,
  artifacts = [],
  artifactBusyId = null,
  onSelect,
  onApplyPatchArtifact,
  onRollbackPatchCheckpoint,
  onOpenReview,
}: RunCardProps) {
  const action = envelope.action as AIChatAction;
  const meta = getActionMeta(action);
  const prompt = run?.userPrompt || "";
  const response = cleanAssistantText(
    run?.response || streamingText || "",
    prompt,
  );
  const provider = run?.providerId || envelope.providerId || "runtime";
  const model = run?.model || envelope.model || "";
  const proposals = run?.toolProposals ?? envelope.toolProposals ?? [];
  const patchArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactPatchPreview,
  );
  const context = run?.contextSummary ?? envelope.contextSummary ?? null;
  const cardStyle = {
    "--run-card-width": `${maxWidth}px`,
  } as React.CSSProperties;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(envelope.id);
    }
  };

  return (
    <article
      className={`ai-chat-run-card ai-chat-tone-${meta.tone}${active ? " is-active" : ""}`}
      aria-pressed={active}
      data-status={envelope.status}
      data-compact={compact ? "true" : "false"}
      role="button"
      style={cardStyle}
      tabIndex={0}
      onClick={() => onSelect(envelope.id)}
      onKeyDown={handleKeyDown}
    >
      {prompt ? (
        <div className="ai-chat-message-bubble ai-chat-message-bubble--user">
          <p className="ai-chat-run-card__prompt">
            {compactText(prompt, compact ? 180 : 360)}
          </p>
          <time className="ai-chat-run-card__time">
            {formatRunTime(envelope.createdAt)}
          </time>
        </div>
      ) : null}
      <div className="ai-chat-message-bubble ai-chat-message-bubble--assistant">
        <header className="ai-chat-run-card__header">
          <span className="ai-chat-run-card__mode">
            {meta.icon}
            {meta.label}
          </span>
          <span className="ai-chat-run-card__status">
            <StatusIcon status={envelope.status} />
            {runStatusLabel(envelope.status)}
          </span>
        </header>

        {response ? (
          <div className="ai-chat-run-card__response">{response}</div>
        ) : envelope.status === "running" ? (
          <div className="ai-chat-run-card__response ai-chat-run-card__response--muted">
            Waiting for runtime tokens&hellip;
          </div>
        ) : null}

        <ContextSummary context={context} compact={compact} />

        <div className="ai-chat-run-card__meta">
          <span>{provider}</span>
          {model ? <span>{model}</span> : null}
          {envelope.egressSummary ? (
            <span>{envelope.egressSummary.status}</span>
          ) : null}
        </div>

        {proposals.length > 0 ? (
          <div className="ai-chat-run-card__tools">
            {proposals.map((proposal) => (
              <ToolProposalCard
                key={`${proposal.kind}-${proposal.id || proposal.name}`}
                proposal={proposal}
              />
            ))}
          </div>
        ) : null}

        {patchArtifacts.length > 0 ? (
          <div className="ai-chat-run-card__artifacts">
            {patchArtifacts.map((artifact) => (
              <PatchArtifactCard
                artifact={artifact}
                busy={artifactBusyId === artifact.id}
                key={artifact.id}
                onApply={onApplyPatchArtifact ?? (() => undefined)}
                onOpenReview={onOpenReview ?? (() => undefined)}
                onRollback={onRollbackPatchCheckpoint ?? (() => undefined)}
              />
            ))}
          </div>
        ) : null}

        {envelope.error ? (
          <div className="ai-chat-run-card__error" title={envelope.error}>
            {friendlyRunError(envelope.error)}
          </div>
        ) : null}
      </div>
    </article>
  );
}
