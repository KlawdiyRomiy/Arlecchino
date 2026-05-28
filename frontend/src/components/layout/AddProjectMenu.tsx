import React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Plus, FolderOpen, Sparkles, GitBranch } from "lucide-react";
import { CloneRepositoryDialog } from "../CloneRepositoryDialog";
import { CreateProjectDialog } from "../CreateProjectDialog";
import { MotionDropdownContent } from "../ui/MotionDropdownContent";

const OPEN_TARGET_EVENT = "arlecchino:open";
const NEW_PROJECT_EVENT = "arlecchino:new-project";

interface AddProjectMenuProps {
  onProjectOpen: (path: string) => void | Promise<void>;
  onMenuOpenChange?: (open: boolean) => void;
}

export const AddProjectMenu: React.FC<AddProjectMenuProps> = ({
  onProjectOpen,
  onMenuOpenChange,
}) => {
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showCloneDialog, setShowCloneDialog] = React.useState(false);

  const handleOpenTarget = () => {
    window.dispatchEvent(new Event(OPEN_TARGET_EVENT));
  };

  React.useEffect(() => {
    const newProject = () => {
      if (!showCloneDialog) {
        setShowCreateDialog(true);
      }
    };

    window.addEventListener(NEW_PROJECT_EVENT, newProject);

    return () => {
      window.removeEventListener(NEW_PROJECT_EVENT, newProject);
    };
  }, [showCreateDialog, showCloneDialog]);

  return (
    <>
      <DropdownMenu.Root onOpenChange={onMenuOpenChange}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="shell-control h-12 w-12 px-0 text-[var(--text-secondary)]"
            title="Add project"
          >
            <Plus size={23} strokeWidth={2} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <MotionDropdownContent
            align="start"
            sideOffset={8}
            className="shell-menu-content min-w-[240px]"
            data-shell-menu-content
          >
            <DropdownMenu.Item
              onSelect={handleOpenTarget}
              className="shell-menu-item cursor-pointer text-[13px]"
            >
              <FolderOpen size={16} />
              <span className="flex-1">Open...</span>
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
          </MotionDropdownContent>
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
