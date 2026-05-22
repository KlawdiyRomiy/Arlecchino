import React from "react";
import {
  AlertCircle,
  Bot,
  Boxes,
  CheckCircle2,
  Circle,
  FileText,
  Gauge,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import type {
  AIApprovalPolicy,
  AIChatAction,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIConsentPolicy,
  AIContextSummary,
  AIContextSnapshot,
  AIEmbeddingStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import { getProviderPresentation } from "./providerPresentation";
import {
  compactText,
  getActionMeta,
  memoryArtifactActivityLabel,
  runActivityLabel,
} from "./aiChatPresentation";

export type ActivityStatusState = "done" | "active" | "idle" | "error";

export interface ActivityStatusItem {
  key: string;
  state: ActivityStatusState;
  label: string;
}

export interface ActivityStatusData {
  selectedProvider: AIProviderDescriptor | null;
  selectedProviderReady: boolean;
  contextPreview: AIContextSnapshot | null;
  activeEnvelope: AIChatRunEnvelope | null;
  artifacts: AIChatRunArtifact[];
  activeRun: AIChatRun | null;
  activeRunText: string;
  approvalPolicy: AIApprovalPolicy | null;
  consentPolicy: AIConsentPolicy | null;
  embeddingStatus: AIEmbeddingStatus | null;
  workflowCount: number;
  artifactBusyId?: string | null;
  mnemonicBusy?: boolean;
}

interface ActivityTimelineProps extends ActivityStatusData {
  visible: boolean;
}

interface RuntimeEgressMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedTokens?: boolean;
  tokenSource?: string;
  costMicros?: number;
  costCurrency?: string;
  costEstimated?: boolean;
  costSource?: string;
  toolProfile?: string;
  toolSchemaCount?: number;
  toolSupportKind?: string;
}

const formatTokenUsage = (metrics: RuntimeEgressMetrics | null): string => {
  if (!metrics?.totalTokens) return "n/a";
  const prefix = metrics.estimatedTokens ? "~" : "";
  return `${prefix}${metrics.totalTokens.toLocaleString()} tokens`;
};

const formatToolProfile = (metrics: RuntimeEgressMetrics | null): string => {
  if (!metrics?.toolProfile || metrics.toolProfile === "none") return "n/a";
  const count =
    typeof metrics.toolSchemaCount === "number"
      ? ` · ${metrics.toolSchemaCount} tools`
      : "";
  return `${metrics.toolProfile.replace(/_/g, " ")}${count}`;
};

const formatCost = (metrics: RuntimeEgressMetrics | null): string => {
  if (!metrics) return "n/a";
  if (metrics.costSource === "local_provider") return "local";
  if (!metrics.costMicros) return metrics.costSource ? "unpriced" : "n/a";
  const currency = metrics.costCurrency || "USD";
  const prefix = metrics.costEstimated ? "~" : "";
  return `${prefix}${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 4,
  }).format(metrics.costMicros / 1_000_000)}`;
};

export function ActivityIcon({ state }: { state: ActivityStatusState }) {
  if (state === "error") return <AlertCircle size={15} />;
  if (state === "done") return <CheckCircle2 size={15} />;
  if (state === "active") return <Loader2 size={15} className="spin" />;
  return <Circle size={15} />;
}

export function buildActivityStatusItems({
  selectedProvider,
  selectedProviderReady,
  contextPreview,
  activeEnvelope,
  artifacts,
  activeRun,
  activeRunText,
  approvalPolicy,
  consentPolicy,
  embeddingStatus,
  workflowCount,
  artifactBusyId = null,
  mnemonicBusy = false,
}: ActivityStatusData): ActivityStatusItem[] {
  const provider = getProviderPresentation(selectedProvider);
  const runState = activeEnvelope?.status ?? "";
  const completed = runState === "completed";
  const failed = runState === "error" || runState === "canceled";
  const items: ActivityStatusItem[] = [];
  if (!selectedProviderReady) {
    items.push({ key: "provider", state: "idle", label: provider.subtitle });
  }
  if (activeEnvelope) {
    items.push({
      key: "run",
      state: failed
        ? "error"
        : runState === "running"
          ? "active"
          : completed
            ? "done"
            : "idle",
      label: runActivityLabel({
        status: activeEnvelope.status,
        activeText: activeRunText || activeRun?.response || "",
        contextItems:
          activeEnvelope.contextSummary?.contextItems ??
          contextPreview?.contextItems ??
          [],
        timelineEvents: activeEnvelope.timeline ?? [],
        artifacts,
        toolProposalCount: activeEnvelope.toolProposalSummary?.total ?? 0,
        artifactBusyId,
        mnemonicBusy,
      }),
    });
  }
  const contextSummary = activeEnvelope?.contextSummary ?? null;
  const contextItems =
    contextSummary?.contextItems ?? contextPreview?.contextItems ?? [];
  if (contextItems.length > 0) {
    const included = contextItems.filter((item) => item.included).length;
    const redacted = contextItems.some((item) => item.redacted);
    const truncated =
      contextSummary?.redaction?.truncated ||
      contextPreview?.redaction?.truncated;
    items.push({
      key: "context",
      state: included > 0 ? "done" : "idle",
      label: `${included}/${contextItems.length} context item${contextItems.length === 1 ? "" : "s"}${redacted ? ", redacted" : ""}${truncated ? ", truncated" : ""}`,
    });
  }
  if (artifacts.length > 0) {
    items.push({
      key: "artifacts",
      state: completed ? "done" : "active",
      label: `${artifacts.length} audit artifact${artifacts.length === 1 ? "" : "s"}`,
    });
  }
  const memoryArtifacts = artifacts.filter(
    (artifact) => artifact.kind === "memory",
  );
  if (mnemonicBusy) {
    items.push({
      key: "mnemonic-memory",
      state: "active",
      label: "Mnemonic: updating memory",
    });
  } else if (memoryArtifacts.length > 0) {
    const busyMemoryArtifact = memoryArtifacts.find(
      (artifact) => artifact.id === artifactBusyId,
    );
    const latestMemoryArtifact =
      busyMemoryArtifact ??
      [...memoryArtifacts].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
        const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
        return (
          (Number.isFinite(leftTime) ? leftTime : 0) -
          (Number.isFinite(rightTime) ? rightTime : 0)
        );
      })[memoryArtifacts.length - 1];
    const proposedCount = memoryArtifacts.filter(
      (artifact) => artifact.status === "proposed",
    ).length;
    items.push({
      key: "mnemonic-memory",
      state: busyMemoryArtifact
        ? "active"
        : proposedCount > 0
          ? "idle"
          : "done",
      label:
        proposedCount > 1
          ? `Mnemonic: ${proposedCount} memories ready to save`
          : memoryArtifactActivityLabel(latestMemoryArtifact, artifactBusyId),
    });
  }
  const proposalCount = activeEnvelope?.toolProposalSummary?.total ?? 0;
  if (proposalCount > 0) {
    items.push({
      key: "tools",
      state: "idle",
      label: `${proposalCount} tool proposal${proposalCount === 1 ? "" : "s"} awaiting review`,
    });
  }
  if (activeEnvelope?.mnemonicInclusion?.requested) {
    const mnemonic = activeEnvelope.mnemonicInclusion;
    const mnemonicContext = contextItems.find(
      (item) => item.kind === "mnemonic",
    );
    items.push({
      key: "mnemonic",
      state: mnemonic.included ? "done" : "idle",
      label: mnemonic.included
        ? `Mnemonic: ${mnemonic.count} used${mnemonicContext?.reason ? `, ${mnemonicContext.reason}` : ""}`
        : "Mnemonic requested, nothing included",
    });
  }
  if (approvalPolicy?.mode) {
    items.push({
      key: "approval",
      state: approvalPolicy.mode === "full_access" ? "active" : "idle",
      label: `Approval: ${approvalPolicy.mode}`,
    });
  }
  if (!consentPolicy?.localProvidersAccepted && selectedProvider?.local) {
    items.push({ key: "consent", state: "idle", label: "Consent pending" });
  }
  if (embeddingStatus?.status === "error") {
    items.push({ key: "embedding", state: "idle", label: "Embedding error" });
  }
  void activeRun;
  void workflowCount;

  return items;
}

export function summarizeActivityStatus(
  items: ActivityStatusItem[],
  selectedProviderReady: boolean,
): ActivityStatusItem {
  const active = items.find((item) => item.state === "active");
  if (active) return active;

  const attention = items.find((item) =>
    ["provider", "consent", "embedding", "mnemonic-memory", "tools"].includes(
      item.key,
    ),
  );
  if (attention) {
    if (attention.key === "mnemonic-memory" || attention.key === "tools") {
      return attention;
    }
    return { key: "summary", state: "idle", label: "Needs attention" };
  }

  const run = items.find((item) => item.key === "run");
  if (run) return run;

  return {
    key: "summary",
    state: selectedProviderReady ? "done" : "idle",
    label: selectedProviderReady ? "Ready" : "Needs setup",
  };
}

export function ActivityStatusPopover({
  activeEnvelope,
  activeRun,
  contextPreview,
  items,
  selectedProvider,
  summary,
}: {
  activeEnvelope: AIChatRunEnvelope | null;
  activeRun: AIChatRun | null;
  contextPreview: AIContextSnapshot | null;
  items: ActivityStatusItem[];
  selectedProvider: AIProviderDescriptor | null;
  summary: ActivityStatusItem;
}) {
  const reduceMotion = useReducedMotion();
  const visibleItems = items.length > 0 ? items : [summary];
  const activeContext: AIContextSummary | AIContextSnapshot | null =
    activeRun?.contextSummary ??
    activeEnvelope?.contextSummary ??
    contextPreview ??
    null;
  const contextItems = activeContext?.contextItems ?? [];
  const includedContextItems = contextItems.filter((item) => item.included);
  const redacted =
    contextItems.some((item) => item.redacted) ||
    Boolean(activeContext?.redaction?.secretsRedacted) ||
    Boolean(activeContext?.redaction?.pathsRedacted);
  const truncated =
    contextItems.some((item) => item.truncated) ||
    Boolean(activeContext?.redaction?.truncated);
  const snippetCount =
    activeContext && "snippetCount" in activeContext
      ? activeContext.snippetCount
      : (contextPreview?.snippets.length ?? 0);
  const contextLabel =
    contextItems.length > 0
      ? `${includedContextItems.length}/${contextItems.length} context item${contextItems.length === 1 ? "" : "s"}`
      : "No context items";
  const contextFlags = [
    snippetCount > 0
      ? `${snippetCount} snippet${snippetCount === 1 ? "" : "s"}`
      : "",
    redacted ? "redacted" : "",
    truncated ? "truncated" : "",
  ].filter(Boolean);
  const action = activeEnvelope?.action ?? activeRun?.action ?? null;
  const actionMeta = action ? getActionMeta(action as AIChatAction) : null;
  const providerLabel =
    activeRun?.providerId ||
    activeEnvelope?.egressSummary?.providerId ||
    activeEnvelope?.providerId ||
    selectedProvider?.name ||
    selectedProvider?.id ||
    "runtime";
  const modelLabel =
    activeRun?.model ||
    activeEnvelope?.egressSummary?.model ||
    activeEnvelope?.model ||
    selectedProvider?.defaultModel ||
    selectedProvider?.models?.[0]?.id ||
    "No model";
  const sourcePath =
    activeContext?.filePath ||
    contextPreview?.filePath ||
    activeEnvelope?.egressSummary?.source ||
    "chat";
  const egress = activeEnvelope?.egressSummary;
  const egressMetrics = (egress ?? null) as RuntimeEgressMetrics | null;
  const egressLabel = egress?.canceled
    ? "canceled"
    : egress?.status || egress?.source || "not recorded";
  const approvalLabel =
    activeEnvelope?.approvalSummary?.mode || "ask_each_time";
  const consentLabel = activeEnvelope?.consentSummary
    ? activeEnvelope.consentSummary.externalAgentCliAccepted
      ? "agent CLI accepted"
      : activeEnvelope.consentSummary.localProvidersAccepted
        ? "local accepted"
        : "local pending"
    : selectedProvider?.local
      ? "local"
      : "provider policy";
  const providerTone = getProviderPresentation(selectedProvider).tone;
  const latencyLabel =
    typeof egress?.latencyMs === "number" ? `${egress.latencyMs} ms` : "n/a";

  return (
    <m.div
      className="ai-chat-popover ai-chat-activity-popover ai-chat-runtime-popover"
      role="menu"
      aria-label="AI runtime status"
      initial={
        reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }
      }
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.985 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div className="ai-chat-popover__title">Runtime status</div>

      <div className="ai-chat-runtime-popover__hero" data-state={summary.state}>
        <ActivityIcon state={summary.state} />
        <span>{summary.label}</span>
      </div>

      <div className="ai-chat-runtime-popover__stack">
        {actionMeta ? (
          <div className="ai-chat-runtime-popover__row">
            <Gauge size={15} />
            <span>{actionMeta.label} mode</span>
          </div>
        ) : null}
        <div className="ai-chat-runtime-popover__row">
          <FileText size={15} />
          <span>{contextLabel}</span>
          {contextFlags.length > 0 ? (
            <small>{contextFlags.join(", ")}</small>
          ) : null}
        </div>
        <div className="ai-chat-runtime-popover__row">
          <Boxes size={15} />
          <span>{compactText(sourcePath, 34)}</span>
        </div>
      </div>

      <div className="ai-chat-runtime-popover__grid">
        <span>Provider</span>
        <strong data-tone={providerTone}>
          <Bot size={13} />
          {providerLabel}
        </strong>
        <span>Model</span>
        <strong>{compactText(modelLabel, 34)}</strong>
        <span>Egress</span>
        <strong>{egressLabel}</strong>
        <span>Latency</span>
        <strong>{latencyLabel}</strong>
        <span>Tokens</span>
        <strong title={egressMetrics?.tokenSource || undefined}>
          {formatTokenUsage(egressMetrics)}
        </strong>
        <span>Tools</span>
        <strong title={egressMetrics?.toolSupportKind || undefined}>
          {formatToolProfile(egressMetrics)}
        </strong>
        <span>Cost</span>
        <strong title={egressMetrics?.costSource || undefined}>
          {formatCost(egressMetrics)}
        </strong>
        <span>Approval</span>
        <strong>
          <ShieldCheck size={13} />
          {approvalLabel}
        </strong>
        <span>Consent</span>
        <strong>{consentLabel}</strong>
      </div>

      <div className="ai-chat-runtime-popover__ledger">
        {visibleItems.map((item) => (
          <div
            key={item.key}
            className="ai-chat-activity-popover__item"
            data-state={item.state}
          >
            <ActivityIcon state={item.state} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </m.div>
  );
}

export function ActivityTimeline({ visible, ...data }: ActivityTimelineProps) {
  if (!visible) return null;

  const items = buildActivityStatusItems(data);
  if (items.length === 0) return null;

  return (
    <section className="ai-chat-activity" aria-label="AI runtime activity">
      <div className="ai-chat-activity__items">
        {items.map((item) => (
          <div
            key={item.key}
            className="ai-chat-activity__item"
            data-state={item.state}
          >
            <ActivityIcon state={item.state} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
