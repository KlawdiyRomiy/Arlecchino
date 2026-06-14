import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  ExternalLink,
  FileWarning,
  Layers3,
  LoaderCircle,
  LocateFixed,
  Play,
  XCircle,
} from "lucide-react";

import { useProjectEntryActions } from "../../contexts/ProjectEntryActionsContext";
import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import type {
  DiagnosticsFileGroup,
  DiagnosticsProblem,
  DiagnosticsSeverity,
  DiagnosticsSeverityFilter,
  DiagnosticsSummary,
} from "../../stores/diagnosticsStore";
import { useEditorStore } from "../../stores/editorStore";
import { useExplorerSelectionStore } from "../../stores/explorerStore";
import { useTheme } from "../../hooks/useTheme";
import { getThemeColors } from "../../styles/colors";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";
import {
  runProjectDiagnosticsScan,
  useProjectDiagnosticsPreload,
} from "../../utils/projectBoundState";
import {
  runBackgroundShellAction,
  useBackgroundShellStatus,
} from "../../shell/backgroundShellStatus";
import { getCurrentProjectSessionId } from "../../shell/projectSessionRoute";
import {
  resolveDiagnosticsProjectPath,
  useWorkspaceStore,
} from "../../stores/workspaceStore";

type ProblemsPresentationMode = "compact" | "expanded";

const SPLIT_DIAGNOSTICS_HOLD_MS = 1200;
const COMPACT_GROUP_RENDER_LIMIT = 80;
const COMPACT_ITEMS_PER_GROUP_LIMIT = 6;
const EXPANDED_GROUP_RENDER_LIMIT = 240;
const EXPANDED_DETAIL_ITEM_LIMIT = 240;

interface ProblemsPanelProps {
  activeFilePath?: string | null;
  onNavigate: (filePath: string, line?: number, column?: number) => void;
  presentationMode?: ProblemsPresentationMode;
}

const problemsSectionClass =
  "overflow-hidden rounded-[24px] border border-[var(--problems-border)] bg-[var(--problems-surface)] shadow-[var(--problems-surface-shadow)]";
const problemsPillClass =
  "inline-flex items-center gap-1 rounded-full border border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)] px-3 py-1.5 text-[11px] font-medium text-[var(--problems-text-secondary)]";

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

const getDominantSeverity = (
  summary: DiagnosticsSummary,
): DiagnosticsSeverity | "clear" => {
  if (summary.errors > 0) {
    return "error";
  }
  if (summary.warnings > 0) {
    return "warning";
  }
  if (summary.infos > 0) {
    return "info";
  }
  return "clear";
};

const severityTone = (severity: DiagnosticsSeverity | "clear") => {
  switch (severity) {
    case "error":
      return {
        color: "var(--status-error)",
        background:
          "color-mix(in srgb, var(--status-error) 14%, var(--problems-bg-tertiary))",
        border:
          "color-mix(in srgb, var(--status-error) 28%, var(--problems-border))",
      };
    case "warning":
      return {
        color: "var(--status-warning)",
        background:
          "color-mix(in srgb, var(--status-warning) 14%, var(--problems-bg-tertiary))",
        border:
          "color-mix(in srgb, var(--status-warning) 28%, var(--problems-border))",
      };
    case "info":
      return {
        color: "var(--status-info)",
        background:
          "color-mix(in srgb, var(--status-info) 14%, var(--problems-bg-tertiary))",
        border:
          "color-mix(in srgb, var(--status-info) 28%, var(--problems-border))",
      };
    default:
      return {
        color: "var(--status-success)",
        background:
          "color-mix(in srgb, var(--status-success) 14%, var(--problems-bg-tertiary))",
        border:
          "color-mix(in srgb, var(--status-success) 28%, var(--problems-border))",
      };
  }
};

const severityIcon = (severity: DiagnosticsSeverity | "clear", size = 14) => {
  if (severity === "error") {
    return <AlertCircle size={size} className="text-[var(--status-error)]" />;
  }
  if (severity === "warning") {
    return (
      <AlertTriangle size={size} className="text-[var(--status-warning)]" />
    );
  }
  if (severity === "info") {
    return <CircleDot size={size} className="text-[var(--status-info)]" />;
  }
  return <CheckCircle2 size={size} className="text-[var(--status-success)]" />;
};

const renderSeverityIcon = (problem: DiagnosticsProblem) =>
  severityIcon(problem.severityLabel, 14);

const relativePath = (
  filePath: string,
  projectPath?: string | null,
): string => {
  if (!projectPath) {
    return filePath;
  }

  if (filePath === projectPath) {
    return ".";
  }

  if (filePath.startsWith(`${projectPath}/`)) {
    return filePath.slice(projectPath.length + 1);
  }

  if (filePath.startsWith(`${projectPath}\\`)) {
    return filePath.slice(projectPath.length + 1);
  }

  return filePath;
};

const summaryValuePillClass =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium";

export const ProblemsPanel: React.FC<ProblemsPanelProps> = ({
  activeFilePath,
  onNavigate,
  presentationMode = "compact",
}) => {
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const backgroundShell = useBackgroundShellStatus();
  const projectSessionId = getCurrentProjectSessionId();
  const { isDark } = useTheme();
  const { copyAbsolutePath, copyRelativePath, copyText, revealEntry } =
    useProjectEntryActions();
  const theme = getThemeColors(isDark);
  const isExpanded = presentationMode === "expanded";
  const layoutMode = isExpanded ? "split" : "stacked";
  const [severityFilter, setSeverityFilter] =
    useState<DiagnosticsSeverityFilter>("all");
  const [currentFileOnly, setCurrentFileOnly] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const previousNonEmptyGroupsRef = useRef<DiagnosticsFileGroup[]>([]);
  const previousNonEmptyGroupsQueryKeyRef = useRef("");
  const previousNonEmptyProjectSummaryRef = useRef<DiagnosticsSummary | null>(
    null,
  );
  const lastActiveFilePathRef = useRef<string | null>(null);
  const splitDiagnosticsHoldUntilRef = useRef(0);
  const [splitDiagnosticsHoldUntil, setSplitDiagnosticsHoldUntil] = useState(0);
  const byFile = useDiagnosticsStore((state) => state.byFile);
  const diagnosticsRuntimeStatus = useDiagnosticsStore(
    (state) => state.runtimeStatus,
  );
  const statusFilePath = useEditorStore((state) => state.statusFile.path);
  const activeEditorFilePath = useEditorStore(
    (state) => state.getActiveTab(state.activePaneId)?.path ?? null,
  );
  const highlightedPath = useExplorerSelectionStore(
    (state) => state.highlightedPath,
  );
  const activeProjectPath = useWorkspaceStore((state) =>
    resolveDiagnosticsProjectPath(
      state.projects,
      state.activeId,
      state.pendingId,
      state.switchSourceId,
    ),
  );
  const activeCandidatePath =
    activeFilePath ?? statusFilePath ?? activeEditorFilePath ?? null;
  const activeDiagnosticsScanJob = useMemo(
    () =>
      backgroundShell.jobs.find(
        (job) =>
          job.kind === "diagnostics-scan" &&
          job.projectPath === activeProjectPath &&
          (!job.sessionId || job.sessionId === projectSessionId) &&
          (job.status === "running" || job.status === "queued"),
      ),
    [activeProjectPath, backgroundShell.jobs, projectSessionId],
  );
  const activeDiagnosticsScanCancelAction = useMemo(() => {
    if (!activeDiagnosticsScanJob) {
      return null;
    }
    return (
      backgroundShell.actions.find(
        (action) =>
          action.intent === "cancel-job" &&
          action.jobId === activeDiagnosticsScanJob.id &&
          action.enabled,
      ) ?? null
    );
  }, [activeDiagnosticsScanJob, backgroundShell.actions]);
  const isBackgroundDiagnosticsScanActive = Boolean(activeDiagnosticsScanJob);
  const handleRunProjectDiagnosticsScan = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!event.nativeEvent.isTrusted || event.detail < 1) {
        return;
      }

      if (!activeProjectPath || isBackgroundDiagnosticsScanActive) {
        return;
      }
      void runProjectDiagnosticsScan(activeProjectPath);
    },
    [activeProjectPath, isBackgroundDiagnosticsScanActive],
  );
  const handleCancelProjectDiagnosticsScan = useCallback(() => {
    if (!activeDiagnosticsScanCancelAction) {
      return;
    }
    void runBackgroundShellAction(activeDiagnosticsScanCancelAction.id);
  }, [activeDiagnosticsScanCancelAction]);

  if (activeCandidatePath) {
    lastActiveFilePathRef.current = activeCandidatePath;
  }

  const currentFileCandidatePath =
    activeCandidatePath ?? highlightedPath ?? lastActiveFilePathRef.current;
  const resolvedActiveFilePath =
    activeCandidatePath ??
    (currentFileOnly
      ? (highlightedPath ?? lastActiveFilePathRef.current)
      : null);

  useEffect(() => {
    const holdDiagnostics = () => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const nextHoldUntil = now + SPLIT_DIAGNOSTICS_HOLD_MS;
      splitDiagnosticsHoldUntilRef.current = nextHoldUntil;
      setSplitDiagnosticsHoldUntil(nextHoldUntil);

      window.setTimeout(() => {
        if (splitDiagnosticsHoldUntilRef.current <= nextHoldUntil) {
          splitDiagnosticsHoldUntilRef.current = 0;
          setSplitDiagnosticsHoldUntil(0);
        }
      }, SPLIT_DIAGNOSTICS_HOLD_MS);
    };

    window.addEventListener("arlecchino:editor-split", holdDiagnostics);
    window.addEventListener(
      "arlecchino:editor-split-transition",
      holdDiagnostics,
    );
    return () => {
      window.removeEventListener("arlecchino:editor-split", holdDiagnostics);
      window.removeEventListener(
        "arlecchino:editor-split-transition",
        holdDiagnostics,
      );
    };
  }, []);

  const groups = useMemo(
    () =>
      useDiagnosticsStore.getState().getProblemGroups({
        severity: severityFilter,
        currentFileOnly,
        currentFilePath: resolvedActiveFilePath,
        projectPath: activeProjectPath,
      }),
    [
      activeProjectPath,
      byFile,
      currentFileOnly,
      resolvedActiveFilePath,
      severityFilter,
    ],
  );

  const groupsQueryKey = [
    activeProjectPath ?? "",
    severityFilter,
    currentFileOnly ? (resolvedActiveFilePath ?? "") : "*",
  ].join("\u0000");
  const rawProjectSummary = useMemo(
    () => useDiagnosticsStore.getState().getProjectSummary(activeProjectPath),
    [activeProjectPath, byFile],
  );
  const shouldPreserveCurrentFileGroups =
    currentFileOnly && severityFilter === "all" && !!resolvedActiveFilePath;
  const isSplitDiagnosticsHoldActive =
    splitDiagnosticsHoldUntil > 0 &&
    (typeof performance === "undefined" ||
      performance.now() < splitDiagnosticsHoldUntil);
  const canReusePreviousGroups =
    previousNonEmptyGroupsQueryKeyRef.current === groupsQueryKey &&
    previousNonEmptyGroupsRef.current.length > 0;

  if (groups.length > 0) {
    previousNonEmptyGroupsRef.current = groups;
    previousNonEmptyGroupsQueryKeyRef.current = groupsQueryKey;
  }

  if (rawProjectSummary.total > 0) {
    previousNonEmptyProjectSummaryRef.current = rawProjectSummary;
  }

  const displayedGroups =
    groups.length === 0 &&
    canReusePreviousGroups &&
    (shouldPreserveCurrentFileGroups || isSplitDiagnosticsHoldActive)
      ? previousNonEmptyGroupsRef.current
      : groups;
  const compactDisplayedGroups = useMemo(
    () => displayedGroups.slice(0, COMPACT_GROUP_RENDER_LIMIT),
    [displayedGroups],
  );
  const expandedDisplayedGroups = useMemo(
    () => displayedGroups.slice(0, EXPANDED_GROUP_RENDER_LIMIT),
    [displayedGroups],
  );
  const hiddenCompactGroupCount = Math.max(
    0,
    displayedGroups.length - compactDisplayedGroups.length,
  );
  const hiddenExpandedGroupCount = Math.max(
    0,
    displayedGroups.length - expandedDisplayedGroups.length,
  );

  const projectSummary =
    displayedGroups !== groups &&
    rawProjectSummary.total === 0 &&
    previousNonEmptyProjectSummaryRef.current
      ? previousNonEmptyProjectSummaryRef.current
      : rawProjectSummary;
  const hasUnfilteredProjectDiagnostics = projectSummary.total > 0;
  const shouldShowCoverageEmptyState =
    displayedGroups.length === 0 && !hasUnfilteredProjectDiagnostics;

  const isDiagnosticsPreloadActive = isBackgroundDiagnosticsScanActive;
  const isDiagnosticsPreloadComplete =
    diagnosticsPreload.projectPath === activeProjectPath &&
    diagnosticsPreload.completed;
  const diagnosticsCoverageState =
    diagnosticsPreload.projectPath === activeProjectPath
      ? diagnosticsPreload.coverageState
      : activeProjectPath
        ? "pending"
        : "complete";
  const hasDiagnosticsPreloadForProject =
    diagnosticsPreload.projectPath === activeProjectPath;
  const hasDiagnosticsPreloadCheckedSelectedFiles =
    hasDiagnosticsPreloadForProject &&
    diagnosticsPreload.selectedCandidates > 0 &&
    diagnosticsPreload.checkedCandidates >=
      diagnosticsPreload.selectedCandidates;
  const isBoundedDiagnosticsProject =
    hasDiagnosticsPreloadForProject && diagnosticsPreload.bounded;
  const isDiagnosticsRuntimeUnavailable =
    diagnosticsRuntimeStatus.projectPath === activeProjectPath &&
    (diagnosticsRuntimeStatus.state === "unavailable" ||
      diagnosticsRuntimeStatus.state === "error");
  const diagnosticsUnavailableMessage =
    isDiagnosticsRuntimeUnavailable && diagnosticsRuntimeStatus.message
      ? diagnosticsRuntimeStatus.message
      : diagnosticsPreload.message ||
        "Workspace diagnostics are not available for the detected files in this project yet.";
  const isWorkspaceDiagnosticsUnavailable =
    shouldShowCoverageEmptyState &&
    (isDiagnosticsRuntimeUnavailable ||
      (isDiagnosticsPreloadComplete &&
        !diagnosticsPreload.active &&
        diagnosticsCoverageState === "unavailable"));
  const isWorkspaceDiagnosticsIncomplete =
    shouldShowCoverageEmptyState &&
    !isWorkspaceDiagnosticsUnavailable &&
    hasDiagnosticsPreloadForProject &&
    !diagnosticsPreload.active &&
    (diagnosticsCoverageState === "incomplete" ||
      diagnosticsCoverageState === "canceled" ||
      (isBoundedDiagnosticsProject &&
        diagnosticsPreload.totalCandidates >
          diagnosticsPreload.selectedCandidates));
  const isDiagnosticsCoverageIncomplete =
    hasDiagnosticsPreloadForProject &&
    !diagnosticsPreload.active &&
    (diagnosticsCoverageState === "incomplete" ||
      diagnosticsCoverageState === "canceled" ||
      (isBoundedDiagnosticsProject &&
        diagnosticsPreload.totalCandidates >
          diagnosticsPreload.selectedCandidates));
  const isPartialWorkspaceDiagnostics = isDiagnosticsCoverageIncomplete;
  const isDiagnosticsPreloadPendingOrRunning =
    isDiagnosticsPreloadActive &&
    (!hasDiagnosticsPreloadForProject ||
      !hasDiagnosticsPreloadCheckedSelectedFiles ||
      !diagnosticsPreload.completed);
  const isProjectDiagnosticsScanRunning =
    !isWorkspaceDiagnosticsUnavailable &&
    !isWorkspaceDiagnosticsIncomplete &&
    isDiagnosticsPreloadPendingOrRunning;
  const showScanningState =
    shouldShowCoverageEmptyState && isProjectDiagnosticsScanRunning;
  const showInlineScanningProgress =
    !shouldShowCoverageEmptyState && isProjectDiagnosticsScanRunning;
  const diagnosticsScanProgressLabel = activeDiagnosticsScanJob?.progress?.total
    ? `${Math.min(
        activeDiagnosticsScanJob.progress.current ?? 0,
        activeDiagnosticsScanJob.progress.total,
      )}/${activeDiagnosticsScanJob.progress.total} files checked`
    : diagnosticsPreload.projectPath === activeProjectPath &&
        diagnosticsPreload.selectedCandidates > 0
      ? `${Math.min(
          diagnosticsPreload.checkedCandidates,
          diagnosticsPreload.selectedCandidates,
        )}/${diagnosticsPreload.selectedCandidates} files checked`
      : "Collecting project diagnostics";
  const canShowCleanState =
    hasUnfilteredProjectDiagnostics ||
    !activeProjectPath ||
    diagnosticsCoverageState === "complete" ||
    !isBackgroundDiagnosticsScanActive;

  const panelVars = useMemo(
    () =>
      ({
        "--problems-bg": theme.bg,
        "--problems-surface":
          "color-mix(in srgb, var(--surface-1) 98%, transparent)",
        "--problems-bg-tertiary":
          "color-mix(in srgb, var(--surface-2) 96%, transparent)",
        "--problems-border": theme.border,
        "--problems-border-strong": "var(--border-strong)",
        "--problems-row-active":
          "color-mix(in srgb, var(--surface-active) 86%, transparent)",
        "--problems-text": theme.text,
        "--problems-text-secondary": theme.textSecondary,
        "--problems-text-tertiary": theme.textMuted,
        "--problems-surface-shadow":
          "inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 24px -22px rgba(0,0,0,0.85)",
      }) as React.CSSProperties,
    [theme],
  );

  const effectiveSelectedFilePath = useMemo(() => {
    if (!isExpanded || displayedGroups.length === 0) {
      return null;
    }

    if (
      selectedFilePath &&
      displayedGroups.some((group) => group.filePath === selectedFilePath)
    ) {
      return selectedFilePath;
    }

    if (
      currentFileCandidatePath &&
      displayedGroups.some(
        (group) => group.filePath === currentFileCandidatePath,
      )
    ) {
      return currentFileCandidatePath;
    }

    return displayedGroups[0]?.filePath ?? null;
  }, [currentFileCandidatePath, displayedGroups, isExpanded, selectedFilePath]);

  const selectedGroup = useMemo(
    () =>
      effectiveSelectedFilePath
        ? (displayedGroups.find(
            (group) => group.filePath === effectiveSelectedFilePath,
          ) ?? null)
        : null,
    [displayedGroups, effectiveSelectedFilePath],
  );

  const summaryPillStyle = (
    severity: DiagnosticsSeverity | "clear",
  ): React.CSSProperties => {
    const tone = severityTone(severity);
    return {
      color: tone.color,
      borderColor: tone.border,
      background: tone.background,
    };
  };

  const renderProjectSummaryPills = (): React.ReactNode => (
    <div className="flex flex-wrap items-center gap-2">
      <span className={problemsPillClass}>{projectSummary.total} total</span>
      <span className={summaryValuePillClass} style={summaryPillStyle("error")}>
        <AlertCircle size={12} />
        {projectSummary.errors} errors
      </span>
      <span
        className={summaryValuePillClass}
        style={summaryPillStyle("warning")}
      >
        <AlertTriangle size={12} />
        {projectSummary.warnings} warnings
      </span>
      <span className={summaryValuePillClass} style={summaryPillStyle("info")}>
        <CircleDot size={12} />
        {projectSummary.infos} info
      </span>
      {isPartialWorkspaceDiagnostics ? (
        <span
          className={summaryValuePillClass}
          style={summaryPillStyle("warning")}
        >
          <Layers3 size={12} />
          Diagnostics incomplete
        </span>
      ) : null}
      {showScanningState || showInlineScanningProgress ? (
        <span className={problemsPillClass}>
          <LoaderCircle size={12} className="animate-spin" />
          Still scanning
        </span>
      ) : null}
    </div>
  );

  const filterButtonClass = (active: boolean, disabled = false): string =>
    `inline-flex items-center rounded-full border px-3.5 py-2 text-[12px] font-medium transition-colors ${
      active
        ? "border-[var(--problems-border-strong)] bg-[var(--problems-row-active)] text-[var(--problems-text)]"
        : "border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)] text-[var(--problems-text-secondary)] hover:border-[var(--problems-border-strong)] hover:text-[var(--problems-text)]"
    } ${disabled ? "cursor-not-allowed opacity-50 hover:border-[var(--problems-border)] hover:text-[var(--problems-text-secondary)]" : ""}`;

  const renderFilterCard = (): React.ReactNode => (
    <section className={`${problemsSectionClass} p-4`}>
      <div className="flex flex-col gap-4">
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
            All files
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
            className={filterButtonClass(
              currentFileOnly,
              !currentFileCandidatePath,
            )}
            disabled={!currentFileCandidatePath}
          >
            Current file
          </button>
        </div>

        {renderProjectSummaryPills()}
        <div className="flex flex-wrap items-center gap-2">
          {isBackgroundDiagnosticsScanActive ? (
            <button
              type="button"
              onClick={handleCancelProjectDiagnosticsScan}
              className={filterButtonClass(
                false,
                !activeDiagnosticsScanCancelAction,
              )}
              disabled={!activeDiagnosticsScanCancelAction}
            >
              <XCircle size={13} className="mr-1.5" />
              Cancel scan
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRunProjectDiagnosticsScan}
              className={filterButtonClass(false, !activeProjectPath)}
              disabled={!activeProjectPath}
            >
              <Play size={13} className="mr-1.5" />
              Scan project
            </button>
          )}
        </div>
      </div>
    </section>
  );

  const buildGroupContextMenuItems = (
    group: DiagnosticsFileGroup,
  ): ContextActionMenuItem[] => [
    {
      label: "Open File",
      icon: <FileWarning size={14} />,
      onSelect: () => onNavigate(group.filePath),
    },
    {
      label: "Copy Relative Path",
      icon: <Copy size={14} />,
      onSelect: () => {
        void copyRelativePath(group.filePath);
      },
    },
    {
      label: "Copy Absolute Path",
      icon: <Copy size={14} />,
      onSelect: () => {
        void copyAbsolutePath(group.filePath);
      },
    },
    {
      label: "Reveal in File Manager",
      icon: <ExternalLink size={14} />,
      onSelect: () => {
        void revealEntry(group.filePath);
      },
    },
  ];

  const buildProblemContextMenuItems = (
    problem: DiagnosticsProblem,
  ): ContextActionMenuItem[] => [
    {
      label: "Go to Problem",
      icon: <ChevronRight size={14} />,
      onSelect: () =>
        onNavigate(problem.filePath, problem.line, problem.column),
    },
    {
      label: "Copy Problem Message",
      icon: <Copy size={14} />,
      onSelect: () => {
        void copyText(problem.message, "Problem message copied");
      },
    },
    {
      label: "Copy File Path",
      icon: <Copy size={14} />,
      onSelect: () => {
        void copyAbsolutePath(problem.filePath);
      },
    },
    {
      label: "Reveal in File Manager",
      icon: <ExternalLink size={14} />,
      onSelect: () => {
        void revealEntry(problem.filePath);
      },
    },
  ];

  const renderProblemRow = (
    problem: DiagnosticsProblem,
    variant: "compact" | "detail",
  ): React.ReactNode => (
    <ContextActionMenu
      key={problem.id}
      items={buildProblemContextMenuItems(problem)}
    >
      <button
        type="button"
        onClick={() =>
          onNavigate(problem.filePath, problem.line, problem.column)
        }
        className={`group flex w-full items-start gap-3 rounded-[18px] border border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)] text-left transition-colors hover:border-[var(--problems-border-strong)] hover:bg-[var(--problems-row-active)] focus:bg-[var(--problems-row-active)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] ${
          variant === "detail" ? "px-4 py-3.5" : "px-3.5 py-3"
        }`}
      >
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-[var(--problems-border)] bg-[var(--problems-surface)]">
          {renderSeverityIcon(problem)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-medium text-[var(--problems-text)]">
            {problem.message}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--problems-text-tertiary)]">
            <span className={problemsPillClass}>
              Ln {problem.line}, Col {problem.column}
            </span>
            {problem.source ? (
              <span className={problemsPillClass}>{problem.source}</span>
            ) : null}
            {problem.code ? (
              <span className={problemsPillClass}>{problem.code}</span>
            ) : null}
          </div>
        </div>
        <ChevronRight
          size={14}
          className="mt-1 shrink-0 text-[var(--problems-text-tertiary)] transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </ContextActionMenu>
  );

  const renderLimitNotice = (
    hiddenCount: number,
    label: "files" | "problems",
  ): React.ReactNode => {
    if (hiddenCount <= 0) {
      return null;
    }

    return (
      <div className="rounded-[16px] border border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)] px-3.5 py-2 text-[12px] font-medium text-[var(--problems-text-secondary)]">
        {hiddenCount} more {label}
      </div>
    );
  };

  const renderScanningProgressNotice = (): React.ReactNode => {
    if (!showInlineScanningProgress) {
      return null;
    }

    return (
      <div className="flex items-center gap-3 rounded-[16px] border border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)] px-3.5 py-2.5 text-[12px] text-[var(--problems-text-secondary)]">
        <LoaderCircle size={14} className="shrink-0 animate-spin" />
        <div className="min-w-0">
          <div className="font-semibold text-[var(--problems-text)]">
            Still scanning
          </div>
          <div className="truncate text-[11px] text-[var(--problems-text-tertiary)]">
            {diagnosticsScanProgressLabel}
          </div>
        </div>
      </div>
    );
  };

  const renderGroupSection = (group: DiagnosticsFileGroup): React.ReactNode => {
    const dominantSeverity = getDominantSeverity(group.summary);
    const tone = severityTone(dominantSeverity);
    const isCurrentFile = group.filePath === currentFileCandidatePath;
    const visibleItems = group.items.slice(0, COMPACT_ITEMS_PER_GROUP_LIMIT);
    const hiddenItemCount = Math.max(
      0,
      group.items.length - visibleItems.length,
    );

    return (
      <ContextActionMenu
        key={group.filePath}
        items={buildGroupContextMenuItems(group)}
      >
        <section className={problemsSectionClass}>
          <div className="border-b border-[var(--problems-border)] px-4 py-4">
            <div className="flex items-start gap-3">
              <div
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border"
                style={{
                  color: tone.color,
                  borderColor: tone.border,
                  background: tone.background,
                }}
              >
                {severityIcon(dominantSeverity, 16)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate text-[14px] font-semibold text-[var(--problems-text)]">
                    {group.fileName}
                  </div>
                  {isCurrentFile ? (
                    <span className={problemsPillClass}>
                      <LocateFixed size={11} />
                      Current file
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 truncate text-[11px] text-[var(--problems-text-tertiary)]">
                  {relativePath(group.filePath, activeProjectPath)}
                </div>
              </div>
              <span
                className={`${summaryValuePillClass} shrink-0`}
                style={summaryPillStyle(dominantSeverity)}
              >
                {group.summary.total}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={problemsPillClass}>{summarizeLabel(group)}</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 px-3 py-3">
            {visibleItems.map((problem) =>
              renderProblemRow(problem, "compact"),
            )}
            {renderLimitNotice(hiddenItemCount, "problems")}
          </div>
        </section>
      </ContextActionMenu>
    );
  };

  const renderExpandedFileCard = (
    group: DiagnosticsFileGroup,
  ): React.ReactNode => {
    const dominantSeverity = getDominantSeverity(group.summary);
    const tone = severityTone(dominantSeverity);
    const isSelected = group.filePath === effectiveSelectedFilePath;
    const isCurrentFile = group.filePath === currentFileCandidatePath;

    return (
      <ContextActionMenu
        key={group.filePath}
        items={buildGroupContextMenuItems(group)}
      >
        <button
          type="button"
          onClick={() => setSelectedFilePath(group.filePath)}
          className="w-full rounded-[22px] border p-4 text-left transition-colors focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
          style={{
            borderColor: isSelected
              ? "var(--problems-border-strong)"
              : "var(--problems-border)",
            background: isSelected
              ? "var(--problems-row-active)"
              : "var(--problems-surface)",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border"
              style={{
                color: tone.color,
                borderColor: tone.border,
                background: tone.background,
              }}
            >
              {severityIcon(dominantSeverity, 16)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-[14px] font-semibold text-[var(--problems-text)]">
                  {group.fileName}
                </div>
                {isCurrentFile ? (
                  <span className={problemsPillClass}>
                    <LocateFixed size={11} />
                    Current file
                  </span>
                ) : null}
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--problems-text-tertiary)]">
                {relativePath(group.filePath, activeProjectPath)}
              </div>
            </div>
            <span
              className={summaryValuePillClass}
              style={summaryPillStyle(dominantSeverity)}
            >
              {group.summary.total}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={problemsPillClass}>{summarizeLabel(group)}</span>
          </div>
        </button>
      </ContextActionMenu>
    );
  };

  const renderStateCard = (): React.ReactNode => {
    return (
      <div
        className={`${problemsSectionClass} flex h-full min-h-0 items-center justify-center p-8`}
      >
        <AnimatePresence mode="wait">
          {showScanningState ? (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="flex max-w-[360px] flex-col items-center gap-4 text-center"
            >
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)]">
                <LoaderCircle
                  size={22}
                  className="animate-spin text-[var(--problems-text-secondary)]"
                />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-[var(--problems-text)]">
                  Scanning diagnostics
                </div>
                <div className="mt-1 text-[12px] text-[var(--problems-text-secondary)]">
                  Collecting the latest workspace issues for this project.
                </div>
              </div>
            </motion.div>
          ) : isWorkspaceDiagnosticsUnavailable ? (
            <motion.div
              key="unsupported"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="max-w-[360px] text-center"
            >
              <div className="text-[14px] font-semibold text-[var(--problems-text)]">
                Diagnostics unavailable
              </div>
              <div className="mt-1 text-[12px] text-[var(--problems-text-secondary)]">
                {diagnosticsUnavailableMessage}
              </div>
            </motion.div>
          ) : isWorkspaceDiagnosticsIncomplete ? (
            <motion.div
              key="incomplete"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="max-w-[360px] text-center"
            >
              <div className="text-[14px] font-semibold text-[var(--problems-text)]">
                Diagnostics incomplete
              </div>
              <div className="mt-1 text-[12px] text-[var(--problems-text-secondary)]">
                {diagnosticsPreload.message ||
                  "Project-wide diagnostics could not verify every supported file yet."}
              </div>
            </motion.div>
          ) : canShowCleanState ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="max-w-[360px] text-center"
            >
              <div className="text-[14px] font-semibold text-[var(--problems-text)]">
                No matching problems
              </div>
              <div className="mt-1 text-[12px] text-[var(--problems-text-secondary)]">
                {currentFileOnly
                  ? "The current file has no problems under the active filters."
                  : "No problems match the current filters right now."}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="pending"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              className="flex max-w-[360px] flex-col items-center gap-4 text-center"
            >
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-[20px] border border-[var(--problems-border)] bg-[var(--problems-bg-tertiary)]">
                <LoaderCircle
                  size={22}
                  className="animate-spin text-[var(--problems-text-secondary)]"
                />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-[var(--problems-text)]">
                  Scanning diagnostics
                </div>
                <div className="mt-1 text-[12px] text-[var(--problems-text-secondary)]">
                  Waiting for project-wide diagnostics coverage.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderCompactBody = (): React.ReactNode => {
    if (displayedGroups.length === 0) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
          {renderStateCard()}
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          data-testid="problems-compact-scroll-region"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="flex min-h-full flex-col gap-3 px-3 py-3">
            {renderScanningProgressNotice()}
            {compactDisplayedGroups.map((group) => renderGroupSection(group))}
            {renderLimitNotice(hiddenCompactGroupCount, "files")}
          </div>
        </div>
      </div>
    );
  };

  const renderSelectedGroupPane = (): React.ReactNode => {
    if (!selectedGroup) {
      return renderStateCard();
    }

    const dominantSeverity = getDominantSeverity(selectedGroup.summary);
    const isSelectedCurrentFile =
      selectedGroup.filePath === currentFileCandidatePath;
    const visibleItems = selectedGroup.items.slice(
      0,
      EXPANDED_DETAIL_ITEM_LIMIT,
    );
    const hiddenItemCount = Math.max(
      0,
      selectedGroup.items.length - visibleItems.length,
    );

    return (
      <section
        data-testid="problems-file-summary-pane"
        className={`${problemsSectionClass} flex h-full min-h-0 flex-col`}
      >
        <div className="border-b border-[var(--problems-border)] px-4 py-4">
          <div className="flex items-start gap-3">
            <div
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border"
              style={summaryPillStyle(dominantSeverity)}
            >
              <FileWarning size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="truncate text-[15px] font-semibold text-[var(--problems-text)]">
                  {selectedGroup.fileName}
                </div>
                {isSelectedCurrentFile ? (
                  <span className={problemsPillClass}>
                    <LocateFixed size={11} />
                    Current file
                  </span>
                ) : null}
                {isPartialWorkspaceDiagnostics ? (
                  <span
                    className={summaryValuePillClass}
                    style={summaryPillStyle("warning")}
                  >
                    <Layers3 size={12} />
                    Diagnostics incomplete
                  </span>
                ) : null}
                {showScanningState || showInlineScanningProgress ? (
                  <span className={problemsPillClass}>
                    <LoaderCircle size={12} className="animate-spin" />
                    Still scanning
                  </span>
                ) : null}
              </div>
              <div className="mt-1 break-all text-[11px] text-[var(--problems-text-tertiary)]">
                {relativePath(selectedGroup.filePath, activeProjectPath)}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className={problemsPillClass}>
              {selectedGroup.summary.total} total
            </span>
            <span
              className={summaryValuePillClass}
              style={summaryPillStyle("error")}
            >
              <AlertCircle size={12} />
              {selectedGroup.summary.errors} errors
            </span>
            <span
              className={summaryValuePillClass}
              style={summaryPillStyle("warning")}
            >
              <AlertTriangle size={12} />
              {selectedGroup.summary.warnings} warnings
            </span>
            <span
              className={summaryValuePillClass}
              style={summaryPillStyle("info")}
            >
              <CircleDot size={12} />
              {selectedGroup.summary.infos} info
            </span>
          </div>
        </div>

        <div
          data-testid="problems-expanded-right-scroll-region"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        >
          <div className="flex flex-col gap-3">
            {visibleItems.map((problem) => renderProblemRow(problem, "detail"))}
            {renderLimitNotice(hiddenItemCount, "problems")}
          </div>
        </div>
      </section>
    );
  };

  const renderExpandedBody = (): React.ReactNode => {
    return (
      <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
        <div
          data-testid="problems-expanded-workspace"
          className="grid h-full min-h-0 grid-cols-[minmax(320px,0.36fr)_minmax(0,0.64fr)] gap-4"
        >
          <div
            data-testid="problems-expanded-sidebar"
            className="flex min-h-0 h-full flex-col overflow-hidden"
          >
            {renderFilterCard()}
            <div
              data-testid="problems-expanded-left-scroll-region"
              className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
            >
              {displayedGroups.length > 0 ? (
                <div className="flex min-h-full flex-col gap-3">
                  {renderScanningProgressNotice()}
                  {expandedDisplayedGroups.map((group) =>
                    renderExpandedFileCard(group),
                  )}
                  {renderLimitNotice(hiddenExpandedGroupCount, "files")}
                </div>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 h-full overflow-hidden">
            {renderSelectedGroupPane()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="problems-panel"
      data-problems-mode={presentationMode}
      data-problems-layout={layoutMode}
      style={panelVars}
      className="relative flex h-full min-h-0 flex-col bg-[var(--problems-bg)] text-[var(--problems-text)]"
    >
      {isExpanded ? (
        renderExpandedBody()
      ) : (
        <>
          <div className="border-b border-[var(--problems-border)] px-3 py-3">
            {renderFilterCard()}
          </div>
          {renderCompactBody()}
        </>
      )}
    </div>
  );
};

export default ProblemsPanel;
