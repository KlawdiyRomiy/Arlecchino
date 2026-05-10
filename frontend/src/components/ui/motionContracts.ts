export const SHELL_MOTION_EASE = [0.16, 1, 0.3, 1] as const;

export const PANEL_FULLSCREEN_MOTION_TRANSITION_MS = 260;
export const PANEL_FULLSCREEN_MOTION_TRANSITION = {
  layout: {
    duration: PANEL_FULLSCREEN_MOTION_TRANSITION_MS / 1000,
    ease: SHELL_MOTION_EASE,
  },
} as const;

export const SHELL_DIALOG_OVERLAY_TRANSITION = {
  duration: 0.14,
  ease: SHELL_MOTION_EASE,
} as const;

export const SHELL_DIALOG_PANEL_TRANSITION = {
  duration: 0.18,
  ease: SHELL_MOTION_EASE,
} as const;

export const SHELL_DROPDOWN_TRANSITION = {
  duration: 0.14,
  ease: SHELL_MOTION_EASE,
} as const;
