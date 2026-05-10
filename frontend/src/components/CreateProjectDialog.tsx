import React, { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import * as App from "../wails/app";
import { selectDirectoryWithCapability } from "../shell/shellDialogs";
import { shortcuts } from "../utils/keyboard";
import { MotionShellDialogFrame } from "./ui/MotionShellDialogFrame";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectOpen: (path: string) => void;
}

export const CreateProjectDialog: React.FC<CreateProjectDialogProps> = ({
  open,
  onOpenChange,
  onProjectOpen,
}) => {
  const [projectName, setProjectName] = useState("");
  const [selectedDir, setSelectedDir] = useState("");
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setProjectName("");
    setSelectedDir("");
    setCreating(false);
  };

  const close = () => {
    if (creating) {
      return;
    }
    reset();
    onOpenChange(false);
  };

  const handleSelectDirectory = async () => {
    try {
      const path = await selectDirectoryWithCapability(
        "Select parent directory for new project",
        App.SelectDirectory,
      );
      if (path) {
        setSelectedDir(path);
      }
    } catch (error) {
      console.error("Error selecting directory:", error);
    }
  };

  const handleCreateProject = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName || !selectedDir) {
      alert("Please enter project name and select directory");
      return;
    }

    setCreating(true);
    try {
      const projectPath = await App.CreateNewProject(
        trimmedName,
        selectedDir,
        "",
      );
      reset();
      onOpenChange(false);
      onProjectOpen(projectPath);
    } catch (error) {
      console.error("Error creating project:", error);
      alert(`Failed to create project: ${error}`);
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    document.body.dataset.shellModalOpen = "true";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shortcuts.escape(event)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      delete document.body.dataset.shellModalOpen;
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, creating, projectName, selectedDir]);

  if (typeof document === "undefined") {
    return null;
  }

  const labelClass =
    "mb-2 block text-[15px] font-semibold text-[var(--text-secondary)]";
  const inputClass =
    "min-h-12 w-full rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 text-[16px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--border-default)] focus:border-[var(--border-strong)]";
  const secondaryButtonClass =
    "inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent px-6 text-[16px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <AnimatePresence>
      {open && (
        <MotionShellDialogFrame
          key="create-project-dialog"
          overlayClassName="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm"
          panelClassName="w-[min(620px,100%)] rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-8 shadow-2xl outline-none"
          panelTestId="create-project-dialog"
        >
          <div>
            <h2 className="text-[28px] font-semibold text-[var(--text-primary)]">
              Create New Project
            </h2>
            <div className="mt-2 text-[16px] text-[var(--text-secondary)]">
              Choose a name and parent directory.
            </div>
          </div>

          <div className="mt-8 space-y-5">
            <div>
              <label className={labelClass}>Project Name</label>
              <input
                type="text"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="my-awesome-project"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Parent Directory</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={selectedDir}
                  readOnly
                  placeholder="Select directory..."
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button
                  onClick={handleSelectDirectory}
                  disabled={creating}
                  className={`${secondaryButtonClass} shrink-0`}
                >
                  Browse
                </button>
              </div>
            </div>

            <div className="break-all text-[13px] text-[var(--text-muted)]">
              Project will be created at:{" "}
              {selectedDir && projectName.trim()
                ? `${selectedDir}/${projectName.trim()}`
                : "..."}
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              onClick={handleCreateProject}
              disabled={!projectName.trim() || !selectedDir || creating}
              className="min-h-12 rounded-[18px] bg-white px-8 text-[16px] font-medium text-black transition-colors hover:bg-gray-200 focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
            >
              {creating ? "Creating..." : "Create Project"}
            </button>
            <button
              onClick={close}
              disabled={creating}
              className={`${secondaryButtonClass} shrink-0 sm:order-1`}
            >
              Cancel
            </button>
          </div>
        </MotionShellDialogFrame>
      )}
    </AnimatePresence>,
    document.body,
  );
};
