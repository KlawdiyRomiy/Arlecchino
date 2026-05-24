import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GitBranch,
  History,
  MessageSquarePlus,
  Search,
  Settings,
} from "lucide-react";
import {
  AIAcceptPlan,
  AIApplyPatchArtifact,
  AIApproveMnemonicEntryProposal,
  AICancelChatRun,
  AICancelProviderAuth,
  AIDeleteChatSession,
  AIExecuteToolCall,
  AIGetApprovalPolicy,
  AIGetChatRun,
  AIGetChatRunEnvelope,
  AIGetConsentPolicy,
  AIGetContextPreview,
  AIGetEmbeddingStatus,
  AIGetStatus,
  AIListProviderRuntimes,
  AIListAgentProfiles,
  AIListChatActions,
  AIListChatRunArtifacts,
  AIListChatRuns,
  AIListContextProviders,
  AIListEgressRecords,
  AIListMnemonicEntries,
  AIListModelCapabilities,
  AIListPendingApprovals,
  AIListPromptWorkflows,
  AIListTools,
  AIListToolAudit,
  AIProbeModelCapability,
  AIRefreshLocalProviders,
  AIRequestPlanRevision,
  AIRollbackPatchCheckpoint,
  AISaveConsentPolicy,
  AISaveMnemonicEntry,
  AISearchMnemonic,
  AIStartLinkedReview,
  AIStartAgentAuthRun,
  AIStartChatRun,
  AIStartProviderRuntime,
  AIStartProviderOAuth,
  AIStopProviderRuntime,
  AISubmitQuestionAnswer,
  AISuggestChatMentions,
  AIUpdateMnemonicEntry,
  type AIProviderRuntimeDescriptor,
  type AIProviderRuntimeModel,
  type AIProviderAuthSession,
} from "../../wails/app";
import { EventsOn } from "../../wails/runtime";
import {
  AIChatAction,
  AIChatRunEnvelope,
  type AIChatRunNotice,
  AIContextItemKind,
  AIToolCallAction,
  type AIChatActionDescriptor,
  type AIChatMentionCandidate,
  type AIChatMentionQuery,
  type AIChatRun,
  type AIChatRunRequest,
  type AIChatRunArtifact,
  type AIQuestionAnswerRequest,
  type AIContextRequest,
  type AIContextSnapshot,
  type AIEgressRecord,
  type AIRunTimelineEvent,
  type AIModelCapabilityDescriptor,
  type AIPendingApproval,
  type AIProviderCapability,
  type AIStatus,
  type AIToolProposal,
  type AIToolAuditRecord,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { PanelPosition } from "../ui/FloatingPanel";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import {
  AnimatePresence,
  LazyMotion,
  LayoutGroup,
  domAnimation,
  m,
  useReducedMotion,
} from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../../stores/editorStore";
import { buildIDEContextDocument } from "../../stores/ideContextDocument";
import {
  type AIChatUIPreferences,
  useEditorSettingsStore,
} from "../../stores/editorSettingsStore";
import { useAIChatStore } from "../../stores/aiChatStore";
import { useAIInlinePatchStore } from "../../stores/aiInlinePatchStore";
import { useAppNotificationStore } from "../../stores/appNotificationStore";
import { usePerformanceStore } from "../../stores/performanceStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { dispatchApplicationMenuAction } from "../../utils/applicationMenu";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";
import { AIChatHeader } from "./AIChatHeader";
import {
  ActivityStatusPopover,
  buildActivityStatusItems,
  summarizeActivityStatus,
} from "./ActivityTimeline";
import { AgentConsole } from "./AgentConsole";
import { ChatGitReview } from "./ChatGitReview";
import { ChatHistoryRail } from "./ChatHistoryRail";
import { ChatComposer } from "./ChatComposer";
import { EmptyState } from "./EmptyState";
import { RunCard } from "./RunCard";
import {
  getProviderDisabledReason,
  isInteractiveFallbackRuntime,
  isExternalAgentProvider,
  isSupportedLocalChatProvider,
  jsonlExecRuntimeFamily,
  modelAgentRuntimeFamily,
  selectDefaultProvider,
  sortProviders,
} from "./providerPresentation";
import {
  defaultAIApprovalPolicy,
  defaultAIConsentPolicy,
  defaultAIEmbeddingStatus,
  defaultAIStatus,
  normalizeAIAgentProfiles,
  normalizeAIApprovalPolicy,
  normalizeAIChatActions,
  normalizeAIChatArtifacts,
  normalizeAIChatRuns,
  normalizeAIConsentPolicy,
  normalizeAIContextProviders,
  normalizeAIContextSnapshot,
  normalizeAIEgressRecords,
  normalizeAIEmbeddingStatus,
  normalizeAIMnemonicEntries,
  normalizeAIModelCapabilities,
  normalizeAIPendingApprovals,
  normalizeAIPromptWorkflows,
  normalizeAIProviderRuntimes,
  normalizeAIStatus,
  normalizeAIToolAudit,
  normalizeAITools,
} from "./aiRuntimeGuards";
import { mergeModelOptions } from "./providerModelOptions";
import { askReadonlyProfileId, minimalGeneralProfileId } from "./types";
import type {
  AIChatPanelProps,
  AIChatUIAction,
  AIChatUIState,
  ContextToggles,
} from "./types";
import "./ai-chat.css";

const defaultChatSessionId = "default";
const chatHydrationBatchSize = 4;
const chatHydrationMaxAttempts = 3;
const chatHydrationRetryDelayMs = 750;

const mergeProviderDescriptorList = (
  current: readonly AIProviderDescriptor[],
  provider: AIProviderDescriptor,
): AIProviderDescriptor[] => {
  const next = current.filter((candidate) => candidate.id !== provider.id);
  next.push(provider);
  return next;
};

const isProviderAuthRun = (
  run: AIChatRun | null | undefined,
  providerId: string,
): run is AIChatRun =>
  Boolean(
    run?.id &&
    providerId &&
    run.providerId === providerId &&
    run.agentRuntime?.authFlow,
  );

const modelForProviderSelection = (
  provider: AIProviderDescriptor,
  status: AIStatus | null,
): string => {
  if (status?.activeProviderId === provider.id && status.activeModel) {
    return status.activeModel;
  }
  return provider.models?.[0]?.id ?? "";
};

const noContext: ContextToggles = {
  workspace: false,
  currentFile: false,
  terminalLogs: false,
  mnemonic: false,
  mcp: false,
  skills: false,
  continuity: false,
};

export const defaultChatContext: ContextToggles = {
  ...noContext,
  currentFile: true,
  mnemonic: true,
  continuity: true,
};

const previewableToolIds = new Set([
  "context.read",
  "diagnostics.read",
  "file.read_range",
  "file.edit.preview",
  "file.create.preview",
  "file.patch.preview",
  "workspace.grep",
  "git.preview",
  "mcp.preview",
  "mcp.execute",
  "subagent.preview",
  "terminal.preview",
]);

interface ActiveEditorContext {
  path: string;
  content: string;
  language: string;
  line: number;
  column: number;
  documentVersion: string;
}

interface ActiveTerminalContext {
  raw: string;
  cwd: string;
}

type ReasoningModelDescriptor = {
  reasoningEfforts?: string[];
};

type ArtifactMap = Record<string, AIChatRunArtifact[]>;

export function activeEditorContextFromStore(
  store: ReturnType<typeof useEditorStore.getState>,
): ActiveEditorContext {
  const activeTab = store.getActiveTab(store.activePaneId);
  const context = {
    path: activeTab?.path ?? store.statusFile.path ?? "",
    content: activeTab?.content ?? "",
    language: activeTab?.language ?? store.statusFile.language ?? "",
    line: store.cursorPosition.line,
    column: store.cursorPosition.col,
  };
  return {
    ...context,
    documentVersion: buildIDEContextDocument(context),
  };
}

type DrawerId = "history" | "review";
type DrawerSnapEdge = Extract<PanelPosition, "left" | "right">;

const initialState: AIChatUIState = {
  selectedAction: AIChatAction.AIChatActionAsk,
  input: "",
  activeSessionId: defaultChatSessionId,
  selectedProfileId: askReadonlyProfileId,
  selectedWorkflowId: "",
  selectedMentionsBySession: {},
  selectedProviderId: "",
  providerSelectionSource: "auto",
  selectedModel: "",
  selectedReasoningEffort: "",
  context: defaultChatContext,
  displayPrefs: {
    autoScroll: true,
    compactCards: false,
    showActivity: true,
  },
  providerPopoverOpen: false,
  settingsPopoverOpen: false,
  activityPopoverOpen: false,
  activeRunId: "",
  hydratedRuns: {},
};

function initialAIChatStateFromPrefs(
  preferences: AIChatUIPreferences,
): AIChatUIState {
  return {
    ...initialState,
    context: {
      ...initialState.context,
      ...preferences.defaultContext,
    },
    displayPrefs: {
      ...initialState.displayPrefs,
      ...preferences.displayPrefs,
    },
  };
}

interface AIChatPanelChromeState {
  historyOpen: boolean;
  reviewOpen: boolean;
  reviewExpanded: boolean;
  controlsCollapsed: boolean;
  leftControlsCollapsed: boolean;
  rightControlsCollapsed: boolean;
  historyEdge: DrawerSnapEdge;
  reviewEdge: DrawerSnapEdge;
  historyWidth: number;
  reviewWidth: number;
  historyInset: number;
  reviewInset: number;
  sessionSearchOpen: boolean;
  historySearch: string;
  reviewSearch: string;
  sessionSearch: string;
  diffSearch: string;
  commitMessage: string;
}

type AIChatPanelChromeAction =
  | { type: "patch"; value: Partial<AIChatPanelChromeState> }
  | { type: "openDrawer"; drawer: DrawerId }
  | { type: "closeDrawer"; drawer: DrawerId }
  | { type: "snapDrawer"; drawer: DrawerId; edge: DrawerSnapEdge }
  | { type: "resizeHistory"; edge: "start" | "end"; delta: number }
  | { type: "resizeReview"; edge: "start" | "end"; delta: number };

const fullscreenDrawerRailInset = 66;

const initialChromeState: AIChatPanelChromeState = {
  historyOpen: false,
  reviewOpen: false,
  reviewExpanded: false,
  controlsCollapsed: false,
  leftControlsCollapsed: false,
  rightControlsCollapsed: false,
  historyEdge: "left",
  reviewEdge: "right",
  historyWidth: 270,
  reviewWidth: 520,
  historyInset: fullscreenDrawerRailInset,
  reviewInset: fullscreenDrawerRailInset,
  sessionSearchOpen: false,
  historySearch: "",
  reviewSearch: "",
  sessionSearch: "",
  diffSearch: "",
  commitMessage: "",
};

function chatSessionKey(sessionId: string): string {
  return sessionId.trim() || defaultChatSessionId;
}

function mentionsForSession(
  state: AIChatUIState,
  sessionId = state.activeSessionId,
): AIChatMentionCandidate[] {
  return state.selectedMentionsBySession[chatSessionKey(sessionId)] ?? [];
}

function selectionFromMentions(mentions: AIChatMentionCandidate[]) {
  return {
    selectedProfileId:
      mentions.find((mention) => mention.profileId)?.profileId ??
      askReadonlyProfileId,
    selectedWorkflowId:
      mentions.find((mention) => mention.workflowId)?.workflowId ?? "",
  };
}

function setMentionsForSession(
  state: AIChatUIState,
  mentions: AIChatMentionCandidate[],
  sessionId = state.activeSessionId,
): Record<string, AIChatMentionCandidate[]> {
  const key = chatSessionKey(sessionId);
  if (mentions.length === 0) {
    const next = { ...state.selectedMentionsBySession };
    delete next[key];
    return next;
  }
  return { ...state.selectedMentionsBySession, [key]: mentions };
}

function reducer(state: AIChatUIState, action: AIChatUIAction): AIChatUIState {
  switch (action.type) {
    case "setAction": {
      const actionMentions = mentionsForSession(state).filter(
        (mention) => !mention.workflowId,
      );
      const profileId =
        action.profileId ??
        (action.action === AIChatAction.AIChatActionAsk
          ? askReadonlyProfileId
          : "");
      return {
        ...state,
        selectedAction: action.action,
        selectedProfileId: profileId,
        selectedWorkflowId: "",
        selectedMentionsBySession: setMentionsForSession(state, actionMentions),
      };
    }
    case "setProfile":
      return { ...state, selectedProfileId: action.profileId };
    case "setWorkflow":
      return { ...state, selectedWorkflowId: action.workflowId };
    case "addMention": {
      const mentions = mentionsForSession(state).filter(
        (mention) => mention.id !== action.mention.id,
      );
      const nextMentions = [...mentions, action.mention];
      return {
        ...state,
        selectedMentionsBySession: setMentionsForSession(state, nextMentions),
        selectedProfileId: action.mention.profileId ?? state.selectedProfileId,
        selectedWorkflowId:
          action.mention.workflowId ?? state.selectedWorkflowId,
      };
    }
    case "removeMention": {
      const currentMentions = mentionsForSession(state);
      const removed = currentMentions.find(
        (mention) => mention.id === action.id,
      );
      const nextMentions = currentMentions.filter(
        (mention) => mention.id !== action.id,
      );
      return {
        ...state,
        selectedMentionsBySession: setMentionsForSession(state, nextMentions),
        selectedProfileId:
          removed?.profileId && removed.profileId === state.selectedProfileId
            ? state.selectedAction === AIChatAction.AIChatActionAsk
              ? askReadonlyProfileId
              : ""
            : state.selectedProfileId,
        selectedWorkflowId:
          removed?.workflowId && removed.workflowId === state.selectedWorkflowId
            ? ""
            : state.selectedWorkflowId,
      };
    }
    case "setInput":
      return { ...state, input: action.input };
    case "setActiveSession": {
      const sessionId = chatSessionKey(action.sessionId);
      return {
        ...state,
        activeSessionId: sessionId,
        activeRunId: action.runId ?? "",
        ...selectionFromMentions(mentionsForSession(state, sessionId)),
      };
    }
    case "setProvider":
      return {
        ...state,
        selectedProviderId: action.providerId,
        providerSelectionSource: action.source ?? "auto",
        selectedModel: action.model ?? state.selectedModel,
        selectedReasoningEffort: "",
        providerPopoverOpen: false,
        activityPopoverOpen: false,
      };
    case "setModel":
      return {
        ...state,
        selectedModel: action.model,
        selectedReasoningEffort: "",
      };
    case "setReasoningEffort":
      return { ...state, selectedReasoningEffort: action.reasoningEffort };
    case "setContext":
      return {
        ...state,
        context: { ...state.context, [action.key]: action.value },
      };
    case "setContextPrefs":
      return {
        ...state,
        context: { ...state.context, ...action.context },
      };
    case "setDisplayPref":
      return {
        ...state,
        displayPrefs: { ...state.displayPrefs, [action.key]: action.value },
      };
    case "setDisplayPrefs":
      return {
        ...state,
        displayPrefs: { ...state.displayPrefs, ...action.displayPrefs },
      };
    case "toggleProviderPopover": {
      const providerPopoverOpen = action.open ?? !state.providerPopoverOpen;
      return {
        ...state,
        providerPopoverOpen,
        settingsPopoverOpen: providerPopoverOpen
          ? false
          : state.settingsPopoverOpen,
        activityPopoverOpen: providerPopoverOpen
          ? false
          : state.activityPopoverOpen,
      };
    }
    case "toggleSettingsPopover": {
      const settingsPopoverOpen = action.open ?? !state.settingsPopoverOpen;
      return {
        ...state,
        settingsPopoverOpen,
        providerPopoverOpen: settingsPopoverOpen
          ? false
          : state.providerPopoverOpen,
        activityPopoverOpen: settingsPopoverOpen
          ? false
          : state.activityPopoverOpen,
      };
    }
    case "toggleActivityPopover": {
      const activityPopoverOpen = action.open ?? !state.activityPopoverOpen;
      return {
        ...state,
        activityPopoverOpen,
        providerPopoverOpen: activityPopoverOpen
          ? false
          : state.providerPopoverOpen,
        settingsPopoverOpen: activityPopoverOpen
          ? false
          : state.settingsPopoverOpen,
      };
    }
    case "setActiveRun":
      return { ...state, activeRunId: action.runId };
    case "hydrateRun":
      return {
        ...state,
        hydratedRuns: { ...state.hydratedRuns, [action.run.id]: action.run },
      };
    case "resetComposer":
      return {
        ...state,
        input: "",
        selectedAction: AIChatAction.AIChatActionAsk,
        selectedProfileId: askReadonlyProfileId,
        selectedWorkflowId: "",
        selectedMentionsBySession: setMentionsForSession(state, []),
      };
    case "ensureProvider":
      if (state.selectedProviderId) return state;
      return {
        ...state,
        selectedProviderId: action.providerId,
        providerSelectionSource: action.source ?? "auto",
        selectedModel: action.model ?? state.selectedModel,
      };
    default:
      return state;
  }
}

function chromeReducer(
  state: AIChatPanelChromeState,
  action: AIChatPanelChromeAction,
): AIChatPanelChromeState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "openDrawer": {
      if (action.drawer === "history") {
        const nextState = { ...state, historyOpen: true };
        if (state.reviewOpen && state.reviewEdge === state.historyEdge) {
          nextState.reviewEdge = oppositeEdge(state.historyEdge);
        }
        return nextState;
      }
      const nextState = { ...state, reviewOpen: true };
      if (state.historyOpen && state.historyEdge === state.reviewEdge) {
        nextState.historyEdge = oppositeEdge(state.reviewEdge);
      }
      return nextState;
    }
    case "closeDrawer":
      return action.drawer === "history"
        ? { ...state, historyOpen: false }
        : { ...state, reviewOpen: false };
    case "snapDrawer": {
      if (action.drawer === "history") {
        const nextState = {
          ...state,
          historyEdge: action.edge,
          historyInset: fullscreenDrawerRailInset,
        };
        if (state.reviewOpen && state.reviewEdge === action.edge) {
          nextState.reviewEdge = oppositeEdge(action.edge);
          nextState.reviewInset = fullscreenDrawerRailInset;
        }
        return nextState;
      }
      const nextState = {
        ...state,
        reviewEdge: action.edge,
        reviewInset: fullscreenDrawerRailInset,
      };
      if (state.historyOpen && state.historyEdge === action.edge) {
        nextState.historyEdge = oppositeEdge(action.edge);
        nextState.historyInset = fullscreenDrawerRailInset;
      }
      return nextState;
    }
    case "resizeHistory":
      if (action.edge === "start") {
        const nextWidth = clamp(state.historyWidth - action.delta, 220, 440);
        return {
          ...state,
          historyInset: clamp(
            state.historyInset + state.historyWidth - nextWidth,
            fullscreenDrawerRailInset,
            520,
          ),
          historyWidth: nextWidth,
        };
      }
      return {
        ...state,
        historyWidth: clamp(state.historyWidth + action.delta, 220, 440),
      };
    case "resizeReview":
      if (action.edge === "end") {
        const nextWidth = clamp(state.reviewWidth + action.delta, 360, 760);
        return {
          ...state,
          reviewInset: clamp(
            state.reviewInset - (nextWidth - state.reviewWidth),
            fullscreenDrawerRailInset,
            520,
          ),
          reviewWidth: nextWidth,
        };
      }
      return {
        ...state,
        reviewWidth: clamp(state.reviewWidth - action.delta, 360, 760),
      };
    default:
      return state;
  }
}

function oppositeEdge(edge: DrawerSnapEdge): DrawerSnapEdge {
  return edge === "left" ? "right" : "left";
}

function createChatSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `chat-${crypto.randomUUID()}`;
  }
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sessionIdOf(run: Pick<AIChatRunEnvelope, "sessionId">): string {
  return run.sessionId?.trim() || defaultChatSessionId;
}

function isBackgroundLinkedReviewRun(
  run:
    | Pick<AIChatRunEnvelope, "action" | "links">
    | Pick<AIChatRun, "action" | "links">
    | null
    | undefined,
): boolean {
  return (
    run?.action === AIChatAction.AIChatActionReview &&
    Boolean(run.links?.autoReviewForBuildRunId?.trim())
  );
}

function shouldRequestAutoLinkedReview(
  run: AIChatRun,
  autoReviewAfterBuild: boolean,
): boolean {
  return (
    run.status === "completed" &&
    run.action === AIChatAction.AIChatActionBuild &&
    autoReviewAfterBuild !== false &&
    Boolean(run.links?.sourcePlanRunId?.trim())
  );
}

function normalizeSessionSearchTerms(query: string): string[] {
  const seen = new Set<string>();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter((term) => {
      if (!term || seen.has(term)) return false;
      seen.add(term);
      return true;
    });
}

function sessionRunSearchText(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
): string {
  const contextItems =
    run?.contextSummary?.contextItems ?? envelope.contextSummary?.contextItems;
  return [
    envelope.action,
    envelope.status,
    run?.userPrompt ?? "",
    run?.response ?? "",
    ...(contextItems ?? []).flatMap((item) => [
      item.label,
      item.path ?? "",
      item.reason ?? "",
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function runMatchesSessionSearch(
  envelope: AIChatRunEnvelope,
  run: AIChatRun | null,
  terms: string[],
): boolean {
  if (terms.length === 0) return true;
  const value = sessionRunSearchText(envelope, run);
  return terms.every((term) => value.includes(term));
}

function scrollRunIntoView(panel: HTMLElement | null, runId: string) {
  if (!panel || !runId) return;
  window.requestAnimationFrame(() => {
    const target = Array.from(
      panel.querySelectorAll<HTMLElement>("[data-ai-chat-run-id]"),
    ).find((element) => element.dataset.aiChatRunId === runId);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function PendingApprovalCenter({
  approvals,
  busyId,
  onApprove,
  onDeny,
  onOpenReview,
  onSelectRun,
}: {
  approvals: AIPendingApproval[];
  busyId?: string | null;
  onApprove: (approval: AIPendingApproval, scope: "once" | "run") => void;
  onDeny: (approval: AIPendingApproval) => void;
  onOpenReview: () => void;
  onSelectRun: (runId: string) => void;
}) {
  if (approvals.length === 0) {
    return null;
  }
  return (
    <section className="ai-chat-pending-approvals">
      <div className="ai-chat-pending-approvals__head">
        <span>Pending approvals</span>
        <button type="button" onClick={onOpenReview}>
          Review
        </button>
      </div>
      <div className="ai-chat-pending-approvals__list">
        {approvals.slice(0, 4).map((approval) => {
          const target =
            approval.targetPaths?.[0] ||
            approval.scopeSummary ||
            approval.commandPreview ||
            approval.toolId;
          const disabled = Boolean(busyId);
          const busy = busyId?.endsWith(`:${approval.id}`) ?? false;
          return (
            <div
              className="ai-chat-pending-approvals__item"
              key={approval.id}
              title={approval.scopeSummary || approval.commandPreview}
            >
              <button
                className="ai-chat-pending-approvals__item-main"
                type="button"
                onClick={() => onSelectRun(approval.runId)}
              >
                <span>
                  {approval.toolId || approval.kind}
                  {approval.riskLevel ? ` · ${approval.riskLevel}` : ""}
                </span>
                <span>{target}</span>
              </button>
              <div className="ai-chat-pending-approvals__actions">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApprove(approval, "once")}
                >
                  {busy && busyId?.includes(":once:") ? "Approving" : "Once"}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onApprove(approval, "run")}
                >
                  {busy && busyId?.includes(":run:") ? "Approving" : "Run"}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDeny(approval)}
                >
                  {busy && busyId?.includes(":deny:") ? "Denying" : "Deny"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function pushUniqueContextItem(
  items: NonNullable<AIContextRequest["contextItems"]>,
  item: NonNullable<AIContextRequest["contextItems"]>[number],
) {
  const key = [
    item.kind,
    item.id ?? "",
    item.path ?? "",
    item.source ?? "",
    item.label ?? "",
  ].join("|");
  const exists = items.some(
    (candidate) =>
      [
        candidate.kind,
        candidate.id ?? "",
        candidate.path ?? "",
        candidate.source ?? "",
        candidate.label ?? "",
      ].join("|") === key,
  );
  if (!exists) items.push(item);
}

function hasMentionContextKind(
  mentions: AIChatMentionCandidate[],
  kind: AIContextItemKind,
): boolean {
  return mentions.some((mention) => mention.contextItem?.kind === kind);
}

function contextItemForMention(
  mention: AIChatMentionCandidate,
  activeEditor: ActiveEditorContext,
): NonNullable<AIContextRequest["contextItems"]>[number] | null {
  const item = mention.contextItem;
  if (!item) return null;
  if (
    item.id === "current_file" &&
    item.kind === AIContextItemKind.AIContextItemKindFile &&
    activeEditor.path
  ) {
    return {
      ...item,
      label: activeEditor.path.split("/").pop() || item.label || "Current file",
      path: activeEditor.path,
    };
  }
  return item;
}

function hasVisibleChatContext(
  context: ContextToggles,
  mentions: AIChatMentionCandidate[],
): boolean {
  return (
    context.workspace ||
    context.currentFile ||
    context.terminalLogs ||
    context.mnemonic ||
    context.mcp ||
    context.skills ||
    context.continuity ||
    mentions.some((mention) => Boolean(mention.contextItem))
  );
}

function profileIdForChatRequest(
  action: AIChatAction,
  profileId: string,
  context: ContextToggles,
  mentions: AIChatMentionCandidate[],
): string {
  if (action !== AIChatAction.AIChatActionAsk) {
    return profileId;
  }
  if (profileId === minimalGeneralProfileId) {
    return minimalGeneralProfileId;
  }
  return hasVisibleChatContext(context, mentions)
    ? askReadonlyProfileId
    : minimalGeneralProfileId;
}

export function buildContextRequest(
  context: ContextToggles,
  activeEditor: ActiveEditorContext,
  prompt = "",
  mentions: AIChatMentionCandidate[] = [],
  profileId = "",
  activeTerminal: ActiveTerminalContext | null = null,
  action: AIChatAction = AIChatAction.AIChatActionAsk,
  sessionId = "",
  runtime: {
    providerId?: string;
    model?: string;
    runtimeFamily?: string;
    reasoningEffort?: string;
    contextWindowHint?: number;
  } = {},
): AIContextRequest {
  const requestProfileId = profileIdForChatRequest(
    action,
    profileId,
    context,
    mentions,
  );
  const effectiveContext =
    action === AIChatAction.AIChatActionAsk &&
    requestProfileId === minimalGeneralProfileId
      ? noContext
      : context;
  const activeFile = activeEditor.path;
  const contextItems: NonNullable<AIContextRequest["contextItems"]> = [];
  if (effectiveContext.workspace) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindWorkspace,
      label: "Workspace",
      source: "composer",
    });
  }
  if (effectiveContext.currentFile && activeFile) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindFile,
      label: activeFile.split("/").pop() || "Current file",
      path: activeFile,
      source: "composer",
    });
  }
  if (effectiveContext.terminalLogs) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindTerminal,
      label: "Terminal",
      source: "composer",
    });
  }
  if (effectiveContext.mnemonic) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindMnemonic,
      label: "Mnemonic",
      source: "composer",
    });
  }
  if (effectiveContext.mcp) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindMCP,
      label: "MCP",
      source: "composer",
    });
  }
  if (effectiveContext.skills) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindSkill,
      label: "Skills",
      source: "composer",
    });
  }
  if (effectiveContext.continuity) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindContinuity,
      label: "Continuity",
      source: "composer",
    });
  }
  mentions.forEach((mention) => {
    const item = contextItemForMention(mention, activeEditor);
    if (item) {
      pushUniqueContextItem(contextItems, item);
    }
  });
  const includeMnemonic =
    effectiveContext.mnemonic ||
    hasMentionContextKind(
      mentions,
      AIContextItemKind.AIContextItemKindMnemonic,
    );
  const includeMCP =
    effectiveContext.mcp ||
    hasMentionContextKind(mentions, AIContextItemKind.AIContextItemKindMCP);
  const includeSkills =
    effectiveContext.skills ||
    hasMentionContextKind(mentions, AIContextItemKind.AIContextItemKindSkill);
  const includeContinuity =
    effectiveContext.continuity ||
    hasMentionContextKind(
      mentions,
      AIContextItemKind.AIContextItemKindContinuity,
    );
  const includeWorkspace =
    effectiveContext.workspace ||
    hasMentionContextKind(
      mentions,
      AIContextItemKind.AIContextItemKindWorkspace,
    );
  const includeCurrentFile =
    effectiveContext.currentFile ||
    mentions.some(
      (mention) =>
        mention.contextItem?.kind === AIContextItemKind.AIContextItemKindFile &&
        (mention.contextItem.id === "current_file" ||
          mention.contextItem.path === activeFile),
    );
  const terminalInput =
    effectiveContext.terminalLogs && activeTerminal?.raw
      ? activeTerminal.raw.slice(-6000)
      : "";
  return {
    documentVersion:
      includeCurrentFile || includeWorkspace || terminalInput
        ? activeEditor.documentVersion
        : "",
    sessionId,
    capability: "chat" as AIProviderCapability,
    action,
    profileId: requestProfileId,
    providerId: runtime.providerId || "",
    model: runtime.model || "",
    runtimeFamily: runtime.runtimeFamily || "",
    reasoningEffort: runtime.reasoningEffort || "",
    contextWindowHint: runtime.contextWindowHint || undefined,
    prompt,
    filePath: includeCurrentFile ? activeFile : "",
    language: includeCurrentFile ? activeEditor.language : "",
    line: includeCurrentFile ? activeEditor.line : undefined,
    column: includeCurrentFile ? activeEditor.column : undefined,
    fullText: includeCurrentFile ? activeEditor.content : "",
    terminalInput,
    terminalWorkDir: terminalInput ? activeTerminal?.cwd : "",
    includeMnemonic,
    includeMCP,
    includeSkills,
    includeContinuity,
    contextItems,
    maxSnippets: includeWorkspace ? 8 : 3,
  };
}

function envelopeFromRun(run: AIChatRun): AIChatRunEnvelope {
  return new AIChatRunEnvelope({
    id: run.id,
    sessionId: run.sessionId,
    projectSessionId: run.projectSessionId,
    action: run.action,
    profileId: run.profileId,
    workflowId: run.workflowId,
    status: run.status,
    providerId: run.providerId,
    model: run.model,
    error: run.error,
    canCancel: run.canCancel,
    contextSummary: run.contextSummary,
    toolProposals: run.toolProposals,
    links: run.links,
    revision: run.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
}

function notificationKindForRunNotice(
  notice: AIChatRunNotice,
): "info" | "success" | "warning" | "error" {
  switch (notice.severity) {
    case "warning":
      return "warning";
    case "success":
      return "success";
    case "info":
      return "info";
    case "error":
    default:
      return "error";
  }
}

function runNoticeNotificationId(
  envelope: Pick<AIChatRunEnvelope, "id">,
  notice: AIChatRunNotice,
): string {
  return (
    notice.notificationId?.trim() ||
    `ai-chat-run:${envelope.id || "unknown"}:notice`
  );
}

function runNoticeSignature(
  envelope: Pick<AIChatRunEnvelope, "revision" | "updatedAt">,
  notice: AIChatRunNotice,
): string {
  return [
    envelope.revision || 0,
    envelope.updatedAt || "",
    notice.severity || "",
    notice.title || "",
    notice.message || "",
    notice.details || "",
  ].join("\u001f");
}

function mergeArtifactsById(
  existing: AIChatRunArtifact[],
  incoming: AIChatRunArtifact[],
): AIChatRunArtifact[] {
  const byId = new Map(existing.map((artifact) => [artifact.id, artifact]));
  incoming.forEach((artifact) => {
    if (!artifact.id) return;
    byId.set(artifact.id, artifact);
  });
  return [...byId.values()].sort((left, right) =>
    String(right.updatedAt || right.createdAt || "").localeCompare(
      String(left.updatedAt || left.createdAt || ""),
    ),
  );
}

function fallbackActionDescriptors(): AIChatActionDescriptor[] {
  return [
    {
      id: AIChatAction.AIChatActionAsk,
      name: "Chat",
      description: "Chat with the default project context.",
      builtIn: true,
      mayProposeTools: true,
      expectsToolProposals: false,
      readOnlyIntent: true,
      showPlanStructure: false,
      executionUnavailable: true,
    },
    {
      id: AIChatAction.AIChatActionPlan,
      name: "Plan",
      description: "Inspect read-only context and produce a plan.",
      builtIn: true,
      mayProposeTools: true,
      expectsToolProposals: false,
      readOnlyIntent: true,
      showPlanStructure: true,
      executionUnavailable: true,
    },
    {
      id: AIChatAction.AIChatActionBuild,
      name: "Build",
      description: "Prepare approval-gated tool calls and patch artifacts.",
      builtIn: true,
      mayProposeTools: false,
      expectsToolProposals: false,
      readOnlyIntent: false,
      showPlanStructure: false,
      executionUnavailable: true,
    },
    {
      id: AIChatAction.AIChatActionDebug,
      name: "Debug",
      description: "Diagnose failures without writing files.",
      builtIn: true,
      mayProposeTools: true,
      expectsToolProposals: false,
      readOnlyIntent: true,
      showPlanStructure: false,
      executionUnavailable: true,
    },
    {
      id: AIChatAction.AIChatActionReview,
      name: "Review",
      description: "Review changes and risks without writing files.",
      builtIn: true,
      mayProposeTools: true,
      expectsToolProposals: false,
      readOnlyIntent: true,
      showPlanStructure: false,
      executionUnavailable: true,
    },
  ] as AIChatActionDescriptor[];
}

function sanitizeActionDescriptors(
  descriptors: AIChatActionDescriptor[],
): AIChatActionDescriptor[] {
  const sourceById = new Map<AIChatAction, AIChatActionDescriptor>();
  fallbackActionDescriptors().forEach((descriptor) => {
    sourceById.set(descriptor.id, descriptor);
  });
  descriptors.forEach((descriptor) => {
    sourceById.set(descriptor.id, {
      ...(sourceById.get(descriptor.id) ?? {}),
      ...descriptor,
    } as AIChatActionDescriptor);
  });
  const source = Array.from(sourceById.values());
  return source.map((descriptor) =>
    descriptor.id === AIChatAction.AIChatActionBuild &&
    /non-executable|not executable/i.test(descriptor.description || "")
      ? {
          ...descriptor,
          executionUnavailable: true,
          mutationAllowed: false,
          expectsToolProposals: false,
        }
      : descriptor,
  );
}

function previewableToolIdForProposal(proposal: AIToolProposal): string | null {
  const candidates = toolIdCandidatesForProposal(proposal);
  return (
    candidates.find(
      (candidate): candidate is string =>
        Boolean(candidate) && previewableToolIds.has(candidate),
    ) ?? null
  );
}

function toolIdCandidatesForProposal(proposal: AIToolProposal): string[] {
  return [proposal.name, proposal.id, proposal.id?.replace(/^tool-call-/, "")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function toolIdForProposal(proposal: AIToolProposal): string | null {
  return (
    previewableToolIdForProposal(proposal) ??
    toolIdCandidatesForProposal(proposal).find((candidate) =>
      candidate.includes("."),
    ) ??
    null
  );
}

export function AIChatPanelContent({
  presentation = "panel",
  projectPath = "",
}: AIChatPanelProps) {
  const activeTerminal = useTerminalStore(
    useShallow((store): ActiveTerminalContext | null => {
      const activePane = store.panes.find(
        (pane) => pane.id === store.activePaneId,
      );
      const activeTerminalId = activePane?.activeTabId ?? "";
      const shellState = activeTerminalId
        ? store.sessionShellState.get(activeTerminalId)
        : null;
      if (!shellState) return null;
      return {
        raw: shellState.raw,
        cwd: shellState.cwd,
      };
    }),
  );
  const beginPanelMotionWindow = usePerformanceStore(
    (store) => store.beginPanelMotionWindow,
  );
  const aiChatSendShortcut = useEditorSettingsStore(
    (store) => store.aiChatSendShortcut,
  );
  const { aiChatPreferences, setAIChatDefaultContext, setAIChatDisplayPref } =
    useEditorSettingsStore(
      useShallow((store) => ({
        aiChatPreferences: store.aiChatPreferences,
        setAIChatDefaultContext: store.setAIChatDefaultContext,
        setAIChatDisplayPref: store.setAIChatDisplayPref,
      })),
    );
  const {
    status,
    providers,
    actions,
    agentProfiles,
    promptWorkflows,
    tools,
    toolAudit,
    runs,
    hydratedRuns,
    streamingTextByRunId,
    egressRecords,
    mnemonicEntries,
    commandIntents,
    approvalPolicy,
    consentPolicy,
    embeddingStatus,
    activeRunId,
    contextPreview,
    contextProviders,
    setStatus,
    setProviders,
    setActions,
    setAgentProfiles,
    setPromptWorkflows,
    setTools,
    setToolAudit,
    upsertToolAudit,
    upsertProvider,
    setRuns,
    upsertRunEnvelope,
    appendRunTimelineEvent,
    deleteSessionRuns,
    setHydratedRun,
    upsertHydratedRuns,
    appendRunToken,
    setActiveRunId,
    setContextPreview,
    setContextProviders,
    setEgressRecords,
    upsertEgressRecord,
    setMnemonicEntries,
    setPendingApprovals: setStorePendingApprovals,
    consumeCommandIntent,
    setApprovalPolicy,
    setConsentPolicy,
    setEmbeddingStatus,
  } = useAIChatStore();

  const [state, dispatch] = useReducer(
    reducer,
    aiChatPreferences,
    initialAIChatStateFromPrefs,
  );
  const [chrome, dispatchChrome] = useReducer(
    chromeReducer,
    initialChromeState,
  );
  const [loading, setLoading] = useState(false);
  const [runtimeHydrated, setRuntimeHydrated] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [providerRuntimes, setProviderRuntimes] = useState<
    AIProviderRuntimeDescriptor[]
  >([]);
  const [modelCapabilities, setModelCapabilities] = useState<
    AIModelCapabilityDescriptor[]
  >([]);
  const [pendingApprovals, setPendingApprovals] = useState<AIPendingApproval[]>(
    [],
  );
  const [artifactsByRunId, setArtifactsByRunId] = useState<ArtifactMap>({});
  const syncInlinePatchArtifacts = useAIInlinePatchStore(
    (store) => store.syncArtifacts,
  );
  const [artifactBusyId, setArtifactBusyId] = useState<string | null>(null);
  const [providerRuntimeBusy, setProviderRuntimeBusy] = useState(false);
  const [providerRuntimeError, setProviderRuntimeError] = useState("");
  const [mnemonicBusy, setMnemonicBusy] = useState(false);
  const [mnemonicError, setMnemonicError] = useState("");
  const [drawerDrag, setDrawerDrag] = useState<{
    drawer: DrawerId;
    offsetX: number;
    targetEdge: DrawerSnapEdge | null;
  } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const initialSelectionHydratedRef = useRef(false);
  const runNoticeSignaturesRef = useRef<Record<string, string>>({});
  const autoReviewBuildRunIdsRef = useRef<Record<string, true>>({});
  const requestedHydrationRunIdsRef = useRef<Set<string>>(new Set());
  const retryingHydrationRunIdsRef = useRef<Set<string>>(new Set());
  const failedHydrationRunIdsRef = useRef<Set<string>>(new Set());
  const hydrationFailureAttemptsRef = useRef<Record<string, number>>({});
  const hydrationRetryTimersRef = useRef<Record<string, number>>({});
  const hydrationMountedRef = useRef(true);
  const [hydratingRunIds, setHydratingRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [retryingHydrationRunIds, setRetryingHydrationRunIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [failedHydrationRunIds, setFailedHydrationRunIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const drawerDragRef = useRef<{
    drawer: DrawerId;
    startX: number;
    edge: DrawerSnapEdge;
    releaseSelectionLock: (() => void) | null;
  } | null>(null);
  const {
    historyOpen,
    reviewOpen,
    reviewExpanded,
    controlsCollapsed,
    leftControlsCollapsed,
    rightControlsCollapsed,
    historyEdge,
    reviewEdge,
    historyWidth,
    reviewWidth,
    historyInset,
    reviewInset,
    sessionSearchOpen,
    historySearch,
    reviewSearch,
    sessionSearch,
    diffSearch,
    commitMessage,
  } = chrome;

  useEffect(() => {
    return () => {
      hydrationMountedRef.current = false;
      Object.values(hydrationRetryTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      hydrationRetryTimersRef.current = {};
    };
  }, []);

  const publishRetryingHydrationRunIds = useCallback(() => {
    if (!hydrationMountedRef.current) return;
    setRetryingHydrationRunIds(new Set(retryingHydrationRunIdsRef.current));
  }, []);

  const publishFailedHydrationRunIds = useCallback(() => {
    if (!hydrationMountedRef.current) return;
    setFailedHydrationRunIds(new Set(failedHydrationRunIdsRef.current));
  }, []);

  const clearHydrationRetryTimer = useCallback((runId: string) => {
    const timerId = hydrationRetryTimersRef.current[runId];
    if (timerId === undefined) return;
    window.clearTimeout(timerId);
    delete hydrationRetryTimersRef.current[runId];
  }, []);

  const clearHydrationFailuresForRunIds = useCallback(
    (runIds: readonly string[]) => {
      let retryingChanged = false;
      let failedChanged = false;
      runIds.forEach((runId) => {
        const key = runId.trim();
        if (!key) return;
        clearHydrationRetryTimer(key);
        delete hydrationFailureAttemptsRef.current[key];
        if (retryingHydrationRunIdsRef.current.delete(key)) {
          retryingChanged = true;
        }
        if (failedHydrationRunIdsRef.current.delete(key)) {
          failedChanged = true;
        }
      });
      if (retryingChanged) {
        publishRetryingHydrationRunIds();
      }
      if (failedChanged) {
        publishFailedHydrationRunIds();
      }
    },
    [
      clearHydrationRetryTimer,
      publishFailedHydrationRunIds,
      publishRetryingHydrationRunIds,
    ],
  );

  const markHydrationFailure = useCallback(
    (runId: string) => {
      const key = runId.trim();
      if (!key) return;
      const attempts = (hydrationFailureAttemptsRef.current[key] ?? 0) + 1;
      hydrationFailureAttemptsRef.current[key] = attempts;

      if (attempts >= chatHydrationMaxAttempts) {
        clearHydrationRetryTimer(key);
        if (retryingHydrationRunIdsRef.current.delete(key)) {
          publishRetryingHydrationRunIds();
        }
        if (!failedHydrationRunIdsRef.current.has(key)) {
          failedHydrationRunIdsRef.current.add(key);
          publishFailedHydrationRunIds();
        }
        return;
      }

      if (!retryingHydrationRunIdsRef.current.has(key)) {
        retryingHydrationRunIdsRef.current.add(key);
        publishRetryingHydrationRunIds();
      }
      if (hydrationRetryTimersRef.current[key] !== undefined) return;
      hydrationRetryTimersRef.current[key] = window.setTimeout(() => {
        delete hydrationRetryTimersRef.current[key];
        if (!hydrationMountedRef.current) return;
        if (retryingHydrationRunIdsRef.current.delete(key)) {
          publishRetryingHydrationRunIds();
        }
      }, chatHydrationRetryDelayMs);
    },
    [
      clearHydrationRetryTimer,
      publishFailedHydrationRunIds,
      publishRetryingHydrationRunIds,
    ],
  );

  useEffect(() => {
    dispatch({
      type: "setContextPrefs",
      context: aiChatPreferences.defaultContext,
    });
    dispatch({
      type: "setDisplayPrefs",
      displayPrefs: aiChatPreferences.displayPrefs,
    });
  }, [aiChatPreferences]);

  const handleContextToggle = useCallback(
    (key: keyof ContextToggles, value: boolean) => {
      dispatch({ type: "setContext", key, value });
      setAIChatDefaultContext(key, value);
    },
    [setAIChatDefaultContext],
  );

  const handleDisplayPrefChange = useCallback(
    (key: keyof typeof state.displayPrefs, value: boolean) => {
      dispatch({ type: "setDisplayPref", key, value });
      setAIChatDisplayPref(key, value);
    },
    [setAIChatDisplayPref],
  );

  const publishRunNotice = useCallback((envelope: AIChatRunEnvelope) => {
    const notice = envelope.runNotice;
    if (!notice?.title) {
      return;
    }
    const notificationId = runNoticeNotificationId(envelope, notice);
    const signature = runNoticeSignature(envelope, notice);
    if (runNoticeSignaturesRef.current[notificationId] === signature) {
      return;
    }
    runNoticeSignaturesRef.current[notificationId] = signature;
    useAppNotificationStore.getState().addNotification({
      id: notificationId,
      kind: notificationKindForRunNotice(notice),
      title: notice.title,
      message: notice.message,
      details: notice.details,
      detailsLabel: notice.details ? "Run details" : undefined,
      source: notice.source || "AI Runtime",
      tag: notice.tag || "agent",
      sticky: notice.severity === "error",
    });
  }, []);

  const fullscreen = presentation === "fullscreen";
  const reduceMotion = useReducedMotion();
  const beginChatMotionWindow = useCallback(() => {
    if (!reduceMotion) {
      beginPanelMotionWindow(280);
    }
  }, [beginPanelMotionWindow, reduceMotion]);
  const sortedProviders = useMemo(() => sortProviders(providers), [providers]);
  const selectedProvider = useMemo(() => {
    const explicit = sortedProviders.find(
      (provider) => provider.id === state.selectedProviderId,
    );
    return (
      explicit ??
      selectDefaultProvider(sortedProviders, status?.activeProviderId)
    );
  }, [sortedProviders, state.selectedProviderId, status?.activeProviderId]);
  const selectedProviderIsExternalAgent = selectedProvider
    ? isExternalAgentProvider(selectedProvider)
    : false;
  const selectedProviderRuntime = useMemo(
    () =>
      selectedProvider
        ? (providerRuntimes.find(
            (candidate) => candidate.providerId === selectedProvider.id,
          ) ?? null)
        : null,
    [providerRuntimes, selectedProvider],
  );
  const selectedModelOptions = useMemo(
    () => mergeModelOptions(selectedProvider, selectedProviderRuntime),
    [selectedProvider, selectedProviderRuntime],
  );
  const selectedModel = useMemo(() => {
    const providerModels = selectedModelOptions;
    const providerModelIds = new Set(
      providerModels.map((model) => model.id).filter(Boolean),
    );
    const statusActiveModel =
      status?.activeProviderId === selectedProvider?.id
        ? status?.activeModel || ""
        : "";
    const requestedModel = state.selectedModel || statusActiveModel;
    if (requestedModel && providerModelIds.has(requestedModel)) {
      return requestedModel;
    }
    const activeModel = providerModels.find((model) => model.active);
    if (activeModel?.id) {
      return activeModel.id;
    }
    if (providerModels[0]?.id) {
      return providerModels[0].id;
    }
    return selectedProviderIsExternalAgent ? "" : statusActiveModel;
  }, [
    selectedModelOptions,
    selectedProviderIsExternalAgent,
    selectedProvider?.id,
    state.selectedModel,
    status?.activeProviderId,
    status?.activeModel,
  ]);
  const selectedModelDescriptor = useMemo(
    () =>
      selectedModelOptions.find((model) => model.id === selectedModel) ?? null,
    [selectedModel, selectedModelOptions],
  );
  const selectedReasoningEffort = useMemo(() => {
    const effort = state.selectedReasoningEffort;
    if (!effort || !selectedProvider) {
      return "";
    }
    const reasoningEfforts =
      (selectedModelDescriptor as ReasoningModelDescriptor | null)
        ?.reasoningEfforts ?? [];
    return reasoningEfforts.includes(effort) ? effort : "";
  }, [
    selectedModelDescriptor,
    selectedProvider,
    state.selectedReasoningEffort,
  ]);
  const selectedModelCapability = useMemo(
    () =>
      modelCapabilities.find(
        (capability) =>
          capability.providerId === selectedProvider?.id &&
          capability.model === selectedModel,
      ) ?? null,
    [modelCapabilities, selectedModel, selectedProvider?.id],
  );
  const selectedContextWindowHint =
    selectedModelCapability?.contextWindow ??
    selectedModelDescriptor?.contextWindow ??
    0;
  const selectedRuntimeFamily = selectedProvider
    ? isExternalAgentProvider(selectedProvider)
      ? selectedProvider.runtimeFamily || jsonlExecRuntimeFamily
      : modelAgentRuntimeFamily
    : "";
  const activeSessionId = state.activeSessionId || defaultChatSessionId;
  const selectedMentionsForActiveSession = useMemo(
    () => mentionsForSession(state, activeSessionId),
    [activeSessionId, state.selectedMentionsBySession],
  );
  const activeSessionEnvelopes = useMemo(
    () => runs.filter((run) => sessionIdOf(run) === activeSessionId),
    [activeSessionId, runs],
  );
  const activeSessionRunIds = useMemo(
    () => new Set(activeSessionEnvelopes.map((run) => run.id)),
    [activeSessionEnvelopes],
  );
  const activeRunKeyCandidate = state.activeRunId || activeRunId || "";
  const activeRunKey =
    activeRunKeyCandidate && activeSessionRunIds.has(activeRunKeyCandidate)
      ? activeRunKeyCandidate
      : (activeSessionEnvelopes[0]?.id ?? "");
  const activeRun = activeRunKey ? (hydratedRuns[activeRunKey] ?? null) : null;
  const activeEnvelope = runs.find((run) => run.id === activeRunKey) ?? null;
  const selectedProviderAuthRun = useMemo(() => {
    const providerId = selectedProvider?.id || "";
    if (!providerId) return null;
    return (
      Object.values(hydratedRuns)
        .filter((run) => isProviderAuthRun(run, providerId))
        .sort((left, right) => {
          const rightTime = Date.parse(
            right.updatedAt || right.createdAt || "",
          );
          const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
          return (
            (Number.isFinite(rightTime) ? rightTime : 0) -
            (Number.isFinite(leftTime) ? leftTime : 0)
          );
        })[0] ?? null
    );
  }, [hydratedRuns, selectedProvider?.id]);
  const activeArtifacts = activeRunKey
    ? (artifactsByRunId[activeRunKey] ?? [])
    : [];
  const allKnownArtifacts = useMemo(
    () =>
      activeSessionEnvelopes.flatMap(
        (envelope) => artifactsByRunId[envelope.id] ?? [],
      ),
    [activeSessionEnvelopes, artifactsByRunId],
  );
  const composerActions = useMemo(
    () => sanitizeActionDescriptors(actions),
    [actions],
  );
  const selectedActionDescriptor = composerActions.find(
    (descriptor) => descriptor.id === state.selectedAction,
  );
  const activeRunRunning = activeSessionEnvelopes.some(
    (run) => run.status === "running" || run.status === "queued",
  );
  const inputReady = state.input.trim().length > 0;
  const providerDisabledReason = getProviderDisabledReason(selectedProvider, {
    selectedModel,
    consentPolicy,
    status,
  });
  const selectedProviderReady = providerDisabledReason === "";
  const activityItems = buildActivityStatusItems({
    selectedProvider,
    selectedProviderReady,
    contextPreview,
    activeEnvelope,
    artifacts: activeArtifacts,
    activeRun,
    activeRunText:
      activeRun?.response ?? streamingTextByRunId[activeRunKey] ?? "",
    approvalPolicy,
    consentPolicy,
    embeddingStatus,
    workflowCount: promptWorkflows.length,
    artifactBusyId,
    mnemonicBusy,
  });
  const activitySummary = summarizeActivityStatus(
    activityItems,
    selectedProviderReady,
  );
  const agentConsoleVisible =
    isInteractiveFallbackRuntime(activeEnvelope?.runtimeFamily) ||
    isInteractiveFallbackRuntime(
      activeEnvelope?.providerEnvelope?.runtimeFamily,
    ) ||
    isInteractiveFallbackRuntime(activeEnvelope?.agentRuntime?.runtimeFamily) ||
    activeEnvelope?.agentRuntime?.transport === "pty_fallback";
  const disabledReason = activeRunRunning
    ? "Generation is running"
    : selectedActionDescriptor?.executionUnavailable
      ? selectedActionDescriptor.description || "Action unavailable"
      : !inputReady
        ? providerDisabledReason
        : providerDisabledReason;
  const canSend =
    inputReady &&
    selectedProviderReady &&
    !activeRunRunning &&
    !selectedActionDescriptor?.executionUnavailable;
  const transcriptRuns = useMemo(
    () => [...activeSessionEnvelopes].reverse(),
    [activeSessionEnvelopes],
  );
  const newestSessionRunIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const run of runs) {
      const sessionId = sessionIdOf(run);
      if (!run.id || seen.has(sessionId)) continue;
      seen.add(sessionId);
      ids.push(run.id);
    }
    return ids;
  }, [runs]);
  const hydrationTargetRunIds = useMemo(() => {
    const ids = new Set<string>();
    newestSessionRunIds.forEach((id) => ids.add(id));
    transcriptRuns.forEach((run) => {
      if (run.id) ids.add(run.id);
    });
    return [...ids];
  }, [newestSessionRunIds, transcriptRuns]);
  const hydrationStatusForRun = useCallback(
    (runId: string) => {
      if (hydratedRuns[runId]) return "hydrated";
      if (failedHydrationRunIds.has(runId)) return "failed";
      if (hydratingRunIds.has(runId)) return "loading";
      return "idle";
    },
    [failedHydrationRunIds, hydratedRuns, hydratingRunIds],
  );
  const sessionSearchTerms = useMemo(
    () => (sessionSearchOpen ? normalizeSessionSearchTerms(sessionSearch) : []),
    [sessionSearch, sessionSearchOpen],
  );
  const sessionSearchMatches = useMemo(
    () =>
      sessionSearchTerms.length === 0
        ? []
        : transcriptRuns.filter((envelope) =>
            runMatchesSessionSearch(
              envelope,
              hydratedRuns[envelope.id] ?? null,
              sessionSearchTerms,
            ),
          ),
    [hydratedRuns, sessionSearchTerms, transcriptRuns],
  );
  const activeSessionSearchIndex = useMemo(() => {
    if (sessionSearchTerms.length === 0 || sessionSearchMatches.length === 0) {
      return -1;
    }
    return sessionSearchMatches.findIndex(
      (envelope) => envelope.id === activeRunKey,
    );
  }, [activeRunKey, sessionSearchMatches, sessionSearchTerms.length]);

  useEffect(() => {
    setContextPreview(null);
    dispatchChrome({
      type: "patch",
      value: { sessionSearch: "", sessionSearchOpen: false },
    });
  }, [activeSessionId, setContextPreview]);

  useEffect(() => {
    if (sessionSearchTerms.length === 0 || sessionSearchMatches.length === 0) {
      return;
    }
    if (activeSessionSearchIndex >= 0) return;
    const nextRunId = sessionSearchMatches[0]?.id;
    if (!nextRunId) return;
    setActiveRunId(nextRunId);
    dispatch({ type: "setActiveRun", runId: nextRunId });
    scrollRunIntoView(panelRef.current, nextRunId);
  }, [
    activeSessionSearchIndex,
    sessionSearchMatches,
    sessionSearchTerms.length,
    setActiveRunId,
  ]);

  const handleNavigateSessionSearch = useCallback(
    (direction: -1 | 1) => {
      if (
        sessionSearchTerms.length === 0 ||
        sessionSearchMatches.length === 0
      ) {
        return;
      }
      const currentIndex =
        activeSessionSearchIndex >= 0 ? activeSessionSearchIndex : 0;
      const nextIndex =
        (currentIndex + direction + sessionSearchMatches.length) %
        sessionSearchMatches.length;
      const nextRunId = sessionSearchMatches[nextIndex]?.id;
      if (!nextRunId) return;
      setActiveRunId(nextRunId);
      dispatch({ type: "setActiveRun", runId: nextRunId });
      scrollRunIntoView(panelRef.current, nextRunId);
    },
    [
      activeSessionSearchIndex,
      sessionSearchMatches,
      sessionSearchTerms.length,
      setActiveRunId,
    ],
  );

  const detectDrawerSnapEdge = useCallback((clientX: number) => {
    const rect = workbenchRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const localX = clientX - rect.left;
    const threshold = Math.min(220, Math.max(96, rect.width * 0.24));
    if (localX <= threshold) return "left";
    if (localX >= rect.width - threshold) return "right";
    return null;
  }, []);
  const detectDrawerSnapEdgeEvent = useEffectEvent(detectDrawerSnapEdge);

  const releaseDrawerDrag = useCallback(() => {
    const activeDrag = drawerDragRef.current;
    activeDrag?.releaseSelectionLock?.();
    drawerDragRef.current = null;
    setDrawerDrag(null);
    if (activeDrag) {
      window.dispatchEvent(new CustomEvent("panel-drag-end"));
    }
  }, []);
  const releaseDrawerDragEvent = useEffectEvent(releaseDrawerDrag);

  const handleDrawerDragStart = useCallback(
    (drawer: DrawerId, event: React.MouseEvent<HTMLElement>) => {
      if (!fullscreen || event.button !== 0) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("button,input,textarea,select,[data-ai-chat-no-drag]")
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      drawerDragRef.current?.releaseSelectionLock?.();
      const edge = drawer === "history" ? historyEdge : reviewEdge;
      drawerDragRef.current = {
        drawer,
        startX: event.clientX,
        edge,
        releaseSelectionLock: beginDragSelectionLock(),
      };
      setDrawerDrag({ drawer, offsetX: 0, targetEdge: edge });
      window.dispatchEvent(new CustomEvent("panel-drag-start"));
    },
    [fullscreen, historyEdge, reviewEdge],
  );

  useEffect(() => {
    if (!drawerDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const drag = drawerDragRef.current;
      if (!drag) return;
      const targetEdge = detectDrawerSnapEdgeEvent(event.clientX);
      setDrawerDrag({
        drawer: drag.drawer,
        offsetX: event.clientX - drag.startX,
        targetEdge,
      });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const drag = drawerDragRef.current;
      if (!drag) {
        releaseDrawerDragEvent();
        return;
      }
      const targetEdge =
        detectDrawerSnapEdgeEvent(event.clientX) ??
        (Math.abs(event.clientX - drag.startX) > 80
          ? event.clientX < drag.startX
            ? "left"
            : "right"
          : drag.edge);
      dispatchChrome({
        type: "snapDrawer",
        drawer: drag.drawer,
        edge: targetEdge,
      });
      releaseDrawerDragEvent();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drawerDrag]);

  useEffect(() => releaseDrawerDrag, [releaseDrawerDrag]);

  const handleResizeHistory = useCallback(
    (edge: "start" | "end", delta: number) => {
      if (!fullscreen) return;
      dispatchChrome({ type: "resizeHistory", edge, delta });
    },
    [fullscreen],
  );

  const handleResizeReview = useCallback(
    (edge: "start" | "end", delta: number) => {
      if (!fullscreen) return;
      dispatchChrome({ type: "resizeReview", edge, delta });
    },
    [fullscreen],
  );

  const refreshRuntime = useCallback(async () => {
    setLoading(true);
    setRuntimeHydrated(false);
    setRuntimeError(null);
    try {
      const contextRequest = buildContextRequest(
        state.context,
        activeEditorContextFromStore(useEditorStore.getState()),
        state.input,
        selectedMentionsForActiveSession,
        state.selectedProfileId,
        activeTerminal,
        state.selectedAction,
        activeSessionId,
        {
          providerId: selectedProvider?.id || state.selectedProviderId,
          model: selectedModel,
          runtimeFamily: selectedRuntimeFamily,
          reasoningEffort: selectedReasoningEffort,
          contextWindowHint: selectedContextWindowHint,
        },
      );
      const [
        nextStatus,
        envelopes,
        preview,
        nextActions,
        nextContextProviders,
        nextEgressRecords,
        nextAgentProfiles,
        nextPromptWorkflows,
        nextTools,
        nextToolAudit,
        nextModelCapabilities,
        nextConsentPolicy,
        nextEmbeddingStatus,
        nextApprovalPolicy,
        nextMnemonicEntries,
        nextProviderRuntimes,
        nextPendingApprovals,
      ] = await Promise.all([
        AIGetStatus(),
        AIListChatRuns(50),
        AIGetContextPreview(contextRequest),
        AIListChatActions(),
        AIListContextProviders(),
        AIListEgressRecords(50),
        AIListAgentProfiles(),
        AIListPromptWorkflows(),
        AIListTools(),
        AIListToolAudit(50),
        AIListModelCapabilities(),
        AIGetConsentPolicy(),
        AIGetEmbeddingStatus(),
        AIGetApprovalPolicy(),
        AIListMnemonicEntries(24),
        AIListProviderRuntimes(),
        AIListPendingApprovals(50),
      ]);
      const safeStatus = normalizeAIStatus(nextStatus);
      const nextProviders = safeStatus.providers;
      const safeConsentPolicy =
        normalizeAIConsentPolicy(nextConsentPolicy) ?? defaultAIConsentPolicy();
      const safeApprovalPolicy =
        normalizeAIApprovalPolicy(nextApprovalPolicy) ??
        defaultAIApprovalPolicy();
      const safeEmbeddingStatus =
        normalizeAIEmbeddingStatus(nextEmbeddingStatus) ??
        defaultAIEmbeddingStatus();
      const safeEnvelopes = normalizeAIChatRuns(envelopes);
      clearHydrationFailuresForRunIds(
        safeEnvelopes.map((envelope) => envelope.id),
      );
      setStatus(safeStatus);
      setProviders(nextProviders);
      setActions(normalizeAIChatActions(nextActions));
      setContextProviders(normalizeAIContextProviders(nextContextProviders));
      setEgressRecords(normalizeAIEgressRecords(nextEgressRecords));
      setAgentProfiles(normalizeAIAgentProfiles(nextAgentProfiles));
      setPromptWorkflows(normalizeAIPromptWorkflows(nextPromptWorkflows));
      setTools(normalizeAITools(nextTools));
      setToolAudit(normalizeAIToolAudit(nextToolAudit));
      setModelCapabilities(normalizeAIModelCapabilities(nextModelCapabilities));
      setConsentPolicy(safeConsentPolicy);
      setEmbeddingStatus(safeEmbeddingStatus);
      setApprovalPolicy(safeApprovalPolicy);
      setMnemonicEntries(normalizeAIMnemonicEntries(nextMnemonicEntries));
      setProviderRuntimes(normalizeAIProviderRuntimes(nextProviderRuntimes));
      const normalizedPendingApprovals =
        normalizeAIPendingApprovals(nextPendingApprovals);
      setPendingApprovals(normalizedPendingApprovals);
      setStorePendingApprovals(normalizedPendingApprovals);
      setRuns(safeEnvelopes);
      setContextPreview(normalizeAIContextSnapshot(preview));

      const defaultProvider = selectDefaultProvider(
        nextProviders,
        safeStatus.activeProviderId,
      );
      if (defaultProvider) {
        dispatch({
          type: "ensureProvider",
          providerId: defaultProvider.id,
          model: modelForProviderSelection(defaultProvider, safeStatus),
          source: "auto",
        });
      }
      const initialEnvelope =
        safeEnvelopes.find(
          (envelope) => !isBackgroundLinkedReviewRun(envelope),
        ) ?? safeEnvelopes[0];
      if (!initialSelectionHydratedRef.current && initialEnvelope?.id) {
        initialSelectionHydratedRef.current = true;
        setActiveRunId(initialEnvelope.id);
        dispatch({
          type: "setActiveSession",
          sessionId: sessionIdOf(initialEnvelope),
          runId: initialEnvelope.id,
        });
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeHydrated(true);
      setLoading(false);
    }
  }, [
    activeSessionId,
    activeTerminal,
    clearHydrationFailuresForRunIds,
    setContextPreview,
    setContextProviders,
    setEgressRecords,
    setActions,
    setAgentProfiles,
    setApprovalPolicy,
    setConsentPolicy,
    setEmbeddingStatus,
    setMnemonicEntries,
    setProviders,
    setPromptWorkflows,
    setRuns,
    setStorePendingApprovals,
    setStatus,
    setActiveRunId,
    setTools,
    setToolAudit,
    selectedContextWindowHint,
    selectedModel,
    selectedProvider?.id,
    selectedReasoningEffort,
    selectedRuntimeFamily,
    state.context,
    state.input,
    state.selectedAction,
    state.selectedProfileId,
    state.selectedProviderId,
    selectedMentionsForActiveSession,
  ]);

  const refreshRuntimeEvent = useEffectEvent(refreshRuntime);
  const clearHydrationFailuresForTargetsEvent = useEffectEvent(() => {
    clearHydrationFailuresForRunIds(hydrationTargetRunIds);
  });

  useEffect(() => {
    refreshRuntimeEvent();
  }, []);

  useEffect(() => {
    const pendingRunIds = hydrationTargetRunIds
      .filter((runId) => runId.trim())
      .filter((runId) => !hydratedRuns[runId])
      .filter((runId) => !requestedHydrationRunIdsRef.current.has(runId))
      .filter((runId) => !retryingHydrationRunIdsRef.current.has(runId))
      .filter((runId) => !failedHydrationRunIdsRef.current.has(runId))
      .slice(0, chatHydrationBatchSize);
    if (pendingRunIds.length === 0) return undefined;

    pendingRunIds.forEach((runId) =>
      requestedHydrationRunIdsRef.current.add(runId),
    );
    setHydratingRunIds((current) => {
      const next = new Set(current);
      pendingRunIds.forEach((runId) => next.add(runId));
      return next;
    });

    Promise.allSettled(pendingRunIds.map((runId) => AIGetChatRun(runId))).then(
      (results) => {
        pendingRunIds.forEach((runId) =>
          requestedHydrationRunIdsRef.current.delete(runId),
        );
        if (!hydrationMountedRef.current) {
          return;
        }
        const loadedRuns: AIChatRun[] = [];
        const loadedRunIds = new Set<string>();
        const failedRunIds: string[] = [];
        results.forEach((result, index) => {
          const runId = pendingRunIds[index];
          if (result.status === "fulfilled" && result.value?.id) {
            loadedRuns.push(result.value);
            loadedRunIds.add(runId);
            loadedRunIds.add(result.value.id);
            return;
          }
          failedRunIds.push(runId);
        });
        if (loadedRuns.length > 0) {
          clearHydrationFailuresForRunIds([...loadedRunIds]);
          upsertHydratedRuns(loadedRuns);
        }
        setHydratingRunIds((current) => {
          const next = new Set(current);
          pendingRunIds.forEach((runId) => next.delete(runId));
          return next;
        });
        if (failedRunIds.length > 0) {
          failedRunIds.forEach((runId) => markHydrationFailure(runId));
        }
      },
    );
    return undefined;
  }, [
    clearHydrationFailuresForRunIds,
    failedHydrationRunIds,
    hydratedRuns,
    hydrationTargetRunIds,
    markHydrationFailure,
    retryingHydrationRunIds,
    upsertHydratedRuns,
  ]);

  const refreshRunArtifacts = useCallback(async (runId: string) => {
    const key = runId.trim();
    if (!key) {
      return;
    }
    const artifacts = await AIListChatRunArtifacts(key);
    const normalized = normalizeAIChatArtifacts(artifacts);
    setArtifactsByRunId((current) => ({
      ...current,
      [key]: mergeArtifactsById(current[key] ?? [], normalized),
    }));
  }, []);

  const refreshPendingApprovals = useCallback(async () => {
    try {
      const approvals = await AIListPendingApprovals(50);
      const normalizedApprovals = normalizeAIPendingApprovals(approvals);
      setPendingApprovals(normalizedApprovals);
      setStorePendingApprovals(normalizedApprovals);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [setRuntimeError, setStorePendingApprovals]);

  const refreshModelCapabilities = useCallback(async () => {
    try {
      const capabilities = await AIListModelCapabilities();
      setModelCapabilities(normalizeAIModelCapabilities(capabilities));
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [setModelCapabilities, setRuntimeError]);

  const refreshActiveArtifacts = useCallback(async () => {
    if (!activeRunKey) {
      return;
    }
    await refreshRunArtifacts(activeRunKey);
  }, [activeRunKey, refreshRunArtifacts]);
  const refreshRunArtifactsEvent = useEffectEvent(refreshRunArtifacts);
  const refreshPendingApprovalsEvent = useEffectEvent(refreshPendingApprovals);
  const refreshModelCapabilitiesEvent = useEffectEvent(
    refreshModelCapabilities,
  );

  useEffect(() => {
    syncInlinePatchArtifacts(allKnownArtifacts);
  }, [allKnownArtifacts, syncInlinePatchArtifacts]);

  useEffect(() => {
    if (!activeRunKey) return;
    void refreshRunArtifacts(activeRunKey);
  }, [activeRunKey, refreshRunArtifacts]);

  useLayoutEffect(() => {
    if (!state.displayPrefs.autoScroll) return;
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    activeSessionId,
    runs,
    activeRun?.response,
    streamingTextByRunId,
    state.displayPrefs.autoScroll,
  ]);

  const startLinkedReviewForBuild = useEffectEvent((run: AIChatRun) => {
    if (
      !shouldRequestAutoLinkedReview(
        run,
        aiChatPreferences.workflowPrefs.autoReviewAfterBuild,
      ) ||
      autoReviewBuildRunIdsRef.current[run.id]
    ) {
      return;
    }
    autoReviewBuildRunIdsRef.current[run.id] = true;
    void AIStartLinkedReview({ buildRunId: run.id })
      .then((result) => {
        if (!result?.run?.id || result.status.startsWith("skipped_")) return;
        setHydratedRun(result.run);
        upsertRunEnvelope(envelopeFromRun(result.run));
        if (!isBackgroundLinkedReviewRun(result.run)) {
          setActiveRunId(result.run.id);
          dispatch({
            type: "setActiveSession",
            sessionId: result.run.sessionId || defaultChatSessionId,
            runId: result.run.id,
          });
          dispatch({ type: "setActiveRun", runId: result.run.id });
        }
      })
      .catch((error) => {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      });
  });

  const handleRunUpdate = useEffectEvent((run: AIChatRun) => {
    if (!run?.id) return;
    clearHydrationFailuresForRunIds([run.id]);
    setHydratedRun(run);
    upsertRunEnvelope(envelopeFromRun(run));
    void refreshRunArtifactsEvent(run.id);
    void refreshPendingApprovalsEvent();
    if (
      run.status === "completed" ||
      run.status === "error" ||
      run.status === "canceled"
    ) {
      window.setTimeout(() => {
        void refreshRunArtifactsEvent(run.id);
      }, 125);
      if (run.agentRuntime?.operation === "auth_login") {
        window.setTimeout(() => {
          void refreshRuntimeEvent();
        }, 250);
      }
      startLinkedReviewForBuild(run);
    }
    void AIGetChatRunEnvelope(run.id)
      .then((envelope) => {
        if (envelope?.id) {
          upsertRunEnvelope(envelope);
          publishRunNotice(envelope);
        }
      })
      .catch(() => {
        // The run payload is enough to keep the transcript live.
      });
    const runSessionId = run.sessionId || defaultChatSessionId;
    if (
      !isBackgroundLinkedReviewRun(run) &&
      (runSessionId === state.activeSessionId || !state.activeRunId)
    ) {
      setActiveRunId(run.id);
      dispatch({
        type: "setActiveSession",
        sessionId: runSessionId,
        runId: run.id,
      });
      dispatch({ type: "setActiveRun", runId: run.id });
    }
  });

  const handleRunEnvelopeUpdate = useEffectEvent(
    (envelope: AIChatRunEnvelope) => {
      if (!envelope?.id) return;
      clearHydrationFailuresForRunIds([envelope.id]);
      upsertRunEnvelope(envelope);
      publishRunNotice(envelope);
      void refreshRunArtifactsEvent(envelope.id);
      void refreshPendingApprovalsEvent();
      const runSessionId = sessionIdOf(envelope);
      if (runSessionId === state.activeSessionId || !state.activeRunId) {
        setActiveRunId(envelope.id);
        dispatch({
          type: "setActiveSession",
          sessionId: runSessionId,
          runId: envelope.id,
        });
        dispatch({ type: "setActiveRun", runId: envelope.id });
      }
    },
  );

  const handleRunToken = useEffectEvent(
    (payload: { runId?: string; token?: string }) => {
      if (!payload?.runId || !payload.token) return;
      appendRunToken(payload.runId, payload.token);
    },
  );

  const handleProviderDescriptor = useEffectEvent(
    (provider: AIProviderDescriptor) => {
      if (!provider?.id) return;
      upsertProvider(provider);
      const currentStatus = status ?? defaultAIStatus();
      setStatus(
        normalizeAIStatus({
          ...currentStatus,
          providers: mergeProviderDescriptorList(
            currentStatus.providers ?? providers,
            provider,
          ),
        }),
      );
    },
  );

  const handleEgressRecord = useEffectEvent((record: AIEgressRecord) => {
    const source = record?.source ?? "";
    const chatSource =
      source === "" ||
      source === "chat_run" ||
      source === "ai_chat" ||
      source === "ai-chat" ||
      source === "chat_tool_result" ||
      source === "chat_rewrite_guard";
    if (!chatSource && !record.runId && !record.projectSessionId) {
      return;
    }
    upsertEgressRecord(record);
    if (record.runId) {
      void refreshRunArtifactsEvent(record.runId);
    }
  });

  const handleToolAuditRecord = useEffectEvent((result: unknown) => {
    const audit = (result as { audit?: AIToolAuditRecord })?.audit;
    if (!audit?.id) return;
    upsertToolAudit(audit);
    void refreshPendingApprovalsEvent();
    if (audit.runId) {
      void refreshRunArtifactsEvent(audit.runId);
    }
  });

  const handleToolLifecycleArtifact = useEffectEvent((artifact: unknown) => {
    const runId = (artifact as { runId?: string })?.runId;
    void refreshPendingApprovalsEvent();
    if (runId) {
      void refreshRunArtifactsEvent(runId);
    }
  });

  const handleChatArtifactUpdated = useEffectEvent((artifact: unknown) => {
    const normalized = normalizeAIChatArtifacts([artifact]).at(0);
    if (!normalized?.id || !normalized.runId) {
      return;
    }
    setArtifactsByRunId((current) => ({
      ...current,
      [normalized.runId]: mergeArtifactsById(current[normalized.runId] ?? [], [
        normalized,
      ]),
    }));
    void refreshPendingApprovalsEvent();
  });

  const handleRunTimelineEvent = useEffectEvent((event: AIRunTimelineEvent) => {
    if (!event?.runId) return;
    appendRunTimelineEvent(event);
  });

  const handleChatToolResult = useEffectEvent((payload: unknown) => {
    const runId = (payload as { runId?: string })?.runId;
    void refreshPendingApprovalsEvent();
    if (runId) {
      void refreshRunArtifactsEvent(runId);
    }
  });

  const handlePatchArtifactAppliedEvent = useEffectEvent((payload: unknown) => {
    const runId = (payload as { runId?: string })?.runId;
    void refreshPendingApprovalsEvent();
    if (runId) {
      void refreshRunArtifactsEvent(runId);
    }
  });

  useEffect(() => {
    const offStarted = EventsOn("ai:chat:run-started", (run) =>
      handleRunUpdate(run as AIChatRun),
    );
    const offCompleted = EventsOn("ai:chat:run-completed", (run) =>
      handleRunUpdate(run as AIChatRun),
    );
    const offError = EventsOn("ai:chat:run-error", (run) =>
      handleRunUpdate(run as AIChatRun),
    );
    const offCanceled = EventsOn("ai:chat:run-canceled", (run) =>
      handleRunUpdate(run as AIChatRun),
    );
    const offToken = EventsOn("ai:chat:token", (payload) =>
      handleRunToken(payload as { runId?: string; token?: string }),
    );
    const offEnvelope = EventsOn("ai:chat:run-envelope-updated", (envelope) =>
      handleRunEnvelopeUpdate(envelope as AIChatRunEnvelope),
    );
    const offTimeline = EventsOn("ai:run:timeline-event", (event) =>
      handleRunTimelineEvent(event as AIRunTimelineEvent),
    );
    const offStatus = EventsOn("ai:provider:status", (provider) =>
      handleProviderDescriptor(provider as AIProviderDescriptor),
    );
    const offRuntime = EventsOn("ai:provider:runtime", (runtime) => {
      const descriptor = runtime as AIProviderRuntimeDescriptor;
      if (!descriptor?.providerId) return;
      setProviderRuntimes((current) => {
        const next = current.filter(
          (candidate) => candidate.providerId !== descriptor.providerId,
        );
        next.push(descriptor);
        return next;
      });
    });
    const offRuntimeRecovered = EventsOn("ai:runtime:recovered", () => {
      clearHydrationFailuresForTargetsEvent();
      void refreshRuntimeEvent();
    });
    const offApprovalsRecovered = EventsOn(
      "ai:tool:approvals-recovered",
      () => {
        void refreshPendingApprovalsEvent();
      },
    );
    const offModelProbe = EventsOn("ai:model:capability-probed", () => {
      void refreshModelCapabilitiesEvent();
    });
    const offEgress = EventsOn("ai:chat:egress-recorded", (record) =>
      handleEgressRecord(record as AIEgressRecord),
    );
    const offToolAudit = EventsOn("ai:tool:call-recorded", (result) =>
      handleToolAuditRecord(result),
    );
    const offToolLifecycle = EventsOn(
      "ai:tool:lifecycle-recorded",
      (artifact) => handleToolLifecycleArtifact(artifact),
    );
    const offArtifactUpdated = EventsOn(
      "ai:chat:artifact-updated",
      (artifact) => handleChatArtifactUpdated(artifact),
    );
    const offChatToolResult = EventsOn("ai:chat:tool-result", (payload) =>
      handleChatToolResult(payload),
    );
    const offPatchApplied = EventsOn("ai:patch:artifact-applied", (payload) =>
      handlePatchArtifactAppliedEvent(payload),
    );
    const offPatchRolledBack = EventsOn(
      "ai:patch:artifact-rolled-back",
      (payload) => handlePatchArtifactAppliedEvent(payload),
    );
    return () => {
      offStarted?.();
      offCompleted?.();
      offError?.();
      offCanceled?.();
      offToken?.();
      offEnvelope?.();
      offTimeline?.();
      offStatus?.();
      offRuntime?.();
      offRuntimeRecovered?.();
      offApprovalsRecovered?.();
      offModelProbe?.();
      offEgress?.();
      offToolAudit?.();
      offToolLifecycle?.();
      offArtifactUpdated?.();
      offChatToolResult?.();
      offPatchApplied?.();
      offPatchRolledBack?.();
    };
  }, []);

  const handleRefreshProviders = useCallback(async () => {
    setLoading(true);
    try {
      const discovery = await AIRefreshLocalProviders();
      const [nextStatus, nextProviderRuntimes] = await Promise.all([
        AIGetStatus(),
        AIListProviderRuntimes(),
      ]);
      const safeStatus = normalizeAIStatus(nextStatus);
      const statusProviders = safeStatus.providers;
      const nextProviders =
        statusProviders.length > 0
          ? statusProviders
          : (discovery?.providers ?? []);
      setStatus(safeStatus);
      setProviders(nextProviders);
      setProviderRuntimes(normalizeAIProviderRuntimes(nextProviderRuntimes));
      const userPinnedProvider =
        state.providerSelectionSource === "user"
          ? nextProviders.find(
              (provider) =>
                provider.id === state.selectedProviderId &&
                isSupportedLocalChatProvider(provider),
            )
          : null;
      const defaultProvider = selectDefaultProvider(
        nextProviders,
        safeStatus.activeProviderId,
      );
      if (!userPinnedProvider && defaultProvider) {
        dispatch({
          type: "setProvider",
          providerId: defaultProvider.id,
          model: modelForProviderSelection(defaultProvider, safeStatus),
          source: "auto",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [
    setProviders,
    setStatus,
    state.providerSelectionSource,
    state.selectedProviderId,
  ]);

  const refreshContextPreview = useCallback(
    async (silent = false) => {
      if (!silent) {
        setRuntimeError(null);
      }
      try {
        const preview = await AIGetContextPreview(
          buildContextRequest(
            state.context,
            activeEditorContextFromStore(useEditorStore.getState()),
            state.input,
            selectedMentionsForActiveSession,
            state.selectedProfileId,
            activeTerminal,
            state.selectedAction,
            activeSessionId,
            {
              providerId: selectedProvider?.id || state.selectedProviderId,
              model: selectedModel,
              runtimeFamily: selectedRuntimeFamily,
              reasoningEffort: selectedReasoningEffort,
              contextWindowHint: selectedContextWindowHint,
            },
          ),
        );
        setContextPreview(normalizeAIContextSnapshot(preview));
      } catch (error) {
        if (!silent) {
          setRuntimeError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
    [
      activeSessionId,
      activeTerminal,
      selectedContextWindowHint,
      selectedModel,
      selectedProvider?.id,
      selectedReasoningEffort,
      selectedRuntimeFamily,
      setContextPreview,
      state.context,
      state.input,
      state.selectedAction,
      state.selectedProfileId,
      state.selectedProviderId,
      selectedMentionsForActiveSession,
    ],
  );

  const handleRefreshContext = useCallback(() => {
    void refreshContextPreview(false);
  }, [refreshContextPreview]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshContextPreview(true);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [refreshContextPreview]);

  useEffect(() => {
    if (activeRunRunning) return;
    const timeout = window.setTimeout(() => {
      void refreshContextPreview(true);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [activeRunRunning, activeSessionEnvelopes, refreshContextPreview]);

  const handleMentionQuery = useCallback(
    async (request: AIChatMentionQuery): Promise<AIChatMentionCandidate[]> =>
      AISuggestChatMentions(request),
    [],
  );

  const handleMentionSelect = useCallback((mention: AIChatMentionCandidate) => {
    if (mention.action) {
      dispatch({ type: "setAction", action: mention.action });
    }
    if (mention.profileId) {
      dispatch({ type: "setProfile", profileId: mention.profileId });
    }
    if (mention.workflowId) {
      dispatch({ type: "setWorkflow", workflowId: mention.workflowId });
    }
    if (mention.contextItem || mention.profileId || mention.workflowId) {
      dispatch({ type: "addMention", mention });
    }
  }, []);

  const startChatRun = useCallback(
    async (override?: {
      action?: AIChatAction;
      prompt?: string;
      sessionId?: string;
      profileId?: string;
      workflowId?: string;
      mentions?: AIChatMentionCandidate[];
      resetComposer?: boolean;
    }) => {
      const prompt = (override?.prompt ?? state.input).trim();
      const action = override?.action ?? state.selectedAction;
      const sessionId = chatSessionKey(override?.sessionId ?? activeSessionId);
      const profileId = override?.profileId ?? state.selectedProfileId;
      const workflowId = override?.workflowId ?? state.selectedWorkflowId;
      const mentions = override?.mentions ?? selectedMentionsForActiveSession;
      if (!prompt) return false;
      if (!selectedProvider || !selectedProviderReady) {
        setRuntimeError(
          providerDisabledReason || "AI provider is unavailable.",
        );
        return false;
      }
      const targetSessionRunning = runs.some(
        (run) =>
          sessionIdOf(run) === sessionId &&
          (run.status === "running" || run.status === "queued"),
      );
      if (targetSessionRunning) {
        setRuntimeError("Generation is already running in this session.");
        return false;
      }
      setRuntimeError(null);
      const latestActiveEditor = activeEditorContextFromStore(
        useEditorStore.getState(),
      );
      const request: AIContextRequest = buildContextRequest(
        state.context,
        latestActiveEditor,
        prompt,
        mentions,
        profileId,
        activeTerminal,
        action,
        sessionId,
        {
          providerId: selectedProvider.id,
          model: selectedModel,
          runtimeFamily: selectedRuntimeFamily,
          reasoningEffort: selectedReasoningEffort,
          contextWindowHint: selectedContextWindowHint,
        },
      );
      try {
        const preview = normalizeAIContextSnapshot(
          await AIGetContextPreview(request),
        );
        if (!preview) {
          throw new Error(
            "Context preview is unavailable; request was not sent.",
          );
        }
        setContextPreview(preview);
        const startRequest: AIChatRunRequest & { reasoningEffort?: string } = {
          action,
          sessionId,
          profileId: request.profileId,
          workflowId,
          prompt,
          runtimeFamily: selectedRuntimeFamily,
          providerId: selectedProvider.id,
          model: selectedModel,
          includeMnemonic: request.includeMnemonic,
          includeMCP: request.includeMCP,
          includeSkills: request.includeSkills,
          includeContinuity: request.includeContinuity,
          context: request,
          links: {},
        };
        if (selectedReasoningEffort) {
          startRequest.reasoningEffort = selectedReasoningEffort;
        }
        const run = await AIStartChatRun(startRequest);
        setHydratedRun(run);
        upsertRunEnvelope(envelopeFromRun(run));
        setActiveRunId(run.id);
        dispatch({ type: "setActiveRun", runId: run.id });
        if (override?.resetComposer !== false) {
          dispatch({ type: "resetComposer" });
        }
        return true;
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
        return false;
      }
    },
    [
      activeTerminal,
      activeSessionId,
      providerDisabledReason,
      runs,
      selectedContextWindowHint,
      selectedModel,
      selectedReasoningEffort,
      selectedProvider,
      selectedProviderReady,
      selectedRuntimeFamily,
      setActiveRunId,
      setContextPreview,
      setHydratedRun,
      state.context,
      state.input,
      state.selectedAction,
      selectedMentionsForActiveSession,
      state.selectedProfileId,
      state.selectedWorkflowId,
      upsertRunEnvelope,
    ],
  );

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedProvider) return;
    await startChatRun();
  }, [canSend, selectedProvider, startChatRun]);

  const handleStartAgentLogin = useCallback(
    async (provider: AIProviderDescriptor): Promise<AIChatRun | null> => {
      if (!provider?.id || activeRunRunning) return null;
      setRuntimeError(null);
      try {
        const run = await AIStartAgentAuthRun(provider.id);
        setHydratedRun(run);
        upsertRunEnvelope(envelopeFromRun(run));
        setActiveRunId(run.id);
        dispatch({
          type: "setActiveSession",
          sessionId: run.sessionId || defaultChatSessionId,
          runId: run.id,
        });
        dispatch({ type: "setActiveRun", runId: run.id });
        return run;
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [activeRunRunning, setActiveRunId, setHydratedRun, upsertRunEnvelope],
  );

  const handleCancelAgentLogin = useCallback(
    async (runId: string) => {
      if (!runId) return;
      setRuntimeError(null);
      try {
        const run = await AICancelChatRun(runId);
        upsertRunEnvelope(envelopeFromRun(run));
        setHydratedRun(run);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [setHydratedRun, upsertRunEnvelope],
  );

  const handleStartProviderOAuth = useCallback(
    async (
      provider: AIProviderDescriptor,
    ): Promise<AIProviderAuthSession | null> => {
      if (!provider?.id) return null;
      setRuntimeError(null);
      try {
        return await AIStartProviderOAuth(provider.id);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [],
  );

  const handleCancelProviderAuth = useCallback(
    async (sessionId: string): Promise<AIProviderAuthSession | null> => {
      if (!sessionId) return null;
      setRuntimeError(null);
      try {
        return await AICancelProviderAuth(sessionId);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
        return null;
      }
    },
    [],
  );

  const activateWorkflowRun = useCallback(
    (run: AIChatRun | null | undefined) => {
      if (!run?.id) return;
      setHydratedRun(run);
      upsertRunEnvelope(envelopeFromRun(run));
      setActiveRunId(run.id);
      dispatch({
        type: "setActiveSession",
        sessionId: run.sessionId || defaultChatSessionId,
        runId: run.id,
      });
      dispatch({ type: "setActiveRun", runId: run.id });
    },
    [setActiveRunId, setHydratedRun, upsertRunEnvelope],
  );

  const handleSubmitQuestionAnswer = useCallback(
    async (request: AIQuestionAnswerRequest) => {
      if (!request.runId) return;
      const busyId = `question:${request.runId}:${request.questionId || request.optionId || "custom"}`;
      setRuntimeError(null);
      setArtifactBusyId(busyId);
      try {
        const result = await AISubmitQuestionAnswer(request);
        activateWorkflowRun(result.run);
        await refreshRunArtifacts(request.runId);
        if (result.run?.id) {
          await refreshRunArtifacts(result.run.id);
        }
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [activateWorkflowRun, refreshRunArtifacts],
  );

  const handleAcceptPlan = useCallback(
    async (planRunId: string) => {
      const targetRunId = planRunId.trim();
      if (!targetRunId) return;
      setRuntimeError(null);
      setArtifactBusyId(`plan:${targetRunId}:accept`);
      try {
        const result = await AIAcceptPlan({ planRunId: targetRunId });
        activateWorkflowRun(result.run);
        await refreshRunArtifacts(targetRunId);
        if (result.run?.id) {
          await refreshRunArtifacts(result.run.id);
        }
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [activateWorkflowRun, refreshRunArtifacts],
  );

  const handleRequestPlanRevision = useCallback(
    async (planRunId: string, reason: string) => {
      const targetRunId = planRunId.trim();
      if (!targetRunId) return;
      setRuntimeError(null);
      setArtifactBusyId(`plan:${targetRunId}:revision`);
      try {
        const result = await AIRequestPlanRevision({
          planRunId: targetRunId,
          reason,
        });
        activateWorkflowRun(result.run);
        await refreshRunArtifacts(targetRunId);
        if (result.run?.id) {
          await refreshRunArtifacts(result.run.id);
        }
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [activateWorkflowRun, refreshRunArtifacts],
  );

  const handleCancel = useCallback(async () => {
    const running =
      activeEnvelope &&
      (activeEnvelope.status === "running" ||
        activeEnvelope.status === "queued")
        ? activeEnvelope
        : activeSessionEnvelopes.find(
            (run) => run.status === "running" || run.status === "queued",
          );
    if (!running) return;
    await AICancelChatRun(running.id);
  }, [activeEnvelope, activeSessionEnvelopes]);

  useEffect(() => {
    const offStopAgent = EventsOn("ide:ai:stop-agent", () => {
      void handleCancel();
    });
    return () => offStopAgent?.();
  }, [handleCancel]);

  const activeCommandIntent = commandIntents[0] ?? null;
  const processingCommandIntentIdsRef = useRef(new Set<string>());

  const processCommandIntent = useCallback(
    async (intent: NonNullable<typeof activeCommandIntent>) => {
      if (processingCommandIntentIdsRef.current.has(intent.id)) {
        return;
      }
      processingCommandIntentIdsRef.current.add(intent.id);
      try {
        switch (intent.actionId) {
          case "ai.newChat": {
            const sessionId = createChatSessionId();
            setActiveRunId(null);
            dispatch({ type: "resetComposer" });
            dispatch({ type: "setActiveSession", sessionId });
            break;
          }
          case "ai.selectAction": {
            if (intent.action) {
              dispatch({ type: "setAction", action: intent.action });
            }
            dispatch({ type: "setInput", input: "" });
            break;
          }
          case "ai.startFromInput": {
            if (!intent.prompt || !intent.action) {
              break;
            }
            const sessionId = createChatSessionId();
            setActiveRunId(null);
            dispatch({ type: "setActiveSession", sessionId });
            dispatch({
              type: "setAction",
              action: intent.action,
              profileId: intent.profileId,
            });
            if (intent.workflowId) {
              dispatch({ type: "setWorkflow", workflowId: intent.workflowId });
            }
            dispatch({ type: "setInput", input: intent.prompt });
            const started = await startChatRun({
              action: intent.action,
              prompt: intent.prompt,
              sessionId,
              profileId: intent.profileId,
              workflowId: intent.workflowId,
              mentions: [],
              resetComposer: false,
            });
            if (started) {
              dispatch({ type: "setInput", input: "" });
            }
            break;
          }
          case "ai.pendingApprovals":
            dispatch({ type: "toggleActivityPopover", open: true });
            await refreshPendingApprovals();
            break;
          case "ai.runtimeStatus":
            dispatch({ type: "toggleActivityPopover", open: true });
            break;
          case "ai.approvalSettings":
            dispatch({ type: "toggleSettingsPopover", open: true });
            break;
          case "ai.cancelActiveRun":
            await handleCancel();
            break;
        }
      } finally {
        processingCommandIntentIdsRef.current.delete(intent.id);
        consumeCommandIntent(intent.id);
      }
    },
    [
      consumeCommandIntent,
      handleCancel,
      refreshPendingApprovals,
      setActiveRunId,
      startChatRun,
    ],
  );

  useEffect(() => {
    if (!activeCommandIntent) return;
    if (activeCommandIntent.actionId === "ai.startFromInput") {
      if (!runtimeHydrated) return;
      if (providers.length > 0 && !selectedProvider) return;
      if (
        selectedProvider &&
        (selectedProvider.models?.length ?? 0) > 0 &&
        !selectedModel
      ) {
        return;
      }
    }
    void processCommandIntent(activeCommandIntent);
  }, [
    activeCommandIntent,
    processCommandIntent,
    providers.length,
    runtimeHydrated,
    selectedModel,
    selectedProvider,
  ]);

  const handleApplyPatchArtifact = useCallback(
    async (artifactId: string, runId?: string) => {
      const targetRunId = runId?.trim() || activeRunKey;
      if (targetRunId) {
        setActiveRunId(targetRunId);
        dispatch({ type: "setActiveRun", runId: targetRunId });
      }
      setRuntimeError(null);
      setArtifactBusyId(artifactId);
      try {
        await AIApplyPatchArtifact({ artifactId });
        if (targetRunId) {
          await refreshRunArtifacts(targetRunId);
        } else {
          await refreshActiveArtifacts();
        }
        dispatchChrome({ type: "openDrawer", drawer: "review" });
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [activeRunKey, refreshActiveArtifacts, refreshRunArtifacts, setActiveRunId],
  );

  const handleRollbackPatchArtifact = useCallback(
    async (artifactOrCheckpointId: string, runId?: string) => {
      const targetRunId = runId?.trim() || activeRunKey;
      if (targetRunId) {
        setActiveRunId(targetRunId);
        dispatch({ type: "setActiveRun", runId: targetRunId });
      }
      const artifact =
        allKnownArtifacts.find(
          (candidate) => candidate.id === artifactOrCheckpointId,
        ) ?? null;
      const artifactId = artifact?.id || artifactOrCheckpointId;
      setRuntimeError(null);
      setArtifactBusyId(artifactId);
      try {
        await AIRollbackPatchCheckpoint({
          checkpointId: artifact?.id ? "" : artifactOrCheckpointId,
          artifactId: artifact?.id,
        });
        if (targetRunId) {
          await refreshRunArtifacts(targetRunId);
        } else {
          await refreshActiveArtifacts();
        }
        dispatchChrome({ type: "openDrawer", drawer: "review" });
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [
      activeRunKey,
      allKnownArtifacts,
      refreshActiveArtifacts,
      refreshRunArtifacts,
      setActiveRunId,
    ],
  );

  const refreshMnemonicEntries = useCallback(async () => {
    const entries = await AIListMnemonicEntries(24);
    setMnemonicEntries(normalizeAIMnemonicEntries(entries));
  }, [setMnemonicEntries]);

  const handleMnemonicSearch = useCallback(
    async (query: string) => {
      setMnemonicBusy(true);
      setMnemonicError("");
      try {
        const trimmed = query.trim();
        const entries = trimmed
          ? await AISearchMnemonic({
              query: trimmed,
              limit: 24,
              includeGenerated: true,
              includeSuperseded: true,
              includeUntrusted: true,
            })
          : await AIListMnemonicEntries(24);
        setMnemonicEntries(normalizeAIMnemonicEntries(entries));
      } catch (error) {
        setMnemonicError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMnemonicBusy(false);
      }
    },
    [setMnemonicEntries],
  );

  const handleMnemonicSave = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      setMnemonicBusy(true);
      setMnemonicError("");
      try {
        await AISaveMnemonicEntry({
          content: trimmed,
          type: "note",
          source: "user",
          trust: "trusted",
          pinned: true,
          isLatest: true,
          confidence: 1,
          importance: 5,
          provenance: {
            reviewedBy: "user",
            source: "ai-chat-settings",
          },
        });
        await refreshMnemonicEntries();
      } catch (error) {
        setMnemonicError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMnemonicBusy(false);
      }
    },
    [refreshMnemonicEntries],
  );

  const handleMnemonicPromote = useCallback(
    async (entryId: string) => {
      if (!entryId) return;
      setMnemonicBusy(true);
      setMnemonicError("");
      try {
        await AIUpdateMnemonicEntry(entryId, {
          trust: "trusted",
          pinned: true,
          isLatest: true,
          provenance: {
            reviewedBy: "user",
            promotion: "user_confirmed",
          },
        });
        await refreshMnemonicEntries();
      } catch (error) {
        setMnemonicError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMnemonicBusy(false);
      }
    },
    [refreshMnemonicEntries],
  );

  const handleApproveMnemonicArtifact = useCallback(
    async (artifactId: string) => {
      if (!artifactId) return;
      setArtifactBusyId(artifactId);
      setRuntimeError(null);
      try {
        await AIApproveMnemonicEntryProposal({
          artifactId,
          reviewedBy: "user",
          trust: "trusted",
          pinned: true,
        });
        await Promise.all([refreshActiveArtifacts(), refreshMnemonicEntries()]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshActiveArtifacts, refreshMnemonicEntries],
  );

  const handlePreviewToolProposal = useCallback(
    async (proposal: AIToolProposal, runId: string, runRevision?: number) => {
      const toolId = previewableToolIdForProposal(proposal);
      if (!toolId || !runId) return;
      const busyId = proposal.id || toolId;
      setArtifactBusyId(busyId);
      setRuntimeError(null);
      try {
        const result = await AIExecuteToolCall({
          runId,
          runRevision,
          toolId,
          action: AIToolCallAction.AIToolCallActionPreview,
          arguments: proposal.arguments ?? {},
        });
        if (result?.audit?.id) {
          upsertToolAudit(result.audit);
        }
        await Promise.all([
          refreshRunArtifacts(runId),
          refreshPendingApprovalsEvent(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovalsEvent, refreshRunArtifacts, upsertToolAudit],
  );

  const handleDenyToolProposal = useCallback(
    async (proposal: AIToolProposal, runId: string, runRevision?: number) => {
      const toolId = toolIdForProposal(proposal);
      if (!toolId || !runId) return;
      const busyId = `deny:${proposal.id || proposal.name || toolId}`;
      setArtifactBusyId(busyId);
      setRuntimeError(null);
      try {
        const result = await AIExecuteToolCall({
          runId,
          runRevision,
          toolId,
          action: AIToolCallAction.AIToolCallActionDeny,
          arguments: proposal.arguments ?? {},
        });
        if (result?.audit?.id) {
          upsertToolAudit(result.audit);
        }
        await Promise.all([
          refreshRunArtifacts(runId),
          refreshPendingApprovalsEvent(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovalsEvent, refreshRunArtifacts, upsertToolAudit],
  );

  const handleApproveToolProposal = useCallback(
    async (
      proposal: AIToolProposal,
      runId: string,
      scope: "once" | "run",
      runRevision?: number,
    ) => {
      const toolId = toolIdForProposal(proposal);
      if (!toolId || !runId) return;
      const action =
        scope === "run"
          ? AIToolCallAction.AIToolCallActionApproveForRun
          : AIToolCallAction.AIToolCallActionApproveOnce;
      const busyId = `approve:${scope}:${proposal.id || proposal.name || toolId}`;
      setArtifactBusyId(busyId);
      setRuntimeError(null);
      try {
        const result = await AIExecuteToolCall({
          runId,
          runRevision,
          toolId,
          action,
          arguments: proposal.arguments ?? {},
        });
        if (result?.audit?.id) {
          upsertToolAudit(result.audit);
        }
        await Promise.all([
          refreshRunArtifacts(runId),
          refreshPendingApprovalsEvent(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovalsEvent, refreshRunArtifacts, upsertToolAudit],
  );

  const handleApprovePendingApproval = useCallback(
    async (approval: AIPendingApproval, scope: "once" | "run") => {
      if (!approval.runId || !approval.toolId) return;
      const action =
        scope === "run"
          ? AIToolCallAction.AIToolCallActionApproveForRun
          : AIToolCallAction.AIToolCallActionApproveOnce;
      const busyId = `approval:${scope}:${approval.id}`;
      setArtifactBusyId(busyId);
      setRuntimeError(null);
      try {
        const result = await AIExecuteToolCall({
          runId: approval.runId,
          toolId: approval.toolId,
          action,
          arguments: approval.arguments ?? {},
        });
        if (result?.audit?.id) {
          upsertToolAudit(result.audit);
        }
        await Promise.all([
          refreshRunArtifacts(approval.runId),
          refreshPendingApprovalsEvent(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovalsEvent, refreshRunArtifacts, upsertToolAudit],
  );

  const handleDenyPendingApproval = useCallback(
    async (approval: AIPendingApproval) => {
      if (!approval.runId || !approval.toolId) return;
      const busyId = `approval:deny:${approval.id}`;
      setArtifactBusyId(busyId);
      setRuntimeError(null);
      try {
        const result = await AIExecuteToolCall({
          runId: approval.runId,
          toolId: approval.toolId,
          action: AIToolCallAction.AIToolCallActionDeny,
          arguments: approval.arguments ?? {},
        });
        if (result?.audit?.id) {
          upsertToolAudit(result.audit);
        }
        await Promise.all([
          refreshRunArtifacts(approval.runId),
          refreshPendingApprovalsEvent(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovalsEvent, refreshRunArtifacts, upsertToolAudit],
  );

  const handleAcceptLocalProviderConsent = useCallback(async () => {
    setRuntimeError(null);
    try {
      const nextPolicy = await AISaveConsentPolicy({
        ...(consentPolicy ?? defaultAIConsentPolicy()),
        localProvidersAccepted: true,
      });
      setConsentPolicy(
        normalizeAIConsentPolicy(nextPolicy) ?? defaultAIConsentPolicy(),
      );
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [consentPolicy, setConsentPolicy]);

  const handleAcceptExternalAgentConsent = useCallback(async () => {
    setRuntimeError(null);
    try {
      const nextPolicy = await AISaveConsentPolicy({
        ...(consentPolicy ?? defaultAIConsentPolicy()),
        externalAgentCliAccepted: true,
      });
      setConsentPolicy(
        normalizeAIConsentPolicy(nextPolicy) ?? defaultAIConsentPolicy(),
      );
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [consentPolicy, setConsentPolicy]);

  const handleAcceptRemoteBYOKProviderConsent = useCallback(async () => {
    setRuntimeError(null);
    try {
      const nextPolicy = await AISaveConsentPolicy({
        ...(consentPolicy ?? defaultAIConsentPolicy()),
        remoteProvidersAccepted: true,
      });
      setConsentPolicy(
        normalizeAIConsentPolicy(nextPolicy) ?? defaultAIConsentPolicy(),
      );
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [consentPolicy, setConsentPolicy]);

  const handleAcceptFrontierProviderConsent = useCallback(async () => {
    setRuntimeError(null);
    try {
      const nextPolicy = await AISaveConsentPolicy({
        ...(consentPolicy ?? defaultAIConsentPolicy()),
        frontierProvidersAccepted: true,
      });
      setConsentPolicy(
        normalizeAIConsentPolicy(nextPolicy) ?? defaultAIConsentPolicy(),
      );
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [consentPolicy, setConsentPolicy]);

  const handleNewChat = useCallback(() => {
    const sessionId = createChatSessionId();
    setActiveRunId(null);
    dispatch({ type: "resetComposer" });
    dispatch({ type: "setActiveSession", sessionId });
  }, [setActiveRunId]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const sessionRuns = runs.filter((run) => sessionIdOf(run) === sessionId);
      clearHydrationFailuresForRunIds(sessionRuns.map((run) => run.id));
      const nextRun = sessionRuns[0];
      setActiveRunId(nextRun?.id ?? null);
      dispatch({
        type: "setActiveSession",
        sessionId,
        runId: nextRun?.id ?? "",
      });
    },
    [clearHydrationFailuresForRunIds, runs, setActiveRunId],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim() || defaultChatSessionId;
      setRuntimeError(null);
      try {
        await AIDeleteChatSession(normalizedSessionId);
        const remainingRuns = runs.filter(
          (run) => sessionIdOf(run) !== normalizedSessionId,
        );
        deleteSessionRuns(normalizedSessionId);
        if (normalizedSessionId === activeSessionId) {
          const nextRun = remainingRuns[0];
          if (nextRun) {
            setActiveRunId(nextRun.id);
            dispatch({
              type: "setActiveSession",
              sessionId: sessionIdOf(nextRun),
              runId: nextRun.id,
            });
          } else {
            const nextSessionId = createChatSessionId();
            setActiveRunId(null);
            dispatch({ type: "setActiveSession", sessionId: nextSessionId });
          }
        }
        await refreshRuntime();
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSessionId, deleteSessionRuns, refreshRuntime, runs, setActiveRunId],
  );

  const handleProviderSelect = useCallback((provider: AIProviderDescriptor) => {
    if (!isSupportedLocalChatProvider(provider)) return;
    dispatch({
      type: "setProvider",
      providerId: provider.id,
      model: provider.models?.[0]?.id ?? "",
      source: "user",
    });
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    dispatch({ type: "setModel", model: modelId });
  }, []);

  const handleProbeModelCapability = useCallback(async () => {
    if (!selectedProvider || !selectedModel) {
      return;
    }
    setProviderRuntimeBusy(true);
    setProviderRuntimeError("");
    try {
      await AIProbeModelCapability({
        providerId: selectedProvider.id,
        model: selectedModel,
        force: true,
      });
      await refreshModelCapabilities();
    } catch (error) {
      setProviderRuntimeError(
        error instanceof Error ? error.message : String(error),
      );
      await refreshModelCapabilities();
    } finally {
      setProviderRuntimeBusy(false);
    }
  }, [refreshModelCapabilities, selectedModel, selectedProvider]);

  const handleStartProviderRuntime = useCallback(
    async (provider: AIProviderDescriptor, model: AIProviderRuntimeModel) => {
      setProviderRuntimeBusy(true);
      setProviderRuntimeError("");
      try {
        const runtime = await AIStartProviderRuntime({
          providerId: provider.id,
          kind: provider.kind,
          endpoint: provider.endpoint,
          modelId: model.id,
          modelPath: model.path,
        });
        setProviderRuntimes((current) => {
          const next = current.filter(
            (candidate) => candidate.providerId !== runtime.providerId,
          );
          next.push(runtime);
          return next;
        });
        dispatch({ type: "setModel", model: model.id });
        await handleRefreshProviders();
      } catch (error) {
        setProviderRuntimeError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setProviderRuntimeBusy(false);
      }
    },
    [handleRefreshProviders],
  );

  const handleStopProviderRuntime = useCallback(
    async (providerId: string) => {
      setProviderRuntimeBusy(true);
      setProviderRuntimeError("");
      try {
        const runtime = await AIStopProviderRuntime(providerId);
        setProviderRuntimes((current) => {
          const next = current.filter(
            (candidate) => candidate.providerId !== runtime.providerId,
          );
          next.push(runtime);
          return next;
        });
        await handleRefreshProviders();
      } catch (error) {
        setProviderRuntimeError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setProviderRuntimeBusy(false);
      }
    },
    [handleRefreshProviders],
  );

  const closeTransientPopovers = useCallback(() => {
    dispatch({ type: "toggleProviderPopover", open: false });
    dispatch({ type: "toggleSettingsPopover", open: false });
    dispatch({ type: "toggleActivityPopover", open: false });
    dispatchChrome({
      type: "patch",
      value: { sessionSearchOpen: false },
    });
  }, []);

  const handleToggleControlsCollapsed = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({
      type: "patch",
      value: { controlsCollapsed: !controlsCollapsed },
    });
  }, [beginChatMotionWindow, closeTransientPopovers, controlsCollapsed]);

  const handleToggleLeftControlsCollapsed = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({
      type: "patch",
      value: { leftControlsCollapsed: !leftControlsCollapsed },
    });
  }, [beginChatMotionWindow, closeTransientPopovers, leftControlsCollapsed]);

  const handleToggleRightControlsCollapsed = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({
      type: "patch",
      value: { rightControlsCollapsed: !rightControlsCollapsed },
    });
  }, [beginChatMotionWindow, closeTransientPopovers, rightControlsCollapsed]);

  const handlePanelToggleHistory = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({
      type: historyOpen ? "closeDrawer" : "openDrawer",
      drawer: "history",
    });
  }, [beginChatMotionWindow, closeTransientPopovers, historyOpen]);

  const handlePanelToggleSessionSearch = useCallback(() => {
    const nextOpen = !sessionSearchOpen;
    dispatch({ type: "toggleProviderPopover", open: false });
    dispatch({ type: "toggleSettingsPopover", open: false });
    dispatch({ type: "toggleActivityPopover", open: false });
    dispatchChrome({
      type: "patch",
      value: {
        sessionSearchOpen: nextOpen,
        sessionSearch: nextOpen ? sessionSearch : "",
      },
    });
  }, [sessionSearch, sessionSearchOpen]);

  const handlePanelToggleActivity = useCallback(() => {
    dispatch({ type: "toggleActivityPopover" });
    dispatchChrome({
      type: "patch",
      value: { sessionSearchOpen: false },
    });
  }, []);

  const handlePanelOpenSettings = useCallback(() => {
    dispatchApplicationMenuAction("settings.toggle");
    dispatchChrome({
      type: "patch",
      value: { sessionSearchOpen: false },
    });
  }, []);

  const panelContextItems = useMemo<ContextActionMenuItem[]>(
    () => [
      {
        key: "new-chat",
        label: "New Chat",
        icon: <MessageSquarePlus size={13} />,
        onSelect: handleNewChat,
      },
      {
        key: "toggle-history",
        label: historyOpen ? "Close History" : "Open History",
        icon: <History size={13} />,
        onSelect: handlePanelToggleHistory,
      },
      {
        key: "search-session",
        label: sessionSearchOpen ? "Close Search" : "Search Current Chat",
        icon: <Search size={13} />,
        disabled: transcriptRuns.length === 0 && !sessionSearchOpen,
        onSelect: handlePanelToggleSessionSearch,
      },
      { separator: true },
      {
        key: "runtime-activity",
        label: state.activityPopoverOpen
          ? "Close Runtime Activity"
          : "Runtime Activity",
        icon: <CheckCircle2 size={13} />,
        onSelect: handlePanelToggleActivity,
      },
      {
        key: "settings",
        label: "AI Chat Settings",
        icon: <Settings size={13} />,
        onSelect: handlePanelOpenSettings,
      },
    ],
    [
      handleNewChat,
      handlePanelOpenSettings,
      handlePanelToggleActivity,
      handlePanelToggleHistory,
      handlePanelToggleSessionSearch,
      historyOpen,
      sessionSearchOpen,
      state.activityPopoverOpen,
      transcriptRuns.length,
    ],
  );

  useEffect(() => {
    const popoverOpen =
      state.providerPopoverOpen ||
      state.settingsPopoverOpen ||
      state.activityPopoverOpen ||
      sessionSearchOpen;
    if (!popoverOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-ai-chat-popover-scope]")) return;
      closeTransientPopovers();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeTransientPopovers();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    closeTransientPopovers,
    sessionSearchOpen,
    state.activityPopoverOpen,
    state.providerPopoverOpen,
    state.settingsPopoverOpen,
  ]);

  const panelClass = [
    "ai-chat-panel",
    `ai-chat-panel--${presentation}`,
    state.displayPrefs.compactCards ? "is-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section ref={panelRef} className={panelClass} data-testid="ai-chat-panel">
      <LazyMotion features={domAnimation}>
        {!fullscreen ? (
          <AIChatHeader
            activeEnvelope={activeEnvelope}
            activeRun={activeRun}
            activeRunText={
              activeRun?.response ?? streamingTextByRunId[activeRunKey] ?? ""
            }
            activityPopoverOpen={state.activityPopoverOpen}
            agentProfiles={agentProfiles}
            approvalPolicy={approvalPolicy}
            artifactBusyId={artifactBusyId}
            artifacts={activeArtifacts}
            context={state.context}
            contextPreview={contextPreview}
            contextProviders={contextProviders}
            consentPolicy={consentPolicy}
            displayPrefs={state.displayPrefs}
            egressRecords={egressRecords}
            embeddingStatus={embeddingStatus}
            loading={loading}
            mnemonicEntries={mnemonicEntries}
            promptWorkflows={promptWorkflows}
            historyOpen={historyOpen}
            reviewExpanded={reviewExpanded}
            reviewOpen={reviewOpen}
            controlsCollapsed={controlsCollapsed}
            sessionSearch={sessionSearch}
            sessionSearchOpen={sessionSearchOpen}
            sessionSearchMatchCount={
              sessionSearchTerms.length > 0 && sessionSearchMatches.length > 0
                ? Math.max(activeSessionSearchIndex, 0) + 1
                : 0
            }
            sessionSearchTotalCount={
              sessionSearchTerms.length > 0 ? sessionSearchMatches.length : 0
            }
            selectedProvider={selectedProvider}
            selectedProviderReady={selectedProviderReady}
            settingsPopoverOpen={state.settingsPopoverOpen}
            status={status}
            tools={tools}
            toolAudit={toolAudit}
            modelCapabilities={modelCapabilities}
            mnemonicBusy={mnemonicBusy}
            mnemonicError={mnemonicError}
            onContextToggle={handleContextToggle}
            onDisplayPrefChange={handleDisplayPrefChange}
            onToggleActivityPopover={() => {
              dispatch({ type: "toggleActivityPopover" });
              dispatchChrome({
                type: "patch",
                value: { sessionSearchOpen: false },
              });
            }}
            onToggleHistory={() => {
              beginChatMotionWindow();
              closeTransientPopovers();
              dispatchChrome({
                type: historyOpen ? "closeDrawer" : "openDrawer",
                drawer: "history",
              });
            }}
            onToggleReview={() => {
              beginChatMotionWindow();
              closeTransientPopovers();
              if (reviewExpanded) {
                dispatchChrome({
                  type: "patch",
                  value: { reviewExpanded: false, reviewOpen: false },
                });
                return;
              }
              dispatchChrome({
                type: reviewOpen ? "closeDrawer" : "openDrawer",
                drawer: "review",
              });
            }}
            onToggleControlsCollapsed={handleToggleControlsCollapsed}
            onToggleSessionSearch={() => {
              const nextOpen = !sessionSearchOpen;
              dispatch({ type: "toggleProviderPopover", open: false });
              dispatch({ type: "toggleSettingsPopover", open: false });
              dispatch({ type: "toggleActivityPopover", open: false });
              dispatchChrome({
                type: "patch",
                value: {
                  sessionSearchOpen: nextOpen,
                },
              });
            }}
            onSessionSearchChange={(value) =>
              dispatchChrome({ type: "patch", value: { sessionSearch: value } })
            }
            onSessionSearchPrevious={() => handleNavigateSessionSearch(-1)}
            onSessionSearchNext={() => handleNavigateSessionSearch(1)}
            onClearSessionSearch={() =>
              dispatchChrome({ type: "patch", value: { sessionSearch: "" } })
            }
            onNewChat={handleNewChat}
            onRefreshRuntime={refreshRuntime}
            onMnemonicSearch={handleMnemonicSearch}
            onMnemonicSave={handleMnemonicSave}
            onMnemonicPromote={handleMnemonicPromote}
            onAcceptLocalProviderConsent={handleAcceptLocalProviderConsent}
            onAcceptExternalAgentConsent={handleAcceptExternalAgentConsent}
            onAcceptRemoteBYOKProviderConsent={
              handleAcceptRemoteBYOKProviderConsent
            }
            onAcceptFrontierProviderConsent={
              handleAcceptFrontierProviderConsent
            }
            onToggleSettingsPopover={() => {
              dispatchApplicationMenuAction("settings.toggle");
              dispatchChrome({
                type: "patch",
                value: { sessionSearchOpen: false },
              });
            }}
          />
        ) : null}

        <div
          ref={workbenchRef}
          className="ai-chat-workbench"
          data-presentation={
            presentation === "fullscreen" ? "expanded" : "panel"
          }
        >
          <LayoutGroup>
            {drawerDrag ? (
              <div className="ai-chat-drawer-snap-zones" aria-hidden="true">
                <div
                  className="ai-chat-drawer-snap-zone ai-chat-drawer-snap-zone--left"
                  data-active={
                    drawerDrag.targetEdge === "left" ? "true" : "false"
                  }
                />
                <div
                  className="ai-chat-drawer-snap-zone ai-chat-drawer-snap-zone--right"
                  data-active={
                    drawerDrag.targetEdge === "right" ? "true" : "false"
                  }
                />
              </div>
            ) : null}
            <AnimatePresence initial={false}>
              {fullscreen && leftControlsCollapsed ? (
                <m.button
                  className="ai-chat-fullscreen-curtain-toggle ai-chat-fullscreen-curtain-toggle--left"
                  data-testid="ai-chat-fullscreen-left-controls-toggle"
                  type="button"
                  title="Show left chat controls"
                  aria-pressed="true"
                  initial={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }
                  }
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.18 }}
                  onClick={handleToggleLeftControlsCollapsed}
                >
                  <ChevronRight size={16} />
                </m.button>
              ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {fullscreen && rightControlsCollapsed ? (
                <m.button
                  className="ai-chat-fullscreen-curtain-toggle ai-chat-fullscreen-curtain-toggle--right"
                  data-testid="ai-chat-fullscreen-right-controls-toggle"
                  type="button"
                  title="Show right chat controls"
                  aria-pressed="true"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.18 }}
                  onClick={handleToggleRightControlsCollapsed}
                >
                  <ChevronLeft size={16} />
                </m.button>
              ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {fullscreen && !leftControlsCollapsed ? (
                <m.nav
                  className="ai-chat-focus-rail ai-chat-focus-rail--left"
                  data-ai-chat-popover-scope
                  aria-label="AI Chat navigation"
                  initial={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }
                  }
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.18 }}
                >
                  <button
                    className="ai-chat-icon-button ai-chat-chrome-toggle"
                    data-testid="ai-chat-fullscreen-controls-collapse"
                    type="button"
                    title="Hide left chat controls"
                    aria-pressed="false"
                    onClick={handleToggleLeftControlsCollapsed}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className={`ai-chat-icon-button${historyOpen ? " is-active" : ""}`}
                    type="button"
                    title="History"
                    onClick={() => {
                      beginChatMotionWindow();
                      closeTransientPopovers();
                      dispatchChrome({
                        type: historyOpen ? "closeDrawer" : "openDrawer",
                        drawer: "history",
                      });
                    }}
                  >
                    <History size={16} />
                  </button>
                  <button
                    className="ai-chat-icon-button"
                    type="button"
                    title="New chat"
                    onClick={handleNewChat}
                  >
                    <MessageSquarePlus size={16} />
                  </button>
                  <button
                    className={`ai-chat-icon-button${sessionSearchOpen ? " is-active" : ""}`}
                    type="button"
                    title="Search current session"
                    onClick={() => {
                      dispatch({ type: "toggleProviderPopover", open: false });
                      dispatch({ type: "toggleSettingsPopover", open: false });
                      dispatch({ type: "toggleActivityPopover", open: false });
                      dispatchChrome({
                        type: "patch",
                        value: {
                          sessionSearchOpen: !sessionSearchOpen,
                        },
                      });
                    }}
                  >
                    <Search size={16} />
                  </button>
                  <AnimatePresence initial={false}>
                    {sessionSearchOpen ? (
                      <m.div
                        className="ai-chat-popover ai-chat-header-search ai-chat-rail-popover"
                        role="search"
                        aria-label="Search current chat session"
                        initial={
                          reduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, x: -6, scale: 0.98 }
                        }
                        animate={
                          reduceMotion
                            ? { opacity: 1 }
                            : { opacity: 1, x: 0, scale: 1 }
                        }
                        exit={
                          reduceMotion
                            ? { opacity: 0 }
                            : { opacity: 0, x: -4, scale: 0.98 }
                        }
                        transition={{ duration: reduceMotion ? 0.1 : 0.16 }}
                      >
                        <div className="ai-chat-search-field ai-chat-search-field--header">
                          {sessionSearch ? null : <Search size={14} />}
                          <input
                            autoFocus
                            aria-label="Search current chat session"
                            placeholder="Search this session..."
                            value={sessionSearch}
                            onChange={(event) =>
                              dispatchChrome({
                                type: "patch",
                                value: { sessionSearch: event.target.value },
                              })
                            }
                          />
                          {sessionSearch ? (
                            <>
                              <span className="ai-chat-header-search__count">
                                {sessionSearchTerms.length > 0 &&
                                sessionSearchMatches.length > 0
                                  ? Math.max(activeSessionSearchIndex, 0) + 1
                                  : 0}
                                /
                                {sessionSearchTerms.length > 0
                                  ? sessionSearchMatches.length
                                  : 0}
                              </span>
                              <div
                                className="ai-chat-header-search__nav"
                                aria-label="Search result navigation"
                              >
                                <button
                                  className="ai-chat-icon-button ai-chat-icon-button--compact"
                                  type="button"
                                  title="Previous search result"
                                  disabled={sessionSearchMatches.length === 0}
                                  onClick={() =>
                                    handleNavigateSessionSearch(-1)
                                  }
                                >
                                  <ChevronUp size={14} />
                                </button>
                                <button
                                  className="ai-chat-icon-button ai-chat-icon-button--compact"
                                  type="button"
                                  title="Next search result"
                                  disabled={sessionSearchMatches.length === 0}
                                  onClick={() => handleNavigateSessionSearch(1)}
                                >
                                  <ChevronDown size={14} />
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </m.div>
                    ) : null}
                  </AnimatePresence>
                </m.nav>
              ) : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {fullscreen && !rightControlsCollapsed ? (
                <m.nav
                  className="ai-chat-focus-rail ai-chat-focus-rail--right"
                  data-ai-chat-popover-scope
                  aria-label="AI Chat tools"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
                  transition={{ duration: reduceMotion ? 0.1 : 0.18 }}
                >
                  <button
                    className="ai-chat-icon-button ai-chat-chrome-toggle"
                    data-testid="ai-chat-fullscreen-right-controls-collapse"
                    type="button"
                    title="Hide right chat controls"
                    aria-pressed="false"
                    onClick={handleToggleRightControlsCollapsed}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className={`ai-chat-icon-button${reviewOpen || reviewExpanded ? " is-active" : ""}`}
                    type="button"
                    title="Git review"
                    onClick={() => {
                      beginChatMotionWindow();
                      closeTransientPopovers();
                      if (reviewExpanded) {
                        dispatchChrome({
                          type: "patch",
                          value: { reviewExpanded: false, reviewOpen: false },
                        });
                        return;
                      }
                      dispatchChrome({
                        type: reviewOpen ? "closeDrawer" : "openDrawer",
                        drawer: "review",
                      });
                    }}
                  >
                    <GitBranch size={16} />
                  </button>
                  <button
                    className={`ai-chat-icon-button${state.activityPopoverOpen ? " is-active" : ""}`}
                    type="button"
                    title="Runtime activity"
                    onClick={() => {
                      dispatch({ type: "toggleActivityPopover" });
                      dispatchChrome({
                        type: "patch",
                        value: {
                          sessionSearchOpen: false,
                        },
                      });
                    }}
                  >
                    <CheckCircle2 size={16} />
                  </button>
                  <AnimatePresence initial={false}>
                    {state.activityPopoverOpen ? (
                      <ActivityStatusPopover
                        activeEnvelope={activeEnvelope}
                        activeRun={activeRun}
                        contextPreview={contextPreview}
                        items={activityItems}
                        selectedProvider={selectedProvider}
                        summary={activitySummary}
                      />
                    ) : null}
                  </AnimatePresence>
                  <button
                    className="ai-chat-icon-button"
                    type="button"
                    title="AI Chat settings"
                    onClick={() =>
                      dispatchApplicationMenuAction("settings.toggle")
                    }
                  >
                    <Settings size={16} />
                  </button>
                </m.nav>
              ) : null}
            </AnimatePresence>
            <ContextActionMenu
              ignoredTargetSelector=".ai-chat-run-card, .ai-chat-composer, .ai-chat-popover, .ai-chat-focus-rail, .ai-chat-drawer, button, input, textarea, a"
              items={panelContextItems}
              nativeScope="ai-chat-panel"
              nativeTargetId={activeSessionId}
            >
              <div
                className="ai-chat-conversation"
                data-dimmed={reviewExpanded ? "true" : "false"}
              >
                <main className="ai-chat-body">
                  {runtimeError ? (
                    <div className="ai-chat-runtime-error">{runtimeError}</div>
                  ) : null}
                  <PendingApprovalCenter
                    approvals={pendingApprovals}
                    busyId={artifactBusyId}
                    onApprove={handleApprovePendingApproval}
                    onDeny={handleDenyPendingApproval}
                    onOpenReview={() => {
                      beginChatMotionWindow();
                      dispatchChrome({ type: "openDrawer", drawer: "review" });
                    }}
                    onSelectRun={(runId) => {
                      const envelope = runs.find(
                        (candidate) => candidate.id === runId,
                      );
                      setActiveRunId(runId);
                      if (envelope) {
                        dispatch({
                          type: "setActiveSession",
                          sessionId: sessionIdOf(envelope),
                          runId,
                        });
                      }
                      dispatch({ type: "setActiveRun", runId });
                    }}
                  />
                  <AgentConsole
                    activeEnvelope={activeEnvelope}
                    visible={agentConsoleVisible}
                  />
                  {transcriptRuns.length === 0 ? (
                    <EmptyState
                      providerReady={selectedProviderReady}
                      onRefresh={handleRefreshProviders}
                      sessionId={activeSessionId}
                    />
                  ) : (
                    <div className="ai-chat-transcript">
                      <AnimatePresence initial={false} mode="popLayout">
                        {transcriptRuns.map((envelope: AIChatRunEnvelope) => (
                          <RunCard
                            active={envelope.id === activeRunKey}
                            compact={state.displayPrefs.compactCards}
                            envelope={envelope}
                            artifactBusyId={artifactBusyId}
                            artifacts={artifactsByRunId[envelope.id] ?? []}
                            key={envelope.id}
                            run={hydratedRuns[envelope.id] ?? null}
                            hydrationStatus={hydrationStatusForRun(envelope.id)}
                            streamingText={
                              streamingTextByRunId[envelope.id] ?? ""
                            }
                            searchQuery={
                              sessionSearchTerms.length > 0 ? sessionSearch : ""
                            }
                            onApplyPatchArtifact={handleApplyPatchArtifact}
                            onApproveMnemonicArtifact={
                              handleApproveMnemonicArtifact
                            }
                            onOpenReview={() => {
                              beginChatMotionWindow();
                              dispatchChrome({
                                type: "openDrawer",
                                drawer: "review",
                              });
                            }}
                            onApproveToolProposal={handleApproveToolProposal}
                            onAcceptPlan={handleAcceptPlan}
                            onDenyToolProposal={handleDenyToolProposal}
                            onPreviewToolProposal={handlePreviewToolProposal}
                            onRequestPlanRevision={handleRequestPlanRevision}
                            onRollbackPatchArtifact={
                              handleRollbackPatchArtifact
                            }
                            onSelect={(runId) => {
                              setActiveRunId(runId);
                              dispatch({ type: "setActiveRun", runId });
                            }}
                            onSubmitQuestionAnswer={handleSubmitQuestionAnswer}
                          />
                        ))}
                      </AnimatePresence>
                      <div ref={transcriptEndRef} />
                    </div>
                  )}
                </main>

                <ChatComposer
                  canSend={canSend}
                  actions={composerActions}
                  contextPreview={contextPreview}
                  disabledReason={disabledReason}
                  input={state.input}
                  providerRuntimeBusy={providerRuntimeBusy}
                  providerRuntimeError={providerRuntimeError}
                  providerRuntimes={providerRuntimes}
                  providers={sortedProviders}
                  consentPolicy={consentPolicy}
                  running={activeRunRunning}
                  selectedAction={state.selectedAction}
                  selectedMentions={selectedMentionsForActiveSession}
                  selectedModel={selectedModel}
                  selectedReasoningEffort={selectedReasoningEffort}
                  agentAuthRun={selectedProviderAuthRun}
                  selectedModelCapability={selectedModelCapability}
                  selectedProvider={selectedProvider}
                  sendShortcut={aiChatSendShortcut}
                  onActionChange={(action, profileId) =>
                    dispatch({ type: "setAction", action, profileId })
                  }
                  onCancel={handleCancel}
                  onInputChange={(input) =>
                    dispatch({ type: "setInput", input })
                  }
                  onMentionQuery={handleMentionQuery}
                  onMentionRemove={(id) =>
                    dispatch({ type: "removeMention", id })
                  }
                  onMentionSelect={handleMentionSelect}
                  onProbeModelCapability={handleProbeModelCapability}
                  onRefreshContext={handleRefreshContext}
                  onRefreshProviders={handleRefreshProviders}
                  onSend={handleSend}
                  onSelectModel={handleModelSelect}
                  onSelectReasoningEffort={(reasoningEffort) =>
                    dispatch({
                      type: "setReasoningEffort",
                      reasoningEffort,
                    })
                  }
                  onSelectProvider={handleProviderSelect}
                  onStartAgentLogin={handleStartAgentLogin}
                  onCancelAgentLogin={handleCancelAgentLogin}
                  onStartProviderOAuth={handleStartProviderOAuth}
                  onCancelProviderAuth={handleCancelProviderAuth}
                  onAcceptExternalAgentConsent={
                    handleAcceptExternalAgentConsent
                  }
                  onAcceptRemoteBYOKProviderConsent={
                    handleAcceptRemoteBYOKProviderConsent
                  }
                  onAcceptFrontierProviderConsent={
                    handleAcceptFrontierProviderConsent
                  }
                  onStartProviderRuntime={handleStartProviderRuntime}
                  onStopProviderRuntime={handleStopProviderRuntime}
                />
              </div>
            </ContextActionMenu>

            <AnimatePresence>
              {historyOpen ? (
                <m.div
                  className={`ai-chat-drawer ai-chat-drawer--${historyEdge}`}
                  data-drawer-edge={historyEdge}
                  data-drawer-dragging={
                    drawerDrag?.drawer === "history" ? "true" : "false"
                  }
                  data-testid="ai-chat-history-drawer"
                  initial={{
                    x: reduceMotion
                      ? 0
                      : historyEdge === "left"
                        ? "-104%"
                        : "104%",
                    opacity: reduceMotion ? 0 : 0.72,
                  }}
                  animate={{
                    x:
                      drawerDrag?.drawer === "history" ? drawerDrag.offsetX : 0,
                    opacity: 1,
                  }}
                  exit={{
                    x: reduceMotion
                      ? 0
                      : historyEdge === "left"
                        ? "-104%"
                        : "104%",
                    opacity: 0,
                  }}
                  layout
                  style={{
                    width: historyWidth,
                    ...(fullscreen
                      ? historyEdge === "left"
                        ? {
                            left: Math.max(
                              historyInset,
                              fullscreenDrawerRailInset,
                            ),
                          }
                        : {
                            right: Math.max(
                              historyInset,
                              fullscreenDrawerRailInset,
                            ),
                          }
                      : {}),
                  }}
                  transition={
                    drawerDrag?.drawer === "history"
                      ? { duration: 0 }
                      : {
                          duration: reduceMotion ? 0.1 : 0.18,
                          ease: [0.22, 1, 0.36, 1],
                        }
                  }
                >
                  {fullscreen ? (
                    <>
                      <m.span
                        className="ai-chat-drawer-resize ai-chat-drawer-resize--left"
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0}
                        dragMomentum={false}
                        title="Resize history left edge"
                        onDrag={(_event, info) =>
                          handleResizeHistory("start", info.delta.x)
                        }
                      />
                      <m.span
                        className="ai-chat-drawer-resize ai-chat-drawer-resize--right"
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0}
                        dragMomentum={false}
                        title="Resize history right edge"
                        onDrag={(_event, info) =>
                          handleResizeHistory("end", info.delta.x)
                        }
                      />
                    </>
                  ) : null}
                  <ChatHistoryRail
                    activeSessionId={activeSessionId}
                    canMove={fullscreen}
                    hydratedRuns={hydratedRuns}
                    runs={runs}
                    searchQuery={historySearch}
                    onClose={() =>
                      dispatchChrome({ type: "closeDrawer", drawer: "history" })
                    }
                    onDragStart={(event) =>
                      handleDrawerDragStart("history", event)
                    }
                    onNewChat={handleNewChat}
                    onDeleteSession={handleDeleteSession}
                    onSearchChange={(historySearch) =>
                      dispatchChrome({
                        type: "patch",
                        value: { historySearch },
                      })
                    }
                    onSelectSession={handleSelectSession}
                  />
                </m.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {reviewOpen && !reviewExpanded ? (
                <m.div
                  className={`ai-chat-drawer ai-chat-drawer--${reviewEdge}`}
                  data-drawer-edge={reviewEdge}
                  data-drawer-dragging={
                    drawerDrag?.drawer === "review" ? "true" : "false"
                  }
                  data-testid="ai-chat-review-drawer"
                  initial={{
                    x: reduceMotion
                      ? 0
                      : reviewEdge === "left"
                        ? "-104%"
                        : "104%",
                    opacity: reduceMotion ? 0 : 0.72,
                  }}
                  animate={{
                    x: drawerDrag?.drawer === "review" ? drawerDrag.offsetX : 0,
                    opacity: 1,
                  }}
                  exit={{
                    x: reduceMotion
                      ? 0
                      : reviewEdge === "left"
                        ? "-104%"
                        : "104%",
                    opacity: 0,
                  }}
                  layout
                  style={{
                    width: reviewWidth,
                    ...(fullscreen
                      ? reviewEdge === "left"
                        ? {
                            left: Math.max(
                              reviewInset,
                              fullscreenDrawerRailInset,
                            ),
                          }
                        : {
                            right: Math.max(
                              reviewInset,
                              fullscreenDrawerRailInset,
                            ),
                          }
                      : {}),
                  }}
                  transition={
                    drawerDrag?.drawer === "review"
                      ? { duration: 0 }
                      : {
                          duration: reduceMotion ? 0.1 : 0.18,
                          ease: [0.22, 1, 0.36, 1],
                        }
                  }
                >
                  {fullscreen ? (
                    <>
                      <m.span
                        className="ai-chat-drawer-resize ai-chat-drawer-resize--left"
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0}
                        dragMomentum={false}
                        title="Resize review left edge"
                        onDrag={(_event, info) =>
                          handleResizeReview("start", info.delta.x)
                        }
                      />
                      <m.span
                        className="ai-chat-drawer-resize ai-chat-drawer-resize--right"
                        drag="x"
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={0}
                        dragMomentum={false}
                        title="Resize review right edge"
                        onDrag={(_event, info) =>
                          handleResizeReview("end", info.delta.x)
                        }
                      />
                    </>
                  ) : null}
                  <ChatGitReview
                    canMove={fullscreen}
                    commitMessage={commitMessage}
                    diffSearch={diffSearch}
                    mode="drawer"
                    projectPath={projectPath}
                    searchQuery={reviewSearch}
                    onClose={() =>
                      dispatchChrome({ type: "closeDrawer", drawer: "review" })
                    }
                    onCollapse={() =>
                      dispatchChrome({
                        type: "patch",
                        value: { reviewExpanded: false },
                      })
                    }
                    onCommitMessageChange={(commitMessage) =>
                      dispatchChrome({
                        type: "patch",
                        value: { commitMessage },
                      })
                    }
                    onDiffSearchChange={(diffSearch) =>
                      dispatchChrome({ type: "patch", value: { diffSearch } })
                    }
                    onExpand={() => {
                      dispatchChrome({
                        type: "patch",
                        value: { reviewOpen: false, reviewExpanded: true },
                      });
                    }}
                    onDragStart={(event) =>
                      handleDrawerDragStart("review", event)
                    }
                    onSearchChange={(reviewSearch) =>
                      dispatchChrome({
                        type: "patch",
                        value: { reviewSearch },
                      })
                    }
                  />
                </m.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence>
              {reviewExpanded ? (
                <m.div
                  className="ai-chat-review-overlay"
                  data-testid="ai-chat-review-expanded"
                  initial={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }
                  }
                  animate={
                    reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }
                  }
                  exit={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.985 }
                  }
                  transition={{
                    duration: reduceMotion ? 0.1 : 0.18,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <ChatGitReview
                    canMove={false}
                    commitMessage={commitMessage}
                    diffSearch={diffSearch}
                    mode="overlay"
                    projectPath={projectPath}
                    searchQuery={reviewSearch}
                    onClose={() => {
                      dispatchChrome({
                        type: "patch",
                        value: { reviewExpanded: false, reviewOpen: false },
                      });
                    }}
                    onCollapse={() => {
                      dispatchChrome({
                        type: "patch",
                        value: { reviewExpanded: false, reviewOpen: true },
                      });
                    }}
                    onCommitMessageChange={(commitMessage) =>
                      dispatchChrome({
                        type: "patch",
                        value: { commitMessage },
                      })
                    }
                    onDiffSearchChange={(diffSearch) =>
                      dispatchChrome({ type: "patch", value: { diffSearch } })
                    }
                    onExpand={() =>
                      dispatchChrome({
                        type: "patch",
                        value: { reviewExpanded: true },
                      })
                    }
                    onDragStart={(event) =>
                      handleDrawerDragStart("review", event)
                    }
                    onSearchChange={(reviewSearch) =>
                      dispatchChrome({
                        type: "patch",
                        value: { reviewSearch },
                      })
                    }
                  />
                </m.div>
              ) : null}
            </AnimatePresence>
          </LayoutGroup>
        </div>
      </LazyMotion>
    </section>
  );
}
