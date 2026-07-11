package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const maxToolOutputPreviewBytes = 16 * 1024
const toolApprovalGrantTTL = 15 * time.Minute

const (
	toolApprovalScopeOnce = "once"
	toolApprovalScopeRun  = "run"
)

var (
	terminalOutputRedirectionPattern = regexp.MustCompile(`(?m)(^|[;&|[:space:]])([0-9]?>|>>)[[:space:]]*[A-Za-z_./~$-]`)
	terminalTeeWritePattern          = regexp.MustCompile(`(?i)(^|[;&|][[:space:]]*)tee([[:space:]]+-a)?[[:space:]]+[^;&|]+`)
)

func (s *Service) ExecuteToolCall(ctx context.Context, projectID string, req AIToolCallRequest) (AIToolCallResult, error) {
	project := s.project(projectID)
	if project == nil {
		return AIToolCallResult{}, fmt.Errorf("AI project session is not open")
	}
	req.ToolID = strings.TrimSpace(req.ToolID)
	if req.ToolID == "" {
		return AIToolCallResult{}, fmt.Errorf("tool id is empty")
	}
	if req.Action == "" {
		req.Action = AIToolCallActionPreview
	}
	descriptor, ok := s.toolDescriptor(req.ToolID)
	if !ok {
		return AIToolCallResult{}, fmt.Errorf("tool %q is not registered", req.ToolID)
	}
	if strings.TrimSpace(req.RunID) != "" {
		if _, err := s.validateToolCallRun(project, req); err != nil {
			return AIToolCallResult{}, err
		}
	}

	proposal := toolProposalForCall(descriptor, req, project.ProjectRoot)
	proposal = evaluateToolProposal(proposal, s.approvalSummaryForProject(project), project.ProjectRoot)
	if req.Action == AIToolCallActionPreview || descriptor.Kind == AIToolKindContextRead {
		proposal.AllowedByCurrentPolicy = true
	}
	var approvalGrant *AIToolApprovalGrant
	var approvalGrantErr error
	if toolCallPerformsExecution(req.Action) && proposal.HardDenyReason == "" {
		if req.Action == AIToolCallActionExecute {
			if !proposal.AllowedByCurrentPolicy {
				if grant, ok := s.consumeToolApprovalGrant(project, req, descriptor); ok {
					approvalGrant = &grant
					proposal.AllowedByCurrentPolicy = true
				}
			}
		} else if scope := toolApprovalScopeForAction(req.Action); scope != "" {
			grant, err := s.grantToolApproval(project, req, descriptor, scope)
			if err != nil {
				approvalGrantErr = err
			} else {
				approvalGrant = &grant
				proposal.AllowedByCurrentPolicy = true
			}
		}
	}
	result := newToolCallResult(req, descriptor, proposal)
	s.emitToolLifecycleArtifact(project, result, proposal, "proposed", nil)
	if req.Action == AIToolCallActionDeny {
		result.Status = "denied"
		result.Error = "tool call denied by user"
		return s.finishToolCall(project, result, proposal, nil), nil
	}
	if proposal.HardDenyReason != "" {
		result.Status = "blocked"
		result.Error = string(proposal.HardDenyReason)
		return s.finishToolCall(project, result, proposal, nil), nil
	}
	if approvalGrantErr != nil {
		result.Status = "blocked"
		result.Error = approvalGrantErr.Error()
		return s.finishToolCall(project, result, proposal, nil), nil
	}
	if toolCallPerformsExecution(req.Action) && !proposal.AllowedByCurrentPolicy {
		result.Status = "approval_required"
		result.Error = "tool execution requires an active approval policy"
		return s.finishToolCall(project, result, proposal, nil), nil
	}

	if toolCallPerformsExecution(req.Action) {
		approvalPayload := map[string]any{
			"approvalModeRequired": proposal.ApprovalModeRequired,
			"approvalPolicyMode":   s.approvalSummaryForProject(project).Mode,
			"approvedByPolicy":     approvalGrant == nil,
		}
		if approvalGrant != nil {
			approvalPayload["approvalGrantId"] = approvalGrant.ID
			approvalPayload["approvalGrantScope"] = approvalGrant.Scope
			approvalPayload["approvedByGrant"] = true
			approvalPayload["approvedByPolicy"] = false
		}
		s.emitToolLifecycleArtifact(project, result, proposal, "approved", map[string]any{
			"approvalModeRequired": approvalPayload["approvalModeRequired"],
			"approvalPolicyMode":   approvalPayload["approvalPolicyMode"],
			"approvedByPolicy":     approvalPayload["approvedByPolicy"],
			"approvalGrantId":      approvalPayload["approvalGrantId"],
			"approvalGrantScope":   approvalPayload["approvalGrantScope"],
			"approvedByGrant":      approvalPayload["approvedByGrant"],
		})
	}
	s.emitToolLifecycleArtifact(project, result, proposal, "started", nil)
	execReq := req
	if toolCallPerformsExecution(req.Action) {
		execReq.Action = AIToolCallActionExecute
	}
	switch req.ToolID {
	case "agent.status.update":
		result = s.executeAgentStatusUpdateTool(project, execReq, result)
	case "agent.commentary":
		result = s.executeAgentCommentaryTool(project, execReq, result)
	case "context.read":
		result = s.executeContextReadTool(project, execReq, result)
	case "diagnostics.read":
		result = s.executeDiagnosticsReadTool(project, execReq, result)
	case "file.read_range":
		result = s.executeFileReadRangeTool(project, execReq, result)
	case "workspace.grep":
		result = s.executeWorkspaceGrepTool(project, execReq, result)
	case "file.edit.preview":
		result = s.executeFileEditPreviewTool(project, execReq, result)
	case "file.create.preview":
		result = s.executeFileCreatePreviewTool(project, execReq, result)
	case "file.patch.preview":
		result = s.executePatchPreviewTool(project, execReq, result)
	case "file.patch.apply":
		result = s.executePatchApplyTool(project, execReq, result)
	case "terminal.preview":
		if execReq.Action == AIToolCallActionExecute {
			result = s.executeTerminalTool(ctx, project, execReq, result)
		} else {
			result.Status = "previewed"
			result.OutputPreview = strings.TrimSpace(execReq.Arguments["command"])
		}
	case "git.preview":
		result = s.executeGitPreviewTool(ctx, project, execReq, result)
	case "memory.search":
		result = s.executeMemorySearchTool(project, execReq, result)
	case "memory.context":
		result = s.executeMemoryContextTool(project, execReq, result)
	case "memory.propose_save":
		result = s.executeMemoryProposeSaveTool(project, execReq, result)
	case "mcp.preview":
		if execReq.Action == AIToolCallActionExecute {
			result.Status = "blocked"
			result.Error = "mcp.preview cannot be executed; use an MCP execution tool"
		} else {
			result.Status = "previewed"
			result.OutputPreview = firstNonEmpty(execReq.Arguments["tool"], execReq.Arguments["name"], "mcp action")
		}
	case "mcp.execute":
		result = s.executeMCPExecuteTool(ctx, project, execReq, result)
	case "subagent.preview":
		result = s.executeSubagentPreviewTool(project, execReq, result)
	case "interaction.question":
		result = s.executeInteractionQuestionTool(project, execReq, result)
	default:
		result.Status = "blocked"
		result.Error = "tool is registered but has no executor"
	}
	return s.finishToolCall(project, result, proposal, nil), nil
}

func (s *Service) ListToolAudit(projectID string, limit int) ([]AIToolAuditRecord, error) {
	project := s.project(projectID)
	if project == nil || project.ToolAudit == nil {
		return []AIToolAuditRecord{}, nil
	}
	return project.ToolAudit.List(limit)
}

func (s *Service) toolDescriptor(toolID string) (AIToolDescriptor, bool) {
	for _, descriptor := range s.ListTools() {
		if descriptor.ID == toolID {
			return descriptor, true
		}
	}
	return AIToolDescriptor{}, false
}

func (s *Service) validateToolCallRun(project *ProjectSession, req AIToolCallRequest) (AIChatRun, error) {
	run, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil {
		return AIChatRun{}, err
	}
	if run.Status == "canceled" {
		return AIChatRun{}, fmt.Errorf("cannot review a tool call for a canceled run")
	}
	if req.RunRevision > 0 && run.Revision != req.RunRevision {
		return AIChatRun{}, fmt.Errorf("tool call run revision is stale: have %d, want %d", req.RunRevision, run.Revision)
	}
	return run, nil
}

func toolCallPerformsExecution(action AIToolCallAction) bool {
	switch action {
	case AIToolCallActionExecute, AIToolCallActionApproveOnce, AIToolCallActionApproveForRun:
		return true
	default:
		return false
	}
}

func toolApprovalScopeForAction(action AIToolCallAction) string {
	switch action {
	case AIToolCallActionApproveOnce:
		return toolApprovalScopeOnce
	case AIToolCallActionApproveForRun:
		return toolApprovalScopeRun
	default:
		return ""
	}
}

func (s *Service) grantToolApproval(project *ProjectSession, req AIToolCallRequest, descriptor AIToolDescriptor, scope string) (AIToolApprovalGrant, error) {
	if strings.TrimSpace(req.RunID) == "" {
		return AIToolApprovalGrant{}, fmt.Errorf("tool approval requires a run id")
	}
	run, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil {
		return AIToolApprovalGrant{}, err
	}
	if run.Status == "canceled" {
		return AIToolApprovalGrant{}, fmt.Errorf("cannot approve a tool call for a canceled run")
	}
	now := time.Now().UTC()
	grant := AIToolApprovalGrant{
		ID:               "tool-approval-" + uuid.NewString(),
		ProjectSessionID: project.ID,
		RunID:            req.RunID,
		ToolID:           descriptor.ID,
		Kind:             descriptor.Kind,
		Scope:            scope,
		ArgumentsHash:    toolApprovalArgumentsHash(req.Arguments),
		GrantedBy:        "user",
		GrantedAt:        now.Format(time.RFC3339),
		ExpiresAt:        now.Add(toolApprovalGrantTTL).Format(time.RFC3339),
	}
	if scope == toolApprovalScopeRun {
		s.mu.Lock()
		if s.toolApprovals == nil {
			s.toolApprovals = map[string]AIToolApprovalGrant{}
		}
		s.toolApprovals[toolApprovalGrantKey(project.ID, req.RunID, descriptor.ID, req.Arguments)] = grant
		s.mu.Unlock()
		if project.ToolApprovalGrants != nil {
			_ = project.ToolApprovalGrants.Upsert(grant)
		}
	}
	return grant, nil
}

func (s *Service) consumeToolApprovalGrant(project *ProjectSession, req AIToolCallRequest, descriptor AIToolDescriptor) (AIToolApprovalGrant, bool) {
	if strings.TrimSpace(req.RunID) == "" {
		return AIToolApprovalGrant{}, false
	}
	run, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil || run.Status == "canceled" {
		return AIToolApprovalGrant{}, false
	}
	key := toolApprovalGrantKey(project.ID, req.RunID, descriptor.ID, req.Arguments)
	s.mu.Lock()
	defer s.mu.Unlock()
	grant, ok := s.toolApprovals[key]
	if !ok {
		return AIToolApprovalGrant{}, false
	}
	expiresAt, err := time.Parse(time.RFC3339, grant.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now().UTC()) {
		delete(s.toolApprovals, key)
		if project.ToolApprovalGrants != nil {
			_ = project.ToolApprovalGrants.Delete(grant.ID)
		}
		return AIToolApprovalGrant{}, false
	}
	if grant.Scope == toolApprovalScopeOnce {
		grant.UsedAt = utcNow()
		delete(s.toolApprovals, key)
		if project.ToolApprovalGrants != nil {
			_ = project.ToolApprovalGrants.Delete(grant.ID)
		}
		return grant, true
	}
	return grant, true
}

func toolApprovalGrantKey(projectID string, runID string, toolID string, arguments map[string]string) string {
	return strings.Join([]string{
		normalizeProjectID(projectID),
		strings.TrimSpace(runID),
		strings.TrimSpace(toolID),
		toolApprovalArgumentsHash(arguments),
	}, ":")
}

func toolApprovalArgumentsHash(arguments map[string]string) string {
	return shortHash(toolArgumentsJSON(arguments))
}

func newToolCallResult(req AIToolCallRequest, descriptor AIToolDescriptor, proposal AIToolProposal) AIToolCallResult {
	now := utcNow()
	return AIToolCallResult{
		ID:        "tool-call-" + uuid.NewString(),
		ToolID:    descriptor.ID,
		Kind:      descriptor.Kind,
		Action:    req.Action,
		Status:    "created",
		Arguments: sanitizedToolArguments(req.Arguments),
		CreatedAt: now,
		Audit: AIToolAuditRecord{
			ID:                     "tool-audit-" + uuid.NewString(),
			RunID:                  strings.TrimSpace(req.RunID),
			ToolID:                 descriptor.ID,
			Kind:                   descriptor.Kind,
			Action:                 req.Action,
			Status:                 "created",
			ScopeSummary:           proposal.ScopeSummary,
			CommandPreview:         sanitizedDisplayText(proposal.CommandPreview),
			TargetPaths:            sanitizedToolPaths(proposal.TargetPaths),
			MCPToolName:            sanitizedDisplayText(proposal.MCPToolName),
			ApprovalModeRequired:   proposal.ApprovalModeRequired,
			AllowedByCurrentPolicy: proposal.AllowedByCurrentPolicy,
			HardDenyReason:         proposal.HardDenyReason,
			CreatedAt:              now,
		},
	}
}

func (s *Service) finishToolCall(project *ProjectSession, result AIToolCallResult, proposal AIToolProposal, payload any) AIToolCallResult {
	runID := strings.TrimSpace(result.Audit.RunID)
	if runID != "" && !s.runCanUseProject(project, runID) {
		return result
	}
	result.OutputPreview = truncateUTF8(sanitizedDisplayText(result.OutputPreview), maxToolOutputPreviewBytes)
	result.Error = sanitizedDisplayText(result.Error)
	result.Audit.Status = result.Status
	result.Audit.ArtifactID = result.ArtifactID
	result.Audit.OutputPreview = result.OutputPreview
	result.Audit.Error = result.Error
	result.Audit.AllowedByCurrentPolicy = proposal.AllowedByCurrentPolicy
	result.Audit.HardDenyReason = proposal.HardDenyReason
	if isAgentCommunicationToolID(result.ToolID) {
		return result
	}
	if project != nil && project.ToolAudit != nil {
		stored, err := project.ToolAudit.Append(result.Audit)
		if err == nil {
			result.Audit = stored
		}
	}
	s.emitToolLifecycleArtifact(project, result, proposal, toolLifecycleFinalPhase(result.Status), payload)
	s.updatePendingApprovalFromToolResult(project, result, proposal)
	if runID != "" {
		s.emitRunEvent(project, runID, "ai:tool:call-recorded", result)
	} else {
		s.emitEvent("ai:tool:call-recorded", result)
	}
	return result
}

func (s *Service) emitToolLifecycleArtifact(project *ProjectSession, result AIToolCallResult, proposal AIToolProposal, phase string, payload any) {
	if isAgentCommunicationToolID(result.ToolID) {
		return
	}
	artifact, ok := s.recordToolLifecycleArtifact(project, result, proposal, phase, payload)
	if ok {
		s.emitRunEvent(project, artifact.RunID, "ai:tool:lifecycle-recorded", artifact)
	}
}

func (s *Service) recordToolLifecycleArtifact(project *ProjectSession, result AIToolCallResult, proposal AIToolProposal, phase string, payload any) (AIChatRunArtifact, bool) {
	if project == nil || project.ChatArtifacts == nil || strings.TrimSpace(result.Audit.RunID) == "" {
		return AIChatRunArtifact{}, false
	}
	run, err := s.GetChatRun(project.ID, result.Audit.RunID)
	if err != nil {
		return AIChatRunArtifact{}, false
	}
	kind := AIChatRunArtifactToolProposal
	title := "Tool: " + result.ToolID
	if result.Kind == AIToolKindTerminal {
		kind = AIChatRunArtifactTerminal
		title = "Terminal tool"
	}
	now := utcNow()
	artifactID := toolLifecycleArtifactID(run.ID, result.ID)
	createdAt := now
	events := []map[string]any{}
	if existing, getErr := project.ChatArtifacts.Get(artifactID); getErr == nil {
		createdAt = firstNonEmpty(existing.CreatedAt, now)
		events = toolLifecycleEventsFromPayload(existing.PayloadJSON)
	}
	status := toolLifecycleArtifactStatus(phase, result.Status)
	event := map[string]any{
		"phase":      phase,
		"status":     status,
		"toolId":     result.ToolID,
		"artifactId": result.ArtifactID,
		"error":      result.Error,
		"at":         now,
	}
	if payload != nil {
		event["payload"] = payload
	}
	events = append(events, event)
	artifactPayload := toolLifecycleArtifactPayload(result, proposal, phase, status, events, payload)
	artifact := AIChatRunArtifact{
		ID:               artifactID,
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             kind,
		Status:           status,
		Title:            title,
		Summary:          toolLifecycleArtifactSummary(status, result, proposal),
		PayloadJSON:      marshalChatArtifactPayload(artifactPayload),
		CreatedAt:        createdAt,
		UpdatedAt:        now,
	}
	_ = project.ChatArtifacts.Upsert(artifact)
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Source:           "tool_gateway",
		Type:             "tool_" + phase,
		Status:           status,
		Actor:            "tool",
		ToolID:           result.ToolID,
		ArtifactID:       result.ArtifactID,
		CorrelationID:    result.ID,
		Summary:          toolLifecycleArtifactSummary(status, result, proposal),
		Capability:       AICapabilityChat,
	})
	s.emitRunEnvelope(project.ID, run.ID)
	return artifact, true
}

func toolLifecycleArtifactSummary(status string, result AIToolCallResult, proposal AIToolProposal) string {
	parts := []string{firstNonEmpty(result.Status, "recorded")}
	if status != "" && status != result.Status {
		parts = []string{status}
	}
	if proposal.ScopeSummary != "" {
		parts = append(parts, proposal.ScopeSummary)
	}
	if result.ArtifactID != "" {
		parts = append(parts, "artifact "+result.ArtifactID)
	}
	if result.Error != "" {
		parts = append(parts, result.Error)
	}
	if result.OutputPreview != "" && result.Error == "" {
		parts = append(parts, result.OutputPreview)
	}
	return strings.Join(parts, " · ")
}

func toolLifecycleArtifactID(runID string, resultID string) string {
	return "artifact-" + shortHash(runID+":tool:"+resultID)
}

func toolLifecycleFinalPhase(status string) string {
	switch strings.TrimSpace(status) {
	case "blocked", "approval_required", "denied":
		return strings.TrimSpace(status)
	case "error", "apply_error":
		return "failed"
	default:
		return "completed"
	}
}

func toolLifecycleArtifactStatus(phase string, resultStatus string) string {
	phase = strings.TrimSpace(phase)
	if phase == "proposed" || phase == "approved" || phase == "started" {
		return phase
	}
	return firstNonEmpty(strings.TrimSpace(resultStatus), phase, "recorded")
}

func toolLifecycleEventsFromPayload(payloadJSON string) []map[string]any {
	if strings.TrimSpace(payloadJSON) == "" {
		return nil
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &raw); err != nil {
		return nil
	}
	rawEvents, ok := raw["events"].([]any)
	if !ok {
		return nil
	}
	events := make([]map[string]any, 0, len(rawEvents))
	for _, rawEvent := range rawEvents {
		event, ok := rawEvent.(map[string]any)
		if ok {
			events = append(events, event)
		}
	}
	return events
}

func toolLifecycleArtifactPayload(result AIToolCallResult, proposal AIToolProposal, phase string, status string, events []map[string]any, payload any) map[string]any {
	output := map[string]any{
		"callId":        result.ID,
		"toolId":        result.ToolID,
		"kind":          result.Kind,
		"action":        result.Action,
		"phase":         phase,
		"status":        status,
		"resultStatus":  result.Status,
		"artifactId":    result.ArtifactID,
		"outputPreview": result.OutputPreview,
		"error":         result.Error,
		"arguments":     result.Arguments,
		"audit":         result.Audit,
		"proposal": map[string]any{
			"id":                     proposal.ID,
			"name":                   proposal.Name,
			"kind":                   proposal.Kind,
			"riskLevel":              proposal.RiskLevel,
			"scopeSummary":           proposal.ScopeSummary,
			"targetPaths":            sanitizedToolPaths(proposal.TargetPaths),
			"commandPreview":         sanitizedDisplayText(proposal.CommandPreview),
			"approvalModeRequired":   proposal.ApprovalModeRequired,
			"allowedByCurrentPolicy": proposal.AllowedByCurrentPolicy,
			"hardDenyReason":         proposal.HardDenyReason,
		},
		"lifecycle": lifecyclePhases(events),
		"events":    events,
	}
	if payload != nil {
		output["payload"] = payload
	}
	return output
}

func lifecyclePhases(events []map[string]any) []string {
	phases := make([]string, 0, len(events))
	for _, event := range events {
		phase, ok := event["phase"].(string)
		if ok && strings.TrimSpace(phase) != "" {
			phases = append(phases, phase)
		}
	}
	return phases
}

func (s *Service) executeContextReadTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	snapshot := s.buildContextSnapshot(project, AIContextRequest{
		Capability:      providers.CapabilityChat,
		Prompt:          req.Arguments["prompt"],
		FilePath:        req.Arguments["filePath"],
		IncludeMnemonic: req.Arguments["mnemonic"] == "true",
		IncludeMCP:      req.Arguments["mcp"] == "true",
		IncludeSkills:   req.Arguments["skills"] == "true",
		MaxBytes:        32 * 1024,
	})
	summary := summarizeContextSnapshot(snapshot)
	result.Status = "executed"
	result.OutputPreview = contextArtifactSummary(summary)
	return result
}

func (s *Service) executePatchPreviewTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if req.Action == AIToolCallActionExecute {
		result.Status = "blocked"
		result.Error = "file.patch.preview only creates a review artifact"
		return result
	}
	preview, err := s.PreviewPatch(project.ID, AIPatchPreviewRequest{
		RunID:       req.RunID,
		Title:       firstNonEmpty(req.Arguments["title"], "Tool patch preview"),
		Summary:     req.Arguments["summary"],
		UnifiedDiff: req.Arguments["unifiedDiff"],
	})
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	result.Status = preview.Artifact.Status
	result.ArtifactID = preview.Artifact.ID
	result.OutputPreview = preview.Artifact.Summary
	return result
}

func (s *Service) executePatchApplyTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	if req.Action != AIToolCallActionExecute {
		result.Status = "previewed"
		result.OutputPreview = req.Arguments["artifactId"]
		return result
	}
	applyResult, err := s.ApplyPatchArtifact(project.ID, AIPatchApplyRequest{ArtifactID: req.Arguments["artifactId"]})
	if err != nil {
		result.Status = firstNonEmpty(applyResult.Status, "blocked")
		result.Error = err.Error()
		return result
	}
	result.Status = applyResult.Status
	result.ArtifactID = applyResult.ArtifactID
	result.OutputPreview = strings.Join(applyResult.CheckpointIDs, ", ")
	return result
}

func (s *Service) executeTerminalTool(ctx context.Context, project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	command := strings.TrimSpace(req.Arguments["command"])
	if command == "" {
		result.Status = "blocked"
		result.Error = "terminal command is empty"
		return result
	}
	cwd, err := safeToolCWD(project.ProjectRoot, req.Arguments["cwd"])
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	runCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "/bin/sh", "-c", command)
	cmd.Dir = cwd
	output, err := cmd.CombinedOutput()
	result.OutputPreview = string(output)
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

func (s *Service) executeGitPreviewTool(ctx context.Context, project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	op := strings.TrimSpace(req.Arguments["op"])
	var args []string
	switch op {
	case "", "status":
		args = []string{"status", "--short"}
	case "diff":
		args = []string{"diff", "--stat"}
	case "log":
		args = []string{"log", "--oneline", "-20"}
	default:
		result.Status = "blocked"
		result.Error = "unsupported git preview operation"
		return result
	}
	runCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "git", append([]string{"-C", project.ProjectRoot}, args...)...)
	output, err := cmd.CombinedOutput()
	result.OutputPreview = string(output)
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

func toolProposalForCall(descriptor AIToolDescriptor, req AIToolCallRequest, projectRoot string) AIToolProposal {
	arguments := req.Arguments
	proposal := AIToolProposal{
		ID:                     "tool-call-" + descriptor.ID,
		Name:                   descriptor.ID,
		Description:            descriptor.Description,
		Policy:                 AIToolPolicyApprovalRequired,
		Arguments:              arguments,
		Kind:                   descriptor.Kind,
		ScopeSummary:           descriptor.Description,
		RiskLevel:              AIToolRiskMedium,
		CommandPreview:         arguments["command"],
		MCPToolName:            arguments["tool"],
		ApprovalModeRequired:   descriptor.DefaultApprovalMode,
		Status:                 AIToolProposalStatusProposed,
		ExecutionState:         AIToolExecutionStateNotExecutable,
		AllowedByCurrentPolicy: false,
	}
	if descriptor.Kind == AIToolKindContextRead || req.Action == AIToolCallActionPreview {
		proposal.Policy = AIToolPolicyReadOnly
		proposal.RiskLevel = AIToolRiskLow
		proposal.ApprovalModeRequired = AIApprovalModeReadOnlyAllowed
	}
	if target := strings.TrimSpace(arguments["path"]); target != "" {
		proposal.TargetPaths = []string{target}
	}
	if req.ToolID == "file.read_range" {
		proposal.ScopeSummary = "Project-scoped file range read: " + arguments["path"]
	}
	if req.ToolID == "diagnostics.read" {
		proposal.ScopeSummary = "Project-scoped diagnostics read: " + arguments["path"]
	}
	if req.ToolID == "workspace.grep" {
		proposal.ScopeSummary = "Project-scoped search: " + arguments["pattern"]
	}
	if artifactID := strings.TrimSpace(arguments["artifactId"]); artifactID != "" {
		proposal.ScopeSummary = "Project-scoped patch artifact apply: " + artifactID
	}
	if req.ToolID == "file.edit.preview" {
		proposal.ScopeSummary = "Project-scoped targeted edit preview: " + arguments["path"]
	}
	if req.ToolID == "file.create.preview" {
		proposal.ScopeSummary = "Project-scoped new file preview: " + arguments["path"]
	}
	if req.ToolID == "terminal.preview" && toolCallPerformsExecution(req.Action) {
		proposal.ApprovalModeRequired = AIApprovalModeFullAccess
		proposal.RiskLevel = AIToolRiskHigh
	}
	if req.ToolID == "file.patch.apply" {
		proposal.ApprovalModeRequired = AIApprovalModeFullAccess
		proposal.RiskLevel = AIToolRiskHigh
	}
	if req.ToolID == "git.preview" {
		proposal.Kind = AIToolKindContextRead
		proposal.ApprovalModeRequired = AIApprovalModeReadOnlyAllowed
	}
	if req.ToolID == "memory.search" {
		proposal.Kind = AIToolKindContextRead
		proposal.ScopeSummary = "Mnemonic memory search: " + firstNonEmpty(arguments["query"], "recent entries")
		proposal.ApprovalModeRequired = AIApprovalModeReadOnlyAllowed
		proposal.RiskLevel = AIToolRiskLow
	}
	if req.ToolID == "memory.context" {
		proposal.Kind = AIToolKindContextRead
		proposal.ScopeSummary = "Shared Mnemonic memory context"
		proposal.ApprovalModeRequired = AIApprovalModeReadOnlyAllowed
		proposal.RiskLevel = AIToolRiskLow
	}
	if req.ToolID == "memory.propose_save" {
		proposal.Kind = AIToolKindContextRead
		proposal.ScopeSummary = "Reviewable Mnemonic memory-save proposal"
		proposal.ApprovalModeRequired = AIApprovalModeReadOnlyAllowed
		proposal.RiskLevel = AIToolRiskMedium
	}
	if req.ToolID == "mcp.execute" {
		proposal.MCPToolName = firstNonEmpty(arguments["tool"], arguments["name"])
		class := classifyMCPSubtool(proposal.MCPToolName)
		proposal.ScopeSummary = class.ScopeSummary(proposal.MCPToolName)
		proposal.ApprovalModeRequired = class.ApprovalMode
		proposal.RiskLevel = class.RiskLevel
		if class.HardDenyReason != "" {
			proposal.HardDenyReason = class.HardDenyReason
		}
	}
	if req.ToolID == "subagent.preview" {
		proposal.ScopeSummary = "Isolated subagent preview: " + firstNonEmpty(arguments["prompt"], "background task")
		proposal.Kind = AIToolKindSubagent
		proposal.ApprovalModeRequired = AIApprovalModeAskEachTime
	}
	if req.ToolID == "interaction.question" {
		proposal.Kind = AIToolKindContextRead
		proposal.ScopeSummary = "Structured user question: " + firstNonEmpty(arguments["prompt"], arguments["question"], "clarifying question")
		proposal.ApprovalModeRequired = AIApprovalModeReadOnlyAllowed
		proposal.RiskLevel = AIToolRiskLow
	}
	if reason := hardDenyReasonForCommand(arguments["command"], projectRoot); reason != "" {
		proposal.HardDenyReason = reason
	}
	return proposal
}

func hardDenyReasonForCommand(command string, _ string) AIToolHardDenyReason {
	normalized := strings.ToLower(strings.TrimSpace(command))
	if normalized == "" {
		return ""
	}
	if strings.Contains(normalized, "rm -rf") ||
		strings.Contains(normalized, "sudo ") ||
		strings.Contains(normalized, "mkfs") ||
		strings.Contains(normalized, "diskutil erase") ||
		strings.Contains(normalized, "chmod -r 777") ||
		strings.Contains(normalized, ":(){") {
		return AIToolHardDenyReasonDestructiveShell
	}
	if strings.Contains(normalized, "api_key=") ||
		strings.Contains(normalized, "authorization: bearer") ||
		strings.Contains(normalized, "id_rsa") ||
		strings.Contains(normalized, ".env") {
		return AIToolHardDenyReasonSecrets
	}
	if terminalCommandLooksLikeFileWrite(normalized) {
		return AIToolHardDenyReasonTerminalFileWrite
	}
	if (strings.Contains(normalized, "curl ") ||
		strings.Contains(normalized, "wget ") ||
		strings.Contains(normalized, "ssh ") ||
		strings.Contains(normalized, "scp ")) &&
		!strings.Contains(normalized, "localhost") &&
		!strings.Contains(normalized, "127.0.0.1") &&
		!strings.Contains(normalized, "::1") {
		return AIToolHardDenyReasonNonLoopbackNetwork
	}
	return ""
}

func terminalCommandLooksLikeFileWrite(command string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return false
	}
	if terminalOutputRedirectionPattern.MatchString(command) ||
		terminalTeeWritePattern.MatchString(command) {
		return true
	}
	for _, marker := range []string{
		"sed -i",
		"sed -i.",
		"perl -pi",
		"perl -i",
		"ed -s ",
		"writefile",
		"writefilesync",
		"createwritestream",
	} {
		if strings.Contains(command, marker) {
			return true
		}
	}
	if strings.Contains(command, "open(") && strings.Contains(command, ".write(") {
		return true
	}
	return false
}

func safeToolCWD(projectRoot string, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "." {
		return projectRoot, nil
	}
	if filepath.IsAbs(value) {
		rel, err := filepath.Rel(projectRoot, value)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", fmt.Errorf("tool cwd escapes project")
		}
		return value, nil
	}
	return safeProjectPath(projectRoot, value)
}

func sanitizedToolArguments(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := map[string]string{}
	for key, value := range input {
		output[sanitizedDisplayText(key)] = truncateUTF8(sanitizedDisplayText(value), 1024)
	}
	return output
}

func sanitizedToolPaths(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	output := make([]string, 0, len(input))
	for _, path := range input {
		output = append(output, sanitizedDisplayText(path))
	}
	return output
}
