import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";

export type TerminalMode = "shell" | "tui" | "agent_cli" | "agent_tui";
export type TerminalPowerProfile = "normal" | "soft_pause" | "hard_pause";
export type TUIAssistAnchor = "left" | "right" | "top" | "bottom";

export interface TUIAssistState {
  active: boolean;
  panel: "explorer" | "aiChat" | "git" | "browser" | null;
  ratio: number;
  anchor: TUIAssistAnchor;
}

export interface TerminalSecurityPolicy {
  enabled: boolean;
  allowSensitiveInspection: boolean;
  requireWriteApproval: boolean;
  blockedFileNames: string[];
}

export interface TerminalAccessDecision {
  allowed: boolean;
  reason: string;
}

export interface TerminalSession {
  id: string;
  name: string;
  projectPath: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  streamDecoder: TextDecoder;
  isAttached: boolean;
  mode: TerminalMode;
  modeReason: string;
  modeConfidence: number;
  modeSourceSignals: string[];
  modeUpdatedAt: number;
}

export interface TerminalPane {
  id: string;
  tabIds: string[];
  activeTabId: string;
}

export interface TerminalShellState {
  phase: string;
  cwd: string;
  lastExitCode: number | null;
  updatedAt: number;
  raw: string;
}

export interface TerminalSemanticEntry {
  kind: string;
  path: string;
  line: number;
  column: number;
  severity: string;
  message: string;
  imageDataUrl: string;
  timestamp: number;
}

export interface ClosedTerminalTab {
  paneId: string;
  name: string;
}

export type SplitDirection = "horizontal" | "vertical" | null;
