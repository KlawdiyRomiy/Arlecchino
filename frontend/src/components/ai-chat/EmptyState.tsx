import React from "react";
import { MessageCircle, RefreshCw } from "lucide-react";

interface EmptyStateProps {
  providerReady: boolean;
  onRefresh: () => void;
}

export function EmptyState({ providerReady, onRefresh }: EmptyStateProps) {
  return (
    <div className="ai-chat-empty">
      <div className="ai-chat-empty__icon">
        <MessageCircle size={34} />
      </div>
      <div className="ai-chat-empty__title">
        Ask anything about your codebase.
      </div>
      <div className="ai-chat-empty__subtitle">
        {providerReady
          ? "Runtime is ready."
          : "Connect a ready local provider to start."}
      </div>
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
