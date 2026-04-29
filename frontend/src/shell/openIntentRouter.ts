import type {
  OpenPreviewWindowInput,
  PreviewSurfaceType,
  PreviewWindowMode,
  PreviewWindowPayload,
  PreviewWindowPosition,
} from "../stores/previewWindowStore";

export const OPEN_INTENT_EVENT = "ide:intent:open";

const MAX_PENDING_OPEN_INTENTS = 32;

type MaybePromise<T> = T | Promise<T>;

export type OpenIntentKind =
  | "openProject"
  | "openFile"
  | "openPreview"
  | "focusSurface";

interface BaseOpenIntent {
  id?: string;
  source?: string;
}

export interface OpenProjectIntent extends BaseOpenIntent {
  kind: "openProject";
  projectPath: string;
}

export interface OpenFileIntent extends BaseOpenIntent {
  kind: "openFile";
  path: string;
  line?: number;
}

export interface OpenPreviewIntent extends BaseOpenIntent {
  kind: "openPreview";
  preview: OpenPreviewWindowInput;
}

export interface FocusSurfaceIntent extends BaseOpenIntent {
  kind: "focusSurface";
  surfaceId?: string;
  previewWindowId?: string;
  panelId?: string;
}

export type OpenIntent =
  | OpenProjectIntent
  | OpenFileIntent
  | OpenPreviewIntent
  | FocusSurfaceIntent;

export interface OpenIntentDispatcher {
  openProject: (
    projectPath: string,
    intent: OpenProjectIntent,
  ) => MaybePromise<void>;
  openFile: (
    path: string,
    line: number | undefined,
    intent: OpenFileIntent,
  ) => MaybePromise<void>;
  openPreview: (
    input: OpenPreviewWindowInput,
    intent: OpenPreviewIntent,
  ) => MaybePromise<void>;
  focusSurface: (intent: FocusSurfaceIntent) => MaybePromise<void>;
}

export interface OpenIntentRouteResult {
  ok: boolean;
  status: "dispatched" | "queued" | "rejected";
  queued: boolean;
  intent?: OpenIntent;
  queueLength: number;
  reason?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const unwrapEventPayload = (value: unknown): unknown => {
  if (Array.isArray(value) && value.length === 1) {
    return unwrapEventPayload(value[0]);
  }

  return value;
};

const getString = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const getNumber = (
  source: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const getBoolean = (
  source: Record<string, unknown>,
  key: string,
): boolean | undefined =>
  typeof source[key] === "boolean" ? source[key] : undefined;

const getKindCandidate = (source: Record<string, unknown>): unknown =>
  source.kind ?? source.type ?? source.action ?? source.intent ?? source.name;

const normalizeKind = (value: unknown): OpenIntentKind | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s.-]+/g, "_")
    .replace(/_+/g, "_");
  const compact = normalized.replace(/_/g, "");

  switch (compact) {
    case "openproject":
    case "projectopen":
    case "project":
      return "openProject";
    case "openfile":
    case "fileopen":
    case "file":
    case "editoropen":
      return "openFile";
    case "openpreview":
    case "previewopen":
    case "preview":
    case "openbrowser":
    case "browseropen":
      return "openPreview";
    case "focussurface":
    case "surfacefocus":
    case "focus":
    case "previewfocus":
    case "panelfocus":
      return "focusSurface";
    default:
      return null;
  }
};

const inferKind = (source: Record<string, unknown>): OpenIntentKind | null => {
  const explicitKind = normalizeKind(getKindCandidate(source));
  if (explicitKind) {
    return explicitKind;
  }

  if (getString(source, "projectPath") || getString(source, "project_path")) {
    return "openProject";
  }

  if (getString(source, "filePath") || getString(source, "file_path")) {
    return "openFile";
  }

  if (
    getString(source, "url") ||
    getString(source, "surface") ||
    isRecord(source.preview)
  ) {
    return "openPreview";
  }

  if (
    getString(source, "surfaceId") ||
    getString(source, "surface_id") ||
    getString(source, "previewWindowId") ||
    getString(source, "preview_window_id") ||
    getString(source, "windowId") ||
    getString(source, "window_id") ||
    getString(source, "panelId") ||
    getString(source, "panel_id") ||
    getString(source, "panel")
  ) {
    return "focusSurface";
  }

  if (getString(source, "path") || getString(source, "file")) {
    return "openFile";
  }

  return null;
};

const toPreviewSurface = (value: unknown): PreviewSurfaceType | null => {
  if (typeof value !== "string") {
    return null;
  }

  switch (value.trim().toLowerCase()) {
    case "file":
      return "file";
    case "code":
    case "editor":
      return "code";
    case "browser":
    case "web":
    case "url":
      return "browser";
    case "git":
    case "scm":
      return "git";
    case "chat":
    case "ai":
    case "assistant":
      return "chat";
    case "terminal":
    case "shell":
      return "terminal";
    case "appearance":
    case "theme":
    case "layout":
    case "ide":
      return "appearance";
    default:
      return null;
  }
};

const toPreviewMode = (value: unknown): PreviewWindowMode | undefined =>
  value === "floating" || value === "snapped" ? value : undefined;

const toPreviewPosition = (
  value: unknown,
): PreviewWindowPosition | undefined => {
  switch (value) {
    case "left":
    case "right":
    case "top":
    case "bottom":
      return value;
    default:
      return undefined;
  }
};

const toPreviewPayload = (value: unknown): PreviewWindowPayload => {
  if (!isRecord(value)) {
    return {};
  }

  const payload: PreviewWindowPayload = {};
  Object.entries(value).forEach(([key, item]) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      payload[key] = item;
    }
  });
  return payload;
};

const parsePreviewIntentInput = (
  source: Record<string, unknown>,
): OpenPreviewWindowInput | null => {
  const previewSource = isRecord(source.preview) ? source.preview : source;
  const nestedPayload = toPreviewPayload(previewSource.payload);
  const directPayload = toPreviewPayload(previewSource);
  const payload: PreviewWindowPayload = {
    ...directPayload,
    ...nestedPayload,
  };

  delete payload.id;
  delete payload.kind;
  delete payload.type;
  delete payload.action;
  delete payload.intent;
  delete payload.name;
  delete payload.source;
  delete payload.surface;
  delete payload.preview;
  delete payload.payload;
  delete payload.mode;
  delete payload.window_mode;
  delete payload.position;
  delete payload.side;
  delete payload.width;
  delete payload.height;
  delete payload.x;
  delete payload.y;
  delete payload.pinned;
  delete payload.focus;

  const nestedPayloadSource = isRecord(previewSource.payload)
    ? previewSource.payload
    : undefined;
  const surface =
    toPreviewSurface(previewSource.surface) ||
    toPreviewSurface(nestedPayloadSource?.surface) ||
    (payload.url ? "browser" : null) ||
    (payload.path ? "file" : null);
  if (!surface) {
    return null;
  }

  const modeCandidate =
    toPreviewMode(previewSource.mode) ||
    toPreviewMode(previewSource.window_mode);
  const side = getString(previewSource, "side");

  return {
    id: getString(previewSource, "id"),
    surface,
    title: getString(previewSource, "title"),
    payload,
    mode:
      modeCandidate ??
      (previewSource.mode === "tab" || previewSource.mode === "side"
        ? "snapped"
        : undefined),
    position:
      toPreviewPosition(previewSource.position) ??
      (previewSource.mode === "side" && side === "left"
        ? "left"
        : previewSource.mode === "side" && side === "right"
          ? "right"
          : undefined),
    side: side === "left" || side === "right" ? side : undefined,
    width: getNumber(previewSource, "width"),
    height: getNumber(previewSource, "height"),
    x: getNumber(previewSource, "x"),
    y: getNumber(previewSource, "y"),
    pinned: getBoolean(previewSource, "pinned"),
  };
};

export const parseOpenIntentPayload = (value: unknown): OpenIntent | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (isRecord(normalizedValue) && isRecord(normalizedValue.intent)) {
    const nestedIntent = normalizedValue.intent;
    if (!getKindCandidate(nestedIntent)) {
      return parseOpenIntentPayload({
        ...nestedIntent,
        kind: getKindCandidate(normalizedValue),
        source: getString(normalizedValue, "source"),
      });
    }
    return parseOpenIntentPayload({
      ...nestedIntent,
      source:
        getString(nestedIntent, "source") ??
        getString(normalizedValue, "source"),
    });
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const kind = inferKind(normalizedValue);
  if (!kind) {
    return null;
  }

  const base = {
    id: getString(normalizedValue, "id"),
    source: getString(normalizedValue, "source"),
  };

  switch (kind) {
    case "openProject": {
      const projectPath =
        getString(normalizedValue, "projectPath") ||
        getString(normalizedValue, "project_path") ||
        getString(normalizedValue, "path");
      return projectPath ? { ...base, kind, projectPath } : null;
    }
    case "openFile": {
      const path =
        getString(normalizedValue, "filePath") ||
        getString(normalizedValue, "file_path") ||
        getString(normalizedValue, "path") ||
        getString(normalizedValue, "file");
      return path
        ? { ...base, kind, path, line: getNumber(normalizedValue, "line") }
        : null;
    }
    case "openPreview": {
      const preview = parsePreviewIntentInput(normalizedValue);
      return preview ? { ...base, kind, preview } : null;
    }
    case "focusSurface": {
      const surfaceId =
        getString(normalizedValue, "surfaceId") ||
        getString(normalizedValue, "surface_id");
      const previewWindowId =
        getString(normalizedValue, "previewWindowId") ||
        getString(normalizedValue, "preview_window_id") ||
        getString(normalizedValue, "windowId") ||
        getString(normalizedValue, "window_id");
      const panelId =
        getString(normalizedValue, "panelId") ||
        getString(normalizedValue, "panel_id") ||
        getString(normalizedValue, "panel");
      if (!surfaceId && !previewWindowId && !panelId) {
        return null;
      }
      return { ...base, kind, surfaceId, previewWindowId, panelId };
    }
  }
};

let activeDispatcher: OpenIntentDispatcher | null = null;
let activeFlush: Promise<OpenIntentRouteResult[]> | null = null;
const pendingOpenIntents: OpenIntent[] = [];

const queueOpenIntent = (intent: OpenIntent): OpenIntentRouteResult => {
  if (pendingOpenIntents.length >= MAX_PENDING_OPEN_INTENTS) {
    pendingOpenIntents.shift();
  }
  pendingOpenIntents.push(intent);

  return {
    ok: true,
    status: "queued",
    queued: true,
    intent,
    queueLength: pendingOpenIntents.length,
  };
};

const dispatchOpenIntent = async (
  intent: OpenIntent,
  dispatcher: OpenIntentDispatcher,
): Promise<void> => {
  switch (intent.kind) {
    case "openProject":
      await dispatcher.openProject(intent.projectPath, intent);
      return;
    case "openFile":
      await dispatcher.openFile(intent.path, intent.line, intent);
      return;
    case "openPreview":
      await dispatcher.openPreview(intent.preview, intent);
      return;
    case "focusSurface":
      await dispatcher.focusSurface(intent);
      return;
  }
};

export const flushPendingOpenIntents = (): Promise<OpenIntentRouteResult[]> => {
  if (activeFlush) {
    return activeFlush;
  }

  const dispatcher = activeDispatcher;
  if (!dispatcher || pendingOpenIntents.length === 0) {
    return Promise.resolve([]);
  }

  const flush = async () => {
    const intents = pendingOpenIntents.splice(0, pendingOpenIntents.length);
    const results: OpenIntentRouteResult[] = [];
    for (const intent of intents) {
      try {
        await dispatchOpenIntent(intent, dispatcher);
        results.push({
          ok: true,
          status: "dispatched",
          queued: false,
          intent,
          queueLength: pendingOpenIntents.length,
        });
      } catch (error) {
        results.push({
          ok: false,
          status: "rejected",
          queued: false,
          intent,
          queueLength: pendingOpenIntents.length,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  };

  const trackedFlush = flush().finally(() => {
    if (activeFlush === trackedFlush) {
      activeFlush = null;
    }
  });
  activeFlush = trackedFlush;
  return activeFlush;
};

export const registerOpenIntentDispatcher = (
  dispatcher: OpenIntentDispatcher,
): (() => void) => {
  activeDispatcher = dispatcher;
  void flushPendingOpenIntents();

  return () => {
    if (activeDispatcher === dispatcher) {
      activeDispatcher = null;
    }
  };
};

export const routeOpenIntent = async (
  payload: unknown,
): Promise<OpenIntentRouteResult> => {
  const intent = parseOpenIntentPayload(payload);
  if (!intent) {
    return {
      ok: false,
      status: "rejected",
      queued: false,
      queueLength: pendingOpenIntents.length,
      reason: "Invalid open intent payload.",
    };
  }

  const dispatcher = activeDispatcher;
  if (!dispatcher) {
    return queueOpenIntent(intent);
  }

  await dispatchOpenIntent(intent, dispatcher);
  return {
    ok: true,
    status: "dispatched",
    queued: false,
    intent,
    queueLength: pendingOpenIntents.length,
  };
};

export const getPendingOpenIntents = (): OpenIntent[] =>
  pendingOpenIntents.map((intent) => ({ ...intent }));

export const clearPendingOpenIntents = () => {
  pendingOpenIntents.splice(0, pendingOpenIntents.length);
};
