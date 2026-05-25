import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Boxes,
  Check,
  ChevronDown,
  FileText,
  Layers,
  ListChecks,
  Paperclip,
  ShieldCheck,
  Send,
  Slash,
  Sparkles,
  Square,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type {
  AIChatActionDescriptor,
  AIChatMentionCandidate,
  AIConsentPolicy,
  AIContextCapsuleSummary,
  AIContextContinuationPlan,
  AIContextSnapshot,
  AIModelCapabilityDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  AIChatAction,
  AIChatMentionKind,
  AIChatMentionOperation,
  AIChatMentionQuery,
  AIChatMentionTrigger,
  type AIChatRun,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type { AIChatSendShortcut } from "../../stores/editorSettingsStore";
import type {
  AIProviderAuthSession,
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import { getActionMeta, modeOrder } from "./aiChatPresentation";
import { MentionPicker } from "./MentionPicker";
import { ModelPicker } from "./ModelPicker";
import { askReadonlyProfileId } from "./types";

interface ChatComposerProps {
  selectedAction: AIChatAction;
  selectedMentions: AIChatMentionCandidate[];
  actions: AIChatActionDescriptor[];
  input: string;
  canSend: boolean;
  running: boolean;
  disabledReason: string;
  sendShortcut: AIChatSendShortcut;
  providers: AIProviderDescriptor[];
  selectedProvider: AIProviderDescriptor | null;
  selectedModel: string;
  selectedReasoningEffort: string;
  agentAuthRun?: AIChatRun | null;
  providerRuntimes: AIProviderRuntimeDescriptor[];
  providerRuntimeBusy: boolean;
  providerRuntimeError: string;
  selectedModelCapability: AIModelCapabilityDescriptor | null;
  consentPolicy: AIConsentPolicy | null;
  contextPreview?: AIContextSnapshot | null;
  continuityPlan?: AIContextContinuationPlan | null;
  continuityCapsules?: AIContextCapsuleSummary[];
  continuityInspectorOpen: boolean;
  continuityBusy: boolean;
  continuityError: string;
  onActionChange: (action: AIChatAction, profileId?: string) => void;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onSelectModel: (modelId: string) => void;
  onSelectReasoningEffort: (reasoningEffort: string) => void;
  onRefreshProviders: () => void;
  onStartAgentLogin: (
    provider: AIProviderDescriptor,
  ) => Promise<AIChatRun | null> | AIChatRun | null | void;
  onCancelAgentLogin?: (runId: string) => Promise<void> | void;
  onStartProviderOAuth?: (
    provider: AIProviderDescriptor,
  ) => Promise<AIProviderAuthSession | null> | AIProviderAuthSession | null;
  onCancelProviderAuth?: (
    sessionId: string,
  ) => Promise<AIProviderAuthSession | null> | AIProviderAuthSession | null;
  onAcceptExternalAgentConsent: () => void;
  onAcceptRemoteBYOKProviderConsent: () => void;
  onAcceptFrontierProviderConsent: () => void;
  onProbeModelCapability: () => void;
  onStartProviderRuntime: (
    provider: AIProviderDescriptor,
    model: AIProviderRuntimeModel,
  ) => void;
  onStopProviderRuntime: (providerId: string) => void;
  onInputChange: (value: string) => void;
  onMentionQuery: (
    request: AIChatMentionQuery,
  ) => Promise<AIChatMentionCandidate[]>;
  onMentionSelect: (candidate: AIChatMentionCandidate) => void;
  onMentionRemove: (id: string) => void;
  onToggleContinuityInspector: () => void;
  onRefreshContinuity: () => void;
  onCompactContinuity: () => void;
  onRevokeContinuityCapsule: (capsuleId: string) => void;
  onSend: () => void;
  onCancel: () => void;
}

const actionIndex = (action: AIChatAction): number => {
  const index = modeOrder.indexOf(action);
  return index === -1 ? modeOrder.length : index;
};

const sortActionDescriptors = (
  descriptors: AIChatActionDescriptor[],
): AIChatActionDescriptor[] => {
  const sorted = Array.from(descriptors);
  sorted.sort((left, right) => actionIndex(left.id) - actionIndex(right.id));
  return sorted;
};

interface ComposerModeOption {
  key: string;
  action: AIChatAction;
  profileId: string;
  name: string;
  description: string;
  executionUnavailable: boolean;
}

const composerModeKey = (action: AIChatAction): string => {
  if (action === AIChatAction.AIChatActionAsk) {
    return "chat";
  }
  return action;
};

const modeOptionTestId = (key: string): string =>
  `ai-chat-mode-${key.replace(/\s+/g, "-").toLowerCase()}`;

interface ComposerMentionTrigger {
  trigger: AIChatMentionTrigger;
  query: string;
  start: number;
  end: number;
  source?: "input" | "attachment";
}

const parseComposerMentionTrigger = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ComposerMentionTrigger | null => {
  if (selectionStart !== selectionEnd) return null;
  const beforeCaret = value.slice(0, selectionStart);
  const tokenStart = Math.max(
    beforeCaret.lastIndexOf(" "),
    beforeCaret.lastIndexOf("\n"),
    beforeCaret.lastIndexOf("\t"),
  );
  const start = tokenStart + 1;
  const token = beforeCaret.slice(start);
  if (token.length === 0) return null;
  const first = token[0];
  if (first !== "@" && first !== "/") return null;
  if (first === "/") {
    const lineStart = beforeCaret.lastIndexOf("\n", start - 1) + 1;
    if (beforeCaret.slice(lineStart, start).trim() !== "") return null;
  }
  return {
    trigger:
      first === "@"
        ? AIChatMentionTrigger.AIChatMentionTriggerAt
        : AIChatMentionTrigger.AIChatMentionTriggerSlash,
    query: token.slice(1),
    start,
    end: selectionStart,
  };
};

const sameComposerMentionTrigger = (
  left: ComposerMentionTrigger | null,
  right: ComposerMentionTrigger | null,
): boolean =>
  left?.trigger === right?.trigger &&
  left?.query === right?.query &&
  left?.start === right?.start &&
  left?.end === right?.end &&
  left?.source === right?.source;

const firstSelectableMentionIndex = (
  candidates: AIChatMentionCandidate[],
): number => candidates.findIndex((candidate) => !candidate.disabledReason);

const nextSelectableMentionIndex = (
  candidates: AIChatMentionCandidate[],
  current: number,
  direction: 1 | -1,
): number => {
  if (candidates.length === 0) return -1;
  let index = current;
  for (let step = 0; step < candidates.length; step += 1) {
    index = (index + direction + candidates.length) % candidates.length;
    if (!candidates[index]?.disabledReason) return index;
  }
  return -1;
};

const isAttachmentMentionCandidate = (
  candidate: AIChatMentionCandidate,
): boolean =>
  candidate.operation ===
    AIChatMentionOperation.AIChatMentionOperationAttachFile ||
  candidate.operation ===
    AIChatMentionOperation.AIChatMentionOperationAttachSkill;

const iconForMentionKind = (kind: AIChatMentionKind) => {
  switch (kind) {
    case AIChatMentionKind.AIChatMentionKindAgent:
      return Bot;
    case AIChatMentionKind.AIChatMentionKindSkill:
      return Boxes;
    case AIChatMentionKind.AIChatMentionKindFile:
      return FileText;
    case AIChatMentionKind.AIChatMentionKindContext:
      return Layers;
    case AIChatMentionKind.AIChatMentionKindWorkflow:
      return ListChecks;
    case AIChatMentionKind.AIChatMentionKindAction:
      return Sparkles;
    default:
      return Slash;
  }
};

const mentionDetail = (mention: AIChatMentionCandidate): string =>
  mention.detail ||
  mention.contextItem?.path ||
  mention.contextItem?.label ||
  mention.description ||
  "";

const formatContextTokenCount = (tokens = 0): string => {
  const trimUnitValue = (value: string) =>
    value.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${value >= 10 ? Math.round(value) : trimUnitValue(value.toFixed(value < 2 ? 2 : 1))}m`;
  }
  if (tokens >= 1_000) {
    const value = tokens / 1_000;
    return `${value >= 10 ? Math.round(value) : trimUnitValue(value.toFixed(1))}k`;
  }
  return `${Math.max(0, tokens)}`;
};

const contextBudgetPercent = (
  budget: AIContextSnapshot["budget"] | undefined,
): number => {
  if (!budget?.contextWindow) return 0;
  return Math.min(100, Math.max(0, (budget.usageRatio || 0) * 100));
};

const formatContextPercent = (percent: number): string => {
  if (percent > 0 && percent < 0.01) return "<0.01%";
  if (percent < 10) return `${percent.toFixed(2)}%`;
  if (percent < 99.95) return `${percent.toFixed(1)}%`;
  return `${Math.min(100, Math.round(percent))}%`;
};

const contextBudgetTooltip = (
  budget: AIContextSnapshot["budget"] | undefined,
): string => {
  if (!budget) return "Context budget is being measured.";
  const input = formatContextTokenCount(budget.inputTokens);
  if (!budget.contextWindow) {
    return `${input} estimated input tokens. Model context window is not available yet.`;
  }
  const windowSize = formatContextTokenCount(budget.contextWindow);
  const remainingWindow = formatContextTokenCount(budget.remainingTokens);
  const source =
    budget.source === "assembled_external_agent_prompt"
      ? "external agent prompt"
      : "provider request";
  const percent = formatContextPercent(contextBudgetPercent(budget));
  if (budget.autoCompactRecommended) {
    return `${input}/${windowSize} estimated input tokens from the ${source} (${percent} used). Compaction is recommended before the next large turn.`;
  }
  if (budget.autoCompactThresholdTokens) {
    const remainingCompact = formatContextTokenCount(
      budget.remainingBeforeCompact,
    );
    return `${input}/${windowSize} estimated input tokens from the ${source} (${percent} used). ${remainingCompact} before the compaction threshold; ${remainingWindow} to the model limit.`;
  }
  return `${input}/${windowSize} estimated input tokens from the ${source} (${percent} used). ${remainingWindow} to the model limit.`;
};

const capsuleTitle = (capsule: AIContextCapsuleSummary): string => {
  const kind = capsule.kind || "capsule";
  const status = capsule.status || "active";
  return `${kind} · ${status}`;
};

const capsuleSummary = (capsule: AIContextCapsuleSummary): string =>
  capsule.summary ||
  capsule.continuationHint ||
  capsule.sourceRefs?.[0]?.label ||
  capsule.id;

export function ChatComposer({
  selectedAction,
  selectedMentions,
  actions,
  input,
  canSend,
  running,
  disabledReason,
  sendShortcut,
  providers,
  selectedProvider,
  selectedModel,
  selectedReasoningEffort,
  agentAuthRun,
  providerRuntimes,
  providerRuntimeBusy,
  providerRuntimeError,
  selectedModelCapability,
  consentPolicy,
  contextPreview,
  continuityPlan,
  continuityInspectorOpen,
  continuityBusy,
  continuityError,
  onActionChange,
  onSelectProvider,
  onSelectModel,
  onSelectReasoningEffort,
  onRefreshProviders,
  onStartAgentLogin,
  onCancelAgentLogin,
  onStartProviderOAuth,
  onCancelProviderAuth,
  onAcceptExternalAgentConsent,
  onAcceptRemoteBYOKProviderConsent,
  onAcceptFrontierProviderConsent,
  onProbeModelCapability,
  onStartProviderRuntime,
  onStopProviderRuntime,
  onInputChange,
  onMentionQuery,
  onMentionSelect,
  onMentionRemove,
  onToggleContinuityInspector,
  onRefreshContinuity,
  onCompactContinuity,
  onRevokeContinuityCapsule,
  onSend,
  onCancel,
}: ChatComposerProps) {
  const reduceMotion = useReducedMotion();
  const modeButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const composerRef = useRef<HTMLElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionRequestIdRef = useRef(0);
  const [activeMention, setActiveMention] =
    useState<ComposerMentionTrigger | null>(null);
  const [mentionCandidates, setMentionCandidates] = useState<
    AIChatMentionCandidate[]
  >([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(-1);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const actionDescriptors =
    actions.length > 0
      ? sortActionDescriptors(actions)
      : modeOrder.map((action) => {
          const isBuild = action === AIChatAction.AIChatActionBuild;
          const mayProposeTools =
            action === AIChatAction.AIChatActionPlan ||
            action === AIChatAction.AIChatActionDebug ||
            isBuild;
          return {
            id: action,
            name: getActionMeta(action).label,
            description: getActionMeta(action).description,
            builtIn: true,
            mayProposeTools,
            expectsToolProposals: isBuild,
            readOnlyIntent: !isBuild,
            showPlanStructure: action === AIChatAction.AIChatActionPlan,
            executionUnavailable: true,
          } as AIChatActionDescriptor;
        });
  const chatDescriptor = actionDescriptors.find(
    (descriptor) => descriptor.id === AIChatAction.AIChatActionAsk,
  );
  const modeOptions: ComposerModeOption[] = [
    {
      key: "chat",
      action: AIChatAction.AIChatActionAsk,
      profileId: askReadonlyProfileId,
      name: "Chat",
      description:
        chatDescriptor?.description || "Chat with the default project context.",
      executionUnavailable: false,
    },
    ...actionDescriptors
      .filter((descriptor) => descriptor.id !== AIChatAction.AIChatActionAsk)
      .map((descriptor) => {
        const meta = getActionMeta(descriptor.id);
        return {
          key: descriptor.id,
          action: descriptor.id,
          profileId: "",
          name: descriptor.name || meta.label,
          description: descriptor.description || meta.description,
          executionUnavailable: Boolean(descriptor.executionUnavailable),
        };
      }),
  ];
  const selectedModeKey = composerModeKey(selectedAction);
  const selectedMode =
    modeOptions.find((option) => option.key === selectedModeKey) ??
    modeOptions[0];
  const contextBudget = contextPreview?.budget;
  const contextPercent = contextBudgetPercent(contextBudget);
  const previewContinuity = contextPreview?.continuity ?? [];
  const includedContinuity =
    previewContinuity.length > 0 ? previewContinuity : (continuityPlan?.included ?? []);
  const staleContinuity = continuityPlan?.stale ?? [];
  const visibleContinuityCapsules = includedContinuity;
  const continuityCountLabel = `${includedContinuity.length} included · ${staleContinuity.length} stale`;
  const compactDisabledReason =
    continuityPlan?.disabledReason ||
    (running ? "A run is active." : continuityBusy ? "Continuity action is running." : "");
  const compactDisabled =
    continuityBusy || running || continuityPlan?.canCompact !== true;
  const canRevokeContinuity = continuityPlan?.canRevoke === true;
  const contextMeterStyle = {
    "--context-meter": `${contextPercent}%`,
  } as React.CSSProperties;
  const contextMeterClassName = [
    "ai-chat-composer__context-meter",
    contextBudget?.autoCompactRecommended
      ? "is-hot"
      : contextPercent >= 70
        ? "is-warm"
        : "is-cool",
  ].join(" ");
  const contextMeterTooltip = contextBudgetTooltip(contextBudget);

  const closeMentionPicker = useCallback(() => {
    setActiveMention(null);
    setMentionCandidates([]);
    setMentionLoading(false);
    setMentionIndex(-1);
  }, []);

  const openAttachmentPicker = useCallback(() => {
    if (activeMention?.source === "attachment") {
      closeMentionPicker();
      return;
    }
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? input.length;
    setModeMenuOpen(false);
    setModelPickerOpen(false);
    setMentionCandidates([]);
    setMentionLoading(true);
    setMentionIndex(-1);
    setActiveMention({
      trigger: AIChatMentionTrigger.AIChatMentionTriggerSlash,
      query: "",
      start: cursor,
      end: cursor,
      source: "attachment",
    });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [activeMention?.source, closeMentionPicker, input.length]);

  const syncMentionTrigger = useCallback(
    (value = input) => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const next = parseComposerMentionTrigger(
        value,
        textarea.selectionStart,
        textarea.selectionEnd,
      );
      setActiveMention((current) =>
        sameComposerMentionTrigger(current, next) ? current : next,
      );
      if (!next) {
        setMentionCandidates([]);
        setMentionLoading(false);
        setMentionIndex(-1);
      }
    },
    [input],
  );

  useEffect(() => {
    syncMentionTrigger(input);
  }, [input, syncMentionTrigger]);

  useEffect(() => {
    if (!activeMention) return;
    const requestId = mentionRequestIdRef.current + 1;
    mentionRequestIdRef.current = requestId;
    setMentionLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const candidates = await onMentionQuery(
          new AIChatMentionQuery({
            trigger: activeMention.trigger,
            query: activeMention.query,
            limit: 36,
            includeDisabled: true,
          }),
        );
        if (mentionRequestIdRef.current !== requestId) return;
        const nextCandidates =
          activeMention.source === "attachment"
            ? candidates.filter(isAttachmentMentionCandidate)
            : candidates;
        setMentionCandidates(nextCandidates);
        setMentionIndex(firstSelectableMentionIndex(nextCandidates));
      } catch {
        if (mentionRequestIdRef.current !== requestId) return;
        setMentionCandidates([]);
        setMentionIndex(-1);
      } finally {
        if (mentionRequestIdRef.current === requestId) {
          setMentionLoading(false);
        }
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [activeMention, onMentionQuery]);

  useEffect(() => {
    if (!activeMention) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-ai-chat-mention-scope]")
      ) {
        return;
      }
      closeMentionPicker();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [activeMention, closeMentionPicker]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && composerRef.current?.contains(target)) {
        return;
      }
      setModeMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModeMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [modeMenuOpen]);

  const replaceMentionTrigger = useCallback(
    (candidate: AIChatMentionCandidate) => {
      if (!activeMention) return;
      const operation = candidate.operation;
      const shouldInsert =
        operation === AIChatMentionOperation.AIChatMentionOperationInsertText;
      let replacement = shouldInsert ? candidate.insertText || "" : "";
      const after = input.slice(activeMention.end);
      if (replacement && after && !/^\s/.test(after)) {
        replacement += " ";
      } else if (replacement && !after) {
        replacement += " ";
      }
      const nextInput =
        input.slice(0, activeMention.start) + replacement + after;
      const nextCursor = activeMention.start + replacement.length;
      onInputChange(nextInput);
      onMentionSelect(candidate);
      closeMentionPicker();
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [activeMention, closeMentionPicker, input, onInputChange, onMentionSelect],
  );

  const handleModeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "Tab") return;

    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex =
      (index + direction + modeOptions.length) % modeOptions.length;
    const nextMode = modeOptions[nextIndex];
    if (!nextMode) return;
    onActionChange(nextMode.action, nextMode.profileId);
    modeButtonRefs.current[nextIndex]?.focus();
  };

  const selectMode = (option: ComposerModeOption) => {
    onActionChange(option.action, option.profileId);
    setModeMenuOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cycleMode = (direction: 1 | -1) => {
    const currentIndex = modeOptions.findIndex(
      (option) => option.key === selectedModeKey,
    );
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      (baseIndex + direction + modeOptions.length) % modeOptions.length;
    const nextMode = modeOptions[nextIndex];
    if (nextMode) {
      onActionChange(nextMode.action, nextMode.profileId);
    }
  };

  const handleComposerKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (activeMention) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMentionPicker();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setMentionIndex((current) =>
          nextSelectableMentionIndex(
            mentionCandidates,
            current,
            event.key === "ArrowDown" ? 1 : -1,
          ),
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        setMentionIndex((current) =>
          nextSelectableMentionIndex(
            mentionCandidates,
            current,
            event.shiftKey ? -1 : 1,
          ),
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const candidate = mentionCandidates[mentionIndex];
        if (candidate && !candidate.disabledReason) {
          replaceMentionTrigger(candidate);
        }
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (running) {
        onCancel();
        return;
      }
      if (input) {
        onInputChange("");
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      cycleMode(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    const modPressed = event.metaKey || event.ctrlKey;
    const shouldSend =
      sendShortcut === "enter"
        ? !event.altKey && !modPressed
        : modPressed && !event.altKey;
    if (!shouldSend) return;
    event.preventDefault();
    if (canSend) onSend();
  };

  return (
    <footer ref={composerRef} className="ai-chat-composer">
      <div
        className={`ai-chat-composer__box${modelPickerOpen ? " is-model-picker-open" : ""}`}
        data-ai-chat-mention-scope
      >
        <div className="ai-chat-composer__topbar">
          <div
            className="ai-chat-mode-dropdown"
            data-ai-chat-popover-scope
            role="presentation"
          >
            <button
              className={`ai-chat-mode-dropdown__trigger ai-chat-tone-${getActionMeta(selectedMode.action).tone}${modeMenuOpen ? " is-selected" : ""}`}
              data-testid={modeOptionTestId(selectedMode.key)}
              type="button"
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title="Change chat mode"
              onClick={() => setModeMenuOpen((open) => !open)}
            >
              {getActionMeta(selectedMode.action).icon}
              <span>{selectedMode.name}</span>
              <ChevronDown size={14} />
            </button>
            <AnimatePresence initial={false}>
              {modeMenuOpen ? (
                <m.div
                  className="ai-chat-mode-dropdown__menu"
                  role="menu"
                  aria-label="AI chat mode"
                  initial={
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: 6, scale: 0.98 }
                  }
                  animate={
                    reduceMotion
                      ? { opacity: 1 }
                      : { opacity: 1, y: 0, scale: 1 }
                  }
                  exit={
                    reduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, y: 4, scale: 0.98 }
                  }
                  transition={{
                    duration: reduceMotion ? 0.1 : 0.16,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  {modeOptions.map((option, index) => {
                    const meta = getActionMeta(option.action);
                    const selected = selectedModeKey === option.key;
                    return (
                      <button
                        key={option.key}
                        ref={(element) => {
                          modeButtonRefs.current[index] = element;
                        }}
                        className={`ai-chat-mode-dropdown__item ai-chat-tone-${meta.tone}${selected ? " is-selected" : ""}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        title={option.description || meta.description}
                        disabled={option.executionUnavailable}
                        onClick={() => selectMode(option)}
                        onKeyDown={(event) => handleModeKeyDown(event, index)}
                      >
                        <span className="ai-chat-mode-dropdown__item-icon">
                          {meta.icon}
                        </span>
                        <span className="ai-chat-mode-dropdown__item-body">
                          <strong>{option.name || meta.label}</strong>
                          <small>
                            {option.description || meta.description}
                          </small>
                        </span>
                        <AnimatePresence initial={false}>
                          {selected ? (
                            <m.span
                              className="ai-chat-mode-dropdown__check"
                              initial={{ opacity: 0, scale: 0.85 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.85 }}
                              transition={{
                                duration: reduceMotion ? 0.1 : 0.14,
                              }}
                            >
                              <Check size={14} />
                            </m.span>
                          ) : null}
                        </AnimatePresence>
                      </button>
                    );
                  })}
                </m.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        {selectedMentions.length > 0 ? (
          <div className="ai-chat-composer__mentions">
            {selectedMentions.map((mention) => {
              const MentionIcon = iconForMentionKind(mention.kind);
              const detail = mentionDetail(mention);
              return (
                <button
                  key={mention.id}
                  className="ai-chat-composer__mention-chip"
                  data-kind={mention.kind}
                  type="button"
                  title={detail}
                  onClick={() => onMentionRemove(mention.id)}
                >
                  <span className="ai-chat-composer__mention-icon">
                    <MentionIcon size={16} />
                  </span>
                  <span className="ai-chat-composer__mention-body">
                    <span>{mention.label}</span>
                    {detail && detail !== mention.label ? (
                      <small>{detail}</small>
                    ) : null}
                  </span>
                  <X size={14} />
                </button>
              );
            })}
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="ai-chat-composer__textarea"
          data-testid="ai-chat-input"
          placeholder={
            disabledReason || "Chat, plan, debug, build, or review..."
          }
          rows={3}
          value={input}
          aria-expanded={Boolean(activeMention)}
          aria-controls={activeMention ? "ai-chat-mention-picker" : undefined}
          aria-activedescendant={
            activeMention && mentionIndex >= 0
              ? `ai-chat-mention-option-${mentionIndex}`
              : undefined
          }
          onChange={(event) => {
            const nextInput = event.target.value;
            onInputChange(nextInput);
            window.requestAnimationFrame(() => syncMentionTrigger(nextInput));
          }}
          onClick={() => syncMentionTrigger()}
          onKeyDown={handleComposerKeyDown}
          onKeyUp={() => syncMentionTrigger()}
          onSelect={() => syncMentionTrigger()}
        />
        <MentionPicker
          open={Boolean(activeMention)}
          trigger={activeMention?.trigger ?? null}
          candidates={mentionCandidates}
          selectedIndex={mentionIndex}
          loading={mentionLoading}
          title={activeMention?.source === "attachment" ? "Attach" : undefined}
          ariaLabel={
            activeMention?.source === "attachment"
              ? "Attachment suggestions"
              : undefined
          }
          onHover={(index) => {
            if (!mentionCandidates[index]?.disabledReason) {
              setMentionIndex(index);
            }
          }}
          onSelect={replaceMentionTrigger}
        />
        <div className="ai-chat-composer__controls">
          <div className="ai-chat-composer__meta">
            <ModelPicker
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
              providerRuntimeBusy={providerRuntimeBusy}
              providerRuntimeError={providerRuntimeError}
              providerRuntimes={providerRuntimes}
              providers={providers}
              selectedModel={selectedModel}
              selectedReasoningEffort={selectedReasoningEffort}
              selectedProvider={selectedProvider}
              agentAuthRun={agentAuthRun}
              selectedModelCapability={selectedModelCapability}
              consentPolicy={consentPolicy}
              onRefreshProviders={onRefreshProviders}
              onStartAgentLogin={onStartAgentLogin}
              onCancelAgentLogin={onCancelAgentLogin}
              onStartProviderOAuth={onStartProviderOAuth}
              onCancelProviderAuth={onCancelProviderAuth}
              onAcceptExternalAgentConsent={onAcceptExternalAgentConsent}
              onAcceptRemoteBYOKProviderConsent={
                onAcceptRemoteBYOKProviderConsent
              }
              onAcceptFrontierProviderConsent={onAcceptFrontierProviderConsent}
              onProbeModelCapability={onProbeModelCapability}
              onSelectModel={onSelectModel}
              onSelectReasoningEffort={onSelectReasoningEffort}
              onSelectProvider={onSelectProvider}
              onStartProviderRuntime={onStartProviderRuntime}
              onStopProviderRuntime={onStopProviderRuntime}
            />
            {disabledReason ? (
              disabledReason === "External agent CLI consent required" ? (
                <button
                  className="ai-chat-inline-consent-button"
                  type="button"
                  onClick={onAcceptExternalAgentConsent}
                >
                  <ShieldCheck size={13} />
                  Accept external CLI consent
                </button>
              ) : disabledReason === "Remote provider consent required" ? (
                <button
                  className="ai-chat-inline-consent-button"
                  type="button"
                  onClick={onAcceptRemoteBYOKProviderConsent}
                >
                  <ShieldCheck size={13} />
                  Accept remote provider consent
                </button>
              ) : disabledReason === "Frontier provider consent required" ? (
                <button
                  className="ai-chat-inline-consent-button"
                  type="button"
                  onClick={onAcceptFrontierProviderConsent}
                >
                  <ShieldCheck size={13} />
                  Accept frontier consent
                </button>
              ) : (
                <span className="ai-chat-composer__reason">
                  {disabledReason}
                </span>
              )
            ) : null}
          </div>
          <div className="ai-chat-composer__buttons">
            {contextBudget ? (
              <div className="ai-chat-composer__context-meter-wrap">
                <button
                  className={contextMeterClassName}
                  style={contextMeterStyle}
                  type="button"
                  aria-expanded={continuityInspectorOpen}
                  aria-label={contextMeterTooltip}
                  onClick={onToggleContinuityInspector}
                >
                  <span className="ai-chat-composer__context-meter-ring">
                    <span className="ai-chat-composer__context-meter-core" />
                  </span>
                  <span
                    className="ai-chat-composer__context-meter-popover"
                    role="tooltip"
                  >
                    <strong>
                      {formatContextTokenCount(contextBudget.inputTokens)}
                      {contextBudget.contextWindow
                        ? ` / ${formatContextTokenCount(contextBudget.contextWindow)}`
                        : ""}
                    </strong>
                    <span>
                      {contextBudget.contextWindow
                        ? contextBudget.autoCompactRecommended
                          ? "Compact before the next large turn"
                          : `${formatContextPercent(contextPercent)} used; ${formatContextTokenCount(contextBudget.remainingBeforeCompact)} before compaction`
                        : "Context window unavailable"}
                    </span>
                  </span>
                </button>
                {continuityInspectorOpen ? (
                  <div
                    className="ai-chat-composer__continuity-popover"
                    data-testid="ai-chat-continuity-popover"
                  >
                    <div className="ai-chat-composer__continuity-head">
                      <span>Continuity</span>
                      <small>{continuityCountLabel}</small>
                    </div>
                    {continuityPlan?.policyReason ? (
                      <p className="ai-chat-composer__continuity-policy">
                        {continuityPlan.policyReason}
                      </p>
                    ) : null}
                    {continuityPlan?.degradedReason ? (
                      <p className="ai-chat-composer__continuity-error">
                        {continuityPlan.degradedReason}
                      </p>
                    ) : null}
                    {continuityError ? (
                      <p className="ai-chat-composer__continuity-error">
                        {continuityError}
                      </p>
                    ) : null}
                    <div className="ai-chat-composer__continuity-actions">
                      <button
                        type="button"
                        disabled={continuityBusy}
                        onClick={onRefreshContinuity}
                      >
                        <RefreshCw size={13} />
                        Refresh
                      </button>
                      <button
                        type="button"
                        disabled={compactDisabled}
                        title={compactDisabledReason || "Compact continuity"}
                        onClick={onCompactContinuity}
                      >
                        <RefreshCw size={13} />
                        Compact now
                      </button>
                    </div>
                    <div className="ai-chat-composer__continuity-list">
                      {visibleContinuityCapsules.length > 0 ? (
                        visibleContinuityCapsules.slice(0, 6).map((capsule) => (
                          <div
                            className="ai-chat-composer__continuity-row"
                            key={capsule.id}
                          >
                            <div>
                              <span>{capsuleTitle(capsule)}</span>
                              <small>{capsuleSummary(capsule)}</small>
                            </div>
                            {capsule.status !== "revoked" ? (
                              <button
                                type="button"
                                disabled={continuityBusy || !canRevokeContinuity}
                                title={
                                  canRevokeContinuity
                                    ? "Revoke capsule"
                                    : continuityPlan?.disabledReason ||
                                      "Continuity revocation unavailable."
                                }
                                aria-label="Revoke capsule"
                                onClick={() =>
                                  onRevokeContinuityCapsule(capsule.id)
                                }
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : null}
                          </div>
                        ))
                      ) : (
                        <p className="ai-chat-composer__continuity-empty">
                          No continuity capsules selected.
                        </p>
                      )}
                      {staleContinuity.length > 0 ? (
                        <div className="ai-chat-composer__continuity-stale">
                          {staleContinuity.slice(0, 4).map((capsule) => (
                            <span key={capsule.id}>
                              Stale: {capsuleSummary(capsule)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              className={`ai-chat-attachment-button${
                activeMention?.source === "attachment" ? " is-selected" : ""
              }`}
              data-testid="ai-chat-attach-button"
              type="button"
              aria-expanded={activeMention?.source === "attachment"}
              aria-label="Attach file or skill"
              title="Attach file or skill"
              onClick={openAttachmentPicker}
            >
              <Paperclip size={18} />
            </button>
            {running ? (
              <button
                className="ai-chat-send-button is-stop"
                type="button"
                title="Stop run"
                onClick={onCancel}
              >
                <Square size={17} />
              </button>
            ) : (
              <button
                className="ai-chat-send-button"
                data-testid="ai-chat-send"
                type="button"
                disabled={!canSend}
                title={canSend ? "Send" : disabledReason}
                onClick={onSend}
              >
                <Send size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
