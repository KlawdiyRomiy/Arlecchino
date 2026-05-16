import React from "react";
import {
  ChevronDown,
  GitBranch,
  History,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Settings,
} from "lucide-react";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIAgentProfileDescriptor,
  AIApprovalPolicy,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIConsentPolicy,
  AIContextSnapshot,
  AIContextProviderDescriptor,
  AIEmbeddingStatus,
  AIEgressRecord,
  AIMnemonicEntry,
  AIModelCapabilityDescriptor,
  AIPromptWorkflowDescriptor,
  AIStatus,
  AIToolAuditRecord,
  AIToolDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIChatDisplayPrefs, ContextToggles } from "./types";
import { getProviderPresentation } from "./providerPresentation";
import { ProviderPopover } from "./ProviderPopover";
import { SettingsPopover } from "./SettingsPopover";
import {
  ActivityIcon,
  ActivityStatusPopover,
  buildActivityStatusItems,
  summarizeActivityStatus,
} from "./ActivityTimeline";
import {
  AI_CHAT_HEADER_ITEM_LABELS,
  type AIChatHeaderDropGroup,
  type AIChatHeaderItemId,
  useAIChatHeaderReorder,
} from "./AIChatHeaderReorder";

interface AIChatHeaderProps {
  loading: boolean;
  selectedProvider: AIProviderDescriptor | null;
  selectedProviderReady: boolean;
  selectedProviderId: string;
  providers: AIProviderDescriptor[];
  providerPopoverOpen: boolean;
  settingsPopoverOpen: boolean;
  activityPopoverOpen: boolean;
  historyOpen: boolean;
  reviewOpen: boolean;
  reviewExpanded: boolean;
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
  tools: AIToolDescriptor[];
  toolAudit: AIToolAuditRecord[];
  modelCapabilities: AIModelCapabilityDescriptor[];
  activeEnvelope: AIChatRunEnvelope | null;
  activeRun: AIChatRun | null;
  activeRunText: string;
  artifacts: AIChatRunArtifact[];
  contextPreview: AIContextSnapshot | null;
  onNewChat: () => void;
  onRefreshRuntime: () => void;
  onToggleActivityPopover: () => void;
  onToggleHistory: () => void;
  onToggleReview: () => void;
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
  selectedProviderReady,
  selectedProviderId,
  providers,
  providerPopoverOpen,
  settingsPopoverOpen,
  activityPopoverOpen,
  historyOpen,
  reviewOpen,
  reviewExpanded,
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
  tools,
  toolAudit,
  modelCapabilities,
  activeEnvelope,
  activeRun,
  activeRunText,
  artifacts,
  contextPreview,
  onNewChat,
  onRefreshRuntime,
  onToggleActivityPopover,
  onToggleHistory,
  onToggleReview,
  onToggleProviderPopover,
  onToggleSettingsPopover,
  onSelectProvider,
  onRefreshProviders,
  onTestProvider,
  onContextToggle,
  onDisplayPrefChange,
}: AIChatHeaderProps) {
  const {
    draggedItemId,
    effectiveLayout,
    handleClickCapture,
    handlePointerDown,
    leftGroupRef,
    rightGroupRef,
  } = useAIChatHeaderReorder();
  const provider = getProviderPresentation(selectedProvider);
  const activityItems = buildActivityStatusItems({
    activeEnvelope,
    activeRun,
    activeRunText,
    approvalPolicy,
    artifacts,
    consentPolicy,
    contextPreview,
    embeddingStatus,
    selectedProvider,
    selectedProviderReady,
    workflowCount: promptWorkflows.length,
  });
  const activitySummary = summarizeActivityStatus(
    activityItems,
    selectedProviderReady,
  );

  const renderHeaderItem = (
    itemId: AIChatHeaderItemId,
    group: AIChatHeaderDropGroup,
  ) => {
    const content = (() => {
      switch (itemId) {
        case "history":
          return (
            <button
              className={`ai-chat-icon-button${historyOpen ? " is-active" : ""}`}
              data-testid="ai-chat-history-toggle"
              type="button"
              title={historyOpen ? "Close chat history" : "Open chat history"}
              onClick={onToggleHistory}
            >
              <History size={16} />
            </button>
          );
        case "activity":
          return (
            <div
              className="ai-chat-header__menu ai-chat-header__menu--activity"
              data-ai-chat-popover-scope
            >
              <button
                className="ai-chat-activity-button"
                data-state={activitySummary.state}
                type="button"
                title="AI runtime status"
                aria-expanded={activityPopoverOpen}
                onClick={onToggleActivityPopover}
              >
                <ActivityIcon state={activitySummary.state} />
                <span>{activitySummary.label}</span>
                <ChevronDown size={14} />
              </button>
              {activityPopoverOpen ? (
                <ActivityStatusPopover
                  items={activityItems}
                  summary={activitySummary}
                />
              ) : null}
            </div>
          );
        case "review":
          return (
            <button
              className={`ai-chat-icon-button${reviewOpen || reviewExpanded ? " is-active" : ""}`}
              data-testid="ai-chat-review-toggle"
              type="button"
              title={
                reviewOpen || reviewExpanded
                  ? "Close Git Review"
                  : "Open Git Review"
              }
              onClick={onToggleReview}
            >
              <GitBranch size={16} />
            </button>
          );
        case "newChat":
          return (
            <button
              className="ai-chat-icon-button"
              type="button"
              title="New chat"
              onClick={onNewChat}
            >
              <MessageSquarePlus size={16} />
            </button>
          );
        case "refresh":
          return (
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
          );
        case "provider":
          return (
            <div
              className="ai-chat-header__menu ai-chat-header__menu--provider"
              data-ai-chat-popover-scope
            >
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
          );
        case "settings":
          return (
            <div
              className="ai-chat-header__menu ai-chat-header__menu--settings"
              data-ai-chat-popover-scope
            >
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
                  tools={tools}
                  toolAudit={toolAudit}
                  modelCapabilities={modelCapabilities}
                  onContextToggle={onContextToggle}
                  onDisplayPrefChange={onDisplayPrefChange}
                />
              ) : null}
            </div>
          );
      }
    })();

    return (
      <div
        className="ai-chat-header__reorder-item"
        data-ai-chat-header-item-id={itemId}
        data-ai-chat-header-dragging={
          draggedItemId === itemId ? "true" : undefined
        }
        key={itemId}
        title={`Drag ${AI_CHAT_HEADER_ITEM_LABELS[itemId]}`}
        onClickCapture={handleClickCapture}
        onPointerDown={(event) => handlePointerDown(itemId, group, event)}
      >
        {content}
      </div>
    );
  };

  return (
    <header className="ai-chat-header">
      <div className="ai-chat-header__left" ref={leftGroupRef}>
        {effectiveLayout.left.map((itemId) => renderHeaderItem(itemId, "left"))}
      </div>

      <div className="ai-chat-header__actions" ref={rightGroupRef}>
        {effectiveLayout.right.map((itemId) =>
          renderHeaderItem(itemId, "right"),
        )}
      </div>
    </header>
  );
}
