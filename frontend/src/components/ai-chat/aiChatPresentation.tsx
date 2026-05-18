import React from "react";
import {
  Bug,
  ClipboardList,
  Hammer,
  HelpCircle,
  MessageCircle,
} from "lucide-react";
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
    shortLabel: "Ask",
    tone: "ask",
    icon: <MessageCircle size={15} />,
    description: "Answer with provided context only.",
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
    description: "Prepare a non-executable build proposal.",
  },
  [AIChatAction.AIChatActionDebug]: {
    label: "Debug",
    shortLabel: "Debug",
    tone: "debug",
    icon: <Bug size={15} />,
    description: "Diagnose failures without writing files.",
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
}

export function runActivityLabel({
  status = "",
  activeText = "",
  contextItems = [],
  elapsedMs = 0,
}: AIChatActivityLabelInput): string {
  if (status === "queued") return "Queued";
  if (status !== "running") return runStatusLabel(status);
  if (activeText.trim()) return "Writing response";
  if (elapsedMs >= 4000) return "Thinking";
  void contextItems;
  return "Thinking";
}
