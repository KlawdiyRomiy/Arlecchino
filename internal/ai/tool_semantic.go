package ai

import (
	"fmt"
	"strconv"
	"strings"
)

func (s *Service) executeSemanticQueryTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if s == nil || s.semantic == nil {
		result.Status = "blocked"
		result.Error = "semantic context adapter is not available"
		return result
	}
	semanticReq := AISemanticQueryRequest{
		Operation: strings.TrimSpace(req.Arguments["operation"]),
		Query:     strings.TrimSpace(req.Arguments["query"]),
		Path:      strings.TrimSpace(req.Arguments["path"]),
		Line:      semanticInteger(req.Arguments["line"]),
		Character: semanticInteger(req.Arguments["character"]),
		Limit:     semanticInteger(req.Arguments["limit"]),
	}
	if !validSemanticOperation(semanticReq.Operation) {
		result.Status = "blocked"
		result.Error = fmt.Sprintf("unsupported semantic operation %q", semanticReq.Operation)
		return result
	}
	value, err := s.semantic(project.ProjectRoot, semanticReq)
	if err != nil {
		result.Status = "error"
		result.Error = sanitizedDisplayText(err.Error())
		return result
	}
	result.Status = "executed"
	result.OutputPreview = truncateUTF8(sanitizedDisplayText(strings.TrimSpace(strings.Join([]string{value.Source, value.Summary, value.Payload}, "\n"))), maxToolOutputPreviewBytes)
	return result
}

func validSemanticOperation(operation string) bool {
	switch strings.TrimSpace(operation) {
	case "symbols", "definition", "references", "diagnostics", "call_hierarchy":
		return true
	default:
		return false
	}
}

func semanticInteger(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 0 {
		return 0
	}
	return parsed
}
