import React from "react";
import {
  Bot,
  ChevronDown,
  Loader2,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIContextProviderDescriptor,
  AIStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIChatDisplayPrefs, ContextToggles } from "./types";
import { getProviderPresentation } from "./providerPresentation";
import { ProviderPopover } from "./ProviderPopover";
import { SettingsPopover } from "./SettingsPopover";

interface AIChatHeaderProps {
  loading: boolean;
  status: AIStatus | null;
  selectedProvider: AIProviderDescriptor | null;
  selectedProviderId: string;
  providers: AIProviderDescriptor[];
  secretDraft: string;
  providerPopoverOpen: boolean;
  settingsPopoverOpen: boolean;
  context: ContextToggles;
  displayPrefs: AIChatDisplayPrefs;
  contextProviders: AIContextProviderDescriptor[];
  onNewChat: () => void;
  onRefreshRuntime: () => void;
  onToggleProviderPopover: () => void;
  onToggleSettingsPopover: () => void;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onRefreshProviders: () => void;
  onTestProvider: () => void;
  onSecretChange: (value: string) => void;
  onSaveSecret: () => void;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onDisplayPrefChange: (key: keyof AIChatDisplayPrefs, value: boolean) => void;
}

export function AIChatHeader({
  loading,
  status,
  selectedProvider,
  selectedProviderId,
  providers,
  secretDraft,
  providerPopoverOpen,
  settingsPopoverOpen,
  context,
  displayPrefs,
  contextProviders,
  onNewChat,
  onRefreshRuntime,
  onToggleProviderPopover,
  onToggleSettingsPopover,
  onSelectProvider,
  onRefreshProviders,
  onTestProvider,
  onSecretChange,
  onSaveSecret,
  onContextToggle,
  onDisplayPrefChange,
}: AIChatHeaderProps) {
  const provider = getProviderPresentation(selectedProvider);

  return (
    <header className="ai-chat-header">
      <div className="ai-chat-header__title">
        <Bot size={17} />
        <span>AI Chat</span>
        {status?.enabled ? (
          <span className="ai-chat-header__status is-ready">Ready</span>
        ) : null}
      </div>

      <div className="ai-chat-header__actions">
        <button
          className="ai-chat-icon-button"
          type="button"
          title="New chat"
          onClick={onNewChat}
        >
          <Trash2 size={16} />
        </button>
        <button
          className="ai-chat-icon-button"
          type="button"
          title="Refresh runtime"
          onClick={onRefreshRuntime}
        >
          {loading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
        </button>

        <div className="ai-chat-header__menu">
          <button
            className="ai-chat-provider-button"
            data-testid="ai-chat-provider-button"
            type="button"
            title={provider.rawReason || provider.subtitle}
            onClick={onToggleProviderPopover}
          >
            <span className={`ai-chat-status-dot is-${provider.tone}`} />
            <span className="ai-chat-provider-button__body">
              <span>{provider.title}</span>
              <small>{provider.subtitle}</small>
            </span>
            <ChevronDown size={15} />
          </button>
          {providerPopoverOpen ? (
            <ProviderPopover
              providers={providers}
              secretDraft={secretDraft}
              selectedProviderId={selectedProviderId}
              onRefresh={onRefreshProviders}
              onSaveSecret={onSaveSecret}
              onSecretChange={onSecretChange}
              onSelectProvider={onSelectProvider}
              onTest={onTestProvider}
            />
          ) : null}
        </div>

        <div className="ai-chat-header__menu">
          <button
            className="ai-chat-icon-button"
            data-testid="ai-chat-settings-button"
            type="button"
            title="AI Chat settings"
            onClick={onToggleSettingsPopover}
          >
            <Settings size={17} />
          </button>
          {settingsPopoverOpen ? (
            <SettingsPopover
              context={context}
              contextProviders={contextProviders}
              displayPrefs={displayPrefs}
              onContextToggle={onContextToggle}
              onDisplayPrefChange={onDisplayPrefChange}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
