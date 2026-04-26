import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ProjectEntryTrashRequest } from "../../contexts/ProjectEntryActionsContext";
import { getProjectPathBasename } from "../../utils/projectPaths";
import type {
  ProjectEntryCreateDialogState,
  ProjectEntryRenameDialogState,
} from "./MainLayout.types";
import { joinProjectEntryPath } from "./projectEntryUtils";

type DialogSubmitHandler = () => void | Promise<void>;

interface ProjectEntryDialogsProps {
  createEntryDialog: ProjectEntryCreateDialogState | null;
  createEntryName: string;
  createEntryBusy: boolean;
  onCreateEntryNameChange: (name: string) => void;
  onCreateEntrySubmit: DialogSubmitHandler;
  onCreateEntryClose: () => void;
  getCreateEntryDirectoryLabel: (path: string) => string;
  renameEntryDialog: ProjectEntryRenameDialogState | null;
  renameEntryName: string;
  renameEntryBusy: boolean;
  onRenameEntryNameChange: (name: string) => void;
  onRenameEntrySubmit: DialogSubmitHandler;
  onRenameEntryClose: () => void;
  trashEntryDialog: ProjectEntryTrashRequest | null;
  trashEntryBusy: boolean;
  onTrashEntrySubmit: DialogSubmitHandler;
  onTrashEntryClose: () => void;
  getRelativePath: (path: string) => string;
}

export const ProjectEntryDialogs: React.FC<ProjectEntryDialogsProps> = ({
  createEntryDialog,
  createEntryName,
  createEntryBusy,
  onCreateEntryNameChange,
  onCreateEntrySubmit,
  onCreateEntryClose,
  getCreateEntryDirectoryLabel,
  renameEntryDialog,
  renameEntryName,
  renameEntryBusy,
  onRenameEntryNameChange,
  onRenameEntrySubmit,
  onRenameEntryClose,
  trashEntryDialog,
  trashEntryBusy,
  onTrashEntrySubmit,
  onTrashEntryClose,
  getRelativePath,
}) => (
  <>
    <AnimatePresence>
      {createEntryDialog ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-5 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="w-[min(620px,100%)] rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-8 shadow-2xl outline-none"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void onCreateEntrySubmit();
              }}
            >
              <div>
                <div className="text-[28px] font-semibold text-[var(--text-primary)]">
                  {createEntryDialog.type === "file"
                    ? "New File"
                    : "New Folder"}
                </div>
                <div className="mt-2 text-[16px] text-[var(--text-secondary)]">
                  Create inside{" "}
                  {getCreateEntryDirectoryLabel(
                    createEntryDialog.directoryPath,
                  )}
                </div>
              </div>

              <div className="mt-8">
                <label className="mb-2 block text-[15px] font-semibold text-[var(--text-secondary)]">
                  Name
                </label>
                <input
                  autoFocus
                  type="text"
                  value={createEntryName}
                  onChange={(event) =>
                    onCreateEntryNameChange(event.target.value)
                  }
                  placeholder={
                    createEntryDialog.type === "file"
                      ? "notes.txt"
                      : "new-folder"
                  }
                  className="min-h-12 w-full rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 text-[16px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--border-default)] focus:border-[var(--border-strong)]"
                />
                <div className="mt-4 break-all text-[13px] text-[var(--text-muted)]">
                  {joinProjectEntryPath(
                    createEntryDialog.directoryPath,
                    createEntryName.trim() || "...",
                  )}
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onCreateEntryClose}
                  disabled={createEntryBusy}
                  className="inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[var(--border-subtle)] bg-transparent px-6 text-[16px] font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50 sm:order-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!createEntryName.trim() || createEntryBusy}
                  className="min-h-12 rounded-[18px] bg-white px-8 text-[16px] font-medium text-black transition-colors hover:bg-gray-200 focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)] disabled:cursor-not-allowed disabled:opacity-50 sm:order-2"
                >
                  {createEntryBusy
                    ? "Creating..."
                    : createEntryDialog.type === "file"
                      ? "Create File"
                      : "Create Folder"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>

    {renameEntryDialog ? (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            Rename {renameEntryDialog.isDirectory ? "Folder" : "File"}
          </div>
          <div className="mt-2 break-all text-[12px] text-[var(--text-secondary)]">
            {getRelativePath(renameEntryDialog.path)}
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-[12px] font-medium text-[var(--text-secondary)]">
              New name
            </label>
            <input
              autoFocus
              type="text"
              value={renameEntryName}
              onChange={(event) => onRenameEntryNameChange(event.target.value)}
              className="w-full rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2.5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
            />
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onRenameEntryClose}
              disabled={renameEntryBusy}
              className="rounded-[12px] border border-[var(--border-subtle)] px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onRenameEntrySubmit()}
              disabled={!renameEntryName.trim() || renameEntryBusy}
              className="rounded-[12px] bg-white px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {renameEntryBusy ? "Renaming..." : "Rename"}
            </button>
          </div>
        </div>
      </div>
    ) : null}

    {trashEntryDialog ? (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl">
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            Move to Trash
          </div>
          <div className="mt-3 text-[13px] text-[var(--text-secondary)]">
            Move{" "}
            <span className="font-medium text-[var(--text-primary)]">
              {trashEntryDialog.displayName ||
                getProjectPathBasename(trashEntryDialog.path)}
            </span>{" "}
            to Trash?
          </div>
          <div className="mt-2 text-[12px] text-[var(--text-muted)]">
            Unsaved changes in open editors may be lost.
          </div>
          <div className="mt-3 break-all text-[11px] text-[var(--text-muted)]">
            {getRelativePath(trashEntryDialog.path)}
          </div>

          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onTrashEntryClose}
              disabled={trashEntryBusy}
              className="rounded-[12px] border border-[var(--border-subtle)] px-4 py-2 text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onTrashEntrySubmit()}
              disabled={trashEntryBusy}
              className="rounded-[12px] bg-red-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {trashEntryBusy ? "Moving..." : "Move to Trash"}
            </button>
          </div>
        </div>
      </div>
    ) : null}
  </>
);
