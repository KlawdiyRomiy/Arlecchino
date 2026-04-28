import React, { useCallback, useLayoutEffect, useRef } from "react";
import { Call } from "/wails/runtime.js";
import { Quit, WindowMinimise } from "../../wails/runtime";
import { toggleWindowFullscreen } from "../../utils/windowFullscreen";

interface NativeWindowControlsBridge {
  PositionNativeWindowControls?: (
    closeX: number,
    closeY: number,
    minimiseX: number,
    minimiseY: number,
    maximiseX: number,
    maximiseY: number,
  ) => Promise<void> | void;
}

interface WailsWindow {
  _wails?: {
    environment?: {
      OS?: string;
    };
  };
  go?: {
    main?: {
      App?: NativeWindowControlsBridge;
    };
  };
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    platform?: string;
  };
}

const nativePositionMethodNames = [
  "arlecchino.App.PositionNativeWindowControls",
  "main.App.PositionNativeWindowControls",
] as const;

let nativePositionMethodName:
  | (typeof nativePositionMethodNames)[number]
  | undefined;

const getNativeWindowControlsBridge = ():
  | NativeWindowControlsBridge
  | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as WailsWindow).go?.main?.App;
};

const shouldUseNativeMacControls = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const wailsOS = (window as WailsWindow)._wails?.environment?.OS;
  if (wailsOS === "darwin") {
    return true;
  }

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform || navigator.platform;
  return /mac/i.test(platform) || /mac os x/i.test(navigator.userAgent);
};

const positionNativeWindowControls = async (
  closeX: number,
  closeY: number,
  minimiseX: number,
  minimiseY: number,
  maximiseX: number,
  maximiseY: number,
): Promise<void> => {
  const legacyPositionControls =
    getNativeWindowControlsBridge()?.PositionNativeWindowControls;
  if (legacyPositionControls) {
    await legacyPositionControls(
      closeX,
      closeY,
      minimiseX,
      minimiseY,
      maximiseX,
      maximiseY,
    );
    return;
  }

  const args = [closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY];
  if (nativePositionMethodName) {
    await Call.ByName(nativePositionMethodName, ...args);
    return;
  }

  let lastError: unknown;
  for (const methodName of nativePositionMethodNames) {
    try {
      await Call.ByName(methodName, ...args);
      nativePositionMethodName = methodName;
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

export const WindowControls: React.FC = () => {
  const handleClose = useCallback(() => Quit(), []);
  const handleMinimize = useCallback(() => WindowMinimise(), []);
  const handleFullscreen = useCallback(() => {
    void toggleWindowFullscreen();
  }, []);
  const useNativeMacControls = shouldUseNativeMacControls();
  const placeholderRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLSpanElement>(null);
  const minimizeRef = useRef<HTMLSpanElement>(null);
  const fullscreenRef = useRef<HTMLSpanElement>(null);

  const positionNativeControls = useCallback(() => {
    const closeRect = closeRef.current?.getBoundingClientRect();
    const minimizeRect = minimizeRef.current?.getBoundingClientRect();
    const fullscreenRect = fullscreenRef.current?.getBoundingClientRect();

    if (!closeRect || !minimizeRect || !fullscreenRect) {
      return;
    }

    void Promise.resolve(
      positionNativeWindowControls(
        closeRect.left + closeRect.width / 2,
        closeRect.top + closeRect.height / 2,
        minimizeRect.left + minimizeRect.width / 2,
        minimizeRect.top + minimizeRect.height / 2,
        fullscreenRect.left + fullscreenRect.width / 2,
        fullscreenRect.top + fullscreenRect.height / 2,
      ),
    ).catch((error) => {
      console.warn("Failed to position native window controls", error);
    });
  }, []);

  useLayoutEffect(() => {
    if (!useNativeMacControls) {
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
  }, [positionNativeControls, useNativeMacControls]);

  if (useNativeMacControls) {
    return (
      <div
        ref={placeholderRef}
        className="pointer-events-none ml-1 flex h-full -translate-y-[2px] items-center"
        style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
        aria-hidden="true"
      >
        <div className="shell-cluster px-2.5 py-1.5">
          <span
            ref={closeRef}
            className="block h-[13px] w-[13px] rounded-full opacity-0"
          />
          <span
            ref={minimizeRef}
            className="block h-[13px] w-[13px] rounded-full opacity-0"
          />
          <span
            ref={fullscreenRef}
            className="block h-[13px] w-[13px] rounded-full opacity-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="ml-1 flex h-full -translate-y-[2px] items-center"
      style={{ "--wails-draggable": "no-drag" } as React.CSSProperties}
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
};
