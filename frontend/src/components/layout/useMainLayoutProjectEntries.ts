import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectEntryActionsContextValue,
  ProjectEntryActionTarget,
  ProjectEntryMoveRequest,
  ProjectEntryTrashBatchRequest,
  ProjectEntryTrashRequest,
} from "../../contexts/ProjectEntryActionsContext";
import { writeClipboardTextWithFallback } from "../../utils/clipboard";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  normalizeProjectPath,
  relativeProjectPath,
  remapProjectPathPrefix,
} from "../../utils/projectPaths";
import {
  CreateProjectEntry,
  GetProjectEntryUndoState,
  RedoProjectEntryOperation,
  MoveProjectEntry,
  RenameProjectEntryWithHistory,
  RevealProjectEntry,
  TrashProjectEntry,
  TrashProjectEntries,
  UndoProjectEntryOperation,
} from "../../wails/app";
import type {
  ProjectEntryCreateDialogState,
  ProjectEntryRenameDialogState,
} from "./MainLayout.types";
import { joinProjectEntryPath } from "./projectEntryUtils";

type NotificationType = "success" | "error";
type ProjectEntryAccessMode = "read" | "write";
type ProjectEntryAccessDecision = {
  allowed: boolean;
  reason: string;
};

const undoableTrashFallbackReasonFragments = [
  "sensitive paths cannot be retained for undo",
  "cache or dependency directories cannot be retained for undo",
  "macos package directories cannot be retained for undo",
  "symlink entries cannot be retained for undo",
  "symlink entries are not supported",
  "symlink path components are not supported",
  "hardlinked files cannot be retained for undo",
  "entry tree is too large to retain for undo",
  "undoable trash requires same-volume rename",
  "cannot create undo stash on the same filesystem",
  "cannot create undo stash through symlink path",
];

const isUndoableTrashFallbackEligible = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return undoableTrashFallbackReasonFragments.some((fragment) =>
    normalized.includes(fragment),
  );
};

interface UseMainLayoutProjectEntriesOptions {
  activeProjectPath: string;
  tuiModeActive: boolean;
  canAccessPath: (
    path: string,
    mode: ProjectEntryAccessMode,
  ) => ProjectEntryAccessDecision;
  onBeforeMoveEntry?: () => Promise<void>;
  onUserCreatedEntry?: (path: string, isDirectory: boolean) => void;
  showNotification: (type: NotificationType, message: string) => void;
  setProjectPathCopiedVisible: (visible: boolean) => void;
}

export const useMainLayoutProjectEntries = ({
  activeProjectPath,
  tuiModeActive,
  canAccessPath,
  onBeforeMoveEntry,
  onUserCreatedEntry,
  showNotification,
  setProjectPathCopiedVisible,
}: UseMainLayoutProjectEntriesOptions) => {
  const projectPathCopiedTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [createEntryDialog, setCreateEntryDialog] =
    useState<ProjectEntryCreateDialogState | null>(null);
  const [createEntryName, setCreateEntryName] = useState("");
  const [createEntryBusy, setCreateEntryBusy] = useState(false);
  const [renameEntryDialog, setRenameEntryDialog] =
    useState<ProjectEntryRenameDialogState | null>(null);
  const [renameEntryName, setRenameEntryName] = useState("");
  const [renameEntryBusy, setRenameEntryBusy] = useState(false);
  const [trashEntryDialog, setTrashEntryDialog] =
    useState<ProjectEntryTrashBatchRequest | null>(null);
  const [trashEntryBusy, setTrashEntryBusy] = useState(false);
  const [trashEntryNativeFallbackReason, setTrashEntryNativeFallbackReason] =
    useState<string | null>(null);

  const ensureProjectEntryAccess = useCallback(
    (
      path: string,
      mode: ProjectEntryAccessMode,
      options?: { userInitiatedWrite?: boolean },
    ): boolean => {
      if (!path) {
        showNotification("error", "[Files] Path is empty");
        return false;
      }

      if (!tuiModeActive) {
        return true;
      }

      const accessDecision = canAccessPath(path, mode);
      if (
        mode === "write" &&
        options?.userInitiatedWrite &&
        !accessDecision.allowed &&
        accessDecision.reason === "write requires explicit user approval"
      ) {
        return true;
      }
      if (!accessDecision.allowed) {
        showNotification("error", `[Security] ${accessDecision.reason}`);
        return false;
      }

      return true;
    },
    [canAccessPath, showNotification, tuiModeActive],
  );

  const closeCreateEntryDialog = useCallback(() => {
    if (createEntryBusy) {
      return;
    }

    setCreateEntryDialog(null);
    setCreateEntryName("");
  }, [createEntryBusy]);

  const closeRenameEntryDialog = useCallback(() => {
    if (renameEntryBusy) {
      return;
    }

    setRenameEntryDialog(null);
    setRenameEntryName("");
  }, [renameEntryBusy]);

  const closeTrashEntryDialog = useCallback(() => {
    if (trashEntryBusy) {
      return;
    }

    setTrashEntryDialog(null);
    setTrashEntryNativeFallbackReason(null);
  }, [trashEntryBusy]);

  const copyText = useCallback(
    async (text: string, successMessage = "Copied to clipboard") => {
      if (!text.trim()) {
        showNotification("error", "[Clipboard] Nothing to copy");
        return false;
      }

      const copied = await writeClipboardTextWithFallback(text);
      if (!copied) {
        showNotification("error", "[Clipboard] Failed to write to clipboard");
        return false;
      }

      showNotification("success", successMessage);
      return true;
    },
    [showNotification],
  );

  const getRelativePath = useCallback(
    (path: string) => relativeProjectPath(path, activeProjectPath),
    [activeProjectPath],
  );

  const getCreateEntryDirectoryLabel = useCallback(
    (path: string) => {
      const relativePath = getRelativePath(path);
      return relativePath === "." ? path : relativePath;
    },
    [getRelativePath],
  );

  const copyAbsolutePath = useCallback(
    async (path: string) => {
      if (!ensureProjectEntryAccess(path, "read")) {
        return false;
      }
      return copyText(path, "Absolute path copied");
    },
    [copyText, ensureProjectEntryAccess],
  );

  const copyRelativePath = useCallback(
    async (path: string) => {
      if (!ensureProjectEntryAccess(path, "read")) {
        return false;
      }

      return copyText(getRelativePath(path), "Relative path copied");
    },
    [copyText, ensureProjectEntryAccess, getRelativePath],
  );

  const copyProjectPath = useCallback(async () => {
    if (!activeProjectPath) {
      showNotification("error", "[Files] No project opened");
      return false;
    }

    if (!ensureProjectEntryAccess(activeProjectPath, "read")) {
      return false;
    }

    return copyText(activeProjectPath, "Project path copied");
  }, [activeProjectPath, copyText, ensureProjectEntryAccess, showNotification]);

  const showProjectPathCopiedConfirmation = useCallback(() => {
    if (projectPathCopiedTimerRef.current) {
      clearTimeout(projectPathCopiedTimerRef.current);
    }

    setProjectPathCopiedVisible(true);
    projectPathCopiedTimerRef.current = setTimeout(() => {
      setProjectPathCopiedVisible(false);
      projectPathCopiedTimerRef.current = null;
    }, 1600);
  }, [setProjectPathCopiedVisible]);

  const copyProjectPathFromShortcut = useCallback(async () => {
    if (!activeProjectPath) {
      showNotification("error", "[Files] No project opened");
      return false;
    }

    if (!ensureProjectEntryAccess(activeProjectPath, "read")) {
      return false;
    }

    const copied = await writeClipboardTextWithFallback(activeProjectPath);
    if (!copied) {
      showNotification("error", "[Clipboard] Failed to write to clipboard");
      return false;
    }

    showProjectPathCopiedConfirmation();
    return true;
  }, [
    activeProjectPath,
    ensureProjectEntryAccess,
    showNotification,
    showProjectPathCopiedConfirmation,
  ]);

  useEffect(
    () => () => {
      if (projectPathCopiedTimerRef.current) {
        clearTimeout(projectPathCopiedTimerRef.current);
      }
    },
    [],
  );

  const revealEntry = useCallback(
    async (path: string) => {
      if (!ensureProjectEntryAccess(path, "read")) {
        return false;
      }

      try {
        await RevealProjectEntry(path);
        return true;
      } catch (error) {
        showNotification(
          "error",
          `[Files] ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    [ensureProjectEntryAccess, showNotification],
  );

  const requestCreateEntry = useCallback(
    (type: "file" | "folder", directoryPath = activeProjectPath) => {
      const normalizedDirectory = normalizeProjectPath(directoryPath);
      if (!normalizedDirectory) {
        showNotification("error", "[Files] No project opened");
        return;
      }

      if (
        !ensureProjectEntryAccess(normalizedDirectory, "write", {
          userInitiatedWrite: true,
        })
      ) {
        return;
      }

      setCreateEntryDialog({
        type,
        directoryPath: normalizedDirectory,
      });
      setCreateEntryName("");
    },
    [activeProjectPath, ensureProjectEntryAccess, showNotification],
  );

  const requestRenameEntry = useCallback(
    (entry: ProjectEntryActionTarget) => {
      if (!ensureProjectEntryAccess(entry.path, "write")) {
        return;
      }

      const currentName = getProjectPathBasename(entry.path);
      setRenameEntryDialog({
        ...entry,
        name: currentName,
      });
      setRenameEntryName(currentName);
    },
    [ensureProjectEntryAccess],
  );

  const requestTrashEntries = useCallback(
    (request: ProjectEntryTrashBatchRequest) => {
      const entries = request.entries.filter((entry) => entry.path);
      if (entries.length === 0) {
        showNotification("error", "[Files] No entries selected");
        return;
      }
      for (const entry of entries) {
        if (!ensureProjectEntryAccess(entry.path, "write")) {
          return;
        }
      }

      setTrashEntryDialog({
        ...request,
        entries,
      });
      setTrashEntryNativeFallbackReason(null);
    },
    [ensureProjectEntryAccess, showNotification],
  );

  const requestTrashEntry = useCallback(
    (entry: ProjectEntryTrashRequest) => {
      requestTrashEntries({ entries: [entry], displayName: entry.displayName });
    },
    [requestTrashEntries],
  );

  const requestMoveEntry = useCallback(
    async (entry: ProjectEntryMoveRequest) => {
      const normalizedSource = normalizeProjectPath(entry.path);
      const normalizedTargetDirectory = normalizeProjectPath(
        entry.targetDirectory,
      );
      if (!normalizedSource || !normalizedTargetDirectory) {
        showNotification("error", "[Files] Move target is invalid");
        return false;
      }

      if (!ensureProjectEntryAccess(normalizedSource, "write")) {
        return false;
      }
      if (
        !ensureProjectEntryAccess(normalizedTargetDirectory, "write", {
          userInitiatedWrite: true,
        })
      ) {
        return false;
      }

      try {
        await onBeforeMoveEntry?.();
        const result = await MoveProjectEntry(
          normalizedSource,
          normalizedTargetDirectory,
        );
        showNotification(
          "success",
          result.rewrittenImports
            ? `Moved and rewrote ${result.rewrittenImports} import${result.rewrittenImports === 1 ? "" : "s"}`
            : "Entry moved",
        );
        return true;
      } catch (error) {
        showNotification(
          "error",
          `[Files] ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    [ensureProjectEntryAccess, onBeforeMoveEntry, showNotification],
  );

  const handleCreateEntrySubmit = useCallback(async () => {
    if (!createEntryDialog) {
      return;
    }

    const entryName = createEntryName.trim();
    if (!entryName) {
      showNotification("error", "[Files] Name is required");
      return;
    }

    const targetPath = joinProjectEntryPath(
      createEntryDialog.directoryPath,
      entryName,
    );
    if (
      !ensureProjectEntryAccess(targetPath, "write", {
        userInitiatedWrite: true,
      })
    ) {
      return;
    }

    setCreateEntryBusy(true);
    try {
      const result = await CreateProjectEntry({
        type: createEntryDialog.type,
        directoryPath: createEntryDialog.directoryPath,
        name: entryName,
      });
      onUserCreatedEntry?.(result.path, result.isDirectory);

      showNotification(
        "success",
        `${createEntryDialog.type === "file" ? "File" : "Folder"} created`,
      );
      setCreateEntryDialog(null);
      setCreateEntryName("");
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setCreateEntryBusy(false);
    }
  }, [
    createEntryDialog,
    createEntryName,
    ensureProjectEntryAccess,
    onUserCreatedEntry,
    showNotification,
  ]);

  const handleRenameEntrySubmit = useCallback(async () => {
    if (!renameEntryDialog) {
      return;
    }

    const nextName = renameEntryName.trim();
    if (!nextName) {
      showNotification("error", "[Files] Name is required");
      return;
    }

    if (!ensureProjectEntryAccess(renameEntryDialog.path, "write")) {
      return;
    }

    setRenameEntryBusy(true);
    try {
      await RenameProjectEntryWithHistory({
        path: renameEntryDialog.path,
        newName: nextName,
      });
      showNotification("success", "Entry renamed");
      setRenameEntryDialog(null);
      setRenameEntryName("");
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRenameEntryBusy(false);
    }
  }, [
    ensureProjectEntryAccess,
    renameEntryDialog,
    renameEntryName,
    showNotification,
  ]);

  const handleTrashEntrySubmit = useCallback(async () => {
    if (!trashEntryDialog) {
      return;
    }

    for (const entry of trashEntryDialog.entries) {
      if (!ensureProjectEntryAccess(entry.path, "write")) {
        return;
      }
    }

    setTrashEntryBusy(true);
    try {
      const result = await TrashProjectEntries({
        entries: trashEntryDialog.entries.map((entry) => ({
          path: entry.path,
          isDirectory: entry.isDirectory,
          displayName: entry.displayName,
        })),
      });
      showNotification(
        "success",
        result.count === 1
          ? "Moved to trash"
          : `${result.count} entries moved to trash`,
      );
      setTrashEntryDialog(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isUndoableTrashFallbackEligible(message)) {
        setTrashEntryNativeFallbackReason(message);
        showNotification("error", `[Files] Undoable trash blocked: ${message}`);
      } else {
        setTrashEntryNativeFallbackReason(null);
        showNotification("error", `[Files] ${message}`);
      }
    } finally {
      setTrashEntryBusy(false);
    }
  }, [ensureProjectEntryAccess, showNotification, trashEntryDialog]);

  const handleTrashEntryNativeFallbackSubmit = useCallback(async () => {
    if (!trashEntryDialog) {
      return;
    }

    for (const entry of trashEntryDialog.entries) {
      if (!ensureProjectEntryAccess(entry.path, "write")) {
        return;
      }
    }

    setTrashEntryBusy(true);
    try {
      for (const entry of trashEntryDialog.entries) {
        await TrashProjectEntry(entry.path);
      }
      showNotification(
        "success",
        trashEntryDialog.entries.length === 1
          ? "Moved to trash without undo"
          : `${trashEntryDialog.entries.length} entries moved to trash without undo`,
      );
      setTrashEntryDialog(null);
      setTrashEntryNativeFallbackReason(null);
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTrashEntryBusy(false);
    }
  }, [ensureProjectEntryAccess, showNotification, trashEntryDialog]);

  const undoProjectEntryOperation = useCallback(async () => {
    try {
      const before = await GetProjectEntryUndoState();
      if (!before.canUndo) {
        return false;
      }
      await UndoProjectEntryOperation();
      showNotification("success", "Explorer action undone");
      return true;
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }, [showNotification]);

  const redoProjectEntryOperation = useCallback(async () => {
    try {
      const before = await GetProjectEntryUndoState();
      if (!before.canRedo) {
        return false;
      }
      await RedoProjectEntryOperation();
      showNotification("success", "Explorer action redone");
      return true;
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }, [showNotification]);

  const remapProjectEntryDialogs = useCallback(
    (oldPath: string, newPath: string) => {
      setCreateEntryDialog((current) => {
        if (!current) {
          return current;
        }

        const remappedDirectory = remapProjectPathPrefix(
          current.directoryPath,
          oldPath,
          newPath,
        );
        if (!remappedDirectory || remappedDirectory === current.directoryPath) {
          return current;
        }

        return {
          ...current,
          directoryPath: remappedDirectory,
        };
      });

      setRenameEntryDialog((current) => {
        if (!current) {
          return current;
        }

        const remappedPath = remapProjectPathPrefix(
          current.path,
          oldPath,
          newPath,
        );
        if (!remappedPath || remappedPath === current.path) {
          return current;
        }

        const nextName = getProjectPathBasename(remappedPath);
        setRenameEntryName(nextName);
        return {
          ...current,
          path: remappedPath,
          name: nextName,
        };
      });

      setTrashEntryDialog((current) => {
        if (!current) {
          return current;
        }

        let changed = false;
        const entries = current.entries.map((entry) => {
          const remappedPath = remapProjectPathPrefix(
            entry.path,
            oldPath,
            newPath,
          );
          if (!remappedPath || remappedPath === entry.path) {
            return entry;
          }
          changed = true;
          return {
            ...entry,
            path: remappedPath,
            displayName: getProjectPathBasename(remappedPath),
          };
        });
        return changed ? { ...current, entries } : current;
      });
    },
    [],
  );

  const pruneProjectEntryDialogs = useCallback((deletedPath: string) => {
    setCreateEntryDialog((current) =>
      current && isSameOrChildPath(current.directoryPath, deletedPath)
        ? null
        : current,
    );
    setRenameEntryDialog((current) =>
      current && isSameOrChildPath(current.path, deletedPath) ? null : current,
    );
    setTrashEntryDialog((current) => {
      if (!current) {
        return current;
      }
      const entries = current.entries.filter(
        (entry) => !isSameOrChildPath(entry.path, deletedPath),
      );
      return entries.length === 0 ? null : { ...current, entries };
    });
  }, []);

  const projectEntryActions: ProjectEntryActionsContextValue = useMemo(
    () => ({
      projectPath: activeProjectPath,
      getRelativePath,
      copyText,
      copyAbsolutePath,
      copyRelativePath,
      copyProjectPath,
      revealEntry,
      requestCreateEntry,
      requestMoveEntry,
      requestRenameEntry,
      requestTrashEntry,
      requestTrashEntries,
      undoProjectEntryOperation,
      redoProjectEntryOperation,
    }),
    [
      activeProjectPath,
      copyAbsolutePath,
      copyProjectPath,
      copyRelativePath,
      copyText,
      getRelativePath,
      requestCreateEntry,
      requestMoveEntry,
      requestRenameEntry,
      requestTrashEntry,
      requestTrashEntries,
      revealEntry,
      undoProjectEntryOperation,
      redoProjectEntryOperation,
    ],
  );

  const projectEntryDialogProps = {
    createEntryDialog,
    createEntryName,
    createEntryBusy,
    onCreateEntryNameChange: setCreateEntryName,
    onCreateEntrySubmit: handleCreateEntrySubmit,
    onCreateEntryClose: closeCreateEntryDialog,
    getCreateEntryDirectoryLabel,
    renameEntryDialog,
    renameEntryName,
    renameEntryBusy,
    onRenameEntryNameChange: setRenameEntryName,
    onRenameEntrySubmit: handleRenameEntrySubmit,
    onRenameEntryClose: closeRenameEntryDialog,
    trashEntryDialog,
    trashEntryBusy,
    trashEntryNativeFallbackReason,
    onTrashEntrySubmit: handleTrashEntrySubmit,
    onTrashEntryNativeFallbackSubmit: handleTrashEntryNativeFallbackSubmit,
    onTrashEntryClose: closeTrashEntryDialog,
    getRelativePath,
  };

  return {
    closeCreateEntryDialog,
    createEntryDialog,
    copyProjectPathFromShortcut,
    ensureProjectEntryAccess,
    projectEntryActions,
    projectEntryDialogProps,
    pruneProjectEntryDialogs,
    redoProjectEntryOperation,
    remapProjectEntryDialogs,
    undoProjectEntryOperation,
  };
};
