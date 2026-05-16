import React from "react";
import {
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Settings,
} from "lucide-react";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIAgentProfileDescriptor,
  AIApprovalPolicy,
  AIConsentPolicy,
  AIContextProviderDescriptor,
  AIEmbeddingStatus,
  AIEgressRecord,
  AIMnemonicEntry,
  AIPromptWorkflowDescriptor,
  AIStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIChatDisplayPrefs, ContextToggles } from "./types";
import { getProviderPresentation } from "./providerPresentation";
import { ProviderPopover } from "./ProviderPopover";
import { SettingsPopover } from "./SettingsPopover";

interface AIChatHeaderProps {
  loading: boolean;
  selectedProvider: AIProviderDescriptor | null;
  selectedProviderId: string;
  providers: AIProviderDescriptor[];
  providerPopoverOpen: boolean;
  settingsPopoverOpen: boolean;
  context: ContextToggles;
  displayPrefs: AIChatDisplayPrefs;
  contextProviders: AIContextProviderDescriptor[];
  status: AIStatus | null;
  approvalPolicy: AIApprovalPolicy | null;
  consentPolicy: AIConsentPolicy | null;
  embeddingStatus: AIEmbeddingStatus | null;
  egressRecords: AIEgressRecord[];
  mnemonicEntries: AIMnemonicEntry[];
  agentProfiles: AIAgentProfileDescriptor[];
  promptWorkflows: AIPromptWorkflowDescriptor[];
  onNewChat: () => void;
  onRefreshRuntime: () => void;
  onToggleProviderPopover: () => void;
  onToggleSettingsPopover: () => void;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onRefreshProviders: () => void;
  onTestProvider: () => void;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onDisplayPrefChange: (key: keyof AIChatDisplayPrefs, value: boolean) => void;
}

export function AIChatHeader({
  loading,
  selectedProvider,
  selectedProviderId,
  providers,
  providerPopoverOpen,
  settingsPopoverOpen,
  context,
  displayPrefs,
  contextProviders,
  status,
  approvalPolicy,
  consentPolicy,
  embeddingStatus,
  egressRecords,
  mnemonicEntries,
  agentProfiles,
  promptWorkflows,
  onNewChat,
  onRefreshRuntime,
  onToggleProviderPopover,
  onToggleSettingsPopover,
  onSelectProvider,
  onRefreshProviders,
  onTestProvider,
  onContextToggle,
  onDisplayPrefChange,
}: AIChatHeaderProps) {
  const provider = getProviderPresentation(selectedProvider);

  return (
    <header className="ai-chat-header">
      <div className="ai-chat-header__actions">
        <button
          className="ai-chat-icon-button"
          type="button"
          title="New chat"
          onClick={onNewChat}
        >
          <MessageSquarePlus size={16} />
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

        <div className="ai-chat-header__menu" data-ai-chat-popover-scope>
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
              selectedProviderId={selectedProviderId}
              onRefresh={onRefreshProviders}
              onSelectProvider={onSelectProvider}
              onTest={onTestProvider}
            />
          ) : null}
        </div>

        <div className="ai-chat-header__menu" data-ai-chat-popover-scope>
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
              status={status}
              approvalPolicy={approvalPolicy}
              consentPolicy={consentPolicy}
              embeddingStatus={embeddingStatus}
              egressRecords={egressRecords}
              mnemonicEntries={mnemonicEntries}
              agentProfiles={agentProfiles}
              promptWorkflows={promptWorkflows}
              onContextToggle={onContextToggle}
              onDisplayPrefChange={onDisplayPrefChange}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
