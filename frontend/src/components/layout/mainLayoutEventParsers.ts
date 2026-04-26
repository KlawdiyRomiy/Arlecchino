import type {
  OpenPreviewWindowInput,
  PreviewSurfaceType,
  PreviewWindowPayload,
  UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import type { Theme } from "../../types/theme";
import { normalizeTUIAssistAnchor } from "../../utils/terminalLayout";
import type { PanelPosition } from "../ui/FloatingPanel";
import type {
  PanelOpenRequest,
  PanelSideMoveRequest,
} from "./MainLayout.types";

const unwrapEventPayload = (value: unknown): unknown => {
  if (Array.isArray(value) && value.length === 1) {
    return unwrapEventPayload(value[0]);
  }

  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getStringFromRecord = (
  source: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

const getNumberFromRecord = (
  source: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const getBooleanFromRecord = (
  source: Record<string, unknown>,
  key: string,
): boolean | undefined => {
  const value = source[key];
  return typeof value === "boolean" ? value : undefined;
};

const parsePanelPosition = (value: unknown): PanelPosition | undefined => {
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

const parsePanelMode = (value: unknown): "snapped" | "floating" | undefined => {
  switch (value) {
    case "snapped":
    case "floating":
      return value;
    default:
      return undefined;
  }
};

export const parsePanelOpenRequest = (
  value: unknown,
): PanelOpenRequest | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (typeof normalizedValue === "string") {
    const panel = normalizedValue.trim().toLowerCase();
    return panel ? { panel } : null;
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const panel =
    getStringFromRecord(normalizedValue, "panel") ||
    getStringFromRecord(normalizedValue, "target") ||
    getStringFromRecord(normalizedValue, "id") ||
    getStringFromRecord(normalizedValue, "name");
  if (!panel) {
    return null;
  }

  const position =
    parsePanelPosition(normalizedValue.position) ||
    parsePanelPosition(normalizedValue.side);

  return {
    panel: panel.toLowerCase(),
    position,
    mode: parsePanelMode(normalizedValue.mode),
    width: getNumberFromRecord(normalizedValue, "width"),
    height: getNumberFromRecord(normalizedValue, "height"),
    x: getNumberFromRecord(normalizedValue, "x"),
    y: getNumberFromRecord(normalizedValue, "y"),
    ratio: getNumberFromRecord(normalizedValue, "ratio"),
    anchor: normalizeTUIAssistAnchor(
      getStringFromRecord(normalizedValue, "anchor") ?? position,
      "right",
    ),
    path:
      getStringFromRecord(normalizedValue, "path") ||
      getStringFromRecord(normalizedValue, "file") ||
      getStringFromRecord(normalizedValue, "filePath"),
    title: getStringFromRecord(normalizedValue, "title"),
    name: getStringFromRecord(normalizedValue, "name"),
    language: getStringFromRecord(normalizedValue, "language"),
    content: getStringFromRecord(normalizedValue, "content"),
    line: getNumberFromRecord(normalizedValue, "line"),
    command:
      getStringFromRecord(normalizedValue, "command") ||
      getStringFromRecord(normalizedValue, "input"),
    terminalName:
      getStringFromRecord(normalizedValue, "terminalName") ||
      getStringFromRecord(normalizedValue, "sessionName") ||
      getStringFromRecord(normalizedValue, "title"),
    focus: getBooleanFromRecord(normalizedValue, "focus") ?? false,
  };
};

export const parsePanelSideMoveRequest = (
  value: unknown,
): PanelSideMoveRequest | null => {
  const normalizedValue = unwrapEventPayload(value);
  if (!isRecord(normalizedValue)) {
    return null;
  }

  if (getStringFromRecord(normalizedValue, "panel")) {
    return null;
  }

  const from =
    parsePanelPosition(normalizedValue.from) ||
    parsePanelPosition(normalizedValue.source) ||
    parsePanelPosition(normalizedValue.sourcePosition);
  const to =
    parsePanelPosition(normalizedValue.to) ||
    parsePanelPosition(normalizedValue.target) ||
    parsePanelPosition(normalizedValue.targetPosition);

  return from && to ? { from, to } : null;
};

export const parseEditorOpenRequest = (
  value: unknown,
): { path: string; line?: number } | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (typeof normalizedValue === "string") {
    const path = normalizedValue.trim();
    return path ? { path } : null;
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const path =
    getStringFromRecord(normalizedValue, "path") ||
    getStringFromRecord(normalizedValue, "file") ||
    getStringFromRecord(normalizedValue, "filePath");
  if (!path) {
    return null;
  }

  return {
    path,
    line: getNumberFromRecord(normalizedValue, "line"),
  };
};

export const parseEditorSplitDirection = (
  value: unknown,
): "horizontal" | "vertical" | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (normalizedValue === "horizontal" || normalizedValue === "vertical") {
    return normalizedValue;
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const direction = getStringFromRecord(normalizedValue, "direction");
  return direction === "horizontal" || direction === "vertical"
    ? direction
    : null;
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

const toThemeValue = (value: unknown): Theme | null => {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return null;
};

const toPreviewWindowPayload = (value: unknown): PreviewWindowPayload => {
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

export const parseOpenPreviewInput = (
  value: unknown,
): OpenPreviewWindowInput | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (typeof normalizedValue === "string") {
    const surface = toPreviewSurface(normalizedValue);
    if (surface) {
      return { surface };
    }

    return {
      surface: "file",
      title: normalizedValue.split("/").pop() || "file preview",
      payload: { path: normalizedValue },
    };
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const directPayload = toPreviewWindowPayload(normalizedValue);
  const nestedPayload = toPreviewWindowPayload(normalizedValue.payload);
  const payload: PreviewWindowPayload = {
    ...directPayload,
    ...nestedPayload,
  };
  delete payload.surface;
  delete payload.mode;
  delete payload.position;
  delete payload.side;
  delete payload.width;
  delete payload.height;
  delete payload.x;
  delete payload.y;
  delete payload.id;
  delete payload.pinned;

  const surfaceCandidate =
    toPreviewSurface(normalizedValue.surface) ||
    toPreviewSurface(
      isRecord(normalizedValue.payload)
        ? normalizedValue.payload.surface
        : undefined,
    ) ||
    toPreviewSurface(normalizedValue.kind) ||
    toPreviewSurface(normalizedValue.type) ||
    (payload.url ? "browser" : null) ||
    (payload.path ? "file" : null);

  if (!surfaceCandidate) {
    return null;
  }

  const modeCandidate = getStringFromRecord(normalizedValue, "mode");
  const positionCandidate = getStringFromRecord(normalizedValue, "position");
  const sideCandidate = getStringFromRecord(normalizedValue, "side");

  const mode =
    modeCandidate === "floating" || modeCandidate === "snapped"
      ? modeCandidate
      : modeCandidate === "tab" || modeCandidate === "side"
        ? "snapped"
        : undefined;
  const position =
    positionCandidate === "left" ||
    positionCandidate === "right" ||
    positionCandidate === "top" ||
    positionCandidate === "bottom"
      ? positionCandidate
      : modeCandidate === "side" && sideCandidate === "left"
        ? "left"
        : modeCandidate === "side" && sideCandidate === "right"
          ? "right"
          : undefined;
  const side =
    sideCandidate === "left" || sideCandidate === "right"
      ? sideCandidate
      : undefined;

  return {
    id: getStringFromRecord(normalizedValue, "id"),
    surface: surfaceCandidate,
    title: getStringFromRecord(normalizedValue, "title"),
    payload,
    mode,
    position,
    side,
    width: getNumberFromRecord(normalizedValue, "width"),
    height: getNumberFromRecord(normalizedValue, "height"),
    x: getNumberFromRecord(normalizedValue, "x"),
    y: getNumberFromRecord(normalizedValue, "y"),
    pinned: getBooleanFromRecord(normalizedValue, "pinned"),
  };
};

export const parseWindowIdFromPayload = (value: unknown): string | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (
    typeof normalizedValue === "string" &&
    normalizedValue.trim().length > 0
  ) {
    return normalizedValue.trim();
  }

  if (!isRecord(normalizedValue)) {
    return null;
  }

  return (
    getStringFromRecord(normalizedValue, "id") ||
    getStringFromRecord(normalizedValue, "windowId") ||
    getStringFromRecord(normalizedValue, "checkpointId") ||
    null
  );
};

export const parseUpdatePreviewInput = (
  value: unknown,
): {
  id: string;
  input: UpdatePreviewWindowInput;
  focusRequested: boolean;
} | null => {
  const normalizedValue = unwrapEventPayload(value);

  if (!isRecord(normalizedValue)) {
    return null;
  }

  const id = parseWindowIdFromPayload(normalizedValue);
  if (!id) {
    return null;
  }

  const payload = toPreviewWindowPayload(normalizedValue.payload);
  const modeCandidate = getStringFromRecord(normalizedValue, "mode");
  const positionCandidate = getStringFromRecord(normalizedValue, "position");
  const focusRequested =
    getBooleanFromRecord(normalizedValue, "focus") ??
    getBooleanFromRecord(normalizedValue, "activate") ??
    false;
  const input: UpdatePreviewWindowInput = {
    title: getStringFromRecord(normalizedValue, "title"),
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    mode:
      modeCandidate === "floating" || modeCandidate === "snapped"
        ? modeCandidate
        : modeCandidate === "tab" || modeCandidate === "side"
          ? "snapped"
          : undefined,
    position:
      positionCandidate === "left" ||
      positionCandidate === "right" ||
      positionCandidate === "top" ||
      positionCandidate === "bottom"
        ? positionCandidate
        : undefined,
    width: getNumberFromRecord(normalizedValue, "width"),
    height: getNumberFromRecord(normalizedValue, "height"),
    x: getNumberFromRecord(normalizedValue, "x"),
    y: getNumberFromRecord(normalizedValue, "y"),
    pinned: getBooleanFromRecord(normalizedValue, "pinned"),
  };

  return { id, input, focusRequested };
};

export const mergePreviewWindowUpdateInput = (
  base: UpdatePreviewWindowInput,
  next: UpdatePreviewWindowInput,
): UpdatePreviewWindowInput => ({
  title: next.title ?? base.title,
  payload: next.payload
    ? { ...(base.payload ?? {}), ...next.payload }
    : base.payload,
  mode: next.mode ?? base.mode,
  position: next.position ?? base.position,
  width: next.width ?? base.width,
  height: next.height ?? base.height,
  x: next.x ?? base.x,
  y: next.y ?? base.y,
  pinned: typeof next.pinned === "boolean" ? next.pinned : base.pinned,
});

export const parseCheckpointLabel = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return getStringFromRecord(value, "label") || undefined;
};

export const parseAppearancePatch = (
  value: unknown,
): { theme?: Theme; uiScale?: number } => {
  if (!isRecord(value)) {
    return {};
  }

  const theme = toThemeValue(value.theme);
  const uiScale = getNumberFromRecord(value, "uiScale");
  return {
    theme: theme ?? undefined,
    uiScale,
  };
};
