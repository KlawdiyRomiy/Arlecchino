import React, { useMemo } from "react";

import { DiagnosticsCompactIndicator } from "../problems/DiagnosticsCompactIndicator";
import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import { useEditorStore } from "../../stores/editorStore";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import {
  resolveDiagnosticsProjectPath,
  useWorkspaceStore,
} from "../../stores/workspaceStore";
import {
  resolveActiveDiagnosticsProjectPath,
  useProjectDiagnosticsPreload,
} from "../../utils/projectBoundState";
import { useBackgroundShellStatus } from "../../shell/backgroundShellStatus";
import { getCurrentProjectSessionId } from "../../shell/projectSessionRoute";

interface StatusBarProps {
  onToggleProblems: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({ onToggleProblems }) => {
  const diagnosticsStoreProjectSummary = useDiagnosticsStore(
    (state) => state.projectSummary,
  );
  const diagnosticsByFile = useDiagnosticsStore((state) => state.byFile);
  const diagnosticsRuntimeStatus = useDiagnosticsStore(
    (state) => state.runtimeStatus,
  );
  const diagnosticsStoreProjectPath = useDiagnosticsStore(
    (state) => state.activeProjectPath,
  );
  const statusFile = useEditorStore((state) => state.statusFile);
  const cursorPosition = useEditorStore((state) => state.cursorPosition);
  const showCompactDiagnostics = useEditorSettingsStore(
    (state) => state.showCompactDiagnostics,
  );
  const workspaceProjectPath = useWorkspaceStore((state) =>
    resolveDiagnosticsProjectPath(
      state.projects,
      state.activeId,
      state.pendingId,
      state.switchSourceId,
    ),
  );
  const diagnosticsPreload = useProjectDiagnosticsPreload();
  const backgroundShell = useBackgroundShellStatus();
  const projectSessionId = getCurrentProjectSessionId();
  const activeProjectPath = resolveActiveDiagnosticsProjectPath({
    workspaceProjectPath,
    diagnosticsPreloadProjectPath: diagnosticsPreload.projectPath,
    diagnosticsRuntimeProjectPath: diagnosticsRuntimeStatus.projectPath,
    diagnosticsStoreProjectPath,
  });
  const projectSummary = useMemo(
    () =>
      activeProjectPath
        ? useDiagnosticsStore.getState().getProjectSummary(activeProjectPath)
        : diagnosticsStoreProjectSummary,
    [activeProjectPath, diagnosticsByFile, diagnosticsStoreProjectSummary],
  );
  const statusTextClass = "text-[11px] text-[var(--text-secondary)]";
  const chipClass =
    "shell-cluster-soft flex min-h-[32px] items-center gap-1.5 px-3 transition-colors hover:border-[var(--shell-border-strong)] hover:text-[var(--text-primary)]";
  const activeProjectLabel = useMemo(() => {
    if (!activeProjectPath) {
      return "No project";
    }

    const parts = activeProjectPath.split(/[/\\]/).filter(Boolean);
    return parts.at(-1) ?? activeProjectPath;
  }, [activeProjectPath]);
  const activeLanguageLabel = useMemo(() => {
    if (!statusFile.language) {
      return "Plain Text";
    }

    const knownLabels: Record<string, string> = {
      typescript: "TypeScript",
      javascript: "JavaScript",
      plaintext: "Plain Text",
      markdown: "Markdown",
    };

    return (
      knownLabels[statusFile.language.toLowerCase()] ??
      statusFile.language.charAt(0).toUpperCase() + statusFile.language.slice(1)
    );
  }, [statusFile.language]);
  const activeFileDisplay = useMemo(() => {
    if (!statusFile.path) {
      return "No file";
    }

    if (
      activeProjectPath &&
      statusFile.path.startsWith(`${activeProjectPath}/`)
    ) {
      return statusFile.path.slice(activeProjectPath.length + 1);
    }

    return statusFile.name || statusFile.path;
  }, [activeProjectPath, statusFile.name, statusFile.path]);
  const activeFileSegments = useMemo(() => {
    if (!statusFile.path) {
      return { directory: "", fileName: "No file" };
    }

    const normalized = activeFileDisplay.replace(/\\/g, "/");
    const splitIndex = normalized.lastIndexOf("/");
    if (splitIndex === -1) {
      return { directory: "", fileName: normalized };
    }

    return {
      directory: normalized.slice(0, splitIndex + 1),
      fileName: normalized.slice(splitIndex + 1),
    };
  }, [activeFileDisplay, statusFile.path]);
  const positionLabel = statusFile.path
    ? `Ln ${cursorPosition.line}, Col ${cursorPosition.col}`
    : "Ln -, Col -";
  const hasActiveDiagnosticsScan = useMemo(
    () =>
      backgroundShell.jobs.some(
        (job) =>
          job.kind === "diagnostics-scan" &&
          job.projectPath === activeProjectPath &&
          (!job.sessionId || job.sessionId === projectSessionId) &&
          (job.status === "running" || job.status === "queued"),
      ),
    [activeProjectPath, backgroundShell.jobs, projectSessionId],
  );
  const diagnosticsIndicatorState = useMemo(() => {
    const preloadMatchesProject =
      diagnosticsPreload.projectPath === activeProjectPath;
    const runtimeMatchesProject =
      diagnosticsRuntimeStatus.projectPath === activeProjectPath;
    const coverageState = preloadMatchesProject
      ? diagnosticsPreload.coverageState
      : activeProjectPath
        ? "pending"
        : "complete";
    const hasIncompleteCounters =
      preloadMatchesProject &&
      (diagnosticsPreload.skippedCandidates > 0 ||
        diagnosticsPreload.oversizedCandidates > 0 ||
        diagnosticsPreload.unsafeCandidates > 0 ||
        diagnosticsPreload.unsupportedCandidates > 0 ||
        diagnosticsPreload.noServerCandidates > 0 ||
        diagnosticsPreload.openFailedCandidates > 0 ||
        diagnosticsPreload.publicationTimeoutCandidates > 0);

    if (projectSummary.total > 0) {
      return "default" as const;
    }
    if (
      activeProjectPath &&
      runtimeMatchesProject &&
      (diagnosticsRuntimeStatus.state === "unavailable" ||
        diagnosticsRuntimeStatus.state === "error")
    ) {
      return "unavailable" as const;
    }
    if (
      activeProjectPath &&
      !diagnosticsPreload.active &&
      coverageState === "unavailable"
    ) {
      return "unavailable" as const;
    }
    if (
      activeProjectPath &&
      (coverageState === "incomplete" ||
        coverageState === "canceled" ||
        (preloadMatchesProject && diagnosticsPreload.bounded) ||
        hasIncompleteCounters ||
        (preloadMatchesProject &&
          diagnosticsPreload.totalCandidates > 0 &&
          diagnosticsPreload.selectedCandidates <
            diagnosticsPreload.totalCandidates))
    ) {
      return "incomplete" as const;
    }
    if (
      activeProjectPath &&
      (hasActiveDiagnosticsScan ||
        (preloadMatchesProject && diagnosticsPreload.active))
    ) {
      return "scanning" as const;
    }
    if (activeProjectPath && coverageState === "pending") {
      return "scan" as const;
    }
    return "default" as const;
  }, [
    activeProjectPath,
    diagnosticsPreload,
    diagnosticsRuntimeStatus,
    hasActiveDiagnosticsScan,
    projectSummary.total,
  ]);

  return (
    <div
      className="z-50 flex h-11 select-none items-center bg-transparent px-3 pb-1.5 tracking-[0.08em] tabular-nums"
      data-testid="statusbar"
    >
      <div className="flex items-center gap-2">
        <div className="shell-cluster-soft min-h-[32px] px-2.5">
          {showCompactDiagnostics ? (
            <DiagnosticsCompactIndicator
              summary={projectSummary}
              onClick={onToggleProblems}
              state={diagnosticsIndicatorState}
            />
          ) : (
            <span className={statusTextClass}>Diagnostics hidden</span>
          )}
        </div>

        <div className={chipClass}>
          <span data-testid="statusbar-language" className={statusTextClass}>
            {activeLanguageLabel}
          </span>
        </div>

        <div className={chipClass}>
          <span className={statusTextClass}>{activeProjectLabel}</span>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div
          data-testid="statusbar-file"
          className="shell-cluster-soft max-w-[360px] overflow-hidden whitespace-nowrap px-3 text-[11px]"
        >
          {activeFileSegments.directory ? (
            <>
              <span className="truncate text-[var(--text-muted)]">
                {activeFileSegments.directory}
              </span>
              <span className="truncate text-[var(--text-primary)]">
                {activeFileSegments.fileName}
              </span>
            </>
          ) : (
            <span className={statusTextClass}>
              {activeFileSegments.fileName}
            </span>
          )}
        </div>

        <div className={chipClass}>
          <span data-testid="statusbar-position" className={statusTextClass}>
            {positionLabel}
          </span>
        </div>

        <div className="shell-cluster-soft min-h-[32px] px-3 text-[11px] text-[var(--text-secondary)]">
          UTF-8
        </div>
      </div>
    </div>
  );
};
