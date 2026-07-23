export const PROJECT_ENTRIES_CHANGED_EVENT = "project:entries:changed";

export interface ProjectFilesystemEntryChange {
  path: string;
  isDirectory: boolean;
}

export interface ProjectFilesystemChangeBatch {
  created: ProjectFilesystemEntryChange[];
  changed: string[];
  deleted: ProjectFilesystemEntryChange[];
}

const emptyBatch = (): ProjectFilesystemChangeBatch => ({
  created: [],
  changed: [],
  deleted: [],
});

const toEntryChange = (value: unknown): ProjectFilesystemEntryChange | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const { path, isDirectory } = value as {
    path?: unknown;
    isDirectory?: unknown;
  };
  if (typeof path !== "string" || path.trim() === "") {
    return null;
  }

  return { path, isDirectory: Boolean(isDirectory) };
};

const toEntryChanges = (value: unknown): ProjectFilesystemEntryChange[] =>
  Array.isArray(value)
    ? value
        .map(toEntryChange)
        .filter(
          (entry): entry is ProjectFilesystemEntryChange => entry !== null,
        )
    : [];

const toChangedPaths = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (path): path is string =>
          typeof path === "string" && path.trim() !== "",
      )
    : [];

export const parseProjectFilesystemChangeBatch = (
  payload: unknown,
): ProjectFilesystemChangeBatch => {
  if (!payload || typeof payload !== "object") {
    return emptyBatch();
  }

  const { created, changed, deleted } = payload as {
    created?: unknown;
    changed?: unknown;
    deleted?: unknown;
  };
  return {
    created: toEntryChanges(created),
    changed: toChangedPaths(changed),
    deleted: toEntryChanges(deleted),
  };
};
