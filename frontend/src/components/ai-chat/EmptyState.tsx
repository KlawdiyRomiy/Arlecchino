import React from "react";
import {
  Bug,
  ClipboardList,
  Hammer,
  MessageCircle,
  RefreshCw,
  SearchCheck,
} from "lucide-react";
import { m, useReducedMotion } from "framer-motion";
import { AIChatAction } from "../../../bindings/arlecchino/internal/ai/models";
import { minimalGeneralProfileId } from "./types";

interface EmptyStateProps {
  providerReady: boolean;
  onRefresh: () => void;
  onStarterSelect?: (
    action: AIChatAction,
    prompt: string,
    profileId?: string,
  ) => void;
}

interface EmptyStarter {
  action: AIChatAction;
  profileId?: string;
  icon: React.ReactNode;
  label: string;
  prompt: string;
}

const starters: EmptyStarter[] = [
  {
    action: AIChatAction.AIChatActionAsk,
    profileId: minimalGeneralProfileId,
    icon: <MessageCircle size={14} />,
    label: "Chat freely",
    prompt: "Let's just chat.",
  },
  {
    action: AIChatAction.AIChatActionPlan,
    icon: <ClipboardList size={14} />,
    label: "Plan a change",
    prompt: "Plan the next safe change for the current file.",
  },
  {
    action: AIChatAction.AIChatActionReview,
    icon: <SearchCheck size={14} />,
    label: "Review current file",
    prompt: "Review the current file for bugs and missing verification.",
  },
  {
    action: AIChatAction.AIChatActionDebug,
    icon: <Bug size={14} />,
    label: "Debug diagnostics",
    prompt: "Debug the current diagnostics and identify the root cause.",
  },
  {
    action: AIChatAction.AIChatActionBuild,
    icon: <Hammer size={14} />,
    label: "Build patch",
    prompt: "Prepare a narrow patch proposal for the current issue.",
  },
];

export function EmptyState({
  providerReady,
  onRefresh,
  onStarterSelect,
}: EmptyStateProps) {
  const reduceMotion = useReducedMotion();
  const starterTransition = {
    duration: reduceMotion ? 0.1 : 0.18,
    ease: [0.22, 1, 0.36, 1] as const,
  };
  return (
    <div className="ai-chat-empty">
      <div className="ai-chat-empty__icon">
        <MessageCircle size={34} />
      </div>
      <div className="ai-chat-empty__title">
        Start with chat or project context.
      </div>
      <div className="ai-chat-empty__subtitle">
        {providerReady
          ? "Runtime is ready."
          : "Connect a ready local provider to start."}
      </div>
      {providerReady ? (
        <div className="ai-chat-empty__starters" aria-label="AI Chat starters">
          {starters.map((starter) => (
            <m.button
              key={starter.action}
              className="ai-chat-empty__starter"
              layout
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 7 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              transition={starterTransition}
              type="button"
              onClick={() =>
                onStarterSelect?.(
                  starter.action,
                  starter.prompt,
                  starter.profileId,
                )
              }
              whileTap={reduceMotion ? undefined : { scale: 0.985 }}
            >
              {starter.icon}
              {starter.label}
            </m.button>
          ))}
        </div>
      ) : null}
      {!providerReady ? (
        <button
          className="ai-chat-ghost-button"
          type="button"
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
          Refresh providers
        </button>
      ) : null}
    </div>
  );
}
