import React from "react";
import {
  Database,
  FileText,
  Monitor,
  RefreshCw,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ContextToggles } from "./types";

interface ContextToggleRowDescriptor {
  key: keyof ContextToggles;
  label: string;
  Icon: LucideIcon;
}

const contextToggleRows: ContextToggleRowDescriptor[] = [
  { key: "workspace", label: "Workspace", Icon: Database },
  { key: "currentFile", label: "Current file", Icon: FileText },
  { key: "terminalLogs", label: "Terminal logs", Icon: Monitor },
  { key: "mnemonic", label: "Mnemonic", Icon: Shield },
  { key: "continuity", label: "Continuity", Icon: RefreshCw },
  { key: "mcp", label: "MCP", Icon: SlidersHorizontal },
  { key: "skills", label: "Skills", Icon: SlidersHorizontal },
];

interface ContextToggleListProps {
  context: ContextToggles;
  showIcons?: boolean;
  onContextToggle: (key: keyof ContextToggles, value: boolean) => void;
}

export function ContextToggleList({
  context,
  showIcons = false,
  onContextToggle,
}: ContextToggleListProps) {
  return (
    <>
      {contextToggleRows.map((row) => {
        const Icon = row.Icon;
        return (
          <label className="ai-chat-toggle-row" key={row.key}>
            <span>
              {showIcons ? <Icon size={15} /> : null}
              {row.label}
            </span>
            <input
              checked={context[row.key]}
              type="checkbox"
              onChange={(event) =>
                onContextToggle(row.key, event.target.checked)
              }
            />
          </label>
        );
      })}
    </>
  );
}
