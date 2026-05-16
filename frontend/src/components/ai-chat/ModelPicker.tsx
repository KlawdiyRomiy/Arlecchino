import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import type { AIProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/providers/models";
import type {
  AIProviderRuntimeDescriptor,
  AIProviderRuntimeModel,
} from "../../wails/app";
import { mergeModelOptions } from "./providerModelOptions";
import { getProviderPresentation } from "./providerPresentation";

interface ModelPickerProps {
  providers: AIProviderDescriptor[];
  selectedProvider: AIProviderDescriptor | null;
  selectedModel: string;
  providerRuntimes: AIProviderRuntimeDescriptor[];
  providerRuntimeBusy: boolean;
  providerRuntimeError: string;
  onSelectProvider: (provider: AIProviderDescriptor) => void;
  onSelectModel: (modelId: string) => void;
  onRefreshProviders: () => void;
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
  providerRuntimes,
  providerRuntimeBusy,
  providerRuntimeError,
  onSelectProvider,
  onSelectModel,
  onRefreshProviders,
  onStartProviderRuntime,
  onStopProviderRuntime,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
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
  const selectedModelLabel =
    activeModel?.displayName || activeModel?.id || selectedModel || "No model";

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
        </span>
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div
          className="ai-chat-popover ai-chat-model-picker"
          data-testid="ai-chat-model-picker"
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
                No local chat providers detected.
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
                {selectedProvider?.frontier
                  ? "Configure BYOK credentials to query provider models."
                  : "No active or installed models detected."}
              </div>
            )}
          </section>

          <div className="ai-chat-model-picker__actions">
            <button
              className="ai-chat-secondary-button"
              type="button"
              onClick={onRefreshProviders}
            >
              <RefreshCw size={14} />
              Refresh
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
              : "Select a local provider to continue."}
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
        </div>
      ) : null}
    </div>
  );
}
