import type { CSSProperties } from "react";

export const FLOATING_PANEL_LAYOUT_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 46,
  mass: 0.7,
  restDelta: 0.4,
  restSpeed: 0.4,
} as const;

export const FLOATING_PANEL_LAYOUT_TRANSITION_MS = 300;
export const FLOATING_PANEL_MOTION_SETTLE_BUFFER_MS = 120;
export const FLOATING_PANEL_OPEN_MOTION_BUFFER_MS = 160;
export const FLOATING_PANEL_INTERACTION_MOTION_BUFFER_MS = 180;
export const FLOATING_PANEL_FULLSCREEN_MOTION_BUFFER_MS = 180;
export const FLOATING_PANEL_EXIT_CLEANUP_BUFFER_MS = 700;
export const FLOATING_PANEL_CONTENT_INTRINSIC_SIZE = "1px 480px";

export const getFloatingPanelMotionDurationMs = (
  bufferMs = FLOATING_PANEL_MOTION_SETTLE_BUFFER_MS,
) => FLOATING_PANEL_LAYOUT_TRANSITION_MS + bufferMs;

export const FLOATING_PANEL_STABLE_CONTENT_VISIBILITY_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: FLOATING_PANEL_CONTENT_INTRINSIC_SIZE,
};
