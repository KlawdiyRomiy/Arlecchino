package ai

import (
	"fmt"
	"strings"
)

const (
	defaultDiagnosticsReadLimit = 20
	maxDiagnosticsReadLimit     = 50
)

func (s *Service) executeDiagnosticsReadTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if s == nil || s.diagnostics == nil {
		result.Status = "unavailable"
		result.Error = "diagnostics reader is not wired into the AI service"
		return result
	}
	relPath := strings.TrimSpace(req.Arguments["path"])
	if relPath == "" {
		result.Status = "blocked"
		result.Error = "diagnostics path is empty"
		return result
	}
	if !fileReadRangePathAllowed(relPath) {
		result.Status = "blocked"
		result.Error = "diagnostics path is sensitive or binary-like"
		return result
	}
	if _, err := safeProjectPath(project.ProjectRoot, relPath); err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	limit := parsePositiveToolInt(req.Arguments["limit"], defaultDiagnosticsReadLimit)
	if limit > maxDiagnosticsReadLimit {
		limit = maxDiagnosticsReadLimit
	}
	output, err := s.diagnostics(project.ProjectRoot, relPath, req.Arguments["language"], limit)
	if err != nil {
		result.Status = "unavailable"
		result.Error = sanitizedDisplayText(err.Error())
		return result
	}
	output = strings.TrimSpace(output)
	if output == "" {
		output = fmt.Sprintf("No diagnostics for %s.", relPath)
	}
	result.Status = "executed"
	result.OutputPreview = output
	return result
}
