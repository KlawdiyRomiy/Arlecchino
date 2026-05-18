import React from "react";
import {
  ExternalLink,
  ShieldAlert,
  Eye,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { AIToolProposal } from "../../../bindings/arlecchino/internal/ai/models";

interface ToolProposalCardProps {
  proposal: AIToolProposal;
  canPreview?: boolean;
  canDeny?: boolean;
  canApprove?: boolean;
  busy?: boolean;
  denyBusy?: boolean;
  approveOnceBusy?: boolean;
  approveRunBusy?: boolean;
  reviewDisabledReason?: string;
  onPreview?: (proposal: AIToolProposal) => void;
  onDeny?: (proposal: AIToolProposal) => void;
  onApprove?: (proposal: AIToolProposal, scope: "once" | "run") => void;
}

export function ToolProposalCard({
  proposal,
  canPreview = false,
  canDeny = false,
  canApprove = false,
  busy = false,
  denyBusy = false,
  approveOnceBusy = false,
  approveRunBusy = false,
  reviewDisabledReason = "",
  onPreview,
  onDeny,
  onApprove,
}: ToolProposalCardProps) {
  const hasActions = canPreview || canDeny || canApprove;
  const approvalBusy = approveOnceBusy || approveRunBusy;
  const actionsDisabled = Boolean(reviewDisabledReason) || approvalBusy;
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
      {hasActions ? (
        <div className="ai-chat-tool-proposal__actions">
          {canPreview ? (
            <button
              className="ai-chat-secondary-button"
              type="button"
              disabled={busy || denyBusy || actionsDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onPreview?.(proposal);
              }}
            >
              <Eye size={13} />
              {busy ? "Creating review" : "Create review"}
            </button>
          ) : null}
          {canApprove ? (
            <>
              <button
                className="ai-chat-secondary-button is-primary"
                type="button"
                disabled={busy || denyBusy || actionsDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onApprove?.(proposal, "once");
                }}
              >
                <ShieldCheck size={13} />
                {approveOnceBusy ? "Approving" : "Approve once"}
              </button>
              <button
                className="ai-chat-secondary-button"
                type="button"
                disabled={busy || denyBusy || actionsDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onApprove?.(proposal, "run");
                }}
              >
                <ShieldCheck size={13} />
                {approveRunBusy ? "Approving" : "Approve for run"}
              </button>
            </>
          ) : null}
          {canDeny ? (
            <button
              className="ai-chat-secondary-button is-danger"
              type="button"
              disabled={busy || denyBusy || actionsDisabled}
              onClick={(event) => {
                event.stopPropagation();
                onDeny?.(proposal);
              }}
            >
              <XCircle size={13} />
              {denyBusy ? "Denying" : "Deny"}
            </button>
          ) : null}
          {reviewDisabledReason ? (
            <span className="ai-chat-tool-proposal__disabled">
              {reviewDisabledReason}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
