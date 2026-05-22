import React from "react";
import { Plus } from "lucide-react";
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
        className={`ai-chat-context-menu__trigger${open ? " is-selected" : ""}`}
        data-testid="ai-chat-context-picker-button"
        type="button"
        aria-expanded={open}
        title="Add request context"
        onClick={onToggle}
      >
        <Plus size={15} />
        Context
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
          </AIChatPopoverFrame>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
