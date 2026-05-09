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
  PositionNativeWindowControls?: (
    closeX: number,
    closeY: number,
    minimiseX: number,
    minimiseY: number,
    maximiseX: number,
    maximiseY: number,
  ) => Promise<boolean> | boolean;
}

interface ProjectWindowBridge {
  OpenProjectWindow?: (path: string) => Promise<unknown> | unknown;
  OpenProjectWindowSession?: (
    sessionId: string,
    path: string,
  ) => Promise<unknown> | unknown;
  GetProjectWindowSession?: (sessionId: string) => Promise<unknown> | unknown;
  GetCurrentProjectWindowSession?: () => Promise<unknown> | unknown;
}

interface ProjectEntryMoveBridge {
  MoveProjectEntry?: (
    path: string,
    targetDirectory: string,
  ) => Promise<unknown> | unknown;
}

interface FileDialogBridge {
  SelectOpenTarget?: (title: string) => Promise<unknown> | unknown;
}

export type SelectedOpenTargetIntent =
  | { kind: "openProject"; projectPath: string; source?: string }
  | { kind: "openFile"; path: string; line?: number; source?: string };

export interface ProjectWindowSessionPayload {
  sessionId: string;
  projectPath: string;
  windowName: string;
}

export interface ProjectEntryMoveResult {
  oldPath: string;
  newPath: string;
  isDirectory: boolean;
  lspWorkspaceFiles?: number;
  rewrittenFiles?: number;
  rewrittenImports?: number;
}

const nativeWindowControlsMethodNames = [
  "main.App.SetNativeWindowControlsVisible",
  "arlecchino.App.SetNativeWindowControlsVisible",
] as const;

const nativeWindowControlsPositionMethodNames = [
  "main.App.PositionNativeWindowControls",
  "arlecchino.App.PositionNativeWindowControls",
] as const;

const projectWindowMethodNames = [
  "main.App.OpenProjectWindow",
  "arlecchino.App.OpenProjectWindow",
] as const;

const projectWindowSessionMethodNames = [
  "main.App.GetProjectWindowSession",
  "arlecchino.App.GetProjectWindowSession",
] as const;

const openProjectWindowSessionMethodNames = [
  "main.App.OpenProjectWindowSession",
  "arlecchino.App.OpenProjectWindowSession",
] as const;

const currentProjectWindowSessionMethodNames = [
  "main.App.GetCurrentProjectWindowSession",
  "arlecchino.App.GetCurrentProjectWindowSession",
] as const;

const projectEntryMoveMethodNames = [
  "main.App.MoveProjectEntry",
  "arlecchino.App.MoveProjectEntry",
] as const;

const selectOpenTargetMethodNames = [
  "main.App.SelectOpenTarget",
  "arlecchino.App.SelectOpenTarget",
] as const;

let nativeWindowControlsMethodName:
  | (typeof nativeWindowControlsMethodNames)[number]
  | undefined;
let nativeWindowControlsPositionMethodName:
  | (typeof nativeWindowControlsPositionMethodNames)[number]
  | undefined;
let projectWindowMethodName:
  | (typeof projectWindowMethodNames)[number]
  | undefined;
let projectWindowSessionMethodName:
  | (typeof projectWindowSessionMethodNames)[number]
  | undefined;
let openProjectWindowSessionMethodName:
  | (typeof openProjectWindowSessionMethodNames)[number]
  | undefined;
let currentProjectWindowSessionMethodName:
  | (typeof currentProjectWindowSessionMethodNames)[number]
  | undefined;
let projectEntryMoveMethodName:
  | (typeof projectEntryMoveMethodNames)[number]
  | undefined;
let selectOpenTargetMethodName:
  | (typeof selectOpenTargetMethodNames)[number]
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

const getProjectEntryMoveBridge = (): ProjectEntryMoveBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: ProjectEntryMoveBridge } };
    }
  ).go?.main?.App;
};

const getFileDialogBridge = (): FileDialogBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: FileDialogBridge } };
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

export async function PositionNativeWindowControls(
  closeX: number,
  closeY: number,
  minimiseX: number,
  minimiseY: number,
  maximiseX: number,
  maximiseY: number,
): Promise<boolean> {
  const bridge = getNativeWindowControlsBridge();
  const args: [number, number, number, number, number, number] = [
    closeX,
    closeY,
    minimiseX,
    minimiseY,
    maximiseX,
    maximiseY,
  ];
  if (bridge?.PositionNativeWindowControls) {
    try {
      return Boolean(
        await Promise.resolve(bridge.PositionNativeWindowControls(...args)),
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

  if (nativeWindowControlsPositionMethodName) {
    try {
      return Boolean(
        await callByName(nativeWindowControlsPositionMethodName, ...args),
      );
    } catch {
      nativeWindowControlsPositionMethodName = undefined;
    }
  }

  for (const methodName of nativeWindowControlsPositionMethodNames) {
    try {
      const result = await callByName(methodName, ...args);
      nativeWindowControlsPositionMethodName = methodName;
      return Boolean(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return false;
}

const normalizeSelectedOpenTargetIntent = (
  payload: unknown,
): SelectedOpenTargetIntent | null => {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (typeof payload !== "object") {
    throw new Error("Invalid open target payload.");
  }

  const record = payload as Record<string, unknown>;
  if (record.kind === "openProject" && typeof record.projectPath === "string") {
    return {
      kind: "openProject",
      projectPath: record.projectPath,
      source: typeof record.source === "string" ? record.source : undefined,
    };
  }
  if (record.kind === "openFile" && typeof record.path === "string") {
    return {
      kind: "openFile",
      path: record.path,
      line: typeof record.line === "number" ? record.line : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
    };
  }

  throw new Error("Invalid open target payload.");
};

export async function SelectOpenTarget(
  title: string,
): Promise<SelectedOpenTargetIntent | null> {
  const bridge = getFileDialogBridge();
  if (bridge?.SelectOpenTarget) {
    try {
      return normalizeSelectedOpenTargetIntent(
        await Promise.resolve(bridge.SelectOpenTarget(title)),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    throw new Error("Open target dialog bridge is unavailable.");
  }

  if (selectOpenTargetMethodName) {
    try {
      return normalizeSelectedOpenTargetIntent(
        await callByName(selectOpenTargetMethodName, title),
      );
    } catch {
      selectOpenTargetMethodName = undefined;
    }
  }

  for (const methodName of selectOpenTargetMethodNames) {
    try {
      const result = await callByName(methodName, title);
      selectOpenTargetMethodName = methodName;
      return normalizeSelectedOpenTargetIntent(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  throw new Error("Open target dialog bridge is unavailable.");
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

const normalizeProjectWindowSessionPayload = (
  payload: unknown,
): ProjectWindowSessionPayload => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid project window session payload.");
  }
  const record = payload as Record<string, unknown>;
  const sessionId =
    typeof record.sessionId === "string" ? record.sessionId : "";
  const projectPath =
    typeof record.projectPath === "string" ? record.projectPath : "";
  const windowName =
    typeof record.windowName === "string" ? record.windowName : "";
  if (!sessionId || !projectPath) {
    throw new Error("Invalid project window session payload.");
  }
  return { sessionId, projectPath, windowName };
};

export async function GetProjectWindowSession(
  sessionId: string,
): Promise<ProjectWindowSessionPayload> {
  const bridge = getProjectWindowBridge();
  if (bridge?.GetProjectWindowSession) {
    try {
      return normalizeProjectWindowSessionPayload(
        await Promise.resolve(bridge.GetProjectWindowSession(sessionId)),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    throw new Error("Project window session bridge is unavailable.");
  }

  if (projectWindowSessionMethodName) {
    try {
      return normalizeProjectWindowSessionPayload(
        await callByName(projectWindowSessionMethodName, sessionId),
      );
    } catch {
      projectWindowSessionMethodName = undefined;
    }
  }

  for (const methodName of projectWindowSessionMethodNames) {
    try {
      const result = await callByName(methodName, sessionId);
      projectWindowSessionMethodName = methodName;
      return normalizeProjectWindowSessionPayload(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  throw new Error("Project window session bridge is unavailable.");
}

export async function OpenProjectWindowSession(
  sessionId: string,
  path: string,
): Promise<boolean> {
  const bridge = getProjectWindowBridge();
  if (bridge?.OpenProjectWindowSession) {
    try {
      await Promise.resolve(bridge.OpenProjectWindowSession(sessionId, path));
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

  if (openProjectWindowSessionMethodName) {
    try {
      await callByName(openProjectWindowSessionMethodName, sessionId, path);
      return true;
    } catch {
      openProjectWindowSessionMethodName = undefined;
    }
  }

  for (const methodName of openProjectWindowSessionMethodNames) {
    try {
      await callByName(methodName, sessionId, path);
      openProjectWindowSessionMethodName = methodName;
      return true;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return false;
}

export async function GetCurrentProjectWindowSession(): Promise<ProjectWindowSessionPayload | null> {
  const bridge = getProjectWindowBridge();
  if (bridge?.GetCurrentProjectWindowSession) {
    try {
      return normalizeProjectWindowSessionPayload(
        await Promise.resolve(bridge.GetCurrentProjectWindowSession()),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    return null;
  }

  if (currentProjectWindowSessionMethodName) {
    try {
      return normalizeProjectWindowSessionPayload(
        await callByName(currentProjectWindowSessionMethodName),
      );
    } catch {
      currentProjectWindowSessionMethodName = undefined;
    }
  }

  for (const methodName of currentProjectWindowSessionMethodNames) {
    try {
      const result = await callByName(methodName);
      currentProjectWindowSessionMethodName = methodName;
      return normalizeProjectWindowSessionPayload(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return null;
}

export async function MoveProjectEntry(
  path: string,
  targetDirectory: string,
): Promise<ProjectEntryMoveResult> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.MoveProjectEntry) {
    try {
      return (await Promise.resolve(
        bridge.MoveProjectEntry(path, targetDirectory),
      )) as ProjectEntryMoveResult;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    throw new Error("Project entry move bridge is unavailable.");
  }

  if (projectEntryMoveMethodName) {
    try {
      return (await callByName(
        projectEntryMoveMethodName,
        path,
        targetDirectory,
      )) as ProjectEntryMoveResult;
    } catch {
      projectEntryMoveMethodName = undefined;
    }
  }

  for (const methodName of projectEntryMoveMethodNames) {
    try {
      const result = await callByName(methodName, path, targetDirectory);
      projectEntryMoveMethodName = methodName;
      return result as ProjectEntryMoveResult;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  throw new Error("Project entry move bridge is unavailable.");
}
