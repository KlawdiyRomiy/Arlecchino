import { clampUiScale } from "./uiScale";

const DEFAULT_VIEWPORT_WIDTH = 1600;
const DEFAULT_VIEWPORT_HEIGHT = 900;

export const getEffectiveUiScale = (uiScale?: number): number => {
  if (typeof uiScale === "number" && Number.isFinite(uiScale)) {
    return clampUiScale(uiScale);
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    return 1;
  }

  const rawScale = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--ui-scale")
    .trim();
  const parsedScale = Number(rawScale);

  return clampUiScale(
    Number.isFinite(parsedScale) && parsedScale > 0 ? parsedScale : 1,
  );
};

export const getLogicalViewportSize = (
  uiScale?: number,
): { width: number; height: number } => {
  const effectiveScale = getEffectiveUiScale(uiScale);

  if (typeof window === "undefined") {
    return {
      width: DEFAULT_VIEWPORT_WIDTH,
      height: DEFAULT_VIEWPORT_HEIGHT,
    };
  }

  return {
    width: window.innerWidth / effectiveScale,
    height: window.innerHeight / effectiveScale,
  };
};

export const screenToLogicalPixels = (
  value: number,
  uiScale?: number,
): number => value / getEffectiveUiScale(uiScale);

export const logicalToScreenPixels = (
  value: number,
  uiScale?: number,
): number => value * getEffectiveUiScale(uiScale);
