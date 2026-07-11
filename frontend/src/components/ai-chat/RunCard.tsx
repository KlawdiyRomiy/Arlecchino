import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileText,
  Info,
  Layers,
  MessageSquareText,
  Sparkles,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type {
  AIChatAction,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIContextItemDisclosure,
  AIQuestionAnswerRequest,
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
} from "./aiChatPresentation";
import { AgentRunProgress } from "./AgentRunProgress";
import { AIChatMarkdownMessage } from "./AIChatMarkdownMessage";
import { projectAssistantCommentary } from "./assistantCommentary";
import { useAssistantTypewriterText } from "./assistantTypewriter";
import { PatchArtifactCard } from "./PatchArtifactCard";
import { mostCompleteRunText } from "./runTokenFrameBuffer";
import { ToolProposalCard } from "./ToolProposalCard";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";

interface RunCardProps {
  envelope: AIChatRunEnvelope;
  run: AIChatRun | null;
  active: boolean;
  compact: boolean;
  streamingText: string;
  hydrationStatus?: "idle" | "loading" | "failed" | "hydrated";
  artifacts?: AIChatRunArtifact[];
  artifactBusyId?: string | null;
  onSelect: (runId: string) => void;
  onApplyPatchArtifact?: (artifactId: string, runId: string) => void;
  onApproveMnemonicArtifact?: (artifactId: string) => void;
  onRollbackPatchArtifact?: (artifactId: string, runId: string) => void;
  onSubmitQuestionAnswer?: (request: AIQuestionAnswerRequest) => void;
  onAcceptPlan?: (planRunId: string) => void;
  onRequestPlanRevision?: (planRunId: string, reason: string) => void;
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

type MarkdownFence = { char: string; length: number };

function markdownFenceAtLineStart(line: string): MarkdownFence | null {
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
  return marker ? { char: marker[0], length: marker.length } : null;
}

function replaceRuntimeMarkersOutsideInlineCode(line: string): string {
  let inlineTicks = 0;
  let output = "";
  for (let index = 0; index < line.length;) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const ticks = end - index;
      if (inlineTicks === 0) inlineTicks = ticks;
      else if (ticks === inlineTicks) inlineTicks = 0;
      output += line.slice(index, end);
      index = end;
      continue;
    }
    if (inlineTicks === 0) {
      const marker = /^<\/?\|?(?:im|lim)_(?:start|end)\|?>/i.exec(
        line.slice(index),
      )?.[0];
      if (marker) {
        output += "\n";
        index += marker.length;
        continue;
      }
    }
    output += line[index];
    index += 1;
  }
  return output;
}

export function cleanAssistantText(value: string, prompt: string): string {
  if (!value.trim()) return "";
  const afterAssistant = value.replace(
    /^(?:[ \t]*\r?\n)*<\|?l?im_start\|?>\s*assistant[ \t]*(?:\r?\n)?/i,
    "",
  );
  const cleanedLines: string[] = [];
  let openFence: MarkdownFence | null = null;
  for (const sourceLine of afterAssistant.split(/\r?\n/)) {
    const fence = markdownFenceAtLineStart(sourceLine);
    if (openFence) {
      cleanedLines.push(sourceLine);
      if (fence?.char === openFence.char && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }
    if (fence) {
      openFence = fence;
      cleanedLines.push(sourceLine);
      continue;
    }

    const displayLines =
      replaceRuntimeMarkersOutsideInlineCode(sourceLine).split("\n");
    for (const line of displayLines) {
      const semanticLine = line.trim();
      if (
        /^(?:user|assistant|system|(?:user\s+)?intent)\s*:?\s*$/i.test(
          semanticLine,
        )
      ) {
        continue;
      }
      cleanedLines.push(line);
    }
  }
  while (cleanedLines[0]?.trim() === "") cleanedLines.shift();
  while (cleanedLines.at(-1)?.trim() === "") cleanedLines.pop();
  const cleaned = cleanedLines.join("\n");
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const normalizedCleaned = cleaned.replace(/\s+/g, " ").trim();
  if (
    normalizedPrompt &&
    (normalizedCleaned === normalizedPrompt ||
      normalizedCleaned === `User intent: ${normalizedPrompt}`)
  ) {
    return "";
  }
  return cleaned;
}

const AssistantResponse = React.memo(function AssistantResponse({
  reduceMotion,
  runId,
  running,
  searchQuery,
  targetText,
}: {
  reduceMotion: boolean;
  runId: string;
  running: boolean;
  searchQuery: string;
  targetText: string;
}) {
  const presentation = useAssistantTypewriterText({
    reduceMotion,
    runId,
    running,
    targetText,
  });
  return (
    <AIChatMarkdownMessage
      className="ai-chat-run-card__response"
      content={presentation.text}
      searchQuery={searchQuery}
      streaming={running || presentation.active}
      typewriterActive={presentation.active}
    />
  );
});

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

function formatModelName(value?: string | null): string {
  const text = `${value ?? ""}`.trim();
  if (!text) return "AI Model";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b(gpt|api|cli|ai|lm|mcp|jsonl|byok)\b/gi, (part) =>
      part.toUpperCase(),
    )
    .replace(/\b([a-z])([a-z0-9.]*)/gi, (part) => {
      if (/^(GPT|API|CLI|AI|LM|MCP|JSONL|BYOK)$/i.test(part)) {
        return part.toUpperCase();
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    });
}

function formatReasoningEffort(value?: string | null): string {
  const text = `${value ?? ""}`.trim();
  if (!text || text === "auto") return "Auto";
  const normalized = text.toLocaleLowerCase().replace(/[_-]+/g, " ");
  switch (normalized) {
    case "xhigh":
    case "extra high":
      return "Extra High";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "low":
      return "Low";
    case "minimal":
      return "Minimal";
    default:
      return normalized.replace(/\b\p{L}/gu, (letter) =>
        letter.toLocaleUpperCase(),
      );
  }
}

function runReasoningEffort(envelope: AIChatRunEnvelope): string {
  const agentRuntime = envelope.agentRuntime;
  return (
    (agentRuntime as { reasoningEffort?: string } | null | undefined)
      ?.reasoningEffort ||
    (envelope as { reasoningEffort?: string }).reasoningEffort ||
    (envelope.egressSummary as { reasoningEffort?: string } | null | undefined)
      ?.reasoningEffort ||
    ""
  );
}

function runModelName(envelope: AIChatRunEnvelope): string {
  const agentRuntime = envelope.agentRuntime as
    | ({ model?: string; modelId?: string } & Record<string, unknown>)
    | null
    | undefined;
  const providerEnvelope = envelope.providerEnvelope;
  const egressSummary = envelope.egressSummary as
    ({ model?: string } & Record<string, unknown>) | null | undefined;
  return (
    envelope.model ||
    providerEnvelope?.model ||
    agentRuntime?.model ||
    agentRuntime?.modelId ||
    egressSummary?.model ||
    ""
  );
}

function assistantModelTitle(envelope: AIChatRunEnvelope): string {
  return `${formatModelName(runModelName(envelope))} ${formatReasoningEffort(
    runReasoningEffort(envelope),
  )}`.trim();
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

type InteractionQuestionOption = {
  id?: string;
  label?: string;
  value?: string;
  description?: string;
};

type InteractionQuestionPayload = {
  questionId?: string;
  prompt?: string;
  options?: InteractionQuestionOption[];
  allowCustomAnswer?: boolean;
  status?: string;
  selectedOptionId?: string;
  selectedValue?: string;
  customAnswer?: string;
};

type PlanGatePayload = {
  state?: string;
  acceptedBuildRunId?: string;
  revisionPlanRunIds?: string[];
  revisionReason?: string;
};

function parseArtifactPayload<T extends object>(
  artifact: AIChatRunArtifact,
  fallback: T,
): T {
  try {
    const parsed = JSON.parse(artifact.payloadJson || "{}");
    if (parsed && typeof parsed === "object") {
      return parsed as T;
    }
  } catch {
    // Malformed artifact payloads should not break transcript rendering.
  }
  return fallback;
}

function isBackgroundLinkedReviewRun(envelope: AIChatRunEnvelope): boolean {
  return (
    envelope.action === "review" &&
    Boolean(envelope.links?.autoReviewForBuildRunId?.trim())
  );
}

function isGitBaselineUnavailableText(value?: string | null): boolean {
  return `${value ?? ""}`.toLocaleLowerCase().includes("not a git repository");
}

function isOptionalGitBaselineFailure(envelope: AIChatRunEnvelope): boolean {
  const agentRuntime = envelope.agentRuntime;
  const parts = [
    envelope.error,
    agentRuntime?.blockedReason,
    agentRuntime?.failureCode,
    agentRuntime?.preflightStatus,
  ];
  return (
    parts.some(isGitBaselineUnavailableText) &&
    parts.some((part) =>
      /baseline|dirty_baseline/i.test(`${part ?? ""}`.trim()),
    )
  );
}

function RunWorkSection({
  title,
  meta,
  icon,
  tone = "default",
  children,
}: {
  title: string;
  meta?: string;
  icon: React.ReactNode;
  tone?: "default" | "success" | "warning" | "active";
  children: React.ReactNode;
}) {
  return (
    <section className="ai-chat-work-section" data-tone={tone}>
      <div className="ai-chat-work-section__head">
        <span className="ai-chat-work-section__title">
          {icon}
          {title}
        </span>
        {meta ? (
          <span className="ai-chat-work-section__meta">{meta}</span>
        ) : null}
      </div>
      <div className="ai-chat-work-section__body">{children}</div>
    </section>
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

function InteractionQuestionCard({
  artifact,
  busy,
  runId,
  onSubmit,
}: {
  artifact: AIChatRunArtifact;
  busy: boolean;
  runId: string;
  onSubmit?: (request: AIQuestionAnswerRequest) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");
  const payload = parseArtifactPayload<InteractionQuestionPayload>(
    artifact,
    {},
  );
  const questionId = payload.questionId || artifact.id;
  const status = payload.status || artifact.status;
  const answered = status === "answered";
  const options = Array.isArray(payload.options)
    ? payload.options.slice(0, 4)
    : [];
  const selectedAnswer =
    payload.customAnswer ||
    payload.selectedValue ||
    options.find((option) => option.id === payload.selectedOptionId)?.label ||
    "";
  const submitCustomAnswer = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const answer = customAnswer.trim();
    if (!answer || busy || answered) return;
    onSubmit?.({ runId, questionId, customAnswer: answer });
  };

  return (
    <div
      className="ai-chat-question-card"
      data-status={status || "pending"}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="ai-chat-question-card__head">
        <strong>{payload.prompt || artifact.summary || "Question"}</strong>
        <span>{answered ? "Answered" : "Input needed"}</span>
      </div>
      {answered ? (
        <div className="ai-chat-question-card__answer">
          {selectedAnswer || "Answered"}
        </div>
      ) : (
        <>
          <div className="ai-chat-question-card__options">
            {options.map((option, index) => {
              const optionId = option.id || `option-${index + 1}`;
              const description = option.description || option.label || "";
              return (
                <button
                  key={optionId}
                  type="button"
                  className="ai-chat-question-card__option"
                  disabled={busy || !onSubmit}
                  title={description}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSubmit?.({ runId, questionId, optionId });
                  }}
                >
                  <span>{option.label || optionId}</span>
                  <span
                    className="ai-chat-question-card__info"
                    title={description}
                  >
                    <Info size={13} />
                  </span>
                </button>
              );
            })}
            {payload.allowCustomAnswer !== false ? (
              <button
                type="button"
                className="ai-chat-question-card__option ai-chat-question-card__option--custom"
                disabled={busy || !onSubmit}
                title="Enter a custom answer"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCustomOpen((open) => !open);
                }}
              >
                <span>Custom answer</span>
                <ChevronRight size={13} />
              </button>
            ) : null}
          </div>
          {customOpen ? (
            <div className="ai-chat-question-card__custom">
              <textarea
                value={customAnswer}
                placeholder="Enter a custom answer"
                onChange={(event) => setCustomAnswer(event.target.value)}
              />
              <button
                type="button"
                disabled={busy || !customAnswer.trim() || !onSubmit}
                onClick={submitCustomAnswer}
              >
                Send
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PlanGateCard({
  artifact,
  busyId,
  planRunId,
  onAcceptPlan,
  onRequestPlanRevision,
}: {
  artifact: AIChatRunArtifact;
  busyId: string | null;
  planRunId: string;
  onAcceptPlan?: (planRunId: string) => void;
  onRequestPlanRevision?: (planRunId: string, reason: string) => void;
}) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const payload = parseArtifactPayload<PlanGatePayload>(artifact, {});
  const state = payload.state || artifact.status || "pending";
  const pending = state === "pending";
  const accepting = busyId === `plan:${planRunId}:accept`;
  const revising = busyId === `plan:${planRunId}:revision`;

  return (
    <div
      className="ai-chat-plan-gate"
      data-state={state}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="ai-chat-plan-gate__head">
        <strong>Plan decision</strong>
        <span>{state.replace(/_/g, " ")}</span>
      </div>
      {pending ? (
        <>
          <div className="ai-chat-plan-gate__actions">
            <button
              type="button"
              disabled={accepting || revising || !onAcceptPlan}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAcceptPlan?.(planRunId);
              }}
            >
              <CheckCircle2 size={14} />
              Do the plan
            </button>
            <button
              type="button"
              disabled={accepting || revising || !onRequestPlanRevision}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRevisionOpen((open) => !open);
              }}
            >
              <ChevronRight size={14} />
              No, change it
            </button>
          </div>
          {revisionOpen ? (
            <div className="ai-chat-plan-gate__revision">
              <textarea
                value={revisionReason}
                placeholder="What should change in the plan?"
                onChange={(event) => setRevisionReason(event.target.value)}
              />
              <button
                type="button"
                disabled={accepting || revising || !onRequestPlanRevision}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onRequestPlanRevision?.(planRunId, revisionReason.trim());
                }}
              >
                Propose a new plan
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="ai-chat-plan-gate__summary">
          {state === "accepted" && payload.acceptedBuildRunId
            ? `Build run started: ${payload.acceptedBuildRunId.slice(0, 8)}`
            : state === "revision_requested"
              ? "Plan revision requested."
              : artifact.summary || state}
        </div>
      )}
    </div>
  );
}

export function RunCard({
  envelope,
  run,
  active,
  compact,
  streamingText,
  hydrationStatus = "idle",
  artifacts = [],
  artifactBusyId = null,
  onSelect,
  onApplyPatchArtifact,
  onApproveMnemonicArtifact,
  onRollbackPatchArtifact,
  onSubmitQuestionAnswer,
  onAcceptPlan,
  onRequestPlanRevision,
  onOpenReview,
  onPreviewToolProposal,
  onDenyToolProposal,
  onApproveToolProposal,
  searchQuery = "",
}: RunCardProps) {
  const reduceMotion = useReducedMotion();
  const [copiedMessage, setCopiedMessage] = useState<
    "prompt" | "response" | null
  >(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const running = envelope.status === "running" || envelope.status === "queued";
  const action = envelope.action as AIChatAction;
  const meta = getActionMeta(action);
  const backgroundLinkedReview = isBackgroundLinkedReviewRun(envelope);
  const prompt = backgroundLinkedReview ? "" : run?.userPrompt || "";
  const displayPrompt = compactText(prompt, compact ? 180 : 360);
  const assistantTime = formatRunTime(
    run?.updatedAt || envelope.updatedAt || envelope.createdAt,
  );
  const assistantTitle = backgroundLinkedReview
    ? "Background review"
    : assistantModelTitle(envelope);
  const responseSource = mostCompleteRunText(
    run?.response || "",
    streamingText,
    running,
  );
  const response = React.useMemo(
    () => cleanAssistantText(responseSource || "", prompt),
    [prompt, responseSource],
  );
  const terminalEnvelopeOnly =
    !run &&
    !running &&
    ["completed", "error", "canceled", "blocked"].includes(envelope.status);
  const responsePlaceholder = terminalEnvelopeOnly
    ? hydrationStatus === "loading"
      ? "Loading saved message..."
      : hydrationStatus === "failed"
        ? "Saved message unavailable."
        : ""
    : run && !running && !response
      ? "No assistant text recorded."
      : "";
  const contextItems = contextItemsForRun(envelope, run);
  const proposals = run?.toolProposals ?? envelope.toolProposals ?? [];
  const patchArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactPatchPreview,
  );
  const memoryArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactMemory,
  );
  const questionArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind ===
      AIChatRunArtifactKind.AIChatRunArtifactInteractionQuestion,
  );
  const planGateArtifact =
    artifacts.find(
      (artifact) =>
        artifact.kind ===
        AIChatRunArtifactKind.AIChatRunArtifactWorkflowPlanGate,
    ) ?? null;
  const questionBusy = Boolean(
    artifactBusyId && artifactBusyId.startsWith(`question:${envelope.id}:`),
  );
  const timelineEvents = envelope.timeline ?? [];
  const commentary = React.useMemo(
    () => projectAssistantCommentary(timelineEvents, running ? "" : response),
    [response, running, timelineEvents],
  );
  const runtimeNotice = envelope.runNotice;
  const toolReviewDisabledReason = reviewDisabledReason(envelope, run);
  const mentionItems = contextItems.filter((item) => item.source === "mention");
  const optionalGitBaselineError = isOptionalGitBaselineFailure(envelope);
  const hasAssistantBody = Boolean(
    response ||
    responsePlaceholder ||
    questionArtifacts.length > 0 ||
    planGateArtifact ||
    proposals.length > 0 ||
    patchArtifacts.length > 0 ||
    memoryArtifacts.length > 0 ||
    (envelope.error && !optionalGitBaselineError),
  );
  const hasRunDetails =
    Boolean(envelope.agentRuntime) ||
    timelineEvents.length > 0 ||
    running ||
    Boolean(runtimeNotice);
  const runDetailsActionClass = [
    "ai-chat-message-action",
    detailsOpen ? "is-active" : "",
    runtimeNotice?.severity === "error"
      ? "ai-chat-message-action--error"
      : runtimeNotice
        ? "ai-chat-message-action--attention"
        : "",
  ]
    .filter(Boolean)
    .join(" ");
  const runDetailsTitle = detailsOpen
    ? "Hide Agent Runtime"
    : "Show Agent Runtime";
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(envelope.id);
    }
  };
  const copyMessage = async (kind: "prompt" | "response", value: string) => {
    if (!value.trim()) return;
    await copyText(value);
    setCopiedMessage(kind);
    window.setTimeout(() => {
      setCopiedMessage((current) => (current === kind ? null : current));
    }, 1200);
  };
  const handleCopy = (
    event: React.MouseEvent<HTMLButtonElement>,
    kind: "prompt" | "response",
    value: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    void copyMessage(kind, value);
  };
  const selectRun = () => {
    onSelect(envelope.id);
  };
  const openRunReview = () => {
    selectRun();
    onOpenReview?.();
  };
  const toggleDetails = () => {
    selectRun();
    setDetailsOpen((open) => !open);
  };
  const handleToggleDetails = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleDetails();
  };
  const sessionId = (run?.sessionId || envelope.sessionId || "").trim();
  const canOpenReview = Boolean(
    onOpenReview && (proposals.length > 0 || patchArtifacts.length > 0),
  );
  const copyRunId = () => {
    void copyText(envelope.id);
  };
  const copySessionId = () => {
    if (sessionId) void copyText(sessionId);
  };
  const userMessageContextItems: ContextActionMenuItem[] = [
    {
      key: "copy-user-message",
      label: "Copy User Message",
      icon: <MessageSquareText size={13} />,
      onSelect: () => {
        void copyMessage("prompt", prompt);
      },
    },
    {
      key: "select-run",
      label: active ? "Current Run" : "Select Run",
      icon: <CheckCircle2 size={13} />,
      disabled: active,
      onSelect: selectRun,
    },
    { separator: true },
    {
      key: "copy-run-id",
      label: "Copy Run ID",
      icon: <Copy size={13} />,
      onSelect: copyRunId,
    },
    {
      key: "copy-session-id",
      label: "Copy Session ID",
      icon: <Copy size={13} />,
      hidden: !sessionId,
      onSelect: copySessionId,
    },
  ];
  const assistantMessageContextItems: ContextActionMenuItem[] = [
    {
      key: "copy-assistant-message",
      label: "Copy Assistant Message",
      icon: <Sparkles size={13} />,
      hidden: !response,
      onSelect: () => {
        void copyMessage("response", response);
      },
    },
    {
      key: "copy-run-error",
      label: "Copy Error",
      icon: <AlertTriangle size={13} />,
      hidden: !envelope.error,
      onSelect: () => {
        if (envelope.error) void copyText(envelope.error);
      },
    },
    { separator: true },
    {
      key: "toggle-details",
      label: detailsOpen ? "Hide Agent Runtime" : "Show Agent Runtime",
      icon: <Info size={13} />,
      hidden: !hasRunDetails,
      onSelect: toggleDetails,
    },
    {
      key: "open-review",
      label: "Open Review",
      icon: <FileText size={13} />,
      hidden: !canOpenReview,
      onSelect: openRunReview,
    },
    { separator: true },
    {
      key: "select-run",
      label: active ? "Current Run" : "Select Run",
      icon: <CheckCircle2 size={13} />,
      disabled: active,
      onSelect: selectRun,
    },
    {
      key: "copy-run-id",
      label: "Copy Run ID",
      icon: <Copy size={13} />,
      onSelect: copyRunId,
    },
    {
      key: "copy-session-id",
      label: "Copy Session ID",
      icon: <Copy size={13} />,
      hidden: !sessionId,
      onSelect: copySessionId,
    },
  ];
  const runContextItems: ContextActionMenuItem[] = [
    {
      key: "select-run",
      label: active ? "Current Run" : "Select Run",
      icon: <CheckCircle2 size={13} />,
      disabled: active,
      onSelect: selectRun,
    },
    { separator: true },
    {
      key: "copy-user-message",
      label: "Copy User Message",
      icon: <MessageSquareText size={13} />,
      hidden: !prompt,
      onSelect: () => {
        void copyMessage("prompt", prompt);
      },
    },
    {
      key: "copy-assistant-message",
      label: "Copy Assistant Message",
      icon: <Sparkles size={13} />,
      hidden: !response,
      onSelect: () => {
        void copyMessage("response", response);
      },
    },
    {
      key: "copy-run-error",
      label: "Copy Error",
      icon: <AlertTriangle size={13} />,
      hidden: !envelope.error,
      onSelect: () => {
        if (envelope.error) void copyText(envelope.error);
      },
    },
    { separator: true },
    {
      key: "toggle-details",
      label: detailsOpen ? "Hide Agent Runtime" : "Show Agent Runtime",
      icon: <Info size={13} />,
      hidden: !hasRunDetails,
      onSelect: toggleDetails,
    },
    {
      key: "open-review",
      label: "Open Review",
      icon: <FileText size={13} />,
      hidden: !canOpenReview,
      onSelect: openRunReview,
    },
    { separator: true },
    {
      key: "copy-run-id",
      label: "Copy Run ID",
      icon: <Copy size={13} />,
      onSelect: copyRunId,
    },
    {
      key: "copy-session-id",
      label: "Copy Session ID",
      icon: <Copy size={13} />,
      hidden: !sessionId,
      onSelect: copySessionId,
    },
  ];
  return (
    <ContextActionMenu
      ignoredTargetSelector=".ai-chat-message-bubble, .ai-chat-message-action, .ai-chat-code-block, .ai-chat-markdown__inline-code, button, input, textarea, a"
      items={runContextItems}
      nativeScope="ai-chat-run"
      nativeTargetId={envelope.id}
    >
      <m.article
        className={`ai-chat-run-card ai-chat-tone-${meta.tone}${active ? " is-active" : ""}`}
        aria-pressed={active}
        data-ai-chat-run-id={envelope.id}
        data-status={envelope.status}
        data-compact={compact ? "true" : "false"}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
        transition={{
          layout: { duration: reduceMotion ? 0.1 : 0.2 },
          duration: reduceMotion ? 0.1 : 0.18,
          ease: [0.22, 1, 0.36, 1],
        }}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(envelope.id)}
        onKeyDown={handleKeyDown}
      >
        {prompt ? (
          <div className="ai-chat-message-group ai-chat-message-group--user">
            <div className="ai-chat-message-content">
              <ContextActionMenu
                items={userMessageContextItems}
                nativeScope="ai-chat-message"
                nativeSurfaceId={envelope.id}
                nativeTargetId={`${envelope.id}:prompt`}
              >
                <div className="ai-chat-message-bubble ai-chat-message-bubble--user">
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
              </ContextActionMenu>
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
          </div>
        ) : null}
        <div className="ai-chat-message-group ai-chat-message-group--assistant">
          <span className="ai-chat-message-avatar ai-chat-message-avatar--assistant">
            <Sparkles size={15} />
          </span>
          <div className="ai-chat-message-content">
            <div className="ai-chat-message-meta ai-chat-message-meta--assistant">
              <strong>{assistantTitle}</strong>
              {assistantTime ? (
                <time
                  dateTime={
                    run?.updatedAt || envelope.updatedAt || envelope.createdAt
                  }
                >
                  {assistantTime}
                </time>
              ) : null}
            </div>
            {commentary.length > 0 ? (
              <div
                className="ai-chat-commentary-stack"
                aria-label="Agent progress updates"
                aria-live={active ? "polite" : undefined}
              >
                {commentary.map((item) => (
                  <m.div
                    className="ai-chat-commentary-message"
                    data-kind={item.kind}
                    key={item.id}
                    initial={
                      reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }
                    }
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduceMotion ? 0.08 : 0.18 }}
                  >
                    <span
                      className="ai-chat-commentary-message__marker"
                      aria-hidden="true"
                    />
                    <AIChatMarkdownMessage
                      className="ai-chat-commentary-message__content"
                      content={item.content}
                      searchQuery={searchQuery}
                    />
                  </m.div>
                ))}
              </div>
            ) : null}
            {hasAssistantBody ? (
              <ContextActionMenu
                ignoredTargetSelector=".ai-chat-code-block, .ai-chat-markdown__inline-code, button, input, textarea, a"
                items={assistantMessageContextItems}
                nativeScope="ai-chat-message"
                nativeSurfaceId={envelope.id}
                nativeTargetId={`${envelope.id}:response`}
              >
                <div className="ai-chat-message-bubble ai-chat-message-bubble--assistant">
                  {response ? (
                    <AssistantResponse
                      reduceMotion={Boolean(reduceMotion)}
                      runId={envelope.id}
                      running={running}
                      searchQuery={searchQuery}
                      targetText={response}
                    />
                  ) : responsePlaceholder ? (
                    <div className="ai-chat-run-card__response ai-chat-run-card__response--muted">
                      {responsePlaceholder}
                    </div>
                  ) : null}

                  {questionArtifacts.length > 0 ? (
                    <div className="ai-chat-question-stack">
                      {questionArtifacts.map((artifact) => (
                        <InteractionQuestionCard
                          artifact={artifact}
                          busy={questionBusy}
                          key={artifact.id}
                          runId={envelope.id}
                          onSubmit={onSubmitQuestionAnswer}
                        />
                      ))}
                    </div>
                  ) : null}

                  {planGateArtifact ? (
                    <PlanGateCard
                      artifact={planGateArtifact}
                      busyId={artifactBusyId}
                      planRunId={envelope.id}
                      onAcceptPlan={onAcceptPlan}
                      onRequestPlanRevision={onRequestPlanRevision}
                    />
                  ) : null}

                  {proposals.length > 0 ? (
                    <RunWorkSection
                      icon={<Wrench size={14} />}
                      meta={`${proposals.length} proposal${proposals.length === 1 ? "" : "s"}`}
                      title="Approval"
                      tone="warning"
                    >
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
                            busy={
                              artifactBusyId === (proposal.id || proposal.name)
                            }
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
                    </RunWorkSection>
                  ) : null}

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

                  {envelope.error && !optionalGitBaselineError ? (
                    <div
                      className="ai-chat-run-card__error"
                      title={envelope.error}
                    >
                      {friendlyRunError(envelope.error)}
                    </div>
                  ) : null}
                </div>
              </ContextActionMenu>
            ) : null}
            {response || hasRunDetails ? (
              <div className="ai-chat-message-actions ai-chat-message-actions--assistant">
                {response ? (
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
                ) : null}
                {hasRunDetails ? (
                  <button
                    aria-expanded={detailsOpen}
                    aria-label={runDetailsTitle}
                    className={runDetailsActionClass}
                    title={runDetailsTitle}
                    type="button"
                    onClick={handleToggleDetails}
                  >
                    <Info size={14} />
                  </button>
                ) : null}
              </div>
            ) : null}
            <AnimatePresence initial={false}>
              {detailsOpen && hasRunDetails ? (
                <m.div
                  className="ai-chat-agent-inspector"
                  initial={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }
                  }
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{
                    duration: reduceMotion ? 0.1 : 0.18,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <AgentRunProgress announce={active} envelope={envelope} />
                  {runtimeNotice ? (
                    <div
                      className="ai-chat-agent-inspector__notice"
                      data-severity={runtimeNotice.severity}
                    >
                      <AlertTriangle aria-hidden="true" size={14} />
                      <span>
                        <strong>
                          {runtimeNotice.message || runtimeNotice.title}
                        </strong>
                        {runtimeNotice.details ? (
                          <small>{runtimeNotice.details}</small>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </m.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </m.article>
    </ContextActionMenu>
  );
}
