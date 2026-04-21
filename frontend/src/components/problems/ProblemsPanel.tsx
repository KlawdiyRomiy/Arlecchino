import React, { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  CircleDot,
} from "lucide-react";

import {
  useDiagnosticsStore,
  type DiagnosticsFileGroup,
  type DiagnosticsProblem,
  type DiagnosticsSeverityFilter,
} from "../../stores/diagnosticsStore";
import { useEditorStore } from "../../stores/editorStore";
import { useExplorerStore } from "../../stores/explorerStore";
import { useIndexingProgress } from "../../hooks/useIndexingProgress";
import { useProjectDiagnosticsPreload } from "../../utils/projectBoundState";
import {
  resolveDiagnosticsProjectPath,
  useWorkspaceStore,
} from "../../stores/workspaceStore";

interface ProblemsPanelProps {
  activeFilePath?: string | null;
  onNavigate: (filePath: string, line?: number, column?: number) => void;
}

const filterButtonClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition-colors ${
    active
      ? "border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-primary)]"
      : "border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
  }`;

const renderSeverityIcon = (problem: DiagnosticsProblem) => {
  if (problem.severityLabel === "error") {
    return <AlertCircle size={14} className="text-[var(--status-error)]" />;
  }
  if (problem.severityLabel === "warning") {
    return <AlertTriangle size={14} className="text-[var(--status-warning)]" />;
  }
  return <CircleDot size={14} className="text-[var(--status-info)]" />;
};

const summarizeLabel = (group: DiagnosticsFileGroup) => {
  const parts: string[] = [];
  if (group.summary.errors > 0) {
    parts.push(
      `${group.summary.errors} error${group.summary.errors === 1 ? "" : "s"}`,
    );
  }
  if (group.summary.warnings > 0) {
    parts.push(
      `${group.summary.warnings} warning${group.summary.warnings === 1 ? "" : "s"}`,
    );
  }
  if (group.summary.infos > 0) {
    parts.push(`${group.summary.infos} info`);
  }
  return parts.join(" · ");
};

const areGroupsEquivalent = (
  previous: DiagnosticsFileGroup[],
  next: DiagnosticsFileGroup[],
) => {
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((group, groupIndex) => {
    const nextGroup = next[groupIndex];
    if (!nextGroup) {
      return false;
    }

    if (
      group.filePath !== nextGroup.filePath ||
      group.summary.total !== nextGroup.summary.total ||
      group.summary.errors !== nextGroup.summary.errors ||
      group.summary.warnings !== nextGroup.summary.warnings ||
      group.summary.infos !== nextGroup.summary.infos ||
      group.items.length !== nextGroup.items.length
    ) {
      return false;
    }

    return group.items.every((problem, problemIndex) => {
      const nextProblem = nextGroup.items[problemIndex];
      return (
        nextProblem &&
        problem.id === nextProblem.id &&
        problem.message === nextProblem.message &&
        problem.line === nextProblem.line &&
        problem.column === nextProblem.column &&
        problem.severity === nextProblem.severity
      );
    });
  });
};

export const ProblemsPanel: React.FC<ProblemsPanelProps> = ({
  activeFilePath,
  onNavigate,
}) => {
  const indexing = useIndexingProgress();
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const [severityFilter, setSeverityFilter] =
    useState<DiagnosticsSeverityFilter>("all");
  const [currentFileOnly, setCurrentFileOnly] = useState(false);
  const previousNonEmptyGroupsRef = useRef<DiagnosticsFileGroup[]>([]);
  const stableGroupsRef = useRef<DiagnosticsFileGroup[]>([]);
  const byFile = useDiagnosticsStore((state) => state.byFile);
  const activeEditorFilePath = useEditorStore(
    (state) => state.getActiveTab(state.activePaneId)?.path ?? null,
  );
  const highlightedPath = useExplorerStore((state) => state.highlightedPath);
  const activeProjectPath = useWorkspaceStore((state) =>
    resolveDiagnosticsProjectPath(
      state.projects,
      state.activeId,
      state.pendingId,
      state.switchSourceId,
    ),
  );
  const currentFileCandidatePath =
    activeFilePath ?? activeEditorFilePath ?? highlightedPath ?? null;
  const resolvedActiveFilePath =
    activeFilePath ??
    activeEditorFilePath ??
    (currentFileOnly ? highlightedPath : null);

  const groups = useMemo(() => {
    const nextGroups = useDiagnosticsStore.getState().getProblemGroups({
      severity: severityFilter,
      currentFileOnly,
      currentFilePath: resolvedActiveFilePath,
      projectPath: activeProjectPath,
    });

    if (areGroupsEquivalent(stableGroupsRef.current, nextGroups)) {
      return stableGroupsRef.current;
    }

    stableGroupsRef.current = nextGroups;
    return nextGroups;
  }, [
    activeProjectPath,
    byFile,
    currentFileOnly,
    resolvedActiveFilePath,
    severityFilter,
  ]);
  const shouldPreserveCurrentFileGroups =
    currentFileOnly && severityFilter === "all" && !!resolvedActiveFilePath;

  if (groups.length > 0) {
    previousNonEmptyGroupsRef.current = groups;
  }

  const displayedGroups =
    groups.length === 0 && shouldPreserveCurrentFileGroups
      ? previousNonEmptyGroupsRef.current
      : groups;

  const projectSummary = useMemo(
    () => useDiagnosticsStore.getState().getProjectSummary(activeProjectPath),
    [activeProjectPath, byFile],
  );
  const isIndexingActive = indexing.phase === "indexing";
  const isDiagnosticsPreloadActive =
    diagnosticsPreload.active &&
    diagnosticsPreload.projectPath === activeProjectPath;
  const isBoundedDiagnosticsProject =
    diagnosticsPreload.projectPath === activeProjectPath &&
    diagnosticsPreload.bounded;
  const isWorkspaceDiagnosticsUnavailable =
    diagnosticsPreload.projectPath === activeProjectPath &&
    !diagnosticsPreload.active &&
    diagnosticsPreload.totalCandidates === 0;
  const isPartialWorkspaceDiagnostics =
    isBoundedDiagnosticsProject &&
    diagnosticsPreload.totalCandidates > diagnosticsPreload.selectedCandidates;
  const showScanningState =
    displayedGroups.length === 0 &&
    (isIndexingActive || isDiagnosticsPreloadActive);

  return (
    <div
      data-testid="problems-panel"
      className="flex h-full min-h-0 flex-col bg-[var(--surface-1)] text-[var(--text-primary)]"
    >
      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSeverityFilter("all");
              setCurrentFileOnly(false);
            }}
            className={filterButtonClass(
              severityFilter === "all" && !currentFileOnly,
            )}
          >
            All Files
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter("error")}
            className={filterButtonClass(severityFilter === "error")}
          >
            Errors
          </button>
          <button
            type="button"
            onClick={() => setSeverityFilter("warning")}
            className={filterButtonClass(severityFilter === "warning")}
          >
            Warnings
          </button>
          <button
            type="button"
            onClick={() => setCurrentFileOnly((value) => !value)}
            className={`${filterButtonClass(currentFileOnly)} disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!currentFileCandidatePath}
          >
            Current File
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-[var(--text-secondary)]">
          <span>{projectSummary.total} total</span>
          <span className="text-[var(--status-error)]">
            {projectSummary.errors} errors
          </span>
          <span className="text-[var(--status-warning)]">
            {projectSummary.warnings} warnings
          </span>
          <span className="text-[var(--status-info)]">
            {projectSummary.infos} info
          </span>
          {isPartialWorkspaceDiagnostics ? (
            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--status-warning)]">
              Partial results
            </span>
          ) : null}
        </div>
      </div>

      {displayedGroups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <AnimatePresence mode="wait">
            {showScanningState ? (
              <motion.div
                key="scanning"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.22 }}
                className="flex items-center gap-3 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-2"
              >
                <div className="relative h-6 w-6">
                  <motion.svg
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="2"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      fill="none"
                      stroke="var(--text-primary)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeDasharray="22 44"
                      strokeDashoffset="11"
                    />
                  </motion.svg>
                </div>
                <span className="font-mono text-sm text-[var(--text-muted)]">
                  Scanning...
                </span>
              </motion.div>
            ) : isWorkspaceDiagnosticsUnavailable ? (
              <motion.div
                key="unsupported"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="max-w-sm text-center text-sm text-[var(--text-muted)]"
              >
                Workspace diagnostics are not available for the detected files
                in this project yet.
              </motion.div>
            ) : isPartialWorkspaceDiagnostics ? (
              <motion.div
                key="partial"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="max-w-sm text-center text-sm text-[var(--text-muted)]"
              >
                No problems found in the scanned subset yet. Project-wide
                results are currently limited for this workload.
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="text-sm text-[var(--text-muted)]"
              >
                No problems match the current filters.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {displayedGroups.map((group) => (
            <section
              key={group.filePath}
              className="overflow-hidden rounded-[14px] border border-[var(--border-subtle)] bg-[var(--surface-1)]"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-2)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {group.fileName}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                    {group.filePath}
                  </div>
                </div>
                <div className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  {summarizeLabel(group)}
                </div>
              </div>

              <div className="divide-y divide-[var(--border-subtle)]">
                {group.items.map((problem) => (
                  <button
                    key={problem.id}
                    type="button"
                    onClick={() =>
                      onNavigate(problem.filePath, problem.line, problem.column)
                    }
                    className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)] focus:bg-[var(--surface-2)] focus:outline-none focus-visible:shadow-[inset_2px_0_0_var(--border-focus)]"
                  >
                    <div className="mt-0.5 flex w-4 flex-shrink-0 justify-center">
                      {renderSeverityIcon(problem)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-medium text-[var(--text-primary)]">
                        {problem.message}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                        <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-0.5">
                          Ln {problem.line}, Col {problem.column}
                        </span>
                        {problem.source ? (
                          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-0.5">
                            {problem.source}
                          </span>
                        ) : null}
                        {problem.code ? (
                          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-0.5 text-[var(--text-secondary)]">
                            {problem.code}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ChevronRight
                      size={14}
                      className="mt-0.5 flex-shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5"
                    />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
