export * from "../../bindings/arlecchino/app";

interface NativeWindowControlsRuntimeModule {
  Call?: {
    ByName?: <T = unknown>(
      methodName: string,
      ...args: unknown[]
    ) => Promise<T>;
  };
}

interface NativeWindowControlsBridge {
  SetNativeWindowControlsVisible?: (
    visible: boolean,
  ) => Promise<boolean> | boolean;
}

const nativeWindowControlsMethodNames = [
  "main.App.SetNativeWindowControlsVisible",
  "arlecchino.App.SetNativeWindowControlsVisible",
] as const;

let nativeWindowControlsMethodName:
  | (typeof nativeWindowControlsMethodNames)[number]
  | undefined;

const getNativeWindowControlsBridge = ():
  | NativeWindowControlsBridge
  | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: NativeWindowControlsBridge } };
    }
  ).go?.main?.App;
};

export async function SetNativeWindowControlsVisible(
  visible: boolean,
): Promise<boolean> {
  const bridge = getNativeWindowControlsBridge();
  if (bridge?.SetNativeWindowControlsVisible) {
    try {
      return Boolean(
        await Promise.resolve(bridge.SetNativeWindowControlsVisible(visible)),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  let runtimeModule: NativeWindowControlsRuntimeModule;
  try {
    runtimeModule =
      (await import("/wails/runtime.js")) as NativeWindowControlsRuntimeModule;
  } catch {
    return false;
  }

  const callByName = runtimeModule.Call?.ByName;
  if (!callByName) {
    return false;
  }

  if (nativeWindowControlsMethodName) {
    try {
      return Boolean(await callByName(nativeWindowControlsMethodName, visible));
    } catch {
      nativeWindowControlsMethodName = undefined;
    }
  }

  for (const methodName of nativeWindowControlsMethodNames) {
    try {
      const result = await callByName(methodName, visible);
      nativeWindowControlsMethodName = methodName;
      return Boolean(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return false;
}
