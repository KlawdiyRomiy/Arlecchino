import {
  PositionNativeWindowControls as generatedPositionNativeWindowControls,
  RefreshNativeWindowControls as generatedRefreshNativeWindowControls,
  SetNativeWindowControlsVisible as generatedSetNativeWindowControlsVisible,
} from "../../bindings/arlecchino/internal/app/app";

export * from "../../bindings/arlecchino/internal/app/app";

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
  SetNativeWindowControlsOccluded?: (
    occluded: boolean,
  ) => Promise<boolean> | boolean;
  PositionNativeWindowControls?: (
    closeX: number,
    closeY: number,
    minimiseX: number,
    minimiseY: number,
    maximiseX: number,
    maximiseY: number,
  ) => Promise<boolean> | boolean;
  RefreshNativeWindowControls?: () => Promise<boolean> | boolean;
}

export type ApplicationIconAppearance = "system" | "light" | "dark";

interface ApplicationIconBridge {
  SetApplicationIconAppearance?: (
    appearance: ApplicationIconAppearance,
  ) => Promise<boolean> | boolean;
}

interface CloseConfirmationBridge {
  SetCloseConfirmationEnabled?: (
    enabled: boolean,
  ) => Promise<boolean> | boolean;
  ConfirmApplicationClose?: () => Promise<boolean> | boolean;
  CancelApplicationClose?: () => Promise<boolean> | boolean;
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

interface RecentProjectIndexBridge {
  StartRecentProjectIndex?: (path: string) => Promise<unknown> | unknown;
  GetRecentProjectIndexStatuses?: (
    paths: string[],
  ) => Promise<unknown> | unknown;
  RemoveRecentProject?: (path: string) => Promise<unknown> | unknown;
  ClearRecentProjects?: () => Promise<unknown> | unknown;
  RevealPathInFileManager?: (path: string) => Promise<unknown> | unknown;
}

interface ProjectEntryMoveBridge {
  MoveProjectEntry?: (
    path: string,
    targetDirectory: string,
  ) => Promise<unknown> | unknown;
  CreateProjectEntry?: (
    request: ProjectEntryCreateRequest,
  ) => Promise<unknown> | unknown;
  RenameProjectEntryWithHistory?: (
    request: ProjectEntryRenameRequest,
  ) => Promise<unknown> | unknown;
  TrashProjectEntries?: (
    request: ProjectEntryTrashRequest,
  ) => Promise<unknown> | unknown;
  UndoProjectEntryOperation?: () => Promise<unknown> | unknown;
  RedoProjectEntryOperation?: () => Promise<unknown> | unknown;
  GetProjectEntryUndoState?: () => Promise<unknown> | unknown;
}

interface FileDialogBridge {
  SelectOpenTarget?: (title: string) => Promise<unknown> | unknown;
}

interface SystemFontsBridge {
  ListSystemFontFamilies?: () => Promise<unknown> | unknown;
}

export interface SystemFontFamilyInfo {
  family: string;
}

export interface AIProviderRuntimeModel {
  id: string;
  displayName: string;
  contextWindow?: number;
  path?: string;
  source: "active" | "installed" | "cloud" | string;
  active: boolean;
  runnable: boolean;
  reason?: string;
  reasoningEfforts?: string[];
  accountScoped?: boolean;
}

export interface AIProviderRuntimeDescriptor {
  providerId: string;
  kind: string;
  name: string;
  endpoint?: string;
  executablePath?: string;
  running: boolean;
  managed: boolean;
  pid?: number;
  status: "unavailable" | "stopped" | "starting" | "running" | string;
  reason?: string;
  activeModel?: string;
  models: AIProviderRuntimeModel[];
  logs?: string[];
}

export interface AIProviderRuntimeStartRequest {
  providerId: string;
  kind?: string;
  endpoint?: string;
  modelId?: string;
  modelPath?: string;
  contextSize?: number;
}

export interface AIProviderAuthSession {
  id: string;
  providerId: string;
  status:
    | "idle"
    | "opening"
    | "waiting"
    | "completed"
    | "failed"
    | "canceled"
    | "expired"
    | string;
  authorizationUrl?: string;
  startedAt?: string;
  expiresAt?: string;
  error?: string;
  authMode?: string;
}

export type AIPredictionMode = "off" | "subtle" | "eager";

export interface AIPredictionBudgetSettings {
  requestsPerMinute: number;
  tokensPerMinute: number;
  tokensPerDay: number;
  requestsPerFilePerMinute: number;
}

export interface AIPredictionSettings {
  enabled: boolean;
  mode: AIPredictionMode;
  providerId?: string;
  model?: string;
  idleMs: number;
  minIntervalMs: number;
  maxPending: number;
  maxOutputTokens: number;
  maxPromptBytes: number;
  budget: AIPredictionBudgetSettings;
}

export interface AIPredictionBudgetSnapshot {
  requestsThisMinute: number;
  tokensThisMinute: number;
  tokensToday: number;
  pendingRequests: number;
  minIntervalLeftMs?: number;
  cooldownUntil?: string;
  cooldownReason?: string;
  blockedReason?: string;
}

export interface AIConsentSummary {
  localProvidersAccepted: boolean;
  remoteProvidersAccepted: boolean;
  remoteByokProvidersAccepted?: boolean;
  frontierProvidersAccepted: boolean;
  externalAgentCliAccepted?: boolean;
  policySource?: string;
}

export interface AIProviderEnvelope {
  providerId?: string;
  kind?: string;
  endpointClass?: string;
  displayName?: string;
  model?: string;
  local?: boolean;
  frontier?: boolean;
  authConfigured?: boolean;
  billingMode?: string;
  legalBasis?: string;
  riskTier?: string;
  status?: string;
  reason?: string;
}

export interface AIPredictionStatus {
  enabled: boolean;
  settings: AIPredictionSettings;
  providerId?: string;
  model?: string;
  providerReady: boolean;
  providerReason?: string;
  provider?: AIProviderEnvelope | null;
  budget: AIPredictionBudgetSnapshot;
  consent: AIConsentSummary;
}

export type SelectedOpenTargetIntent =
  | { kind: "openProject"; projectPath: string; source?: string }
  | { kind: "openFile"; path: string; line?: number; source?: string };

export interface ProjectWindowSessionPayload {
  sessionId: string;
  projectPath: string;
  windowName: string;
}

export type RecentProjectIndexPhase =
  | "idle"
  | "indexing"
  | "complete"
  | "error"
  | string;

export interface RecentProjectIndexStatus {
  projectPath: string;
  phase: RecentProjectIndexPhase;
  current: number;
  total: number;
  percent: number;
  error?: string;
  updatedAt?: string;
}

export interface ProjectEntryMoveResult {
  oldPath: string;
  newPath: string;
  isDirectory: boolean;
  lspWorkspaceFiles?: number;
  rewrittenFiles?: number;
  rewrittenImports?: number;
}

export interface ProjectEntryCreateRequest {
  type: "file" | "folder";
  directoryPath: string;
  name: string;
}

export interface ProjectEntryCreateResult {
  path: string;
  isDirectory: boolean;
}

export interface ProjectEntryRenameRequest {
  path: string;
  newName: string;
}

export interface ProjectEntryTrashTarget {
  path: string;
  isDirectory: boolean;
  displayName?: string;
}

export interface ProjectEntryTrashRequest {
  entries: ProjectEntryTrashTarget[];
}

export interface ProjectEntryTrashResult {
  count: number;
}

export interface ProjectEntryUndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
}

const nativeWindowControlsMethodNames = [
  "arlecchino/internal/app.App.SetNativeWindowControlsVisible",
  "main.App.SetNativeWindowControlsVisible",
  "arlecchino.App.SetNativeWindowControlsVisible",
] as const;

const nativeWindowControlsOccludedMethodNames = [
  "arlecchino/internal/app.App.SetNativeWindowControlsOccluded",
  "main.App.SetNativeWindowControlsOccluded",
  "arlecchino.App.SetNativeWindowControlsOccluded",
] as const;

const nativeWindowControlsPositionMethodNames = [
  "arlecchino/internal/app.App.PositionNativeWindowControls",
  "main.App.PositionNativeWindowControls",
  "arlecchino.App.PositionNativeWindowControls",
] as const;

const nativeWindowControlsRefreshMethodNames = [
  "arlecchino/internal/app.App.RefreshNativeWindowControls",
  "main.App.RefreshNativeWindowControls",
  "arlecchino.App.RefreshNativeWindowControls",
] as const;

const applicationIconMethodNames = [
  "arlecchino/internal/app.App.SetApplicationIconAppearance",
  "main.App.SetApplicationIconAppearance",
  "arlecchino.App.SetApplicationIconAppearance",
] as const;

const setCloseConfirmationEnabledMethodNames = [
  "arlecchino/internal/app.App.SetCloseConfirmationEnabled",
  "main.App.SetCloseConfirmationEnabled",
  "arlecchino.App.SetCloseConfirmationEnabled",
] as const;

const confirmApplicationCloseMethodNames = [
  "arlecchino/internal/app.App.ConfirmApplicationClose",
  "main.App.ConfirmApplicationClose",
  "arlecchino.App.ConfirmApplicationClose",
] as const;

const cancelApplicationCloseMethodNames = [
  "arlecchino/internal/app.App.CancelApplicationClose",
  "main.App.CancelApplicationClose",
  "arlecchino.App.CancelApplicationClose",
] as const;

const projectWindowMethodNames = [
  "arlecchino/internal/app.App.OpenProjectWindow",
  "main.App.OpenProjectWindow",
  "arlecchino.App.OpenProjectWindow",
] as const;

const projectWindowSessionMethodNames = [
  "arlecchino/internal/app.App.GetProjectWindowSession",
  "main.App.GetProjectWindowSession",
  "arlecchino.App.GetProjectWindowSession",
] as const;

const openProjectWindowSessionMethodNames = [
  "arlecchino/internal/app.App.OpenProjectWindowSession",
  "main.App.OpenProjectWindowSession",
  "arlecchino.App.OpenProjectWindowSession",
] as const;

const currentProjectWindowSessionMethodNames = [
  "arlecchino/internal/app.App.GetCurrentProjectWindowSession",
  "main.App.GetCurrentProjectWindowSession",
  "arlecchino.App.GetCurrentProjectWindowSession",
] as const;

const startRecentProjectIndexMethodNames = [
  "arlecchino/internal/app.App.StartRecentProjectIndex",
  "main.App.StartRecentProjectIndex",
  "arlecchino.App.StartRecentProjectIndex",
] as const;

const recentProjectIndexStatusesMethodNames = [
  "arlecchino/internal/app.App.GetRecentProjectIndexStatuses",
  "main.App.GetRecentProjectIndexStatuses",
  "arlecchino.App.GetRecentProjectIndexStatuses",
] as const;

const removeRecentProjectMethodNames = [
  "arlecchino/internal/app.App.RemoveRecentProject",
  "main.App.RemoveRecentProject",
  "arlecchino.App.RemoveRecentProject",
] as const;

const clearRecentProjectsMethodNames = [
  "arlecchino/internal/app.App.ClearRecentProjects",
  "main.App.ClearRecentProjects",
  "arlecchino.App.ClearRecentProjects",
] as const;

const revealPathInFileManagerMethodNames = [
  "arlecchino/internal/app.App.RevealPathInFileManager",
  "main.App.RevealPathInFileManager",
  "arlecchino.App.RevealPathInFileManager",
] as const;

const projectEntryMoveMethodNames = [
  "arlecchino/internal/app.App.MoveProjectEntry",
  "main.App.MoveProjectEntry",
  "arlecchino.App.MoveProjectEntry",
] as const;

const createProjectEntryMethodNames = [
  "arlecchino/internal/app.App.CreateProjectEntry",
  "main.App.CreateProjectEntry",
  "arlecchino.App.CreateProjectEntry",
] as const;

const renameProjectEntryWithHistoryMethodNames = [
  "arlecchino/internal/app.App.RenameProjectEntryWithHistory",
  "main.App.RenameProjectEntryWithHistory",
  "arlecchino.App.RenameProjectEntryWithHistory",
] as const;

const trashProjectEntriesMethodNames = [
  "arlecchino/internal/app.App.TrashProjectEntries",
  "main.App.TrashProjectEntries",
  "arlecchino.App.TrashProjectEntries",
] as const;

const undoProjectEntryOperationMethodNames = [
  "arlecchino/internal/app.App.UndoProjectEntryOperation",
  "main.App.UndoProjectEntryOperation",
  "arlecchino.App.UndoProjectEntryOperation",
] as const;

const redoProjectEntryOperationMethodNames = [
  "arlecchino/internal/app.App.RedoProjectEntryOperation",
  "main.App.RedoProjectEntryOperation",
  "arlecchino.App.RedoProjectEntryOperation",
] as const;

const getProjectEntryUndoStateMethodNames = [
  "arlecchino/internal/app.App.GetProjectEntryUndoState",
  "main.App.GetProjectEntryUndoState",
  "arlecchino.App.GetProjectEntryUndoState",
] as const;

const selectOpenTargetMethodNames = [
  "arlecchino/internal/app.App.SelectOpenTarget",
  "main.App.SelectOpenTarget",
  "arlecchino.App.SelectOpenTarget",
] as const;

const listSystemFontFamiliesMethodNames = [
  "arlecchino/internal/app.App.ListSystemFontFamilies",
  "main.App.ListSystemFontFamilies",
  "arlecchino.App.ListSystemFontFamilies",
] as const;

const aiListProviderRuntimesMethodNames = [
  "arlecchino/internal/app.App.AIListProviderRuntimes",
  "main.App.AIListProviderRuntimes",
  "arlecchino.App.AIListProviderRuntimes",
] as const;

const aiStartProviderRuntimeMethodNames = [
  "arlecchino/internal/app.App.AIStartProviderRuntime",
  "main.App.AIStartProviderRuntime",
  "arlecchino.App.AIStartProviderRuntime",
] as const;

const aiStopProviderRuntimeMethodNames = [
  "arlecchino/internal/app.App.AIStopProviderRuntime",
  "main.App.AIStopProviderRuntime",
  "arlecchino.App.AIStopProviderRuntime",
] as const;

const aiStartProviderOAuthMethodNames = [
  "arlecchino/internal/app.App.AIStartProviderOAuth",
  "main.App.AIStartProviderOAuth",
  "arlecchino.App.AIStartProviderOAuth",
] as const;

const aiGetProviderAuthSessionMethodNames = [
  "arlecchino/internal/app.App.AIGetProviderAuthSession",
  "main.App.AIGetProviderAuthSession",
  "arlecchino.App.AIGetProviderAuthSession",
] as const;

const aiCancelProviderAuthMethodNames = [
  "arlecchino/internal/app.App.AICancelProviderAuth",
  "main.App.AICancelProviderAuth",
  "arlecchino.App.AICancelProviderAuth",
] as const;

const aiDeleteChatSessionMethodNames = [
  "arlecchino/internal/app.App.AIDeleteChatSession",
  "main.App.AIDeleteChatSession",
  "arlecchino.App.AIDeleteChatSession",
] as const;

const aiGetPredictionStatusMethodNames = [
  "arlecchino/internal/app.App.AIGetPredictionStatus",
  "main.App.AIGetPredictionStatus",
  "arlecchino.App.AIGetPredictionStatus",
] as const;

const aiSavePredictionSettingsMethodNames = [
  "arlecchino/internal/app.App.AISavePredictionSettings",
  "main.App.AISavePredictionSettings",
  "arlecchino.App.AISavePredictionSettings",
] as const;

let nativeWindowControlsMethodName:
  | (typeof nativeWindowControlsMethodNames)[number]
  | undefined;
let nativeWindowControlsOccludedMethodName:
  | (typeof nativeWindowControlsOccludedMethodNames)[number]
  | undefined;
let nativeWindowControlsPositionMethodName:
  | (typeof nativeWindowControlsPositionMethodNames)[number]
  | undefined;
let nativeWindowControlsRefreshMethodName:
  | (typeof nativeWindowControlsRefreshMethodNames)[number]
  | undefined;
let applicationIconMethodName:
  | (typeof applicationIconMethodNames)[number]
  | undefined;
let setCloseConfirmationEnabledMethodName:
  | (typeof setCloseConfirmationEnabledMethodNames)[number]
  | undefined;
let confirmApplicationCloseMethodName:
  | (typeof confirmApplicationCloseMethodNames)[number]
  | undefined;
let cancelApplicationCloseMethodName:
  | (typeof cancelApplicationCloseMethodNames)[number]
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
let startRecentProjectIndexMethodName:
  | (typeof startRecentProjectIndexMethodNames)[number]
  | undefined;
let recentProjectIndexStatusesMethodName:
  | (typeof recentProjectIndexStatusesMethodNames)[number]
  | undefined;
let removeRecentProjectMethodName:
  | (typeof removeRecentProjectMethodNames)[number]
  | undefined;
let clearRecentProjectsMethodName:
  | (typeof clearRecentProjectsMethodNames)[number]
  | undefined;
let revealPathInFileManagerMethodName:
  | (typeof revealPathInFileManagerMethodNames)[number]
  | undefined;
let projectEntryMoveMethodName:
  | (typeof projectEntryMoveMethodNames)[number]
  | undefined;
let createProjectEntryMethodName:
  | (typeof createProjectEntryMethodNames)[number]
  | undefined;
let renameProjectEntryWithHistoryMethodName:
  | (typeof renameProjectEntryWithHistoryMethodNames)[number]
  | undefined;
let trashProjectEntriesMethodName:
  | (typeof trashProjectEntriesMethodNames)[number]
  | undefined;
let undoProjectEntryOperationMethodName:
  | (typeof undoProjectEntryOperationMethodNames)[number]
  | undefined;
let redoProjectEntryOperationMethodName:
  | (typeof redoProjectEntryOperationMethodNames)[number]
  | undefined;
let getProjectEntryUndoStateMethodName:
  | (typeof getProjectEntryUndoStateMethodNames)[number]
  | undefined;
let selectOpenTargetMethodName:
  | (typeof selectOpenTargetMethodNames)[number]
  | undefined;
let listSystemFontFamiliesMethodName:
  | (typeof listSystemFontFamiliesMethodNames)[number]
  | undefined;
let aiListProviderRuntimesMethodName:
  | (typeof aiListProviderRuntimesMethodNames)[number]
  | undefined;
let aiStartProviderRuntimeMethodName:
  | (typeof aiStartProviderRuntimeMethodNames)[number]
  | undefined;
let aiStopProviderRuntimeMethodName:
  | (typeof aiStopProviderRuntimeMethodNames)[number]
  | undefined;
let aiStartProviderOAuthMethodName:
  | (typeof aiStartProviderOAuthMethodNames)[number]
  | undefined;
let aiGetProviderAuthSessionMethodName:
  | (typeof aiGetProviderAuthSessionMethodNames)[number]
  | undefined;
let aiCancelProviderAuthMethodName:
  | (typeof aiCancelProviderAuthMethodNames)[number]
  | undefined;
let aiDeleteChatSessionMethodName:
  | (typeof aiDeleteChatSessionMethodNames)[number]
  | undefined;
let aiGetPredictionStatusMethodName:
  | (typeof aiGetPredictionStatusMethodNames)[number]
  | undefined;
let aiSavePredictionSettingsMethodName:
  | (typeof aiSavePredictionSettingsMethodNames)[number]
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

const getApplicationIconBridge = (): ApplicationIconBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: ApplicationIconBridge } };
    }
  ).go?.main?.App;
};

const getCloseConfirmationBridge = (): CloseConfirmationBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: CloseConfirmationBridge } };
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

const getRecentProjectIndexBridge = ():
  | RecentProjectIndexBridge
  | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: RecentProjectIndexBridge } };
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

const getSystemFontsBridge = (): SystemFontsBridge | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (
    window as unknown as {
      go?: { main?: { App?: SystemFontsBridge } };
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

const callBooleanBridgeMethod = async <TMethodName extends string>(
  cachedMethodName: TMethodName | undefined,
  setCachedMethodName: (methodName: TMethodName | undefined) => void,
  methodNames: readonly TMethodName[],
  args: unknown[] = [],
): Promise<boolean> => {
  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    return false;
  }

  if (cachedMethodName) {
    try {
      return Boolean(await callByName(cachedMethodName, ...args));
    } catch {
      setCachedMethodName(undefined);
    }
  }

  for (const methodName of methodNames) {
    try {
      const result = await callByName(methodName, ...args);
      setCachedMethodName(methodName);
      return Boolean(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return false;
};

const callGeneratedBooleanBridgeMethod = async (
  call: () => Promise<boolean> | boolean,
): Promise<boolean | null> => {
  try {
    return Boolean(await Promise.resolve(call()));
  } catch {
    return null;
  }
};

const callRuntimeBridgeMethod = async <T>(
  cachedMethodName: string | undefined,
  setCachedMethodName: (methodName: string | undefined) => void,
  methodNames: readonly string[],
  args: unknown[] = [],
): Promise<T> => {
  const runtimeModule = await loadRuntimeCallModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    throw new Error("Wails runtime bridge is unavailable.");
  }

  if (cachedMethodName) {
    try {
      return (await callByName(cachedMethodName, ...args)) as T;
    } catch {
      setCachedMethodName(undefined);
    }
  }

  for (const methodName of methodNames) {
    try {
      const result = await callByName(methodName, ...args);
      setCachedMethodName(methodName);
      return result as T;
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  throw new Error("Wails runtime method is unavailable.");
};

export async function SetNativeWindowControlsVisible(
  visible: boolean,
): Promise<boolean> {
  const generatedResult = await callGeneratedBooleanBridgeMethod(() =>
    generatedSetNativeWindowControlsVisible(visible),
  );
  if (generatedResult !== null) {
    return generatedResult;
  }

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

export async function SetNativeWindowControlsOccluded(
  occluded: boolean,
): Promise<boolean> {
  const bridge = getNativeWindowControlsBridge();
  if (bridge?.SetNativeWindowControlsOccluded) {
    try {
      return Boolean(
        await Promise.resolve(bridge.SetNativeWindowControlsOccluded(occluded)),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callBooleanBridgeMethod(
    nativeWindowControlsOccludedMethodName,
    (methodName) => {
      nativeWindowControlsOccludedMethodName = methodName;
    },
    nativeWindowControlsOccludedMethodNames,
    [occluded],
  );
}

export async function PositionNativeWindowControls(
  closeX: number,
  closeY: number,
  minimiseX: number,
  minimiseY: number,
  maximiseX: number,
  maximiseY: number,
): Promise<boolean> {
  const args: [number, number, number, number, number, number] = [
    closeX,
    closeY,
    minimiseX,
    minimiseY,
    maximiseX,
    maximiseY,
  ];
  const generatedResult = await callGeneratedBooleanBridgeMethod(() =>
    generatedPositionNativeWindowControls(...args),
  );
  if (generatedResult !== null) {
    return generatedResult;
  }

  const bridge = getNativeWindowControlsBridge();
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

export async function RefreshNativeWindowControls(): Promise<boolean> {
  const generatedResult = await callGeneratedBooleanBridgeMethod(() =>
    generatedRefreshNativeWindowControls(),
  );
  if (generatedResult !== null) {
    return generatedResult;
  }

  const bridge = getNativeWindowControlsBridge();
  if (bridge?.RefreshNativeWindowControls) {
    try {
      return Boolean(
        await Promise.resolve(bridge.RefreshNativeWindowControls()),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callBooleanBridgeMethod(
    nativeWindowControlsRefreshMethodName,
    (methodName) => {
      nativeWindowControlsRefreshMethodName = methodName;
    },
    nativeWindowControlsRefreshMethodNames,
  );
}

export async function SetApplicationIconAppearance(
  appearance: ApplicationIconAppearance,
): Promise<boolean> {
  const bridge = getApplicationIconBridge();
  if (bridge?.SetApplicationIconAppearance) {
    try {
      return Boolean(
        await Promise.resolve(bridge.SetApplicationIconAppearance(appearance)),
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

  if (applicationIconMethodName) {
    try {
      return Boolean(await callByName(applicationIconMethodName, appearance));
    } catch {
      applicationIconMethodName = undefined;
    }
  }

  for (const methodName of applicationIconMethodNames) {
    try {
      const result = await callByName(methodName, appearance);
      applicationIconMethodName = methodName;
      return Boolean(result);
    } catch {
      // Try the next known Wails v3 service namespace.
    }
  }

  return false;
}

export async function SetCloseConfirmationEnabled(
  enabled: boolean,
): Promise<boolean> {
  const bridge = getCloseConfirmationBridge();
  if (bridge?.SetCloseConfirmationEnabled) {
    try {
      return Boolean(
        await Promise.resolve(bridge.SetCloseConfirmationEnabled(enabled)),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callBooleanBridgeMethod(
    setCloseConfirmationEnabledMethodName,
    (methodName) => {
      setCloseConfirmationEnabledMethodName = methodName;
    },
    setCloseConfirmationEnabledMethodNames,
    [enabled],
  );
}

export async function ConfirmApplicationClose(): Promise<boolean> {
  const bridge = getCloseConfirmationBridge();
  if (bridge?.ConfirmApplicationClose) {
    try {
      return Boolean(await Promise.resolve(bridge.ConfirmApplicationClose()));
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callBooleanBridgeMethod(
    confirmApplicationCloseMethodName,
    (methodName) => {
      confirmApplicationCloseMethodName = methodName;
    },
    confirmApplicationCloseMethodNames,
  );
}

export async function CancelApplicationClose(): Promise<boolean> {
  const bridge = getCloseConfirmationBridge();
  if (bridge?.CancelApplicationClose) {
    try {
      return Boolean(await Promise.resolve(bridge.CancelApplicationClose()));
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callBooleanBridgeMethod(
    cancelApplicationCloseMethodName,
    (methodName) => {
      cancelApplicationCloseMethodName = methodName;
    },
    cancelApplicationCloseMethodNames,
  );
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

const normalizeSystemFontFamilies = (payload: unknown): string[] => {
  if (!Array.isArray(payload)) {
    throw new Error("Invalid system font families payload.");
  }

  const seen = new Set<string>();
  const families: string[] = [];

  for (const entry of payload) {
    const family =
      typeof entry === "string"
        ? entry
        : entry &&
            typeof entry === "object" &&
            typeof (entry as SystemFontFamilyInfo).family === "string"
          ? (entry as SystemFontFamilyInfo).family
          : "";
    const normalized = family.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    families.push(normalized);
  }

  return families.sort((left, right) => left.localeCompare(right));
};

export async function ListSystemFontFamilies(): Promise<string[]> {
  const bridge = getSystemFontsBridge();
  if (bridge?.ListSystemFontFamilies) {
    try {
      return normalizeSystemFontFamilies(
        await Promise.resolve(bridge.ListSystemFontFamilies()),
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const payload = await callRuntimeBridgeMethod<unknown>(
    listSystemFontFamiliesMethodName,
    (methodName) => {
      listSystemFontFamiliesMethodName =
        methodName as (typeof listSystemFontFamiliesMethodNames)[number];
    },
    listSystemFontFamiliesMethodNames,
  );
  return normalizeSystemFontFamilies(payload);
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

const normalizeRecentProjectIndexStatus = (
  payload: unknown,
  fallbackPath = "",
): RecentProjectIndexStatus => {
  const source =
    payload && typeof payload === "object"
      ? (payload as Partial<RecentProjectIndexStatus>)
      : {};
  const projectPath =
    typeof source.projectPath === "string" && source.projectPath.trim()
      ? source.projectPath
      : fallbackPath;
  const phase =
    typeof source.phase === "string" && source.phase.trim()
      ? source.phase
      : "idle";
  const current =
    typeof source.current === "number" && Number.isFinite(source.current)
      ? Math.max(0, source.current)
      : 0;
  const total =
    typeof source.total === "number" && Number.isFinite(source.total)
      ? Math.max(0, source.total)
      : 0;
  const percent =
    typeof source.percent === "number" && Number.isFinite(source.percent)
      ? Math.max(0, Math.min(100, source.percent))
      : total > 0
        ? Math.max(0, Math.min(100, (current / total) * 100))
        : phase === "complete"
          ? 100
          : 0;
  const error =
    typeof source.error === "string" && source.error.trim()
      ? source.error
      : undefined;
  const updatedAt =
    typeof source.updatedAt === "string" && source.updatedAt.trim()
      ? source.updatedAt
      : undefined;

  return {
    projectPath,
    phase,
    current,
    total,
    percent,
    error,
    updatedAt,
  };
};

const normalizeRecentProjectIndexStatuses = (
  payload: unknown,
  paths: string[],
): RecentProjectIndexStatus[] => {
  if (!Array.isArray(payload)) {
    return paths.map((path) => normalizeRecentProjectIndexStatus(null, path));
  }
  return payload.map((entry, index) =>
    normalizeRecentProjectIndexStatus(entry, paths[index] ?? ""),
  );
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

export async function StartRecentProjectIndex(
  path: string,
): Promise<RecentProjectIndexStatus> {
  const bridge = getRecentProjectIndexBridge();
  if (bridge?.StartRecentProjectIndex) {
    try {
      return normalizeRecentProjectIndexStatus(
        await Promise.resolve(bridge.StartRecentProjectIndex(path)),
        path,
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const payload = await callRuntimeBridgeMethod<unknown>(
    startRecentProjectIndexMethodName,
    (methodName) => {
      startRecentProjectIndexMethodName =
        methodName as (typeof startRecentProjectIndexMethodNames)[number];
    },
    startRecentProjectIndexMethodNames,
    [path],
  );
  return normalizeRecentProjectIndexStatus(payload, path);
}

export async function GetRecentProjectIndexStatuses(
  paths: string[],
): Promise<RecentProjectIndexStatus[]> {
  const bridge = getRecentProjectIndexBridge();
  if (bridge?.GetRecentProjectIndexStatuses) {
    try {
      return normalizeRecentProjectIndexStatuses(
        await Promise.resolve(bridge.GetRecentProjectIndexStatuses(paths)),
        paths,
      );
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  const payload = await callRuntimeBridgeMethod<unknown>(
    recentProjectIndexStatusesMethodName,
    (methodName) => {
      recentProjectIndexStatusesMethodName =
        methodName as (typeof recentProjectIndexStatusesMethodNames)[number];
    },
    recentProjectIndexStatusesMethodNames,
    [paths],
  );
  return normalizeRecentProjectIndexStatuses(payload, paths);
}

export async function RemoveRecentProject(path: string): Promise<void> {
  const bridge = getRecentProjectIndexBridge();
  if (bridge?.RemoveRecentProject) {
    try {
      await Promise.resolve(bridge.RemoveRecentProject(path));
      return;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  await callRuntimeBridgeMethod<void>(
    removeRecentProjectMethodName,
    (methodName) => {
      removeRecentProjectMethodName =
        methodName as (typeof removeRecentProjectMethodNames)[number];
    },
    removeRecentProjectMethodNames,
    [path],
  );
}

export async function ClearRecentProjects(): Promise<void> {
  const bridge = getRecentProjectIndexBridge();
  if (bridge?.ClearRecentProjects) {
    try {
      await Promise.resolve(bridge.ClearRecentProjects());
      return;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  await callRuntimeBridgeMethod<void>(
    clearRecentProjectsMethodName,
    (methodName) => {
      clearRecentProjectsMethodName =
        methodName as (typeof clearRecentProjectsMethodNames)[number];
    },
    clearRecentProjectsMethodNames,
  );
}

export async function RevealPathInFileManager(path: string): Promise<void> {
  const bridge = getRecentProjectIndexBridge();
  if (bridge?.RevealPathInFileManager) {
    try {
      await Promise.resolve(bridge.RevealPathInFileManager(path));
      return;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  await callRuntimeBridgeMethod<void>(
    revealPathInFileManagerMethodName,
    (methodName) => {
      revealPathInFileManagerMethodName =
        methodName as (typeof revealPathInFileManagerMethodNames)[number];
    },
    revealPathInFileManagerMethodNames,
    [path],
  );
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

export async function CreateProjectEntry(
  request: ProjectEntryCreateRequest,
): Promise<ProjectEntryCreateResult> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.CreateProjectEntry) {
    try {
      return (await Promise.resolve(
        bridge.CreateProjectEntry(request),
      )) as ProjectEntryCreateResult;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callRuntimeBridgeMethod<ProjectEntryCreateResult>(
    createProjectEntryMethodName,
    (methodName) => {
      createProjectEntryMethodName =
        methodName as (typeof createProjectEntryMethodNames)[number];
    },
    createProjectEntryMethodNames,
    [request],
  );
}

export async function RenameProjectEntryWithHistory(
  request: ProjectEntryRenameRequest,
): Promise<{ newPath: string; isDirectory: boolean }> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.RenameProjectEntryWithHistory) {
    try {
      return (await Promise.resolve(
        bridge.RenameProjectEntryWithHistory(request),
      )) as { newPath: string; isDirectory: boolean };
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callRuntimeBridgeMethod<{ newPath: string; isDirectory: boolean }>(
    renameProjectEntryWithHistoryMethodName,
    (methodName) => {
      renameProjectEntryWithHistoryMethodName =
        methodName as (typeof renameProjectEntryWithHistoryMethodNames)[number];
    },
    renameProjectEntryWithHistoryMethodNames,
    [request],
  );
}

export async function TrashProjectEntries(
  request: ProjectEntryTrashRequest,
): Promise<ProjectEntryTrashResult> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.TrashProjectEntries) {
    try {
      return (await Promise.resolve(
        bridge.TrashProjectEntries(request),
      )) as ProjectEntryTrashResult;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callRuntimeBridgeMethod<ProjectEntryTrashResult>(
    trashProjectEntriesMethodName,
    (methodName) => {
      trashProjectEntriesMethodName =
        methodName as (typeof trashProjectEntriesMethodNames)[number];
    },
    trashProjectEntriesMethodNames,
    [request],
  );
}

export async function UndoProjectEntryOperation(): Promise<ProjectEntryUndoState> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.UndoProjectEntryOperation) {
    try {
      return (await Promise.resolve(
        bridge.UndoProjectEntryOperation(),
      )) as ProjectEntryUndoState;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callRuntimeBridgeMethod<ProjectEntryUndoState>(
    undoProjectEntryOperationMethodName,
    (methodName) => {
      undoProjectEntryOperationMethodName =
        methodName as (typeof undoProjectEntryOperationMethodNames)[number];
    },
    undoProjectEntryOperationMethodNames,
  );
}

export async function RedoProjectEntryOperation(): Promise<ProjectEntryUndoState> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.RedoProjectEntryOperation) {
    try {
      return (await Promise.resolve(
        bridge.RedoProjectEntryOperation(),
      )) as ProjectEntryUndoState;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callRuntimeBridgeMethod<ProjectEntryUndoState>(
    redoProjectEntryOperationMethodName,
    (methodName) => {
      redoProjectEntryOperationMethodName =
        methodName as (typeof redoProjectEntryOperationMethodNames)[number];
    },
    redoProjectEntryOperationMethodNames,
  );
}

export async function GetProjectEntryUndoState(): Promise<ProjectEntryUndoState> {
  const bridge = getProjectEntryMoveBridge();
  if (bridge?.GetProjectEntryUndoState) {
    try {
      return (await Promise.resolve(
        bridge.GetProjectEntryUndoState(),
      )) as ProjectEntryUndoState;
    } catch {
      // Fall back to Wails v3 runtime name lookup.
    }
  }

  return callRuntimeBridgeMethod<ProjectEntryUndoState>(
    getProjectEntryUndoStateMethodName,
    (methodName) => {
      getProjectEntryUndoStateMethodName =
        methodName as (typeof getProjectEntryUndoStateMethodNames)[number];
    },
    getProjectEntryUndoStateMethodNames,
  );
}

export async function AIListProviderRuntimes(): Promise<
  AIProviderRuntimeDescriptor[]
> {
  return callRuntimeBridgeMethod<AIProviderRuntimeDescriptor[]>(
    aiListProviderRuntimesMethodName,
    (methodName) => {
      aiListProviderRuntimesMethodName =
        methodName as (typeof aiListProviderRuntimesMethodNames)[number];
    },
    aiListProviderRuntimesMethodNames,
  );
}

export async function AIStartProviderRuntime(
  request: AIProviderRuntimeStartRequest,
): Promise<AIProviderRuntimeDescriptor> {
  return callRuntimeBridgeMethod<AIProviderRuntimeDescriptor>(
    aiStartProviderRuntimeMethodName,
    (methodName) => {
      aiStartProviderRuntimeMethodName =
        methodName as (typeof aiStartProviderRuntimeMethodNames)[number];
    },
    aiStartProviderRuntimeMethodNames,
    [request],
  );
}

export async function AIStopProviderRuntime(
  providerId: string,
): Promise<AIProviderRuntimeDescriptor> {
  return callRuntimeBridgeMethod<AIProviderRuntimeDescriptor>(
    aiStopProviderRuntimeMethodName,
    (methodName) => {
      aiStopProviderRuntimeMethodName =
        methodName as (typeof aiStopProviderRuntimeMethodNames)[number];
    },
    aiStopProviderRuntimeMethodNames,
    [providerId],
  );
}

export async function AIStartProviderOAuth(
  providerId: string,
): Promise<AIProviderAuthSession> {
  return callRuntimeBridgeMethod<AIProviderAuthSession>(
    aiStartProviderOAuthMethodName,
    (methodName) => {
      aiStartProviderOAuthMethodName =
        methodName as (typeof aiStartProviderOAuthMethodNames)[number];
    },
    aiStartProviderOAuthMethodNames,
    [providerId],
  );
}

export async function AIGetProviderAuthSession(
  sessionId: string,
): Promise<AIProviderAuthSession> {
  return callRuntimeBridgeMethod<AIProviderAuthSession>(
    aiGetProviderAuthSessionMethodName,
    (methodName) => {
      aiGetProviderAuthSessionMethodName =
        methodName as (typeof aiGetProviderAuthSessionMethodNames)[number];
    },
    aiGetProviderAuthSessionMethodNames,
    [sessionId],
  );
}

export async function AICancelProviderAuth(
  sessionId: string,
): Promise<AIProviderAuthSession> {
  return callRuntimeBridgeMethod<AIProviderAuthSession>(
    aiCancelProviderAuthMethodName,
    (methodName) => {
      aiCancelProviderAuthMethodName =
        methodName as (typeof aiCancelProviderAuthMethodNames)[number];
    },
    aiCancelProviderAuthMethodNames,
    [sessionId],
  );
}

export async function AIDeleteChatSession(sessionId: string): Promise<void> {
  await callRuntimeBridgeMethod<void>(
    aiDeleteChatSessionMethodName,
    (methodName) => {
      aiDeleteChatSessionMethodName =
        methodName as (typeof aiDeleteChatSessionMethodNames)[number];
    },
    aiDeleteChatSessionMethodNames,
    [sessionId],
  );
}

export async function AIGetPredictionStatus(): Promise<AIPredictionStatus> {
  return callRuntimeBridgeMethod<AIPredictionStatus>(
    aiGetPredictionStatusMethodName,
    (methodName) => {
      aiGetPredictionStatusMethodName =
        methodName as (typeof aiGetPredictionStatusMethodNames)[number];
    },
    aiGetPredictionStatusMethodNames,
  );
}

export async function AISavePredictionSettings(
  settings: AIPredictionSettings,
): Promise<AIPredictionStatus> {
  return callRuntimeBridgeMethod<AIPredictionStatus>(
    aiSavePredictionSettingsMethodName,
    (methodName) => {
      aiSavePredictionSettingsMethodName =
        methodName as (typeof aiSavePredictionSettingsMethodNames)[number];
    },
    aiSavePredictionSettingsMethodNames,
    [settings],
  );
}
