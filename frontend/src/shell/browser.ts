import { canUseShellCapability } from "./shellCapabilities";

type RuntimeBrowserOpener = (url: string) => Promise<unknown> | unknown;
type WindowBrowserOpener = (
  url: string,
  target: string,
  features: string,
) => unknown;

interface BrowserRuntimeModule {
  Browser?: {
    OpenURL?: RuntimeBrowserOpener;
  };
}

interface OpenExternalUrlOptions {
  openWithRuntime?: RuntimeBrowserOpener;
  openWithWindow?: WindowBrowserOpener;
  allowRuntimeOpen?: boolean;
}

const EXTERNAL_BROWSER_FEATURES = "noopener,noreferrer";

const normalizeExternalUrl = (url: string): string | null => {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
    return parsedUrl.toString();
  } catch {
    return null;
  }
};

const loadRuntimeBrowserOpener = async (): Promise<
  RuntimeBrowserOpener | undefined
> => {
  try {
    const runtimeModule =
      (await import("/wails/runtime.js")) as BrowserRuntimeModule;
    return runtimeModule.Browser?.OpenURL;
  } catch {
    return undefined;
  }
};

const getWindowBrowserOpener = (): WindowBrowserOpener | undefined => {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    return undefined;
  }

  return window.open.bind(window);
};

export const openExternalUrlWithCapability = async (
  url: string,
  options: OpenExternalUrlOptions = {},
): Promise<boolean> => {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) {
    return false;
  }

  const allowRuntimeOpen =
    options.allowRuntimeOpen ?? canUseShellCapability("browserOpenURL");
  if (allowRuntimeOpen) {
    const openWithRuntime =
      options.openWithRuntime ?? (await loadRuntimeBrowserOpener());
    if (openWithRuntime) {
      try {
        await Promise.resolve(openWithRuntime(normalizedUrl));
        return true;
      } catch (error) {
        console.error("[Browser] runtime OpenURL failed", error);
      }
    }
  }

  const openWithWindow = options.openWithWindow ?? getWindowBrowserOpener();
  if (!openWithWindow) {
    return false;
  }

  try {
    return (
      openWithWindow(normalizedUrl, "_blank", EXTERNAL_BROWSER_FEATURES) !==
      null
    );
  } catch (error) {
    console.error("[Browser] window.open failed", error);
    return false;
  }
};
