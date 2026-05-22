import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Gauge,
  LogIn,
  Play,
  RefreshCw,
  Search,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type { AIModelCapabilityDescriptor } from "../../../bindings/arlecchino/internal/ai/models";
import type { AIConsentPolicy } from "../../../bindings/arlecchino/internal/ai/models";
import {
  AIProviderSettings,
  type AIProviderDescriptor,
} from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import { AISaveProviderSettings, AITestProvider } from "../../wails/app";
import { mergeModelOptions } from "./providerModelOptions";
import {
  getProviderPresentation,
  isExternalAgentProvider,
  isFrontierModelProvider,
  isRemoteBYOKProvider,
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
  onAcceptRemoteBYOKProviderConsent: () => void;
  onAcceptFrontierProviderConsent: () => void;
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
  onAcceptRemoteBYOKProviderConsent,
  onAcceptFrontierProviderConsent,
  onProbeModelCapability,
  onStartProviderRuntime,
  onStopProviderRuntime,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [providerSetupBusy, setProviderSetupBusy] = useState(false);
  const [providerSetupError, setProviderSetupError] = useState("");
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
  const selectedProviderPresentation =
    getProviderPresentation(selectedProvider);
  const selectedProviderLabel = selectedProviderPresentation.title;
  const selectedProviderNeedsAuth = selectedProvider?.status === "needs_auth";
  const selectedProviderIsExternalAgent =
    isExternalAgentProvider(selectedProvider);
  const selectedProviderNeedsAPIKey =
    selectedProviderNeedsAuth &&
    !selectedProviderIsExternalAgent &&
    Boolean(selectedProvider?.requiresAuth);
  const selectedProviderNeedsConsent =
    selectedProviderIsExternalAgent && !consentPolicy?.externalAgentCliAccepted;
  const selectedProviderNeedsRemoteBYOKConsent =
    isRemoteBYOKProvider(selectedProvider) &&
    !consentPolicy?.remoteProvidersAccepted;
  const selectedProviderNeedsFrontierConsent =
    isFrontierModelProvider(selectedProvider) &&
    !consentPolicy?.frontierProvidersAccepted;
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
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredProviders = useMemo(
    () =>
      normalizedSearch
        ? providers.filter((provider) =>
            [
              provider.name,
              provider.id,
              provider.kind,
              provider.endpoint,
              provider.runtimeFamily,
            ]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        : providers,
    [normalizedSearch, providers],
  );
  const filteredModelOptions = useMemo(
    () =>
      normalizedSearch
        ? modelOptions.filter((model) =>
            [
              model.displayName,
              model.id,
              model.source,
              model.path,
              model.reason,
              ...(model.reasoningEfforts ?? []),
            ]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        : modelOptions,
    [modelOptions, normalizedSearch],
  );
  const selectedModelMeta = [
    selectedProviderLabel || "No provider",
    selectedModelLabel,
    reasoningEfforts.length > 0 || activeReasoningEffort ? reasoningLabel : "",
  ]
    .filter(Boolean)
    .join(" / ");
  const projectDefaultModel = selectedProvider?.defaultModel || "";
  const projectDefaultDisabled =
    !projectDefaultModel || projectDefaultModel === selectedModel;

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

  useEffect(() => {
    setApiKeyDraft("");
    setProviderSetupError("");
  }, [selectedProvider?.id]);

  const handleSaveProviderAPIKey = async () => {
    if (!selectedProvider || !apiKeyDraft.trim()) return;
    setProviderSetupBusy(true);
    setProviderSetupError("");
    try {
      await AISaveProviderSettings(
        new AIProviderSettings({
          id: selectedProvider.id,
          name: selectedProviderLabel,
          kind: selectedProvider.kind,
          endpoint: selectedProvider.endpoint,
          model: selectedModel || selectedProvider.defaultModel,
          enabled: true,
          manual: selectedProvider.manual,
          secretValue: apiKeyDraft.trim(),
        }),
      );
      setApiKeyDraft("");
      try {
        await AITestProvider(selectedProvider.id);
      } catch {
        // The saved key still updates auth state; refresh will show the exact provider status.
      }
      onRefreshProviders();
    } catch (error) {
      setProviderSetupError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setProviderSetupBusy(false);
    }
  };

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
          {selectedModelMeta}
        </span>
        <ChevronDown size={14} />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            className="ai-chat-popover ai-chat-model-picker"
            data-testid="ai-chat-model-picker"
            initial={
              reduceMotion
                ? { opacity: 0 }
                : { opacity: 0, y: 12, scale: 0.985 }
            }
            animate={
              reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }
            }
            layout
            transition={{
              duration: reduceMotion ? 0.1 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="ai-chat-model-picker__header">
              <div>
                <div className="ai-chat-popover__title">
                  Provider, model, reasoning
                </div>
                <div className="ai-chat-model-picker__current">
                  {selectedModelMeta}
                </div>
              </div>
              <button
                className="ai-chat-icon-button"
                type="button"
                title="Close model picker"
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div className="ai-chat-model-picker__toolbar">
              <label className="ai-chat-model-picker__search">
                <Search size={14} />
                <input
                  type="search"
                  value={search}
                  placeholder="Search models"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button
                className="ai-chat-model-picker__default"
                type="button"
                disabled={projectDefaultDisabled}
                title={
                  projectDefaultModel
                    ? `Use project default model: ${projectDefaultModel}`
                    : "Project default model is not configured"
                }
                onClick={() => {
                  if (projectDefaultModel) {
                    onSelectModel(projectDefaultModel);
                  }
                }}
              >
                Project default
                <CheckCircle2 size={13} />
              </button>
            </div>

            <div className="ai-chat-model-picker__columns">
              <section className="ai-chat-popover__section ai-chat-model-picker__column">
                <div className="ai-chat-popover__label">Providers</div>
                {filteredProviders.length > 0 ? (
                  <div className="ai-chat-provider-list">
                    {filteredProviders.map((provider) => {
                      const presentation = getProviderPresentation(provider);
                      const selected = provider.id === selectedProvider?.id;
                      return (
                        <button
                          key={provider.id}
                          className={`ai-chat-provider-row is-${presentation.tone}${selected ? " is-selected" : ""}`}
                          type="button"
                          disabled={!presentation.selectable}
                          title={
                            presentation.rawReason || presentation.subtitle
                          }
                          onClick={() => onSelectProvider(provider)}
                        >
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
                    {providers.length > 0
                      ? "No matching providers."
                      : "No chat runtimes detected."}
                  </div>
                )}
              </section>

              <section className="ai-chat-popover__section ai-chat-model-picker__column ai-chat-model-picker__column--models">
                <div className="ai-chat-popover__label">
                  Models
                  {selectedProviderLabel ? (
                    <span>{selectedProviderLabel}</span>
                  ) : null}
                </div>
                {filteredModelOptions.length > 0 ? (
                  <div className="ai-chat-model-list">
                    {filteredModelOptions.map((model) => {
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
                            onClick={() => onSelectModel(model.id)}
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
                    {modelOptions.length > 0
                      ? "No matching models."
                      : selectedProviderIsExternalAgent
                        ? selectedProviderNeedsAuth
                          ? "Sign in to load account models."
                          : "Account model catalog unavailable."
                        : selectedProvider?.frontier
                          ? "Configure a remote API key to query provider models."
                          : "No active or installed models detected."}
                  </div>
                )}
              </section>

              <section className="ai-chat-popover__section ai-chat-model-picker__column ai-chat-model-picker__column--reasoning">
                <div className="ai-chat-popover__label">
                  Reasoning
                  <span>
                    {reasoningEfforts.length > 0
                      ? selectedModelAccountScoped
                        ? "account model"
                        : "model"
                      : "auto only"}
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
                <div className="ai-chat-reasoning-hint">
                  {activeReasoningEffort
                    ? "This reasoning effort is sent with the next backend run when this model supports it."
                    : "Auto sends no explicit reasoning effort; the provider runtime uses its default."}
                </div>
              </section>
            </div>

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
              {selectedProviderNeedsAPIKey ? (
                <div className="ai-chat-model-picker__key-setup">
                  <input
                    aria-label={`${selectedProviderLabel} API key`}
                    className="ai-chat-model-picker__key-input"
                    type="password"
                    value={apiKeyDraft}
                    placeholder="API key"
                    autoComplete="off"
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                  />
                  <button
                    className="ai-chat-secondary-button is-primary"
                    type="button"
                    disabled={!apiKeyDraft.trim() || providerSetupBusy}
                    onClick={handleSaveProviderAPIKey}
                  >
                    Save key
                  </button>
                  {providerSetupError ? (
                    <span className="ai-chat-model-picker__setup-error">
                      {providerSetupError}
                    </span>
                  ) : null}
                </div>
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
              {selectedProviderNeedsRemoteBYOKConsent ? (
                <button
                  className="ai-chat-secondary-button is-primary"
                  type="button"
                  title="Allow this remote provider to receive selected project context"
                  onClick={onAcceptRemoteBYOKProviderConsent}
                >
                  Accept remote provider consent
                </button>
              ) : null}
              {selectedProviderNeedsFrontierConsent ? (
                <button
                  className="ai-chat-secondary-button is-primary"
                  type="button"
                  title="Allow this frontier provider to receive selected project context"
                  onClick={onAcceptFrontierProviderConsent}
                >
                  Accept frontier consent
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
              <button
                className="ai-chat-secondary-button is-primary ai-chat-model-picker__use"
                type="button"
                onClick={() => setOpen(false)}
              >
                <CheckCircle2 size={14} />
                Use selection
              </button>
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
