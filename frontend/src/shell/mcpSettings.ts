export interface MCPSettings {
  version: number;
  enabled: boolean;
  approvalRequired: boolean;
  defaultApprovalTtlSeconds: number;
  disabledTools: string[];
}

export interface MCPToolSettingsEntry {
  name: string;
  description: string;
  group: string;
  enabled: boolean;
  effectiveEnabled: boolean;
}

export interface MCPSettingsStatus {
  settings: MCPSettings;
  tools: MCPToolSettingsEntry[];
  diskPath: string;
  bridgeRunning: boolean;
  approvalCodeConfigured: boolean;
  approvalRequiredEnvOverride: boolean;
}

interface RuntimeCallModule {
  Call?: {
    ByName?: (methodName: string, ...args: unknown[]) => Promise<unknown>;
  };
}

const methodNames = {
  get: ["main.App.GetMCPSettings", "arlecchino.App.GetMCPSettings"],
  save: ["main.App.SaveMCPSettings", "arlecchino.App.SaveMCPSettings"],
} as const;

type MethodKey = keyof typeof methodNames;

const cachedMethodNames: Partial<Record<MethodKey, string>> = {};

const DEFAULT_MCP_SETTINGS: MCPSettings = {
  version: 1,
  enabled: true,
  approvalRequired: true,
  defaultApprovalTtlSeconds: 300,
  disabledTools: [],
};

const DEFAULT_MCP_STATUS: MCPSettingsStatus = {
  settings: DEFAULT_MCP_SETTINGS,
  tools: [],
  diskPath: "",
  bridgeRunning: false,
  approvalCodeConfigured: false,
  approvalRequiredEnvOverride: false,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRecordValue = (
  record: Record<string, unknown>,
  camelKey: string,
  pascalKey: string,
): unknown =>
  Object.prototype.hasOwnProperty.call(record, camelKey)
    ? record[camelKey]
    : record[pascalKey];

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const readNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const readString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const readStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

export const normalizeMCPSettingsPayload = (payload: unknown): MCPSettings => {
  if (!isRecord(payload)) {
    return { ...DEFAULT_MCP_SETTINGS };
  }
  const defaultTtl = readNumber(
    getRecordValue(
      payload,
      "defaultApprovalTtlSeconds",
      "DefaultApprovalTTLSeconds",
    ),
    DEFAULT_MCP_SETTINGS.defaultApprovalTtlSeconds,
  );
  return {
    version: readNumber(
      getRecordValue(payload, "version", "Version"),
      DEFAULT_MCP_SETTINGS.version,
    ),
    enabled: readBoolean(
      getRecordValue(payload, "enabled", "Enabled"),
      DEFAULT_MCP_SETTINGS.enabled,
    ),
    approvalRequired: readBoolean(
      getRecordValue(payload, "approvalRequired", "ApprovalRequired"),
      DEFAULT_MCP_SETTINGS.approvalRequired,
    ),
    defaultApprovalTtlSeconds: Math.min(
      Math.max(Math.round(defaultTtl), 60),
      3600,
    ),
    disabledTools: Array.from(
      new Set(
        readStringArray(
          getRecordValue(payload, "disabledTools", "DisabledTools"),
        ),
      ),
    ).sort(),
  };
};

const normalizeMCPToolSettingsEntry = (
  payload: unknown,
): MCPToolSettingsEntry | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const name = readString(getRecordValue(payload, "name", "Name"));
  if (!name) {
    return null;
  }
  return {
    name,
    description: readString(
      getRecordValue(payload, "description", "Description"),
    ),
    group: readString(getRecordValue(payload, "group", "Group")) || "Other",
    enabled: readBoolean(getRecordValue(payload, "enabled", "Enabled"), true),
    effectiveEnabled: readBoolean(
      getRecordValue(payload, "effectiveEnabled", "EffectiveEnabled"),
      true,
    ),
  };
};

export const normalizeMCPSettingsStatusPayload = (
  payload: unknown,
): MCPSettingsStatus => {
  if (!isRecord(payload)) {
    return { ...DEFAULT_MCP_STATUS, settings: { ...DEFAULT_MCP_SETTINGS } };
  }
  const toolsRaw = getRecordValue(payload, "tools", "Tools");
  return {
    settings: normalizeMCPSettingsPayload(
      getRecordValue(payload, "settings", "Settings"),
    ),
    tools: Array.isArray(toolsRaw)
      ? toolsRaw.flatMap((item) => {
          const entry = normalizeMCPToolSettingsEntry(item);
          return entry ? [entry] : [];
        })
      : [],
    diskPath: readString(getRecordValue(payload, "diskPath", "DiskPath")),
    bridgeRunning: readBoolean(
      getRecordValue(payload, "bridgeRunning", "BridgeRunning"),
      false,
    ),
    approvalCodeConfigured: readBoolean(
      getRecordValue(
        payload,
        "approvalCodeConfigured",
        "ApprovalCodeConfigured",
      ),
      false,
    ),
    approvalRequiredEnvOverride: readBoolean(
      getRecordValue(
        payload,
        "approvalRequiredEnvOverride",
        "ApprovalRequiredEnvOverride",
      ),
      false,
    ),
  };
};

const loadRuntimeModule = async (): Promise<RuntimeCallModule | undefined> => {
  try {
    return (await import("/wails/runtime.js")) as RuntimeCallModule;
  } catch {
    return undefined;
  }
};

const callByKnownName = async (
  key: MethodKey,
  ...args: unknown[]
): Promise<unknown | undefined> => {
  const runtimeModule = await loadRuntimeModule();
  const callByName = runtimeModule?.Call?.ByName;
  if (!callByName) {
    return undefined;
  }

  const cachedName = cachedMethodNames[key];
  if (cachedName) {
    try {
      return await callByName(cachedName, ...args);
    } catch {
      delete cachedMethodNames[key];
    }
  }

  for (const methodName of methodNames[key]) {
    try {
      const payload = await callByName(methodName, ...args);
      cachedMethodNames[key] = methodName;
      return payload;
    } catch {
      // Try the next Wails service namespace.
    }
  }

  return undefined;
};

export async function getMCPSettings(): Promise<MCPSettingsStatus> {
  const payload = await callByKnownName("get");
  return normalizeMCPSettingsStatusPayload(payload);
}

export async function saveMCPSettings(
  settings: MCPSettings,
): Promise<MCPSettingsStatus> {
  const payload = await callByKnownName("save", settings);
  if (payload === undefined) {
    throw new Error("MCP settings bridge is unavailable.");
  }
  return normalizeMCPSettingsStatusPayload(payload);
}
