import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { EventsOn } from "../wails/runtime";
import { getCurrentProjectSessionId } from "../shell/projectSessionRoute";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";

export type DiagnosticsSeverity = "error" | "warning" | "info";
export type DiagnosticsSeverityFilter = "all" | DiagnosticsSeverity;
export type DiagnosticsRuntimeState =
  | "idle"
  | "ready"
  | "unavailable"
  | "error";

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
  sessionId?: string;
  generation?: number;
  language?: string;
  items?: DiagnosticsEventItem[] | null;
}

export interface DiagnosticsStatusEventPayload {
  projectPath?: string;
  sessionId?: string;
  generation?: number;
  language?: string;
  filePath?: string;
  state?: string;
  message?: string;
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

export interface DiagnosticsRuntimeStatus {
  state: DiagnosticsRuntimeState;
  projectPath: string | null;
  generation: number;
  language: string;
  filePath: string;
  message: string;
  updatedAt: number;
}

export interface DiagnosticsGroupOptions {
  severity?: DiagnosticsSeverityFilter;
  currentFileOnly?: boolean;
  currentFilePath?: string | null;
  projectPath?: string | null;
}

interface DiagnosticsState {
  byFile: Map<string, DiagnosticsFileGroup>;
  byFileLanguage: Map<string, Map<string, DiagnosticsFileGroup>>;
  projectSummary: DiagnosticsSummary;
  activeProjectPath: string | null;
  currentGeneration: number;
  runtimeStatus: DiagnosticsRuntimeStatus;
  ingestDiagnosticsEvent: (event: DiagnosticsEventPayload) => void;
  ingestDiagnosticsStatusEvent: (event: DiagnosticsStatusEventPayload) => void;
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

const emptyRuntimeStatus = (): DiagnosticsRuntimeStatus => ({
  state: "idle",
  projectPath: null,
  generation: 0,
  language: "",
  filePath: "",
  message: "",
  updatedAt: 0,
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

const normalizeDiagnosticsLanguage = (language: string): string => {
  const normalized = language.trim().toLowerCase();
  return normalized || "unknown";
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

const addSummary = (
  summary: DiagnosticsSummary,
  next: DiagnosticsSummary,
): DiagnosticsSummary => ({
  errors: summary.errors + next.errors,
  warnings: summary.warnings + next.warnings,
  infos: summary.infos + next.infos,
  total: summary.total + next.total,
});

const subtractSummary = (
  summary: DiagnosticsSummary,
  previous: DiagnosticsSummary,
): DiagnosticsSummary => ({
  errors: Math.max(0, summary.errors - previous.errors),
  warnings: Math.max(0, summary.warnings - previous.warnings),
  infos: Math.max(0, summary.infos - previous.infos),
  total: Math.max(0, summary.total - previous.total),
});

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
  const normalizedLanguage = normalizeDiagnosticsLanguage(language);
  const normalized = items.map((item) => {
    const severityLabel = getSeverityLabel(item.severity);
    const line = item.range.start.line + 1;
    const column = item.range.start.character + 1;
    const stableCode = item.code ?? "";
    const stableSource = item.source ?? "";

    return {
      id: `${filePath}:${normalizedLanguage}:${line}:${column}:${stableSource}:${stableCode}:${item.message}`,
      filePath,
      language: normalizedLanguage,
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
  const normalizedLanguage = normalizeDiagnosticsLanguage(language);
  const normalizedItems = normalizeProblems(
    filePath,
    normalizedLanguage,
    items,
  );
  return {
    filePath,
    fileName: getFileName(filePath),
    language: normalizedLanguage,
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
    id: `${nextFilePath}:${item.language}:${item.line}:${item.column}:${item.source}:${item.code}:${item.message}`,
    filePath: nextFilePath,
  }));

  return {
    ...group,
    filePath: nextFilePath,
    fileName: getProjectPathBasename(nextFilePath),
    items,
  };
};

const getProblemAggregateKey = (problem: DiagnosticsProblem): string =>
  [
    problem.range.start.line,
    problem.range.start.character,
    problem.range.end.line,
    problem.range.end.character,
    problem.severity,
    problem.source,
    problem.code,
    problem.message,
  ].join("\u0000");

const aggregateLanguageBucketsForFile = (
  filePath: string,
  buckets: Map<string, DiagnosticsFileGroup>,
): DiagnosticsFileGroup | null => {
  const itemsByKey = new Map<string, DiagnosticsProblem>();
  const languages = new Set<string>();

  buckets.forEach((group) => {
    if (group.language) {
      languages.add(group.language);
    }
    for (const item of group.items) {
      const key = getProblemAggregateKey(item);
      if (!itemsByKey.has(key)) {
        itemsByKey.set(key, item);
      }
    }
  });

  const items = Array.from(itemsByKey.values()).sort(compareProblems);
  if (items.length === 0) {
    return null;
  }

  return {
    filePath,
    fileName: getFileName(filePath),
    language: Array.from(languages).sort().join(","),
    items,
    summary: summarizeProblems(items),
  };
};

const aggregateDiagnosticsByFile = (
  byFileLanguage: Map<string, Map<string, DiagnosticsFileGroup>>,
): Map<string, DiagnosticsFileGroup> => {
  const next = new Map<string, DiagnosticsFileGroup>();

  byFileLanguage.forEach((buckets, filePath) => {
    const group = aggregateLanguageBucketsForFile(filePath, buckets);
    if (group) {
      next.set(filePath, group);
    }
  });

  return next;
};

const problemListsEqual = (
  previous: DiagnosticsProblem[],
  next: DiagnosticsProblem[],
): boolean => {
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((problem, index) => {
    const nextProblem = next[index];
    return (
      nextProblem &&
      problem.id === nextProblem.id &&
      problem.severity === nextProblem.severity &&
      problem.line === nextProblem.line &&
      problem.column === nextProblem.column
    );
  });
};

const fileGroupsEqual = (
  previous: DiagnosticsFileGroup | undefined,
  next: DiagnosticsFileGroup | undefined,
): boolean => {
  if (!previous || !next) {
    return previous === next;
  }
  return (
    previous.filePath === next.filePath &&
    previous.language === next.language &&
    previous.summary.errors === next.summary.errors &&
    previous.summary.warnings === next.summary.warnings &&
    previous.summary.infos === next.summary.infos &&
    previous.summary.total === next.summary.total &&
    problemListsEqual(previous.items, next.items)
  );
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

const summarizeFileChange = (
  current: DiagnosticsSummary,
  previousGroup: DiagnosticsFileGroup | null,
  nextGroup: DiagnosticsFileGroup | null,
  filePath: string,
  projectPath?: string | null,
): DiagnosticsSummary => {
  if (!matchesProjectPath(filePath, projectPath)) {
    return current;
  }

  let summary = current;
  if (previousGroup) {
    summary = subtractSummary(summary, previousGroup.summary);
  }
  if (nextGroup) {
    summary = addSummary(summary, nextGroup.summary);
  }
  return summary;
};

const normalizeGeneration = (generation: number | undefined): number => {
  if (typeof generation !== "number" || !Number.isFinite(generation)) {
    return 0;
  }

  return generation > 0 ? Math.trunc(generation) : 0;
};

const normalizeRuntimeState = (state?: string): DiagnosticsRuntimeState => {
  switch (state) {
    case "ready":
    case "unavailable":
    case "error":
      return state;
    default:
      return "idle";
  }
};

let diagnosticsEventsBound = false;
let diagnosticsEventsBindTimer: number | null = null;
let diagnosticsEventsBoundWaiters: Array<() => void> = [];
const diagnosticPayloadMatchesCurrentSession = (
  payload: DiagnosticsEventPayload | DiagnosticsStatusEventPayload,
) => {
  const sessionId =
    typeof payload.sessionId === "string" && payload.sessionId.length > 0
      ? payload.sessionId
      : "main";
  return sessionId === getCurrentProjectSessionId();
};

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
    byFileLanguage: new Map(),
    projectSummary: emptySummary(),
    activeProjectPath: null,
    currentGeneration: 0,
    runtimeStatus: emptyRuntimeStatus(),

    setProjectScope: (projectPath, generation = 0) => {
      set((state) => ({
        activeProjectPath: projectPath,
        currentGeneration: normalizeGeneration(generation),
        projectSummary: summarizeByFile(state.byFile, projectPath),
        runtimeStatus:
          !projectPath ||
          (state.runtimeStatus.projectPath &&
            state.runtimeStatus.projectPath !== projectPath)
            ? emptyRuntimeStatus()
            : state.runtimeStatus,
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

      if (!Array.isArray(event.items)) {
        return;
      }
      const items = event.items;
      get().setFileDiagnostics(filePath, event.language ?? "", items);
    },

    ingestDiagnosticsStatusEvent: (event) => {
      const nextRuntimeState = normalizeRuntimeState(event.state);
      const eventProjectPath =
        typeof event.projectPath === "string" && event.projectPath !== ""
          ? event.projectPath
          : null;
      const eventGeneration = normalizeGeneration(event.generation);

      set((state) => {
        if (
          state.activeProjectPath &&
          eventProjectPath &&
          eventProjectPath !== state.activeProjectPath
        ) {
          return state;
        }
        if (
          state.currentGeneration > 0 &&
          eventGeneration > 0 &&
          eventGeneration < state.currentGeneration
        ) {
          return state;
        }

        const nextGeneration =
          eventGeneration > state.currentGeneration
            ? eventGeneration
            : state.currentGeneration;
        const projectPath = eventProjectPath ?? state.activeProjectPath;

        return {
          currentGeneration: nextGeneration,
          runtimeStatus: {
            state: nextRuntimeState,
            projectPath,
            generation: eventGeneration || nextGeneration,
            language: typeof event.language === "string" ? event.language : "",
            filePath: typeof event.filePath === "string" ? event.filePath : "",
            message: typeof event.message === "string" ? event.message : "",
            updatedAt: Date.now(),
          },
        };
      });
    },

    setFileDiagnostics: (filePath, language, items) => {
      set((state) => {
        const languageKey = normalizeDiagnosticsLanguage(language);
        const previousFileBuckets = state.byFileLanguage.get(filePath);
        const previousLanguageGroup = previousFileBuckets?.get(languageKey);
        const nextLanguageGroup =
          items.length > 0
            ? createFileGroup(filePath, languageKey, items)
            : undefined;

        if (fileGroupsEqual(previousLanguageGroup, nextLanguageGroup)) {
          return state;
        }

        const nextByFileLanguage = new Map(state.byFileLanguage);
        const nextFileBuckets = new Map<string, DiagnosticsFileGroup>(
          previousFileBuckets ?? [],
        );
        if (items.length === 0) {
          nextFileBuckets.delete(languageKey);
        } else {
          nextFileBuckets.set(languageKey, nextLanguageGroup!);
        }

        if (nextFileBuckets.size === 0) {
          nextByFileLanguage.delete(filePath);
        } else {
          nextByFileLanguage.set(filePath, nextFileBuckets);
        }

        const previousAggregate = state.byFile.get(filePath) ?? null;
        const nextAggregate =
          nextFileBuckets.size > 0
            ? aggregateLanguageBucketsForFile(filePath, nextFileBuckets)
            : null;
        const nextByFile = new Map(state.byFile);
        if (nextAggregate) {
          nextByFile.set(filePath, nextAggregate);
        } else {
          nextByFile.delete(filePath);
        }

        return {
          byFileLanguage: nextByFileLanguage,
          byFile: nextByFile,
          projectSummary: summarizeFileChange(
            state.projectSummary,
            previousAggregate,
            nextAggregate,
            filePath,
            state.activeProjectPath,
          ),
        };
      });
    },

    clearFileDiagnostics: (filePath) => {
      set((state) => {
        if (
          !state.byFileLanguage.has(filePath) &&
          !state.byFile.has(filePath)
        ) {
          return state;
        }

        const nextByFileLanguage = new Map(state.byFileLanguage);
        nextByFileLanguage.delete(filePath);
        const previousAggregate = state.byFile.get(filePath) ?? null;
        const nextByFile = new Map(state.byFile);
        nextByFile.delete(filePath);
        return {
          byFileLanguage: nextByFileLanguage,
          byFile: nextByFile,
          projectSummary: summarizeFileChange(
            state.projectSummary,
            previousAggregate,
            null,
            filePath,
            state.activeProjectPath,
          ),
        };
      });
    },

    renameFileDiagnostics: (oldPath, newPath) => {
      get().renamePathDiagnostics(oldPath, newPath);
    },

    renamePathDiagnostics: (oldPrefix, newPrefix) => {
      set((state) => {
        const nextByFileLanguage = new Map<
          string,
          Map<string, DiagnosticsFileGroup>
        >();

        state.byFileLanguage.forEach((buckets, filePath) => {
          const nextFilePath =
            remapProjectPathPrefix(filePath, oldPrefix, newPrefix) ?? filePath;
          const nextFileBuckets = new Map(
            nextByFileLanguage.get(nextFilePath) ?? new Map(),
          );
          buckets.forEach((group, language) => {
            nextFileBuckets.set(
              language,
              remapFileGroup(group, oldPrefix, newPrefix),
            );
          });
          nextByFileLanguage.set(nextFilePath, nextFileBuckets);
        });

        const nextByFile = aggregateDiagnosticsByFile(nextByFileLanguage);
        return {
          byFileLanguage: nextByFileLanguage,
          byFile: nextByFile,
          projectSummary: summarizeByFile(nextByFile, state.activeProjectPath),
        };
      });
    },

    prunePathDiagnostics: (pathPrefix) => {
      set((state) => {
        const nextByFileLanguage = new Map<
          string,
          Map<string, DiagnosticsFileGroup>
        >();

        state.byFileLanguage.forEach((buckets, filePath) => {
          if (!isSameOrChildPath(filePath, pathPrefix)) {
            nextByFileLanguage.set(filePath, new Map(buckets));
          }
        });

        const nextByFile = aggregateDiagnosticsByFile(nextByFileLanguage);
        return {
          byFileLanguage: nextByFileLanguage,
          byFile: nextByFile,
          projectSummary: summarizeByFile(nextByFile, state.activeProjectPath),
        };
      });
    },

    reset: () =>
      set({
        byFile: new Map(),
        byFileLanguage: new Map(),
        projectSummary: emptySummary(),
        activeProjectPath: null,
        currentGeneration: 0,
        runtimeStatus: emptyRuntimeStatus(),
      }),

    getProjectSummary: (projectPath = null) => {
      const state = get();
      if ((projectPath ?? null) === (state.activeProjectPath ?? null)) {
        return state.projectSummary;
      }
      return summarizeByFile(state.byFile, projectPath);
    },

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
      const groups: DiagnosticsFileGroup[] = [];

      get().byFile.forEach((group) => {
        if (
          !matchesProjectPath(group.filePath, projectPath) ||
          (currentFileOnly && group.filePath !== currentFilePath)
        ) {
          return;
        }

        if (severity === "all") {
          groups.push(group);
          return;
        }

        const filteredItems = filterGroupItems(group, severity);
        if (filteredItems.length === 0) {
          return;
        }

        groups.push({
          ...group,
          items: filteredItems,
          summary: summarizeProblems(filteredItems),
        });
      });

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

  if (diagnosticsEventsBindTimer) {
    window.clearTimeout(diagnosticsEventsBindTimer);
    diagnosticsEventsBindTimer = null;
  }

  diagnosticsEventsBound = true;
  resolveDiagnosticsEventsBound();
  EventsOn("lsp:diagnostics", (event: DiagnosticsEventPayload) => {
    if (!diagnosticPayloadMatchesCurrentSession(event)) {
      return;
    }
    useDiagnosticsStore.getState().ingestDiagnosticsEvent(event);
  });
  EventsOn("lsp:diagnostics:status", (event: DiagnosticsStatusEventPayload) => {
    if (!diagnosticPayloadMatchesCurrentSession(event)) {
      return;
    }
    useDiagnosticsStore.getState().ingestDiagnosticsStatusEvent(event);
  });
};

bindDiagnosticsEvents();
