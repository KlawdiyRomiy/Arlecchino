export const DEFAULT_UI_SCALE = 1.0;
export const MIN_UI_SCALE = 0.7;
export const MAX_UI_SCALE = 2.0;
export const UI_SCALE_STEP = 0.05;

const UI_SCALE_EPSILON = 0.0001;

export const clampUiScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    return DEFAULT_UI_SCALE;
  }

  return Math.min(Math.max(scale, MIN_UI_SCALE), MAX_UI_SCALE);
};

export const applyUiScaleStep = (
  currentScale: number,
  stepDelta: number,
): number =>
  clampUiScale(Number((currentScale + UI_SCALE_STEP * stepDelta).toFixed(2)));

export const getUiScaleStepOffset = (scale: number): number | null => {
  const normalizedScale = clampUiScale(scale);
  const rawStepOffset = (normalizedScale - DEFAULT_UI_SCALE) / UI_SCALE_STEP;
  const roundedStepOffset = Math.round(rawStepOffset);

  return Math.abs(rawStepOffset - roundedStepOffset) <= UI_SCALE_EPSILON
    ? roundedStepOffset
    : null;
};
