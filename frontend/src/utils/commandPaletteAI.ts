import type { AIChatAction } from "../../bindings/arlecchino/internal/ai/models";

export type AICommandPaletteActionId =
  | "ai.newChat"
  | "ai.selectAction"
  | "ai.startFromInput"
  | "ai.pendingApprovals"
  | "ai.cancelActiveRun"
  | "ai.approvalSettings";

export interface AICommandPalettePayload {
  action?: AIChatAction;
  input?: string;
  prompt?: string;
  workflowId?: string;
  workflowSlash?: string;
  profileId?: string;
}

export interface AIChatCommandIntent {
  id: string;
  actionId: AICommandPaletteActionId;
  projectScopeKey: string;
  action?: AIChatAction;
  prompt?: string;
  workflowId?: string;
  workflowSlash?: string;
  profileId?: string;
  createdAt: number;
}

export interface AIWorkflowMode {
  slash: string;
  action: AIChatAction;
  workflowId: string;
  profileId: string;
  label: string;
  description: string;
}

const AI_CHAT_ACTION_ASK = "ask" as AIChatAction;
const AI_CHAT_ACTION_DEBUG = "debug" as AIChatAction;
const AI_CHAT_ACTION_PLAN = "plan" as AIChatAction;
const AI_CHAT_ACTION_BUILD = "build" as AIChatAction;
const AI_CHAT_ACTION_REVIEW = "review" as AIChatAction;

export const AI_WORKFLOW_MODES: AIWorkflowMode[] = [
  {
    slash: "/chat",
    action: AI_CHAT_ACTION_ASK,
    workflowId: "slash-chat",
    profileId: "ask-readonly",
    label: "Chat",
    description: "Chat with visible project context.",
  },
  {
    slash: "/plan",
    action: AI_CHAT_ACTION_PLAN,
    workflowId: "slash-plan",
    profileId: "plan-architect",
    label: "Plan",
    description: "Create a read-only implementation plan.",
  },
  {
    slash: "/debug",
    action: AI_CHAT_ACTION_DEBUG,
    workflowId: "slash-debug",
    profileId: "debug-operator",
    label: "Debug",
    description: "Investigate failures with evidence.",
  },
  {
    slash: "/build",
    action: AI_CHAT_ACTION_BUILD,
    workflowId: "slash-build",
    profileId: "build-reviewer",
    label: "Build",
    description: "Draft approval-gated implementation work.",
  },
  {
    slash: "/review",
    action: AI_CHAT_ACTION_REVIEW,
    workflowId: "slash-review",
    profileId: "review-auditor",
    label: "Review",
    description: "Review current changes without mutation.",
  },
];

const AI_WORKFLOW_PARSE_ALIASES: AIWorkflowMode[] = [
  {
    slash: "/ask",
    action: AI_CHAT_ACTION_ASK,
    workflowId: "slash-ask",
    profileId: "ask-readonly",
    label: "Chat",
    description: "Chat with visible project context.",
  },
  {
    slash: "/general",
    action: AI_CHAT_ACTION_ASK,
    workflowId: "slash-general",
    profileId: "minimal-general",
    label: "Chat",
    description: "Chat without implicit project context.",
  },
];

const AI_WORKFLOW_PARSE_MODES = [
  ...AI_WORKFLOW_MODES,
  ...AI_WORKFLOW_PARSE_ALIASES,
];

export type ParsedAICommandInput =
  | { kind: "invalid"; reason: string }
  | { kind: "empty" }
  | { kind: "unknown-mode"; mode: string }
  | { kind: "empty-prompt"; mode: AIWorkflowMode }
  | {
      kind: "start";
      prompt: string;
      mode: AIWorkflowMode;
    };

export const isAICommandInput = (input: string): boolean =>
  /^@ai(?:\s|$)/i.test(input.trim());

export function parseAICommandInput(input: string): ParsedAICommandInput {
  const trimmed = input.trim();
  if (!isAICommandInput(trimmed)) {
    return { kind: "invalid", reason: "AI command must start with @ai." };
  }

  const body = trimmed.replace(/^@ai(?:\s+)?/i, "").trim();
  if (!body) {
    return { kind: "empty" };
  }

  const firstToken = body.split(/\s+/, 1)[0] ?? "";
  if (firstToken.startsWith("/")) {
    const mode = AI_WORKFLOW_PARSE_MODES.find(
      (candidate) => candidate.slash === firstToken.toLowerCase(),
    );
    if (!mode) {
      return { kind: "unknown-mode", mode: firstToken };
    }

    const prompt = body.slice(firstToken.length).trim();
    if (!prompt) {
      return { kind: "empty-prompt", mode };
    }

    return { kind: "start", mode, prompt };
  }

  const chatMode = AI_WORKFLOW_MODES.find((mode) => mode.slash === "/chat");
  if (!chatMode) {
    return { kind: "invalid", reason: "Chat workflow is unavailable." };
  }
  return { kind: "start", mode: chatMode, prompt: body };
}

export function createAIChatCommandIntent(
  actionId: AICommandPaletteActionId,
  payload: AICommandPalettePayload = {},
  projectScopeKey = "",
): AIChatCommandIntent {
  const parsed =
    actionId === "ai.startFromInput" && payload.input
      ? parseAICommandInput(payload.input)
      : null;
  const startPayload =
    parsed?.kind === "start"
      ? {
          action: parsed.mode.action,
          prompt: parsed.prompt,
          workflowId: parsed.mode.workflowId,
          workflowSlash: parsed.mode.slash,
          profileId: parsed.mode.profileId,
        }
      : payload;

  return {
    id: `ai-command-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actionId,
    projectScopeKey: projectScopeKey.trim(),
    action: startPayload.action,
    prompt: startPayload.prompt,
    workflowId: startPayload.workflowId,
    workflowSlash: startPayload.workflowSlash,
    profileId: startPayload.profileId,
    createdAt: Date.now(),
  };
}
