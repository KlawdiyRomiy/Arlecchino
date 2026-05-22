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
  AIPromptWorkflowDescriptor,
  AIProviderDescriptor,
  AIStatus,
  AIToolAuditRecord,
  AIToolDescriptor,
} from "../../bindings/arlecchino/internal/ai/models";

interface AIChatRuntimeState {
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
  egressRecords: AIEgressRecord[];
  mnemonicEntries: AIMnemonicEntry[];
  approvalPolicy: AIApprovalPolicy | null;
  consentPolicy: AIConsentPolicy | null;
  embeddingStatus: AIEmbeddingStatus | null;
  activeRunId: string | null;
  contextPreview: AIContextSnapshot | null;
  loading: boolean;
  error: string | null;
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
  deleteSessionRuns: (sessionId: string) => void;
  setHydratedRun: (run: AIChatRun) => void;
  upsertHydratedRun: (run: AIChatRun) => void;
  upsertHydratedRuns: (runs: AIChatRun[]) => void;
  appendRunToken: (runId: string, token: string) => void;
  setActiveRunId: (runId: string | null) => void;
  setContextPreview: (preview: AIContextSnapshot | null) => void;
  setEgressRecords: (records: AIEgressRecord[]) => void;
  upsertEgressRecord: (record: AIEgressRecord) => void;
  setMnemonicEntries: (entries: AIMnemonicEntry[]) => void;
  setApprovalPolicy: (policy: AIApprovalPolicy | null) => void;
  setConsentPolicy: (policy: AIConsentPolicy | null) => void;
  setEmbeddingStatus: (status: AIEmbeddingStatus | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearRuntime: () => void;
}

const sortRuns = (runs: AIChatRunEnvelope[]): AIChatRunEnvelope[] =>
  [...runs].sort((a, b) => {
    const left = Date.parse(b.updatedAt || b.createdAt || "");
    const right = Date.parse(a.updatedAt || a.createdAt || "");
    return (
      (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0)
    );
  });

const isTerminalRunStatus = (status?: string): boolean =>
  status === "completed" || status === "error" || status === "canceled";

const sessionIdOf = (run: Pick<AIChatRunEnvelope, "sessionId">): string =>
  run.sessionId?.trim() || "default";

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
  return sortRuns(next);
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
  state: Pick<AIChatRuntimeState, "hydratedRuns" | "streamingTextByRunId">,
  runs: AIChatRun[],
) => {
  const hydratedRuns = { ...state.hydratedRuns };
  const streamingTextByRunId = { ...state.streamingTextByRunId };
  for (const run of runs) {
    if (!run?.id) continue;
    const existingStream = streamingTextByRunId[run.id] ?? "";
    const response = run.response ?? "";
    const streamingText =
      isTerminalRunStatus(run.status) || response.length > existingStream.length
        ? response
        : existingStream;
    hydratedRuns[run.id] = run;
    streamingTextByRunId[run.id] = streamingText;
  }
  return { hydratedRuns, streamingTextByRunId };
};

const initialRuntimeState = {
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
  egressRecords: [],
  mnemonicEntries: [],
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
  setInitialData: (data) =>
    set((state) => ({
      ...state,
      ...data,
      runs: data.runs ? sortRuns(data.runs) : state.runs,
    })),
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
  setRuns: (runs) => set({ runs: sortRuns(runs) }),
  upsertRunEnvelope: (run) =>
    set((state) => ({
      runs: mergeRunEnvelope(state.runs, run),
      activeRunId: state.activeRunId ?? run.id,
    })),
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
      return changed ? { runs } : state;
    }),
  deleteSessionRuns: (sessionId) =>
    set((state) => {
      const normalizedSessionId = sessionId.trim() || "default";
      const removedRunIds = new Set(
        state.runs
          .filter((run) => sessionIdOf(run) === normalizedSessionId)
          .map((run) => run.id),
      );
      if (removedRunIds.size === 0) {
        return state;
      }
      const hydratedRuns = { ...state.hydratedRuns };
      const streamingTextByRunId = { ...state.streamingTextByRunId };
      for (const runId of removedRunIds) {
        delete hydratedRuns[runId];
        delete streamingTextByRunId[runId];
      }
      return {
        runs: state.runs.filter(
          (run) => sessionIdOf(run) !== normalizedSessionId,
        ),
        hydratedRuns,
        streamingTextByRunId,
        activeRunId:
          state.activeRunId && removedRunIds.has(state.activeRunId)
            ? null
            : state.activeRunId,
      };
    }),
  setHydratedRun: (run) =>
    set((state) => {
      const merged = mergeHydratedRunState(state, [run]);
      return {
        ...merged,
        activeRunId: state.activeRunId ?? run.id,
      };
    }),
  upsertHydratedRun: (run) =>
    set((state) => mergeHydratedRunState(state, [run])),
  upsertHydratedRuns: (runs) =>
    set((state) => mergeHydratedRunState(state, runs)),
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
          [runId]: `${state.streamingTextByRunId[runId] ?? ""}${token}`,
        },
      };
    }),
  setActiveRunId: (activeRunId) => set({ activeRunId }),
  setContextPreview: (contextPreview) => set({ contextPreview }),
  setEgressRecords: (egressRecords) => set({ egressRecords }),
  upsertEgressRecord: (record) =>
    set((state) => ({
      egressRecords: mergeEgressRecord(state.egressRecords, record),
    })),
  setMnemonicEntries: (mnemonicEntries) => set({ mnemonicEntries }),
  setApprovalPolicy: (approvalPolicy) => set({ approvalPolicy }),
  setConsentPolicy: (consentPolicy) => set({ consentPolicy }),
  setEmbeddingStatus: (embeddingStatus) => set({ embeddingStatus }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearRuntime: () => set({ ...initialRuntimeState }),
}));

export type { AIChatAction };
