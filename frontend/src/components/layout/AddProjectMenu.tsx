import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, FolderOpen, Sparkles, GitBranch } from "lucide-react";
import { SelectDirectory } from "../../wails/app";
import { selectDirectoryWithCapability } from "../../shell/shellDialogs";
import { CloneRepositoryDialog } from "../CloneRepositoryDialog";
import { CreateProjectDialog } from "../CreateProjectDialog";

const OPEN_PROJECT_EVENT = "arlecchino:open-project";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

interface AddProjectMenuProps {
  onProjectOpen: (path: string) => void | Promise<void>;
}

export const AddProjectMenu: React.FC<AddProjectMenuProps> = ({
  onProjectOpen,
}) => {
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showCloneDialog, setShowCloneDialog] = React.useState(false);

  const handleOpenProject = async () => {
    try {
      const path = await selectDirectoryWithCapability(
        "Choose project directory",
        SelectDirectory,
      );
      if (path) onProjectOpen(path);
    } catch (error) {
      console.error("Error selecting directory:", error);
    }
  };

  React.useEffect(() => {
    const openProject = () => {
      if (!showCreateDialog && !showCloneDialog) {
        void handleOpenProject();
      }
    };

    const newProject = () => {
      if (!showCloneDialog) {
        setShowCreateDialog(true);
      }
    };

    window.addEventListener(OPEN_PROJECT_EVENT, openProject);
    window.addEventListener(NEW_PROJECT_EVENT, newProject);

    return () => {
      window.removeEventListener(OPEN_PROJECT_EVENT, openProject);
      window.removeEventListener(NEW_PROJECT_EVENT, newProject);
    };
  }, [showCreateDialog, showCloneDialog]);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="shell-control h-12 w-12 px-0 text-[var(--text-secondary)]"
            title="Add project"
          >
            <Plus size={23} strokeWidth={2} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            className="shell-menu-content min-w-[240px] animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
            data-shell-menu-content
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
              onSelect={() => setShowCloneDialog(true)}
              className="shell-menu-item cursor-pointer text-[13px]"
            >
              <GitBranch size={16} />
              <span className="flex-1">Clone Repository</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onProjectOpen={onProjectOpen}
      />
      <CloneRepositoryDialog
        open={showCloneDialog}
        onOpenChange={setShowCloneDialog}
        onProjectOpen={onProjectOpen}
      />
    </>
  );
};
