import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, ChevronRight, Clock } from "lucide-react";
import { getThemeColors, radius, shadows, transitions, zIndex, spacing } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { SuggestCommand, PredictCommand, ParseCommand } from "../wails/app";
import type {
  ClassResult,
  CommandSuggestion,
} from "../../bindings/arlecchino/internal/app/models";

interface CommandAutocompleteProps {
  input: string;
  position: { x: number; y: number };
  onSelect: (text: string) => void;
  onClose: () => void;
  visible: boolean;
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({
  input,
  position,
  onSelect,
  onClose,
  visible,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const [suggestions, setSuggestions] = useState<CommandSuggestion[]>([]);
  const [prediction, setPrediction] = useState<ClassResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [parsedCommand, setParsedCommand] = useState<{
    command: string;
    argument: string;
    valid: boolean;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !input.trim()) {
      setSuggestions([]);
      setPrediction(null);
      setParsedCommand(null);
      return;
    }

    const fetchSuggestions = async () => {
      const parsed = await ParseCommand(input);
      setParsedCommand({
        command: parsed.command as string,
        argument: parsed.argument as string,
        valid: parsed.valid as boolean,
      });

      const sugg = await SuggestCommand(input);
      setSuggestions(sugg || []);
      setSelectedIndex(0);

      if (parsed.valid && parsed.argument) {
        const pred = await PredictCommand(input);
        setPrediction(pred);
      } else {
        setPrediction(null);
      }
    };

    const debounce = setTimeout(fetchSuggestions, 50);
    return () => clearTimeout(debounce);
  }, [input, visible]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          break;
        case "Tab":
        case "Enter":
          if (suggestions[selectedIndex]) {
            e.preventDefault();
            onSelect(suggestions[selectedIndex].text);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [visible, suggestions, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!visible || (suggestions.length === 0 && !prediction)) return null;

  const containerStyle: React.CSSProperties = {
    position: "fixed",
    left: position.x,
    top: position.y,
    minWidth: "300px",
    maxWidth: "450px",
    maxHeight: "300px",
    backgroundColor: isDark ? theme.bgSecondary : theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: radius.md,
    boxShadow: shadows.lg,
    zIndex: zIndex.modal,
    overflow: "hidden",
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderBottom: `1px solid ${theme.border}`,
    backgroundColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.02)",
  };

  const itemStyle = (isSelected: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    backgroundColor: isSelected
      ? isDark
        ? "rgba(255,255,255,0.08)"
        : "rgba(0,0,0,0.05)"
      : "transparent",
    transition: `background-color ${transitions.fast}`,
  });

  const kindBadgeStyle = (kind: string): React.CSSProperties => ({
    padding: "2px 6px",
    fontSize: "10px",
    fontWeight: 500,
    borderRadius: radius.sm,
    backgroundColor:
      kind === "command"
        ? isDark
          ? "rgba(168,85,247,0.2)"
          : "rgba(168,85,247,0.1)"
        : isDark
        ? "rgba(59,130,246,0.2)"
        : "rgba(59,130,246,0.1)",
    color: kind === "command" ? "#A855F7" : "#3B82F6",
    textTransform: "uppercase",
  });

  const pendingStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderTop: `1px solid ${theme.border}`,
    backgroundColor: isDark ? "rgba(234,179,8,0.05)" : "rgba(234,179,8,0.03)",
  };

  const pendingBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "2px 6px",
    fontSize: "10px",
    fontWeight: 500,
    borderRadius: radius.sm,
    backgroundColor: isDark ? "rgba(234,179,8,0.2)" : "rgba(234,179,8,0.1)",
    color: "#EAB308",
    marginLeft: "8px",
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      {parsedCommand?.valid && (
        <div style={headerStyle}>
          <Terminal size={14} style={{ color: "#A855F7" }} />
          <span style={{ fontSize: "12px", fontWeight: 500, color: theme.text }}>
            {parsedCommand.command}
          </span>
          {parsedCommand.argument && (
            <>
              <ChevronRight size={12} style={{ color: theme.textMuted }} />
              <span style={{ fontSize: "12px", color: theme.textMuted }}>
                {parsedCommand.argument}
              </span>
            </>
          )}
        </div>
      )}

      <div style={{ maxHeight: "200px", overflowY: "auto" }}>
        {suggestions.map((suggestion, index) => (
          <div
            key={suggestion.text}
            style={itemStyle(index === selectedIndex)}
            onClick={() => onSelect(suggestion.text)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span style={kindBadgeStyle(suggestion.kind)}>{suggestion.kind}</span>
            <span style={{ fontSize: "13px", color: theme.text, flex: 1 }}>
              {suggestion.text}
            </span>
            <span style={{ fontSize: "11px", color: theme.textMuted }}>
              {suggestion.description}
            </span>
          </div>
        ))}
      </div>

      {prediction && (
        <div style={pendingStyle}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: theme.text }}>
              Will create: <strong>{prediction.name}</strong>
            </span>
            <span style={pendingBadgeStyle}>
              <Clock size={10} />
              does not exist yet
            </span>
          </div>
          <div style={{ fontSize: "11px", color: theme.textMuted, marginTop: "4px" }}>
            {prediction.namespace} → {prediction.filePath?.split("/").slice(-3).join("/")}
          </div>
        </div>
      )}
    </div>
  );
};
