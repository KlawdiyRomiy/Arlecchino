import { create } from "zustand";

import {
  AIChatRunArtifactKind,
  AIPatchArtifactPayload,
  type AIChatRunArtifact,
  type AIPatchFile,
} from "../../bindings/arlecchino/internal/ai/models";

export interface AIInlinePatchPreview {
  id: string;
  runId: string;
  sessionId: string;
  title: string;
  status: string;
  summary?: string;
  unifiedDiff: string;
  files: AIPatchFile[];
  updatedAt?: string;
}

interface AIInlinePatchState {
  previews: Record<string, AIInlinePatchPreview>;
  dismissedIds: Record<string, true>;
  syncArtifacts: (artifacts: AIChatRunArtifact[]) => void;
  dismissPreview: (previewId: string) => void;
  clearPreview: (previewId: string) => void;
  clearAll: () => void;
}

const parsePatchPayload = (
  artifact: AIChatRunArtifact,
): AIPatchArtifactPayload | null => {
  try {
    return AIPatchArtifactPayload.createFrom(artifact.payloadJson || "{}");
  } catch {
    return null;
  }
};

export const normalizeAIInlinePatchPath = (value: string): string =>
  value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");

const stripPatchPrefix = (value: string): string =>
  normalizeAIInlinePatchPath(value)
    .replace(/^\.?\//, "")
    .replace(/^a\//, "")
    .replace(/^b\//, "");

export const aiInlinePatchPathMatches = (
  editorPath: string,
  patchPath: string,
): boolean => {
  const editor = normalizeAIInlinePatchPath(editorPath).toLowerCase();
  const patch = stripPatchPrefix(patchPath).toLowerCase();
  if (!editor || !patch) {
    return false;
  }
  return editor === patch || editor.endsWith(`/${patch}`);
};

export const selectAIInlinePatchPreviewForPath = (
  previews: Record<string, AIInlinePatchPreview>,
  filePath: string,
): AIInlinePatchPreview | null => {
  const entries = Object.values(previews)
    .filter((preview) =>
      preview.files.some((file) =>
        aiInlinePatchPathMatches(filePath, file.path),
      ),
    )
    .sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
    );
  return entries[0] ?? null;
};

export const useAIInlinePatchStore = create<AIInlinePatchState>((set) => ({
  previews: {},
  dismissedIds: {},

  syncArtifacts: (artifacts) =>
    set((state) => {
      const next: Record<string, AIInlinePatchPreview> = {};
      artifacts.forEach((artifact) => {
        if (
          artifact.kind !== AIChatRunArtifactKind.AIChatRunArtifactPatchPreview
        ) {
          return;
        }
        if (artifact.status !== "ready") {
          return;
        }
        if (state.dismissedIds[artifact.id]) {
          return;
        }
        const payload = parsePatchPayload(artifact);
        if (
          !payload?.checkReady ||
          !payload.unifiedDiff.trim() ||
          payload.files.length === 0
        ) {
          return;
        }
        next[artifact.id] = {
          id: artifact.id,
          runId: artifact.runId,
          sessionId: artifact.sessionId,
          title: artifact.title || "Patch preview",
          status: artifact.status,
          summary: artifact.summary,
          unifiedDiff: payload.unifiedDiff,
          files: payload.files,
          updatedAt: artifact.updatedAt,
        };
      });
      return { previews: next };
    }),

  dismissPreview: (previewId) =>
    set((state) => {
      const { [previewId]: _removed, ...remaining } = state.previews;
      return {
        previews: remaining,
        dismissedIds: { ...state.dismissedIds, [previewId]: true },
      };
    }),

  clearPreview: (previewId) =>
    set((state) => {
      const { [previewId]: _removed, ...remaining } = state.previews;
      return { previews: remaining };
    }),

  clearAll: () => set({ previews: {} }),
}));
