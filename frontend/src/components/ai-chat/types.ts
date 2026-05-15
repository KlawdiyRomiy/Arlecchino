import type {
  AIChatAction,
  AIChatRun,
  AIChatRunEnvelope,
} from "../../../bindings/arlecchino/internal/ai/models";

export type AIChatPresentation = "panel" | "fullscreen" | "preview";

export interface AIChatPanelProps {
  presentation?: AIChatPresentation;
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
  selectedProviderId: string;
  selectedModel: string;
  context: ContextToggles;
  displayPrefs: AIChatDisplayPrefs;
  providerPopoverOpen: boolean;
  settingsPopoverOpen: boolean;
  activeRunId: string;
  hydratedRuns: Record<string, AIChatRun>;
  secretDraft: string;
}

export type AIChatUIAction =
  | { type: "setAction"; action: AIChatAction }
  | { type: "setInput"; input: string }
  | { type: "setProvider"; providerId: string; model?: string }
  | { type: "setModel"; model: string }
  | { type: "setContext"; key: keyof ContextToggles; value: boolean }
  | { type: "setDisplayPref"; key: keyof AIChatDisplayPrefs; value: boolean }
  | { type: "toggleProviderPopover"; open?: boolean }
  | { type: "toggleSettingsPopover"; open?: boolean }
  | { type: "setActiveRun"; runId: string }
  | { type: "hydrateRun"; run: AIChatRun }
  | { type: "setSecretDraft"; value: string }
  | { type: "resetComposer" }
  | { type: "ensureProvider"; providerId: string; model?: string };

export interface TranscriptItem {
  envelope: AIChatRunEnvelope;
  run: AIChatRun | null;
}
