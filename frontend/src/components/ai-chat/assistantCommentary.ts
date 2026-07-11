import type { AIRunTimelineEvent } from "../../../bindings/arlecchino/internal/ai/models";

export type AssistantCommentaryKind =
  "progress" | "milestone" | "verification" | "warning";

export interface AssistantCommentaryItem {
  id: string;
  content: string;
  kind: AssistantCommentaryKind;
  createdAt: string;
}

const commentaryKinds = new Set<AssistantCommentaryKind>([
  "progress",
  "milestone",
  "verification",
  "warning",
]);

function normalizedText(value?: string | null): string {
  return `${value ?? ""}`.replace(/\s+/g, " ").trim();
}

function commentaryKind(value?: string | null): AssistantCommentaryKind {
  const normalized = `${value ?? ""}`.trim().toLowerCase();
  return commentaryKinds.has(normalized as AssistantCommentaryKind)
    ? (normalized as AssistantCommentaryKind)
    : "progress";
}

function eventTimestamp(event: AIRunTimelineEvent): number {
  const parsed = Date.parse(event.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectAssistantCommentary(
  events: AIRunTimelineEvent[],
  finalResponse = "",
): AssistantCommentaryItem[] {
  const normalizedFinal = normalizedText(finalResponse);
  const seen = new Set<string>();

  return [...events]
    .sort((left, right) => eventTimestamp(left) - eventTimestamp(right))
    .flatMap((event) => {
      if (
        event.type !== "assistant_commentary" &&
        event.status !== "message.commentary"
      ) {
        return [];
      }
      const content = `${event.summary ?? ""}`.trim();
      const semanticContent = normalizedText(content);
      if (
        !semanticContent ||
        semanticContent === normalizedFinal ||
        seen.has(semanticContent)
      ) {
        return [];
      }
      seen.add(semanticContent);
      return [
        {
          id: event.id || `${event.createdAt}:${semanticContent}`,
          content,
          kind: commentaryKind(event.status),
          createdAt: event.createdAt,
        },
      ];
    });
}
