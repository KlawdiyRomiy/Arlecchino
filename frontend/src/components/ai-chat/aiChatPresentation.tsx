import React from "react";
import { Bug, Hammer, HelpCircle, MessageCircle, Sparkles } from "lucide-react";
import { AIChatAction } from "../../../bindings/arlecchino/internal/ai/models";

export const modeOrder: AIChatAction[] = [
  AIChatAction.AIChatActionAsk,
  AIChatAction.AIChatActionPlan,
  AIChatAction.AIChatActionBuild,
  AIChatAction.AIChatActionDebug,
];

export interface AIChatActionMeta {
  label: string;
  shortLabel: string;
  tone: "ask" | "plan" | "build" | "debug";
  icon: React.ReactNode;
  description: string;
}

export const modeMeta: Partial<Record<AIChatAction, AIChatActionMeta>> = {
  [AIChatAction.AIChatActionAsk]: {
    label: "Ask",
    shortLabel: "ASK",
    tone: "ask",
    icon: <MessageCircle size={15} />,
    description: "Ask about the current codebase.",
  },
  [AIChatAction.AIChatActionPlan]: {
    label: "Plan",
    shortLabel: "PLAN",
    tone: "plan",
    icon: <Sparkles size={15} />,
    description: "Create an implementation plan.",
  },
  [AIChatAction.AIChatActionBuild]: {
    label: "Build",
    shortLabel: "BUILD",
    tone: "build",
    icon: <Hammer size={15} />,
    description: "Prepare a non-executable build proposal.",
  },
  [AIChatAction.AIChatActionDebug]: {
    label: "Debug",
    shortLabel: "DEBUG",
    tone: "debug",
    icon: <Bug size={15} />,
    description: "Analyze a failure or regression.",
  },
};

export function getActionMeta(action: AIChatAction): AIChatActionMeta {
  return (
    modeMeta[action] ?? {
      label: action || "Ask",
      shortLabel: (action || "ASK").toUpperCase(),
      tone: "ask",
      icon: <HelpCircle size={15} />,
      description: "Ask about the current codebase.",
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
