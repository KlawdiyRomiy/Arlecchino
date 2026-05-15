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
  AIChatRunEnvelope,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  compactText,
  formatRunTime,
  getActionMeta,
  runStatusLabel,
} from "./aiChatPresentation";
import { ContextSummary } from "./ContextSummary";
import { ToolProposalCard } from "./ToolProposalCard";

interface RunCardProps {
  envelope: AIChatRunEnvelope;
  run: AIChatRun | null;
  active: boolean;
  compact: boolean;
  maxWidth: number;
  onSelect: (runId: string) => void;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running" || status === "queued")
    return <Loader2 size={15} className="spin" />;
  if (status === "completed") return <CheckCircle2 size={15} />;
  if (status === "error") return <AlertCircle size={15} />;
  if (status === "canceled") return <XCircle size={15} />;
  return <Clock size={15} />;
}

export function RunCard({
  envelope,
  run,
  active,
  compact,
  maxWidth,
  onSelect,
}: RunCardProps) {
  const action = envelope.action as AIChatAction;
  const meta = getActionMeta(action);
  const prompt = run?.userPrompt || "";
  const response = run?.response || "";
  const provider = run?.providerId || envelope.providerId || "runtime";
  const model = run?.model || envelope.model || "";
  const proposals = run?.toolProposals ?? envelope.toolProposals ?? [];
  const context = run?.contextSummary ?? envelope.contextSummary ?? null;

  return (
    <article
      className={`ai-chat-run-card ai-chat-tone-${meta.tone}${active ? " is-active" : ""}`}
      data-status={envelope.status}
      data-compact={compact ? "true" : "false"}
      style={{ maxWidth }}
      onClick={() => onSelect(envelope.id)}
    >
      <header className="ai-chat-run-card__header">
        <span className="ai-chat-run-card__mode">
          {meta.icon}
          {meta.shortLabel}
        </span>
        <span className="ai-chat-run-card__status">
          <StatusIcon status={envelope.status} />
          {runStatusLabel(envelope.status)}
        </span>
        <time className="ai-chat-run-card__time">
          {formatRunTime(envelope.createdAt)}
        </time>
      </header>

      {prompt ? (
        <p className="ai-chat-run-card__prompt">
          {compactText(prompt, compact ? 180 : 360)}
        </p>
      ) : null}
      {response ? (
        <div className="ai-chat-run-card__response">{response}</div>
      ) : envelope.status === "running" ? (
        <div className="ai-chat-run-card__response ai-chat-run-card__response--muted">
          Waiting for runtime tokens...
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
          {proposals.map((proposal, index) => (
            <ToolProposalCard
              key={`${proposal.kind}-${proposal.id}-${index}`}
              proposal={proposal}
            />
          ))}
        </div>
      ) : null}

      {envelope.error ? (
        <div className="ai-chat-run-card__error">{envelope.error}</div>
      ) : null}
    </article>
  );
}
