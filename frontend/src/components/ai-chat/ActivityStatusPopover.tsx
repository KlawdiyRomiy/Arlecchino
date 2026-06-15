import { Bot, Boxes, FileText, Gauge, ShieldCheck } from "lucide-react";
import { m, useReducedMotion } from "framer-motion";

import type {
  AIChatAction,
  AIChatRun,
  AIChatRunEnvelope,
  AIContextSummary,
  AIContextSnapshot,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import { ActivityIcon } from "./ActivityIcon";
import { compactText, getActionMeta } from "./aiChatPresentation";
import type { ActivityStatusItem } from "./activityStatus";
import { getProviderPresentation } from "./providerPresentation";
import { useInteractiveSurfaceMotion } from "../ui/interactiveSurfaceMotion";

interface RuntimeEgressMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedTokens?: boolean;
  tokenSource?: string;
  requestCount?: number;
  apiDurationMs?: number;
  wallDurationMs?: number;
  firstTokenLatencyMs?: number;
  costMicros?: number;
  costCurrency?: string;
  costEstimated?: boolean;
  costSource?: string;
  toolProfile?: string;
  toolSchemaCount?: number;
  toolSupportKind?: string;
}

const formatDuration = (value?: number): string =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString()} ms`
    : "n/a";

const formatTokenUsage = (metrics: RuntimeEgressMetrics | null): string => {
  if (!metrics?.totalTokens) return "n/a";
  const prefix = metrics.estimatedTokens ? "~" : "";
  return `${prefix}${metrics.totalTokens.toLocaleString()} tokens`;
};

const formatRequestCount = (metrics: RuntimeEgressMetrics | null): string => {
  if (!metrics?.requestCount) return "n/a";
  return `${metrics.requestCount.toLocaleString()} request${metrics.requestCount === 1 ? "" : "s"}`;
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
  const { markMotionStart, surfaceStyle } = useInteractiveSurfaceMotion(
    "popover",
    {
      preserveTransform: true,
      reduceMotion: Boolean(reduceMotion),
    },
  );
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
    : egress?.finalStatus || egress?.status || egress?.source || "not recorded";
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
  const apiDurationLabel = formatDuration(
    egressMetrics?.apiDurationMs ?? egress?.latencyMs,
  );
  const wallDurationLabel = formatDuration(egressMetrics?.wallDurationMs);
  const firstTokenLabel = formatDuration(egressMetrics?.firstTokenLatencyMs);

  return (
    <m.div
      className="ai-chat-popover ai-chat-activity-popover ai-chat-runtime-popover"
      role="menu"
      aria-label="AI runtime status"
      onAnimationStart={markMotionStart}
      initial={
        reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }
      }
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.985 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
      style={surfaceStyle}
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
        <span>Requests</span>
        <strong>{formatRequestCount(egressMetrics)}</strong>
        <span>Wall time</span>
        <strong>{wallDurationLabel}</strong>
        <span>Model time</span>
        <strong>{apiDurationLabel}</strong>
        <span>First token</span>
        <strong>{firstTokenLabel}</strong>
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
