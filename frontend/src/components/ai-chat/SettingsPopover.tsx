import React from "react";
import {
  Database,
  FileText,
  Monitor,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
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
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onDisplayPrefChange: (key: keyof AIChatDisplayPrefs, value: boolean) => void;
}

const contextRows: Array<{
  key: keyof ContextToggles;
  label: string;
  icon: React.ReactNode;
}> = [
  { key: "workspace", label: "Workspace", icon: <Database size={15} /> },
  { key: "currentFile", label: "Current file", icon: <FileText size={15} /> },
  { key: "terminalLogs", label: "Terminal logs", icon: <Monitor size={15} /> },
  { key: "mnemonic", label: "Mnemonic", icon: <Shield size={15} /> },
  { key: "mcp", label: "MCP", icon: <SlidersHorizontal size={15} /> },
  { key: "skills", label: "Skills", icon: <SlidersHorizontal size={15} /> },
];

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
  onContextToggle,
  onDisplayPrefChange,
}: SettingsPopoverProps) {
  const enabledProfiles = agentProfiles.filter((profile) => profile.enabled);
  const executableTools = tools.filter((tool) => tool.executionAvailable);
  const pinnedMnemonic = mnemonicEntries.filter((entry) => entry.pinned);
  const generatedMnemonic = mnemonicEntries.filter((entry) => entry.generated);
  const staleMnemonic = mnemonicEntries.filter(
    (entry) => entry.superseded || !entry.isLatest,
  );
  const localModels = modelCapabilities.filter((model) => model.local);
  const toolModels = modelCapabilities.filter((model) => model.toolSupport);

  return (
    <div
      className="ai-chat-popover ai-chat-settings-popover"
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
        <label className="ai-chat-toggle-row">
          <span>Runtime activity</span>
          <input
            checked={displayPrefs.showActivity}
            type="checkbox"
            onChange={(event) =>
              onDisplayPrefChange("showActivity", event.target.checked)
            }
          />
        </label>
      </div>

      <div className="ai-chat-popover__section">
        <div className="ai-chat-popover__title">Context</div>
        {contextRows.map((row) => (
          <label className="ai-chat-toggle-row" key={row.key}>
            <span>
              {row.icon}
              {row.label}
            </span>
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
            {consentPolicy?.localProvidersAccepted
              ? "local accepted"
              : "local pending"}
          </strong>
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
    </div>
  );
}
