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
import { History, MessageSquarePlus, Search, Settings } from "lucide-react";
import {
  AIAcceptPlan,
  AIApplyPatchArtifact,
  AIApproveMnemonicEntryProposal,
  AICancelChatRun,
  AICancelProviderAuth,
  AICompactChatSession,
  AIDeleteChatSession,
  AIExecuteToolCall,
  AIGetChatRun,
  AIGetChatRunEnvelope,
  AIGetConsentPolicy,
  AIGetContextContinuationPlan,
  AIGetContextPreview,
  AIGetStatus,
  AIListProviderRuntimes,
  AIListChatActions,
  AIListChatRunArtifacts,
  AIListChatRuns,
  AIListQueuedChatRuns,
  AIListContextCapsules,
  AIListMnemonicEntries,
  AIListModelCapabilities,
  AIListPendingApprovals,
  AIProbeModelCapability,
  AIProposeMnemonicEntry,
  AIRefreshLocalProviders,
  AIRevokeContextCapsule,
  AIRequestPlanRevision,
  AIRollbackPatchCheckpoint,
  AISaveConsentPolicy,
  AISearchMnemonic,
  AIStartLinkedReview,
  AIStartAgentAuthRun,
  AIStartChatRun,
  AIStartProviderRuntime,
  AIStartProviderOAuth,
  AIStopProviderRuntime,
  AISubmitQuestionAnswer,
  AISuggestChatMentions,
  AISteerChatRun,
  AIQueueChatRun,
  AIUpdateQueuedChatRun,
  AIRemoveQueuedChatRun,
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
  type AIContextCapsuleSummary,
  type AIContextCompactionRequest,
  type AIContextContinuationPlan,
  type AIEgressRecord,
  type AIRunTimelineEvent,
  type AIModelCapabilityDescriptor,
  type AIPendingApproval,
  type AIQueuedChatRun,
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
import {
  aiChatProjectScopeKey,
  useAIChatStore,
} from "../../stores/aiChatStore";
import { useAIInlinePatchStore } from "../../stores/aiInlinePatchStore";
import { getCurrentProjectSessionId } from "../../shell/projectSessionRoute";
import { useAppNotificationStore } from "../../stores/appNotificationStore";
import { usePerformanceStore } from "../../stores/performanceStore";
import { useTerminalStore } from "../../stores/terminalStore";
import {
  AI_CHAT_FULLSCREEN_COMMAND_EVENT,
  type AIChatFullscreenCommandDetail,
} from "../../utils/aiChatFullscreenCommands";
import { dispatchApplicationMenuAction } from "../../utils/applicationMenu";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";
import { normalizeProjectPathIdentity } from "../../utils/projectPaths";
import { AIChatHeader } from "./AIChatHeader";
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
  defaultAIConsentPolicy,
  defaultAIStatus,
  normalizeAIChatActions,
  normalizeAIChatArtifacts,
  normalizeAIChatRuns,
  normalizeAIConsentPolicy,
  normalizeAIContextSnapshot,
  normalizeAIMnemonicEntries,
  normalizeAIModelCapabilities,
  normalizeAIPendingApprovals,
  normalizeAIProviderRuntimes,
  normalizeAIStatus,
} from "./aiRuntimeGuards";
import { mergeModelOptions } from "./providerModelOptions";
import { isFreshProjectRecord } from "./projectScopeFreshness";
import { resetAIChatUIStateForProject } from "./projectScopeState";
import {
  runStreamFollowCursor,
  RunTokenFrameBuffer,
} from "./runTokenFrameBuffer";
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
const allProjectChatRunsLimit = 100;
const chatHydrationMaxAttempts = 3;
const chatHydrationRetryDelayMs = 750;
const chatTokenBatchIntervalMs = 40;

const newContinuationIdempotencyKey = (): string => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `continuation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const isTerminalChatRunStatus = (status?: string | null): boolean =>
  status === "completed" ||
  status === "error" ||
  status === "canceled" ||
  status === "blocked";

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

const defaultChatContext: ContextToggles = {
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

function activeEditorContextFromStore(
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

function activeTerminalContextFromStore(
  store: ReturnType<typeof useTerminalStore.getState>,
): ActiveTerminalContext | null {
  const activePane = store.panes.find((pane) => pane.id === store.activePaneId);
  const activeTerminalId = activePane?.activeTabId ?? "";
  const shellState = activeTerminalId
    ? store.sessionShellState.get(activeTerminalId)
    : null;
  if (!shellState) {
    return null;
  }
  return {
    raw: shellState.raw,
    cwd: shellState.cwd,
  };
}

type LiveRunCardProps = Omit<
  React.ComponentProps<typeof RunCard>,
  "streamingText"
>;
const emptyRunArtifacts: AIChatRunArtifact[] = [];

const LiveRunCard = React.memo(function LiveRunCard(props: LiveRunCardProps) {
  const streamingText = useAIChatStore(
    (store) => store.streamingTextByRunId[props.envelope.id] ?? "",
  );
  return <RunCard {...props} streamingText={streamingText} />;
});

export function TranscriptFollowAnchor({
  enabled,
  runId,
  runCount,
  sessionKey,
  updatedAt,
}: {
  enabled: boolean;
  runId: string;
  runCount: number;
  sessionKey: string;
  updatedAt: string;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const enabledRef = useRef(enabled);
  const followFrameRef = useRef<number | null>(null);
  const followOutputRef = useRef(true);
  const previousSessionKeyRef = useRef(sessionKey);
  enabledRef.current = enabled;
  const streamingCursor = useAIChatStore((store) =>
    runStreamFollowCursor(
      runId ? (store.streamingTextByRunId[runId] ?? "") : "",
    ),
  );

  const scheduleFollowOutput = useCallback(() => {
    if (
      !enabledRef.current ||
      !followOutputRef.current ||
      followFrameRef.current !== null
    ) {
      return;
    }
    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (!enabledRef.current || !followOutputRef.current) return;
      const transcript = anchorRef.current?.closest<HTMLElement>(
        ".ai-chat-transcript",
      );
      if (!transcript) return;
      const nextScrollTop = Math.max(
        0,
        transcript.scrollHeight - transcript.clientHeight,
      );
      if (Math.abs(transcript.scrollTop - nextScrollTop) > 1) {
        transcript.scrollTop = nextScrollTop;
      }
    });
  }, []);

  useEffect(() => {
    const transcript = anchorRef.current?.closest<HTMLElement>(
      ".ai-chat-transcript",
    );
    if (!transcript) return undefined;
    const updateFollowState = () => {
      const panel = transcript.closest<HTMLElement>("[data-panel-id]");
      const panelState = panel?.dataset.panelState ?? "";
      const panelMotion = panel?.dataset.panelMotion ?? "";
      const panelGeometryMotionActive =
        panelState === "dragging" ||
        panelState === "resizing" ||
        panelMotion === "enter" ||
        panelMotion === "relocating" ||
        panel?.dataset.panelFullscreenMotion === "true";
      if (panelGeometryMotionActive) {
        scheduleFollowOutput();
        return;
      }

      const distanceFromBottom =
        transcript.scrollHeight -
        transcript.scrollTop -
        transcript.clientHeight;
      followOutputRef.current = distanceFromBottom <= 56;
    };
    transcript.addEventListener("scroll", updateFollowState, { passive: true });
    return () => transcript.removeEventListener("scroll", updateFollowState);
  }, [scheduleFollowOutput, sessionKey]);

  useEffect(() => {
    if (!enabled || !runId || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const transcript = anchorRef.current?.closest<HTMLElement>(
      ".ai-chat-transcript",
    );
    if (!transcript) return undefined;
    const target = [
      ...transcript.querySelectorAll<HTMLElement>("[data-ai-chat-run-id]"),
    ].find((candidate) => candidate.dataset.aiChatRunId === runId);
    if (!target) return undefined;

    const observer = new ResizeObserver(() => scheduleFollowOutput());
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, runId, scheduleFollowOutput, sessionKey]);

  useEffect(
    () => () => {
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (previousSessionKeyRef.current !== sessionKey) {
      previousSessionKeyRef.current = sessionKey;
      followOutputRef.current = true;
    }
    scheduleFollowOutput();
  }, [
    enabled,
    runCount,
    scheduleFollowOutput,
    sessionKey,
    streamingCursor,
    updatedAt,
  ]);

  return <div ref={anchorRef} aria-hidden="true" />;
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
  },
  providerPopoverOpen: false,
  settingsPopoverOpen: false,
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
  historyEdge: DrawerSnapEdge;
  reviewEdge: DrawerSnapEdge;
  historyWidth: number;
  reviewWidth: number;
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

const initialChromeState: AIChatPanelChromeState = {
  historyOpen: false,
  reviewOpen: false,
  reviewExpanded: false,
  historyEdge: "left",
  reviewEdge: "right",
  historyWidth: 270,
  reviewWidth: 520,
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
    case "resetProjectComposer":
      return resetAIChatUIStateForProject(state);
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
        };
        if (state.reviewOpen && state.reviewEdge === action.edge) {
          nextState.reviewEdge = oppositeEdge(action.edge);
        }
        return nextState;
      }
      const nextState = {
        ...state,
        reviewEdge: action.edge,
      };
      if (state.historyOpen && state.historyEdge === action.edge) {
        nextState.historyEdge = oppositeEdge(action.edge);
      }
      return nextState;
    }
    case "resizeHistory":
      if (action.edge === "start") {
        const nextWidth = clamp(state.historyWidth - action.delta, 220, 440);
        return {
          ...state,
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

const defaultProjectSessionId = "main";

type ProjectScopedRecord = {
  projectSessionId?: string | null;
  runId?: string | null;
  id?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function projectSessionIdOf(
  record: ProjectScopedRecord | null | undefined,
): string {
  return record?.projectSessionId?.trim() || defaultProjectSessionId;
}

function projectSessionMatches(
  record: ProjectScopedRecord | null | undefined,
  currentProjectSessionId: string,
): boolean {
  return (
    projectSessionIdOf(record) ===
    (currentProjectSessionId.trim() || defaultProjectSessionId)
  );
}

function projectScopedRunId(
  record: ProjectScopedRecord | null | undefined,
): string {
  return record?.runId?.trim() || record?.id?.trim() || "";
}

function isFreshForProjectScope(
  record: ProjectScopedRecord,
  scopeActivatedAt: number,
): boolean {
  return isFreshProjectRecord(record, scopeActivatedAt);
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

function buildContextRequest(
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
    inputs: run.inputs,
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
  outerMotionActive = false,
  presentation = "panel",
  projectPath = "",
}: AIChatPanelProps) {
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
    projectScopeKey,
    status,
    providers,
    actions,
    runs,
    hydratedRuns,
    mnemonicEntries,
    commandIntents,
    consentPolicy,
    activeRunId,
    contextPreview,
    setProjectScopeKey,
    setStatus,
    setProviders,
    setActions,
    upsertToolAudit,
    upsertProvider,
    setRuns,
    upsertRunEnvelope,
    appendRunTimelineEvent,
    deleteSessionRuns,
    clearProjectChatState,
    setHydratedRun,
    upsertHydratedRuns,
    appendRunToken,
    resetRunStream,
    setActiveRunId,
    setContextPreview,
    upsertEgressRecord,
    setMnemonicEntries,
    setPendingApprovals: setStorePendingApprovals,
    consumeCommandIntent,
    setConsentPolicy,
  } = useAIChatStore(
    useShallow((store) => ({
      projectScopeKey: store.projectScopeKey,
      status: store.status,
      providers: store.providers,
      actions: store.actions,
      runs: store.runs,
      hydratedRuns: store.hydratedRuns,
      mnemonicEntries: store.mnemonicEntries,
      commandIntents: store.commandIntents,
      consentPolicy: store.consentPolicy,
      activeRunId: store.activeRunId,
      contextPreview: store.contextPreview,
      setProjectScopeKey: store.setProjectScopeKey,
      setStatus: store.setStatus,
      setProviders: store.setProviders,
      setActions: store.setActions,
      upsertToolAudit: store.upsertToolAudit,
      upsertProvider: store.upsertProvider,
      setRuns: store.setRuns,
      upsertRunEnvelope: store.upsertRunEnvelope,
      appendRunTimelineEvent: store.appendRunTimelineEvent,
      deleteSessionRuns: store.deleteSessionRuns,
      clearProjectChatState: store.clearProjectChatState,
      setHydratedRun: store.setHydratedRun,
      upsertHydratedRuns: store.upsertHydratedRuns,
      appendRunToken: store.appendRunToken,
      resetRunStream: store.resetRunStream,
      setActiveRunId: store.setActiveRunId,
      setContextPreview: store.setContextPreview,
      upsertEgressRecord: store.upsertEgressRecord,
      setMnemonicEntries: store.setMnemonicEntries,
      setPendingApprovals: store.setPendingApprovals,
      consumeCommandIntent: store.consumeCommandIntent,
      setConsentPolicy: store.setConsentPolicy,
    })),
  );

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
  const currentProjectSessionId = getCurrentProjectSessionId();
  const currentProjectPathKey = useMemo(
    () => normalizeProjectPathIdentity(projectPath || ""),
    [projectPath],
  );
  const currentChatProjectScopeKey = useMemo(
    () => aiChatProjectScopeKey(currentProjectSessionId, currentProjectPathKey),
    [currentProjectPathKey, currentProjectSessionId],
  );
  const upsertInlinePatchArtifact = useAIInlinePatchStore(
    (store) => store.upsertArtifact,
  );
  const [artifactBusyId, setArtifactBusyId] = useState<string | null>(null);
  const [providerRuntimeBusy, setProviderRuntimeBusy] = useState(false);
  const [providerRuntimeError, setProviderRuntimeError] = useState("");
  const [mnemonicBusy, setMnemonicBusy] = useState(false);
  const [mnemonicError, setMnemonicError] = useState("");
  const [continuityInspectorOpen, setContinuityInspectorOpen] = useState(false);
  const [continuityBusy, setContinuityBusy] = useState(false);
  const [continuityError, setContinuityError] = useState("");
  const [continuityPlan, setContinuityPlan] =
    useState<AIContextContinuationPlan | null>(null);
  const [continuityCapsules, setContinuityCapsules] = useState<
    AIContextCapsuleSummary[]
  >([]);
  const [queuedRuns, setQueuedRuns] = useState<AIQueuedChatRun[]>([]);
  const [drawerDrag, setDrawerDrag] = useState<{
    drawer: DrawerId;
    offsetX: number;
    targetEdge: DrawerSnapEdge | null;
  } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const initialSelectionHydratedRef = useRef(false);
  const runNoticeSignaturesRef = useRef<Record<string, string>>({});
  const autoReviewBuildRunIdsRef = useRef<Record<string, true>>({});
  const requestedHydrationRunIdsRef = useRef<Set<string>>(new Set());
  const retryingHydrationRunIdsRef = useRef<Set<string>>(new Set());
  const failedHydrationRunIdsRef = useRef<Set<string>>(new Set());
  const hydrationFailureAttemptsRef = useRef<Record<string, number>>({});
  const hydrationRetryTimersRef = useRef<Record<string, number>>({});
  const hydrationMountedRef = useRef(true);
  const chatProjectScopeKeyRef = useRef(currentChatProjectScopeKey);
  const chatProjectScopeActivatedAtRef = useRef(Date.now());
  const currentProjectRunIdsRef = useRef<Set<string>>(new Set());
  const appendRunTokenRef = useRef(appendRunToken);
  appendRunTokenRef.current = appendRunToken;
  const runTokenFrameBufferRef = useRef<RunTokenFrameBuffer | null>(null);
  if (runTokenFrameBufferRef.current === null) {
    runTokenFrameBufferRef.current = new RunTokenFrameBuffer(
      (runId, token) => appendRunTokenRef.current(runId, token),
      {
        request: (callback) =>
          window.setTimeout(
            () => callback(window.performance.now()),
            chatTokenBatchIntervalMs,
          ),
        cancel: (timerId) => window.clearTimeout(timerId),
      },
    );
  }
  const registerCurrentProjectRunIds = useCallback(
    (runIds: Iterable<string>) => {
      const next = new Set(currentProjectRunIdsRef.current);
      let changed = false;
      for (const runId of runIds) {
        const normalizedRunId = runId.trim();
        if (!normalizedRunId || next.has(normalizedRunId)) continue;
        next.add(normalizedRunId);
        changed = true;
      }
      if (changed) currentProjectRunIdsRef.current = next;
    },
    [],
  );
  const commitHydratedRun = useCallback(
    (run: AIChatRun) => {
      if (!run?.id) return;
      registerCurrentProjectRunIds([run.id]);
      if (isTerminalChatRunStatus(run.status)) {
        runTokenFrameBufferRef.current?.flush(run.id);
      }
      setHydratedRun(run);
    },
    [registerCurrentProjectRunIds, setHydratedRun],
  );
  const commitHydratedRuns = useCallback(
    (nextRuns: AIChatRun[]) => {
      registerCurrentProjectRunIds(nextRuns.map((run) => run.id));
      nextRuns.forEach((run) => {
        if (isTerminalChatRunStatus(run.status)) {
          runTokenFrameBufferRef.current?.flush(run.id);
        }
      });
      upsertHydratedRuns(nextRuns);
    },
    [registerCurrentProjectRunIds, upsertHydratedRuns],
  );
  const commitRunEnvelope = useCallback(
    (envelope: AIChatRunEnvelope) => {
      if (!envelope?.id) return;
      registerCurrentProjectRunIds([envelope.id]);
      if (isTerminalChatRunStatus(envelope.status)) {
        runTokenFrameBufferRef.current?.flush(envelope.id);
      }
      upsertRunEnvelope(envelope);
    },
    [registerCurrentProjectRunIds, upsertRunEnvelope],
  );
  const commitRunList = useCallback(
    (nextRuns: AIChatRunEnvelope[]) => {
      registerCurrentProjectRunIds(nextRuns.map((run) => run.id));
      nextRuns.forEach((run) => {
        if (isTerminalChatRunStatus(run.status)) {
          runTokenFrameBufferRef.current?.flush(run.id);
        }
      });
      setRuns(nextRuns);
    },
    [registerCurrentProjectRunIds, setRuns],
  );
  const continuityRequestSeqRef = useRef(0);
  const contextPreviewRequestSeqRef = useRef(0);
  const lastFullscreenCommandRef = useRef<{
    command: AIChatFullscreenCommandDetail["command"];
    at: number;
  } | null>(null);
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
    historyEdge,
    reviewEdge,
    historyWidth,
    reviewWidth,
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

  const publishRunNotice = useCallback(
    (envelope: AIChatRunEnvelope) => {
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
      const visibleActiveRunId = state.activeRunId || activeRunId || "";
      if (!document.hidden && envelope.id === visibleActiveRunId) {
        return;
      }
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
    },
    [activeRunId, state.activeRunId],
  );

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
  const chatProjectScopeReady =
    projectScopeKey === currentChatProjectScopeKey &&
    chatProjectScopeKeyRef.current === currentChatProjectScopeKey;
  const scopedRuns = useMemo(
    () =>
      chatProjectScopeReady
        ? runs.filter((run) =>
            projectSessionMatches(run, currentProjectSessionId),
          )
        : [],
    [chatProjectScopeReady, currentProjectSessionId, runs],
  );
  const scopedRunIds = useMemo(
    () => new Set(scopedRuns.map((run) => run.id).filter(Boolean)),
    [scopedRuns],
  );
  currentProjectRunIdsRef.current = scopedRunIds;
  const scopedHydratedRuns = useMemo(() => {
    const next: Record<string, AIChatRun> = {};
    for (const [runId, run] of Object.entries(hydratedRuns)) {
      if (
        run?.id &&
        projectSessionMatches(run, currentProjectSessionId) &&
        (scopedRunIds.has(runId) || scopedRunIds.has(run.id))
      ) {
        next[runId] = run;
      }
    }
    return next;
  }, [currentProjectSessionId, hydratedRuns, scopedRunIds]);
  const scopedPendingApprovals = useMemo(
    () =>
      pendingApprovals.filter((approval) => {
        if (!chatProjectScopeReady) return false;
        if (!projectSessionMatches(approval, currentProjectSessionId)) {
          return false;
        }
        const runId = projectScopedRunId(approval);
        return !runId || scopedRunIds.has(runId);
      }),
    [
      chatProjectScopeReady,
      currentProjectSessionId,
      pendingApprovals,
      scopedRunIds,
    ],
  );
  const recordMatchesCurrentProjectScope = useCallback(
    (
      record: ProjectScopedRecord | null | undefined,
      options: { allowFresh?: boolean; allowRunless?: boolean } = {},
    ): boolean => {
      if (!chatProjectScopeReady) return false;
      if (!record || !projectSessionMatches(record, currentProjectSessionId)) {
        return false;
      }
      const runId = projectScopedRunId(record);
      if (runId && currentProjectRunIdsRef.current.has(runId)) {
        return true;
      }
      if (
        options.allowFresh &&
        isFreshForProjectScope(record, chatProjectScopeActivatedAtRef.current)
      ) {
        return true;
      }
      if (!runId && options.allowRunless) {
        return (
          currentProjectSessionId.trim() !== defaultProjectSessionId ||
          isFreshForProjectScope(record, chatProjectScopeActivatedAtRef.current)
        );
      }
      return false;
    },
    [chatProjectScopeReady, currentProjectSessionId],
  );
  const selectedMentionsForActiveSession = useMemo(
    () => mentionsForSession(state, activeSessionId),
    [activeSessionId, state.selectedMentionsBySession],
  );
  const activeSessionEnvelopes = useMemo(
    () => scopedRuns.filter((run) => sessionIdOf(run) === activeSessionId),
    [activeSessionId, scopedRuns],
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
  const activeRun = activeRunKey
    ? (scopedHydratedRuns[activeRunKey] ?? null)
    : null;
  const activeEnvelope =
    scopedRuns.find((run) => run.id === activeRunKey) ?? null;
  const selectedProviderAuthRun = useMemo(() => {
    const providerId = selectedProvider?.id || "";
    if (!providerId) return null;
    return (
      Object.values(scopedHydratedRuns)
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
  }, [scopedHydratedRuns, selectedProvider?.id]);
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
  const agentConsoleVisible =
    isInteractiveFallbackRuntime(activeEnvelope?.runtimeFamily) ||
    isInteractiveFallbackRuntime(
      activeEnvelope?.providerEnvelope?.runtimeFamily,
    ) ||
    isInteractiveFallbackRuntime(activeEnvelope?.agentRuntime?.runtimeFamily) ||
    activeEnvelope?.agentRuntime?.transport === "pty_fallback";
  const disabledReason = activeRunRunning
    ? ""
    : selectedActionDescriptor?.executionUnavailable
      ? selectedActionDescriptor.description || "Action unavailable"
      : !inputReady
        ? providerDisabledReason
        : providerDisabledReason;
  const canSend =
    chatProjectScopeReady &&
    inputReady &&
    selectedProviderReady &&
    !activeRunRunning &&
    !selectedActionDescriptor?.executionUnavailable;

  const refreshQueuedRuns = useCallback(async () => {
    if (!chatProjectScopeReady) {
      setQueuedRuns([]);
      return;
    }
    const requestScopeKey = currentChatProjectScopeKey;
    try {
      const items = await AIListQueuedChatRuns(activeSessionId);
      if (chatProjectScopeKeyRef.current !== requestScopeKey) return;
      setQueuedRuns(
        [...items].sort((left, right) => left.position - right.position),
      );
    } catch (error) {
      if (chatProjectScopeKeyRef.current !== requestScopeKey) return;
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [activeSessionId, chatProjectScopeReady, currentChatProjectScopeKey]);

  useEffect(() => {
    void refreshQueuedRuns();
  }, [refreshQueuedRuns]);
  const transcriptRuns = useMemo(
    () => [...activeSessionEnvelopes].reverse(),
    [activeSessionEnvelopes],
  );
  const newestSessionRunIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const run of scopedRuns) {
      const sessionId = sessionIdOf(run);
      if (!run.id || seen.has(sessionId)) continue;
      seen.add(sessionId);
      ids.push(run.id);
    }
    return ids;
  }, [scopedRuns]);
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
      if (scopedHydratedRuns[runId]) return "hydrated";
      if (failedHydrationRunIds.has(runId)) return "failed";
      if (hydratingRunIds.has(runId)) return "loading";
      return "idle";
    },
    [failedHydrationRunIds, scopedHydratedRuns, hydratingRunIds],
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
              scopedHydratedRuns[envelope.id] ?? null,
              sessionSearchTerms,
            ),
          ),
    [scopedHydratedRuns, sessionSearchTerms, transcriptRuns],
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
    setContinuityPlan(null);
    setContinuityCapsules([]);
    setContinuityError("");
    continuityRequestSeqRef.current += 1;
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
    const requestScopeKey = currentChatProjectScopeKey;
    setLoading(true);
    setRuntimeHydrated(false);
    setRuntimeError(null);
    try {
      const [statusResult, runsResult, actionsResult, consentResult] =
        await Promise.allSettled([
          AIGetStatus(),
          AIListChatRuns(allProjectChatRunsLimit),
          AIListChatActions(),
          AIGetConsentPolicy(),
        ]);
      if (chatProjectScopeKeyRef.current !== requestScopeKey) {
        return;
      }

      const currentStore = useAIChatStore.getState();
      const safeStatus =
        statusResult.status === "fulfilled"
          ? normalizeAIStatus(statusResult.value)
          : (currentStore.status ?? defaultAIStatus());
      const nextProviders =
        statusResult.status === "fulfilled"
          ? safeStatus.providers
          : currentStore.providers;
      const safeEnvelopes =
        runsResult.status === "fulfilled"
          ? normalizeAIChatRuns(runsResult.value).filter((envelope) =>
              projectSessionMatches(envelope, currentProjectSessionId),
            )
          : [];
      const refreshedRunIds = new Set(
        safeEnvelopes.map((envelope) => envelope.id).filter(Boolean),
      );
      const safeConsentPolicy =
        consentResult.status === "fulfilled"
          ? (normalizeAIConsentPolicy(consentResult.value) ??
            defaultAIConsentPolicy())
          : (currentStore.consentPolicy ?? defaultAIConsentPolicy());

      setStatus(safeStatus);
      setProviders(nextProviders);
      if (actionsResult.status === "fulfilled") {
        setActions(normalizeAIChatActions(actionsResult.value));
      }
      setConsentPolicy(safeConsentPolicy);
      if (runsResult.status === "fulfilled") {
        clearHydrationFailuresForRunIds(
          safeEnvelopes.map((envelope) => envelope.id),
        );
        commitRunList(safeEnvelopes);
      }

      const criticalFailure = [statusResult, runsResult].find(
        (result) => result.status === "rejected",
      );
      if (criticalFailure?.status === "rejected") {
        setRuntimeError(
          criticalFailure.reason instanceof Error
            ? criticalFailure.reason.message
            : String(criticalFailure.reason),
        );
      }

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

      window.setTimeout(() => {
        void Promise.allSettled([
          AIListModelCapabilities(),
          AIListProviderRuntimes(),
          AIListPendingApprovals(50),
        ]).then(
          ([
            modelCapabilitiesResult,
            providerRuntimesResult,
            pendingApprovalsResult,
          ]) => {
            if (
              !hydrationMountedRef.current ||
              chatProjectScopeKeyRef.current !== requestScopeKey
            ) {
              return;
            }
            if (modelCapabilitiesResult.status === "fulfilled") {
              setModelCapabilities(
                normalizeAIModelCapabilities(modelCapabilitiesResult.value),
              );
            }
            if (providerRuntimesResult.status === "fulfilled") {
              setProviderRuntimes(
                normalizeAIProviderRuntimes(providerRuntimesResult.value),
              );
            }
            if (
              pendingApprovalsResult.status === "fulfilled" &&
              runsResult.status === "fulfilled"
            ) {
              const normalizedPendingApprovals = normalizeAIPendingApprovals(
                pendingApprovalsResult.value,
              ).filter((approval) => {
                if (!projectSessionMatches(approval, currentProjectSessionId)) {
                  return false;
                }
                const runId = projectScopedRunId(approval);
                return !runId || refreshedRunIds.has(runId);
              });
              setPendingApprovals(normalizedPendingApprovals);
              setStorePendingApprovals(normalizedPendingApprovals);
            }
          },
        );
      }, 0);
    } catch (error) {
      if (
        hydrationMountedRef.current &&
        chatProjectScopeKeyRef.current === requestScopeKey
      ) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (
        hydrationMountedRef.current &&
        chatProjectScopeKeyRef.current === requestScopeKey
      ) {
        setRuntimeHydrated(true);
        setLoading(false);
      }
    }
  }, [
    clearHydrationFailuresForRunIds,
    commitRunList,
    currentChatProjectScopeKey,
    currentProjectSessionId,
    setActions,
    setConsentPolicy,
    setProviders,
    setStorePendingApprovals,
    setStatus,
    setActiveRunId,
  ]);

  const refreshRuntimeEvent = useEffectEvent(refreshRuntime);
  const clearHydrationFailuresForTargetsEvent = useEffectEvent(() => {
    clearHydrationFailuresForRunIds(hydrationTargetRunIds);
  });

  useLayoutEffect(() => {
    if (projectScopeKey !== currentChatProjectScopeKey) {
      setProjectScopeKey(currentChatProjectScopeKey);
    }
  }, [currentChatProjectScopeKey, projectScopeKey, setProjectScopeKey]);

  useLayoutEffect(() => {
    const scopeChanged =
      chatProjectScopeKeyRef.current !== currentChatProjectScopeKey;
    if (scopeChanged) {
      runTokenFrameBufferRef.current?.discard();
      currentProjectRunIdsRef.current = new Set();
      chatProjectScopeKeyRef.current = currentChatProjectScopeKey;
      chatProjectScopeActivatedAtRef.current = Date.now();
      initialSelectionHydratedRef.current = false;
      requestedHydrationRunIdsRef.current.clear();
      retryingHydrationRunIdsRef.current.clear();
      failedHydrationRunIdsRef.current.clear();
      hydrationFailureAttemptsRef.current = {};
      Object.values(hydrationRetryTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      hydrationRetryTimersRef.current = {};
      setHydratingRunIds(new Set());
      setRetryingHydrationRunIds(new Set());
      setFailedHydrationRunIds(new Set());
      clearProjectChatState();
      setPendingApprovals([]);
      setArtifactsByRunId({});
      setRuntimeError(null);
      setRuntimeHydrated(false);
      setActiveRunId(null);
      setContinuityPlan(null);
      setContinuityCapsules([]);
      setContinuityError("");
      dispatch({ type: "resetProjectComposer" });
      dispatchChrome({
        type: "patch",
        value: {
          sessionSearch: "",
          sessionSearchOpen: false,
          historySearch: "",
        },
      });
    } else {
      chatProjectScopeKeyRef.current = currentChatProjectScopeKey;
    }
    void refreshRuntimeEvent();
  }, [clearProjectChatState, currentChatProjectScopeKey, setActiveRunId]);

  useEffect(() => {
    const hydrationScopeKey = currentChatProjectScopeKey;
    const pendingRunIds = hydrationTargetRunIds
      .filter((runId) => runId.trim())
      .filter((runId) => !scopedHydratedRuns[runId])
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
        if (
          !hydrationMountedRef.current ||
          chatProjectScopeKeyRef.current !== hydrationScopeKey
        ) {
          return;
        }
        const loadedRuns: AIChatRun[] = [];
        const loadedRunIds = new Set<string>();
        const failedRunIds: string[] = [];
        results.forEach((result, index) => {
          const runId = pendingRunIds[index];
          if (
            result.status === "fulfilled" &&
            result.value?.id &&
            projectSessionMatches(result.value, currentProjectSessionId)
          ) {
            loadedRuns.push(result.value);
            loadedRunIds.add(runId);
            loadedRunIds.add(result.value.id);
            return;
          }
          failedRunIds.push(runId);
        });
        if (loadedRuns.length > 0) {
          clearHydrationFailuresForRunIds([...loadedRunIds]);
          commitHydratedRuns(loadedRuns);
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
    commitHydratedRuns,
    currentChatProjectScopeKey,
    currentProjectSessionId,
    failedHydrationRunIds,
    hydrationTargetRunIds,
    markHydrationFailure,
    retryingHydrationRunIds,
    scopedHydratedRuns,
  ]);

  const refreshRunArtifacts = useCallback(
    async (runId: string) => {
      const key = runId.trim();
      if (!key) {
        return;
      }
      const requestScopeKey = currentChatProjectScopeKey;
      const artifacts = await AIListChatRunArtifacts(key);
      if (chatProjectScopeKeyRef.current !== requestScopeKey) {
        return;
      }
      const normalized = normalizeAIChatArtifacts(artifacts).filter(
        (artifact) =>
          artifact.runId === key &&
          projectSessionMatches(artifact, currentProjectSessionId),
      );
      setArtifactsByRunId((current) => ({
        ...current,
        [key]: mergeArtifactsById(current[key] ?? [], normalized),
      }));
    },
    [currentChatProjectScopeKey, currentProjectSessionId],
  );

  const refreshPendingApprovals = useCallback(async () => {
    try {
      const approvals = await AIListPendingApprovals(50);
      const normalizedApprovals = normalizeAIPendingApprovals(approvals).filter(
        (approval) =>
          projectSessionMatches(approval, currentProjectSessionId) &&
          (!approval.runId ||
            currentProjectRunIdsRef.current.has(approval.runId)),
      );
      setPendingApprovals(normalizedApprovals);
      setStorePendingApprovals(normalizedApprovals);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [currentProjectSessionId, setRuntimeError, setStorePendingApprovals]);

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
    allKnownArtifacts.forEach((artifact) => {
      upsertInlinePatchArtifact(artifact, {
        projectSessionId: currentProjectSessionId,
      });
    });
  }, [allKnownArtifacts, currentProjectSessionId, upsertInlinePatchArtifact]);

  useEffect(() => {
    if (!activeRunKey) return;
    void refreshRunArtifacts(activeRunKey);
  }, [activeRunKey, refreshRunArtifacts]);

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
        if (
          !result?.run?.id ||
          result.status.startsWith("skipped_") ||
          !projectSessionMatches(result.run, currentProjectSessionId)
        ) {
          return;
        }
        commitHydratedRun(result.run);
        commitRunEnvelope(envelopeFromRun(result.run));
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
    if (
      !run?.id ||
      !recordMatchesCurrentProjectScope(run, { allowFresh: true })
    ) {
      return;
    }
    clearHydrationFailuresForRunIds([run.id]);
    commitHydratedRun(run);
    commitRunEnvelope(envelopeFromRun(run));
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
        if (
          envelope?.id &&
          recordMatchesCurrentProjectScope(envelope, { allowFresh: true })
        ) {
          commitRunEnvelope(envelope);
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
      if (
        !envelope?.id ||
        !recordMatchesCurrentProjectScope(envelope, { allowFresh: true })
      ) {
        return;
      }
      clearHydrationFailuresForRunIds([envelope.id]);
      commitRunEnvelope(envelope);
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
      if (!currentProjectRunIdsRef.current.has(payload.runId.trim())) return;
      runTokenFrameBufferRef.current?.enqueue(payload.runId, payload.token);
    },
  );

  const handleRunStreamReset = useEffectEvent(
    (payload: ProjectScopedRecord & { revision?: number | null }) => {
      const runId = payload?.runId?.trim();
      if (
        !runId ||
        !projectSessionMatches(payload, currentProjectSessionId) ||
        !currentProjectRunIdsRef.current.has(runId)
      ) {
        return;
      }
      runTokenFrameBufferRef.current?.discard(runId);
      resetRunStream(
        runId,
        typeof payload.revision === "number" &&
          Number.isFinite(payload.revision)
          ? payload.revision
          : undefined,
      );
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
    if (
      !recordMatchesCurrentProjectScope(record, {
        allowFresh: true,
        allowRunless: true,
      })
    ) {
      return;
    }
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
    if (audit.runId && !currentProjectRunIdsRef.current.has(audit.runId))
      return;
    upsertToolAudit(audit);
    void refreshPendingApprovalsEvent();
    if (audit.runId) {
      void refreshRunArtifactsEvent(audit.runId);
    }
  });

  const handleToolLifecycleArtifact = useEffectEvent((artifact: unknown) => {
    const record = artifact as ProjectScopedRecord;
    const runId = record?.runId?.trim();
    if (
      runId &&
      !recordMatchesCurrentProjectScope(record, { allowFresh: true })
    ) {
      return;
    }
    void refreshPendingApprovalsEvent();
    if (runId) {
      void refreshRunArtifactsEvent(runId);
    }
  });

  const handleChatArtifactUpdated = useEffectEvent((artifact: unknown) => {
    const normalized = normalizeAIChatArtifacts([artifact]).at(0);
    if (
      !normalized?.id ||
      !normalized.runId ||
      !recordMatchesCurrentProjectScope(normalized, { allowFresh: true })
    ) {
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
    if (
      !event?.runId ||
      !recordMatchesCurrentProjectScope(event, { allowFresh: true })
    ) {
      return;
    }
    appendRunTimelineEvent(event);
  });

  const handleChatToolResult = useEffectEvent((payload: unknown) => {
    const record = payload as ProjectScopedRecord;
    const runId = record?.runId?.trim();
    if (
      runId &&
      !recordMatchesCurrentProjectScope(record, { allowFresh: true })
    ) {
      return;
    }
    void refreshPendingApprovalsEvent();
    if (runId) {
      void refreshRunArtifactsEvent(runId);
    }
  });

  const handleQueueUpdateEvent = useEffectEvent((payload: unknown) => {
    const item = payload as AIQueuedChatRun;
    if (!item || !projectSessionMatches(item, currentProjectSessionId)) {
      return;
    }
    if (chatSessionKey(item.sessionId) === activeSessionId) {
      void refreshQueuedRuns();
    }
  });

  const handlePatchArtifactAppliedEvent = useEffectEvent((payload: unknown) => {
    const record = payload as ProjectScopedRecord;
    const runId = record?.runId?.trim();
    if (
      runId &&
      !recordMatchesCurrentProjectScope(record, { allowFresh: true })
    ) {
      return;
    }
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
    const offStreamReset = EventsOn("ai:chat:stream-reset", (payload) =>
      handleRunStreamReset(
        payload as ProjectScopedRecord & { revision?: number | null },
      ),
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
    const offQueue = EventsOn("ai:chat:queue-updated", (payload) =>
      handleQueueUpdateEvent(payload),
    );
    return () => {
      runTokenFrameBufferRef.current?.discard();
      offStarted?.();
      offCompleted?.();
      offError?.();
      offCanceled?.();
      offToken?.();
      offStreamReset?.();
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
      offQueue?.();
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
      const requestScopeKey = currentChatProjectScopeKey;
      const requestSeq = ++contextPreviewRequestSeqRef.current;
      try {
        const preview = await AIGetContextPreview(
          buildContextRequest(
            state.context,
            activeEditorContextFromStore(useEditorStore.getState()),
            state.input,
            selectedMentionsForActiveSession,
            state.selectedProfileId,
            activeTerminalContextFromStore(useTerminalStore.getState()),
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
        if (
          chatProjectScopeKeyRef.current !== requestScopeKey ||
          contextPreviewRequestSeqRef.current !== requestSeq
        ) {
          return;
        }
        setContextPreview(normalizeAIContextSnapshot(preview));
      } catch (error) {
        if (
          !silent &&
          chatProjectScopeKeyRef.current === requestScopeKey &&
          contextPreviewRequestSeqRef.current === requestSeq
        ) {
          setRuntimeError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    },
    [
      activeSessionId,
      currentChatProjectScopeKey,
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

  const refreshContinuityInspector = useCallback(async () => {
    const sessionId = chatSessionKey(activeSessionId);
    const requestSeq = ++continuityRequestSeqRef.current;
    const requestScopeKey = currentChatProjectScopeKey;
    setContinuityBusy(true);
    setContinuityError("");
    try {
      const [plan, capsules] = await Promise.all([
        AIGetContextContinuationPlan(sessionId),
        AIListContextCapsules(sessionId, 24),
      ]);
      if (
        requestSeq !== continuityRequestSeqRef.current ||
        sessionId !== chatSessionKey(state.activeSessionId) ||
        chatProjectScopeKeyRef.current !== requestScopeKey
      ) {
        return;
      }
      setContinuityPlan(plan ?? null);
      setContinuityCapsules(Array.isArray(capsules) ? capsules : []);
    } catch (error) {
      if (
        requestSeq !== continuityRequestSeqRef.current ||
        chatProjectScopeKeyRef.current !== requestScopeKey
      ) {
        return;
      }
      setContinuityError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (
        requestSeq === continuityRequestSeqRef.current &&
        chatProjectScopeKeyRef.current === requestScopeKey
      ) {
        setContinuityBusy(false);
      }
    }
  }, [activeSessionId, currentChatProjectScopeKey, state.activeSessionId]);

  const handleToggleContinuityInspector = useCallback(() => {
    setContinuityInspectorOpen((open) => {
      const next = !open;
      if (next) {
        void refreshContinuityInspector();
      }
      return next;
    });
  }, [refreshContinuityInspector]);

  const handleCompactContinuity = useCallback(async () => {
    const sessionId = chatSessionKey(activeSessionId);
    if (continuityPlan?.canCompact !== true) {
      const reason =
        continuityPlan?.disabledReason ||
        continuityPlan?.degradedReason ||
        "Context continuity compaction is unavailable.";
      setContinuityError(reason);
      return;
    }
    setContinuityBusy(true);
    setContinuityError("");
    try {
      await AICompactChatSession({
        sessionId,
        reason: "manual:context-meter",
        maxTurns: 24,
        modelAssisted: false,
      } as AIContextCompactionRequest);
      await Promise.all([
        refreshContinuityInspector(),
        refreshContextPreview(false),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setContinuityError(message);
      setRuntimeError(message);
    } finally {
      setContinuityBusy(false);
    }
  }, [
    activeSessionId,
    continuityPlan?.canCompact,
    continuityPlan?.degradedReason,
    continuityPlan?.disabledReason,
    refreshContextPreview,
    refreshContinuityInspector,
  ]);

  const handleRevokeContinuityCapsule = useCallback(
    async (capsuleId: string) => {
      if (!capsuleId) return;
      if (continuityPlan?.canRevoke !== true) {
        setContinuityError(
          continuityPlan?.disabledReason ||
            continuityPlan?.degradedReason ||
            "Context continuity revocation is unavailable.",
        );
        return;
      }
      setContinuityBusy(true);
      setContinuityError("");
      try {
        await AIRevokeContextCapsule(capsuleId);
        await Promise.all([
          refreshContinuityInspector(),
          refreshContextPreview(false),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setContinuityError(message);
        setRuntimeError(message);
      } finally {
        setContinuityBusy(false);
      }
    },
    [
      continuityPlan?.canRevoke,
      continuityPlan?.degradedReason,
      continuityPlan?.disabledReason,
      refreshContextPreview,
      refreshContinuityInspector,
    ],
  );

  useEffect(() => {
    if (activeRunRunning) return;
    const timeout = window.setTimeout(() => {
      void refreshContextPreview(true);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [activeRunRunning, refreshContextPreview]);

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
      if (!chatProjectScopeReady) return false;
      if (!selectedProvider || !selectedProviderReady) {
        setRuntimeError(
          providerDisabledReason || "AI provider is unavailable.",
        );
        return false;
      }
      const targetSessionRunning = scopedRuns.some(
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
        activeTerminalContextFromStore(useTerminalStore.getState()),
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
      const requestScopeKey = currentChatProjectScopeKey;
      contextPreviewRequestSeqRef.current += 1;
      setContextPreview(null);
      try {
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
        if (
          chatProjectScopeKeyRef.current !== requestScopeKey ||
          !projectSessionMatches(run, currentProjectSessionId)
        ) {
          return false;
        }
        commitHydratedRun(run);
        commitRunEnvelope(envelopeFromRun(run));
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
      activeSessionId,
      chatProjectScopeReady,
      currentChatProjectScopeKey,
      currentProjectSessionId,
      providerDisabledReason,
      scopedRuns,
      selectedContextWindowHint,
      selectedModel,
      selectedReasoningEffort,
      selectedProvider,
      selectedProviderReady,
      selectedRuntimeFamily,
      setActiveRunId,
      setContextPreview,
      commitHydratedRun,
      commitRunEnvelope,
      state.context,
      state.input,
      state.selectedAction,
      selectedMentionsForActiveSession,
      state.selectedProfileId,
      state.selectedWorkflowId,
    ],
  );

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedProvider) return;
    await startChatRun();
  }, [canSend, selectedProvider, startChatRun]);

  const continueActiveRun = useCallback(
    async (disposition: "steer" | "redirect") => {
      const run =
        activeSessionEnvelopes.find(
          (candidate) =>
            candidate.status === "running" || candidate.status === "queued",
        ) ?? null;
      const message = state.input.trim();
      if (!run || !message) return;
      setRuntimeError(null);
      try {
        await AISteerChatRun({
          runId: run.id,
          message,
          expectedRevision: run.revision,
          idempotencyKey: newContinuationIdempotencyKey(),
          disposition,
          selectedAction: state.selectedAction,
        });
        dispatch({ type: "resetComposer" });
        const envelope = await AIGetChatRunEnvelope(run.id);
        if (projectSessionMatches(envelope, currentProjectSessionId)) {
          commitRunEnvelope(envelope);
        }
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      activeSessionEnvelopes,
      commitRunEnvelope,
      currentProjectSessionId,
      state.input,
      state.selectedAction,
    ],
  );

  const handleSteer = useCallback(() => {
    void continueActiveRun("steer");
  }, [continueActiveRun]);

  const handleRedirect = useCallback(() => {
    void continueActiveRun("redirect");
  }, [continueActiveRun]);

  const handleQueue = useCallback(async () => {
    const message = state.input.trim();
    if (!message) return;
    setRuntimeError(null);
    try {
      await AIQueueChatRun({
        sessionId: activeSessionId,
        message,
        selectedAction: state.selectedAction,
        idempotencyKey: newContinuationIdempotencyKey(),
      });
      dispatch({ type: "resetComposer" });
      await refreshQueuedRuns();
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [activeSessionId, refreshQueuedRuns, state.input, state.selectedAction]);

  const handleUpdateQueued = useCallback(
    async (queueID: string, message: string) => {
      if (!message.trim()) return;
      setRuntimeError(null);
      try {
        await AIUpdateQueuedChatRun(activeSessionId, {
          id: queueID,
          message,
        });
        await refreshQueuedRuns();
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSessionId, refreshQueuedRuns],
  );

  const handleMoveQueued = useCallback(
    async (queueID: string, position: number) => {
      setRuntimeError(null);
      try {
        await AIUpdateQueuedChatRun(activeSessionId, {
          id: queueID,
          position,
          reorder: true,
        });
        await refreshQueuedRuns();
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSessionId, refreshQueuedRuns],
  );

  const handleRemoveQueued = useCallback(
    async (queueID: string) => {
      setRuntimeError(null);
      try {
        await AIRemoveQueuedChatRun(activeSessionId, queueID);
        await refreshQueuedRuns();
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [activeSessionId, refreshQueuedRuns],
  );

  const handleStartAgentLogin = useCallback(
    async (provider: AIProviderDescriptor): Promise<AIChatRun | null> => {
      if (!provider?.id || activeRunRunning) return null;
      setRuntimeError(null);
      const requestScopeKey = currentChatProjectScopeKey;
      try {
        const run = await AIStartAgentAuthRun(provider.id);
        if (
          chatProjectScopeKeyRef.current !== requestScopeKey ||
          !projectSessionMatches(run, currentProjectSessionId)
        ) {
          return null;
        }
        commitHydratedRun(run);
        commitRunEnvelope(envelopeFromRun(run));
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
    [
      activeRunRunning,
      currentChatProjectScopeKey,
      currentProjectSessionId,
      setActiveRunId,
      commitHydratedRun,
      commitRunEnvelope,
    ],
  );

  const handleCancelAgentLogin = useCallback(
    async (runId: string) => {
      if (!runId) return;
      setRuntimeError(null);
      const requestScopeKey = currentChatProjectScopeKey;
      try {
        const run = await AICancelChatRun(runId);
        if (
          chatProjectScopeKeyRef.current !== requestScopeKey ||
          !projectSessionMatches(run, currentProjectSessionId)
        ) {
          return;
        }
        commitRunEnvelope(envelopeFromRun(run));
        commitHydratedRun(run);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      currentChatProjectScopeKey,
      currentProjectSessionId,
      commitHydratedRun,
      commitRunEnvelope,
    ],
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
      if (!run?.id || !projectSessionMatches(run, currentProjectSessionId)) {
        return;
      }
      commitHydratedRun(run);
      commitRunEnvelope(envelopeFromRun(run));
      setActiveRunId(run.id);
      dispatch({
        type: "setActiveSession",
        sessionId: run.sessionId || defaultChatSessionId,
        runId: run.id,
      });
      dispatch({ type: "setActiveRun", runId: run.id });
    },
    [
      currentProjectSessionId,
      setActiveRunId,
      commitHydratedRun,
      commitRunEnvelope,
    ],
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
        if (intent.projectScopeKey !== currentChatProjectScopeKey) {
          return;
        }
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
            await refreshPendingApprovals();
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
      currentChatProjectScopeKey,
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
    const requestScopeKey = currentChatProjectScopeKey;
    const entries = await AIListMnemonicEntries(24);
    if (chatProjectScopeKeyRef.current !== requestScopeKey) {
      return;
    }
    setMnemonicEntries(normalizeAIMnemonicEntries(entries));
  }, [currentChatProjectScopeKey, setMnemonicEntries]);

  const handleMnemonicSearch = useCallback(
    async (query: string) => {
      setMnemonicBusy(true);
      setMnemonicError("");
      try {
        const requestScopeKey = currentChatProjectScopeKey;
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
        if (chatProjectScopeKeyRef.current !== requestScopeKey) {
          return;
        }
        setMnemonicEntries(normalizeAIMnemonicEntries(entries));
      } catch (error) {
        setMnemonicError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMnemonicBusy(false);
      }
    },
    [currentChatProjectScopeKey, setMnemonicEntries],
  );

  useEffect(() => {
    if (!state.settingsPopoverOpen) return;
    void refreshMnemonicEntries();
  }, [refreshMnemonicEntries, state.settingsPopoverOpen]);

  const handleMnemonicSave = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      if (!activeRunKey) {
        setMnemonicError("Open a chat run before saving project memory.");
        return;
      }
      setMnemonicBusy(true);
      setMnemonicError("");
      try {
        const proposal = await AIProposeMnemonicEntry({
          runId: activeRunKey,
          entry: {
            content: trimmed,
            type: "note",
            source: "user",
            trust: "trusted",
            pinned: true,
            isLatest: true,
            confidence: 1,
            importance: 5,
          },
        });
        await AIApproveMnemonicEntryProposal({
          artifactId: proposal.artifact.id,
          reviewedBy: "user",
          trust: "trusted",
          pinned: true,
        });
        await Promise.all([refreshActiveArtifacts(), refreshMnemonicEntries()]);
      } catch (error) {
        setMnemonicError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMnemonicBusy(false);
      }
    },
    [activeRunKey, refreshActiveArtifacts, refreshMnemonicEntries],
  );

  const handleMnemonicPromote = useCallback(
    async (entryId: string) => {
      if (!entryId) return;
      if (!activeRunKey) {
        setMnemonicError("Open a chat run before trusting project memory.");
        return;
      }
      const entry = mnemonicEntries.find(
        (candidate) => candidate.id === entryId,
      );
      if (!entry) {
        setMnemonicError("Mnemonic entry was not found.");
        return;
      }
      setMnemonicBusy(true);
      setMnemonicError("");
      try {
        const proposal = await AIProposeMnemonicEntry({
          runId: activeRunKey,
          entry: {
            content: entry.content,
            type: entry.type || "note",
            source: "user",
            tags: entry.tags ?? [],
            trust: "trusted",
            pinned: true,
            isLatest: true,
            confidence: entry.confidence || 1,
            importance: Math.max(entry.importance || 5, 5),
          },
        });
        await AIApproveMnemonicEntryProposal({
          artifactId: proposal.artifact.id,
          reviewedBy: "user",
          trust: "trusted",
          pinned: true,
        });
        await Promise.all([refreshActiveArtifacts(), refreshMnemonicEntries()]);
      } catch (error) {
        setMnemonicError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMnemonicBusy(false);
      }
    },
    [
      activeRunKey,
      mnemonicEntries,
      refreshActiveArtifacts,
      refreshMnemonicEntries,
    ],
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
          refreshPendingApprovals(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovals, refreshRunArtifacts, upsertToolAudit],
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
          refreshPendingApprovals(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovals, refreshRunArtifacts, upsertToolAudit],
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
          refreshPendingApprovals(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovals, refreshRunArtifacts, upsertToolAudit],
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
          refreshPendingApprovals(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovals, refreshRunArtifacts, upsertToolAudit],
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
          refreshPendingApprovals(),
        ]);
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshPendingApprovals, refreshRunArtifacts, upsertToolAudit],
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
      const sessionRuns = scopedRuns.filter(
        (run) => sessionIdOf(run) === sessionId,
      );
      clearHydrationFailuresForRunIds(sessionRuns.map((run) => run.id));
      const nextRun = sessionRuns[0];
      setActiveRunId(nextRun?.id ?? null);
      dispatch({
        type: "setActiveSession",
        sessionId,
        runId: nextRun?.id ?? "",
      });
    },
    [clearHydrationFailuresForRunIds, scopedRuns, setActiveRunId],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim() || defaultChatSessionId;
      setRuntimeError(null);
      try {
        await AIDeleteChatSession(normalizedSessionId);
        const remainingRuns = scopedRuns.filter(
          (run) => sessionIdOf(run) !== normalizedSessionId,
        );
        deleteSessionRuns(normalizedSessionId, currentProjectSessionId);
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
    [
      activeSessionId,
      currentProjectSessionId,
      deleteSessionRuns,
      refreshRuntime,
      scopedRuns,
      setActiveRunId,
    ],
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
    dispatchChrome({
      type: "patch",
      value: { sessionSearchOpen: false },
    });
  }, []);

  const handlePanelToggleHistory = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    if (!historyOpen && !fullscreen) {
      dispatchChrome({
        type: "patch",
        value: {
          historyOpen: true,
          reviewOpen: false,
          reviewExpanded: false,
        },
      });
      return;
    }
    dispatchChrome({
      type: historyOpen ? "closeDrawer" : "openDrawer",
      drawer: "history",
    });
  }, [beginChatMotionWindow, closeTransientPopovers, fullscreen, historyOpen]);

  const focusSessionSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLInputElement>(
          '[data-testid="ai-chat-session-search"]',
        )
        ?.focus();
    });
  }, []);

  const handlePanelOpenSessionSearch = useCallback(() => {
    dispatch({ type: "toggleProviderPopover", open: false });
    dispatch({ type: "toggleSettingsPopover", open: false });
    dispatchChrome({
      type: "patch",
      value: { sessionSearchOpen: true },
    });
    focusSessionSearchInput();
  }, [focusSessionSearchInput]);

  const handlePanelToggleSessionSearch = useCallback(() => {
    const nextOpen = !sessionSearchOpen;
    dispatch({ type: "toggleProviderPopover", open: false });
    dispatch({ type: "toggleSettingsPopover", open: false });
    dispatchChrome({
      type: "patch",
      value: {
        sessionSearchOpen: nextOpen,
        sessionSearch: nextOpen ? sessionSearch : "",
      },
    });
    if (nextOpen) {
      focusSessionSearchInput();
    }
  }, [focusSessionSearchInput, sessionSearch, sessionSearchOpen]);

  const handlePanelToggleReview = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    if (reviewExpanded) {
      dispatchChrome({
        type: "patch",
        value: {
          reviewExpanded: false,
          reviewOpen: true,
          historyOpen: fullscreen ? historyOpen : false,
        },
      });
      return;
    }
    if (!reviewOpen && !fullscreen) {
      dispatchChrome({
        type: "patch",
        value: { reviewOpen: true, historyOpen: false },
      });
      return;
    }
    dispatchChrome({
      type: reviewOpen ? "closeDrawer" : "openDrawer",
      drawer: "review",
    });
  }, [
    beginChatMotionWindow,
    closeTransientPopovers,
    fullscreen,
    historyOpen,
    reviewExpanded,
    reviewOpen,
  ]);

  const handleCloseHistoryDrawer = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({ type: "closeDrawer", drawer: "history" });
  }, [beginChatMotionWindow, closeTransientPopovers]);

  const handleCloseReviewDrawer = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({ type: "closeDrawer", drawer: "review" });
  }, [beginChatMotionWindow, closeTransientPopovers]);

  const handlePanelToggleReviewExpanded = useCallback(() => {
    beginChatMotionWindow();
    closeTransientPopovers();
    dispatchChrome({
      type: "patch",
      value: reviewExpanded
        ? { reviewExpanded: false, reviewOpen: true }
        : { reviewExpanded: true, reviewOpen: false },
    });
  }, [beginChatMotionWindow, closeTransientPopovers, reviewExpanded]);

  const handlePanelOpenSettings = useCallback(() => {
    dispatchApplicationMenuAction("settings.toggle");
    dispatchChrome({
      type: "patch",
      value: { sessionSearchOpen: false },
    });
  }, []);

  const handleOpenRunReview = useCallback(() => {
    beginChatMotionWindow();
    if (!fullscreen) {
      dispatchChrome({
        type: "patch",
        value: { reviewOpen: true, reviewExpanded: false, historyOpen: false },
      });
      return;
    }
    dispatchChrome({ type: "openDrawer", drawer: "review" });
  }, [beginChatMotionWindow, fullscreen]);

  const handleSelectTranscriptRun = useCallback(
    (runId: string) => {
      setActiveRunId(runId);
      dispatch({ type: "setActiveRun", runId });
    },
    [setActiveRunId],
  );

  useEffect(() => {
    if (!fullscreen) return;

    const handleFullscreenCommand = (event: Event) => {
      const command = (event as CustomEvent<AIChatFullscreenCommandDetail>)
        .detail?.command;
      const now = performance.now();
      const lastCommand = lastFullscreenCommandRef.current;
      if (
        command &&
        lastCommand?.command === command &&
        now - lastCommand.at < 120
      ) {
        return;
      }
      if (command) {
        lastFullscreenCommandRef.current = { command, at: now };
      }
      switch (command) {
        case "history.toggle":
          handlePanelToggleHistory();
          return;
        case "sessionSearch.open":
          handlePanelOpenSessionSearch();
          return;
        case "review.toggle":
          handlePanelToggleReview();
          return;
        case "review.expandToggle":
          handlePanelToggleReviewExpanded();
          return;
      }
    };

    window.addEventListener(
      AI_CHAT_FULLSCREEN_COMMAND_EVENT,
      handleFullscreenCommand,
    );
    return () =>
      window.removeEventListener(
        AI_CHAT_FULLSCREEN_COMMAND_EVENT,
        handleFullscreenCommand,
      );
  }, [
    fullscreen,
    handlePanelOpenSessionSearch,
    handlePanelToggleHistory,
    handlePanelToggleReview,
    handlePanelToggleReviewExpanded,
  ]);

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
        key: "settings",
        label: "AI Chat Settings",
        icon: <Settings size={13} />,
        onSelect: handlePanelOpenSettings,
      },
    ],
    [
      handleNewChat,
      handlePanelOpenSettings,
      handlePanelToggleHistory,
      handlePanelToggleSessionSearch,
      historyOpen,
      sessionSearchOpen,
      transcriptRuns.length,
    ],
  );

  useEffect(() => {
    const popoverOpen =
      state.providerPopoverOpen ||
      state.settingsPopoverOpen ||
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
  const compactDrawerView = reviewOpen
    ? "review"
    : historyOpen
      ? "history"
      : "conversation";

  return (
    <section ref={panelRef} className={panelClass} data-testid="ai-chat-panel">
      <LazyMotion features={domAnimation}>
        <div
          className="ai-chat-workspace"
          data-presentation={fullscreen ? "expanded" : "panel"}
        >
          <AIChatHeader
            loading={loading}
            historyOpen={historyOpen}
            reviewExpanded={reviewExpanded}
            reviewOpen={reviewOpen}
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
            onToggleHistory={handlePanelToggleHistory}
            onToggleReview={handlePanelToggleReview}
            onToggleSessionSearch={() => {
              const nextOpen = !sessionSearchOpen;
              dispatch({ type: "toggleProviderPopover", open: false });
              dispatch({ type: "toggleSettingsPopover", open: false });
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
          />

          <div
            ref={workbenchRef}
            className="ai-chat-workbench"
            data-drawer-view={compactDrawerView}
            data-history-edge={historyEdge}
            data-history-open={historyOpen ? "true" : "false"}
            data-presentation={fullscreen ? "expanded" : "panel"}
            data-review-edge={reviewEdge}
            data-review-open={reviewOpen && !reviewExpanded ? "true" : "false"}
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
              <ContextActionMenu
                ignoredTargetSelector=".ai-chat-run-card, .ai-chat-composer, .ai-chat-popover, .ai-chat-drawer, button, input, textarea, a"
                items={panelContextItems}
                nativeScope="ai-chat-panel"
                nativeTargetId={activeSessionId}
              >
                <m.div
                  className="ai-chat-conversation"
                  data-outer-motion={outerMotionActive ? "true" : "false"}
                  data-dimmed={reviewExpanded ? "true" : "false"}
                  layout={
                    outerMotionActive
                      ? false
                      : historyOpen || (reviewOpen && !reviewExpanded)
                        ? true
                        : "position"
                  }
                  transition={{
                    layout: {
                      duration: reduceMotion ? 0.1 : 0.18,
                      ease: [0.22, 1, 0.36, 1],
                    },
                  }}
                >
                  <main className="ai-chat-body">
                    {runtimeError ? (
                      <div className="ai-chat-runtime-error">
                        {runtimeError}
                      </div>
                    ) : null}
                    <PendingApprovalCenter
                      approvals={scopedPendingApprovals}
                      busyId={artifactBusyId}
                      onApprove={handleApprovePendingApproval}
                      onDeny={handleDenyPendingApproval}
                      onOpenReview={() => {
                        beginChatMotionWindow();
                        dispatchChrome({
                          type: "openDrawer",
                          drawer: "review",
                        });
                      }}
                      onSelectRun={(runId) => {
                        const envelope = scopedRuns.find(
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
                            <LiveRunCard
                              active={envelope.id === activeRunKey}
                              compact={state.displayPrefs.compactCards}
                              envelope={envelope}
                              artifactBusyId={artifactBusyId}
                              artifacts={
                                artifactsByRunId[envelope.id] ??
                                emptyRunArtifacts
                              }
                              key={envelope.id}
                              run={scopedHydratedRuns[envelope.id] ?? null}
                              hydrationStatus={hydrationStatusForRun(
                                envelope.id,
                              )}
                              searchQuery={
                                sessionSearchTerms.length > 0
                                  ? sessionSearch
                                  : ""
                              }
                              onApplyPatchArtifact={handleApplyPatchArtifact}
                              onApproveMnemonicArtifact={
                                handleApproveMnemonicArtifact
                              }
                              onOpenReview={handleOpenRunReview}
                              onApproveToolProposal={handleApproveToolProposal}
                              onAcceptPlan={handleAcceptPlan}
                              onDenyToolProposal={handleDenyToolProposal}
                              onPreviewToolProposal={handlePreviewToolProposal}
                              onRequestPlanRevision={handleRequestPlanRevision}
                              onRollbackPatchArtifact={
                                handleRollbackPatchArtifact
                              }
                              onSelect={handleSelectTranscriptRun}
                              onSubmitQuestionAnswer={
                                handleSubmitQuestionAnswer
                              }
                            />
                          ))}
                        </AnimatePresence>
                        <TranscriptFollowAnchor
                          enabled={state.displayPrefs.autoScroll}
                          runId={activeRunKey}
                          runCount={transcriptRuns.length}
                          sessionKey={activeSessionId}
                          updatedAt={activeEnvelope?.updatedAt ?? ""}
                        />
                      </div>
                    )}
                  </main>

                  <ChatComposer
                    canSend={canSend}
                    actions={composerActions}
                    continuityBusy={continuityBusy}
                    continuityCapsules={continuityCapsules}
                    continuityError={continuityError}
                    continuityInspectorOpen={continuityInspectorOpen}
                    continuityPlan={continuityPlan}
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
                    onCompactContinuity={handleCompactContinuity}
                    onInputChange={(input) =>
                      dispatch({ type: "setInput", input })
                    }
                    onMentionQuery={handleMentionQuery}
                    onMentionRemove={(id) =>
                      dispatch({ type: "removeMention", id })
                    }
                    onMentionSelect={handleMentionSelect}
                    onProbeModelCapability={handleProbeModelCapability}
                    onRefreshContinuity={refreshContinuityInspector}
                    onRevokeContinuityCapsule={handleRevokeContinuityCapsule}
                    onRefreshProviders={handleRefreshProviders}
                    onSend={handleSend}
                    onSteer={handleSteer}
                    onQueue={handleQueue}
                    onRedirect={handleRedirect}
                    queuedRuns={queuedRuns}
                    onUpdateQueued={handleUpdateQueued}
                    onMoveQueued={handleMoveQueued}
                    onRemoveQueued={handleRemoveQueued}
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
                    onToggleContinuityInspector={
                      handleToggleContinuityInspector
                    }
                  />
                </m.div>
              </ContextActionMenu>

              <AnimatePresence
                mode={historyEdge === "left" ? "sync" : "popLayout"}
              >
                {historyOpen ? (
                  <m.div
                    className={`ai-chat-drawer ai-chat-drawer--${historyEdge}`}
                    data-drawer-kind="history"
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
                        drawerDrag?.drawer === "history"
                          ? drawerDrag.offsetX
                          : 0,
                      opacity: 1,
                    }}
                    exit={{
                      x: reduceMotion
                        ? 0
                        : historyEdge === "left"
                          ? "-104%"
                          : "104%",
                      opacity: 0,
                      width:
                        fullscreen && historyEdge === "left" && !reduceMotion
                          ? 0
                          : undefined,
                    }}
                    layout="position"
                    style={{
                      width: fullscreen
                        ? `min(${historyWidth}px, 30vw)`
                        : "100%",
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
                      hydratedRuns={scopedHydratedRuns}
                      runs={scopedRuns}
                      searchQuery={historySearch}
                      onClose={handleCloseHistoryDrawer}
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

              <AnimatePresence
                mode={reviewEdge === "left" ? "sync" : "popLayout"}
              >
                {reviewOpen && !reviewExpanded ? (
                  <m.div
                    className={`ai-chat-drawer ai-chat-drawer--${reviewEdge}`}
                    data-drawer-kind="review"
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
                      x:
                        drawerDrag?.drawer === "review"
                          ? drawerDrag.offsetX
                          : 0,
                      opacity: 1,
                    }}
                    exit={{
                      x: reduceMotion
                        ? 0
                        : reviewEdge === "left"
                          ? "-104%"
                          : "104%",
                      opacity: 0,
                      width:
                        fullscreen && reviewEdge === "left" && !reduceMotion
                          ? 0
                          : undefined,
                    }}
                    layout="position"
                    style={{
                      width: fullscreen
                        ? `min(${reviewWidth}px, 38vw)`
                        : "100%",
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
                      onClose={handleCloseReviewDrawer}
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
                      reduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, scale: 0.985 }
                    }
                    animate={
                      reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }
                    }
                    exit={
                      reduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, scale: 0.985 }
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
        </div>
      </LazyMotion>
    </section>
  );
}
