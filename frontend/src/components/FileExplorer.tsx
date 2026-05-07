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
import {
  detectPanelSnapDropTarget,
  type PanelSnapDragCallbacks,
} from "../utils/panelSnapDrag";

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

interface RenamedEntryEvent {
  oldPath?: string;
  newPath?: string;
  isDirectory?: boolean;
}

interface DeletedEntryEvent {
  path?: string;
  isDirectory?: boolean;
}

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
  ) => void;
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
    copyAbsolutePath,
    copyRelativePath,
    copyProjectPath,
    revealEntry,
    requestCreateEntry,
    requestMoveEntry,
    requestRenameEntry,
    requestTrashEntry,
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
  const setStoreHighlightedPath = useExplorerSelectionStore(
    (state) => state.setHighlightedPath,
  );
  const [projectPath, setProjectPath] = useState<string>(initialProjectPath);
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
  const explorerRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<FileNode[]>([]);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentCreatedPathsRef = useRef<Map<string, number>>(new Map());
  const expandedPathsRef = useRef(expandedPaths);
  const projectPathRef = useRef(projectPath);
  const onFileOpenRef = useRef(onFileOpen);
  const onFileOpenInPanelRef = useRef(onFileOpenInPanel);
  const highlightedPathRef = useRef<string | null>(null);
  const latestFileOpenRequestRef = useRef(0);
  const suppressNodeClickRef = useRef(false);
  const relations = useFileRelations(perspectiveTarget || "");
  filesRef.current = files;
  expandedPathsRef.current = expandedPaths;
  projectPathRef.current = projectPath;
  onFileOpenRef.current = onFileOpen;
  onFileOpenInPanelRef.current = onFileOpenInPanel;

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

  useEffect(() => {
    loadProject();
  }, []);

  useEffect(() => {
    return () => {
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

  const loadProject = async () => {
    try {
      const resolvedProjectPath =
        initialProjectPath || (await App.GetCurrentProjectPath());
      if (!resolvedProjectPath) {
        setProjectPath("");
        setStoreProjectPath("");
        return;
      }

      setProjectPath(resolvedProjectPath);
      setStoreProjectPath(resolvedProjectPath);
      await loadDirectory(resolvedProjectPath);
    } catch (error) {
      console.error("Error loading project:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadDirectory = async (dirPath: string) => {
    try {
      const entries: FileEntry[] = await App.ReadDirectory(dirPath);
      let nodes: FileNode[] = buildFileNodes(entries);

      // Восстанавливаем ранее открытые папки
      if (expandedPathsRef.current.size > 0) {
        nodes = await restoreExpandedFolders(nodes);
      }

      filesRef.current = nodes;
      setFiles(nodes);
    } catch (error) {
      console.error("Error reading directory:", error);
    }
  };

  const refreshDirectoryPath = async (dirPath: string) => {
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
              isExpanded: true,
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
      setExpanded(dirPath, true);
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

  const openCreatedFile = async (createdPath: string) => {
    const fileName = createdPath.split("/").pop() || "";
    const requestId = latestFileOpenRequestRef.current + 1;
    latestFileOpenRequestRef.current = requestId;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (latestFileOpenRequestRef.current !== requestId) {
          return;
        }
        onFileOpenRef.current?.(createdPath, "", fileName);
        return;
      } catch (error) {
        if (latestFileOpenRequestRef.current !== requestId) {
          return;
        }
        if (attempt === 1) {
          console.error("Error opening created file:", error);
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 120));
      }
    }
  };

  const refreshPathChain = async (targetPath: string, isDirectory: boolean) => {
    const currentProjectPath = normalizeProjectPath(projectPathRef.current);
    if (!currentProjectPath) {
      return;
    }

    const targetDirectory = isDirectory
      ? targetPath
      : targetPath.slice(0, targetPath.lastIndexOf("/")) || currentProjectPath;

    await refreshDirectoryPath(currentProjectPath);

    if (targetDirectory === currentProjectPath) {
      return;
    }

    const relativePath = targetDirectory.startsWith(`${currentProjectPath}/`)
      ? targetDirectory.slice(currentProjectPath.length + 1)
      : "";

    if (!relativePath) {
      return;
    }

    let currentPath = currentProjectPath;
    for (const segment of relativePath.split("/").filter(Boolean)) {
      currentPath += `/${segment}`;
      await refreshDirectoryPath(currentPath);
    }
  };

  useEffect(() => {
    const handleCreatedEntry = async (payload: string | CreatedEntryEvent) => {
      const createdPath =
        typeof payload === "string" ? payload : (payload.path ?? "");
      const isDirectory =
        typeof payload === "string" ? false : Boolean(payload.isDirectory);
      const currentProjectPath = normalizeProjectPath(projectPathRef.current);

      if (!createdPath || !currentProjectPath) {
        return;
      }

      if (
        createdPath !== currentProjectPath &&
        !createdPath.startsWith(`${currentProjectPath}/`)
      ) {
        return;
      }

      if (wasRecentlyHandled(createdPath, isDirectory)) {
        return;
      }

      await refreshPathChain(createdPath, isDirectory);
      await revealPath(createdPath);

      if (isDirectory) {
        return;
      }

      await openCreatedFile(createdPath);
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

  // Get extension label (uppercase)
  const getExtLabel = (fileName: string): string => {
    const lowerName = fileName.toLowerCase();

    // Special cases
    if (lowerName.endsWith(".blade.php")) return "BLADE";
    if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile."))
      return "DOCKER";
    if (lowerName === "makefile") return "MAKE";
    if (lowerName === ".gitignore") return "GIT";
    if (lowerName === ".dockerignore") return "DOCKER";
    if (lowerName === ".env" || lowerName.startsWith(".env.")) return "ENV";
    if (lowerName === ".editorconfig") return "CFG";
    if (lowerName.includes(".prettierrc")) return "FMT";
    if (lowerName.includes(".eslintrc")) return "LINT";
    if (lowerName.includes(".babelrc")) return "BABEL";

    const ext = fileName.split(".").pop()?.toLowerCase();
    if (!ext) return "";

    // Map extensions to display labels
    const labelMap: Record<string, string> = {
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
      R: "R",
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

    return labelMap[ext] || ext.toUpperCase();
  };

  // Get extension color
  const getExtColor = (fileName: string): string => {
    const lowerName = fileName.toLowerCase();

    // Special cases
    if (lowerName.endsWith(".blade.php")) return colors.fileType.blade;
    if (lowerName === "dockerfile" || lowerName.startsWith("dockerfile."))
      return colors.fileType.dockerfile;
    if (lowerName === "makefile") return "#6B7280";
    if (lowerName === ".gitignore") return "#F05032";
    if (lowerName === ".dockerignore") return colors.fileType.dockerfile;
    if (lowerName === ".env" || lowerName.startsWith(".env."))
      return colors.fileType.env;

    const ext = fileName.split(".").pop()?.toLowerCase();
    if (!ext) return theme.textMuted;

    // Images
    if (
      [
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
      ].includes(ext)
    ) {
      return colors.fileType.image;
    }

    return extColorMap[ext] || theme.textMuted;
  };

  // Get base name without extension for display
  const getFileBaseName = (fileName: string): string => {
    const lowerName = fileName.toLowerCase();

    // Files without extension or special files - show as is
    if (lowerName === "dockerfile" || lowerName === "makefile") return fileName;
    if (lowerName.startsWith("dockerfile.")) return fileName.split(".")[0];
    if (lowerName.startsWith(".")) {
      // Dotfiles: .gitignore -> show empty basename (just .EXT)
      const parts = fileName.split(".");
      if (parts.length === 2) return ""; // .gitignore -> ""
      return parts.slice(1, -1).join("."); // .env.local -> env
    }

    // Blade files: welcome.blade.php -> welcome
    if (lowerName.endsWith(".blade.php")) {
      return fileName.replace(/\.blade\.php$/i, "");
    }

    // Normal files: main.go -> main
    const lastDotIndex = fileName.lastIndexOf(".");
    if (lastDotIndex === -1) return fileName;
    return fileName.substring(0, lastDotIndex);
  };

  // Check if file has a recognizable extension
  const hasKnownExtension = (fileName: string): boolean => {
    const lowerName = fileName.toLowerCase();
    if (lowerName === "dockerfile" || lowerName === "makefile") return true;
    if (lowerName.startsWith(".")) return true; // dotfiles
    const ext = fileName.split(".").pop()?.toLowerCase();
    return ext
      ? ext in extColorMap ||
          [
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
          ].includes(ext)
      : false;
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

  const handleNodePointerDown = (
    node: FileNode,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    const releaseSelectionLock = beginDragSelectionLock();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let activeDrag = false;
    let latestDropTarget: string | null = null;
    let latestSnapTarget: ReturnType<typeof detectPanelSnapDropTarget> = null;
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
      const snapTarget =
        !insideExplorer && !node.isDirectory
          ? detectPanelSnapDropTarget(
              pointerEvent.clientX,
              pointerEvent.clientY,
            )
          : null;
      updatePanelSnapDrag(snapTarget);
      latestDropTarget = getExplorerDropDirectory(
        pointerEvent.clientX,
        pointerEvent.clientY,
        node,
      );
      setDropTargetPath(latestDropTarget);
      setDragGhost({
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
        label: node.name,
        detail: snapTarget
          ? `Snap to ${snapTarget}`
          : latestDropTarget
            ? `Move to ${latestDropTarget.split("/").pop() || latestDropTarget}`
            : node.isDirectory
              ? "Folder can be moved inside Explorer"
              : "Release outside Explorer to open as panel",
      });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      if (snapDragStarted) {
        onPanelSnapDragEnd?.();
      }
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

    if (e && !node.isDirectory) {
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
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
      if (e.metaKey && !e.altKey && !e.ctrlKey) {
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

  const buildNodeContextActions = (node: FileNode): ContextActionMenuItem[] => {
    const target: ProjectEntryActionTarget = {
      path: node.path,
      isDirectory: node.isDirectory,
    };

    return [
      {
        label: node.isDirectory ? "Open / Expand" : "Open",
        icon: node.isDirectory ? <FolderOpen size={14} /> : <File size={14} />,
        onSelect: () => {
          void handleNodeClick(node);
        },
      },
      !node.isDirectory
        ? {
            label: "Open in Panel",
            icon: <PanelRightOpen size={14} />,
            onSelect: () => {
              void handleFileOpenInPanel(node.path, node.name);
            },
          }
        : { hidden: true },
      node.isDirectory
        ? {
            label: "New File",
            icon: <FilePlus size={14} />,
            onSelect: () => requestCreateEntry("file", node.path),
          }
        : { hidden: true },
      node.isDirectory
        ? {
            label: "New Folder",
            icon: <FolderPlus size={14} />,
            onSelect: () => requestCreateEntry("folder", node.path),
          }
        : { hidden: true },
      {
        label: "Rename",
        icon: <Edit3 size={14} />,
        onSelect: () => requestRenameEntry(target),
      },
      { separator: true },
      {
        label: "Copy Relative Path",
        icon: <Copy size={14} />,
        onSelect: () => {
          void copyRelativePath(node.path);
        },
      },
      {
        label: "Copy Absolute Path",
        icon: <Copy size={14} />,
        onSelect: () => {
          void copyAbsolutePath(node.path);
        },
      },
      {
        label: "Reveal in File Manager",
        icon: <ExternalLink size={14} />,
        onSelect: () => {
          void revealEntry(node.path);
        },
      },
      { separator: true },
      {
        label: "Move to Trash",
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () =>
          requestTrashEntry({
            ...target,
            displayName: node.name,
          }),
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
  const fileExplorerNodeRightInset = 8;
  const folderCreateButtonSize = 22;
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
          <DropdownMenu.Content
            align={options?.align ?? "end"}
            side={options?.side ?? "bottom"}
            sideOffset={options?.sideOffset ?? 8}
            className="z-[100] min-w-[220px] overflow-hidden rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-2xl animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2"
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
          </DropdownMenu.Content>
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
    const isHighlighted = highlightedPathRef.current === node.path;
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

    const renderTreeGuides = () => {
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
        <ContextActionMenu items={buildNodeContextActions(node)}>
          <div
            style={nodeStyle}
            className={`file-explorer-node${
              isHighlighted
                ? " file-explorer-node-highlighted file-explorer-node-flash"
                : ""
            }`}
            data-file-path={node.path}
            data-file-directory={node.isDirectory ? "true" : "false"}
            onPointerDown={(event) => handleNodePointerDown(node, event)}
            onClick={(e) => handleNodeClick(node, e)}
          >
            {renderTreeGuides()}

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
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {getFileBaseName(node.name)}
                {hasKnownExtension(node.name) && (
                  <>
                    <span style={{ color: "var(--text-muted)" }}>.</span>
                    <span
                      style={{
                        color: getExtColor(node.name),
                        fontWeight: 700,
                        fontSize: "11px",
                        letterSpacing: "0.3px",
                        fontFamily:
                          "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
                      }}
                    >
                      {getExtLabel(node.name)}
                    </span>
                  </>
                )}
                {!hasKnownExtension(node.name) && node.name}
              </span>
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
      >
        <div
          ref={explorerRef}
          data-testid="file-explorer-scroll-region"
          style={{
            height: "100%",
            overflow: "auto",
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
      >
        <div
          ref={explorerRef}
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            minHeight: 0,
            overflow: "hidden",
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

          <div
            data-testid="file-explorer-scroll-region"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: "4px 0",
            }}
          >
            {files.map((node, index) =>
              renderFileNode(node, 0, index === files.length - 1, []),
            )}
          </div>

          {renderPerspectiveOverlays()}
          <DragGhost ghost={dragGhost} />
        </div>
      </ContextActionMenu>
    </>
  );
};

export const FileExplorer = React.memo(FileExplorerComponent);
