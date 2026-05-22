package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const maxMCPToolOutputPreviewBytes = 12 * 1024

type mcpSubtoolClass struct {
	ApprovalMode   AIApprovalMode
	RiskLevel      AIToolRiskLevel
	HardDenyReason AIToolHardDenyReason
	Category       string
}

func (c mcpSubtoolClass) ScopeSummary(toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		toolName = "unknown"
	}
	if strings.TrimSpace(c.Category) == "" {
		return "MCP tool call: " + toolName
	}
	return "MCP " + c.Category + " tool call: " + toolName
}

func classifyMCPSubtool(toolName string) mcpSubtoolClass {
	normalized := strings.TrimSpace(toolName)
	switch normalized {
	case "agent_memory.search", "agent_memory.list", "agent_memory.context",
		"ide_control.capabilities", "ide_control.permission_status",
		"ide_control.search_files", "ide_control.search_content",
		"ide_control.audit_logs", "ide_control.flight_recorder":
		return mcpSubtoolClass{ApprovalMode: AIApprovalModeReadOnlyAllowed, RiskLevel: AIToolRiskLow, Category: "read-only"}
	case "ide_ui.open_file_panel", "ide_ui.preview_open", "ide_ui.hot_switch",
		"ide_ui.apply_layout_profile", "ide_ui.apply_layout_snapshot",
		"ide_ui.register_layout_profile":
		return mcpSubtoolClass{ApprovalMode: AIApprovalModeAskEachTime, RiskLevel: AIToolRiskMedium, Category: "UI"}
	case "agent_memory.save":
		return mcpSubtoolClass{ApprovalMode: AIApprovalModeAskEachTime, RiskLevel: AIToolRiskMedium, Category: "memory-write"}
	case "ide_control.write_file", "ide_backend.terminal_create", "ide_backend.terminal_write",
		"ide_backend.terminal_resize", "ide_backend.terminal_close", "ide_backend.terminal_close_all",
		"ide_backend.dispatch_command", "ide_backend.project_close",
		"ide_backend.lsp_restart", "ide_backend.lsp_install",
		"change_journal.rollback_checkpoint":
		return mcpSubtoolClass{ApprovalMode: AIApprovalModeFullAccess, RiskLevel: AIToolRiskHigh, Category: "write/admin"}
	default:
		return mcpSubtoolClass{ApprovalMode: AIApprovalModeAskEachTime, RiskLevel: AIToolRiskMedium, Category: "unknown"}
	}
}

func (s *Service) executeMCPExecuteTool(ctx context.Context, project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	toolName := strings.TrimSpace(firstNonEmpty(req.Arguments["tool"], req.Arguments["name"]))
	if toolName == "" {
		result.Status = "blocked"
		result.Error = "MCP tool name is empty"
		return result
	}
	arguments, err := mcpToolArguments(req.Arguments)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	preview := fmt.Sprintf("%s %s", toolName, compactToolJSON(arguments))
	if req.Action != AIToolCallActionExecute {
		result.Status = "previewed"
		result.OutputPreview = preview
		return result
	}
	if s == nil || s.mcpExecutor == nil {
		result.Status = "blocked"
		result.Error = "MCP execution is not wired into the AI service"
		return result
	}
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	output, err := s.mcpExecutor(runCtx, project.ProjectRoot, toolName, arguments)
	result.OutputPreview = truncateUTF8(sanitizedDisplayText(compactToolJSON(output)), maxMCPToolOutputPreviewBytes)
	if runCtx.Err() != nil {
		result.Status = "error"
		result.Error = runCtx.Err().Error()
		return result
	}
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		return result
	}
	result.Status = "executed"
	return result
}

func (s *Service) executeSubagentPreviewTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if req.Action == AIToolCallActionExecute {
		result.Status = "blocked"
		result.Error = "subagent.preview only creates an isolated review artifact"
		return result
	}
	prompt := strings.TrimSpace(req.Arguments["prompt"])
	if prompt == "" {
		result.Status = "blocked"
		result.Error = "subagent prompt is empty"
		return result
	}
	action := AIChatAction(strings.TrimSpace(req.Arguments["action"]))
	if action == "" {
		action = AIChatActionPlan
	}
	if !validChatAction(action) {
		result.Status = "blocked"
		result.Error = fmt.Sprintf("unsupported subagent action %q", action)
		return result
	}
	preview, err := s.PreviewBackgroundAgent(project.ID, AIBackgroundAgentPreviewRequest{
		RunID:     req.RunID,
		Prompt:    prompt,
		Action:    action,
		ProfileID: req.Arguments["profileId"],
	})
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	result.Status = preview.Status
	result.ArtifactID = preview.Artifact.ID
	result.OutputPreview = preview.Artifact.Summary
	return result
}

func mcpToolArguments(arguments map[string]string) (map[string]any, error) {
	raw := strings.TrimSpace(firstNonEmpty(arguments["arguments"], arguments["args"], arguments["input"], arguments["parameters"], arguments["params"]))
	if raw == "" {
		return map[string]any{}, nil
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, fmt.Errorf("MCP tool arguments must be a JSON object: %w", err)
	}
	if decoded == nil {
		decoded = map[string]any{}
	}
	return decoded, nil
}

func compactToolJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(encoded)
}
