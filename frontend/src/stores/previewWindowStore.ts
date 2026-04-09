import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { Theme } from "../types/theme";

export type PreviewSurfaceType =
  | "file"
  | "code"
  | "browser"
  | "git"
  | "chat"
  | "terminal"
  | "appearance";

export type PreviewWindowMode = "floating" | "snapped";
export type PreviewWindowPosition = "left" | "right" | "top" | "bottom";

export interface PreviewWindowPayload {
  title?: string;
  path?: string;
  content?: string;
  language?: string;
  line?: number;
  url?: string;
  htmlContent?: string;
  sourceLabel?: string;
  revision?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface PreviewWindow {
  id: string;
  title: string;
  surface: PreviewSurfaceType;
  payload: PreviewWindowPayload;
  position: PreviewWindowPosition;
  mode: PreviewWindowMode;
  width: number;
  height: number;
  x: number;
  y: number;
  isPinned: boolean;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppearancePreviewState {
  checkpointId: string;
  baseTheme: Theme;
  baseUiScale: number;
  theme: Theme;
  uiScale: number;
}

interface PreviewLayoutCheckpoint {
  id: string;
  label: string;
  windows: PreviewWindow[];
  activeWindowId: string | null;
  createdAt: number;
}

export interface OpenPreviewWindowInput {
  id?: string;
  surface: PreviewSurfaceType;
  title?: string;
  payload?: PreviewWindowPayload;
  side?: "left" | "right";
  mode?: PreviewWindowMode;
  position?: PreviewWindowPosition;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  pinned?: boolean;
}

export interface UpdatePreviewWindowInput {
  title?: string;
  payload?: PreviewWindowPayload;
  position?: PreviewWindowPosition;
  mode?: PreviewWindowMode;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  pinned?: boolean;
}

interface PreviewWindowStoreState {
  windows: PreviewWindow[];
  activeWindowId: string | null;
  appearancePreview: AppearancePreviewState | null;
  checkpoints: Record<string, PreviewLayoutCheckpoint>;
  maxWindows: number;
  openWindow: (input: OpenPreviewWindowInput) => {
    opened: boolean;
    id?: string;
    reason?: string;
  };
  updateWindow: (id: string, input: UpdatePreviewWindowInput) => boolean;
  closeWindow: (id: string) => void;
  closeAllWindows: () => void;
  focusWindow: (id: string) => void;
  setPinned: (id: string, pinned: boolean) => void;
  createCheckpoint: (label?: string) => string;
  restoreCheckpoint: (id: string) => boolean;
  deleteCheckpoint: (id: string) => void;
  startAppearancePreview: (
    baseTheme: Theme,
    baseUiScale: number,
    checkpointId?: string,
  ) => string;
  patchAppearancePreview: (
    patch: Partial<Pick<AppearancePreviewState, "theme" | "uiScale">>,
  ) => AppearancePreviewState | null;
  applyAppearancePreview: () => AppearancePreviewState | null;
  cancelAppearancePreview: () => { theme: Theme; uiScale: number } | null;
}

const PREVIEW_STORAGE_KEY = "preview-window-state.v1";
const PREVIEW_MAX_WINDOWS = 6;
const PREVIEW_MAX_CHECKPOINTS = 24;
const MIN_WINDOW_SIZE = 220;
const MAX_WINDOW_WIDTH = 1400;
const MAX_WINDOW_HEIGHT = 1200;
const MIN_UI_SCALE = 0.7;
const MAX_UI_SCALE = 2;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const sanitizeSize = (
  width: number | undefined,
  height: number | undefined,
): { width: number; height: number } => {
  const nextWidth = clamp(width ?? 520, MIN_WINDOW_SIZE, MAX_WINDOW_WIDTH);
  const nextHeight = clamp(height ?? 360, MIN_WINDOW_SIZE, MAX_WINDOW_HEIGHT);
  return {
    width: Number.isFinite(nextWidth) ? nextWidth : 520,
    height: Number.isFinite(nextHeight) ? nextHeight : 360,
  };
};

const getViewportWidth = (): number =>
  typeof window === "undefined" ? 1600 : window.innerWidth;

const getViewportHeight = (): number =>
  typeof window === "undefined" ? 900 : window.innerHeight;

const createWindowId = (): string => {
  const random = Math.random().toString(36).slice(2, 8);
  return `preview-${Date.now()}-${random}`;
};

const getDefaultPosition = (
  side: "left" | "right" | undefined,
  index: number,
  width: number,
  height: number,
): { x: number; y: number; position: PreviewWindowPosition } => {
  const viewportWidth = getViewportWidth();
  const viewportHeight = getViewportHeight();
  const offsetX = 48 + index * 28;
  const offsetY = 70 + index * 24;

  const xFromSide =
    side === "left"
      ? 24
      : side === "right"
        ? Math.max(24, viewportWidth - width - 24)
        : Math.min(offsetX, Math.max(24, viewportWidth - width - 24));

  const y = Math.min(offsetY, Math.max(24, viewportHeight - height - 24));
  const position: PreviewWindowPosition =
    side === "left" ? "left" : side === "right" ? "right" : "right";

  return {
    x: xFromSide,
    y,
    position,
  };
};

const cloneWindow = (windowState: PreviewWindow): PreviewWindow => ({
  ...windowState,
  payload: { ...windowState.payload },
});

const getNextZIndex = (windows: PreviewWindow[]): number => {
  const maxZIndex = windows.reduce(
    (maxValue, current) => Math.max(maxValue, current.zIndex),
    100,
  );
  return maxZIndex + 1;
};

const trimCheckpoints = (
  checkpoints: Record<string, PreviewLayoutCheckpoint>,
): Record<string, PreviewLayoutCheckpoint> => {
  const kept = Object.values(checkpoints)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, PREVIEW_MAX_CHECKPOINTS);

  return kept.reduce<Record<string, PreviewLayoutCheckpoint>>(
    (accumulator, checkpoint) => {
      accumulator[checkpoint.id] = checkpoint;
      return accumulator;
    },
    {},
  );
};

export const usePreviewWindowStore = create<PreviewWindowStoreState>()(
  persist(
    (set, get) => ({
      windows: [],
      activeWindowId: null,
      appearancePreview: null,
      checkpoints: {},
      maxWindows: PREVIEW_MAX_WINDOWS,

      openWindow: (input) => {
        const now = Date.now();
        const existingId = input.id?.trim();

        const foundWindow = existingId
          ? get().windows.find((windowState) => windowState.id === existingId)
          : undefined;

        if (!foundWindow && get().windows.length >= get().maxWindows) {
          return {
            opened: false,
            reason: `Reached preview window limit (${get().maxWindows})`,
          };
        }

        if (foundWindow) {
          const { width, height } = sanitizeSize(
            input.width ?? foundWindow.width,
            input.height ?? foundWindow.height,
          );
          const nextZIndex = getNextZIndex(get().windows);

          set((state) => ({
            windows: state.windows.map((windowState) =>
              windowState.id === foundWindow.id
                ? {
                    ...windowState,
                    title: input.title ?? windowState.title,
                    surface: input.surface ?? windowState.surface,
                    payload: {
                      ...windowState.payload,
                      ...(input.payload ?? {}),
                    },
                    mode: input.mode ?? windowState.mode,
                    position: input.position ?? windowState.position,
                    width,
                    height,
                    x: input.x ?? windowState.x,
                    y: input.y ?? windowState.y,
                    isPinned:
                      typeof input.pinned === "boolean"
                        ? input.pinned
                        : windowState.isPinned,
                    zIndex: nextZIndex,
                    updatedAt: now,
                  }
                : windowState,
            ),
            activeWindowId: foundWindow.id,
          }));

          return { opened: true, id: foundWindow.id };
        }

        const nextId =
          existingId && existingId.length > 0 ? existingId : createWindowId();
        const { width, height } = sanitizeSize(input.width, input.height);
        const defaultPosition = getDefaultPosition(
          input.side,
          get().windows.length,
          width,
          height,
        );
        const nextWindow: PreviewWindow = {
          id: nextId,
          title:
            input.title ?? input.payload?.title ?? `${input.surface} preview`,
          surface: input.surface,
          payload: { ...(input.payload ?? {}) },
          mode:
            input.mode ??
            (input.side || input.position ? "snapped" : "floating"),
          position: input.position ?? defaultPosition.position,
          width,
          height,
          x: input.x ?? defaultPosition.x,
          y: input.y ?? defaultPosition.y,
          isPinned: Boolean(input.pinned),
          zIndex: getNextZIndex(get().windows),
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          windows: [...state.windows, nextWindow],
          activeWindowId: nextWindow.id,
        }));

        return { opened: true, id: nextWindow.id };
      },

      updateWindow: (id, input) => {
        const target = get().windows.find(
          (windowState) => windowState.id === id,
        );
        if (!target) {
          return false;
        }

        const now = Date.now();
        const size = sanitizeSize(
          input.width ?? target.width,
          input.height ?? target.height,
        );

        const nextTitle = input.title ?? target.title;
        const nextMode = input.mode ?? target.mode;
        const nextPosition = input.position ?? target.position;
        const nextX = input.x ?? target.x;
        const nextY = input.y ?? target.y;
        const nextPinned =
          typeof input.pinned === "boolean" ? input.pinned : target.isPinned;
        const payloadChanged = input.payload
          ? Object.entries(input.payload).some(
              ([key, value]) => target.payload[key] !== value,
            )
          : false;

        const hasChanges =
          nextTitle !== target.title ||
          nextMode !== target.mode ||
          nextPosition !== target.position ||
          size.width !== target.width ||
          size.height !== target.height ||
          nextX !== target.x ||
          nextY !== target.y ||
          nextPinned !== target.isPinned ||
          payloadChanged;

        if (!hasChanges) {
          return true;
        }

        set((state) => ({
          windows: state.windows.map((windowState) =>
            windowState.id === id
              ? {
                  ...windowState,
                  title: nextTitle,
                  payload: input.payload
                    ? { ...windowState.payload, ...input.payload }
                    : windowState.payload,
                  mode: nextMode,
                  position: nextPosition,
                  width: size.width,
                  height: size.height,
                  x: nextX,
                  y: nextY,
                  isPinned: nextPinned,
                  updatedAt: now,
                }
              : windowState,
          ),
        }));

        return true;
      },

      closeWindow: (id) => {
        set((state) => {
          const remainingWindows = state.windows.filter(
            (windowState) => windowState.id !== id,
          );
          const fallbackActiveId =
            state.activeWindowId === id
              ? (remainingWindows
                  .slice()
                  .sort((left, right) => right.zIndex - left.zIndex)[0]?.id ??
                null)
              : state.activeWindowId;

          return {
            windows: remainingWindows,
            activeWindowId: fallbackActiveId,
          };
        });
      },

      closeAllWindows: () => {
        set({ windows: [], activeWindowId: null });
      },

      focusWindow: (id) => {
        const target = get().windows.find(
          (windowState) => windowState.id === id,
        );
        if (!target) {
          return;
        }
        const nextZIndex = getNextZIndex(get().windows);
        set((state) => ({
          windows: state.windows.map((windowState) =>
            windowState.id === id
              ? {
                  ...windowState,
                  zIndex: nextZIndex,
                  updatedAt: Date.now(),
                }
              : windowState,
          ),
          activeWindowId: id,
        }));
      },

      setPinned: (id, pinned) => {
        set((state) => ({
          windows: state.windows.map((windowState) =>
            windowState.id === id
              ? {
                  ...windowState,
                  isPinned: pinned,
                  updatedAt: Date.now(),
                }
              : windowState,
          ),
        }));
      },

      createCheckpoint: (label = "manual") => {
        const id = `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const checkpoint: PreviewLayoutCheckpoint = {
          id,
          label,
          windows: get().windows.map(cloneWindow),
          activeWindowId: get().activeWindowId,
          createdAt: Date.now(),
        };
        set((state) => ({
          checkpoints: trimCheckpoints({
            ...state.checkpoints,
            [id]: checkpoint,
          }),
        }));
        return id;
      },

      restoreCheckpoint: (id) => {
        const checkpoint = get().checkpoints[id];
        if (!checkpoint) {
          return false;
        }
        set({
          windows: checkpoint.windows.map(cloneWindow),
          activeWindowId: checkpoint.activeWindowId,
        });
        return true;
      },

      deleteCheckpoint: (id) => {
        set((state) => {
          const nextCheckpoints = { ...state.checkpoints };
          delete nextCheckpoints[id];
          return { checkpoints: nextCheckpoints };
        });
      },

      startAppearancePreview: (baseTheme, baseUiScale, checkpointId) => {
        const existing = get().appearancePreview;
        if (existing) {
          return existing.checkpointId;
        }

        const nextCheckpointId = checkpointId ?? `appearance-${Date.now()}`;
        const clampedUiScale = clamp(baseUiScale, MIN_UI_SCALE, MAX_UI_SCALE);
        const nextAppearancePreview: AppearancePreviewState = {
          checkpointId: nextCheckpointId,
          baseTheme,
          baseUiScale: clampedUiScale,
          theme: baseTheme,
          uiScale: clampedUiScale,
        };
        set({ appearancePreview: nextAppearancePreview });
        return nextCheckpointId;
      },

      patchAppearancePreview: (patch) => {
        const current = get().appearancePreview;
        if (!current) {
          return null;
        }

        const nextAppearancePreview: AppearancePreviewState = {
          ...current,
          theme: patch.theme ?? current.theme,
          uiScale:
            typeof patch.uiScale === "number"
              ? clamp(patch.uiScale, MIN_UI_SCALE, MAX_UI_SCALE)
              : current.uiScale,
        };

        set({ appearancePreview: nextAppearancePreview });
        return nextAppearancePreview;
      },

      applyAppearancePreview: () => {
        const current = get().appearancePreview;
        if (!current) {
          return null;
        }

        set({ appearancePreview: null });
        return current;
      },

      cancelAppearancePreview: () => {
        const current = get().appearancePreview;
        if (!current) {
          return null;
        }

        set({ appearancePreview: null });
        return { theme: current.baseTheme, uiScale: current.baseUiScale };
      },
    }),
    {
      name: PREVIEW_STORAGE_KEY,
      partialize: (state) => ({
        windows: state.windows.filter((w) => w.surface !== "browser"),
        activeWindowId: state.activeWindowId,
        maxWindows: state.maxWindows,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<PreviewWindowStoreState>;
        return {
          ...current,
          ...p,
          windows: (p?.windows ?? []).filter((w) => w.surface !== "browser"),
        };
      },
    },
  ),
);
