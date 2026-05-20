import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  Terminal,
  FileText,
  Hash,
  Sparkles,
  AtSign,
  Clock,
  Pin,
  GitBranch,
  Settings,
  Folder,
  FolderOpen,
  Play,
  Bug,
  Copy,
  X,
  AlertCircle,
  Code,
  Box,
  Layers,
  Database,
  Navigation,
} from "lucide-react";
import {
  SearchFiles,
  SearchContent,
  SearchSymbols,
  GetDispatcherSuggestions,
  ExpandTag,
  GetTerminalPreview,
  PredictTerminalCommand,
  GetTerminalHistory,
} from "../wails/app";

interface DispatcherItem {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action: string;
  actionLabel?: string;
  score?: number;
  filePath?: string;
  line?: number;
}

interface DispatcherResult {
  success: boolean;
  output: string;
  error: string;
  resultType: number;
  items: DispatcherItem[];
  preview: string;
  shouldClose: boolean;
}

interface CommandDispatcherProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (input: string, type: string) => void;
  onOpenFile?: (path: string, line?: number) => void;
  onTerminalCommand?: (command: string) => void;
  pinnedItems?: string[];
  recentItems?: string[];
  projectPath?: string;
}

const dispatcherErrorItem = (
  id: string,
  title: string,
  error: unknown,
): DispatcherItem => ({
  id,
  icon: <AlertCircle size={16} />,
  title,
  subtitle: error instanceof Error ? error.message : String(error),
  action: "error",
});

const backendSearchAction = (action: string | undefined): string =>
  action === "error" ? "error" : "open";

type InputMode = "default" | "ide" | "file" | "grep" | "symbol" | "ai" | "tag";

interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
}

const GREP_QUOTE_CLOSERS: Record<string, string> = {
  '"': '"',
  "'": "'",
  "“": "”",
  "”": "”",
  "„": "“",
  "‟": "”",
  "«": "»",
  "»": "»",
  "‘": "’",
  "’": "’",
  "‚": "‘",
  "‛": "’",
};

const getGrepQuotePrefix = (input: string): string | null => {
  const [prefix] = input;
  return prefix && prefix in GREP_QUOTE_CLOSERS ? prefix : null;
};

const stripGrepQuotePrefix = (input: string): string => {
  const prefix = getGrepQuotePrefix(input);
  if (!prefix) return input;

  const closingQuote = GREP_QUOTE_CLOSERS[prefix];
  const query = input.slice(prefix.length);
  return query.endsWith(closingQuote)
    ? query.slice(0, -closingQuote.length)
    : query;
};

const parseAnsi = (text: string): AnsiSpan[] => {
  const spans: AnsiSpan[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let currentBold = false;

  const colorMap: Record<string, string> = {
    "30": "#1a1a1a",
    "31": "#888888",
    "32": "#22c55e",
    "33": "#eab308",
    "34": "#3b82f6",
    "35": "#a855f7",
    "36": "#06b6d4",
    "37": "#e5e5e5",
    "90": "#737373",
    "91": "#aaaaaa",
    "92": "#4ade80",
    "93": "#facc15",
    "94": "#60a5fa",
    "95": "#c084fc",
    "96": "#22d3ee",
    "97": "#ffffff",
  };

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      if (segment)
        spans.push({ text: segment, color: currentColor, bold: currentBold });
    }
    const codes = match[1].split(";");
    for (const code of codes) {
      if (code === "0" || code === "") {
        currentColor = undefined;
        currentBold = false;
      } else if (code === "1") {
        currentBold = true;
      } else if (colorMap[code]) {
        currentColor = colorMap[code];
      }
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    spans.push({
      text: text.slice(lastIndex),
      color: currentColor,
      bold: currentBold,
    });
  }

  return spans.length ? spans : [{ text }];
};

const getModeFromInput = (input: string): InputMode => {
  if (input.startsWith(">>")) return "file";
  if (input.startsWith(">")) return "ide";
  if (getGrepQuotePrefix(input)) return "grep";
  if (input.startsWith("#")) return "symbol";
  if (input.startsWith("@ai ")) return "ai";
  if (input.startsWith("@")) return "tag";
  return "default";
};

const modeLabels: Record<InputMode, string> = {
  default: "Search",
  ide: "Command",
  file: "Files",
  grep: "Grep",
  symbol: "Symbols",
  ai: "Agent",
  tag: "Tag",
};

const modeHints: Partial<Record<InputMode, string>> = {
  ide: "> command",
  file: ">> files",
  grep: '" text',
  symbol: "# symbol",
  ai: "@ai",
  tag: "@ tag",
};

export const CommandDispatcher: React.FC<CommandDispatcherProps> = ({
  isOpen,
  onClose,
  onExecute,
  onOpenFile,
  onTerminalCommand,
  pinnedItems = [],
  recentItems = [],
  projectPath = "",
}) => {
  const [input, setInput] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<DispatcherItem[]>([]);
  const [preview, setPreview] = useState("");
  const [ghostText, setGhostText] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    output: string;
    error: string;
    success: boolean;
    command: string;
  } | null>(null);
  const [historyList, setHistoryList] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const mode = getModeFromInput(input);
  const hasResults = items.length > 0;

  const isTerminalMode = mode === "tag" && /^@t\s/i.test(input);
  const activeModeLabel = isTerminalMode ? "Terminal" : modeLabels[mode];
  const terminalCommand = isTerminalMode
    ? input.replace(/^@t\s+/i, "").trim()
    : "";

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setInput("");
      setSelectedIndex(0);
      setItems([]);
      setGhostText("");
      setIsExecuting(false);
      setExecutionResult(null);
      setHistoryIndex(-1);
      setSavedInput("");

      const loadHistory = async () => {
        const localHistory = JSON.parse(
          localStorage.getItem("dispatcher_history") || "[]",
        ) as string[];

        try {
          const shellHistory = await GetTerminalHistory(100);
          const terminalCommands = (shellHistory || []).map(
            (cmd: string) => "@t " + cmd,
          );
          const combined = [...localHistory, ...terminalCommands];
          const unique = [...new Set(combined)];
          setHistoryList(unique);
        } catch {
          setHistoryList(localHistory);
        }
      };

      loadHistory();
    }
  }, [isOpen]);

  // Debounced terminal prediction
  useEffect(() => {
    if (!isTerminalMode) {
      return;
    }

    if (terminalCommand.length < 1) {
      setGhostText("");
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const response = await PredictTerminalCommand({
          input: terminalCommand,
          workDir: projectPath,
          projectID: "",
        });

        if (response.predictions && response.predictions.length > 0) {
          const prediction = response.predictions[0];
          const completion = prediction.Completion || "";

          if (completion && completion !== terminalCommand) {
            setGhostText(completion);
          } else {
            setGhostText("");
          }
        } else {
          setGhostText("");
        }
      } catch (e) {
        console.error("[Dispatcher] PredictTerminalCommand error:", e);
        setGhostText("");
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [isTerminalMode, terminalCommand]);

  // Clear items and preview when entering terminal mode
  useEffect(() => {
    if (isTerminalMode) {
      setItems([]);
      setPreview("");
    }
  }, [isTerminalMode]);

  useEffect(() => {
    // Skip items loading entirely in terminal mode
    if (isTerminalMode) {
      return;
    }

    // Skip items loading when navigating history
    if (historyIndex !== -1) {
      setItems([]);
      return;
    }

    const loadItems = async () => {
      const newItems: DispatcherItem[] = [];

      if (input !== "") {
        switch (mode) {
          case "ide":
            try {
              const ideActions = await GetDispatcherSuggestions(input);
              ideActions?.forEach((action, i) => {
                newItems.push({
                  id: `ide-${i}`,
                  icon: getIconForBackendItem(action.icon || "terminal"),
                  title: action.title,
                  subtitle: action.subtitle,
                  action: "ide",
                });
              });
            } catch (e) {
              console.error("[Dispatcher] GetDispatcherSuggestions error:", e);
              newItems.push(
                dispatcherErrorItem("ide-error", "Command search failed", e),
              );
            }
            break;
          case "file":
            try {
              const files = await SearchFiles(input.slice(2).trim());
              files?.forEach((f, i) => {
                newItems.push({
                  id: `file-${i}`,
                  icon: <FileText size={16} />,
                  title: f.title,
                  subtitle: f.subtitle,
                  action: backendSearchAction(f.action),
                  filePath: f.filePath,
                  line: f.line,
                });
              });
            } catch (e) {
              console.error("[Dispatcher] SearchFiles error:", e);
              newItems.push(
                dispatcherErrorItem("file-error", "File search failed", e),
              );
            }
            break;
          case "grep":
            try {
              const query = stripGrepQuotePrefix(input);
              const results = await SearchContent(query);
              results?.forEach((r, i) => {
                newItems.push({
                  id: `grep-${i}`,
                  icon: <FileText size={16} />,
                  title: r.title,
                  subtitle: r.subtitle,
                  action: backendSearchAction(r.action),
                  filePath: r.filePath,
                  line: r.line,
                });
              });
            } catch (e) {
              console.error("[Dispatcher] SearchContent error:", e);
              newItems.push(
                dispatcherErrorItem("grep-error", "Content search failed", e),
              );
            }
            break;
          case "symbol":
            try {
              const symbols = await SearchSymbols(input.slice(1).trim());
              symbols?.forEach((s, i) => {
                newItems.push({
                  id: `symbol-${i}`,
                  icon: getSymbolIcon(s.icon),
                  title: s.title,
                  subtitle: s.subtitle,
                  action: "goto",
                  filePath: s.filePath,
                  line: s.line,
                });
              });
            } catch (e) {
              console.error("[Dispatcher] SearchSymbols error:", e);
              newItems.push(
                dispatcherErrorItem("symbol-error", "Symbol search failed", e),
              );
            }
            break;
          default:
            if (input.length >= 2) {
              try {
                const [files, content] = await Promise.all([
                  SearchFiles(input),
                  SearchContent(input),
                ]);

                files?.slice(0, 10).forEach((f, i) => {
                  newItems.push({
                    id: `file-${i}`,
                    icon: <FileText size={16} />,
                    title: f.title,
                    subtitle: f.subtitle,
                    action: backendSearchAction(f.action),
                    filePath: f.filePath,
                    line: f.line,
                  });
                });

                content?.slice(0, 10).forEach((r, i) => {
                  newItems.push({
                    id: `content-${i}`,
                    icon: <Search size={16} />,
                    title: r.title,
                    subtitle: r.subtitle,
                    action: backendSearchAction(r.action),
                    filePath: r.filePath,
                    line: r.line,
                  });
                });
              } catch (e) {
                console.error("[Dispatcher] Search error:", e);
                newItems.push(
                  dispatcherErrorItem("search-error", "Search failed", e),
                );
              }
            }
        }
      }

      setItems(newItems);
      setSelectedIndex(0);

      if (mode === "tag" && input.startsWith("@")) {
        try {
          const expanded = await ExpandTag(input);
          setPreview(expanded !== input ? expanded : "");
        } catch {
          setPreview("");
        }
      } else {
        setPreview("");
      }
    };

    loadItems();
  }, [input, mode, pinnedItems, recentItems, isTerminalMode, historyIndex]);

  const isTerminalCommand = (item: DispatcherItem) =>
    item.action === "execute" && !item.filePath;

  useEffect(() => {
    const selectedItem = items[selectedIndex];
    if (!selectedItem || mode === "tag" || isExecuting || executionResult)
      return;

    if (isTerminalCommand(selectedItem)) {
      GetTerminalPreview(selectedItem.title)
        .then((result) => setPreview(result?.output || ""))
        .catch(() => setPreview(""));
    }
  }, [selectedIndex, items, mode, isExecuting, executionResult]);

  useEffect(() => {
    if (!executionResult) return;

    const timer = setTimeout(() => {
      if (onTerminalCommand) {
        onTerminalCommand(executionResult.command);
      }
      onClose();
    }, 2000);

    return () => clearTimeout(timer);
  }, [executionResult, onTerminalCommand, onClose]);

  const getSymbolIcon = (iconName: string): React.ReactNode => {
    switch (iconName) {
      case "box":
        return <Box size={16} />;
      case "layers":
        return <Layers size={16} />;
      case "code":
        return <Code size={16} />;
      case "database":
        return <Database size={16} />;
      case "navigation":
        return <Navigation size={16} />;
      case "hash":
        return <Hash size={16} />;
      default:
        return <Code size={16} />;
    }
  };

  const getIconForBackendItem = (iconName: string): React.ReactNode => {
    switch (iconName) {
      case "terminal":
        return <Terminal size={16} />;
      case "clock":
        return <Clock size={16} />;
      case "git-branch":
        return <GitBranch size={16} />;
      case "sparkles":
        return <Sparkles size={16} />;
      case "folder":
        return <Folder size={16} />;
      case "folder-open":
        return <FolderOpen size={16} />;
      case "settings":
        return <Settings size={16} />;
      case "play":
        return <Play size={16} />;
      case "bug":
        return <Bug size={16} />;
      case "copy":
        return <Copy size={16} />;
      case "alert-circle":
      case "alert-triangle":
        return <AlertCircle size={16} />;
      case "x-circle":
        return <X size={16} />;
      case "file-plus":
      case "save":
      case "file-text":
        return <FileText size={16} />;
      case "at-sign":
        return <AtSign size={16} />;
      case "search":
        return <Search size={16} />;
      case "workflow":
      case "maximize":
      case "columns":
      case "rows":
        return <Layers size={16} />;
      case "move":
      case "focus":
      case "zoom-in":
      case "zoom-out":
        return <Navigation size={16} />;
      case "hash":
        return <Hash size={16} />;
      default:
        return <Terminal size={16} />;
    }
  };

  const SAFE_COMMAND_PREFIXES = [
    "git ",
    "ls",
    "pwd",
    "echo ",
    "cat ",
    "which ",
    "npm ",
    "go ",
    "cargo ",
    "docker ",
  ];

  const isSafeCommand = (cmd: string): boolean => {
    const trimmed = cmd.trim();
    return SAFE_COMMAND_PREFIXES.some(
      (prefix) => trimmed.startsWith(prefix) || trimmed === prefix.trim(),
    );
  };

  const executeItem = useCallback(
    (item: DispatcherItem) => {
      if (item.action === "error") {
        return;
      }
      if (item.filePath && onOpenFile) {
        onOpenFile(item.filePath, item.line);
        onClose();
        return;
      }

      const itemMode = getModeFromInput(item.title);

      if (itemMode === "ide") {
        onExecute(item.title, "ide");
        onClose();
        return;
      }

      if (itemMode === "tag" && preview && onTerminalCommand) {
        onTerminalCommand(preview);
        onClose();
        return;
      }

      if (item.action === "execute" && onTerminalCommand) {
        if (isSafeCommand(item.title)) {
          setIsExecuting(true);
          setExecutionResult(null);
          setPreview(`${item.title}\nExecuting...`);

          GetTerminalPreview(item.title)
            .then((result) => {
              setIsExecuting(false);
              setExecutionResult({
                output: result.output || "",
                error: result.error || "",
                success: result.exitCode === 0,
                command: item.title,
              });
            })
            .catch((err) => {
              setIsExecuting(false);
              setExecutionResult({
                output: "",
                error: String(err),
                success: false,
                command: item.title,
              });
            });
          return;
        }

        onTerminalCommand(item.title);
        onClose();
        return;
      }

      onExecute(item.title, mode);
      onClose();
    },
    [mode, preview, onOpenFile, onTerminalCommand, onExecute, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (executionResult) {
        e.preventDefault();
        if (onTerminalCommand) {
          onTerminalCommand(executionResult.command);
        }
        onClose();
        return;
      }

      if (isExecuting) {
        e.preventDefault();
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (items.length > 0) {
            setSelectedIndex((i) => {
              const next = Math.min(i + 1, items.length - 1);
              scrollToItem(next);
              return next;
            });
          } else if (historyList.length > 0) {
            if (historyIndex > 0) {
              const newIndex = historyIndex - 1;
              setHistoryIndex(newIndex);
              setInput(historyList[newIndex]);
              setGhostText("");
            } else if (historyIndex === 0) {
              setHistoryIndex(-1);
              setInput(savedInput);
              setGhostText("");
            }
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (items.length > 0) {
            setSelectedIndex((i) => {
              const next = Math.max(i - 1, 0);
              scrollToItem(next);
              return next;
            });
          } else if (historyList.length > 0) {
            if (historyIndex === -1) {
              setSavedInput(input);
            }
            const newIndex = Math.min(historyIndex + 1, historyList.length - 1);
            if (newIndex !== historyIndex) {
              setHistoryIndex(newIndex);
              setInput(historyList[newIndex]);
              setGhostText("");
            }
          }
          break;
        case "Enter":
          e.preventDefault();
          if (isTerminalMode && terminalCommand && onTerminalCommand) {
            // Save terminal command to history
            if (input.trim()) {
              const history = JSON.parse(
                localStorage.getItem("dispatcher_history") || "[]",
              ) as string[];
              const newHistory = [
                input,
                ...history.filter((h) => h !== input),
              ].slice(0, 100);
              localStorage.setItem(
                "dispatcher_history",
                JSON.stringify(newHistory),
              );
            }
            onTerminalCommand(terminalCommand);
            onClose();
            return;
          }
          if (items[selectedIndex]) {
            // Save the full item title to history, not partial input
            const itemTitle = items[selectedIndex].title;
            const history = JSON.parse(
              localStorage.getItem("dispatcher_history") || "[]",
            ) as string[];
            const newHistory = [
              itemTitle,
              ...history.filter((h) => h !== itemTitle),
            ].slice(0, 100);
            localStorage.setItem(
              "dispatcher_history",
              JSON.stringify(newHistory),
            );
            executeItem(items[selectedIndex]);
          } else if (input) {
            // Save raw input to history only when no item selected
            if (input.trim()) {
              const history = JSON.parse(
                localStorage.getItem("dispatcher_history") || "[]",
              ) as string[];
              const newHistory = [
                input,
                ...history.filter((h) => h !== input),
              ].slice(0, 100);
              localStorage.setItem(
                "dispatcher_history",
                JSON.stringify(newHistory),
              );
            }
            if (mode === "default" && onTerminalCommand) {
              onTerminalCommand(input);
              onClose();
            } else {
              onExecute(input, mode);
              onClose();
            }
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "Tab":
          e.preventDefault();
          // Terminal mode: apply ghost text
          if (isTerminalMode && ghostText) {
            setInput("@t " + terminalCommand + ghostText);
            setGhostText("");
          } else if (items[selectedIndex]) {
            setInput(items[selectedIndex].title);
          }
          break;
      }
    },
    [
      items,
      selectedIndex,
      input,
      mode,
      executeItem,
      onTerminalCommand,
      onExecute,
      onClose,
      isExecuting,
      executionResult,
      isTerminalMode,
      terminalCommand,
      ghostText,
      historyList,
      historyIndex,
      savedInput,
    ],
  );

  const scrollToItem = (index: number) => {
    if (listRef.current) {
      const item = listRef.current.children[index] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/52" onClick={onClose}>
      <div
        className="absolute left-1/2 top-[43%] flex w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {(preview || isExecuting || executionResult) && (
          <div className="shell-overlay-card mb-3 w-full p-4">
            <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              <span>
                {executionResult ? "Execution preview" : "Expanded command"}
              </span>
              <span>{executionResult ? "Any key to close" : "Preview"}</span>
            </div>
            <div className="max-h-[220px] overflow-y-auto font-mono text-[13px] leading-6 text-[var(--text-primary)] whitespace-pre-wrap break-words">
              {isExecuting ? (
                <div className="animate-pulse">
                  <span className="mr-2 text-[var(--status-info)]">$</span>
                  <span>{preview.split("\n")[0]}</span>
                  <div className="mt-1 text-[var(--text-muted)]">
                    Executing...
                  </div>
                </div>
              ) : executionResult ? (
                <>
                  <div className="mb-2">
                    <span className="mr-2 text-[var(--status-info)]">$</span>
                    <span>{executionResult.command}</span>
                  </div>
                  {executionResult.success ? (
                    parseAnsi(executionResult.output).map((span, i) => (
                      <span
                        key={i}
                        style={{
                          color: span.color,
                          fontWeight: span.bold ? 600 : 400,
                        }}
                      >
                        {span.text}
                      </span>
                    ))
                  ) : (
                    <span className="text-[var(--status-error)]">
                      {executionResult.error ||
                        executionResult.output ||
                        "Command failed"}
                    </span>
                  )}
                  <div className="mt-3 border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-muted)]">
                    Press any key to close
                  </div>
                </>
              ) : (
                <>
                  <span className="mr-2 text-[var(--status-info)]">$</span>
                  {parseAnsi(preview).map((span, i) => (
                    <span
                      key={i}
                      style={{
                        color: span.color,
                        fontWeight: span.bold ? 600 : 400,
                      }}
                    >
                      {span.text}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        <div className="shell-overlay-card w-full overflow-hidden rounded-[30px] p-3">
          <div
            className={`flex items-center gap-3 px-2 ${
              hasResults
                ? "border-b border-[var(--shell-inline-divider)] pb-3"
                : ""
            }`}
          >
            <div className="shell-cluster flex-1 px-4">
              <Search size={18} className="shrink-0 text-[var(--text-muted)]" />
              <div className="relative flex-1 py-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (historyIndex !== -1) {
                      setHistoryIndex(-1);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Search..."
                  className="w-full border-none bg-transparent text-[15px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                />
                {isTerminalMode && ghostText && (
                  <span className="pointer-events-none absolute left-0 top-0 whitespace-pre py-2 text-[15px] font-normal text-transparent">
                    {input}
                    <span className="text-[var(--text-muted)]">
                      {ghostText}
                    </span>
                  </span>
                )}
              </div>
            </div>
            <div className="shell-cluster-soft flex shrink-0 items-center gap-2 px-3 py-1.5">
              {!isTerminalMode && (
                <span className="shell-pill">
                  {activeModeLabel}
                  {modeHints[mode] ? (
                    <span className="text-[var(--text-muted)]">
                      {modeHints[mode]}
                    </span>
                  ) : null}
                </span>
              )}
              {isTerminalMode && (
                <>
                  {ghostText && <span className="shell-kbd">Tab</span>}
                  <span className="shell-pill border-[color:var(--status-success)]/25 bg-[color:var(--status-success)]/10 text-[var(--status-success)]">
                    Terminal
                  </span>
                </>
              )}
            </div>
          </div>

          {hasResults && (
            <div
              ref={listRef}
              className="max-h-[420px] overflow-y-auto px-2 py-3"
            >
              {items.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => executeItem(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`mb-2 flex cursor-pointer items-center gap-3 rounded-[20px] border px-4 py-3 transition-colors ${
                    index === selectedIndex
                      ? "border-[var(--shell-border-strong)] bg-[var(--surface-active)] shadow-[inset_0_1px_0_var(--shell-inner-highlight)]"
                      : "border-transparent bg-transparent hover:border-[var(--shell-border)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[var(--text-secondary)] ${
                      index === selectedIndex
                        ? "border-[var(--shell-border-strong)] bg-[var(--surface-shell-soft)] text-[var(--text-primary)]"
                        : "border-[var(--shell-border)] bg-[var(--surface-shell)]"
                    }`}
                  >
                    {item.icon}
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-[var(--text-primary)]">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="truncate text-[12px] text-[var(--text-muted)]">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandDispatcher;
