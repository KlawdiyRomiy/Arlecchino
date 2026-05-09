import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PositionNativeWindowControls } from "../../wails/app";
import { Quit, WindowMinimise } from "../../wails/runtime";
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
}

interface NativeBackdropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const isMacPlatform = (): boolean => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform || navigator.platform;
  return /mac/i.test(platform) || /mac os x/i.test(navigator.userAgent);
};

const shouldReserveNativeMacControls = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const wailsOS = (window as WailsWindow)._wails?.environment?.OS;
  if (wailsOS) {
    return wailsOS === "darwin";
  }

  return isMacPlatform();
};

const nativeBackdropStyle = {
  "--wails-draggable": "no-drag",
  width: "calc(84px * var(--ui-inverse-scale))",
  height: "calc(48px * var(--ui-inverse-scale))",
  transform: "translateY(calc(-2px * var(--ui-inverse-scale)))",
  display: "flex",
  alignItems: "center",
} as React.CSSProperties;

const nativeBackdropBubbleStyle: React.CSSProperties = {
  position: "relative",
  width: "calc(84px * var(--ui-inverse-scale))",
  height: "calc(28px * var(--ui-inverse-scale))",
};

const nativeBackdropPortalBubbleStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
};

const nativeBackdropMeasurementStyle: React.CSSProperties = {
  ...nativeBackdropBubbleStyle,
  visibility: "hidden",
};

const nativeButtonTargetsStyle: React.CSSProperties = {
  position: "absolute",
  left: "calc(12px * var(--ui-inverse-scale))",
  top: "50%",
  display: "flex",
  alignItems: "center",
  gap: "calc(10px * var(--ui-inverse-scale))",
  transform: "translateY(-50%)",
};

const nativeButtonTargetStyle: React.CSSProperties = {
  width: "calc(13px * var(--ui-inverse-scale))",
  height: "calc(13px * var(--ui-inverse-scale))",
  borderRadius: "9999px",
  opacity: 0,
};

const areNativeBackdropRectsEqual = (
  a: NativeBackdropRect | null,
  b: NativeBackdropRect,
) => {
  if (!a) {
    return false;
  }

  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
};

const buildNativeBackdropPortalStyle = (
  rect: NativeBackdropRect,
): React.CSSProperties => ({
  position: "fixed",
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
  zIndex: 120,
  pointerEvents: "none",
});

export const WindowControls: React.FC<WindowControlsProps> = ({
  visible = true,
  backdropVisible = true,
}) => {
  const reserveNativeMacControls = shouldReserveNativeMacControls();
  const placeholderRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLSpanElement>(null);
  const minimizeRef = useRef<HTMLSpanElement>(null);
  const fullscreenRef = useRef<HTMLSpanElement>(null);
  const [nativeBackdropRect, setNativeBackdropRect] =
    useState<NativeBackdropRect | null>(null);
  const handleClose = useCallback(() => Quit(), []);
  const handleMinimize = useCallback(() => WindowMinimise(), []);
  const handleFullscreen = useCallback(() => {
    void toggleWindowFullscreen();
  }, []);

  const positionNativeControls = useCallback(() => {
    if (!visible) {
      return;
    }

    const closeRect = closeRef.current?.getBoundingClientRect();
    const minimizeRect = minimizeRef.current?.getBoundingClientRect();
    const fullscreenRect = fullscreenRef.current?.getBoundingClientRect();
    const backdropRect = backdropRef.current?.getBoundingClientRect();

    if (!closeRect || !minimizeRect || !fullscreenRect) {
      return;
    }

    if (backdropRect) {
      const nextBackdropRect = {
        left: backdropRect.left,
        top: backdropRect.top,
        width: backdropRect.width,
        height: backdropRect.height,
      };
      setNativeBackdropRect((current) =>
        areNativeBackdropRectsEqual(current, nextBackdropRect)
          ? current
          : nextBackdropRect,
      );
    }

    void PositionNativeWindowControls(
      closeRect.left + closeRect.width / 2,
      closeRect.top + closeRect.height / 2,
      minimizeRect.left + minimizeRect.width / 2,
      minimizeRect.top + minimizeRect.height / 2,
      fullscreenRect.left + fullscreenRect.width / 2,
      fullscreenRect.top + fullscreenRect.height / 2,
    ).catch(() => undefined);
  }, [visible]);

  useLayoutEffect(() => {
    if (!reserveNativeMacControls || !visible) {
      return;
    }

    let animationFrame = 0;
    const schedulePosition = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(positionNativeControls);
    };

    schedulePosition();
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
      retryTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", schedulePosition);
      resizeObserver?.disconnect();
    };
  }, [positionNativeControls, reserveNativeMacControls, visible]);

  if (!reserveNativeMacControls) {
    return (
      <div
        className="ml-1 flex h-full -translate-y-[2px] items-center"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
        data-testid="window-controls-fallback"
      >
        <div className="shell-cluster px-2.5 py-1.5">
          <button
            onClick={handleClose}
            className="h-[13px] w-[13px] rounded-full bg-[#595959] transition-colors hover:bg-[#ff5f57]"
            title="Close"
          />
          <button
            onClick={handleMinimize}
            className="h-[13px] w-[13px] rounded-full bg-[#4f4f4f] transition-colors hover:bg-[#febc2e]"
            title="Minimize"
          />
          <button
            onClick={handleFullscreen}
            className="h-[13px] w-[13px] rounded-full bg-[#474747] transition-colors hover:bg-[#28c840]"
            title="Full Screen"
          />
        </div>
      </div>
    );
  }

  const portalRoot =
    typeof document === "undefined" || !visible || !backdropVisible
      ? null
      : document.body;

  return (
    <>
      <div
        ref={placeholderRef}
        className="pointer-events-none shrink-0"
        style={nativeBackdropStyle}
        aria-hidden="true"
        data-testid="window-controls-native-spacer"
      >
        {visible ? (
          <div
            ref={backdropRef}
            className="shell-cluster"
            aria-hidden="true"
            style={nativeBackdropMeasurementStyle}
          >
            <div style={nativeButtonTargetsStyle}>
              <span ref={closeRef} style={nativeButtonTargetStyle} />
              <span ref={minimizeRef} style={nativeButtonTargetStyle} />
              <span ref={fullscreenRef} style={nativeButtonTargetStyle} />
            </div>
          </div>
        ) : null}
      </div>
      {portalRoot && nativeBackdropRect
        ? createPortal(
            <div
              aria-hidden="true"
              data-testid="window-controls-native-backdrop"
              style={buildNativeBackdropPortalStyle(nativeBackdropRect)}
            >
              <div
                className="shell-cluster"
                style={nativeBackdropPortalBubbleStyle}
              />
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
};
