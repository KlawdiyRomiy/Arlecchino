import { canUseShellCapability } from "../shell/shellCapabilities";

type RuntimeClipboardReader = () => Promise<string>;
type RuntimeClipboardWriter = (text: string) => Promise<unknown>;
type NavigatorClipboardReader = () => Promise<string>;
type NavigatorClipboardWriter = (text: string) => Promise<boolean>;

interface ClipboardRuntimeModule {
  Clipboard?: {
    Text?: RuntimeClipboardReader;
    SetText?: RuntimeClipboardWriter;
  };
}

let clipboardRuntimeModulePromise:
  | Promise<ClipboardRuntimeModule | undefined>
  | undefined;

const loadClipboardRuntimeModule = (): Promise<
  ClipboardRuntimeModule | undefined
> => {
  clipboardRuntimeModulePromise ??= import("/wails/runtime.js")
    .then((runtimeModule) => runtimeModule as ClipboardRuntimeModule)
    .catch(() => undefined);
  return clipboardRuntimeModulePromise;
};

const loadRuntimeClipboardReader = async (): Promise<
  RuntimeClipboardReader | undefined
> => {
  const runtimeModule = await loadClipboardRuntimeModule();
  return runtimeModule?.Clipboard?.Text;
};

const loadRuntimeClipboardWriter = async (): Promise<
  RuntimeClipboardWriter | undefined
> => {
  const runtimeModule = await loadClipboardRuntimeModule();
  return runtimeModule?.Clipboard?.SetText;
};

const readFromNavigatorClipboard = async (): Promise<string> => {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.readText === "function"
  ) {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      console.error("[Clipboard] navigator.readText failed", error);
    }
  }

  return "";
};

const writeToNavigatorClipboard = async (text: string): Promise<boolean> => {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("[Clipboard] navigator.writeText failed", error);
    }
  }

  return false;
};

export const readClipboardTextWithFallback = async (
  readFromRuntime?: RuntimeClipboardReader,
  readFromNavigator: NavigatorClipboardReader = readFromNavigatorClipboard,
): Promise<string> => {
  if (canUseShellCapability("clipboard")) {
    const runtimeReader =
      readFromRuntime ?? (await loadRuntimeClipboardReader());
    try {
      if (runtimeReader) {
        const value = await runtimeReader();
        if (typeof value === "string") {
          return value;
        }
      }
    } catch (error) {
      console.error("[Clipboard] runtime read failed", error);
    }
  }

  return readFromNavigator();
};

export const writeClipboardTextWithFallback = async (
  text: string,
  writeToRuntime?: RuntimeClipboardWriter,
  writeToNavigator: NavigatorClipboardWriter = writeToNavigatorClipboard,
): Promise<boolean> => {
  if (canUseShellCapability("clipboard")) {
    const runtimeWriter =
      writeToRuntime ?? (await loadRuntimeClipboardWriter());
    try {
      if (runtimeWriter) {
        await runtimeWriter(text);
        return true;
      }
    } catch (error) {
      console.error("[Clipboard] runtime write failed", error);
    }
  }

  return writeToNavigator(text);
};
