import React from "react";
import { ExternalLink, ShieldAlert, Eye } from "lucide-react";
import type { AIToolProposal } from "../../../bindings/arlecchino/internal/ai/models";

interface ToolProposalCardProps {
  proposal: AIToolProposal;
  canPreview?: boolean;
  busy?: boolean;
  onPreview?: (proposal: AIToolProposal) => void;
}

export function ToolProposalCard({
  proposal,
  canPreview = false,
  busy = false,
  onPreview,
}: ToolProposalCardProps) {
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
      {canPreview ? (
        <button
          className="ai-chat-secondary-button"
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onPreview?.(proposal);
          }}
        >
          <Eye size={13} />
          {busy ? "Previewing" : "Preview tool"}
        </button>
      ) : null}
    </div>
  );
}
