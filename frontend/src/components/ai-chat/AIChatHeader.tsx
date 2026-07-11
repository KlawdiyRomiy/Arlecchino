import React from "react";
import {
  ChevronDown,
  ChevronUp,
  GitBranch,
  History,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import {
  AI_CHAT_HEADER_ITEM_LABELS,
  type AIChatHeaderDropGroup,
  type AIChatHeaderItemId,
  useAIChatHeaderReorder,
} from "./AIChatHeaderReorder";

interface AIChatHeaderProps {
  loading: boolean;
  historyOpen: boolean;
  reviewOpen: boolean;
  reviewExpanded: boolean;
  sessionSearch: string;
  sessionSearchOpen: boolean;
  sessionSearchMatchCount: number;
  sessionSearchTotalCount: number;
  onNewChat: () => void;
  onRefreshRuntime: () => void;
  onToggleHistory: () => void;
  onToggleReview: () => void;
  onToggleSessionSearch: () => void;
  onSessionSearchChange: (value: string) => void;
  onSessionSearchNext: () => void;
  onSessionSearchPrevious: () => void;
  onClearSessionSearch: () => void;
}

export function AIChatHeader({
  loading,
  historyOpen,
  reviewOpen,
  reviewExpanded,
  sessionSearch,
  sessionSearchOpen,
  sessionSearchMatchCount,
  sessionSearchTotalCount,
  onNewChat,
  onRefreshRuntime,
  onToggleHistory,
  onToggleReview,
  onToggleSessionSearch,
  onSessionSearchChange,
  onSessionSearchNext,
  onSessionSearchPrevious,
  onClearSessionSearch,
}: AIChatHeaderProps) {
  const {
    draggedItemId,
    effectiveLayout,
    handleClickCapture,
    handlePointerDown,
    leftGroupRef,
    rightGroupRef,
  } = useAIChatHeaderReorder();
  const renderHeaderItem = (
    itemId: AIChatHeaderItemId,
    group: AIChatHeaderDropGroup,
  ) => {
    const content = (() => {
      switch (itemId) {
        case "history":
          return (
            <button
              className={`ai-chat-header-button ai-chat-header-button--history${historyOpen ? " is-active" : ""}`}
              data-testid="ai-chat-history-toggle"
              type="button"
              title={historyOpen ? "Close chat history" : "Open chat history"}
              onClick={onToggleHistory}
            >
              <History size={16} />
              <span className="ai-chat-header-button__label">History</span>
            </button>
          );
        case "review":
          return (
            <button
              className={`ai-chat-header-button ai-chat-header-button--review${reviewOpen || reviewExpanded ? " is-active" : ""}`}
              data-testid="ai-chat-review-toggle"
              type="button"
              title={
                reviewOpen || reviewExpanded
                  ? "Close Git Review"
                  : "Open Git Review"
              }
              onClick={onToggleReview}
            >
              <GitBranch size={16} />
              <span className="ai-chat-header-button__label">Git Panel</span>
            </button>
          );
        case "search":
          return (
            <div
              className="ai-chat-header__menu ai-chat-header__menu--search"
              data-ai-chat-popover-scope
            >
              <button
                className={`ai-chat-header-button ai-chat-header-button--search${sessionSearchOpen ? " is-active" : ""}`}
                type="button"
                title={
                  sessionSearch
                    ? `Search session: ${sessionSearchMatchCount}/${sessionSearchTotalCount}`
                    : "Search current session"
                }
                aria-expanded={sessionSearchOpen}
                onClick={onToggleSessionSearch}
              >
                <Search size={16} />
                <span className="ai-chat-header-button__label">Search</span>
              </button>
              <AnimatePresence initial={false}>
                {sessionSearchOpen ? (
                  <div
                    className="ai-chat-popover ai-chat-header-search"
                    role="search"
                    aria-label="Search current chat session"
                  >
                    <div className="ai-chat-search-field ai-chat-search-field--header">
                      {sessionSearch ? null : <Search size={14} />}
                      <input
                        autoFocus
                        aria-label="Search current chat session"
                        data-testid="ai-chat-session-search"
                        placeholder="Search this session..."
                        value={sessionSearch}
                        onChange={(event) =>
                          onSessionSearchChange(event.target.value)
                        }
                      />
                      {sessionSearch ? (
                        <>
                          <span className="ai-chat-header-search__count">
                            {sessionSearchMatchCount}/{sessionSearchTotalCount}
                          </span>
                          <div
                            className="ai-chat-header-search__nav"
                            aria-label="Search result navigation"
                          >
                            <button
                              className="ai-chat-icon-button ai-chat-icon-button--compact"
                              type="button"
                              title="Previous search result"
                              disabled={sessionSearchTotalCount === 0}
                              onClick={onSessionSearchPrevious}
                            >
                              <ChevronUp size={16} />
                            </button>
                            <button
                              className="ai-chat-icon-button ai-chat-icon-button--compact"
                              type="button"
                              title="Next search result"
                              disabled={sessionSearchTotalCount === 0}
                              onClick={onSessionSearchNext}
                            >
                              <ChevronDown size={16} />
                            </button>
                          </div>
                          <button
                            className="ai-chat-icon-button ai-chat-icon-button--compact ai-chat-header-search__clear"
                            type="button"
                            title="Clear session search"
                            onClick={onClearSessionSearch}
                          >
                            <X size={16} />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        case "newChat":
          return (
            <button
              className="ai-chat-header-button ai-chat-header-button--new-chat"
              type="button"
              title="New chat"
              onClick={onNewChat}
            >
              <MessageSquarePlus size={16} />
              <span className="ai-chat-header-button__label">New Chat</span>
            </button>
          );
        case "refresh":
          return (
            <button
              className="ai-chat-header-button ai-chat-header-button--refresh"
              type="button"
              title="Refresh runtime"
              onClick={onRefreshRuntime}
            >
              {loading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}
              <span className="ai-chat-header-button__label">Refresh</span>
            </button>
          );
      }
    })();

    return (
      <div
        className="ai-chat-header__reorder-item"
        data-ai-chat-header-item-id={itemId}
        data-ai-chat-header-dragging={
          draggedItemId === itemId ? "true" : undefined
        }
        key={itemId}
        title={`Drag ${AI_CHAT_HEADER_ITEM_LABELS[itemId]}`}
        onClickCapture={handleClickCapture}
        onPointerDown={(event) => handlePointerDown(itemId, group, event)}
      >
        {content}
      </div>
    );
  };

  return (
    <header className="ai-chat-header">
      <div className="ai-chat-header__curtain">
        <div className="ai-chat-header__left" ref={leftGroupRef}>
          {effectiveLayout.left.map((itemId) =>
            renderHeaderItem(itemId, "left"),
          )}
        </div>

        <div className="ai-chat-header__actions" ref={rightGroupRef}>
          {effectiveLayout.right.map((itemId) =>
            renderHeaderItem(itemId, "right"),
          )}
        </div>
      </div>
    </header>
  );
}
