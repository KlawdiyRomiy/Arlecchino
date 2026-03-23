import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, User, Copy, Check, RotateCcw } from "lucide-react";
import { colors, getThemeColors, radius, transitions } from "../styles/colors";
import { useTheme } from "../hooks/useTheme";
import { useAIChatStore, ChatMessage } from "../stores/aiChatStore";

interface AIChatPanelProps {
  onClearChat?: () => void;
}

export const AIChatPanelContent: React.FC<AIChatPanelProps> = ({
  onClearChat,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);

  // Используем persist store для сохранения истории чата
  const { messages, addMessage, clearMessages } = useAIChatStore();

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    addMessage({
      role: "user",
      content: input.trim(),
    });

    const userContent = input.trim();
    setInput("");
    setIsLoading(true);

    setTimeout(() => {
      addMessage({
        role: "assistant",
        content: `This is a placeholder response. In the full implementation, this would connect to an AI service to provide helpful responses about your project.\n\nYou asked: "${userContent}"`,
      });
      setIsLoading(false);
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const clearChat = () => {
    clearMessages();
  };

  const messagesContainerStyle: React.CSSProperties = {
    flex: 1,
    overflow: "auto",
    padding: "var(--space-md)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-md)",
  };

  const messageStyle = (role: "user" | "assistant"): React.CSSProperties => ({
    display: "flex",
    gap: "var(--space-sm)",
    alignItems: "flex-start",
  });

  const avatarStyle = (role: "user" | "assistant"): React.CSSProperties => ({
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    backgroundColor:
      role === "assistant" ? "var(--bg-hover)" : "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontSize: "10px",
    fontWeight: 600,
  });

  const bubbleStyle = (role: "user" | "assistant"): React.CSSProperties => ({
    flex: 1,
    padding: "var(--space-sm) var(--space-md)",
    borderRadius: "var(--radius-md)",
    backgroundColor:
      role === "assistant" ? "var(--bg-elevated)" : "var(--bg-tertiary)",
    border: "none",
  });

  const contentStyle: React.CSSProperties = {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
  };

  const actionsStyle: React.CSSProperties = {
    display: "flex",
    gap: "8px",
    marginTop: "8px",
  };

  const actionBtnStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 8px",
    fontSize: "11px",
    color: theme.textMuted,
    backgroundColor: "transparent",
    border: "none",
    borderRadius: radius.sm,
    cursor: "pointer",
    transition: `all ${transitions.fast}`,
  };

  const inputContainerStyle: React.CSSProperties = {
    padding: "var(--space-md)",
    borderTop: `1px solid var(--border-subtle)`,
  };

  const inputWrapperStyle: React.CSSProperties = {
    display: "flex",
    gap: "var(--space-sm)",
    alignItems: "flex-end",
  };

  const textareaStyle: React.CSSProperties = {
    flex: 1,
    minHeight: "40px",
    maxHeight: "120px",
    padding: "var(--space-sm) var(--space-md)",
    fontSize: "12px",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-tertiary)",
    border: `1px solid var(--border-subtle)`,
    borderRadius: "var(--radius-md)",
    resize: "none",
    outline: "none",
    fontFamily: "inherit",
    transition: `all ${transitions.fast}`,
  };

  const sendBtnStyle: React.CSSProperties = {
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    cursor: input.trim() && !isLoading ? "pointer" : "not-allowed",
    opacity: input.trim() && !isLoading ? 1 : 0.5,
    transition: `all ${transitions.fast}`,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: "14px",
          fontWeight: 500,
          letterSpacing: "0.5px",
        }}
      >
        Coming Soon
      </div>
    </div>
  );
};

export default AIChatPanelContent;
