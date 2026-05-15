import React from "react";
import { CheckCircle2, RefreshCw, TestTube2 } from "lucide-react";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import { getProviderPresentation } from "./providerPresentation";

interface ProviderPopoverProps {
  providers: AIProviderDescriptor[];
  selectedProviderId: string;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onRefresh: () => void;
  onTest: () => void;
}

export function ProviderPopover({
  providers,
  selectedProviderId,
  onSelectProvider,
  onRefresh,
  onTest,
}: ProviderPopoverProps) {
  return (
    <div
      className="ai-chat-popover ai-chat-provider-popover"
      data-testid="ai-chat-provider-popover"
    >
      <div className="ai-chat-popover__title">Providers</div>
      <div className="ai-chat-provider-list">
        {providers.map((provider) => {
          const presentation = getProviderPresentation(provider);
          const selected = provider.id === selectedProviderId;
          return (
            <button
              key={provider.id}
              className={`ai-chat-provider-row is-${presentation.tone}${selected ? " is-selected" : ""}`}
              type="button"
              disabled={!presentation.selectable}
              title={presentation.rawReason || presentation.subtitle}
              onClick={() => onSelectProvider(provider)}
            >
              <span className="ai-chat-provider-row__dot" />
              <span className="ai-chat-provider-row__body">
                <span className="ai-chat-provider-row__name">
                  {presentation.title}
                </span>
                <span className="ai-chat-provider-row__detail">
                  {presentation.subtitle}
                </span>
              </span>
              {selected ? <CheckCircle2 size={15} /> : null}
            </button>
          );
        })}
      </div>

      <div className="ai-chat-provider-popover__actions">
        <button
          className="ai-chat-secondary-button"
          type="button"
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
        <button
          className="ai-chat-secondary-button"
          type="button"
          onClick={onTest}
        >
          <TestTube2 size={15} />
          Test
        </button>
      </div>
    </div>
  );
}
