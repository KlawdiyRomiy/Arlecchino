import type { EditorTab } from "../stores/editorStore";

export type ExecutionProfileKind = "terminal" | "preview";
export type ExecutionProfileMode = "run" | "debug";
export type ExecutionProfileOrigin = "auto" | "plugin" | "imported" | "user";

export interface ExecutionProfile {
  id: string;
  label: string;
  description: string;
  kind: ExecutionProfileKind;
  mode: ExecutionProfileMode;
  command: string;
  workingDirectory?: string;
  language?: string;
  framework?: string;
  origin?: ExecutionProfileOrigin;
  confidence?: number;
  requiredTools?: string[];
  missingTools?: string[];
  env?: Record<string, string>;
}

export interface ExecutionProfileSet {
  runProfiles: ExecutionProfile[];
  debugProfiles: ExecutionProfile[];
}

interface ResolveExecutionProfilesInput {
  projectPath?: string;
  activeTab?: EditorTab | null;
}

interface ExecutionProfilesRequest {
  projectPath: string;
  activeFilePath: string;
  activeFileName: string;
  activeFileContent: string;
  activeFileLanguage: string;
}

interface ExecutionAppBridge {
  GetExecutionProfiles?: (
    input: ExecutionProfilesRequest,
  ) => Promise<ExecutionProfileSet | null>;
}

const quotePath = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

const normalizePath = (value: string): string => value.replace(/\\/g, "/");

const getDirectoryPath = (filePath: string): string => {
  const normalized = normalizePath(filePath);
  const lastSlashIndex = normalized.lastIndexOf("/");
  return lastSlashIndex >= 0 ? normalized.slice(0, lastSlashIndex) : normalized;
};

const isHtmlFile = (filePath: string): boolean =>
  /\.(html?|xhtml)$/i.test(filePath);

const isGoMainFile = (filePath: string, content: string): boolean => {
  if (!/\/main\.go$/i.test(normalizePath(filePath))) {
    return false;
  }

  return (
    /(^|\n)package\s+main\b/.test(content) &&
    /(^|\n)func\s+main\s*\(/.test(content)
  );
};

const buildProfile = (
  mode: ExecutionProfileMode,
  profile: Omit<ExecutionProfile, "mode">,
): ExecutionProfile => ({
  ...profile,
  mode,
});

const getExecutionAppBridge = (): ExecutionAppBridge | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const maybeWindow = window as unknown as {
    go?: {
      main?: {
        App?: ExecutionAppBridge;
      };
    };
  };

  return maybeWindow.go?.main?.App ?? null;
};

const sanitizeProfile = (value: ExecutionProfile): ExecutionProfile | null => {
  if (!value.id || !value.label || !value.mode || !value.kind) {
    return null;
  }

  return {
    ...value,
    requiredTools: value.requiredTools ?? [],
    missingTools: value.missingTools ?? [],
    env: value.env ?? {},
  };
};

const normalizeProfileSet = (
  value: ExecutionProfileSet | null | undefined,
): ExecutionProfileSet | null => {
  if (!value) {
    return null;
  }

  const runProfiles = Array.isArray(value.runProfiles)
    ? value.runProfiles
        .map((profile) => sanitizeProfile(profile))
        .filter((profile): profile is ExecutionProfile => profile !== null)
    : [];

  const debugProfiles = Array.isArray(value.debugProfiles)
    ? value.debugProfiles
        .map((profile) => sanitizeProfile(profile))
        .filter((profile): profile is ExecutionProfile => profile !== null)
    : [];

  return { runProfiles, debugProfiles };
};

const resolveExecutionProfilesLocally = ({
  projectPath = "",
  activeTab,
}: ResolveExecutionProfilesInput): ExecutionProfileSet => {
  if (!activeTab) {
    return { runProfiles: [], debugProfiles: [] };
  }

  const filePath = normalizePath(activeTab.path);
  const fileName = activeTab.name || filePath.split("/").pop() || filePath;
  const directoryPath = getDirectoryPath(filePath);
  const workingDirectory = projectPath || directoryPath;

  if (isHtmlFile(filePath)) {
    return {
      runProfiles: [
        buildProfile("run", {
          id: `preview:${filePath}`,
          label: `Preview ${fileName}`,
          description: "Open the current file in browser preview",
          kind: "preview",
          command: "",
          workingDirectory,
          origin: "auto",
          confidence: 0.9,
        }),
      ],
      debugProfiles: [],
    };
  }

  if (isGoMainFile(filePath, activeTab.content)) {
    return {
      runProfiles: [
        buildProfile("run", {
          id: `go-run:${filePath}`,
          label: `Run ${fileName}`,
          description: "Run the current Go entrypoint",
          kind: "terminal",
          command: `go run ${quotePath(filePath)}`,
          workingDirectory: directoryPath,
          language: "go",
          origin: "auto",
          confidence: 0.95,
          requiredTools: ["go"],
        }),
      ],
      debugProfiles: [
        buildProfile("debug", {
          id: `go-debug:${directoryPath}`,
          label: `Debug ${fileName}`,
          description: "Start Delve for the current Go entrypoint",
          kind: "terminal",
          command: `dlv debug ${quotePath(directoryPath)}`,
          workingDirectory: directoryPath,
          language: "go",
          origin: "auto",
          confidence: 0.9,
          requiredTools: ["dlv"],
        }),
      ],
    };
  }

  return { runProfiles: [], debugProfiles: [] };
};

export async function resolveExecutionProfiles({
  projectPath = "",
  activeTab,
}: ResolveExecutionProfilesInput): Promise<ExecutionProfileSet> {
  const appBridge = getExecutionAppBridge();
  if (appBridge && typeof appBridge.GetExecutionProfiles === "function") {
    const request: ExecutionProfilesRequest = {
      projectPath,
      activeFilePath: activeTab?.path ?? "",
      activeFileName: activeTab?.name ?? "",
      activeFileContent: activeTab?.content ?? "",
      activeFileLanguage: activeTab?.language ?? "",
    };

    try {
      const resolved = await appBridge.GetExecutionProfiles(request);
      const normalized = normalizeProfileSet(resolved);
      if (normalized) {
        return normalized;
      }
    } catch {
      // local fallback below
    }
  }

  return resolveExecutionProfilesLocally({ projectPath, activeTab });
}
