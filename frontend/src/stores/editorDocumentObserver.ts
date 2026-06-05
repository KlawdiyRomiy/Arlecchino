import {
  NotifyFileChanged,
  NotifyFileClosed,
  NotifyFileOpened,
  RecordFileAccess,
} from "../wails/app";
import { EventsOn } from "../wails/runtime";
import {
  isSameOrChildPathByIdentity,
  normalizeProjectPath,
  normalizeProjectPathIdentity,
  projectPathsEqualByIdentity,
} from "../utils/projectPaths";

interface EditorDocumentRecord {
  path: string;
  language: string;
  content: string;
  version: number;
  surfaceIds: Set<string>;
  notifyingSurfaceIds: Set<string>;
  opened: boolean;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  pendingVersion: number;
  pendingContent: string;
}

interface EditorDocumentSurfaceRecord {
  key: string;
  notifiesBackend: boolean;
}

interface EditorDocumentOpenInput {
  surfaceId: string;
  path: string;
  language: string;
  content: string;
  largeDocument?: boolean;
}

interface EditorDocumentChangeInput {
  surfaceId: string;
  path: string;
  language: string;
  content: string;
  delayMs?: number;
}

export interface RuntimeRefreshedEvent {
  sessionId?: string;
  projectPath?: string;
  languages?: string[];
  restarted?: string[];
  workDirs?: string[];
}

let nextSurfaceSequence = 0;
const documents = new Map<string, EditorDocumentRecord>();
const surfaces = new Map<string, EditorDocumentSurfaceRecord>();

const normalizePath = (path: string): string =>
  normalizeProjectPath(path).replace(/\\/g, "/").replace(/\/+/g, "/");

const normalizeLanguage = (language: string): string =>
  language.trim().toLowerCase();

const documentKey = (path: string, language: string): string =>
  `${normalizeProjectPathIdentity(path)}\0${normalizeLanguage(language)}`;

const findDocumentKeyByPath = (path: string): string | null => {
  const normalizedPath = normalizePath(path);
  for (const [key, record] of documents.entries()) {
    if (projectPathsEqualByIdentity(record.path, normalizedPath)) {
      return key;
    }
  }
  return null;
};

const getOrCreateDocument = (
  path: string,
  language: string,
  content: string,
): EditorDocumentRecord => {
  const key = documentKey(path, language);
  const existing = documents.get(key);
  if (existing) {
    return existing;
  }

  const record: EditorDocumentRecord = {
    path,
    language,
    content,
    version: 1,
    surfaceIds: new Set(),
    notifyingSurfaceIds: new Set(),
    opened: false,
    pendingTimer: null,
    pendingVersion: 1,
    pendingContent: content,
  };
  documents.set(key, record);
  return record;
};

const clearPendingChange = (record: EditorDocumentRecord): void => {
  if (record.pendingTimer !== null) {
    clearTimeout(record.pendingTimer);
    record.pendingTimer = null;
  }
};

const flushPendingChange = (record: EditorDocumentRecord): void => {
  if (record.pendingTimer === null) {
    return;
  }
  clearPendingChange(record);
  void NotifyFileChanged(
    record.path,
    record.language,
    record.pendingVersion,
    record.pendingContent,
  ).catch(console.warn);
};

const openBackendDocument = (record: EditorDocumentRecord): void => {
  if (record.opened || record.notifyingSurfaceIds.size === 0) {
    return;
  }
  record.opened = true;
  record.version = Math.max(1, record.version);
  record.pendingVersion = record.version;
  record.pendingContent = record.content;
  void NotifyFileOpened(record.path, record.language, record.content).catch(
    console.warn,
  );
};

const closeBackendDocumentIfUnused = (record: EditorDocumentRecord): void => {
  if (!record.opened || record.notifyingSurfaceIds.size > 0) {
    return;
  }
  flushPendingChange(record);
  record.opened = false;
  void NotifyFileClosed(record.path, record.language).catch(console.warn);
};

export const resyncOpenEditorDocuments = (
  event?: RuntimeRefreshedEvent,
): void => {
  const languages = new Set(
    (event?.languages ?? [])
      .map((language) => normalizeLanguage(language))
      .filter(Boolean),
  );
  const projectPathIdentity = normalizeProjectPathIdentity(
    event?.projectPath ?? "",
  );
  const records = Array.from(documents.values()).filter(
    (record) =>
      record.notifyingSurfaceIds.size > 0 &&
      (languages.size === 0 ||
        languages.has(normalizeLanguage(record.language))) &&
      (!projectPathIdentity ||
        isSameOrChildPathByIdentity(record.path, projectPathIdentity)),
  );
  for (const record of records) {
    clearPendingChange(record);
    record.opened = false;
    record.version = Math.max(1, record.version);
    record.pendingVersion = record.version;
    record.pendingContent = record.content;

    void (async () => {
      try {
        await NotifyFileOpened(record.path, record.language, record.content);
        await NotifyFileChanged(
          record.path,
          record.language,
          record.version,
          record.content,
        );
        record.opened = true;
      } catch (error) {
        console.warn(error);
      }
    })();
  }
};

const runtimeRefreshUnsubscribe = EventsOn<[RuntimeRefreshedEvent]>(
  "depsync:runtime-refreshed",
  (event) => {
    resyncOpenEditorDocuments(event);
  },
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    runtimeRefreshUnsubscribe();
  });
}

export const createEditorDocumentSurfaceId = (prefix: string): string => {
  nextSurfaceSequence += 1;
  return `${prefix}:${nextSurfaceSequence}`;
};

export const recordEditorDocumentAccess = (path: string): void => {
  if (!path) {
    return;
  }
  void RecordFileAccess(path).catch(() => {});
};

export const getEditorDocumentVersion = (
  path: string,
  language: string,
): number | null => {
  if (!path || !language) {
    return null;
  }
  return documents.get(documentKey(path, language))?.version ?? null;
};

export const openEditorDocument = ({
  surfaceId,
  path,
  language,
  content,
  largeDocument = false,
}: EditorDocumentOpenInput): void => {
  if (!surfaceId || !path || !language) {
    return;
  }

  const key = documentKey(path, language);
  const previousSurface = surfaces.get(surfaceId);
  if (previousSurface && previousSurface.key !== key) {
    closeEditorDocument(surfaceId);
  }

  const record = getOrCreateDocument(path, language, content);
  const notifiesBackend = !largeDocument;
  record.surfaceIds.add(surfaceId);
  if (notifiesBackend) {
    record.notifyingSurfaceIds.add(surfaceId);
  } else {
    record.notifyingSurfaceIds.delete(surfaceId);
  }
  surfaces.set(surfaceId, { key, notifiesBackend });

  record.content = content;
  if (record.pendingTimer === null) {
    record.pendingContent = content;
    record.pendingVersion = record.version;
  }
  if (notifiesBackend) {
    openBackendDocument(record);
  } else {
    closeBackendDocumentIfUnused(record);
  }
  recordEditorDocumentAccess(path);
};

export const notifyEditorDocumentChanged = ({
  surfaceId,
  path,
  language,
  content,
  delayMs = 0,
}: EditorDocumentChangeInput): void => {
  if (!surfaceId || !path || !language) {
    return;
  }

  const key = documentKey(path, language);
  const surface = surfaces.get(surfaceId);
  if (!surface || surface.key !== key) {
    openEditorDocument({ surfaceId, path, language, content });
  }

  const record = getOrCreateDocument(path, language, content);
  const activeSurface = surfaces.get(surfaceId);
  if (!activeSurface?.notifiesBackend) {
    return;
  }

  record.version += 1;
  record.pendingVersion = record.version;
  record.pendingContent = content;
  record.content = content;
  clearPendingChange(record);

  const publish = () => {
    record.pendingTimer = null;
    void NotifyFileChanged(
      record.path,
      record.language,
      record.pendingVersion,
      record.pendingContent,
    ).catch(console.warn);
  };

  if (delayMs <= 0) {
    publish();
    return;
  }

  record.pendingTimer = setTimeout(publish, delayMs);
};

export const replaceEditorDocumentFromDisk = (
  path: string,
  language: string,
  content: string,
): void => {
  const key = documentKey(path, language);
  const record =
    documents.get(key) ?? documents.get(findDocumentKeyByPath(path) ?? "");
  if (!record || record.notifyingSurfaceIds.size === 0) {
    return;
  }
  const surfaceId = record.notifyingSurfaceIds.values().next().value;
  if (!surfaceId) {
    return;
  }

  notifyEditorDocumentChanged({
    surfaceId,
    path,
    language,
    content,
    delayMs: 0,
  });
};

export const closeEditorDocument = (surfaceId: string): void => {
  const surface = surfaces.get(surfaceId);
  if (!surface) {
    return;
  }

  surfaces.delete(surfaceId);
  const record = documents.get(surface.key);
  if (!record) {
    return;
  }

  record.surfaceIds.delete(surfaceId);
  record.notifyingSurfaceIds.delete(surfaceId);
  closeBackendDocumentIfUnused(record);

  if (record.surfaceIds.size === 0) {
    documents.delete(surface.key);
  }
};

export const resetEditorDocumentObserverForTests = (): void => {
  documents.forEach(clearPendingChange);
  documents.clear();
  surfaces.clear();
  nextSurfaceSequence = 0;
};
