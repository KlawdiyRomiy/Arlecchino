import React from "react";
import { Paperclip, Send, Square } from "lucide-react";
import type { AIChatAction } from "../../../bindings/arlecchino/internal/ai/models";
import { getActionMeta, modeOrder } from "./aiChatPresentation";

interface ChatComposerProps {
  selectedAction: AIChatAction;
  input: string;
  canSend: boolean;
  running: boolean;
  disabledReason: string;
  onActionChange: (action: AIChatAction) => void;
  onInputChange: (value: string) => void;
  onRefreshContext: () => void;
  onSend: () => void;
  onCancel: () => void;
}

export function ChatComposer({
  selectedAction,
  input,
  canSend,
  running,
  disabledReason,
  onActionChange,
  onInputChange,
  onRefreshContext,
  onSend,
  onCancel,
}: ChatComposerProps) {
  return (
    <footer className="ai-chat-composer">
      <div
        className="ai-chat-mode-switch"
        role="tablist"
        aria-label="AI chat mode"
      >
        {modeOrder.map((action) => {
          const meta = getActionMeta(action);
          const selected = selectedAction === action;
          return (
            <button
              key={action}
              className={`ai-chat-mode-button ai-chat-tone-${meta.tone}${selected ? " is-selected" : ""}`}
              data-testid={`ai-chat-mode-${meta.label.toLowerCase()}`}
              type="button"
              aria-selected={selected}
              role="tab"
              title={meta.description}
              onClick={() => onActionChange(action)}
            >
              {meta.icon}
              {meta.shortLabel}
            </button>
          );
        })}
      </div>

      <div className="ai-chat-composer__box">
        <textarea
          className="ai-chat-composer__textarea"
          data-testid="ai-chat-input"
          placeholder={disabledReason || "Ask, plan, build, or debug..."}
          rows={3}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <div className="ai-chat-composer__controls">
          <span className="ai-chat-composer__reason">{disabledReason}</span>
          <div className="ai-chat-composer__buttons">
            <button
              className="ai-chat-icon-button"
              type="button"
              title="Attach runtime context"
              onClick={onRefreshContext}
            >
              <Paperclip size={17} />
            </button>
            {running ? (
              <button
                className="ai-chat-send-button is-stop"
                type="button"
                title="Stop run"
                onClick={onCancel}
              >
                <Square size={17} />
              </button>
            ) : (
              <button
                className="ai-chat-send-button"
                data-testid="ai-chat-send"
                type="button"
                disabled={!canSend}
                title={canSend ? "Send" : disabledReason}
                onClick={onSend}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
