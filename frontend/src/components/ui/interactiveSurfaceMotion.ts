import { useCallback, useMemo, type CSSProperties } from "react";

import { beginInteractiveSurfaceMotionWindow } from "../../stores/performanceStore";

export type InteractiveSurfaceMotionKind =
  | "menu"
  | "dropdown"
  | "popover"
  | "dialog"
  | "modal"
  | "panel";

const INTERACTIVE_SURFACE_MOTION_DURATIONS_MS: Record<
  InteractiveSurfaceMotionKind,
  number
> = {
  menu: 220,
  dropdown: 260,
  popover: 260,
  dialog: 360,
  modal: 360,
  panel: 360,
};

interface InteractiveSurfaceMotionStyleOptions {
  preserveTransform?: boolean;
  reduceMotion?: boolean;
}

const resolveMotionDuration = (
  kindOrDuration: InteractiveSurfaceMotionKind | number,
) =>
  typeof kindOrDuration === "number"
    ? Math.max(0, kindOrDuration)
    : INTERACTIVE_SURFACE_MOTION_DURATIONS_MS[kindOrDuration];

export const markInteractiveSurfaceMotion = (
  kindOrDuration: InteractiveSurfaceMotionKind | number = "popover",
) => {
  beginInteractiveSurfaceMotionWindow(resolveMotionDuration(kindOrDuration));
};

export const interactiveSurfaceOverlayStyle: CSSProperties = {
  contain: "layout paint style",
  transform: "translateZ(0)",
};

export const getInteractiveSurfaceMotionStyle = ({
  preserveTransform = false,
  reduceMotion = false,
}: InteractiveSurfaceMotionStyleOptions = {}): CSSProperties => ({
  backfaceVisibility: "hidden",
  contain: "layout paint style",
  isolation: "isolate",
  ...(preserveTransform ? {} : { transform: "translateZ(0)" }),
  willChange: reduceMotion ? undefined : "opacity, transform",
});

export const useInteractiveSurfaceMotion = (
  kindOrDuration: InteractiveSurfaceMotionKind | number = "popover",
  options: InteractiveSurfaceMotionStyleOptions = {},
) => {
  const duration = resolveMotionDuration(kindOrDuration);
  const { preserveTransform = false, reduceMotion = false } = options;
  const markMotionStart = useCallback(() => {
    beginInteractiveSurfaceMotionWindow(duration);
  }, [duration]);
  const surfaceStyle = useMemo(
    () =>
      getInteractiveSurfaceMotionStyle({
        preserveTransform,
        reduceMotion,
      }),
    [preserveTransform, reduceMotion],
  );

  return { markMotionStart, surfaceStyle };
};
