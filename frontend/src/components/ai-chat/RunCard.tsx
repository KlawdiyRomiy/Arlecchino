import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Layers,
  Sparkles,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { AnimatePresence, m } from "framer-motion";
import type {
  AIChatAction,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIContextItemDisclosure,
  AIRunTimelineEvent,
  AIToolProposal,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  AIChatRunArtifactKind,
  AIContextItemKind,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  compactText,
  formatRunTime,
  getActionMeta,
  runActivityLabel,
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
  onApplyPatchArtifact?: (artifactId: string, runId: string) => void;
  onApproveMnemonicArtifact?: (artifactId: string) => void;
  onRollbackPatchArtifact?: (artifactId: string, runId: string) => void;
  onOpenReview?: () => void;
  onPreviewToolProposal?: (
    proposal: AIToolProposal,
    runId: string,
    runRevision?: number,
  ) => void;
  onDenyToolProposal?: (
    proposal: AIToolProposal,
    runId: string,
    runRevision?: number,
  ) => void;
  onApproveToolProposal?: (
    proposal: AIToolProposal,
    runId: string,
    scope: "once" | "run",
    runRevision?: number,
  ) => void;
  searchQuery?: string;
}

function normalizeGeneratedSpacing(value: string): string {
  return value
    .replace(/(\d+)\.(?=\p{L})/gu, "$1. ")
    .replace(/([!?,;:])(?=\p{L})/gu, "$1 ");
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
    .replace(/<\/?\|?(?:im|lim)_(?:start|end)\|?>/gi, "\n")
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
  return contextItemsForRun(envelope, run).filter(
    (item) => item.source === "mention",
  );
}

function contextItemsForRun(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
): AIContextItemDisclosure[] {
  const items =
    run?.contextSummary?.contextItems ?? envelope.contextSummary?.contextItems;
  return items ?? [];
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

function elapsedMs(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
  now = Date.now(),
): number {
  const created = Date.parse(run?.createdAt || envelope.createdAt || "");
  if (!Number.isFinite(created)) return 0;
  const updated = Date.parse(run?.updatedAt || envelope.updatedAt || "");
  const end =
    envelope.status === "running" || envelope.status === "queued"
      ? now
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

function workedForLabel(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
  now?: number,
) {
  const verb =
    envelope.status === "running" || envelope.status === "queued"
      ? "Working for"
      : "Worked for";
  return `${verb} ${formatElapsed(elapsedMs(envelope, run, now))}`;
}

function canPreviewToolProposal(proposal: AIToolProposal): boolean {
  const id = proposal.name || proposal.id || "";
  return [
    "context.read",
    "diagnostics.read",
    "file.read_range",
    "file.edit.preview",
    "file.create.preview",
    "file.patch.preview",
    "workspace.grep",
    "git.preview",
    "mcp.preview",
    "mcp.execute",
    "subagent.preview",
    "terminal.preview",
  ].includes(id);
}

function canDenyToolProposal(proposal: AIToolProposal): boolean {
  const candidates = [
    proposal.name,
    proposal.id,
    proposal.id?.replace(/^tool-call-/, ""),
  ].map((value) => value?.trim());
  return (
    proposal.status !== "blocked" &&
    candidates.some(
      (candidate) => Boolean(candidate) && candidate.includes("."),
    )
  );
}

function canApproveToolProposal(proposal: AIToolProposal): boolean {
  const candidates = [
    proposal.name,
    proposal.id,
    proposal.id?.replace(/^tool-call-/, ""),
  ].map((value) => value?.trim());
  return (
    proposal.status !== "blocked" &&
    candidates.some((candidate) =>
      ["terminal.preview", "file.patch.apply", "mcp.execute"].includes(
        candidate || "",
      ),
    )
  );
}

function reviewDisabledReason(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
): string {
  if (envelope.status === "canceled" || run?.status === "canceled") {
    return "Run canceled";
  }
  if (
    run &&
    envelope.revision > 0 &&
    run.revision > 0 &&
    run.revision < envelope.revision
  ) {
    return "Run updated";
  }
  return "";
}

function memoryCitationCountLabel(count: number): string {
  return `${count} memory citation${count === 1 ? "" : "s"}`;
}

function memoryArtifactMeta(artifact: AIChatRunArtifact): string {
  const parts = [artifact.status || "recorded"];
  try {
    const payload = JSON.parse(artifact.payloadJson || "{}") as Record<
      string,
      unknown
    >;
    const entry =
      payload.entry && typeof payload.entry === "object"
        ? (payload.entry as Record<string, unknown>)
        : payload;
    const source = typeof entry.source === "string" ? entry.source : "";
    const trust = typeof entry.trust === "string" ? entry.trust : "";
    if (source) parts.push(source);
    if (trust) parts.push(trust);
  } catch {
    // Ignore malformed artifact payloads; the visible summary is enough.
  }
  return parts.filter(Boolean).join(" · ");
}

interface ToolLifecyclePayload {
  toolId: string;
  action: string;
  status: string;
  artifactId: string;
  outputPreview: string;
  error: string;
  targetPaths: string[];
  riskLevel: string;
  approvalModeRequired: string;
  allowedByCurrentPolicy: boolean;
  hardDenyReason: string;
  lifecycle: string[];
}

function parseToolLifecyclePayload(
  artifact: AIChatRunArtifact,
): ToolLifecyclePayload {
  const fallback: ToolLifecyclePayload = {
    toolId: artifact.title.replace(/^Tool:\s*/i, "") || "tool",
    action: "",
    status: artifact.status || "recorded",
    artifactId: "",
    outputPreview: artifact.summary || "",
    error: "",
    targetPaths: [],
    riskLevel: "",
    approvalModeRequired: "",
    allowedByCurrentPolicy: false,
    hardDenyReason: "",
    lifecycle: [],
  };
  try {
    const payload = JSON.parse(artifact.payloadJson || "{}") as Record<
      string,
      unknown
    >;
    const audit =
      payload.audit && typeof payload.audit === "object"
        ? (payload.audit as Record<string, unknown>)
        : {};
    const proposal =
      payload.proposal && typeof payload.proposal === "object"
        ? (payload.proposal as Record<string, unknown>)
        : {};
    const targetPaths = Array.isArray(proposal.targetPaths)
      ? proposal.targetPaths.filter(
          (value): value is string => typeof value === "string",
        )
      : Array.isArray(audit.targetPaths)
        ? audit.targetPaths.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
    const lifecycle = Array.isArray(payload.lifecycle)
      ? payload.lifecycle.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return {
      toolId:
        (typeof payload.toolId === "string" && payload.toolId) ||
        (typeof audit.toolId === "string" && audit.toolId) ||
        fallback.toolId,
      action:
        (typeof payload.action === "string" && payload.action) ||
        (typeof audit.action === "string" && audit.action) ||
        fallback.action,
      status:
        (typeof payload.status === "string" && payload.status) ||
        (typeof audit.status === "string" && audit.status) ||
        fallback.status,
      artifactId:
        (typeof payload.artifactId === "string" && payload.artifactId) ||
        (typeof audit.artifactId === "string" && audit.artifactId) ||
        "",
      outputPreview:
        (typeof payload.outputPreview === "string" && payload.outputPreview) ||
        (typeof audit.outputPreview === "string" && audit.outputPreview) ||
        fallback.outputPreview,
      error:
        (typeof payload.error === "string" && payload.error) ||
        (typeof audit.error === "string" && audit.error) ||
        "",
      targetPaths,
      riskLevel:
        (typeof proposal.riskLevel === "string" && proposal.riskLevel) || "",
      approvalModeRequired:
        (typeof proposal.approvalModeRequired === "string" &&
          proposal.approvalModeRequired) ||
        "",
      allowedByCurrentPolicy:
        typeof proposal.allowedByCurrentPolicy === "boolean"
          ? proposal.allowedByCurrentPolicy
          : false,
      hardDenyReason:
        (typeof proposal.hardDenyReason === "string" &&
          proposal.hardDenyReason) ||
        "",
      lifecycle,
    };
  } catch {
    return fallback;
  }
}

function toolLifecycleState(status: string): "ok" | "blocked" | "active" {
  const normalized = status.toLocaleLowerCase();
  if (
    normalized.includes("approval_required") ||
    normalized.includes("blocked") ||
    normalized.includes("error") ||
    normalized.includes("denied")
  ) {
    return "blocked";
  }
  if (normalized.includes("started") || normalized.includes("running")) {
    return "active";
  }
  return "ok";
}

function toolLifecycleMeta(payload: ToolLifecyclePayload): string {
  return [
    payload.action,
    payload.status,
    payload.lifecycle.length > 0 ? payload.lifecycle.join(" -> ") : "",
    payload.artifactId,
  ]
    .filter(Boolean)
    .join(" · ");
}

function toolLifecycleApprovalLabel(payload: ToolLifecyclePayload): string {
  if (payload.hardDenyReason) {
    return `Hard deny: ${payload.hardDenyReason}`;
  }
  if (payload.allowedByCurrentPolicy) {
    return "Policy allowed";
  }
  return payload.approvalModeRequired
    ? `Requires ${payload.approvalModeRequired}`
    : "";
}

function ToolLifecycleArtifacts({
  artifacts,
}: {
  artifacts: AIChatRunArtifact[];
}) {
  if (artifacts.length === 0) return null;
  return (
    <div className="ai-chat-tool-lifecycle" aria-label="Tool execution log">
      {artifacts.map((artifact) => {
        const payload = parseToolLifecyclePayload(artifact);
        const state = toolLifecycleState(payload.status);
        const Icon = state === "blocked" ? AlertTriangle : Wrench;
        const detail =
          payload.error ||
          payload.targetPaths[0] ||
          payload.outputPreview ||
          artifact.summary;
        const approvalLabel = toolLifecycleApprovalLabel(payload);
        return (
          <div
            className="ai-chat-tool-lifecycle__item"
            data-state={state}
            data-risk={payload.riskLevel || "unknown"}
            key={artifact.id}
          >
            <div className="ai-chat-tool-lifecycle__head">
              <span className="ai-chat-tool-lifecycle__title">
                <Icon size={14} />
                {payload.toolId}
              </span>
              <span className="ai-chat-tool-lifecycle__meta">
                {toolLifecycleMeta(payload)}
              </span>
            </div>
            {payload.riskLevel || approvalLabel ? (
              <div className="ai-chat-tool-lifecycle__badges">
                {payload.riskLevel ? (
                  <span className="ai-chat-tool-lifecycle__badge">
                    Risk: {payload.riskLevel}
                  </span>
                ) : null}
                {approvalLabel ? (
                  <span className="ai-chat-tool-lifecycle__badge">
                    {approvalLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
            {detail ? (
              <p className="ai-chat-tool-lifecycle__detail">{detail}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function RunTimeline({ events }: { events: AIRunTimelineEvent[] }) {
  const visible = events.slice(-6);
  if (visible.length === 0) return null;
  return (
    <div className="ai-chat-run-timeline" aria-label="Run timeline">
      {visible.map((event) => (
        <div
          className="ai-chat-run-timeline__item"
          data-status={event.status || "recorded"}
          key={event.id}
          title={[
            event.source,
            event.type,
            event.status,
            event.createdAt,
            event.summary,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <Clock3 size={12} />
          <span>{event.type?.replace(/_/g, " ") || "event"}</span>
          {event.status ? <small>{event.status}</small> : null}
        </div>
      ))}
    </div>
  );
}

interface MemoryCitationsProps {
  artifacts: AIChatRunArtifact[];
  artifactBusyId: string | null;
  onApproveMnemonicArtifact?: (artifactId: string) => void;
}

function MemoryCitations({
  artifacts,
  artifactBusyId,
  onApproveMnemonicArtifact,
}: MemoryCitationsProps) {
  const [open, setOpen] = useState(false);
  if (artifacts.length === 0) return null;
  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };
  return (
    <div className="ai-chat-memory-citations" onClick={stop}>
      <button
        className="ai-chat-memory-citations__toggle"
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          stop(event);
          setOpen((value) => !value);
        }}
      >
        <m.span
          className="ai-chat-memory-citations__chevron"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <ChevronRight size={16} />
        </m.span>
        <span>{memoryCitationCountLabel(artifacts.length)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            className="ai-chat-memory-citations__list"
            initial={{ opacity: 0, height: 0, y: -3 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -3 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {artifacts.map((artifact) => (
              <div
                className="ai-chat-memory-citations__item"
                data-status={artifact.status}
                key={artifact.id}
              >
                <div className="ai-chat-memory-citations__item-head">
                  <span className="ai-chat-memory-citations__source">
                    {artifact.title || "Mnemonic"}
                  </span>
                  <span className="ai-chat-memory-citations__meta">
                    {memoryArtifactMeta(artifact)}
                  </span>
                </div>
                {artifact.summary ? (
                  <p className="ai-chat-memory-citations__summary">
                    {artifact.summary}
                  </p>
                ) : null}
                {artifact.status === "proposed" ? (
                  <button
                    className="ai-chat-secondary-button is-primary"
                    type="button"
                    disabled={artifactBusyId === artifact.id}
                    onClick={(event) => {
                      stop(event);
                      onApproveMnemonicArtifact?.(artifact.id);
                    }}
                  >
                    <ShieldCheck size={13} />
                    {artifactBusyId === artifact.id
                      ? "Approving"
                      : "Trust and save"}
                  </button>
                ) : null}
              </div>
            ))}
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
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
  onApproveMnemonicArtifact,
  onRollbackPatchArtifact,
  onOpenReview,
  onPreviewToolProposal,
  onDenyToolProposal,
  onApproveToolProposal,
  searchQuery = "",
}: RunCardProps) {
  const [copiedMessage, setCopiedMessage] = useState<
    "prompt" | "response" | null
  >(null);
  const running = envelope.status === "running" || envelope.status === "queued";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [running]);
  const action = envelope.action as AIChatAction;
  const meta = getActionMeta(action);
  const prompt = run?.userPrompt || "";
  const displayPrompt = compactText(prompt, compact ? 180 : 360);
  const createdTime = formatRunTime(envelope.createdAt);
  const response = cleanAssistantText(
    run?.response || streamingText || "",
    prompt,
  );
  const contextItems = contextItemsForRun(envelope, run);
  const runElapsedMs = elapsedMs(envelope, run, now);
  const activityLabel = runActivityLabel({
    status: envelope.status,
    activeText: response,
    contextItems,
    elapsedMs: runElapsedMs,
  });
  const proposals = run?.toolProposals ?? envelope.toolProposals ?? [];
  const toolReviewDisabledReason = reviewDisabledReason(envelope, run);
  const mentionItems = contextItems.filter((item) => item.source === "mention");
  const patchArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactPatchPreview,
  );
  const toolLifecycleArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactToolProposal ||
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactTerminal,
  );
  const memoryArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactMemory,
  );
  const timelineEvents = envelope.timeline ?? [];
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
              {workedForLabel(envelope, run, now)}
            </span>
          </header>

          {response ? (
            <div className="ai-chat-run-card__response">
              {renderHighlightedText(response, searchQuery)}
            </div>
          ) : running ? (
            <div className="ai-chat-run-card__response ai-chat-run-card__response--muted">
              {activityLabel}&hellip;
            </div>
          ) : null}

          {proposals.length > 0 ? (
            <div className="ai-chat-run-card__tools">
              {proposals.map((proposal) => (
                <ToolProposalCard
                  key={`${proposal.kind}-${proposal.id || proposal.name}`}
                  approveOnceBusy={
                    artifactBusyId ===
                    `approve:once:${proposal.id || proposal.name || proposal.kind}`
                  }
                  approveRunBusy={
                    artifactBusyId ===
                    `approve:run:${proposal.id || proposal.name || proposal.kind}`
                  }
                  busy={artifactBusyId === (proposal.id || proposal.name)}
                  canApprove={canApproveToolProposal(proposal)}
                  canDeny={canDenyToolProposal(proposal)}
                  canPreview={canPreviewToolProposal(proposal)}
                  denyBusy={
                    artifactBusyId ===
                    `deny:${proposal.id || proposal.name || proposal.kind}`
                  }
                  reviewDisabledReason={toolReviewDisabledReason}
                  onDeny={(nextProposal) =>
                    onDenyToolProposal?.(
                      nextProposal,
                      envelope.id,
                      envelope.revision,
                    )
                  }
                  onApprove={(nextProposal, scope) =>
                    onApproveToolProposal?.(
                      nextProposal,
                      envelope.id,
                      scope,
                      envelope.revision,
                    )
                  }
                  onPreview={(nextProposal) =>
                    onPreviewToolProposal?.(
                      nextProposal,
                      envelope.id,
                      envelope.revision,
                    )
                  }
                  proposal={proposal}
                />
              ))}
            </div>
          ) : null}

          <ToolLifecycleArtifacts artifacts={toolLifecycleArtifacts} />
          <RunTimeline events={timelineEvents} />

          {patchArtifacts.length > 0 ? (
            <div className="ai-chat-run-card__artifacts">
              {patchArtifacts.map((artifact) => (
                <PatchArtifactCard
                  artifact={artifact}
                  busy={artifactBusyId === artifact.id}
                  key={artifact.id}
                  onApply={(artifactId) => {
                    onSelect(envelope.id);
                    onApplyPatchArtifact?.(artifactId, envelope.id);
                  }}
                  onOpenReview={() => {
                    onSelect(envelope.id);
                    onOpenReview?.();
                  }}
                  onRollback={(artifactId) => {
                    onSelect(envelope.id);
                    onRollbackPatchArtifact?.(artifactId, envelope.id);
                  }}
                />
              ))}
            </div>
          ) : null}

          {memoryArtifacts.length > 0 ? (
            <MemoryCitations
              artifacts={memoryArtifacts}
              artifactBusyId={artifactBusyId}
              onApproveMnemonicArtifact={onApproveMnemonicArtifact}
            />
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
