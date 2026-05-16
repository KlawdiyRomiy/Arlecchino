import React, { useRef } from "react";
import { Paperclip, Send, Square } from "lucide-react";
import type {
  AIChatAction,
  AIChatActionDescriptor,
  AIContextProviderDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type { AIChatSendShortcut } from "../../stores/editorSettingsStore";
import type {
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import { ContextPickerMenu } from "./ContextPickerMenu";
import { getActionMeta, modeOrder } from "./aiChatPresentation";
import { ModelPicker } from "./ModelPicker";
import type { ContextToggles } from "./types";

interface ChatComposerProps {
  selectedAction: AIChatAction;
  actions: AIChatActionDescriptor[];
  input: string;
  canSend: boolean;
  running: boolean;
  disabledReason: string;
  sendShortcut: AIChatSendShortcut;
  providers: AIProviderDescriptor[];
  selectedProvider: AIProviderDescriptor | null;
  selectedModel: string;
  providerRuntimes: AIProviderRuntimeDescriptor[];
  providerRuntimeBusy: boolean;
  providerRuntimeError: string;
  context: ContextToggles;
  contextProviders: AIContextProviderDescriptor[];
  contextPickerOpen: boolean;
  onActionChange: (action: AIChatAction) => void;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onSelectModel: (modelId: string) => void;
  onRefreshProviders: () => void;
  onStartProviderRuntime: (
    provider: AIProviderDescriptor,
    model: AIProviderRuntimeModel,
  ) => void;
  onStopProviderRuntime: (providerId: string) => void;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onInputChange: (value: string) => void;
  onRefreshContext: () => void;
  onToggleContextPicker: () => void;
  onSend: () => void;
  onCancel: () => void;
}

const actionIndex = (action: AIChatAction): number => {
  const index = modeOrder.indexOf(action);
  return index === -1 ? modeOrder.length : index;
};

const sortActionDescriptors = (
  descriptors: AIChatActionDescriptor[],
): AIChatActionDescriptor[] => {
  const sorted = Array.from(descriptors);
  sorted.sort((left, right) => actionIndex(left.id) - actionIndex(right.id));
  return sorted;
};

export function ChatComposer({
  selectedAction,
  actions,
  input,
  canSend,
  running,
  disabledReason,
  sendShortcut,
  providers,
  selectedProvider,
  selectedModel,
  providerRuntimes,
  providerRuntimeBusy,
  providerRuntimeError,
  context,
  contextProviders,
  contextPickerOpen,
  onActionChange,
  onSelectProvider,
  onSelectModel,
  onRefreshProviders,
  onStartProviderRuntime,
  onStopProviderRuntime,
  onContextToggle,
  onInputChange,
  onRefreshContext,
  onToggleContextPicker,
  onSend,
  onCancel,
}: ChatComposerProps) {
  const modeButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const actionDescriptors =
    actions.length > 0
      ? sortActionDescriptors(actions)
      : modeOrder.map(
          (action) =>
            ({
              id: action,
              name: getActionMeta(action).label,
              description: getActionMeta(action).description,
              builtIn: true,
              mayProposeTools: action === "build",
              expectsToolProposals: action === "build",
              readOnlyIntent: action !== "build",
              showPlanStructure: action === "plan",
              executionUnavailable: action === "build",
            }) as AIChatActionDescriptor,
        );

  const handleModeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "Tab") return;

    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex =
      (index + direction + actionDescriptors.length) % actionDescriptors.length;
    const nextAction = actionDescriptors[nextIndex]?.id;
    if (!nextAction) return;
    onActionChange(nextAction);
    modeButtonRefs.current[nextIndex]?.focus();
  };

  const cycleMode = (direction: 1 | -1) => {
    const currentIndex = actionDescriptors.findIndex(
      (descriptor) => descriptor.id === selectedAction,
    );
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      (baseIndex + direction + actionDescriptors.length) %
      actionDescriptors.length;
    const nextAction = actionDescriptors[nextIndex]?.id;
    if (nextAction) {
      onActionChange(nextAction);
    }
  };

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (running) {
        onCancel();
        return;
      }
      if (input) {
        onInputChange("");
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      cycleMode(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    const modPressed = event.metaKey || event.ctrlKey;
    const shouldSend =
      sendShortcut === "enter"
        ? !event.altKey && !modPressed
        : modPressed && !event.altKey;
    if (!shouldSend) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <footer className="ai-chat-composer">
      <div
        className="ai-chat-mode-switch"
        role="tablist"
        aria-label="AI chat mode"
      >
        {actionDescriptors.map((descriptor, index) => {
          const meta = getActionMeta(descriptor.id);
          const selected = selectedAction === descriptor.id;
          return (
            <button
              key={descriptor.id}
              className={`ai-chat-mode-button ai-chat-tone-${meta.tone}${selected ? " is-selected" : ""}`}
              data-testid={`ai-chat-mode-${(descriptor.name || meta.label).toLowerCase()}`}
              type="button"
              aria-selected={selected}
              ref={(element) => {
                modeButtonRefs.current[index] = element;
              }}
              role="tab"
              title={descriptor.description || meta.description}
              onClick={() => onActionChange(descriptor.id)}
              onKeyDown={(event) => handleModeKeyDown(event, index)}
            >
              {meta.icon}
              {descriptor.name || meta.label}
            </button>
          );
        })}
        <ContextPickerMenu
          context={context}
          contextProviders={contextProviders}
          open={contextPickerOpen}
          onContextToggle={onContextToggle}
          onToggle={onToggleContextPicker}
        />
      </div>

      <div className="ai-chat-composer__box">
        <textarea
          className="ai-chat-composer__textarea"
          data-testid="ai-chat-input"
          placeholder={disabledReason || "Ask, plan, build, or debug..."}
          rows={3}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleComposerKeyDown}
        />
        <div className="ai-chat-composer__controls">
          <div className="ai-chat-composer__meta">
            <ModelPicker
              providerRuntimeBusy={providerRuntimeBusy}
              providerRuntimeError={providerRuntimeError}
              providerRuntimes={providerRuntimes}
              providers={providers}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
              onRefreshProviders={onRefreshProviders}
              onSelectModel={onSelectModel}
              onSelectProvider={onSelectProvider}
              onStartProviderRuntime={onStartProviderRuntime}
              onStopProviderRuntime={onStopProviderRuntime}
            />
            {disabledReason ? (
              <span className="ai-chat-composer__reason">{disabledReason}</span>
            ) : null}
          </div>
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
