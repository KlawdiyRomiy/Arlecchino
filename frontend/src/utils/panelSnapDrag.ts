import type { PanelPosition } from "../components/ui/FloatingPanel";
import { SNAPPED_PANEL_OUTER_GAP } from "./layoutHelpers";
import { getEffectiveUiScale, logicalToScreenPixels } from "./logicalViewport";

const PANEL_DROP_PREVIEW_WIDTH = 150;
const PANEL_DROP_PREVIEW_HEIGHT = 100;
const PANEL_DROP_HIT_EXPANSION = 72;
const PANEL_DROP_HIT_WIDTH =
  PANEL_DROP_PREVIEW_WIDTH + PANEL_DROP_HIT_EXPANSION;
const PANEL_DROP_HIT_HEIGHT =
  PANEL_DROP_PREVIEW_HEIGHT + PANEL_DROP_HIT_EXPANSION;

export interface PanelSnapDragCallbacks {
  onPanelSnapDragStart?: () => void;
  onPanelSnapDragMove?: (position: PanelPosition | null) => void;
  onPanelSnapDragEnd?: () => void;
}

export const detectPanelSnapDropTarget = (
  clientX: number,
  clientY: number,
  uiScale?: number,
): PanelPosition | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const effectiveUiScale = getEffectiveUiScale(uiScale);
  const horizontalThreshold = logicalToScreenPixels(
    PANEL_DROP_HIT_WIDTH,
    effectiveUiScale,
  );
  const verticalThreshold = logicalToScreenPixels(
    PANEL_DROP_HIT_HEIGHT,
    effectiveUiScale,
  );
  const edgeGap = logicalToScreenPixels(
    SNAPPED_PANEL_OUTER_GAP,
    effectiveUiScale,
  );
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const candidates: Array<{ position: PanelPosition; distance: number }> = [];

  if (clientX <= horizontalThreshold + edgeGap) {
    candidates.push({ position: "left", distance: clientX });
  }
  if (clientX >= windowWidth - horizontalThreshold - edgeGap) {
    candidates.push({ position: "right", distance: windowWidth - clientX });
  }
  if (clientY <= verticalThreshold + edgeGap) {
    candidates.push({ position: "top", distance: clientY });
  }
  if (clientY >= windowHeight - verticalThreshold - edgeGap) {
    candidates.push({ position: "bottom", distance: windowHeight - clientY });
  }

  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.position ?? null;
};
