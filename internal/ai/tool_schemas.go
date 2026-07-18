package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"arlecchino/internal/ai/providers"
)

const (
	providerToolAgentStatusUpdate   = "agent_status_update"
	providerToolAgentCommentary     = "agent_commentary"
	providerToolDiagnosticsRead     = "diagnostics_read"
	providerToolSemanticQuery       = "semantic_query"
	providerToolFileReadRange       = "file_read_range"
	providerToolWorkspaceGrep       = "workspace_grep"
	providerToolGitPreview          = "git_preview"
	providerToolMemorySearch        = "memory_search"
	providerToolMemoryContext       = "memory_context"
	providerToolMemoryProposeSave   = "memory_propose_save"
	providerToolTerminalPreview     = "terminal_preview"
	providerToolBrowserPreview      = "browser_preview"
	providerToolFileEditPreview     = "file_edit_preview"
	providerToolFileCreatePreview   = "file_create_preview"
	providerToolFilePatchPreview    = "file_patch_preview"
	providerToolMCPExecute          = "mcp_execute"
	providerToolSubagentPreview     = "subagent_preview"
	providerToolSubagentStart       = "subagent_start_readonly"
	providerToolSubagentStartPatch  = "subagent_start_patch"
	providerToolInteractionQuestion = "interaction_question"
)

type chatToolCallRequest struct {
	Request      AIToolCallRequest
	ProviderCall providers.GenerationToolCall
}

type chatToolset struct {
	Tools           []providers.GenerationTool
	Profile         string
	ToolSupportKind string
	ToolSupport     bool
}

const (
	chatToolProfileNone            = "none"
	chatToolProfileUnsupported     = "unsupported"
	chatToolProfileChatReadOnly    = "chat_read_only"
	chatToolProfilePlanReadOnly    = "plan_read_only"
	chatToolProfileDebugDiagnostic = "debug_diagnostic"
	chatToolProfileFullAgentLoop   = "full_agent_loop"
	chatToolProfileFastCurrentFile = "fast_current_file_edit"
)

func generationToolsetForChatRequest(req AIChatRunRequest, descriptor AIProviderDescriptor, model string) chatToolset {
	if !chatRequestUsesProviderTools(req) {
		return chatToolset{Profile: chatToolProfileNone, ToolSupport: true}
	}
	modelDescriptor := modelDescriptorForCapabilityEvidence(descriptor, model)
	evidence := modelCapabilityEvidenceFor(descriptor, modelDescriptor)
	if !evidence.ToolSupport {
		return chatToolset{
			Profile:         chatToolProfileUnsupported,
			ToolSupportKind: evidence.ToolSupportKind,
			ToolSupport:     false,
		}
	}
	tools := generationToolsForChatRequest(req)
	profile := chatToolProfileForRequest(req)
	if buildUsesFastCurrentFileEditToolset(req) {
		tools = filterGenerationTools(
			tools,
			providerToolAgentStatusUpdate,
			providerToolAgentCommentary,
			providerToolFileEditPreview,
			providerToolFileCreatePreview,
		)
		profile = chatToolProfileFastCurrentFile
	}
	return chatToolset{
		Tools:           tools,
		Profile:         profile,
		ToolSupportKind: evidence.ToolSupportKind,
		ToolSupport:     true,
	}
}

func chatRequestUsesProviderTools(req AIChatRunRequest) bool {
	switch req.Action {
	case AIChatActionAsk:
		return !isMinimalChatRequest(req)
	case AIChatActionBuild, AIChatActionDebug, AIChatActionPlan, AIChatActionReview:
		return true
	default:
		return false
	}
}

func chatToolProfileForRequest(req AIChatRunRequest) string {
	switch req.Action {
	case AIChatActionAsk:
		if isMinimalChatRequest(req) {
			return chatToolProfileNone
		}
		return chatToolProfileChatReadOnly
	case AIChatActionPlan:
		return chatToolProfilePlanReadOnly
	case AIChatActionDebug:
		return chatToolProfileDebugDiagnostic
	case AIChatActionBuild:
		return chatToolProfileFullAgentLoop
	case AIChatActionReview:
		return chatToolProfilePlanReadOnly
	default:
		return chatToolProfileNone
	}
}

func modelDescriptorForCapabilityEvidence(descriptor AIProviderDescriptor, model string) providers.AIModelDescriptor {
	model = strings.TrimSpace(firstNonEmpty(model, descriptor.DefaultModel))
	for _, candidate := range descriptor.Models {
		if strings.TrimSpace(candidate.ID) == model {
			return candidate
		}
	}
	return providers.AIModelDescriptor{ID: model, DisplayName: model, Streaming: true}
}

func filterGenerationTools(tools []providers.GenerationTool, names ...string) []providers.GenerationTool {
	if len(tools) == 0 || len(names) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(names))
	for _, name := range names {
		allowed[name] = struct{}{}
	}
	filtered := make([]providers.GenerationTool, 0, len(names))
	for _, tool := range tools {
		if _, ok := allowed[tool.Name]; ok {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func buildUsesFastCurrentFileEditToolset(req AIChatRunRequest) bool {
	if req.Action != AIChatActionBuild {
		return false
	}
	if strings.TrimSpace(req.ProfileID) == "subagent-runner" || strings.TrimSpace(req.ProfileID) == "subagent-patch-author" {
		return false
	}
	if len(strings.TrimSpace(req.Prompt)) > 260 {
		return false
	}
	if !buildRunHasConcreteFileEditSurface(req) {
		return false
	}
	for _, item := range req.Context.ContextItems {
		switch item.Kind {
		case AIContextItemKindWorkspace, AIContextItemKindTerminal, AIContextItemKindDiagnostics, AIContextItemKindGitDiff, AIContextItemKindMCP, AIContextItemKindSkill:
			return false
		}
	}
	return true
}

func generationToolsForChatRequest(req AIChatRunRequest) []providers.GenerationTool {
	if !chatRequestUsesProviderTools(req) {
		return nil
	}
	tools := []providers.GenerationTool{
		{
			Name:        providerToolAgentStatusUpdate,
			Description: "Broadcast private structured Agent Runtime state to Arlecchino. This never creates chat text. Use at meaningful phase changes, not for every small tool call.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"phase", "state", "title"},
				"properties": map[string]any{
					"phase": map[string]any{
						"type":        "string",
						"enum":        []string{"starting", "planning", "context", "researching", "reading", "editing", "writing", "running", "testing", "verifying", "reviewing", "waiting", "blocked", "finalizing", "completed"},
						"description": "Current semantic work phase.",
					},
					"state": map[string]any{
						"type":        "string",
						"enum":        []string{"active", "done", "waiting", "blocked", "error", "canceled"},
						"description": "State of this phase.",
					},
					"title": map[string]any{
						"type":        "string",
						"maxLength":   180,
						"description": "Short user-safe status label shown in the private inspector.",
					},
					"detail": map[string]any{
						"type":        "string",
						"maxLength":   420,
						"description": "Optional compact detail. Never include secrets or raw hidden reasoning.",
					},
				},
			},
		},
		{
			Name:        providerToolAgentCommentary,
			Description: "Publish one concise visible assistant progress message, separate from the final answer. Use at task start, after meaningful milestones, and before verification; do not narrate every tool call.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"message"},
				"properties": map[string]any{
					"message": map[string]any{
						"type":        "string",
						"maxLength":   700,
						"description": "Concise progress update in the user's language.",
					},
					"kind": map[string]any{
						"type":        "string",
						"enum":        []string{"progress", "milestone", "verification", "warning"},
						"description": "Presentation intent. Defaults to progress.",
					},
				},
			},
		},
		{
			Name:        providerToolInteractionQuestion,
			Description: "Ask the user one structured clarifying question only when the answer materially changes the outcome. Do not ask by default or as a routine confirmation step. Provide one to four mutually exclusive options; each option must include a concise hover description. Arlecchino renders a separate custom-answer path.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"prompt", "options"},
				"properties": map[string]any{
					"prompt": map[string]any{
						"type":        "string",
						"description": "The concrete clarifying question to show to the user.",
					},
					"options": map[string]any{
						"type":        "array",
						"minItems":    1,
						"maxItems":    maxInteractionQuestionOptions,
						"description": "One to four ready answers. The UI adds a separate custom-answer option.",
						"items": map[string]any{
							"type":                 "object",
							"additionalProperties": false,
							"required":             []string{"label", "description"},
							"properties": map[string]any{
								"id": map[string]any{
									"type":        "string",
									"description": "Stable short option id.",
								},
								"label": map[string]any{
									"type":        "string",
									"description": "Short button label.",
								},
								"value": map[string]any{
									"type":        "string",
									"description": "Answer value sent back if this option is selected.",
								},
								"description": map[string]any{
									"type":        "string",
									"description": "Hover explanation of this option's impact or tradeoff.",
								},
							},
						},
					},
				},
			},
		},
		{
			Name:        providerToolDiagnosticsRead,
			Description: "Read current LSP diagnostics for a project file. Use before fixing compile or lint errors when diagnostics are available.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"path"},
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Project-relative path to the file whose diagnostics should be read.",
					},
					"language": map[string]any{
						"type":        "string",
						"description": "Optional language id such as go, ts, tsx, or python.",
					},
					"limit": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"maximum":     50,
						"description": "Maximum diagnostics to return.",
					},
				},
			},
		},
		{
			Name:        providerToolSemanticQuery,
			Description: "Read bounded semantic code evidence through the IDE host. Supported operations are symbols, definition, references, diagnostics, and call_hierarchy. The returned source explicitly identifies LSP, indexer, or an honest unavailable/fallback result.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"operation"},
				"properties": map[string]any{
					"operation": map[string]any{
						"type":        "string",
						"enum":        []string{"symbols", "definition", "references", "diagnostics", "call_hierarchy"},
						"description": "Semantic operation to perform.",
					},
					"query": map[string]any{
						"type":        "string",
						"description": "Symbol or text query for symbols, references, or call hierarchy.",
					},
					"path": map[string]any{
						"type":        "string",
						"description": "Project-relative file path for definition or diagnostics.",
					},
					"line": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"description": "1-based line for definition.",
					},
					"character": map[string]any{
						"type":        "integer",
						"minimum":     0,
						"description": "0-based character for definition.",
					},
					"limit": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"maximum":     100,
						"description": "Maximum bounded result count.",
					},
				},
			},
		},
		{
			Name:        providerToolFileReadRange,
			Description: "Read a bounded, line-numbered range from a project text file. Use before targeted edits when the exact anchor is not already in context.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"path"},
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Project-relative path to the text file.",
					},
					"startLine": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"description": "1-based first line to read. Defaults to 1.",
					},
					"lineCount": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"maximum":     maxFileReadLineCount,
						"description": "Maximum number of lines to read.",
					},
				},
			},
		},
		{
			Name:        providerToolWorkspaceGrep,
			Description: "Search project text files for a literal or regex pattern and return bounded line-numbered matches. Use to locate anchors before edits.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"pattern"},
				"properties": map[string]any{
					"pattern": map[string]any{
						"type":        "string",
						"description": "Search pattern. Literal by default; set regex true for regular expressions.",
					},
					"regex": map[string]any{
						"type":        "boolean",
						"description": "Interpret pattern as a Go regular expression.",
					},
					"includeGlob": map[string]any{
						"type":        "string",
						"description": "Optional project-relative glob such as **/*.go or frontend/src/**/*.tsx.",
					},
					"maxMatches": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"maximum":     maxWorkspaceGrepMatches,
						"description": "Maximum number of matches to return.",
					},
				},
			},
		},
		{
			Name:        providerToolGitPreview,
			Description: "Read git status, diff summary, or recent log without mutating the repository.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"op": map[string]any{
						"type":        "string",
						"enum":        []string{"status", "diff", "log"},
						"description": "Git preview operation. Defaults to status.",
					},
				},
			},
		},
		{
			Name:        providerToolMemorySearch,
			Description: "Search shared project Mnemonic memory, including generated agent-memory entries, with trust/source labels. Use before relying on older project context.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "Search terms. Leave empty to list recent shared memory entries.",
					},
					"tags": map[string]any{
						"type":        "string",
						"description": "Optional comma-separated tags.",
					},
					"limit": map[string]any{
						"type":        "integer",
						"minimum":     1,
						"maximum":     12,
						"description": "Maximum memory entries to return.",
					},
				},
			},
		},
		{
			Name:        providerToolMemoryContext,
			Description: "Read a compact shared Mnemonic memory context summary with trust/source labels. This includes generated agent-memory entries but does not promote them to trusted facts.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"maxChars": map[string]any{
						"type":        "integer",
						"minimum":     200,
						"maximum":     4000,
						"description": "Maximum characters to return.",
					},
				},
			},
		},
	}
	if req.Action == AIChatActionDebug || req.Action == AIChatActionBuild {
		tools = append(tools, providers.GenerationTool{
			Name:        providerToolTerminalPreview,
			Description: "Preview a project-local terminal verification command. This does not execute from the model path; the user must approve execution.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"command"},
				"properties": map[string]any{
					"command": map[string]any{
						"type":        "string",
						"description": "Command to preview. Do not use shell redirection, tee, sed -i, network calls, sudo, or destructive commands.",
					},
					"cwd": map[string]any{
						"type":        "string",
						"description": "Optional project-relative working directory.",
					},
					"summary": map[string]any{
						"type":        "string",
						"description": "Short reason for the command.",
					},
				},
			},
		})
	}
	if req.Action == AIChatActionBuild {
		tools = append(tools, providers.GenerationTool{
			Name:        providerToolBrowserPreview,
			Description: "Propose opening a local browser preview only for a loopback http(s) URL. This is not browser automation or general web access: Arlecchino requires an explicit approval and records whether screenshot evidence is actually available.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"url"},
				"properties": map[string]any{
					"url": map[string]any{
						"type":        "string",
						"description": "Loopback http(s) URL such as http://127.0.0.1:3000. External domains are rejected.",
					},
					"title": map[string]any{
						"type":        "string",
						"description": "Optional short preview title.",
					},
				},
			},
		})
		tools = append(tools,
			providers.GenerationTool{
				Name:        providerToolMemoryProposeSave,
				Description: "Create a reviewable Mnemonic memory-save proposal. This does not save trusted memory; the user must review and approve the proposal before durable promotion.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"content"},
					"properties": map[string]any{
						"content": map[string]any{
							"type":        "string",
							"description": "Compact fact, decision, workflow, or handoff note to propose for shared Mnemonic memory.",
						},
						"type": map[string]any{
							"type":        "string",
							"description": "Memory type such as decision, fact, pattern, bug-fix, workflow, or session-summary.",
						},
						"tags": map[string]any{
							"type":        "string",
							"description": "Optional comma-separated tags.",
						},
						"importance": map[string]any{
							"type":        "integer",
							"minimum":     1,
							"maximum":     10,
							"description": "Relative importance from 1 to 10.",
						},
						"reason": map[string]any{
							"type":        "string",
							"description": "Why this should be reviewed for durable memory.",
						},
					},
				},
			},
			providers.GenerationTool{
				Name:        providerToolFileEditPreview,
				Description: "Create a reviewable patch artifact for a narrow file edit. Use this for small comments, local replacements, and insertions. If the anchor is already visible in provided context, call this directly. Do not pass whole-file oldText/newText rewrites.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"path", "operation", "newText"},
					"properties": map[string]any{
						"path": map[string]any{
							"type":        "string",
							"description": "Project-relative path to the text file.",
						},
						"operation": map[string]any{
							"type":        "string",
							"enum":        []string{"replace", "insert_before", "insert_after", "append"},
							"description": "Narrow edit operation. Prefer insert_before or insert_after for adding comments. Standalone line insertions are normalized at line boundaries.",
						},
						"oldText": map[string]any{
							"type":        "string",
							"description": "Exact unique narrow anchor text required for replace, insert_before, and insert_after. Never use the whole file as oldText.",
						},
						"newText": map[string]any{
							"type":        "string",
							"description": "Text to insert or replacement text. Keep it local; broad rewrites are rejected and must use explicit reviewed patches. Include exact newlines when known; line-boundary comment insertions are protected from being glued to the anchor.",
						},
						"title": map[string]any{
							"type":        "string",
							"description": "Short review title.",
						},
						"summary": map[string]any{
							"type":        "string",
							"description": "Short review summary.",
						},
					},
				},
			},
			providers.GenerationTool{
				Name:        providerToolFileCreatePreview,
				Description: "Create a reviewable patch artifact for a new project text file. Use for new files; do not use terminal commands to write files.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"path", "content"},
					"properties": map[string]any{
						"path": map[string]any{
							"type":        "string",
							"description": "Project-relative path for the new text file.",
						},
						"content": map[string]any{
							"type":        "string",
							"description": "Full content of the new file. Keep generated files out of this tool unless explicitly requested.",
						},
						"title": map[string]any{
							"type":        "string",
							"description": "Short review title.",
						},
						"summary": map[string]any{
							"type":        "string",
							"description": "Short review summary.",
						},
					},
				},
			},
			providers.GenerationTool{
				Name:        providerToolFilePatchPreview,
				Description: "Create a reviewable patch artifact from a git-style unified diff for multi-file or multi-hunk changes.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"unifiedDiff"},
					"properties": map[string]any{
						"unifiedDiff": map[string]any{
							"type":        "string",
							"description": "Git-style unified diff beginning with diff --git. It is checked before any apply.",
						},
						"title": map[string]any{
							"type":        "string",
							"description": "Short review title.",
						},
						"summary": map[string]any{
							"type":        "string",
							"description": "Short review summary.",
						},
					},
				},
			},
		)
		if req.ProfileID == "subagent-runner" {
			tools = append(tools, providers.GenerationTool{
				Name:        providerToolSubagentStart,
				Description: "Propose an isolated read-only child run with scoped context and a structured evidence result. It cannot modify the worktree, run terminal commands, use MCP, or inherit Build permissions. Arlecchino requires approval before it starts.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"objective"},
					"properties": map[string]any{
						"objective": map[string]any{
							"type":        "string",
							"description": "Concrete scoped task for the read-only child run.",
						},
						"role": map[string]any{
							"type":        "string",
							"description": "Optional concise read-only role, such as researcher or reviewer.",
						},
					},
				},
			})
			tools = append(tools, providers.GenerationTool{
				Name:        providerToolSubagentStartPatch,
				Description: "Propose an isolated patch-artifact child run. The child may draft reviewable patch artifacts only for its declared project-relative ownership paths; it cannot apply them, execute terminal commands, use MCP, or mutate the parent worktree. Arlecchino requires approval before it starts.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"objective", "ownedPaths"},
					"properties": map[string]any{
						"objective": map[string]any{
							"type":        "string",
							"description": "Concrete scoped implementation task for the child.",
						},
						"ownedPaths": map[string]any{
							"type":        "array",
							"items":       map[string]any{"type": "string"},
							"minItems":    1,
							"maxItems":    maxSubagentOwnedPaths,
							"description": "Exact project-relative files or directories owned by this child.",
						},
						"role": map[string]any{
							"type":        "string",
							"description": "Optional concise implementation role.",
						},
					},
				},
			})
		}
		tools = append(tools, providers.GenerationTool{
			Name:        providerToolMCPExecute,
			Description: "Preview an Arlecchino MCP tool call. Execution remains policy-gated by AI approval, MCP permission, subtool risk classification, audit, and visible UI acknowledgement when applicable.",
			Parameters: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"tool", "arguments"},
				"properties": map[string]any{
					"serverId": map[string]any{
						"type":        "string",
						"description": "Optional managed MCP server id. A managed server and its specific tool must be health-checked, enabled, and separately approved before execution.",
					},
					"tool": map[string]any{
						"type":        "string",
						"description": "MCP tool name, for example ide_ui.open_file_panel, ide_control.capabilities, or agent_memory.search.",
					},
					"arguments": map[string]any{
						"type":                 "object",
						"additionalProperties": true,
						"description":          "JSON object arguments for the MCP tool.",
					},
					"summary": map[string]any{
						"type":        "string",
						"description": "Short reason for the MCP action.",
					},
				},
			},
		})
	}
	return tools
}

func chatToolCallRequestsFromGenerationResponse(response providers.GenerationResponse) ([]chatToolCallRequest, error) {
	if len(response.ToolCalls) == 0 {
		return nil, nil
	}
	requests := make([]chatToolCallRequest, 0, len(response.ToolCalls))
	for _, call := range response.ToolCalls {
		toolID := toolIDForProviderToolName(call.Name)
		if toolID == "" {
			return nil, fmt.Errorf("AI provider returned unsupported tool call %q", strings.TrimSpace(call.Name))
		}
		arguments, err := toolArgumentsFromJSON(call.ArgumentsJSON)
		if err != nil {
			return nil, fmt.Errorf("AI provider returned invalid arguments for tool %s: %w", toolID, err)
		}
		arguments = normalizeProviderToolArguments(toolID, arguments)
		requests = append(requests, chatToolCallRequest{
			Request: AIToolCallRequest{
				ToolID:    toolID,
				Action:    AIToolCallActionPreview,
				Arguments: arguments,
			},
			ProviderCall: call,
		})
	}
	return requests, nil
}

func chatToolCallRequestFromToolRequest(req AIToolCallRequest, index int) chatToolCallRequest {
	name := providerToolNameForToolID(req.ToolID)
	return chatToolCallRequest{
		Request: req,
		ProviderCall: providers.GenerationToolCall{
			ID:            fmt.Sprintf("fenced_call_%d", index+1),
			Name:          name,
			ArgumentsJSON: toolArgumentsJSON(req.Arguments),
		},
	}
}

func toolIDForProviderToolName(name string) string {
	switch strings.TrimSpace(name) {
	case providerToolAgentStatusUpdate:
		return "agent.status.update"
	case providerToolAgentCommentary:
		return "agent.commentary"
	case providerToolDiagnosticsRead:
		return "diagnostics.read"
	case providerToolSemanticQuery:
		return "semantic.query"
	case providerToolFileReadRange:
		return "file.read_range"
	case providerToolWorkspaceGrep:
		return "workspace.grep"
	case providerToolGitPreview:
		return "git.preview"
	case providerToolMemorySearch:
		return "memory.search"
	case providerToolMemoryContext:
		return "memory.context"
	case providerToolMemoryProposeSave:
		return "memory.propose_save"
	case providerToolTerminalPreview:
		return "terminal.preview"
	case providerToolBrowserPreview:
		return "browser.preview"
	case providerToolFileEditPreview:
		return "file.edit.preview"
	case providerToolFileCreatePreview:
		return "file.create.preview"
	case providerToolFilePatchPreview:
		return "file.patch.preview"
	case providerToolMCPExecute:
		return "mcp.execute"
	case providerToolSubagentPreview:
		return "subagent.preview"
	case providerToolSubagentStart:
		return "subagent.start_readonly"
	case providerToolSubagentStartPatch:
		return "subagent.start_patch"
	case providerToolInteractionQuestion:
		return "interaction.question"
	default:
		return ""
	}
}

func providerToolNameForToolID(toolID string) string {
	switch strings.TrimSpace(toolID) {
	case "agent.status.update":
		return providerToolAgentStatusUpdate
	case "agent.commentary":
		return providerToolAgentCommentary
	case "diagnostics.read":
		return providerToolDiagnosticsRead
	case "semantic.query":
		return providerToolSemanticQuery
	case "file.read_range":
		return providerToolFileReadRange
	case "workspace.grep":
		return providerToolWorkspaceGrep
	case "git.preview":
		return providerToolGitPreview
	case "memory.search":
		return providerToolMemorySearch
	case "memory.context":
		return providerToolMemoryContext
	case "memory.propose_save":
		return providerToolMemoryProposeSave
	case "terminal.preview":
		return providerToolTerminalPreview
	case "browser.preview":
		return providerToolBrowserPreview
	case "file.edit.preview":
		return providerToolFileEditPreview
	case "file.create.preview":
		return providerToolFileCreatePreview
	case "file.patch.preview":
		return providerToolFilePatchPreview
	case "mcp.execute":
		return providerToolMCPExecute
	case "subagent.preview":
		return providerToolSubagentPreview
	case "subagent.start_readonly":
		return providerToolSubagentStart
	case "subagent.start_patch":
		return providerToolSubagentStartPatch
	case "interaction.question":
		return providerToolInteractionQuestion
	default:
		return strings.ReplaceAll(strings.TrimSpace(toolID), ".", "_")
	}
}

func toolArgumentsJSON(arguments map[string]string) string {
	if len(arguments) == 0 {
		return "{}"
	}
	encoded, err := json.Marshal(arguments)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func toolArgumentsFromJSON(value string) (map[string]string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return map[string]string{}, nil
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(value), &raw); err != nil {
		return nil, err
	}
	arguments := make(map[string]string, len(raw))
	for key, value := range raw {
		key = strings.TrimSpace(key)
		if key == "" || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			arguments[key] = typed
		default:
			encoded, err := json.Marshal(typed)
			if err != nil {
				arguments[key] = fmt.Sprint(typed)
			} else {
				arguments[key] = string(encoded)
			}
		}
	}
	return arguments, nil
}

func normalizeProviderToolArguments(toolID string, arguments map[string]string) map[string]string {
	normalized := make(map[string]string, len(arguments)+4)
	for key, value := range arguments {
		normalized[key] = value
	}
	switch toolID {
	case "agent.status.update":
		applyToolArgumentAlias(normalized, "phase", "stage", "step")
		applyToolArgumentAlias(normalized, "state", "status")
		applyToolArgumentAlias(normalized, "title", "summary", "label")
		applyToolArgumentAlias(normalized, "detail", "details", "message")
	case "agent.commentary":
		applyToolArgumentAlias(normalized, "message", "text", "summary")
		applyToolArgumentAlias(normalized, "kind", "type")
	case "diagnostics.read":
		normalizeDiagnosticsReadToolArguments(normalized)
	case "semantic.query":
		normalizeSemanticQueryToolArguments(normalized)
	case "file.read_range":
		normalizeReadRangeToolArguments(normalized)
	case "workspace.grep":
		normalizeWorkspaceGrepToolArguments(normalized)
	case "git.preview":
		applyToolArgumentAlias(normalized, "op", "operation", "action")
	case "terminal.preview":
		normalizeTerminalPreviewToolArguments(normalized)
	case "browser.preview":
		applyToolArgumentAlias(normalized, "url", "endpoint", "href")
		applyToolArgumentAlias(normalized, "title", "name", "label")
	case "file.edit.preview":
		normalizeEditPreviewToolArguments(normalized)
	case "file.create.preview":
		normalizeCreatePreviewToolArguments(normalized)
	case "file.patch.preview":
		applyToolArgumentAlias(normalized, "unifiedDiff", "unified_diff", "diff", "patch")
	case "mcp.execute":
		normalizeMCPExecuteToolArguments(normalized)
		applyToolArgumentAlias(normalized, "serverId", "server_id", "server")
	case "subagent.preview":
		applyToolArgumentAlias(normalized, "prompt", "task", "query", "instruction")
		applyToolArgumentAlias(normalized, "profileId", "profile_id", "profile")
	case "subagent.start_readonly":
		applyToolArgumentAlias(normalized, "objective", "prompt", "task", "query", "instruction")
		applyToolArgumentAlias(normalized, "role", "agentRole", "agent_role")
	case "subagent.start_patch":
		applyToolArgumentAlias(normalized, "objective", "prompt", "task", "query", "instruction")
		applyToolArgumentAlias(normalized, "role", "agentRole", "agent_role")
		applyToolArgumentAlias(normalized, "ownedPaths", "owned_paths", "paths", "files")
	case "interaction.question":
		applyToolArgumentAlias(normalized, "prompt", "question", "message")
	}
	return normalized
}

func normalizeDiagnosticsReadToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "path", "file_path", "filePath", "filepath", "file", "target_file", "targetFile")
	applyToolArgumentAlias(arguments, "language", "lang", "languageId", "language_id")
	applyToolArgumentAlias(arguments, "limit", "max", "count")
}

func normalizeSemanticQueryToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "operation", "op", "kind", "action")
	applyToolArgumentAlias(arguments, "query", "symbol", "name", "search")
	applyToolArgumentAlias(arguments, "path", "file_path", "filePath", "file", "target_file")
	applyToolArgumentAlias(arguments, "line", "startLine", "start_line")
	applyToolArgumentAlias(arguments, "character", "char", "column")
	applyToolArgumentAlias(arguments, "limit", "max", "count")
}

func normalizeReadRangeToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "path", "file_path", "filePath", "filepath", "file", "target_file", "targetFile")
	applyToolArgumentAlias(arguments, "startLine", "start_line", "start", "from", "line")
	applyToolArgumentAlias(arguments, "lineCount", "line_count", "lines", "count", "limit")
}

func normalizeWorkspaceGrepToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "pattern", "query", "search", "needle")
	applyToolArgumentAlias(arguments, "includeGlob", "include_glob", "glob", "pathGlob", "path_glob")
	applyToolArgumentAlias(arguments, "maxMatches", "max_matches", "limit", "count")
}

func normalizeTerminalPreviewToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "command", "cmd", "shell", "input")
	applyToolArgumentAlias(arguments, "cwd", "workingDirectory", "working_directory", "dir")
}

func normalizeEditPreviewToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "path", "file_path", "filePath", "filepath", "file", "target_file", "targetFile")
	applyToolArgumentAlias(arguments, "oldText", "old_text", "old", "anchor", "target", "needle", "before")
	applyToolArgumentAlias(arguments, "newText", "new_text", "new", "content", "replacement", "text")
	applyToolArgumentAlias(arguments, "operation", "op", "action")
	if edit := nestedToolArgumentObject(arguments["edit"]); len(edit) > 0 {
		applyToolArgumentAliasFrom(arguments, edit, "path", "path", "file_path", "filePath", "filepath", "file", "target_file", "targetFile")
		applyToolArgumentAliasFrom(arguments, edit, "oldText", "oldText", "old_text", "old", "anchor", "target", "needle")
		applyToolArgumentAliasFrom(arguments, edit, "newText", "newText", "new_text", "new", "content", "replacement", "text")
		applyToolArgumentAliasFrom(arguments, edit, "operation", "operation", "op")
		if strings.TrimSpace(arguments["operation"]) == "" {
			if op := normalizedEditOperation(edit["action"], edit["position"]); op != "" {
				arguments["operation"] = op
			}
		}
	}
	if op := normalizedEditOperation(arguments["operation"], arguments["position"]); op != "" {
		arguments["operation"] = op
	}
}

func normalizeCreatePreviewToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "path", "file_path", "filePath", "filepath", "file", "target_file", "targetFile")
	applyToolArgumentAlias(arguments, "content", "newText", "new_text", "text", "body")
}

func normalizeMCPExecuteToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "tool", "toolName", "tool_name", "name")
	applyToolArgumentAlias(arguments, "arguments", "args", "input", "parameters", "params")
}

func applyToolArgumentAlias(arguments map[string]string, canonical string, aliases ...string) {
	applyToolArgumentAliasFrom(arguments, arguments, canonical, aliases...)
}

func applyToolArgumentAliasFrom(target map[string]string, source map[string]string, canonical string, aliases ...string) {
	if strings.TrimSpace(target[canonical]) != "" {
		return
	}
	for _, alias := range aliases {
		value, ok := source[alias]
		if !ok || strings.TrimSpace(value) == "" {
			continue
		}
		target[canonical] = value
		return
	}
}

func nestedToolArgumentObject(value string) map[string]string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(value), &raw); err != nil {
		return nil
	}
	output := make(map[string]string, len(raw))
	for key, value := range raw {
		key = strings.TrimSpace(key)
		if key == "" || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			output[key] = typed
		default:
			encoded, err := json.Marshal(typed)
			if err != nil {
				output[key] = fmt.Sprint(typed)
			} else {
				output[key] = string(encoded)
			}
		}
	}
	return output
}

func normalizedEditOperation(operation string, position string) string {
	op := normalizeToolArgumentToken(operation)
	pos := normalizeToolArgumentToken(position)
	switch op {
	case "replace":
		return "replace"
	case "append":
		return "append"
	case "insert_before", "before", "prepend":
		return "insert_before"
	case "insert_after", "after":
		return "insert_after"
	case "insert":
		switch pos {
		case "before", "above", "prepend":
			return "insert_before"
		case "after", "below", "append":
			return "insert_after"
		}
	}
	return ""
}

func normalizeToolArgumentToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "-", "_")
	value = strings.ReplaceAll(value, " ", "_")
	return value
}
