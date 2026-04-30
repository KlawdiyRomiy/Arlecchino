import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { EventsOn } from "../wails/runtime";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";

export type DiagnosticsSeverity = "error" | "warning" | "info";
export type DiagnosticsSeverityFilter = "all" | DiagnosticsSeverity;

export interface DiagnosticsPosition {
  line: number;
  character: number;
}

export interface DiagnosticsRange {
  start: DiagnosticsPosition;
  end: DiagnosticsPosition;
}

export interface DiagnosticsEventItem {
  range: DiagnosticsRange;
  severity: number;
  code?: string;
  source?: string;
  message: string;
}

export interface DiagnosticsEventPayload {
  uri?: string;
  filePath?: string;
  projectPath?: string;
  generation?: number;
  language?: string;
  items?: DiagnosticsEventItem[] | null;
}

export interface DiagnosticsSummary {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

export interface DiagnosticsProblem {
  id: string;
  filePath: string;
  language: string;
  range: DiagnosticsRange;
  severity: number;
  severityLabel: DiagnosticsSeverity;
  code: string;
  source: string;
  message: string;
  line: number;
  column: number;
}

export interface DiagnosticsFileGroup {
  filePath: string;
  fileName: string;
  language: string;
  items: DiagnosticsProblem[];
  summary: DiagnosticsSummary;
}

export interface DiagnosticsGroupOptions {
  severity?: DiagnosticsSeverityFilter;
  currentFileOnly?: boolean;
  currentFilePath?: string | null;
  projectPath?: string | null;
}

interface DiagnosticsState {
  byFile: Map<string, DiagnosticsFileGroup>;
  projectSummary: DiagnosticsSummary;
  activeProjectPath: string | null;
  currentGeneration: number;
  ingestDiagnosticsEvent: (event: DiagnosticsEventPayload) => void;
  setProjectScope: (projectPath: string | null, generation?: number) => void;
  setFileDiagnostics: (
    filePath: string,
    language: string,
    items: DiagnosticsEventItem[],
  ) => void;
  clearFileDiagnostics: (filePath: string) => void;
  renameFileDiagnostics: (oldPath: string, newPath: string) => void;
  renamePathDiagnostics: (oldPrefix: string, newPrefix: string) => void;
  prunePathDiagnostics: (pathPrefix: string) => void;
  reset: () => void;
  getProjectSummary: (projectPath?: string | null) => DiagnosticsSummary;
  getFileSummary: (filePath?: string | null) => DiagnosticsSummary;
  getProblemGroups: (
    options?: DiagnosticsGroupOptions,
  ) => DiagnosticsFileGroup[];
}

const emptySummary = (): DiagnosticsSummary => ({
  errors: 0,
  warnings: 0,
  infos: 0,
  total: 0,
});

const severityRank: Record<DiagnosticsSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const getSeverityLabel = (severity: number): DiagnosticsSeverity => {
  if (severity === 1) {
    return "error";
  }
  if (severity === 2) {
    return "warning";
  }
  return "info";
};

const getFileName = (filePath: string): string => {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
};

const summarizeProblems = (items: DiagnosticsProblem[]): DiagnosticsSummary => {
  const summary = emptySummary();

  for (const item of items) {
    if (item.severityLabel === "error") {
      summary.errors += 1;
    } else if (item.severityLabel === "warning") {
      summary.warnings += 1;
    } else {
      summary.infos += 1;
    }
  }

  summary.total = items.length;
  return summary;
};

const summarizeGroups = (
  groups: DiagnosticsFileGroup[],
): DiagnosticsSummary => {
  const summary = emptySummary();

  for (const group of groups) {
    summary.errors += group.summary.errors;
    summary.warnings += group.summary.warnings;
    summary.infos += group.summary.infos;
    summary.total += group.summary.total;
  }

  return summary;
};

const compareProblems = (
  left: DiagnosticsProblem,
  right: DiagnosticsProblem,
): number => {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  if (left.column !== right.column) {
    return left.column - right.column;
  }
  if (left.severityLabel !== right.severityLabel) {
    return severityRank[left.severityLabel] - severityRank[right.severityLabel];
  }
  return left.message.localeCompare(right.message);
};

const compareGroups = (
  left: DiagnosticsFileGroup,
  right: DiagnosticsFileGroup,
): number => {
  if (left.summary.errors !== right.summary.errors) {
    return right.summary.errors - left.summary.errors;
  }
  if (left.summary.warnings !== right.summary.warnings) {
    return right.summary.warnings - left.summary.warnings;
  }
  return left.filePath.localeCompare(right.filePath);
};

const resolveFilePath = ({
  filePath,
  uri,
}: DiagnosticsEventPayload): string => {
  if (typeof filePath === "string" && filePath !== "") {
    return filePath;
  }
  if (typeof uri !== "string" || uri === "") {
    return "";
  }

  if (!uri.startsWith("file://")) {
    return uri;
  }

  try {
    const parsed = new URL(uri);
    const pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname || uri.replace("file://", "");
  } catch {
    return decodeURIComponent(uri.replace("file://", ""));
  }
};

const normalizeProblems = (
  filePath: string,
  language: string,
  items: DiagnosticsEventItem[],
): DiagnosticsProblem[] => {
  const normalized = items.map((item) => {
    const severityLabel = getSeverityLabel(item.severity);
    const line = item.range.start.line + 1;
    const column = item.range.start.character + 1;
    const stableCode = item.code ?? "";

    return {
      id: `${filePath}:${line}:${column}:${stableCode}:${item.message}`,
      filePath,
      language,
      range: item.range,
      severity: item.severity,
      severityLabel,
      code: item.code ?? "",
      source: item.source ?? "",
      message: item.message,
      line,
      column,
    } satisfies DiagnosticsProblem;
  });

  normalized.sort(compareProblems);
  return normalized;
};

const createFileGroup = (
  filePath: string,
  language: string,
  items: DiagnosticsEventItem[],
): DiagnosticsFileGroup => {
  const normalizedItems = normalizeProblems(filePath, language, items);
  return {
    filePath,
    fileName: getFileName(filePath),
    language,
    items: normalizedItems,
    summary: summarizeProblems(normalizedItems),
  };
};

const remapFileGroup = (
  group: DiagnosticsFileGroup,
  oldPrefix: string,
  newPrefix: string,
): DiagnosticsFileGroup => {
  const nextFilePath =
    remapProjectPathPrefix(group.filePath, oldPrefix, newPrefix) ??
    group.filePath;

  if (nextFilePath === group.filePath) {
    return group;
  }

  const items = group.items.map((item) => ({
    ...item,
    id: `${nextFilePath}:${item.line}:${item.column}:${item.code}:${item.message}`,
    filePath: nextFilePath,
  }));

  return {
    ...group,
    filePath: nextFilePath,
    fileName: getProjectPathBasename(nextFilePath),
    items,
  };
};

const filterGroupItems = (
  group: DiagnosticsFileGroup,
  severity: DiagnosticsSeverityFilter,
): DiagnosticsProblem[] => {
  if (severity === "all") {
    return group.items;
  }
  return group.items.filter((item) => item.severityLabel === severity);
};

const matchesProjectPath = (filePath: string, projectPath?: string | null) => {
  if (!projectPath) {
    return true;
  }

  return (
    filePath === projectPath ||
    filePath.startsWith(`${projectPath}/`) ||
    filePath.startsWith(`${projectPath}\\`)
  );
};

const summarizeByFile = (
  byFile: Map<string, DiagnosticsFileGroup>,
  projectPath?: string | null,
): DiagnosticsSummary =>
  summarizeGroups(
    Array.from(byFile.values()).filter((group) =>
      matchesProjectPath(group.filePath, projectPath),
    ),
  );

const normalizeGeneration = (generation: number | undefined): number => {
  if (typeof generation !== "number" || !Number.isFinite(generation)) {
    return 0;
  }

  return generation > 0 ? Math.trunc(generation) : 0;
};

const hasWailsRuntimeEvents = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const runtimeWindow = window as typeof window & {
    runtime?: {
      EventsOnMultiple?: unknown;
    };
  };

  return typeof runtimeWindow.runtime?.EventsOnMultiple === "function";
};

let diagnosticsEventsBound = false;
let diagnosticsEventsBindTimer: number | null = null;
let diagnosticsEventsBoundWaiters: Array<() => void> = [];

const resolveDiagnosticsEventsBound = () => {
  if (diagnosticsEventsBoundWaiters.length === 0) {
    return;
  }

  const waiters = diagnosticsEventsBoundWaiters;
  diagnosticsEventsBoundWaiters = [];
  waiters.forEach((resolve) => resolve());
};

const scheduleDiagnosticsEventsBind = () => {
  if (
    diagnosticsEventsBound ||
    typeof window === "undefined" ||
    diagnosticsEventsBindTimer
  ) {
    return;
  }

  diagnosticsEventsBindTimer = window.setTimeout(() => {
    diagnosticsEventsBindTimer = null;
    bindDiagnosticsEvents();
  }, 50);
};

export const useDiagnosticsStore = create<DiagnosticsState>()(
  subscribeWithSelector((set, get) => ({
    byFile: new Map(),
    projectSummary: emptySummary(),
    activeProjectPath: null,
    currentGeneration: 0,

    setProjectScope: (projectPath, generation = 0) => {
      set((state) => ({
        activeProjectPath: projectPath,
        currentGeneration: normalizeGeneration(generation),
        projectSummary: summarizeByFile(state.byFile, projectPath),
      }));
    },

    ingestDiagnosticsEvent: (event) => {
      const filePath = resolveFilePath(event);
      if (filePath === "") {
        return;
      }

      const { activeProjectPath, currentGeneration } = get();
      const eventProjectPath =
        typeof event.projectPath === "string" && event.projectPath !== ""
          ? event.projectPath
          : null;
      const eventGeneration = normalizeGeneration(event.generation);

      if (
        activeProjectPath &&
        !matchesProjectPath(filePath, activeProjectPath)
      ) {
        return;
      }
      if (
        activeProjectPath &&
        eventProjectPath &&
        eventProjectPath !== activeProjectPath
      ) {
        return;
      }
      if (
        currentGeneration > 0 &&
        eventGeneration > 0 &&
        eventGeneration < currentGeneration
      ) {
        return;
      }
      if (
        activeProjectPath &&
        eventGeneration > 0 &&
        (currentGeneration === 0 || eventGeneration > currentGeneration)
      ) {
        get().setProjectScope(activeProjectPath, eventGeneration);
      }

      const items = Array.isArray(event.items) ? event.items : [];
      get().setFileDiagnostics(filePath, event.language ?? "", items);
    },

    setFileDiagnostics: (filePath, language, items) => {
      set((state) => {
        const next = new Map(state.byFile);
        if (items.length === 0) {
          next.delete(filePath);
          return {
            byFile: next,
            projectSummary: summarizeByFile(next, state.activeProjectPath),
          };
        }

        next.set(filePath, createFileGroup(filePath, language, items));
        return {
          byFile: next,
          projectSummary: summarizeByFile(next, state.activeProjectPath),
        };
      });
    },

    clearFileDiagnostics: (filePath) => {
      set((state) => {
        const next = new Map(state.byFile);
        next.delete(filePath);
        return {
          byFile: next,
          projectSummary: summarizeByFile(next, state.activeProjectPath),
        };
      });
    },

    renameFileDiagnostics: (oldPath, newPath) => {
      get().renamePathDiagnostics(oldPath, newPath);
    },

    renamePathDiagnostics: (oldPrefix, newPrefix) => {
      set((state) => {
        const next = new Map<string, DiagnosticsFileGroup>();

        state.byFile.forEach((group, filePath) => {
          const nextFilePath =
            remapProjectPathPrefix(filePath, oldPrefix, newPrefix) ?? filePath;
          next.set(nextFilePath, remapFileGroup(group, oldPrefix, newPrefix));
        });

        return {
          byFile: next,
          projectSummary: summarizeByFile(next, state.activeProjectPath),
        };
      });
    },

    prunePathDiagnostics: (pathPrefix) => {
      set((state) => {
        const next = new Map<string, DiagnosticsFileGroup>();

        state.byFile.forEach((group, filePath) => {
          if (!isSameOrChildPath(filePath, pathPrefix)) {
            next.set(filePath, group);
          }
        });

        return {
          byFile: next,
          projectSummary: summarizeByFile(next, state.activeProjectPath),
        };
      });
    },

    reset: () =>
      set({
        byFile: new Map(),
        projectSummary: emptySummary(),
        activeProjectPath: null,
        currentGeneration: 0,
      }),

    getProjectSummary: (projectPath = null) =>
      summarizeByFile(get().byFile, projectPath),

    getFileSummary: (filePath) => {
      if (!filePath) {
        return emptySummary();
      }
      return get().byFile.get(filePath)?.summary ?? emptySummary();
    },

    getProblemGroups: ({
      severity = "all",
      currentFileOnly = false,
      currentFilePath = null,
      projectPath = null,
    }: DiagnosticsGroupOptions = {}) => {
      const groups = Array.from(get().byFile.values())
        .filter((group) => matchesProjectPath(group.filePath, projectPath))
        .filter(
          (group) => !currentFileOnly || group.filePath === currentFilePath,
        )
        .map((group) => {
          const filteredItems = filterGroupItems(group, severity);
          if (filteredItems.length === 0) {
            return null;
          }

          return {
            ...group,
            items: filteredItems,
            summary: summarizeProblems(filteredItems),
          } satisfies DiagnosticsFileGroup;
        })
        .filter((group): group is DiagnosticsFileGroup => group !== null);

      groups.sort(compareGroups);
      return groups;
    },
  })),
);

export const ensureDiagnosticsEventsBound = (): Promise<void> => {
  if (diagnosticsEventsBound || typeof window === "undefined") {
    return Promise.resolve();
  }

  bindDiagnosticsEvents();
  if (diagnosticsEventsBound) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    diagnosticsEventsBoundWaiters.push(resolve);
    scheduleDiagnosticsEventsBind();
  });
};

const bindDiagnosticsEvents = () => {
  if (diagnosticsEventsBound || typeof window === "undefined") {
    return;
  }

  if (!hasWailsRuntimeEvents()) {
    scheduleDiagnosticsEventsBind();
    return;
  }

  if (diagnosticsEventsBindTimer) {
    window.clearTimeout(diagnosticsEventsBindTimer);
    diagnosticsEventsBindTimer = null;
  }

  diagnosticsEventsBound = true;
  resolveDiagnosticsEventsBound();
  EventsOn("lsp:diagnostics", (event: DiagnosticsEventPayload) => {
    useDiagnosticsStore.getState().ingestDiagnosticsEvent(event);
  });
};

bindDiagnosticsEvents();
