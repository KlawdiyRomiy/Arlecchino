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
  Code,
  Box,
  Layers,
  Database,
  Navigation,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { zIndex } from "../styles/colors";
import {
  SearchFiles,
  SearchContent,
  SearchSymbols,
  GetDispatcherSuggestions,
  ExpandTag,
  GetTerminalPreview,
  PredictTerminalCommand,
  GetTerminalHistory,
} from "../../wailsjs/go/main/App";

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

type InputMode = "default" | "ide" | "file" | "grep" | "symbol" | "ai" | "tag";

interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
}

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
  if (input.startsWith('"') || input.startsWith("'")) return "grep";
  if (input.startsWith("#")) return "symbol";
  if (input.startsWith("@ai ")) return "ai";
  if (input.startsWith("@")) return "tag";
  return "default";
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
  const { isDark } = useTheme();

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

  const isTerminalMode = mode === "tag" && /^@t\s/i.test(input);
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
                  action: "open",
                  filePath: f.filePath,
                  line: f.line,
                });
              });
            } catch (e) {
              console.error("[Dispatcher] SearchFiles error:", e);
            }
            break;
          case "grep":
            try {
              let query = input;
              if (input.startsWith('"'))
                query = input.slice(1).replace(/"$/, "");
              else if (input.startsWith("'"))
                query = input.slice(1).replace(/'$/, "");
              const results = await SearchContent(query);
              results?.forEach((r, i) => {
                newItems.push({
                  id: `grep-${i}`,
                  icon: <FileText size={16} />,
                  title: r.title,
                  subtitle: r.subtitle,
                  action: "open",
                  filePath: r.filePath,
                  line: r.line,
                });
              });
            } catch (e) {
              console.error("[Dispatcher] SearchContent error:", e);
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
            }
            break;
          default:
            if (input.length >= 2) {
              try {
                const [files, content] = await Promise.all([
                  SearchFiles(input).catch(() => []),
                  SearchContent(input).catch(() => []),
                ]);

                files?.slice(0, 10).forEach((f, i) => {
                  newItems.push({
                    id: `file-${i}`,
                    icon: <FileText size={16} />,
                    title: f.title,
                    subtitle: f.subtitle,
                    action: "open",
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
                    action: "open",
                    filePath: r.filePath,
                    line: r.line,
                  });
                });
              } catch (e) {
                console.error("[Dispatcher] Search error:", e);
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
      case "settings":
        return <Settings size={16} />;
      case "file-plus":
      case "save":
      case "file-text":
        return <FileText size={16} />;
      case "at-sign":
        return <AtSign size={16} />;
      case "search":
        return <Search size={16} />;
      case "workflow":
        return <Layers size={16} />;
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "35vh",
        backgroundColor: "transparent",
        zIndex: zIndex.modal,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "640px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {(preview || isExecuting || executionResult) && (
          <div
            style={{
              width: "100%",
              marginBottom: "8px",
              animation: "bubbleIn 0.2s ease-out",
            }}
          >
            <style>{`
              @keyframes bubbleIn {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
              }
            `}</style>
            <div
              style={{
                position: "relative",
                backgroundColor: "#0d0d0d",
                borderRadius: "12px",
                boxShadow:
                  "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
                padding: "12px 16px",
                maxHeight: "200px",
                overflowY: "auto",
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, 'Cascadia Code', monospace",
                fontSize: "13px",
                lineHeight: 1.5,
                color: "#e5e5e5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                borderLeft: executionResult
                  ? `3px solid ${executionResult.success ? "#22c55e" : "#888888"}`
                  : "none",
              }}
            >
              {isExecuting ? (
                <div style={{ animation: "pulse 1.2s ease-in-out infinite" }}>
                  <span style={{ color: "#06b6d4", marginRight: "8px" }}>
                    $
                  </span>
                  <span style={{ color: "#e5e5e5" }}>
                    {preview.split("\n")[0]}
                  </span>
                  <div style={{ color: "#737373", marginTop: "4px" }}>
                    Executing...
                  </div>
                </div>
              ) : executionResult ? (
                <>
                  <div style={{ marginBottom: "8px" }}>
                    <span style={{ color: "#06b6d4", marginRight: "8px" }}>
                      $
                    </span>
                    <span style={{ color: "#e5e5e5" }}>
                      {executionResult.command}
                    </span>
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
                    <span style={{ color: "#888888" }}>
                      {executionResult.error ||
                        executionResult.output ||
                        "Command failed"}
                    </span>
                  )}
                  <div
                    style={{
                      color: "#525252",
                      fontSize: "11px",
                      marginTop: "8px",
                      borderTop: "1px solid #262626",
                      paddingTop: "8px",
                    }}
                  >
                    Press any key to close
                  </div>
                </>
              ) : (
                <>
                  <span style={{ color: "#06b6d4", marginRight: "8px" }}>
                    $
                  </span>
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
            <div
              style={{
                width: 0,
                height: 0,
                margin: "0 auto",
                borderLeft: "10px solid transparent",
                borderRight: "10px solid transparent",
                borderTop: "10px solid #0d0d0d",
              }}
            />
          </div>
        )}

        <div
          style={{
            width: "100%",
            backgroundColor: isDark ? "#1a1a1a" : "#fff",
            borderRadius: "12px",
            boxShadow: isDark
              ? "0 16px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1)"
              : "0 16px 64px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.1)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "16px 20px",
              position: "relative",
            }}
          >
            <Search
              size={18}
              style={{ color: isDark ? "#666" : "#999", flexShrink: 0 }}
            />
            <div style={{ position: "relative", flex: 1 }}>
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
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  backgroundColor: "transparent",
                  fontSize: "16px",
                  color: isDark ? "#fff" : "#000",
                  fontWeight: 400,
                }}
              />
              {/* Ghost text for terminal mode */}
              {isTerminalMode && ghostText && (
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    pointerEvents: "none",
                    fontSize: "16px",
                    fontWeight: 400,
                    color: "transparent",
                    whiteSpace: "pre",
                  }}
                >
                  {input}
                  <span style={{ color: isDark ? "#555" : "#aaa" }}>
                    {ghostText}
                  </span>
                </span>
              )}
            </div>
            {/* Terminal mode indicator */}
            {isTerminalMode && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexShrink: 0,
                }}
              >
                {ghostText && (
                  <span
                    style={{
                      fontSize: "11px",
                      color: isDark ? "#555" : "#aaa",
                      padding: "2px 6px",
                      backgroundColor: isDark ? "#333" : "#eee",
                      borderRadius: "4px",
                    }}
                  >
                    Tab
                  </span>
                )}
                <span
                  style={{
                    fontSize: "11px",
                    color: "#22c55e",
                    fontWeight: 500,
                  }}
                >
                  Terminal
                </span>
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div
              ref={listRef}
              style={{
                maxHeight: "400px",
                overflowY: "auto",
                borderTop: `1px solid ${isDark ? "#333" : "#eee"}`,
              }}
            >
              {items.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => executeItem(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "12px 20px",
                    cursor: "pointer",
                    backgroundColor:
                      index === selectedIndex
                        ? isDark
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(0,0,0,0.05)"
                        : "transparent",
                  }}
                >
                  <div
                    style={{
                      color: isDark ? "#888" : "#666",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: 500,
                        color: isDark ? "#fff" : "#000",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
                    </span>
                    {item.subtitle && (
                      <span
                        style={{
                          fontSize: "14px",
                          color: isDark ? "#666" : "#999",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        — {item.subtitle}
                      </span>
                    )}
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
