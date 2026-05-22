import React from "react";
import {
  ChevronDown,
  ChevronUp,
  GitBranch,
  History,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
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
  settingsPopoverOpen: boolean;
  activityPopoverOpen: boolean;
  historyOpen: boolean;
  reviewOpen: boolean;
  reviewExpanded: boolean;
  sessionSearch: string;
  sessionSearchOpen: boolean;
  sessionSearchMatchCount: number;
  sessionSearchTotalCount: number;
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
  mnemonicBusy: boolean;
  mnemonicError: string;
  activeEnvelope: AIChatRunEnvelope | null;
  activeRun: AIChatRun | null;
  activeRunText: string;
  artifacts: AIChatRunArtifact[];
  artifactBusyId: string | null;
  contextPreview: AIContextSnapshot | null;
  onNewChat: () => void;
  onRefreshRuntime: () => void;
  onToggleActivityPopover: () => void;
  onToggleHistory: () => void;
  onToggleReview: () => void;
  onToggleSessionSearch: () => void;
  onSessionSearchChange: (value: string) => void;
  onSessionSearchNext: () => void;
  onSessionSearchPrevious: () => void;
  onClearSessionSearch: () => void;
  onToggleSettingsPopover: () => void;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onDisplayPrefChange: (key: keyof AIChatDisplayPrefs, value: boolean) => void;
  onMnemonicSearch: (query: string) => void;
  onMnemonicSave: (content: string) => void;
  onMnemonicPromote: (entryId: string) => void;
  onAcceptLocalProviderConsent: () => void;
  onAcceptExternalAgentConsent: () => void;
  onAcceptRemoteBYOKProviderConsent: () => void;
  onAcceptFrontierProviderConsent: () => void;
}

export function AIChatHeader({
  loading,
  selectedProvider,
  selectedProviderReady,
  settingsPopoverOpen,
  activityPopoverOpen,
  historyOpen,
  reviewOpen,
  reviewExpanded,
  sessionSearch,
  sessionSearchOpen,
  sessionSearchMatchCount,
  sessionSearchTotalCount,
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
  mnemonicBusy,
  mnemonicError,
  activeEnvelope,
  activeRun,
  activeRunText,
  artifacts,
  artifactBusyId,
  contextPreview,
  onNewChat,
  onRefreshRuntime,
  onToggleActivityPopover,
  onToggleHistory,
  onToggleReview,
  onToggleSessionSearch,
  onSessionSearchChange,
  onSessionSearchNext,
  onSessionSearchPrevious,
  onClearSessionSearch,
  onToggleSettingsPopover,
  onContextToggle,
  onDisplayPrefChange,
  onMnemonicSearch,
  onMnemonicSave,
  onMnemonicPromote,
  onAcceptLocalProviderConsent,
  onAcceptExternalAgentConsent,
  onAcceptRemoteBYOKProviderConsent,
  onAcceptFrontierProviderConsent,
}: AIChatHeaderProps) {
  const {
    draggedItemId,
    effectiveLayout,
    handleClickCapture,
    handlePointerDown,
    leftGroupRef,
    rightGroupRef,
  } = useAIChatHeaderReorder();
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
    artifactBusyId,
    mnemonicBusy,
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
              <AnimatePresence initial={false}>
                {activityPopoverOpen ? (
                  <ActivityStatusPopover
                    activeEnvelope={activeEnvelope}
                    activeRun={activeRun}
                    contextPreview={contextPreview}
                    items={activityItems}
                    selectedProvider={selectedProvider}
                    summary={activitySummary}
                  />
                ) : null}
              </AnimatePresence>
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
        case "search":
          return (
            <div
              className="ai-chat-header__menu ai-chat-header__menu--search"
              data-ai-chat-popover-scope
            >
              <button
                className={`ai-chat-icon-button${sessionSearchOpen ? " is-active" : ""}`}
                type="button"
                title={
                  sessionSearch
                    ? `Search session: ${sessionSearchMatchCount}/${sessionSearchTotalCount}`
                    : "Search current session"
                }
                aria-expanded={sessionSearchOpen}
                onClick={onToggleSessionSearch}
              >
                <Search size={16} />
              </button>
              <AnimatePresence initial={false}>
                {sessionSearchOpen ? (
                  <div
                    className="ai-chat-popover ai-chat-header-search"
                    role="search"
                    aria-label="Search current chat session"
                  >
                    <div className="ai-chat-search-field ai-chat-search-field--header">
                      {sessionSearch ? null : <Search size={14} />}
                      <input
                        autoFocus
                        aria-label="Search current chat session"
                        placeholder="Search this session..."
                        value={sessionSearch}
                        onChange={(event) =>
                          onSessionSearchChange(event.target.value)
                        }
                      />
                      {sessionSearch ? (
                        <>
                          <span className="ai-chat-header-search__count">
                            {sessionSearchMatchCount}/{sessionSearchTotalCount}
                          </span>
                          <div
                            className="ai-chat-header-search__nav"
                            aria-label="Search result navigation"
                          >
                            <button
                              className="ai-chat-icon-button ai-chat-icon-button--compact"
                              type="button"
                              title="Previous search result"
                              disabled={sessionSearchTotalCount === 0}
                              onClick={onSessionSearchPrevious}
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              className="ai-chat-icon-button ai-chat-icon-button--compact"
                              type="button"
                              title="Next search result"
                              disabled={sessionSearchTotalCount === 0}
                              onClick={onSessionSearchNext}
                            >
                              <ChevronDown size={16} />
                            </button>
                          </div>
                          <button
                            className="ai-chat-icon-button ai-chat-icon-button--compact ai-chat-header-search__clear"
                            type="button"
                            title="Clear session search"
                            onClick={onClearSessionSearch}
                          >
                            <X size={16} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </AnimatePresence>
            </div>
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
        case "settings":
          return (
            <button
              className="ai-chat-icon-button"
              data-testid="ai-chat-settings-button"
              type="button"
              title="Open app settings"
              onClick={onToggleSettingsPopover}
            >
              <Settings size={17} />
            </button>
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
