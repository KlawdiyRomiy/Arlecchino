import { create } from "zustand";

import type {
  AIChatAction,
  AIChatActionDescriptor,
  AIChatRun,
  AIChatRunEnvelope,
  AIRunTimelineEvent,
  AIAgentProfileDescriptor,
  AIApprovalPolicy,
  AIConsentPolicy,
  AIContextProviderDescriptor,
  AIContextSnapshot,
  AIEmbeddingStatus,
  AIEgressRecord,
  AIMnemonicEntry,
  AIPendingApproval,
  AIPromptWorkflowDescriptor,
  AIProviderDescriptor,
  AIStatus,
  AIToolAuditRecord,
  AIToolDescriptor,
} from "../../bindings/arlecchino/internal/ai/models";
import {
  createAIChatCommandIntent,
  type AIChatCommandIntent,
  type AICommandPaletteActionId,
  type AICommandPalettePayload,
} from "../utils/commandPaletteAI";
import { normalizeProjectPathIdentity } from "../utils/projectPaths";

interface AIChatRuntimeState {
  projectScopeKey: string;
  status: AIStatus | null;
  providers: AIProviderDescriptor[];
  actions: AIChatActionDescriptor[];
  agentProfiles: AIAgentProfileDescriptor[];
  promptWorkflows: AIPromptWorkflowDescriptor[];
  tools: AIToolDescriptor[];
  toolAudit: AIToolAuditRecord[];
  contextProviders: AIContextProviderDescriptor[];
  runs: AIChatRunEnvelope[];
  hydratedRuns: Record<string, AIChatRun>;
  streamingTextByRunId: Record<string, string>;
  streamResetRevisionByRunId: Record<string, number>;
  egressRecords: AIEgressRecord[];
  mnemonicEntries: AIMnemonicEntry[];
  pendingApprovals: AIPendingApproval[];
  commandIntents: AIChatCommandIntent[];
  approvalPolicy: AIApprovalPolicy | null;
  consentPolicy: AIConsentPolicy | null;
  embeddingStatus: AIEmbeddingStatus | null;
  activeRunId: string | null;
  contextPreview: AIContextSnapshot | null;
  loading: boolean;
  error: string | null;
  setProjectScopeKey: (scopeKey: string) => void;
  setInitialData: (data: Partial<AIChatRuntimeState>) => void;
  setStatus: (status: AIStatus | null) => void;
  setProviders: (providers: AIProviderDescriptor[]) => void;
  upsertProvider: (provider: AIProviderDescriptor) => void;
  setActions: (actions: AIChatActionDescriptor[]) => void;
  setAgentProfiles: (profiles: AIAgentProfileDescriptor[]) => void;
  setPromptWorkflows: (workflows: AIPromptWorkflowDescriptor[]) => void;
  setTools: (tools: AIToolDescriptor[]) => void;
  setToolAudit: (records: AIToolAuditRecord[]) => void;
  upsertToolAudit: (record: AIToolAuditRecord) => void;
  setContextProviders: (providers: AIContextProviderDescriptor[]) => void;
  setRuns: (runs: AIChatRunEnvelope[]) => void;
  upsertRunEnvelope: (run: AIChatRunEnvelope) => void;
  appendRunTimelineEvent: (event: AIRunTimelineEvent) => void;
  deleteSessionRuns: (sessionId: string, projectSessionId?: string) => void;
  clearProjectChatState: () => void;
  setHydratedRun: (run: AIChatRun) => void;
  upsertHydratedRun: (run: AIChatRun) => void;
  upsertHydratedRuns: (runs: AIChatRun[]) => void;
  appendRunToken: (runId: string, token: string) => void;
  resetRunStream: (runId: string, revision?: number) => void;
  setActiveRunId: (runId: string | null) => void;
  setContextPreview: (preview: AIContextSnapshot | null) => void;
  setEgressRecords: (records: AIEgressRecord[]) => void;
  upsertEgressRecord: (record: AIEgressRecord) => void;
  setMnemonicEntries: (entries: AIMnemonicEntry[]) => void;
  setPendingApprovals: (approvals: AIPendingApproval[]) => void;
  enqueueCommandIntent: (
    actionId: AICommandPaletteActionId,
    payload?: AICommandPalettePayload,
    projectScopeKey?: string,
  ) => void;
  consumeCommandIntent: (id: string) => void;
  setApprovalPolicy: (policy: AIApprovalPolicy | null) => void;
  setConsentPolicy: (policy: AIConsentPolicy | null) => void;
  setEmbeddingStatus: (status: AIEmbeddingStatus | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearRuntime: () => void;
}

const AI_CHAT_MAX_RUNS = 80;
const AI_CHAT_MAX_HYDRATED_RUNS = 20;
const AI_CHAT_MAX_STREAMING_TEXT_CHARS = 96_000;
const AI_CHAT_MAX_HYDRATED_RESPONSE_CHARS = 96_000;
const DEFAULT_AI_CHAT_PROJECT_SESSION_ID = "main";

export const aiChatProjectScopeKey = (
  projectSessionId: string,
  projectPath: string,
): string => {
  const sessionKey =
    projectSessionId.trim() || DEFAULT_AI_CHAT_PROJECT_SESSION_ID;
  const pathKey =
    normalizeProjectPathIdentity(projectPath || "") || "no-project";
  return `${sessionKey}\0${pathKey}`;
};

const sortRuns = (runs: AIChatRunEnvelope[]): AIChatRunEnvelope[] =>
  [...runs].sort((a, b) => {
    const left = Date.parse(b.updatedAt || b.createdAt || "");
    const right = Date.parse(a.updatedAt || a.createdAt || "");
    return (
      (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)
    );
  });

const isTerminalRunStatus = (status?: string): boolean =>
  status === "completed" ||
  status === "error" ||
  status === "canceled" ||
  status === "blocked";

const sessionIdOf = (run: { sessionId?: string | null }): string =>
  run.sessionId?.trim() || "default";

const projectSessionIdOf = (run: {
  projectSessionId?: string | null;
}): string => run.projectSessionId?.trim() || "main";

const matchesProjectSession = (
  run: { projectSessionId?: string | null },
  projectSessionId?: string,
): boolean => {
  const normalized = projectSessionId?.trim();
  return !normalized || projectSessionIdOf(run) === normalized;
};

const trimAIChatText = (text: string, maxChars: number): string =>
  text.length > maxChars ? text.slice(-maxChars) : text;

const runRevision = (revision?: number | null): number =>
  typeof revision === "number" && Number.isFinite(revision)
    ? Math.max(0, revision)
    : 0;

const optionalRunRevision = (revision?: number | null): number | undefined =>
  typeof revision === "number" && Number.isFinite(revision) && revision >= 0
    ? revision
    : undefined;

const trimHydratedRunPayload = (run: AIChatRun): AIChatRun => {
  if (
    typeof run.response !== "string" ||
    run.response.length <= AI_CHAT_MAX_HYDRATED_RESPONSE_CHARS
  ) {
    return run;
  }
  return {
    ...run,
    response: trimAIChatText(run.response, AI_CHAT_MAX_HYDRATED_RESPONSE_CHARS),
  };
};

const mergeToolProposals = (
  existing: AIChatRunEnvelope,
  incoming: AIChatRunEnvelope,
): AIChatRunEnvelope["toolProposals"] => {
  if (Array.isArray(incoming.toolProposals)) {
    return incoming.toolProposals;
  }
  if (incoming.toolProposalSummary?.total === 0) {
    return [];
  }
  return existing.toolProposals;
};

const timelineEventKey = (event: AIRunTimelineEvent): string =>
  event.id?.trim() ||
  [
    event.runId,
    event.source,
    event.type,
    event.status,
    event.createdAt,
    event.summary,
  ]
    .filter(Boolean)
    .join(":");

const sortTimelineEvents = (
  events: AIRunTimelineEvent[],
): AIRunTimelineEvent[] =>
  [...events].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt || "");
    const rightTime = Date.parse(right.createdAt || "");
    return (
      (Number.isFinite(leftTime) ? leftTime : 0) -
      (Number.isFinite(rightTime) ? rightTime : 0)
    );
  });

const mergeTimelineEvents = (
  existing: AIRunTimelineEvent[] = [],
  incoming: AIRunTimelineEvent[] = [],
): AIRunTimelineEvent[] => {
  if (existing.length === 0 && incoming.length === 0) return [];
  const byKey = new Map<string, AIRunTimelineEvent>();
  for (const event of [...existing, ...incoming]) {
    const key = timelineEventKey(event);
    if (!key) continue;
    byKey.set(key, event);
  }
  return sortTimelineEvents([...byKey.values()]).slice(-80);
};

const mergeRunEnvelope = (
  runs: AIChatRunEnvelope[],
  run: AIChatRunEnvelope,
): AIChatRunEnvelope[] => {
  const existing = runs.find((candidate) => candidate.id === run.id);
  if (existing) {
    const existingRevision = existing.revision ?? 0;
    const incomingRevision = run.revision ?? 0;
    if (existingRevision > 0 && incomingRevision > 0) {
      if (incomingRevision < existingRevision) return runs;
      if (
        incomingRevision === existingRevision &&
        Date.parse(run.updatedAt || "") < Date.parse(existing.updatedAt || "")
      ) {
        return runs;
      }
    }
  }
  const merged = existing
    ? {
        ...existing,
        ...run,
        providerEnvelope: run.providerEnvelope ?? existing.providerEnvelope,
        egressSummary: Object.prototype.hasOwnProperty.call(
          run,
          "egressSummary",
        )
          ? run.egressSummary
          : existing.egressSummary,
        disclosureSummary:
          run.disclosureSummary?.providerId || run.disclosureSummary?.model
            ? run.disclosureSummary
            : existing.disclosureSummary,
        approvalSummary:
          run.approvalSummary?.mode || run.approvalSummary?.fullAccessActive
            ? run.approvalSummary
            : existing.approvalSummary,
        consentSummary:
          run.consentSummary?.policySource ||
          run.consentSummary?.localProvidersAccepted ||
          run.consentSummary?.remoteProvidersAccepted ||
          run.consentSummary?.frontierProvidersAccepted ||
          run.consentSummary?.externalAgentCliAccepted
            ? run.consentSummary
            : existing.consentSummary,
        toolProposals: mergeToolProposals(existing, run),
        toolProposalSummary:
          run.toolProposalSummary ?? existing.toolProposalSummary,
        timeline: mergeTimelineEvents(
          existing.timeline ?? [],
          run.timeline ?? [],
        ),
        mnemonicInclusion:
          run.mnemonicInclusion !== undefined && run.mnemonicInclusion !== null
            ? run.mnemonicInclusion
            : existing.mnemonicInclusion,
      }
    : run;
  const next = runs.filter((candidate) => candidate.id !== run.id);
  next.unshift(merged as AIChatRunEnvelope);
  return sortRuns(next).slice(0, AI_CHAT_MAX_RUNS);
};

const mergeEgressRecord = (
  records: AIEgressRecord[],
  record: AIEgressRecord,
): AIEgressRecord[] => {
  const next = records.filter((candidate) => candidate.id !== record.id);
  next.unshift(record);
  return next.slice(0, 50);
};

const mergeHydratedRunState = (
  state: Pick<
    AIChatRuntimeState,
    | "hydratedRuns"
    | "runs"
    | "streamingTextByRunId"
    | "streamResetRevisionByRunId"
  >,
  runs: AIChatRun[],
) => {
  const hydratedRuns = { ...state.hydratedRuns };
  const streamingTextByRunId = { ...state.streamingTextByRunId };
  for (const run of runs) {
    if (!run?.id) continue;
    const incomingRevision = runRevision(run.revision);
    const hydratedRevision = runRevision(state.hydratedRuns[run.id]?.revision);
    const envelopeRevision = runRevision(
      state.runs.find((candidate) => candidate.id === run.id)?.revision,
    );
    const resetRevision = runRevision(state.streamResetRevisionByRunId[run.id]);
    if (
      incomingRevision < resetRevision ||
      incomingRevision < Math.max(hydratedRevision, envelopeRevision)
    ) {
      continue;
    }
    const existingStream = streamingTextByRunId[run.id] ?? "";
    const response = run.response ?? "";
    const streamingText = isTerminalRunStatus(run.status)
      ? response
      : response.length >= existingStream.length
        ? response
        : existingStream;
    hydratedRuns[run.id] = trimHydratedRunPayload(run);
    streamingTextByRunId[run.id] = trimAIChatText(
      streamingText,
      AI_CHAT_MAX_STREAMING_TEXT_CHARS,
    );
  }
  return { hydratedRuns, streamingTextByRunId };
};

type AIChatRetentionState = Pick<
  AIChatRuntimeState,
  | "activeRunId"
  | "hydratedRuns"
  | "runs"
  | "streamingTextByRunId"
  | "streamResetRevisionByRunId"
>;

const pruneAIChatRetention = <State extends AIChatRetentionState>(
  state: State,
): State => {
  const runs = sortRuns(state.runs).slice(0, AI_CHAT_MAX_RUNS);
  const retainedRunIds = new Set(runs.map((run) => run.id));
  const activeRunHasPayload = Boolean(
    state.activeRunId &&
    (state.hydratedRuns[state.activeRunId] ||
      state.streamingTextByRunId[state.activeRunId]),
  );
  if (state.activeRunId && activeRunHasPayload) {
    retainedRunIds.add(state.activeRunId);
  }

  const runPriority = new Map<string, number>();
  runs.forEach((run, index) => {
    runPriority.set(run.id, index);
  });
  if (state.activeRunId) {
    runPriority.set(state.activeRunId, -1);
  }

  const hydratedRunIds = Object.keys(state.hydratedRuns)
    .sort((left, right) => {
      const priority =
        (runPriority.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (runPriority.get(right) ?? Number.MAX_SAFE_INTEGER);
      if (priority !== 0) return priority;
      const leftRun = state.hydratedRuns[left];
      const rightRun = state.hydratedRuns[right];
      const leftTime = Date.parse(
        leftRun?.updatedAt || leftRun?.createdAt || "",
      );
      const rightTime = Date.parse(
        rightRun?.updatedAt || rightRun?.createdAt || "",
      );
      return (
        (Number.isFinite(rightTime) ? rightTime : 0) -
        (Number.isFinite(leftTime) ? leftTime : 0)
      );
    })
    .slice(0, AI_CHAT_MAX_HYDRATED_RUNS);

  const hydratedRunSet = new Set(hydratedRunIds);
  const hydratedRuns: Record<string, AIChatRun> = {};
  for (const runId of hydratedRunIds) {
    hydratedRuns[runId] = trimHydratedRunPayload(state.hydratedRuns[runId]);
  }

  const streamingTextByRunId: Record<string, string> = {};
  for (const [runId, text] of Object.entries(state.streamingTextByRunId)) {
    if (!retainedRunIds.has(runId) && !hydratedRunSet.has(runId)) {
      continue;
    }
    streamingTextByRunId[runId] = trimAIChatText(
      text,
      AI_CHAT_MAX_STREAMING_TEXT_CHARS,
    );
  }

  const streamResetRevisionByRunId: Record<string, number> = {};
  for (const [runId, revision] of Object.entries(
    state.streamResetRevisionByRunId,
  )) {
    if (!retainedRunIds.has(runId) && !hydratedRunSet.has(runId)) {
      continue;
    }
    streamResetRevisionByRunId[runId] = revision;
  }

  return {
    ...state,
    runs,
    hydratedRuns,
    streamingTextByRunId,
    streamResetRevisionByRunId,
    activeRunId:
      state.activeRunId &&
      (runs.some((run) => run.id === state.activeRunId) || activeRunHasPayload)
        ? state.activeRunId
        : (runs[0]?.id ?? null),
  };
};

const initialRuntimeState = {
  projectScopeKey: "",
  status: null,
  providers: [],
  actions: [],
  agentProfiles: [],
  promptWorkflows: [],
  tools: [],
  toolAudit: [],
  contextProviders: [],
  runs: [],
  hydratedRuns: {},
  streamingTextByRunId: {},
  streamResetRevisionByRunId: {},
  egressRecords: [],
  mnemonicEntries: [],
  pendingApprovals: [],
  commandIntents: [],
  approvalPolicy: null,
  consentPolicy: null,
  embeddingStatus: null,
  activeRunId: null,
  contextPreview: null,
  loading: false,
  error: null,
};

export const useAIChatStore = create<AIChatRuntimeState>()((set) => ({
  ...initialRuntimeState,
  setProjectScopeKey: (scopeKey) =>
    set((state) => {
      const nextScopeKey = scopeKey.trim();
      if (state.projectScopeKey === nextScopeKey) {
        return state;
      }
      return {
        ...state,
        projectScopeKey: nextScopeKey,
        runs: [],
        hydratedRuns: {},
        streamingTextByRunId: {},
        streamResetRevisionByRunId: {},
        egressRecords: [],
        mnemonicEntries: [],
        pendingApprovals: [],
        commandIntents: state.commandIntents.filter(
          (intent) => intent.projectScopeKey === nextScopeKey,
        ),
        toolAudit: [],
        activeRunId: null,
        contextPreview: null,
        error: null,
      };
    }),
  setInitialData: (data) =>
    set((state) =>
      pruneAIChatRetention({
        ...state,
        ...data,
        runs: data.runs ? sortRuns(data.runs) : state.runs,
      }),
    ),
  setStatus: (status) => set({ status }),
  setProviders: (providers) => set({ providers }),
  upsertProvider: (provider) =>
    set((state) => {
      const providers = state.providers.filter(
        (candidate) => candidate.id !== provider.id,
      );
      providers.push(provider);
      return { providers };
    }),
  setActions: (actions) => set({ actions }),
  setAgentProfiles: (agentProfiles) => set({ agentProfiles }),
  setPromptWorkflows: (promptWorkflows) => set({ promptWorkflows }),
  setTools: (tools) => set({ tools }),
  setToolAudit: (toolAudit) => set({ toolAudit }),
  upsertToolAudit: (record) =>
    set((state) => ({
      toolAudit: [
        record,
        ...state.toolAudit.filter((candidate) => candidate.id !== record.id),
      ].slice(0, 50),
    })),
  setContextProviders: (contextProviders) => set({ contextProviders }),
  setRuns: (runs) =>
    set((state) => pruneAIChatRetention({ ...state, runs: sortRuns(runs) })),
  upsertRunEnvelope: (run) =>
    set((state) =>
      pruneAIChatRetention({
        ...state,
        runs: mergeRunEnvelope(state.runs, run),
        activeRunId: state.activeRunId ?? run.id,
      }),
    ),
  appendRunTimelineEvent: (event) =>
    set((state) => {
      const runId = event?.runId?.trim();
      if (!runId) return state;
      let changed = false;
      const runs = state.runs.map((run) => {
        if (run.id !== runId) return run;
        changed = true;
        return {
          ...run,
          timeline: mergeTimelineEvents(run.timeline ?? [], [event]),
        };
      });
      return changed ? pruneAIChatRetention({ ...state, runs }) : state;
    }),
  deleteSessionRuns: (sessionId, projectSessionId) =>
    set((state) => {
      const normalizedSessionId = sessionId.trim() || "default";
      const removedRunIds = new Set<string>();
      for (const run of state.runs) {
        if (
          sessionIdOf(run) === normalizedSessionId &&
          matchesProjectSession(run, projectSessionId)
        ) {
          removedRunIds.add(run.id);
        }
      }
      for (const [runId, run] of Object.entries(state.hydratedRuns)) {
        if (
          sessionIdOf(run) === normalizedSessionId &&
          matchesProjectSession(run, projectSessionId)
        ) {
          removedRunIds.add(runId);
        }
      }
      if (state.activeRunId) {
        const activeEnvelope = state.runs.find(
          (run) => run.id === state.activeRunId,
        );
        const activeHydrated = state.hydratedRuns[state.activeRunId];
        if (
          (activeEnvelope &&
            sessionIdOf(activeEnvelope) === normalizedSessionId &&
            matchesProjectSession(activeEnvelope, projectSessionId)) ||
          (activeHydrated &&
            sessionIdOf(activeHydrated) === normalizedSessionId &&
            matchesProjectSession(activeHydrated, projectSessionId))
        ) {
          removedRunIds.add(state.activeRunId);
        }
      }
      if (removedRunIds.size === 0) {
        return state;
      }
      const hydratedRuns = { ...state.hydratedRuns };
      const streamingTextByRunId = { ...state.streamingTextByRunId };
      const streamResetRevisionByRunId = {
        ...state.streamResetRevisionByRunId,
      };
      for (const runId of removedRunIds) {
        delete hydratedRuns[runId];
        delete streamingTextByRunId[runId];
        delete streamResetRevisionByRunId[runId];
      }
      return pruneAIChatRetention({
        ...state,
        runs: state.runs.filter(
          (run) =>
            sessionIdOf(run) !== normalizedSessionId ||
            !matchesProjectSession(run, projectSessionId),
        ),
        hydratedRuns,
        streamingTextByRunId,
        streamResetRevisionByRunId,
        activeRunId:
          state.activeRunId && removedRunIds.has(state.activeRunId)
            ? null
            : state.activeRunId,
      });
    }),
  clearProjectChatState: () =>
    set({
      runs: [],
      hydratedRuns: {},
      streamingTextByRunId: {},
      streamResetRevisionByRunId: {},
      egressRecords: [],
      mnemonicEntries: [],
      pendingApprovals: [],
      toolAudit: [],
      activeRunId: null,
      contextPreview: null,
    }),
  setHydratedRun: (run) =>
    set((state) => {
      const merged = mergeHydratedRunState(state, [run]);
      return pruneAIChatRetention({
        ...state,
        ...merged,
        activeRunId: state.activeRunId ?? run.id,
      });
    }),
  upsertHydratedRun: (run) =>
    set((state) =>
      pruneAIChatRetention({
        ...state,
        ...mergeHydratedRunState(state, [run]),
      }),
    ),
  upsertHydratedRuns: (runs) =>
    set((state) =>
      pruneAIChatRetention({
        ...state,
        ...mergeHydratedRunState(state, runs),
      }),
    ),
  appendRunToken: (runId, token) =>
    set((state) => {
      const envelope = state.runs.find((run) => run.id === runId);
      const hydrated = state.hydratedRuns[runId];
      if (
        isTerminalRunStatus(envelope?.status) ||
        isTerminalRunStatus(hydrated?.status)
      ) {
        return state;
      }
      return {
        streamingTextByRunId: {
          ...state.streamingTextByRunId,
          [runId]: trimAIChatText(
            `${state.streamingTextByRunId[runId] ?? ""}${token}`,
            AI_CHAT_MAX_STREAMING_TEXT_CHARS,
          ),
        },
      };
    }),
  resetRunStream: (runId, revision) =>
    set((state) => {
      const envelope = state.runs.find((run) => run.id === runId);
      const hydrated = state.hydratedRuns[runId];
      const incomingRevision = optionalRunRevision(revision);
      const knownRevision = Math.max(
        runRevision(envelope?.revision),
        runRevision(hydrated?.revision),
        runRevision(state.streamResetRevisionByRunId[runId]),
      );
      if (incomingRevision !== undefined && incomingRevision < knownRevision) {
        return state;
      }
      const terminalState =
        isTerminalRunStatus(envelope?.status) ||
        isTerminalRunStatus(hydrated?.status);
      if (
        terminalState &&
        (incomingRevision === undefined || incomingRevision <= knownRevision)
      ) {
        return state;
      }
      const nextResetRevision = Math.max(
        runRevision(state.streamResetRevisionByRunId[runId]),
        incomingRevision ?? 0,
      );
      const markerUnchanged =
        nextResetRevision ===
        runRevision(state.streamResetRevisionByRunId[runId]);
      if (
        !state.streamingTextByRunId[runId] &&
        !hydrated?.response &&
        markerUnchanged
      ) {
        return state;
      }
      const streamingTextByRunId = {
        ...state.streamingTextByRunId,
        [runId]: "",
      };
      const streamResetRevisionByRunId = {
        ...state.streamResetRevisionByRunId,
        [runId]: nextResetRevision,
      };
      if (!hydrated?.response) {
        return { streamingTextByRunId, streamResetRevisionByRunId };
      }
      return {
        streamingTextByRunId,
        streamResetRevisionByRunId,
        hydratedRuns: {
          ...state.hydratedRuns,
          [runId]: { ...hydrated, response: "" },
        },
      };
    }),
  setActiveRunId: (activeRunId) =>
    set((state) => {
      if (!state.activeRunId || state.activeRunId === activeRunId) {
        return pruneAIChatRetention({ ...state, activeRunId });
      }
      if (state.runs.some((run) => run.id === state.activeRunId)) {
        return pruneAIChatRetention({ ...state, activeRunId });
      }
      const hydratedRuns = { ...state.hydratedRuns };
      const streamingTextByRunId = { ...state.streamingTextByRunId };
      const streamResetRevisionByRunId = {
        ...state.streamResetRevisionByRunId,
      };
      delete hydratedRuns[state.activeRunId];
      delete streamingTextByRunId[state.activeRunId];
      delete streamResetRevisionByRunId[state.activeRunId];
      return pruneAIChatRetention({
        ...state,
        activeRunId,
        hydratedRuns,
        streamingTextByRunId,
        streamResetRevisionByRunId,
      });
    }),
  setContextPreview: (contextPreview) => set({ contextPreview }),
  setEgressRecords: (egressRecords) => set({ egressRecords }),
  upsertEgressRecord: (record) =>
    set((state) => ({
      egressRecords: mergeEgressRecord(state.egressRecords, record),
    })),
  setMnemonicEntries: (mnemonicEntries) => set({ mnemonicEntries }),
  setPendingApprovals: (pendingApprovals) => set({ pendingApprovals }),
  enqueueCommandIntent: (actionId, payload = {}, projectScopeKey = "") =>
    set((state) => ({
      commandIntents: [
        ...state.commandIntents,
        createAIChatCommandIntent(actionId, payload, projectScopeKey),
      ].slice(-8),
    })),
  consumeCommandIntent: (id) =>
    set((state) => ({
      commandIntents: state.commandIntents.filter((intent) => intent.id !== id),
    })),
  setApprovalPolicy: (approvalPolicy) => set({ approvalPolicy }),
  setConsentPolicy: (consentPolicy) => set({ consentPolicy }),
  setEmbeddingStatus: (embeddingStatus) => set({ embeddingStatus }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearRuntime: () => set({ ...initialRuntimeState }),
}));

export type { AIChatAction };
