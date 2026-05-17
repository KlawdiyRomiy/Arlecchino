import {
  countLines,
  fingerprintText,
  formatIDEContextEventLine,
  useIDEContextLedgerStore,
} from "./ideContextLedgerStore";
import { useDiagnosticsStore } from "./diagnosticsStore";
import { useGitStore } from "./gitStore";
import { useTerminalStore } from "./terminalStore";

export interface ActiveEditorIDEContext {
  path: string;
  content: string;
  language: string;
  line: number;
  column: number;
}

export const buildIDEContextDocument = (
  activeEditor: ActiveEditorIDEContext,
): string => {
  const ledger = useIDEContextLedgerStore.getState();
  const recentEvents = ledger.events.slice(-18);
  const git = useGitStore.getState();
  const diagnostics = useDiagnosticsStore.getState();
  const terminal = useTerminalStore.getState();
  const activeTerminalPane = terminal.panes.find(
    (pane) => pane.id === terminal.activePaneId,
  );
  const activeTerminalId = activeTerminalPane?.activeTabId ?? "";
  const activeTerminal = activeTerminalId
    ? terminal.sessions.get(activeTerminalId)
    : undefined;

  const lines: string[] = ["Arlecchino IDE context ledger v1"];
  if (activeEditor.path) {
    lines.push(
      `active_file=${activeEditor.path}`,
      `active_file_language=${activeEditor.language || "unknown"}`,
      `active_file_cursor=${activeEditor.line}:${activeEditor.column}`,
      `active_file_dirty_hash=${fingerprintText(activeEditor.content)}`,
      `active_file_lines=${countLines(activeEditor.content)}`,
      `active_file_bytes=${activeEditor.content.length}`,
    );
  } else {
    lines.push("active_file=");
  }

  if (git.projectPath) {
    lines.push(
      `git_branch=${git.branch.current || "unknown"}`,
      `git_ahead=${git.branch.ahead}`,
      `git_behind=${git.branch.behind}`,
      `git_staged=${git.stagedFiles.length}`,
      `git_unstaged=${git.unstagedFiles.length}`,
      `git_conflicted=${git.conflictedFiles.length}`,
    );
  }

  const projectDiagnostics = diagnostics.getProjectSummary();
  if (
    projectDiagnostics.total > 0 ||
    diagnostics.runtimeStatus.state !== "idle"
  ) {
    lines.push(
      `diagnostics_total=${projectDiagnostics.total}`,
      `diagnostics_errors=${projectDiagnostics.errors}`,
      `diagnostics_warnings=${projectDiagnostics.warnings}`,
      `diagnostics_state=${diagnostics.runtimeStatus.state}`,
    );
  }

  if (activeTerminal) {
    const shell = terminal.sessionShellState.get(activeTerminal.id);
    lines.push(
      `active_terminal=${activeTerminal.id}`,
      `active_terminal_mode=${activeTerminal.mode}`,
      `active_terminal_cwd=${shell?.cwd ?? activeTerminal.projectPath ?? ""}`,
    );
  }

  if (recentEvents.length > 0) {
    lines.push("recent_events:");
    recentEvents.forEach((event) =>
      lines.push(`- ${formatIDEContextEventLine(event)}`),
    );
  }

  return lines.join("\n");
};
