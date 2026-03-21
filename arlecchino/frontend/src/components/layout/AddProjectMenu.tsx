import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, FolderOpen, Sparkles, GitBranch } from "lucide-react";
import { SelectDirectory } from "../../../wailsjs/go/main/App";

interface AddProjectMenuProps {
  onProjectOpen: (path: string) => void;
}

export const AddProjectMenu: React.FC<AddProjectMenuProps> = ({
  onProjectOpen,
}) => {
  const handleOpenProject = async () => {
    try {
      const path = await SelectDirectory("Choose project directory");
      if (path) onProjectOpen(path);
    } catch (error) {
      console.error("Error selecting directory:", error);
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title="Add project"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="min-w-[180px] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg shadow-2xl overflow-hidden z-[100] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
        >
          <DropdownMenu.Item
            onSelect={handleOpenProject}
            className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors"
          >
            <FolderOpen size={14} />
            Open Project
          </DropdownMenu.Item>

          <DropdownMenu.Item
            onSelect={handleOpenProject}
            className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] cursor-pointer outline-none transition-colors"
          >
            <Sparkles size={14} />
            New Project
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="h-px bg-[var(--border-subtle)] my-1" />

          <DropdownMenu.Item
            disabled
            className="flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--text-muted)] cursor-not-allowed outline-none"
          >
            <GitBranch size={14} />
            Clone Repository
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};
