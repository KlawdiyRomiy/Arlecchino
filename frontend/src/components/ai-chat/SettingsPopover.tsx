import React, { useState } from "react";
import type {
  AIAgentProfileDescriptor,
  AIApprovalPolicy,
  AIConsentPolicy,
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
import { AIChatPopoverFrame } from "./AIChatPopoverFrame";
import { ContextToggleList } from "./contextToggleRows";

interface SettingsPopoverProps {
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

export function SettingsPopover({
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
  onContextToggle,
  onDisplayPrefChange,
  onMnemonicSearch,
  onMnemonicSave,
  onMnemonicPromote,
  onAcceptLocalProviderConsent,
  onAcceptExternalAgentConsent,
  onAcceptRemoteBYOKProviderConsent,
  onAcceptFrontierProviderConsent,
}: SettingsPopoverProps) {
  const [mnemonicDraft, setMnemonicDraft] = useState("");
  const [mnemonicQuery, setMnemonicQuery] = useState("");
  const enabledProfiles = agentProfiles.filter((profile) => profile.enabled);
  const executableTools = tools.filter((tool) => tool.executionAvailable);
  const pinnedMnemonic = mnemonicEntries.filter((entry) => entry.pinned);
  const generatedMnemonic = mnemonicEntries.filter((entry) => entry.generated);
  const staleMnemonic = mnemonicEntries.filter(
    (entry) => entry.superseded || !entry.isLatest,
  );
  const localModels = modelCapabilities.filter((model) => model.local);
  const toolModels = modelCapabilities.filter((model) => model.toolSupport);
  const visibleMnemonicEntries = mnemonicEntries.slice(0, 6);
  const handleMnemonicSave = () => {
    const content = mnemonicDraft.trim();
    if (!content) return;
    onMnemonicSave(content);
    setMnemonicDraft("");
  };

  return (
    <AIChatPopoverFrame
      className="ai-chat-settings-popover"
      data-testid="ai-chat-settings-popover"
    >
      <div className="ai-chat-popover__section">
        <div className="ai-chat-popover__title">Display</div>
        <label className="ai-chat-toggle-row">
          <span>Auto-scroll</span>
          <input
            checked={displayPrefs.autoScroll}
            type="checkbox"
            onChange={(event) =>
              onDisplayPrefChange("autoScroll", event.target.checked)
            }
          />
        </label>
        <label className="ai-chat-toggle-row">
          <span>Compact cards</span>
          <input
            checked={displayPrefs.compactCards}
            type="checkbox"
            onChange={(event) =>
              onDisplayPrefChange("compactCards", event.target.checked)
            }
          />
        </label>
      </div>

      <div className="ai-chat-popover__section">
        <div className="ai-chat-popover__title">Context</div>
        <ContextToggleList
          context={context}
          showIcons
          onContextToggle={onContextToggle}
        />
      </div>

      {contextProviders.length > 0 ? (
        <div className="ai-chat-popover__section">
          <div className="ai-chat-popover__title">Runtime Providers</div>
          <div className="ai-chat-context-provider-list">
            {contextProviders.map((provider) => (
              <span key={provider.id} className="ai-chat-context-provider">
                <span
                  className={`ai-chat-context-provider__dot is-${
                    provider.enabled && provider.available
                      ? "ready"
                      : "disabled"
                  }`}
                />
                {provider.name || provider.id}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="ai-chat-popover__section">
        <div className="ai-chat-popover__title">Backend Runtime</div>
        <div className="ai-chat-runtime-grid">
          <span>Approval</span>
          <strong>{approvalPolicy?.mode || "ask_each_time"}</strong>
          <span>Consent</span>
          <strong>
            {consentPolicy?.externalAgentCliAccepted
              ? "agent CLI accepted"
              : consentPolicy?.frontierProvidersAccepted
                ? "frontier accepted"
                : consentPolicy?.remoteProvidersAccepted
                  ? "remote provider accepted"
                  : consentPolicy?.localProvidersAccepted
                    ? "local accepted"
                    : "local pending"}
          </strong>
          {!consentPolicy?.localProvidersAccepted ? (
            <>
              <span>Local consent</span>
              <button
                className="ai-chat-secondary-button is-primary"
                type="button"
                onClick={onAcceptLocalProviderConsent}
              >
                Accept local provider
              </button>
            </>
          ) : null}
          {!consentPolicy?.externalAgentCliAccepted ? (
            <>
              <span>Agent CLI consent</span>
              <button
                className="ai-chat-secondary-button is-primary"
                type="button"
                onClick={onAcceptExternalAgentConsent}
              >
                Accept external CLI
              </button>
            </>
          ) : null}
          {!consentPolicy?.remoteProvidersAccepted ? (
            <>
              <span>Remote provider consent</span>
              <button
                className="ai-chat-secondary-button is-primary"
                type="button"
                onClick={onAcceptRemoteBYOKProviderConsent}
              >
                Accept remote provider
              </button>
            </>
          ) : null}
          {!consentPolicy?.frontierProvidersAccepted ? (
            <>
              <span>Frontier consent</span>
              <button
                className="ai-chat-secondary-button is-primary"
                type="button"
                onClick={onAcceptFrontierProviderConsent}
              >
                Accept frontier providers
              </button>
            </>
          ) : null}
          <span>Mnemonic</span>
          <strong>
            {status?.mnemonicEnabled ? "enabled" : "disabled"} ·{" "}
            {mnemonicEntries.length}
          </strong>
          <span>Memory trust</span>
          <strong>
            {pinnedMnemonic.length} pinned · {generatedMnemonic.length} review ·{" "}
            {staleMnemonic.length} stale
          </strong>
          <span>Egress ledger</span>
          <strong>{egressRecords.length}</strong>
          <span>Workflows</span>
          <strong>{promptWorkflows.length}</strong>
          <span>Agent profiles</span>
          <strong>
            {enabledProfiles.length}/{agentProfiles.length}
          </strong>
          <span>Tools</span>
          <strong>
            {executableTools.length}/{tools.length} executable
          </strong>
          <span>Tool audit</span>
          <strong>{toolAudit.length}</strong>
          <span>Model capabilities</span>
          <strong>
            {modelCapabilities.length} models · {localModels.length} local ·{" "}
            {toolModels.length} tool-ready
          </strong>
          <span>Embeddings</span>
          <strong>{embeddingStatus?.status || "unknown"}</strong>
        </div>
      </div>

      <div className="ai-chat-popover__section">
        <div className="ai-chat-popover__title">Mnemonic</div>
        <div className="ai-chat-mnemonic-controls">
          <div className="ai-chat-mnemonic-search">
            <input
              value={mnemonicQuery}
              type="search"
              placeholder="Search project memory"
              onChange={(event) => setMnemonicQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onMnemonicSearch(mnemonicQuery);
              }}
            />
            <button
              className="ai-chat-secondary-button"
              type="button"
              disabled={mnemonicBusy}
              onClick={() => onMnemonicSearch(mnemonicQuery)}
            >
              Search
            </button>
          </div>
          <textarea
            value={mnemonicDraft}
            rows={2}
            placeholder="Save reviewed project fact"
            onChange={(event) => setMnemonicDraft(event.target.value)}
          />
          <button
            className="ai-chat-secondary-button is-primary"
            type="button"
            disabled={mnemonicBusy || !mnemonicDraft.trim()}
            onClick={handleMnemonicSave}
          >
            Save reviewed memory
          </button>
          {mnemonicError ? (
            <div className="ai-chat-provider-runtime-error">
              {mnemonicError}
            </div>
          ) : null}
        </div>
        {visibleMnemonicEntries.length > 0 ? (
          <div className="ai-chat-mnemonic-list">
            {visibleMnemonicEntries.map((entry) => {
              const needsReview =
                entry.generated ||
                entry.trust === "generated" ||
                entry.trust === "untrusted";
              return (
                <div className="ai-chat-mnemonic-row" key={entry.id}>
                  <span className="ai-chat-mnemonic-row__content">
                    {entry.content}
                  </span>
                  <span className="ai-chat-mnemonic-row__meta">
                    {entry.trust || (entry.generated ? "generated" : "trusted")}
                    {entry.pinned ? " · pinned" : ""}
                  </span>
                  {needsReview ? (
                    <button
                      className="ai-chat-secondary-button"
                      type="button"
                      disabled={mnemonicBusy}
                      onClick={() => onMnemonicPromote(entry.id)}
                    >
                      Trust
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ai-chat-provider-empty">
            No visible project memory yet.
          </div>
        )}
      </div>
    </AIChatPopoverFrame>
  );
}
