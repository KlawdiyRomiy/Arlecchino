import React, { useState, useEffect, useCallback, useRef } from "react";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { Copy, ExternalLink, X } from "lucide-react";
import {
  CodeMirrorEditor,
  type EditorHistoryAvailability,
} from "./CodeMirrorEditor";
import { EditorFileLoadingView } from "./EditorFileLoadingView";
import { EditorTabs, Tab } from "./EditorTabs";
import { TabSwitcherOverlay } from "./TabSwitcherOverlay";
import QuickLookModal from "./QuickLookModal";
import { BinaryEditorPreview } from "./BinaryEditorPreview";
import { ImageEditorPreview } from "./ImageEditorPreview";
import * as AppFunctions from "../wails/app";
import { EventsOn } from "../wails/runtime";
import { useProjectEntryActions } from "../contexts/ProjectEntryActionsContext";
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
import { editorCanvasBackground } from "../utils/codeMirrorTheme";
import { type ContextActionMenuItem } from "./ui/ContextActionMenu";
import { GuardedEditorPreview } from "./GuardedEditorPreview";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  normalizeProjectPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";
import {
  createEditorFileLoadingLoad,
  createEditableEditorFileLoad,
  loadEditorFile,
  type EditorFileLoadState,
  type EditorFileOpenPayload,
} from "../utils/editorFileLoader";
import { usePerformanceStore } from "../stores/performanceStore";
import type {
  MarkdownPreviewSource,
  PanelOpenRequest,
} from "./layout/MainLayout.types";
import type { PanelSnapDragCallbacks } from "../utils/panelSnapDrag";

type SplitDirection = "horizontal" | "vertical" | null;

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
const EMPTY_EDITOR_HISTORY_AVAILABILITY: EditorHistoryAvailability = {
  canUndo: false,
  canRedo: false,
};

const isMarkdownPath = (path: string): boolean =>
  /\.(md|mdx|markdown|mdown|mkdn)$/i.test(path);

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

interface AIPatchArtifactAppliedEvent {
  artifactId?: string;
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
  const aiInlinePatchPreviews = useAIInlinePatchStore(
    (state) => state.previews,
  );
  const clearAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.clearPreview,
  );
  const dismissAIInlinePatchPreview = useAIInlinePatchStore(
    (state) => state.dismissPreview,
  );
  const resetActiveEditorBudget = usePerformanceStore(
    (state) => state.resetActiveEditorBudget,
  );
  const { copyAbsolutePath, revealEntry } = useProjectEntryActions();

  const tabStorageKey = `editorTabs:${projectPath}`;

  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const raw = localStorage.getItem(`editorTabs:${projectPath}`);
      if (!raw) return [];
      const { tabs: saved } = JSON.parse(raw);
      return Array.isArray(saved)
        ? saved.map((t: { path: string; label: string }) => ({
            id: makeEditorTabId(t.path),
            label: t.label,
            path: t.path,
            isDirty: false,
          }))
        : [];
    } catch {
      return [];
    }
  });

  const [activeTab, setActiveTab] = useState<string | null>(() => {
    try {
      const raw = localStorage.getItem(`editorTabs:${projectPath}`);
      if (!raw) return null;
      return JSON.parse(raw).activeTabId ?? null;
    } catch {
      return null;
    }
  });

  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLoadStates, setFileLoadStates] = useState<
    Record<string, EditorFileLoadState>
  >({});
  const [isSaving, setIsSaving] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | undefined>(
    undefined,
  );
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const [splitDirection, setSplitDirection] = useState<SplitDirection>(null);
  const [secondaryActiveTab, setSecondaryActiveTab] = useState<string | null>(
    null,
  );
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

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentStateFlushTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingContentStateRef = useRef<Record<string, string>>({});
  const typingActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingTypingActivityRef = useRef(0);
  const tabsRef = useRef<Tab[]>([]);
  const fileContentsRef = useRef<Record<string, string>>({});
  const fileLoadStatesRef = useRef<Record<string, EditorFileLoadState>>({});
  const activeTabRef = useRef<string | null>(activeTab);
  const activeEditorViewRef = useRef<EditorView | null>(null);
  const secondaryActiveTabRef = useRef<string | null>(secondaryActiveTab);
  const openFileRequestRef = useRef(0);
  const fileOpenLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const quickLookRequestRef = useRef(0);
  const reopenClosedTabRequestRef = useRef(0);
  const tabSwitcherSelectionRef = useRef<string | null>(null);
  const [isTabSwitcherOpen, setIsTabSwitcherOpen] = useState(false);
  const [tabSwitcherSelection, setTabSwitcherSelectionState] = useState<
    string | null
  >(null);
  const [editorHistoryAvailability, setEditorHistoryAvailability] =
    useState<EditorHistoryAvailability>(EMPTY_EDITOR_HISTORY_AVAILABILITY);

  const setTabSwitcherSelection = useCallback((tabId: string | null) => {
    tabSwitcherSelectionRef.current = tabId;
    setTabSwitcherSelectionState(tabId);
  }, []);

  const handleEditorViewReady = useCallback((view: EditorView | null) => {
    activeEditorViewRef.current = view;
    if (!view) {
      setEditorHistoryAvailability(EMPTY_EDITOR_HISTORY_AVAILABILITY);
    }
  }, []);

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

  const storeFileLoadState = useCallback(
    (tabId: string, file: EditorFileLoadState) => {
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
    [],
  );

  const closeTabSwitcher = useCallback(() => {
    setIsTabSwitcherOpen(false);
    setTabSwitcherSelection(null);
  }, [setTabSwitcherSelection]);

  const commitTabSwitcher = useCallback(() => {
    const nextTabId = tabSwitcherSelectionRef.current;
    if (nextTabId) {
      setActiveTab(nextTabId);
    }
    closeTabSwitcher();
  }, [closeTabSwitcher]);

  const cancelTabSwitcher = useCallback(() => {
    closeTabSwitcher();
  }, [closeTabSwitcher]);

  const cycleTabSwitcher = useCallback(
    (direction: 1 | -1) => {
      if (tabs.length < 2) {
        return;
      }

      const anchorTabId =
        (isTabSwitcherOpen ? tabSwitcherSelectionRef.current : activeTab) ??
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
    [activeTab, isTabSwitcherOpen, setTabSwitcherSelection, tabs],
  );

  useEffect(() => {
    if (tabs.length === 0) return;

    const restoredTabs = [...tabs];
    let cancelled = false;

    Promise.allSettled(
      restoredTabs.map((tab) => loadEditorFile(tab.path)),
    ).then((results) => {
      if (cancelled) return;

      const currentTabIds = new Set(tabsRef.current.map((tab) => tab.id));
      const loaded: Record<string, string> = {};
      const nextLoadStates: Record<string, EditorFileLoadState> = {};

      restoredTabs.forEach((tab, i) => {
        if (!currentTabIds.has(tab.id)) {
          return;
        }
        if (results[i].status === "fulfilled") {
          const file = (
            results[i] as PromiseFulfilledResult<EditorFileLoadState>
          ).value;
          nextLoadStates[tab.id] = file;
          if (file.kind === "editable") {
            loaded[tab.id] = file.content;
          }
        }
      });

      fileContentsRef.current = { ...fileContentsRef.current, ...loaded };
      fileLoadStatesRef.current = {
        ...fileLoadStatesRef.current,
        ...nextLoadStates,
      };
      setFileContents((prev) => ({ ...prev, ...loaded }));
      setFileLoadStates((prev) => ({ ...prev, ...nextLoadStates }));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (tabs.length === 0) {
        localStorage.removeItem(tabStorageKey);
        return;
      }

      localStorage.setItem(
        tabStorageKey,
        JSON.stringify({
          tabs: tabs.map((t) => ({ path: t.path, label: t.label })),
          activeTabId: activeTab,
        }),
      );
    }, 120);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [tabs, activeTab, tabStorageKey]);

  const lastFileToOpenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!fileToOpen) return;

    // Prevent duplicate opens for the same file
    const fileKey = `${fileToOpen.file.kind}:${fileToOpen.file.path}:${
      fileToOpen.line || 0
    }`;
    if (lastFileToOpenRef.current === fileKey) return;
    lastFileToOpenRef.current = fileKey;

    handleFileOpen(fileToOpen);
    let highlightTimeout: ReturnType<typeof setTimeout> | undefined;
    if (fileToOpen.line) {
      setHighlightLine(fileToOpen.line);
      highlightTimeout = setTimeout(() => setHighlightLine(undefined), 3000);
    }
    onFileOpened?.();

    return () => {
      if (highlightTimeout) {
        clearTimeout(highlightTimeout);
      }
    };
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
        if (activeTab) {
          handleTabClose(activeTab);
        } else if (tabs.length === 0) {
          onRequestProjectClose?.();
        }
        return;
      }

      // Cmd+\ (Split Horizontal)
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        if (splitDirection) {
          setSplitDirection(null);
          setSecondaryActiveTab(null);
        } else if (activeTab && tabs.length > 1) {
          setSplitDirection("horizontal");
          const otherTab = tabs.find((t) => t.id !== activeTab);
          setSecondaryActiveTab(otherTab?.id || null);
        } else if (activeTab) {
          setSplitDirection("horizontal");
          setSecondaryActiveTab(activeTab);
        }
        return;
      }

      // Cmd+Shift+\ (Split Vertical)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "|") {
        e.preventDefault();
        if (splitDirection) {
          setSplitDirection(null);
          setSecondaryActiveTab(null);
        } else if (activeTab && tabs.length > 1) {
          setSplitDirection("vertical");
          const otherTab = tabs.find((t) => t.id !== activeTab);
          setSecondaryActiveTab(otherTab?.id || null);
        } else if (activeTab) {
          setSplitDirection("vertical");
          setSecondaryActiveTab(activeTab);
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
      tabsRef.current = tabsRef.current.map((item) =>
        item.id === tab.id ? { ...item, isDirty: false } : item,
      );
      setTabs((previous) =>
        previous.map((item) =>
          item.id === tab.id ? { ...item, isDirty: false } : item,
        ),
      );
      if (file.kind === "editable") {
        replaceEditorStoreTabContent(
          tab.id,
          file.content,
          getLanguageFromPath(tab.path),
        );
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

  const handleAcceptAIInlinePatch = useCallback(
    async (preview: AIInlinePatchPreview) => {
      const affectedTabs = tabsRef.current.filter((tab) =>
        preview.files.some((file) =>
          aiInlinePatchPathMatches(tab.path, file.path),
        ),
      );
      const dirtyTab = affectedTabs.find((tab) => tab.isDirty);
      if (dirtyTab) {
        useAppNotificationStore.getState().addNotification({
          id: `ai-inline-patch-dirty:${preview.id}`,
          kind: "warning",
          title: "Save editor changes first",
          message: `${dirtyTab.label} has unsaved changes.`,
          source: "AI",
          sticky: false,
          timeoutMs: 6000,
        });
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
      }
    },
    [clearAIInlinePatchPreview, refreshAppliedPatchTab],
  );

  const handleRejectAIInlinePatch = useCallback(
    (preview: AIInlinePatchPreview) => {
      dismissAIInlinePatchPreview(preview.id);
    },
    [dismissAIInlinePatchPreview],
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
    const statusTab = primaryActiveTab ?? secondaryTab;

    if (!statusTab) {
      setStatusFile(null, null, null);
      return;
    }

    const language = getLanguageFromPath(statusTab.path);
    const loadState = fileLoadStates[statusTab.id];
    if (!loadState || loadState.kind !== "editable") {
      setStatusFile(statusTab.path, statusTab.label, language);
      return;
    }

    const content = fileContents[statusTab.id] ?? loadState.content;
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
    fileContents,
    fileLoadStates,
    getLanguageFromPath,
    secondaryActiveTab,
    setStatusFile,
    syncEditorStoreActiveTab,
    tabs,
  ]);

  const removeStaleLoadingTabs = useCallback((activePath: string) => {
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
      delete nextLoadStates[tabId];
      delete fileContentsRef.current[tabId];
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
  }, []);

  const handleFileOpen = useCallback(
    ({ file, line }: EditorFileOpenPayload) => {
      const filePath = file.path;
      removeStaleLoadingTabs(filePath);
      const tabId = makeEditorTabId(filePath);
      const existingTab = tabsRef.current.find((tab) => tab.path === filePath);
      if (existingTab) {
        if (file.kind !== "loading") {
          storeFileLoadState(existingTab.id, file);
        }
        setActiveTab(existingTab.id);
        if (line) {
          setHighlightLine(line);
          window.setTimeout(() => setHighlightLine(undefined), 3000);
        }
        return;
      }

      const newTab: Tab = {
        id: tabId,
        label: file.name,
        path: filePath,
        isDirty: false,
      };

      storeFileLoadState(tabId, file);
      setTabs((prevTabs) =>
        prevTabs.some((tab) => tab.path === filePath)
          ? prevTabs
          : [...prevTabs, newTab],
      );
      setActiveTab(tabId);
      if (line) {
        setHighlightLine(line);
        window.setTimeout(() => setHighlightLine(undefined), 3000);
      }
    },
    [removeStaleLoadingTabs, storeFileLoadState],
  );

  const clearFileOpenLoadingTimer = useCallback(() => {
    if (fileOpenLoadingTimerRef.current === null) {
      return;
    }

    clearTimeout(fileOpenLoadingTimerRef.current);
    fileOpenLoadingTimerRef.current = null;
  }, []);

  const scheduleFileOpenLoading = useCallback(
    (requestId: number, path: string, line?: number) => {
      clearFileOpenLoadingTimer();
      fileOpenLoadingTimerRef.current = setTimeout(() => {
        fileOpenLoadingTimerRef.current = null;
        if (openFileRequestRef.current !== requestId) {
          return;
        }

        handleFileOpen({
          file: createEditorFileLoadingLoad(path),
          line,
        });
      }, 140);
    },
    [clearFileOpenLoadingTimer, handleFileOpen],
  );

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
      closeEditorStoreTabPath(closedTab.path);
    }

    const updatedTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(updatedTabs);

    const { [tabId]: _, ...remainingContents } = fileContents;
    setFileContents(remainingContents);
    setFileLoadStates((previous) => {
      const { [tabId]: _removed, ...remaining } = previous;
      return remaining;
    });
    delete fileContentsRef.current[tabId];
    delete fileLoadStatesRef.current[tabId];

    if (activeTab === tabId) {
      setActiveTab(
        updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null,
      );
      if (updatedTabs.length === 0) {
        resetActiveEditorBudget();
      }
    }
  };

  const handleCloseOtherTabs = useCallback((tabId: string) => {
    const retainedTab = tabsRef.current.find((tab) => tab.id === tabId);
    if (!retainedTab) {
      return;
    }

    setTabs([retainedTab]);
    setFileContents((previous) =>
      previous[tabId] !== undefined ? { [tabId]: previous[tabId] } : {},
    );
    setFileLoadStates((previous) =>
      previous[tabId] !== undefined ? { [tabId]: previous[tabId] } : {},
    );
    setActiveTab(tabId);
    setSecondaryActiveTab(null);
    setSplitDirection(null);
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    openFileRequestRef.current += 1;
    tabsRef.current.forEach((tab) => closeEditorStoreTabPath(tab.path));
    setTabs([]);
    setFileContents({});
    setFileLoadStates({});
    fileContentsRef.current = {};
    fileLoadStatesRef.current = {};
    setActiveTab(null);
    setSecondaryActiveTab(null);
    setSplitDirection(null);
    resetActiveEditorBudget();
  }, [closeEditorStoreTabPath, resetActiveEditorBudget]);

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
    secondaryActiveTabRef.current = secondaryActiveTab;
  }, [secondaryActiveTab]);

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

  const autoSaveFile = useCallback(async (tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || !tab.isDirty) {
      console.log("Auto-save skipped:", tabId, "isDirty:", tab?.isDirty);
      return;
    }

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
    }
  }, []);

  const scheduleAutoSave = useCallback(
    (tabId: string) => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
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
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    const dirtyTabs = tabsRef.current.filter((tab) => tab.isDirty);
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
  }, [flushPendingContentState]);

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

  const handleContentChange = (value: string | undefined) => {
    if (!activeTab || value === undefined) return;

    fileContentsRef.current[activeTab] = value;
    const currentLoadState = fileLoadStatesRef.current[activeTab];
    if (currentLoadState?.kind === "editable") {
      const nextLoadState: EditorFileLoadState = {
        ...currentLoadState,
        content: value,
      };
      fileLoadStatesRef.current[activeTab] = nextLoadState;
    }
    const tab = tabsRef.current.find((item) => item.id === activeTab);
    if (tab && isMarkdownPath(tab.path)) {
      onMarkdownPreviewSourceChange?.({
        path: tab.path,
        name: tab.label,
        content: value,
      });
    }
    scheduleContentStateFlush(activeTab, value);
    updateEditorStoreTabContent(activeTab, value);
    markTabDirty(activeTab);
    scheduleAutoSave(activeTab);
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

  const handleSaveFile = useCallback(async () => {
    if (!activeTab || isSaving) return;

    const tab = tabs.find((t) => t.id === activeTab);
    if (!tab) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    setIsSaving(true);

    try {
      let contentToSave = fileContentsRef.current[activeTab];
      if (contentToSave === undefined) {
        return;
      }

      // Try to format code before saving
      try {
        const formatted = await AppFunctions.FormatCode(
          tab.path,
          contentToSave,
        );
        if (formatted && formatted !== contentToSave) {
          console.log("File formatted successfully");
          contentToSave = formatted;
          fileContentsRef.current[activeTab] = formatted;
          // Update editor content with formatted version
          setFileContents((prev) => ({
            ...prev,
            [activeTab]: formatted,
          }));
          const currentLoadState = fileLoadStatesRef.current[activeTab];
          if (currentLoadState?.kind === "editable") {
            fileLoadStatesRef.current[activeTab] = {
              ...currentLoadState,
              content: formatted,
            };
          }
        }
      } catch (formatError) {
        // If formatting fails, continue with original content
        console.warn("Prettier formatting failed:", formatError);
      }

      await AppFunctions.WriteFile(tab.path, contentToSave);
      tabsRef.current = tabsRef.current.map((item) =>
        item.id === activeTab ? { ...item, isDirty: false } : item,
      );
      setTabs(
        tabs.map((t) => (t.id === activeTab ? { ...t, isDirty: false } : t)),
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
  }, [activeTab, tabs, isSaving]);

  const handleOpenFileRequest = async (path: string, line?: number) => {
    const requestId = openFileRequestRef.current + 1;
    openFileRequestRef.current = requestId;

    try {
      let fullPath = path;
      if (!path.startsWith("/") && projectPath) {
        fullPath = `${projectPath}/${path}`;
      }

      scheduleFileOpenLoading(requestId, fullPath, line);
      const file = await loadEditorFile(fullPath);
      if (openFileRequestRef.current !== requestId) {
        return;
      }
      clearFileOpenLoadingTimer();
      handleFileOpen({ file, line });
      if (line) {
        setHighlightLine(line);
        setTimeout(() => setHighlightLine(undefined), 3000);
      }
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
    const removedTabIds = new Set(
      currentTabs
        .filter((tab) => isSameOrChildPath(tab.path, deletedPath))
        .map((tab) => tab.id),
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
    setActiveTab(nextPrimaryTabId);

    if (nextTabs.length <= 1) {
      setSecondaryActiveTab(null);
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

    const unsubscribePatchApplied = EventsOn(
      "ai:patch:artifact-applied",
      (event: AIPatchArtifactAppliedEvent) => {
        const files = Array.isArray(event?.files) ? event.files : [];
        if (files.length === 0) {
          return;
        }
        const affectedTabs = tabsRef.current.filter((tab) =>
          files.some((file) => {
            const path = file.absolutePath || file.path || "";
            return path && aiInlinePatchPathMatches(tab.path, path);
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
      },
    );

    return () => {
      unsubscribeRenamed();
      unsubscribeDeleted();
      unsubscribePatchApplied();
    };
  }, [
    applyDeletedProjectEntry,
    applyRenamedProjectEntry,
    projectPath,
    refreshAppliedPatchTab,
  ]);

  const handleTabsReorder = useCallback((nextTabs: Tab[]) => {
    tabsRef.current = nextTabs;
    setTabs(nextTabs);
  }, []);

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
    [onFileOpenInPanel],
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

    handleFileOpen({ file: createEditableEditorFileLoad(filePath, content) });
    if (highlightLine) {
      setHighlightLine(highlightLine);
      setTimeout(() => setHighlightLine(undefined), 3000);
    }
  };

  const notifyEditorSplitTransition = useCallback(() => {
    window.dispatchEvent(new CustomEvent("arlecchino:editor-split-transition"));
  }, []);

  const handleSplit = useCallback(
    (direction: "horizontal" | "vertical") => {
      notifyEditorSplitTransition();

      if (splitDirection) {
        // Close split
        setSplitDirection(null);
        setSecondaryActiveTab(null);
      } else if (activeTab && tabs.length > 1) {
        // Open split with second-to-last tab
        setSplitDirection(direction);
        const otherTab = tabs.find((t) => t.id !== activeTab);
        setSecondaryActiveTab(otherTab?.id || null);
      } else if (activeTab) {
        // Only one tab - open split with same file
        setSplitDirection(direction);
        setSecondaryActiveTab(activeTab);
      }
    },
    [activeTab, notifyEditorSplitTransition, splitDirection, tabs],
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
      setSplitDirection(direction);
      if (tabs.length > 1) {
        const otherTab = tabs.find((tab) => tab.id !== activeTab);
        setSecondaryActiveTab(otherTab?.id || activeTab);
        return;
      }

      setSecondaryActiveTab(activeTab);
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
    notifyEditorSplitTransition,
    secondaryActiveTab,
    splitDirection,
    tabs,
  ]);

  const handleCloseSplit = () => {
    setSplitDirection(null);
    setSecondaryActiveTab(null);
  };

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (contentStateFlushTimerRef.current) {
        clearTimeout(contentStateFlushTimerRef.current);
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
  }, []);

  const activeTabData = tabs.find((tab) => tab.id === activeTab);
  const activeMarkdownPreviewSource = buildMarkdownPreviewSource(activeTab);
  const secondaryTabData = secondaryActiveTab
    ? tabs.find((tab) => tab.id === secondaryActiveTab)
    : null;

  // Track if split is animating in
  const [splitReady, setSplitReady] = useState(false);

  useEffect(() => {
    if (splitDirection && secondaryTabData) {
      // Delay showing split pane to let Monaco initialize
      setSplitReady(false);
      const timer = setTimeout(() => {
        setSplitReady(true);
      }, 50);
      return () => clearTimeout(timer);
    }

    setSplitReady(false);
  }, [splitDirection, secondaryTabData]);

  const renderEditor = (tabData: Tab, content: string, isSecondary = false) => (
    <CodeMirrorEditor
      filePath={tabData.path}
      content={content}
      language={getLanguageFromPath(tabData.path)}
      onChange={isSecondary ? () => {} : handleContentChange}
      onSave={handleSaveFile}
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
      onEditorViewReady={isSecondary ? undefined : handleEditorViewReady}
      onHistoryAvailabilityChange={
        isSecondary ? undefined : handleHistoryAvailabilityChange
      }
      highlightLine={isSecondary ? undefined : highlightLine}
      aiInlinePatchPreview={selectAIInlinePatchPreviewForPath(
        aiInlinePatchPreviews,
        tabData.path,
      )}
      onAcceptAIInlinePatch={handleAcceptAIInlinePatch}
      onRejectAIInlinePatch={handleRejectAIInlinePatch}
      projectPath={projectPath}
    />
  );

  const renderEditorSurface = (tabData: Tab, isSecondary = false) => {
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
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {tabs.length > 0 && (
        <EditorTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabClick={setActiveTab}
          onTabClose={handleTabClose}
          onTabsReorder={handleTabsReorder}
          onTabDetachToPanel={handleTabDetachToPanel}
          onPanelSnapDragStart={onPanelSnapDragStart}
          onPanelSnapDragMove={onPanelSnapDragMove}
          onPanelSnapDragEnd={onPanelSnapDragEnd}
          onUndo={handleEditorUndo}
          onRedo={handleEditorRedo}
          canUndo={editorHistoryAvailability.canUndo}
          canRedo={editorHistoryAvailability.canRedo}
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

      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{ background: activeTabData ? editorBgColor : "transparent" }}
      >
        {activeTabData && activeTab ? (
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
                style={{
                  visibility: splitReady ? "visible" : "hidden",
                  background: editorBgColor,
                }}
              >
                <button
                  type="button"
                  onClick={handleCloseSplit}
                  onMouseDown={(event) => event.preventDefault()}
                  aria-label="Close split"
                  title="Close split"
                  className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 min-w-10 items-center justify-center rounded-[18px] border border-[var(--shell-border)] bg-[color-mix(in_srgb,var(--surface-shell-strong)_94%,transparent)] p-0 text-[var(--text-secondary)] shadow-[var(--shell-shadow)] backdrop-blur-xl transition-[background-color,border-color,color,box-shadow,transform] hover:border-[var(--shell-border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-active)_78%,transparent)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:shadow-[0_0_0_1px_var(--focus-ring),0_0_0_3px_var(--focus-ring-strong)]"
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
          activeTabId={activeTab}
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
