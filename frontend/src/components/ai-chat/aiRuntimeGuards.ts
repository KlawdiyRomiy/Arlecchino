import {
  AIApprovalPolicy,
  AIConsentPolicy,
  AIContextSnapshot,
  AIEmbeddingStatus,
  AIStatus,
  type AIAgentProfileDescriptor,
  type AIChatActionDescriptor,
  type AIChatRunArtifact,
  type AIChatRunEnvelope,
  type AIContextProviderDescriptor,
  type AIEgressRecord,
  type AIMnemonicEntry,
  type AIModelCapabilityDescriptor,
  type AIPendingApproval,
  type AIPromptWorkflowDescriptor,
  type AIToolAuditRecord,
  type AIToolDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type { AIProviderRuntimeDescriptor } from "../../wails/app";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toArray = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value.filter(Boolean) as T[]) : [];

export const defaultAIStatus = (): AIStatus =>
  new AIStatus({
    enabled: true,
    mnemonicEnabled: false,
    providers: [],
    settingsConfigured: false,
  });

export const defaultAIConsentPolicy = (): AIConsentPolicy =>
  new AIConsentPolicy({
    localProvidersAccepted: false,
    remoteProvidersAccepted: false,
    frontierProvidersAccepted: false,
    externalAgentCliAccepted: false,
    providerPolicies: [],
  });

export const defaultAIApprovalPolicy = (): AIApprovalPolicy =>
  new AIApprovalPolicy({
    mode: "ask_each_time",
    allowedToolKinds: [],
    hardDenyCategories: [],
  } as Partial<AIApprovalPolicy>);

export const defaultAIEmbeddingStatus = (): AIEmbeddingStatus =>
  new AIEmbeddingStatus({
    status: "unknown",
    reason: "Embedding runtime has not reported status yet.",
    providers: [],
    updatedAt: "",
  });

export const normalizeAIStatus = (value: unknown): AIStatus => {
  const source = isRecord(value) ? value : {};
  return new AIStatus({
    ...source,
    enabled:
      typeof source.enabled === "boolean"
        ? source.enabled
        : defaultAIStatus().enabled,
    mnemonicEnabled:
      typeof source.mnemonicEnabled === "boolean"
        ? source.mnemonicEnabled
        : false,
    providers: toArray<AIProviderDescriptor>(source.providers),
    settingsConfigured:
      typeof source.settingsConfigured === "boolean"
        ? source.settingsConfigured
        : false,
  } as Partial<AIStatus>);
};

export const normalizeAIConsentPolicy = (
  value: unknown,
): AIConsentPolicy | null => {
  if (!isRecord(value)) return null;
  return new AIConsentPolicy({
    ...value,
    providerPolicies: toArray(value.providerPolicies),
  } as Partial<AIConsentPolicy>);
};

export const normalizeAIApprovalPolicy = (
  value: unknown,
): AIApprovalPolicy | null => {
  if (!isRecord(value)) return null;
  return new AIApprovalPolicy({
    ...value,
    allowedToolKinds: toArray(value.allowedToolKinds),
    hardDenyCategories: toArray(value.hardDenyCategories),
  } as Partial<AIApprovalPolicy>);
};

export const normalizeAIEmbeddingStatus = (
  value: unknown,
): AIEmbeddingStatus | null => {
  if (!isRecord(value)) return null;
  return new AIEmbeddingStatus({
    ...value,
    providers: toArray(value.providers),
  } as Partial<AIEmbeddingStatus>);
};

export const normalizeAIContextSnapshot = (
  value: unknown,
): AIContextSnapshot | null => {
  if (!isRecord(value)) return null;
  return new AIContextSnapshot({
    ...value,
    snippets: toArray(value.snippets),
    contextItems: toArray(value.contextItems),
    dataCategories: toArray(value.dataCategories),
  } as Partial<AIContextSnapshot>);
};

export const normalizeArray = <T>(value: unknown): T[] => toArray<T>(value);

export const normalizeAIChatRuns = (value: unknown): AIChatRunEnvelope[] =>
  toArray<AIChatRunEnvelope>(value);

export const normalizeAIChatArtifacts = (value: unknown): AIChatRunArtifact[] =>
  toArray<AIChatRunArtifact>(value);

export const normalizeAIChatActions = (
  value: unknown,
): AIChatActionDescriptor[] => toArray<AIChatActionDescriptor>(value);

export const normalizeAIContextProviders = (
  value: unknown,
): AIContextProviderDescriptor[] => toArray<AIContextProviderDescriptor>(value);

export const normalizeAIEgressRecords = (value: unknown): AIEgressRecord[] =>
  toArray<AIEgressRecord>(value);

export const normalizeAIAgentProfiles = (
  value: unknown,
): AIAgentProfileDescriptor[] => toArray<AIAgentProfileDescriptor>(value);

export const normalizeAIPromptWorkflows = (
  value: unknown,
): AIPromptWorkflowDescriptor[] => toArray<AIPromptWorkflowDescriptor>(value);

export const normalizeAITools = (value: unknown): AIToolDescriptor[] =>
  toArray<AIToolDescriptor>(value);

export const normalizeAIToolAudit = (value: unknown): AIToolAuditRecord[] =>
  toArray<AIToolAuditRecord>(value);

export const normalizeAIModelCapabilities = (
  value: unknown,
): AIModelCapabilityDescriptor[] => toArray<AIModelCapabilityDescriptor>(value);

export const normalizeAIPendingApprovals = (
  value: unknown,
): AIPendingApproval[] => toArray<AIPendingApproval>(value);

export const normalizeAIMnemonicEntries = (value: unknown): AIMnemonicEntry[] =>
  toArray<AIMnemonicEntry>(value);

export const normalizeAIProviderRuntimes = (
  value: unknown,
): AIProviderRuntimeDescriptor[] => toArray<AIProviderRuntimeDescriptor>(value);
