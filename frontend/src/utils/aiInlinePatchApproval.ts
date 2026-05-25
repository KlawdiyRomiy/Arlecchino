import {
  aiInlinePatchPathMatches,
  resolveAIInlinePatchFilePath,
  type AIInlinePatchScope,
  type AIInlinePatchPreview,
} from "../stores/aiInlinePatchStore";
import { isSameOrChildPathByIdentity } from "./projectPaths";

export interface AIInlinePatchDirtyCandidate {
  path: string;
  name?: string;
  label?: string;
  isDirty?: boolean;
  pending?: boolean;
}

export const getAffectedAIInlinePatchCandidates = <
  T extends AIInlinePatchDirtyCandidate,
>(
  preview: AIInlinePatchPreview,
  candidates: T[],
  scope: AIInlinePatchScope = {},
): T[] =>
  candidates.filter((candidate) =>
    preview.files.some((file) =>
      aiInlinePatchPathMatches(candidate.path, file.path, scope.projectPath),
    ),
  );

export const findBlockingAIInlinePatchCandidate = <
  T extends AIInlinePatchDirtyCandidate,
>(
  preview: AIInlinePatchPreview,
  candidates: T[],
  scope: AIInlinePatchScope = {},
): T | null =>
  getAffectedAIInlinePatchCandidates(preview, candidates, scope).find(
    (candidate) => candidate.isDirty || candidate.pending,
  ) ?? null;

export const isAIInlinePatchPreviewInScope = (
  preview: AIInlinePatchPreview,
  scope: AIInlinePatchScope,
): boolean => {
  if (
    scope.projectSessionId &&
    preview.projectSessionId !== scope.projectSessionId
  ) {
    return false;
  }
  if (!scope.projectPath) {
    return true;
  }
  return preview.files.every((file) =>
    isSameOrChildPathByIdentity(
      resolveAIInlinePatchFilePath(scope.projectPath, file.path),
      scope.projectPath ?? "",
    ),
  );
};

export const formatAIInlinePatchCandidateName = (
  candidate: AIInlinePatchDirtyCandidate,
): string => candidate.label || candidate.name || candidate.path;
