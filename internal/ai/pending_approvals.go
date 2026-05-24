package ai

import (
	"encoding/json"
	"fmt"
	"strings"

	"arlecchino/internal/ai/agents"
)

func (s *Service) ListPendingApprovals(projectID string, limit int) ([]AIPendingApproval, error) {
	project := s.project(projectID)
	if project == nil {
		return []AIPendingApproval{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if project.PendingApprovals != nil {
		ledgerPending, err := project.PendingApprovals.ListPending(limit)
		if err != nil {
			return nil, err
		}
		if len(ledgerPending) > 0 {
			return filterCanceledPendingApprovals(s, project, ledgerPending), nil
		}
		hasLedgerRecords, err := project.PendingApprovals.HasRecords()
		if err != nil {
			return nil, err
		}
		if hasLedgerRecords {
			return []AIPendingApproval{}, nil
		}
	}
	if project.ChatArtifacts == nil {
		return []AIPendingApproval{}, nil
	}
	artifacts, err := project.ChatArtifacts.List(limit * 4)
	if err != nil {
		return nil, err
	}
	pending := make([]AIPendingApproval, 0)
	resolved := map[string]struct{}{}
	canceledRunIDs := s.canceledRunIDs(project)
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
		if _, canceled := canceledRunIDs[approval.RunID]; canceled {
			continue
		}
		if _, ok := resolved[pendingApprovalKey(approval.RunID, approval.ToolID, approval.Arguments)]; ok {
			continue
		}
		if project.PendingApprovals != nil {
			_ = project.PendingApprovals.Upsert(approval)
		}
		pending = append(pending, approval)
		if len(pending) >= limit {
			break
		}
	}
	return pending, nil
}

func filterCanceledPendingApprovals(s *Service, project *ProjectSession, approvals []AIPendingApproval) []AIPendingApproval {
	if len(approvals) == 0 {
		return approvals
	}
	canceledRunIDs := s.canceledRunIDs(project)
	if len(canceledRunIDs) == 0 {
		return approvals
	}
	out := approvals[:0]
	for _, approval := range approvals {
		if _, canceled := canceledRunIDs[approval.RunID]; canceled {
			continue
		}
		out = append(out, approval)
	}
	return out
}

func (s *Service) canceledRunIDs(project *ProjectSession) map[string]struct{} {
	canceled := map[string]struct{}{}
	if s == nil || project == nil {
		return canceled
	}
	if project.ChatHistory != nil {
		if runs, err := project.ChatHistory.List(0); err == nil {
			for _, run := range runs {
				run = normalizeLoadedChatRun(project.ID, run)
				if run.Status == "canceled" {
					canceled[run.ID] = struct{}{}
				}
			}
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, run := range s.runs {
		if run.ProjectSessionID != project.ID {
			continue
		}
		if run.Status == "canceled" {
			canceled[run.ID] = struct{}{}
		} else {
			delete(canceled, run.ID)
		}
	}
	return canceled
}

func pendingApprovalFromArtifact(artifact AIChatRunArtifact) (AIPendingApproval, bool) {
	if artifact.Status != "approval_required" && artifact.Status != "proposed" {
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
	if status != "approval_required" && status != "proposed" {
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
	if status == "approval_required" || status == "proposed" {
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

func (s *Service) recordRuntimeApprovalEvent(project *ProjectSession, runID string, event agents.Event) {
	if project == nil || project.PendingApprovals == nil || strings.TrimSpace(runID) == "" {
		return
	}
	status := strings.TrimSpace(event.Status)
	if !strings.Contains(status, "approval") && status != "server_request.blocked" {
		return
	}
	approval, ok := s.pendingApprovalFromRuntimeEvent(project, runID, event)
	if !ok {
		return
	}
	if project.ChatArtifacts != nil {
		artifact := approval.Artifact
		_ = project.ChatArtifacts.Upsert(artifact)
		s.emitChatArtifactChanged(project, artifact, "ai:runtime:approval-recorded")
	}
	_ = project.PendingApprovals.Upsert(approval)
}

func (s *Service) pendingApprovalFromRuntimeEvent(project *ProjectSession, runID string, event agents.Event) (AIPendingApproval, bool) {
	method := firstNonEmpty(runtimePayloadString(event.Payload, "providerEventType"), strings.TrimSpace(event.Status))
	toolID, kind := runtimeApprovalTool(method)
	if toolID == "" {
		return AIPendingApproval{}, false
	}
	status := runtimeApprovalStatus(event.Status)
	now := firstNonEmpty(event.CreatedAt, utcNow())
	runSessionID := normalizeChatSessionID("")
	if run, err := s.GetChatRun(project.ID, runID); err == nil {
		runSessionID = normalizeChatSessionID(run.SessionID)
	}
	arguments := map[string]string{
		"providerEventType": method,
		"threadId":          runtimePayloadString(event.Payload, "threadId"),
		"turnId":            runtimePayloadString(event.Payload, "turnId"),
		"itemId":            runtimePayloadString(event.Payload, "itemId"),
		"approvalId":        runtimePayloadString(event.Payload, "approvalId"),
		"reason":            runtimePayloadString(event.Payload, "reason"),
		"command":           runtimePayloadString(event.Payload, "command"),
		"cwd":               runtimePayloadString(event.Payload, "cwd"),
		"hostDecision":      runtimePayloadString(event.Payload, "hostDecision"),
	}
	for key, value := range arguments {
		if strings.TrimSpace(value) == "" {
			delete(arguments, key)
		}
	}
	correlationID := firstNonEmpty(
		runtimePayloadString(event.Payload, "correlationId"),
		runtimeCorrelationID(runID, toolID, arguments["itemId"], arguments["approvalId"], method),
	)
	artifactID := "artifact-" + shortHash(runID+":runtime-approval:"+correlationID)
	risk := AIToolRiskHigh
	approvalMode := AIApprovalModeAskEachTime
	scope := runtimeApprovalScopeSummary(method, arguments)
	if status == "blocked" {
		approvalMode = AIApprovalModeFullAccess
	}
	artifact := AIChatRunArtifact{
		ID:               artifactID,
		RunID:            runID,
		SessionID:        runSessionID,
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactToolProposal,
		Status:           status,
		Title:            "Runtime approval: " + toolID,
		Summary:          scope,
		PayloadJSON: marshalChatArtifactPayload(map[string]any{
			"correlationId":          correlationID,
			"providerEventType":      method,
			"status":                 status,
			"toolId":                 toolID,
			"kind":                   kind,
			"arguments":              arguments,
			"hostDecision":           runtimePayloadString(event.Payload, "hostDecision"),
			"hostGrantedPermissions": stringSliceAny(event.Payload["hostGrantedPermissions"]),
			"hostDeniedPermissions":  stringSliceAny(event.Payload["hostDeniedPermissions"]),
			"failureCode":            runtimePayloadString(event.Payload, "failureCode"),
		}),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if kind == AIToolKindTerminal {
		artifact.Kind = AIChatRunArtifactTerminal
	}
	return AIPendingApproval{
		ID:               fmt.Sprintf("pending-%s", artifactID),
		RunID:            runID,
		SessionID:        runSessionID,
		ProjectSessionID: project.ID,
		ArtifactID:       artifactID,
		ToolID:           toolID,
		Kind:             kind,
		Action:           AIToolCallActionExecute,
		Status:           status,
		RiskLevel:        risk,
		ApprovalMode:     approvalMode,
		ScopeSummary:     scope,
		TargetPaths:      runtimeApprovalTargetPaths(event.Payload),
		CommandPreview:   arguments["command"],
		Arguments:        arguments,
		Artifact:         artifact,
		CreatedAt:        now,
		UpdatedAt:        now,
	}, true
}

func runtimeApprovalTool(method string) (string, AIToolKind) {
	switch strings.TrimSpace(method) {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return "provider.command.approve", AIToolKindTerminal
	case "item/fileChange/requestApproval", "applyPatchApproval":
		return "provider.file_change.approve", AIToolKindFileWrite
	case "item/permissions/requestApproval":
		return "provider.permissions.approve", AIToolKindTerminal
	default:
		if strings.Contains(method, "approval") {
			return "provider.callback.approve", AIToolKindTerminal
		}
		return "", ""
	}
}

func runtimeApprovalStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "approval.blocked", "server_request.blocked":
		return "blocked"
	case "approval.resolved":
		return "completed"
	default:
		return "approval_required"
	}
}

func runtimeApprovalScopeSummary(method string, arguments map[string]string) string {
	switch strings.TrimSpace(method) {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return "Provider requested command approval: " + firstNonEmpty(arguments["command"], arguments["reason"], method)
	case "item/fileChange/requestApproval", "applyPatchApproval":
		return "Provider requested file-change approval: " + firstNonEmpty(arguments["reason"], arguments["itemId"], method)
	case "item/permissions/requestApproval":
		return "Provider requested expanded permissions: " + firstNonEmpty(arguments["reason"], method)
	default:
		return "Provider requested unsupported host callback: " + method
	}
}

func runtimeApprovalTargetPaths(payload map[string]any) []string {
	paths := []string{}
	for _, key := range []string{"cwd", "grantRoot"} {
		if value := runtimePayloadString(payload, key); value != "" {
			paths = append(paths, value)
		}
	}
	return paths
}

func stringSliceAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string{}, typed...)
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				out = append(out, strings.TrimSpace(text))
			}
		}
		return out
	default:
		return nil
	}
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

func (s *Service) updatePendingApprovalFromToolResult(project *ProjectSession, result AIToolCallResult, proposal AIToolProposal) {
	if project == nil || project.PendingApprovals == nil || strings.TrimSpace(result.Audit.RunID) == "" {
		return
	}
	switch strings.TrimSpace(result.Status) {
	case "approval_required", "proposed":
		approval := pendingApprovalForToolResult(project, result, proposal)
		_ = project.PendingApprovals.Upsert(approval)
	case "denied", "blocked", "completed", "executed", "ready", "error", "apply_error":
		_ = project.PendingApprovals.Resolve(result.Audit.RunID, result.ToolID, result.Arguments, result.Status)
	}
}

func pendingApprovalForToolResult(project *ProjectSession, result AIToolCallResult, proposal AIToolProposal) AIPendingApproval {
	now := utcNow()
	artifactID := toolLifecycleArtifactID(result.Audit.RunID, result.ID)
	artifact := AIChatRunArtifact{
		ID:               artifactID,
		RunID:            result.Audit.RunID,
		SessionID:        normalizeChatSessionID(""),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactToolProposal,
		Status:           result.Status,
		Title:            "Tool: " + result.ToolID,
		Summary:          toolLifecycleArtifactSummary(result.Status, result, proposal),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if result.Kind == AIToolKindTerminal {
		artifact.Kind = AIChatRunArtifactTerminal
		artifact.Title = "Terminal tool"
	}
	if project.ChatArtifacts != nil {
		if stored, err := project.ChatArtifacts.Get(artifactID); err == nil {
			artifact = stored
		}
	}
	return AIPendingApproval{
		ID:               fmt.Sprintf("pending-%s", artifactID),
		RunID:            result.Audit.RunID,
		SessionID:        normalizeChatSessionID(artifact.SessionID),
		ProjectSessionID: project.ID,
		ArtifactID:       artifactID,
		ToolID:           result.ToolID,
		Kind:             result.Kind,
		Action:           result.Action,
		Status:           result.Status,
		RiskLevel:        proposal.RiskLevel,
		ApprovalMode:     proposal.ApprovalModeRequired,
		ScopeSummary:     proposal.ScopeSummary,
		TargetPaths:      sanitizedToolPaths(proposal.TargetPaths),
		CommandPreview:   sanitizedDisplayText(proposal.CommandPreview),
		Arguments:        result.Arguments,
		Artifact:         artifact,
		CreatedAt:        firstNonEmpty(artifact.CreatedAt, now),
		UpdatedAt:        firstNonEmpty(artifact.UpdatedAt, now),
	}
}
