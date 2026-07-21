import React, { useMemo } from "react";
import {
  AlertCircle,
  Files,
  GitBranch,
  Plus,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

import { useEditorStore } from "../../stores/editorStore";
import {
  getFileExtensionLabel,
  getFileExtensionLabelColor,
} from "../../utils/fileExtensionLabel";

export interface BrowserRailPanels {
  explorer: boolean;
  git: boolean;
  problems: boolean;
  terminal: boolean;
  aiChat: boolean;
}

export interface BrowserRailProps {
  projectPath: string;
  panels: BrowserRailPanels;
  aiChatAvailable: boolean;
  onToggleExplorer: () => void;
  onToggleGit: () => void;
  onToggleProblems: () => void;
  onToggleTerminal: () => void;
  onToggleAIChat: () => void;
  onOpenCommandBar: () => void;
}

const getProjectInitial = (projectPath: string): string => {
  const name = projectPath.split(/[/\\]/).filter(Boolean).at(-1) ?? "";
  return (name[0] ?? "A").toUpperCase();
};

const getProjectName = (projectPath: string): string =>
  projectPath.split(/[/\\]/).filter(Boolean).at(-1) ?? "Project";

/**
 * Experimental Arc-inspired vertical rail. It is pure chrome: panels remain
 * floating/detachable, the rail only mirrors visibility and triggers the
 * existing MainLayout toggles.
 */
export const BrowserRail: React.FC<BrowserRailProps> = ({
  projectPath,
  panels,
  aiChatAvailable,
  onToggleExplorer,
  onToggleGit,
  onToggleProblems,
  onToggleTerminal,
  onToggleAIChat,
  onOpenCommandBar,
}) => {
  const panes = useEditorStore((state) => state.panes);
  const tabs = useEditorStore((state) => state.tabs);
  const activePaneId = useEditorStore((state) => state.activePaneId);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const setActivePane = useEditorStore((state) => state.setActivePane);

  const activePane =
    panes.find((entry) => entry.id === activePaneId) ?? panes[0];
  const railTabs = useMemo(() => {
    if (!activePane) {
      return [] as Array<{ id: string; name: string; isDirty: boolean }>;
    }
    return activePane.tabIds
      .map((tabId) => tabs.get(tabId))
      .filter((tab) => tab !== undefined)
      .map((tab) => ({ id: tab.id, name: tab.name, isDirty: tab.isDirty }));
  }, [activePane, tabs]);
  const activeTabId = activePane?.activeTabId ?? null;

  const activateRailTab = (tabId: string) => {
    if (!activePaneId) {
      return;
    }
    setActivePane(activePaneId);
    setActiveTab(activePaneId, tabId);
  };

  return (
    <aside className="browser-rail" data-testid="browser-rail">
      <button
        type="button"
        className="browser-rail-space"
        onClick={onToggleExplorer}
        title={`${getProjectName(projectPath)} — toggle Explorer`}
        aria-label="Toggle Explorer"
        aria-pressed={panels.explorer}
      >
        {getProjectInitial(projectPath)}
      </button>

      <div className="browser-rail-divider" />

      <div className="browser-rail-tabs">
        {railTabs.map((tab) => {
          const label = getFileExtensionLabel(tab.name);
          return (
            <button
              key={tab.id}
              type="button"
              className={`browser-rail-tab${
                tab.id === activeTabId ? " is-active" : ""
              }`}
              style={{ color: getFileExtensionLabelColor(label) }}
              onClick={() => activateRailTab(tab.id)}
              title={tab.name}
              aria-label={tab.name}
              aria-current={tab.id === activeTabId ? "page" : undefined}
            >
              <span className="browser-rail-tab-file">{label}</span>
              {tab.isDirty ? <span className="browser-rail-tab-dot" /> : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="browser-rail-tab"
        onClick={onOpenCommandBar}
        title="Command bar"
        aria-label="Open command bar"
      >
        <Plus size={16} />
      </button>

      <div className="browser-rail-divider" />

      <div className="browser-rail-section">
        <button
          type="button"
          className={`browser-rail-tab${panels.git ? " is-active" : ""}`}
          onClick={onToggleGit}
          title="Git"
          aria-label="Toggle Git panel"
          aria-pressed={panels.git}
        >
          <GitBranch size={16} />
        </button>
        <button
          type="button"
          className={`browser-rail-tab${panels.problems ? " is-active" : ""}`}
          onClick={onToggleProblems}
          title="Problems"
          aria-label="Toggle Problems panel"
          aria-pressed={panels.problems}
        >
          <AlertCircle size={16} />
        </button>
        <button
          type="button"
          className={`browser-rail-tab${panels.terminal ? " is-active" : ""}`}
          onClick={onToggleTerminal}
          title="Terminal"
          aria-label="Toggle Terminal panel"
          aria-pressed={panels.terminal}
        >
          <SquareTerminal size={16} />
        </button>
        {aiChatAvailable ? (
          <button
            type="button"
            className={`browser-rail-tab${panels.aiChat ? " is-active" : ""}`}
            onClick={onToggleAIChat}
            title="AI Chat"
            aria-label="Toggle AI Chat panel"
            aria-pressed={panels.aiChat}
          >
            <Sparkles size={16} />
          </button>
        ) : null}
        <button
          type="button"
          className={`browser-rail-tab${panels.explorer ? " is-active" : ""}`}
          onClick={onToggleExplorer}
          title="Explorer"
          aria-label="Toggle Explorer panel"
          aria-pressed={panels.explorer}
        >
          <Files size={16} />
        </button>
      </div>
    </aside>
  );
};
