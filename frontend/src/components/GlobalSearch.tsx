import React, { useState, useEffect, useRef } from "react";
import { Search, FileText, X } from "lucide-react";
import * as AppFunctions from "../../wailsjs/go/main/App";
import { useTheme } from "../hooks/useTheme";
import { colors, getThemeColors, radius, transitions } from "../styles/colors";

interface SearchResult {
  file: string;
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  onFileOpen: (path: string, line: number) => void;
}

export const GlobalSearch: React.FC<GlobalSearchProps> = ({
  isOpen,
  onClose,
  projectPath,
  onFileOpen,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(true); // Default to whole word search
  const [fileTypeFilter, setFileTypeFilter] = useState<string>("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);

  // Load cached search on mount
  useEffect(() => {
    if (isOpen) {
      const cached = localStorage.getItem("last-global-search");
      if (cached) {
        try {
          const data = JSON.parse(cached);
          setQuery(data.query || "");
          setResults(data.results || []);
          setCaseSensitive(data.caseSensitive || false);
          setUseRegex(data.useRegex || false);
        } catch (e) {
          console.error("Failed to load cached search", e);
        }
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const searchTimeout = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(searchTimeout);
  }, [query, caseSensitive, useRegex, wholeWord]);

  const performSearch = async () => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const searchResults = await AppFunctions.SearchInProject(
        query,
        caseSensitive,
        useRegex,
        wholeWord,
      );
      setResults(searchResults || []);
      setSelectedIndex(0);
    } catch (error) {
      console.error("Search failed:", error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleResultClick = (result: SearchResult) => {
    onFileOpen(result.file, result.line);
    handleClose();
  };

  const handleClose = () => {
    if (query.trim()) {
      localStorage.setItem(
        "last-global-search",
        JSON.stringify({
          query,
          results,
          caseSensitive,
          useRegex,
          wholeWord,
        }),
      );
    } else {
      localStorage.removeItem("last-global-search");
    }
    onClose();
  };

  // Scroll selected item into view
  useEffect(() => {
    if (resultRefs.current[selectedIndex]) {
      resultRefs.current[selectedIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        Math.min(prev + 1, filteredResults.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filteredResults.length > 0) {
      e.preventDefault();
      handleResultClick(filteredResults[selectedIndex]);
    }
  };

  if (!isOpen) return null;

  // Filter results by file type
  const filteredResults =
    fileTypeFilter === "all"
      ? results
      : results.filter((r) => {
          const ext = r.file.split(".").pop()?.toLowerCase();
          return ext === fileTypeFilter;
        });

  // Get unique file extensions from results
  const fileTypes = Array.from(
    new Set(results.map((r) => r.file.split(".").pop()?.toLowerCase() || "")),
  ).filter((ext) => ext);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "5rem",
        zIndex: 50,
        backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.3)",
        backdropFilter: "blur(8px)",
      }}
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: isDark ? colors.dark.bgPanel : "#FFFFFF",
          borderRadius: radius.lg,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          width: "700px",
          maxHeight: "600px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div
          style={{
            padding: "16px",
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "12px",
            }}
          >
            <Search size={20} style={{ color: theme.textMuted }} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search in project..."
              style={{
                flex: 1,
                background: "transparent",
                color: theme.text,
                outline: "none",
                fontSize: "18px",
                border: "none",
              }}
            />
            <button
              onClick={handleClose}
              style={{
                background: "none",
                border: "none",
                color: theme.textMuted,
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Search Options */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              fontSize: "14px",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={(e) => setWholeWord(e.target.checked)}
                style={{ borderRadius: radius.sm }}
              />
              <span style={{ color: theme.textSecondary }}>Whole Word</span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
                style={{ borderRadius: radius.sm }}
              />
              <span style={{ color: theme.textSecondary }}>Case Sensitive</span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
                style={{ borderRadius: radius.sm }}
              />
              <span style={{ color: theme.textSecondary }}>Use Regex</span>
            </label>

            {/* File Type Filter */}
            {fileTypes.length > 0 && (
              <select
                value={fileTypeFilter}
                onChange={(e) => setFileTypeFilter(e.target.value)}
                style={{
                  padding: "4px 8px",
                  fontSize: "12px",
                  border: `1px solid ${theme.border}`,
                  borderRadius: radius.sm,
                  backgroundColor: isDark ? colors.dark.bgPanel : "#FFFFFF",
                  color: theme.text,
                }}
              >
                <option value="all">All Files</option>
                {fileTypes.map((ext) => (
                  <option key={ext} value={ext}>
                    .{ext}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isSearching ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "48px 0",
              }}
            >
              <div style={{ color: theme.textMuted }}>Searching...</div>
            </div>
          ) : filteredResults.length === 0 && query.trim() ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "48px 0",
                color: theme.textMuted,
              }}
            >
              <Search
                size={48}
                style={{ marginBottom: "12px", opacity: 0.3 }}
              />
              <p>No results found</p>
              <p style={{ fontSize: "14px", marginTop: "4px" }}>
                Try different search terms or check options
              </p>
            </div>
          ) : filteredResults.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "48px 0",
                color: theme.textMuted,
              }}
            >
              <Search
                size={48}
                style={{ marginBottom: "12px", opacity: 0.3 }}
              />
              <p>Start typing to search</p>
              <p style={{ fontSize: "14px", marginTop: "4px" }}>
                Search across all files in your project
              </p>
            </div>
          ) : (
            <div style={{ borderTop: `1px solid ${theme.border}` }}>
              {filteredResults.map((result, index) => (
                <div
                  key={`${result.file}-${result.line}-${index}`}
                  ref={(el) => {
                    resultRefs.current[index] = el;
                  }}
                  onClick={() => handleResultClick(result)}
                  style={{
                    padding: "12px",
                    cursor: "pointer",
                    transition: transitions.fast,
                    backgroundColor:
                      index === selectedIndex
                        ? isDark
                          ? "rgba(239,68,68,0.2)"
                          : "rgba(239,68,68,0.1)"
                        : "transparent",
                    borderLeft:
                      index === selectedIndex
                        ? `4px solid ${theme.text}`
                        : "none",
                    borderTop: index > 0 ? `1px solid ${theme.border}` : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (index !== selectedIndex) {
                      e.currentTarget.style.backgroundColor = isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.02)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (index !== selectedIndex) {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "4px",
                    }}
                  >
                    <FileText size={16} style={{ color: colors.status.info }} />
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: 500,
                        color: theme.text,
                      }}
                    >
                      {result.file.split("/").pop()}
                    </span>
                    <span style={{ fontSize: "12px", color: theme.textMuted }}>
                      Line {result.line}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: theme.textSecondary,
                      marginLeft: "24px",
                      fontFamily: "monospace",
                    }}
                  >
                    {result.preview.substring(0, result.matchStart)}
                    <span
                      style={{
                        backgroundColor: isDark ? "#854D0E" : "#FEF3C7",
                        color: theme.text,
                        padding: "2px 4px",
                        borderRadius: "2px",
                      }}
                    >
                      {result.preview.substring(
                        result.matchStart,
                        result.matchEnd,
                      )}
                    </span>
                    {result.preview.substring(result.matchEnd)}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: theme.textMuted,
                      marginLeft: "24px",
                      marginTop: "4px",
                    }}
                  >
                    {result.file}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {filteredResults.length > 0 && (
          <div
            style={{
              padding: "8px 16px",
              backgroundColor: isDark ? colors.dark.bg : "#F9FAFB",
              borderTop: `1px solid ${theme.border}`,
              fontSize: "12px",
              color: theme.textMuted,
            }}
          >
            {filteredResults.length} result
            {filteredResults.length !== 1 ? "s" : ""} found
            {fileTypeFilter !== "all" && ` (filtered by .${fileTypeFilter})`}
            {results.length !== filteredResults.length &&
              ` of ${results.length} total`}
          </div>
        )}
      </div>
    </div>
  );
};
