import React from "react";
import { AnimatePresence } from "framer-motion";
import type { ProjectEntryTrashBatchRequest } from "../../contexts/ProjectEntryActionsContext";
import { getProjectPathBasename } from "../../utils/projectPaths";
import { MotionShellDialogFrame } from "../ui/MotionShellDialogFrame";
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
  trashEntryDialog: ProjectEntryTrashBatchRequest | null;
  trashEntryBusy: boolean;
  trashEntryNativeFallbackReason: string | null;
  onTrashEntrySubmit: DialogSubmitHandler;
  onTrashEntryNativeFallbackSubmit: DialogSubmitHandler;
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
  trashEntryNativeFallbackReason,
  onTrashEntrySubmit,
  onTrashEntryNativeFallbackSubmit,
  onTrashEntryClose,
  getRelativePath,
}) => (
  <>
    <AnimatePresence>
      {createEntryDialog ? (
        <MotionShellDialogFrame
          key={`create-entry-${createEntryDialog.type}`}
          overlayClassName="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-5"
          panelClassName="w-[min(620px,100%)] rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-8 shadow-2xl outline-none"
          panelTestId={`project-entry-${createEntryDialog.type}-dialog`}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateEntrySubmit();
            }}
          >
            <div>
              <div className="text-[28px] font-semibold text-[var(--text-primary)]">
                {createEntryDialog.type === "file" ? "New File" : "New Folder"}
              </div>
              <div className="mt-2 text-[16px] text-[var(--text-secondary)]">
                Create inside{" "}
                {getCreateEntryDirectoryLabel(createEntryDialog.directoryPath)}
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
                  createEntryDialog.type === "file" ? "notes.txt" : "new-folder"
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
                className="shell-dialog-action shell-dialog-action-secondary sm:order-1"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!createEntryName.trim() || createEntryBusy}
                className="shell-dialog-action shell-dialog-action-primary shell-dialog-action-wide sm:order-2"
              >
                {createEntryBusy
                  ? "Creating..."
                  : createEntryDialog.type === "file"
                    ? "Create File"
                    : "Create Folder"}
              </button>
            </div>
          </form>
        </MotionShellDialogFrame>
      ) : null}
    </AnimatePresence>

    <AnimatePresence>
      {renameEntryDialog ? (
        <MotionShellDialogFrame
          key="rename-entry"
          overlayClassName="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4"
          panelClassName="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl"
          panelTestId="project-entry-rename-dialog"
        >
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
              className="shell-dialog-action shell-dialog-action-secondary shell-dialog-action-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onRenameEntrySubmit()}
              disabled={!renameEntryName.trim() || renameEntryBusy}
              className="shell-dialog-action shell-dialog-action-primary shell-dialog-action-sm"
            >
              {renameEntryBusy ? "Renaming..." : "Rename"}
            </button>
          </div>
        </MotionShellDialogFrame>
      ) : null}
    </AnimatePresence>

    <AnimatePresence>
      {trashEntryDialog ? (
        <MotionShellDialogFrame
          key="trash-entry"
          overlayClassName="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4"
          panelClassName="w-full max-w-md rounded-[18px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5 shadow-2xl"
          panelTestId="project-entry-trash-dialog"
        >
          <div className="text-lg font-semibold text-[var(--text-primary)]">
            Move to Trash
          </div>
          <div className="mt-3 text-[13px] text-[var(--text-secondary)]">
            Move{" "}
            <span className="font-medium text-[var(--text-primary)]">
              {trashEntryDialog.entries.length === 1
                ? trashEntryDialog.displayName ||
                  trashEntryDialog.entries[0]?.displayName ||
                  getProjectPathBasename(
                    trashEntryDialog.entries[0]?.path ?? "",
                  )
                : `${trashEntryDialog.entries.length} selected entries`}
            </span>{" "}
            to Trash?
          </div>
          <div className="mt-2 text-[12px] text-[var(--text-muted)]">
            Unsaved changes in open editors may be lost.
          </div>
          {trashEntryNativeFallbackReason ? (
            <div className="mt-3 rounded-[12px] border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-[var(--text-secondary)]">
              <div className="font-medium text-[var(--text-primary)]">
                Undo is unavailable for this selection.
              </div>
              <div className="mt-1 break-words">
                {trashEntryNativeFallbackReason}
              </div>
            </div>
          ) : null}
          <div className="mt-3 whitespace-pre-line break-all text-[11px] text-[var(--text-muted)]">
            {trashEntryDialog.entries.length === 1
              ? getRelativePath(trashEntryDialog.entries[0]?.path ?? "")
              : trashEntryDialog.entries
                  .slice(0, 6)
                  .map((entry) => getRelativePath(entry.path))
                  .join("\n")}
            {trashEntryDialog.entries.length > 6
              ? `\n...and ${trashEntryDialog.entries.length - 6} more`
              : ""}
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
            {trashEntryNativeFallbackReason ? (
              <button
                type="button"
                onClick={() => void onTrashEntryNativeFallbackSubmit()}
                disabled={trashEntryBusy}
                className="rounded-[12px] border border-red-500/40 px-4 py-2 text-[13px] font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {trashEntryBusy ? "Moving..." : "Move Without Undo"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onTrashEntrySubmit()}
              disabled={trashEntryBusy}
              className="rounded-[12px] bg-red-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {trashEntryBusy ? "Moving..." : "Move to Trash"}
            </button>
          </div>
        </MotionShellDialogFrame>
      ) : null}
    </AnimatePresence>
  </>
);
