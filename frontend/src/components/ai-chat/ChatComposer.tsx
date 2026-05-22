import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Boxes,
  Check,
  ChevronDown,
  Database,
  FileText,
  Layers,
  ListChecks,
  Monitor,
  ShieldCheck,
  Paperclip,
  Send,
  Slash,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type {
  AIChatActionDescriptor,
  AIChatMentionCandidate,
  AIConsentPolicy,
  AIContextProviderDescriptor,
  AIModelCapabilityDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  AIChatAction,
  AIChatMentionKind,
  AIChatMentionOperation,
  AIChatMentionQuery,
  AIChatMentionTrigger,
} from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type { AIChatSendShortcut } from "../../stores/editorSettingsStore";
import type {
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import { ContextPickerMenu } from "./ContextPickerMenu";
import { getActionMeta, modeOrder } from "./aiChatPresentation";
import { MentionPicker } from "./MentionPicker";
import { ModelPicker } from "./ModelPicker";
import type { ContextToggles } from "./types";

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
  providerRuntimes: AIProviderRuntimeDescriptor[];
  providerRuntimeBusy: boolean;
  providerRuntimeError: string;
  selectedModelCapability: AIModelCapabilityDescriptor | null;
  consentPolicy: AIConsentPolicy | null;
  context: ContextToggles;
  contextProviders: AIContextProviderDescriptor[];
  contextPickerOpen: boolean;
  onActionChange: (action: AIChatAction) => void;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onSelectModel: (modelId: string) => void;
  onSelectReasoningEffort: (reasoningEffort: string) => void;
  onRefreshProviders: () => void;
  onStartAgentLogin: (provider: AIProviderDescriptor) => void;
  onAcceptExternalAgentConsent: () => void;
  onAcceptRemoteBYOKProviderConsent: () => void;
  onAcceptFrontierProviderConsent: () => void;
  onProbeModelCapability: () => void;
  onStartProviderRuntime: (
    provider: AIProviderDescriptor,
    model: AIProviderRuntimeModel,
  ) => void;
  onStopProviderRuntime: (providerId: string) => void;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onInputChange: (value: string) => void;
  onMentionQuery: (
    request: AIChatMentionQuery,
  ) => Promise<AIChatMentionCandidate[]>;
  onMentionSelect: (candidate: AIChatMentionCandidate) => void;
  onMentionRemove: (id: string) => void;
  onRefreshContext: () => void;
  onToggleContextPicker: () => void;
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

interface ComposerMentionTrigger {
  trigger: AIChatMentionTrigger;
  query: string;
  start: number;
  end: number;
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
  left?.end === right?.end;

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

const contextChipMeta: Record<
  keyof ContextToggles,
  {
    label: string;
    detail: string;
    icon: React.ComponentType<{ size?: number }>;
  }
> = {
  workspace: {
    label: "Workspace",
    detail: "project",
    icon: Layers,
  },
  currentFile: {
    label: "Current file",
    detail: "editor",
    icon: FileText,
  },
  terminalLogs: {
    label: "Terminal logs",
    detail: "shell",
    icon: Monitor,
  },
  mnemonic: {
    label: "Mnemonic",
    detail: "memory",
    icon: Database,
  },
  mcp: {
    label: "MCP",
    detail: "tools",
    icon: SlidersHorizontal,
  },
  skills: {
    label: "Skills",
    detail: "instructions",
    icon: Boxes,
  },
};

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
  providerRuntimes,
  providerRuntimeBusy,
  providerRuntimeError,
  selectedModelCapability,
  consentPolicy,
  context,
  contextProviders,
  contextPickerOpen,
  onActionChange,
  onSelectProvider,
  onSelectModel,
  onSelectReasoningEffort,
  onRefreshProviders,
  onStartAgentLogin,
  onAcceptExternalAgentConsent,
  onAcceptRemoteBYOKProviderConsent,
  onAcceptFrontierProviderConsent,
  onProbeModelCapability,
  onStartProviderRuntime,
  onStopProviderRuntime,
  onContextToggle,
  onInputChange,
  onMentionQuery,
  onMentionSelect,
  onMentionRemove,
  onRefreshContext,
  onToggleContextPicker,
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
  const enabledContextChips = (
    Object.keys(contextChipMeta) as Array<keyof ContextToggles>
  ).filter((key) => context[key]);

  const closeMentionPicker = useCallback(() => {
    setActiveMention(null);
    setMentionCandidates([]);
    setMentionLoading(false);
    setMentionIndex(-1);
  }, []);

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
        setMentionCandidates(candidates);
        setMentionIndex(firstSelectableMentionIndex(candidates));
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
      (index + direction + actionDescriptors.length) % actionDescriptors.length;
    const nextAction = actionDescriptors[nextIndex]?.id;
    if (!nextAction) return;
    onActionChange(nextAction);
    modeButtonRefs.current[nextIndex]?.focus();
  };

  const selectMode = (action: AIChatAction) => {
    onActionChange(action);
    setModeMenuOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const cycleMode = (direction: 1 | -1) => {
    const currentIndex = actionDescriptors.findIndex(
      (descriptor) => descriptor.id === selectedAction,
    );
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex =
      (baseIndex + direction + actionDescriptors.length) %
      actionDescriptors.length;
    const nextAction = actionDescriptors[nextIndex]?.id;
    if (nextAction) {
      onActionChange(nextAction);
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
      <div className="ai-chat-composer__box" data-ai-chat-mention-scope>
        <div className="ai-chat-composer__topbar">
          <div
            className="ai-chat-mode-dropdown"
            data-ai-chat-popover-scope
            role="presentation"
          >
            <button
              className={`ai-chat-mode-dropdown__trigger ai-chat-tone-${getActionMeta(selectedAction).tone}${modeMenuOpen ? " is-selected" : ""}`}
              data-testid={`ai-chat-mode-${getActionMeta(selectedAction).label.toLowerCase()}`}
              type="button"
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title="Change chat mode"
              onClick={() => setModeMenuOpen((open) => !open)}
            >
              {getActionMeta(selectedAction).icon}
              <span>{getActionMeta(selectedAction).label}</span>
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
                  {actionDescriptors.map((descriptor, index) => {
                    const meta = getActionMeta(descriptor.id);
                    const selected = selectedAction === descriptor.id;
                    return (
                      <button
                        key={descriptor.id}
                        ref={(element) => {
                          modeButtonRefs.current[index] = element;
                        }}
                        className={`ai-chat-mode-dropdown__item ai-chat-tone-${meta.tone}${selected ? " is-selected" : ""}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        title={descriptor.description || meta.description}
                        disabled={descriptor.executionUnavailable}
                        onClick={() => selectMode(descriptor.id)}
                        onKeyDown={(event) => handleModeKeyDown(event, index)}
                      >
                        <span className="ai-chat-mode-dropdown__item-icon">
                          {meta.icon}
                        </span>
                        <span className="ai-chat-mode-dropdown__item-body">
                          <strong>{descriptor.name || meta.label}</strong>
                          <small>
                            {descriptor.description || meta.description}
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
          <ContextPickerMenu
            context={context}
            contextProviders={contextProviders}
            open={contextPickerOpen}
            onContextToggle={onContextToggle}
            onToggle={onToggleContextPicker}
          />
        </div>
        {enabledContextChips.length > 0 ? (
          <div
            className="ai-chat-composer__context-chips"
            aria-label="Included context"
          >
            <AnimatePresence initial={false}>
              {enabledContextChips.map((key) => {
                const meta = contextChipMeta[key];
                const ContextIcon = meta.icon;
                return (
                  <m.button
                    key={key}
                    className="ai-chat-composer__context-chip"
                    layout
                    initial={
                      reduceMotion ? { opacity: 0 } : { opacity: 0, y: 5 }
                    }
                    animate={
                      reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                    }
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={{
                      duration: reduceMotion ? 0.1 : 0.16,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    type="button"
                    title={`Remove ${meta.label} from this request`}
                    onClick={() => onContextToggle(key, false)}
                    whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                  >
                    <span className="ai-chat-composer__context-icon">
                      <ContextIcon size={14} />
                    </span>
                    <span>{meta.label}</span>
                    <small>{meta.detail}</small>
                    <X size={12} />
                  </m.button>
                );
              })}
            </AnimatePresence>
          </div>
        ) : null}
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
          placeholder={disabledReason || "Ask, plan, build, or debug..."}
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
              providerRuntimeBusy={providerRuntimeBusy}
              providerRuntimeError={providerRuntimeError}
              providerRuntimes={providerRuntimes}
              providers={providers}
              selectedModel={selectedModel}
              selectedReasoningEffort={selectedReasoningEffort}
              selectedProvider={selectedProvider}
              selectedModelCapability={selectedModelCapability}
              consentPolicy={consentPolicy}
              onRefreshProviders={onRefreshProviders}
              onStartAgentLogin={onStartAgentLogin}
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
            <button
              className="ai-chat-icon-button"
              type="button"
              title="Attach runtime context"
              onClick={onRefreshContext}
            >
              <Paperclip size={17} />
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
