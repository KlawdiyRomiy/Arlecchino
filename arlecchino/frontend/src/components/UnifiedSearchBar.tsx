import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  Search,
  Terminal,
  FileText,
  Globe,
  Clock,
  Sparkles,
  Package,
  Settings,
  GitBranch,
  Pin,
  X,
  RefreshCw,
} from "lucide-react";
import { colors, getThemeColors, radius, shadows, transitions, zIndex } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { SuggestCommand, PredictCommand, SearchInProject } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

type Category = "artisan" | "composer" | "file" | "system" | "git";
type ResultKind = "command" | "file" | "search" | "tab" | "recent" | "ai" | Category;

interface Command {
  id: string;
  label: string;
  description?: string;
  category: Category;
  icon?: React.ReactNode;
  shortcut?: string;
  action: () => void | Promise<void>;
}

interface UnifiedResult {
  id: string;
  kind: ResultKind;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
  pending?: boolean;
  shortcut?: string;
  pinned?: boolean;
  category?: Category;
}

interface UnifiedSearchBarProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  onFileOpen: (path: string, line?: number) => void;
  artisanCommands?: Command[];
  composerCommands?: Command[];
  systemCommands?: Command[];
  openTabs?: Array<{ id: string; name: string; path: string }>;
  recentFiles?: string[];
  initialMode?: "all" | "search";
  onOpenSnippetsManager?: () => void;
}

const categoryColors: Record<string, string> = {
  artisan: "#A855F7",
  composer: "#F97316",
  file: "#3B82F6",
  system: "#6B7280",
  git: "#22C55E",
  search: "#10B981",
  tab: "#F59E0B",
  recent: "#8B5CF6",
};

const PINNED_COMMANDS_KEY = "arlecchino-pinned-commands";

const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true;
  try {
    const pattern = query.toLowerCase().split("").join(".*");
    return new RegExp(pattern).test(text.toLowerCase());
  } catch {
    return text.toLowerCase().includes(query.toLowerCase());
  }
};

function getCategoryIcon(category: Category): React.ReactNode {
  switch (category) {
    case "artisan": return <Terminal size={14} />;
    case "composer": return <Package size={14} />;
    case "system": return <Settings size={14} />;
    case "git": return <GitBranch size={14} />;
    case "file": return <FileText size={14} />;
    default: return <Settings size={14} />;
  }
}

export const UnifiedSearchBar: React.FC<UnifiedSearchBarProps> = ({
  isOpen,
  onClose,
  projectPath,
  onFileOpen,
  artisanCommands = [],
  composerCommands = [],
  systemCommands = [],
  openTabs = [],
  recentFiles = [],
  initialMode = "all",
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnifiedResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prediction, setPrediction] = useState<main.ClassResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Category | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; resultId: string } | null>(null);

  const resultsRef = useRef<UnifiedResult[]>([]);
  resultsRef.current = results;
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(true);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef("");
  const isSearchingRef = useRef(false);

  // Stable refs - update synchronously, no useEffect
  const onCloseRef = useRef(onClose);
  const onFileOpenRef = useRef(onFileOpen);
  onCloseRef.current = onClose;
  onFileOpenRef.current = onFileOpen;

  // Store commands in ref to avoid dependency issues
  const commandsRef = useRef<Command[]>([]);
  commandsRef.current = [...artisanCommands, ...composerCommands, ...systemCommands];

  // Store tabs/files in refs
  const openTabsRef = useRef(openTabs);
  const recentFilesRef = useRef(recentFiles);
  openTabsRef.current = openTabs;
  recentFilesRef.current = recentFiles;

  // Load pinned IDs once
  const pinnedIdsRef = useRef<string[]>([]);
  const loadedPinnedRef = useRef(false);
  if (!loadedPinnedRef.current) {
    try {
      const saved = localStorage.getItem(PINNED_COMMANDS_KEY);
      if (saved) pinnedIdsRef.current = JSON.parse(saved);
    } catch {}
    loadedPinnedRef.current = true;
  }

  const togglePin = useCallback((commandId: string) => {
    const current = pinnedIdsRef.current;
    pinnedIdsRef.current = current.includes(commandId)
      ? current.filter((id) => id !== commandId)
      : [...current, commandId];
    localStorage.setItem(PINNED_COMMANDS_KEY, JSON.stringify(pinnedIdsRef.current));
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  // Build results synchronously - no useEffect!
  // Build results - simplified logic:
  // - Empty query: show all commands (artisan, composer, git, system)
  // - /query: global file search only
  // - Any other text: search commands + files
  const buildResults = useCallback(async (searchQuery: string, filter: Category | null) => {
    if (isSearchingRef.current && lastQueryRef.current === searchQuery) return;
    
    // Cancel previous search
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    searchAbortRef.current = new AbortController();
    
    lastQueryRef.current = searchQuery;
    const newResults: UnifiedResult[] = [];
    const pinnedIds = pinnedIdsRef.current;
    
    const isFileSearchMode = searchQuery.startsWith("/");
    const cleanQuery = isFileSearchMode ? searchQuery.slice(1) : searchQuery;

    // ========== EMPTY QUERY: Show only pinned commands ==========
    if (!searchQuery.trim() && !filter) {
      // Pinned commands only
      commandsRef.current.filter((c) => pinnedIds.includes(c.id)).forEach((cmd) => {
        newResults.push({
          id: `pinned-${cmd.id}`,
          kind: cmd.category,
          title: cmd.label,
          subtitle: cmd.description,
          icon: cmd.icon || getCategoryIcon(cmd.category),
          shortcut: cmd.shortcut,
          pinned: true,
          category: cmd.category,
          action: async () => { await cmd.action(); onCloseRef.current?.(); },
        });
      });

      setResults(newResults);
      setSelectedIndex(0);
      return;
    }

    // ========== FILE SEARCH MODE (/query) ==========
    if (isFileSearchMode) {
      if (cleanQuery.length < 2) {
        setResults([]);
        setSelectedIndex(0);
        return;
      }

      setIsLoading(true);
      isSearchingRef.current = true;
      try {
        const searchResults = await SearchInProject(cleanQuery, caseSensitive, false, wholeWord);
        if (lastQueryRef.current !== searchQuery) return;
        
        searchResults?.forEach((r, i) => {
          newResults.push({
            id: `search-${i}`,
            kind: "search",
            title: r.file.split("/").pop() || r.file,
            subtitle: `Line ${r.line}: ${r.preview.trim()}`,
            icon: <FileText size={14} />,
            action: () => { onFileOpenRef.current?.(r.file, r.line); onCloseRef.current?.(); },
          });
        });
      } catch {}
      setIsLoading(false);
      isSearchingRef.current = false;
      setResults(newResults);
      setSelectedIndex(0);
      return;
    }

    // ========== NORMAL SEARCH: Commands + Files ==========
    
    // Filter commands by query
    let filteredCommands = commandsRef.current.filter((c) =>
      fuzzyMatch(c.label, cleanQuery) || fuzzyMatch(c.description || "", cleanQuery)
    );
    if (filter) {
      filteredCommands = filteredCommands.filter((c) => c.category === filter);
    }

    // Sort: pinned first
    filteredCommands.sort((a, b) => {
      const aPinned = pinnedIds.includes(a.id);
      const bPinned = pinnedIds.includes(b.id);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });

    filteredCommands.slice(0, 15).forEach((cmd) => {
      newResults.push({
        id: `cmd-${cmd.id}`,
        kind: cmd.category,
        title: cmd.label,
        subtitle: cmd.description,
        icon: cmd.icon || getCategoryIcon(cmd.category),
        shortcut: cmd.shortcut,
        pinned: pinnedIds.includes(cmd.id),
        category: cmd.category,
        action: async () => { await cmd.action(); onCloseRef.current?.(); },
      });
    });

    // Add file search results
    if (projectPath && cleanQuery.length >= 2) {
      setIsLoading(true);
      try {
        const searchResults = await SearchInProject(cleanQuery, false, false, false);
        if (lastQueryRef.current !== searchQuery) return;
        
        const maxFiles = newResults.length < 5 ? 10 : 5;
        searchResults?.slice(0, maxFiles).forEach((r, i) => {
          newResults.push({
            id: `file-${i}`,
            kind: "search",
            title: r.file.split("/").pop() || r.file,
            subtitle: `Line ${r.line}: ${r.preview.trim()}`,
            icon: <FileText size={14} />,
            action: () => { onFileOpenRef.current?.(r.file, r.line); onCloseRef.current?.(); },
          });
        });
      } catch {}
      setIsLoading(false);
    }

    setResults(newResults);
    setSelectedIndex(0);
  }, [projectPath, caseSensitive, wholeWord]);

  // Handle query change with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
    
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      buildResults(newQuery, activeFilter);
    }, 150);
  }, [activeFilter, buildResults]);

  // Handle filter change
  const handleFilterChange = useCallback((filter: Category | null) => {
    setActiveFilter(filter);
    buildResults(query, filter);
  }, [query, buildResults]);

  // Handle open/close
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current) {
    // Just opened
    wasOpenRef.current = true;
    const initialQuery = initialMode === "search" ? "/" : "";
    setQuery(initialQuery);
    setResults([]);
    setSelectedIndex(0);
    setPrediction(null);
    setActiveFilter(null);
    setContextMenu(null);  // Reset context menu on open
    lastQueryRef.current = "";
    setTimeout(() => {
      inputRef.current?.focus();
      buildResults(initialQuery, null);
    }, 50);
  } else if (!isOpen && wasOpenRef.current) {
    wasOpenRef.current = false;
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentResults = resultsRef.current;
    
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
      e.preventDefault();
      const selected = currentResults[selectedIndex];
      if (selected && (selected.id.startsWith("cmd-") || selected.id.startsWith("pinned-"))) {
        togglePin(selected.id.replace(/^(cmd-|pinned-)/, ""));
        buildResults(query, activeFilter);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < currentResults.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : currentResults.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        currentResults[selectedIndex]?.action();
        break;
      case "Escape":
        e.preventDefault();
        if (contextMenu) {
          setContextMenu(null);  // First close context menu
        } else {
          onClose();  // Then close dialog
        }
        break;
    }
  }, [selectedIndex, onClose, togglePin, query, activeFilter, buildResults, contextMenu]);

  // Scroll selected into view
  const scrollSelectedIntoView = useCallback(() => {
    listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  
  // Call scroll after render
  useMemo(() => {
    setTimeout(scrollSelectedIntoView, 0);
  }, [selectedIndex, scrollSelectedIntoView]);

  if (!isOpen) return null;

  const filters: { key: Category; label: string }[] = [
    { key: "artisan", label: "Artisan" },
    { key: "composer", label: "Composer" },
    { key: "system", label: "System" },
    { key: "git", label: "Git" },
  ];

  const isSearchQuery = query.startsWith("/");
  const isArtisanQuery = query.startsWith(">") || query.startsWith("php artisan") || query.startsWith("artisan");

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: isDark ? "rgba(30,30,30,0.85)" : "rgba(120,120,120,0.5)",
        zIndex: zIndex.modal,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "580px",
          backgroundColor: isDark ? "#242424" : "#f5f5f5",
          borderRadius: radius.lg,
          boxShadow: shadows.floating,
          overflow: "hidden",
          border: `1px solid ${isDark ? "#404040" : "#d4d4d4"}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderBottom: `1px solid ${isDark ? "#333" : "#ddd"}` }}>
          {isLoading ? (
            <RefreshCw size={18} style={{ color: theme.textMuted, animation: "spin 1s linear infinite" }} />
          ) : (
            <Search size={18} style={{ color: theme.textMuted }} />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isSearchQuery ? "Search in project..." : "Search commands, files..."}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              fontSize: "15px",
              color: theme.text,
            }}
          />
          {query && (
            <button onClick={() => handleQueryChange("")} style={{ padding: "4px", background: "none", border: "none", cursor: "pointer", color: theme.textMuted }}>
              <X size={16} />
            </button>
          )}
        </div>

        {!isSearchQuery && !isArtisanQuery && (
          <div style={{ display: "flex", gap: "6px", padding: "8px 16px", borderBottom: `1px solid ${isDark ? "#333" : "#ddd"}`, flexWrap: "wrap" }}>
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => handleFilterChange(activeFilter === f.key ? null : f.key)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  borderRadius: radius.sm,
                  border: `1px solid ${activeFilter === f.key ? categoryColors[f.key] : isDark ? "#444" : "#ccc"}`,
                  backgroundColor: activeFilter === f.key ? `${categoryColors[f.key]}20` : "transparent",
                  color: activeFilter === f.key ? categoryColors[f.key] : theme.textMuted,
                  cursor: "pointer",
                  transition: transitions.fast,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {isSearchQuery && (
          <div style={{ display: "flex", gap: "16px", padding: "8px 16px", borderBottom: `1px solid ${isDark ? "#333" : "#ddd"}`, fontSize: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: theme.textSecondary }}>
              <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
              Whole Word
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: theme.textSecondary }}>
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              Case Sensitive
            </label>
          </div>
        )}

        <div ref={listRef} style={{ maxHeight: "360px", overflowY: "auto" }}>
          {isLoading && results.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: theme.textMuted }}>Searching...</div>
          ) : results.length === 0 && query.trim() ? (
            <div style={{ padding: "20px", textAlign: "center", color: theme.textMuted }}>No results</div>
          ) : (
            results.map((result, index) => (
              <div
                key={result.id}
                data-index={index}
                onClick={result.action}
                onMouseEnter={() => setSelectedIndex(index)}
                onContextMenu={(e) => {
                  if (result.id.startsWith("cmd-") || result.id.startsWith("pinned-")) {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, resultId: result.id });
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 16px",
                  cursor: "pointer",
                  backgroundColor: index === selectedIndex
                    ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")
                    : "transparent",
                  transition: transitions.fast,
                }}
              >
                <div style={{
                  width: "26px",
                  height: "26px",
                  borderRadius: radius.sm,
                  backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: categoryColors[result.category || result.kind] || theme.textMuted,
                }}>
                  {result.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 500, color: theme.text }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.title}</span>
                    {result.pinned && <Pin size={11} style={{ color: colors.laravel.orange }} />}
                  </div>
                  {result.subtitle && (
                    <div style={{ fontSize: "12px", color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {result.subtitle}
                    </div>
                  )}
                </div>
                {result.shortcut && (
                  <div style={{ display: "flex", gap: "2px" }}>
                    {result.shortcut.split("+").map((k, i) => (
                      <kbd key={i} style={{ padding: "2px 5px", fontSize: "10px", backgroundColor: isDark ? "#333" : "#e5e5e5", borderRadius: "3px", color: theme.textMuted }}>{k}</kbd>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer with keyboard hints */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderTop: `1px solid ${isDark ? "#333" : "#ddd"}`,
          fontSize: "11px",
          color: theme.textMuted,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span><kbd style={{ padding: "2px 5px", backgroundColor: isDark ? "#333" : "#e5e5e5", borderRadius: "3px", marginRight: "4px" }}>↑↓</kbd> Navigate</span>
            <span><kbd style={{ padding: "2px 5px", backgroundColor: isDark ? "#333" : "#e5e5e5", borderRadius: "3px", marginRight: "4px" }}>↵</kbd> Execute</span>
            <span><kbd style={{ padding: "2px 5px", backgroundColor: isDark ? "#333" : "#e5e5e5", borderRadius: "3px", marginRight: "4px" }}>⌘P</kbd> Pin</span>
            <span><kbd style={{ padding: "2px 5px", backgroundColor: isDark ? "#333" : "#e5e5e5", borderRadius: "3px", marginRight: "4px" }}>esc</kbd> Close</span>
          </div>
          <span>{results.length} items</span>
        </div>
      </div>

      {/* Context Menu for Pin/Unpin */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: isDark ? "#2a2a2a" : "#fff",
            border: `1px solid ${isDark ? "#444" : "#ddd"}`,
            borderRadius: radius.md,
            boxShadow: shadows.lg,
            zIndex: zIndex.tooltip,
            padding: "4px",
            minWidth: "120px",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              fontSize: "13px",
              color: theme.text,
              cursor: "pointer",
              borderRadius: radius.sm,
            }}
            onClick={() => {
              const cmdId = contextMenu.resultId.replace(/^(cmd-|pinned-)/, "");
              togglePin(cmdId);
              setContextMenu(null);
              buildResults(query, activeFilter);
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.backgroundColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.backgroundColor = "transparent";
            }}
          >
            <Pin size={14} />
            <span>{pinnedIdsRef.current.includes(contextMenu.resultId.replace(/^(cmd-|pinned-)/, "")) ? "Unpin" : "Pin"}</span>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
