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

interface ModelPickerProps {
  selectedProvider: AIProviderDescriptor | null;
  selectedModel: string;
  providerRuntimes: AIProviderRuntimeDescriptor[];
  providerRuntimeBusy: boolean;
  providerRuntimeError: string;
  onSelectModel: (modelId: string) => void;
  onRefreshProviders: () => void;
  onStartProviderRuntime: (
    provider: AIProviderDescriptor,
    model: AIProviderRuntimeModel,
  ) => void;
  onStopProviderRuntime: (providerId: string) => void;
}

export function ModelPicker({
  selectedProvider,
  selectedModel,
  providerRuntimes,
  providerRuntimeBusy,
  providerRuntimeError,
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
        title={
          activeModel?.path ||
          activeModel?.reason ||
          activeModel?.displayName ||
          activeModel?.id ||
          "Choose model"
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ai-chat-composer__model-dot" />
        <span className="ai-chat-composer__model-body">
          <span>
            {activeModel?.displayName ||
              activeModel?.id ||
              selectedModel ||
              "Choose model"}
          </span>
          <small>
            {selectedProviderLabel || "No provider"}
            {runtime?.running ? " · running" : ""}
          </small>
        </span>
        <ChevronDown size={14} />
      </button>

      {open ? (
        <div
          className="ai-chat-popover ai-chat-model-picker"
          data-testid="ai-chat-model-picker"
        >
          <div className="ai-chat-popover__title">Models</div>
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
