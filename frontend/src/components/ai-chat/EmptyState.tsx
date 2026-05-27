import React, { useMemo } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";

interface EmptyStateProps {
  providerReady: boolean;
  onRefresh: () => void;
  sessionId?: string;
}

const emptyStateCaptions = [
  "Want to build something?",
  "What are we making today?",
  "Ready when you are.",
  "I hope you have a wonderful day.",
  "Let's shape the next idea.",
  "What's on your mind?",
  "Small step or big plan?",
  "Time to make something useful.",
  "Tell me what we should explore.",
  "Let's start from one clear thought.",
] as const;

function captionIndexForSession(sessionId: string): number {
  const source = sessionId.trim() || "default";
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash % emptyStateCaptions.length;
}

export function EmptyState({
  providerReady,
  onRefresh,
  sessionId = "",
}: EmptyStateProps) {
  const caption = useMemo(
    () => emptyStateCaptions[captionIndexForSession(sessionId)],
    [sessionId],
  );

  return (
    <div className="ai-chat-empty">
      <div className="ai-chat-empty__icon">
        <MessageCircle size={34} />
      </div>
      <div className="ai-chat-empty__title">{caption}</div>
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
