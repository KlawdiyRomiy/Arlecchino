import type { PanelPosition, PanelSize } from "../ui/FloatingPanel";
import { getLogicalViewportSize } from "../../utils/logicalViewport";
import type {
  AppSurfaceAction,
  HydratedPanelLayoutState,
  PanelConfig,
  PanelConfigs,
  PanelId,
  PanelOpenRequest,
  PanelVisibility,
  RememberedSnappedPositions,
} from "./MainLayout.types";

const SNAPPED_PANEL_POSITIONS: readonly PanelPosition[] = [
  "left",
  "right",
  "bottom",
  "top",
];

const PANEL_POSITION_PREFERENCES: Record<PanelId, readonly PanelPosition[]> = {
  explorer: ["left", "right", "bottom", "top"],
  terminal: ["bottom", "right", "left", "top"],
  aiChat: ["right", "left", "bottom", "top"],
  git: ["left", "right", "bottom", "top"],
  problems: ["bottom", "right", "left", "top"],
  code: ["right", "left", "bottom", "top"],
  markdownPreview: ["right", "left", "bottom", "top"],
};

const PANEL_ID_ALIASES: Record<string, PanelId> = {
  git: "git",
  scm: "git",
  ai: "aiChat",
  aichat: "aiChat",
  assistant: "aiChat",
  chat: "aiChat",
  terminal: "terminal",
  console: "terminal",
  shell: "terminal",
  explorer: "explorer",
  sidebar: "explorer",
  files: "explorer",
  problems: "problems",
  diagnostics: "problems",
  code: "code",
  editor: "code",
  markdown: "markdownPreview",
  markdownpreview: "markdownPreview",
  mdpreview: "markdownPreview",
  previewmarkdown: "markdownPreview",
};

const APP_SURFACE_ALIASES: Record<string, AppSurfaceAction> = {
  search: { kind: "dispatcher" },
  find: { kind: "dispatcher" },
  commandpalette: { kind: "dispatcher" },
  palette: { kind: "dispatcher" },
  output: { kind: "panel", panelId: "terminal" },
  logs: { kind: "panel", panelId: "terminal" },
  run: { kind: "run", mode: "run" },
  debug: { kind: "run", mode: "debug" },
  extensions: { kind: "settings" },
  settings: { kind: "settings" },
  preferences: { kind: "settings" },
};

export const DEFAULT_PANELS: PanelVisibility = {
  explorer: true,
  terminal: false,
  aiChat: false,
  git: false,
  problems: false,
  code: false,
  markdownPreview: false,
};

export const DEFAULT_PANEL_CONFIGS: PanelConfigs = {
  explorer: {
    position: "left",
    size: { width: 260, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  terminal: {
    position: "bottom",
    size: { width: 0, height: 220 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  aiChat: {
    position: "right",
    size: { width: 320, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  git: {
    position: "left",
    size: { width: 280, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  problems: {
    position: "bottom",
    size: { width: 520, height: 320 },
    mode: "floating",
    x: 96,
    y: 96,
  },
  code: {
    position: "right",
    size: { width: 620, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
  markdownPreview: {
    position: "right",
    size: { width: 420, height: 0 },
    mode: "snapped",
    x: 0,
    y: 0,
  },
};

export const uniquePanelPositions = (
  positions: Array<PanelPosition | null | undefined>,
): PanelPosition[] => {
  const unique = new Set<PanelPosition>();
  positions.forEach((position) => {
    if (position) {
      unique.add(position);
    }
  });
  return Array.from(unique);
};

export const normalizePanelSizeForPosition = (
  position: PanelPosition,
  currentSize: PanelSize,
): PanelSize => {
  if (position === "bottom" || position === "top") {
    return {
      width: 0,
      height: Math.min(currentSize.height > 0 ? currentSize.height : 220, 400),
    };
  }

  return {
    width: Math.min(currentSize.width > 0 ? currentSize.width : 280, 500),
    height: 0,
  };
};

export const normalizePreviewWindowSizeForPosition = (
  position: PanelPosition,
  windowState: { width: number; height: number },
): { width: number; height: number } => {
  if (position === "bottom" || position === "top") {
    return {
      width: 0,
      height: Math.min(windowState.height > 0 ? windowState.height : 260, 520),
    };
  }

  return {
    width: Math.min(windowState.width > 0 ? windowState.width : 380, 720),
    height: 0,
  };
};

export const isPanelPosition = (value: unknown): value is PanelPosition =>
  value === "left" ||
  value === "right" ||
  value === "top" ||
  value === "bottom";

const PANEL_POSITION_LABELS: Record<PanelPosition, string> = {
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
};

export const formatPanelPosition = (position: PanelPosition): string =>
  PANEL_POSITION_LABELS[position];

export const resolvePanelId = (panelName: string): PanelId | null => {
  const normalized = panelName.trim().toLowerCase();
  return PANEL_ID_ALIASES[normalized] ?? null;
};

export const resolveAppSurfaceAction = (
  panelName: string,
): AppSurfaceAction | null => {
  const normalized = panelName.trim().toLowerCase();
  return APP_SURFACE_ALIASES[normalized] ?? null;
};

const getViewportSafeFloatingConfig = (
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  const { width: viewportWidth, height: viewportHeight } =
    getLogicalViewportSize();
  const safeWidth = Math.max(220, Math.min(width, viewportWidth));
  const safeHeight = Math.max(140, Math.min(height, viewportHeight));
  const maxX = Math.max(0, viewportWidth - safeWidth);
  const maxY = Math.max(32, viewportHeight - safeHeight);

  return {
    width: safeWidth,
    height: safeHeight,
    x: Math.max(0, Math.min(x, maxX)),
    y: Math.max(32, Math.min(y, maxY)),
  };
};

export const buildPanelConfigForOpen = (
  panelId: PanelId,
  request: PanelOpenRequest,
  currentConfig: PanelConfig,
): PanelConfig => {
  const defaultConfig = DEFAULT_PANEL_CONFIGS[panelId];
  const hasExplicitFloatingPlacement =
    typeof request.x === "number" || typeof request.y === "number";
  const position = request.position ?? currentConfig.position;
  const mode =
    request.mode ??
    (request.position
      ? "snapped"
      : hasExplicitFloatingPlacement
        ? "floating"
        : currentConfig.mode);

  if (mode === "snapped") {
    const baseSize = normalizePanelSizeForPosition(position, {
      width:
        request.width ?? currentConfig.size.width ?? defaultConfig.size.width,
      height:
        request.height ??
        currentConfig.size.height ??
        defaultConfig.size.height,
    });

    return {
      position,
      mode,
      x: 0,
      y: 0,
      size: {
        width: request.width ?? baseSize.width,
        height: request.height ?? baseSize.height,
      },
    };
  }

  const safeFloating = getViewportSafeFloatingConfig(
    request.width ??
      currentConfig.size.width ??
      defaultConfig.size.width ??
      320,
    request.height ??
      currentConfig.size.height ??
      defaultConfig.size.height ??
      240,
    request.x ?? currentConfig.x,
    request.y ?? currentConfig.y,
  );

  return {
    position,
    mode,
    x: safeFloating.x,
    y: safeFloating.y,
    size: {
      width: safeFloating.width,
      height: safeFloating.height,
    },
  };
};

const hasExplicitPanelPlacement = (request: PanelOpenRequest): boolean =>
  request.position !== undefined ||
  request.mode !== undefined ||
  typeof request.x === "number" ||
  typeof request.y === "number";

const getOccupiedSnappedPositions = (
  panelId: PanelId,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): Set<PanelPosition> => {
  const occupied = new Set<PanelPosition>();

  (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
    if (id === panelId || !panels[id]) {
      return;
    }

    const config = panelConfigs[id];
    if (config.mode === "snapped") {
      occupied.add(config.position);
    }
  });

  return occupied;
};

export const resolveSmartSnappedPosition = (
  panelId: PanelId,
  rememberedPosition: PanelPosition,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): PanelPosition | null => {
  const occupiedPositions = getOccupiedSnappedPositions(
    panelId,
    panels,
    panelConfigs,
  );

  if (
    isPanelPosition(rememberedPosition) &&
    !occupiedPositions.has(rememberedPosition)
  ) {
    return rememberedPosition;
  }

  const preferredPositions = PANEL_POSITION_PREFERENCES[panelId];
  const orderedPositions = [
    rememberedPosition,
    ...preferredPositions,
    ...SNAPPED_PANEL_POSITIONS,
  ].filter(
    (position, index, all): position is PanelPosition =>
      isPanelPosition(position) && all.indexOf(position) === index,
  );

  for (const position of orderedPositions) {
    if (!occupiedPositions.has(position)) {
      return position;
    }
  }

  return null;
};

const buildCenteredFloatingOpenRequest = (
  panelId: PanelId,
  request: PanelOpenRequest,
  currentConfig: PanelConfig,
): PanelOpenRequest => {
  const defaultConfig = DEFAULT_PANEL_CONFIGS[panelId];
  const fallbackWidth =
    currentConfig.size.width || defaultConfig.size.width || 420;
  const fallbackHeight =
    currentConfig.size.height || defaultConfig.size.height || 320;
  const { width: viewportWidth, height: viewportHeight } =
    getLogicalViewportSize();
  const maxWidth = Math.max(320, viewportWidth - 96);
  const maxHeight = Math.max(220, viewportHeight - 128);
  const width = Math.min(request.width ?? fallbackWidth, maxWidth);
  const height = Math.min(request.height ?? fallbackHeight, maxHeight);

  return {
    ...request,
    mode: "floating",
    width,
    height,
    x: Math.max(0, Math.round((viewportWidth - width) / 2)),
    y: Math.max(32, Math.round((viewportHeight - height) / 2)),
  };
};

const resolvePanelOpenRequest = (
  panelId: PanelId,
  request: PanelOpenRequest,
  rememberedPosition: PanelPosition,
  currentConfig: PanelConfig,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
): PanelOpenRequest => {
  if (hasExplicitPanelPlacement(request)) {
    return request;
  }

  const defaultConfig = DEFAULT_PANEL_CONFIGS[panelId];
  const mode =
    request.mode ??
    (defaultConfig.mode === "snapped" ? "snapped" : currentConfig.mode);
  if (mode !== "snapped") {
    return request;
  }

  const resolvedPosition = resolveSmartSnappedPosition(
    panelId,
    rememberedPosition,
    panels,
    panelConfigs,
  );
  if (!resolvedPosition) {
    return buildCenteredFloatingOpenRequest(panelId, request, currentConfig);
  }

  return {
    ...request,
    position: resolvedPosition,
  };
};

export const computeNextPanelOpenState = (
  panelId: PanelId,
  request: PanelOpenRequest,
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
  rememberedSnappedPositions: RememberedSnappedPositions,
): {
  nextPanels: PanelVisibility;
  nextConfig: PanelConfig;
  nextRememberedSnappedPositions: RememberedSnappedPositions;
} => {
  const currentConfig = panelConfigs[panelId];
  const resolvedRequest = resolvePanelOpenRequest(
    panelId,
    request,
    rememberedSnappedPositions[panelId],
    currentConfig,
    panels,
    panelConfigs,
  );
  const nextConfig = buildPanelConfigForOpen(
    panelId,
    resolvedRequest,
    currentConfig,
  );
  const nextPanels = { ...panels };
  const nextRememberedSnappedPositions = { ...rememberedSnappedPositions };

  if (
    nextConfig.mode === "snapped" &&
    (request.position !== undefined || request.mode === "snapped")
  ) {
    nextRememberedSnappedPositions[panelId] = nextConfig.position;
  }

  if (nextConfig.mode === "snapped") {
    (Object.keys(panelConfigs) as PanelId[]).forEach((id) => {
      if (id === panelId || !nextPanels[id]) {
        return;
      }

      const otherConfig = panelConfigs[id];
      if (
        otherConfig.mode === "snapped" &&
        otherConfig.position === nextConfig.position
      ) {
        nextPanels[id] = false;
      }
    });
  }

  nextPanels[panelId] = true;
  return { nextPanels, nextConfig, nextRememberedSnappedPositions };
};

export const cloneDefaultPanelConfigs = (): PanelConfigs => ({
  explorer: {
    ...DEFAULT_PANEL_CONFIGS.explorer,
    size: { ...DEFAULT_PANEL_CONFIGS.explorer.size },
  },
  terminal: {
    ...DEFAULT_PANEL_CONFIGS.terminal,
    size: { ...DEFAULT_PANEL_CONFIGS.terminal.size },
  },
  aiChat: {
    ...DEFAULT_PANEL_CONFIGS.aiChat,
    size: { ...DEFAULT_PANEL_CONFIGS.aiChat.size },
  },
  git: {
    ...DEFAULT_PANEL_CONFIGS.git,
    size: { ...DEFAULT_PANEL_CONFIGS.git.size },
  },
  problems: {
    ...DEFAULT_PANEL_CONFIGS.problems,
    size: { ...DEFAULT_PANEL_CONFIGS.problems.size },
  },
  code: {
    ...DEFAULT_PANEL_CONFIGS.code,
    size: { ...DEFAULT_PANEL_CONFIGS.code.size },
  },
  markdownPreview: {
    ...DEFAULT_PANEL_CONFIGS.markdownPreview,
    size: { ...DEFAULT_PANEL_CONFIGS.markdownPreview.size },
  },
});

export const createDefaultRememberedSnappedPositions =
  (): RememberedSnappedPositions => ({
    explorer: DEFAULT_PANEL_CONFIGS.explorer.position,
    terminal: DEFAULT_PANEL_CONFIGS.terminal.position,
    aiChat: DEFAULT_PANEL_CONFIGS.aiChat.position,
    git: DEFAULT_PANEL_CONFIGS.git.position,
    problems: DEFAULT_PANEL_CONFIGS.problems.position,
    code: DEFAULT_PANEL_CONFIGS.code.position,
    markdownPreview: DEFAULT_PANEL_CONFIGS.markdownPreview.position,
  });

export const clonePanelConfigsValue = (source: PanelConfigs): PanelConfigs => ({
  explorer: { ...source.explorer, size: { ...source.explorer.size } },
  terminal: { ...source.terminal, size: { ...source.terminal.size } },
  aiChat: { ...source.aiChat, size: { ...source.aiChat.size } },
  git: { ...source.git, size: { ...source.git.size } },
  problems: { ...source.problems, size: { ...source.problems.size } },
  code: { ...source.code, size: { ...source.code.size } },
  markdownPreview: {
    ...source.markdownPreview,
    size: { ...source.markdownPreview.size },
  },
});

export const cloneRememberedSnappedPositionsValue = (
  source: RememberedSnappedPositions,
): RememberedSnappedPositions => ({
  explorer: source.explorer,
  terminal: source.terminal,
  aiChat: source.aiChat,
  git: source.git,
  problems: source.problems,
  code: source.code,
  markdownPreview: source.markdownPreview,
});

export const normalizeHydratedPanelLayoutState = (
  panels: PanelVisibility,
  panelConfigs: PanelConfigs,
  rememberedSnappedPositions: RememberedSnappedPositions,
): HydratedPanelLayoutState => {
  const nextPanels = { ...panels };
  const nextPanelConfigs = clonePanelConfigsValue(panelConfigs);
  const nextRememberedSnappedPositions = cloneRememberedSnappedPositionsValue(
    rememberedSnappedPositions,
  );
  const occupiedPositions = new Set<PanelPosition>();

  // Keep a single visible snapped owner per side during hydration.
  (Object.keys(nextPanels) as PanelId[]).forEach((panelId) => {
    if (!nextPanels[panelId]) {
      return;
    }

    const config = nextPanelConfigs[panelId];
    if (config.mode !== "snapped") {
      return;
    }

    if (occupiedPositions.has(config.position)) {
      nextPanels[panelId] = false;
      return;
    }

    occupiedPositions.add(config.position);
  });

  return {
    panels: nextPanels,
    panelConfigs: nextPanelConfigs,
    rememberedSnappedPositions: nextRememberedSnappedPositions,
  };
};

const resolveStoredPanelConfig = (
  savedPanelConfig: unknown,
  defaultConfig: PanelConfig,
): PanelConfig => {
  const configRecord =
    typeof savedPanelConfig === "object" && savedPanelConfig !== null
      ? (savedPanelConfig as Record<string, unknown>)
      : null;
  const sizeRecord =
    typeof configRecord?.size === "object" && configRecord.size !== null
      ? (configRecord.size as Record<string, unknown>)
      : null;

  return {
    ...defaultConfig,
    ...(configRecord ?? {}),
    size: {
      ...defaultConfig.size,
      ...(sizeRecord ?? {}),
    },
  };
};

const resolveStoredPanelConfigs = (
  savedPanelConfigs: unknown,
): PanelConfigs => {
  if (typeof savedPanelConfigs !== "object" || savedPanelConfigs === null) {
    return cloneDefaultPanelConfigs();
  }

  const { browser: _browser, ...rest } = savedPanelConfigs as Record<
    string,
    unknown
  >;
  return {
    explorer: resolveStoredPanelConfig(
      rest.explorer,
      DEFAULT_PANEL_CONFIGS.explorer,
    ),
    terminal: resolveStoredPanelConfig(
      rest.terminal,
      DEFAULT_PANEL_CONFIGS.terminal,
    ),
    aiChat: resolveStoredPanelConfig(rest.aiChat, DEFAULT_PANEL_CONFIGS.aiChat),
    git: resolveStoredPanelConfig(rest.git, DEFAULT_PANEL_CONFIGS.git),
    problems: resolveStoredPanelConfig(
      rest.problems,
      DEFAULT_PANEL_CONFIGS.problems,
    ),
    code: resolveStoredPanelConfig(rest.code, DEFAULT_PANEL_CONFIGS.code),
    markdownPreview: resolveStoredPanelConfig(
      rest.markdownPreview,
      DEFAULT_PANEL_CONFIGS.markdownPreview,
    ),
  };
};

export const resolveRememberedSnappedPositions = (
  savedPanelConfigs: unknown,
  savedRememberedPositions: unknown,
): RememberedSnappedPositions => {
  const nextPositions = createDefaultRememberedSnappedPositions();
  const rememberedRecord =
    typeof savedRememberedPositions === "object" &&
    savedRememberedPositions !== null
      ? (savedRememberedPositions as Record<string, unknown>)
      : null;
  const configsRecord =
    typeof savedPanelConfigs === "object" && savedPanelConfigs !== null
      ? (savedPanelConfigs as Record<string, unknown>)
      : null;

  (Object.keys(nextPositions) as PanelId[]).forEach((panelId) => {
    const rememberedPosition = rememberedRecord?.[panelId];
    if (isPanelPosition(rememberedPosition)) {
      nextPositions[panelId] = rememberedPosition;
      return;
    }

    const savedConfig = configsRecord?.[panelId];
    if (typeof savedConfig !== "object" || savedConfig === null) {
      return;
    }

    const configRecord = savedConfig as Record<string, unknown>;
    if (
      configRecord.mode === "snapped" &&
      isPanelPosition(configRecord.position)
    ) {
      nextPositions[panelId] = configRecord.position;
    }
  });

  return nextPositions;
};

export const loadPersistedPanelLayoutState = (
  panelStorageKey: string | null,
): HydratedPanelLayoutState => {
  if (!panelStorageKey) {
    return normalizeHydratedPanelLayoutState(
      { ...DEFAULT_PANELS },
      cloneDefaultPanelConfigs(),
      createDefaultRememberedSnappedPositions(),
    );
  }

  try {
    const raw = localStorage.getItem(panelStorageKey);
    if (!raw) {
      return normalizeHydratedPanelLayoutState(
        { ...DEFAULT_PANELS },
        cloneDefaultPanelConfigs(),
        createDefaultRememberedSnappedPositions(),
      );
    }

    const parsed = JSON.parse(raw) as {
      panels?: unknown;
      panelConfigs?: unknown;
      rememberedSnappedPositions?: unknown;
    };
    const savedPanels =
      typeof parsed.panels === "object" && parsed.panels !== null
        ? (parsed.panels as Record<string, unknown>)
        : null;
    const { browser: _browser, ...restPanels } = savedPanels ?? {};
    const panels: PanelVisibility = {
      ...DEFAULT_PANELS,
      ...(restPanels as Partial<PanelVisibility>),
    };
    const panelConfigs = resolveStoredPanelConfigs(parsed.panelConfigs);
    const rememberedSnappedPositions = resolveRememberedSnappedPositions(
      parsed.panelConfigs,
      parsed.rememberedSnappedPositions,
    );

    return normalizeHydratedPanelLayoutState(
      panels,
      panelConfigs,
      rememberedSnappedPositions,
    );
  } catch {
    return normalizeHydratedPanelLayoutState(
      { ...DEFAULT_PANELS },
      cloneDefaultPanelConfigs(),
      createDefaultRememberedSnappedPositions(),
    );
  }
};
