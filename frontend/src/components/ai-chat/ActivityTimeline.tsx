import React from "react";
import { Circle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import type {
  AIChatRun,
  AIChatRunEnvelope,
  AIContextSnapshot,
  AIEgressRecord,
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
  egressRecords: AIEgressRecord[];
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
  egressRecords,
}: ActivityTimelineProps) {
  if (!visible) return null;

  const provider = getProviderPresentation(selectedProvider);
  const runState = activeEnvelope?.status ?? "";
  const streaming =
    runState === "running" && Boolean(activeRunText || activeRun?.response);
  const completed =
    runState === "completed" || runState === "error" || runState === "canceled";
  const latestEgress =
    activeEnvelope?.egressSummary ?? egressRecords[0] ?? null;

  return (
    <section className="ai-chat-activity" aria-label="AI runtime activity">
      <div className="ai-chat-activity__title">
        <ShieldCheck size={15} />
        Runtime state
      </div>
      <div className="ai-chat-activity__items">
        <div
          className="ai-chat-activity__item"
          data-state={selectedProviderReady ? "done" : "idle"}
        >
          <ActivityIcon state={selectedProviderReady ? "done" : "idle"} />
          <span>
            {selectedProviderReady ? "Provider ready" : provider.subtitle}
          </span>
        </div>
        <div
          className="ai-chat-activity__item"
          data-state={contextPreview ? "done" : "idle"}
        >
          <ActivityIcon state={contextPreview ? "done" : "idle"} />
          <span>
            {contextPreview
              ? "Context preview ready"
              : "Context will be prepared on send"}
          </span>
        </div>
        <div
          className="ai-chat-activity__item"
          data-state={streaming ? "active" : completed ? "done" : "idle"}
        >
          <ActivityIcon
            state={streaming ? "active" : completed ? "done" : "idle"}
          />
          <span>
            {activeEnvelope
              ? streaming
                ? "Token stream active"
                : runStatusLabel(activeEnvelope.status)
              : "No active run"}
          </span>
        </div>
        <div
          className="ai-chat-activity__item"
          data-state={latestEgress ? "done" : "idle"}
        >
          <ActivityIcon state={latestEgress ? "done" : "idle"} />
          <span>
            {latestEgress
              ? `Egress ${latestEgress.status}`
              : "No egress record"}
          </span>
        </div>
      </div>
    </section>
  );
}
