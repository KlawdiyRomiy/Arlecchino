import React from "react";
import { ExternalLink, ShieldAlert } from "lucide-react";
import type { AIToolProposal } from "../../../bindings/arlecchino/internal/ai/models";

interface ToolProposalCardProps {
  proposal: AIToolProposal;
}

export function ToolProposalCard({ proposal }: ToolProposalCardProps) {
  return (
    <div className="ai-chat-tool-proposal">
      <div className="ai-chat-tool-proposal__head">
        <span className="ai-chat-tool-proposal__title">
          <ShieldAlert size={14} />
          {proposal.name || proposal.kind || "Tool proposal"}
        </span>
        <span className="ai-chat-tool-proposal__state">
          {proposal.executionState || "Preview only"}
        </span>
      </div>
      {proposal.description ? (
        <p className="ai-chat-tool-proposal__body">{proposal.description}</p>
      ) : null}
      {proposal.targetPaths?.[0] || proposal.commandPreview ? (
        <span
          className="ai-chat-tool-proposal__target"
          title={proposal.targetPaths?.join(", ") || proposal.commandPreview}
        >
          <ExternalLink size={13} />
          {proposal.targetPaths?.[0] || proposal.commandPreview}
        </span>
      ) : null}
    </div>
  );
}
