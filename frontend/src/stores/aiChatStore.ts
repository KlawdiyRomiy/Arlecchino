import { create } from "zustand";

import type {
  AIChatAction,
  AIChatActionDescriptor,
  AIChatRun,
  AIChatRunEnvelope,
  AIContextProviderDescriptor,
  AIContextSnapshot,
  AIEgressRecord,
  AIProviderDescriptor,
  AIStatus,
} from "../../bindings/arlecchino/internal/ai/models";

interface AIChatRuntimeState {
  status: AIStatus | null;
  providers: AIProviderDescriptor[];
  actions: AIChatActionDescriptor[];
  contextProviders: AIContextProviderDescriptor[];
  runs: AIChatRunEnvelope[];
  hydratedRuns: Record<string, AIChatRun>;
  streamingTextByRunId: Record<string, string>;
  egressRecords: AIEgressRecord[];
  activeRunId: string | null;
  contextPreview: AIContextSnapshot | null;
  loading: boolean;
  error: string | null;
  setInitialData: (data: Partial<AIChatRuntimeState>) => void;
  setStatus: (status: AIStatus | null) => void;
  setProviders: (providers: AIProviderDescriptor[]) => void;
  upsertProvider: (provider: AIProviderDescriptor) => void;
  setActions: (actions: AIChatActionDescriptor[]) => void;
  setContextProviders: (providers: AIContextProviderDescriptor[]) => void;
  setRuns: (runs: AIChatRunEnvelope[]) => void;
  upsertRunEnvelope: (run: AIChatRunEnvelope) => void;
  setHydratedRun: (run: AIChatRun) => void;
  appendRunToken: (runId: string, token: string) => void;
  setActiveRunId: (runId: string | null) => void;
  setContextPreview: (preview: AIContextSnapshot | null) => void;
  setEgressRecords: (records: AIEgressRecord[]) => void;
  upsertEgressRecord: (record: AIEgressRecord) => void;
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

const mergeRunEnvelope = (
  runs: AIChatRunEnvelope[],
  run: AIChatRunEnvelope,
): AIChatRunEnvelope[] => {
  const next = runs.filter((candidate) => candidate.id !== run.id);
  next.unshift(run);
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

const initialRuntimeState = {
  status: null,
  providers: [],
  actions: [],
  contextProviders: [],
  runs: [],
  hydratedRuns: {},
  streamingTextByRunId: {},
  egressRecords: [],
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
  setContextProviders: (contextProviders) => set({ contextProviders }),
  setRuns: (runs) => set({ runs: sortRuns(runs) }),
  upsertRunEnvelope: (run) =>
    set((state) => ({
      runs: mergeRunEnvelope(state.runs, run),
      activeRunId: state.activeRunId ?? run.id,
    })),
  setHydratedRun: (run) =>
    set((state) => ({
      hydratedRuns: { ...state.hydratedRuns, [run.id]: run },
      streamingTextByRunId: {
        ...state.streamingTextByRunId,
        [run.id]: run.response ?? state.streamingTextByRunId[run.id] ?? "",
      },
      activeRunId: state.activeRunId ?? run.id,
    })),
  appendRunToken: (runId, token) =>
    set((state) => ({
      streamingTextByRunId: {
        ...state.streamingTextByRunId,
        [runId]: `${state.streamingTextByRunId[runId] ?? ""}${token}`,
      },
    })),
  setActiveRunId: (activeRunId) => set({ activeRunId }),
  setContextPreview: (contextPreview) => set({ contextPreview }),
  setEgressRecords: (egressRecords) => set({ egressRecords }),
  upsertEgressRecord: (record) =>
    set((state) => ({
      egressRecords: mergeEgressRecord(state.egressRecords, record),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearRuntime: () => set({ ...initialRuntimeState }),
}));

export type { AIChatAction };
