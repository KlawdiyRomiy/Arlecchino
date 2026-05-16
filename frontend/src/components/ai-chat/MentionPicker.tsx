import React, { useEffect, useMemo, useRef } from "react";
import {
  Bot,
  Boxes,
  FileText,
  Layers,
  ListChecks,
  Slash,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import {
  AIChatMentionKind,
  type AIChatMentionCandidate,
  type AIChatMentionTrigger,
} from "../../../bindings/arlecchino/internal/ai/models";

interface MentionPickerProps {
  open: boolean;
  trigger: AIChatMentionTrigger | null;
  candidates: AIChatMentionCandidate[];
  selectedIndex: number;
  loading: boolean;
  onSelect: (candidate: AIChatMentionCandidate) => void;
  onHover: (index: number) => void;
}

const iconForKind = (kind: AIChatMentionKind) => {
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

const groupedCandidates = (candidates: AIChatMentionCandidate[]) => {
  const order: string[] = [];
  const groups = new Map<string, AIChatMentionCandidate[]>();
  candidates.forEach((candidate) => {
    const group = candidate.group || "Suggestions";
    if (!groups.has(group)) {
      order.push(group);
      groups.set(group, []);
    }
    groups.get(group)?.push(candidate);
  });
  return order.map((group) => ({
    group,
    candidates: groups.get(group) ?? [],
  }));
};

export function MentionPicker({
  open,
  trigger,
  candidates,
  selectedIndex,
  loading,
  onSelect,
  onHover,
}: MentionPickerProps) {
  const reduceMotion = useReducedMotion();
  const groups = useMemo(() => groupedCandidates(candidates), [candidates]);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  let flatIndex = -1;

  useEffect(() => {
    if (!open || selectedIndex < 0) return;
    rowRefs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [open, selectedIndex]);

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div
          id="ai-chat-mention-picker"
          className="ai-chat-popover ai-chat-mention-picker"
          data-ai-chat-popover-scope
          data-testid="ai-chat-mention-picker"
          role="listbox"
          aria-label={
            trigger === "/" ? "Command suggestions" : "Mention suggestions"
          }
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          initial={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }
          }
          animate={
            reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }
          }
          exit={
            reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.985 }
          }
          transition={{
            duration: reduceMotion ? 0.1 : 0.16,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <div className="ai-chat-popover__title">
            {trigger === "/" ? "Commands" : "Mentions"}
          </div>
          {loading ? (
            <div className="ai-chat-mention-picker__empty">Loading...</div>
          ) : groups.length === 0 ? (
            <div className="ai-chat-mention-picker__empty">No matches</div>
          ) : (
            groups.map(({ group, candidates: groupCandidates }) => (
              <div className="ai-chat-mention-picker__section" key={group}>
                <div className="ai-chat-mention-picker__group">{group}</div>
                {groupCandidates.map((candidate) => {
                  flatIndex += 1;
                  const rowIndex = flatIndex;
                  const Icon = iconForKind(candidate.kind);
                  const disabled = Boolean(candidate.disabledReason);
                  return (
                    <button
                      key={candidate.id}
                      className={`ai-chat-mention-picker__row${
                        selectedIndex === rowIndex ? " is-active" : ""
                      }${disabled ? " is-disabled" : ""}`}
                      data-testid="ai-chat-mention-option"
                      type="button"
                      disabled={disabled}
                      id={`ai-chat-mention-option-${rowIndex}`}
                      role="option"
                      aria-selected={selectedIndex === rowIndex}
                      aria-disabled={disabled}
                      ref={(element) => {
                        rowRefs.current[rowIndex] = element;
                      }}
                      onMouseEnter={() => onHover(rowIndex)}
                      onClick={() => {
                        if (!disabled) onSelect(candidate);
                      }}
                    >
                      <span className="ai-chat-mention-picker__icon">
                        <Icon size={15} />
                      </span>
                      <span className="ai-chat-mention-picker__text">
                        <span className="ai-chat-mention-picker__label">
                          {candidate.label}
                        </span>
                        <span className="ai-chat-mention-picker__detail">
                          {candidate.disabledReason ||
                            candidate.detail ||
                            candidate.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}
