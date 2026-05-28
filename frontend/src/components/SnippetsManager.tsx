import React, { useState, useEffect } from "react";
import { useTheme } from "../hooks/useTheme";
import { colors, getThemeColors, radius, transitions } from "../styles/colors";

interface Snippet {
  id: string;
  name: string;
  prefix: string;
  body: string[];
  description: string;
  language: string;
}

interface SnippetsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (snippet: Snippet) => void;
}

export const SnippetsManager: React.FC<SnippetsManagerProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const { isDark } = useTheme();
  const theme = getThemeColors(isDark);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    prefix: "",
    body: "",
    description: "",
    language: "text",
  });

  useEffect(() => {
    if (isOpen) {
      loadSnippets();
    } else {
      // Reset form when closed
      setShowForm(false);
      setEditingSnippet(null);
      setFormData({
        name: "",
        prefix: "",
        body: "",
        description: "",
        language: "text",
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (showForm) {
          setShowForm(false);
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown, true);
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, showForm, onClose]);

  const loadSnippets = () => {
    const stored = localStorage.getItem("custom-snippets");
    if (stored) {
      setSnippets(JSON.parse(stored));
    }
  };

  const saveSnippets = (snippetsList: Snippet[]) => {
    localStorage.setItem("custom-snippets", JSON.stringify(snippetsList));
    setSnippets(snippetsList);
  };

  const handleCreateSnippet = () => {
    setFormData({
      name: "",
      prefix: "",
      body: "",
      description: "",
      language: "text",
    });
    setEditingSnippet(null);
    setShowForm(true);
  };

  const handleEditSnippet = (snippet: Snippet) => {
    setFormData({
      name: snippet.name,
      prefix: snippet.prefix,
      body: snippet.body.join("\n"),
      description: snippet.description,
      language: snippet.language,
    });
    setEditingSnippet(snippet);
    setShowForm(true);
  };

  const handleDeleteSnippet = (id: string) => {
    const updated = snippets.filter((s) => s.id !== id);
    saveSnippets(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const snippet: Snippet = {
      id: editingSnippet?.id || `snippet-${Date.now()}`,
      name: formData.name,
      prefix: formData.prefix,
      body: formData.body.split("\n"),
      description: formData.description,
      language: formData.language,
    };

    let updated: Snippet[];
    if (editingSnippet) {
      updated = snippets.map((s) => (s.id === editingSnippet.id ? snippet : s));
    } else {
      updated = [...snippets, snippet];
    }

    saveSnippets(updated);
    onSave(snippet);
    setShowForm(false);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.3)",
        backdropFilter: "blur(8px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "var(--surface-elevated)",
          borderRadius: radius.lg,
          boxShadow:
            "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
          width: "800px",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              fontSize: "20px",
              fontWeight: 600,
              color: theme.text,
            }}
          >
            Custom Snippets
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: theme.textMuted,
              cursor: "pointer",
              fontSize: "24px",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "24px",
          }}
        >
          {!showForm ? (
            <>
              <button
                type="button"
                onClick={handleCreateSnippet}
                style={{
                  marginBottom: "16px",
                  padding: "8px 16px",
                  backgroundColor: isDark
                    ? "rgba(255,255,255,0.15)"
                    : "rgba(0,0,0,0.1)",
                  color: theme.text,
                  border: `1px solid ${theme.border}`,
                  borderRadius: radius.md,
                  cursor: "pointer",
                  fontWeight: 500,
                  transition: transitions.fast,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = isDark
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(0,0,0,0.15)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = isDark
                    ? "rgba(255,255,255,0.15)"
                    : "rgba(0,0,0,0.1)")
                }
              >
                + Create New Snippet
              </button>

              {snippets.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 0",
                    color: theme.textMuted,
                  }}
                >
                  <p>No custom snippets yet.</p>
                  <p style={{ fontSize: "14px", marginTop: "8px" }}>
                    Create your first snippet to get started!
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {snippets.map((snippet) => (
                    <div
                      key={snippet.id}
                      style={{
                        border: `1px solid ${theme.border}`,
                        borderRadius: radius.lg,
                        padding: "16px",
                        transition: transitions.fast,
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.borderColor = colors.status.info)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.borderColor = theme.border)
                      }
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "12px",
                            }}
                          >
                            <h3 style={{ fontWeight: 600, color: theme.text }}>
                              {snippet.name}
                            </h3>
                            <span
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                backgroundColor: isDark
                                  ? "rgba(255,255,255,0.1)"
                                  : "rgba(0,0,0,0.05)",
                                color: theme.textSecondary,
                                borderRadius: radius.sm,
                              }}
                            >
                              {snippet.prefix}
                            </span>
                            <span
                              style={{
                                padding: "4px 8px",
                                fontSize: "12px",
                                backgroundColor: isDark
                                  ? "rgba(59,130,246,0.2)"
                                  : "rgba(59,130,246,0.1)",
                                color: isDark ? "#93C5FD" : "#2563EB",
                                borderRadius: radius.sm,
                              }}
                            >
                              {snippet.language}
                            </span>
                          </div>
                          {snippet.description && (
                            <p
                              style={{
                                fontSize: "14px",
                                color: theme.textSecondary,
                                marginTop: "4px",
                              }}
                            >
                              {snippet.description}
                            </p>
                          )}
                          <pre
                            style={{
                              marginTop: "8px",
                              fontSize: "12px",
                              backgroundColor: "var(--surface-canvas)",
                              padding: "8px",
                              borderRadius: radius.sm,
                              overflowX: "auto",
                            }}
                          >
                            <code>{snippet.body.join("\n")}</code>
                          </pre>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: "8px",
                            marginLeft: "16px",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => handleEditSnippet(snippet)}
                            style={{
                              padding: "4px 12px",
                              fontSize: "14px",
                              color: colors.status.info,
                              background: "transparent",
                              border: "none",
                              borderRadius: radius.sm,
                              cursor: "pointer",
                              transition: transitions.fast,
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor = isDark
                                ? "rgba(59,130,246,0.2)"
                                : "rgba(59,130,246,0.1)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "transparent")
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSnippet(snippet.id)}
                            style={{
                              padding: "4px 12px",
                              fontSize: "14px",
                              color: colors.status.error,
                              background: "transparent",
                              border: "none",
                              borderRadius: radius.sm,
                              cursor: "pointer",
                              transition: transitions.fast,
                            }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor = isDark
                                ? "rgba(239,68,68,0.2)"
                                : "rgba(239,68,68,0.1)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "transparent")
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "16px" }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: theme.text,
                    marginBottom: "4px",
                  }}
                >
                  Snippet Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., API request helper"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: radius.md,
                    backgroundColor: "var(--surface-canvas)",
                    color: theme.text,
                    fontSize: "14px",
                  }}
                  required
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: theme.text,
                    marginBottom: "4px",
                  }}
                >
                  Prefix (trigger)
                </label>
                <input
                  type="text"
                  value={formData.prefix}
                  onChange={(e) =>
                    setFormData({ ...formData, prefix: e.target.value })
                  }
                  placeholder="e.g., apih"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: radius.md,
                    backgroundColor: "var(--surface-canvas)",
                    color: theme.text,
                    fontSize: "14px",
                  }}
                  required
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: theme.text,
                    marginBottom: "4px",
                  }}
                >
                  Language
                </label>
                <select
                  value={formData.language}
                  onChange={(e) =>
                    setFormData({ ...formData, language: e.target.value })
                  }
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: radius.md,
                    backgroundColor: "var(--surface-canvas)",
                    color: theme.text,
                    fontSize: "14px",
                  }}
                >
                  <option value="text">Plain Text</option>
                  <option value="php">PHP</option>
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                  <option value="json">JSON</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: theme.text,
                    marginBottom: "4px",
                  }}
                >
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="e.g., Creates a reusable request helper"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: radius.md,
                    backgroundColor: "var(--surface-canvas)",
                    color: theme.text,
                    fontSize: "14px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: theme.text,
                    marginBottom: "4px",
                  }}
                >
                  Snippet Body
                </label>
                <textarea
                  value={formData.body}
                  onChange={(e) =>
                    setFormData({ ...formData, body: e.target.value })
                  }
                  placeholder="public function ${1:methodName}()\n{\n    ${2:// code}\n}"
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    border: `1px solid ${theme.border}`,
                    borderRadius: radius.md,
                    backgroundColor: "var(--surface-canvas)",
                    color: theme.text,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: "13px",
                  }}
                  rows={10}
                  required
                />
                <p
                  style={{
                    marginTop: "4px",
                    fontSize: "12px",
                    color: theme.textMuted,
                  }}
                >
                  Use $&#123;1:placeholder&#125; for tab stops and placeholders
                </p>
              </div>

              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.15)"
                      : "rgba(0,0,0,0.1)",
                    color: theme.text,
                    border: `1px solid ${theme.border}`,
                    borderRadius: radius.md,
                    cursor: "pointer",
                    fontWeight: 500,
                    transition: transitions.fast,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = isDark
                      ? "rgba(255,255,255,0.2)"
                      : "rgba(0,0,0,0.15)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = isDark
                      ? "rgba(255,255,255,0.15)"
                      : "rgba(0,0,0,0.1)")
                  }
                >
                  {editingSnippet ? "Update Snippet" : "Create Snippet"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: isDark
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(0,0,0,0.05)",
                    color: theme.text,
                    border: "none",
                    borderRadius: radius.md,
                    cursor: "pointer",
                    transition: transitions.fast,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = isDark
                      ? "rgba(255,255,255,0.15)"
                      : "rgba(0,0,0,0.1)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = isDark
                      ? "rgba(255,255,255,0.1)"
                      : "rgba(0,0,0,0.05)")
                  }
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
