import type {
  PanelConfig,
  PanelConfigs,
  PanelId,
  PanelVisibility,
} from "../components/layout/MainLayout.types";
import type {
  PreviewSurfaceType,
  PreviewWindow,
  PreviewWindowPayload,
  PreviewWindowPosition,
} from "../stores/previewWindowStore";

export type SurfaceSource = "panel" | "preview" | "main";

export type SurfaceHostMode =
  | "main-center"
  | "floating"
  | "snapped"
  | "fullscreen"
  | "detached";

export type SurfaceAppletKind =
  | PreviewSurfaceType
  | "explorer"
  | "aiChat"
  | "problems";

export type SurfaceFocusPolicy = "activate" | "preserve-current" | "background";

export interface SurfaceGeometry {
  position?: PreviewWindowPosition;
  width: number;
  height: number;
  x: number;
  y: number;
  zIndex?: number;
}

export interface SurfaceSession {
  id: string;
  source: SurfaceSource;
  appletKind: SurfaceAppletKind;
  hostMode: SurfaceHostMode;
  title: string;
  active: boolean;
  pinned: boolean;
  createdAt?: number;
  updatedAt?: number;
  geometry?: SurfaceGeometry;
  panelId?: PanelId;
  previewWindowId?: string;
  ownerProjectId?: string;
  nativeWindowId?: string;
  focusPolicy?: SurfaceFocusPolicy;
  payload?: PreviewWindowPayload;
}

export interface BuildSurfaceSessionsInput {
  panels: PanelVisibility;
  panelConfigs: PanelConfigs;
  previewWindows: PreviewWindow[];
  activePreviewWindowId: string | null;
  activePanelId?: PanelId | null;
}

const PANEL_TITLES: Record<PanelId, string> = {
  explorer: "Explorer",
  terminal: "Terminal",
  aiChat: "AI Chat",
  git: "Git",
  problems: "Problems",
  code: "Code",
};

export const panelSurfaceId = (panelId: PanelId): string => `panel:${panelId}`;

export const previewSurfaceId = (windowId: string): string =>
  `preview:${windowId}`;

export const hostModeFromPlacement = (
  mode: "floating" | "snapped",
): SurfaceHostMode => mode;

export const panelToSurfaceSession = (
  panelId: PanelId,
  config: PanelConfig,
  visible: boolean,
  activePanelId: PanelId | null = null,
): SurfaceSession => ({
  id: panelSurfaceId(panelId),
  source: "panel",
  appletKind: panelId === "code" ? "code" : panelId,
  hostMode: hostModeFromPlacement(config.mode),
  title: PANEL_TITLES[panelId],
  active: visible && activePanelId === panelId,
  pinned: false,
  panelId,
  geometry: {
    position: config.position,
    width: config.size.width,
    height: config.size.height,
    x: config.x,
    y: config.y,
  },
});

export const previewWindowToSurfaceSession = (
  windowState: PreviewWindow,
  activePreviewWindowId: string | null,
): SurfaceSession => ({
  id: previewSurfaceId(windowState.id),
  source: "preview",
  appletKind: windowState.surface,
  hostMode: hostModeFromPlacement(windowState.mode),
  title: windowState.title,
  active: activePreviewWindowId === windowState.id,
  pinned: windowState.isPinned,
  createdAt: windowState.createdAt,
  updatedAt: windowState.updatedAt,
  previewWindowId: windowState.id,
  payload: { ...windowState.payload },
  geometry: {
    position: windowState.position,
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    zIndex: windowState.zIndex,
  },
});

export const buildSurfaceSessions = ({
  panels,
  panelConfigs,
  previewWindows,
  activePreviewWindowId,
  activePanelId = null,
}: BuildSurfaceSessionsInput): SurfaceSession[] => [
  ...Object.entries(panels)
    .filter(([, visible]) => visible)
    .map(([panelId]) => {
      const typedPanelId = panelId as PanelId;
      return panelToSurfaceSession(
        typedPanelId,
        panelConfigs[typedPanelId],
        true,
        activePanelId,
      );
    }),
  ...previewWindows.map((windowState) =>
    previewWindowToSurfaceSession(windowState, activePreviewWindowId),
  ),
];
