import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import {
  usePreviewWindowStore,
  type AppearancePreviewState,
  type OpenPreviewWindowInput,
  type PreviewWindow,
  type UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import type { Theme } from "../../types/theme";
import { emitPerfMetric, measurePerf, nowPerf } from "../../utils/perf";
import {
  mergePreviewWindowUpdateInput,
  parseAppearancePatch,
  parseCheckpointLabel,
  parseOpenPreviewInput,
  parseUpdatePreviewInput,
  parseWindowIdFromPayload,
} from "./mainLayoutEventParsers";

type NotificationType = "success" | "error";

interface QueuedPreviewWindowUpdate {
  input: UpdatePreviewWindowInput;
  focusRequested: boolean;
  queuedAt: number;
}

interface UseMainLayoutPreviewEventsOptions {
  appearancePreview: AppearancePreviewState | null;
  closePreviewWindowWithMotion: (id: string) => void;
  currentTheme: Theme;
  getBrowserPreviewWindowForShortcut: () => PreviewWindow | null;
  openCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  previewLaunchInput: OpenPreviewWindowInput | null;
  resolveBrowserPreviewOpenInput: (
    input: OpenPreviewWindowInput,
  ) => OpenPreviewWindowInput;
  setTheme: (theme: Theme) => void;
  setUiScale: (uiScale: number) => void;
  showNotification: (type: NotificationType, message: string) => void;
  toggleCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  uiScale: number;
}

export const useMainLayoutPreviewEvents = ({
  appearancePreview,
  closePreviewWindowWithMotion,
  currentTheme,
  getBrowserPreviewWindowForShortcut,
  openCanonicalBrowserPreviewRef,
  previewLaunchInput,
  resolveBrowserPreviewOpenInput,
  setTheme,
  setUiScale,
  showNotification,
  toggleCanonicalBrowserPreviewRef,
  uiScale,
}: UseMainLayoutPreviewEventsOptions) => {
  const openPreviewWindow = usePreviewWindowStore((state) => state.openWindow);
  const updatePreviewWindow = usePreviewWindowStore(
    (state) => state.updateWindow,
  );
  const focusPreviewWindow = usePreviewWindowStore(
    (state) => state.focusWindow,
  );
  const createPreviewCheckpoint = usePreviewWindowStore(
    (state) => state.createCheckpoint,
  );
  const restorePreviewCheckpoint = usePreviewWindowStore(
    (state) => state.restoreCheckpoint,
  );
  const deletePreviewCheckpoint = usePreviewWindowStore(
    (state) => state.deleteCheckpoint,
  );
  const startAppearancePreview = usePreviewWindowStore(
    (state) => state.startAppearancePreview,
  );
  const patchAppearancePreview = usePreviewWindowStore(
    (state) => state.patchAppearancePreview,
  );
  const applyAppearancePreview = usePreviewWindowStore(
    (state) => state.applyAppearancePreview,
  );
  const cancelAppearancePreview = usePreviewWindowStore(
    (state) => state.cancelAppearancePreview,
  );
  const appearanceSessionRef = useRef<string | null>(null);
  const previewUpdateQueueRef = useRef<Map<string, QueuedPreviewWindowUpdate>>(
    new Map(),
  );
  const previewUpdateFrameRef = useRef<number | null>(null);

  const ensureAppearancePreviewSession = useCallback(() => {
    if (appearanceSessionRef.current) {
      return appearanceSessionRef.current;
    }

    const activeAppearancePreview =
      usePreviewWindowStore.getState().appearancePreview;
    if (activeAppearancePreview) {
      appearanceSessionRef.current = activeAppearancePreview.checkpointId;
      return activeAppearancePreview.checkpointId;
    }

    const checkpointId = createPreviewCheckpoint("appearance-preview");
    const startedCheckpointId = startAppearancePreview(
      currentTheme,
      uiScale,
      checkpointId,
    );

    if (startedCheckpointId !== checkpointId) {
      deletePreviewCheckpoint(checkpointId);
    }

    appearanceSessionRef.current = startedCheckpointId;

    return startedCheckpointId;
  }, [
    createPreviewCheckpoint,
    currentTheme,
    deletePreviewCheckpoint,
    startAppearancePreview,
    uiScale,
  ]);

  useEffect(() => {
    if (!appearancePreview) {
      appearanceSessionRef.current = null;
    }
  }, [appearancePreview]);

  const applyAppearanceSettings = useCallback(
    (nextTheme: Theme, nextUiScale: number) => {
      setTheme(nextTheme);
      setUiScale(nextUiScale);
    },
    [setTheme, setUiScale],
  );

  const flushQueuedPreviewWindowUpdates = useCallback(() => {
    previewUpdateFrameRef.current = null;

    const queuedUpdates = Array.from(previewUpdateQueueRef.current.entries());
    previewUpdateQueueRef.current.clear();
    const flushedAt = nowPerf();

    queuedUpdates.forEach(([windowId, queuedUpdate]) => {
      const updateStartedAt = nowPerf();
      const updated = updatePreviewWindow(windowId, queuedUpdate.input);
      const updateDurationMs = nowPerf() - updateStartedAt;

      emitPerfMetric({
        scope: "preview",
        name: "window.update",
        durationMs: updateDurationMs,
        details: {
          windowId,
          updated,
          queuedMs: flushedAt - queuedUpdate.queuedAt,
          focusRequested: queuedUpdate.focusRequested,
        },
      });

      if (updated && queuedUpdate.focusRequested) {
        focusPreviewWindow(windowId);
      }
    });
  }, [focusPreviewWindow, updatePreviewWindow]);

  const queuePreviewWindowUpdate = useCallback(
    (
      windowId: string,
      input: UpdatePreviewWindowInput,
      focusRequested: boolean,
    ) => {
      const existingUpdate = previewUpdateQueueRef.current.get(windowId);
      previewUpdateQueueRef.current.set(windowId, {
        input: existingUpdate
          ? mergePreviewWindowUpdateInput(existingUpdate.input, input)
          : input,
        focusRequested: existingUpdate
          ? existingUpdate.focusRequested || focusRequested
          : focusRequested,
        queuedAt: existingUpdate?.queuedAt ?? nowPerf(),
      });

      if (previewUpdateFrameRef.current !== null) {
        return;
      }

      previewUpdateFrameRef.current = window.requestAnimationFrame(
        flushQueuedPreviewWindowUpdates,
      );
    },
    [flushQueuedPreviewWindowUpdates],
  );

  useEffect(
    () => () => {
      if (previewUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(previewUpdateFrameRef.current);
      }
      previewUpdateFrameRef.current = null;
      previewUpdateQueueRef.current.clear();
    },
    [],
  );

  const handleAppearancePreviewStartEvent = useCallback(
    (payload: unknown) => {
      ensureAppearancePreviewSession();
      const patch = parseAppearancePatch(payload);
      if (!patch.theme && typeof patch.uiScale !== "number") {
        return;
      }

      const stagedAppearance = patchAppearancePreview(patch);
      if (stagedAppearance) {
        applyAppearanceSettings(
          stagedAppearance.theme,
          stagedAppearance.uiScale,
        );
      }
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      patchAppearancePreview,
    ],
  );

  const handleAppearancePreviewPatchEvent = useCallback(
    (payload: unknown) => {
      const patch = parseAppearancePatch(payload);
      if (!patch.theme && typeof patch.uiScale !== "number") {
        return;
      }

      const activeAppearancePreview =
        usePreviewWindowStore.getState().appearancePreview;
      if (!activeAppearancePreview) {
        ensureAppearancePreviewSession();
      }

      const stagedAppearance = patchAppearancePreview(patch);
      if (stagedAppearance) {
        applyAppearanceSettings(
          stagedAppearance.theme,
          stagedAppearance.uiScale,
        );
      }
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      patchAppearancePreview,
    ],
  );

  const handleAppearancePreviewApplyEvent = useCallback(() => {
    const activeAppearancePreview =
      usePreviewWindowStore.getState().appearancePreview;
    const appliedAppearance = applyAppearancePreview();
    if (!activeAppearancePreview || !appliedAppearance) {
      return;
    }

    deletePreviewCheckpoint(activeAppearancePreview.checkpointId);
    appearanceSessionRef.current = null;
    showNotification("success", "Appearance changes applied globally");
  }, [applyAppearancePreview, deletePreviewCheckpoint, showNotification]);

  const handleAppearancePreviewCancelEvent = useCallback(() => {
    const activeAppearancePreview =
      usePreviewWindowStore.getState().appearancePreview;
    const restoredAppearance = cancelAppearancePreview();
    if (!activeAppearancePreview || !restoredAppearance) {
      return;
    }

    applyAppearanceSettings(
      restoredAppearance.theme,
      restoredAppearance.uiScale,
    );
    restorePreviewCheckpoint(activeAppearancePreview.checkpointId);
    deletePreviewCheckpoint(activeAppearancePreview.checkpointId);
    appearanceSessionRef.current = null;
    showNotification("success", "Appearance preview canceled");
  }, [
    applyAppearanceSettings,
    cancelAppearancePreview,
    deletePreviewCheckpoint,
    restorePreviewCheckpoint,
    showNotification,
  ]);

  const handlePreviewWindowOpenEvent = useCallback(
    (payload: unknown) => {
      const input = parseOpenPreviewInput(payload);
      if (!input) {
        return;
      }

      const resolvedInput = resolveBrowserPreviewOpenInput(input);
      const openResult = measurePerf(
        "preview",
        "window.open",
        () => openPreviewWindow(resolvedInput),
        {
          surface: resolvedInput.surface,
          mode: resolvedInput.mode ?? null,
        },
      );
      if (!openResult.opened) {
        if (openResult.reason) {
          showNotification("error", openResult.reason);
        }
        return;
      }

      if (resolvedInput.surface === "appearance") {
        ensureAppearancePreviewSession();
        const patch = parseAppearancePatch(resolvedInput.payload);
        if (patch.theme || typeof patch.uiScale === "number") {
          const stagedAppearance = patchAppearancePreview(patch);
          if (stagedAppearance) {
            applyAppearanceSettings(
              stagedAppearance.theme,
              stagedAppearance.uiScale,
            );
          }
        }
      }

      const openedWindowId = openResult.id;
      if (openedWindowId) {
        measurePerf(
          "preview",
          "window.focus.open",
          () => focusPreviewWindow(openedWindowId),
          {
            windowId: openedWindowId,
            surface: resolvedInput.surface,
          },
        );
      }
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      focusPreviewWindow,
      openPreviewWindow,
      patchAppearancePreview,
      resolveBrowserPreviewOpenInput,
      showNotification,
    ],
  );

  const openCanonicalBrowserPreview = useCallback(() => {
    const nextInput = previewLaunchInput;
    if (!nextInput) {
      showNotification(
        "error",
        "[Preview] No preview is available for the current context",
      );
      return;
    }

    handlePreviewWindowOpenEvent({
      ...nextInput,
      payload: {
        ...(nextInput.payload ?? {}),
        revision: Date.now(),
      },
    });
  }, [handlePreviewWindowOpenEvent, previewLaunchInput, showNotification]);

  useEffect(() => {
    openCanonicalBrowserPreviewRef.current = openCanonicalBrowserPreview;
  }, [openCanonicalBrowserPreview, openCanonicalBrowserPreviewRef]);

  const toggleCanonicalBrowserPreview = useCallback(() => {
    const existingPreviewWindow = getBrowserPreviewWindowForShortcut();
    if (existingPreviewWindow) {
      closePreviewWindowWithMotion(existingPreviewWindow.id);
      return;
    }

    openCanonicalBrowserPreviewRef.current();
  }, [
    closePreviewWindowWithMotion,
    getBrowserPreviewWindowForShortcut,
    openCanonicalBrowserPreviewRef,
  ]);

  useEffect(() => {
    toggleCanonicalBrowserPreviewRef.current = toggleCanonicalBrowserPreview;
  }, [toggleCanonicalBrowserPreview, toggleCanonicalBrowserPreviewRef]);

  const handlePreviewWindowUpdateEvent = useCallback(
    (payload: unknown) => {
      const parsed = parseUpdatePreviewInput(payload);
      if (!parsed) {
        return;
      }

      queuePreviewWindowUpdate(parsed.id, parsed.input, parsed.focusRequested);
    },
    [queuePreviewWindowUpdate],
  );

  const handlePreviewWindowCloseEvent = useCallback(
    (payload: unknown) => {
      const windowId = parseWindowIdFromPayload(payload);
      if (!windowId) {
        return;
      }
      closePreviewWindowWithMotion(windowId);
    },
    [closePreviewWindowWithMotion],
  );

  const handlePreviewWindowFocusEvent = useCallback(
    (payload: unknown) => {
      const windowId = parseWindowIdFromPayload(payload);
      if (!windowId) {
        return;
      }
      focusPreviewWindow(windowId);
    },
    [focusPreviewWindow],
  );

  const handlePreviewWindowCheckpointCreateEvent = useCallback(
    (payload: unknown) => {
      createPreviewCheckpoint(parseCheckpointLabel(payload) ?? "manual");
    },
    [createPreviewCheckpoint],
  );

  const handlePreviewWindowCheckpointRestoreEvent = useCallback(
    (payload: unknown) => {
      const checkpointId = parseWindowIdFromPayload(payload);
      if (!checkpointId) {
        return;
      }
      restorePreviewCheckpoint(checkpointId);
    },
    [restorePreviewCheckpoint],
  );

  return {
    handleAppearancePreviewApplyEvent,
    handleAppearancePreviewCancelEvent,
    handleAppearancePreviewPatchEvent,
    handleAppearancePreviewStartEvent,
    handlePreviewWindowCheckpointCreateEvent,
    handlePreviewWindowCheckpointRestoreEvent,
    handlePreviewWindowCloseEvent,
    handlePreviewWindowFocusEvent,
    handlePreviewWindowOpenEvent,
    handlePreviewWindowUpdateEvent,
    openCanonicalBrowserPreview,
  };
};
