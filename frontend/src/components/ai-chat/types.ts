import type {
  AIChatAction,
  AIChatMentionCandidate,
  AIChatRun,
  AIChatRunEnvelope,
} from "../../../bindings/arlecchino/internal/ai/models";

export type AIChatPresentation = "panel" | "fullscreen" | "preview";

export interface AIChatPanelProps {
  presentation?: AIChatPresentation;
  projectPath?: string;
}

export interface ContextToggles {
  workspace: boolean;
  currentFile: boolean;
  terminalLogs: boolean;
  mnemonic: boolean;
  mcp: boolean;
  skills: boolean;
}

export interface AIChatDisplayPrefs {
  autoScroll: boolean;
  compactCards: boolean;
  showActivity: boolean;
}

export interface AIChatUIState {
  selectedAction: AIChatAction;
  input: string;
  activeSessionId: string;
  selectedProfileId: string;
  selectedWorkflowId: string;
  selectedMentionsBySession: Record<string, AIChatMentionCandidate[]>;
  selectedProviderId: string;
  selectedModel: string;
  selectedReasoningEffort: string;
  context: ContextToggles;
  displayPrefs: AIChatDisplayPrefs;
  providerPopoverOpen: boolean;
  settingsPopoverOpen: boolean;
  activityPopoverOpen: boolean;
  activeRunId: string;
  hydratedRuns: Record<string, AIChatRun>;
}

export type AIChatUIAction =
  | { type: "setAction"; action: AIChatAction }
  | { type: "setProfile"; profileId: string }
  | { type: "setWorkflow"; workflowId: string }
  | { type: "addMention"; mention: AIChatMentionCandidate }
  | { type: "removeMention"; id: string }
  | { type: "setInput"; input: string }
  | { type: "setActiveSession"; sessionId: string; runId?: string }
  | { type: "setProvider"; providerId: string; model?: string }
  | { type: "setModel"; model: string }
  | { type: "setReasoningEffort"; reasoningEffort: string }
  | { type: "setContext"; key: keyof ContextToggles; value: boolean }
  | { type: "setDisplayPref"; key: keyof AIChatDisplayPrefs; value: boolean }
  | { type: "toggleProviderPopover"; open?: boolean }
  | { type: "toggleSettingsPopover"; open?: boolean }
  | { type: "toggleActivityPopover"; open?: boolean }
  | { type: "setActiveRun"; runId: string }
  | { type: "hydrateRun"; run: AIChatRun }
  | { type: "resetComposer" }
  | { type: "ensureProvider"; providerId: string; model?: string };

export interface TranscriptItem {
  envelope: AIChatRunEnvelope;
  run: AIChatRun | null;
}
