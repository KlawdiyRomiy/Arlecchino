import {
  InspectEditorFile,
  ReadEditorBinaryFile,
  ReadEditorFilePreview,
  ReadEditorVisualFile,
  ReadFile,
} from "../wails/app";
import type { OpenIntentPolicy } from "../shell/openIntentRouter";

export type EditorFileAccessPolicy = OpenIntentPolicy;

const confirmedWritablePaths = new Set<string>();

const normalizedAccessPath = (path: string): string => path.trim();

export const grantEditorFileWriteAccess = (path: string) => {
  const normalizedPath = normalizedAccessPath(path);
  if (normalizedPath) {
    confirmedWritablePaths.add(normalizedPath);
  }
};

export const isEditorFilePolicyReadOnly = (
  file: EditorFileLoadState | null | undefined,
): boolean => {
  const path = normalizedAccessPath(file?.path ?? "");
  return Boolean(
    file?.policy?.readOnly && path && !confirmedWritablePaths.has(path),
  );
};

export interface EditorFileInspection {
  path: string;
  name: string;
  sizeBytes: number;
  formattedSize: string;
  isText: boolean;
  safeForEditor: boolean;
  largeDocument: boolean;
  reason: string;
  lineCount: number;
  maxLineLength: number;
  limitBytes: number;
  lineLimit: number;
  maxLineLengthLimit: number;
}

export interface EditorFilePreview {
  inspection: EditorFileInspection;
  content: string;
  truncated: boolean;
  previewBytes: number;
}

export interface EditorVisualFile {
  path: string;
  name: string;
  sizeBytes: number;
  formattedSize: string;
  mimeType: string;
  dataUrl: string;
}

export interface EditorBinaryFieldPair {
  label: string;
  value: string;
}

export interface EditorBinarySection {
  title: string;
  rows: EditorBinaryFieldPair[];
}

export interface EditorBinaryFile {
  path: string;
  name: string;
  sizeBytes: number;
  formattedSize: string;
  format: string;
  mimeType: string;
  reason: string;
  hexPreview: string;
  stringsPreview: string[];
  sections: EditorBinarySection[];
  previewBytes: number;
  truncated: boolean;
}

export type EditorFileLoadingState = {
  kind: "loading";
  path: string;
  name: string;
  policy?: EditorFileAccessPolicy;
};

export type EditorFileLoadState =
  | EditorFileLoadingState
  | {
      kind: "editable";
      path: string;
      name: string;
      content: string;
      inspection: EditorFileInspection;
      policy?: EditorFileAccessPolicy;
    }
  | {
      kind: "guardedPreview";
      path: string;
      name: string;
      preview: EditorFilePreview;
      inspection: EditorFileInspection;
      policy?: EditorFileAccessPolicy;
    }
  | {
      kind: "visualPreview";
      path: string;
      name: string;
      visual: EditorVisualFile;
      policy?: EditorFileAccessPolicy;
    }
  | {
      kind: "binaryPreview";
      path: string;
      name: string;
      binary: EditorBinaryFile;
      inspection?: EditorFileInspection;
      policy?: EditorFileAccessPolicy;
    }
  | {
      kind: "error";
      path: string;
      name: string;
      message: string;
      inspection?: EditorFileInspection;
      policy?: EditorFileAccessPolicy;
    };

export interface EditorNavigationTarget {
  line: number;
  column?: number;
  navId: number;
  focus?: boolean;
}

export interface EditorFileOpenPayload {
  file: EditorFileLoadState;
  line?: number;
  navigationTarget?: EditorNavigationTarget;
}

let editorNavigationTargetId = 0;

const normalizeNavigationOrdinal = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.floor(value));
};

export const createEditorNavigationTarget = (
  line?: number,
  column?: number,
  options: { focus?: boolean } = {},
): EditorNavigationTarget | undefined => {
  const normalizedLine = normalizeNavigationOrdinal(line);
  if (!normalizedLine) {
    return undefined;
  }

  const normalizedColumn = normalizeNavigationOrdinal(column);
  editorNavigationTargetId += 1;
  return {
    line: normalizedLine,
    column: normalizedColumn,
    navId: editorNavigationTargetId,
    focus: options.focus,
  };
};

export const coerceEditorNavigationTarget = (
  target: number | EditorNavigationTarget | undefined,
  options: { focus?: boolean } = {},
): EditorNavigationTarget | undefined => {
  if (typeof target === "number") {
    return createEditorNavigationTarget(target, undefined, options);
  }

  if (!target) {
    return undefined;
  }

  return {
    ...target,
    line: normalizeNavigationOrdinal(target.line) ?? 1,
    column: normalizeNavigationOrdinal(target.column),
    focus: target.focus ?? options.focus,
  };
};

export const getEditorFileName = (path: string): string =>
  path.split("/").pop() || path;

export const isEditorVisualFilePath = (path: string): boolean => {
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(
    ext &&
    [
      "avif",
      "bmp",
      "gif",
      "ico",
      "jpeg",
      "jpe",
      "jfif",
      "jpg",
      "png",
      "svg",
      "webp",
    ].includes(ext),
  );
};

export const createEditorFileLoadingLoad = (
  path: string,
  name?: string,
  policy?: EditorFileAccessPolicy,
): EditorFileLoadingState => ({
  kind: "loading",
  path,
  name: name || getEditorFileName(path),
  policy,
});

export const createEditableEditorFileLoad = (
  path: string,
  content: string,
  inspection?: EditorFileInspection,
  policy?: EditorFileAccessPolicy,
): EditorFileLoadState => ({
  kind: "editable",
  path,
  name: inspection?.name ?? getEditorFileName(path),
  content,
  inspection:
    inspection ??
    ({
      path,
      name: getEditorFileName(path),
      sizeBytes: content.length,
      formattedSize: `${content.length} B`,
      isText: true,
      safeForEditor: true,
      largeDocument: false,
      reason: "safe for interactive editing",
      lineCount: 1,
      maxLineLength: content.length,
      limitBytes: 2 * 1024 * 1024,
      lineLimit: 20_000,
      maxLineLengthLimit: 20_000,
    } satisfies EditorFileInspection),
  policy,
});

export const loadEditorFile = async (
  path: string,
  options: {
    knownContent?: string;
    previewBytes?: number;
    policy?: EditorFileAccessPolicy;
  } = {},
): Promise<EditorFileLoadState> => {
  try {
    if (
      isEditorVisualFilePath(path) &&
      typeof options.knownContent !== "string"
    ) {
      const visual = (await ReadEditorVisualFile(path)) as EditorVisualFile;
      return {
        kind: "visualPreview",
        path,
        name: visual.name || getEditorFileName(path),
        visual,
        policy: options.policy,
      };
    }

    const inspection = (await InspectEditorFile(path)) as
      | EditorFileInspection
      | null
      | undefined;
    if (!inspection || typeof inspection.safeForEditor !== "boolean") {
      const content =
        typeof options.knownContent === "string"
          ? options.knownContent
          : await ReadFile(path);
      return createEditableEditorFileLoad(
        path,
        content,
        undefined,
        options.policy,
      );
    }
    if (inspection.safeForEditor) {
      const content =
        typeof options.knownContent === "string"
          ? options.knownContent
          : await ReadFile(path);
      return createEditableEditorFileLoad(
        path,
        content,
        inspection,
        options.policy,
      );
    }

    if (inspection.isText) {
      const preview = (await ReadEditorFilePreview(
        path,
        options.previewBytes ?? 64 * 1024,
      )) as EditorFilePreview;
      return {
        kind: "guardedPreview",
        path,
        name: inspection.name || getEditorFileName(path),
        preview,
        inspection,
        policy: options.policy,
      };
    }

    if (!inspection.isText) {
      const binary = (await ReadEditorBinaryFile(path)) as EditorBinaryFile;
      return {
        kind: "binaryPreview",
        path,
        name: binary.name || inspection.name || getEditorFileName(path),
        binary,
        inspection,
        policy: options.policy,
      };
    }

    return {
      kind: "error",
      path,
      name: inspection.name || getEditorFileName(path),
      message: inspection.reason || "File cannot be opened in the editor.",
      inspection,
      policy: options.policy,
    };
  } catch (error) {
    return {
      kind: "error",
      path,
      name: getEditorFileName(path),
      message: error instanceof Error ? error.message : String(error),
      policy: options.policy,
    };
  }
};
