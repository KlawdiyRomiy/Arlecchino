import React, { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import * as App from "../wails/app";
import { selectDirectoryWithCapability } from "../shell/shellDialogs";
import {
  isShellCapabilityUsable,
  useShellCapabilities,
} from "../shell/shellCapabilities";
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
  const [error, setError] = useState("");
  const shellCapabilities = useShellCapabilities();
  const dialogsCapability = shellCapabilities.capabilities.dialogs;
  const dialogsAvailable = isShellCapabilityUsable(dialogsCapability);
  const dialogsUnavailableReason =
    dialogsCapability.reason ||
    "Native dialogs are available only in the packaged Wails shell.";

  const reset = () => {
    setProjectName("");
    setSelectedDir("");
    setCreating(false);
    setError("");
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
        setError("");
      }
    } catch (error) {
      console.error("Error selecting directory:", error);
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCreateProject = async () => {
    const trimmedName = projectName.trim();
    if (!trimmedName || !selectedDir) {
      setError("Please enter project name and select directory");
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
      setError(`Failed to create project: ${error}`);
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    document.body.dataset.shellModalOpen = "true";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.body.dataset.closeConfirmationOpen === "true") {
        return;
      }

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
    "shell-dialog-action shell-dialog-action-secondary";

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
                  type="button"
                  onClick={handleSelectDirectory}
                  disabled={creating || !dialogsAvailable}
                  className={`${secondaryButtonClass} shrink-0`}
                  title={dialogsAvailable ? "Browse" : dialogsUnavailableReason}
                >
                  Browse
                </button>
              </div>
              {!dialogsAvailable ? (
                <div className="mt-2 text-[13px] text-[var(--text-muted)]">
                  {dialogsUnavailableReason}
                </div>
              ) : null}
            </div>

            <div className="break-all text-[13px] text-[var(--text-muted)]">
              Project will be created at:{" "}
              {selectedDir && projectName.trim()
                ? `${selectedDir}/${projectName.trim()}`
                : "..."}
            </div>
            {error ? (
              <div className="rounded-[16px] border border-[var(--status-error)] bg-[var(--bg-tertiary)] px-4 py-3 text-[13px] text-[var(--status-error)]">
                {error}
              </div>
            ) : null}
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={handleCreateProject}
              disabled={!projectName.trim() || !selectedDir || creating}
              className="shell-dialog-action shell-dialog-action-primary shell-dialog-action-wide sm:order-2"
            >
              {creating ? "Creating..." : "Create Project"}
            </button>
            <button
              type="button"
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
