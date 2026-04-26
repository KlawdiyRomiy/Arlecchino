import React, { useState, useEffect, useCallback, useRef } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { EditorTabs, Tab } from "./EditorTabs";
import { TabSwitcherOverlay } from "./TabSwitcherOverlay";
import QuickLookModal from "./QuickLookModal";
import * as AppFunctions from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { useProjectEntryActions } from "../contexts/ProjectEntryActionsContext";
import { shortcuts } from "../utils/keyboard";
import {
  PROJECT_SWITCH_BLOCKERS,
  blockProjectSwitch,
  unblockProjectSwitch,
} from "../utils/priorityUI";
import { useTheme } from "../hooks/useTheme";
import { makeEditorTabId, useEditorStore } from "../stores/editorStore";
import { editorCanvasBackground } from "../utils/codeMirrorTheme";
import { type ContextActionMenuItem } from "./ui/ContextActionMenu";
import {
  getProjectPathBasename,
  isSameOrChildPath,
  normalizeProjectPath,
  remapProjectPathPrefix,
} from "../utils/projectPaths";

type SplitDirection = "horizontal" | "vertical" | null;

type EditorFileOpenHandler = (
  path: string,
  content: string,
  name: string,
  line?: number,
) => void;

interface ProjectScreenProps {
  projectPath: string;
  fileToOpen?: {
    path: string;
    content: string;
    name: string;
    line?: number;
  } | null;
  onFileOpened?: () => void;
  onToggleProblems?: () => void;
  onPerspectiveOpen?: () => void;
  onPerspectiveClose?: () => void;
  onEditorFileOpenReady?: (handler: EditorFileOpenHandler | null) => void;
}

const AUTO_SAVE_DELAY = 1500;

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

const ProjectScreen: React.FC<ProjectScreenProps> = ({
  projectPath,
  fileToOpen,
  onFileOpened,
  onToggleProblems,
  onPerspectiveOpen,
  onPerspectiveClose,
  onEditorFileOpenReady,
}) => {
  const { isDark } = useTheme();
  const editorBgColor = isDark ? editorCanvasBackground : "#ffffff";
  const setStatusFile = useEditorStore((state) => state.setStatusFile);
  const activeEditorPaneId = useEditorStore((state) => state.activePaneId);
  const syncEditorStoreActiveTab = useEditorStore(
    (state) => state.syncActiveTab,
  );
  const closeEditorStoreTabPath = useEditorStore((state) => state.closePath);
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
  const tabsRef = useRef<Tab[]>([]);
  const fileContentsRef = useRef<Record<string, string>>({});
  const activeTabRef = useRef<string | null>(activeTab);
  const secondaryActiveTabRef = useRef<string | null>(secondaryActiveTab);
  const openFileRequestRef = useRef(0);
  const quickLookRequestRef = useRef(0);
  const reopenClosedTabRequestRef = useRef(0);
  const tabSwitcherSelectionRef = useRef<string | null>(null);
  const [isTabSwitcherOpen, setIsTabSwitcherOpen] = useState(false);
  const [tabSwitcherSelection, setTabSwitcherSelectionState] = useState<
    string | null
  >(null);

  const setTabSwitcherSelection = useCallback((tabId: string | null) => {
    tabSwitcherSelectionRef.current = tabId;
    setTabSwitcherSelectionState(tabId);
  }, []);

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
      restoredTabs.map((tab) => AppFunctions.ReadFile(tab.path)),
    ).then((results) => {
      if (cancelled) return;

      const currentTabIds = new Set(tabsRef.current.map((tab) => tab.id));
      const loaded: Record<string, string> = {};
      const invalidIds = new Set<string>();

      restoredTabs.forEach((tab, i) => {
        if (!currentTabIds.has(tab.id)) {
          return;
        }
        if (results[i].status === "fulfilled") {
          loaded[tab.id] = (results[i] as PromiseFulfilledResult<string>).value;
        } else {
          invalidIds.add(tab.id);
        }
      });

      setFileContents((prev) => ({ ...prev, ...loaded }));

      if (invalidIds.size > 0) {
        setTabs((prev) => prev.filter((t) => !invalidIds.has(t.id)));
        setActiveTab((prev) =>
          prev && invalidIds.has(prev)
            ? (tabsRef.current.filter((t) => !invalidIds.has(t.id)).pop()?.id ??
              null)
            : prev,
        );
      }
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
    const fileKey = `${fileToOpen.path}:${fileToOpen.line || 0}`;
    if (lastFileToOpenRef.current === fileKey) return;
    lastFileToOpenRef.current = fileKey;

    handleFileOpen(fileToOpen.path, fileToOpen.content, fileToOpen.name);
    if (fileToOpen.line) {
      setHighlightLine(fileToOpen.line);
      setTimeout(() => setHighlightLine(undefined), 3000);
    }
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
        if (activeTab) {
          handleTabClose(activeTab);
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

  const getLanguageFromPath = (path: string): string => {
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
  };

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
    const content = fileContents[statusTab.id];
    if (content === undefined) {
      setStatusFile(statusTab.path, statusTab.label, language);
      return;
    }

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
    secondaryActiveTab,
    setStatusFile,
    syncEditorStoreActiveTab,
    tabs,
  ]);

  const handleFileOpen = useCallback(
    (filePath: string, content: string, fileName: string, line?: number) => {
      const tabId = makeEditorTabId(filePath);
      const existingTab = tabsRef.current.find((tab) => tab.path === filePath);
      if (existingTab) {
        setActiveTab(existingTab.id);
        if (line) {
          setHighlightLine(line);
          window.setTimeout(() => setHighlightLine(undefined), 3000);
        }
        return;
      }

      const newTab: Tab = {
        id: tabId,
        label: fileName,
        path: filePath,
        isDirty: false,
      };

      setFileContents((prev) => ({ ...prev, [tabId]: content }));
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
    [],
  );

  useEffect(() => {
    onEditorFileOpenReady?.(handleFileOpen);
    return () => {
      onEditorFileOpenReady?.(null);
    };
  }, [handleFileOpen, onEditorFileOpenReady]);

  useEffect(() => {
    setHighlightLine(undefined);
  }, [activeTab]);

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

    if (activeTab === tabId) {
      setActiveTab(
        updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1].id : null,
      );
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
    setActiveTab(tabId);
    setSecondaryActiveTab(null);
    setSplitDirection(null);
  }, []);

  const handleCloseAllTabs = useCallback(() => {
    openFileRequestRef.current += 1;
    tabsRef.current.forEach((tab) => closeEditorStoreTabPath(tab.path));
    setTabs([]);
    setFileContents({});
    setActiveTab(null);
    setSecondaryActiveTab(null);
    setSplitDirection(null);
  }, [closeEditorStoreTabPath]);

  const handleReopenClosedTab = async () => {
    if (closedTabs.length === 0) return;

    const [lastClosedTab, ...remainingClosedTabs] = closedTabs;
    setClosedTabs(remainingClosedTabs);
    const requestId = reopenClosedTabRequestRef.current + 1;
    reopenClosedTabRequestRef.current = requestId;

    try {
      const content = await AppFunctions.ReadFile(lastClosedTab.path);
      if (reopenClosedTabRequestRef.current !== requestId) {
        return;
      }
      handleFileOpen(lastClosedTab.path, content, lastClosedTab.label);
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
      console.log("Auto-saving:", tab.path);
      await AppFunctions.WriteFile(tab.path, content);
      setTabs((prevTabs) =>
        prevTabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
      );
      console.log("Auto-saved successfully:", tab.path);
    } catch (error) {
      console.error("Auto-save error:", error);
    }
  }, []);

  const scheduleAutoSave = useCallback(
    (tabId: string) => {
      console.log("Scheduling auto-save for:", tabId);
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      autoSaveTimerRef.current = setTimeout(() => {
        console.log("Auto-save timer triggered for:", tabId);
        autoSaveFile(tabId);
      }, AUTO_SAVE_DELAY);
    },
    [autoSaveFile],
  );

  const handleContentChange = (value: string | undefined) => {
    if (!activeTab || value === undefined) return;

    console.log("Content changed for tab:", activeTab);

    setFileContents((prev) => ({
      ...prev,
      [activeTab]: value,
    }));

    setTabs((prevTabs) =>
      prevTabs.map((tab) =>
        tab.id === activeTab ? { ...tab, isDirty: true } : tab,
      ),
    );

    scheduleAutoSave(activeTab);
  };

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
      let contentToSave = fileContents[activeTab];

      // Try to format code before saving
      try {
        const formatted = await AppFunctions.FormatCode(
          tab.path,
          contentToSave,
        );
        if (formatted && formatted !== contentToSave) {
          console.log("File formatted successfully");
          contentToSave = formatted;
          // Update editor content with formatted version
          setFileContents((prev) => ({
            ...prev,
            [activeTab]: formatted,
          }));
        }
      } catch (formatError) {
        // If formatting fails, continue with original content
        console.warn("Prettier formatting failed:", formatError);
      }

      await AppFunctions.WriteFile(tab.path, contentToSave);
      setTabs(
        tabs.map((t) => (t.id === activeTab ? { ...t, isDirty: false } : t)),
      );
      console.log("File saved:", tab.path);

      window.dispatchEvent(
        new CustomEvent("file-saved", { detail: { path: tab.path } }),
      );
    } catch (error) {
      console.error("Error saving file:", error);
      alert(`Failed to save file: ${error}`);
    } finally {
      setIsSaving(false);
    }
  }, [activeTab, tabs, fileContents, isSaving]);

  const handleOpenFileRequest = async (path: string, line?: number) => {
    const requestId = openFileRequestRef.current + 1;
    openFileRequestRef.current = requestId;

    try {
      let fullPath = path;
      if (!path.startsWith("/") && projectPath) {
        fullPath = `${projectPath}/${path}`;
      }

      const content = await AppFunctions.ReadFile(fullPath);
      if (openFileRequestRef.current !== requestId) {
        return;
      }
      const name = path.split("/").pop() || "unknown";
      handleFileOpen(fullPath, content, name);
      if (line) {
        setHighlightLine(line);
        setTimeout(() => setHighlightLine(undefined), 3000);
      }
    } catch (error) {
      if (openFileRequestRef.current === requestId) {
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

    return () => {
      unsubscribeRenamed();
      unsubscribeDeleted();
    };
  }, [applyDeletedProjectEntry, applyRenamedProjectEntry, projectPath]);

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

      const content = await AppFunctions.ReadFile(fullPath);
      if (quickLookRequestRef.current !== requestId) {
        return;
      }
      const language = getLanguageFromPath(fullPath);

      blockProjectSwitch(PROJECT_SWITCH_BLOCKERS.quickLook);
      setQuickLook({
        isOpen: true,
        filePath: fullPath,
        content,
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

    handleFileOpen(filePath, content, name);
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
    };
  }, []);

  const activeTabData = tabs.find((tab) => tab.id === activeTab);
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
      onTyping={(chars) => {
        AppFunctions.RecordTypingActivity(chars).catch(() => {});
      }}
      onGhostShown={() => {
        AppFunctions.RecordGhostShown().catch(() => {});
      }}
      onGhostRejected={() => {
        AppFunctions.RecordGhostRejected().catch(() => {});
      }}
      highlightLine={isSecondary ? undefined : highlightLine}
      projectPath={projectPath}
    />
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {tabs.length > 0 && (
        <EditorTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabClick={setActiveTab}
          onTabClose={handleTabClose}
          onSplitHorizontal={() => handleSplit("vertical")}
          onSplitVertical={() => handleSplit("horizontal")}
          getTabContextMenuItems={buildTabContextMenuItems}
        />
      )}

      <div
        className="flex-1 min-h-0 overflow-hidden"
        style={{ background: activeTabData ? editorBgColor : "transparent" }}
      >
        {activeTabData && activeTab && activeTab in fileContents ? (
          splitDirection && secondaryTabData ? (
            <div
              className={`flex h-full ${splitDirection === "horizontal" ? "flex-row" : "flex-col"}`}
              style={{ background: editorBgColor }}
            >
              <div
                className={`${splitDirection === "horizontal" ? "w-1/2 border-r" : "h-1/2 border-b"} border-gray-200 dark:border-gray-700`}
              >
                {renderEditor(activeTabData, fileContents[activeTab!] || "")}
              </div>
              <div
                className={`${splitDirection === "horizontal" ? "w-1/2" : "h-1/2"} relative`}
                style={{
                  visibility: splitReady ? "visible" : "hidden",
                  background: editorBgColor,
                }}
              >
                <button
                  onClick={handleCloseSplit}
                  className="absolute top-2 right-2 z-10 p-1 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
                  title="Close split"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
                {renderEditor(
                  secondaryTabData,
                  fileContents[secondaryActiveTab!] || "",
                  true,
                )}
              </div>
            </div>
          ) : (
            renderEditor(activeTabData, fileContents[activeTab!] || "")
          )
        ) : (
          <div className="h-full w-full" />
        )}
      </div>

      {isSaving && (
        <div className="absolute bottom-8 right-4 px-3 py-1 bg-blue-500 text-white text-sm rounded-full shadow-lg">
          Saving...
        </div>
      )}

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
