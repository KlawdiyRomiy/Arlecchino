import React, { useMemo } from "react";

import { DiagnosticsCompactIndicator } from "../problems/DiagnosticsCompactIndicator";
import { useDiagnosticsStore } from "../../stores/diagnosticsStore";
import { useEditorStore } from "../../stores/editorStore";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

interface StatusBarProps {
  onToggleProblems: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({ onToggleProblems }) => {
  const byFile = useDiagnosticsStore((state) => state.byFile);
  const statusFile = useEditorStore((state) => state.statusFile);
  const cursorPosition = useEditorStore((state) => state.cursorPosition);
  const showCompactDiagnostics = useEditorSettingsStore(
    (state) => state.showCompactDiagnostics,
  );
  const activeProjectPath = useWorkspaceStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeId)?.path ??
      null,
  );
  const projectSummary = useMemo(
    () => useDiagnosticsStore.getState().getProjectSummary(activeProjectPath),
    [activeProjectPath, byFile],
  );
  const statusTextClass = "text-[rgba(248,250,252,0.82)]";
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
  const positionLabel = statusFile.path
    ? `Ln ${cursorPosition.line}, Col ${cursorPosition.col}`
    : "Ln -, Col -";

  return (
    <div className="h-6 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] flex items-center px-4 text-[10px] select-none font-mono z-50">
      <div className="flex items-center gap-4">
        {showCompactDiagnostics ? (
          <DiagnosticsCompactIndicator
            summary={projectSummary}
            onClick={onToggleProblems}
          />
        ) : null}

        {showCompactDiagnostics ? (
          <div className="w-px h-3 bg-[var(--border-subtle)]" />
        ) : null}

        <div className="flex items-center gap-1.5 hover:text-[var(--text-secondary)] px-2 py-0.5 rounded cursor-pointer transition-colors">
          <span data-testid="statusbar-language" className={statusTextClass}>
            {activeLanguageLabel}
          </span>
        </div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div className="flex items-center gap-1.5 hover:text-[var(--text-secondary)] px-2 py-0.5 rounded cursor-pointer transition-colors">
          <span className={statusTextClass}>{activeProjectLabel}</span>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-4">
        <div
          data-testid="statusbar-file"
          className={`${statusTextClass} max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap`}
        >
          {activeFileDisplay}
        </div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div data-testid="statusbar-position" className={statusTextClass}>
          {positionLabel}
        </div>

        <div className="w-px h-3 bg-[var(--border-subtle)]" />

        <div className={statusTextClass}>UTF-8</div>
      </div>
    </div>
  );
};
