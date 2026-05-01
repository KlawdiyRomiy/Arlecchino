export * from "../../bindings/arlecchino/app";

interface WailsRuntimeCallModule {
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

interface ProjectWindowBridge {
  OpenProjectWindow?: (path: string) => Promise<unknown> | unknown;
}

const nativeWindowControlsMethodNames = [
  "main.App.SetNativeWindowControlsVisible",
  "arlecchino.App.SetNativeWindowControlsVisible",
] as const;

const projectWindowMethodNames = [
  "main.App.OpenProjectWindow",
  "arlecchino.App.OpenProjectWindow",
] as const;

let nativeWindowControlsMethodName:
  | (typeof nativeWindowControlsMethodNames)[number]
  | undefined;
let projectWindowMethodName:
  | (typeof projectWindowMethodNames)[number]
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

const getProjectWindowBridge = (): ProjectWindowBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: ProjectWindowBridge } };
    }
  ).go?.main?.App;
};

const loadRuntimeCallModule =
  async (): Promise<WailsRuntimeCallModule | null> => {
    try {
      return (await import("/wails/runtime.js")) as WailsRuntimeCallModule;
    } catch {
      return null;
    }
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

  const runtimeModule = await loadRuntimeCallModule();
  if (!runtimeModule) {
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

export async function OpenProjectWindow(path: string): Promise<boolean> {
  const bridge = getProjectWindowBridge();
  if (bridge?.OpenProjectWindow) {
    try {
      await Promise.resolve(bridge.OpenProjectWindow(path));
      return true;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    return false;
  }

  if (projectWindowMethodName) {
    try {
      await callByName(projectWindowMethodName, path);
      return true;
    } catch {
      projectWindowMethodName = undefined;
    }
  }

  for (const methodName of projectWindowMethodNames) {
    try {
      await callByName(methodName, path);
      projectWindowMethodName = methodName;
      return true;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return false;
}
