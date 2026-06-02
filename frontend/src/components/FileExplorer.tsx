import React, { useCallback, useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import * as App from "../wails/app";
import { EventsOn } from "../wails/runtime";
import {
  useProjectEntryActions,
  type ProjectEntryActionTarget,
} from "../contexts/ProjectEntryActionsContext";
import type { PanelOpenRequest } from "./layout/MainLayout.types";
import { colors, getThemeColors } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { useFileRelations } from "../hooks/useFileRelations";
import { QuickRelationsMenu } from "./QuickRelationsMenu";
import { DependencyTree } from "./DependencyTree";
import { AnimatePresence, motion } from "framer-motion";
import {
  useExplorerSelectionStore,
  useExplorerStore,
} from "../stores/explorerStore";
import {
  ContextActionMenu,
  type ContextActionMenuItem,
} from "./ui/ContextActionMenu";
import { DragGhost, type DragGhostState } from "./ui/DragGhost";
import { MotionDropdownContent } from "./ui/MotionDropdownContent";
import { buildFileNodes } from "../utils/fileTreeHelpers";
import { shortcuts } from "../utils/keyboard";
import {
  PROJECT_SWITCH_BLOCKERS,
  blockProjectSwitch,
  unblockProjectSwitch,
} from "../utils/priorityUI";
import {
  getProjectPathDirname,
  isSameOrChildPath,
} from "../utils/projectPaths";
import { beginDragSelectionLock } from "../utils/dragSelectionLock";
import { resolveExplorerNodeClickIntent } from "../utils/fileExplorerClickIntent";
import {
  detectPanelSnapDropTarget,
  type PanelSnapDragCallbacks,
} from "../utils/panelSnapDrag";
import type { EditorSplitDropSide } from "./EditorTabs";

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isExpanded?: boolean;
  isLoaded?: boolean;
}

interface Breadcrumb {
  name: string;
  path: string;
  node: FileNode;
}

interface CreatedEntryEvent {
  path?: string;
  isDirectory?: boolean;
}

interface RefreshDirectoryOptions {
  preserveExpansion?: boolean;
}

interface RenamedEntryEvent {
  oldPath?: string;
  newPath?: string;
  isDirectory?: boolean;
}

interface DeletedEntryEvent {
  path?: string;
  isDirectory?: boolean;
}

const FILE_EXPLORER_NODE_RIGHT_INSET = 8;
const FOLDER_CREATE_BUTTON_SIZE = 22;
const EDITOR_FILE_SPLIT_DRAG_EVENT = "arlecchino:editor-file-split-drag";
const EDITOR_FILE_SPLIT_DROP_EVENT = "arlecchino:editor-file-split-drop";

export interface FileExplorerProps extends PanelSnapDragCallbacks {
  onFileOpen?: (
    path: string,
    content: string,
    name: string,
    line?: number,
  ) => void;
  onFileOpenInPanel?: (
    path: string,
    name: string,
    line?: number,
    request?: Partial<PanelOpenRequest>,
  ) => unknown | Promise<unknown>;
  projectPath?: string;
  isHorizontal?: boolean;
  onPerspectiveOpen?: () => void;
  onPerspectiveClose?: () => void;
}

const FileExplorerComponent: React.FC<FileExplorerProps> = ({
  onFileOpen,
  onFileOpenInPanel,
  onPanelSnapDragStart,
  onPanelSnapDragMove,
  onPanelSnapDragEnd,
  projectPath: initialProjectPath = "",
  isHorizontal = false,
  onPerspectiveOpen,
  onPerspectiveClose,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const {
    projectPath: contextProjectPath,
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
  } = useProjectEntryActions();
  const {
    expandedPaths,
    toggleExpanded,
    setExpanded,
    revealRequestPath,
    clearRevealRequest,
    setProjectPath: setStoreProjectPath,
  } = useExplorerStore(
    useShallow((state) => ({
      expandedPaths: state.expandedPaths,
      toggleExpanded: state.toggleExpanded,
      setExpanded: state.setExpanded,
      revealRequestPath: state.revealRequestPath,
      clearRevealRequest: state.clearRevealRequest,
      setProjectPath: state.setProjectPath,
    })),
  );
  const {
    selectedPaths,
    focusedPath,
    anchorPath,
    setStoreHighlightedPath,
    selectSinglePath,
    setSelectedPaths,
    toggleSelectedPath,
    clearSelection,
  } = useExplorerSelectionStore(
    useShallow((state) => ({
      selectedPaths: state.selectedPaths,
      focusedPath: state.focusedPath,
      anchorPath: state.anchorPath,
      setStoreHighlightedPath: state.setHighlightedPath,
      selectSinglePath: state.selectSinglePath,
      setSelectedPaths: state.setSelectedPaths,
      toggleSelectedPath: state.toggleSelectedPath,
      clearSelection: state.clearSelection,
    })),
  );
  const [projectPath, setProjectPath] = useState<string>("");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [perspectiveTarget, setPerspectiveTarget] = useState<string | null>(
    null,
  );
  const [quickMenu, setQuickMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
  }>({ isOpen: false, x: 0, y: 0 });
  const [treeOpen, setTreeOpen] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [dragGhost, setDragGhost] = useState<DragGhostState | null>(null);
  const [marqueeSelection, setMarqueeSelection] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const explorerRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<FileNode[]>([]);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentCreatedPathsRef = useRef<Map<string, number>>(new Map());
  const expandedPathsRef = useRef(expandedPaths);
  const projectPathRef = useRef(projectPath);
  const onFileOpenRef = useRef(onFileOpen);
  const onFileOpenInPanelRef = useRef(onFileOpenInPanel);
  const highlightedEditorTabsRef = useRef<HTMLElement | null>(null);
  const highlightedPathRef = useRef<string | null>(null);
  const selectedPathsRef = useRef(selectedPaths);
  const focusedPathRef = useRef(focusedPath);
  const anchorPathRef = useRef(anchorPath);
  const latestFileOpenRequestRef = useRef(0);
  const latestProjectLoadRef = useRef(0);
  const suppressNodeClickRef = useRef(false);
  const relations = useFileRelations(perspectiveTarget || "");
  filesRef.current = files;
  expandedPathsRef.current = expandedPaths;
  projectPathRef.current = projectPath;
  onFileOpenRef.current = onFileOpen;
  onFileOpenInPanelRef.current = onFileOpenInPanel;
  selectedPathsRef.current = selectedPaths;
  focusedPathRef.current = focusedPath;
  anchorPathRef.current = anchorPath;

  const findNodeElement = useCallback((path: string): HTMLElement | null => {
    const root = explorerRef.current;
    if (!root) {
      return null;
    }

    const escapedPath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    try {
      return root.querySelector<HTMLElement>(
        `.file-explorer-node[data-file-path="${escapedPath}"]`,
      );
    } catch {
      // Extremely unusual filenames can still break CSS string selectors.
    }

    const nodes = root.querySelectorAll<HTMLElement>(".file-explorer-node");
    for (const element of nodes) {
      if (element.dataset.filePath === path) {
        return element;
      }
    }

    return null;
  }, []);

  const activateExplorerKeyboardScope = useCallback(() => {
    explorerRef.current?.focus({ preventScroll: true });
  }, []);

  const setHighlightedPath = useCallback(
    (path: string | null, flash: boolean = true) => {
      const previousPath = highlightedPathRef.current;
      if (previousPath && previousPath !== path) {
        const previousElement = findNodeElement(previousPath);
        previousElement?.classList.remove(
          "file-explorer-node-highlighted",
          "file-explorer-node-flash",
        );
      }

      highlightedPathRef.current = path;
      setStoreHighlightedPath(path);

      if (!path) {
        return;
      }

      const nextElement = findNodeElement(path);
      if (!nextElement) {
        return;
      }

      nextElement.classList.add("file-explorer-node-highlighted");
      if (flash) {
        nextElement.classList.remove("file-explorer-node-flash");
        void nextElement.offsetWidth;
        nextElement.classList.add("file-explorer-node-flash");
      }
    },
    [findNodeElement, setStoreHighlightedPath],
  );

  // Синхронизируем isExpanded из store в файлы
  const getIsExpanded = (path: string): boolean => expandedPaths.has(path);

  const closePerspective = useCallback(() => {
    document.body.removeAttribute("data-perspective-open");
    setQuickMenu((prev) => ({ ...prev, isOpen: false }));
    setTreeOpen(false);
    setPerspectiveTarget(null);
    unblockProjectSwitch(PROJECT_SWITCH_BLOCKERS.filePerspective);
    onPerspectiveClose?.();
  }, [onPerspectiveClose]);

  useEffect(() => {
    if (!perspectiveTarget) {
      return;
    }

    const handlePerspectiveEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      closePerspective();
    };

    window.addEventListener("keydown", handlePerspectiveEscape, true);
    return () => {
      window.removeEventListener("keydown", handlePerspectiveEscape, true);
    };
  }, [closePerspective, perspectiveTarget]);

  const handlePerspectiveFileSelect = async (path: string, line?: number) => {
    const requestId = latestFileOpenRequestRef.current + 1;
    latestFileOpenRequestRef.current = requestId;
    closePerspective();
    void revealPath(path);
    if (latestFileOpenRequestRef.current !== requestId) {
      return;
    }
    onFileOpenRef.current?.(path, "", path.split("/").pop() || "", line);
  };

  const handleFileOpenInPanel = async (
    path: string,
    name: string,
    request?: Partial<PanelOpenRequest>,
  ) => {
    onFileOpenInPanelRef.current?.(path, name, undefined, request);
  };

  const renderPerspectiveOverlays = () => (
    <>
      <AnimatePresence>
        {quickMenu.isOpen && (
          <QuickRelationsMenu
            isOpen={quickMenu.isOpen}
            x={quickMenu.x}
            y={quickMenu.y}
            relations={relations}
            onClose={closePerspective}
            onFileSelect={handlePerspectiveFileSelect}
          />
        )}
      </AnimatePresence>
      {treeOpen && perspectiveTarget && (
        <DependencyTree
          filePath={perspectiveTarget}
          onClose={closePerspective}
          onFileSelect={handlePerspectiveFileSelect}
        />
      )}
    </>
  );

  const renderMarqueeSelection = () =>
    marqueeSelection ? (
      <div
        className="file-explorer-marquee"
        style={{
          left: `${marqueeSelection.left}px`,
          top: `${marqueeSelection.top}px`,
          width: `${marqueeSelection.width}px`,
          height: `${marqueeSelection.height}px`,
        }}
      />
    ) : null;

  useEffect(() => {
    return () => {
      latestProjectLoadRef.current += 1;
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const expandToPath = async (targetPath: string) => {
    if (!targetPath || !projectPath) return;

    const pathParts = targetPath.replace(projectPath + "/", "").split("/");
    pathParts.pop();

    let currentPath = projectPath;
    const pathsToExpand: string[] = [];

    for (const part of pathParts) {
      currentPath += "/" + part;
      pathsToExpand.push(currentPath);
    }

    for (const path of pathsToExpand) {
      await expandNodeByPath(path);
      // Give React a tiny window to flush the folder expansion before the next step.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  };

  const revealPath = async (path: string, clearRequest: boolean = false) => {
    if (!path || !projectPath) {
      if (clearRequest) {
        clearRevealRequest();
      }
      return;
    }

    const normalizedProjectPath = projectPath.endsWith("/")
      ? projectPath.slice(0, -1)
      : projectPath;
    const isProjectPath =
      path === normalizedProjectPath ||
      path.startsWith(`${normalizedProjectPath}/`);

    if (!isProjectPath) {
      if (clearRequest) {
        clearRevealRequest();
      }
      return;
    }

    const parentPath = getProjectPathDirname(path);
    if (parentPath && isSameOrChildPath(parentPath, normalizedProjectPath)) {
      await refreshDirectoryPath(parentPath);
    }
    await expandToPath(path);
    setHighlightedPath(path);

    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }

    scrollTimerRef.current = setTimeout(() => {
      const element = document.querySelector(`[data-file-path="${path}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);

    highlightTimerRef.current = setTimeout(() => {
      setHighlightedPath(null);
    }, 2000);

    if (clearRequest) {
      clearRevealRequest();
    }
  };

  useEffect(() => {
    if (!revealRequestPath || !projectPath) {
      return;
    }

    void revealPath(revealRequestPath, true);
  }, [projectPath, revealRequestPath]);

  const expandNodeByPath = async (path: string): Promise<void> => {
    const expandRecursive = async (
      nodes: FileNode[],
      targetPath: string,
    ): Promise<FileNode[] | null> => {
      for (const node of nodes) {
        if (node.path === targetPath) {
          if (!node.isLoaded && node.isDirectory) {
            try {
              const entries: FileEntry[] = await App.ReadDirectory(node.path);
              const childNodes: FileNode[] = buildFileNodes(entries);

              return nodes.map((n) =>
                n.path === targetPath
                  ? {
                      ...n,
                      isExpanded: true,
                      isLoaded: true,
                      children: childNodes,
                    }
                  : n,
              );
            } catch (error) {
              console.error("Error expanding node:", error);
              return null;
            }
          }

          return nodes.map((n) =>
            n.path === targetPath ? { ...n, isExpanded: true } : n,
          );
        }

        if (node.children && node.isDirectory) {
          const updated = await expandRecursive(node.children, targetPath);
          if (updated) {
            return nodes.map((n) =>
              n.path === node.path ? { ...n, children: updated } : n,
            );
          }
        }
      }

      return null;
    };

    const updatedFiles = await expandRecursive(filesRef.current, path);
    if (!updatedFiles) {
      return;
    }

    filesRef.current = updatedFiles;
    setFiles(updatedFiles);
    setExpanded(path, true);
  };

  // Загрузить содержимое папки и вернуть children
  const loadFolderChildren = async (dirPath: string): Promise<FileNode[]> => {
    try {
      const entries: FileEntry[] = await App.ReadDirectory(dirPath);
      return buildFileNodes(entries);
    } catch (error) {
      console.error("Error loading folder:", dirPath, error);
      return [];
    }
  };

  // Рекурсивно восстановить открытые папки
  const restoreExpandedFolders = async (
    nodes: FileNode[],
  ): Promise<FileNode[]> => {
    const result: FileNode[] = [];

    for (const node of nodes) {
      if (node.isDirectory && expandedPathsRef.current.has(node.path)) {
        // Эта папка была открыта — загружаем её содержимое
        const children = await loadFolderChildren(node.path);
        // Рекурсивно восстанавливаем вложенные папки
        const restoredChildren = await restoreExpandedFolders(children);
        result.push({
          ...node,
          isExpanded: true,
          isLoaded: true,
          children: restoredChildren,
        });
      } else {
        result.push(node);
      }
    }

    return result;
  };

  const loadDirectory = async (
    dirPath: string,
    isCurrentRequest: () => boolean = () => true,
  ) => {
    try {
      const entries: FileEntry[] = await App.ReadDirectory(dirPath);
      let nodes: FileNode[] = buildFileNodes(entries);

      // Восстанавливаем ранее открытые папки
      if (expandedPathsRef.current.size > 0) {
        nodes = await restoreExpandedFolders(nodes);
      }

      if (!isCurrentRequest()) {
        return;
      }
      filesRef.current = nodes;
      setFiles(nodes);
    } catch (error) {
      if (isCurrentRequest()) {
        console.error("Error reading directory:", error);
      }
    }
  };

  const loadProject = async () => {
    const requestId = latestProjectLoadRef.current + 1;
    latestProjectLoadRef.current = requestId;
    const isCurrentRequest = () => latestProjectLoadRef.current === requestId;
    setLoading(true);

    try {
      const resolvedProjectPath =
        initialProjectPath || (await App.GetCurrentProjectPath());
      if (!isCurrentRequest()) {
        return;
      }
      if (!resolvedProjectPath) {
        setProjectPath("");
        setStoreProjectPath("");
        filesRef.current = [];
        setFiles([]);
        return;
      }

      setProjectPath(resolvedProjectPath);
      setStoreProjectPath(resolvedProjectPath);
      await loadDirectory(resolvedProjectPath, isCurrentRequest);
    } catch (error) {
      if (isCurrentRequest()) {
        console.error("Error loading project:", error);
      }
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadProject();
  }, [initialProjectPath]);

  const refreshDirectoryPath = async (
    dirPath: string,
    options: RefreshDirectoryOptions = {},
  ) => {
    if (!dirPath) return;

    try {
      const entries: FileEntry[] = await App.ReadDirectory(dirPath);
      let nextChildren = buildFileNodes(entries, expandedPathsRef.current);

      if (expandedPathsRef.current.size > 0) {
        nextChildren = await restoreExpandedFolders(nextChildren);
      }

      if (dirPath === projectPathRef.current) {
        filesRef.current = nextChildren;
        setFiles(nextChildren);
        return;
      }

      const updateDirectory = (nodes: FileNode[]): FileNode[] =>
        nodes.map((node) => {
          if (node.path === dirPath) {
            return {
              ...node,
              isLoaded: true,
              isExpanded: options.preserveExpansion
                ? getIsExpanded(node.path)
                : true,
              children: nextChildren,
            };
          }
          if (!node.children) {
            return node;
          }
          return { ...node, children: updateDirectory(node.children) };
        });

      const updatedFiles = updateDirectory(filesRef.current);
      filesRef.current = updatedFiles;
      setFiles(updatedFiles);
      if (!options.preserveExpansion) {
        setExpanded(dirPath, true);
      }
    } catch (error) {
      console.error("Error refreshing directory:", dirPath, error);
    }
  };

  const pruneDeletedPathFromTree = (deletedPath: string) => {
    const pruneNodes = (nodes: FileNode[]): FileNode[] =>
      nodes.reduce<FileNode[]>((nextNodes, node) => {
        if (isSameOrChildPath(node.path, deletedPath)) {
          return nextNodes;
        }

        if (!node.children) {
          nextNodes.push(node);
          return nextNodes;
        }

        nextNodes.push({
          ...node,
          children: pruneNodes(node.children),
        });
        return nextNodes;
      }, []);

    const updatedFiles = pruneNodes(filesRef.current);
    filesRef.current = updatedFiles;
    setFiles(updatedFiles);
  };

  const normalizeProjectPath = (path: string) =>
    path.endsWith("/") ? path.slice(0, -1) : path;

  const wasRecentlyHandled = (path: string, isDirectory: boolean) => {
    const key = `${isDirectory ? "dir" : "file"}:${path}`;
    const now = Date.now();
    const lastHandledAt = recentCreatedPathsRef.current.get(key) ?? 0;

    for (const [entryKey, handledAt] of recentCreatedPathsRef.current) {
      if (now - handledAt > 1500) {
        recentCreatedPathsRef.current.delete(entryKey);
      }
    }

    if (now - lastHandledAt < 1500) {
      return true;
    }

    recentCreatedPathsRef.current.set(key, now);
    return false;
  };

  const findLoadedDirectory = (
    nodes: FileNode[],
    targetPath: string,
  ): FileNode | null => {
    for (const node of nodes) {
      if (node.path === targetPath) {
        return node.isDirectory && node.isLoaded ? node : null;
      }
      if (!node.children) {
        continue;
      }
      const match = findLoadedDirectory(node.children, targetPath);
      if (match) {
        return match;
      }
    }
    return null;
  };

  const refreshCreatedEntryParent = async (createdPath: string) => {
    const currentProjectPath = normalizeProjectPath(projectPathRef.current);
    if (!currentProjectPath) {
      return;
    }

    if (!isSameOrChildPath(createdPath, currentProjectPath)) {
      return;
    }

    const parentPath = normalizeProjectPath(
      getProjectPathDirname(createdPath) || currentProjectPath,
    );
    if (!parentPath) {
      return;
    }

    if (parentPath === currentProjectPath) {
      await refreshDirectoryPath(currentProjectPath, {
        preserveExpansion: true,
      });
      return;
    }

    if (!getIsExpanded(parentPath)) {
      return;
    }
    const parentNode = findLoadedDirectory(filesRef.current, parentPath);
    if (!parentNode) {
      return;
    }

    await refreshDirectoryPath(parentPath, { preserveExpansion: true });
  };

  useEffect(() => {
    const handleCreatedEntry = async (payload: string | CreatedEntryEvent) => {
      const createdPath = normalizeProjectPath(
        typeof payload === "string" ? payload : (payload.path ?? ""),
      );
      const isDirectory =
        typeof payload === "string" ? false : Boolean(payload.isDirectory);
      const currentProjectPath = normalizeProjectPath(projectPathRef.current);

      if (!createdPath || !currentProjectPath) {
        return;
      }

      if (!isSameOrChildPath(createdPath, currentProjectPath)) {
        return;
      }

      if (wasRecentlyHandled(createdPath, isDirectory)) {
        return;
      }

      await refreshCreatedEntryParent(createdPath);
    };

    const unsubscribeFileCreated = EventsOn("file:created", (createdPath) => {
      void handleCreatedEntry(createdPath as string);
    });
    const unsubscribeProjectEntryCreated = EventsOn(
      "project:entry:created",
      (event) => {
        void handleCreatedEntry(event as CreatedEntryEvent);
      },
    );

    return () => {
      unsubscribeFileCreated();
      unsubscribeProjectEntryCreated();
    };
  }, []);

  useEffect(() => {
    const reloadExplorerTree = async (focusPath?: string) => {
      const currentProjectPath = normalizeProjectPath(projectPathRef.current);
      if (!currentProjectPath) {
        return;
      }

      setBreadcrumbs([]);
      await loadDirectory(currentProjectPath);
      if (focusPath) {
        await revealPath(focusPath);
      }
    };

    const unsubscribeRenamed = EventsOn(
      "project:entry:renamed",
      (event: RenamedEntryEvent) => {
        const oldPath = normalizeProjectPath(event?.oldPath ?? "");
        const newPath = normalizeProjectPath(event?.newPath ?? "");
        const currentProjectPath = normalizeProjectPath(projectPathRef.current);

        if (
          !oldPath ||
          !newPath ||
          !currentProjectPath ||
          (!isSameOrChildPath(oldPath, currentProjectPath) &&
            !isSameOrChildPath(newPath, currentProjectPath))
        ) {
          return;
        }

        void reloadExplorerTree(newPath);
      },
    );

    const unsubscribeDeleted = EventsOn(
      "project:entry:deleted",
      (event: DeletedEntryEvent) => {
        const deletedPath = normalizeProjectPath(event?.path ?? "");
        const currentProjectPath = normalizeProjectPath(projectPathRef.current);

        if (
          !deletedPath ||
          !currentProjectPath ||
          !isSameOrChildPath(deletedPath, currentProjectPath)
        ) {
          return;
        }

        const currentHighlightedPath = highlightedPathRef.current;
        if (
          currentHighlightedPath &&
          isSameOrChildPath(currentHighlightedPath, deletedPath)
        ) {
          setHighlightedPath(null);
        }

        pruneDeletedPathFromTree(deletedPath);

        const parentPath = getProjectPathDirname(deletedPath);
        const refreshTarget =
          parentPath && isSameOrChildPath(parentPath, currentProjectPath)
            ? parentPath
            : currentProjectPath;
        void refreshDirectoryPath(refreshTarget);
      },
    );

    return () => {
      unsubscribeRenamed();
      unsubscribeDeleted();
    };
  }, [setHighlightedPath]);

  // ========================================
  // INLINE EXTENSION STYLE - Unique Arlecchino file icons
  // Format: filename.EXT where EXT is colored
  // ========================================

  const extColorMap: Record<string, string> = {
    php: colors.fileType.php,
    js: colors.fileType.js,
    jsx: colors.fileType.jsx,
    ts: colors.fileType.ts,
    tsx: colors.fileType.tsx,
    vue: colors.fileType.vue,
    svelte: colors.fileType.svelte,
    astro: colors.fileType.astro,
    json: colors.fileType.json,
    css: colors.fileType.css,
    scss: colors.fileType.scss,
    sass: colors.fileType.sass,
    less: colors.fileType.less,
    html: colors.fileType.html,
    htm: colors.fileType.html,
    md: colors.fileType.md,
    mdx: colors.fileType.md,
    txt: colors.fileType.txt,
    yaml: colors.fileType.yaml,
    yml: colors.fileType.yml,
    toml: colors.fileType.toml,
    sql: colors.fileType.sql,
    go: colors.fileType.go,
    mod: colors.fileType.go,
    sum: colors.fileType.go,
    rs: colors.fileType.rs,
    py: colors.fileType.py,
    rb: colors.fileType.rb,
    java: colors.fileType.java,
    kt: colors.fileType.kt,
    kts: colors.fileType.kt,
    scala: colors.fileType.scala,
    sc: colors.fileType.scala,
    cs: colors.fileType.cs,
    cpp: colors.fileType.cpp,
    cc: colors.fileType.cpp,
    cxx: colors.fileType.cpp,
    c: colors.fileType.c,
    h: colors.fileType.h,
    hpp: colors.fileType.hpp,
    hxx: colors.fileType.hpp,
    swift: colors.fileType.swift,
    dart: colors.fileType.dart,
    lua: colors.fileType.lua,
    pl: colors.fileType.pl,
    pm: colors.fileType.pl,
    r: colors.fileType.r,
    R: colors.fileType.r,
    hs: colors.fileType.hs,
    lhs: colors.fileType.hs,
    clj: colors.fileType.clj,
    cljs: colors.fileType.clj,
    cljc: colors.fileType.clj,
    erl: colors.fileType.erl,
    hrl: colors.fileType.erl,
    ex: colors.fileType.ex,
    exs: colors.fileType.ex,
    groovy: colors.fileType.groovy,
    gradle: colors.fileType.groovy,
    sh: colors.fileType.sh,
    bash: colors.fileType.bash,
    zsh: colors.fileType.zsh,
    fish: colors.fileType.sh,
    ps1: colors.fileType.ps1,
    psm1: colors.fileType.ps1,
    psd1: colors.fileType.ps1,
    conf: colors.fileType.nginx,
    nginx: colors.fileType.nginx,
    proto: colors.fileType.proto,
    xml: colors.fileType.xml,
    xsl: colors.fileType.xml,
    xslt: colors.fileType.xml,
    svg: colors.fileType.svg,
    diff: colors.fileType.diff,
    patch: colors.fileType.patch,
    m: colors.fileType.m,
    mm: colors.fileType.mm,
    graphql: colors.fileType.graphql,
    gql: colors.fileType.gql,
    prisma: colors.fileType.prisma,
    tf: colors.fileType.tf,
    hcl: colors.fileType.tf,
    sol: colors.fileType.sol,
    zig: colors.fileType.zig,
    nim: colors.fileType.nim,
    v: colors.fileType.v,
    env: colors.fileType.env,
    lock: "#6B7280",
    gitignore: "#F05032",
    dockerignore: colors.fileType.dockerfile,
    editorconfig: "#FEFEFE",
    prettierrc: "#F7B93E",
    eslintrc: "#4B32C3",
    babelrc: "#F9DC3E",
  };

  const imageFileExtensions = new Set([
    "png",
    "jpg",
    "jpeg",
    "jpe",
    "jfif",
    "gif",
    "webp",
    "ico",
    "bmp",
    "avif",
  ]);

  const extensionLabelMap: Record<string, string> = {
    ts: "TS",
    tsx: "TSX",
    js: "JS",
    jsx: "JSX",
    go: "GO",
    mod: "MOD",
    sum: "SUM",
    rs: "RS",
    py: "PY",
    rb: "RB",
    php: "PHP",
    vue: "VUE",
    svelte: "SVLT",
    css: "CSS",
    scss: "SCSS",
    sass: "SASS",
    less: "LESS",
    html: "HTML",
    htm: "HTML",
    json: "JSON",
    yaml: "YML",
    yml: "YML",
    toml: "TOML",
    sql: "SQL",
    md: "MD",
    mdx: "MD",
    txt: "TXT",
    java: "JAVA",
    kt: "KT",
    scala: "SCALA",
    cs: "C#",
    cpp: "C++",
    cc: "C++",
    cxx: "C++",
    c: "C",
    h: "H",
    hpp: "H++",
    swift: "SWIFT",
    dart: "DART",
    lua: "LUA",
    pl: "PERL",
    r: "R",
    hs: "HS",
    clj: "CLJ",
    erl: "ERL",
    ex: "EX",
    sh: "SH",
    bash: "SH",
    zsh: "SH",
    fish: "SH",
    ps1: "PS",
    proto: "PROTO",
    xml: "XML",
    svg: "SVG",
    graphql: "GQL",
    gql: "GQL",
    prisma: "PRISMA",
    tf: "TF",
    hcl: "TF",
    zig: "ZIG",
    nim: "NIM",
    v: "V",
    lock: "LOCK",
    env: "ENV",
    png: "IMG",
    jpg: "IMG",
    jpeg: "IMG",
    jpe: "IMG",
    jfif: "IMG",
    gif: "IMG",
    webp: "IMG",
    bmp: "IMG",
    avif: "IMG",
    ico: "ICO",
  };

  type FileNameDisplayParts = {
    baseName: string;
    suffixLabel: string;
    suffixColor: string;
  };

  const getKnownExtension = (fileName: string): string | null => {
    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
      return null;
    }

    const extension = fileName.slice(dotIndex + 1).toLowerCase();
    return extension in extColorMap || imageFileExtensions.has(extension)
      ? extension
      : null;
  };

  const getExtensionColor = (extension: string): string => {
    if (imageFileExtensions.has(extension)) {
      return colors.fileType.image;
    }

    return extColorMap[extension] || theme.textMuted;
  };

  const getSpecialConfigBaseName = (
    fileName: string,
    lowerName: string,
    marker: string,
  ): string => {
    if (fileName.startsWith(".")) {
      return fileName.split(".").slice(1, -1).join(".");
    }

    const markerIndex = lowerName.indexOf(marker);
    return markerIndex > 0 ? fileName.slice(0, markerIndex) : "";
  };

  const getFileNameDisplayParts = (
    fileName: string,
  ): FileNameDisplayParts | null => {
    const lowerName = fileName.toLowerCase();

    if (lowerName.endsWith(".blade.php")) {
      return {
        baseName: fileName.replace(/\.blade\.php$/i, ""),
        suffixLabel: "BLADE",
        suffixColor: colors.fileType.blade,
      };
    }

    if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile.")) {
      return {
        baseName: fileName.split(".")[0] || fileName,
        suffixLabel: "DOCKER",
        suffixColor: colors.fileType.dockerfile,
      };
    }

    if (lowerName === "makefile") {
      return {
        baseName: fileName,
        suffixLabel: "MAKE",
        suffixColor: "#6B7280",
      };
    }

    if (lowerName === ".gitignore") {
      return { baseName: "", suffixLabel: "GIT", suffixColor: "#F05032" };
    }

    if (lowerName === ".dockerignore") {
      return {
        baseName: "",
        suffixLabel: "DOCKER",
        suffixColor: colors.fileType.dockerfile,
      };
    }

    if (lowerName === ".env" || lowerName.startsWith(".env.")) {
      const parts = fileName.split(".");
      return {
        baseName: parts.length === 2 ? "" : parts.slice(1, -1).join("."),
        suffixLabel: "ENV",
        suffixColor: colors.fileType.env,
      };
    }

    if (lowerName === ".editorconfig") {
      return { baseName: "", suffixLabel: "CFG", suffixColor: "#FEFEFE" };
    }

    if (lowerName.includes(".prettierrc")) {
      return {
        baseName: getSpecialConfigBaseName(fileName, lowerName, ".prettierrc"),
        suffixLabel: "FMT",
        suffixColor: "#F7B93E",
      };
    }

    if (lowerName.includes(".eslintrc")) {
      return {
        baseName: getSpecialConfigBaseName(fileName, lowerName, ".eslintrc"),
        suffixLabel: "LINT",
        suffixColor: "#4B32C3",
      };
    }

    if (lowerName.includes(".babelrc")) {
      return {
        baseName: getSpecialConfigBaseName(fileName, lowerName, ".babelrc"),
        suffixLabel: "BABEL",
        suffixColor: "#F9DC3E",
      };
    }

    const extension = getKnownExtension(fileName);
    if (!extension) {
      return null;
    }

    return {
      baseName: fileName.slice(0, fileName.lastIndexOf(".")),
      suffixLabel: extensionLabelMap[extension] || extension.toUpperCase(),
      suffixColor: getExtensionColor(extension),
    };
  };

  const renderFileNameLabel = (fileName: string) => {
    const displayParts = getFileNameDisplayParts(fileName);

    return (
      <span
        style={{
          fontSize: "13px",
          color: "var(--text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {displayParts ? (
          <>
            {displayParts.baseName}
            <span style={{ color: "var(--text-muted)" }}>.</span>
            <span
              style={{
                color: displayParts.suffixColor,
                fontWeight: 700,
                fontSize: "11px",
                letterSpacing: "0.3px",
                fontFamily:
                  "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
              }}
            >
              {displayParts.suffixLabel}
            </span>
          </>
        ) : (
          fileName
        )}
      </span>
    );
  };

  const renderExplorerTreeGuides = (
    level: number,
    isLast: boolean,
    parentGuides: boolean[],
    guideColor: string,
  ) => {
    if (level === 0) return null;
    return (
      <div style={{ display: "flex", alignItems: "stretch", height: "30px" }}>
        {parentGuides.map((showLine, i) => (
          <div
            key={i}
            style={{
              width: "16px",
              position: "relative",
              flexShrink: 0,
            }}
          >
            {showLine && (
              <div
                style={{
                  position: "absolute",
                  left: "7px",
                  top: 0,
                  bottom: 0,
                  width: "1px",
                  backgroundColor: guideColor,
                }}
              />
            )}
          </div>
        ))}
        <div
          style={{
            width: "16px",
            position: "relative",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "7px",
              top: 0,
              height: isLast ? "15px" : "100%",
              width: "1px",
              backgroundColor: guideColor,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "7px",
              top: "14px",
              width: "9px",
              height: "1px",
              backgroundColor: guideColor,
            }}
          />
        </div>
      </div>
    );
  };

  const renderFileExplorerDragGhostContent = (
    node: FileNode,
    level: number,
    isLast: boolean,
    parentGuides: boolean[],
  ) => {
    const guideColor = isDark ? "var(--border-subtle)" : "rgba(0,0,0,0.15)";
    const hoverBackground = isDark ? "var(--bg-tertiary)" : "rgba(0,0,0,0.03)";

    return (
      <div
        className="file-explorer-node file-explorer-node-drag-copy"
        data-drag-ghost-source="file-explorer-node"
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          height: "100%",
          minHeight: "30px",
          paddingLeft: "8px",
          paddingRight: `${FILE_EXPLORER_NODE_RIGHT_INSET}px`,
          borderRadius: "var(--radius-sm)",
          cursor: "grabbing",
          background: hoverBackground,
        }}
      >
        {renderExplorerTreeGuides(level, isLast, parentGuides, guideColor)}
        {renderFileNameLabel(node.name)}
      </div>
    );
  };

  const findNodeByPath = useCallback((path: string): FileNode | null => {
    const walk = (nodes: FileNode[]): FileNode | null => {
      for (const current of nodes) {
        if (current.path === path) {
          return current;
        }
        if (current.children) {
          const child = walk(current.children);
          if (child) {
            return child;
          }
        }
      }
      return null;
    };
    return walk(filesRef.current);
  }, []);

  const getExplorerScrollElement = useCallback((): HTMLElement | null => {
    const root = explorerRef.current;
    if (!root) {
      return null;
    }
    return (
      root.querySelector<HTMLElement>(
        '[data-testid="file-explorer-scroll-region"]',
      ) ?? root
    );
  }, []);

  const getSelectedNodesInTreeOrder = useCallback((): FileNode[] => {
    const selected = selectedPathsRef.current;
    const selectedNodes: FileNode[] = [];
    const walk = (nodes: FileNode[]) => {
      nodes.forEach((node) => {
        if (selected.has(node.path)) {
          selectedNodes.push(node);
        }
        if (node.children) {
          walk(node.children);
        }
      });
    };
    walk(filesRef.current);
    return selectedNodes;
  }, []);

  const dedupeAncestorSelectedNodes = useCallback((nodes: FileNode[]) => {
    return nodes.filter(
      (node) =>
        !nodes.some(
          (candidateParent) =>
            candidateParent.path !== node.path &&
            isSameOrChildPath(node.path, candidateParent.path),
        ),
    );
  }, []);

  const pruneCollapsedDescendantSelection = useCallback(
    (collapsedPath: string) => {
      const selected = selectedPathsRef.current;
      let changed = false;
      const nextSelectedPaths = new Set<string>();
      selected.forEach((path) => {
        if (path !== collapsedPath && isSameOrChildPath(path, collapsedPath)) {
          changed = true;
          return;
        }
        nextSelectedPaths.add(path);
      });
      if (!changed) {
        return;
      }

      const nextFocusedPath = nextSelectedPaths.has(
        focusedPathRef.current ?? "",
      )
        ? focusedPathRef.current
        : nextSelectedPaths.has(collapsedPath)
          ? collapsedPath
          : (Array.from(nextSelectedPaths).at(-1) ?? null);
      const nextAnchorPath = nextSelectedPaths.has(anchorPathRef.current ?? "")
        ? anchorPathRef.current
        : (nextFocusedPath ?? Array.from(nextSelectedPaths)[0] ?? null);
      setSelectedPaths(nextSelectedPaths, {
        focusedPath: nextFocusedPath,
        anchorPath: nextAnchorPath,
      });
    },
    [setSelectedPaths],
  );

  const selectNodesIntersectingViewportRect = useCallback(
    (rect: DOMRect) => {
      const root = explorerRef.current;
      if (!root) {
        return;
      }
      const selected: string[] = [];
      const nodes = root.querySelectorAll<HTMLElement>(".file-explorer-node");
      nodes.forEach((element) => {
        const path = element.dataset.filePath;
        if (!path) {
          return;
        }
        const nodeRect = element.getBoundingClientRect();
        const intersects =
          rect.left <= nodeRect.right &&
          rect.right >= nodeRect.left &&
          rect.top <= nodeRect.bottom &&
          rect.bottom >= nodeRect.top;
        if (intersects) {
          selected.push(path);
        }
      });
      setSelectedPaths(selected, {
        focusedPath: selected[selected.length - 1] ?? null,
        anchorPath: selected[0] ?? null,
      });
    },
    [setSelectedPaths],
  );

  const getExplorerDropDirectory = useCallback(
    (clientX: number, clientY: number, draggedNode: FileNode) => {
      const root = explorerRef.current;
      if (!root) {
        return null;
      }
      const element = document.elementFromPoint(clientX, clientY);
      if (!element || !root.contains(element)) {
        return null;
      }

      const nodeElement = element.closest<HTMLElement>(".file-explorer-node");
      let targetDirectory = projectPathRef.current;
      if (nodeElement && root.contains(nodeElement)) {
        const targetPath = nodeElement.dataset.filePath ?? "";
        const targetNode = targetPath ? findNodeByPath(targetPath) : null;
        if (targetNode?.isDirectory) {
          targetDirectory = targetNode.path;
        } else if (targetPath) {
          targetDirectory =
            getProjectPathDirname(targetPath) || projectPathRef.current;
        }
      }

      if (!targetDirectory) {
        return null;
      }
      if (
        draggedNode.isDirectory &&
        isSameOrChildPath(targetDirectory, draggedNode.path)
      ) {
        return null;
      }
      return targetDirectory;
    },
    [findNodeByPath],
  );

  const getEditorTabsDropTarget = useCallback(
    (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      return (
        element?.closest<HTMLElement>('[data-testid="editor-tabs-bar"]') ?? null
      );
    },
    [],
  );

  const getEditorSplitDropTarget = useCallback(
    (clientX: number, clientY: number): EditorSplitDropSide | null => {
      const editorSurface = document.querySelector<HTMLElement>(
        '[data-testid="editor-surface"]',
      );
      const rect = editorSurface?.getBoundingClientRect();
      if (
        !rect ||
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }

      return clientX < rect.left + rect.width / 2 ? "left" : "right";
    },
    [],
  );

  const clearEditorTabsDropHighlight = useCallback(() => {
    highlightedEditorTabsRef.current?.classList.remove(
      "editor-tabs-code-drop-target",
    );
    highlightedEditorTabsRef.current = null;
  }, []);

  const emitEditorSplitDrag = useCallback(
    (side: EditorSplitDropSide | null) => {
      window.dispatchEvent(
        new CustomEvent(EDITOR_FILE_SPLIT_DRAG_EVENT, {
          detail: { side },
        }),
      );
    },
    [],
  );

  const emitEditorSplitDrop = useCallback(
    (node: FileNode, side: EditorSplitDropSide) => {
      window.dispatchEvent(
        new CustomEvent(EDITOR_FILE_SPLIT_DROP_EVENT, {
          detail: {
            path: node.path,
            name: node.name,
            side,
          },
        }),
      );
    },
    [],
  );

  const autoScrollExplorerForDrag = useCallback(
    (clientY: number) => {
      const scrollElement = getExplorerScrollElement();
      if (!scrollElement) {
        return;
      }
      const rect = scrollElement.getBoundingClientRect();
      if (clientY < rect.top + 34) {
        scrollElement.scrollTop -= 18;
      } else if (clientY > rect.bottom - 34) {
        scrollElement.scrollTop += 18;
      }
    },
    [getExplorerScrollElement],
  );

  const handleExplorerMarqueePointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (
        event.button !== 0 ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          ".file-explorer-node, button, [data-shell-menu-content], [data-radix-popper-content-wrapper]",
        )
      ) {
        return;
      }

      const scrollElement = getExplorerScrollElement();
      if (!scrollElement) {
        return;
      }

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const startScrollLeft = scrollElement.scrollLeft;
      const startScrollTop = scrollElement.scrollTop;
      let active = false;
      let releaseSelectionLock: (() => void) | null = null;

      const updateMarquee = (clientX: number, clientY: number) => {
        const rect = scrollElement.getBoundingClientRect();
        const currentX = clientX - rect.left + scrollElement.scrollLeft;
        const currentY = clientY - rect.top + scrollElement.scrollTop;
        const originX = startX - rect.left + startScrollLeft;
        const originY = startY - rect.top + startScrollTop;
        setMarqueeSelection({
          left: Math.min(originX, currentX),
          top: Math.min(originY, currentY),
          width: Math.abs(currentX - originX),
          height: Math.abs(currentY - originY),
        });
        selectNodesIntersectingViewportRect(
          new DOMRect(
            Math.min(startX, clientX),
            Math.min(startY, clientY),
            Math.abs(clientX - startX),
            Math.abs(clientY - startY),
          ),
        );
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove, true);
        window.removeEventListener("pointerup", handlePointerUp, true);
        window.removeEventListener("pointercancel", handlePointerCancel, true);
        releaseSelectionLock?.();
        releaseSelectionLock = null;
      };

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }
        const dx = pointerEvent.clientX - startX;
        const dy = pointerEvent.clientY - startY;
        if (!active && Math.hypot(dx, dy) > 5) {
          active = true;
          releaseSelectionLock = beginDragSelectionLock();
        }
        if (!active) {
          return;
        }
        pointerEvent.preventDefault();
        autoScrollExplorerForDrag(pointerEvent.clientY);
        updateMarquee(pointerEvent.clientX, pointerEvent.clientY);
      };

      const handlePointerUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
        setMarqueeSelection(null);
        if (!active) {
          clearSelection();
        }
      };

      const handlePointerCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
        setMarqueeSelection(null);
      };

      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", handlePointerUp, true);
      window.addEventListener("pointercancel", handlePointerCancel, true);
    },
    [
      autoScrollExplorerForDrag,
      clearSelection,
      getExplorerScrollElement,
      selectNodesIntersectingViewportRect,
    ],
  );

  const handleNodePointerDown = (
    node: FileNode,
    event: React.PointerEvent<HTMLDivElement>,
    level: number,
    isLast: boolean,
    parentGuides: boolean[],
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    const releaseSelectionLock = beginDragSelectionLock();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const sourceRect = event.currentTarget.getBoundingClientRect();
    const offsetX = startX - sourceRect.left;
    const offsetY = startY - sourceRect.top;
    let activeDrag = false;
    let latestDropTarget: string | null = null;
    let latestSnapTarget: ReturnType<typeof detectPanelSnapDropTarget> = null;
    let latestEditorSplitTarget: EditorSplitDropSide | null = null;
    let snapDragStarted = false;

    const updatePanelSnapDrag = (nextSnapTarget: typeof latestSnapTarget) => {
      if (!snapDragStarted) {
        snapDragStarted = true;
        onPanelSnapDragStart?.();
      }
      if (latestSnapTarget !== nextSnapTarget) {
        onPanelSnapDragMove?.(nextSnapTarget);
      }
      latestSnapTarget = nextSnapTarget;
    };

    const updateEditorSplitDrag = (
      nextSplitTarget: EditorSplitDropSide | null,
    ) => {
      if (latestEditorSplitTarget === nextSplitTarget) {
        return;
      }
      latestEditorSplitTarget = nextSplitTarget;
      emitEditorSplitDrag(nextSplitTarget);
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }

      const dx = pointerEvent.clientX - startX;
      const dy = pointerEvent.clientY - startY;
      if (!activeDrag && Math.hypot(dx, dy) > 7) {
        activeDrag = true;
        suppressNodeClickRef.current = true;
      }
      if (!activeDrag) {
        return;
      }

      pointerEvent.preventDefault();
      document.getSelection()?.removeAllRanges();
      autoScrollExplorerForDrag(pointerEvent.clientY);
      const root = explorerRef.current;
      const rect = root?.getBoundingClientRect();
      const insideExplorer = Boolean(
        rect &&
        pointerEvent.clientX >= rect.left &&
        pointerEvent.clientX <= rect.right &&
        pointerEvent.clientY >= rect.top &&
        pointerEvent.clientY <= rect.bottom,
      );
      const editorTabsTarget =
        !insideExplorer && !node.isDirectory
          ? getEditorTabsDropTarget(pointerEvent.clientX, pointerEvent.clientY)
          : null;
      if (highlightedEditorTabsRef.current !== editorTabsTarget) {
        clearEditorTabsDropHighlight();
        if (editorTabsTarget) {
          editorTabsTarget.classList.add("editor-tabs-code-drop-target");
          highlightedEditorTabsRef.current = editorTabsTarget;
        }
      }
      const editorSplitTarget =
        !insideExplorer && !node.isDirectory && !editorTabsTarget
          ? getEditorSplitDropTarget(pointerEvent.clientX, pointerEvent.clientY)
          : null;
      const snapTarget =
        !insideExplorer &&
        !node.isDirectory &&
        !editorTabsTarget &&
        !editorSplitTarget
          ? detectPanelSnapDropTarget(
              pointerEvent.clientX,
              pointerEvent.clientY,
            )
          : null;
      updateEditorSplitDrag(editorSplitTarget);
      if (editorSplitTarget || editorTabsTarget) {
        if (snapDragStarted) {
          updatePanelSnapDrag(null);
        }
      } else {
        updatePanelSnapDrag(snapTarget);
      }
      latestDropTarget = getExplorerDropDirectory(
        pointerEvent.clientX,
        pointerEvent.clientY,
        node,
      );
      setDropTargetPath(latestDropTarget);
      if (node.isDirectory) {
        setDragGhost({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          label: node.name,
          detail: latestDropTarget
            ? `Move to ${latestDropTarget.split("/").pop() || latestDropTarget}`
            : "Folder can be moved inside Explorer",
        });
        return;
      }

      setDragGhost({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        label: node.name,
        variant: "layout",
        layout: "file-explorer-node",
        content: renderFileExplorerDragGhostContent(
          node,
          level,
          isLast,
          parentGuides,
        ),
        width: sourceRect.width,
        height: sourceRect.height,
        offsetX,
        offsetY,
      });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      if (snapDragStarted) {
        onPanelSnapDragEnd?.();
      }
      clearEditorTabsDropHighlight();
      updateEditorSplitDrag(null);
      releaseSelectionLock();
    };

    const resetClickSuppression = () => {
      window.setTimeout(() => {
        suppressNodeClickRef.current = false;
      }, 0);
    };

    const handlePointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      setDropTargetPath(null);
      setDragGhost(null);
      resetClickSuppression();
    };

    const handlePointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      const wasActiveDrag = activeDrag;
      const dropTarget = latestDropTarget;
      setDropTargetPath(null);
      setDragGhost(null);
      if (!wasActiveDrag) {
        return;
      }

      resetClickSuppression();
      const root = explorerRef.current;
      const rect = root?.getBoundingClientRect();
      const insideExplorer = Boolean(
        rect &&
        pointerEvent.clientX >= rect.left &&
        pointerEvent.clientX <= rect.right &&
        pointerEvent.clientY >= rect.top &&
        pointerEvent.clientY <= rect.bottom,
      );

      if (!insideExplorer) {
        if (!node.isDirectory) {
          const editorTabsTarget = getEditorTabsDropTarget(
            pointerEvent.clientX,
            pointerEvent.clientY,
          );
          if (editorTabsTarget) {
            onFileOpenRef.current?.(node.path, "", node.name);
            return;
          }

          const editorSplitTarget = getEditorSplitDropTarget(
            pointerEvent.clientX,
            pointerEvent.clientY,
          );
          if (editorSplitTarget) {
            emitEditorSplitDrop(node, editorSplitTarget);
            return;
          }

          void handleFileOpenInPanel(
            node.path,
            node.name,
            latestSnapTarget
              ? {
                  mode: "snapped",
                  position: latestSnapTarget,
                  width: 560,
                  height: 360,
                  reflowOnSnap: true,
                }
              : {
                  mode: "floating",
                  x: Math.max(16, pointerEvent.clientX - 280),
                  y: Math.max(64, pointerEvent.clientY - 24),
                  width: 560,
                  height: 360,
                },
          );
        }
        return;
      }

      if (!dropTarget) {
        return;
      }
      const sourceParent =
        getProjectPathDirname(node.path) || projectPathRef.current;
      if (sourceParent === dropTarget) {
        return;
      }

      void requestMoveEntry({
        path: node.path,
        isDirectory: node.isDirectory,
        targetDirectory: dropTarget,
      });
    };

    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
  };

  const handleNodeClick = async (node: FileNode, e?: React.MouseEvent) => {
    if (suppressNodeClickRef.current) {
      e?.preventDefault();
      e?.stopPropagation();
      return;
    }

    const clickIntent = e
      ? resolveExplorerNodeClickIntent(
          {
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
          },
          node.isDirectory,
        )
      : "default";

    if (e && clickIntent === "toggleSelection") {
      e.preventDefault();
      e.stopPropagation();
      toggleSelectedPath(node.path, { preserveAnchor: true });
      setHighlightedPath(node.path, false);
      return;
    }

    if (e && !node.isDirectory) {
      if (clickIntent === "openQuickRelations") {
        e.preventDefault();
        e.stopPropagation();
        const clickX = e.clientX;
        const clickY = e.clientY;
        blockProjectSwitch(PROJECT_SWITCH_BLOCKERS.filePerspective);
        setPerspectiveTarget(node.path);
        setQuickMenu({
          isOpen: true,
          x: clickX,
          y: clickY,
        });
        return;
      }
      if (clickIntent === "openDependencyTree") {
        e.preventDefault();
        e.stopPropagation();

        blockProjectSwitch(PROJECT_SWITCH_BLOCKERS.filePerspective);
        setPerspectiveTarget(node.path);
        setTreeOpen(true);
        if (onPerspectiveOpen) {
          onPerspectiveOpen();
        }
        return;
      }
    }

    if (!node.isDirectory) {
      const requestId = latestFileOpenRequestRef.current + 1;
      latestFileOpenRequestRef.current = requestId;
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      selectSinglePath(node.path);
      setHighlightedPath(node.path);

      try {
        if (latestFileOpenRequestRef.current !== requestId) {
          return;
        }
        onFileOpenRef.current?.(node.path, "", node.name);
      } catch (error) {
        if (latestFileOpenRequestRef.current === requestId) {
          console.error("Error reading file:", error);
        }
      }
      return;
    }

    latestFileOpenRequestRef.current += 1;
    selectSinglePath(node.path);
    setHighlightedPath(node.path, false);
    await toggleDirectory(node);
  };

  const navigateToBreadcrumb = async (node: FileNode) => {
    if (!node.isLoaded && node.isDirectory) {
      await loadFolderContents(node);
    }

    const findNodeByPath = (
      nodes: FileNode[],
      targetPath: string,
    ): FileNode | null => {
      for (const currentNode of nodes) {
        if (currentNode.path === targetPath) {
          return currentNode;
        }

        if (currentNode.children) {
          const nestedNode = findNodeByPath(currentNode.children, targetPath);
          if (nestedNode) {
            return nestedNode;
          }
        }
      }

      return null;
    };

    const pathParts = node.path.replace(projectPath + "/", "").split("/");
    const newBreadcrumbs: Breadcrumb[] = [];
    let currentPath = projectPath;

    for (const part of pathParts) {
      currentPath += "/" + part;
      let childNode = findNodeByPath(filesRef.current, currentPath);
      if (childNode) {
        if (!childNode.isLoaded && childNode.isDirectory) {
          await loadFolderContents(childNode);
          childNode = findNodeByPath(filesRef.current, currentPath);
        }

        if (!childNode) {
          break;
        }

        newBreadcrumbs.push({ name: part, path: currentPath, node: childNode });
      }
    }

    setBreadcrumbs(newBreadcrumbs);
  };

  const loadFolderContents = async (node: FileNode) => {
    if (!node.isDirectory) return;

    if (!node.isLoaded) {
      try {
        const entries: FileEntry[] = await App.ReadDirectory(node.path);
        const childNodes: FileNode[] = buildFileNodes(entries);

        const updatedNode = { ...node, isLoaded: true, children: childNodes };

        const updateNode = (nodes: FileNode[]): FileNode[] => {
          return nodes.map((n) => {
            if (n.path === node.path) {
              return updatedNode;
            }
            if (n.children) {
              return { ...n, children: updateNode(n.children) };
            }
            return n;
          });
        };

        setFiles((currentFiles) => {
          const updatedFiles = updateNode(currentFiles);
          filesRef.current = updatedFiles;
          return updatedFiles;
        });
      } catch (error) {
        console.error("Error loading folder:", error);
      }
    }
  };

  const toggleDirectory = async (node: FileNode) => {
    if (!node.isDirectory) return;

    const isCurrentlyExpanded = getIsExpanded(node.path);

    if (!node.isLoaded && !isCurrentlyExpanded) {
      try {
        const entries: FileEntry[] = await App.ReadDirectory(node.path);
        const childNodes: FileNode[] = buildFileNodes(entries, expandedPaths);

        const updateNode = (nodes: FileNode[]): FileNode[] => {
          return nodes.map((n) => {
            if (n.path === node.path) {
              return {
                ...n,
                isExpanded: true,
                isLoaded: true,
                children: childNodes,
              };
            }
            if (n.children) {
              return { ...n, children: updateNode(n.children) };
            }
            return n;
          });
        };

        setFiles((currentFiles) => {
          const updatedFiles = updateNode(currentFiles);
          filesRef.current = updatedFiles;
          return updatedFiles;
        });
        setExpanded(node.path, true);
      } catch (error) {
        console.error("Error loading directory:", error);
      }
    } else {
      // Toggle expanded state in store
      toggleExpanded(node.path);
      if (isCurrentlyExpanded) {
        pruneCollapsedDescendantSelection(node.path);
      }

      const updateNode = (nodes: FileNode[]): FileNode[] => {
        return nodes.map((n) => {
          if (n.path === node.path) {
            return { ...n, isExpanded: !isCurrentlyExpanded };
          }
          if (n.children) {
            return { ...n, children: updateNode(n.children) };
          }
          return n;
        });
      };

      setFiles((currentFiles) => {
        const updatedFiles = updateNode(currentFiles);
        filesRef.current = updatedFiles;
        return updatedFiles;
      });
    }
  };

  const getContextSelectionForNode = useCallback(
    (node: FileNode): FileNode[] => {
      if (!selectedPathsRef.current.has(node.path)) {
        return [node];
      }
      const selectedNodes = getSelectedNodesInTreeOrder();
      return selectedNodes.length > 0 ? selectedNodes : [node];
    },
    [getSelectedNodesInTreeOrder],
  );

  const openContextSelection = useCallback(
    async (nodes: FileNode[]) => {
      const maxBatchOpen = 20;
      let openedFiles = 0;
      for (const selectedNode of nodes) {
        if (selectedNode.isDirectory) {
          await toggleDirectory(selectedNode);
          continue;
        }
        if (openedFiles >= maxBatchOpen) {
          break;
        }
        openedFiles += 1;
        onFileOpenRef.current?.(selectedNode.path, "", selectedNode.name);
      }
    },
    [toggleDirectory],
  );

  const handleNodeContextMenuCapture = useCallback(
    (node: FileNode) => {
      if (selectedPathsRef.current.has(node.path)) {
        return;
      }
      selectSinglePath(node.path);
      setHighlightedPath(node.path, false);
    },
    [selectSinglePath, setHighlightedPath],
  );

  const handleRootContextMenuCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".file-explorer-node")) {
        return;
      }
      clearSelection();
    },
    [clearSelection],
  );

  const buildNodeContextActions = (node: FileNode): ContextActionMenuItem[] => {
    const selectedNodes = getContextSelectionForNode(node);
    const entryActionNodes = dedupeAncestorSelectedNodes(selectedNodes);
    const isBatch = selectedNodes.length > 1;
    const singleTarget: ProjectEntryActionTarget = {
      path: node.path,
      isDirectory: node.isDirectory,
    };
    const selectedFiles = selectedNodes.filter((entry) => !entry.isDirectory);
    const selectedFolders = selectedNodes.filter((entry) => entry.isDirectory);
    const selectedLabel = isBatch
      ? `${selectedNodes.length} Selected`
      : node.isDirectory
        ? "Open / Expand"
        : "Open";

    return [
      {
        label: selectedLabel,
        icon:
          selectedFolders.length > 0 && selectedFiles.length === 0 ? (
            <FolderOpen size={14} />
          ) : (
            <File size={14} />
          ),
        onSelect: () => {
          if (isBatch) {
            void openContextSelection(entryActionNodes);
          } else {
            void handleNodeClick(node);
          }
        },
      },
      !node.isDirectory && !isBatch
        ? {
            label: "Open in Panel",
            icon: <PanelRightOpen size={14} />,
            onSelect: () => {
              void handleFileOpenInPanel(node.path, node.name);
            },
          }
        : { hidden: true },
      node.isDirectory && !isBatch
        ? {
            label: "New File",
            icon: <FilePlus size={14} />,
            onSelect: () => requestCreateEntry("file", node.path),
          }
        : { hidden: true },
      node.isDirectory && !isBatch
        ? {
            label: "New Folder",
            icon: <FolderPlus size={14} />,
            onSelect: () => requestCreateEntry("folder", node.path),
          }
        : { hidden: true },
      {
        label: "Rename",
        icon: <Edit3 size={14} />,
        hidden: isBatch,
        onSelect: () => requestRenameEntry(singleTarget),
      },
      { separator: true },
      {
        label: isBatch ? "Copy Relative Paths" : "Copy Relative Path",
        icon: <Copy size={14} />,
        onSelect: () => {
          if (isBatch) {
            void copyText(
              selectedNodes
                .map((entry) => getRelativePath(entry.path))
                .join("\n"),
              "Relative paths copied",
            );
          } else {
            void copyRelativePath(node.path);
          }
        },
      },
      {
        label: isBatch ? "Copy Absolute Paths" : "Copy Absolute Path",
        icon: <Copy size={14} />,
        onSelect: () => {
          if (isBatch) {
            void copyText(
              selectedNodes.map((entry) => entry.path).join("\n"),
              "Absolute paths copied",
            );
          } else {
            void copyAbsolutePath(node.path);
          }
        },
      },
      {
        label: "Reveal in File Manager",
        icon: <ExternalLink size={14} />,
        hidden: isBatch,
        onSelect: () => {
          void revealEntry(node.path);
        },
      },
      { separator: true },
      {
        label: isBatch ? "Move Selected to Trash" : "Move to Trash",
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () => {
          if (isBatch) {
            requestTrashEntries({
              entries: entryActionNodes.map((entry) => ({
                path: entry.path,
                isDirectory: entry.isDirectory,
                displayName: entry.name,
              })),
              displayName: `${entryActionNodes.length} selected entries`,
            });
            return;
          }
          requestTrashEntry({
            ...singleTarget,
            displayName: node.name,
          });
        },
      },
    ];
  };

  const rootContextActions: ContextActionMenuItem[] = [
    {
      label: "New File",
      icon: <FilePlus size={14} />,
      onSelect: () =>
        requestCreateEntry(
          "file",
          projectPathRef.current || contextProjectPath,
        ),
    },
    {
      label: "New Folder",
      icon: <FolderPlus size={14} />,
      onSelect: () =>
        requestCreateEntry(
          "folder",
          projectPathRef.current || contextProjectPath,
        ),
    },
    { separator: true },
    {
      label: "Copy Project Path",
      icon: <Copy size={14} />,
      onSelect: () => {
        void copyProjectPath();
      },
    },
    {
      label: "Reveal Project Root",
      icon: <ExternalLink size={14} />,
      onSelect: () => {
        void revealEntry(projectPathRef.current || contextProjectPath);
      },
    },
    {
      label: "Refresh",
      icon: <RefreshCw size={14} />,
      onSelect: () => {
        void loadDirectory(projectPathRef.current || contextProjectPath);
      },
    },
  ];

  const createEntryMenuItemClassName =
    "flex cursor-pointer items-center gap-3 px-4 py-3 text-[13px] text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]";
  const fileExplorerScrollbarGutter = 8;
  const fileExplorerNodeRightInset = FILE_EXPLORER_NODE_RIGHT_INSET;
  const folderCreateButtonSize = FOLDER_CREATE_BUTTON_SIZE;
  const headerCreateButtonSize = 24;
  const headerCreateButtonPaddingRight =
    fileExplorerScrollbarGutter +
    fileExplorerNodeRightInset * 2 +
    folderCreateButtonSize / 2 -
    headerCreateButtonSize / 2;

  const renderCreateEntryMenu = (
    directoryPath: string,
    trigger: React.ReactElement,
    options?: {
      align?: "start" | "center" | "end";
      side?: "top" | "right" | "bottom" | "left";
      sideOffset?: number;
    },
  ) => {
    const targetDirectory =
      directoryPath || projectPathRef.current || contextProjectPath;

    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <MotionDropdownContent
            align={options?.align ?? "end"}
            side={options?.side ?? "bottom"}
            sideOffset={options?.sideOffset ?? 8}
            className="z-[100] min-w-[220px] overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl"
            data-shell-menu-content
          >
            <DropdownMenu.Item
              onSelect={() => requestCreateEntry("file", targetDirectory)}
              className={createEntryMenuItemClassName}
            >
              <FilePlus size={16} />
              New File
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => requestCreateEntry("folder", targetDirectory)}
              className={createEntryMenuItemClassName}
            >
              <FolderPlus size={16} />
              New Folder
            </DropdownMenu.Item>
          </MotionDropdownContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  };

  const renderFileNode = (
    node: FileNode,
    level: number = 0,
    isLast: boolean = false,
    parentGuides: boolean[] = [],
  ) => {
    const isSelected = selectedPaths.has(node.path);
    const isHighlighted =
      isSelected || highlightedPathRef.current === node.path;
    const isNodeExpanded = getIsExpanded(node.path);
    const guideColor = isDark ? "var(--border-subtle)" : "rgba(0,0,0,0.15)";
    const highlightBackground = isDark ? "var(--bg-hover)" : "rgba(0,0,0,0.06)";
    const hoverBackground = isDark ? "var(--bg-tertiary)" : "rgba(0,0,0,0.03)";
    const flashPeakBackground = isDark
      ? "rgba(255,255,255,0.15)"
      : "rgba(0,0,0,0.12)";
    const isDropTarget = node.isDirectory && dropTargetPath === node.path;

    const nodeStyle: React.CSSProperties & {
      "--file-explorer-hover-bg": string;
      "--file-explorer-highlight-bg": string;
      "--file-explorer-flash-base": string;
      "--file-explorer-flash-peak": string;
    } = {
      display: "flex",
      alignItems: "center",
      height: "30px",
      paddingLeft: "8px",
      paddingRight: `${fileExplorerNodeRightInset}px`,
      marginLeft: "8px",
      marginRight: `${fileExplorerNodeRightInset}px`,
      borderRadius: "var(--radius-sm)",
      cursor: "pointer",
      outline: isDropTarget
        ? "1px solid color-mix(in srgb, var(--accent-primary) 60%, transparent)"
        : undefined,
      background: isDropTarget
        ? "color-mix(in srgb, var(--accent-primary) 14%, transparent)"
        : undefined,
      "--file-explorer-hover-bg": hoverBackground,
      "--file-explorer-highlight-bg": highlightBackground,
      "--file-explorer-flash-base": highlightBackground,
      "--file-explorer-flash-peak": flashPeakBackground,
    };

    const chevronStyle: React.CSSProperties = {
      marginRight: "4px",
      color: "var(--text-muted)",
      opacity: 0.6,
    };

    const folderIconStyle: React.CSSProperties = {
      marginRight: "8px",
      color: "var(--text-secondary)",
    };

    const textStyle: React.CSSProperties = {
      fontSize: "13px",
      color: "var(--text-primary)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      flex: 1,
      minWidth: 0,
      fontWeight: node.isDirectory ? 500 : 400,
    };

    const folderCreateButtonStyle: React.CSSProperties = {
      width: `${folderCreateButtonSize}px`,
      height: `${folderCreateButtonSize}px`,
      marginLeft: "6px",
      borderRadius: "6px",
      border: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--text-muted)",
      background: "transparent",
      cursor: "pointer",
      padding: 0,
      opacity: 0.72,
      flexShrink: 0,
    };

    const childGuides = [...parentGuides, !isLast];

    return (
      <div key={node.path}>
        <ContextActionMenu
          items={() => buildNodeContextActions(node)}
          onContextMenuCapture={() => handleNodeContextMenuCapture(node)}
        >
          <div
            style={nodeStyle}
            className={`file-explorer-node${
              isHighlighted
                ? ` file-explorer-node-highlighted${isSelected ? " file-explorer-node-selected" : " file-explorer-node-flash"}`
                : ""
            }`}
            data-file-path={node.path}
            data-file-directory={node.isDirectory ? "true" : "false"}
            onPointerDown={(event) =>
              handleNodePointerDown(node, event, level, isLast, parentGuides)
            }
            onClick={(e) => handleNodeClick(node, e)}
          >
            {renderExplorerTreeGuides(level, isLast, parentGuides, guideColor)}

            {node.isDirectory && (
              <span
                style={chevronStyle}
                className={`file-explorer-chevron${
                  isNodeExpanded ? " file-explorer-chevron-expanded" : ""
                }`}
              >
                <ChevronDown size={14} />
              </span>
            )}

            {node.isDirectory ? (
              <>
                {isNodeExpanded ? (
                  <FolderOpen size={16} style={folderIconStyle} />
                ) : (
                  <Folder size={16} style={folderIconStyle} />
                )}
                <span style={textStyle}>{node.name}</span>
                {renderCreateEntryMenu(
                  node.path,
                  <button
                    type="button"
                    title={`Create inside ${node.name}`}
                    aria-label={`Create inside ${node.name}`}
                    style={folderCreateButtonStyle}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Plus size={13} />
                  </button>,
                  { align: "end", sideOffset: 4 },
                )}
              </>
            ) : (
              // INLINE EXTENSION STYLE: filename.EXT
              renderFileNameLabel(node.name)
            )}
          </div>
        </ContextActionMenu>

        <AnimatePresence initial={false}>
          {node.isDirectory && isNodeExpanded && node.children && (
            <motion.div
              initial={{ opacity: 0, scaleY: 0.96 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scaleY: 0.96 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              style={{ overflow: "hidden", transformOrigin: "top" }}
            >
              {node.children.map((child, index) =>
                renderFileNode(
                  child,
                  level + 1,
                  index === node.children!.length - 1,
                  childGuides,
                ),
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const getCurrentItems = (): FileNode[] => {
    if (breadcrumbs.length === 0) return files;
    const lastBreadcrumb = breadcrumbs[breadcrumbs.length - 1];
    return lastBreadcrumb.node.children || [];
  };

  const getCurrentFolders = (): FileNode[] => {
    return getCurrentItems().filter((item) => item.isDirectory);
  };

  const getCurrentFiles = (): FileNode[] => {
    return getCurrentItems().filter((item) => !item.isDirectory);
  };

  const renderHorizontalLayout = () => {
    const projectName = projectPath.split("/").pop() || "Project";

    const headerStyle: React.CSSProperties = {
      padding: "8px 16px",
      borderBottom: `1px solid var(--border-subtle)`,
    };

    const projectNameStyle: React.CSSProperties = {
      fontSize: "11px",
      fontWeight: 600,
      color: "var(--text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
    };

    return (
      <ContextActionMenu
        items={rootContextActions}
        ignoredTargetSelector=".file-explorer-node"
        onContextMenuCapture={handleRootContextMenuCapture}
      >
        <div
          ref={explorerRef}
          data-testid="file-explorer-scroll-region"
          data-explorer-keyboard-scope="true"
          tabIndex={-1}
          onPointerDownCapture={activateExplorerKeyboardScope}
          onPointerDown={handleExplorerMarqueePointerDown}
          style={{
            height: "100%",
            overflow: "auto",
            position: "relative",
            outline: "none",
          }}
        >
          <div style={headerStyle}>
            <div style={projectNameStyle}>{projectName}</div>
          </div>

          <div style={{ padding: "4px 0" }}>
            {files.map((node, index) =>
              renderFileNode(node, 0, index === files.length - 1, []),
            )}
          </div>
          {renderMarqueeSelection()}

          {renderPerspectiveOverlays()}
          <DragGhost ghost={dragGhost} />
        </div>
      </ContextActionMenu>
    );
  };

  if (loading) {
    return (
      <div
        style={{
          padding: "16px",
          fontSize: "13px",
          color: theme.textMuted,
          height: "100%",
        }}
      >
        Loading project...
      </div>
    );
  }

  if (!projectPath) {
    return (
      <div
        style={{
          padding: "16px",
          fontSize: "13px",
          color: theme.textMuted,
          height: "100%",
        }}
      >
        No project opened
      </div>
    );
  }

  if (isHorizontal) {
    return renderHorizontalLayout();
  }

  const projectName = projectPath.split("/").pop() || "Project";

  const headerStyle: React.CSSProperties = {
    padding: `8px ${headerCreateButtonPaddingRight}px 8px 12px`,
    position: "relative",
    zIndex: 5,
    flexShrink: 0,
    background:
      "linear-gradient(180deg, color-mix(in srgb, var(--surface-shell-soft) 96%, transparent), color-mix(in srgb, var(--surface-shell) 98%, transparent))",
    backdropFilter: "blur(18px)",
    borderBottom: `1px solid ${theme.border}`,
  };

  const projectNameStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 500,
    color: theme.textSecondary,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  };

  return (
    <>
      <ContextActionMenu
        items={rootContextActions}
        ignoredTargetSelector=".file-explorer-node"
        onContextMenuCapture={handleRootContextMenuCapture}
      >
        <div
          ref={explorerRef}
          data-explorer-keyboard-scope="true"
          tabIndex={-1}
          onPointerDownCapture={activateExplorerKeyboardScope}
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
            outline: "none",
          }}
        >
          <div
            style={{
              ...headerStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
            }}
          >
            <div style={projectNameStyle}>{projectName}</div>

            {renderCreateEntryMenu(
              projectPathRef.current || contextProjectPath,
              <button
                type="button"
                title="Create"
                data-testid="file-explorer-create-button"
                style={{
                  width: `${headerCreateButtonSize}px`,
                  height: `${headerCreateButtonSize}px`,
                  borderRadius: "6px",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: theme.textMuted,
                  background: "transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <Plus size={14} />
              </button>,
            )}
          </div>

          <div className="file-explorer-scroll-fog-shell">
            <div
              data-testid="file-explorer-scroll-region"
              onPointerDown={handleExplorerMarqueePointerDown}
              style={{
                height: "100%",
                overflow: "auto",
                padding: "4px 0",
                position: "relative",
              }}
            >
              {files.map((node, index) =>
                renderFileNode(node, 0, index === files.length - 1, []),
              )}
              {renderMarqueeSelection()}
            </div>
          </div>

          {renderPerspectiveOverlays()}
          <DragGhost ghost={dragGhost} />
        </div>
      </ContextActionMenu>
    </>
  );
};

export const FileExplorer = React.memo(FileExplorerComponent);
