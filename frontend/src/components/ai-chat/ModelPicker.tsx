import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Gauge,
  LogIn,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type { AIModelCapabilityDescriptor } from "../../../bindings/arlecchino/internal/ai/models";
import type { AIConsentPolicy } from "../../../bindings/arlecchino/internal/ai/models";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import { mergeModelOptions } from "./providerModelOptions";
import {
  getProviderPresentation,
  isExternalAgentProvider,
} from "./providerPresentation";

interface ModelPickerProps {
  providers: AIProviderDescriptor[];
  selectedProvider: AIProviderDescriptor | null;
  selectedModel: string;
  selectedReasoningEffort: string;
  providerRuntimes: AIProviderRuntimeDescriptor[];
  providerRuntimeBusy: boolean;
  providerRuntimeError: string;
  selectedModelCapability: AIModelCapabilityDescriptor | null;
  consentPolicy: AIConsentPolicy | null;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onSelectModel: (modelId: string) => void;
  onSelectReasoningEffort: (reasoningEffort: string) => void;
  onRefreshProviders: () => void;
  onStartAgentLogin: (provider: AIProviderDescriptor) => void;
  onAcceptExternalAgentConsent: () => void;
  onProbeModelCapability: () => void;
  onStartProviderRuntime: (
    provider: AIProviderDescriptor,
    model: AIProviderRuntimeModel,
  ) => void;
  onStopProviderRuntime: (providerId: string) => void;
}

export function ModelPicker({
  providers,
  selectedProvider,
  selectedModel,
  selectedReasoningEffort,
  providerRuntimes,
  providerRuntimeBusy,
  providerRuntimeError,
  selectedModelCapability,
  consentPolicy,
  onSelectProvider,
  onSelectModel,
  onSelectReasoningEffort,
  onRefreshProviders,
  onStartAgentLogin,
  onAcceptExternalAgentConsent,
  onProbeModelCapability,
  onStartProviderRuntime,
  onStopProviderRuntime,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const runtime = selectedProvider
    ? providerRuntimes.find(
        (candidate) => candidate.providerId === selectedProvider.id,
      )
    : null;
  const modelOptions = mergeModelOptions(selectedProvider, runtime);
  const activeModel =
    modelOptions.find((model) => model.id === selectedModel) ??
    modelOptions.find((model) => model.active) ??
    null;
  const selectedProviderLabel = selectedProvider?.name || selectedProvider?.id;
  const selectedProviderPresentation =
    getProviderPresentation(selectedProvider);
  const selectedProviderNeedsAuth =
    isExternalAgentProvider(selectedProvider) &&
    selectedProvider?.status === "needs_auth";
  const selectedProviderIsExternalAgent =
    isExternalAgentProvider(selectedProvider);
  const selectedProviderNeedsConsent =
    selectedProviderIsExternalAgent && !consentPolicy?.externalAgentCliAccepted;
  const selectedModelLabel =
    activeModel?.displayName || activeModel?.id || selectedModel || "No model";
  const reasoningEfforts = activeModel?.reasoningEfforts ?? [];
  const activeReasoningEffort = reasoningEfforts.includes(
    selectedReasoningEffort,
  )
    ? selectedReasoningEffort
    : "";
  const reasoningLabel = activeReasoningEffort || "auto";
  const selectedModelAccountScoped = Boolean(activeModel?.accountScoped);
  const probeStatus = selectedModelCapability?.probeStatus || "";
  const probeLabel =
    probeStatus === "verified"
      ? "Tool probe verified"
      : probeStatus === "unsupported"
        ? "Tool probe failed"
        : probeStatus === "error" || probeStatus === "failed"
          ? "Tool probe error"
          : probeStatus === "pending"
            ? "Tool probe running"
            : selectedModelCapability?.toolSupport
              ? "Tool support inferred"
              : "Tool support unknown";

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-ai-chat-model-picker-scope]")) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="ai-chat-composer__model" data-ai-chat-model-picker-scope>
      <button
        className="ai-chat-composer__model-button"
        type="button"
        aria-expanded={open}
        aria-label="Choose provider and model"
        title={
          activeModel?.path ||
          activeModel?.reason ||
          activeModel?.displayName ||
          activeModel?.id ||
          selectedProviderPresentation.subtitle ||
          "Choose provider and model"
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className={`ai-chat-composer__model-dot is-${selectedProviderPresentation.tone}`}
        />
        <span className="ai-chat-composer__model-label">
          {selectedProviderLabel || "No provider"} / {selectedModelLabel}
          {selectedProviderIsExternalAgent ? ` / ${reasoningLabel}` : ""}
        </span>
        <ChevronDown size={14} />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            className="ai-chat-popover ai-chat-model-picker"
            data-testid="ai-chat-model-picker"
            initial={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }
            }
            animate={
              reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: -4, scale: 0.985 }
            }
            transition={{
              duration: reduceMotion ? 0.1 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="ai-chat-model-picker__header">
              <div className="ai-chat-popover__title">Provider and model</div>
              <button
                className="ai-chat-icon-button"
                type="button"
                title="Refresh providers"
                onClick={onRefreshProviders}
              >
                <RefreshCw size={14} />
              </button>
            </div>

            <section className="ai-chat-popover__section">
              <div className="ai-chat-popover__label">Providers</div>
              {providers.length > 0 ? (
                <div className="ai-chat-provider-list">
                  {providers.map((provider) => {
                    const presentation = getProviderPresentation(provider);
                    const selected = provider.id === selectedProvider?.id;
                    return (
                      <button
                        key={provider.id}
                        className={`ai-chat-provider-row is-${presentation.tone}${selected ? " is-selected" : ""}`}
                        type="button"
                        disabled={!presentation.selectable}
                        title={presentation.rawReason || presentation.subtitle}
                        onClick={() => onSelectProvider(provider)}
                      >
                        <span className="ai-chat-provider-row__dot" />
                        <span className="ai-chat-provider-row__body">
                          <span className="ai-chat-provider-row__name">
                            {presentation.title}
                          </span>
                          <span className="ai-chat-provider-row__detail">
                            {presentation.subtitle}
                          </span>
                        </span>
                        {selected ? <CheckCircle2 size={15} /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="ai-chat-provider-empty">
                  No chat runtimes detected.
                </div>
              )}
            </section>

            <section className="ai-chat-popover__section">
              <div className="ai-chat-popover__label">
                Models
                {selectedProviderLabel ? (
                  <span>{selectedProviderLabel}</span>
                ) : null}
              </div>
              {modelOptions.length > 0 ? (
                <div className="ai-chat-model-list">
                  {modelOptions.map((model) => {
                    const active =
                      selectedModel === model.id ||
                      (!selectedModel && model.active);
                    const canStart =
                      Boolean(selectedProvider?.local) &&
                      !isExternalAgentProvider(selectedProvider) &&
                      model.runnable &&
                      (!runtime?.running || !model.active);
                    return (
                      <div
                        className={`ai-chat-model-row${active ? " is-selected" : ""}`}
                        key={`${model.id}-${model.path || model.source}`}
                      >
                        <button
                          type="button"
                          title={model.path || model.reason || model.id}
                          onClick={() => {
                            onSelectModel(model.id);
                            setOpen(false);
                          }}
                        >
                          <span>
                            <span className="ai-chat-model-row__name">
                              {model.displayName || model.id}
                            </span>
                            <span className="ai-chat-model-row__detail">
                              {model.source}
                              {model.active ? " · active" : ""}
                              {model.accountScoped ? " · account" : ""}
                            </span>
                          </span>
                          {active ? <CheckCircle2 size={14} /> : null}
                        </button>
                        {canStart && selectedProvider ? (
                          <button
                            className="ai-chat-model-row__action"
                            type="button"
                            disabled={providerRuntimeBusy}
                            title="Start provider server with this model"
                            onClick={() =>
                              onStartProviderRuntime(selectedProvider, model)
                            }
                          >
                            <Play size={13} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="ai-chat-provider-empty">
                  {selectedProviderIsExternalAgent
                    ? selectedProviderNeedsAuth
                      ? "Sign in to load account models."
                      : "Account model catalog unavailable."
                    : selectedProvider?.frontier
                      ? "Configure BYOK credentials to query provider models."
                      : "No active or installed models detected."}
                </div>
              )}
            </section>

            {selectedProviderIsExternalAgent && reasoningEfforts.length > 0 ? (
              <section className="ai-chat-popover__section">
                <div className="ai-chat-popover__label">
                  Reasoning
                  <span>
                    {selectedModelAccountScoped ? "account model" : "model"}
                  </span>
                </div>
                <div className="ai-chat-reasoning-list">
                  <button
                    className={`ai-chat-reasoning-chip${activeReasoningEffort === "" ? " is-selected" : ""}`}
                    type="button"
                    onClick={() => onSelectReasoningEffort("")}
                  >
                    Auto
                  </button>
                  {reasoningEfforts.map((effort) => (
                    <button
                      key={effort}
                      className={`ai-chat-reasoning-chip${activeReasoningEffort === effort ? " is-selected" : ""}`}
                      type="button"
                      onClick={() => onSelectReasoningEffort(effort)}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="ai-chat-model-picker__actions">
              <button
                className="ai-chat-secondary-button"
                type="button"
                onClick={onRefreshProviders}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
              {selectedProviderIsExternalAgent && selectedProvider ? (
                <button
                  className="ai-chat-secondary-button is-primary"
                  type="button"
                  disabled={providerRuntimeBusy}
                  title={
                    selectedProviderNeedsAuth
                      ? "Start the official CLI login flow inside AI Chat"
                      : "Open the official CLI account flow inside AI Chat"
                  }
                  onClick={() => {
                    setOpen(false);
                    onStartAgentLogin(selectedProvider);
                  }}
                >
                  <LogIn size={14} />
                  {selectedProviderNeedsAuth ? "Sign in" : "Account"}
                </button>
              ) : null}
              {selectedProviderNeedsConsent ? (
                <button
                  className="ai-chat-secondary-button is-primary"
                  type="button"
                  title="Allow this local CLI to receive selected project context"
                  onClick={onAcceptExternalAgentConsent}
                >
                  Accept CLI consent
                </button>
              ) : null}
              <button
                className="ai-chat-secondary-button"
                type="button"
                disabled={!selectedProvider || providerRuntimeBusy}
                title={selectedModelCapability?.probeError || probeLabel}
                onClick={onProbeModelCapability}
              >
                <Gauge size={14} />
                Probe tools
              </button>
              {runtime?.running && runtime.managed && selectedProvider ? (
                <button
                  className="ai-chat-secondary-button ai-chat-provider-stop"
                  type="button"
                  disabled={providerRuntimeBusy}
                  onClick={() => onStopProviderRuntime(selectedProvider.id)}
                >
                  <Square size={14} />
                  Stop server
                </button>
              ) : null}
            </div>
            <div className="ai-chat-provider-runtime-note">
              {selectedProvider?.local
                ? "Runs locally."
                : isExternalAgentProvider(selectedProvider)
                  ? "Runs through the provider-owned CLI account."
                  : "Select a local provider or Agent CLI runtime to continue."}
            </div>
            {runtime?.reason ? (
              <div className="ai-chat-provider-runtime-note">
                {runtime.reason}
              </div>
            ) : null}
            {providerRuntimeError ? (
              <div className="ai-chat-provider-runtime-error">
                {providerRuntimeError}
              </div>
            ) : null}
            <div
              className={`ai-chat-model-picker__probe is-${probeStatus || "unknown"}`}
              title={selectedModelCapability?.probeError || probeLabel}
            >
              {probeLabel}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
