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
  AICancelChatRun,
  AIGetChatRun,
  AIGetContextPreview,
  AIGetStatus,
  AIListChatRuns,
  AIListContextProviders,
  AIListEgressRecords,
  AIRefreshLocalProviders,
  AIStartChatRun,
  AITestProvider,
} from "../../wails/app";
import { EventsOn } from "../../wails/runtime";
import {
  AIChatAction,
  AIChatRunEnvelope,
  type AIChatRun,
  type AIContextRequest,
  type AIContextSnapshot,
  type AIEgressRecord,
  type AIProviderCapability,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import {
  AnimatePresence,
  LazyMotion,
  LayoutGroup,
  domAnimation,
  m,
} from "framer-motion";
import { GitBranch, History } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import { useAIChatStore } from "../../stores/aiChatStore";
import { ActivityTimeline } from "./ActivityTimeline";
import { AIChatHeader } from "./AIChatHeader";
import { ChatGitReview } from "./ChatGitReview";
import { ChatHistoryRail } from "./ChatHistoryRail";
import { ChatComposer } from "./ChatComposer";
import { EmptyState } from "./EmptyState";
import { RunCard } from "./RunCard";
import {
  getProviderDisabledReason,
  isReadyChatProvider,
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

const initialState: AIChatUIState = {
  selectedAction: AIChatAction.AIChatActionAsk,
  input: "",
  activeSessionId: defaultChatSessionId,
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
  activeRunId: "",
  hydratedRuns: {},
};

interface AIChatPanelChromeState {
  historyOpen: boolean;
  reviewOpen: boolean;
  reviewExpanded: boolean;
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
  | { type: "moveHistory"; delta: number }
  | { type: "moveReview"; delta: number }
  | { type: "resizeHistory"; edge: "start" | "end"; delta: number }
  | { type: "resizeReview"; edge: "start" | "end"; delta: number }
  | { type: "toggleContextPicker" };

const initialChromeState: AIChatPanelChromeState = {
  historyOpen: false,
  reviewOpen: false,
  reviewExpanded: false,
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
      return { ...state, selectedAction: action.action };
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
    case "toggleProviderPopover":
      return {
        ...state,
        providerPopoverOpen: action.open ?? !state.providerPopoverOpen,
        settingsPopoverOpen:
          action.open === true ? false : state.settingsPopoverOpen,
      };
    case "toggleSettingsPopover":
      return {
        ...state,
        settingsPopoverOpen: action.open ?? !state.settingsPopoverOpen,
        providerPopoverOpen:
          action.open === true ? false : state.providerPopoverOpen,
      };
    case "setActiveRun":
      return { ...state, activeRunId: action.runId };
    case "hydrateRun":
      return {
        ...state,
        hydratedRuns: { ...state.hydratedRuns, [action.run.id]: action.run },
      };
    case "resetComposer":
      return { ...state, input: "" };
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
    case "moveHistory":
      return {
        ...state,
        historyInset: clamp(state.historyInset + action.delta, 12, 520),
      };
    case "moveReview":
      return {
        ...state,
        reviewInset: clamp(state.reviewInset - action.delta, 12, 520),
      };
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

function buildContextRequest(
  context: ContextToggles,
  activeFile: string,
): AIContextRequest {
  return {
    capability: "chat" as AIProviderCapability,
    filePath: context.currentFile ? activeFile : "",
    includeMnemonic: context.mnemonic,
    includeMCP: context.mcp,
    includeSkills: context.skills,
    maxSnippets: context.workspace ? 8 : 3,
  };
}

function envelopeFromRun(run: AIChatRun): AIChatRunEnvelope {
  return new AIChatRunEnvelope({
    id: run.id,
    sessionId: run.sessionId,
    projectSessionId: run.projectSessionId,
    action: run.action,
    status: run.status,
    providerId: run.providerId,
    model: run.model,
    error: run.error,
    canCancel: run.canCancel,
    contextSummary: run.contextSummary,
    toolProposals: run.toolProposals,
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
  const {
    status,
    providers,
    runs,
    hydratedRuns,
    streamingTextByRunId,
    activeRunId,
    contextPreview,
    contextProviders,
    setStatus,
    setProviders,
    upsertProvider,
    setRuns,
    upsertRunEnvelope,
    setHydratedRun,
    appendRunToken,
    setActiveRunId,
    setContextPreview,
    setContextProviders,
    setEgressRecords,
    upsertEgressRecord,
  } = useAIChatStore();

  const [state, dispatch] = useReducer(reducer, initialState);
  const [chrome, dispatchChrome] = useReducer(
    chromeReducer,
    initialChromeState,
  );
  const [loading, setLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const initialSelectionHydratedRef = useRef(false);
  const {
    historyOpen,
    reviewOpen,
    reviewExpanded,
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
  const activeRunRunning = runs.some(
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
  const messageMaxWidth = presentation === "fullscreen" ? 760 : 560;

  const handleMoveHistory = useCallback(
    (delta: number) => {
      if (!fullscreen) return;
      dispatchChrome({ type: "moveHistory", delta });
    },
    [fullscreen],
  );

  const handleMoveReview = useCallback(
    (delta: number) => {
      if (!fullscreen) return;
      dispatchChrome({ type: "moveReview", delta });
    },
    [fullscreen],
  );

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
      const [nextStatus, envelopes, preview] = await Promise.all([
        AIGetStatus(),
        AIListChatRuns(50),
        AIGetContextPreview(
          buildContextRequest(state.context, activeFile || ""),
        ),
      ]);
      const [nextContextProviders, nextEgressRecords] = await Promise.all([
        AIListContextProviders(),
        AIListEgressRecords(50),
      ]);
      const nextProviders = nextStatus?.providers ?? [];
      setStatus(nextStatus);
      setProviders(nextProviders);
      setContextProviders(nextContextProviders ?? []);
      setEgressRecords(nextEgressRecords ?? []);
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
    setProviders,
    setRuns,
    setStatus,
    setActiveRunId,
    state.context,
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
    setActiveRunId(run.id);
    dispatch({
      type: "setActiveSession",
      sessionId: run.sessionId || defaultChatSessionId,
      runId: run.id,
    });
    dispatch({ type: "setActiveRun", runId: run.id });
  });

  const handleRunEnvelopeUpdate = useEffectEvent(
    (envelope: AIChatRunEnvelope) => {
      if (!envelope?.id) return;
      upsertRunEnvelope(envelope);
      setActiveRunId(envelope.id);
      dispatch({
        type: "setActiveSession",
        sessionId: sessionIdOf(envelope),
        runId: envelope.id,
      });
      dispatch({ type: "setActiveRun", runId: envelope.id });
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
    const offEgress = EventsOn("ai:chat:egress-recorded", (record) =>
      handleEgressRecord(record as AIEgressRecord),
    );
    return () => {
      offStarted?.();
      offCompleted?.();
      offError?.();
      offCanceled?.();
      offToken?.();
      offEnvelope?.();
      offStatus?.();
      offEgress?.();
    };
  }, []);

  const handleRefreshProviders = useCallback(async () => {
    setLoading(true);
    try {
      const discovery = await AIRefreshLocalProviders();
      const nextStatus = await AIGetStatus();
      const statusProviders = nextStatus?.providers ?? [];
      const nextProviders =
        statusProviders.length > 0
          ? statusProviders
          : (discovery?.providers ?? []);
      setStatus(nextStatus);
      setProviders(nextProviders);
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
      buildContextRequest(state.context, activeFile || ""),
    );
    setContextPreview(preview);
  }, [activeFile, setContextPreview, state.context]);

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedProvider) return;
    setRuntimeError(null);
    const request: AIContextRequest = buildContextRequest(
      state.context,
      activeFile || "",
    );
    const run = await AIStartChatRun({
      action: state.selectedAction,
      sessionId: activeSessionId,
      prompt: state.input.trim(),
      providerId: selectedProvider.id,
      model: selectedModel,
      includeMnemonic: state.context.mnemonic,
      includeMCP: state.context.mcp,
      includeSkills: state.context.skills,
      context: request,
    });
    setHydratedRun(run);
    upsertRunEnvelope(envelopeFromRun(run));
    setActiveRunId(run.id);
    dispatch({ type: "setActiveRun", runId: run.id });
    dispatch({ type: "resetComposer" });
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
    upsertRunEnvelope,
  ]);

  const handleCancel = useCallback(async () => {
    const running = runs.find(
      (run) => run.status === "running" || run.status === "queued",
    );
    if (!running) return;
    await AICancelChatRun(running.id);
  }, [runs]);

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

  const handleProviderSelect = useCallback((provider: AIProviderDescriptor) => {
    if (getProviderDisabledReason(provider)) return;
    dispatch({
      type: "setProvider",
      providerId: provider.id,
      model: provider.models?.[0]?.id ?? "",
    });
  }, []);

  const handleTestProvider = useCallback(async () => {
    if (!selectedProvider) return;
    const provider = await AITestProvider(selectedProvider.id);
    upsertProvider(provider);
  }, [selectedProvider, upsertProvider]);

  const closeTransientPopovers = useCallback(() => {
    dispatch({ type: "toggleProviderPopover", open: false });
    dispatch({ type: "toggleSettingsPopover", open: false });
    dispatchChrome({ type: "patch", value: { contextPickerOpen: false } });
  }, []);

  useEffect(() => {
    const popoverOpen =
      state.providerPopoverOpen ||
      state.settingsPopoverOpen ||
      contextPickerOpen;
    if (!popoverOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-ai-chat-popover-scope]")) return;
      closeTransientPopovers();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeTransientPopovers();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    closeTransientPopovers,
    contextPickerOpen,
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
      <AIChatHeader
        context={state.context}
        contextProviders={contextProviders}
        displayPrefs={state.displayPrefs}
        loading={loading}
        providerPopoverOpen={state.providerPopoverOpen}
        providers={sortedProviders}
        selectedProvider={selectedProvider}
        selectedProviderId={selectedProvider?.id ?? ""}
        settingsPopoverOpen={state.settingsPopoverOpen}
        onContextToggle={(key, value) =>
          dispatch({ type: "setContext", key, value })
        }
        onDisplayPrefChange={(key, value) =>
          dispatch({ type: "setDisplayPref", key, value })
        }
        onNewChat={handleNewChat}
        onRefreshProviders={handleRefreshProviders}
        onRefreshRuntime={refreshRuntime}
        onSelectProvider={handleProviderSelect}
        onTestProvider={handleTestProvider}
        onToggleProviderPopover={() => {
          dispatch({ type: "toggleProviderPopover" });
          dispatchChrome({
            type: "patch",
            value: { contextPickerOpen: false },
          });
        }}
        onToggleSettingsPopover={() => {
          dispatch({ type: "toggleSettingsPopover" });
          dispatchChrome({
            type: "patch",
            value: { contextPickerOpen: false },
          });
        }}
      />

      <div
        className="ai-chat-workbench"
        data-presentation={presentation === "fullscreen" ? "expanded" : "panel"}
      >
        <LazyMotion features={domAnimation}>
          <LayoutGroup>
            {!historyOpen ? (
              <button
                className="ai-chat-edge-toggle ai-chat-edge-toggle--left"
                data-testid="ai-chat-history-toggle"
                type="button"
                title="Open chat history"
                onClick={() =>
                  dispatchChrome({
                    type: "patch",
                    value: { historyOpen: true },
                  })
                }
              >
                <History size={15} />
              </button>
            ) : null}
            {!reviewOpen && !reviewExpanded ? (
              <button
                className="ai-chat-edge-toggle ai-chat-edge-toggle--right"
                data-testid="ai-chat-review-toggle"
                type="button"
                title="Open Git Review"
                onClick={() =>
                  dispatchChrome({ type: "patch", value: { reviewOpen: true } })
                }
              >
                <GitBranch size={15} />
              </button>
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
                    {transcriptRuns.map((envelope: AIChatRunEnvelope) => (
                      <RunCard
                        active={envelope.id === activeRunKey}
                        compact={state.displayPrefs.compactCards}
                        envelope={envelope}
                        key={envelope.id}
                        maxWidth={messageMaxWidth}
                        run={hydratedRuns[envelope.id] ?? null}
                        onSelect={(runId) => {
                          setActiveRunId(runId);
                          dispatch({ type: "setActiveRun", runId });
                        }}
                      />
                    ))}
                    <div ref={transcriptEndRef} />
                  </div>
                )}
              </main>

              <ActivityTimeline
                activeEnvelope={activeEnvelope}
                activeRun={activeRun}
                activeRunText={
                  activeRun?.response ??
                  streamingTextByRunId[activeRunKey] ??
                  ""
                }
                contextPreview={contextPreview}
                selectedProvider={selectedProvider}
                selectedProviderReady={selectedProviderReady}
                visible={
                  state.displayPrefs.showActivity &&
                  (presentation === "fullscreen" || transcriptRuns.length > 0)
                }
              />

              <ChatComposer
                canSend={canSend}
                context={state.context}
                contextPickerOpen={contextPickerOpen}
                contextProviders={contextProviders}
                disabledReason={disabledReason}
                input={state.input}
                running={activeRunRunning}
                selectedAction={state.selectedAction}
                onActionChange={(action) =>
                  dispatch({ type: "setAction", action })
                }
                onCancel={handleCancel}
                onContextToggle={(key, value) =>
                  dispatch({ type: "setContext", key, value })
                }
                onInputChange={(input) => dispatch({ type: "setInput", input })}
                onRefreshContext={handleRefreshContext}
                onSend={handleSend}
                onToggleContextPicker={() => {
                  dispatch({ type: "toggleProviderPopover", open: false });
                  dispatch({ type: "toggleSettingsPopover", open: false });
                  dispatchChrome({ type: "toggleContextPicker" });
                }}
              />
            </div>

            <AnimatePresence>
              {historyOpen ? (
                <m.div
                  className="ai-chat-drawer ai-chat-drawer--left"
                  data-testid="ai-chat-history-drawer"
                  initial={{ x: "-104%", opacity: 0.72 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "-104%", opacity: 0 }}
                  layout
                  style={{
                    width: historyWidth,
                    ...(fullscreen ? { left: historyInset } : {}),
                  }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
                      dispatchChrome({
                        type: "patch",
                        value: { historyOpen: false },
                      })
                    }
                    onMove={handleMoveHistory}
                    onNewChat={handleNewChat}
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
                  className="ai-chat-drawer ai-chat-drawer--right"
                  data-testid="ai-chat-review-drawer"
                  initial={{ x: "104%", opacity: 0.72 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "104%", opacity: 0 }}
                  layout
                  style={{
                    width: reviewWidth,
                    ...(fullscreen ? { right: reviewInset } : {}),
                  }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
                      dispatchChrome({
                        type: "patch",
                        value: { reviewOpen: false },
                      })
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
                    onMove={handleMoveReview}
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
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.985 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
                    onMove={handleMoveReview}
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
        </LazyMotion>
      </div>
    </section>
  );
}
