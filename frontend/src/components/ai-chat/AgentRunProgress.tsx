import React from "react";
import {
  AlertCircle,
  Ban,
  Bot,
  Check,
  CirclePlay,
  FileStack,
  LoaderCircle,
  MessageSquareText,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";

import type {
  AIChatRunEnvelope,
  AIRunTimelineEvent,
} from "../../../bindings/arlecchino/internal/ai/models";
import { isExternalAgentRuntimeFamily } from "./providerPresentation";

type AgentRunStageKey = "start" | "context" | "agent" | "result";
type AgentRunStageState =
  "pending" | "active" | "done" | "blocked" | "error" | "canceled";

interface AgentRunStage {
  key: AgentRunStageKey;
  label: string;
  state: AgentRunStageState;
  durationMs?: number;
}

interface AgentRunActivity {
  key: string;
  label: string;
  meta: string;
  state: AgentRunStageState;
}

export interface AgentRunProgressModel {
  stages: AgentRunStage[];
  activities: AgentRunActivity[];
  state: AgentRunStageState;
  statusLabel: string;
  compact: boolean;
  confirmedBoundary: number;
  visible: boolean;
}

const stageDefinitions: Array<Pick<AgentRunStage, "key" | "label">> = [
  { key: "start", label: "Prepare" },
  { key: "context", label: "Context" },
  { key: "agent", label: "Act" },
  { key: "result", label: "Verify" },
];

const terminalStatuses = new Set(["completed", "error", "canceled", "blocked"]);
const activeStatuses = new Set(["started", "running", "active", "pending"]);
const doneStatuses = new Set([
  "completed",
  "done",
  "ready",
  "recorded",
  "applied",
  "verified",
  "success",
]);
const runtimeClockListeners = new Set<() => void>();
const runtimeClockIntervalMs = 250;
let runtimeClockNow = Date.now();
let runtimeClockTimer: number | null = null;

function runtimeClockSnapshot(): number {
  return runtimeClockNow;
}

function subscribeRuntimeClock(listener: () => void): () => void {
  runtimeClockListeners.add(listener);
  runtimeClockNow = Date.now();
  if (runtimeClockTimer === null) {
    runtimeClockTimer = window.setInterval(() => {
      runtimeClockNow = Date.now();
      runtimeClockListeners.forEach((notify) => notify());
    }, runtimeClockIntervalMs);
  }
  return () => {
    runtimeClockListeners.delete(listener);
    if (runtimeClockListeners.size === 0 && runtimeClockTimer !== null) {
      window.clearInterval(runtimeClockTimer);
      runtimeClockTimer = null;
    }
  };
}

function subscribeStaticRuntimeClock(): () => void {
  return () => undefined;
}

function useRuntimeClock(active: boolean): number {
  return React.useSyncExternalStore(
    active ? subscribeRuntimeClock : subscribeStaticRuntimeClock,
    runtimeClockSnapshot,
    runtimeClockSnapshot,
  );
}

function normalized(value?: string | null): string {
  return `${value ?? ""}`.trim().toLowerCase();
}

function eventTime(event: AIRunTimelineEvent): number {
  const value = Date.parse(event.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function envelopeTime(value?: string | null): number {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function stageForEvent(event: AIRunTimelineEvent): AgentRunStageKey | null {
  const source = normalized(event.source);
  const type = normalized(event.type);
  if (type.startsWith("agent_status_")) {
    switch (type.slice("agent_status_".length)) {
      case "starting":
      case "planning":
        return "start";
      case "context":
      case "researching":
      case "reading":
        return "context";
      case "testing":
      case "verifying":
      case "reviewing":
      case "finalizing":
      case "completed":
        return "result";
      default:
        return "agent";
    }
  }
  if (type === "run_started" || type === "auth_started") return "start";
  if (
    source === "context" ||
    type.startsWith("context_") ||
    type === "fast_context" ||
    type === "mnemonic_context" ||
    type === "mcp_context" ||
    type === "mcp_tools_degraded"
  ) {
    return "context";
  }
  if (
    type === "provider_response" ||
    type === "run_completed" ||
    type === "run_error" ||
    type === "run_canceled" ||
    type === "run_recovered" ||
    type === "chat_summary"
  ) {
    return "result";
  }
  if (
    source === "provider" ||
    source === "agent_runtime" ||
    source === "tool_runtime" ||
    type.startsWith("provider_") ||
    type.startsWith("tool_") ||
    type.startsWith("auth_") ||
    type.startsWith("worktree_") ||
    type.startsWith("runtime_") ||
    type.startsWith("patch_") ||
    type === "artifact_updated"
  ) {
    return "agent";
  }
  return null;
}

function stateForEvent(event: AIRunTimelineEvent): AgentRunStageState {
  const status = normalized(event.status);
  const type = normalized(event.type);
  if (status === "blocked") return "blocked";
  if (status === "error" || type === "run_error") return "error";
  if (status === "canceled" || type === "run_canceled") return "canceled";
  if (status === "waiting") return "active";
  if (type === "provider_response" && doneStatuses.has(status)) return "active";
  if (activeStatuses.has(status)) return "active";
  if (doneStatuses.has(status) || type === "run_completed") return "done";
  return "pending";
}

function terminalState(envelope: AIChatRunEnvelope): AgentRunStageState | null {
  const status = normalized(envelope.status);
  const proofState = normalized(envelope.agentRuntime?.proofState);
  if (status === "canceled") return "canceled";
  if (status === "blocked" || proofState === "blocked") return "blocked";
  if (status === "error" || proofState === "error") return "error";
  if (status !== "completed") return null;

  const externalAgent = Boolean(
    isExternalAgentRuntimeFamily(envelope.runtimeFamily) ||
    (envelope.agentRuntime &&
      (isExternalAgentRuntimeFamily(envelope.agentRuntime.runtimeFamily) ||
        (normalized(envelope.agentRuntime.transport) !== "" &&
          normalized(envelope.agentRuntime.transport) !== "model_api"))),
  );
  if (externalAgent && proofState !== "proved") {
    return "blocked";
  }
  return "done";
}

function compactActivityText(value: string, fallback: string): string {
  const text = value.replace(/\s+/g, " ").trim() || fallback;
  return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
}

function eventActivityLabel(event: AIRunTimelineEvent): string {
  const fallback = (event.type || "runtime event").replace(/_/g, " ");
  return compactActivityText(event.summary || "", fallback);
}

function eventActivityMeta(event: AIRunTimelineEvent): string {
  const type = event.type?.startsWith("agent_status_")
    ? event.type.slice("agent_status_".length)
    : event.type?.replace(/_/g, " ");
  return [type, event.status].filter(Boolean).join(" / ");
}

function visibleActivities(events: AIRunTimelineEvent[]): AgentRunActivity[] {
  const sourceEvents = events.filter((event) => {
    const type = normalized(event.type);
    if (
      type === "assistant_commentary" ||
      normalized(event.status) === "message.commentary"
    ) {
      return false;
    }
    if (type.startsWith("agent_status_")) return true;
    return (
      type.startsWith("context_") ||
      type.startsWith("provider_") ||
      type.startsWith("tool_") ||
      type.startsWith("patch_") ||
      type === "run_started" ||
      type === "run_completed" ||
      type === "run_error" ||
      type === "run_canceled" ||
      type === "artifact_updated"
    );
  });
  const grouped = new Map<string, AIRunTimelineEvent>();
  sourceEvents.forEach((event) => {
    if (!event?.id && !event?.type) return;
    const key =
      event.correlationId?.trim() ||
      event.artifactId?.trim() ||
      event.id ||
      `${event.source}:${event.type}:${event.createdAt}`;
    grouped.set(key, event);
  });
  return [...grouped.entries()]
    .sort(([, left], [, right]) => eventTime(left) - eventTime(right))
    .slice(-5)
    .map(([key, event]) => ({
      key,
      label: eventActivityLabel(event),
      meta: eventActivityMeta(event),
      state: stateForEvent(event),
    }));
}

function stageDuration(
  key: AgentRunStageKey,
  stageTimes: Map<AgentRunStageKey, number>,
  envelope: AIChatRunEnvelope,
  state: AgentRunStageState,
  nowMs: number,
): number | undefined {
  const index = stageDefinitions.findIndex((stage) => stage.key === key);
  const startedAt = stageTimes.get(key) ?? 0;
  if (!startedAt) return undefined;
  for (
    let nextIndex = index + 1;
    nextIndex < stageDefinitions.length;
    nextIndex += 1
  ) {
    const finishedAt = stageTimes.get(stageDefinitions[nextIndex].key) ?? 0;
    if (finishedAt >= startedAt) return finishedAt - startedAt;
  }
  if (state === "active" && nowMs >= startedAt) return nowMs - startedAt;
  if (!terminalStatuses.has(normalized(envelope.status))) return undefined;
  const finishedAt = envelopeTime(envelope.updatedAt);
  return finishedAt >= startedAt ? finishedAt - startedAt : undefined;
}

function statusLabelForModel(
  state: AgentRunStageState,
  activeStage: AgentRunStage | undefined,
  envelope: AIChatRunEnvelope,
): string {
  switch (state) {
    case "done":
      return "Confirmed";
    case "blocked": {
      const proof = normalized(envelope.agentRuntime?.proofState);
      return proof && proof !== "proved" ? `Proof ${proof}` : "Blocked";
    }
    case "error":
      return "Failed";
    case "canceled":
      return "Canceled";
    case "active":
      return activeStage ? `Live / ${activeStage.label}` : "Live";
    default:
      return "Awaiting evidence";
  }
}

export function projectAgentRunProgress(
  envelope: AIChatRunEnvelope,
  _streamingText: string,
  nowMs = Date.now(),
): AgentRunProgressModel {
  const events = [...(envelope.timeline ?? [])].sort(
    (left, right) => eventTime(left) - eventTime(right),
  );
  const stageTimes = new Map<AgentRunStageKey, number>();
  const stageStates = new Map<AgentRunStageKey, AgentRunStageState>();
  const stageEventOrder = new Map<AgentRunStageKey, number>();
  let latestActiveEventStage: AgentRunStageKey | null = null;
  let latestProgressEventStage: AgentRunStageKey | null = null;
  let latestProgressEventState: AgentRunStageState = "pending";
  let latestProgressEventAt = 0;
  const runStartedAt = envelopeTime(envelope.createdAt);
  if (runStartedAt) stageTimes.set("start", runStartedAt);
  stageStates.set("start", "active");

  for (const [eventIndex, event] of events.entries()) {
    const stage = stageForEvent(event);
    if (!stage) continue;
    stageEventOrder.set(stage, eventIndex);
    const at = eventTime(event);
    if (at && !stageTimes.has(stage)) stageTimes.set(stage, at);
    const eventState = stateForEvent(event);
    if (eventState !== "pending") stageStates.set(stage, eventState);
    if (eventState === "active") latestActiveEventStage = stage;
    if (eventState !== "pending") {
      latestProgressEventStage = stage;
      latestProgressEventState = eventState;
      if (at) latestProgressEventAt = at;
    }
  }

  if (envelope.contextSummary) {
    const contextState = stageStates.get("context");
    if (
      contextState !== "blocked" &&
      contextState !== "error" &&
      contextState !== "canceled"
    ) {
      stageStates.set("context", "done");
    }
    const contextTime = envelopeTime(envelope.contextSummary.createdAt);
    if (contextTime && !stageTimes.has("context")) {
      stageTimes.set("context", contextTime);
    }
  }
  if (envelope.agentRuntime || envelope.egressSummary) {
    if (!stageStates.has("agent")) stageStates.set("agent", "active");
    const runtimeTime = envelopeTime(envelope.agentRuntime?.firstEventAt);
    if (runtimeTime && !stageTimes.has("agent")) {
      stageTimes.set("agent", runtimeTime);
    }
  }
  const terminal = terminalState(envelope);
  if (terminal) stageStates.set("result", terminal);

  let currentActiveStage: AgentRunStageKey | null = null;
  if (!terminal) {
    const agentEventOrder = stageEventOrder.get("agent");
    const resultEventOrder = stageEventOrder.get("result");
    const agentRestartedAfterResult =
      stageStates.get("agent") === "active" &&
      agentEventOrder !== undefined &&
      resultEventOrder !== undefined &&
      agentEventOrder > resultEventOrder;
    if (agentRestartedAfterResult) {
      currentActiveStage = "agent";
    } else if (
      latestProgressEventStage &&
      latestProgressEventState === "active"
    ) {
      currentActiveStage = latestProgressEventStage;
    } else if (
      latestProgressEventStage &&
      latestProgressEventState === "done"
    ) {
      const latestIndex = stageDefinitions.findIndex(
        (stage) => stage.key === latestProgressEventStage,
      );
      currentActiveStage = stageDefinitions[latestIndex + 1]?.key ?? null;
    } else if (
      latestActiveEventStage &&
      latestActiveEventStage !== "start" &&
      stageStates.get(latestActiveEventStage) === "active"
    ) {
      currentActiveStage = latestActiveEventStage;
    } else if (stageStates.get("agent") === "active") {
      currentActiveStage = "agent";
    } else if (stageStates.get("context") === "active") {
      currentActiveStage = "context";
    } else if (!latestProgressEventStage) {
      currentActiveStage = "start";
    }
    if (currentActiveStage) {
      const currentIndex = stageDefinitions.findIndex(
        (stage) => stage.key === currentActiveStage,
      );
      const currentState = stageStates.get(currentActiveStage);
      if (
        currentState !== "blocked" &&
        currentState !== "error" &&
        currentState !== "canceled"
      ) {
        stageStates.set(currentActiveStage, "active");
      }
      if (!stageTimes.has(currentActiveStage) && latestProgressEventAt) {
        stageTimes.set(currentActiveStage, latestProgressEventAt);
      }
      const currentOrder = stageEventOrder.get(currentActiveStage) ?? -1;
      for (
        let index = currentIndex + 1;
        index < stageDefinitions.length;
        index += 1
      ) {
        const key = stageDefinitions[index].key;
        const laterOrder = stageEventOrder.get(key);
        const state = stageStates.get(key);
        if (laterOrder !== undefined && laterOrder > currentOrder) {
          continue;
        }
        if (state === "active" || state === "done") {
          stageStates.delete(key);
        }
      }
    }
  }

  const furthestEvidence = stageDefinitions.reduce(
    (furthest, stage, index) =>
      stageStates.has(stage.key) || stageTimes.has(stage.key)
        ? Math.max(furthest, index)
        : furthest,
    0,
  );
  const activeBoundary = currentActiveStage
    ? stageDefinitions.findIndex((stage) => stage.key === currentActiveStage)
    : furthestEvidence;
  for (let index = 0; index < activeBoundary; index += 1) {
    const key = stageDefinitions[index].key;
    const current = stageStates.get(key);
    if (current === "active") {
      stageStates.set(key, "done");
    }
  }

  const stages = stageDefinitions.map((stage) => {
    const state = stageStates.get(stage.key) ?? "pending";
    return {
      ...stage,
      state,
      durationMs: stageDuration(stage.key, stageTimes, envelope, state, nowMs),
    };
  });
  const activeStage = [...stages]
    .reverse()
    .find((stage) => stage.state === "active");
  const stageTerminalState =
    stages.find((stage) => stage.state === "error")?.state ??
    stages.find((stage) => stage.state === "blocked")?.state ??
    stages.find((stage) => stage.state === "canceled")?.state;
  const envelopeActive = ["running", "queued"].includes(
    normalized(envelope.status),
  );
  const state =
    stageTerminalState ??
    terminal ??
    (activeStage || envelopeActive ? "active" : "pending");
  let confirmedBoundary = 0;
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index].state === "pending") break;
    confirmedBoundary = index;
  }
  const visible = Boolean(
    envelope.agentRuntime ||
    events.length > 0 ||
    normalized(envelope.status) === "running" ||
    normalized(envelope.status) === "queued",
  );

  return {
    stages,
    activities: visibleActivities(events),
    state,
    statusLabel: statusLabelForModel(state, activeStage, envelope),
    compact: false,
    confirmedBoundary,
    visible,
  };
}

function formatDuration(
  durationMs: number | undefined,
  state: AgentRunStageState,
): string {
  if (state === "pending") return "—";
  if (typeof durationMs !== "number" || durationMs < 0) {
    return state === "active" ? "Live" : "—";
  }
  if (durationMs < 1) return "<1 ms";
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))} ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function StageStateIcon({ state }: { state: AgentRunStageState }) {
  switch (state) {
    case "done":
      return <Check size={11} />;
    case "blocked":
      return <Ban size={11} />;
    case "error":
      return <X size={11} />;
    case "canceled":
      return <X size={11} />;
    case "active":
      return (
        <LoaderCircle className="ai-chat-agent-progress__spinner" size={13} />
      );
    default:
      return null;
  }
}

const stageIcons: Record<
  AgentRunStageKey,
  React.ComponentType<{ size?: number }>
> = {
  start: CirclePlay,
  context: FileStack,
  agent: Bot,
  result: MessageSquareText,
};

export const AgentRunProgress = React.memo(function AgentRunProgress({
  announce = false,
  envelope,
}: {
  announce?: boolean;
  envelope: AIChatRunEnvelope;
}) {
  const reduceMotion = useReducedMotion();
  const runtimeActive = ["running", "queued"].includes(
    normalized(envelope.status),
  );
  const nowMs = useRuntimeClock(runtimeActive);
  const model = React.useMemo(
    () => projectAgentRunProgress(envelope, "", nowMs),
    [envelope, nowMs],
  );
  if (!model.visible) return null;

  return (
    <section
      className="ai-chat-agent-progress"
      data-compact={model.compact ? "true" : "false"}
      data-state={model.state}
      aria-label="Agent Runtime"
    >
      <div className="ai-chat-agent-progress__header">
        <span className="ai-chat-agent-progress__title">
          <Bot size={14} />
          Agent Runtime
        </span>
        <span
          className="ai-chat-agent-progress__status"
          data-state={model.state}
          aria-live={announce && !model.compact ? "polite" : undefined}
        >
          {model.state !== "pending" ? (
            <span aria-hidden="true">
              <StageStateIcon state={model.state} />
            </span>
          ) : null}
          {model.statusLabel}
        </span>
      </div>

      <div
        className="ai-chat-agent-progress__bar"
        aria-hidden="true"
        style={
          {
            "--ai-chat-agent-progress":
              model.confirmedBoundary / (stageDefinitions.length - 1),
          } as React.CSSProperties
        }
      >
        <span />
      </div>

      <div className="ai-chat-agent-progress__stages" role="list">
        {model.stages.map((stage) => {
          const Icon = stageIcons[stage.key];
          return (
            <div
              className="ai-chat-agent-progress__stage"
              data-state={stage.state}
              key={stage.key}
              role="listitem"
              aria-label={`${stage.label}: ${stage.state}`}
              aria-current={stage.state === "active" ? "step" : undefined}
              title={
                stage.state === "pending"
                  ? `${stage.label}: awaiting runtime evidence`
                  : `${stage.label}: ${stage.state}`
              }
            >
              <span className="ai-chat-agent-progress__stage-icon">
                <Icon aria-hidden="true" size={14} />
                <span className="ai-chat-agent-progress__stage-state">
                  <StageStateIcon state={stage.state} />
                </span>
              </span>
              <span className="ai-chat-agent-progress__stage-copy">
                <strong>{stage.label}</strong>
                <small>{formatDuration(stage.durationMs, stage.state)}</small>
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="ai-chat-agent-progress__ledger"
        aria-label="Agent activity"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {model.activities.length > 0 ? (
            model.activities.map((activity) => (
              <m.div
                className="ai-chat-agent-progress__event"
                data-state={activity.state}
                key={activity.key}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{ duration: reduceMotion ? 0.08 : 0.16 }}
              >
                <span className="ai-chat-agent-progress__event-icon">
                  {activity.state === "error" ||
                  activity.state === "blocked" ? (
                    <AlertCircle size={12} />
                  ) : activity.state === "done" ? (
                    <Check size={12} />
                  ) : (
                    <span />
                  )}
                </span>
                <span className="ai-chat-agent-progress__event-copy">
                  <strong>{activity.label}</strong>
                  {activity.meta ? <small>{activity.meta}</small> : null}
                </span>
              </m.div>
            ))
          ) : (
            <m.div
              className="ai-chat-agent-progress__event"
              data-state="active"
              key="backend-accepted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span className="ai-chat-agent-progress__event-icon">
                <span />
              </span>
              <span className="ai-chat-agent-progress__event-copy">
                <strong>Run accepted by backend</strong>
                <small>awaiting runtime event</small>
              </span>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
});
