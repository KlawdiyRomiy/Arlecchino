import React, { useState, useEffect, useCallback } from "react";
import { GitCommit, User, Clock, ChevronDown, ChevronRight, FileText, RefreshCw } from "lucide-react";
import { getThemeColors, radius, transitions } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { useEditorSettingsStore } from "../stores/editorSettingsStore";
import * as AppFunctions from "../../wailsjs/go/main/App";

interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  subject: string;
  body: string;
  parents: string;
}

interface GitHistoryProps {
  onCommitSelect?: (hash: string) => void;
  onViewDiff?: (hash: string) => void;
  selectedCommit?: string | null;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return `${diffMinutes}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function hashToColor(hash: string): string {
  let h = 0;
  for (let i = 0; i < hash.length; i++) {
    h = hash.charCodeAt(i) + ((h << 5) - h);
  }
  const hue = h % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

export const GitHistory: React.FC<GitHistoryProps> = ({
  onCommitSelect,
  onViewDiff,
  selectedCommit,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const uiScale = useEditorSettingsStore((state) => state.uiScale);
  
  // Scale helper
  const scaled = (size: number) => Math.round(size * uiScale);
  
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitStats, setCommitStats] = useState<Record<string, string>>({});

  const loadCommits = useCallback(async () => {
    setLoading(true);
    try {
      const result = await AppFunctions.GetGitLog(100, "");
      setCommits(result || []);
    } catch (err) {
      console.error("[GitHistory] Failed to load commits:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCommits();
  }, [loadCommits]);

  const toggleExpand = async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null);
      return;
    }
    setExpandedCommit(hash);
    if (!commitStats[hash]) {
      try {
        const stats = await AppFunctions.GetGitShow(hash);
        setCommitStats(prev => ({ ...prev, [hash]: stats }));
      } catch (err) {
        console.error("[GitHistory] Failed to load commit stats:", err);
      }
    }
  };

  const CommitRow: React.FC<{ commit: CommitInfo; isFirst: boolean; isLast: boolean }> = ({ commit, isFirst, isLast }) => {
    const isExpanded = expandedCommit === commit.hash;
    const isSelected = selectedCommit === commit.hash;
    const avatarColor = hashToColor(commit.authorEmail);

    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "10px 12px",
            cursor: "pointer",
            background: isSelected ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)") : "transparent",
            borderLeft: isSelected ? `2px solid #EF4444` : "2px solid transparent",
            transition: `background ${transitions.fast}`,
          }}
          onClick={() => {
            onCommitSelect?.(commit.hash);
            toggleExpand(commit.hash);
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)";
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.background = "transparent";
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 20 }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: isFirst ? "#EF4444" : "#6B7280",
              border: `2px solid ${theme.bg}`,
              zIndex: 1,
            }} />
            {!isLast && (
              <div style={{
                width: 2,
                flex: 1,
                minHeight: 30,
                background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
                marginTop: -2,
              }} />
            )}
          </div>

          <div style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: avatarColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 600,
            color: "#fff",
            flexShrink: 0,
          }}>
            {getInitials(commit.author)}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {isExpanded ? <ChevronDown size={12} style={{ color: theme.textMuted }} /> : <ChevronRight size={12} style={{ color: theme.textMuted }} />}
              <span style={{
                fontSize: 13,
                fontWeight: 500,
                color: theme.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {commit.subject}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 11,
                color: "#EF4444",
                fontFamily: "monospace",
                background: isDark ? "rgba(239, 68, 68, 0.1)" : "rgba(239, 68, 68, 0.08)",
                padding: "1px 6px",
                borderRadius: radius.sm,
                flexShrink: 0,
              }}>
                {commit.shortHash}
              </span>
              <span style={{ fontSize: 11, color: theme.textMuted, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <User size={10} /> {commit.author}
              </span>
              <span style={{ fontSize: 11, color: theme.textMuted, display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <Clock size={10} /> {formatDate(commit.date)}
              </span>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDiff?.(commit.hash);
            }}
            style={{
              background: "transparent",
              border: `1px solid ${theme.border}`,
              borderRadius: radius.sm,
              padding: "4px 8px",
              fontSize: 11,
              color: theme.textMuted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: `all ${transitions.fast}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#EF4444";
              e.currentTarget.style.color = "#EF4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = theme.border;
              e.currentTarget.style.color = theme.textMuted;
            }}
          >
            <FileText size={12} /> View
          </button>
        </div>

        {isExpanded && (
          <div style={{
            marginLeft: 44,
            padding: "8px 12px",
            background: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)",
            borderRadius: radius.sm,
            marginRight: 12,
            marginBottom: 8,
          }}>
            {commit.body && (
              <div style={{
                fontSize: 12,
                color: theme.textMuted,
                marginBottom: 8,
                whiteSpace: "pre-wrap",
              }}>
                {commit.body}
              </div>
            )}
            {commitStats[commit.hash] && (
              <pre style={{
                fontSize: 11,
                color: theme.textMuted,
                fontFamily: "monospace",
                margin: 0,
                whiteSpace: "pre-wrap",
                overflow: "auto",
                maxHeight: 200,
              }}>
                {commitStats[commit.hash].split("\n").slice(0, 30).join("\n")}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: theme.text, fontSize: scaled(14) }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: `1px solid ${theme.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GitCommit size={14} style={{ color: theme.textMuted }} />
          <span style={{ fontSize: 12, fontWeight: 500 }}>Commit History</span>
          <span style={{ fontSize: 11, color: theme.textMuted }}>({commits.length})</span>
        </div>
        <button
          onClick={loadCommits}
          disabled={loading}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 4,
            borderRadius: radius.sm,
            display: "flex",
          }}
        >
          <RefreshCw size={14} style={{ color: theme.textMuted, animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: theme.textMuted }}>
            Loading...
          </div>
        ) : commits.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: theme.textMuted, fontSize: 13 }}>
            No commits yet
          </div>
        ) : (
          commits.map((commit, idx) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              isFirst={idx === 0}
              isLast={idx === commits.length - 1}
            />
          ))
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default GitHistory;
