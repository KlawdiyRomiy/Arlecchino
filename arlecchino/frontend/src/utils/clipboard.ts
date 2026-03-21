type RuntimeClipboardReader = () => Promise<string>;
type RuntimeClipboardWriter = (text: string) => Promise<unknown>;

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
): Promise<string> => {
  if (readFromRuntime) {
    try {
      const value = await readFromRuntime();
      if (typeof value === "string") {
        return value;
      }
    } catch (error) {
      console.error("[Clipboard] runtime read failed", error);
    }
  }

  return readFromNavigatorClipboard();
};

export const writeClipboardTextWithFallback = async (
  text: string,
  writeToRuntime?: RuntimeClipboardWriter,
): Promise<boolean> => {
  if (writeToRuntime) {
    try {
      await writeToRuntime(text);
      return true;
    } catch (error) {
      console.error("[Clipboard] runtime write failed", error);
    }
  }

  return writeToNavigatorClipboard(text);
};
