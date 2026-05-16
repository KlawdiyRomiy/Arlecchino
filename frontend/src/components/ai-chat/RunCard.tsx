import React, { useState } from "react";
import { CheckCircle2, Copy, FileText, Layers, Sparkles } from "lucide-react";
import type {
  AIChatAction,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIContextItemDisclosure,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  AIChatRunArtifactKind,
  AIContextItemKind,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  compactText,
  formatRunTime,
  getActionMeta,
} from "./aiChatPresentation";
import { PatchArtifactCard } from "./PatchArtifactCard";
import { ToolProposalCard } from "./ToolProposalCard";

interface RunCardProps {
  envelope: AIChatRunEnvelope;
  run: AIChatRun | null;
  active: boolean;
  compact: boolean;
  streamingText: string;
  artifacts?: AIChatRunArtifact[];
  artifactBusyId?: string | null;
  onSelect: (runId: string) => void;
  onApplyPatchArtifact?: (artifactId: string) => void;
  onRollbackPatchCheckpoint?: (checkpointId: string) => void;
  onOpenReview?: () => void;
  searchQuery?: string;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function searchTerms(query: string): string[] {
  const seen = new Set<string>();
  return query
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => {
      const key = term.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderHighlightedText(value: string, query: string): React.ReactNode {
  const terms = searchTerms(query);
  if (terms.length === 0) return value;
  const pattern = new RegExp(
    `(${terms
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|")})`,
    "gi",
  );
  return value.split(pattern).map((part, index) =>
    terms.some(
      (term) => term.toLocaleLowerCase() === part.toLocaleLowerCase(),
    ) ? (
      <mark className="ai-chat-search-hit" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : (
      <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
    ),
  );
}

function mentionItemsForRun(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
): AIContextItemDisclosure[] {
  const items =
    run?.contextSummary?.contextItems ?? envelope.contextSummary?.contextItems;
  return (items ?? []).filter((item) => item.source === "mention");
}

function iconForMentionItem(kind: AIContextItemKind) {
  switch (kind) {
    case AIContextItemKind.AIContextItemKindFile:
      return FileText;
    case AIContextItemKind.AIContextItemKindWorkspace:
    case AIContextItemKind.AIContextItemKindMCP:
    case AIContextItemKind.AIContextItemKindMnemonic:
    case AIContextItemKind.AIContextItemKindTerminal:
      return Layers;
    default:
      return Sparkles;
  }
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function elapsedMs(envelope: AIChatRunEnvelope, run: AIChatRun | null): number {
  const created = Date.parse(run?.createdAt || envelope.createdAt || "");
  if (!Number.isFinite(created)) return 0;
  const updated = Date.parse(run?.updatedAt || envelope.updatedAt || "");
  const end =
    envelope.status === "running" || envelope.status === "queued"
      ? Date.now()
      : updated;
  if (!Number.isFinite(end) || end < created) return 0;
  return end - created;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function workedForLabel(envelope: AIChatRunEnvelope, run: AIChatRun | null) {
  const verb =
    envelope.status === "running" || envelope.status === "queued"
      ? "Working for"
      : "Worked for";
  return `${verb} ${formatElapsed(elapsedMs(envelope, run))}`;
}

export function RunCard({
  envelope,
  run,
  active,
  compact,
  streamingText,
  artifacts = [],
  artifactBusyId = null,
  onSelect,
  onApplyPatchArtifact,
  onRollbackPatchCheckpoint,
  onOpenReview,
  searchQuery = "",
}: RunCardProps) {
  const [copiedMessage, setCopiedMessage] = useState<
    "prompt" | "response" | null
  >(null);
  const action = envelope.action as AIChatAction;
  const meta = getActionMeta(action);
  const prompt = run?.userPrompt || "";
  const displayPrompt = compactText(prompt, compact ? 180 : 360);
  const createdTime = formatRunTime(envelope.createdAt);
  const response = cleanAssistantText(
    run?.response || streamingText || "",
    prompt,
  );
  const proposals = run?.toolProposals ?? envelope.toolProposals ?? [];
  const mentionItems = mentionItemsForRun(envelope, run);
  const patchArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactPatchPreview,
  );
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(envelope.id);
    }
  };
  const handleCopy = async (
    event: React.MouseEvent<HTMLButtonElement>,
    kind: "prompt" | "response",
    value: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!value.trim()) return;
    await copyText(value);
    setCopiedMessage(kind);
    window.setTimeout(() => {
      setCopiedMessage((current) => (current === kind ? null : current));
    }, 1200);
  };

  return (
    <article
      className={`ai-chat-run-card ai-chat-tone-${meta.tone}${active ? " is-active" : ""}`}
      aria-pressed={active}
      data-ai-chat-run-id={envelope.id}
      data-status={envelope.status}
      data-compact={compact ? "true" : "false"}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(envelope.id)}
      onKeyDown={handleKeyDown}
    >
      {prompt ? (
        <div className="ai-chat-message-group ai-chat-message-group--user">
          <div className="ai-chat-message-bubble ai-chat-message-bubble--user">
            <span className="ai-chat-run-card__user-mode">
              {createdTime ? (
                <time
                  className="ai-chat-run-card__time"
                  dateTime={envelope.createdAt}
                >
                  {createdTime}
                </time>
              ) : null}
              <span
                className="ai-chat-run-card__mode-icon"
                role="img"
                aria-label={`${meta.label} mode`}
                title={`${meta.label} mode`}
              >
                {meta.icon}
              </span>
            </span>
            <p className="ai-chat-run-card__prompt">
              {renderHighlightedText(displayPrompt, searchQuery)}
            </p>
            {mentionItems.length > 0 ? (
              <div
                className="ai-chat-run-card__mentions"
                aria-label="Mentioned context"
              >
                {mentionItems.map((item) => {
                  const Icon = iconForMentionItem(item.kind);
                  const label = item.label || item.path || "Mention";
                  const detail = item.path || item.reason || "";
                  return (
                    <span
                      className="ai-chat-run-card__mention"
                      key={`${item.kind}-${item.id}-${item.path}-${label}`}
                      title={item.path || item.reason || label}
                    >
                      <span className="ai-chat-run-card__mention-icon">
                        <Icon size={16} />
                      </span>
                      <span className="ai-chat-run-card__mention-body">
                        <strong>{label}</strong>
                        {detail && detail !== label ? (
                          <small>{detail}</small>
                        ) : null}
                      </span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="ai-chat-message-actions ai-chat-message-actions--user">
            <button
              className="ai-chat-message-action"
              type="button"
              title="Copy user message"
              onClick={(event) => handleCopy(event, "prompt", prompt)}
            >
              {copiedMessage === "prompt" ? (
                <CheckCircle2 size={14} />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
        </div>
      ) : null}
      <div className="ai-chat-message-group ai-chat-message-group--assistant">
        <div className="ai-chat-message-bubble ai-chat-message-bubble--assistant">
          <header className="ai-chat-run-card__header">
            <span className="ai-chat-run-card__worked">
              {workedForLabel(envelope, run)}
            </span>
          </header>

          {response ? (
            <div className="ai-chat-run-card__response">
              {renderHighlightedText(response, searchQuery)}
            </div>
          ) : envelope.status === "running" ? (
            <div className="ai-chat-run-card__response ai-chat-run-card__response--muted">
              Waiting for runtime tokens&hellip;
            </div>
          ) : null}

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
        {response ? (
          <div className="ai-chat-message-actions ai-chat-message-actions--assistant">
            <button
              className="ai-chat-message-action"
              type="button"
              title="Copy assistant message"
              onClick={(event) => handleCopy(event, "response", response)}
            >
              {copiedMessage === "response" ? (
                <CheckCircle2 size={14} />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
