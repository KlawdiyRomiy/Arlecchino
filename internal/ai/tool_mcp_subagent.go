package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const maxMCPToolOutputPreviewBytes = 12 * 1024

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
