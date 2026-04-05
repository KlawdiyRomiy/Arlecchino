import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, FolderOpen, Sparkles, GitBranch } from "lucide-react";
import { SelectDirectory } from "../../../wailsjs/go/main/App";
import { CreateProjectDialog } from "../CreateProjectDialog";

const OPEN_PROJECT_EVENT = "arlecchino:open-project";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

interface AddProjectMenuProps {
  onProjectOpen: (path: string) => void;
}

export const AddProjectMenu: React.FC<AddProjectMenuProps> = ({
  onProjectOpen,
}) => {
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);

  const handleOpenProject = async () => {
    try {
      const path = await SelectDirectory("Choose project directory");
      if (path) onProjectOpen(path);
    } catch (error) {
      console.error("Error selecting directory:", error);
    }
  };

  React.useEffect(() => {
    const openProject = () => {
      if (!showCreateDialog) {
        void handleOpenProject();
      }
    };

    const newProject = () => {
      setShowCreateDialog(true);
    };

    window.addEventListener(OPEN_PROJECT_EVENT, openProject);
    window.addEventListener(NEW_PROJECT_EVENT, newProject);

    return () => {
      window.removeEventListener(OPEN_PROJECT_EVENT, openProject);
      window.removeEventListener(NEW_PROJECT_EVENT, newProject);
    };
  }, [showCreateDialog]);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
            title="Add project"
          >
            <Plus size={14} strokeWidth={2} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            className="z-[100] min-w-[240px] overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
          >
            <DropdownMenu.Item
              onSelect={handleOpenProject}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 text-[13px] text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              <FolderOpen size={16} />
              <span className="flex-1">Open Project</span>
              <span className="rounded-md bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                ⌘O
              </span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => setShowCreateDialog(true)}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 text-[13px] text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Sparkles size={16} />
              <span className="flex-1">New Project</span>
              <span className="rounded-md bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                ⌘N
              </span>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />

            <DropdownMenu.Item
              disabled
              className="flex items-center gap-3 px-4 py-3 text-[13px] text-[var(--text-muted)] outline-none"
            >
              <GitBranch size={16} />
              Clone Repository
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onProjectOpen={onProjectOpen}
      />
    </>
  );
};
