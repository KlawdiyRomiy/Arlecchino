import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
  timelineEventActivityLabel,
} from "./aiChatPresentation";
import { AIChatMarkdownMessage } from "./AIChatMarkdownMessage";
import { PatchArtifactCard } from "./PatchArtifactCard";
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

function typewriterStepSize(remaining: number): number {
  if (remaining > 1600) return 160;
  if (remaining > 640) return 80;
  if (remaining > 240) return 32;
  if (remaining > 80) return 10;
  return 2;
}

function typewriterDelayMs(displayedText: string): number {
  const last = displayedText.charAt(displayedText.length - 1);
  if (last === "\n") return 34;
  if (/[.!?;:]$/.test(last)) return 46;
  return 18;
}

function nextTypewriterLength(
  displayedText: string,
  targetText: string,
): number {
  const nextLength = Math.min(
    targetText.length,
    displayedText.length +
      typewriterStepSize(targetText.length - displayedText.length),
  );
  const partialFence = /(^|\n)( {0,3})(`{1,2}|~{1,2})$/.exec(
    targetText.slice(0, nextLength),
  );
  if (!partialFence) return nextLength;
  return Math.min(targetText.length, nextLength + 3 - partialFence[3].length);
}

function initialTypewriterLength(targetText: string): number {
  return nextTypewriterLength("", targetText);
}

function useAssistantTypewriterText({
  enabled,
  reduceMotion,
  runId,
  targetText,
}: {
  enabled: boolean;
  reduceMotion: boolean;
  runId: string;
  targetText: string;
}): string {
  const animate = enabled && !reduceMotion && targetText.length > 0;
  const [displayedText, setDisplayedText] = useState(() =>
    animate
      ? targetText.slice(0, initialTypewriterLength(targetText))
      : targetText,
  );
  const displayedTextRef = React.useRef(displayedText);
  const runIdRef = React.useRef(runId);

  useEffect(() => {
    displayedTextRef.current = displayedText;
  }, [displayedText]);

  useEffect(() => {
    if (runIdRef.current === runId) return;
    runIdRef.current = runId;
    const nextText = animate
      ? targetText.slice(0, initialTypewriterLength(targetText))
      : targetText;
    displayedTextRef.current = nextText;
    setDisplayedText(nextText);
  }, [animate, runId, targetText]);

  useEffect(() => {
    if (!animate) {
      if (displayedTextRef.current !== targetText) {
        displayedTextRef.current = targetText;
        setDisplayedText(targetText);
      }
      return undefined;
    }

    const currentText = displayedTextRef.current;
    if (currentText === targetText) return undefined;
    if (!targetText.startsWith(currentText)) {
      displayedTextRef.current = targetText;
      setDisplayedText(targetText);
      return undefined;
    }

    const nextLength = nextTypewriterLength(currentText, targetText);
    const nextText = targetText.slice(0, nextLength);
    const timer = window.setTimeout(() => {
      displayedTextRef.current = nextText;
      setDisplayedText(nextText);
    }, typewriterDelayMs(currentText));

    return () => {
      window.clearTimeout(timer);
    };
  }, [animate, displayedText, targetText]);

  return displayedText;
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
    | ({ model?: string } & Record<string, unknown>)
    | null
    | undefined;
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

function runtimeFamilyLabel(value?: string): string {
  switch (value) {
    case "structured_agent_runtime":
      return "Structured agent";
    case "jsonl_exec_runtime":
      return "JSONL exec";
    case "model_agent_runtime":
      return "Model runtime";
    case "interactive_fallback_runtime":
    case "external_agent_cli":
      return "Interactive fallback";
    default:
      return value || "Runtime";
  }
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

function runtimeProofState(
  envelope: AIChatRunEnvelope,
  artifacts: AIChatRunArtifact[],
): { state: "ok" | "active" | "blocked"; label: string } {
  const agentRuntime = envelope.agentRuntime;
  const buildMode = envelope.action === "build";
  const patchArtifact = artifacts.find(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactPatchPreview,
  );
  const terminalArtifact = artifacts.find(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactTerminal ||
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactAgentTerminal,
  );
  const worktreeEvidenceArtifact = artifacts.find(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactAgentWorktree,
  );
  const typedBuildEvidence =
    agentRuntime?.proofState === "proved" &&
    isTypedBuildEvidenceArtifactState(agentRuntime.artifactState);
  if (isOptionalGitBaselineFailure(envelope)) {
    return {
      state: "ok",
      label: "Worktree proof unavailable",
    };
  }
  if (agentRuntime?.blockedReason || envelope.status === "error") {
    return {
      state: "blocked",
      label: agentRuntime?.blockedReason || envelope.error || "blocked",
    };
  }
  if (patchArtifact) {
    return {
      state: "ok",
      label: `Patch artifact ${patchArtifact.status || "recorded"}`,
    };
  }
  if (agentRuntime?.capturedDiffId) {
    return { state: "ok", label: "Captured diff artifact" };
  }
  if (terminalArtifact && !buildMode) {
    return {
      state: "ok",
      label: `Runtime evidence ${terminalArtifact.status || "recorded"}`,
    };
  }
  if (worktreeEvidenceArtifact && !buildMode) {
    return {
      state: "ok",
      label: `Worktree evidence ${
        worktreeEvidenceArtifact.status || "recorded"
      }`,
    };
  }
  if (typedBuildEvidence) {
    return {
      state: "ok",
      label: agentRuntime?.artifactState || "typed build evidence",
    };
  }
  if (envelope.status === "running" || envelope.status === "queued") {
    return { state: "active", label: "Waiting for proof" };
  }
  if (buildMode) {
    return { state: "blocked", label: "Build proof missing" };
  }
  return { state: "ok", label: "No artifact required" };
}

function isTypedBuildEvidenceArtifactState(value?: string | null): boolean {
  switch (`${value ?? ""}`.trim()) {
    case "explicit_no_change":
    case "diagnostic_evidence":
    case "test_evidence":
      return true;
    default:
      return false;
  }
}

function compactRuntimeValue(value?: string | number | null): string {
  const text = `${value ?? ""}`.trim();
  return text || "n/a";
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

function RuntimeTruthCard({
  envelope,
  artifacts,
}: {
  envelope: AIChatRunEnvelope;
  artifacts: AIChatRunArtifact[];
}) {
  const agentRuntime = envelope.agentRuntime;
  const providerEnvelope = envelope.providerEnvelope;
  const runtimeReasoningEffort =
    (agentRuntime as { reasoningEffort?: string } | null | undefined)
      ?.reasoningEffort ||
    (envelope as { reasoningEffort?: string }).reasoningEffort ||
    (envelope.egressSummary as { reasoningEffort?: string } | null | undefined)
      ?.reasoningEffort;
  const runtimeFamily =
    agentRuntime?.runtimeFamily ||
    envelope.runtimeFamily ||
    providerEnvelope?.runtimeFamily ||
    "";
  const transport =
    agentRuntime?.transport || providerEnvelope?.transport || "";
  const provider =
    envelope.providerId ||
    providerEnvelope?.providerId ||
    agentRuntime?.runtimeId;
  const model = envelope.model || providerEnvelope?.model;
  const proof = runtimeProofState(envelope, artifacts);
  const consent = providerEnvelope?.externalAccount
    ? envelope.consentSummary?.externalAgentCliAccepted
      ? "agent consent accepted"
      : "agent consent pending"
    : envelope.consentSummary?.localProvidersAccepted
      ? "local consent accepted"
      : "local consent pending";
  const proposalTotal = envelope.toolProposalSummary?.total ?? 0;
  const toolPolicy =
    proposalTotal > 0
      ? `${proposalTotal} proposal${proposalTotal === 1 ? "" : "s"}`
      : agentRuntime?.toolPolicy ||
        envelope.approvalSummary?.mode ||
        "ask_each_time";
  const proofValue =
    proof.state === "blocked"
      ? proof.label
      : agentRuntime?.proofState || proof.label;
  const rows = [
    ["Runtime", runtimeFamilyLabel(runtimeFamily)],
    ["Transport", compactRuntimeValue(transport)],
    ["Provider", compactRuntimeValue(provider)],
    ["Model", compactRuntimeValue(model)],
    ["Reasoning", compactRuntimeValue(runtimeReasoningEffort || "auto")],
    ["Status", compactRuntimeValue(agentRuntime?.status || envelope.status)],
    ["Health", compactRuntimeValue(agentRuntime?.healthStatus)],
    ["Consent", consent],
    ["Tools", toolPolicy],
    ["Sandbox", compactRuntimeValue(agentRuntime?.sandboxPolicy)],
    ["Adapter", compactRuntimeValue(agentRuntime?.adapterVersion)],
    ["Protocol", compactRuntimeValue(agentRuntime?.protocolVersion)],
    ["Fallback", agentRuntime?.fallbackRuntime ? "yes" : "no"],
    ["Proof", compactRuntimeValue(proofValue)],
    [
      "Artifact",
      compactRuntimeValue(agentRuntime?.artifactState || proof.label),
    ],
  ];
  if (agentRuntime?.failureCode) {
    rows.push(["Failure", compactRuntimeValue(agentRuntime.failureCode)]);
  }
  const primaryRows = [
    ["Provider", compactRuntimeValue(provider)],
    ["Model", compactRuntimeValue(model)],
    ["Reasoning", compactRuntimeValue(runtimeReasoningEffort || "auto")],
    ["Consent", consent],
    ["Tools", toolPolicy],
    ["Proof", compactRuntimeValue(proofValue)],
    [
      "Artifact",
      compactRuntimeValue(agentRuntime?.artifactState || proof.label),
    ],
  ];
  const diagnosticTitle = rows
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
  const icon =
    proof.state === "blocked" ? (
      <AlertTriangle size={14} />
    ) : proof.state === "active" ? (
      <Wrench size={14} />
    ) : (
      <ShieldCheck size={14} />
    );
  return (
    <RunWorkSection
      icon={icon}
      meta={runtimeFamilyLabel(runtimeFamily)}
      title="Verification"
      tone={
        proof.state === "blocked"
          ? "warning"
          : proof.state === "active"
            ? "active"
            : "success"
      }
    >
      <div
        className="ai-chat-runtime-proof"
        data-state={proof.state}
        title={diagnosticTitle}
      >
        <div className="ai-chat-runtime-proof__pills">
          {primaryRows.map(([label, value]) => (
            <span className="ai-chat-runtime-proof__pill" key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </span>
          ))}
        </div>
      </div>
    </RunWorkSection>
  );
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
    <RunWorkSection
      icon={<Wrench size={14} />}
      meta={`${artifacts.length} event${artifacts.length === 1 ? "" : "s"}`}
      title="Tool activity"
    >
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
    </RunWorkSection>
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
          <span>
            {timelineEventActivityLabel(event) ||
              event.type?.replace(/_/g, " ") ||
              "event"}
          </span>
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
  const backgroundLinkedReview = isBackgroundLinkedReviewRun(envelope);
  const prompt = backgroundLinkedReview ? "" : run?.userPrompt || "";
  const displayPrompt = compactText(prompt, compact ? 180 : 360);
  const createdTime = formatRunTime(envelope.createdAt);
  const assistantTime = formatRunTime(
    run?.updatedAt || envelope.updatedAt || envelope.createdAt,
  );
  const assistantTitle = backgroundLinkedReview
    ? "Background review"
    : assistantModelTitle(envelope);
  const responseSource =
    running && streamingText ? streamingText : run?.response || streamingText;
  const response = cleanAssistantText(responseSource || "", prompt);
  const terminalEnvelopeOnly =
    !run &&
    !running &&
    ["completed", "error", "canceled", "blocked"].includes(envelope.status);
  const responsePlaceholder = terminalEnvelopeOnly
    ? hydrationStatus === "failed"
      ? "Saved message unavailable."
      : "Loading saved message..."
    : run && !running && !response
      ? "No assistant text recorded."
      : "";
  const displayedResponse = useAssistantTypewriterText({
    enabled: running && Boolean(response),
    reduceMotion: Boolean(reduceMotion),
    runId: envelope.id,
    targetText: response,
  });
  const typewriterActive =
    running && !reduceMotion && displayedResponse.length < response.length;
  const contextItems = contextItemsForRun(envelope, run);
  const runElapsedMs = elapsedMs(envelope, run, now);
  const proposals = run?.toolProposals ?? envelope.toolProposals ?? [];
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
  const runtimeNotice = envelope.runNotice;
  const activityLabel = runActivityLabel({
    status: envelope.status,
    activeText: response,
    contextItems,
    elapsedMs: runElapsedMs,
    timelineEvents,
    artifacts,
    toolProposalCount: proposals.length,
    artifactBusyId,
  });
  const toolReviewDisabledReason = reviewDisabledReason(envelope, run);
  const mentionItems = contextItems.filter((item) => item.source === "mention");
  const proof = runtimeProofState(envelope, artifacts);
  const optionalGitBaselineError = isOptionalGitBaselineFailure(envelope);
  const hasRunDetails =
    Boolean(envelope.agentRuntime) ||
    toolLifecycleArtifacts.length > 0 ||
    timelineEvents.length > 0 ||
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
  const runDetailsTitle = runtimeNotice
    ? `${runtimeNotice.title} details`
    : "Run details";
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
      label: detailsOpen ? "Hide Run Details" : "Show Run Details",
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
      label: detailsOpen ? "Hide Run Details" : "Show Run Details",
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
        layout
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
            <span className="ai-chat-message-avatar ai-chat-message-avatar--user">
              Y
            </span>
            <div className="ai-chat-message-content">
              <ContextActionMenu
                items={userMessageContextItems}
                nativeScope="ai-chat-message"
                nativeSurfaceId={envelope.id}
                nativeTargetId={`${envelope.id}:prompt`}
              >
                <div className="ai-chat-message-bubble ai-chat-message-bubble--user">
                  <div className="ai-chat-message-meta ai-chat-message-meta--user">
                    <strong>You</strong>
                    {createdTime ? (
                      <time dateTime={envelope.createdAt}>{createdTime}</time>
                    ) : null}
                    <span
                      className="ai-chat-run-card__mode-icon"
                      role="img"
                      aria-label={`${meta.label} mode`}
                      title={`${meta.label} mode`}
                    >
                      {meta.icon}
                    </span>
                  </div>
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
            <ContextActionMenu
              ignoredTargetSelector=".ai-chat-code-block, .ai-chat-markdown__inline-code, button, input, textarea, a"
              items={assistantMessageContextItems}
              nativeScope="ai-chat-message"
              nativeSurfaceId={envelope.id}
              nativeTargetId={`${envelope.id}:response`}
            >
              <div className="ai-chat-message-bubble ai-chat-message-bubble--assistant">
                {response ? (
                  <AIChatMarkdownMessage
                    className="ai-chat-run-card__response"
                    content={displayedResponse}
                    searchQuery={searchQuery}
                    streaming={running}
                    typewriterActive={typewriterActive}
                  />
                ) : running ? (
                  <div className="ai-chat-run-card__response ai-chat-run-card__response--muted">
                    {activityLabel}&hellip;
                  </div>
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

                <AnimatePresence initial={false}>
                  {detailsOpen && hasRunDetails ? (
                    <m.div
                      className="ai-chat-run-details"
                      layout
                      initial={
                        reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, height: 0 }
                      }
                      animate={
                        reduceMotion
                          ? { opacity: 1 }
                          : { opacity: 1, height: "auto" }
                      }
                      exit={
                        reduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, height: 0 }
                      }
                      transition={{
                        duration: reduceMotion ? 0.1 : 0.18,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {runtimeNotice?.details ? (
                        <div className="ai-chat-run-details__notice">
                          <strong>
                            {runtimeNotice.message || runtimeNotice.title}
                          </strong>
                          <span>{runtimeNotice.details}</span>
                        </div>
                      ) : null}
                      <ToolLifecycleArtifacts
                        artifacts={toolLifecycleArtifacts}
                      />
                      <RuntimeTruthCard
                        envelope={envelope}
                        artifacts={artifacts}
                      />
                      <RunTimeline events={timelineEvents} />
                    </m.div>
                  ) : null}
                </AnimatePresence>

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
                  <RunWorkSection
                    icon={<FileText size={14} />}
                    meta={`${patchArtifacts.length} artifact${patchArtifacts.length === 1 ? "" : "s"}`}
                    title="Patch"
                    tone="warning"
                  >
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
                  </RunWorkSection>
                ) : null}

                {memoryArtifacts.length > 0 ? (
                  <MemoryCitations
                    artifacts={memoryArtifacts}
                    artifactBusyId={artifactBusyId}
                    onApproveMnemonicArtifact={onApproveMnemonicArtifact}
                  />
                ) : null}

                {envelope.error &&
                !runtimeNotice &&
                !optionalGitBaselineError ? (
                  <div
                    className="ai-chat-run-card__error"
                    title={envelope.error}
                  >
                    {friendlyRunError(envelope.error)}
                  </div>
                ) : null}
              </div>
            </ContextActionMenu>
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
          </div>
        </div>
      </m.article>
    </ContextActionMenu>
  );
}
