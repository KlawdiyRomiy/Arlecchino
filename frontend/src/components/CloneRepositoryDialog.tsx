import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  FolderOpen,
  GitBranch,
  Link,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";

import * as App from "../../wailsjs/go/main/App";
import { deriveCloneProjectName } from "../utils/gitClone";
import { shortcuts } from "../utils/keyboard";

interface CloneRepositoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProjectOpen: (path: string) => void | Promise<void>;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export const CloneRepositoryDialog: React.FC<CloneRepositoryDialogProps> = ({
  open,
  onOpenChange,
  onProjectOpen,
}) => {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [selectedDir, setSelectedDir] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectNameEdited, setProjectNameEdited] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRepositoryUrl("");
    setSelectedDir("");
    setProjectName("");
    setProjectNameEdited(false);
    setCloning(false);
    setError(null);
  };

  const close = () => {
    if (cloning) {
      return;
    }
    reset();
    onOpenChange(false);
  };

  const handleRepositoryUrlChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const nextUrl = event.target.value;
    setRepositoryUrl(nextUrl);
    setError(null);
    if (!projectNameEdited) {
      setProjectName(deriveCloneProjectName(nextUrl));
    }
  };

  const handleProjectNameChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setProjectNameEdited(true);
    setProjectName(event.target.value);
    setError(null);
  };

  const handleSelectDirectory = async () => {
    try {
      const path = await App.SelectDirectory(
        "Select destination for cloned repository",
      );
      if (path) {
        setSelectedDir(path);
        setError(null);
      }
    } catch (selectError) {
      console.error("Error selecting clone destination:", selectError);
      setError(getErrorMessage(selectError));
    }
  };

  const handleCloneRepository = async () => {
    const trimmedUrl = repositoryUrl.trim();
    const trimmedName = projectName.trim();

    if (!trimmedUrl || !selectedDir || !trimmedName) {
      setError("Repository URL, destination, and project name are required.");
      return;
    }

    setCloning(true);
    setError(null);
    try {
      const projectPath = await App.CloneRepository(
        trimmedUrl,
        selectedDir,
        trimmedName,
      );
      reset();
      onOpenChange(false);
      await Promise.resolve(onProjectOpen(projectPath));
    } catch (cloneError) {
      console.error("Error cloning repository:", cloneError);
      setError(getErrorMessage(cloneError));
      setCloning(false);
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
  }, [open, cloning]);

  if (typeof document === "undefined") {
    return null;
  }

  const labelClass =
    "mb-2 flex items-center gap-2 text-[15px] font-semibold text-[var(--text-secondary)]";
  const inputClass =
    "min-h-12 w-full rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 text-[16px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--border-default)] focus:border-[var(--border-strong)] disabled:cursor-wait disabled:opacity-70";
  const secondaryButtonClass =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] border border-[var(--border-subtle)] bg-transparent px-6 text-[16px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50";
  const iconButtonClass =
    "inline-flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50";
  const cloneDisabled =
    !repositoryUrl.trim() || !selectedDir || !projectName.trim() || cloning;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="shell-overlay-card w-[min(620px,100%)] p-8 outline-none"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleCloneRepository();
              }}
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent text-[var(--text-primary)]">
                    <GitBranch size={20} />
                  </div>
                  <h2 className="text-[28px] font-semibold text-[var(--text-primary)]">
                    Clone Repository
                  </h2>
                  <div className="mt-2 text-[16px] text-[var(--text-secondary)]">
                    Clone a Git remote and open it as the current project.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={close}
                  disabled={cloning}
                  className={iconButtonClass}
                  aria-label="Close clone repository dialog"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mt-8 space-y-5">
                <div>
                  <label className={labelClass}>
                    <Link size={15} />
                    Repository URL
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={repositoryUrl}
                    onChange={handleRepositoryUrlChange}
                    disabled={cloning}
                    placeholder="https://github.com/org/repo.git"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    <FolderOpen size={15} />
                    Destination
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      value={selectedDir}
                      readOnly
                      placeholder="Select destination..."
                      className={`${inputClass} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleSelectDirectory}
                      disabled={cloning}
                      className={`${secondaryButtonClass} shrink-0`}
                    >
                      <FolderOpen size={17} />
                      Browse
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>
                    <Sparkles size={15} />
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={handleProjectNameChange}
                    disabled={cloning}
                    placeholder="repo"
                    className={inputClass}
                  />
                </div>

                <div className="min-h-5 break-words text-[13px] text-[var(--text-muted)]">
                  {error ? (
                    <span className="inline-flex items-start gap-2 text-[var(--status-error)]">
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                      <span>{error}</span>
                    </span>
                  ) : selectedDir && projectName.trim() ? (
                    <>
                      Project will be cloned to: {selectedDir}/
                      {projectName.trim()}
                    </>
                  ) : (
                    "Ready to clone once a repository and destination are selected."
                  )}
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="submit"
                  disabled={cloneDisabled}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] bg-white px-8 text-[16px] font-medium text-black transition-colors hover:bg-gray-200 focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
                >
                  {cloning ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <GitBranch size={18} />
                  )}
                  {cloning ? "Cloning..." : "Clone"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={cloning}
                  className={`${secondaryButtonClass} shrink-0 sm:order-1`}
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
