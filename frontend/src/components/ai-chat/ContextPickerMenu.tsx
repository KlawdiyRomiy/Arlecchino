import React from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type { AIContextProviderDescriptor } from "../../../bindings/arlecchino/internal/ai/models";
import type { ContextToggles } from "./types";

interface ContextPickerMenuProps {
  context: ContextToggles;
  contextProviders: AIContextProviderDescriptor[];
  open: boolean;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
  onToggle: () => void;
}

const contextRows: Array<{ key: keyof ContextToggles; label: string }> = [
  { key: "workspace", label: "Workspace" },
  { key: "currentFile", label: "Current file" },
  { key: "terminalLogs", label: "Terminal logs" },
  { key: "mnemonic", label: "Mnemonic" },
  { key: "mcp", label: "MCP" },
  { key: "skills", label: "Skills" },
];

export function ContextPickerMenu({
  context,
  contextProviders,
  open,
  onContextToggle,
  onToggle,
}: ContextPickerMenuProps) {
  const reduceMotion = useReducedMotion();

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
          <m.div
            className="ai-chat-popover ai-chat-context-picker"
            data-testid="ai-chat-context-picker"
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
            <div className="ai-chat-popover__title">Add context</div>
            <div className="ai-chat-context-picker__toggles">
              {contextRows.map((row) => (
                <label className="ai-chat-toggle-row" key={row.key}>
                  <span>{row.label}</span>
                  <input
                    checked={context[row.key]}
                    type="checkbox"
                    onChange={(event) =>
                      onContextToggle(row.key, event.target.checked)
                    }
                  />
                </label>
              ))}
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
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
