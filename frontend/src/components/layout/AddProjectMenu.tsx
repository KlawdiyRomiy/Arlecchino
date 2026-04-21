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
            className="shell-control h-11 w-11 px-0 text-[var(--text-secondary)]"
            title="Add project"
          >
            <Plus size={18} strokeWidth={2} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            className="shell-menu-content min-w-[240px] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
          >
            <DropdownMenu.Item
              onSelect={handleOpenProject}
              className="shell-menu-item cursor-pointer text-[13px]"
            >
              <FolderOpen size={16} />
              <span className="flex-1">Open Project</span>
              <span className="shell-kbd font-mono">⌘O</span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => setShowCreateDialog(true)}
              className="shell-menu-item cursor-pointer text-[13px]"
            >
              <Sparkles size={16} />
              <span className="flex-1">New Project</span>
              <span className="shell-kbd font-mono">⌘N</span>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-[var(--shell-inline-divider)]" />

            <DropdownMenu.Item
              disabled
              className="shell-menu-item text-[13px] text-[var(--text-muted)]"
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
