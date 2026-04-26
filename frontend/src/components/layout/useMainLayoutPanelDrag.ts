import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  usePreviewWindowStore,
  type PreviewWindow,
  type UpdatePreviewWindowInput,
} from "../../stores/previewWindowStore";
import type { PanelPosition, PanelSize } from "../ui/FloatingPanel";
import type {
  PanelConfigs,
  PanelId,
  PanelVisibility,
  RememberedSnappedPositions,
} from "./MainLayout.types";
import {
  normalizePanelSizeForPosition,
  uniquePanelPositions,
} from "./panelLayoutModel";

interface PanelDropSettlingRequest {
  panels?: PanelId[];
  previewWindows?: string[];
  positions?: PanelPosition[];
}

interface UseMainLayoutPanelDragOptions {
  applyPanelConfigsState: (panelConfigs: PanelConfigs) => void;
  applyRememberedSnappedPositionsState: (
    rememberedPositions: RememberedSnappedPositions,
  ) => void;
  draggingPanel: PanelId | null;
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
  focusPreviewWindow: (windowId: string) => void;
  gitDiffBaselineWidthRef: MutableRefObject<number | null>;
  isSnappedPositionOccupied: (
    position: PanelPosition,
    options?: { exclude?: PanelId[]; excludeWindowIds?: string[] },
  ) => boolean;
  movePreviewWindowToPosition: (
    windowId: string,
    position: PanelPosition,
  ) => boolean;
  panelConfigs: PanelConfigs;
  panelConfigsRef: MutableRefObject<PanelConfigs>;
  panelDropSettlingTimerRef: MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  panels: PanelVisibility;
  rememberedSnappedPositionsRef: MutableRefObject<RememberedSnappedPositions>;
  setDraggingPanel: Dispatch<SetStateAction<PanelId | null>>;
  setDraggingPreviewWindowId: Dispatch<SetStateAction<string | null>>;
  setDropTargetPosition: Dispatch<SetStateAction<PanelPosition | null>>;
  setFloatingPresenceVersion: Dispatch<SetStateAction<number>>;
  setPanelConfigs: Dispatch<SetStateAction<PanelConfigs>>;
  setPanelDropSettling: Dispatch<SetStateAction<boolean>>;
  setRelocatingPanelIds: Dispatch<SetStateAction<PanelId[]>>;
  setRelocatingPreviewWindowIds: Dispatch<SetStateAction<string[]>>;
  snapPreviewWindowToPosition: (
    windowState: PreviewWindow,
    position: PanelPosition,
  ) => boolean;
  startPanelDropSettling: (request: PanelDropSettlingRequest) => void;
  updatePreviewWindow: (
    windowId: string,
    input: UpdatePreviewWindowInput,
  ) => boolean;
}

export const useMainLayoutPanelDrag = ({
  applyPanelConfigsState,
  applyRememberedSnappedPositionsState,
  draggingPanel,
  findAvailablePanelPosition,
  findSnappedPreviewWindowAtPosition,
  focusPreviewWindow,
  gitDiffBaselineWidthRef,
  isSnappedPositionOccupied,
  movePreviewWindowToPosition,
  panelConfigs,
  panelConfigsRef,
  panelDropSettlingTimerRef,
  panels,
  rememberedSnappedPositionsRef,
  setDraggingPanel,
  setDraggingPreviewWindowId,
  setDropTargetPosition,
  setFloatingPresenceVersion,
  setPanelConfigs,
  setPanelDropSettling,
  setRelocatingPanelIds,
  setRelocatingPreviewWindowIds,
  snapPreviewWindowToPosition,
  startPanelDropSettling,
  updatePreviewWindow,
}: UseMainLayoutPanelDragOptions) => {
  const handlePanelResize = useCallback(
    (
      panelId: PanelId,
      updates: { width: number; height: number; x?: number; y?: number },
    ) => {
      setPanelConfigs((prev) => {
        const current = prev[panelId];
        const nextX = updates.x !== undefined ? updates.x : current.x;
        const nextY = updates.y !== undefined ? updates.y : current.y;

        if (
          current.size.width === updates.width &&
          current.size.height === updates.height &&
          current.x === nextX &&
          current.y === nextY
        ) {
          return prev;
        }

        return {
          ...prev,
          [panelId]: {
            ...current,
            size: { width: updates.width, height: updates.height },
            x: nextX,
            y: nextY,
          },
        };
      });
    },
    [setPanelConfigs],
  );

  const handleGitDiffFocusChange = useCallback(
    (active: boolean) => {
      const gitConfig = panelConfigsRef.current.git;
      const isEligibleHost =
        gitConfig.mode === "snapped" &&
        (gitConfig.position === "left" || gitConfig.position === "right");

      if (!active) {
        const baselineWidth = gitDiffBaselineWidthRef.current;
        gitDiffBaselineWidthRef.current = null;

        if (!isEligibleHost || baselineWidth === null) {
          return;
        }

        setPanelConfigs((previous) => {
          const currentGit = previous.git;
          if (
            currentGit.mode !== "snapped" ||
            (currentGit.position !== "left" && currentGit.position !== "right")
          ) {
            return previous;
          }

          if (currentGit.size.width === baselineWidth) {
            return previous;
          }

          return {
            ...previous,
            git: {
              ...currentGit,
              size: {
                ...currentGit.size,
                width: baselineWidth,
              },
            },
          };
        });
        return;
      }

      if (!isEligibleHost) {
        return;
      }

      const currentWidth = gitConfig.size.width;
      if (currentWidth >= 560) {
        return;
      }

      if (gitDiffBaselineWidthRef.current === null) {
        gitDiffBaselineWidthRef.current = currentWidth;
      }

      const targetWidth = Math.min(Math.max(currentWidth, 560), 720);
      if (targetWidth === currentWidth) {
        return;
      }

      setPanelConfigs((previous) => {
        const currentGit = previous.git;
        if (
          currentGit.mode !== "snapped" ||
          (currentGit.position !== "left" && currentGit.position !== "right")
        ) {
          return previous;
        }

        if (currentGit.size.width >= targetWidth) {
          return previous;
        }

        return {
          ...previous,
          git: {
            ...currentGit,
            size: {
              ...currentGit.size,
              width: targetWidth,
            },
          },
        };
      });
    },
    [gitDiffBaselineWidthRef, panelConfigsRef, setPanelConfigs],
  );

  const resetDragSettlingState = useCallback(() => {
    if (panelDropSettlingTimerRef.current) {
      clearTimeout(panelDropSettlingTimerRef.current);
      panelDropSettlingTimerRef.current = null;
    }
    setPanelDropSettling(false);
    setRelocatingPanelIds([]);
    setRelocatingPreviewWindowIds([]);
  }, [
    panelDropSettlingTimerRef,
    setPanelDropSettling,
    setRelocatingPanelIds,
    setRelocatingPreviewWindowIds,
  ]);

  const handleDragStart = useCallback(
    (panelId: string) => {
      resetDragSettlingState();
      setDraggingPreviewWindowId(null);
      setDraggingPanel(panelId as PanelId);
    },
    [resetDragSettlingState, setDraggingPanel, setDraggingPreviewWindowId],
  );

  const handleDragMove = useCallback(
    (_panelId: string, targetPosition: PanelPosition | null) => {
      setDropTargetPosition((current) =>
        current === targetPosition ? current : targetPosition,
      );
    },
    [setDropTargetPosition],
  );

  const handlePreviewWindowDragStart = useCallback(
    (windowId: string) => {
      resetDragSettlingState();
      setDraggingPanel(null);
      setDraggingPreviewWindowId(windowId);
      focusPreviewWindow(windowId);
    },
    [
      focusPreviewWindow,
      resetDragSettlingState,
      setDraggingPanel,
      setDraggingPreviewWindowId,
    ],
  );

  const handlePreviewWindowDragMove = useCallback(
    (_windowId: string, targetPosition: PanelPosition | null) => {
      setDropTargetPosition((current) =>
        current === targetPosition ? current : targetPosition,
      );
    },
    [setDropTargetPosition],
  );

  const handlePreviewWindowDragEnd = useCallback(
    (
      windowId: string,
      targetPosition: PanelPosition | null,
      dropX?: number,
      dropY?: number,
      dropWidth?: number,
      dropHeight?: number,
    ): boolean => {
      setDraggingPreviewWindowId(null);
      setDropTargetPosition(null);

      if (!targetPosition) {
        return false;
      }

      if (movePreviewWindowToPosition(windowId, targetPosition)) {
        return true;
      }

      const previewWindow = usePreviewWindowStore
        .getState()
        .windows.find((windowState) => windowState.id === windowId);
      if (!previewWindow) {
        return true;
      }

      updatePreviewWindow(windowId, {
        mode: "floating",
        x: dropX ?? previewWindow.x,
        y: dropY ?? previewWindow.y,
        width: dropWidth ?? previewWindow.width,
        height: dropHeight ?? previewWindow.height,
      });
      return true;
    },
    [
      movePreviewWindowToPosition,
      setDraggingPreviewWindowId,
      setDropTargetPosition,
      updatePreviewWindow,
    ],
  );

  const getSizeForPosition = useCallback(
    (position: PanelPosition, currentSize: PanelSize): PanelSize =>
      normalizePanelSizeForPosition(position, currentSize),
    [],
  );

  const handleDragEnd = useCallback(
    (
      _panelId: string,
      targetPosition: PanelPosition | null,
      dropX?: number,
      dropY?: number,
    ) => {
      if (draggingPanel) {
        const currentPanel = draggingPanel;

        if (targetPosition) {
          const panelAtTarget = (Object.keys(panelConfigs) as PanelId[]).find(
            (id) =>
              id !== currentPanel &&
              panelConfigs[id].position === targetPosition &&
              panelConfigs[id].mode === "snapped" &&
              panels[id],
          );
          const previewWindowAtTarget = panelAtTarget
            ? null
            : findSnappedPreviewWindowAtPosition(targetPosition);

          const currentConfig = panelConfigs[currentPanel];
          const currentPanelSize = currentConfig.size;
          const currentPosition = currentConfig.position;
          const wasFloatingPanel = currentConfig.mode === "floating";

          if (panelAtTarget) {
            const targetConfig = panelConfigs[panelAtTarget];
            const targetPanelSize = targetConfig.size;
            const nextRememberedSnappedPositions = {
              ...rememberedSnappedPositionsRef.current,
              [currentPanel]: targetPosition,
              [panelAtTarget]: currentPosition,
            };
            const nextPanelConfigs = {
              ...panelConfigsRef.current,
              [currentPanel]: {
                ...panelConfigsRef.current[currentPanel],
                mode: "snapped" as const,
                position: targetPosition,
                size: getSizeForPosition(targetPosition, currentPanelSize),
              },
              [panelAtTarget]: {
                ...panelConfigsRef.current[panelAtTarget],
                mode: "snapped" as const,
                position: currentPosition,
                size: getSizeForPosition(currentPosition, targetPanelSize),
              },
            };

            if (wasFloatingPanel) {
              setFloatingPresenceVersion((version) => version + 1);
            }
            startPanelDropSettling({
              panels: [currentPanel, panelAtTarget],
              positions: uniquePanelPositions([
                targetPosition,
                currentPosition,
              ]),
            });
            applyPanelConfigsState(nextPanelConfigs);
            applyRememberedSnappedPositionsState(
              nextRememberedSnappedPositions,
            );
          } else if (previewWindowAtTarget) {
            const fallbackPosition =
              currentConfig.mode === "snapped" &&
              currentPosition !== targetPosition &&
              !isSnappedPositionOccupied(currentPosition, {
                exclude: [currentPanel],
                excludeWindowIds: [previewWindowAtTarget.id],
              })
                ? currentPosition
                : findAvailablePanelPosition({
                    preferred: previewWindowAtTarget.position,
                    exclude: [currentPanel],
                    excludeWindowIds: [previewWindowAtTarget.id],
                    excludePositions: [targetPosition],
                  });

            if (fallbackPosition) {
              snapPreviewWindowToPosition(
                previewWindowAtTarget,
                fallbackPosition,
              );
            } else {
              updatePreviewWindow(previewWindowAtTarget.id, {
                mode: "floating",
                x: previewWindowAtTarget.x,
                y: previewWindowAtTarget.y,
                width: previewWindowAtTarget.width,
                height: previewWindowAtTarget.height,
              });
            }

            const nextRememberedSnappedPositions = {
              ...rememberedSnappedPositionsRef.current,
              [currentPanel]: targetPosition,
            };
            const nextPanelConfigs = {
              ...panelConfigsRef.current,
              [currentPanel]: {
                ...panelConfigsRef.current[currentPanel],
                mode: "snapped" as const,
                position: targetPosition,
                size: getSizeForPosition(targetPosition, currentPanelSize),
              },
            };

            if (wasFloatingPanel) {
              setFloatingPresenceVersion((version) => version + 1);
            }
            startPanelDropSettling({
              panels: [currentPanel],
              previewWindows: [previewWindowAtTarget.id],
              positions: uniquePanelPositions([
                targetPosition,
                currentConfig.mode === "snapped" ? currentPosition : null,
                fallbackPosition,
              ]),
            });
            applyPanelConfigsState(nextPanelConfigs);
            applyRememberedSnappedPositionsState(
              nextRememberedSnappedPositions,
            );
          } else {
            const nextRememberedSnappedPositions = {
              ...rememberedSnappedPositionsRef.current,
              [currentPanel]: targetPosition,
            };
            const nextPanelConfigs = {
              ...panelConfigsRef.current,
              [currentPanel]: {
                ...panelConfigsRef.current[currentPanel],
                mode: "snapped" as const,
                position: targetPosition,
                size: getSizeForPosition(targetPosition, currentPanelSize),
              },
            };

            if (wasFloatingPanel) {
              setFloatingPresenceVersion((version) => version + 1);
            }
            startPanelDropSettling({
              panels: [currentPanel],
              positions: uniquePanelPositions([
                targetPosition,
                currentConfig.mode === "snapped" ? currentPosition : null,
              ]),
            });
            applyPanelConfigsState(nextPanelConfigs);
            applyRememberedSnappedPositionsState(
              nextRememberedSnappedPositions,
            );
          }
        } else if (dropX !== undefined && dropY !== undefined) {
          const currentSize = panelConfigs[currentPanel].size;
          const width = currentSize.width || 300;
          const height = currentSize.height || 400;
          const nextPanelConfigs = {
            ...panelConfigsRef.current,
            [currentPanel]: {
              ...panelConfigsRef.current[currentPanel],
              mode: "floating" as const,
              x: dropX,
              y: dropY,
              size: { width, height },
            },
          };

          applyPanelConfigsState(nextPanelConfigs);
        }
      }

      setDraggingPanel(null);
      setDraggingPreviewWindowId(null);
      setDropTargetPosition(null);
    },
    [
      applyPanelConfigsState,
      applyRememberedSnappedPositionsState,
      draggingPanel,
      findAvailablePanelPosition,
      findSnappedPreviewWindowAtPosition,
      getSizeForPosition,
      isSnappedPositionOccupied,
      panelConfigs,
      panelConfigsRef,
      panels,
      rememberedSnappedPositionsRef,
      setDraggingPanel,
      setDraggingPreviewWindowId,
      setDropTargetPosition,
      setFloatingPresenceVersion,
      snapPreviewWindowToPosition,
      startPanelDropSettling,
      updatePreviewWindow,
    ],
  );

  return {
    handleDragEnd,
    handleDragMove,
    handleDragStart,
    handleGitDiffFocusChange,
    handlePanelResize,
    handlePreviewWindowDragEnd,
    handlePreviewWindowDragMove,
    handlePreviewWindowDragStart,
  };
};
