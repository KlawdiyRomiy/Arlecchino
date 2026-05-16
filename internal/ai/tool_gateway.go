package ai

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const maxToolOutputPreviewBytes = 16 * 1024

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
		if _, err := s.GetChatRun(project.ID, req.RunID); err != nil {
			return AIToolCallResult{}, err
		}
	}

	proposal := toolProposalForCall(descriptor, req, project.ProjectRoot)
	proposal = evaluateToolProposal(proposal, s.approvalSummaryForProject(project), project.ProjectRoot)
	if req.Action == AIToolCallActionPreview || descriptor.Kind == AIToolKindContextRead {
		proposal.AllowedByCurrentPolicy = true
	}
	result := newToolCallResult(req, descriptor, proposal)
	if proposal.HardDenyReason != "" {
		result.Status = "blocked"
		result.Error = string(proposal.HardDenyReason)
		return s.finishToolCall(project, result, proposal, nil), nil
	}
	if req.Action == AIToolCallActionExecute && !proposal.AllowedByCurrentPolicy {
		result.Status = "approval_required"
		result.Error = "tool execution requires an active approval policy"
		return s.finishToolCall(project, result, proposal, nil), nil
	}

	switch req.ToolID {
	case "context.read":
		result = s.executeContextReadTool(project, req, result)
	case "file.patch.preview":
		result = s.executePatchPreviewTool(project, req, result)
	case "file.patch.apply":
		result = s.executePatchApplyTool(project, req, result)
	case "terminal.preview":
		if req.Action == AIToolCallActionExecute {
			result = s.executeTerminalTool(ctx, project, req, result)
		} else {
			result.Status = "previewed"
			result.OutputPreview = strings.TrimSpace(req.Arguments["command"])
		}
	case "git.preview":
		result = s.executeGitPreviewTool(ctx, project, req, result)
	case "mcp.preview":
		result.Status = "previewed"
		result.OutputPreview = firstNonEmpty(req.Arguments["tool"], req.Arguments["name"], "mcp action")
	case "mcp.execute":
		result.Status = "blocked"
		result.Error = "MCP execution is not available until an MCP executor is injected into the AI service"
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
	result.OutputPreview = truncateUTF8(sanitizedDisplayText(result.OutputPreview), maxToolOutputPreviewBytes)
	result.Error = sanitizedDisplayText(result.Error)
	result.Audit.Status = result.Status
	result.Audit.ArtifactID = result.ArtifactID
	result.Audit.OutputPreview = result.OutputPreview
	result.Audit.Error = result.Error
	result.Audit.AllowedByCurrentPolicy = proposal.AllowedByCurrentPolicy
	result.Audit.HardDenyReason = proposal.HardDenyReason
	if project != nil && project.ToolAudit != nil {
		stored, err := project.ToolAudit.Append(result.Audit)
		if err == nil {
			result.Audit = stored
		}
	}
	if project != nil && project.ChatArtifacts != nil && strings.TrimSpace(result.Audit.RunID) != "" {
		artifactPayload := payload
		if artifactPayload == nil {
			artifactPayload = result.Audit
		}
		kind := AIChatRunArtifactToolProposal
		title := "Tool call"
		if result.Kind == AIToolKindTerminal {
			kind = AIChatRunArtifactTerminal
			title = "Terminal preview"
		}
		s.recordChatRunArtifact(project, result.Audit.RunID, kind, title, result.Status, artifactPayload)
	}
	s.emitEvent("ai:tool:call-recorded", result)
	return result
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
	args := []string{"status", "--short"}
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
	if artifactID := strings.TrimSpace(arguments["artifactId"]); artifactID != "" {
		proposal.ScopeSummary = "Project-scoped patch artifact apply: " + artifactID
	}
	if req.ToolID == "terminal.preview" && req.Action == AIToolCallActionExecute {
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
	if reason := hardDenyReasonForCommand(arguments["command"], projectRoot); reason != "" {
		proposal.HardDenyReason = reason
	}
	return proposal
}

func hardDenyReasonForCommand(command string, _ string) AIToolHardDenyReason {
	command = strings.ToLower(strings.TrimSpace(command))
	if command == "" {
		return ""
	}
	if strings.Contains(command, "rm -rf") ||
		strings.Contains(command, "sudo ") ||
		strings.Contains(command, "mkfs") ||
		strings.Contains(command, "diskutil erase") ||
		strings.Contains(command, "chmod -r 777") ||
		strings.Contains(command, ":(){") {
		return AIToolHardDenyReasonDestructiveShell
	}
	if strings.Contains(command, "api_key=") ||
		strings.Contains(command, "authorization: bearer") ||
		strings.Contains(command, "id_rsa") ||
		strings.Contains(command, ".env") {
		return AIToolHardDenyReasonSecrets
	}
	if (strings.Contains(command, "curl ") ||
		strings.Contains(command, "wget ") ||
		strings.Contains(command, "ssh ") ||
		strings.Contains(command, "scp ")) &&
		!strings.Contains(command, "localhost") &&
		!strings.Contains(command, "127.0.0.1") &&
		!strings.Contains(command, "::1") {
		return AIToolHardDenyReasonNonLoopbackNetwork
	}
	return ""
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
