import React, { useState, useEffect, useMemo } from "react";
import { X, ChevronLeft, ChevronRight, Copy, Check } from "lucide-react";
import { getThemeColors, radius, transitions } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";

interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "hunk";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
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

function parseDiff(diffText: string): DiffHunk[] {
  const lines = diffText.split("\n");
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
        currentHunk = {
          header: line,
          lines: [{ type: "hunk", content: line }],
          oldStart: oldLine,
          newStart: newLine,
        };
        hunks.push(currentHunk);
      }
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        newLineNum: newLine++,
      });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      currentHunk.lines.push({
        type: "remove",
        content: line.slice(1),
        oldLineNum: oldLine++,
      });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNum: oldLine++,
        newLineNum: newLine++,
      });
    } else if (line.startsWith("diff ") || line.startsWith("index ") ||
               line.startsWith("---") || line.startsWith("+++")) {
      currentHunk.lines.push({ type: "header", content: line });
    }
  }

  return hunks;
}

export const GitDiffViewer: React.FC<GitDiffViewerProps> = ({
  diff,
  fileName,
  onClose,
  onPrevFile,
  onNextFile,
  hasPrev,
  hasNext,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const hunks = useMemo(() => parseDiff(diff), [diff]);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    hunks.forEach(hunk => {
      hunk.lines.forEach(line => {
        if (line.type === "add") additions++;
        if (line.type === "remove") deletions++;
      });
    });
    return { additions, deletions };
  }, [hunks]);

  const copyDiff = () => {
    navigator.clipboard.writeText(diff);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev && onPrevFile) onPrevFile();
      if (e.key === "ArrowRight" && hasNext && onNextFile) onNextFile();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onPrevFile, onNextFile, hasPrev, hasNext]);

  const colors = {
    add: { bg: isDark ? "rgba(34, 197, 94, 0.15)" : "rgba(34, 197, 94, 0.2)", border: "#22C55E" },
    remove: { bg: isDark ? "rgba(239, 68, 68, 0.15)" : "rgba(239, 68, 68, 0.2)", border: "#EF4444" },
    context: { bg: "transparent", border: "transparent" },
    hunk: { bg: isDark ? "rgba(59, 130, 246, 0.1)" : "rgba(59, 130, 246, 0.15)", border: "#3B82F6" },
    header: { bg: isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.05)", border: "transparent" },
  };

  const lineNumStyle: React.CSSProperties = {
    width: 50,
    minWidth: 50,
    textAlign: "right",
    paddingRight: 8,
    color: theme.textMuted,
    fontSize: 11,
    userSelect: "none",
    borderRight: `1px solid ${theme.border}`,
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: theme.bg,
      color: theme.text,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: `1px solid ${theme.border}`,
        background: theme.bgSecondary,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {hasPrev && (
            <button
              onClick={onPrevFile}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                borderRadius: radius.sm,
                display: "flex",
                color: theme.textMuted,
              }}
            >
              <ChevronLeft size={16} />
            </button>
          )}
          <span style={{ fontSize: 13, fontWeight: 500 }}>{fileName}</span>
          {hasNext && (
            <button
              onClick={onNextFile}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                borderRadius: radius.sm,
                display: "flex",
                color: theme.textMuted,
              }}
            >
              <ChevronRight size={16} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#22C55E" }}>+{stats.additions}</span>
          <span style={{ fontSize: 12, color: "#EF4444" }}>-{stats.deletions}</span>

          <div style={{
            display: "flex",
            background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
            borderRadius: radius.sm,
            padding: 2,
          }}>
            <button
              onClick={() => setViewMode("unified")}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                border: "none",
                borderRadius: radius.sm,
                cursor: "pointer",
                background: viewMode === "unified" ? theme.bgSecondary : "transparent",
                color: viewMode === "unified" ? theme.text : theme.textMuted,
              }}
            >
              Unified
            </button>
            <button
              onClick={() => setViewMode("split")}
              style={{
                padding: "4px 8px",
                fontSize: 11,
                border: "none",
                borderRadius: radius.sm,
                cursor: "pointer",
                background: viewMode === "split" ? theme.bgSecondary : "transparent",
                color: viewMode === "split" ? theme.text : theme.textMuted,
              }}
            >
              Split
            </button>
          </div>

          <button
            onClick={copyDiff}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: radius.sm,
              display: "flex",
              color: theme.textMuted,
            }}
            title="Copy diff"
          >
            {copied ? <Check size={14} color="#22C55E" /> : <Copy size={14} />}
          </button>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              borderRadius: radius.sm,
              display: "flex",
              color: theme.textMuted,
            }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {hunks.length === 0 ? (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: theme.textMuted,
            fontSize: 13,
          }}>
            No changes
          </div>
        ) : viewMode === "unified" ? (
          <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, minWidth: "max-content" }}>
            {hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx}>
                {hunk.lines.map((line, lineIdx) => (
                  <div
                    key={lineIdx}
                    style={{
                      display: "flex",
                      background: colors[line.type].bg,
                      borderLeft: `3px solid ${colors[line.type].border}`,
                      minHeight: 20,
                    }}
                  >
                    <div style={lineNumStyle}>
                      {line.type !== "hunk" && line.type !== "header" && line.oldLineNum}
                    </div>
                    <div style={{ ...lineNumStyle, borderRight: "none", paddingLeft: 4 }}>
                      {line.type !== "hunk" && line.type !== "header" && line.newLineNum}
                    </div>
                    <div style={{
                      flex: 1,
                      paddingLeft: 8,
                      whiteSpace: "pre",
                    }}>
                      {line.type === "add" && <span style={{ color: "#22C55E", marginRight: 4 }}>+</span>}
                      {line.type === "remove" && <span style={{ color: "#EF4444", marginRight: 4 }}>-</span>}
                      {line.content}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5, height: "100%" }}>
            <div style={{ flex: 1, borderRight: `1px solid ${theme.border}`, overflow: "auto" }}>
              <div style={{ padding: "4px 8px", background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}`, fontSize: 11, color: theme.textMuted, position: "sticky", top: 0, zIndex: 1 }}>
                Original
              </div>
              <div style={{ minWidth: "max-content" }}>
              {hunks.map((hunk, hunkIdx) => (
                <div key={hunkIdx}>
                  {hunk.lines.filter(l => l.type !== "add").map((line, lineIdx) => (
                    <div
                      key={lineIdx}
                      style={{
                        display: "flex",
                        background: line.type === "remove" ? colors.remove.bg : colors[line.type].bg,
                        borderLeft: `3px solid ${line.type === "remove" ? colors.remove.border : colors[line.type].border}`,
                        minHeight: 20,
                      }}
                    >
                      <div style={lineNumStyle}>{line.oldLineNum}</div>
                      <div style={{ flex: 1, paddingLeft: 8, whiteSpace: "pre" }}>{line.content}</div>
                    </div>
                  ))}
                </div>
              ))}
              </div>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <div style={{ padding: "4px 8px", background: theme.bgSecondary, borderBottom: `1px solid ${theme.border}`, fontSize: 11, color: theme.textMuted, position: "sticky", top: 0, zIndex: 1 }}>
                Modified
              </div>
              <div style={{ minWidth: "max-content" }}>
              {hunks.map((hunk, hunkIdx) => (
                <div key={hunkIdx}>
                  {hunk.lines.filter(l => l.type !== "remove").map((line, lineIdx) => (
                    <div
                      key={lineIdx}
                      style={{
                        display: "flex",
                        background: line.type === "add" ? colors.add.bg : colors[line.type].bg,
                        borderLeft: `3px solid ${line.type === "add" ? colors.add.border : colors[line.type].border}`,
                        minHeight: 20,
                      }}
                    >
                      <div style={lineNumStyle}>{line.newLineNum}</div>
                      <div style={{ flex: 1, paddingLeft: 8, whiteSpace: "pre" }}>{line.content}</div>
                    </div>
                  ))}
                </div>
              ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitDiffViewer;
