import {
  InspectEditorFile,
  ReadEditorFilePreview,
  ReadFile,
} from "../wails/app";

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

export type EditorFileLoadState =
  | {
      kind: "editable";
      path: string;
      name: string;
      content: string;
      inspection: EditorFileInspection;
    }
  | {
      kind: "guardedPreview";
      path: string;
      name: string;
      preview: EditorFilePreview;
      inspection: EditorFileInspection;
    }
  | {
      kind: "error";
      path: string;
      name: string;
      message: string;
      inspection?: EditorFileInspection;
    };

export interface EditorFileOpenPayload {
  file: EditorFileLoadState;
  line?: number;
}

export const getEditorFileName = (path: string): string =>
  path.split("/").pop() || path;

export const createEditableEditorFileLoad = (
  path: string,
  content: string,
  inspection?: EditorFileInspection,
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
});

export const loadEditorFile = async (
  path: string,
  options: { knownContent?: string; previewBytes?: number } = {},
): Promise<EditorFileLoadState> => {
  try {
    const inspection = (await InspectEditorFile(path)) as
      | EditorFileInspection
      | null
      | undefined;
    if (!inspection || typeof inspection.safeForEditor !== "boolean") {
      const content =
        typeof options.knownContent === "string"
          ? options.knownContent
          : await ReadFile(path);
      return createEditableEditorFileLoad(path, content);
    }
    if (inspection.safeForEditor) {
      const content =
        typeof options.knownContent === "string"
          ? options.knownContent
          : await ReadFile(path);
      return createEditableEditorFileLoad(path, content, inspection);
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
      };
    }

    return {
      kind: "error",
      path,
      name: inspection.name || getEditorFileName(path),
      message: inspection.reason || "File cannot be opened in the editor.",
      inspection,
    };
  } catch (error) {
    return {
      kind: "error",
      path,
      name: getEditorFileName(path),
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
