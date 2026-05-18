package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"arlecchino/internal/ai/providers"
)

const (
	providerToolDiagnosticsRead   = "diagnostics_read"
	providerToolFileReadRange     = "file_read_range"
	providerToolWorkspaceGrep     = "workspace_grep"
	providerToolGitPreview        = "git_preview"
	providerToolTerminalPreview   = "terminal_preview"
	providerToolFileEditPreview   = "file_edit_preview"
	providerToolFileCreatePreview = "file_create_preview"
	providerToolFilePatchPreview  = "file_patch_preview"
	providerToolMCPExecute        = "mcp_execute"
	providerToolSubagentPreview   = "subagent_preview"
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
	chatToolProfilePlanReadOnly    = "plan_read_only"
	chatToolProfileDebugDiagnostic = "debug_diagnostic"
	chatToolProfileFullAgentLoop   = "full_agent_loop"
	chatToolProfileFastCurrentFile = "fast_current_file_edit"
)

func generationToolsetForChatRequest(req AIChatRunRequest, descriptor AIProviderDescriptor, model string) chatToolset {
	if req.Action != AIChatActionBuild && req.Action != AIChatActionDebug && req.Action != AIChatActionPlan {
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
	profile := chatToolProfileForAction(req.Action)
	if buildUsesFastCurrentFileEditToolset(req) {
		tools = filterGenerationTools(tools, providerToolFileEditPreview, providerToolFileCreatePreview)
		profile = chatToolProfileFastCurrentFile
	}
	return chatToolset{
		Tools:           tools,
		Profile:         profile,
		ToolSupportKind: evidence.ToolSupportKind,
		ToolSupport:     true,
	}
}

func chatToolProfileForAction(action AIChatAction) string {
	switch action {
	case AIChatActionPlan:
		return chatToolProfilePlanReadOnly
	case AIChatActionDebug:
		return chatToolProfileDebugDiagnostic
	case AIChatActionBuild:
		return chatToolProfileFullAgentLoop
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
	if strings.TrimSpace(req.ProfileID) == "subagent-runner" || req.IncludeMCP || req.Context.IncludeMCP {
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
	if req.Action != AIChatActionBuild && req.Action != AIChatActionDebug && req.Action != AIChatActionPlan {
		return nil
	}
	tools := []providers.GenerationTool{
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
		tools = append(tools,
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
				Name:        providerToolSubagentPreview,
				Description: "Create an isolated background-agent preview artifact with scoped context. This does not mutate files or launch unreviewed background work.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"prompt"},
					"properties": map[string]any{
						"prompt": map[string]any{
							"type":        "string",
							"description": "Concrete scoped task for the background agent preview.",
						},
						"action": map[string]any{
							"type":        "string",
							"enum":        []string{"ask", "debug", "plan", "build"},
							"description": "Mode for the isolated preview. Defaults to plan.",
						},
						"profileId": map[string]any{
							"type":        "string",
							"description": "Optional subagent profile id.",
						},
					},
				},
			})
		}
		if req.IncludeMCP || req.Context.IncludeMCP {
			tools = append(tools, providers.GenerationTool{
				Name:        providerToolMCPExecute,
				Description: "Preview an MCP tool call for user approval. Execution remains approval-gated by both AI policy and MCP policy.",
				Parameters: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"required":             []string{"tool", "arguments"},
					"properties": map[string]any{
						"tool": map[string]any{
							"type":        "string",
							"description": "MCP tool name, for example ide_ui.open_file_panel or ide_control.search_files.",
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
	}
	return tools
}

func toolCallRequestsFromGenerationResponse(response providers.GenerationResponse) []AIToolCallRequest {
	calls := chatToolCallRequestsFromGenerationResponse(response)
	if len(calls) == 0 {
		return nil
	}
	requests := make([]AIToolCallRequest, 0, len(calls))
	for _, call := range calls {
		requests = append(requests, call.Request)
	}
	return requests
}

func chatToolCallRequestsFromGenerationResponse(response providers.GenerationResponse) []chatToolCallRequest {
	if len(response.ToolCalls) == 0 {
		return nil
	}
	requests := make([]chatToolCallRequest, 0, len(response.ToolCalls))
	for _, call := range response.ToolCalls {
		toolID := toolIDForProviderToolName(call.Name)
		if toolID == "" {
			continue
		}
		arguments, err := toolArgumentsFromJSON(call.ArgumentsJSON)
		if err != nil {
			continue
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
	return requests
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
	case providerToolDiagnosticsRead:
		return "diagnostics.read"
	case providerToolFileReadRange:
		return "file.read_range"
	case providerToolWorkspaceGrep:
		return "workspace.grep"
	case providerToolGitPreview:
		return "git.preview"
	case providerToolTerminalPreview:
		return "terminal.preview"
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
	default:
		return ""
	}
}

func providerToolNameForToolID(toolID string) string {
	switch strings.TrimSpace(toolID) {
	case "diagnostics.read":
		return providerToolDiagnosticsRead
	case "file.read_range":
		return providerToolFileReadRange
	case "workspace.grep":
		return providerToolWorkspaceGrep
	case "git.preview":
		return providerToolGitPreview
	case "terminal.preview":
		return providerToolTerminalPreview
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
	case "diagnostics.read":
		normalizeDiagnosticsReadToolArguments(normalized)
	case "file.read_range":
		normalizeReadRangeToolArguments(normalized)
	case "workspace.grep":
		normalizeWorkspaceGrepToolArguments(normalized)
	case "git.preview":
		applyToolArgumentAlias(normalized, "op", "operation", "action")
	case "terminal.preview":
		normalizeTerminalPreviewToolArguments(normalized)
	case "file.edit.preview":
		normalizeEditPreviewToolArguments(normalized)
	case "file.create.preview":
		normalizeCreatePreviewToolArguments(normalized)
	case "file.patch.preview":
		applyToolArgumentAlias(normalized, "unifiedDiff", "unified_diff", "diff", "patch")
	case "mcp.execute":
		normalizeMCPExecuteToolArguments(normalized)
	case "subagent.preview":
		applyToolArgumentAlias(normalized, "prompt", "task", "query", "instruction")
		applyToolArgumentAlias(normalized, "profileId", "profile_id", "profile")
	}
	return normalized
}

func normalizeDiagnosticsReadToolArguments(arguments map[string]string) {
	applyToolArgumentAlias(arguments, "path", "file_path", "filePath", "filepath", "file", "target_file", "targetFile")
	applyToolArgumentAlias(arguments, "language", "lang", "languageId", "language_id")
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
