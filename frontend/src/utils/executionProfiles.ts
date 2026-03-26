import type { EditorTab } from "../stores/editorStore";

export type ExecutionProfileKind = "terminal" | "preview";
export type ExecutionProfileMode = "run" | "debug";

export interface ExecutionProfile {
  id: string;
  label: string;
  description: string;
  kind: ExecutionProfileKind;
  mode: ExecutionProfileMode;
  command: string;
  workingDirectory?: string;
}

export interface ExecutionProfileSet {
  runProfiles: ExecutionProfile[];
  debugProfiles: ExecutionProfile[];
}

interface ResolveExecutionProfilesInput {
  projectPath?: string;
  activeTab?: EditorTab | null;
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

export function resolveExecutionProfiles({
  projectPath = "",
  activeTab,
}: ResolveExecutionProfilesInput): ExecutionProfileSet {
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
        }),
      ],
    };
  }

  return { runProfiles: [], debugProfiles: [] };
}
