import { useCallback, useMemo } from "react";
import type { PreviewWindow } from "../../stores/previewWindowStore";
import type { PanelPosition } from "../ui/FloatingPanel";
import type {
  PanelConfig,
  PanelConfigs,
  PanelId,
  PanelVisibility,
} from "./MainLayout.types";

interface UseMainPanelWorkspaceModelOptions {
  panels: PanelVisibility;
  panelConfigs: PanelConfigs;
  previewWindows: PreviewWindow[];
  browserPreviewWindows: PreviewWindow[];
  tuiModeActive: boolean;
  resizingPanel: PanelId | null;
  resizingPreviewWindowId: string | null;
  isLogicalFullscreenPanel: (config: PanelConfig) => boolean;
}

export const useMainPanelWorkspaceModel = ({
  panels,
  panelConfigs,
  previewWindows,
  browserPreviewWindows,
  tuiModeActive,
  resizingPanel,
  resizingPreviewWindowId,
  isLogicalFullscreenPanel,
}: UseMainPanelWorkspaceModelOptions) => {
  const getActivePanelsAtPosition = useCallback(
    (position: PanelPosition): PanelId | null =>
      (Object.keys(panelConfigs) as PanelId[]).find(
        (id) =>
          !(tuiModeActive && id === "terminal") &&
          panelConfigs[id].mode === "snapped" &&
          panelConfigs[id].position === position &&
          panels[id],
      ) ?? null,
    [panelConfigs, panels, tuiModeActive],
  );

  const getActivePreviewWindowAtPosition = useCallback(
    (
      position: PanelPosition,
      excludeWindowId?: string | null,
    ): PreviewWindow | null =>
      previewWindows.find(
        (windowState) =>
          windowState.id !== excludeWindowId &&
          windowState.mode === "snapped" &&
          windowState.position === position,
      ) ?? null,
    [previewWindows],
  );

  const getBrowserPreviewWindowAtPosition = useCallback(
    (position: PanelPosition): PreviewWindow | null =>
      browserPreviewWindows.find(
        (windowState) =>
          windowState.mode === "snapped" && windowState.position === position,
      ) ?? null,
    [browserPreviewWindows],
  );

  return useMemo(() => {
    const leftSnappedPanel = getActivePanelsAtPosition("left");
    const rightSnappedPanel = getActivePanelsAtPosition("right");
    const topSnappedPanel = getActivePanelsAtPosition("top");
    const bottomSnappedPanel = getActivePanelsAtPosition("bottom");
    const leftSnappedPreviewWindow = getBrowserPreviewWindowAtPosition("left");
    const rightSnappedPreviewWindow =
      getBrowserPreviewWindowAtPosition("right");
    const topSnappedPreviewWindow = getBrowserPreviewWindowAtPosition("top");
    const bottomSnappedPreviewWindow =
      getBrowserPreviewWindowAtPosition("bottom");

    const leftSlotWidth = leftSnappedPanel
      ? panelConfigs[leftSnappedPanel].size.width
      : leftSnappedPreviewWindow
        ? leftSnappedPreviewWindow.width
        : 0;
    const rightSlotWidth = rightSnappedPanel
      ? panelConfigs[rightSnappedPanel].size.width
      : rightSnappedPreviewWindow
        ? rightSnappedPreviewWindow.width
        : 0;
    const topSlotHeight = topSnappedPanel
      ? panelConfigs[topSnappedPanel].size.height
      : topSnappedPreviewWindow
        ? topSnappedPreviewWindow.height
        : 0;
    const bottomSlotHeight = bottomSnappedPanel
      ? panelConfigs[bottomSnappedPanel].size.height
      : bottomSnappedPreviewWindow
        ? bottomSnappedPreviewWindow.height
        : 0;

    const leftSlotActive = Boolean(
      leftSnappedPanel || leftSnappedPreviewWindow,
    );
    const rightSlotActive = Boolean(
      rightSnappedPanel || rightSnappedPreviewWindow,
    );
    const topSlotActive = Boolean(topSnappedPanel || topSnappedPreviewWindow);
    const bottomSlotActive = Boolean(
      bottomSnappedPanel || bottomSnappedPreviewWindow,
    );

    const floatingPanelIds = (Object.keys(panelConfigs) as PanelId[]).filter(
      (panelId) =>
        !(tuiModeActive && panelId === "terminal") &&
        panels[panelId] &&
        panelConfigs[panelId].mode === "floating",
    );
    const floatingBrowserPreviewWindows = browserPreviewWindows.filter(
      (windowState) => windowState.mode === "floating",
    );
    const shouldSuppressSnappedExitForPosition = (position: PanelPosition) =>
      floatingPanelIds.some((panelId) => {
        const config = panelConfigs[panelId];
        return config.position === position && isLogicalFullscreenPanel(config);
      });

    return {
      getActivePanelsAtPosition,
      getActivePreviewWindowAtPosition,
      getBrowserPreviewWindowAtPosition,
      fullscreenSnappedExitSuppression: {
        left: shouldSuppressSnappedExitForPosition("left"),
        right: shouldSuppressSnappedExitForPosition("right"),
        top: shouldSuppressSnappedExitForPosition("top"),
        bottom: shouldSuppressSnappedExitForPosition("bottom"),
      },
      floatingPanelIds,
      floatingBrowserPreviewWindows,
      occupiedSlots: {
        left: leftSlotActive,
        right: rightSlotActive,
        top: topSlotActive,
        bottom: bottomSlotActive,
      },
      mainSnappedPanels: {
        left: leftSlotWidth || undefined,
        right: rightSlotWidth || undefined,
        top: topSlotHeight || undefined,
        bottom: bottomSlotHeight || undefined,
      },
      slots: {
        left: {
          panelId: leftSnappedPanel,
          previewWindow: leftSnappedPreviewWindow,
          size: leftSlotWidth,
          active: leftSlotActive,
          isResizing:
            resizingPanel === leftSnappedPanel ||
            resizingPreviewWindowId === leftSnappedPreviewWindow?.id,
        },
        right: {
          panelId: rightSnappedPanel,
          previewWindow: rightSnappedPreviewWindow,
          size: rightSlotWidth,
          active: rightSlotActive,
          isResizing:
            resizingPanel === rightSnappedPanel ||
            resizingPreviewWindowId === rightSnappedPreviewWindow?.id,
        },
        top: {
          panelId: topSnappedPanel,
          previewWindow: topSnappedPreviewWindow,
          size: topSlotHeight,
          active: topSlotActive,
          isResizing:
            resizingPanel === topSnappedPanel ||
            resizingPreviewWindowId === topSnappedPreviewWindow?.id,
        },
        bottom: {
          panelId: bottomSnappedPanel,
          previewWindow: bottomSnappedPreviewWindow,
          size: bottomSlotHeight,
          active: bottomSlotActive,
          isResizing:
            resizingPanel === bottomSnappedPanel ||
            resizingPreviewWindowId === bottomSnappedPreviewWindow?.id,
        },
      },
    };
  }, [
    browserPreviewWindows,
    getActivePanelsAtPosition,
    getActivePreviewWindowAtPosition,
    getBrowserPreviewWindowAtPosition,
    isLogicalFullscreenPanel,
    panelConfigs,
    panels,
    resizingPanel,
    resizingPreviewWindowId,
    tuiModeActive,
  ]);
};
