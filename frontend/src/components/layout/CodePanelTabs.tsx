import React from "react";
import { Copy, FileText, X } from "lucide-react";
import type { CodePanelTab } from "./MainLayout.types";
import { getCodePanelTabTestId } from "./projectEntryUtils";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "../ui/ContextActionMenu";
import { writeClipboardTextWithFallback } from "../../utils/clipboard";
import { relativeProjectPath } from "../../utils/projectPaths";

interface CodePanelTabsProps {
  tabs: CodePanelTab[];
  activePath: string;
  projectPath?: string;
  onActivate: (path: string) => void;
  onClose?: (path: string) => void;
  onCloseOthers?: (path: string) => void;
}

export const CodePanelTabs: React.FC<CodePanelTabsProps> = ({
  tabs,
  activePath,
  projectPath,
  onActivate,
  onClose,
  onCloseOthers,
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
        const contextItems: ContextActionMenuItem[] = [
          {
            label: "Activate Tab",
            icon: <FileText size={14} />,
            disabled: isActive,
            onSelect: () => onActivate(tab.path),
          },
          { separator: true },
          {
            label: "Copy Relative Path",
            icon: <Copy size={14} />,
            onSelect: () =>
              void writeClipboardTextWithFallback(
                relativeProjectPath(tab.path, projectPath),
              ),
          },
          {
            label: "Copy Absolute Path",
            icon: <Copy size={14} />,
            onSelect: () => void writeClipboardTextWithFallback(tab.path),
          },
          { separator: true },
          {
            label: "Close Tab",
            icon: <X size={14} />,
            hidden: !onClose,
            onSelect: () => onClose?.(tab.path),
          },
          {
            label: "Close Others",
            icon: <X size={14} />,
            hidden: !onCloseOthers,
            disabled: tabs.length <= 1,
            onSelect: () => onCloseOthers?.(tab.path),
          },
        ];

        return (
          <ContextActionMenu
            key={tab.path}
            items={contextItems}
            nativeScope="code-panel-tab"
            nativeTargetId={tab.path}
            nativeContext={{ path: tab.path, projectPath }}
          >
            <button
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
                color: isActive
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
              }}
              onClick={() => onActivate(tab.path)}
            >
              {tab.name}
            </button>
          </ContextActionMenu>
        );
      })}
    </div>
  );
};
