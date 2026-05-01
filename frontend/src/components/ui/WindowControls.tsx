import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  width: "calc(76px * var(--ui-inverse-scale))",
  height: "calc(48px * var(--ui-inverse-scale))",
  transform: "translateY(calc(-2px * var(--ui-inverse-scale)))",
} as React.CSSProperties;

const nativeBackdropPortalStyle: React.CSSProperties = {
  position: "fixed",
  left: "11px",
  top: "12px",
  zIndex: 120,
  pointerEvents: "none",
};

const nativeBackdropBubbleStyle: React.CSSProperties = {
  width: "76px",
  height: "28px",
};

export const WindowControls: React.FC<WindowControlsProps> = ({
  visible = true,
}) => {
  const reserveNativeMacControls = shouldReserveNativeMacControls();
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const handleClose = useCallback(() => Quit(), []);
  const handleMinimize = useCallback(() => WindowMinimise(), []);
  const handleFullscreen = useCallback(() => {
    void toggleWindowFullscreen();
  }, []);

  useEffect(() => {
    if (!reserveNativeMacControls || typeof document === "undefined") {
      setPortalRoot(null);
      return;
    }

    setPortalRoot(document.body);
  }, [reserveNativeMacControls]);

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

  return (
    <>
      <div
        className="pointer-events-none shrink-0"
        style={nativeBackdropStyle}
        aria-hidden="true"
        data-testid="window-controls-native-spacer"
      />
      {portalRoot && visible
        ? createPortal(
            <div
              aria-hidden="true"
              data-testid="window-controls-native-backdrop"
              style={nativeBackdropPortalStyle}
            >
              <div
                className="shell-cluster"
                style={nativeBackdropBubbleStyle}
              />
            </div>,
            portalRoot,
          )
        : null}
    </>
  );
};
