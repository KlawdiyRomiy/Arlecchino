import React, { useCallback, useLayoutEffect, useRef } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  PositionNativeWindowControls,
  RefreshNativeWindowControls,
  SetNativeWindowControlsVisible,
} from "../../wails/app";
import { WindowMinimise } from "../../wails/runtime";
import { toggleWindowFullscreen } from "../../utils/windowFullscreen";

interface WailsWindow {
  _wails?: {
    environment?: {
      OS?: string;
    };
  };
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

interface WindowControlsProps {
  visible?: boolean;
  backdropVisible?: boolean;
  nativeEnabled?: boolean;
}

const MAC_CONTROLS_WIDTH = 84;
const MAC_CONTROLS_HEIGHT = 48;
const MAC_CONTROLS_Y_OFFSET = -2;
const MAC_BUBBLE_HEIGHT = 28;
const MAC_TOPBAR_HORIZONTAL_PADDING = 12;
const MAC_BUTTON_LEFT = 12;
const MAC_BUTTON_GAP = 10;
const MAC_BUTTON_SIZE = 13;
const MAC_CONTROLS_BORDER_WIDTH = 1;
const MAC_BUTTON_ROW_WIDTH = MAC_BUTTON_SIZE * 3 + MAC_BUTTON_GAP * 2;
const MAC_BUBBLE_WIDTH =
  MAC_BUTTON_ROW_WIDTH + MAC_BUTTON_LEFT * 2 + MAC_CONTROLS_BORDER_WIDTH * 2;
const MAC_BUBBLE_X_OFFSET = -1;
const MAC_BUBBLE_Y_OFFSET = 1;

const APP_CLOSE_REQUEST_EVENT = "arlecchino:request-close";

const macControlsOuterStyle = {
  "--wails-draggable": "no-drag",
  width: `calc(${MAC_CONTROLS_WIDTH}px * var(--ui-inverse-scale))`,
  height: `calc(${MAC_CONTROLS_HEIGHT}px * var(--ui-inverse-scale))`,
  transform: `translateY(calc(${MAC_CONTROLS_Y_OFFSET}px * var(--ui-inverse-scale)))`,
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
} as React.CSSProperties;

const macControlsBubbleStyle: React.CSSProperties = {
  position: "relative",
  width: `calc(${MAC_BUBBLE_WIDTH}px * var(--ui-inverse-scale))`,
  height: `calc(${MAC_BUBBLE_HEIGHT}px * var(--ui-inverse-scale))`,
  minWidth: `calc(${MAC_BUBBLE_WIDTH}px * var(--ui-inverse-scale))`,
  maxWidth: `calc(${MAC_BUBBLE_WIDTH}px * var(--ui-inverse-scale))`,
  minHeight: `calc(${MAC_BUBBLE_HEIGHT}px * var(--ui-inverse-scale))`,
  maxHeight: `calc(${MAC_BUBBLE_HEIGHT}px * var(--ui-inverse-scale))`,
  boxSizing: "border-box",
};

const nativeBackdropBubbleStyle: React.CSSProperties = {
  ...macControlsBubbleStyle,
  boxSizing: "border-box",
  transform: `translate(calc(${MAC_BUBBLE_X_OFFSET}px * var(--ui-inverse-scale)), calc(${MAC_BUBBLE_Y_OFFSET}px * var(--ui-inverse-scale)))`,
};

const fallbackBubbleStyle: React.CSSProperties = {
  ...macControlsBubbleStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: `calc(${MAC_BUTTON_GAP}px * var(--ui-inverse-scale))`,
  paddingLeft: `calc(${MAC_BUTTON_LEFT}px * var(--ui-inverse-scale))`,
  paddingRight: `calc(${MAC_BUTTON_LEFT}px * var(--ui-inverse-scale))`,
  boxSizing: "border-box",
};

const fallbackButtonStyle: React.CSSProperties = {
  width: `calc(${MAC_BUTTON_SIZE}px * var(--ui-inverse-scale))`,
  height: `calc(${MAC_BUTTON_SIZE}px * var(--ui-inverse-scale))`,
};

const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform || navigator.platform;
  return /mac/i.test(platform) || /mac os x/i.test(navigator.userAgent);
};

const getWailsOS = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as WailsWindow)._wails?.environment?.OS;
};

const shouldUseNativeMacControls = (): boolean => getWailsOS() === "darwin";

const shouldRenderMacControls = (): boolean => {
  const wailsOS = getWailsOS();
  if (wailsOS) {
    return wailsOS === "darwin";
  }

  return isMacPlatform();
};

const readRootNumber = (name: string, fallback: number): number => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return fallback;
  }

  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getNativeWindowControlsInset = (
  placeholder: HTMLElement | null,
): [
  closeX: number,
  closeY: number,
  minimiseX: number,
  minimiseY: number,
  maximiseX: number,
  maximiseY: number,
] => {
  const rect = placeholder?.getBoundingClientRect();
  const controlScale =
    rect && rect.width > 0 ? rect.width / MAC_CONTROLS_WIDTH : 1;
  const closeCenterX =
    rect?.left ??
    MAC_TOPBAR_HORIZONTAL_PADDING * readRootNumber("--ui-scale", 1);
  const closeX =
    closeCenterX + (MAC_BUTTON_LEFT + MAC_BUTTON_SIZE / 2) * controlScale;
  const centerY =
    (rect?.top ?? MAC_CONTROLS_Y_OFFSET) +
    (MAC_CONTROLS_HEIGHT / 2) * controlScale;
  const buttonCenterGap = MAC_BUTTON_SIZE + MAC_BUTTON_GAP;

  return [
    closeX,
    centerY,
    closeX + buttonCenterGap * controlScale,
    centerY,
    closeX + buttonCenterGap * 2 * controlScale,
    centerY,
  ];
};

let nativeWindowControlsOwner: symbol | null = null;
let nativeWindowControlsHideTimer: ReturnType<typeof setTimeout> | null = null;

export const WindowControls: React.FC<WindowControlsProps> = ({
  visible = true,
  backdropVisible = true,
  nativeEnabled,
}) => {
  const useNativeMacControls = shouldUseNativeMacControls();
  const renderMacControls = shouldRenderMacControls();
  const projectSwitchPending = useWorkspaceStore(
    (state) => state.pendingId !== null,
  );
  const ownerRef = useRef<symbol>(Symbol("window-controls-native-owner"));
  const placeholderRef = useRef<HTMLDivElement>(null);
  const controlsVisible = visible && backdropVisible;
  const nativeControlsEnabled = nativeEnabled ?? controlsVisible;

  const handleClose = useCallback(() => {
    window.dispatchEvent(new Event(APP_CLOSE_REQUEST_EVENT));
  }, []);
  const handleMinimize = useCallback(() => WindowMinimise(), []);
  const handleFullscreen = useCallback(() => {
    void toggleWindowFullscreen();
  }, []);

  const positionNativeControls = useCallback(() => {
    if (!controlsVisible || projectSwitchPending) {
      return;
    }

    void PositionNativeWindowControls(
      ...getNativeWindowControlsInset(placeholderRef.current),
    )
      .then((positioned) => {
        if (!positioned || nativeWindowControlsOwner !== ownerRef.current) {
          return;
        }

        return SetNativeWindowControlsVisible(true);
      })
      .catch(() => undefined);
  }, [controlsVisible, projectSwitchPending]);

  useLayoutEffect(() => {
    if (!useNativeMacControls) {
      return;
    }

    const owner = ownerRef.current;
    nativeWindowControlsOwner = owner;
    if (nativeWindowControlsHideTimer !== null) {
      clearTimeout(nativeWindowControlsHideTimer);
      nativeWindowControlsHideTimer = null;
    }

    if (!nativeControlsEnabled) {
      void SetNativeWindowControlsVisible(false).catch(() => undefined);
      return;
    }

    if (!controlsVisible) {
      void SetNativeWindowControlsVisible(true)
        .then((enabled) => {
          if (!enabled || nativeWindowControlsOwner !== owner) {
            return;
          }

          return RefreshNativeWindowControls();
        })
        .catch(() => undefined);
      return;
    }

    if (projectSwitchPending) {
      return;
    }

    let animationFrame = 0;
    let settleAnimationFrame = 0;
    const schedulePosition = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(positionNativeControls);
    };
    const scheduleSettledPosition = () => {
      cancelAnimationFrame(settleAnimationFrame);
      settleAnimationFrame = requestAnimationFrame(() => {
        settleAnimationFrame = requestAnimationFrame(schedulePosition);
      });
    };

    schedulePosition();
    scheduleSettledPosition();
    const retryTimers = [50, 250, 1000].map((delay) =>
      window.setTimeout(schedulePosition, delay),
    );
    window.addEventListener("resize", schedulePosition);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedulePosition);
    if (placeholderRef.current) {
      resizeObserver?.observe(placeholderRef.current);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(settleAnimationFrame);
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", schedulePosition);
      resizeObserver?.disconnect();
    };
  }, [
    controlsVisible,
    nativeControlsEnabled,
    positionNativeControls,
    projectSwitchPending,
    useNativeMacControls,
  ]);

  useLayoutEffect(() => {
    if (!useNativeMacControls) {
      return;
    }

    const owner = ownerRef.current;
    return () => {
      if (nativeWindowControlsOwner !== owner) {
        return;
      }

      nativeWindowControlsOwner = null;
      if (nativeWindowControlsHideTimer !== null) {
        clearTimeout(nativeWindowControlsHideTimer);
      }
      nativeWindowControlsHideTimer = setTimeout(() => {
        nativeWindowControlsHideTimer = null;
        if (nativeWindowControlsOwner !== null) {
          return;
        }

        void SetNativeWindowControlsVisible(false).catch(() => undefined);
      }, 0);
    };
  }, [useNativeMacControls]);

  if (!controlsVisible) {
    return null;
  }

  if (useNativeMacControls) {
    return (
      <div
        ref={placeholderRef}
        className="pointer-events-none shrink-0"
        style={macControlsOuterStyle}
        aria-hidden="true"
        data-testid="window-controls-native-macos"
      >
        <div
          className="shell-cluster"
          aria-hidden="true"
          style={nativeBackdropBubbleStyle}
          data-testid="window-controls-native-backdrop"
        />
      </div>
    );
  }

  return (
    <div
      className="group/window-controls flex items-center"
      style={macControlsOuterStyle}
      data-testid={
        renderMacControls
          ? "window-controls-react-macos"
          : "window-controls-fallback"
      }
    >
      <div
        className="shell-cluster"
        style={fallbackBubbleStyle}
        data-testid="window-controls-react-bubble"
      >
        <button
          type="button"
          aria-label="Close"
          title="Close"
          className="group/window-control-button relative shrink-0 rounded-full border border-[#e0443e] bg-[#ff5f57] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.42),0_0.5px_1px_rgba(0,0,0,0.2)] outline-none transition-colors hover:bg-[#ff6b63] active:bg-[#e54840] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
          style={fallbackButtonStyle}
          onClick={handleClose}
        >
          <span
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-hover/window-control-button:opacity-100"
            aria-hidden="true"
          >
            <span className="absolute left-1/2 top-1/2 h-px w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-[rgba(105,17,14,0.76)]" />
            <span className="absolute left-1/2 top-1/2 h-px w-[7px] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-[rgba(105,17,14,0.76)]" />
          </span>
        </button>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          className="group/window-control-button relative shrink-0 rounded-full border border-[#dea123] bg-[#febc2e] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.42),0_0.5px_1px_rgba(0,0,0,0.2)] outline-none transition-colors hover:bg-[#ffc847] active:bg-[#e5a823] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
          style={fallbackButtonStyle}
          onClick={handleMinimize}
        >
          <span
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-hover/window-control-button:opacity-100"
            aria-hidden="true"
          >
            <span className="absolute left-1/2 top-1/2 h-px w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(126,80,3,0.78)]" />
          </span>
        </button>
        <button
          type="button"
          aria-label="Full Screen"
          title="Full Screen"
          className="group/window-control-button relative shrink-0 rounded-full border border-[#20aa35] bg-[#28c840] shadow-[inset_0_0.5px_0_rgba(255,255,255,0.42),0_0.5px_1px_rgba(0,0,0,0.2)] outline-none transition-colors hover:bg-[#32d74b] active:bg-[#22b838] focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
          style={fallbackButtonStyle}
          onClick={handleFullscreen}
        >
          <span
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-hover/window-control-button:opacity-100"
            aria-hidden="true"
          >
            <span className="absolute left-[3px] top-[3px] h-px w-[5px] rotate-45 rounded-full bg-[rgba(13,83,26,0.8)]" />
            <span className="absolute left-[3px] top-[3px] h-[5px] w-px rotate-45 rounded-full bg-[rgba(13,83,26,0.8)]" />
            <span className="absolute bottom-[3px] right-[3px] h-px w-[5px] rotate-45 rounded-full bg-[rgba(13,83,26,0.8)]" />
            <span className="absolute bottom-[3px] right-[3px] h-[5px] w-px rotate-45 rounded-full bg-[rgba(13,83,26,0.8)]" />
          </span>
        </button>
      </div>
    </div>
  );
};
