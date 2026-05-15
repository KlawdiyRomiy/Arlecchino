import React, { useMemo } from "react";
import {
  Circle,
  GripHorizontal,
  History,
  Loader2,
  MessageSquarePlus,
  Search,
  X,
} from "lucide-react";
import { m, type PanInfo } from "framer-motion";
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
  onMove: (delta: number) => void;
  onNewChat: () => void;
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
  onMove,
  onNewChat,
  onSearchChange,
  onSelectSession,
}: ChatHistoryRailProps) {
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
  const handleDrag = (
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    onMove(info.delta.x);
  };

  return (
    <aside className="ai-chat-history-rail">
      <div className="ai-chat-side-section__header">
        <span>
          <History size={14} />
          History
          {canMove ? (
            <m.span
              className="ai-chat-drawer-grip"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0}
              dragMomentum={false}
              onDrag={handleDrag}
              title="Move history"
            >
              <GripHorizontal size={13} />
            </m.span>
          ) : null}
        </span>
        <div className="ai-chat-drawer-actions">
          <button
            className="ai-chat-icon-button"
            type="button"
            title="New chat"
            onClick={onNewChat}
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            className="ai-chat-icon-button"
            type="button"
            title="Close history"
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
        {filteredGroups.map((group) => {
          const active = group.id === activeSessionId;
          return (
            <button
              className={`ai-chat-history-item${active ? " is-active" : ""}`}
              key={group.id}
              type="button"
              title={group.title}
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
          );
        })}
        {filteredGroups.length === 0 ? (
          <div className="ai-chat-side-empty">No chats match.</div>
        ) : null}
      </div>
    </aside>
  );
}
