import React from "react";
import type { CodePanelTab } from "./MainLayout.types";
import { getCodePanelTabTestId } from "./projectEntryUtils";

interface CodePanelTabsProps {
  tabs: CodePanelTab[];
  activePath: string;
  onActivate: (path: string) => void;
}

export const CodePanelTabs: React.FC<CodePanelTabsProps> = ({
  tabs,
  activePath,
  onActivate,
}) => {
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div
      data-testid="code-panel-tabs"
      className="flex h-9 min-h-9 items-center gap-1 overflow-x-auto border-b border-[var(--shell-border-subtle)] bg-[color-mix(in_srgb,var(--surface-shell)_88%,transparent)] px-2"
    >
      {tabs.map((tab) => {
        const isActive = tab.path === activePath;
        return (
          <button
            key={tab.path}
            type="button"
            data-testid={getCodePanelTabTestId(tab.path)}
            title={tab.path}
            className="h-7 max-w-48 min-w-0 flex-shrink-0 truncate rounded-md border px-2.5 text-left text-xs font-medium transition-colors"
            style={{
              borderColor: isActive
                ? "var(--shell-border-strong)"
                : "transparent",
              backgroundColor: isActive
                ? "var(--surface-hover)"
                : "transparent",
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            }}
            onClick={() => onActivate(tab.path)}
          >
            {tab.name}
          </button>
        );
      })}
    </div>
  );
};
