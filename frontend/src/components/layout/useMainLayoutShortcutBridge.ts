import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  usePreviewWindowStore,
  type PreviewWindow,
} from "../../stores/previewWindowStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { shortcuts, type ShortcutActionId } from "../../utils/keyboard";
import type { PanelPosition } from "../ui/FloatingPanel";
import type {
  HeldPanelShortcut,
  HeldPanelShortcutTarget,
  PanelConfigs,
  PanelId,
  PanelVisibility,
  RememberedSnappedPositions,
} from "./MainLayout.types";
import {
  clonePanelConfigsValue,
  cloneRememberedSnappedPositionsValue,
  formatPanelPosition,
  normalizePanelSizeForPosition,
  uniquePanelPositions,
} from "./panelLayoutModel";

const PANEL_SHORTCUT_TAP_GRACE_MS = 650;
const APPLICATION_MENU_REPEAT_SUPPRESSION_MS = 700;
const HELD_SHORTCUT_NATIVE_DUPLICATE_SUPPRESSION_MS = 5000;

type ShortcutSuppressionRef = MutableRefObject<{
  actionId: ShortcutActionId;
  until: number;
} | null>;

type ApplicationMenuRepeatRef = MutableRefObject<{
  actionId: ShortcutActionId;
  lastAt: number;
} | null>;

interface PanelDropSettlingRequest {
  panels?: PanelId[];
  previewWindows?: string[];
  positions?: PanelPosition[];
}

interface UseMainLayoutShortcutBridgeOptions {
  applyPanelConfigsState: (panelConfigs: PanelConfigs) => void;
  applyPanelsState: (panels: PanelVisibility) => void;
  applyRememberedSnappedPositionsState: (
    rememberedPositions: RememberedSnappedPositions,
  ) => void;
  applicationMenuRepeatRef: ApplicationMenuRepeatRef;
  delayedShortcutActionSuppressionRef: ShortcutSuppressionRef;
  findAvailablePanelPosition: (options?: {
    preferred?: PanelPosition;
    exclude?: PanelId[];
    excludePositions?: PanelPosition[];
    excludeWindowIds?: string[];
  }) => PanelPosition | null;
  findSnappedPreviewWindowAtPosition: (
    position: PanelPosition,
    options?: { excludeWindowIds?: string[] },
  ) => PreviewWindow | null;
  findVisibleSnappedPanelAtPosition: (
    position: PanelPosition,
    options?: { exclude?: PanelId[] },
  ) => PanelId | null;
  heldPanelShortcutRef: MutableRefObject<HeldPanelShortcut | null>;
  isSnappedPositionOccupied: (
    position: PanelPosition,
    options?: { exclude?: PanelId[]; excludeWindowIds?: string[] },
  ) => boolean;
  movePreviewWindowToPosition: (
    windowId: string,
    targetPosition: PanelPosition,
  ) => boolean;
  openCanonicalBrowserPreviewRef: MutableRefObject<() => void>;
  panelConfigsRef: MutableRefObject<PanelConfigs>;
  panelsRef: MutableRefObject<PanelVisibility>;
  pressedShortcutCodesRef: MutableRefObject<Set<string>>;
  rememberedSnappedPositionsRef: MutableRefObject<RememberedSnappedPositions>;
  setFloatingPresenceVersion: Dispatch<SetStateAction<number>>;
  shortcutActionSuppressionRef: ShortcutSuppressionRef;
  showNotification: (type: "success" | "error", message: string) => void;
  snapPreviewWindowToPosition: (
    windowState: PreviewWindow,
    position: PanelPosition,
  ) => boolean;
  startPanelDropSettling: (request: PanelDropSettlingRequest) => void;
}

export const useMainLayoutShortcutBridge = ({
  applyPanelConfigsState,
  applyPanelsState,
  applyRememberedSnappedPositionsState,
  applicationMenuRepeatRef,
  delayedShortcutActionSuppressionRef,
  findAvailablePanelPosition,
  findSnappedPreviewWindowAtPosition,
  findVisibleSnappedPanelAtPosition,
  heldPanelShortcutRef,
  isSnappedPositionOccupied,
  movePreviewWindowToPosition,
  openCanonicalBrowserPreviewRef,
  panelConfigsRef,
  panelsRef,
  pressedShortcutCodesRef,
  rememberedSnappedPositionsRef,
  setFloatingPresenceVersion,
  shortcutActionSuppressionRef,
  showNotification,
  snapPreviewWindowToPosition,
  startPanelDropSettling,
}: UseMainLayoutShortcutBridgeOptions) => {
  const getShortcutEventCode = (event: KeyboardEvent): string =>
    event.code || event.key.toLowerCase();

  const getPanelShortcutMovePosition = (
    event: KeyboardEvent,
  ): PanelPosition | null => {
    if (shortcuts.arrowLeft(event)) {
      return "left";
    }
    if (shortcuts.arrowRight(event)) {
      return "right";
    }
    if (shortcuts.arrowUp(event)) {
      return "top";
    }
    if (shortcuts.arrowDown(event)) {
      return "bottom";
    }
    return null;
  };

  const movePanelFromHeldShortcut = (
    panelId: PanelId,
    targetPosition: PanelPosition,
  ): boolean => {
    if (useTerminalStore.getState().tuiModeActive) {
      return false;
    }

    const currentPanels = panelsRef.current;
    const currentConfigs = panelConfigsRef.current;
    const currentConfig = currentConfigs[panelId];
    const isPanelVisible = currentPanels[panelId];
    const sourcePosition =
      currentConfig.mode === "snapped"
        ? currentConfig.position
        : rememberedSnappedPositionsRef.current[panelId];

    if (
      isPanelVisible &&
      currentConfig.mode === "snapped" &&
      sourcePosition === targetPosition
    ) {
      return true;
    }

    const targetPanel = findVisibleSnappedPanelAtPosition(targetPosition, {
      exclude: [panelId],
    });
    const targetPreviewWindow = targetPanel
      ? null
      : findSnappedPreviewWindowAtPosition(targetPosition);
    const relocatingPanels = [panelId];
    const relocatingPreviewWindows: string[] = [];
    const settlingPositions: Array<PanelPosition | null | undefined> = [
      targetPosition,
      currentConfig.mode === "snapped" ? sourcePosition : null,
    ];
    const nextPanels = { ...currentPanels, [panelId]: true };
    const nextPanelConfigs = clonePanelConfigsValue(panelConfigsRef.current);
    const nextRememberedSnappedPositions = cloneRememberedSnappedPositionsValue(
      rememberedSnappedPositionsRef.current,
    );

    if (targetPanel) {
      relocatingPanels.push(targetPanel);
      const fallbackPosition =
        sourcePosition !== targetPosition &&
        !isSnappedPositionOccupied(sourcePosition, {
          exclude: [panelId, targetPanel],
        })
          ? sourcePosition
          : findAvailablePanelPosition({
              preferred: rememberedSnappedPositionsRef.current[targetPanel],
              exclude: [panelId, targetPanel],
              excludePositions: [targetPosition],
            });

      if (!fallbackPosition) {
        return false;
      }
      settlingPositions.push(fallbackPosition);

      const targetConfig = panelConfigsRef.current[targetPanel];
      nextPanelConfigs[targetPanel] = {
        ...nextPanelConfigs[targetPanel],
        mode: "snapped",
        position: fallbackPosition,
        x: 0,
        y: 0,
        size: normalizePanelSizeForPosition(
          fallbackPosition,
          targetConfig.size,
        ),
      };
      nextRememberedSnappedPositions[targetPanel] = fallbackPosition;
      nextPanels[targetPanel] = true;
    } else if (targetPreviewWindow) {
      relocatingPreviewWindows.push(targetPreviewWindow.id);
      const fallbackPosition =
        sourcePosition !== targetPosition &&
        !isSnappedPositionOccupied(sourcePosition, {
          exclude: [panelId],
          excludeWindowIds: [targetPreviewWindow.id],
        })
          ? sourcePosition
          : findAvailablePanelPosition({
              preferred: targetPreviewWindow.position,
              exclude: [panelId],
              excludeWindowIds: [targetPreviewWindow.id],
              excludePositions: [targetPosition],
            });

      if (!fallbackPosition) {
        return false;
      }
      settlingPositions.push(fallbackPosition);

      if (!snapPreviewWindowToPosition(targetPreviewWindow, fallbackPosition)) {
        return false;
      }
    }

    nextPanelConfigs[panelId] = {
      ...nextPanelConfigs[panelId],
      mode: "snapped",
      position: targetPosition,
      x: 0,
      y: 0,
      size: normalizePanelSizeForPosition(targetPosition, currentConfig.size),
    };
    nextRememberedSnappedPositions[panelId] = targetPosition;

    if (isPanelVisible && currentConfig.mode === "floating") {
      setFloatingPresenceVersion((version) => version + 1);
    }

    startPanelDropSettling({
      panels: relocatingPanels,
      previewWindows: relocatingPreviewWindows,
      positions: uniquePanelPositions(settlingPositions),
    });
    applyPanelsState(nextPanels);
    applyPanelConfigsState(nextPanelConfigs);
    applyRememberedSnappedPositionsState(nextRememberedSnappedPositions);
    return true;
  };

  const clearHeldPanelShortcutTapGraceTimer = (
    heldShortcut: HeldPanelShortcut | null,
  ) => {
    if (!heldShortcut?.tapGraceTimer) {
      return;
    }

    clearTimeout(heldShortcut.tapGraceTimer);
    heldShortcut.tapGraceTimer = null;
  };

  const suppressDelayedShortcutMenuDuplicate = (
    actionId: ShortcutActionId | undefined,
  ) => {
    if (!actionId) {
      return;
    }

    const now = performance.now();
    shortcutActionSuppressionRef.current = {
      actionId,
      until: now + APPLICATION_MENU_REPEAT_SUPPRESSION_MS,
    };
    delayedShortcutActionSuppressionRef.current = {
      actionId,
      until: now + HELD_SHORTCUT_NATIVE_DUPLICATE_SUPPRESSION_MS,
    };
  };

  const runHeldPanelShortcutTapAction = (
    heldShortcut: HeldPanelShortcut,
    options: { lockMove?: boolean } = {},
  ): boolean => {
    clearHeldPanelShortcutTapGraceTimer(heldShortcut);
    if (options.lockMove) {
      heldShortcut.moveLocked = true;
    }

    if (!heldShortcut.tapActionRun && !heldShortcut.moved) {
      heldShortcut.runTapAction();
      heldShortcut.tapActionRun = true;
      return true;
    }

    return false;
  };

  const commitHeldPanelShortcutTapAfterGrace = (
    heldShortcut: HeldPanelShortcut,
  ) => {
    if (heldPanelShortcutRef.current !== heldShortcut) {
      clearHeldPanelShortcutTapGraceTimer(heldShortcut);
      return;
    }

    const tapActionCommitted = runHeldPanelShortcutTapAction(heldShortcut, {
      lockMove: true,
    });
    if (heldPanelShortcutRef.current === heldShortcut && !heldShortcut.moved) {
      if (tapActionCommitted) {
        suppressDelayedShortcutMenuDuplicate(heldShortcut.actionId);
      }
    }
  };

  const clearHeldPanelShortcut = (runTapAction: boolean) => {
    const heldShortcut = heldPanelShortcutRef.current;
    heldPanelShortcutRef.current = null;

    if (
      runTapAction &&
      heldShortcut &&
      !heldShortcut.tapActionRun &&
      !heldShortcut.moved
    ) {
      if (runHeldPanelShortcutTapAction(heldShortcut)) {
        suppressDelayedShortcutMenuDuplicate(heldShortcut.actionId);
      }
    } else {
      clearHeldPanelShortcutTapGraceTimer(heldShortcut);
    }
  };

  const areHeldPanelShortcutTargetsEqual = (
    left: HeldPanelShortcutTarget,
    right: HeldPanelShortcutTarget,
  ): boolean => {
    if (left.kind !== right.kind) {
      return false;
    }

    if (left.kind === "panel" && right.kind === "panel") {
      return left.panelId === right.panelId;
    }

    if (left.kind === "preview" && right.kind === "preview") {
      return left.windowId === right.windowId;
    }

    return false;
  };

  const getBrowserPreviewWindowForShortcut = (): PreviewWindow | null => {
    const state = usePreviewWindowStore.getState();
    const activeWindow = state.activeWindowId
      ? state.windows.find(
          (windowState) => windowState.id === state.activeWindowId,
        )
      : undefined;
    if (activeWindow?.surface === "browser") {
      return activeWindow;
    }

    return (
      state.windows
        .slice()
        .sort((left, right) => right.zIndex - left.zIndex)
        .find((windowState) => windowState.surface === "browser") ?? null
    );
  };

  const isHeldPanelShortcutTargetVisible = (
    target: HeldPanelShortcutTarget,
  ): boolean => {
    if (target.kind === "panel") {
      return panelsRef.current[target.panelId];
    }

    if (target.windowId !== undefined) {
      return usePreviewWindowStore
        .getState()
        .windows.some((windowState) => windowState.id === target.windowId);
    }

    return getBrowserPreviewWindowForShortcut() !== null;
  };

  const moveSnappedPanelBetweenSides = (
    from: PanelPosition,
    to: PanelPosition,
  ): boolean => {
    if (from === to) {
      return true;
    }

    const panelId = findVisibleSnappedPanelAtPosition(from);
    if (!panelId) {
      showNotification(
        "error",
        `[Panels] No snapped panel on the ${formatPanelPosition(from)} side`,
      );
      return false;
    }

    const moved = movePanelFromHeldShortcut(panelId, to);
    if (!moved) {
      showNotification(
        "error",
        `[Panels] Unable to move ${formatPanelPosition(from)} panel to the ${formatPanelPosition(to)} side`,
      );
    }
    return moved;
  };

  const moveBrowserPreviewToPosition = (
    targetPosition: PanelPosition,
  ): void => {
    const moveExistingPreview = (previewWindow: PreviewWindow): boolean => {
      const moved = movePreviewWindowToPosition(
        previewWindow.id,
        targetPosition,
      );
      if (!moved) {
        showNotification(
          "error",
          `[Preview] Unable to move browser preview to the ${formatPanelPosition(targetPosition)} side`,
        );
      }
      return moved;
    };

    const existingPreviewWindow = getBrowserPreviewWindowForShortcut();
    if (existingPreviewWindow) {
      moveExistingPreview(existingPreviewWindow);
      return;
    }

    openCanonicalBrowserPreviewRef.current();
    window.requestAnimationFrame(() => {
      const openedPreviewWindow = getBrowserPreviewWindowForShortcut();
      if (openedPreviewWindow) {
        moveExistingPreview(openedPreviewWindow);
      }
    });
  };

  const beginHeldPanelShortcut = (
    event: KeyboardEvent,
    target: HeldPanelShortcutTarget,
    runTapAction: () => void,
    options: {
      actionId?: ShortcutActionId;
      runTapActionImmediately?: boolean;
    } = {},
  ) => {
    const triggerCode = getShortcutEventCode(event);
    const currentHeldShortcut = heldPanelShortcutRef.current;

    if (
      currentHeldShortcut &&
      areHeldPanelShortcutTargetsEqual(currentHeldShortcut.target, target) &&
      currentHeldShortcut.triggerCode === triggerCode
    ) {
      if (event.repeat) {
        if (!currentHeldShortcut.tapActionRun && !currentHeldShortcut.moved) {
          clearHeldPanelShortcutTapGraceTimer(currentHeldShortcut);
        }
        return;
      }

      if (!currentHeldShortcut.tapActionRun && !currentHeldShortcut.moved) {
        clearHeldPanelShortcut(true);
        return;
      }

      clearHeldPanelShortcut(!currentHeldShortcut.tapActionRun);
    } else {
      clearHeldPanelShortcut(true);
    }

    const shouldRunTapAction = options.runTapActionImmediately === true;
    const targetVisible = isHeldPanelShortcutTargetVisible(target);
    const tapActionRun = shouldRunTapAction && !targetVisible;
    if (tapActionRun) {
      runTapAction();
    }

    const heldShortcut: HeldPanelShortcut = {
      actionId: options.actionId,
      target,
      triggerCode,
      modifiers: {
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
      },
      runTapAction,
      tapActionRun,
      tapGraceTimer: null,
      moveLocked: false,
      moved: false,
    };
    heldPanelShortcutRef.current = heldShortcut;

    if (shouldRunTapAction && targetVisible) {
      heldShortcut.tapGraceTimer = setTimeout(() => {
        commitHeldPanelShortcutTapAfterGrace(heldShortcut);
      }, PANEL_SHORTCUT_TAP_GRACE_MS);
    }
  };

  const markShortcutActionHandled = (actionId: ShortcutActionId) => {
    shortcutActionSuppressionRef.current = {
      actionId,
      until: performance.now() + APPLICATION_MENU_REPEAT_SUPPRESSION_MS,
    };
  };

  const shouldSuppressApplicationMenuAction = (
    actionId: ShortcutActionId,
  ): boolean => {
    const now = performance.now();
    const delayedSuppression = delayedShortcutActionSuppressionRef.current;
    if (delayedSuppression) {
      if (now > delayedSuppression.until) {
        delayedShortcutActionSuppressionRef.current = null;
      } else if (delayedSuppression.actionId === actionId) {
        if (heldPanelShortcutRef.current?.actionId !== actionId) {
          delayedShortcutActionSuppressionRef.current = null;
        }
        return true;
      }
    }

    const shortcutSuppression = shortcutActionSuppressionRef.current;
    if (
      shortcutSuppression &&
      shortcutSuppression.actionId === actionId &&
      now <= shortcutSuppression.until
    ) {
      shortcutSuppression.until = now + APPLICATION_MENU_REPEAT_SUPPRESSION_MS;
      return true;
    }

    const repeat = applicationMenuRepeatRef.current;
    if (
      repeat &&
      repeat.actionId === actionId &&
      now - repeat.lastAt <= APPLICATION_MENU_REPEAT_SUPPRESSION_MS
    ) {
      repeat.lastAt = now;
      return true;
    }

    applicationMenuRepeatRef.current = { actionId, lastAt: now };
    return false;
  };

  const isHeldPanelShortcutActive = (
    event: KeyboardEvent,
    heldShortcut: HeldPanelShortcut,
  ): boolean => {
    if (!pressedShortcutCodesRef.current.has(heldShortcut.triggerCode)) {
      return false;
    }

    const { modifiers } = heldShortcut;
    if (modifiers.meta && !event.metaKey) {
      return false;
    }
    if (modifiers.ctrl && !event.ctrlKey) {
      return false;
    }
    if (modifiers.alt && !event.altKey) {
      return false;
    }
    if (modifiers.shift && !event.shiftKey) {
      return false;
    }

    return true;
  };

  const handleHeldPanelShortcutMove = (event: KeyboardEvent): boolean => {
    const targetPosition = getPanelShortcutMovePosition(event);
    const heldShortcut = heldPanelShortcutRef.current;
    if (!targetPosition || !heldShortcut) {
      return false;
    }

    if (heldShortcut.moveLocked) {
      return false;
    }

    if (!isHeldPanelShortcutActive(event, heldShortcut)) {
      return false;
    }

    if (heldShortcut.target.kind === "panel") {
      if (
        !movePanelFromHeldShortcut(heldShortcut.target.panelId, targetPosition)
      ) {
        return false;
      }
    } else {
      const previewTarget = heldShortcut.target;
      const previewWindow =
        previewTarget.windowId !== undefined
          ? usePreviewWindowStore
              .getState()
              .windows.find(
                (windowState) => windowState.id === previewTarget.windowId,
              )
          : getBrowserPreviewWindowForShortcut();
      if (!previewWindow) {
        moveBrowserPreviewToPosition(targetPosition);
      } else if (
        !movePreviewWindowToPosition(previewWindow.id, targetPosition)
      ) {
        return false;
      }
    }

    clearHeldPanelShortcutTapGraceTimer(heldShortcut);
    heldShortcut.moved = true;
    return true;
  };

  const finishHeldPanelShortcutOnKeyUp = (event: KeyboardEvent) => {
    const heldShortcut = heldPanelShortcutRef.current;
    if (!heldShortcut) {
      return;
    }

    if (getShortcutEventCode(event) === heldShortcut.triggerCode) {
      clearHeldPanelShortcut(true);
      return;
    }

    if (!isHeldPanelShortcutActive(event, heldShortcut)) {
      clearHeldPanelShortcut(true);
    }
  };

  return {
    beginHeldPanelShortcut,
    clearHeldPanelShortcut,
    finishHeldPanelShortcutOnKeyUp,
    getBrowserPreviewWindowForShortcut,
    getShortcutEventCode,
    handleHeldPanelShortcutMove,
    markShortcutActionHandled,
    moveBrowserPreviewToPosition,
    movePanelToPosition: movePanelFromHeldShortcut,
    moveSnappedPanelBetweenSides,
    shouldSuppressApplicationMenuAction,
  };
};
