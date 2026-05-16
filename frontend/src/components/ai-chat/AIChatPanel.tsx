import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  AIApplyPatchArtifact,
  AICancelChatRun,
  AIDeleteChatSession,
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
  AIListPromptWorkflows,
  AIListTools,
  AIListToolAudit,
  AIRefreshLocalProviders,
  AIRollbackPatchCheckpoint,
  AIStartChatRun,
  AIStartProviderRuntime,
  AIStopProviderRuntime,
  AISuggestChatMentions,
  type AIProviderRuntimeDescriptor,
  type AIProviderRuntimeModel,
} from "../../wails/app";
import { EventsOn } from "../../wails/runtime";
import {
  AIChatAction,
  AIChatRunEnvelope,
  AIContextItemKind,
  type AIChatMentionCandidate,
  type AIChatMentionQuery,
  type AIChatRun,
  type AIChatRunArtifact,
  type AIContextRequest,
  type AIContextSnapshot,
  type AIEgressRecord,
  type AIModelCapabilityDescriptor,
  type AIProviderCapability,
  type AIToolAuditRecord,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { PanelPosition } from "../ui/FloatingPanel";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import {
  AnimatePresence,
  LazyMotion,
  LayoutGroup,
  domAnimation,
  m,
  useReducedMotion,
} from "framer-motion";
import { useEditorStore } from "../../stores/editorStore";
import { useEditorSettingsStore } from "../../stores/editorSettingsStore";
import { useAIChatStore } from "../../stores/aiChatStore";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";
import { AIChatHeader } from "./AIChatHeader";
import { ChatGitReview } from "./ChatGitReview";
import { ChatHistoryRail } from "./ChatHistoryRail";
import { ChatComposer } from "./ChatComposer";
import { EmptyState } from "./EmptyState";
import { RunCard } from "./RunCard";
import {
  getProviderDisabledReason,
  isReadyChatProvider,
  isSupportedLocalChatProvider,
  selectDefaultProvider,
  sortProviders,
} from "./providerPresentation";
import type {
  AIChatPanelProps,
  AIChatUIAction,
  AIChatUIState,
  ContextToggles,
} from "./types";
import "./ai-chat.css";

const defaultChatSessionId = "default";

const initialContext: ContextToggles = {
  workspace: true,
  currentFile: true,
  terminalLogs: false,
  mnemonic: true,
  mcp: true,
  skills: true,
};

type DrawerId = "history" | "review";
type DrawerSnapEdge = Extract<PanelPosition, "left" | "right">;

const initialState: AIChatUIState = {
  selectedAction: AIChatAction.AIChatActionAsk,
  input: "",
  activeSessionId: defaultChatSessionId,
  selectedProfileId: "",
  selectedWorkflowId: "",
  selectedMentions: [],
  selectedProviderId: "",
  selectedModel: "",
  context: initialContext,
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

interface AIChatPanelChromeState {
  historyOpen: boolean;
  reviewOpen: boolean;
  reviewExpanded: boolean;
  historyEdge: DrawerSnapEdge;
  reviewEdge: DrawerSnapEdge;
  historyWidth: number;
  reviewWidth: number;
  historyInset: number;
  reviewInset: number;
  contextPickerOpen: boolean;
  historySearch: string;
  reviewSearch: string;
  diffSearch: string;
  commitMessage: string;
}

type AIChatPanelChromeAction =
  | { type: "patch"; value: Partial<AIChatPanelChromeState> }
  | { type: "openDrawer"; drawer: DrawerId }
  | { type: "closeDrawer"; drawer: DrawerId }
  | { type: "snapDrawer"; drawer: DrawerId; edge: DrawerSnapEdge }
  | { type: "resizeHistory"; edge: "start" | "end"; delta: number }
  | { type: "resizeReview"; edge: "start" | "end"; delta: number }
  | { type: "toggleContextPicker" };

const initialChromeState: AIChatPanelChromeState = {
  historyOpen: false,
  reviewOpen: false,
  reviewExpanded: false,
  historyEdge: "left",
  reviewEdge: "right",
  historyWidth: 270,
  reviewWidth: 380,
  historyInset: 12,
  reviewInset: 12,
  contextPickerOpen: false,
  historySearch: "",
  reviewSearch: "",
  diffSearch: "",
  commitMessage: "",
};

function reducer(state: AIChatUIState, action: AIChatUIAction): AIChatUIState {
  switch (action.type) {
    case "setAction":
      return {
        ...state,
        selectedAction: action.action,
        selectedWorkflowId: "",
        selectedMentions: state.selectedMentions.filter(
          (mention) => !mention.workflowId,
        ),
      };
    case "setProfile":
      return { ...state, selectedProfileId: action.profileId };
    case "setWorkflow":
      return { ...state, selectedWorkflowId: action.workflowId };
    case "addMention": {
      const mentions = state.selectedMentions.filter(
        (mention) => mention.id !== action.mention.id,
      );
      return { ...state, selectedMentions: [...mentions, action.mention] };
    }
    case "removeMention": {
      const removed = state.selectedMentions.find(
        (mention) => mention.id === action.id,
      );
      return {
        ...state,
        selectedMentions: state.selectedMentions.filter(
          (mention) => mention.id !== action.id,
        ),
        selectedProfileId:
          removed?.profileId && removed.profileId === state.selectedProfileId
            ? ""
            : state.selectedProfileId,
        selectedWorkflowId:
          removed?.workflowId && removed.workflowId === state.selectedWorkflowId
            ? ""
            : state.selectedWorkflowId,
      };
    }
    case "setInput":
      return { ...state, input: action.input };
    case "setActiveSession":
      return {
        ...state,
        activeSessionId: action.sessionId || defaultChatSessionId,
        activeRunId: action.runId ?? "",
      };
    case "setProvider":
      return {
        ...state,
        selectedProviderId: action.providerId,
        selectedModel: action.model ?? state.selectedModel,
        providerPopoverOpen: false,
        activityPopoverOpen: false,
      };
    case "setModel":
      return { ...state, selectedModel: action.model };
    case "setContext":
      return {
        ...state,
        context: { ...state.context, [action.key]: action.value },
      };
    case "setDisplayPref":
      return {
        ...state,
        displayPrefs: { ...state.displayPrefs, [action.key]: action.value },
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
        selectedProfileId: "",
        selectedWorkflowId: "",
        selectedMentions: [],
      };
    case "ensureProvider":
      if (state.selectedProviderId) return state;
      return {
        ...state,
        selectedProviderId: action.providerId,
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
          historyInset: 12,
        };
        if (state.reviewOpen && state.reviewEdge === action.edge) {
          nextState.reviewEdge = oppositeEdge(action.edge);
          nextState.reviewInset = 12;
        }
        return nextState;
      }
      const nextState = {
        ...state,
        reviewEdge: action.edge,
        reviewInset: 12,
      };
      if (state.historyOpen && state.historyEdge === action.edge) {
        nextState.historyEdge = oppositeEdge(action.edge);
        nextState.historyInset = 12;
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
            12,
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
        const nextWidth = clamp(state.reviewWidth + action.delta, 320, 620);
        return {
          ...state,
          reviewInset: clamp(
            state.reviewInset - (nextWidth - state.reviewWidth),
            12,
            520,
          ),
          reviewWidth: nextWidth,
        };
      }
      return {
        ...state,
        reviewWidth: clamp(state.reviewWidth - action.delta, 320, 620),
      };
    case "toggleContextPicker":
      return {
        ...state,
        contextPickerOpen: !state.contextPickerOpen,
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

async function fallbackOnRuntimeError<T>(
  request: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await request;
  } catch {
    return fallback;
  }
}

function sessionIdOf(run: Pick<AIChatRunEnvelope, "sessionId">): string {
  return run.sessionId?.trim() || defaultChatSessionId;
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
  activeFile: string,
): NonNullable<AIContextRequest["contextItems"]>[number] | null {
  const item = mention.contextItem;
  if (!item) return null;
  if (
    item.id === "current_file" &&
    item.kind === AIContextItemKind.AIContextItemKindFile &&
    activeFile
  ) {
    return {
      ...item,
      label: activeFile.split("/").pop() || item.label || "Current file",
      path: activeFile,
    };
  }
  return item;
}

function buildContextRequest(
  context: ContextToggles,
  activeFile: string,
  prompt = "",
  mentions: AIChatMentionCandidate[] = [],
): AIContextRequest {
  const contextItems: NonNullable<AIContextRequest["contextItems"]> = [];
  if (context.workspace) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindWorkspace,
      label: "Workspace",
      source: "composer",
    });
  }
  if (context.currentFile && activeFile) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindFile,
      label: activeFile.split("/").pop() || "Current file",
      path: activeFile,
      source: "composer",
    });
  }
  if (context.terminalLogs) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindTerminal,
      label: "Terminal",
      source: "composer",
    });
  }
  if (context.mnemonic) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindMnemonic,
      label: "Mnemonic",
      source: "composer",
    });
  }
  if (context.mcp) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindMCP,
      label: "MCP",
      source: "composer",
    });
  }
  if (context.skills) {
    pushUniqueContextItem(contextItems, {
      kind: AIContextItemKind.AIContextItemKindSkill,
      label: "Skills",
      source: "composer",
    });
  }
  mentions.forEach((mention) => {
    const item = contextItemForMention(mention, activeFile);
    if (item) {
      pushUniqueContextItem(contextItems, item);
    }
  });
  const includeMnemonic =
    context.mnemonic ||
    hasMentionContextKind(
      mentions,
      AIContextItemKind.AIContextItemKindMnemonic,
    );
  const includeMCP =
    context.mcp ||
    hasMentionContextKind(mentions, AIContextItemKind.AIContextItemKindMCP);
  const includeSkills =
    context.skills ||
    hasMentionContextKind(mentions, AIContextItemKind.AIContextItemKindSkill);
  const includeWorkspace =
    context.workspace ||
    hasMentionContextKind(
      mentions,
      AIContextItemKind.AIContextItemKindWorkspace,
    );
  return {
    capability: "chat" as AIProviderCapability,
    prompt,
    filePath: context.currentFile ? activeFile : "",
    includeMnemonic,
    includeMCP,
    includeSkills,
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
    revision: run.revision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
}

export function AIChatPanelContent({
  presentation = "panel",
  projectPath = "",
}: AIChatPanelProps) {
  const activeFile = useEditorStore(
    (store) =>
      store.statusFile.path ??
      store.getActiveTab(store.activePaneId)?.path ??
      "",
  );
  const aiChatSendShortcut = useEditorSettingsStore(
    (store) => store.aiChatSendShortcut,
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
    deleteSessionRuns,
    setHydratedRun,
    appendRunToken,
    setActiveRunId,
    setContextPreview,
    setContextProviders,
    setEgressRecords,
    upsertEgressRecord,
    setMnemonicEntries,
    setApprovalPolicy,
    setConsentPolicy,
    setEmbeddingStatus,
  } = useAIChatStore();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [chrome, dispatchChrome] = useReducer(
    chromeReducer,
    initialChromeState,
  );
  const [loading, setLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [providerRuntimes, setProviderRuntimes] = useState<
    AIProviderRuntimeDescriptor[]
  >([]);
  const [modelCapabilities, setModelCapabilities] = useState<
    AIModelCapabilityDescriptor[]
  >([]);
  const [activeArtifacts, setActiveArtifacts] = useState<AIChatRunArtifact[]>(
    [],
  );
  const [artifactBusyId, setArtifactBusyId] = useState<string | null>(null);
  const [providerRuntimeBusy, setProviderRuntimeBusy] = useState(false);
  const [providerRuntimeError, setProviderRuntimeError] = useState("");
  const [drawerDrag, setDrawerDrag] = useState<{
    drawer: DrawerId;
    offsetX: number;
    targetEdge: DrawerSnapEdge | null;
  } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const initialSelectionHydratedRef = useRef(false);
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
    historyInset,
    reviewInset,
    contextPickerOpen,
    historySearch,
    reviewSearch,
    diffSearch,
    commitMessage,
  } = chrome;

  const fullscreen = presentation === "fullscreen";
  const reduceMotion = useReducedMotion();
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
  const selectedProviderReady = isReadyChatProvider(selectedProvider);
  const selectedModel =
    state.selectedModel ||
    selectedProvider?.models?.[0]?.id ||
    status?.activeModel ||
    "";
  const activeSessionId = state.activeSessionId || defaultChatSessionId;
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
  const activeRunRunning = activeSessionEnvelopes.some(
    (run) => run.status === "running" || run.status === "queued",
  );
  const inputReady = state.input.trim().length > 0;
  const providerDisabledReason = getProviderDisabledReason(selectedProvider);
  const disabledReason = activeRunRunning
    ? "Generation is running"
    : !inputReady
      ? selectedProviderReady
        ? ""
        : providerDisabledReason
      : providerDisabledReason;
  const canSend = inputReady && selectedProviderReady && !activeRunRunning;
  const transcriptRuns = useMemo(
    () => [...activeSessionEnvelopes].reverse(),
    [activeSessionEnvelopes],
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
    setRuntimeError(null);
    try {
      const contextRequest = buildContextRequest(
        state.context,
        activeFile || "",
        state.input,
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
      ] = await Promise.all([
        AIGetStatus(),
        fallbackOnRuntimeError(AIListChatRuns(50), []),
        fallbackOnRuntimeError(AIGetContextPreview(contextRequest), null),
        fallbackOnRuntimeError(AIListChatActions(), []),
        fallbackOnRuntimeError(AIListContextProviders(), []),
        fallbackOnRuntimeError(AIListEgressRecords(50), []),
        fallbackOnRuntimeError(AIListAgentProfiles(), []),
        fallbackOnRuntimeError(AIListPromptWorkflows(), []),
        fallbackOnRuntimeError(AIListTools(), []),
        fallbackOnRuntimeError(AIListToolAudit(50), []),
        fallbackOnRuntimeError(AIListModelCapabilities(), []),
        fallbackOnRuntimeError(AIGetConsentPolicy(), null),
        fallbackOnRuntimeError(AIGetEmbeddingStatus(), null),
        fallbackOnRuntimeError(AIGetApprovalPolicy(), null),
        fallbackOnRuntimeError(AIListMnemonicEntries(24), []),
        fallbackOnRuntimeError(AIListProviderRuntimes(), []),
      ]);
      const nextProviders = nextStatus?.providers ?? [];
      setStatus(nextStatus);
      setProviders(nextProviders);
      setActions(nextActions ?? []);
      setContextProviders(nextContextProviders ?? []);
      setEgressRecords(nextEgressRecords ?? []);
      setAgentProfiles(nextAgentProfiles ?? []);
      setPromptWorkflows(nextPromptWorkflows ?? []);
      setTools(nextTools ?? []);
      setToolAudit(nextToolAudit ?? []);
      setModelCapabilities(nextModelCapabilities ?? []);
      setConsentPolicy(nextConsentPolicy ?? null);
      setEmbeddingStatus(nextEmbeddingStatus ?? null);
      setApprovalPolicy(nextApprovalPolicy ?? null);
      setMnemonicEntries(nextMnemonicEntries ?? []);
      setProviderRuntimes(nextProviderRuntimes ?? []);
      setRuns(envelopes ?? []);
      setContextPreview(preview);

      const defaultProvider = selectDefaultProvider(
        nextProviders,
        nextStatus?.activeProviderId,
      );
      if (defaultProvider) {
        dispatch({
          type: "ensureProvider",
          providerId: defaultProvider.id,
          model:
            nextStatus?.activeModel || defaultProvider.models?.[0]?.id || "",
        });
      }
      if (!initialSelectionHydratedRef.current && envelopes?.[0]?.id) {
        initialSelectionHydratedRef.current = true;
        setActiveRunId(envelopes[0].id);
        dispatch({
          type: "setActiveSession",
          sessionId: sessionIdOf(envelopes[0]),
          runId: envelopes[0].id,
        });
      }
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [
    activeFile,
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
    setStatus,
    setActiveRunId,
    setTools,
    setToolAudit,
    state.context,
    state.input,
  ]);

  const refreshRuntimeEvent = useEffectEvent(refreshRuntime);

  useEffect(() => {
    refreshRuntimeEvent();
  }, []);

  useEffect(() => {
    if (!activeRunKey) return;
    if (hydratedRuns[activeRunKey]) return;
    let cancelled = false;
    AIGetChatRun(activeRunKey)
      .then((run) => {
        if (!cancelled && run) {
          setHydratedRun(run);
        }
      })
      .catch(() => {
        // Metadata-only envelopes remain renderable when full run hydration fails.
      });
    return () => {
      cancelled = true;
    };
  }, [activeRunKey, hydratedRuns, setHydratedRun]);

  useEffect(() => {
    if (!activeRunKey) {
      setActiveArtifacts([]);
      return;
    }
    let cancelled = false;
    AIListChatRunArtifacts(activeRunKey)
      .then((artifacts) => {
        if (!cancelled) {
          setActiveArtifacts(artifacts ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveArtifacts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeRunKey, activeEnvelope?.updatedAt]);

  const refreshActiveArtifacts = useCallback(async () => {
    if (!activeRunKey) {
      setActiveArtifacts([]);
      return;
    }
    const artifacts = await AIListChatRunArtifacts(activeRunKey);
    setActiveArtifacts(artifacts ?? []);
  }, [activeRunKey]);

  useEffect(() => {
    if (!state.displayPrefs.autoScroll) return;
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [
    runs,
    activeRun?.response,
    streamingTextByRunId,
    state.displayPrefs.autoScroll,
  ]);

  const handleRunUpdate = useEffectEvent((run: AIChatRun) => {
    if (!run?.id) return;
    setHydratedRun(run);
    upsertRunEnvelope(envelopeFromRun(run));
    void AIGetChatRunEnvelope(run.id)
      .then((envelope) => {
        if (envelope?.id) {
          upsertRunEnvelope(envelope);
        }
      })
      .catch(() => {
        // The run payload is enough to keep the transcript live.
      });
    const runSessionId = run.sessionId || defaultChatSessionId;
    if (runSessionId === state.activeSessionId || !state.activeRunId) {
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
      upsertRunEnvelope(envelope);
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
    },
  );

  const handleEgressRecord = useEffectEvent((record: AIEgressRecord) => {
    const source = record?.source ?? "";
    if (!["chat_run", "ai_chat", "ai-chat"].includes(source)) return;
    if (record.runId && activeRunKey && record.runId !== activeRunKey) return;
    if (
      record.chatAction &&
      activeEnvelope?.action &&
      record.chatAction !== activeEnvelope.action
    ) {
      return;
    }
    upsertEgressRecord(record);
  });

  const handleToolAuditRecord = useEffectEvent((result: unknown) => {
    const audit = (result as { audit?: AIToolAuditRecord })?.audit;
    if (!audit?.id) return;
    upsertToolAudit(audit);
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
    const offEgress = EventsOn("ai:chat:egress-recorded", (record) =>
      handleEgressRecord(record as AIEgressRecord),
    );
    const offToolAudit = EventsOn("ai:tool:call-recorded", (result) =>
      handleToolAuditRecord(result),
    );
    return () => {
      offStarted?.();
      offCompleted?.();
      offError?.();
      offCanceled?.();
      offToken?.();
      offEnvelope?.();
      offStatus?.();
      offRuntime?.();
      offEgress?.();
      offToolAudit?.();
    };
  }, []);

  const handleRefreshProviders = useCallback(async () => {
    setLoading(true);
    try {
      const discovery = await AIRefreshLocalProviders();
      const [nextStatus, nextProviderRuntimes] = await Promise.all([
        AIGetStatus(),
        fallbackOnRuntimeError(AIListProviderRuntimes(), []),
      ]);
      const statusProviders = nextStatus?.providers ?? [];
      const nextProviders =
        statusProviders.length > 0
          ? statusProviders
          : (discovery?.providers ?? []);
      setStatus(nextStatus);
      setProviders(nextProviders);
      setProviderRuntimes(nextProviderRuntimes ?? []);
      const defaultProvider = selectDefaultProvider(
        nextProviders,
        nextStatus?.activeProviderId,
      );
      if (defaultProvider) {
        dispatch({
          type: "setProvider",
          providerId: defaultProvider.id,
          model:
            nextStatus?.activeModel || defaultProvider.models?.[0]?.id || "",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [setProviders, setStatus]);

  const handleRefreshContext = useCallback(async () => {
    const preview = await AIGetContextPreview(
      buildContextRequest(
        state.context,
        activeFile || "",
        state.input,
        state.selectedMentions,
      ),
    );
    setContextPreview(preview);
  }, [
    activeFile,
    setContextPreview,
    state.context,
    state.input,
    state.selectedMentions,
  ]);

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

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedProvider) return;
    setRuntimeError(null);
    const request: AIContextRequest = buildContextRequest(
      state.context,
      activeFile || "",
      state.input.trim(),
      state.selectedMentions,
    );
    try {
      const run = await AIStartChatRun({
        action: state.selectedAction,
        sessionId: activeSessionId,
        profileId: state.selectedProfileId,
        workflowId: state.selectedWorkflowId,
        prompt: state.input.trim(),
        providerId: selectedProvider.id,
        model: selectedModel,
        includeMnemonic: request.includeMnemonic,
        includeMCP: request.includeMCP,
        includeSkills: request.includeSkills,
        context: request,
      });
      setHydratedRun(run);
      upsertRunEnvelope(envelopeFromRun(run));
      setActiveRunId(run.id);
      dispatch({ type: "setActiveRun", runId: run.id });
      dispatch({ type: "resetComposer" });
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : String(error));
    }
  }, [
    activeFile,
    canSend,
    selectedModel,
    selectedProvider,
    setActiveRunId,
    setHydratedRun,
    activeSessionId,
    state.context,
    state.input,
    state.selectedAction,
    state.selectedMentions,
    state.selectedProfileId,
    state.selectedWorkflowId,
    upsertRunEnvelope,
  ]);

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

  const handleApplyPatchArtifact = useCallback(
    async (artifactId: string) => {
      setRuntimeError(null);
      setArtifactBusyId(artifactId);
      try {
        await AIApplyPatchArtifact({ artifactId });
        await refreshActiveArtifacts();
        dispatchChrome({ type: "openDrawer", drawer: "review" });
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshActiveArtifacts],
  );

  const handleRollbackPatchCheckpoint = useCallback(
    async (checkpointId: string) => {
      setRuntimeError(null);
      setArtifactBusyId(checkpointId);
      try {
        await AIRollbackPatchCheckpoint({ checkpointId });
        await refreshActiveArtifacts();
        dispatchChrome({ type: "openDrawer", drawer: "review" });
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        setArtifactBusyId(null);
      }
    },
    [refreshActiveArtifacts],
  );

  const handleNewChat = useCallback(() => {
    const sessionId = createChatSessionId();
    setActiveRunId(null);
    dispatch({ type: "setActiveSession", sessionId });
  }, [setActiveRunId]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const nextRun = runs.find((run) => sessionIdOf(run) === sessionId);
      setActiveRunId(nextRun?.id ?? null);
      dispatch({
        type: "setActiveSession",
        sessionId,
        runId: nextRun?.id ?? "",
      });
    },
    [runs, setActiveRunId],
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
    });
  }, []);

  const handleModelSelect = useCallback((modelId: string) => {
    dispatch({ type: "setModel", model: modelId });
  }, []);

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
    dispatchChrome({ type: "patch", value: { contextPickerOpen: false } });
  }, []);

  useEffect(() => {
    const popoverOpen =
      state.providerPopoverOpen ||
      state.settingsPopoverOpen ||
      state.activityPopoverOpen ||
      contextPickerOpen;
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
    contextPickerOpen,
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
        <AIChatHeader
          activeEnvelope={activeEnvelope}
          activeRun={activeRun}
          activeRunText={
            activeRun?.response ?? streamingTextByRunId[activeRunKey] ?? ""
          }
          activityPopoverOpen={state.activityPopoverOpen}
          agentProfiles={agentProfiles}
          approvalPolicy={approvalPolicy}
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
          selectedProvider={selectedProvider}
          selectedProviderReady={selectedProviderReady}
          settingsPopoverOpen={state.settingsPopoverOpen}
          status={status}
          tools={tools}
          toolAudit={toolAudit}
          modelCapabilities={modelCapabilities}
          onContextToggle={(key, value) =>
            dispatch({ type: "setContext", key, value })
          }
          onDisplayPrefChange={(key, value) =>
            dispatch({ type: "setDisplayPref", key, value })
          }
          onToggleActivityPopover={() => {
            dispatch({ type: "toggleActivityPopover" });
            dispatchChrome({
              type: "patch",
              value: { contextPickerOpen: false },
            });
          }}
          onToggleHistory={() => {
            closeTransientPopovers();
            dispatchChrome({
              type: historyOpen ? "closeDrawer" : "openDrawer",
              drawer: "history",
            });
          }}
          onToggleReview={() => {
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
          onNewChat={handleNewChat}
          onRefreshRuntime={refreshRuntime}
          onToggleSettingsPopover={() => {
            dispatch({ type: "toggleSettingsPopover" });
            dispatchChrome({
              type: "patch",
              value: { contextPickerOpen: false },
            });
          }}
        />

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
            <div
              className="ai-chat-conversation"
              data-dimmed={reviewExpanded ? "true" : "false"}
            >
              <main className="ai-chat-body">
                {runtimeError ? (
                  <div className="ai-chat-runtime-error">{runtimeError}</div>
                ) : null}
                {transcriptRuns.length === 0 ? (
                  <EmptyState
                    providerReady={selectedProviderReady}
                    onRefresh={handleRefreshProviders}
                  />
                ) : (
                  <div className="ai-chat-transcript">
                    <AnimatePresence initial={false}>
                      {transcriptRuns.map((envelope: AIChatRunEnvelope) => (
                        <RunCard
                          active={envelope.id === activeRunKey}
                          compact={state.displayPrefs.compactCards}
                          envelope={envelope}
                          artifactBusyId={artifactBusyId}
                          artifacts={
                            envelope.id === activeRunKey ? activeArtifacts : []
                          }
                          key={envelope.id}
                          reduceMotion={Boolean(reduceMotion)}
                          run={hydratedRuns[envelope.id] ?? null}
                          streamingText={
                            streamingTextByRunId[envelope.id] ?? ""
                          }
                          onApplyPatchArtifact={handleApplyPatchArtifact}
                          onOpenReview={() =>
                            dispatchChrome({
                              type: "openDrawer",
                              drawer: "review",
                            })
                          }
                          onRollbackPatchCheckpoint={
                            handleRollbackPatchCheckpoint
                          }
                          onSelect={(runId) => {
                            setActiveRunId(runId);
                            dispatch({ type: "setActiveRun", runId });
                          }}
                        />
                      ))}
                    </AnimatePresence>
                    <div ref={transcriptEndRef} />
                  </div>
                )}
              </main>

              <ChatComposer
                canSend={canSend}
                actions={actions}
                context={state.context}
                contextPickerOpen={contextPickerOpen}
                contextProviders={contextProviders}
                disabledReason={disabledReason}
                input={state.input}
                providerRuntimeBusy={providerRuntimeBusy}
                providerRuntimeError={providerRuntimeError}
                providerRuntimes={providerRuntimes}
                providers={sortedProviders}
                running={activeRunRunning}
                selectedAction={state.selectedAction}
                selectedMentions={state.selectedMentions}
                selectedModel={selectedModel}
                selectedProvider={selectedProvider}
                sendShortcut={aiChatSendShortcut}
                onActionChange={(action) =>
                  dispatch({ type: "setAction", action })
                }
                onCancel={handleCancel}
                onContextToggle={(key, value) =>
                  dispatch({ type: "setContext", key, value })
                }
                onInputChange={(input) => dispatch({ type: "setInput", input })}
                onMentionQuery={handleMentionQuery}
                onMentionRemove={(id) =>
                  dispatch({ type: "removeMention", id })
                }
                onMentionSelect={handleMentionSelect}
                onRefreshContext={handleRefreshContext}
                onRefreshProviders={handleRefreshProviders}
                onSend={handleSend}
                onSelectModel={handleModelSelect}
                onSelectProvider={handleProviderSelect}
                onStartProviderRuntime={handleStartProviderRuntime}
                onStopProviderRuntime={handleStopProviderRuntime}
                onToggleContextPicker={() => {
                  dispatch({ type: "toggleProviderPopover", open: false });
                  dispatch({ type: "toggleSettingsPopover", open: false });
                  dispatch({ type: "toggleActivityPopover", open: false });
                  dispatchChrome({ type: "toggleContextPicker" });
                }}
              />
            </div>

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
                        ? { left: historyInset }
                        : { right: historyInset }
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
                        ? { left: reviewInset }
                        : { right: reviewInset }
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
