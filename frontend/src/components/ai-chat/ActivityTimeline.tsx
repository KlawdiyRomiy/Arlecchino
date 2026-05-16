import React from "react";
import { Circle, CheckCircle2, Loader2 } from "lucide-react";
import type {
  AIApprovalPolicy,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIConsentPolicy,
  AIContextSnapshot,
  AIEmbeddingStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import { getProviderPresentation } from "./providerPresentation";
import { runStatusLabel } from "./aiChatPresentation";

export type ActivityStatusState = "done" | "active" | "idle";

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
}

interface ActivityTimelineProps extends ActivityStatusData {
  visible: boolean;
}

export function ActivityIcon({ state }: { state: ActivityStatusState }) {
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
}: ActivityStatusData): ActivityStatusItem[] {
  const provider = getProviderPresentation(selectedProvider);
  const runState = activeEnvelope?.status ?? "";
  const streaming =
    runState === "running" && Boolean(activeRunText || activeRun?.response);
  const completed =
    runState === "completed" || runState === "error" || runState === "canceled";
  const items: ActivityStatusItem[] = [];
  if (!selectedProviderReady) {
    items.push({ key: "provider", state: "idle", label: provider.subtitle });
  }
  if (activeEnvelope) {
    items.push({
      key: "run",
      state: streaming ? "active" : completed ? "done" : "idle",
      label: streaming ? "Running" : runStatusLabel(activeEnvelope.status),
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
  const proposalCount = activeEnvelope?.toolProposalSummary?.total ?? 0;
  if (proposalCount > 0) {
    items.push({
      key: "tools",
      state: "idle",
      label: `${proposalCount} proposal${proposalCount === 1 ? "" : "s"} preview only`,
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

  const run = items.find((item) => item.key === "run");
  if (run) return run;

  const attention = items.find((item) =>
    ["provider", "consent", "embedding"].includes(item.key),
  );
  if (attention) {
    return { key: "summary", state: "idle", label: "Needs attention" };
  }

  return {
    key: "summary",
    state: selectedProviderReady ? "done" : "idle",
    label: selectedProviderReady ? "Ready" : "Needs setup",
  };
}

export function ActivityStatusPopover({
  items,
  summary,
}: {
  items: ActivityStatusItem[];
  summary: ActivityStatusItem;
}) {
  const visibleItems = items.length > 0 ? items : [summary];

  return (
    <div
      className="ai-chat-popover ai-chat-activity-popover"
      role="menu"
      aria-label="AI runtime status"
    >
      <div className="ai-chat-popover__title">Runtime status</div>
      <div className="ai-chat-activity-popover__items">
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
    </div>
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
