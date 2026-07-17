import React, { useState, useEffect, useCallback, useRef } from "react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Copy,
  ExternalLink,
  Search,
  X,
} from "lucide-react";
import {
  CodeMirrorEditor,
  type CodeMirrorPerformanceProfile,
  type EditorHistoryAvailability,
} from "./CodeMirrorEditor";
import { EditorFileLoadingView } from "./EditorFileLoadingView";
import {
  EditorTabs,
  Tab,
  type EditorSplitDropSide,
  type EditorSplitPaneSide,
  type EditorSplitDropTarget,
} from "./EditorTabs";
import { TabSwitcherOverlay } from "./TabSwitcherOverlay";
import QuickLookModal from "./QuickLookModal";
import { BinaryEditorPreview } from "./BinaryEditorPreview";
import { ImageEditorPreview } from "./ImageEditorPreview";
import * as AppFunctions from "../wails/app";
import { EventsOn } from "../wails/runtime";
import { useProjectEntryActions } from "../contexts/ProjectEntryActionsContext";
import { radius } from "../styles/colors";
import { shortcuts } from "../utils/keyboard";
import {
  PROJECT_SWITCH_BLOCKERS,
  blockProjectSwitch,
  unblockProjectSwitch,
} from "../utils/priorityUI";
import { makeEditorTabId, useEditorStore } from "../stores/editorStore";
import {
  aiInlinePatchPathMatches,
  selectAIInlinePatchPreviewForPath,
  useAIInlinePatchStore,
  type AIInlinePatchPreview,
} from "../stores/aiInlinePatchStore";
import { useAppNotificationStore } from "../stores/appNotificationStore";
import {
  codeEditorChromeStyle,
  editorCanvasBackground,
} from "../utils/codeMirrorTheme";
import { openEditorFileSearch } from "../utils/codeMirrorFileSearch";
import { formatCodeWithPrettier } from "../utils/formatCode";
import { type ContextActionMenuItem } from "./ui/ContextActionMenu";
import { GuardedEditorPreview } from "./GuardedEditorPreview";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  normalizeProjectPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";
import {
  EDITOR_FILE_LOADING_DELAY_MS,
  createEditorFileLoadingLoad,
  createEditableEditorFileLoad,
  createEditorNavigationTarget,
  grantEditorFileWriteAccess,
  isEditorFilePolicyReadOnly,
  loadEditorFile,
  type EditorFileLoadState,
  type EditorFileOpenPayload,
  type EditorNavigationTarget,
} from "../utils/editorFileLoader";
import { replaceEditorDocumentFromDisk } from "../stores/editorDocumentObserver";
import { getCurrentProjectSessionId } from "../shell/projectSessionRoute";
import {
  findBlockingAIInlinePatchCandidate,
  formatAIInlinePatchCandidateName,
  getAffectedAIInlinePatchCandidates,
  isAIInlinePatchPreviewInScope,
} from "../utils/aiInlinePatchApproval";
import { usePerformanceStore } from "../stores/performanceStore";
import type {
  MarkdownPreviewSource,
  PanelOpenRequest,
} from "./layout/MainLayout.types";
import type { PanelSnapDragCallbacks } from "../utils/panelSnapDrag";

type SplitDirection = "horizontal" | "vertical" | null;
type EditorSplitSlots = {
  leftTabIds: string[];
  rightTabIds: string[];
  bottomTabIds: string[];
  leftActiveTabId: string;
  rightActiveTabId: string;
  bottomActiveTabId: string;
} | null;

type EditorFileOpenHandler = (payload: EditorFileOpenPayload) => void;

interface ProjectScreenProps extends PanelSnapDragCallbacks {
  projectPath: string;
  fileToOpen?: EditorFileOpenPayload | null;
  onFileOpened?: () => void;
  onToggleProblems?: () => void;
  markdownPreviewOpen?: boolean;
  onToggleMarkdownPreview?: () => void;
  onMarkdownPreviewSourceChange?: (
    source: MarkdownPreviewSource | null,
  ) => void;
  onPerspectiveOpen?: () => void;
  onPerspectiveClose?: () => void;
  onEditorFileOpenReady?: (handler: EditorFileOpenHandler | null) => void;
  onDirtyEditorFlushReady?: (handler: (() => Promise<void>) | null) => void;
  onRequestProjectClose?: () => void;
  onFileOpenInPanel?: (
    path: string,
    name: string,
    line?: number,
    request?: Partial<PanelOpenRequest>,
  ) => unknown | Promise<unknown>;
}

const AUTO_SAVE_DELAY = 1500;
const EDITOR_STORE_CONTENT_FLUSH_MS = 50;
const EMPTY_EDITOR_HISTORY_AVAILABILITY: EditorHistoryAvailability = {
  canUndo: false,
  canRedo: false,
};

const isMarkdownPath = (path: string): boolean =>
  /\.(md|mdx|markdown|mdown|mkdn)$/i.test(path);

const editorSplitPaneSides: EditorSplitPaneSide[] = ["left", "right", "bottom"];
const editorSplitDropSides: EditorSplitDropSide[] = editorSplitPaneSides;
const EDITOR_FILE_SPLIT_DRAG_EVENT = "arlecchino:editor-file-split-drag";
const EDITOR_FILE_SPLIT_DROP_EVENT = "arlecchino:editor-file-split-drop";

interface EditorFileSplitDropEventDetail {
  path?: string;
  name?: string;
  side?: EditorSplitDropSide;
  line?: number;
}

const normalizeEditorTabs = (inputTabs: Tab[]): Tab[] => {
  const normalized: Tab[] = [];
  const pathIndex = new Map<string, number>();

  inputTabs.forEach((tab) => {
    const path = tab.path.trim();
    if (!path) {
      return;
    }

    const nextTab: Tab = {
      ...tab,
      id: makeEditorTabId(path),
      label: tab.label.trim() || getProjectPathBasename(path),
      path,
    };
    const existingIndex = pathIndex.get(path);
    if (existingIndex === undefined) {
      pathIndex.set(path, normalized.length);
      normalized.push(nextTab);
      return;
    }

    if (nextTab.isDirty && !normalized[existingIndex].isDirty) {
      normalized[existingIndex] = {
        ...normalized[existingIndex],
        isDirty: true,
      };
    }
  });

  return normalized;
};

const uniqueEditorTabIds = (tabIds: string[]): string[] => {
  const seen = new Set<string>();
  const uniqueIds: string[] = [];
  tabIds.forEach((tabId) => {
    if (!tabId || seen.has(tabId)) {
      return;
    }
    seen.add(tabId);
    uniqueIds.push(tabId);
  });
  return uniqueIds;
};

const getEditorSplitTabIds = (
  slots: NonNullable<EditorSplitSlots>,
  side: EditorSplitPaneSide,
): string[] => {
  switch (side) {
    case "left":
      return slots.leftTabIds;
    case "right":
      return slots.rightTabIds;
    case "bottom":
      return slots.bottomTabIds;
  }
};

const getEditorSplitActiveTabId = (
  slots: NonNullable<EditorSplitSlots>,
  side: EditorSplitPaneSide,
): string => {
  switch (side) {
    case "left":
      return slots.leftActiveTabId;
    case "right":
      return slots.rightActiveTabId;
    case "bottom":
      return slots.bottomActiveTabId;
  }
};

const getEditorSplitActiveSides = (
  slots: EditorSplitSlots,
): EditorSplitPaneSide[] =>
  slots
    ? editorSplitPaneSides.filter(
        (side) => getEditorSplitTabIds(slots, side).length > 0,
      )
    : [];

const getPrimaryEditorSplitSide = (
  slots: EditorSplitSlots,
): EditorSplitPaneSide | null => getEditorSplitActiveSides(slots)[0] ?? null;

const getPrimaryEditorSplitActiveTabId = (
  slots: EditorSplitSlots,
): string | null => {
  const side = getPrimaryEditorSplitSide(slots);
  return slots && side ? getEditorSplitActiveTabId(slots, side) : null;
};

const getSecondaryEditorSplitActiveTabId = (
  slots: EditorSplitSlots,
): string | null => {
  const side = getEditorSplitActiveSides(slots)[1] ?? null;
  return slots && side ? getEditorSplitActiveTabId(slots, side) : null;
};

const getEditorSplitDirection = (slots: EditorSplitSlots): SplitDirection => {
  if (!slots) {
    return null;
  }
  return slots.bottomTabIds.length > 0 ? "vertical" : "horizontal";
};

const getEditorSplitSideForTabId = (
  slots: EditorSplitSlots,
  tabId: string | null,
): EditorSplitPaneSide | null => {
  if (!slots || !tabId) {
    return null;
  }
  for (const side of editorSplitPaneSides) {
    if (getEditorSplitTabIds(slots, side).includes(tabId)) {
      return side;
    }
  }
  return null;
};

const isEditorSplitDropSide = (side: unknown): side is EditorSplitDropSide =>
  side === "left" || side === "right" || side === "bottom";

const normalizeEditorSplitSlots = (
  slots: EditorSplitSlots,
  tabs: Tab[],
): EditorSplitSlots => {
  if (!slots) {
    return null;
  }

  const validTabIds = new Set(tabs.map((tab) => tab.id));
  const leftTabIds = uniqueEditorTabIds(slots.leftTabIds).filter((tabId) =>
    validTabIds.has(tabId),
  );
  const rightTabIds = uniqueEditorTabIds(slots.rightTabIds).filter((tabId) =>
    validTabIds.has(tabId),
  );
  const bottomTabIds = uniqueEditorTabIds(slots.bottomTabIds).filter((tabId) =>
    validTabIds.has(tabId),
  );

  const activeSideCount = [leftTabIds, rightTabIds, bottomTabIds].filter(
    (tabIds) => tabIds.length > 0,
  ).length;
  if (activeSideCount < 2) {
    return null;
  }

  return {
    leftTabIds,
    rightTabIds,
    bottomTabIds,
    leftActiveTabId: leftTabIds.includes(slots.leftActiveTabId)
      ? slots.leftActiveTabId
      : (leftTabIds[0] ?? ""),
    rightActiveTabId: rightTabIds.includes(slots.rightActiveTabId)
      ? slots.rightActiveTabId
      : (rightTabIds[0] ?? ""),
    bottomActiveTabId: bottomTabIds.includes(slots.bottomActiveTabId)
      ? slots.bottomActiveTabId
      : (bottomTabIds[0] ?? ""),
  };
};

const createEditorSplitSlots = (
  overrides: Partial<NonNullable<EditorSplitSlots>> = {},
): NonNullable<EditorSplitSlots> => ({
  leftTabIds: [],
  rightTabIds: [],
  bottomTabIds: [],
  leftActiveTabId: "",
  rightActiveTabId: "",
  bottomActiveTabId: "",
  ...overrides,
});

const updateEditorSplitSide = (
  slots: NonNullable<EditorSplitSlots>,
  side: EditorSplitPaneSide,
  tabIds: string[],
  activeTabId?: string,
): NonNullable<EditorSplitSlots> => {
  switch (side) {
    case "left":
      return {
        ...slots,
        leftTabIds: tabIds,
        leftActiveTabId: activeTabId ?? tabIds[0] ?? "",
      };
    case "right":
      return {
        ...slots,
        rightTabIds: tabIds,
        rightActiveTabId: activeTabId ?? tabIds[0] ?? "",
      };
    case "bottom":
      return {
        ...slots,
        bottomTabIds: tabIds,
        bottomActiveTabId: activeTabId ?? tabIds[0] ?? "",
      };
  }
};

const createInitialEditorSplitSlots = (
  tabId: string,
  targetSide: EditorSplitPaneSide,
  fallbackTabIds: string[],
  fallbackActiveTabId: string,
): NonNullable<EditorSplitSlots> => {
  const fallbackSide: EditorSplitPaneSide =
    targetSide === "left" ? "right" : "left";
  let slots = updateEditorSplitSide(
    createEditorSplitSlots(),
    targetSide,
    [tabId],
    tabId,
  );
  slots = updateEditorSplitSide(
    slots,
    fallbackSide,
    fallbackTabIds,
    fallbackActiveTabId,
  );
  return slots;
};

const createPrimaryEditorSplitSlots = (
  primaryTabId: string,
  secondarySide: EditorSplitPaneSide,
  secondaryTabIds: string[],
  secondaryActiveTabId: string,
): NonNullable<EditorSplitSlots> => {
  let slots = updateEditorSplitSide(
    createEditorSplitSlots(),
    "left",
    [primaryTabId],
    primaryTabId,
  );
  slots = updateEditorSplitSide(
    slots,
    secondarySide,
    secondaryTabIds,
    secondaryActiveTabId,
  );
  return slots;
};

const getTabsByIds = (tabs: Tab[], tabIds: string[]): Tab[] => {
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  return tabIds.flatMap((tabId) => {
    const tab = tabsById.get(tabId);
    return tab ? [tab] : [];
  });
};

const getOtherEditorTabIds = (tabs: Tab[], tabId: string): string[] => {
  const tabIds: string[] = [];
  tabs.forEach((tab) => {
    if (tab.id !== tabId) {
      tabIds.push(tab.id);
    }
  });
  return tabIds;
};

const normalizeProjectStoragePath = (
  projectPath: string | null | undefined,
): string =>
  (projectPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");

const stableProjectStorageHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
};

const projectScopedStorageKey = (
  prefix: string,
  projectPath: string | null | undefined,
): string => {
  const normalizedProjectPath = normalizeProjectStoragePath(projectPath);
  return normalizedProjectPath
    ? `${prefix}:project:${stableProjectStorageHash(normalizedProjectPath)}`
    : `${prefix}:global`;
};

const legacyProjectScopedStorageKey = (
  prefix: string,
  projectPath: string | null | undefined,
): string => `${prefix}:${projectPath ?? ""}`;

const readProjectScopedStorageItem = (
  storageKey: string,
  legacyStorageKey: string,
): string | null => {
  const current = localStorage.getItem(storageKey);
  if (current || legacyStorageKey === storageKey) {
    return current;
  }
  return localStorage.getItem(legacyStorageKey);
};

const readStoredEditorTabs = (
  storageKey: string,
  legacyStorageKey: string,
): Tab[] => {
  try {
    const raw = readProjectScopedStorageItem(storageKey, legacyStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { tabs?: unknown };
    if (!Array.isArray(parsed.tabs)) {
      return [];
    }

    return normalizeEditorTabs(
      parsed.tabs.flatMap((entry): Tab[] => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const candidate = entry as { path?: unknown; label?: unknown };
        if (typeof candidate.path !== "string") {
          return [];
        }

        const path = candidate.path;
        const label =
          typeof candidate.label === "string"
            ? candidate.label
            : getProjectPathBasename(path);
        return [
          {
            id: makeEditorTabId(path),
            label,
            path,
            isDirty: false,
          },
        ];
      }),
    );
  } catch {
    return [];
  }
};

const readStoredActiveEditorTabId = (
  storageKey: string,
  legacyStorageKey: string,
): string | null => {
  try {
    const raw = readProjectScopedStorageItem(storageKey, legacyStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { activeTabId?: unknown };
    return typeof parsed.activeTabId === "string" ? parsed.activeTabId : null;
  } catch {
    return null;
  }
};

const readStoredEditorTabState = (
  storageKey: string,
  legacyStorageKey: string,
): { tabs: Tab[]; activeTabId: string | null } => {
  const storedTabs = readStoredEditorTabs(storageKey, legacyStorageKey);
  const storedActiveTabId = readStoredActiveEditorTabId(
    storageKey,
    legacyStorageKey,
  );
  const activeTabId =
    storedActiveTabId && storedTabs.some((tab) => tab.id === storedActiveTabId)
      ? storedActiveTabId
      : (storedTabs[0]?.id ?? null);

  return { tabs: storedTabs, activeTabId };
};

const EditorSplitDropZone: React.FC<{
  side: EditorSplitDropSide;
  isActive: boolean;
}> = ({ side, isActive }) => {
  const isBottom = side === "bottom";
  const activeBorder = "var(--shell-border-strong)";
  const inactiveBorder = "rgba(255,255,255,0.1)";
  const style: React.CSSProperties = {
    position: "absolute",
    top: isBottom ? "calc(66.666% + 4px)" : 8,
    bottom: isBottom ? 8 : "calc(33.333% + 4px)",
    left: isBottom || side === "left" ? 8 : "calc(50% + 4px)",
    right: isBottom || side === "right" ? 8 : "calc(50% + 4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    border: `1px solid ${isActive ? activeBorder : inactiveBorder}`,
    background: isActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.025)",
    boxShadow: isActive
      ? "inset 0 0 0 1px var(--shell-border-strong), var(--shell-shadow)"
      : "none",
    opacity: isActive ? 1 : 0.52,
    pointerEvents: "none",
  };

  return (
    <div
      data-testid={`editor-split-drop-zone-${side}`}
      data-drop-active={isActive ? "true" : "false"}
      aria-label={`Editor split ${side}`}
      style={style}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 9999,
          border: "1px solid var(--shell-border-strong)",
          backgroundColor:
            "color-mix(in srgb, var(--surface-shell-strong) 92%, transparent)",
          color: "var(--text-secondary)",
          opacity: isActive ? 1 : 0.64,
          boxShadow: isActive ? "var(--shadow-overlay)" : "none",
        }}
      >
        {isBottom ? (
          <ArrowUpDown size={16} strokeWidth={2.2} />
        ) : (
          <ArrowLeftRight size={16} strokeWidth={2.2} />
        )}
      </div>
    </div>
  );
};

const getWrappedTabIndex = (
  currentIndex: number,
  direction: 1 | -1,
  total: number,
): number => {
  if (total <= 0) {
    return -1;
  }

  return (currentIndex + direction + total) % total;
};

interface ProjectEntryRenamedEvent {
  oldPath?: string;
  newPath?: string;
  isDirectory?: boolean;
}

interface ProjectEntryDeletedEvent {
  path?: string;
  isDirectory?: boolean;
}

interface AIPatchArtifactMutationEvent {
  artifactId?: string;
  projectSessionId?: string;
  files?: Array<{
    path?: string;
    absolutePath?: string;
    status?: string;
    created?: boolean;
  }>;
}

const ProjectScreen: React.FC<ProjectScreenProps> = ({
  projectPath,
  fileToOpen,
  onFileOpened,
  onToggleProblems,
  markdownPreviewOpen = false,
  onToggleMarkdownPreview,
  onMarkdownPreviewSourceChange,
  onPerspectiveOpen,
  onPerspectiveClose,
  onEditorFileOpenReady,
  onDirtyEditorFlushReady,
  onRequestProjectClose,
  onFileOpenInPanel,
  onPanelSnapDragStart,
  onPanelSnapDragMove,
  onPanelSnapDragEnd,
}) => {
  const editorBgColor = editorCanvasBackground;
  const currentProjectSessionId = getCurrentProjectSessionId();
  const setStatusFile = useEditorStore((state) => state.setStatusFile);
  const activeEditorPaneId = useEditorStore((state) => state.activePaneId);
  const syncEditorStoreActiveTab = useEditorStore(
    (state) => state.syncActiveTab,
  );
  const updateEditorStoreTabContent = useEditorStore(
    (state) => state.updateTabContent,
  );
  const replaceEditorStoreTabContent = useEditorStore(
    (state) => state.replaceTabContent,
  );
  const closeEditorStoreTabPath = useEditorStore((state) => state.closePath);
  const pruneEditorStorePathPrefix = useEditorStore(
    (state) => state.closePathPrefix,
  );
  const aiInlinePatchPreviews = useAIInlinePatchStore(
    (state) => state.previews,
  );
  const clearAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.clearPreview,
  );
  const acknowledgeAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.acknowledgePreview,
  );
  const dismissAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.dismissPreview,
  );
  const aiInlinePatchBusyIds = useAIInlinePatchStore((state) => state.busyIds);
  const beginAIInlinePatchBusy = useAIInlinePatchStore(
    (state) => state.beginBusy,
  );
  const endAIInlinePatchBusy = useAIInlinePatchStore((state) => state.endBusy);
  const resetActiveEditorBudget = usePerformanceStore(
    (state) => state.resetActiveEditorBudget,
  );
  const beginPanelMotionWindow = usePerformanceStore(
    (state) => state.beginPanelMotionWindow,
  );
  const { copyAbsolutePath, revealEntry } = useProjectEntryActions();

  const tabStorageKey = React.useMemo(
    () => projectScopedStorageKey("editorTabs", projectPath),
    [projectPath],
  );
  const legacyTabStorageKey = React.useMemo(
    () => legacyProjectScopedStorageKey("editorTabs", projectPath),
    [projectPath],
  );

  const [tabs, setTabs] = useState<Tab[]>(
    () => readStoredEditorTabState(tabStorageKey, legacyTabStorageKey).tabs,
  );

  const [activeTab, setActiveTab] = useState<string | null>(
    () =>
      readStoredEditorTabState(tabStorageKey, legacyTabStorageKey).activeTabId,
  );

  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLoadStates, setFileLoadStates] = useState<
    Record<string, EditorFileLoadState>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | undefined>(
    undefined,
  );
  const [pendingEditorNavigation, setPendingEditorNavigation] = useState<{
    path: string;
    target: EditorNavigationTarget;
  } | null>(null);
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const [splitDirection, setSplitDirection] = useState<SplitDirection>(null);
  const [secondaryActiveTab, setSecondaryActiveTab] = useState<string | null>(
    null,
  );
  const [editorSplitSlots, setEditorSplitSlots] =
    useState<EditorSplitSlots>(null);
  const [focusedEditorSplitSide, setFocusedEditorSplitSide] =
    useState<EditorSplitPaneSide>("left");
  const [activeEditorSplitDropSide, setActiveEditorSplitDropSide] =
    useState<EditorSplitDropSide | null>(null);
  const [quickLook, setQuickLook] = useState<{
    isOpen: boolean;
    filePath: string;
    content: string;
    language: string;
    highlightLine?: number;
  }>({
    isOpen: false,
    filePath: "",
    content: "",
    language: "plaintext",
  });

  const closeQuickLook = () => {
    unblockProjectSwitch(PROJECT_SWITCH_BLOCKERS.quickLook);
    setQuickLook((prev) => ({ ...prev, isOpen: false }));
  };

  const autoSaveTimerRefs = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const contentStateFlushTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingContentStateRef = useRef<Record<string, string>>({});
  const pendingEditorStoreContentRef = useRef<Record<string, string>>({});
  const editorStoreContentFlushTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const lastEditorStoreContentFlushAtRef = useRef(0);
  const typingActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingTypingActivityRef = useRef(0);
  const tabsRef = useRef<Tab[]>(tabs);
  const fileContentsRef = useRef<Record<string, string>>({});
  const fileLoadStatesRef = useRef<Record<string, EditorFileLoadState>>({});
  const tabFileLoadRequestsRef = useRef<
    Record<string, { path: string; requestId: number }>
  >({});
  const tabLoadingRevealTimerRefs = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const editorSurfaceRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<string | null>(activeTab);
  const splitDirectionRef = useRef<SplitDirection>(splitDirection);
  const activeEditorViewRef = useRef<EditorView | null>(null);
  const editorViewRefs = useRef<Record<string, EditorView | null>>({});
  const secondaryActiveTabRef = useRef<string | null>(secondaryActiveTab);
  const editorSplitSlotsRef = useRef<EditorSplitSlots>(editorSplitSlots);
  const focusedEditorSplitSideRef = useRef<EditorSplitPaneSide>(
    focusedEditorSplitSide,
  );
  const openFileRequestRef = useRef(0);
  const fileOpenLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastFileToOpenRef = useRef<string | null>(null);
  const quickLookRequestRef = useRef(0);
  const reopenClosedTabRequestRef = useRef(0);
  const tabSwitcherSelectionRef = useRef<string | null>(null);
  const [isTabSwitcherOpen, setIsTabSwitcherOpen] = useState(false);
  const [tabSwitcherSelection, setTabSwitcherSelectionState] = useState<
    string | null
  >(null);
  const [editorHistoryAvailability, setEditorHistoryAvailability] =
    useState<EditorHistoryAvailability>(EMPTY_EDITOR_HISTORY_AVAILABILITY);
  const [activeEditorViewAvailable, setActiveEditorViewAvailable] =
    useState(false);

  const flushPendingEditorStoreContent = useCallback(() => {
    const pending = pendingEditorStoreContentRef.current;
    pendingEditorStoreContentRef.current = {};
    editorStoreContentFlushTimerRef.current = null;
    lastEditorStoreContentFlushAtRef.current = Date.now();
    Object.entries(pending).forEach(([tabId, content]) => {
      updateEditorStoreTabContent(tabId, content);
    });
  }, [updateEditorStoreTabContent]);

  const flushEditorStoreContentForTab = useCallback(
    (tabId: string) => {
      const pending = pendingEditorStoreContentRef.current[tabId];
      if (pending === undefined) {
        return;
      }
      delete pendingEditorStoreContentRef.current[tabId];
      updateEditorStoreTabContent(tabId, pending);
      lastEditorStoreContentFlushAtRef.current = Date.now();
      if (
        Object.keys(pendingEditorStoreContentRef.current).length === 0 &&
        editorStoreContentFlushTimerRef.current !== null
      ) {
        clearTimeout(editorStoreContentFlushTimerRef.current);
        editorStoreContentFlushTimerRef.current = null;
      }
    },
    [updateEditorStoreTabContent],
  );

  const scheduleEditorStoreContentUpdate = useCallback(
    (tabId: string, content: string) => {
      const now = Date.now();
      const sharedTab = useEditorStore.getState().tabs.get(tabId);
      const elapsed = now - lastEditorStoreContentFlushAtRef.current;
      if (
        sharedTab &&
        (!sharedTab.isDirty ||
          (editorStoreContentFlushTimerRef.current === null &&
            elapsed >= EDITOR_STORE_CONTENT_FLUSH_MS))
      ) {
        delete pendingEditorStoreContentRef.current[tabId];
        updateEditorStoreTabContent(tabId, content);
        lastEditorStoreContentFlushAtRef.current = now;
        return;
      }

      pendingEditorStoreContentRef.current[tabId] = content;
      if (editorStoreContentFlushTimerRef.current !== null) {
        return;
      }
      editorStoreContentFlushTimerRef.current = setTimeout(
        flushPendingEditorStoreContent,
        Math.max(0, EDITOR_STORE_CONTENT_FLUSH_MS - elapsed),
      );
    },
    [flushPendingEditorStoreContent, updateEditorStoreTabContent],
  );

  const setTabSwitcherSelection = useCallback((tabId: string | null) => {
    tabSwitcherSelectionRef.current = tabId;
    setTabSwitcherSelectionState(tabId);
  }, []);

  const updateActiveEditorView = useCallback((view: EditorView | null) => {
    activeEditorViewRef.current = view;
    setActiveEditorViewAvailable(Boolean(view));
    if (!view) {
      setEditorHistoryAvailability(EMPTY_EDITOR_HISTORY_AVAILABILITY);
    }
  }, []);

  const clearTabLoadingRevealTimer = useCallback((tabId: string) => {
    const timer = tabLoadingRevealTimerRefs.current[tabId];
    if (timer === undefined) {
      return;
    }

    clearTimeout(timer);
    delete tabLoadingRevealTimerRefs.current[tabId];
  }, []);

  const clearAllTabLoadingRevealTimers = useCallback(() => {
    Object.values(tabLoadingRevealTimerRefs.current).forEach(clearTimeout);
    tabLoadingRevealTimerRefs.current = {};
  }, []);

  useEffect(
    () => () => {
      clearAllTabLoadingRevealTimers();
      tabFileLoadRequestsRef.current = {};
    },
    [clearAllTabLoadingRevealTimers],
  );

  const handleEditorViewReadyForTab = useCallback(
    (tabId: string, view: EditorView | null) => {
      if (view) {
        editorViewRefs.current[tabId] = view;
      } else {
        delete editorViewRefs.current[tabId];
      }

      const splitSlots = editorSplitSlotsRef.current;
      const focusedTabId = splitSlots
        ? getEditorSplitActiveTabId(
            splitSlots,
            focusedEditorSplitSideRef.current,
          )
        : activeTabRef.current;
      if (focusedTabId === tabId) {
        updateActiveEditorView(view);
      }
    },
    [updateActiveEditorView],
  );

  const handleNavigationTargetApplied = useCallback((navId: number) => {
    setPendingEditorNavigation((current) =>
      current?.target.navId === navId ? null : current,
    );
  }, []);

  const focusEditorSplitSide = useCallback(
    (side: EditorSplitPaneSide) => {
      focusedEditorSplitSideRef.current = side;
      setFocusedEditorSplitSide(side);

      const splitSlots = editorSplitSlotsRef.current;
      const focusedTabId = splitSlots
        ? getEditorSplitActiveTabId(splitSlots, side)
        : activeTabRef.current;
      updateActiveEditorView(
        focusedTabId ? (editorViewRefs.current[focusedTabId] ?? null) : null,
      );
    },
    [updateActiveEditorView],
  );

  const activateEditorTab = useCallback(
    (tabId: string) => {
      const currentSlots = editorSplitSlotsRef.current;
      if (currentSlots) {
        const focusedSide = focusedEditorSplitSideRef.current;
        const splitSide = getEditorSplitTabIds(
          currentSlots,
          focusedSide,
        ).includes(tabId)
          ? focusedSide
          : getEditorSplitSideForTabId(currentSlots, tabId);

        if (splitSide) {
          const nextSlots = updateEditorSplitSide(
            currentSlots,
            splitSide,
            getEditorSplitTabIds(currentSlots, splitSide),
            tabId,
          );
          const normalizedSlots = normalizeEditorSplitSlots(
            nextSlots,
            tabsRef.current,
          );
          if (normalizedSlots) {
            editorSplitSlotsRef.current = normalizedSlots;
            setEditorSplitSlots(normalizedSlots);
            const nextDirection = getEditorSplitDirection(normalizedSlots);
            splitDirectionRef.current = nextDirection;
            setSplitDirection(nextDirection);
            const nextPrimaryTabId =
              getPrimaryEditorSplitActiveTabId(normalizedSlots);
            activeTabRef.current = nextPrimaryTabId;
            setActiveTab(nextPrimaryTabId);
            setSecondaryActiveTab(
              getSecondaryEditorSplitActiveTabId(normalizedSlots),
            );
            focusEditorSplitSide(splitSide);
            return;
          }
        }
      }

      activeTabRef.current = tabId;
      setActiveTab(tabId);
      updateActiveEditorView(editorViewRefs.current[tabId] ?? null);
    },
    [focusEditorSplitSide, updateActiveEditorView],
  );

  const handleHistoryAvailabilityChange = useCallback(
    (next: EditorHistoryAvailability) => {
      setEditorHistoryAvailability((previous) =>
        previous.canUndo === next.canUndo && previous.canRedo === next.canRedo
          ? previous
          : next,
      );
    },
    [],
  );

  const handleEditorUndo = useCallback(() => {
    const view = activeEditorViewRef.current;
    if (!view) {
      return;
    }
    if (undo(view)) {
      view.focus();
    }
  }, []);

  const handleEditorRedo = useCallback(() => {
    const view = activeEditorViewRef.current;
    if (!view) {
      return;
    }
    if (redo(view)) {
      view.focus();
    }
  }, []);

  const handleFindInFile = useCallback(() => {
    const view = activeEditorViewRef.current;
    if (!view) {
      return;
    }
    openEditorFileSearch(view);
  }, []);

  const storeFileLoadState = useCallback(
    (tabId: string, file: EditorFileLoadState) => {
      clearTabLoadingRevealTimer(tabId);
      fileLoadStatesRef.current[tabId] = file;
      setFileLoadStates((previous) => ({ ...previous, [tabId]: file }));
      if (file.kind === "editable") {
        fileContentsRef.current[tabId] = file.content;
        setFileContents((previous) => ({ ...previous, [tabId]: file.content }));
        return;
      }

      delete fileContentsRef.current[tabId];
      setFileContents((previous) => {
        const { [tabId]: _removed, ...remaining } = previous;
        return remaining;
      });
    },
    [clearTabLoadingRevealTimer],
  );

  const ensureTabFileLoaded = useCallback(
    (tab: Tab | undefined) => {
      if (!tab) return;
      if (
        fileLoadStatesRef.current[tab.id] ||
        fileContentsRef.current[tab.id] !== undefined
      ) {
        return;
      }
      const currentRequest = tabFileLoadRequestsRef.current[tab.id];
      if (currentRequest?.path === tab.path) {
        return;
      }

      clearTabLoadingRevealTimer(tab.id);
      const requestId = (currentRequest?.requestId ?? 0) + 1;
      tabFileLoadRequestsRef.current[tab.id] = {
        path: tab.path,
        requestId,
      };
      tabLoadingRevealTimerRefs.current[tab.id] = setTimeout(() => {
        delete tabLoadingRevealTimerRefs.current[tab.id];
        const pendingRequest = tabFileLoadRequestsRef.current[tab.id];
        if (
          !pendingRequest ||
          pendingRequest.path !== tab.path ||
          pendingRequest.requestId !== requestId
        ) {
          return;
        }

        const currentTab = tabsRef.current.find(
          (candidate) => candidate.id === tab.id,
        );
        if (!currentTab || currentTab.path !== tab.path) {
          return;
        }
        if (
          fileLoadStatesRef.current[tab.id] ||
          fileContentsRef.current[tab.id] !== undefined
        ) {
          return;
        }

        storeFileLoadState(
          tab.id,
          createEditorFileLoadingLoad(tab.path, tab.label),
        );
      }, EDITOR_FILE_LOADING_DELAY_MS);

      loadEditorFile(tab.path)
        .then((file) => {
          const pendingRequest = tabFileLoadRequestsRef.current[tab.id];
          if (
            !pendingRequest ||
            pendingRequest.path !== tab.path ||
            pendingRequest.requestId !== requestId
          ) {
            return;
          }
          clearTabLoadingRevealTimer(tab.id);
          delete tabFileLoadRequestsRef.current[tab.id];
          const currentTab = tabsRef.current.find(
            (candidate) => candidate.id === tab.id,
          );
          if (!currentTab || currentTab.path !== tab.path) {
            return;
          }
          storeFileLoadState(tab.id, file);
        })
        .catch(() => {
          const pendingRequest = tabFileLoadRequestsRef.current[tab.id];
          if (
            !pendingRequest ||
            pendingRequest.path !== tab.path ||
            pendingRequest.requestId !== requestId
          ) {
            return;
          }
          clearTabLoadingRevealTimer(tab.id);
          delete tabFileLoadRequestsRef.current[tab.id];
          delete fileLoadStatesRef.current[tab.id];
          setFileLoadStates((previous) => {
            const { [tab.id]: _removed, ...remaining } = previous;
            return remaining;
          });
        });
    },
    [clearTabLoadingRevealTimer, storeFileLoadState],
  );

  const closeTabSwitcher = useCallback(() => {
    setIsTabSwitcherOpen(false);
    setTabSwitcherSelection(null);
  }, [setTabSwitcherSelection]);

  const commitTabSwitcher = useCallback(() => {
    const nextTabId = tabSwitcherSelectionRef.current;
    if (nextTabId) {
      activateEditorTab(nextTabId);
    }
    closeTabSwitcher();
  }, [activateEditorTab, closeTabSwitcher]);

  const cancelTabSwitcher = useCallback(() => {
    closeTabSwitcher();
  }, [closeTabSwitcher]);

  const cycleTabSwitcher = useCallback(
    (direction: 1 | -1) => {
      if (tabs.length < 2) {
        return;
      }

      const splitSlots = editorSplitSlotsRef.current;
      const focusedTabId = splitSlots
        ? getEditorSplitActiveTabId(
            splitSlots,
            focusedEditorSplitSideRef.current,
          )
        : activeTabRef.current;
      const anchorTabId =
        (isTabSwitcherOpen ? tabSwitcherSelectionRef.current : focusedTabId) ??
        tabs[0]?.id ??
        null;
      const anchorIndex = tabs.findIndex((tab) => tab.id === anchorTabId);
      const nextIndex =
        anchorIndex >= 0
          ? getWrappedTabIndex(anchorIndex, direction, tabs.length)
          : direction > 0
            ? 0
            : tabs.length - 1;
      const nextTab = tabs[nextIndex];

      if (!nextTab) {
        return;
      }

      setIsTabSwitcherOpen(true);
      setTabSwitcherSelection(nextTab.id);
    },
    [isTabSwitcherOpen, setTabSwitcherSelection, tabs],
  );

  useEffect(() => {
    if (tabs.length === 0) return;

    const visibleTabIds = new Set(
      [
        activeTab,
        secondaryActiveTab,
        ...(editorSplitSlots
          ? getEditorSplitActiveSides(editorSplitSlots).map((side) =>
              getEditorSplitActiveTabId(editorSplitSlots, side),
            )
          : []),
        activeTab ?? tabs[0]?.id,
      ].filter(Boolean),
    );
    tabs
      .filter((tab) => visibleTabIds.has(tab.id))
      .forEach((tab) => ensureTabFileLoaded(tab));
  }, [
    activeTab,
    editorSplitSlots,
    ensureTabFileLoaded,
    secondaryActiveTab,
    tabs,
  ]);

  useEffect(() => {
    if (tabs.length === 0) return;
    const visibleTabIds = new Set(
      [
        activeTab,
        secondaryActiveTab,
        ...(editorSplitSlots
          ? getEditorSplitActiveSides(editorSplitSlots).map((side) =>
              getEditorSplitActiveTabId(editorSplitSlots, side),
            )
          : []),
        activeTab ?? tabs[0]?.id,
      ].filter(Boolean),
    );
    tabs.forEach((tab) => {
      if (visibleTabIds.has(tab.id) || tab.isDirty) {
        return;
      }
      pruneEditorStorePathPrefix(tab.path, { preserveDirty: true });
    });
  }, [
    activeTab,
    editorSplitSlots,
    pruneEditorStorePathPrefix,
    secondaryActiveTab,
    tabs,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (tabs.length === 0) {
        localStorage.removeItem(tabStorageKey);
        if (legacyTabStorageKey !== tabStorageKey) {
          localStorage.removeItem(legacyTabStorageKey);
        }
        return;
      }

      const normalizedTabs = normalizeEditorTabs(tabs);
      localStorage.setItem(
        tabStorageKey,
        JSON.stringify({
          tabs: normalizedTabs.map((t) => ({ path: t.path, label: t.label })),
          activeTabId: activeTab,
        }),
      );
      if (legacyTabStorageKey !== tabStorageKey) {
        localStorage.removeItem(legacyTabStorageKey);
      }
    }, 120);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [tabs, activeTab, tabStorageKey, legacyTabStorageKey]);

  useEffect(() => {
    if (!fileToOpen) return;

    // Prevent duplicate opens for the same file
    const fileKey = `${fileToOpen.file.kind}:${fileToOpen.file.path}:${
      fileToOpen.line || 0
    }:${fileToOpen.navigationTarget?.column ?? 0}:${
      fileToOpen.navigationTarget?.navId ?? 0
    }:${fileToOpen.file.policy?.source ?? ""}:${
      fileToOpen.file.policy?.readOnly ? "ro" : "rw"
    }`;
    if (lastFileToOpenRef.current === fileKey) return;
    lastFileToOpenRef.current = fileKey;

    handleFileOpen(fileToOpen);
    onFileOpened?.();
  }, [fileToOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isAnyModalOpen = quickLook.isOpen;

      if (isAnyModalOpen) {
        return;
      }

      if (isTabSwitcherOpen && shortcuts.escape(e)) {
        e.preventDefault();
        cancelTabSwitcher();
        return;
      }

      if (isTabSwitcherOpen && shortcuts.enter(e)) {
        e.preventDefault();
        commitTabSwitcher();
        return;
      }

      if (shortcuts.switchEditorTabNext(e)) {
        e.preventDefault();
        cycleTabSwitcher(1);
        return;
      }

      if (shortcuts.switchEditorTabPrev(e)) {
        e.preventDefault();
        cycleTabSwitcher(-1);
        return;
      }

      // Cmd+Shift+T (Reopen Closed Tab)
      if (shortcuts.reopenTab(e)) {
        e.preventDefault();
        handleReopenClosedTab();
        return;
      }

      // Cmd+S (Save)
      if (shortcuts.save(e)) {
        e.preventDefault();
        handleSaveFile();
        return;
      }

      // Cmd+W (Close Tab)
      if (shortcuts.closeTab(e)) {
        e.preventDefault();
        const splitSlots = editorSplitSlotsRef.current;
        const tabIdToClose = splitSlots
          ? getEditorSplitActiveTabId(
              splitSlots,
              focusedEditorSplitSideRef.current,
            )
          : activeTab;
        if (tabIdToClose) {
          const splitSide = splitSlots
            ? focusedEditorSplitSideRef.current
            : null;
          if (splitSide) {
            handleSplitTabClose(splitSide, tabIdToClose);
          } else {
            handleTabClose(tabIdToClose);
          }
        } else if (tabs.length === 0) {
          onRequestProjectClose?.();
        }
        return;
      }

      // Cmd+\ (Split Horizontal)
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        if (splitDirection) {
          editorSplitSlotsRef.current = null;
          splitDirectionRef.current = null;
          setSplitDirection(null);
          setSecondaryActiveTab(null);
          setEditorSplitSlots(null);
          focusEditorSplitSide("left");
        } else if (activeTab) {
          window.dispatchEvent(
            new CustomEvent("arlecchino:editor-split", {
              detail: { direction: "horizontal" },
            }),
          );
        }
        return;
      }

      // Cmd+Shift+\ (Split Vertical)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "|") {
        e.preventDefault();
        if (splitDirection) {
          editorSplitSlotsRef.current = null;
          splitDirectionRef.current = null;
          setSplitDirection(null);
          setSecondaryActiveTab(null);
          setEditorSplitSlots(null);
          focusEditorSplitSide("left");
        } else if (activeTab) {
          window.dispatchEvent(
            new CustomEvent("arlecchino:editor-split", {
              detail: { direction: "vertical" },
            }),
          );
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTab,
    cancelTabSwitcher,
    closedTabs,
    commitTabSwitcher,
    cycleTabSwitcher,
    focusEditorSplitSide,
    quickLook.isOpen,
    onRequestProjectClose,
    splitDirection,
    tabs,
  ]);

  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isTabSwitcherOpen) {
        return;
      }

      if (
        e.key === "Control" ||
        e.code === "ControlLeft" ||
        e.code === "ControlRight"
      ) {
        commitTabSwitcher();
      }
    };

    const handleWindowBlur = () => {
      if (isTabSwitcherOpen) {
        commitTabSwitcher();
      }
    };

    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [commitTabSwitcher, isTabSwitcherOpen]);

  const getLanguageFromPath = useCallback((path: string): string => {
    const lowerPath = path.toLowerCase();
    const baseName = lowerPath.split("/").pop() || "";
    const originalBaseName = path.split("/").pop() || "";
    if (lowerPath.endsWith(".blade.php")) return "blade";
    if (lowerPath.endsWith(".d.ts")) return "typescript";
    if (baseName.startsWith(".env")) return "env";
    if (baseName === "dockerfile" || baseName === ".dockerfile")
      return "dockerfile";
    if (baseName === "makefile" || baseName === "gnumakefile")
      return "makefile";
    if (baseName === "cmakelists.txt") return "cmake";
    if (
      baseName === "go.mod" ||
      baseName === "go.sum" ||
      baseName === "go.work"
    )
      return "go";
    if (baseName === "nginx.conf") return "nginx";
    if (originalBaseName.endsWith(".C") || originalBaseName.endsWith(".H"))
      return "cpp";

    const ext = path.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "typescriptreact",
      jsx: "javascriptreact",
      html: "html",
      htm: "html",
      css: "css",
      scss: "scss",
      sass: "sass",
      less: "less",
      sql: "sql",
      py: "python",
      pyw: "python",
      pyi: "python",
      pyx: "python",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      fish: "bash",
      java: "java",
      cs: "csharp",
      csx: "csharp",
      cpp: "cpp",
      cc: "cpp",
      cxx: "cpp",
      hpp: "cpp",
      hxx: "cpp",
      hh: "cpp",
      c: "c",
      h: "c",
      ps1: "powershell",
      psm1: "powershell",
      psd1: "powershell",
      php: "php",
      phtml: "php",
      php3: "php",
      php4: "php",
      php5: "php",
      phps: "php",
      go: "go",
      rs: "rust",
      kt: "kotlin",
      kts: "kotlin",
      lua: "lua",
      asm: "assembly",
      s: "assembly",
      rb: "ruby",
      erb: "ruby",
      rake: "ruby",
      gemspec: "ruby",
      ru: "ruby",
      dart: "dart",
      swift: "swift",
      r: "r",
      rmd: "r",
      groovy: "groovy",
      gradle: "groovy",
      vb: "vb",
      vbs: "vb",
      bas: "vba",
      frm: "vba",
      m: "objectivec",
      mat: "matlab",
      pl: "perl",
      pm: "perl",
      pod: "perl",
      t: "perl",
      gd: "gdscript",
      ex: "elixir",
      exs: "elixir",
      scala: "scala",
      sc: "scala",
      pas: "delphi",
      pp: "delphi",
      inc: "delphi",
      dpr: "delphi",
      lisp: "lisp",
      cl: "lisp",
      lsp: "lisp",
      el: "lisp",
      zig: "zig",
      erl: "erlang",
      hrl: "erlang",
      f90: "fortran",
      f: "fortran",
      for: "fortran",
      f95: "fortran",
      f03: "fortran",
      adb: "ada",
      ads: "ada",
      fs: "fsharp",
      fsi: "fsharp",
      fsx: "fsharp",
      ml: "ocaml",
      mli: "ocaml",
      pro: "prolog",
      cob: "cobol",
      cbl: "cobol",
      cpy: "cobol",
      hs: "haskell",
      lhs: "haskell",
      jl: "julia",
      clj: "clojure",
      cljs: "clojure",
      cljc: "clojure",
      edn: "clojure",
      mm: "objectivec",
      gleam: "gleam",
      json: "json",
      jsonc: "json",
      json5: "json",
      yaml: "yaml",
      yml: "yaml",
      xml: "xml",
      xsl: "xml",
      xsd: "xml",
      svg: "xml",
      wsdl: "xml",
      toml: "toml",
      ini: "ini",
      cfg: "ini",
      conf: "ini",
      dockerfile: "dockerfile",
      tf: "terraform",
      tfvars: "terraform",
      hcl: "terraform",
      mk: "makefile",
      cmake: "cmake",
      tex: "latex",
      ltx: "latex",
      sty: "latex",
      cls: "latex",
      sol: "solidity",
      wgsl: "wgsl",
      glsl: "glsl",
      vert: "glsl",
      frag: "glsl",
      geom: "glsl",
      md: "markdown",
      mdx: "markdown",
      markdown: "markdown",
      astro: "astro",
      vue: "vue",
      svelte: "svelte",
      env: "env",
      txt: "plaintext",
      log: "plaintext",
      nginx: "nginx",
      proto: "protobuf",
      graphql: "graphql",
      gql: "graphql",
      diff: "diff",
      patch: "diff",
    };
    return languageMap[ext || ""] || "plaintext";
  }, []);

  const refreshAppliedPatchTab = useCallback(
    async (tab: Tab) => {
      const file = await loadEditorFile(tab.path);
      storeFileLoadState(tab.id, file);
      delete pendingContentStateRef.current[tab.id];
      delete pendingEditorStoreContentRef.current[tab.id];
      tabsRef.current = tabsRef.current.map((item) =>
        item.id === tab.id ? { ...item, isDirty: false } : item,
      );
      setTabs((previous) =>
        previous.map((item) =>
          item.id === tab.id ? { ...item, isDirty: false } : item,
        ),
      );
      if (file.kind === "editable") {
        const language = getLanguageFromPath(tab.path);
        replaceEditorStoreTabContent(tab.id, file.content, language);
        replaceEditorDocumentFromDisk(tab.path, language, file.content);
        if (isMarkdownPath(tab.path)) {
          onMarkdownPreviewSourceChange?.({
            path: tab.path,
            name: tab.label,
            content: file.content,
          });
        }
      }
    },
    [
      getLanguageFromPath,
      onMarkdownPreviewSourceChange,
      replaceEditorStoreTabContent,
      storeFileLoadState,
    ],
  );

  const getAIInlinePatchDirtyCandidates = useCallback(() => {
    const mainEditorCandidates = tabsRef.current.map((tab) => ({
      ...tab,
      pending:
        pendingContentStateRef.current[tab.id] !== undefined ||
        autoSaveTimerRefs.current[tab.id] !== undefined,
    }));
    const mainEditorPaths = new Set(
      mainEditorCandidates.map((candidate) => candidate.path),
    );
    const otherEditorCandidates = Array.from(
      useEditorStore.getState().tabs.values(),
    )
      .filter((tab) => !mainEditorPaths.has(tab.path))
      .map((tab) => ({
        path: tab.path,
        name: tab.name,
        isDirty: tab.isDirty,
      }));
    return [...mainEditorCandidates, ...otherEditorCandidates];
  }, []);

  const handleAcceptAIInlinePatch = useCallback(
    async (preview: AIInlinePatchPreview) => {
      if (aiInlinePatchBusyIds[preview.id]) {
        return;
      }
      const patchScope = {
        projectPath,
        projectSessionId: currentProjectSessionId,
      };
      if (!isAIInlinePatchPreviewInScope(preview, patchScope)) {
        dismissAIInlinePatchPreview(preview.id);
        return;
      }
      if (preview.alreadyApplied) {
        acknowledgeAIInlinePatchPreview(preview.id);
        return;
      }
      const candidates = getAIInlinePatchDirtyCandidates();
      const affectedTabs = getAffectedAIInlinePatchCandidates(
        preview,
        tabsRef.current,
        patchScope,
      );
      const blockingTab = findBlockingAIInlinePatchCandidate(
        preview,
        candidates,
        patchScope,
      );
      if (blockingTab) {
        useAppNotificationStore.getState().addNotification({
          id: `ai-inline-patch-dirty:${preview.id}`,
          kind: "warning",
          title: "Save editor changes first",
          message: `${formatAIInlinePatchCandidateName(blockingTab)} has unsaved changes.`,
          source: "AI",
          sticky: false,
          timeoutMs: 6000,
        });
        return;
      }

      if (!beginAIInlinePatchBusy(preview.id)) {
        return;
      }
      try {
        await AppFunctions.AIApplyPatchArtifact({ artifactId: preview.id });
        clearAIInlinePatchPreview(preview.id);
        await Promise.all(
          affectedTabs.map((tab) => refreshAppliedPatchTab(tab)),
        );
      } catch (error) {
        useAppNotificationStore.getState().addNotification({
          id: `ai-inline-patch-apply:${preview.id}`,
          kind: "error",
          title: "Failed to apply AI patch",
          message: error instanceof Error ? error.message : String(error),
          source: "AI",
          sticky: false,
          timeoutMs: 7000,
        });
      } finally {
        endAIInlinePatchBusy(preview.id);
      }
    },
    [
      acknowledgeAIInlinePatchPreview,
      aiInlinePatchBusyIds,
      beginAIInlinePatchBusy,
      clearAIInlinePatchPreview,
      currentProjectSessionId,
      dismissAIInlinePatchPreview,
      endAIInlinePatchBusy,
      getAIInlinePatchDirtyCandidates,
      projectPath,
      refreshAppliedPatchTab,
    ],
  );

  const handleRejectAIInlinePatch = useCallback(
    async (preview: AIInlinePatchPreview) => {
      if (aiInlinePatchBusyIds[preview.id]) {
        return;
      }
      const patchScope = {
        projectPath,
        projectSessionId: currentProjectSessionId,
      };
      if (!isAIInlinePatchPreviewInScope(preview, patchScope)) {
        dismissAIInlinePatchPreview(preview.id);
        return;
      }
      if (!preview.alreadyApplied) {
        dismissAIInlinePatchPreview(preview.id);
        return;
      }
      const candidates = getAIInlinePatchDirtyCandidates();
      const affectedTabs = getAffectedAIInlinePatchCandidates(
        preview,
        tabsRef.current,
        patchScope,
      );
      const blockingTab = findBlockingAIInlinePatchCandidate(
        preview,
        candidates,
        patchScope,
      );
      if (blockingTab) {
        useAppNotificationStore.getState().addNotification({
          id: `ai-inline-patch-rollback-dirty:${preview.id}`,
          kind: "warning",
          title: "Save editor changes first",
          message: `${formatAIInlinePatchCandidateName(blockingTab)} has unsaved changes.`,
          source: "AI",
          sticky: false,
          timeoutMs: 6000,
        });
        return;
      }
      if (!beginAIInlinePatchBusy(preview.id)) {
        return;
      }
      try {
        await AppFunctions.AIRollbackPatchCheckpoint({
          artifactId: preview.id,
          checkpointId: "",
        });
        clearAIInlinePatchPreview(preview.id);
        await Promise.all(
          affectedTabs.map((tab) => refreshAppliedPatchTab(tab)),
        );
      } catch (error) {
        useAppNotificationStore.getState().addNotification({
          id: `ai-inline-patch-rollback:${preview.id}`,
          kind: "error",
          title: "Failed to rollback AI edit",
          message: error instanceof Error ? error.message : String(error),
          source: "AI",
          sticky: false,
          timeoutMs: 7000,
        });
      } finally {
        endAIInlinePatchBusy(preview.id);
      }
    },
    [
      aiInlinePatchBusyIds,
      beginAIInlinePatchBusy,
      clearAIInlinePatchPreview,
      currentProjectSessionId,
      dismissAIInlinePatchPreview,
      endAIInlinePatchBusy,
      getAIInlinePatchDirtyCandidates,
      projectPath,
      refreshAppliedPatchTab,
    ],
  );

  const buildMarkdownPreviewSource = useCallback(
    (tabId: string | null): MarkdownPreviewSource | null => {
      if (!tabId) {
        return null;
      }

      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (!tab || !isMarkdownPath(tab.path)) {
        return null;
      }

      const loadState = fileLoadStates[tab.id];
      const content =
        fileContents[tab.id] ??
        (loadState?.kind === "editable"
          ? loadState.content
          : loadState?.kind === "guardedPreview"
            ? loadState.preview.content
            : null);

      if (content === null || content === undefined) {
        return null;
      }

      return {
        path: tab.path,
        name: tab.label,
        content,
      };
    },
    [fileContents, fileLoadStates, tabs],
  );

  useEffect(() => {
    onMarkdownPreviewSourceChange?.(buildMarkdownPreviewSource(activeTab));
  }, [activeTab, buildMarkdownPreviewSource, onMarkdownPreviewSourceChange]);

  useEffect(() => {
    const primaryActiveTab = tabs.find((tab) => tab.id === activeTab) ?? null;
    const secondaryTab =
      tabs.find((tab) => tab.id === secondaryActiveTab) ?? null;
    const splitActiveTab = editorSplitSlots
      ? (tabs.find(
          (tab) =>
            tab.id ===
            getEditorSplitActiveTabId(editorSplitSlots, focusedEditorSplitSide),
        ) ?? null)
      : null;
    const statusTab = splitActiveTab ?? primaryActiveTab ?? secondaryTab;

    if (!statusTab) {
      setStatusFile(null, null, null);
      return;
    }

    const language = getLanguageFromPath(statusTab.path);
    const loadState =
      fileLoadStatesRef.current[statusTab.id] ?? fileLoadStates[statusTab.id];
    if (!loadState || loadState.kind !== "editable") {
      setStatusFile(statusTab.path, statusTab.label, language);
      return;
    }

    const content =
      fileContentsRef.current[statusTab.id] ??
      fileContents[statusTab.id] ??
      loadState.content;
    syncEditorStoreActiveTab(
      activeEditorPaneId,
      statusTab.path,
      statusTab.label,
      content,
      language,
      statusTab.isDirty === true,
    );
  }, [
    activeEditorPaneId,
    activeTab,
    editorSplitSlots,
    fileContents,
    fileLoadStates,
    focusedEditorSplitSide,
    getLanguageFromPath,
    secondaryActiveTab,
    setStatusFile,
    syncEditorStoreActiveTab,
    tabs,
  ]);

  const removeStaleLoadingTabs = useCallback(
    (activePath: string) => {
      const staleLoadingTabIds = new Set<string>();
      Object.entries(fileLoadStatesRef.current).forEach(([tabId, file]) => {
        if (file.kind === "loading" && file.path !== activePath) {
          staleLoadingTabIds.add(tabId);
        }
      });

      if (staleLoadingTabIds.size === 0) {
        return;
      }

      const nextLoadStates = { ...fileLoadStatesRef.current };
      staleLoadingTabIds.forEach((tabId) => {
        clearTabLoadingRevealTimer(tabId);
        delete nextLoadStates[tabId];
        delete fileContentsRef.current[tabId];
        delete tabFileLoadRequestsRef.current[tabId];
      });
      fileLoadStatesRef.current = nextLoadStates;
      setFileLoadStates(nextLoadStates);
      setFileContents((previous) => {
        const nextContents = { ...previous };
        staleLoadingTabIds.forEach((tabId) => {
          delete nextContents[tabId];
        });
        return nextContents;
      });

      tabsRef.current = tabsRef.current.filter(
        (tab) => !staleLoadingTabIds.has(tab.id),
      );
      setTabs((previous) =>
        previous.filter((tab) => !staleLoadingTabIds.has(tab.id)),
      );
    },
    [clearTabLoadingRevealTimer],
  );

  const commitEditorSplitSlots = useCallback((nextSlots: EditorSplitSlots) => {
    const normalizedSlots = normalizeEditorSplitSlots(
      nextSlots,
      tabsRef.current,
    );
    editorSplitSlotsRef.current = normalizedSlots;
    setEditorSplitSlots(normalizedSlots);
    if (!normalizedSlots) {
      splitDirectionRef.current = null;
      setSplitDirection(null);
      setSecondaryActiveTab(null);
      return false;
    }

    const nextDirection = getEditorSplitDirection(normalizedSlots);
    splitDirectionRef.current = nextDirection;
    setSplitDirection(nextDirection);
    setActiveTab(getPrimaryEditorSplitActiveTabId(normalizedSlots));
    setSecondaryActiveTab(getSecondaryEditorSplitActiveTabId(normalizedSlots));
    return true;
  }, []);

  const addTabToEditorSplitSide = useCallback(
    (tabId: string, side: EditorSplitPaneSide): boolean => {
      const currentSlots = editorSplitSlotsRef.current;
      if (!currentSlots) {
        return false;
      }

      const nextSideIds = uniqueEditorTabIds([
        ...getEditorSplitTabIds(currentSlots, side),
        tabId,
      ]);
      const nextSlots = updateEditorSplitSide(
        currentSlots,
        side,
        nextSideIds,
        tabId,
      );

      if (!commitEditorSplitSlots(nextSlots)) {
        return false;
      }

      focusEditorSplitSide(side);
      return true;
    },
    [commitEditorSplitSlots, focusEditorSplitSide],
  );

  const handleFileOpen = useCallback(
    ({ file, line, navigationTarget }: EditorFileOpenPayload) => {
      const filePath = file.path;
      const target =
        navigationTarget ??
        createEditorNavigationTarget(line, undefined, { focus: true });
      const flashLine = target?.line ?? line;
      const revealRequestedLocation = () => {
        if (target) {
          setPendingEditorNavigation({ path: filePath, target });
        }
        if (flashLine) {
          setHighlightLine(flashLine);
          window.setTimeout(() => setHighlightLine(undefined), 3000);
        }
      };
      removeStaleLoadingTabs(filePath);
      const tabId = makeEditorTabId(filePath);
      const existingTab = tabsRef.current.find((tab) => tab.path === filePath);
      if (existingTab) {
        if (file.kind !== "loading") {
          storeFileLoadState(existingTab.id, file);
        }
        const splitSide =
          getEditorSplitSideForTabId(
            editorSplitSlotsRef.current,
            existingTab.id,
          ) ?? focusedEditorSplitSideRef.current;
        if (addTabToEditorSplitSide(existingTab.id, splitSide)) {
          revealRequestedLocation();
          return;
        }
        setActiveTab(existingTab.id);
        revealRequestedLocation();
        return;
      }

      const newTab: Tab = {
        id: tabId,
        label: file.name,
        path: filePath,
        isDirty: false,
      };

      storeFileLoadState(tabId, file);
      const nextTabs = normalizeEditorTabs([...tabsRef.current, newTab]);
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      if (
        addTabToEditorSplitSide(newTab.id, focusedEditorSplitSideRef.current)
      ) {
        revealRequestedLocation();
        return;
      }
      setActiveTab(tabId);
      revealRequestedLocation();
    },
    [addTabToEditorSplitSide, removeStaleLoadingTabs, storeFileLoadState],
  );

  const scheduleFileOpenLoading = useCallback(
    (
      requestId: number,
      path: string,
      line?: number,
      navigationTarget?: EditorNavigationTarget,
      policy?: EditorFileLoadState["policy"],
    ) => {
      if (fileOpenLoadingTimerRef.current !== null) {
        clearTimeout(fileOpenLoadingTimerRef.current);
        fileOpenLoadingTimerRef.current = null;
      }
      if (openFileRequestRef.current !== requestId) {
        return;
      }

      fileOpenLoadingTimerRef.current = setTimeout(() => {
        fileOpenLoadingTimerRef.current = null;
        if (openFileRequestRef.current !== requestId) {
          return;
        }

        handleFileOpen({
          file: createEditorFileLoadingLoad(path, undefined, policy),
          line,
          navigationTarget,
        });
      }, EDITOR_FILE_LOADING_DELAY_MS);
    },
    [handleFileOpen],
  );

  const clearFileOpenLoadingTimer = useCallback(() => {
    if (fileOpenLoadingTimerRef.current === null) {
      return;
    }

    clearTimeout(fileOpenLoadingTimerRef.current);
    fileOpenLoadingTimerRef.current = null;
  }, []);

  useEffect(() => clearFileOpenLoadingTimer, [clearFileOpenLoadingTimer]);

  useEffect(() => {
    onEditorFileOpenReady?.(handleFileOpen);
    return () => {
      onEditorFileOpenReady?.(null);
    };
  }, [handleFileOpen, onEditorFileOpenReady]);

  useEffect(() => {
    setHighlightLine(undefined);
  }, [activeTab]);

  useEffect(() => {
    if (!activeTab) {
      resetActiveEditorBudget();
      return;
    }
    const loadState = fileLoadStates[activeTab];
    if (loadState && loadState.kind !== "editable") {
      resetActiveEditorBudget();
    }
  }, [activeTab, fileLoadStates, resetActiveEditorBudget]);

  const handleTabClose = (tabId: string) => {
    const closedTab = tabs.find((tab) => tab.id === tabId);
    if (closedTab) {
      // Save to closed tabs history (keep last 10)
      setClosedTabs((prev) => [closedTab, ...prev].slice(0, 10));
      flushEditorStoreContentForTab(tabId);
      closeEditorStoreTabPath(closedTab.path);
    }

    const updatedTabs = tabs.filter((tab) => tab.id !== tabId);
    tabsRef.current = updatedTabs;
    setTabs(updatedTabs);

    const { [tabId]: _, ...remainingContents } = fileContents;
    setFileContents(remainingContents);
    setFileLoadStates((previous) => {
      const { [tabId]: _removed, ...remaining } = previous;
      return remaining;
    });
    clearTabLoadingRevealTimer(tabId);
    delete fileContentsRef.current[tabId];
    delete fileLoadStatesRef.current[tabId];
    delete tabFileLoadRequestsRef.current[tabId];

    if (activeTab === tabId) {
      setActiveTab(
        updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null,
      );
      if (updatedTabs.length === 0) {
        resetActiveEditorBudget();
      }
    }

    const currentSplitSlots = editorSplitSlotsRef.current;
    if (currentSplitSlots) {
      const nextSplitSlots = normalizeEditorSplitSlots(
        {
          leftTabIds: currentSplitSlots.leftTabIds.filter((id) => id !== tabId),
          rightTabIds: currentSplitSlots.rightTabIds.filter(
            (id) => id !== tabId,
          ),
          bottomTabIds: currentSplitSlots.bottomTabIds.filter(
            (id) => id !== tabId,
          ),
          leftActiveTabId: currentSplitSlots.leftActiveTabId,
          rightActiveTabId: currentSplitSlots.rightActiveTabId,
          bottomActiveTabId: currentSplitSlots.bottomActiveTabId,
        },
        updatedTabs,
      );
      editorSplitSlotsRef.current = nextSplitSlots;
      setEditorSplitSlots(nextSplitSlots);
      if (nextSplitSlots) {
        const nextDirection = getEditorSplitDirection(nextSplitSlots);
        splitDirectionRef.current = nextDirection;
        setSplitDirection(nextDirection);
        setActiveTab(getPrimaryEditorSplitActiveTabId(nextSplitSlots));
        setSecondaryActiveTab(
          getSecondaryEditorSplitActiveTabId(nextSplitSlots),
        );
      } else {
        splitDirectionRef.current = null;
        setSplitDirection(null);
        setSecondaryActiveTab(null);
      }
    }
  };

  const handleSplitTabClose = (side: EditorSplitPaneSide, tabId: string) => {
    const currentSplitSlots = editorSplitSlotsRef.current;
    if (!currentSplitSlots) {
      handleTabClose(tabId);
      return;
    }

    const nextSideIds = getEditorSplitTabIds(currentSplitSlots, side).filter(
      (id) => id !== tabId,
    );
    const tabStillOpenOnOtherSide = editorSplitPaneSides.some(
      (candidateSide) =>
        candidateSide !== side &&
        getEditorSplitTabIds(currentSplitSlots, candidateSide).includes(tabId),
    );

    if (tabStillOpenOnOtherSide) {
      const nextSplitSlots = updateEditorSplitSide(
        currentSplitSlots,
        side,
        nextSideIds,
        getEditorSplitActiveTabId(currentSplitSlots, side) === tabId
          ? nextSideIds[0]
          : getEditorSplitActiveTabId(currentSplitSlots, side),
      );
      if (!commitEditorSplitSlots(nextSplitSlots)) {
        collapseEditorSplitToTab(tabId);
        return;
      }
      const nextFocusSide =
        nextSideIds.length > 0
          ? side
          : getPrimaryEditorSplitSide(nextSplitSlots);
      if (nextFocusSide) {
        focusEditorSplitSide(nextFocusSide);
      }
      return;
    }

    handleTabClose(tabId);
  };

  const handleCloseOtherTabs = useCallback(
    (tabId: string) => {
      const retainedTab = tabsRef.current.find((tab) => tab.id === tabId);
      if (!retainedTab) {
        return;
      }

      tabsRef.current = [retainedTab];
      setTabs([retainedTab]);
      Object.keys(tabFileLoadRequestsRef.current).forEach((pendingTabId) => {
        if (pendingTabId === tabId) {
          return;
        }
        clearTabLoadingRevealTimer(pendingTabId);
        delete tabFileLoadRequestsRef.current[pendingTabId];
      });
      setFileContents((previous) =>
        previous[tabId] !== undefined ? { [tabId]: previous[tabId] } : {},
      );
      setFileLoadStates((previous) =>
        previous[tabId] !== undefined ? { [tabId]: previous[tabId] } : {},
      );
      activeTabRef.current = tabId;
      setActiveTab(tabId);
      setSecondaryActiveTab(null);
      splitDirectionRef.current = null;
      setSplitDirection(null);
      editorSplitSlotsRef.current = null;
      setEditorSplitSlots(null);
      focusEditorSplitSide("left");
    },
    [clearTabLoadingRevealTimer, focusEditorSplitSide],
  );

  const handleCloseAllTabs = useCallback(() => {
    openFileRequestRef.current += 1;
    clearFileOpenLoadingTimer();
    tabsRef.current.forEach((tab) => {
      flushEditorStoreContentForTab(tab.id);
      closeEditorStoreTabPath(tab.path);
    });
    setTabs([]);
    setFileContents({});
    setFileLoadStates({});
    fileContentsRef.current = {};
    fileLoadStatesRef.current = {};
    tabFileLoadRequestsRef.current = {};
    clearAllTabLoadingRevealTimers();
    activeTabRef.current = null;
    setActiveTab(null);
    setSecondaryActiveTab(null);
    splitDirectionRef.current = null;
    setSplitDirection(null);
    editorSplitSlotsRef.current = null;
    setEditorSplitSlots(null);
    focusEditorSplitSide("left");
    resetActiveEditorBudget();
  }, [
    clearAllTabLoadingRevealTimers,
    clearFileOpenLoadingTimer,
    closeEditorStoreTabPath,
    flushEditorStoreContentForTab,
    focusEditorSplitSide,
    resetActiveEditorBudget,
  ]);

  const handleReopenClosedTab = async () => {
    if (closedTabs.length === 0) return;

    const [lastClosedTab, ...remainingClosedTabs] = closedTabs;
    setClosedTabs(remainingClosedTabs);
    const requestId = reopenClosedTabRequestRef.current + 1;
    reopenClosedTabRequestRef.current = requestId;

    try {
      const file = await loadEditorFile(lastClosedTab.path);
      if (reopenClosedTabRequestRef.current !== requestId) {
        return;
      }
      handleFileOpen({ file });
    } catch (error) {
      if (reopenClosedTabRequestRef.current === requestId) {
        console.error("Failed to reopen closed tab:", error);
      }
    }
  };

  // Update refs when state changes
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    splitDirectionRef.current = splitDirection;
  }, [splitDirection]);

  useEffect(() => {
    secondaryActiveTabRef.current = secondaryActiveTab;
  }, [secondaryActiveTab]);

  useEffect(() => {
    editorSplitSlotsRef.current = editorSplitSlots;
  }, [editorSplitSlots]);

  useEffect(() => {
    focusedEditorSplitSideRef.current = focusedEditorSplitSide;
  }, [focusedEditorSplitSide]);

  useEffect(() => {
    if (!isTabSwitcherOpen) {
      return;
    }

    if (tabs.length < 2) {
      cancelTabSwitcher();
      return;
    }

    if (tabSwitcherSelectionRef.current) {
      const selectedTabStillExists = tabs.some(
        (tab) => tab.id === tabSwitcherSelectionRef.current,
      );
      if (selectedTabStillExists) {
        return;
      }
    }

    const fallbackTabId = activeTab ?? tabs[0]?.id ?? null;
    setTabSwitcherSelection(fallbackTabId);
  }, [
    activeTab,
    cancelTabSwitcher,
    isTabSwitcherOpen,
    setTabSwitcherSelection,
    tabs,
  ]);

  useEffect(() => {
    fileContentsRef.current = fileContents;
  }, [fileContents]);

  useEffect(() => {
    fileLoadStatesRef.current = fileLoadStates;
  }, [fileLoadStates]);

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe((state, previousState) => {
      if (state.tabs === previousState.tabs) {
        return;
      }
      const localTabs = tabsRef.current;
      if (localTabs.length === 0) {
        return;
      }

      const contentUpdates: Record<string, string> = {};
      const loadStateUpdates: Record<string, EditorFileLoadState> = {};
      let hasContentUpdates = false;
      let hasLoadStateUpdates = false;
      let tabsChanged = false;

      const nextTabs = localTabs.map((tab) => {
        const sharedTab = state.tabs.get(tab.id);
        const previousSharedTab = previousState.tabs.get(tab.id);
        if (!sharedTab || sharedTab.path !== tab.path) {
          return tab;
        }
        if (
          previousSharedTab &&
          previousSharedTab.content === sharedTab.content &&
          previousSharedTab.isDirty === sharedTab.isDirty &&
          previousSharedTab.language === sharedTab.language
        ) {
          return tab;
        }

        const pendingLocalContent =
          pendingEditorStoreContentRef.current[tab.id];
        const keepsPendingLocalContent =
          pendingLocalContent !== undefined &&
          pendingLocalContent !== sharedTab.content;
        const loadState = fileLoadStatesRef.current[tab.id];
        if (
          (keepsPendingLocalContent ||
            fileContentsRef.current[tab.id] === sharedTab.content) &&
          (loadState?.kind !== "editable" ||
            keepsPendingLocalContent ||
            loadState.content === sharedTab.content) &&
          tab.isDirty === sharedTab.isDirty
        ) {
          return tab;
        }

        if (
          !keepsPendingLocalContent &&
          fileContentsRef.current[tab.id] !== sharedTab.content
        ) {
          fileContentsRef.current[tab.id] = sharedTab.content;
          contentUpdates[tab.id] = sharedTab.content;
          hasContentUpdates = true;
        }

        if (
          !keepsPendingLocalContent &&
          loadState?.kind === "editable" &&
          loadState.content !== sharedTab.content
        ) {
          const nextLoadState: EditorFileLoadState = {
            ...loadState,
            content: sharedTab.content,
          };
          fileLoadStatesRef.current[tab.id] = nextLoadState;
          loadStateUpdates[tab.id] = nextLoadState;
          hasLoadStateUpdates = true;
        }

        if (tab.isDirty === sharedTab.isDirty) {
          return tab;
        }
        tabsChanged = true;
        return { ...tab, isDirty: sharedTab.isDirty };
      });

      if (hasContentUpdates) {
        setFileContents((previous) => ({ ...previous, ...contentUpdates }));
      }
      if (hasLoadStateUpdates) {
        setFileLoadStates((previous) => ({
          ...previous,
          ...loadStateUpdates,
        }));
      }
      if (tabsChanged) {
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
      }
    });

    return unsubscribe;
  }, []);

  const isTabReadOnlyByPolicy = useCallback((tabId: string): boolean => {
    return isEditorFilePolicyReadOnly(fileLoadStatesRef.current[tabId]);
  }, []);

  const notifyReadOnlyPolicyBlocked = useCallback((path: string) => {
    useAppNotificationStore.getState().addNotification({
      id: `readonly-policy:${path}`,
      kind: "warning",
      title: "File opened read-only",
      message:
        "This file came from an external macOS intent. Confirm write access before editing or saving.",
      source: "Editor",
      sticky: false,
      timeoutMs: 7000,
    });
  }, []);

  const confirmTabWriteAccess = useCallback(
    (tab: Tab): boolean => {
      const file = fileLoadStatesRef.current[tab.id];
      if (!isEditorFilePolicyReadOnly(file)) {
        return true;
      }

      if (
        file?.policy?.requiresConfirmation &&
        window.confirm(
          `Allow editing and saving this external file?\n\n${tab.path}`,
        )
      ) {
        grantEditorFileWriteAccess(tab.path);
        setFileLoadStates((previous) => ({ ...previous }));
        return true;
      }

      notifyReadOnlyPolicyBlocked(tab.path);
      return false;
    },
    [notifyReadOnlyPolicyBlocked],
  );

  const autoSaveFile = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab || !tab.isDirty) {
        console.log("Auto-save skipped:", tabId, "isDirty:", tab?.isDirty);
        return;
      }

      if (isTabReadOnlyByPolicy(tabId)) {
        console.log(
          "Auto-save skipped for read-only external intent:",
          tab.path,
        );
        return;
      }

      flushEditorStoreContentForTab(tabId);

      const content = fileContentsRef.current[tabId];
      if (content === undefined) {
        console.log("Auto-save skipped: no content for", tabId);
        return;
      }

      try {
        await AppFunctions.WriteFile(tab.path, content);
        tabsRef.current = tabsRef.current.map((item) =>
          item.id === tabId ? { ...item, isDirty: false } : item,
        );
        setTabs((prevTabs) =>
          prevTabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
        );
      } catch (error) {
        console.error("Auto-save error:", error);
        useAppNotificationStore.getState().addNotification({
          id: `autosave-error:${tab.path}`,
          kind: "error",
          title: "Auto-save failed",
          message: error instanceof Error ? error.message : String(error),
          source: "Editor",
          sticky: false,
          timeoutMs: 7000,
        });
      }
    },
    [flushEditorStoreContentForTab, isTabReadOnlyByPolicy],
  );

  const scheduleAutoSave = useCallback(
    (tabId: string) => {
      const existingTimer = autoSaveTimerRefs.current[tabId];
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      autoSaveTimerRefs.current[tabId] = setTimeout(() => {
        delete autoSaveTimerRefs.current[tabId];
        autoSaveFile(tabId);
      }, AUTO_SAVE_DELAY);
    },
    [autoSaveFile],
  );

  const flushPendingContentState = useCallback(() => {
    const pending = pendingContentStateRef.current;
    pendingContentStateRef.current = {};
    contentStateFlushTimerRef.current = null;
    if (Object.keys(pending).length === 0) {
      return;
    }
    setFileContents((previous) => ({ ...previous, ...pending }));
    setFileLoadStates((previous) => {
      let changed = false;
      const next = { ...previous };
      Object.entries(pending).forEach(([tabId, content]) => {
        const file = fileLoadStatesRef.current[tabId] ?? previous[tabId];
        if (file?.kind !== "editable") {
          return;
        }
        if (isEditorFilePolicyReadOnly(file)) {
          return;
        }
        const updated: EditorFileLoadState = { ...file, content };
        next[tabId] = updated;
        fileLoadStatesRef.current[tabId] = updated;
        changed = true;
      });
      return changed ? next : previous;
    });
  }, []);

  const flushDirtyTabsForProjectMove = useCallback(async () => {
    flushPendingContentState();
    flushPendingEditorStoreContent();
    Object.values(autoSaveTimerRefs.current).forEach((timer) =>
      clearTimeout(timer),
    );
    autoSaveTimerRefs.current = {};

    const dirtyTabs = tabsRef.current.filter(
      (tab) => tab.isDirty && !isTabReadOnlyByPolicy(tab.id),
    );
    if (dirtyTabs.length === 0) {
      return;
    }

    for (const tab of dirtyTabs) {
      const content = fileContentsRef.current[tab.id];
      if (content === undefined) {
        continue;
      }
      await AppFunctions.WriteFile(tab.path, content);
    }

    const dirtyIds = new Set(dirtyTabs.map((tab) => tab.id));
    tabsRef.current = tabsRef.current.map((tab) =>
      dirtyIds.has(tab.id) ? { ...tab, isDirty: false } : tab,
    );
    setTabs((previous) =>
      previous.map((tab) =>
        dirtyIds.has(tab.id) ? { ...tab, isDirty: false } : tab,
      ),
    );
  }, [
    flushPendingContentState,
    flushPendingEditorStoreContent,
    isTabReadOnlyByPolicy,
  ]);

  useEffect(() => {
    onDirtyEditorFlushReady?.(flushDirtyTabsForProjectMove);
    return () => {
      onDirtyEditorFlushReady?.(null);
    };
  }, [flushDirtyTabsForProjectMove, onDirtyEditorFlushReady]);

  const scheduleContentStateFlush = useCallback(
    (tabId: string, value: string) => {
      pendingContentStateRef.current[tabId] = value;
      if (contentStateFlushTimerRef.current !== null) {
        return;
      }
      contentStateFlushTimerRef.current = setTimeout(
        flushPendingContentState,
        250,
      );
    },
    [flushPendingContentState],
  );

  const markTabDirty = useCallback((tabId: string) => {
    tabsRef.current = tabsRef.current.map((tab) =>
      tab.id === tabId && !tab.isDirty ? { ...tab, isDirty: true } : tab,
    );
    setTabs((previous) => {
      let changed = false;
      const next = previous.map((tab) => {
        if (tab.id !== tabId || tab.isDirty) {
          return tab;
        }
        changed = true;
        return { ...tab, isDirty: true };
      });
      return changed ? next : previous;
    });
  }, []);

  const handleContentChangeForTab = (
    tabId: string,
    value: string | undefined,
  ) => {
    if (!tabId || value === undefined) return;
    if (isTabReadOnlyByPolicy(tabId)) {
      return;
    }

    fileContentsRef.current[tabId] = value;
    const currentLoadState = fileLoadStatesRef.current[tabId];
    if (currentLoadState?.kind === "editable") {
      const nextLoadState: EditorFileLoadState = {
        ...currentLoadState,
        content: value,
      };
      fileLoadStatesRef.current[tabId] = nextLoadState;
    }
    const tab = tabsRef.current.find((item) => item.id === tabId);
    if (tab && isMarkdownPath(tab.path)) {
      onMarkdownPreviewSourceChange?.({
        path: tab.path,
        name: tab.label,
        content: value,
      });
    }
    scheduleContentStateFlush(tabId, value);
    scheduleEditorStoreContentUpdate(tabId, value);
    markTabDirty(tabId);
    scheduleAutoSave(tabId);
  };

  const handleContentChange = (value: string | undefined) => {
    if (!activeTab) return;
    handleContentChangeForTab(activeTab, value);
  };

  const recordTypingActivity = useCallback((chars: number) => {
    if (chars <= 0) {
      return;
    }
    pendingTypingActivityRef.current += chars;
    if (typingActivityTimerRef.current !== null) {
      return;
    }
    typingActivityTimerRef.current = setTimeout(() => {
      const pending = pendingTypingActivityRef.current;
      pendingTypingActivityRef.current = 0;
      typingActivityTimerRef.current = null;
      if (pending > 0) {
        AppFunctions.RecordTypingActivity(pending).catch(() => {});
      }
    }, 500);
  }, []);

  const handleSaveFileForTab = useCallback(
    async (tabId: string) => {
      if (!tabId || isSaving) return;

      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;

      const pendingAutoSave = autoSaveTimerRefs.current[tabId];
      if (pendingAutoSave) {
        clearTimeout(pendingAutoSave);
        delete autoSaveTimerRefs.current[tabId];
      }

      if (!confirmTabWriteAccess(tab)) {
        return;
      }

      flushEditorStoreContentForTab(tabId);

      setIsSaving(true);

      try {
        let contentToSave = fileContentsRef.current[tabId];
        if (contentToSave === undefined) {
          return;
        }

        // Try to format code before saving
        try {
          const formatted = await formatCodeWithPrettier(
            contentToSave,
            tab.path,
            getLanguageFromPath(tab.path),
          );
          if (formatted && formatted !== contentToSave) {
            console.log("File formatted successfully");
            contentToSave = formatted;
            fileContentsRef.current[tabId] = formatted;
            // Update editor content with formatted version
            setFileContents((prev) => ({
              ...prev,
              [tabId]: formatted,
            }));
            const currentLoadState = fileLoadStatesRef.current[tabId];
            if (currentLoadState?.kind === "editable") {
              fileLoadStatesRef.current[tabId] = {
                ...currentLoadState,
                content: formatted,
              };
            }
            const language = getLanguageFromPath(tab.path);
            replaceEditorStoreTabContent(tab.id, formatted, language);
            replaceEditorDocumentFromDisk(tab.path, language, formatted);
          }
        } catch (formatError) {
          // If formatting fails, continue with original content
          console.warn("Prettier formatting failed:", formatError);
        }

        await AppFunctions.WriteFile(tab.path, contentToSave);
        tabsRef.current = tabsRef.current.map((item) =>
          item.id === tabId ? { ...item, isDirty: false } : item,
        );
        setTabs((prevTabs) =>
          prevTabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
        );
        console.log("File write completed:", tab.path);

        window.dispatchEvent(
          new CustomEvent("file-saved", { detail: { path: tab.path } }),
        );
      } catch (error) {
        console.error("Error saving file:", error);
        useAppNotificationStore.getState().addNotification({
          id: `save-error:${tab.path}`,
          kind: "error",
          title: "Failed to save file",
          message: error instanceof Error ? error.message : String(error),
          source: "Editor",
          sticky: false,
          timeoutMs: 7000,
        });
      } finally {
        setIsSaving(false);
      }
    },
    [
      confirmTabWriteAccess,
      flushEditorStoreContentForTab,
      getLanguageFromPath,
      isSaving,
      replaceEditorStoreTabContent,
    ],
  );

  const handleSaveFile = useCallback(async () => {
    const tabId = editorSplitSlots
      ? getEditorSplitActiveTabId(editorSplitSlots, focusedEditorSplitSide)
      : activeTab;
    if (!tabId) return;
    await handleSaveFileForTab(tabId);
  }, [
    activeTab,
    editorSplitSlots,
    focusedEditorSplitSide,
    handleSaveFileForTab,
  ]);

  const handleOpenFileRequest = async (path: string, line?: number) => {
    const requestId = openFileRequestRef.current + 1;
    openFileRequestRef.current = requestId;

    try {
      let fullPath = path;
      if (!path.startsWith("/") && projectPath) {
        fullPath = `${projectPath}/${path}`;
      }

      const navigationTarget = createEditorNavigationTarget(line, undefined, {
        focus: true,
      });
      scheduleFileOpenLoading(requestId, fullPath, line, navigationTarget);
      const file = await loadEditorFile(fullPath);
      if (openFileRequestRef.current !== requestId) {
        return;
      }
      clearFileOpenLoadingTimer();
      handleFileOpen({ file, line, navigationTarget });
    } catch (error) {
      if (openFileRequestRef.current === requestId) {
        clearFileOpenLoadingTimer();
        console.error("Failed to open file:", error);
        alert(`Failed to open file: ${path}`);
      }
    }
  };

  const applyRenamedProjectEntry = useCallback(
    (oldPath: string, newPath: string) => {
      const currentTabs = tabsRef.current;
      const nextTabs = currentTabs.map((tab) => {
        const remappedPath = remapProjectPathPrefix(tab.path, oldPath, newPath);
        if (!remappedPath || remappedPath === tab.path) {
          return tab;
        }

        return {
          ...tab,
          id: makeEditorTabId(remappedPath),
          label: getProjectPathBasename(remappedPath),
          path: remappedPath,
        };
      });

      const changed = nextTabs.some((tab, index) => tab !== currentTabs[index]);
      if (!changed) {
        return;
      }

      const tabIdMap = new Map(
        currentTabs.map((tab, index) => [
          tab.id,
          nextTabs[index]?.id ?? tab.id,
        ]),
      );

      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setFileContents((previous) => {
        const next: Record<string, string> = {};
        Object.entries(previous).forEach(([tabId, content]) => {
          next[tabIdMap.get(tabId) ?? tabId] = content;
        });
        return next;
      });
      setFileLoadStates((previous) => {
        const next: Record<string, EditorFileLoadState> = {};
        Object.entries(previous).forEach(([tabId, file]) => {
          const nextTabId = tabIdMap.get(tabId) ?? tabId;
          const nextTab = nextTabs.find((tab) => tab.id === nextTabId);
          next[nextTabId] = nextTab
            ? { ...file, path: nextTab.path, name: nextTab.label }
            : file;
        });
        return next;
      });
      setActiveTab((previous) =>
        previous ? (tabIdMap.get(previous) ?? previous) : previous,
      );
      setSecondaryActiveTab((previous) =>
        previous ? (tabIdMap.get(previous) ?? previous) : previous,
      );
      setEditorSplitSlots((previous) => {
        const nextSplitSlots = normalizeEditorSplitSlots(
          previous
            ? {
                leftTabIds: previous.leftTabIds.map(
                  (tabId) => tabIdMap.get(tabId) ?? tabId,
                ),
                rightTabIds: previous.rightTabIds.map(
                  (tabId) => tabIdMap.get(tabId) ?? tabId,
                ),
                bottomTabIds: previous.bottomTabIds.map(
                  (tabId) => tabIdMap.get(tabId) ?? tabId,
                ),
                leftActiveTabId:
                  tabIdMap.get(previous.leftActiveTabId) ??
                  previous.leftActiveTabId,
                rightActiveTabId:
                  tabIdMap.get(previous.rightActiveTabId) ??
                  previous.rightActiveTabId,
                bottomActiveTabId:
                  tabIdMap.get(previous.bottomActiveTabId) ??
                  previous.bottomActiveTabId,
              }
            : previous,
          nextTabs,
        );
        editorSplitSlotsRef.current = nextSplitSlots;
        return nextSplitSlots;
      });
      setClosedTabs((previous) =>
        previous.map((tab) => {
          const remappedPath = remapProjectPathPrefix(
            tab.path,
            oldPath,
            newPath,
          );
          if (!remappedPath || remappedPath === tab.path) {
            return tab;
          }

          return {
            ...tab,
            id: makeEditorTabId(remappedPath),
            label: getProjectPathBasename(remappedPath),
            path: remappedPath,
          };
        }),
      );
      setQuickLook((previous) => {
        if (!previous.isOpen) {
          return previous;
        }

        const remappedPath = remapProjectPathPrefix(
          previous.filePath,
          oldPath,
          newPath,
        );
        if (!remappedPath || remappedPath === previous.filePath) {
          return previous;
        }

        return {
          ...previous,
          filePath: remappedPath,
        };
      });
    },
    [],
  );

  const applyDeletedProjectEntry = useCallback((deletedPath: string) => {
    const currentTabs = tabsRef.current;
    const affectedTabs = currentTabs.filter((tab) =>
      isSameOrChildPath(tab.path, deletedPath),
    );
    const dirtyTabs = affectedTabs.filter((tab) => tab.isDirty);
    dirtyTabs.forEach((tab) => {
      useAppNotificationStore.getState().addNotification({
        id: `deleted-dirty-tab:${tab.id}`,
        kind: "warning",
        title: "File deleted on disk",
        message: `${tab.label} has unsaved editor changes.`,
        source: "Explorer",
        sticky: false,
        timeoutMs: 6000,
      });
    });
    const removedTabIds = new Set(
      affectedTabs.filter((tab) => !tab.isDirty).map((tab) => tab.id),
    );

    if (removedTabIds.size === 0) {
      setClosedTabs((previous) =>
        previous.filter((tab) => !isSameOrChildPath(tab.path, deletedPath)),
      );
      setQuickLook((previous) =>
        previous.isOpen && isSameOrChildPath(previous.filePath, deletedPath)
          ? (unblockProjectSwitch(PROJECT_SWITCH_BLOCKERS.quickLook),
            {
              ...previous,
              isOpen: false,
            })
          : previous,
      );
      return;
    }

    const nextTabs = currentTabs.filter((tab) => !removedTabIds.has(tab.id));
    const fallbackActiveTabId = nextTabs[nextTabs.length - 1]?.id ?? null;
    const nextPrimaryTabId =
      activeTabRef.current && !removedTabIds.has(activeTabRef.current)
        ? activeTabRef.current
        : fallbackActiveTabId;

    tabsRef.current = nextTabs;
    setTabs(nextTabs);
    setFileContents((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([tabId]) => !removedTabIds.has(tabId)),
      ),
    );
    setFileLoadStates((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([tabId]) => !removedTabIds.has(tabId)),
      ),
    );
    setClosedTabs((previous) =>
      previous.filter((tab) => !isSameOrChildPath(tab.path, deletedPath)),
    );
    const nextSplitSlots = normalizeEditorSplitSlots(
      editorSplitSlotsRef.current
        ? {
            leftTabIds: editorSplitSlotsRef.current.leftTabIds.filter(
              (tabId) => !removedTabIds.has(tabId),
            ),
            rightTabIds: editorSplitSlotsRef.current.rightTabIds.filter(
              (tabId) => !removedTabIds.has(tabId),
            ),
            bottomTabIds: editorSplitSlotsRef.current.bottomTabIds.filter(
              (tabId) => !removedTabIds.has(tabId),
            ),
            leftActiveTabId: editorSplitSlotsRef.current.leftActiveTabId,
            rightActiveTabId: editorSplitSlotsRef.current.rightActiveTabId,
            bottomActiveTabId: editorSplitSlotsRef.current.bottomActiveTabId,
          }
        : null,
      nextTabs,
    );
    editorSplitSlotsRef.current = nextSplitSlots;
    setEditorSplitSlots(nextSplitSlots);

    if (nextSplitSlots) {
      setActiveTab(getPrimaryEditorSplitActiveTabId(nextSplitSlots));
      setSecondaryActiveTab(getSecondaryEditorSplitActiveTabId(nextSplitSlots));
    } else {
      setActiveTab(nextPrimaryTabId);
    }

    if (nextSplitSlots) {
      const nextDirection = getEditorSplitDirection(nextSplitSlots);
      splitDirectionRef.current = nextDirection;
      setSplitDirection(nextDirection);
    } else if (nextTabs.length <= 1) {
      setSecondaryActiveTab(null);
      splitDirectionRef.current = null;
      setSplitDirection(null);
    } else {
      setSecondaryActiveTab((previous) => {
        if (previous && !removedTabIds.has(previous)) {
          return previous;
        }

        const fallbackSecondary = nextTabs.find(
          (tab) => tab.id !== nextPrimaryTabId,
        );
        return fallbackSecondary?.id ?? null;
      });
    }

    setQuickLook((previous) =>
      previous.isOpen && isSameOrChildPath(previous.filePath, deletedPath)
        ? (unblockProjectSwitch(PROJECT_SWITCH_BLOCKERS.quickLook),
          {
            ...previous,
            isOpen: false,
          })
        : previous,
    );
  }, []);

  useEffect(() => {
    const normalizedProjectPath = normalizeProjectPath(projectPath);
    if (!normalizedProjectPath) {
      return;
    }

    const unsubscribeRenamed = EventsOn(
      "project:entry:renamed",
      (event: ProjectEntryRenamedEvent) => {
        const oldPath = normalizeProjectPath(event?.oldPath ?? "");
        const newPath = normalizeProjectPath(event?.newPath ?? "");
        if (
          !oldPath ||
          !newPath ||
          (!isSameOrChildPath(oldPath, normalizedProjectPath) &&
            !isSameOrChildPath(newPath, normalizedProjectPath))
        ) {
          return;
        }

        applyRenamedProjectEntry(oldPath, newPath);
      },
    );

    const unsubscribeDeleted = EventsOn(
      "project:entry:deleted",
      (event: ProjectEntryDeletedEvent) => {
        const deletedPath = normalizeProjectPath(event?.path ?? "");
        if (
          !deletedPath ||
          !isSameOrChildPath(deletedPath, normalizedProjectPath)
        ) {
          return;
        }

        applyDeletedProjectEntry(deletedPath);
      },
    );

    const handlePatchMutation = (event: AIPatchArtifactMutationEvent) => {
      if (event?.projectSessionId !== currentProjectSessionId) {
        return;
      }
      const files = Array.isArray(event?.files) ? event.files : [];
      if (files.length === 0) {
        return;
      }
      const affectedTabs = tabsRef.current.filter((tab) =>
        files.some((file) => {
          const path = file.absolutePath || file.path || "";
          return path && aiInlinePatchPathMatches(tab.path, path, projectPath);
        }),
      );
      affectedTabs.forEach((tab) => {
        if (tab.isDirty) {
          useAppNotificationStore.getState().addNotification({
            id: `ai-patch-disk-change:${tab.id}`,
            kind: "warning",
            title: "File changed on disk",
            message: `${tab.label} has unsaved editor changes.`,
            source: "AI",
            sticky: false,
            timeoutMs: 6000,
          });
          return;
        }
        void refreshAppliedPatchTab(tab);
      });
    };
    const unsubscribePatchApplied = EventsOn(
      "ai:patch:artifact-applied",
      handlePatchMutation,
    );
    const unsubscribePatchRolledBack = EventsOn(
      "ai:patch:artifact-rolled-back",
      handlePatchMutation,
    );
    const unsubscribeFileChanged = EventsOn("file:changed", (payload) => {
      const changedPath =
        typeof payload === "string"
          ? payload
          : payload &&
              typeof payload === "object" &&
              "path" in payload &&
              typeof (payload as { path?: unknown }).path === "string"
            ? (payload as { path: string }).path
            : "";
      const affectedTabs = tabsRef.current.filter(
        (tab) =>
          changedPath &&
          aiInlinePatchPathMatches(tab.path, changedPath, projectPath),
      );
      affectedTabs.forEach((tab) => {
        if (tab.isDirty) {
          return;
        }
        void refreshAppliedPatchTab(tab);
      });
    });

    return () => {
      unsubscribeRenamed();
      unsubscribeDeleted();
      unsubscribePatchApplied();
      unsubscribePatchRolledBack();
      unsubscribeFileChanged();
    };
  }, [
    currentProjectSessionId,
    applyDeletedProjectEntry,
    applyRenamedProjectEntry,
    projectPath,
    refreshAppliedPatchTab,
  ]);

  const notifyEditorSplitTransition = useCallback(() => {
    beginPanelMotionWindow(360);
    window.dispatchEvent(new CustomEvent("arlecchino:editor-split-transition"));
  }, [beginPanelMotionWindow]);

  const collapseEditorSplitToTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId);
      if (!tab) {
        return false;
      }

      notifyEditorSplitTransition();
      editorSplitSlotsRef.current = null;
      setEditorSplitSlots(null);
      splitDirectionRef.current = null;
      setSplitDirection(null);
      setSecondaryActiveTab(null);
      activeTabRef.current = tabId;
      setActiveTab(tabId);
      updateActiveEditorView(editorViewRefs.current[tabId] ?? null);
      setActiveEditorSplitDropSide(null);
      ensureTabFileLoaded(tab);
      return true;
    },
    [ensureTabFileLoaded, notifyEditorSplitTransition, updateActiveEditorView],
  );

  const handleTabsReorder = useCallback((nextTabs: Tab[]) => {
    const normalizedTabs = normalizeEditorTabs(nextTabs);
    tabsRef.current = normalizedTabs;
    setTabs(normalizedTabs);
  }, []);

  const handleSplitTabsReorder = useCallback(
    (side: EditorSplitPaneSide, nextTabs: Tab[]) => {
      const currentSlots = editorSplitSlotsRef.current;
      if (!currentSlots) {
        return;
      }

      const nextTabIds = nextTabs.map((tab) => tab.id);
      const nextSlots = updateEditorSplitSide(
        currentSlots,
        side,
        uniqueEditorTabIds(nextTabIds),
        getEditorSplitActiveTabId(currentSlots, side),
      );
      void commitEditorSplitSlots(nextSlots);
    },
    [commitEditorSplitSlots],
  );

  const getEditorSplitDropTarget = useCallback(
    (point: { x: number; y: number }): EditorSplitDropTarget | null => {
      const element = document.elementFromPoint(point.x, point.y);
      const splitTabsSide =
        element?.closest<HTMLElement>("[data-editor-split-side]")?.dataset
          .editorSplitSide ?? null;
      if (isEditorSplitDropSide(splitTabsSide)) {
        return { side: splitTabsSide };
      }

      const rect = editorSurfaceRef.current?.getBoundingClientRect();
      if (
        !rect ||
        point.x < rect.left ||
        point.x > rect.right ||
        point.y < rect.top ||
        point.y > rect.bottom
      ) {
        return null;
      }

      if (point.y >= rect.top + rect.height * 0.666) {
        return { side: "bottom" };
      }

      return {
        side: point.x < rect.left + rect.width / 2 ? "left" : "right",
      };
    },
    [],
  );

  const handleEditorSplitDragMove = useCallback(
    (side: EditorSplitDropSide | null) => {
      setActiveEditorSplitDropSide(side);
    },
    [],
  );

  const applyEditorSplitForTab = useCallback(
    (tabId: string, side: EditorSplitDropSide) => {
      const allTabs = tabsRef.current;
      if (!allTabs.some((candidate) => candidate.id === tabId)) {
        return false;
      }

      const currentSplitSlots = editorSplitSlotsRef.current;
      const targetPaneSide = side;
      const fallbackCounterpartTabIds =
        allTabs.length > 1 ? getOtherEditorTabIds(allTabs, tabId) : [tabId];
      const fallbackActiveTabId =
        fallbackCounterpartTabIds.find(
          (candidate) => candidate === activeTabRef.current,
        ) ?? fallbackCounterpartTabIds[0];
      const nextSplitSlots = currentSplitSlots
        ? editorSplitPaneSides.reduce<NonNullable<EditorSplitSlots>>(
            (nextSlots, paneSide) => {
              const existingTabIds = getEditorSplitTabIds(
                currentSplitSlots,
                paneSide,
              ).filter((id) => id !== tabId);
              const nextTabIds =
                paneSide === targetPaneSide
                  ? uniqueEditorTabIds([...existingTabIds, tabId])
                  : existingTabIds;
              const previousActiveTabId = getEditorSplitActiveTabId(
                currentSplitSlots,
                paneSide,
              );
              const nextActiveTabId =
                paneSide === targetPaneSide
                  ? tabId
                  : previousActiveTabId === tabId
                    ? nextTabIds[0]
                    : previousActiveTabId;
              return updateEditorSplitSide(
                nextSlots,
                paneSide,
                nextTabIds,
                nextActiveTabId,
              );
            },
            createEditorSplitSlots(),
          )
        : createInitialEditorSplitSlots(
            tabId,
            targetPaneSide,
            fallbackCounterpartTabIds,
            fallbackActiveTabId,
          );
      const normalizedSplitSlots = normalizeEditorSplitSlots(
        nextSplitSlots,
        allTabs,
      );
      if (!normalizedSplitSlots) {
        return collapseEditorSplitToTab(tabId);
      }

      notifyEditorSplitTransition();
      editorSplitSlotsRef.current = normalizedSplitSlots;
      setEditorSplitSlots(normalizedSplitSlots);
      const nextSplitDirection = getEditorSplitDirection(normalizedSplitSlots);
      splitDirectionRef.current = nextSplitDirection;
      setSplitDirection(nextSplitDirection);
      setActiveTab(getPrimaryEditorSplitActiveTabId(normalizedSplitSlots));
      setSecondaryActiveTab(
        getSecondaryEditorSplitActiveTabId(normalizedSplitSlots),
      );
      focusEditorSplitSide(targetPaneSide);
      setActiveEditorSplitDropSide(null);
      getTabsByIds(
        allTabs,
        getEditorSplitActiveSides(normalizedSplitSlots).map((paneSide) =>
          getEditorSplitActiveTabId(normalizedSplitSlots, paneSide),
        ),
      ).forEach((tab) => ensureTabFileLoaded(tab));
      return true;
    },
    [
      collapseEditorSplitToTab,
      ensureTabFileLoaded,
      focusEditorSplitSide,
      notifyEditorSplitTransition,
    ],
  );

  const handleTabDropToEditorSplit = useCallback(
    (tab: Tab, side: EditorSplitDropSide) => {
      void applyEditorSplitForTab(tab.id, side);
    },
    [applyEditorSplitForTab],
  );

  const handleExternalFileDropToEditorSplit = useCallback(
    async (detail: EditorFileSplitDropEventDetail) => {
      const path = typeof detail.path === "string" ? detail.path.trim() : "";
      const side = detail.side;
      if (!path || !isEditorSplitDropSide(side)) {
        return;
      }

      const tabsBeforeDrop = tabsRef.current;
      const openingFirstEditorTab =
        !editorSplitSlotsRef.current && tabsBeforeDrop.length === 0;
      const tabId = makeEditorTabId(path);
      const existingTab = tabsBeforeDrop.find(
        (candidate) => candidate.id === tabId || candidate.path === path,
      );
      const tab: Tab = existingTab ?? {
        id: tabId,
        label: detail.name || getProjectPathBasename(path),
        path,
        isDirty: false,
      };

      if (!existingTab) {
        const nextTabs = normalizeEditorTabs([...tabsBeforeDrop, tab]);
        tabsRef.current = nextTabs;
        setTabs(nextTabs);
      }

      const currentLoadState = fileLoadStatesRef.current[tab.id];
      if (!currentLoadState) {
        const requestId = openFileRequestRef.current + 1;
        openFileRequestRef.current = requestId;
        scheduleFileOpenLoading(requestId, tab.path);
      }

      if (openingFirstEditorTab) {
        editorSplitSlotsRef.current = null;
        setEditorSplitSlots(null);
        splitDirectionRef.current = null;
        setSplitDirection(null);
        setSecondaryActiveTab(null);
        activeTabRef.current = tab.id;
        setActiveTab(tab.id);
        focusEditorSplitSide(side);
      } else {
        applyEditorSplitForTab(tab.id, side);
      }
      setActiveEditorSplitDropSide(null);
      if (detail.line) {
        setHighlightLine(detail.line);
        window.setTimeout(() => setHighlightLine(undefined), 3000);
      }

      if (currentLoadState && currentLoadState.kind !== "loading") {
        return;
      }

      try {
        const file = await loadEditorFile(tab.path);
        clearFileOpenLoadingTimer();
        storeFileLoadState(tab.id, file);
      } catch (error) {
        clearFileOpenLoadingTimer();
        useAppNotificationStore.getState().addNotification({
          id: `editor-split-drop:${tab.path}`,
          kind: "error",
          title: "Failed to open split file",
          message: error instanceof Error ? error.message : String(error),
          source: "Explorer",
          timeoutMs: 7000,
        });
      }
    },
    [
      applyEditorSplitForTab,
      clearFileOpenLoadingTimer,
      focusEditorSplitSide,
      scheduleFileOpenLoading,
      storeFileLoadState,
    ],
  );

  const handleEditorTabClick = useCallback(
    (tabId: string, sideHint?: EditorSplitPaneSide) => {
      const currentSlots = editorSplitSlotsRef.current;
      const splitSide =
        currentSlots &&
        sideHint &&
        getEditorSplitTabIds(currentSlots, sideHint).includes(tabId)
          ? sideHint
          : getEditorSplitSideForTabId(currentSlots, tabId);
      if (currentSlots && splitSide) {
        const nextSlots = updateEditorSplitSide(
          currentSlots,
          splitSide,
          getEditorSplitTabIds(currentSlots, splitSide),
          tabId,
        );
        if (commitEditorSplitSlots(nextSlots)) {
          focusEditorSplitSide(splitSide);
        }
        return;
      }
      activeTabRef.current = tabId;
      setActiveTab(tabId);
      updateActiveEditorView(editorViewRefs.current[tabId] ?? null);
    },
    [commitEditorSplitSlots, focusEditorSplitSide, updateActiveEditorView],
  );

  const handleTabDetachToPanel = useCallback(
    async (
      tab: Tab,
      point: { x: number; y: number },
      options?: { snapPosition?: PanelOpenRequest["position"] | null },
    ) => {
      if (!onFileOpenInPanel) {
        return;
      }

      const loadState = fileLoadStatesRef.current[tab.id];
      const request: Partial<PanelOpenRequest> = options?.snapPosition
        ? {
            mode: "snapped",
            position: options.snapPosition,
            width: 560,
            height: 360,
            reflowOnSnap: true,
          }
        : {
            mode: "floating",
            x: Math.max(16, point.x - 280),
            y: Math.max(64, point.y - 24),
            width: 560,
            height: 360,
          };
      if (loadState?.kind === "editable") {
        request.content = fileContentsRef.current[tab.id] ?? loadState.content;
      }

      try {
        await onFileOpenInPanel(tab.path, tab.label, undefined, request);
        handleTabClose(tab.id);
      } catch (error) {
        useAppNotificationStore.getState().addNotification({
          id: `detach-tab:${tab.path}`,
          kind: "error",
          title: "Failed to detach tab",
          message: error instanceof Error ? error.message : String(error),
          source: "Editor",
          timeoutMs: 7000,
        });
      }
    },
    [handleTabClose, onFileOpenInPanel],
  );

  const buildTabContextMenuItems = useCallback(
    (tab: Tab): ContextActionMenuItem[] => [
      {
        label: "Close",
        icon: <X size={14} />,
        onSelect: () => handleTabClose(tab.id),
      },
      {
        label: "Close Others",
        icon: <X size={14} />,
        disabled: tabs.length <= 1,
        onSelect: () => handleCloseOtherTabs(tab.id),
      },
      {
        label: "Close All",
        icon: <X size={14} />,
        disabled: tabs.length === 0,
        onSelect: () => handleCloseAllTabs(),
      },
      { separator: true },
      {
        label: "Copy Absolute Path",
        icon: <Copy size={14} />,
        onSelect: () => {
          void copyAbsolutePath(tab.path);
        },
      },
      {
        label: "Reveal in File Manager",
        icon: <ExternalLink size={14} />,
        onSelect: () => {
          void revealEntry(tab.path);
        },
      },
    ],
    [
      copyAbsolutePath,
      handleCloseAllTabs,
      handleCloseOtherTabs,
      revealEntry,
      tabs.length,
    ],
  );

  const handleQuickLookRequest = async (path: string, line?: number) => {
    const requestId = quickLookRequestRef.current + 1;
    quickLookRequestRef.current = requestId;

    try {
      let fullPath = path;
      if (!path.startsWith("/") && projectPath) {
        fullPath = `${projectPath}/${path}`;
      }

      const file = await loadEditorFile(fullPath);
      if (quickLookRequestRef.current !== requestId) {
        return;
      }
      if (file.kind !== "editable") {
        handleFileOpen({ file, line });
        return;
      }
      const language = getLanguageFromPath(fullPath);

      blockProjectSwitch(PROJECT_SWITCH_BLOCKERS.quickLook);
      setQuickLook({
        isOpen: true,
        filePath: fullPath,
        content: file.content,
        language,
        highlightLine: line,
      });
    } catch (error) {
      if (quickLookRequestRef.current === requestId) {
        console.error("Failed to open Quick Look:", error);
        alert(`Failed to open file: ${path}`);
      }
    }
  };

  const handleQuickLookClose = () => {
    closeQuickLook();
  };

  const handleQuickLookExpand = () => {
    const { filePath, content, highlightLine } = quickLook;
    const name = filePath.split("/").pop() || "unknown";

    closeQuickLook();

    const navigationTarget = createEditorNavigationTarget(
      highlightLine,
      undefined,
      { focus: true },
    );
    handleFileOpen({
      file: createEditableEditorFileLoad(filePath, content),
      line: navigationTarget?.line,
      navigationTarget,
    });
  };

  const handleSplit = useCallback(
    (direction: "horizontal" | "vertical") => {
      notifyEditorSplitTransition();

      if (splitDirection) {
        // Close split
        editorSplitSlotsRef.current = null;
        splitDirectionRef.current = null;
        setSplitDirection(null);
        setSecondaryActiveTab(null);
        setEditorSplitSlots(null);
        focusEditorSplitSide("left");
      } else if (activeTab) {
        const counterpartTabIds = getOtherEditorTabIds(tabs, activeTab);
        const fallbackTabIds =
          counterpartTabIds.length > 0 ? counterpartTabIds : [activeTab];
        const secondarySide: EditorSplitPaneSide =
          direction === "vertical" ? "bottom" : "right";
        const nextSplitSlots = createPrimaryEditorSplitSlots(
          activeTab,
          secondarySide,
          fallbackTabIds,
          fallbackTabIds[0],
        );
        if (commitEditorSplitSlots(nextSplitSlots)) {
          focusEditorSplitSide("left");
        }
      }
    },
    [
      activeTab,
      commitEditorSplitSlots,
      focusEditorSplitSide,
      notifyEditorSplitTransition,
      splitDirection,
      tabs,
    ],
  );

  useEffect(() => {
    const handleExternalEditorSplit = (event: Event) => {
      const detail = (event as CustomEvent<{ direction?: SplitDirection }>)
        .detail;
      const direction = detail?.direction;
      if (direction !== "horizontal" && direction !== "vertical") {
        return;
      }

      if (splitDirection === direction && secondaryActiveTab) {
        return;
      }

      if (!activeTab) {
        return;
      }

      notifyEditorSplitTransition();
      const counterpartTabIds = getOtherEditorTabIds(tabs, activeTab);
      const fallbackTabIds =
        counterpartTabIds.length > 0 ? counterpartTabIds : [activeTab];
      const secondarySide: EditorSplitPaneSide =
        direction === "vertical" ? "bottom" : "right";
      const nextSplitSlots = createPrimaryEditorSplitSlots(
        activeTab,
        secondarySide,
        fallbackTabIds,
        fallbackTabIds[0],
      );
      if (commitEditorSplitSlots(nextSplitSlots)) {
        focusEditorSplitSide("left");
      }
    };

    window.addEventListener(
      "arlecchino:editor-split",
      handleExternalEditorSplit as EventListener,
    );
    return () =>
      window.removeEventListener(
        "arlecchino:editor-split",
        handleExternalEditorSplit as EventListener,
      );
  }, [
    activeTab,
    commitEditorSplitSlots,
    focusEditorSplitSide,
    notifyEditorSplitTransition,
    secondaryActiveTab,
    splitDirection,
    tabs,
  ]);

  useEffect(() => {
    const handleExternalFileSplitDrag = (event: Event) => {
      const detail = (
        event as CustomEvent<{ side?: EditorSplitDropSide | null }>
      ).detail;
      const side = detail?.side;
      setActiveEditorSplitDropSide(isEditorSplitDropSide(side) ? side : null);
    };

    const handleExternalFileSplitDrop = (event: Event) => {
      const detail = (event as CustomEvent<EditorFileSplitDropEventDetail>)
        .detail;
      void handleExternalFileDropToEditorSplit(detail ?? {});
    };

    window.addEventListener(
      EDITOR_FILE_SPLIT_DRAG_EVENT,
      handleExternalFileSplitDrag as EventListener,
    );
    window.addEventListener(
      EDITOR_FILE_SPLIT_DROP_EVENT,
      handleExternalFileSplitDrop as EventListener,
    );
    return () => {
      window.removeEventListener(
        EDITOR_FILE_SPLIT_DRAG_EVENT,
        handleExternalFileSplitDrag as EventListener,
      );
      window.removeEventListener(
        EDITOR_FILE_SPLIT_DROP_EVENT,
        handleExternalFileSplitDrop as EventListener,
      );
    };
  }, [handleExternalFileDropToEditorSplit]);

  const handleCloseSplit = () => {
    editorSplitSlotsRef.current = null;
    splitDirectionRef.current = null;
    setSplitDirection(null);
    setSecondaryActiveTab(null);
    setEditorSplitSlots(null);
    setActiveEditorSplitDropSide(null);
    focusEditorSplitSide("left");
  };

  useEffect(() => {
    return () => {
      Object.values(autoSaveTimerRefs.current).forEach((timer) =>
        clearTimeout(timer),
      );
      autoSaveTimerRefs.current = {};
      if (contentStateFlushTimerRef.current) {
        clearTimeout(contentStateFlushTimerRef.current);
      }
      if (editorStoreContentFlushTimerRef.current) {
        clearTimeout(editorStoreContentFlushTimerRef.current);
        flushPendingEditorStoreContent();
      }
      if (typingActivityTimerRef.current) {
        clearTimeout(typingActivityTimerRef.current);
        const pending = pendingTypingActivityRef.current;
        pendingTypingActivityRef.current = 0;
        if (pending > 0) {
          AppFunctions.RecordTypingActivity(pending).catch(() => {});
        }
      }
    };
  }, [flushPendingEditorStoreContent]);

  const focusedEditorTabId = editorSplitSlots
    ? getEditorSplitActiveTabId(editorSplitSlots, focusedEditorSplitSide)
    : activeTab;
  const activeTabData = tabs.find((tab) => tab.id === activeTab);
  const focusedTabData = focusedEditorTabId
    ? tabs.find((tab) => tab.id === focusedEditorTabId)
    : null;
  const activeMarkdownPreviewSource =
    buildMarkdownPreviewSource(focusedEditorTabId);
  const secondaryTabData = secondaryActiveTab
    ? tabs.find((tab) => tab.id === secondaryActiveTab)
    : null;
  const editorSplitLeftTabs = editorSplitSlots
    ? getTabsByIds(tabs, editorSplitSlots.leftTabIds)
    : [];
  const editorSplitRightTabs = editorSplitSlots
    ? getTabsByIds(tabs, editorSplitSlots.rightTabIds)
    : [];
  const editorSplitBottomTabs = editorSplitSlots
    ? getTabsByIds(tabs, editorSplitSlots.bottomTabIds)
    : [];
  const editorSplitLeftTabData = editorSplitSlots
    ? tabs.find((tab) => tab.id === editorSplitSlots.leftActiveTabId)
    : null;
  const editorSplitRightTabData = editorSplitSlots
    ? tabs.find((tab) => tab.id === editorSplitSlots.rightActiveTabId)
    : null;
  const editorSplitBottomTabData = editorSplitSlots
    ? tabs.find((tab) => tab.id === editorSplitSlots.bottomActiveTabId)
    : null;
  const editorSplitActiveSides = editorSplitSlots
    ? getEditorSplitActiveSides(editorSplitSlots)
    : [];
  const editorSplitTopSides = editorSplitActiveSides.filter(
    (side) => side !== "bottom",
  );
  const editorSplitHasBottom = editorSplitActiveSides.includes("bottom");
  const editorSplitConstrainedMode = editorSplitActiveSides.length >= 2;
  const editorSplitCloseControlsSide =
    (editorSplitHasBottom
      ? "bottom"
      : editorSplitActiveSides[editorSplitActiveSides.length - 1]) ?? "left";
  const editorSplitReady = Boolean(
    editorSplitSlots &&
    editorSplitActiveSides.length >= 2 &&
    editorSplitActiveSides.every((side) => {
      switch (side) {
        case "left":
          return editorSplitLeftTabData;
        case "right":
          return editorSplitRightTabData;
        case "bottom":
          return editorSplitBottomTabData;
      }
    }),
  );
  const tabBarTabs = React.useMemo(
    () => (editorSplitReady ? [] : tabs),
    [editorSplitReady, tabs],
  );
  const tabBarActiveTab =
    activeTab && tabBarTabs.some((tab) => tab.id === activeTab)
      ? activeTab
      : null;
  const activeTabLoadState = focusedTabData
    ? fileLoadStates[focusedTabData.id]
    : undefined;
  const activeTabRendersCodeMirror = Boolean(
    focusedTabData &&
    (activeTabLoadState?.kind === "editable" ||
      (!activeTabLoadState && fileContents[focusedTabData.id] !== undefined)),
  );
  const canFindInActiveEditor =
    activeEditorViewAvailable && activeTabRendersCodeMirror;

  const renderEditor = (
    tabData: Tab,
    content: string,
    isSecondary = false,
    performanceProfile: CodeMirrorPerformanceProfile = "default",
  ) => {
    const inlinePatchPreview = selectAIInlinePatchPreviewForPath(
      aiInlinePatchPreviews,
      tabData.path,
      {
        projectPath,
        projectSessionId: currentProjectSessionId,
      },
    );
    const navigationTarget =
      pendingEditorNavigation?.path === tabData.path
        ? pendingEditorNavigation.target
        : undefined;

    return (
      <CodeMirrorEditor
        filePath={tabData.path}
        content={content}
        language={getLanguageFromPath(tabData.path)}
        onChange={
          isSecondary
            ? (value) => handleContentChangeForTab(tabData.id, value)
            : handleContentChange
        }
        onSave={
          isSecondary ? () => handleSaveFileForTab(tabData.id) : handleSaveFile
        }
        onToggleProblems={onToggleProblems}
        onOpenFile={handleOpenFileRequest}
        onQuickLook={handleQuickLookRequest}
        onPerspectiveOpen={onPerspectiveOpen}
        onPerspectiveClose={onPerspectiveClose}
        onTyping={recordTypingActivity}
        onGhostShown={() => {
          AppFunctions.RecordGhostShown().catch(() => {});
        }}
        onGhostRejected={() => {
          AppFunctions.RecordGhostRejected().catch(() => {});
        }}
        onEditorViewReady={(view) =>
          handleEditorViewReadyForTab(tabData.id, view)
        }
        onHistoryAvailabilityChange={
          tabData.id === focusedEditorTabId
            ? handleHistoryAvailabilityChange
            : undefined
        }
        highlightLine={isSecondary ? undefined : highlightLine}
        navigationTarget={navigationTarget}
        onNavigationTargetApplied={handleNavigationTargetApplied}
        aiInlinePatchPreview={inlinePatchPreview}
        aiInlinePatchBusy={Boolean(
          inlinePatchPreview && aiInlinePatchBusyIds[inlinePatchPreview.id],
        )}
        onAcceptAIInlinePatch={handleAcceptAIInlinePatch}
        onRejectAIInlinePatch={handleRejectAIInlinePatch}
        projectPath={projectPath}
        readOnly={isTabReadOnlyByPolicy(tabData.id)}
        performanceProfile={performanceProfile}
        reportsPerformanceBudget={tabData.id === focusedEditorTabId}
        active={tabData.id === focusedEditorTabId}
      />
    );
  };

  const renderEditorSurface = (
    tabData: Tab,
    isSecondary = false,
    performanceProfile: CodeMirrorPerformanceProfile = "default",
  ) => {
    const loadState = fileLoadStates[tabData.id];
    if (!loadState && fileContents[tabData.id] === undefined) {
      return (
        <EditorFileLoadingView
          file={createEditorFileLoadingLoad(tabData.path, tabData.label)}
        />
      );
    }
    if (loadState?.kind === "loading") {
      return <EditorFileLoadingView file={loadState} />;
    }
    if (loadState?.kind === "visualPreview") {
      return <ImageEditorPreview file={loadState} />;
    }
    if (loadState?.kind === "binaryPreview") {
      return <BinaryEditorPreview file={loadState} />;
    }
    if (loadState?.kind === "guardedPreview" || loadState?.kind === "error") {
      return <GuardedEditorPreview file={loadState} />;
    }

    return renderEditor(
      tabData,
      fileContents[tabData.id] ??
        (loadState?.kind === "editable" ? loadState.content : ""),
      isSecondary,
      performanceProfile,
    );
  };

  const getEditorSplitTabsForSide = (side: EditorSplitPaneSide): Tab[] => {
    switch (side) {
      case "left":
        return editorSplitLeftTabs;
      case "right":
        return editorSplitRightTabs;
      case "bottom":
        return editorSplitBottomTabs;
    }
  };

  const getEditorSplitTabDataForSide = (
    side: EditorSplitPaneSide,
  ): Tab | null | undefined => {
    switch (side) {
      case "left":
        return editorSplitLeftTabData;
      case "right":
        return editorSplitRightTabData;
      case "bottom":
        return editorSplitBottomTabData;
    }
  };

  const getEditorSplitPaneTestId = (side: EditorSplitPaneSide): string =>
    side === "bottom"
      ? "editor-split-pane-bottom"
      : `editor-split-pane-${side}`;

  const getEditorSplitPaneLabel = (side: EditorSplitPaneSide): string => {
    switch (side) {
      case "left":
        return "Left editor split pane";
      case "right":
        return "Right editor split pane";
      case "bottom":
        return "Bottom editor split pane";
    }
  };

  const getEditorSplitPerformanceProfile = (
    side: EditorSplitPaneSide,
  ): CodeMirrorPerformanceProfile =>
    editorSplitConstrainedMode && focusedEditorSplitSide !== side
      ? "dense-split"
      : "default";

  const splitTabsEndControls = (
    <div
      data-testid="editor-tabs-split-close-controls"
      className="flex h-full max-h-full items-center border-l border-[var(--shell-inline-divider)] bg-[var(--editor-surface-elevated)] px-1.5 py-0"
    >
      <button
        type="button"
        onClick={handleFindInFile}
        onMouseDown={(event) => event.preventDefault()}
        disabled={!canFindInActiveEditor}
        data-testid="editor-tabs-split-find-in-file"
        aria-label="Find in file"
        title="Find in file (Cmd+F)"
        className="shell-control size-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-35"
      >
        <Search
          className="size-[13px] min-w-[13px] shrink-0"
          size={13}
          strokeWidth={2.2}
        />
      </button>
      <button
        type="button"
        onClick={handleCloseSplit}
        onMouseDown={(event) => event.preventDefault()}
        aria-label="Close split"
        title="Close split"
        className="shell-control size-10 min-w-10 px-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <X
          className="size-[13px] min-w-[13px] shrink-0"
          size={13}
          strokeWidth={2.2}
        />
      </button>
    </div>
  );

  const renderEditorSplitTabs = (
    side: EditorSplitPaneSide,
    splitTabs: Tab[],
    activeTabId: string,
    options: {
      showHistoryControls?: boolean;
      endControls?: React.ReactNode;
    } = {},
  ) => (
    <EditorTabs
      tabs={splitTabs}
      activeTab={activeTabId}
      activeIndicatorTab={focusedEditorSplitSide === side ? activeTabId : null}
      onTabClick={(tabId) => handleEditorTabClick(tabId, side)}
      onTabClose={(tabId) => handleSplitTabClose(side, tabId)}
      onTabsReorder={(nextTabs) => handleSplitTabsReorder(side, nextTabs)}
      onTabDetachToPanel={handleTabDetachToPanel}
      getEditorSplitDropTarget={getEditorSplitDropTarget}
      onEditorSplitDragMove={handleEditorSplitDragMove}
      onTabDropToEditorSplit={handleTabDropToEditorSplit}
      onPanelSnapDragStart={onPanelSnapDragStart}
      onPanelSnapDragMove={onPanelSnapDragMove}
      onPanelSnapDragEnd={onPanelSnapDragEnd}
      onUndo={handleEditorUndo}
      onRedo={handleEditorRedo}
      canUndo={editorHistoryAvailability.canUndo}
      canRedo={editorHistoryAvailability.canRedo}
      showHistoryControls={options.showHistoryControls}
      showSplitButtons={false}
      endControls={options.endControls}
      getTabContextMenuItems={buildTabContextMenuItems}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {tabs.length > 0 && !editorSplitReady && (
        <EditorTabs
          tabs={tabBarTabs}
          activeTab={tabBarActiveTab}
          onTabClick={handleEditorTabClick}
          onTabClose={handleTabClose}
          onTabsReorder={handleTabsReorder}
          onTabDetachToPanel={handleTabDetachToPanel}
          getEditorSplitDropTarget={getEditorSplitDropTarget}
          onEditorSplitDragMove={handleEditorSplitDragMove}
          onTabDropToEditorSplit={handleTabDropToEditorSplit}
          onPanelSnapDragStart={onPanelSnapDragStart}
          onPanelSnapDragMove={onPanelSnapDragMove}
          onPanelSnapDragEnd={onPanelSnapDragEnd}
          onUndo={handleEditorUndo}
          onRedo={handleEditorRedo}
          canUndo={editorHistoryAvailability.canUndo}
          canRedo={editorHistoryAvailability.canRedo}
          onFindInFile={handleFindInFile}
          canFindInFile={canFindInActiveEditor}
          onSplitHorizontal={() => handleSplit("vertical")}
          onSplitVertical={() => handleSplit("horizontal")}
          markdownPreviewAvailable={activeMarkdownPreviewSource !== null}
          markdownPreviewActive={
            markdownPreviewOpen && activeMarkdownPreviewSource !== null
          }
          onToggleMarkdownPreview={onToggleMarkdownPreview}
          getTabContextMenuItems={buildTabContextMenuItems}
        />
      )}

      {editorSplitReady && editorSplitSlots && !editorSplitHasBottom && (
        <div className="flex h-10 min-h-10 w-full overflow-visible">
          {editorSplitTopSides.map((side, index) => (
            <div
              key={side}
              data-editor-split-side={side}
              className={`relative min-w-0 flex-1 ${
                index < editorSplitTopSides.length - 1
                  ? "border-r border-[var(--editor-border)]"
                  : ""
              }`}
              onFocusCapture={() => focusEditorSplitSide(side)}
              onPointerDownCapture={() => focusEditorSplitSide(side)}
            >
              {renderEditorSplitTabs(
                side,
                getEditorSplitTabsForSide(side),
                getEditorSplitActiveTabId(editorSplitSlots, side),
                {
                  showHistoryControls: index === 0,
                  endControls:
                    editorSplitCloseControlsSide === side
                      ? splitTabsEndControls
                      : undefined,
                },
              )}
            </div>
          ))}
        </div>
      )}

      <div
        ref={editorSurfaceRef}
        data-testid="editor-surface"
        className="relative flex-1 min-h-0 overflow-hidden"
        style={{ background: activeTabData ? editorBgColor : "transparent" }}
      >
        {activeEditorSplitDropSide && (
          <div
            data-testid="editor-split-drop-overlay"
            className="pointer-events-none absolute inset-0 z-30"
            aria-hidden="true"
          >
            {editorSplitDropSides.map((side) => (
              <EditorSplitDropZone
                key={side}
                side={side}
                isActive={activeEditorSplitDropSide === side}
              />
            ))}
          </div>
        )}

        {editorSplitReady && editorSplitSlots ? (
          <div
            className={`flex h-full ${editorSplitHasBottom ? "flex-col" : "flex-row"}`}
            data-testid="editor-split-surface"
            style={{ background: editorBgColor }}
          >
            <div
              className={`flex min-h-0 min-w-0 ${editorSplitHasBottom ? "h-1/2 border-b border-[var(--editor-border)]" : "h-full flex-1"}`}
            >
              {editorSplitTopSides.map((side, index) => {
                const tabData = getEditorSplitTabDataForSide(side);
                if (!tabData) {
                  return null;
                }
                const showInlineTabs = editorSplitHasBottom;
                return (
                  <section
                    key={side}
                    className={`min-h-0 min-w-0 overflow-hidden ${
                      showInlineTabs ? "flex flex-1 flex-col" : "flex-1"
                    } ${
                      index < editorSplitTopSides.length - 1
                        ? "border-r border-[var(--editor-border)]"
                        : ""
                    }`}
                    data-testid={getEditorSplitPaneTestId(side)}
                    aria-label={getEditorSplitPaneLabel(side)}
                    onFocusCapture={() => focusEditorSplitSide(side)}
                    onPointerDownCapture={() => focusEditorSplitSide(side)}
                    style={{
                      background: editorBgColor,
                    }}
                  >
                    {showInlineTabs ? (
                      <div data-editor-split-side={side} className="min-w-0">
                        {renderEditorSplitTabs(
                          side,
                          getEditorSplitTabsForSide(side),
                          getEditorSplitActiveTabId(editorSplitSlots, side),
                          {
                            showHistoryControls: index === 0,
                            endControls:
                              editorSplitCloseControlsSide === side
                                ? splitTabsEndControls
                                : undefined,
                          },
                        )}
                      </div>
                    ) : null}
                    <div
                      className={`${showInlineTabs ? "min-h-0 flex-1" : "h-full min-h-0"} overflow-hidden`}
                    >
                      {renderEditorSurface(
                        tabData,
                        index > 0,
                        getEditorSplitPerformanceProfile(side),
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
            {editorSplitHasBottom && editorSplitBottomTabData ? (
              <section
                className="flex h-1/2 min-h-0 min-w-0 flex-col overflow-hidden"
                data-testid={getEditorSplitPaneTestId("bottom")}
                aria-label={getEditorSplitPaneLabel("bottom")}
                onFocusCapture={() => focusEditorSplitSide("bottom")}
                onPointerDownCapture={() => focusEditorSplitSide("bottom")}
                style={{
                  background: editorBgColor,
                }}
              >
                <div data-editor-split-side="bottom" className="min-w-0">
                  {renderEditorSplitTabs(
                    "bottom",
                    editorSplitBottomTabs,
                    editorSplitSlots.bottomActiveTabId,
                    {
                      showHistoryControls: false,
                      endControls:
                        editorSplitCloseControlsSide === "bottom"
                          ? splitTabsEndControls
                          : undefined,
                    },
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {renderEditorSurface(
                    editorSplitBottomTabData,
                    true,
                    getEditorSplitPerformanceProfile("bottom"),
                  )}
                </div>
              </section>
            ) : null}
          </div>
        ) : activeTabData && activeTab ? (
          splitDirection && secondaryTabData ? (
            <div
              className={`flex h-full ${splitDirection === "horizontal" ? "flex-row" : "flex-col"}`}
              style={{ background: editorBgColor }}
            >
              <div
                className={`${splitDirection === "horizontal" ? "w-1/2 border-r" : "h-1/2 border-b"} border-[var(--editor-border)]`}
              >
                {renderEditorSurface(activeTabData)}
              </div>
              <div
                className={`${splitDirection === "horizontal" ? "w-1/2" : "h-1/2"} relative`}
                style={{ background: editorBgColor }}
              >
                <button
                  type="button"
                  onClick={handleCloseSplit}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label="Close split"
                  title="Close split"
                  className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 min-w-10 items-center justify-center rounded-[18px] border border-[var(--shell-border)] bg-[var(--surface-shell-strong)] p-0 text-[var(--text-secondary)] shadow-[var(--shell-shadow)] transition-[background-color,border-color,color,box-shadow,transform] hover:border-[var(--shell-border-strong)] hover:bg-[var(--surface-active)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
                >
                  <X
                    className="h-4 w-4 min-w-4 shrink-0"
                    size={16}
                    strokeWidth={2.35}
                  />
                </button>
                {renderEditorSurface(secondaryTabData, true)}
              </div>
            </div>
          ) : (
            renderEditorSurface(activeTabData)
          )
        ) : (
          <div className="h-full w-full" />
        )}
      </div>

      {isTabSwitcherOpen ? (
        <TabSwitcherOverlay
          tabs={tabs}
          selectedTabId={tabSwitcherSelection}
          activeTabId={focusedEditorTabId}
          projectPath={projectPath}
        />
      ) : null}

      <QuickLookModal
        isOpen={quickLook.isOpen}
        filePath={quickLook.filePath}
        content={quickLook.content}
        language={quickLook.language}
        highlightLine={quickLook.highlightLine}
        onClose={handleQuickLookClose}
        onExpand={handleQuickLookExpand}
      />
    </div>
  );
};

export default ProjectScreen;
