import React from "react";
import { Circle, CheckCircle2, Loader2 } from "lucide-react";
import type {
  AIApprovalPolicy,
  AIChatRun,
  AIChatRunEnvelope,
  AIConsentPolicy,
  AIContextSnapshot,
  AIEmbeddingStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import { getProviderPresentation } from "./providerPresentation";
import { runStatusLabel } from "./aiChatPresentation";

interface ActivityTimelineProps {
  visible: boolean;
  selectedProvider: AIProviderDescriptor | null;
  selectedProviderReady: boolean;
  contextPreview: AIContextSnapshot | null;
  activeEnvelope: AIChatRunEnvelope | null;
  activeRun: AIChatRun | null;
  activeRunText: string;
  approvalPolicy: AIApprovalPolicy | null;
  consentPolicy: AIConsentPolicy | null;
  embeddingStatus: AIEmbeddingStatus | null;
  workflowCount: number;
}

function ActivityIcon({ state }: { state: "done" | "active" | "idle" }) {
  if (state === "done") return <CheckCircle2 size={15} />;
  if (state === "active") return <Loader2 size={15} className="spin" />;
  return <Circle size={15} />;
}

export function ActivityTimeline({
  visible,
  selectedProvider,
  selectedProviderReady,
  contextPreview,
  activeEnvelope,
  activeRun,
  activeRunText,
  approvalPolicy,
  consentPolicy,
  embeddingStatus,
  workflowCount,
}: ActivityTimelineProps) {
  if (!visible) return null;

  const provider = getProviderPresentation(selectedProvider);
  const runState = activeEnvelope?.status ?? "";
  const streaming =
    runState === "running" && Boolean(activeRunText || activeRun?.response);
  const completed =
    runState === "completed" || runState === "error" || runState === "canceled";
  const items: Array<{
    key: string;
    state: "done" | "active" | "idle";
    label: string;
  }> = [];
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
  if (!consentPolicy?.localProvidersAccepted && selectedProvider?.local) {
    items.push({ key: "consent", state: "idle", label: "Consent pending" });
  }
  if (embeddingStatus?.status === "error") {
    items.push({ key: "embedding", state: "idle", label: "Embedding error" });
  }
  void contextPreview;
  void activeRun;
  void approvalPolicy;
  void workflowCount;
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
