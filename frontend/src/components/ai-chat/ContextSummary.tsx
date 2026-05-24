import React from "react";
import {
  FileText,
  FolderTree,
  ListChecks,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type {
  AIContextSnapshot,
  AIContextSummary,
} from "../../../bindings/arlecchino/internal/ai/models";

type ContextInput = AIContextSnapshot | AIContextSummary | null | undefined;

interface ContextSummaryProps {
  context: ContextInput;
  compact?: boolean;
}

function getSnippetCount(context: ContextInput): number {
  if (!context) return 0;
  if ("snippetCount" in context && typeof context.snippetCount === "number") {
    return context.snippetCount;
  }
  if ("snippets" in context && Array.isArray(context.snippets)) {
    return context.snippets.length;
  }
  return 0;
}

export function ContextSummary({
  context,
  compact = false,
}: ContextSummaryProps) {
  if (!context) {
    return (
      <div className="ai-chat-context-summary ai-chat-context-summary--muted">
        <ShieldCheck size={14} />
        <span>Context will be prepared by runtime</span>
      </div>
    );
  }

  const snippetCount = getSnippetCount(context);
  const continuityCapsules =
    "continuityCapsuleCount" in context &&
    typeof context.continuityCapsuleCount === "number"
      ? context.continuityCapsuleCount
      : "continuity" in context && Array.isArray(context.continuity)
        ? context.continuity.length
        : 0;
  const source = context.capability || "runtime";
  const filePath = context.filePath || "";
  const contextItems = context.contextItems ?? [];
  const includedContextItems = contextItems.filter((item) => item.included);
  const redacted =
    context.redaction?.secretsRedacted > 0 ||
    context.redaction?.pathsRedacted > 0 ||
    contextItems.some((item) => item.redacted);
  const truncated =
    context.redaction?.truncated || contextItems.some((item) => item.truncated);

  return (
    <div
      className="ai-chat-context-summary"
      data-compact={compact ? "true" : "false"}
    >
      <span className="ai-chat-context-pill" title={source}>
        <FolderTree size={14} />
        {source}
      </span>
      {filePath ? (
        <span className="ai-chat-context-pill" title={filePath}>
          <FileText size={14} />
          {filePath.split("/").pop() || filePath}
        </span>
      ) : null}
      <span className="ai-chat-context-pill">
        <ShieldCheck size={14} />
        {snippetCount} snippet{snippetCount === 1 ? "" : "s"}
      </span>
      {contextItems.length > 0 ? (
        <span
          className="ai-chat-context-pill"
          title={contextItems
            .map(
              (item) =>
                `${item.label}: ${item.included ? "included" : item.reason || "not included"}`,
            )
            .join("\n")}
        >
          <FolderTree size={14} />
          {includedContextItems.length}/{contextItems.length} items
        </span>
      ) : null}
      {continuityCapsules > 0 ? (
        <span className="ai-chat-context-pill" title="Session continuity">
          <ListChecks size={14} />
          {continuityCapsules} capsule
          {continuityCapsules === 1 ? "" : "s"}
        </span>
      ) : null}
      {redacted || truncated ? (
        <span
          className="ai-chat-context-pill"
          title="Context was redacted or truncated before model egress"
        >
          <TriangleAlert size={14} />
          {redacted ? "redacted" : "truncated"}
        </span>
      ) : null}
    </div>
  );
}
