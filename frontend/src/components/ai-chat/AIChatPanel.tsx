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
  AIClearChatRuns,
  AIGetChatRun,
  AIGetContextPreview,
  AIGetStatus,
  AIListChatRuns,
  AIListContextProviders,
  AIListEgressRecords,
  AIRefreshLocalProviders,
  AISaveProviderSettings,
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
  type AIProviderSettings,
  type AIStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import { useEditorStore } from "../../stores/editorStore";
import { useAIChatStore } from "../../stores/aiChatStore";
import { ActivityTimeline } from "./ActivityTimeline";
import { AIChatHeader } from "./AIChatHeader";
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
  secretDraft: "",
};

function reducer(state: AIChatUIState, action: AIChatUIAction): AIChatUIState {
  switch (action.type) {
    case "setAction":
      return { ...state, selectedAction: action.action };
    case "setInput":
      return { ...state, input: action.input };
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
    case "setSecretDraft":
      return { ...state, secretDraft: action.value };
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
    egressRecords,
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
  const [loading, setLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const sortedProviders = useMemo(() => sortProviders(providers), [providers]);
  const selectedProvider = useMemo(() => {
    const explicit = sortedProviders.find(
      (provider) =>
        provider.id === state.selectedProviderId && !provider.frontier,
    );
    return (
      explicit ??
      selectDefaultProvider(sortedProviders, status?.activeProviderId)
    );
  }, [sortedProviders, state.selectedProviderId, status?.activeProviderId]);
  const selectedProviderReady = isReadyChatProvider(selectedProvider);
  const readyLocalProviders = useMemo(
    () => sortedProviders.filter(isReadyChatProvider),
    [sortedProviders],
  );
  const selectedModel =
    state.selectedModel ||
    selectedProvider?.models?.[0]?.id ||
    status?.activeModel ||
    "";
  const activeRunKey = state.activeRunId || activeRunId || "";
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
  const transcriptRuns = useMemo(() => [...runs].reverse(), [runs]);
  const messageMaxWidth = presentation === "fullscreen" ? 760 : 560;

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
      setStatus(nextStatus);
      setProviders(nextStatus.providers ?? []);
      setContextProviders(nextContextProviders ?? []);
      setEgressRecords(nextEgressRecords ?? []);
      setRuns(envelopes ?? []);
      setContextPreview(preview);

      const defaultProvider = selectDefaultProvider(
        nextStatus.providers ?? [],
        nextStatus.activeProviderId,
      );
      if (defaultProvider) {
        dispatch({
          type: "ensureProvider",
          providerId: defaultProvider.id,
          model:
            nextStatus.activeModel || defaultProvider.models?.[0]?.id || "",
        });
      }
      if (envelopes?.[0]?.id) {
        setActiveRunId(envelopes[0].id);
        dispatch({ type: "setActiveRun", runId: envelopes[0].id });
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
    if (!state.activeRunId) return;
    if (hydratedRuns[state.activeRunId]) return;
    let cancelled = false;
    AIGetChatRun(state.activeRunId)
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
  }, [hydratedRuns, setHydratedRun, state.activeRunId]);

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
    dispatch({ type: "setActiveRun", runId: run.id });
  });

  const handleRunEnvelopeUpdate = useEffectEvent(
    (envelope: AIChatRunEnvelope) => {
      if (!envelope?.id) return;
      upsertRunEnvelope(envelope);
      setActiveRunId(envelope.id);
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
    if (record.runId && activeRunId && record.runId !== activeRunId) return;
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
  }, [
    handleEgressRecord,
    handleProviderDescriptor,
    handleRunEnvelopeUpdate,
    handleRunToken,
    handleRunUpdate,
  ]);

  const handleRefreshProviders = useCallback(async () => {
    setLoading(true);
    try {
      const discovery = await AIRefreshLocalProviders();
      const nextStatus = await AIGetStatus();
      setStatus(nextStatus);
      setProviders(
        nextStatus.providers?.length
          ? nextStatus.providers
          : (discovery.providers ?? []),
      );
      const defaultProvider = selectDefaultProvider(
        nextStatus.providers?.length
          ? nextStatus.providers
          : (discovery.providers ?? []),
        nextStatus.activeProviderId,
      );
      if (defaultProvider) {
        dispatch({
          type: "setProvider",
          providerId: defaultProvider.id,
          model:
            nextStatus.activeModel || defaultProvider.models?.[0]?.id || "",
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

  const handleNewChat = useCallback(async () => {
    await AIClearChatRuns();
    setRuns([]);
    setActiveRunId(null);
    dispatch({ type: "setActiveRun", runId: "" });
  }, [setActiveRunId, setRuns]);

  const handleProviderSelect = useCallback((provider: AIProviderDescriptor) => {
    if (provider.frontier) return;
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

  const handleSaveSecret = useCallback(async () => {
    if (!selectedProvider || !state.secretDraft.trim()) return;
    const settings: AIProviderSettings = {
      id: selectedProvider.id,
      name: selectedProvider.name,
      kind: selectedProvider.kind,
      endpoint: selectedProvider.endpoint,
      model: selectedProvider.defaultModel,
      enabled: true,
      manual: selectedProvider.manual,
      capabilities: selectedProvider.capabilities,
      secretValue: state.secretDraft.trim(),
      authMode: selectedProvider.authMode,
      oauthSupported: selectedProvider.oauthSupported,
    };
    const provider = await AISaveProviderSettings(settings);
    dispatch({ type: "setSecretDraft", value: "" });
    upsertProvider(provider);
  }, [selectedProvider, state.secretDraft, upsertProvider]);

  const panelClass = [
    "ai-chat-panel",
    `ai-chat-panel--${presentation}`,
    state.displayPrefs.compactCards ? "is-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={panelClass} data-testid="ai-chat-panel">
      <AIChatHeader
        context={state.context}
        contextProviders={contextProviders}
        displayPrefs={state.displayPrefs}
        loading={loading}
        providerPopoverOpen={state.providerPopoverOpen}
        providers={sortedProviders}
        secretDraft={state.secretDraft}
        selectedProvider={selectedProvider}
        selectedProviderId={selectedProvider?.id ?? ""}
        settingsPopoverOpen={state.settingsPopoverOpen}
        status={status}
        onContextToggle={(key, value) =>
          dispatch({ type: "setContext", key, value })
        }
        onDisplayPrefChange={(key, value) =>
          dispatch({ type: "setDisplayPref", key, value })
        }
        onNewChat={handleNewChat}
        onRefreshProviders={handleRefreshProviders}
        onRefreshRuntime={refreshRuntime}
        onSaveSecret={handleSaveSecret}
        onSecretChange={(value) => dispatch({ type: "setSecretDraft", value })}
        onSelectProvider={handleProviderSelect}
        onTestProvider={handleTestProvider}
        onToggleProviderPopover={() =>
          dispatch({ type: "toggleProviderPopover" })
        }
        onToggleSettingsPopover={() =>
          dispatch({ type: "toggleSettingsPopover" })
        }
      />

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
                active={envelope.id === (state.activeRunId || activeRunId)}
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
          activeRun?.response ?? streamingTextByRunId[activeRunKey] ?? ""
        }
        contextPreview={contextPreview}
        egressRecords={egressRecords}
        selectedProvider={selectedProvider}
        selectedProviderReady={selectedProviderReady}
        visible={
          state.displayPrefs.showActivity &&
          (presentation === "fullscreen" || transcriptRuns.length > 0)
        }
      />

      <ChatComposer
        canSend={canSend}
        disabledReason={disabledReason}
        input={state.input}
        running={activeRunRunning}
        selectedAction={state.selectedAction}
        onActionChange={(action) => dispatch({ type: "setAction", action })}
        onCancel={handleCancel}
        onInputChange={(input) => dispatch({ type: "setInput", input })}
        onRefreshContext={handleRefreshContext}
        onSend={handleSend}
      />

      <div className="ai-chat-footer-status">
        <span
          className={`ai-chat-status-dot is-${selectedProviderReady ? "ready" : "warning"}`}
        />
        <span>
          {selectedProviderReady
            ? `${selectedProvider?.name ?? "Local provider"} connected`
            : readyLocalProviders.length === 0
              ? "Ready local provider required"
              : providerDisabledReason}
        </span>
      </div>
    </section>
  );
}
