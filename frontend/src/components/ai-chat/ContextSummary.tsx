import React from "react";
import { FileText, FolderTree, ShieldCheck } from "lucide-react";
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
  const source = context.capability || "runtime";
  const filePath = context.filePath || "";

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
    </div>
  );
}
