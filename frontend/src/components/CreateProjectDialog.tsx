import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import * as App from "../../wailsjs/go/main/App";
import { shortcuts } from "../utils/keyboard";

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
      const path = await App.SelectDirectory(
        "Select parent directory for new project",
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shortcuts.escape(event)) {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, creating, projectName, selectedDir]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className="w-full max-w-md rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
          >
            <h2 className="mb-6 text-2xl font-bold text-[var(--text-primary)]">
              Create New Project
            </h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-[13px] font-medium text-[var(--text-secondary)]">
                  Project Name
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="my-awesome-project"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2 text-[var(--text-primary)] outline-none focus:border-transparent focus:ring-2 focus:ring-white/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-[13px] font-medium text-[var(--text-secondary)]">
                  Parent Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedDir}
                    readOnly
                    placeholder="Select directory..."
                    className="flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-[var(--text-primary)]"
                  />
                  <button
                    onClick={handleSelectDirectory}
                    disabled={creating}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Browse
                  </button>
                </div>
              </div>

              <div className="text-[11px] text-[var(--text-muted)]">
                Project will be created at:{" "}
                {selectedDir && projectName.trim()
                  ? `${selectedDir}/${projectName.trim()}`
                  : "..."}
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={handleCreateProject}
                disabled={!projectName.trim() || !selectedDir || creating}
                className="flex-1 rounded-lg bg-white px-4 py-2 font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Project"}
              </button>
              <button
                onClick={close}
                disabled={creating}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
