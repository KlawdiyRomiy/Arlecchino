package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Service) ListPendingApprovals(projectID string, limit int) ([]AIPendingApproval, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return []AIPendingApproval{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	artifacts, err := project.ChatArtifacts.List(limit * 4)
	if err != nil {
		return nil, err
	}
	pending := make([]AIPendingApproval, 0)
	resolved := map[string]struct{}{}
	for _, artifact := range artifacts {
		if artifact.Kind != AIChatRunArtifactToolProposal && artifact.Kind != AIChatRunArtifactTerminal {
			continue
		}
		if key, ok := resolvedApprovalKeyFromArtifact(artifact); ok {
			resolved[key] = struct{}{}
			continue
		}
		approval, ok := pendingApprovalFromArtifact(artifact)
		if !ok {
			continue
		}
		if approval.ProjectSessionID != "" && approval.ProjectSessionID != project.ID {
			continue
		}
		if _, ok := resolved[pendingApprovalKey(approval.RunID, approval.ToolID, approval.Arguments)]; ok {
			continue
		}
		pending = append(pending, approval)
		if len(pending) >= limit {
			break
		}
	}
	return pending, nil
}

func pendingApprovalFromArtifact(artifact AIChatRunArtifact) (AIPendingApproval, bool) {
	if artifact.Status != "approval_required" && artifact.Status != "proposed" && artifact.Status != "started" {
		return AIPendingApproval{}, false
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
		return AIPendingApproval{}, false
	}
	proposal, _ := payload["proposal"].(map[string]any)
	audit, _ := payload["audit"].(map[string]any)
	toolID := firstString(payload["toolId"], audit["toolId"], proposal["name"])
	if !strings.Contains(toolID, ".") {
		return AIPendingApproval{}, false
	}
	status := firstNonEmpty(firstString(payload["status"], audit["status"]), artifact.Status)
	if status != "approval_required" && status != "proposed" && status != "started" {
		return AIPendingApproval{}, false
	}
	arguments := mapStringString(payload["arguments"])
	if len(arguments) == 0 {
		arguments = mapStringString(audit["arguments"])
	}
	return AIPendingApproval{
		ID:               fmt.Sprintf("pending-%s", artifact.ID),
		RunID:            artifact.RunID,
		SessionID:        normalizeChatSessionID(artifact.SessionID),
		ProjectSessionID: artifact.ProjectSessionID,
		ArtifactID:       artifact.ID,
		ToolID:           toolID,
		Kind:             AIToolKind(firstString(payload["kind"], audit["kind"], proposal["kind"])),
		Action:           AIToolCallAction(firstString(payload["action"], audit["action"])),
		Status:           status,
		RiskLevel:        AIToolRiskLevel(firstString(proposal["riskLevel"])),
		ApprovalMode:     AIApprovalMode(firstString(proposal["approvalModeRequired"], audit["approvalModeRequired"])),
		ScopeSummary:     firstString(proposal["scopeSummary"], audit["scopeSummary"], artifact.Summary),
		TargetPaths:      stringSliceFromAny(firstNonNil(proposal["targetPaths"], audit["targetPaths"])),
		CommandPreview:   firstString(proposal["commandPreview"], audit["commandPreview"]),
		Arguments:        arguments,
		Artifact:         artifact,
		CreatedAt:        artifact.CreatedAt,
		UpdatedAt:        artifact.UpdatedAt,
	}, true
}

func resolvedApprovalKeyFromArtifact(artifact AIChatRunArtifact) (string, bool) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
		return "", false
	}
	audit, _ := payload["audit"].(map[string]any)
	proposal, _ := payload["proposal"].(map[string]any)
	toolID := firstString(payload["toolId"], audit["toolId"], proposal["name"])
	if !strings.Contains(toolID, ".") {
		return "", false
	}
	status := firstNonEmpty(firstString(payload["status"], audit["status"]), artifact.Status)
	if status == "approval_required" || status == "proposed" || status == "started" {
		return "", false
	}
	action := AIToolCallAction(firstString(payload["action"], audit["action"]))
	if action != AIToolCallActionExecute && action != AIToolCallActionDeny && action != AIToolCallActionApproveOnce && action != AIToolCallActionApproveForRun {
		return "", false
	}
	arguments := mapStringString(payload["arguments"])
	if len(arguments) == 0 {
		arguments = mapStringString(audit["arguments"])
	}
	return pendingApprovalKey(artifact.RunID, toolID, arguments), true
}

func pendingApprovalKey(runID string, toolID string, arguments map[string]string) string {
	return strings.Join([]string{
		strings.TrimSpace(runID),
		strings.TrimSpace(toolID),
		toolApprovalArgumentsHash(arguments),
	}, ":")
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func mapStringString(value any) map[string]string {
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	out := map[string]string{}
	for key, val := range raw {
		text, ok := val.(string)
		if ok {
			out[key] = text
		}
	}
	return out
}

func stringSliceFromAny(value any) []string {
	values, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			out = append(out, strings.TrimSpace(text))
		}
	}
	return out
}
