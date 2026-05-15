import React, { useRef } from "react";
import { CheckCircle2, Paperclip, Plus, Send, Square } from "lucide-react";
import type {
  AIChatAction,
  AIContextProviderDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import { getActionMeta, modeOrder } from "./aiChatPresentation";
import type { ContextToggles } from "./types";

interface ChatComposerProps {
  selectedAction: AIChatAction;
  input: string;
  canSend: boolean;
  running: boolean;
  disabledReason: string;
  context: ContextToggles;
  contextProviders: AIContextProviderDescriptor[];
  contextPickerOpen: boolean;
  onActionChange: (action: AIChatAction) => void;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onInputChange: (value: string) => void;
  onRefreshContext: () => void;
  onToggleContextPicker: () => void;
  onSend: () => void;
  onCancel: () => void;
}

const contextRows: Array<{ key: keyof ContextToggles; label: string }> = [
  { key: "workspace", label: "Workspace" },
  { key: "currentFile", label: "Current file" },
  { key: "terminalLogs", label: "Terminal logs" },
  { key: "mnemonic", label: "Mnemonic" },
  { key: "mcp", label: "MCP" },
  { key: "skills", label: "Skills" },
];

export function ChatComposer({
  selectedAction,
  input,
  canSend,
  running,
  disabledReason,
  context,
  contextProviders,
  contextPickerOpen,
  onActionChange,
  onContextToggle,
  onInputChange,
  onRefreshContext,
  onToggleContextPicker,
  onSend,
  onCancel,
}: ChatComposerProps) {
  const modeButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleModeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "Tab") return;

    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = (index + direction + modeOrder.length) % modeOrder.length;
    const nextAction = modeOrder[nextIndex];
    onActionChange(nextAction);
    modeButtonRefs.current[nextIndex]?.focus();
  };

  return (
    <footer className="ai-chat-composer">
      <div
        className="ai-chat-mode-switch"
        role="tablist"
        aria-label="AI chat mode"
      >
        {modeOrder.map((action, index) => {
          const meta = getActionMeta(action);
          const selected = selectedAction === action;
          return (
            <button
              key={action}
              className={`ai-chat-mode-button ai-chat-tone-${meta.tone}${selected ? " is-selected" : ""}`}
              data-testid={`ai-chat-mode-${meta.label.toLowerCase()}`}
              type="button"
              aria-selected={selected}
              ref={(element) => {
                modeButtonRefs.current[index] = element;
              }}
              role="tab"
              title={meta.description}
              onClick={() => onActionChange(action)}
              onKeyDown={(event) => handleModeKeyDown(event, index)}
            >
              {meta.icon}
              {meta.label}
            </button>
          );
        })}
        <div className="ai-chat-context-menu" data-ai-chat-popover-scope>
          <button
            className={`ai-chat-mode-button ai-chat-add-button${contextPickerOpen ? " is-selected" : ""}`}
            data-testid="ai-chat-context-picker-button"
            type="button"
            aria-expanded={contextPickerOpen}
            title="Add agent or skill context"
            onClick={onToggleContextPicker}
          >
            <Plus size={15} />
            Add
          </button>
          {contextPickerOpen ? (
            <div
              className="ai-chat-popover ai-chat-context-picker"
              data-testid="ai-chat-context-picker"
            >
              <div className="ai-chat-popover__title">Add context</div>
              <div className="ai-chat-context-picker__toggles">
                {contextRows.map((row) => (
                  <label className="ai-chat-toggle-row" key={row.key}>
                    <span>{row.label}</span>
                    <input
                      checked={context[row.key]}
                      type="checkbox"
                      onChange={(event) =>
                        onContextToggle(row.key, event.target.checked)
                      }
                    />
                  </label>
                ))}
              </div>
              {contextProviders.length > 0 ? (
                <div className="ai-chat-popover__section">
                  <div className="ai-chat-popover__title">
                    Runtime providers
                  </div>
                  <div className="ai-chat-context-provider-list">
                    {contextProviders.map((provider) => (
                      <span
                        className="ai-chat-context-provider"
                        key={provider.id}
                        title={provider.description}
                      >
                        <span
                          className={`ai-chat-context-provider__dot is-${
                            provider.enabled && provider.available
                              ? "ready"
                              : "disabled"
                          }`}
                        />
                        {provider.name || provider.id}
                        {provider.id === "skills" ||
                        provider.name === "Skills" ? (
                          <CheckCircle2 size={12} />
                        ) : null}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
