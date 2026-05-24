import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Gauge,
  Info,
  KeyRound,
  LoaderCircle,
  LogIn,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type {
  AIChatRun,
  AIConsentPolicy,
  AIModelCapabilityDescriptor,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  AIProviderAuthMode,
  AIProviderSettings,
  type AIProviderDescriptor,
} from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIProviderAuthSession,
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import {
  AIGetProviderAuthSession,
  AISaveProviderSettings,
  AITestProvider,
} from "../../wails/app";
import { openExternalUrlWithCapability } from "../../shell/browser";
import { mergeModelOptions } from "./providerModelOptions";
import {
  getProviderPresentation,
  isExternalAgentProvider,
  isFrontierModelProvider,
  isRemoteBYOKProvider,
} from "./providerPresentation";

interface ModelPickerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  renderPanel?: boolean;
  renderTrigger?: boolean;
  inlinePanel?: boolean;
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
}

const providerStatusLabel = (
  provider: AIProviderDescriptor | null,
  selectedModelLabel: string,
): string => {
  if (!provider) return "No provider";
  if (provider.status === "needs_auth") {
    if (isExternalAgentProvider(provider)) return "Need to login";
    return provider.authMode === AIProviderAuthMode.ProviderAuthModeOAuth
      ? "Need to login"
      : "API key required";
  }
  if (provider.status === "ready") {
    return selectedModelLabel && selectedModelLabel !== "No model"
      ? "Ready"
      : "Choose a model";
  }
  if (provider.status === "disabled") return "Disabled";
  return getProviderPresentation(provider).subtitle;
};

const terminalAuthSessionStatuses = new Set([
  "completed",
  "failed",
  "canceled",
  "expired",
]);

const terminalAgentAuthRunStatuses = new Set([
  "completed",
  "error",
  "canceled",
]);
const activeAgentAuthRunStatuses = new Set(["queued", "pending", "running"]);

export function ModelPicker({
  open: controlledOpen,
  onOpenChange,
  renderPanel = true,
  renderTrigger = true,
  providers,
  selectedProvider,
  selectedModel,
  selectedReasoningEffort,
  agentAuthRun: externalAgentAuthRun,
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
  onCancelAgentLogin,
  onStartProviderOAuth,
  onCancelProviderAuth,
  onAcceptExternalAgentConsent,
  onAcceptRemoteBYOKProviderConsent,
  onAcceptFrontierProviderConsent,
  onProbeModelCapability,
  onStartProviderRuntime,
  onStopProviderRuntime,
}: ModelPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [providerSetupBusy, setProviderSetupBusy] = useState(false);
  const [providerSetupError, setProviderSetupError] = useState("");
  const [oauthSession, setOAuthSession] =
    useState<AIProviderAuthSession | null>(null);
  const [oauthBusy, setOAuthBusy] = useState(false);
  const [oauthError, setOAuthError] = useState("");
  const [agentAuthRun, setAgentAuthRun] = useState<AIChatRun | null>(null);
  const reduceMotion = useReducedMotion();
  const refreshedAfterOAuthRef = useRef("");
  const observedAgentAuthRunIdsRef = useRef<Set<string>>(new Set());
  const refreshedAgentAuthRunIdsRef = useRef<Set<string>>(new Set());
  const runtime = selectedProvider
    ? providerRuntimes.find(
        (candidate) => candidate.providerId === selectedProvider.id,
      )
    : null;
  const modelOptions = mergeModelOptions(selectedProvider, runtime);
  const activeModel = selectedModel
    ? (modelOptions.find((model) => model.id === selectedModel) ?? null)
    : null;
  const selectedProviderPresentation =
    getProviderPresentation(selectedProvider);
  const selectedProviderLabel = selectedProviderPresentation.title;
  const selectedModelLabel =
    activeModel?.displayName || activeModel?.id || selectedModel || "No model";
  const selectedProviderRequiresAuth = Boolean(selectedProvider?.requiresAuth);
  const selectedProviderAuthStatus = (
    selectedProvider?.authStatus || ""
  ).toLowerCase();
  const selectedProviderAuthConfigured = Boolean(
    selectedProvider?.authConfigured ||
    selectedProviderAuthStatus === "ready" ||
    selectedProviderAuthStatus === "authenticated",
  );
  const selectedProviderNeedsAuth =
    Boolean(selectedProvider) &&
    (selectedProvider?.status === "needs_auth" ||
      (selectedProviderRequiresAuth &&
        !selectedProviderAuthConfigured &&
        selectedProvider?.status !== "degraded" &&
        selectedProvider?.status !== "error" &&
        selectedProvider?.status !== "disabled"));
  const selectedProviderAuthenticatedDegraded =
    Boolean(selectedProvider) &&
    selectedProvider?.status === "degraded" &&
    selectedProviderAuthConfigured;
  const selectedProviderIsExternalAgent =
    isExternalAgentProvider(selectedProvider);
  const selectedProviderNeedsOAuth =
    selectedProviderNeedsAuth &&
    !selectedProviderIsExternalAgent &&
    selectedProvider?.authMode === AIProviderAuthMode.ProviderAuthModeOAuth &&
    Boolean(selectedProvider?.oauthSupported);
  const selectedProviderNeedsAPIKey =
    selectedProviderNeedsAuth &&
    !selectedProviderIsExternalAgent &&
    Boolean(selectedProvider?.requiresAuth) &&
    !selectedProviderNeedsOAuth;
  const selectedProviderNeedsExternalLogin =
    selectedProviderNeedsAuth && selectedProviderIsExternalAgent;
  const selectedProviderNeedsConsent =
    selectedProviderIsExternalAgent && !consentPolicy?.externalAgentCliAccepted;
  const selectedProviderNeedsRemoteBYOKConsent =
    isRemoteBYOKProvider(selectedProvider) &&
    !consentPolicy?.remoteProvidersAccepted;
  const selectedProviderNeedsFrontierConsent =
    isFrontierModelProvider(selectedProvider) &&
    !consentPolicy?.frontierProvidersAccepted;
  const selectedProviderBlocksModelChoice =
    selectedProviderNeedsAuth || selectedProviderAuthenticatedDegraded;
  const reasoningEfforts =
    !selectedProviderBlocksModelChoice && activeModel?.reasoningEfforts
      ? activeModel.reasoningEfforts
      : [];
  const activeReasoningEffort = reasoningEfforts.includes(
    selectedReasoningEffort,
  )
    ? selectedReasoningEffort
    : "";
  const selectedModelMeta = [
    selectedProviderLabel || "No provider",
    selectedModelLabel,
    reasoningEfforts.length > 0 || activeReasoningEffort
      ? activeReasoningEffort || "auto"
      : "",
  ]
    .filter(Boolean)
    .join(" / ");
  const modelRows = selectedProviderBlocksModelChoice ? [] : modelOptions;
  const projectDefaultModel = selectedProvider?.defaultModel || "";
  const canUseProjectDefault =
    !selectedProviderBlocksModelChoice &&
    projectDefaultModel &&
    projectDefaultModel !== selectedModel;
  const effectiveAgentAuthRun = externalAgentAuthRun ?? agentAuthRun;
  const waitingForAgent =
    effectiveAgentAuthRun?.status === "running" ||
    effectiveAgentAuthRun?.status === "pending" ||
    effectiveAgentAuthRun?.status === "queued";
  const statusText = providerRuntimeError
    ? providerRuntimeError
    : oauthError || providerSetupError
      ? oauthError || providerSetupError
      : waitingForAgent
        ? "Waiting for auth"
        : selectedProviderNeedsAPIKey && selectedProvider?.authConfigured
          ? "Test provider to unlock models"
          : selectedProviderNeedsAPIKey
            ? "API key required"
            : selectedProviderAuthenticatedDegraded
              ? "Model catalog unavailable"
              : selectedProviderNeedsOAuth
                ? "Waiting for account auth"
                : selectedProviderNeedsExternalLogin
                  ? "Need to login"
                  : providerStatusLabel(selectedProvider, selectedModelLabel);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const nextOpen = typeof next === "function" ? next(open) : next;
    if (controlledOpen === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  useEffect(() => {
    if (!open || !renderPanel) return;

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
  }, [open, renderPanel]);

  useEffect(() => {
    setApiKeyDraft("");
    setProviderSetupError("");
    setOAuthError("");
    setOAuthSession(null);
    setAgentAuthRun(null);
    refreshedAfterOAuthRef.current = "";
  }, [selectedProvider?.id]);

  useEffect(() => {
    if (
      !oauthSession?.id ||
      terminalAuthSessionStatuses.has(oauthSession.status)
    ) {
      return;
    }

    const interval = window.setInterval(async () => {
      try {
        const nextSession = await AIGetProviderAuthSession(oauthSession.id);
        setOAuthSession(nextSession);
        if (
          nextSession.status === "completed" &&
          refreshedAfterOAuthRef.current !== nextSession.id
        ) {
          refreshedAfterOAuthRef.current = nextSession.id;
          onRefreshProviders();
        }
      } catch (error) {
        setOAuthError(error instanceof Error ? error.message : String(error));
      }
    }, 1500);

    return () => window.clearInterval(interval);
  }, [oauthSession?.id, oauthSession?.status, onRefreshProviders]);

  useEffect(() => {
    if (!externalAgentAuthRun?.id) return;
    setAgentAuthRun(externalAgentAuthRun);
    if (activeAgentAuthRunStatuses.has(externalAgentAuthRun.status)) {
      observedAgentAuthRunIdsRef.current.add(externalAgentAuthRun.id);
    }
  }, [
    externalAgentAuthRun?.id,
    externalAgentAuthRun?.status,
    externalAgentAuthRun,
  ]);

  useEffect(() => {
    if (!effectiveAgentAuthRun?.id) {
      return;
    }
    if (activeAgentAuthRunStatuses.has(effectiveAgentAuthRun.status)) {
      observedAgentAuthRunIdsRef.current.add(effectiveAgentAuthRun.id);
      return;
    }
    if (!terminalAgentAuthRunStatuses.has(effectiveAgentAuthRun.status)) {
      return;
    }
    if (!observedAgentAuthRunIdsRef.current.has(effectiveAgentAuthRun.id)) {
      return;
    }
    if (refreshedAgentAuthRunIdsRef.current.has(effectiveAgentAuthRun.id)) {
      return;
    }
    refreshedAgentAuthRunIdsRef.current.add(effectiveAgentAuthRun.id);
    onRefreshProviders();
  }, [
    effectiveAgentAuthRun?.id,
    effectiveAgentAuthRun?.status,
    onRefreshProviders,
  ]);

  const handleSaveProviderAPIKey = async (testAfterSave: boolean) => {
    if (!selectedProvider) return;
    const trimmedKey = apiKeyDraft.trim();
    if (!trimmedKey && !testAfterSave) return;
    setProviderSetupBusy(true);
    setProviderSetupError("");
    try {
      if (trimmedKey) {
        await AISaveProviderSettings(
          new AIProviderSettings({
            id: selectedProvider.id,
            name: selectedProviderLabel,
            kind: selectedProvider.kind,
            endpoint: selectedProvider.endpoint,
            model: selectedModel || selectedProvider.defaultModel,
            enabled: true,
            manual: selectedProvider.manual,
            secretValue: trimmedKey,
          }),
        );
        setApiKeyDraft("");
      }
      if (testAfterSave) {
        await AITestProvider(selectedProvider.id);
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

  const handleStartOAuth = async () => {
    if (!selectedProvider || !onStartProviderOAuth) return;
    setOAuthBusy(true);
    setOAuthError("");
    try {
      const session = await Promise.resolve(
        onStartProviderOAuth(selectedProvider),
      );
      if (!session) return;
      setOAuthSession(session);
      if (!session.authorizationUrl) {
        setOAuthError("OAuth session did not return a login URL.");
        return;
      }
      const opened = await openExternalUrlWithCapability(
        session.authorizationUrl,
      );
      if (!opened) {
        setOAuthError("Could not open the provider login page.");
      }
    } catch (error) {
      setOAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setOAuthBusy(false);
    }
  };

  const handleCancelOAuth = async () => {
    if (!oauthSession?.id) return;
    setOAuthBusy(true);
    setOAuthError("");
    try {
      const canceled = onCancelProviderAuth
        ? await Promise.resolve(onCancelProviderAuth(oauthSession.id))
        : null;
      setOAuthSession(
        canceled ?? { ...oauthSession, status: "canceled", error: "" },
      );
    } catch (error) {
      setOAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setOAuthBusy(false);
    }
  };

  const handleStartAgentAuth = async () => {
    if (!selectedProvider) return;
    setProviderSetupBusy(true);
    setProviderSetupError("");
    try {
      const run = await Promise.resolve(onStartAgentLogin(selectedProvider));
      if (run) {
        observedAgentAuthRunIdsRef.current.add(run.id);
        setAgentAuthRun(run);
      }
    } catch (error) {
      setProviderSetupError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setProviderSetupBusy(false);
    }
  };

  const handleCancelAgentAuth = async () => {
    if (!effectiveAgentAuthRun?.id || !onCancelAgentLogin) return;
    setProviderSetupBusy(true);
    try {
      await Promise.resolve(onCancelAgentLogin(effectiveAgentAuthRun.id));
      setAgentAuthRun({ ...effectiveAgentAuthRun, status: "canceled" });
    } finally {
      setProviderSetupBusy(false);
    }
  };

  const probeStatus = selectedModelCapability?.probeStatus || "";
  const probeLabel =
    probeStatus === "verified"
      ? "Probe verified"
      : probeStatus === "pending"
        ? "Probe running"
        : probeStatus
          ? "Probe issue"
          : "Probe";
  const waitingForOAuth =
    oauthSession?.status === "waiting" || oauthSession?.status === "opening";

  const renderAuthBlock = () => {
    if (!selectedProvider) {
      return (
        <section className="ai-chat-model-picker__auth-card">
          <strong>No provider selected</strong>
          <p>Refresh providers or connect a local runtime.</p>
        </section>
      );
    }

    if (selectedProviderNeedsAPIKey) {
      return (
        <section className="ai-chat-model-picker__auth-card">
          <div className="ai-chat-model-picker__auth-header">
            <strong>API key required</strong>
            <span>{selectedProviderLabel}</span>
          </div>
          <div className="ai-chat-model-picker__auth-input-row">
            <KeyRound size={16} />
            <input
              aria-label={`${selectedProviderLabel} API key`}
              type="password"
              value={apiKeyDraft}
              placeholder={
                selectedProvider.kind === "anthropic" ? "sk-ant-..." : "sk-..."
              }
              autoComplete="off"
              onChange={(event) => setApiKeyDraft(event.target.value)}
            />
            <button
              className="ai-chat-model-picker__auth-button"
              type="button"
              disabled={!apiKeyDraft.trim() || providerSetupBusy}
              onClick={() => void handleSaveProviderAPIKey(false)}
            >
              <KeyRound size={15} />
              Save key
            </button>
            <button
              className="ai-chat-model-picker__auth-button"
              type="button"
              disabled={
                providerSetupBusy ||
                (!apiKeyDraft.trim() && !selectedProvider.authConfigured)
              }
              onClick={() => void handleSaveProviderAPIKey(true)}
            >
              <Gauge size={15} />
              Test
            </button>
          </div>
          <p>Stored locally in the credential vault</p>
          {providerSetupError ? (
            <small className="ai-chat-model-picker__auth-error">
              {providerSetupError}
            </small>
          ) : null}
        </section>
      );
    }

    if (selectedProviderNeedsOAuth) {
      return (
        <section className="ai-chat-model-picker__auth-card">
          <div className="ai-chat-model-picker__auth-header">
            <strong>{selectedProviderLabel} account</strong>
            {waitingForOAuth ? (
              <span className="ai-chat-model-picker__auth-status">
                <LoaderCircle size={15} />
                Waiting for auth
              </span>
            ) : null}
          </div>
          <div className="ai-chat-model-picker__auth-actions">
            <button
              className="ai-chat-model-picker__auth-button is-wide"
              type="button"
              disabled={oauthBusy || waitingForOAuth}
              onClick={() => void handleStartOAuth()}
            >
              <ExternalLink size={16} />
              Open login page
            </button>
            <button
              className="ai-chat-model-picker__auth-button"
              type="button"
              disabled={!waitingForOAuth || oauthBusy}
              onClick={() => void handleCancelOAuth()}
            >
              Cancel
            </button>
          </div>
          <p>
            <Info size={15} />
            Return here after browser sign-in
          </p>
          {oauthError || oauthSession?.error ? (
            <small className="ai-chat-model-picker__auth-error">
              {oauthError || oauthSession?.error}
            </small>
          ) : null}
        </section>
      );
    }

    if (selectedProviderAuthenticatedDegraded) {
      return (
        <section className="ai-chat-model-picker__auth-card is-degraded">
          <div className="ai-chat-model-picker__auth-header">
            <strong>Signed in</strong>
            <span>{selectedProviderLabel}</span>
          </div>
          <p>
            <Info size={15} />
            {selectedProvider.reason || "Model catalog unavailable."}
          </p>
          <div className="ai-chat-model-picker__auth-actions">
            <button
              className="ai-chat-model-picker__auth-button is-wide"
              type="button"
              disabled={providerSetupBusy}
              onClick={onRefreshProviders}
            >
              <RefreshCw size={15} />
              Retry catalog
            </button>
          </div>
        </section>
      );
    }

    if (selectedProviderNeedsExternalLogin) {
      return (
        <section className="ai-chat-model-picker__auth-card">
          <div className="ai-chat-model-picker__auth-header">
            <strong>{selectedProviderLabel} login</strong>
            {waitingForAgent ? (
              <span className="ai-chat-model-picker__auth-status">
                <LoaderCircle size={15} />
                Waiting for auth
              </span>
            ) : null}
          </div>
          <div className="ai-chat-model-picker__auth-actions">
            <button
              className="ai-chat-model-picker__auth-button is-wide"
              type="button"
              disabled={providerSetupBusy || waitingForAgent}
              onClick={() => void handleStartAgentAuth()}
            >
              <LogIn size={16} />
              Login
            </button>
            <button
              className="ai-chat-model-picker__auth-button"
              type="button"
              disabled={!waitingForAgent || providerSetupBusy}
              onClick={() => void handleCancelAgentAuth()}
            >
              Cancel
            </button>
          </div>
          <p>Auth runs in the official external agent runtime.</p>
        </section>
      );
    }

    if (
      selectedProviderNeedsConsent ||
      selectedProviderNeedsRemoteBYOKConsent ||
      selectedProviderNeedsFrontierConsent
    ) {
      return (
        <section className="ai-chat-model-picker__auth-card">
          <div className="ai-chat-model-picker__auth-header">
            <strong>Consent required</strong>
            <span>{selectedProviderLabel}</span>
          </div>
          <div className="ai-chat-model-picker__auth-actions">
            {selectedProviderNeedsConsent ? (
              <button
                className="ai-chat-model-picker__auth-button"
                type="button"
                onClick={onAcceptExternalAgentConsent}
              >
                <ShieldCheck size={15} />
                Accept CLI consent
              </button>
            ) : null}
            {selectedProviderNeedsRemoteBYOKConsent ? (
              <button
                className="ai-chat-model-picker__auth-button"
                type="button"
                onClick={onAcceptRemoteBYOKProviderConsent}
              >
                <ShieldCheck size={15} />
                Accept remote consent
              </button>
            ) : null}
            {selectedProviderNeedsFrontierConsent ? (
              <button
                className="ai-chat-model-picker__auth-button"
                type="button"
                onClick={onAcceptFrontierProviderConsent}
              >
                <ShieldCheck size={15} />
                Accept frontier consent
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    return null;
  };

  return (
    <div className="ai-chat-composer__model" data-ai-chat-model-picker-scope>
      {renderTrigger ? (
        <button
          className="ai-chat-composer__model-button"
          type="button"
          aria-expanded={open}
          aria-label="Choose provider and model"
          title={selectedModelMeta}
          onClick={() => setOpen((current) => !current)}
        >
          <span
            className={`ai-chat-composer__model-dot is-${selectedProviderPresentation.tone}`}
          />
          <span className="ai-chat-composer__model-label">
            {selectedModelMeta}
          </span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      ) : null}

      {renderPanel ? (
        <AnimatePresence initial={false}>
          {open ? (
            <m.div
              className="ai-chat-popover ai-chat-model-picker"
              data-testid="ai-chat-model-picker"
              layout
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 8, scale: 0.97 }
              }
              animate={
                reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 6, scale: 0.975 }
              }
              transition={{
                duration: reduceMotion ? 0.1 : undefined,
                type: reduceMotion ? "tween" : "spring",
                stiffness: 520,
                damping: 38,
                mass: 0.72,
              }}
            >
              <div className="ai-chat-model-picker__header">
                <h3>Model</h3>
                <button
                  className="ai-chat-icon-button"
                  type="button"
                  title="Close model picker"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="ai-chat-model-picker__tabs">
                {providers.map((provider) => {
                  const presentation = getProviderPresentation(provider);
                  const selected = provider.id === selectedProvider?.id;
                  return (
                    <button
                      key={provider.id}
                      className={`ai-chat-model-picker__tab is-${presentation.tone}${selected ? " is-selected" : ""}`}
                      type="button"
                      aria-pressed={selected}
                      disabled={!presentation.selectable}
                      title={presentation.rawReason || presentation.subtitle}
                      onClick={() => onSelectProvider(provider)}
                    >
                      {presentation.title}
                    </button>
                  );
                })}
              </div>

              {!selectedProviderBlocksModelChoice ? (
                <section className="ai-chat-model-picker__model-list">
                  {modelRows.length === 0 ? (
                    <div className="ai-chat-model-picker__empty">
                      No models returned by this provider.
                    </div>
                  ) : null}
                  {modelRows.map((model) => {
                    const active = selectedModel === model.id;
                    const canStart =
                      Boolean(selectedProvider?.local) &&
                      !isExternalAgentProvider(selectedProvider) &&
                      model.runnable &&
                      (!runtime?.running || !model.active);
                    return (
                      <div
                        className={`ai-chat-model-picker__model-row${active ? " is-selected" : ""}`}
                        key={`${model.id}-${model.path || model.source}`}
                      >
                        <button
                          type="button"
                          aria-pressed={active}
                          title={model.path || model.reason || model.id}
                          onClick={() => onSelectModel(model.id)}
                        >
                          <span>{model.displayName || model.id}</span>
                          {active ? (
                            <CheckCircle2 size={17} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                        {canStart && selectedProvider ? (
                          <button
                            className="ai-chat-model-picker__runtime-button"
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
                </section>
              ) : null}

              {renderAuthBlock()}

              {!selectedProviderBlocksModelChoice &&
              reasoningEfforts.length > 0 ? (
                <section className="ai-chat-model-picker__reasoning">
                  <strong>Reasoning</strong>
                  <div className="ai-chat-model-picker__segments">
                    <button
                      type="button"
                      className={!activeReasoningEffort ? "is-selected" : ""}
                      onClick={() => onSelectReasoningEffort("")}
                    >
                      Auto
                    </button>
                    {reasoningEfforts.map((effort) => (
                      <button
                        key={effort}
                        type="button"
                        className={
                          activeReasoningEffort === effort ? "is-selected" : ""
                        }
                        onClick={() => onSelectReasoningEffort(effort)}
                      >
                        {effort}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <footer
                className={`ai-chat-model-picker__footer${providerRuntimeError || oauthError || providerSetupError ? " is-error" : ""}`}
              >
                <span>
                  <span
                    className={`ai-chat-composer__model-dot is-${providerRuntimeError || oauthError || providerSetupError ? "error" : selectedProviderPresentation.tone}`}
                  />
                  {statusText}
                </span>
                <div className="ai-chat-model-picker__footer-actions">
                  {canUseProjectDefault ? (
                    <button
                      type="button"
                      onClick={() => onSelectModel(projectDefaultModel)}
                    >
                      Project default
                    </button>
                  ) : null}
                  <button type="button" onClick={onRefreshProviders}>
                    <RefreshCw size={13} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    disabled={!selectedProvider || providerRuntimeBusy}
                    title={selectedModelCapability?.probeError || probeLabel}
                    onClick={onProbeModelCapability}
                  >
                    <Gauge size={13} />
                    {probeLabel}
                  </button>
                  {runtime?.running && runtime.managed && selectedProvider ? (
                    <button
                      type="button"
                      disabled={providerRuntimeBusy}
                      onClick={() => onStopProviderRuntime(selectedProvider.id)}
                    >
                      <Square size={13} />
                      Stop
                    </button>
                  ) : null}
                </div>
              </footer>
            </m.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </div>
  );
}
