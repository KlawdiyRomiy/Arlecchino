import type {
  AIApprovalPolicy,
  AIChatRun,
  AIChatRunArtifact,
  AIChatRunEnvelope,
  AIConsentPolicy,
  AIContextSnapshot,
  AIEmbeddingStatus,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import {
  memoryArtifactActivityLabel,
  runActivityLabel,
} from "./aiChatPresentation";
import { getProviderPresentation } from "./providerPresentation";

export type ActivityStatusState = "done" | "active" | "idle" | "error";

export interface ActivityStatusItem {
  key: string;
  state: ActivityStatusState;
  label: string;
}

export interface ActivityStatusData {
  selectedProvider: AIProviderDescriptor | null;
  selectedProviderReady: boolean;
  contextPreview: AIContextSnapshot | null;
  activeEnvelope: AIChatRunEnvelope | null;
  artifacts: AIChatRunArtifact[];
  activeRun: AIChatRun | null;
  activeRunText: string;
  approvalPolicy: AIApprovalPolicy | null;
  consentPolicy: AIConsentPolicy | null;
  embeddingStatus: AIEmbeddingStatus | null;
  workflowCount: number;
  artifactBusyId?: string | null;
  mnemonicBusy?: boolean;
}

export function buildActivityStatusItems({
  selectedProvider,
  selectedProviderReady,
  contextPreview,
  activeEnvelope,
  artifacts,
  activeRun,
  activeRunText,
  approvalPolicy,
  consentPolicy,
  embeddingStatus,
  workflowCount,
  artifactBusyId = null,
  mnemonicBusy = false,
}: ActivityStatusData): ActivityStatusItem[] {
  const provider = getProviderPresentation(selectedProvider);
  const runState = activeEnvelope?.status ?? "";
  const completed = runState === "completed";
  const failed = runState === "error" || runState === "canceled";
  const items: ActivityStatusItem[] = [];
  if (!selectedProviderReady) {
    items.push({ key: "provider", state: "idle", label: provider.subtitle });
  }
  if (activeEnvelope) {
    items.push({
      key: "run",
      state: failed
        ? "error"
        : runState === "running"
          ? "active"
          : completed
            ? "done"
            : "idle",
      label: runActivityLabel({
        status: activeEnvelope.status,
        activeText: activeRunText || activeRun?.response || "",
        contextItems:
          activeEnvelope.contextSummary?.contextItems ??
          contextPreview?.contextItems ??
          [],
        timelineEvents: activeEnvelope.timeline ?? [],
        artifacts,
        toolProposalCount: activeEnvelope.toolProposalSummary?.total ?? 0,
        artifactBusyId,
        mnemonicBusy,
      }),
    });
  }
  const contextSummary = activeEnvelope?.contextSummary ?? null;
  const contextItems =
    contextSummary?.contextItems ?? contextPreview?.contextItems ?? [];
  if (contextItems.length > 0) {
    const included = contextItems.filter((item) => item.included).length;
    const redacted = contextItems.some((item) => item.redacted);
    const truncated =
      contextSummary?.redaction?.truncated ||
      contextPreview?.redaction?.truncated;
    items.push({
      key: "context",
      state: included > 0 ? "done" : "idle",
      label: `${included}/${contextItems.length} context item${contextItems.length === 1 ? "" : "s"}${redacted ? ", redacted" : ""}${truncated ? ", truncated" : ""}`,
    });
  }
  if (artifacts.length > 0) {
    items.push({
      key: "artifacts",
      state: completed ? "done" : "active",
      label: `${artifacts.length} audit artifact${artifacts.length === 1 ? "" : "s"}`,
    });
  }
  const memoryArtifacts = artifacts.filter(
    (artifact) => artifact.kind === "memory",
  );
  if (mnemonicBusy) {
    items.push({
      key: "mnemonic-memory",
      state: "active",
      label: "Mnemonic: updating memory",
    });
  } else if (memoryArtifacts.length > 0) {
    const busyMemoryArtifact = memoryArtifacts.find(
      (artifact) => artifact.id === artifactBusyId,
    );
    const latestMemoryArtifact =
      busyMemoryArtifact ??
      [...memoryArtifacts].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
        const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
        return (
          (Number.isFinite(leftTime) ? leftTime : 0) -
          (Number.isFinite(rightTime) ? rightTime : 0)
        );
      })[memoryArtifacts.length - 1];
    const proposedCount = memoryArtifacts.filter(
      (artifact) => artifact.status === "proposed",
    ).length;
    items.push({
      key: "mnemonic-memory",
      state: busyMemoryArtifact
        ? "active"
        : proposedCount > 0
          ? "idle"
          : "done",
      label:
        proposedCount > 1
          ? `Mnemonic: ${proposedCount} memories ready to save`
          : memoryArtifactActivityLabel(latestMemoryArtifact, artifactBusyId),
    });
  }
  const proposalCount = activeEnvelope?.toolProposalSummary?.total ?? 0;
  if (proposalCount > 0) {
    items.push({
      key: "tools",
      state: "idle",
      label: `${proposalCount} tool proposal${proposalCount === 1 ? "" : "s"} awaiting review`,
    });
  }
  if (activeEnvelope?.mnemonicInclusion?.requested) {
    const mnemonic = activeEnvelope.mnemonicInclusion;
    const mnemonicContext = contextItems.find(
      (item) => item.kind === "mnemonic",
    );
    items.push({
      key: "mnemonic",
      state: mnemonic.included ? "done" : "idle",
      label: mnemonic.included
        ? `Mnemonic: ${mnemonic.count} used${mnemonicContext?.reason ? `, ${mnemonicContext.reason}` : ""}`
        : "Mnemonic requested, nothing included",
    });
  }
  if (contextSummary?.continuityCapsuleCount) {
    items.push({
      key: "continuity",
      state: contextSummary.continuityIncluded ? "done" : "idle",
      label: contextSummary.continuityIncluded
        ? `Continuity: ${contextSummary.continuityCapsuleCount} capsule${contextSummary.continuityCapsuleCount === 1 ? "" : "s"} used`
        : "Continuity requested, nothing included",
    });
  }
  if (approvalPolicy?.mode) {
    items.push({
      key: "approval",
      state: approvalPolicy.mode === "full_access" ? "active" : "idle",
      label: `Approval: ${approvalPolicy.mode}`,
    });
  }
  if (!consentPolicy?.localProvidersAccepted && selectedProvider?.local) {
    items.push({ key: "consent", state: "idle", label: "Consent pending" });
  }
  if (embeddingStatus?.status === "error") {
    items.push({ key: "embedding", state: "idle", label: "Embedding error" });
  }
  void activeRun;
  void workflowCount;

  return items;
}

export function summarizeActivityStatus(
  items: ActivityStatusItem[],
  selectedProviderReady: boolean,
): ActivityStatusItem {
  const active = items.find((item) => item.state === "active");
  if (active) return active;

  const attention = items.find((item) =>
    ["provider", "consent", "embedding", "mnemonic-memory", "tools"].includes(
      item.key,
    ),
  );
  if (attention) {
    if (attention.key === "mnemonic-memory" || attention.key === "tools") {
      return attention;
    }
    return { key: "summary", state: "idle", label: "Needs attention" };
  }

  const run = items.find((item) => item.key === "run");
  if (run) return run;

  return {
    key: "summary",
    state: selectedProviderReady ? "done" : "idle",
    label: selectedProviderReady ? "Ready" : "Needs setup",
  };
}
