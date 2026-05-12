import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FolderOpen,
  Search,
  Settings,
  Bug,
  Play,
  Globe,
  MoreVertical,
  MessageSquare,
  GitBranch,
  Terminal,
  RefreshCw,
  DownloadCloud,
  Bell,
} from "lucide-react";
import { WindowControls } from "../ui";
import { DragGhost, type DragGhostState } from "../ui/DragGhost";
import { MotionDropdownContent } from "../ui/MotionDropdownContent";
import { useIndexingProgress } from "../../hooks/useIndexingProgress";
import {
  DEFAULT_TOPBAR_ITEM_ORDER,
  normalizeTopbarItemOrder,
  type TopbarItemId,
  useEditorSettingsStore,
} from "../../stores/editorSettingsStore";
import { beginDragSelectionLock } from "../../utils/dragSelectionLock";
import { ProjectIndicators } from "./ProjectIndicators";
import { AddProjectMenu } from "./AddProjectMenu";
import { NotificationCenterButton } from "./NotificationCenterButton";

type VisibleTopbarItemId = TopbarItemId | "more";
type TopbarItemGroup = "left" | "right";

const COMPACT_TOPBAR_ACTION_IDS: TopbarItemId[] = [
  "aiChat",
  "terminal",
  "git",
  "syncDependencies",
  "checkUpdates",
];
const COMPACT_TOPBAR_ACTION_ID_SET = new Set<TopbarItemId>(
  COMPACT_TOPBAR_ACTION_IDS,
);
const FIXED_TOPBAR_ITEM_ID_SET = new Set<TopbarItemId>([
  "projects",
  "addProject",
  "context",
]);

const isCompactTopbarAction = (itemId: TopbarItemId) =>
  COMPACT_TOPBAR_ACTION_ID_SET.has(itemId);

const isFixedTopbarItem = (itemId: TopbarItemId) =>
  FIXED_TOPBAR_ITEM_ID_SET.has(itemId);

const isVisibleFixedTopbarItem = (
  itemId: VisibleTopbarItemId,
): itemId is TopbarItemId => itemId !== "more" && isFixedTopbarItem(itemId);

const topbarItemLabels: Record<VisibleTopbarItemId, string> = {
  explorer: "Explorer",
  search: "Search",
  settings: "Settings",
  projects: "Projects",
  addProject: "Add project",
  context: "Project context",
  debug: "Debug",
  run: "Run",
  preview: "Preview",
  aiChat: "AI Chat",
  terminal: "Terminal",
  git: "Git",
  syncDependencies: "Sync dependencies",
  checkUpdates: "Check for Updates",
  notifications: "Notifications",
  more: "More",
};

const resolveVisibleTopbarOrder = (
  order: TopbarItemId[],
  compactMode: boolean,
): VisibleTopbarItemId[] => {
  if (compactMode) {
    return order;
  }

  const visibleOrder: VisibleTopbarItemId[] = [];
  let moreInserted = false;
  order.forEach((itemId) => {
    if (isCompactTopbarAction(itemId)) {
      if (!moreInserted) {
        visibleOrder.push("more");
        moreInserted = true;
      }
      return;
    }

    visibleOrder.push(itemId);
  });

  return visibleOrder;
};

const resolveVisibleTopbarSideOrder = (
  visibleOrder: VisibleTopbarItemId[],
  group: TopbarItemGroup,
): VisibleTopbarItemId[] => {
  const anchorId = group === "left" ? "projects" : "context";
  const anchorIndex = visibleOrder.indexOf(anchorId);
  if (anchorIndex === -1) {
    return [];
  }

  const sideOrder =
    group === "left"
      ? visibleOrder.slice(0, anchorIndex)
      : visibleOrder.slice(anchorIndex + 1);

  return sideOrder.filter((itemId) => !isVisibleFixedTopbarItem(itemId));
};

const resolveUnderlyingTopbarSideOrder = (
  order: TopbarItemId[],
  group: TopbarItemGroup,
): TopbarItemId[] => {
  const normalizedOrder = normalizeTopbarItemOrder(order);
  const anchorId = group === "left" ? "projects" : "context";
  const anchorIndex = normalizedOrder.indexOf(anchorId);
  if (anchorIndex === -1) {
    return [];
  }

  const sideOrder =
    group === "left"
      ? normalizedOrder.slice(0, anchorIndex)
      : normalizedOrder.slice(anchorIndex + 1);

  return sideOrder.filter((itemId) => !isFixedTopbarItem(itemId));
};

const resolveTopbarItemIdsFromVisibleItem = (
  itemId: VisibleTopbarItemId,
  currentOrder: TopbarItemId[],
  compactMode: boolean,
): TopbarItemId[] => {
  if (itemId !== "more") {
    return [itemId];
  }

  return compactMode ? [] : currentOrder.filter(isCompactTopbarAction);
};

const resolveUnderlyingTopbarOrderFromVisibleSideOrder = (
  visibleOrder: VisibleTopbarItemId[],
  currentOrder: TopbarItemId[],
  compactMode: boolean,
): TopbarItemId[] => {
  const nextOrder: TopbarItemId[] = [];
  const seen = new Set<TopbarItemId>();

  visibleOrder.forEach((itemId) => {
    resolveTopbarItemIdsFromVisibleItem(
      itemId,
      currentOrder,
      compactMode,
    ).forEach((resolvedItemId) => {
      if (isFixedTopbarItem(resolvedItemId) || seen.has(resolvedItemId)) {
        return;
      }
      seen.add(resolvedItemId);
      nextOrder.push(resolvedItemId);
    });
  });

  return nextOrder;
};

const replaceTopbarSideOrder = (
  currentOrder: TopbarItemId[],
  group: TopbarItemGroup,
  nextSideOrder: TopbarItemId[],
  additionalRemovedIds: TopbarItemId[] = [],
): TopbarItemId[] => {
  const normalizedOrder = normalizeTopbarItemOrder(currentOrder);
  const currentSideOrder = resolveUnderlyingTopbarSideOrder(
    normalizedOrder,
    group,
  );
  const removedItemIdSet = new Set([
    ...currentSideOrder,
    ...nextSideOrder,
    ...additionalRemovedIds,
  ]);
  const baseOrder = normalizedOrder.filter(
    (itemId) => !removedItemIdSet.has(itemId),
  );
  const anchorId = group === "left" ? "projects" : "context";
  const anchorIndex = baseOrder.indexOf(anchorId);
  const insertIndex =
    group === "left"
      ? anchorIndex === -1
        ? 0
        : anchorIndex
      : anchorIndex === -1
        ? baseOrder.length
        : anchorIndex + 1;
  const nextOrder = [...baseOrder];

  nextOrder.splice(insertIndex, 0, ...nextSideOrder);
  return normalizeTopbarItemOrder(nextOrder);
};

interface PanelVisibility {
  explorer: boolean;
  terminal: boolean;
  aiChat: boolean;
  git?: boolean;
}

interface TopBarProps {
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onToggleExplorer?: () => void;
  onToggleTerminal?: () => void;
  onToggleAIChat?: () => void;
  onToggleGit?: () => void;
  onRun?: () => void;
  onOpenDebug?: () => void;
  onOpenPreview?: () => void;
  onOpenDependencyPolicy?: () => void;
  onCheckForUpdates?: () => void;
  onBackToWelcome?: () => void;
  onProjectOpen?: (path: string) => void;
  onSwitchProject?: (id: string, direction?: number) => void;
  onCloseProject?: (id: string) => void;
  onDetachProject?: (id: string) => void;
  onReorderProjects?: (ids: string[]) => void;
  panels?: PanelVisibility;
  projectPath?: string;
  previewEnabled?: boolean;
  previewActive?: boolean;
  previewTitle?: string;
  windowControlsVisible?: boolean;
  windowControlsBackdropVisible?: boolean;
  windowControlsNativeEnabled?: boolean;
  windowDragEnabled?: boolean;
  onChromePopupOpenChange?: (open: boolean) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onOpenSearch,
  onOpenSettings,
  onToggleExplorer,
  onToggleTerminal,
  onToggleAIChat,
  onToggleGit,
  onRun,
  onOpenDebug,
  onOpenPreview,
  onOpenDependencyPolicy,
  onCheckForUpdates,
  onProjectOpen,
  onSwitchProject,
  onCloseProject,
  onDetachProject,
  onReorderProjects,
  panels = { explorer: false, terminal: false, aiChat: false },
  projectPath = "",
  previewEnabled = false,
  previewActive = false,
  previewTitle = "Preview unavailable for the current context.",
  windowControlsVisible = true,
  windowControlsBackdropVisible = true,
  windowControlsNativeEnabled,
  windowDragEnabled = true,
  onChromePopupOpenChange,
}) => {
  const [addProjectMenuOpen, setAddProjectMenuOpen] = React.useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = React.useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = React.useState(false);
  const indexing = useIndexingProgress();
  const showTopbarProjectPath = useEditorSettingsStore(
    (state) => state.showTopbarProjectPath,
  );
  const topbarItemOrder = useEditorSettingsStore(
    (state) => state.topbarItemOrder,
  );
  const setTopbarItemOrder = useEditorSettingsStore(
    (state) => state.setTopbarItemOrder,
  );
  const leftTopbarItemsRef = React.useRef<HTMLDivElement | null>(null);
  const rightTopbarItemsRef = React.useRef<HTMLDivElement | null>(null);
  const suppressTopbarItemClickRef = React.useRef(false);
  const [dragGhost, setDragGhost] = React.useState<DragGhostState | null>(null);
  const compactTopbarMode = !showTopbarProjectPath;
  const normalizedTopbarItemOrder = React.useMemo(
    () =>
      normalizeTopbarItemOrder(
        topbarItemOrder.length > 0
          ? topbarItemOrder
          : DEFAULT_TOPBAR_ITEM_ORDER,
      ),
    [topbarItemOrder],
  );
  const visibleTopbarOrder = React.useMemo(
    () =>
      resolveVisibleTopbarOrder(normalizedTopbarItemOrder, compactTopbarMode),
    [compactTopbarMode, normalizedTopbarItemOrder],
  );
  const leftTopbarOrder = React.useMemo(
    () => resolveVisibleTopbarSideOrder(visibleTopbarOrder, "left"),
    [visibleTopbarOrder],
  );
  const rightTopbarOrder = React.useMemo(
    () => resolveVisibleTopbarSideOrder(visibleTopbarOrder, "right"),
    [visibleTopbarOrder],
  );
  const projectName = projectPath
    ? projectPath.split("/").filter(Boolean).at(-1)
    : null;
  const projectParent = projectPath
    ? projectPath.substring(0, projectPath.lastIndexOf("/") + 1)
    : "";
  const topBarButtonClass =
    "topbar-control-button shell-control h-12 w-12 px-0";
  const activeTopBarPanelButtonClass = "topbar-panel-button-active";
  const topBarActionClass = `${topBarButtonClass} text-[var(--text-secondary)]`;
  const menuItemClass = "shell-menu-item text-[13px]";
  const centerChipClass = "shell-pill font-mono text-[10px] tracking-[0.14em]";
  const topBarGroupClass =
    "relative flex h-full shrink-0 -translate-y-[2px] items-center gap-2";
  const topBarIconSize = 25;
  const menuIconSize = 16;
  const topBarItemNoDragStyle = {
    "--wails-draggable": "no-drag",
    WebkitAppRegion: "no-drag",
  } as React.CSSProperties;
  const isIndexingActive =
    Boolean(projectPath) && indexing.phase === "indexing";
  const indexingProgressRatio = Math.max(
    0,
    Math.min(1, indexing.percentage / 100),
  );
  const indexingProgressValue = Number(indexing.percentage.toFixed(1));
  const fadeTransition = { duration: 0.16, ease: "easeOut" } as const;
  const fadeInitial = { opacity: 0, y: -2 };
  const fadeAnimate = { opacity: 1, y: 0 };
  const contextPathRootClass =
    "flex min-w-0 max-w-[520px] items-center gap-0 overflow-hidden font-mono leading-none";
  const contextPathParentClass =
    "truncate whitespace-nowrap text-[18px] font-medium tracking-[0.02em] text-[var(--text-muted)]";
  const contextPathNameClass =
    "truncate whitespace-nowrap text-[18px] font-medium tracking-[0.02em] text-[var(--text-primary)]";
  const indexingBubbleClass =
    "flex min-w-[188px] items-center justify-center gap-3 font-mono leading-none text-[12px] tracking-[0.1em] text-[var(--text-secondary)]";
  const getPanelActionClass = (active?: boolean) =>
    `${topBarButtonClass} ${
      active ? activeTopBarPanelButtonClass : "text-[var(--text-secondary)]"
    }`;
  const topBarDragStyle = {
    "--wails-draggable": windowDragEnabled ? "drag" : "no-drag",
    WebkitAppRegion: windowDragEnabled ? "drag" : "no-drag",
  } as React.CSSProperties;

  const getTopbarItemClassName = (itemId: VisibleTopbarItemId) => {
    const baseClassName =
      "topbar-reorder-item flex h-full shrink-0 items-center cursor-grab active:cursor-grabbing";
    if (itemId === "context") {
      return `${baseClassName} min-w-0 shrink`;
    }
    if (itemId === "projects") {
      return `${baseClassName} min-w-0`;
    }
    return baseClassName;
  };

  const getTopbarDropGroup = React.useCallback(
    (clientX: number, clientY: number): TopbarItemGroup | null => {
      const targets: Array<[TopbarItemGroup, HTMLDivElement | null]> = [
        ["left", leftTopbarItemsRef.current],
        ["right", rightTopbarItemsRef.current],
      ];

      for (const [targetGroup, container] of targets) {
        const rect = container?.getBoundingClientRect();
        if (
          rect &&
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return targetGroup;
        }
      }

      return null;
    },
    [],
  );

  const reorderVisibleTopbarOrder = React.useCallback(
    (
      draggedItemId: VisibleTopbarItemId,
      clientX: number,
      group: TopbarItemGroup,
    ) => {
      const container =
        group === "left"
          ? leftTopbarItemsRef.current
          : rightTopbarItemsRef.current;
      const currentVisibleOrder =
        group === "left" ? leftTopbarOrder : rightTopbarOrder;
      if (!container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const insideContainer =
        clientX >= containerRect.left && clientX <= containerRect.right;
      if (!insideContainer) {
        return;
      }

      const withoutDragged = currentVisibleOrder.filter(
        (itemId) => itemId !== draggedItemId,
      );
      let insertIndex = withoutDragged.length;
      withoutDragged.some((itemId, index) => {
        const element = container.querySelector<HTMLElement>(
          `[data-topbar-item-id="${CSS.escape(itemId)}"]`,
        );
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        if (clientX < rect.left + rect.width / 2) {
          insertIndex = index;
          return true;
        }
        return false;
      });

      const nextVisibleOrder = [...withoutDragged];
      nextVisibleOrder.splice(insertIndex, 0, draggedItemId);
      if (
        nextVisibleOrder.length === currentVisibleOrder.length &&
        nextVisibleOrder.every(
          (itemId, index) => itemId === currentVisibleOrder[index],
        )
      ) {
        return;
      }

      const draggedItemIds = resolveTopbarItemIdsFromVisibleItem(
        draggedItemId,
        normalizedTopbarItemOrder,
        compactTopbarMode,
      );
      const nextSideOrder = resolveUnderlyingTopbarOrderFromVisibleSideOrder(
        nextVisibleOrder,
        normalizedTopbarItemOrder,
        compactTopbarMode,
      );
      setTopbarItemOrder(
        replaceTopbarSideOrder(
          normalizedTopbarItemOrder,
          group,
          nextSideOrder,
          draggedItemIds,
        ),
      );
    },
    [
      compactTopbarMode,
      leftTopbarOrder,
      normalizedTopbarItemOrder,
      rightTopbarOrder,
      setTopbarItemOrder,
    ],
  );

  const handleTopbarItemPointerDown = React.useCallback(
    (
      itemId: VisibleTopbarItemId,
      group: TopbarItemGroup,
      event: React.PointerEvent<HTMLElement>,
    ) => {
      if (event.button !== 0) {
        return;
      }

      const releaseSelectionLock = beginDragSelectionLock();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let activeDrag = false;

      const resetClickSuppression = () => {
        window.setTimeout(() => {
          suppressTopbarItemClickRef.current = false;
        }, 0);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove, true);
        window.removeEventListener("pointerup", handlePointerUp, true);
        window.removeEventListener("pointercancel", handlePointerCancel, true);
        releaseSelectionLock();
        setDragGhost(null);
      };

      const handlePointerCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
        if (activeDrag) {
          resetClickSuppression();
        }
      };

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }

        pointerEvent.preventDefault();
        document.getSelection()?.removeAllRanges();

        const dx = pointerEvent.clientX - startX;
        const dy = pointerEvent.clientY - startY;
        if (!activeDrag && Math.hypot(dx, dy) > 7) {
          activeDrag = true;
          suppressTopbarItemClickRef.current = true;
        }
        if (!activeDrag) {
          return;
        }

        setDragGhost({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          label: topbarItemLabels[itemId],
          icon: renderTopbarGhostIcon(itemId),
          variant: "icon",
        });

        const targetGroup =
          getTopbarDropGroup(pointerEvent.clientX, pointerEvent.clientY) ??
          group;
        const container =
          targetGroup === "left"
            ? leftTopbarItemsRef.current
            : rightTopbarItemsRef.current;
        if (!container) {
          return;
        }
        const rect = container.getBoundingClientRect();
        if (
          pointerEvent.clientY < rect.top - 24 ||
          pointerEvent.clientY > rect.bottom + 24
        ) {
          return;
        }
        if (pointerEvent.clientX < rect.left + 42) {
          container.scrollLeft -= 18;
        } else if (pointerEvent.clientX > rect.right - 42) {
          container.scrollLeft += 18;
        }
      };

      const handlePointerUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }
        cleanup();
        if (!activeDrag) {
          return;
        }
        resetClickSuppression();

        const targetGroup = getTopbarDropGroup(
          pointerEvent.clientX,
          pointerEvent.clientY,
        );
        if (!targetGroup) {
          return;
        }

        reorderVisibleTopbarOrder(itemId, pointerEvent.clientX, targetGroup);
      };

      window.addEventListener("pointermove", handlePointerMove, true);
      window.addEventListener("pointerup", handlePointerUp, true);
      window.addEventListener("pointercancel", handlePointerCancel, true);
    },
    [getTopbarDropGroup, reorderVisibleTopbarOrder],
  );

  const handleTopbarItemClickCapture = React.useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!suppressTopbarItemClickRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const renderTopbarGhostIcon = (itemId: VisibleTopbarItemId) => {
    switch (itemId) {
      case "explorer":
        return <FolderOpen size={topBarIconSize} />;
      case "search":
        return <Search size={topBarIconSize} />;
      case "settings":
        return <Settings size={topBarIconSize} />;
      case "debug":
        return <Bug size={topBarIconSize} />;
      case "run":
        return <Play size={topBarIconSize} />;
      case "preview":
        return <Globe size={topBarIconSize} />;
      case "aiChat":
        return <MessageSquare size={topBarIconSize} />;
      case "terminal":
        return <Terminal size={topBarIconSize} />;
      case "git":
        return <GitBranch size={topBarIconSize} />;
      case "syncDependencies":
        return <RefreshCw size={topBarIconSize} />;
      case "checkUpdates":
        return <DownloadCloud size={topBarIconSize} />;
      case "notifications":
        return <Bell size={topBarIconSize} />;
      case "more":
        return <MoreVertical size={topBarIconSize} />;
      case "projects":
        return <FolderOpen size={topBarIconSize} />;
      case "addProject":
      case "context":
        return null;
    }
  };

  React.useEffect(() => {
    onChromePopupOpenChange?.(
      addProjectMenuOpen || moreMenuOpen || notificationMenuOpen,
    );
  }, [
    addProjectMenuOpen,
    moreMenuOpen,
    notificationMenuOpen,
    onChromePopupOpenChange,
  ]);

  React.useEffect(
    () => () => {
      onChromePopupOpenChange?.(false);
    },
    [onChromePopupOpenChange],
  );

  const renderExplorerButton = () => (
    <button
      onClick={onToggleExplorer}
      className={`${topBarButtonClass} ${
        panels.explorer
          ? activeTopBarPanelButtonClass
          : "text-[var(--text-secondary)]"
      }`}
      title="Explorer"
    >
      <FolderOpen size={topBarIconSize} />
    </button>
  );

  const renderContextItem = () => (
    <AnimatePresence mode="wait">
      {projectPath && (isIndexingActive || showTopbarProjectPath) ? (
        <motion.div
          key="context-strip"
          initial={fadeInitial}
          animate={fadeAnimate}
          exit={fadeInitial}
          transition={fadeTransition}
          className="topbar-context-shell shell-cluster min-w-0 max-w-[560px] items-center overflow-hidden px-3 py-1.5"
        >
          <AnimatePresence mode="wait" initial={false}>
            {isIndexingActive ? (
              <motion.div
                key="indexing-state"
                initial={fadeInitial}
                animate={fadeAnimate}
                exit={fadeInitial}
                transition={fadeTransition}
                className={indexingBubbleClass}
                data-testid="topbar-indexing-status"
              >
                <span>Indexing</span>
                <span
                  className="inline-flex h-2 w-28 overflow-hidden rounded-full bg-white/8"
                  data-testid="topbar-indexing-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={indexingProgressValue}
                  data-progress={indexingProgressValue}
                >
                  <motion.span
                    className="h-full w-full origin-left rounded-full bg-[var(--text-primary)] will-change-transform"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: indexingProgressRatio }}
                    transition={{
                      type: "spring",
                      stiffness: 210,
                      damping: 28,
                      mass: 0.45,
                    }}
                  />
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="path-state"
                initial={fadeInitial}
                animate={fadeAnimate}
                exit={fadeInitial}
                transition={fadeTransition}
                className={contextPathRootClass}
                data-testid="topbar-project-path"
              >
                <span
                  className={contextPathParentClass}
                  data-testid="topbar-project-parent-path"
                >
                  {projectParent}
                </span>
                <span className={contextPathNameClass}>{projectName}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ) : !projectPath ? (
        <motion.div
          key="empty-context-strip"
          initial={fadeInitial}
          animate={fadeAnimate}
          exit={fadeInitial}
          transition={fadeTransition}
          className="topbar-context-shell shell-cluster px-2.5 py-1.5"
        >
          <span className={centerChipClass}>No project open</span>
        </motion.div>
      ) : (
        <motion.div
          key="compact-context-spacer"
          initial={false}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          className="h-0 w-0"
          aria-hidden="true"
        />
      )}
    </AnimatePresence>
  );

  const renderMoreItem = () => (
    <DropdownMenu.Root open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          className={`${topBarActionClass} outline-none`}
          title="More"
          data-testid="topbar-more-button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setMoreMenuOpen((open) => !open)}
        >
          <MoreVertical size={topBarIconSize} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <MotionDropdownContent
          align="end"
          sideOffset={8}
          className="shell-menu-content min-w-[240px]"
          data-shell-menu-content
        >
          <DropdownMenu.Label className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Panels
          </DropdownMenu.Label>

          <DropdownMenu.Item
            onSelect={() => onToggleAIChat?.()}
            className={menuItemClass}
          >
            <MessageSquare size={menuIconSize} />
            AI Chat
            {panels.aiChat && (
              <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
            )}
          </DropdownMenu.Item>

          <DropdownMenu.Item
            onSelect={() => onToggleTerminal?.()}
            className={menuItemClass}
          >
            <Terminal size={menuIconSize} />
            Terminal
            {panels.terminal && (
              <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
            )}
          </DropdownMenu.Item>

          <DropdownMenu.Item
            onSelect={() => onToggleGit?.()}
            className={menuItemClass}
          >
            <GitBranch size={menuIconSize} />
            Git
            {panels.git && (
              <span className="ml-auto h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
            )}
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-[var(--shell-inline-divider)]" />

          <DropdownMenu.Label className="px-3 py-2 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
            Actions
          </DropdownMenu.Label>

          <DropdownMenu.Item
            onSelect={() => onOpenDependencyPolicy?.()}
            className={menuItemClass}
          >
            <RefreshCw size={menuIconSize} />
            Sync dependencies...
          </DropdownMenu.Item>

          <DropdownMenu.Item
            onSelect={() => onCheckForUpdates?.()}
            className={menuItemClass}
          >
            <DownloadCloud size={menuIconSize} />
            Check for Updates
          </DropdownMenu.Item>
        </MotionDropdownContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const renderTopbarItem = (itemId: VisibleTopbarItemId) => {
    switch (itemId) {
      case "explorer":
        return renderExplorerButton();
      case "search":
        return (
          <button
            onClick={onOpenSearch}
            className={`${topBarButtonClass} text-[var(--text-secondary)]`}
            title="Search"
          >
            <Search size={topBarIconSize} />
          </button>
        );
      case "settings":
        return (
          <button
            onClick={onOpenSettings}
            className={`${topBarButtonClass} text-[var(--text-secondary)]`}
            title="Settings"
          >
            <Settings size={topBarIconSize} />
          </button>
        );
      case "projects":
        return (
          <div
            className="shell-cluster min-w-0 px-1.5"
            data-testid="topbar-projects-cluster"
          >
            <ProjectIndicators
              onSwitch={(id) => onSwitchProject?.(id)}
              onClose={(id) => onCloseProject?.(id)}
              onDetach={(id) => onDetachProject?.(id)}
              onReorder={(ids) => onReorderProjects?.(ids)}
            />
          </div>
        );
      case "addProject":
        return (
          <div
            className="shell-cluster px-1.5"
            data-testid="topbar-add-project-cluster"
          >
            <AddProjectMenu
              onProjectOpen={(path) => onProjectOpen?.(path)}
              onMenuOpenChange={setAddProjectMenuOpen}
            />
          </div>
        );
      case "context":
        return renderContextItem();
      case "debug":
        return (
          <button
            onClick={onOpenDebug}
            className={topBarActionClass}
            title="Debug"
          >
            <Bug size={topBarIconSize} />
          </button>
        );
      case "run":
        return (
          <button onClick={onRun} className={topBarActionClass} title="Run">
            <Play size={topBarIconSize} />
          </button>
        );
      case "preview":
        return (
          <button
            onClick={onOpenPreview}
            className={`${topBarButtonClass} ${
              previewActive
                ? "border-[color:rgba(34,197,94,0.28)] bg-[color:rgba(34,197,94,0.14)] text-[var(--status-success)]"
                : previewEnabled
                  ? "text-[var(--text-secondary)]"
                  : "cursor-not-allowed text-[var(--text-muted)] opacity-45"
            }`}
            title={previewTitle}
            disabled={!previewEnabled}
            data-testid="topbar-preview-button"
          >
            <Globe size={topBarIconSize} />
          </button>
        );
      case "aiChat":
        return (
          <button
            onClick={onToggleAIChat}
            className={getPanelActionClass(panels.aiChat)}
            title="AI Chat"
            aria-pressed={Boolean(panels.aiChat)}
            data-testid="topbar-ai-chat-button"
          >
            <MessageSquare size={topBarIconSize} />
          </button>
        );
      case "terminal":
        return (
          <button
            onClick={onToggleTerminal}
            className={getPanelActionClass(panels.terminal)}
            title="Terminal"
            aria-pressed={Boolean(panels.terminal)}
            data-testid="topbar-terminal-button"
          >
            <Terminal size={topBarIconSize} />
          </button>
        );
      case "git":
        return (
          <button
            onClick={onToggleGit}
            className={getPanelActionClass(panels.git)}
            title="Git"
            aria-pressed={Boolean(panels.git)}
            data-testid="topbar-git-button"
          >
            <GitBranch size={topBarIconSize} />
          </button>
        );
      case "syncDependencies":
        return (
          <button
            onClick={onOpenDependencyPolicy}
            className={topBarActionClass}
            title="Sync dependencies..."
            data-testid="topbar-sync-dependencies-button"
          >
            <RefreshCw size={topBarIconSize} />
          </button>
        );
      case "checkUpdates":
        return (
          <button
            onClick={onCheckForUpdates}
            className={topBarActionClass}
            title="Check for Updates"
            data-testid="topbar-check-updates-button"
          >
            <DownloadCloud size={topBarIconSize} />
          </button>
        );
      case "notifications":
        return (
          <NotificationCenterButton
            buttonClassName={topBarActionClass}
            activeButtonClassName={activeTopBarPanelButtonClass}
            iconSize={topBarIconSize}
            onOpenChange={setNotificationMenuOpen}
          />
        );
      case "more":
        return renderMoreItem();
    }
  };

  const renderDraggableTopbarItem = (
    itemId: VisibleTopbarItemId,
    group: TopbarItemGroup,
  ) => (
    <div
      key={itemId}
      className={getTopbarItemClassName(itemId)}
      style={topBarItemNoDragStyle}
      data-topbar-item-id={itemId}
      data-testid={`topbar-item-${itemId}`}
      onPointerDown={(event) =>
        handleTopbarItemPointerDown(itemId, group, event)
      }
      onClickCapture={handleTopbarItemClickCapture}
    >
      {renderTopbarItem(itemId)}
    </div>
  );

  return (
    <div
      className="relative z-50 flex h-14 min-w-0 items-center gap-2 rounded-b-[18px] border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-3"
      style={topBarDragStyle}
      data-testid="topbar"
    >
      <WindowControls
        visible={windowControlsVisible}
        backdropVisible={windowControlsBackdropVisible}
        nativeEnabled={windowControlsNativeEnabled}
      />

      <div className={topBarGroupClass} style={topBarItemNoDragStyle}>
        <div
          ref={leftTopbarItemsRef}
          className="shell-cluster min-h-12 min-w-[3.5rem] px-1.5"
          data-testid="topbar-left-action-bubble"
        >
          {leftTopbarOrder.map((itemId) =>
            renderDraggableTopbarItem(itemId, "left"),
          )}
        </div>
      </div>

      <div
        className={`${topBarGroupClass} min-w-0`}
        style={topBarItemNoDragStyle}
      >
        <div className="shell-cluster min-h-12 min-w-[3.5rem] max-w-[min(58vw,470px)] overflow-x-auto px-1.5 pr-2">
          <ProjectIndicators
            onSwitch={(id) => onSwitchProject?.(id)}
            onClose={(id) => onCloseProject?.(id)}
            onDetach={(id) => onDetachProject?.(id)}
            onReorder={(ids) => onReorderProjects?.(ids)}
          />
          <div className="shell-divider" />
          <AddProjectMenu
            onProjectOpen={(path) => onProjectOpen?.(path)}
            onMenuOpenChange={setAddProjectMenuOpen}
          />
        </div>
      </div>

      <div className="relative flex h-full -translate-y-[2px] flex-1 items-center justify-center px-2">
        <div className="flex max-w-[860px] flex-1 items-center justify-center gap-2 overflow-hidden">
          {renderContextItem()}
        </div>
      </div>

      <div className={topBarGroupClass} style={topBarItemNoDragStyle}>
        <div
          ref={rightTopbarItemsRef}
          className="shell-cluster min-h-12 min-w-[3.5rem] max-w-[min(58vw,470px)] overflow-x-auto px-1.5"
          data-testid="topbar-action-bubble"
        >
          {rightTopbarOrder.map((itemId) =>
            renderDraggableTopbarItem(itemId, "right"),
          )}
        </div>
      </div>
      <DragGhost ghost={dragGhost} />
    </div>
  );
};
