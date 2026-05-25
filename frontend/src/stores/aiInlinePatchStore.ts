import { create } from "zustand";

import {
  AIChatRunArtifactKind,
  AIPatchArtifactPayload,
  type AIChatRunArtifact,
  type AIPatchFile,
} from "../../bindings/arlecchino/internal/ai/models";
import { getCurrentProjectSessionId } from "../shell/projectSessionRoute";
import {
  isSameOrChildPathByIdentity,
  normalizeProjectPath,
  projectPathsEqualByIdentity,
} from "../utils/projectPaths";

export interface AIInlinePatchPreview {
  id: string;
  runId: string;
  sessionId: string;
  projectSessionId: string;
  title: string;
  status: string;
  summary?: string;
  unifiedDiff: string;
  files: AIPatchFile[];
  alreadyApplied?: boolean;
  source?: string;
  updatedAt?: string;
}

export interface AIInlinePatchScope {
  projectPath?: string | null;
  projectSessionId?: string | null;
}

interface AIInlinePatchState {
  previews: Record<string, AIInlinePatchPreview>;
  dismissedIds: Record<string, true>;
  busyIds: Record<string, true>;
  syncArtifacts: (
    artifacts: AIChatRunArtifact[],
    scope?: AIInlinePatchScope,
  ) => void;
  upsertArtifact: (
    artifact: AIChatRunArtifact,
    scope?: AIInlinePatchScope,
  ) => void;
  removePreview: (previewId: string, scope?: AIInlinePatchScope) => void;
  acknowledgePreview: (previewId: string, scope?: AIInlinePatchScope) => void;
  dismissPreview: (previewId: string, scope?: AIInlinePatchScope) => void;
  clearPreview: (previewId: string) => void;
  beginBusy: (previewId: string) => boolean;
  endBusy: (previewId: string) => void;
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

const collapsePathSegments = (value: string): string => {
  const normalized = normalizeProjectPath(
    value.replace(/\\/g, "/").replace(/\/+/g, "/"),
  );
  const absolute = normalized.startsWith("/");
  const drive = normalized.match(/^[A-Za-z]:\//)?.[0] ?? "";
  const source = drive ? normalized.slice(drive.length) : normalized;
  const segments: string[] = [];
  source.split("/").forEach((segment) => {
    if (!segment || segment === ".") {
      return;
    }
    if (segment === "..") {
      segments.pop();
      return;
    }
    segments.push(segment);
  });
  const prefix = drive || (absolute ? "/" : "");
  return `${prefix}${segments.join("/")}` || (absolute ? "/" : "");
};

export const normalizeAIInlinePatchPath = (value: string): string =>
  collapsePathSegments(value);

const normalizePatchPathText = (value: string): string =>
  normalizeProjectPath(value.trim().replace(/\\/g, "/").replace(/\/+/g, "/"));

const stripPatchPrefix = (value: string): string => {
  const normalized = normalizePatchPathText(value);
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return normalized;
  }
  return normalized
    .replace(/^\.\//, "")
    .replace(/^a\//, "")
    .replace(/^b\//, "");
};

const normalizeProjectSessionId = (value?: string | null): string =>
  typeof value === "string" ? value.trim() : "";

const resolveScopeProjectSessionId = (scope?: AIInlinePatchScope): string =>
  normalizeProjectSessionId(scope?.projectSessionId) ||
  getCurrentProjectSessionId();

const artifactProjectSessionId = (artifact: AIChatRunArtifact): string =>
  normalizeProjectSessionId(artifact.projectSessionId);

const dismissedPreviewKey = (
  projectSessionId: string,
  previewId: string,
): string => `${projectSessionId}\0${previewId}`;

const isPreviewDismissed = (
  dismissedIds: Record<string, true>,
  projectSessionId: string,
  previewId: string,
): boolean =>
  Boolean(dismissedIds[dismissedPreviewKey(projectSessionId, previewId)]);

const artifactMatchesScope = (
  artifact: AIChatRunArtifact,
  scope?: AIInlinePatchScope,
): boolean => {
  const expectedProjectSessionId = resolveScopeProjectSessionId(scope);
  const artifactSessionId = artifactProjectSessionId(artifact);
  return (
    expectedProjectSessionId.length > 0 &&
    artifactSessionId.length > 0 &&
    artifactSessionId === expectedProjectSessionId
  );
};

export const resolveAIInlinePatchFilePath = (
  projectPath: string | null | undefined,
  patchPath: string,
  options: { stripGitPrefix?: boolean } = {},
): string => {
  const patch = options.stripGitPrefix
    ? stripPatchPrefix(patchPath)
    : normalizePatchPathText(patchPath);
  if (!patch || patch === "/dev/null") {
    return "";
  }
  if (patch.split("/").some((segment) => segment === "..")) {
    return "";
  }
  const normalizedPatch = normalizeAIInlinePatchPath(patch);
  if (!normalizedPatch) {
    return "";
  }
  if (normalizedPatch.startsWith("/") || /^[A-Za-z]:\//.test(normalizedPatch)) {
    return normalizedPatch;
  }

  const projectRoot = normalizeAIInlinePatchPath(projectPath ?? "");
  if (!projectRoot) {
    return normalizedPatch;
  }
  const resolved = normalizeAIInlinePatchPath(
    `${projectRoot}/${normalizedPatch}`,
  );
  return isSameOrChildPathByIdentity(resolved, projectRoot) ? resolved : "";
};

export const aiInlinePatchPathMatches = (
  editorPath: string,
  patchPath: string,
  projectPath?: string | null,
  options: { stripGitPrefix?: boolean } = {},
): boolean => {
  const editor = normalizeAIInlinePatchPath(editorPath);
  const patch = resolveAIInlinePatchFilePath(projectPath, patchPath, options);
  if (!editor || !patch) {
    return false;
  }
  return projectPathsEqualByIdentity(editor, patch);
};

const previewFilesAreWithinProject = (
  preview: AIInlinePatchPreview,
  projectPath?: string | null,
): boolean => {
  const projectRoot = normalizeAIInlinePatchPath(projectPath ?? "");
  if (!projectRoot) {
    return true;
  }
  return preview.files.every((file) =>
    isSameOrChildPathByIdentity(
      resolveAIInlinePatchFilePath(projectRoot, file.path),
      projectRoot,
    ),
  );
};

export const selectAIInlinePatchPreviewForPath = (
  previews: Record<string, AIInlinePatchPreview>,
  filePath: string,
  scope: AIInlinePatchScope = {},
): AIInlinePatchPreview | null => {
  const projectSessionId = resolveScopeProjectSessionId(scope);
  if (!projectSessionId) {
    return null;
  }
  const entries = Object.values(previews)
    .filter(
      (preview) =>
        !projectSessionId || preview.projectSessionId === projectSessionId,
    )
    .filter((preview) =>
      previewFilesAreWithinProject(preview, scope.projectPath),
    )
    .filter((preview) =>
      preview.files.some((file) =>
        aiInlinePatchPathMatches(filePath, file.path, scope.projectPath),
      ),
    )
    .sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")),
    );
  return entries[0] ?? null;
};

const buildPreviewFromArtifact = (
  artifact: AIChatRunArtifact,
  dismissedIds: Record<string, true>,
  scope?: AIInlinePatchScope,
): AIInlinePatchPreview | null => {
  if (!artifactMatchesScope(artifact, scope)) {
    return null;
  }
  if (artifact.kind !== AIChatRunArtifactKind.AIChatRunArtifactPatchPreview) {
    return null;
  }
  const projectSessionId = artifactProjectSessionId(artifact);
  if (isPreviewDismissed(dismissedIds, projectSessionId, artifact.id)) {
    return null;
  }
  const payload = parsePatchPayload(artifact);
  if (!payload) {
    return null;
  }
  const alreadyApplied =
    artifact.status === "applied" &&
    payload.alreadyApplied === true &&
    payload.source === "captured_direct_write";
  if (artifact.status !== "ready" && !alreadyApplied) {
    return null;
  }
  if (
    (!payload.checkReady && !alreadyApplied) ||
    !payload.unifiedDiff.trim() ||
    payload.files.length === 0
  ) {
    return null;
  }
  return {
    id: artifact.id,
    runId: artifact.runId,
    sessionId: artifact.sessionId,
    projectSessionId,
    title: artifact.title || "Patch preview",
    status: artifact.status,
    summary: artifact.summary,
    unifiedDiff: payload.unifiedDiff,
    files: payload.files,
    alreadyApplied,
    source: payload.source,
    updatedAt: artifact.updatedAt,
  };
};

const removePreviewFromState = (
  previews: Record<string, AIInlinePatchPreview>,
  previewId: string,
): Record<string, AIInlinePatchPreview> => {
  const { [previewId]: _removed, ...remaining } = previews;
  return remaining;
};

export const useAIInlinePatchStore = create<AIInlinePatchState>((set) => ({
  previews: {},
  dismissedIds: {},
  busyIds: {},

  syncArtifacts: (artifacts, scope) =>
    set((state) => {
      const projectSessionId = resolveScopeProjectSessionId(scope);
      const nextScoped: Record<string, AIInlinePatchPreview> = {};
      artifacts.forEach((artifact) => {
        const preview = buildPreviewFromArtifact(artifact, state.dismissedIds, {
          ...scope,
          projectSessionId,
        });
        if (preview) {
          nextScoped[artifact.id] = preview;
        }
      });
      const nextPreviews = { ...state.previews };
      Object.values(state.previews).forEach((preview) => {
        if (preview.projectSessionId === projectSessionId) {
          delete nextPreviews[preview.id];
        }
      });
      return { previews: { ...nextPreviews, ...nextScoped } };
    }),

  upsertArtifact: (artifact, scope) =>
    set((state) => {
      if (!artifactMatchesScope(artifact, scope)) {
        return state;
      }
      const preview = buildPreviewFromArtifact(
        artifact,
        state.dismissedIds,
        scope,
      );
      if (!preview) {
        return {
          previews: removePreviewFromState(state.previews, artifact.id),
        };
      }
      return {
        previews: {
          ...state.previews,
          [artifact.id]: preview,
        },
      };
    }),

  removePreview: (previewId, scope) =>
    set((state) => {
      const projectSessionId = normalizeProjectSessionId(
        scope?.projectSessionId,
      );
      const preview = state.previews[previewId];
      if (
        preview &&
        projectSessionId &&
        preview.projectSessionId !== projectSessionId
      ) {
        return state;
      }
      const remaining = removePreviewFromState(state.previews, previewId);
      return { previews: remaining };
    }),

  acknowledgePreview: (previewId, scope) =>
    set((state) => {
      const preview = state.previews[previewId];
      const projectSessionId =
        preview?.projectSessionId || resolveScopeProjectSessionId(scope);
      const remaining = removePreviewFromState(state.previews, previewId);
      if (!projectSessionId) {
        return { previews: remaining };
      }
      return {
        previews: remaining,
        dismissedIds: {
          ...state.dismissedIds,
          [dismissedPreviewKey(projectSessionId, previewId)]: true,
        },
      };
    }),

  dismissPreview: (previewId, scope) =>
    set((state) => {
      const preview = state.previews[previewId];
      const projectSessionId =
        preview?.projectSessionId || resolveScopeProjectSessionId(scope);
      const remaining = removePreviewFromState(state.previews, previewId);
      if (!projectSessionId) {
        return { previews: remaining };
      }
      return {
        previews: remaining,
        dismissedIds: {
          ...state.dismissedIds,
          [dismissedPreviewKey(projectSessionId, previewId)]: true,
        },
      };
    }),

  clearPreview: (previewId) =>
    set((state) => {
      const remaining = removePreviewFromState(state.previews, previewId);
      return { previews: remaining };
    }),

  beginBusy: (previewId) => {
    let acquired = false;
    set((state) => {
      if (!previewId || state.busyIds[previewId]) {
        return state;
      }
      acquired = true;
      return {
        busyIds: {
          ...state.busyIds,
          [previewId]: true,
        },
      };
    });
    return acquired;
  },

  endBusy: (previewId) =>
    set((state) => {
      const { [previewId]: _completed, ...remaining } = state.busyIds;
      return { busyIds: remaining };
    }),

  clearAll: () => set({ previews: {}, busyIds: {} }),
}));
