import React from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import type { AIContextProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/models";
import type { ContextToggles } from "./types";
import { AIChatPopoverFrame } from "./AIChatPopoverFrame";
import { ContextToggleList } from "./contextToggleRows";

interface ContextPickerMenuProps {
  context: ContextToggles;
  contextProviders: AIContextProviderDescriptor[];
  open: boolean;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onToggle: () => void;
}

export function ContextPickerMenu({
  context,
  contextProviders,
  open,
  onContextToggle,
  onToggle,
}: ContextPickerMenuProps) {
  return (
    <div className="ai-chat-context-menu" data-ai-chat-popover-scope>
      <button
        className={`ai-chat-mode-button ai-chat-add-button${open ? " is-selected" : ""}`}
        data-testid="ai-chat-context-picker-button"
        type="button"
        aria-expanded={open}
        title="Add agent or skill context"
        onClick={onToggle}
      >
        <Plus size={15} />
        Add
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <AIChatPopoverFrame
            className="ai-chat-context-picker"
            data-testid="ai-chat-context-picker"
          >
            <div className="ai-chat-popover__title">Add context</div>
            <div className="ai-chat-context-picker__toggles">
              <ContextToggleList
                context={context}
                onContextToggle={onContextToggle}
              />
            </div>
            {contextProviders.length > 0 ? (
              <div className="ai-chat-popover__section">
                <div className="ai-chat-popover__title">Runtime providers</div>
                <div className="ai-chat-context-provider-list">
                  {contextProviders.map((provider) => (
                    <span
                      className="ai-chat-context-provider"
                      key={provider.id}
                      title={provider.description}
                    >
                      <span
                        className={`ai-chat-context-provider__dot is-${
                          provider.enabled && provider.available
                            ? "ready"
                            : "disabled"
                        }`}
                      />
                      {provider.name || provider.id}
                      {provider.id === "skills" ||
                      provider.name === "Skills" ? (
                        <CheckCircle2 size={12} />
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </AIChatPopoverFrame>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
