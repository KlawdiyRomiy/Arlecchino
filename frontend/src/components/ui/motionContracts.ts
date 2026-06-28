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

export const SHELL_MODAL_PANEL_INITIAL = {
  opacity: 0,
  scale: 0.98,
  y: 12,
} as const;

export const SHELL_MODAL_PANEL_ANIMATE = {
  opacity: 1,
  scale: 1,
  y: 0,
} as const;

export const SHELL_MODAL_PANEL_EXIT = {
  opacity: 0,
  scale: 0.985,
  y: 8,
} as const;

export const SHELL_DROPDOWN_TRANSITION = {
  duration: 0.14,
  ease: SHELL_MOTION_EASE,
} as const;
