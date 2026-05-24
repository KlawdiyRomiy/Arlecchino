import React from "react";
import {
  Bug,
  ClipboardList,
  Hammer,
  HelpCircle,
  MessageCircle,
  SearchCheck,
} from "lucide-react";
import {
  AIChatAction,
  AIChatRunArtifactKind,
  type AIChatRunArtifact,
  type AIRunTimelineEvent,
} from "../../../bindings/arlecchino/internal/ai/models";

export const modeOrder: AIChatAction[] = [
  AIChatAction.AIChatActionAsk,
  AIChatAction.AIChatActionPlan,
  AIChatAction.AIChatActionBuild,
  AIChatAction.AIChatActionDebug,
  AIChatAction.AIChatActionReview,
];

export interface AIChatActionMeta {
  label: string;
  shortLabel: string;
  tone: "ask" | "plan" | "build" | "debug" | "review";
  icon: React.ReactNode;
  description: string;
}

export const modeMeta: Partial<Record<AIChatAction, AIChatActionMeta>> = {
  [AIChatAction.AIChatActionAsk]: {
    label: "Chat",
    shortLabel: "Chat",
    tone: "ask",
    icon: <MessageCircle size={15} />,
    description: "Chat with the default project context.",
  },
  [AIChatAction.AIChatActionPlan]: {
    label: "Plan",
    shortLabel: "Plan",
    tone: "plan",
    icon: <ClipboardList size={15} />,
    description: "Inspect read-only context and produce a plan.",
  },
  [AIChatAction.AIChatActionBuild]: {
    label: "Build",
    shortLabel: "Build",
    tone: "build",
    icon: <Hammer size={15} />,
    description: "Prepare approval-gated patch artifacts.",
  },
  [AIChatAction.AIChatActionDebug]: {
    label: "Debug",
    shortLabel: "Debug",
    tone: "debug",
    icon: <Bug size={15} />,
    description: "Diagnose failures without writing files.",
  },
  [AIChatAction.AIChatActionReview]: {
    label: "Review",
    shortLabel: "Review",
    tone: "review",
    icon: <SearchCheck size={15} />,
    description: "Find defects and missing verification.",
  },
};

export function getActionMeta(action: AIChatAction): AIChatActionMeta {
  return (
    modeMeta[action] ?? {
      label: action || "Ask",
      shortLabel: action || "Ask",
      tone: "ask",
      icon: <HelpCircle size={15} />,
      description: "Answer with provided context only.",
    }
  );
}

export function formatRunTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function compactText(value: string, max = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}...`;
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Streaming";
    case "completed":
      return "Completed";
    case "error":
      return "Error";
    case "canceled":
      return "Canceled";
    default:
      return status || "Unknown";
  }
}

export interface AIChatActivityLabelInput {
  status?: string;
  activeText?: string;
  contextItems?: Array<{ kind?: string; included?: boolean }>;
  elapsedMs?: number;
  timelineEvents?: AIRunTimelineEvent[];
  artifacts?: AIChatRunArtifact[];
  toolProposalCount?: number;
  artifactBusyId?: string | null;
  mnemonicBusy?: boolean;
}

const includesAny = (value: string, terms: string[]): boolean =>
  terms.some((term) => value.includes(term));

const isCompletedTimelineStatus = (value: string): boolean =>
  includesAny(value, [
    "completed",
    "succeeded",
    "success",
    "done",
    "executed",
    "previewed",
    "included",
    "metadata_ready",
    "proposed",
    "recorded",
  ]);

const isBlockedTimelineStatus = (value: string): boolean =>
  includesAny(value, ["approval", "blocked", "denied", "required", "waiting"]);

const isNoisyTimelineEvent = (event: AIRunTimelineEvent): boolean => {
  const haystack =
    `${event.source || ""} ${event.type || ""} ${event.status || ""} ${event.summary || ""}`.toLocaleLowerCase();
  return includesAny(haystack, [
    "message.delta",
    "transcript delta",
    "reasoning delta",
    "stream_closed",
  ]);
};

const latestMeaningfulTimelineEvent = (
  events: AIRunTimelineEvent[] = [],
): AIRunTimelineEvent | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || isNoisyTimelineEvent(event)) continue;
    return event;
  }
  return null;
};

const latestMemoryArtifact = (
  artifacts: AIChatRunArtifact[] = [],
): AIChatRunArtifact | null => {
  const memoryArtifacts = artifacts.filter(
    (artifact) =>
      artifact.kind === AIChatRunArtifactKind.AIChatRunArtifactMemory,
  );
  if (memoryArtifacts.length === 0) return null;
  return [...memoryArtifacts].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
    const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
    return (
      (Number.isFinite(leftTime) ? leftTime : 0) -
      (Number.isFinite(rightTime) ? rightTime : 0)
    );
  })[memoryArtifacts.length - 1];
};

export function memoryArtifactActivityLabel(
  artifact: AIChatRunArtifact | null,
  artifactBusyId?: string | null,
): string {
  if (!artifact) return "";
  if (artifactBusyId === artifact.id) return "Mnemonic: saving memory";
  switch ((artifact.status || "").toLocaleLowerCase()) {
    case "proposed":
      return "Mnemonic: memory ready to save";
    case "approved":
      return "Mnemonic: memory saved";
    case "recorded":
      return "Mnemonic: memory recorded";
    default:
      return `Mnemonic: ${artifact.status || "memory updated"}`;
  }
}

export function timelineEventActivityLabel(
  event: AIRunTimelineEvent | null,
): string {
  if (!event) return "";
  const source = event.source || "";
  const type = event.type || "";
  const status = event.status || "";
  const summary = event.summary || "";
  const haystack = `${source} ${type} ${status} ${summary}`.toLocaleLowerCase();
  const completed = isCompletedTimelineStatus(haystack);
  const compactSummary = summary ? compactText(summary, 72) : "";

  if (
    source === "artifact" &&
    includesAny(haystack, ["mnemonic", "memory", "write proposal"])
  ) {
    if (status === "proposed") return "Mnemonic: memory ready to save";
    if (status === "approved") return "Mnemonic: memory saved";
    return "Mnemonic: memory recorded";
  }
  if (includesAny(haystack, ["mnemonic_context"])) {
    if (status === "included")
      return compactSummary || "Mnemonic: memory included";
    if (status === "empty") return "Mnemonic: no matching memory";
    if (status === "disabled") return "Mnemonic: disabled";
    return compactSummary || "Mnemonic: checking memory";
  }
  if (includesAny(haystack, ["memory_search"])) {
    if (status === "disabled") return "Mnemonic: disabled";
    if (status === "empty") return "Mnemonic: no matching memory";
    return completed
      ? "Mnemonic: memory search complete"
      : "Mnemonic: searching memory";
  }
  if (includesAny(haystack, ["memory_context"])) {
    if (status === "disabled") return "Mnemonic: disabled";
    if (status === "empty") return "Mnemonic: no memory context";
    return completed
      ? "Mnemonic: memory context ready"
      : "Mnemonic: reading memory";
  }
  if (includesAny(haystack, ["memory_propose_save"])) {
    if (status === "blocked" || status === "error")
      return "Mnemonic: save blocked";
    return completed
      ? "Mnemonic: memory ready to save"
      : "Mnemonic: preparing memory save";
  }
  if (includesAny(haystack, ["mcp_tools_degraded"])) {
    return "MCP: runtime bridge unavailable";
  }
  if (includesAny(haystack, ["mcp_context"])) {
    if (status === "metadata_ready")
      return compactSummary || "MCP: metadata ready";
    if (includesAny(status, ["unavailable", "degraded"])) {
      return compactSummary || "MCP: unavailable";
    }
    return compactSummary || "MCP: checking tools";
  }
  if (includesAny(haystack, ["agent_memory.", "memory-write tool call"])) {
    return completed ? "MCP: memory tool complete" : "MCP: using memory tool";
  }
  if (includesAny(haystack, ["mcp"])) {
    return completed ? "MCP: tool call complete" : "MCP: using tool";
  }
  if (isBlockedTimelineStatus(haystack)) return "Waiting for approval";
  if (includesAny(haystack, ["command", "exec", "shell"])) {
    return completed ? "Command completed" : "Running command";
  }
  if (includesAny(haystack, ["file_change", "applypatch", "patch", "diff"])) {
    return completed ? "File change prepared" : "Preparing file change";
  }
  if (includesAny(haystack, ["read file", "read_file", "open file", "file"])) {
    return completed ? "File read" : "Reading file";
  }
  if (includesAny(haystack, ["tool"])) {
    return completed ? "Tool call completed" : "Using tool";
  }
  if (includesAny(haystack, ["auth"])) return "Authenticating agent";
  if (includesAny(haystack, ["runtime_proof", "thread", "turn/started"])) {
    return "Starting agent runtime";
  }
  if (includesAny(haystack, ["turn/completed", "completed"])) {
    return "Finalizing response";
  }
  const usefulSummary =
    summary &&
    !includesAny(summary.toLocaleLowerCase(), [
      "event received",
      "delta received",
    ]);
  return usefulSummary ? compactText(summary, 72) : "";
}

export function runActivityLabel({
  status = "",
  activeText = "",
  contextItems = [],
  elapsedMs = 0,
  timelineEvents = [],
  artifacts = [],
  toolProposalCount = 0,
  artifactBusyId = null,
  mnemonicBusy = false,
}: AIChatActivityLabelInput): string {
  if (status === "queued") return "Queued";
  if (status !== "running") return runStatusLabel(status);
  if (activeText.trim()) return "Writing response";
  if (mnemonicBusy) return "Mnemonic: updating memory";
  const memoryLabel = memoryArtifactActivityLabel(
    latestMemoryArtifact(artifacts),
    artifactBusyId,
  );
  if (memoryLabel) return memoryLabel;
  const timelineLabel = timelineEventActivityLabel(
    latestMeaningfulTimelineEvent(timelineEvents),
  );
  if (timelineLabel) return timelineLabel;
  if (toolProposalCount > 0) return "Waiting for tool review";
  if (elapsedMs >= 4000) return "Thinking";
  void contextItems;
  return "Thinking";
}
