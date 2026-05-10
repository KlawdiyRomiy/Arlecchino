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

const shouldSyncBrowserPreviewLaunchInput = (
  windowState: PreviewWindow,
  input: OpenPreviewWindowInput,
): boolean => {
  if (windowState.surface !== "browser" || input.surface !== "browser") {
    return false;
  }

  if (typeof input.title === "string" && input.title !== windowState.title) {
    return true;
  }

  const nextPayload = input.payload ?? {};
  return Object.entries(nextPayload).some(
    ([key, value]) => key !== "revision" && windowState.payload[key] !== value,
  );
};

const buildBrowserPreviewLaunchUpdate = (
  input: OpenPreviewWindowInput,
): UpdatePreviewWindowInput => {
  const payload = {
    ...(input.payload ?? {}),
    revision: Date.now(),
  };

  return {
    title:
      input.title ??
      (typeof payload.title === "string" ? payload.title : undefined),
    payload,
  };
};

interface UseMainLayoutPreviewEventsOptions {
  appearancePreview: AppearancePreviewState | null;
  closePreviewWindowWithMotion: (id: string) => void;
  currentTheme: Theme;
  getBrowserPreviewWindowForShortcut: () => PreviewWindow | null;
  openCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  onPreviewFocus?: () => void;
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
  onPreviewFocus,
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
        onPreviewFocus?.();
        focusPreviewWindow(windowId);
      }
    });
  }, [focusPreviewWindow, onPreviewFocus, updatePreviewWindow]);

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
        return { handled: false, reason: "Invalid preview open request." };
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
        return {
          handled: false,
          reason: openResult.reason ?? "Preview window was not opened.",
        };
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
          () => {
            onPreviewFocus?.();
            focusPreviewWindow(openedWindowId);
          },
          {
            windowId: openedWindowId,
            surface: resolvedInput.surface,
          },
        );
      }
      return { handled: true, id: openedWindowId };
    },
    [
      applyAppearanceSettings,
      ensureAppearancePreviewSession,
      focusPreviewWindow,
      onPreviewFocus,
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

  useEffect(() => {
    if (
      !previewLaunchInput ||
      previewLaunchInput.surface !== "browser" ||
      !previewLaunchInput.id
    ) {
      return;
    }

    const existingWindow = usePreviewWindowStore
      .getState()
      .windows.find(
        (windowState) =>
          windowState.id === previewLaunchInput.id &&
          windowState.surface === "browser",
      );

    if (
      !existingWindow ||
      !shouldSyncBrowserPreviewLaunchInput(existingWindow, previewLaunchInput)
    ) {
      return;
    }

    updatePreviewWindow(
      existingWindow.id,
      buildBrowserPreviewLaunchUpdate(previewLaunchInput),
    );
  }, [previewLaunchInput, updatePreviewWindow]);

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
        return { handled: false, reason: "Invalid preview update request." };
      }

      queuePreviewWindowUpdate(parsed.id, parsed.input, parsed.focusRequested);
      return { handled: true, id: parsed.id };
    },
    [queuePreviewWindowUpdate],
  );

  const handlePreviewWindowCloseEvent = useCallback(
    (payload: unknown) => {
      const windowId = parseWindowIdFromPayload(payload);
      if (!windowId) {
        return { handled: false, reason: "Invalid preview close request." };
      }
      const exists = usePreviewWindowStore
        .getState()
        .windows.some((windowState) => windowState.id === windowId);
      if (!exists) {
        return { handled: false, reason: "Preview window was not found." };
      }
      closePreviewWindowWithMotion(windowId);
      return { handled: true, id: windowId };
    },
    [closePreviewWindowWithMotion],
  );

  const handlePreviewWindowFocusEvent = useCallback(
    (payload: unknown) => {
      const windowId = parseWindowIdFromPayload(payload);
      if (!windowId) {
        return { handled: false, reason: "Invalid preview focus request." };
      }
      const exists = usePreviewWindowStore
        .getState()
        .windows.some((windowState) => windowState.id === windowId);
      if (!exists) {
        return { handled: false, reason: "Preview window was not found." };
      }
      onPreviewFocus?.();
      focusPreviewWindow(windowId);
      return { handled: true, id: windowId };
    },
    [focusPreviewWindow, onPreviewFocus],
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
