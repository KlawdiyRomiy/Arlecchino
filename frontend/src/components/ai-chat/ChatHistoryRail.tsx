import React, { useMemo, useState } from "react";
import {
  Check,
  Circle,
  Copy,
  GripHorizontal,
  History,
  Loader2,
  MessageSquarePlus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";
import type {
  AIChatRun,
  AIChatRunEnvelope,
} from "../../../bindings/arlecchino/internal/ai/models";
import {
  compactText,
  formatRunTime,
  getActionMeta,
} from "./aiChatPresentation";

const defaultSessionId = "default";

interface ChatHistoryRailProps {
  activeSessionId: string;
  canMove: boolean;
  hydratedRuns: Record<string, AIChatRun>;
  runs: AIChatRunEnvelope[];
  searchQuery: string;
  onClose: () => void;
  onDragStart: (event: React.MouseEvent<HTMLElement>) => void;
  onNewChat: () => void;
  onDeleteSession: (sessionId: string) => void;
  onSearchChange: (value: string) => void;
  onSelectSession: (sessionId: string) => void;
}

interface ChatSessionGroup {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  count: number;
  updatedAt: string;
}

const sessionIdOf = (run: Pick<AIChatRunEnvelope, "sessionId">): string =>
  run.sessionId?.trim() || defaultSessionId;

const statusIcon = (status: string): React.ReactNode => {
  if (status === "running" || status === "queued") {
    return <Loader2 size={13} className="spin" />;
  }
  return <Circle size={13} />;
};

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return;
  await navigator.clipboard.writeText(value);
}

function buildSessionGroups(
  runs: AIChatRunEnvelope[],
  hydratedRuns: Record<string, AIChatRun>,
  activeSessionId: string,
): ChatSessionGroup[] {
  const groups = new Map<string, ChatSessionGroup>();

  for (const run of runs) {
    const id = sessionIdOf(run);
    const hydrated = hydratedRuns[run.id];
    const meta = getActionMeta(run.action);
    const existing = groups.get(id);
    const updatedAt = run.updatedAt || run.createdAt;
    const promptTitle = hydrated?.userPrompt
      ? compactText(hydrated.userPrompt, 58)
      : "";

    if (!existing) {
      groups.set(id, {
        id,
        title: promptTitle || `${meta.label} chat`,
        subtitle: `${meta.label} · ${formatRunTime(updatedAt) || "now"}`,
        status: run.status,
        count: 1,
        updatedAt,
      });
      continue;
    }

    existing.count += 1;
    if (!existing.title || existing.title.endsWith(" chat")) {
      existing.title = promptTitle || existing.title;
    }
    if (run.status === "running" || run.status === "queued") {
      existing.status = run.status;
    }
  }

  if (activeSessionId && !groups.has(activeSessionId)) {
    groups.set(activeSessionId, {
      id: activeSessionId,
      title: "New chat",
      subtitle: "Draft",
      status: "idle",
      count: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  return Array.from(groups.values()).sort(
    (a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""),
  );
}

export function ChatHistoryRail({
  activeSessionId,
  canMove,
  hydratedRuns,
  runs,
  searchQuery,
  onClose,
  onDragStart,
  onNewChat,
  onDeleteSession,
  onSearchChange,
  onSelectSession,
}: ChatHistoryRailProps) {
  const reduceMotion = useReducedMotion();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const groups = useMemo(
    () => buildSessionGroups(runs, hydratedRuns, activeSessionId),
    [activeSessionId, hydratedRuns, runs],
  );
  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter(
      (group) =>
        group.title.toLowerCase().includes(query) ||
        group.subtitle.toLowerCase().includes(query),
    );
  }, [groups, searchQuery]);
  const contextItemsForGroup = (
    group: ChatSessionGroup,
  ): ContextActionMenuItem[] => [
    {
      key: "open",
      label: "Open chat",
      icon: <Check size={13} />,
      onSelect: () => onSelectSession(group.id),
    },
    {
      key: "new-chat",
      label: "New chat",
      icon: <MessageSquarePlus size={13} />,
      onSelect: onNewChat,
    },
    { separator: true },
    {
      key: "copy-title",
      label: "Copy Chat Title",
      icon: <Copy size={13} />,
      onSelect: () => {
        void copyText(group.title);
      },
    },
    {
      key: "copy-session-id",
      label: "Copy Session ID",
      icon: <Copy size={13} />,
      onSelect: () => {
        void copyText(group.id);
      },
    },
    { separator: true },
    {
      key: "delete",
      label: "Delete chat",
      danger: true,
      icon: <Trash2 size={13} />,
      onSelect: () => setConfirmDeleteId(group.id),
    },
  ];
  return (
    <m.aside
      className="ai-chat-history-rail"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      <div
        className="ai-chat-side-section__header"
        data-ai-chat-drawer-header={canMove ? "true" : undefined}
        role="group"
        aria-label="History drawer header"
        onMouseDown={canMove ? onDragStart : undefined}
      >
        <span>
          <History size={14} />
          History
          {canMove ? (
            <span className="ai-chat-drawer-grip" title="Move history">
              <GripHorizontal size={13} />
            </span>
          ) : null}
        </span>
        <div className="ai-chat-drawer-actions">
          <button
            className="ai-chat-icon-button"
            type="button"
            title="New chat"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onNewChat}
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            className="ai-chat-icon-button"
            type="button"
            title="Close history"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <label className="ai-chat-search-field">
        <Search size={14} />
        <input
          data-testid="ai-chat-history-search"
          placeholder="Search chats"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>

      <div className="ai-chat-history-rail__list">
        <AnimatePresence initial={false}>
          {filteredGroups.map((group) => {
            const active = group.id === activeSessionId;
            const confirming = confirmDeleteId === group.id;
            return (
              <ContextActionMenu
                key={group.id}
                items={contextItemsForGroup(group)}
                nativeScope="ai-chat-history"
                nativeTargetId={group.id}
              >
                <m.div
                  className={`ai-chat-history-item${active ? " is-active" : ""}${confirming ? " is-confirming" : ""}`}
                  title={group.title}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  layout="position"
                  transition={{
                    duration: reduceMotion ? 0.1 : 0.15,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                >
                  <button
                    className="ai-chat-history-item__select"
                    type="button"
                    onClick={() => onSelectSession(group.id)}
                  >
                    <span className="ai-chat-history-item__icon">
                      {statusIcon(group.status)}
                    </span>
                    <span className="ai-chat-history-item__body">
                      <span>{group.title}</span>
                      <small>
                        {group.subtitle}
                        {group.count > 1 ? ` · ${group.count} runs` : ""}
                      </small>
                    </span>
                  </button>
                  {confirming ? (
                    <span className="ai-chat-history-item__confirm">
                      <span>Delete?</span>
                      <button
                        type="button"
                        title="Confirm delete"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => {
                          setConfirmDeleteId(null);
                          onDeleteSession(group.id);
                        }}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        title="Cancel delete"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ) : null}
                </m.div>
              </ContextActionMenu>
            );
          })}
        </AnimatePresence>
        {filteredGroups.length === 0 ? (
          <div className="ai-chat-side-empty">No chats match.</div>
        ) : null}
      </div>
    </m.aside>
  );
}
