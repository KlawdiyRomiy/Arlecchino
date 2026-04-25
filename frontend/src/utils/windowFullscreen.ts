import {
  WindowFullscreen,
  WindowIsFullscreen,
  WindowUnfullscreen,
} from "../../wailsjs/runtime/runtime";

interface NativeFullscreenBridge {
  ToggleNativeFullscreen?: () => Promise<void> | void;
}

interface WailsWindow {
  go?: {
    main?: {
      App?: NativeFullscreenBridge;
    };
  };
}

export const toggleWindowFullscreen = async (): Promise<void> => {
  const toggleNativeFullscreen = (window as WailsWindow).go?.main?.App
    ?.ToggleNativeFullscreen;
  if (toggleNativeFullscreen) {
    await Promise.resolve(toggleNativeFullscreen());
    return;
  }

  const isFullscreen = await WindowIsFullscreen();
  if (isFullscreen) {
    WindowUnfullscreen();
    return;
  }

  WindowFullscreen();
};
