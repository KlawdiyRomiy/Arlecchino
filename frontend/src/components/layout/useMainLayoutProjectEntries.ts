import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectEntryActionsContextValue,
  ProjectEntryActionTarget,
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
  CreateDirectory,
  RenameProjectEntry,
  RevealProjectEntry,
  TrashProjectEntry,
  WriteFile,
} from "../../../wailsjs/go/main/App";
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

interface UseMainLayoutProjectEntriesOptions {
  activeProjectPath: string;
  tuiModeActive: boolean;
  canAccessPath: (
    path: string,
    mode: ProjectEntryAccessMode,
  ) => ProjectEntryAccessDecision;
  showNotification: (type: NotificationType, message: string) => void;
  setProjectPathCopiedVisible: (visible: boolean) => void;
}

export const useMainLayoutProjectEntries = ({
  activeProjectPath,
  tuiModeActive,
  canAccessPath,
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
    useState<ProjectEntryTrashRequest | null>(null);
  const [trashEntryBusy, setTrashEntryBusy] = useState(false);

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

  const requestTrashEntry = useCallback(
    (entry: ProjectEntryTrashRequest) => {
      if (!ensureProjectEntryAccess(entry.path, "write")) {
        return;
      }

      setTrashEntryDialog(entry);
    },
    [ensureProjectEntryAccess],
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
      if (createEntryDialog.type === "file") {
        await WriteFile(targetPath, "");
      } else {
        await CreateDirectory(targetPath);
      }

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
      await RenameProjectEntry(renameEntryDialog.path, nextName);
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

    if (!ensureProjectEntryAccess(trashEntryDialog.path, "write")) {
      return;
    }

    setTrashEntryBusy(true);
    try {
      await TrashProjectEntry(trashEntryDialog.path);
      showNotification("success", "Moved to trash");
      setTrashEntryDialog(null);
    } catch (error) {
      showNotification(
        "error",
        `[Files] ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTrashEntryBusy(false);
    }
  }, [ensureProjectEntryAccess, showNotification, trashEntryDialog]);

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

        const remappedPath = remapProjectPathPrefix(
          current.path,
          oldPath,
          newPath,
        );
        if (!remappedPath || remappedPath === current.path) {
          return current;
        }

        return {
          ...current,
          path: remappedPath,
          displayName: getProjectPathBasename(remappedPath),
        };
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
    setTrashEntryDialog((current) =>
      current && isSameOrChildPath(current.path, deletedPath) ? null : current,
    );
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
      requestRenameEntry,
      requestTrashEntry,
    }),
    [
      activeProjectPath,
      copyAbsolutePath,
      copyProjectPath,
      copyRelativePath,
      copyText,
      getRelativePath,
      requestCreateEntry,
      requestRenameEntry,
      requestTrashEntry,
      revealEntry,
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
    onTrashEntrySubmit: handleTrashEntrySubmit,
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
    remapProjectEntryDialogs,
  };
};
