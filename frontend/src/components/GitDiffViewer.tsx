import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronLeft, ChevronRight, Copy, X } from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import { radius, transitions } from "../styles/colors";

interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "hunk";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

interface GitDiffViewerProps {
  diff: string;
  fileName: string;
  onClose: () => void;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

const parseDiff = (diffText: string): DiffHunk[] => {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (!match) {
        continue;
      }

      oldLine = Number.parseInt(match[1], 10);
      newLine = Number.parseInt(match[2], 10);
      currentHunk = {
        header: line,
        lines: [{ type: "hunk", content: line }],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNum: newLine,
      });
      newLine += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNum: oldLine,
      });
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNum: oldLine,
        newLineNum: newLine,
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      currentHunk.lines.push({ type: "header", content: line });
    }
  }

  return hunks;
};

const buildSplitRows = (hunks: DiffHunk[]): SplitRow[] => {
  const rows: SplitRow[] = [];

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "hunk" || line.type === "header") {
        rows.push({ left: line, right: line });
        continue;
      }

      if (line.type === "context") {
        rows.push({ left: line, right: line });
        continue;
      }

      if (line.type === "remove") {
        rows.push({ left: line, right: null });
        continue;
      }

      rows.push({ left: null, right: line });
    }
  }

  return rows;
};

const lineAccent = (isDark: boolean, type: DiffLine["type"]): string => {
  switch (type) {
    case "add":
      return isDark ? "rgba(34,197,94,0.18)" : "rgba(34,197,94,0.16)";
    case "remove":
      return isDark ? "rgba(239,68,68,0.16)" : "rgba(239,68,68,0.14)";
    case "hunk":
      return isDark ? "rgba(59,130,246,0.14)" : "rgba(59,130,246,0.12)";
    case "header":
      return isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
    default:
      return "transparent";
  }
};

const lineBorder = (type: DiffLine["type"]): string => {
  switch (type) {
    case "add":
      return "#22c55e";
    case "remove":
      return "#ef4444";
    case "hunk":
      return "#3b82f6";
    default:
      return "transparent";
  }
};

const renderLineCell = (
  line: DiffLine | null,
  theme: {
    bg: string;
    bgSecondary: string;
    border: string;
    text: string;
    textMuted: string;
  },
  isDark: boolean,
  side: "left" | "right",
): React.ReactElement => {
  if (!line) {
    return (
      <div
        className="grid min-h-[22px] grid-cols-[46px_minmax(0,1fr)]"
        style={{ background: "transparent" }}
      >
        <div
          style={{ borderRight: `1px solid ${theme.border}` }}
          className="px-2 py-0.5 text-right text-[10px] text-[var(--git-diff-muted)]"
        />
        <div className="px-3 py-0.5" />
      </div>
    );
  }

  const lineNumber = side === "left" ? line.oldLineNum : line.newLineNum;
  const prefix =
    line.type === "add"
      ? "+"
      : line.type === "remove"
        ? "-"
        : line.type === "context"
          ? " "
          : "";

  return (
    <div
      className="grid min-h-[22px] grid-cols-[46px_minmax(0,1fr)]"
      style={{
        background: lineAccent(isDark, line.type),
        borderLeft: `2px solid ${lineBorder(line.type)}`,
      }}
    >
      <div
        style={{ borderRight: `1px solid ${theme.border}` }}
        className="px-2 py-0.5 text-right text-[10px] text-[var(--git-diff-muted)]"
      >
        {line.type === "context" ||
        line.type === "add" ||
        line.type === "remove"
          ? lineNumber
          : ""}
      </div>
      <div className="overflow-x-auto px-3 py-0.5 font-mono text-[11px] leading-5 text-[var(--git-diff-text)]">
        {prefix && (
          <span
            className="mr-2 inline-block w-3 text-center"
            style={{
              color:
                line.type === "add"
                  ? "#22c55e"
                  : line.type === "remove"
                    ? "#ef4444"
                    : theme.textMuted,
            }}
          >
            {prefix}
          </span>
        )}
        <span>{line.content}</span>
      </div>
    </div>
  );
};

export const GitDiffViewer: React.FC<GitDiffViewerProps> = ({
  diff,
  fileName,
  onClose,
  onPrevFile,
  onNextFile,
  hasPrev = false,
  hasNext = false,
}) => {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const copyTimerRef = useRef<number | null>(null);

  const theme = useMemo(
    () => ({
      bg: isDark ? "#0a0a0a" : "#ffffff",
      bgSecondary: isDark ? "#111111" : "#f9fafb",
      bgTertiary: isDark ? "#1a1a1a" : "#f3f4f6",
      border: isDark ? "#2a2a2a" : "#e5e7eb",
      text: isDark ? "#ffffff" : "#111827",
      textMuted: isDark ? "#888888" : "#6b7280",
    }),
    [isDark],
  );

  const hunks = useMemo(() => parseDiff(diff), [diff]);
  const splitRows = useMemo(() => buildSplitRows(hunks), [hunks]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;

    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") {
          additions += 1;
        }
        if (line.type === "remove") {
          deletions += 1;
        }
      }
    }

    return { additions, deletions };
  }, [hunks]);

  const viewerVars = useMemo(
    () =>
      ({
        "--git-diff-bg": theme.bg,
        "--git-diff-surface": theme.bgSecondary,
        "--git-diff-muted": theme.textMuted,
        "--git-diff-text": theme.text,
        "--git-diff-border": theme.border,
      }) as React.CSSProperties,
    [theme],
  );

  const copyDiff = useCallback(() => {
    void navigator.clipboard.writeText(diff);
    setCopied(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 1800);
  }, [diff]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && hasPrev && onPrevFile) {
        onPrevFile();
        return;
      }
      if (event.key === "ArrowRight" && hasNext && onNextFile) {
        onNextFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, [hasNext, hasPrev, onClose, onNextFile, onPrevFile]);

  return (
    <div
      style={viewerVars}
      className="flex h-full min-h-0 flex-col bg-[var(--git-diff-bg)] text-[var(--git-diff-text)]"
    >
      <div
        className="flex items-center gap-3 border-b px-3 py-2"
        style={{
          borderColor: theme.border,
          background: theme.bgSecondary,
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={onPrevFile}
              disabled={!hasPrev}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-[var(--git-diff-muted)] transition-colors hover:text-[var(--git-diff-text)] disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: theme.border,
                background: theme.bgTertiary,
              }}
              title="Previous file"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={onNextFile}
              disabled={!hasNext}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-[var(--git-diff-muted)] transition-colors hover:text-[var(--git-diff-text)] disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: theme.border,
                background: theme.bgTertiary,
              }}
              title="Next file"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium">{fileName}</div>
            <div className="mt-0.5 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-[var(--git-diff-muted)]">
              <span>{viewMode}</span>
              <span className="text-[#22c55e]">+{stats.additions}</span>
              <span className="text-[#ef4444]">-{stats.deletions}</span>
            </div>
          </div>
        </div>

        <div
          className="inline-flex rounded-md border p-1"
          style={{ borderColor: theme.border, background: theme.bgTertiary }}
        >
          {(["unified", "split"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className="rounded px-2.5 py-1 text-[11px] capitalize transition-colors"
              style={{
                background:
                  viewMode === mode ? theme.bgSecondary : "transparent",
                color: viewMode === mode ? theme.text : theme.textMuted,
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={copyDiff}
          className="inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11px] text-[var(--git-diff-muted)] transition-colors hover:text-[var(--git-diff-text)]"
          style={{ borderColor: theme.border, background: theme.bgTertiary }}
          title="Copy diff"
        >
          {copied ? (
            <Check size={13} className="text-[#22c55e]" />
          ) : (
            <Copy size={13} />
          )}
          Copy
        </button>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-[var(--git-diff-muted)] transition-colors hover:text-[var(--git-diff-text)]"
          style={{ borderColor: theme.border, background: theme.bgTertiary }}
          title="Close diff"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {hunks.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-[12px] text-[var(--git-diff-muted)]">
            No changes in this diff.
          </div>
        ) : viewMode === "unified" ? (
          <div className="min-w-max px-2 py-2">
            {hunks.map((hunk) => (
              <div
                key={hunk.header}
                className="overflow-hidden rounded-lg border"
                style={{
                  borderColor: theme.border,
                  background: theme.bgSecondary,
                  marginBottom: radius.sm,
                }}
              >
                {hunk.lines.map((line, index) => (
                  <div
                    key={`${hunk.header}:${index}:${line.type}:${line.oldLineNum ?? 0}:${line.newLineNum ?? 0}`}
                    className="grid min-h-[22px] grid-cols-[46px_46px_minmax(0,1fr)]"
                    style={{
                      background: lineAccent(isDark, line.type),
                      borderLeft: `2px solid ${lineBorder(line.type)}`,
                    }}
                  >
                    <div
                      className="px-2 py-0.5 text-right text-[10px] text-[var(--git-diff-muted)]"
                      style={{ borderRight: `1px solid ${theme.border}` }}
                    >
                      {line.type === "add" ||
                      line.type === "remove" ||
                      line.type === "context"
                        ? line.oldLineNum
                        : ""}
                    </div>
                    <div
                      className="px-2 py-0.5 text-right text-[10px] text-[var(--git-diff-muted)]"
                      style={{ borderRight: `1px solid ${theme.border}` }}
                    >
                      {line.type === "add" ||
                      line.type === "remove" ||
                      line.type === "context"
                        ? line.newLineNum
                        : ""}
                    </div>
                    <div className="overflow-x-auto px-3 py-0.5 font-mono text-[11px] leading-5 text-[var(--git-diff-text)]">
                      {line.type === "add" && (
                        <span className="mr-2 inline-block w-3 text-center text-[#22c55e]">
                          +
                        </span>
                      )}
                      {line.type === "remove" && (
                        <span className="mr-2 inline-block w-3 text-center text-[#ef4444]">
                          -
                        </span>
                      )}
                      {line.type === "context" && (
                        <span className="mr-2 inline-block w-3 text-center text-[var(--git-diff-muted)]">
                          {" "}
                        </span>
                      )}
                      <span>{line.content}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="min-w-max px-2 py-2">
            <div
              className="overflow-hidden rounded-lg border"
              style={{
                borderColor: theme.border,
                background: theme.bgSecondary,
              }}
            >
              <div
                className="grid grid-cols-2 border-b text-[10px] uppercase tracking-[0.16em] text-[var(--git-diff-muted)]"
                style={{
                  borderColor: theme.border,
                  background: theme.bgTertiary,
                }}
              >
                <div
                  className="border-r px-3 py-2"
                  style={{ borderColor: theme.border }}
                >
                  Original
                </div>
                <div className="px-3 py-2">Modified</div>
              </div>
              {splitRows.map((row, index) => (
                <div
                  key={`${index}:${row.left?.content ?? ""}:${row.right?.content ?? ""}`}
                  className="grid grid-cols-2"
                >
                  <div
                    className="border-r"
                    style={{ borderColor: theme.border }}
                  >
                    {renderLineCell(row.left, theme, isDark, "left")}
                  </div>
                  <div>{renderLineCell(row.right, theme, isDark, "right")}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitDiffViewer;
