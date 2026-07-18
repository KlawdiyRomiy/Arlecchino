package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const maxSubagentObjectiveBytes = 16 * 1024
const maxSubagentOwnedPaths = 32

const (
	subagentExecutionReadOnly      = "read_only"
	subagentExecutionPatchArtifact = "patch_artifact"
)

// StartSubagentRun starts an isolated child run. A read-only child can inspect
// only bounded host context. A patch-artifact child may draft reviewable patch
// artifacts for declared paths, but cannot apply a patch, execute a terminal,
// access MCP, or mutate the parent worktree.
func (s *Service) StartSubagentRun(ctx context.Context, projectID string, req AIStartSubagentRunRequest) (AIStartSubagentRunResult, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ChatArtifacts == nil {
		return AIStartSubagentRunResult{}, fmt.Errorf("AI project session is not open")
	}
	req.ParentRunID = strings.TrimSpace(req.ParentRunID)
	req.Objective = strings.TrimSpace(req.Objective)
	if req.ParentRunID == "" || req.Objective == "" {
		return AIStartSubagentRunResult{}, fmt.Errorf("parent run id and subagent objective are required")
	}
	if len(req.Objective) > maxSubagentObjectiveBytes {
		return AIStartSubagentRunResult{}, fmt.Errorf("subagent objective is too large")
	}
	executionMode := normalizeSubagentExecutionMode(req.ExecutionMode)
	ownedPaths, err := normalizeSubagentOwnedPaths(req.OwnedPaths)
	if err != nil {
		return AIStartSubagentRunResult{}, err
	}
	if executionMode == subagentExecutionPatchArtifact && len(ownedPaths) == 0 {
		return AIStartSubagentRunResult{}, fmt.Errorf("patch-artifact subagent requires at least one owned path")
	}
	parent, err := s.GetChatRun(project.ID, req.ParentRunID)
	if err != nil {
		return AIStartSubagentRunResult{}, err
	}
	role := firstNonEmpty(strings.TrimSpace(req.Role), "researcher")
	childID := "subagent-" + uuid.NewString()
	capsule := subagentContextCapsule(parent)
	action, profileID, modeInstruction, err := subagentRunPolicy(executionMode, req.Action, req.ProfileID, ownedPaths)
	if err != nil {
		return AIStartSubagentRunResult{}, err
	}
	capsuleJSON, _ := json.Marshal(capsule)
	objective := strings.Join([]string{
		"Isolated subagent contract. Do not access parent session history or claim unobserved work.",
		modeInstruction,
		"Role: " + role,
		"Use the immutable parent context capsule below only as background. Return a JSON object with fields findings (string[]), evidence ({kind,subject,detail}[]), and verificationGaps (string[]). Do not include private reasoning.",
		"Immutable context capsule:", string(capsuleJSON),
		"Objective:", req.Objective,
	}, "\n\n")
	child, err := s.startChatRun(ctx, project.ID, AIChatRunRequest{
		SessionID:         "subagent-session-" + childID,
		Action:            action,
		ProfileID:         profileID,
		RuntimeFamily:     parent.RuntimeFamily,
		ProviderID:        parent.ProviderID,
		Model:             parent.Model,
		ReasoningEffort:   parent.ReasoningEffort,
		MaxTokens:         req.MaxTokens,
		IncludeMnemonic:   false,
		IncludeSkills:     false,
		IncludeContinuity: false,
		Links: AIChatRunLinks{
			SourceSubagentParentRunID: parent.ID,
			SubagentID:                childID,
		},
	}, []AIChatRunInput{newWorkflowRunInput(objective, "Read-only subagent started", parent.ID)})
	if err != nil {
		return AIStartSubagentRunResult{}, err
	}
	payload := AISubagentRunPayload{
		ParentRunID:        parent.ID,
		ChildRunID:         child.ID,
		Objective:          sanitizedDisplayText(req.Objective),
		Role:               role,
		ReadOnly:           executionMode == subagentExecutionReadOnly,
		ExecutionMode:      executionMode,
		OwnedPaths:         ownedPaths,
		ContextCapsule:     capsule,
		ContextSummary:     capsule.ContextSummary,
		DeadlineMs:         req.DeadlineMs,
		StructuredEvidence: true,
		Status:             "running",
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "subagent-artifact-" + child.ID,
		RunID:            parent.ID,
		SessionID:        parent.SessionID,
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactBackground,
		Status:           "running",
		Title:            subagentArtifactTitle(executionMode),
		Summary:          "Isolated child run started; parent will receive validated structured evidence only.",
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIStartSubagentRunResult{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:subagent:started")
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            child.ID,
		SessionID:        child.SessionID,
		ProjectSessionID: project.ID,
		Source:           "subagent",
		Type:             "child_started",
		Status:           "running",
		Actor:            "system",
		CorrelationID:    childID,
		Capability:       providers.CapabilityChat,
		Summary:          "Isolated " + executionMode + " child run started for parent " + parent.ID,
	})
	if req.DeadlineMs > 0 {
		deadline := time.Duration(req.DeadlineMs) * time.Millisecond
		time.AfterFunc(deadline, func() {
			_, _ = s.CancelChatRun(project.ID, child.ID)
		})
	}
	return AIStartSubagentRunResult{ChildRun: child, Artifact: artifact, Payload: payload}, nil
}

func normalizeSubagentExecutionMode(value string) string {
	switch strings.TrimSpace(value) {
	case "", subagentExecutionReadOnly:
		return subagentExecutionReadOnly
	case subagentExecutionPatchArtifact:
		return subagentExecutionPatchArtifact
	default:
		return "invalid"
	}
}

func normalizeSubagentOwnedPaths(paths []string) ([]string, error) {
	if len(paths) > maxSubagentOwnedPaths {
		return nil, fmt.Errorf("subagent ownership exceeds %d paths", maxSubagentOwnedPaths)
	}
	result := make([]string, 0, len(paths))
	seen := map[string]struct{}{}
	for _, path := range paths {
		path, ok := normalizePatchPath(path)
		if !ok || toolPathLooksSensitive(path) {
			return nil, fmt.Errorf("unsafe subagent owned path %q", path)
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		result = append(result, path)
	}
	return result, nil
}

func subagentRunPolicy(mode string, requestedAction AIChatAction, requestedProfile string, ownedPaths []string) (AIChatAction, string, string, error) {
	if mode == "invalid" {
		return "", "", "", fmt.Errorf("unsupported subagent execution mode")
	}
	if mode == subagentExecutionPatchArtifact {
		if requestedAction != "" && requestedAction != AIChatActionBuild {
			return "", "", "", fmt.Errorf("patch-artifact subagent requires Build action")
		}
		if requestedProfile != "" && strings.TrimSpace(requestedProfile) != "subagent-patch-author" {
			return "", "", "", fmt.Errorf("patch-artifact subagent requires subagent-patch-author profile")
		}
		return AIChatActionBuild, "subagent-patch-author", "Patch-artifact child: only draft reviewable patch artifacts for these owned paths: " + strings.Join(ownedPaths, ", ") + ". Do not call file.patch.apply, terminal, MCP, network, or approval tools.", nil
	}
	if requestedAction != "" && requestedAction != AIChatActionAsk && requestedAction != AIChatActionPlan && requestedAction != AIChatActionReview {
		return "", "", "", fmt.Errorf("read-only subagent action must be Ask, Plan, or Review")
	}
	action := requestedAction
	if action == "" {
		action = AIChatActionReview
	}
	profile := map[AIChatAction]string{AIChatActionAsk: "ask-readonly", AIChatActionPlan: "plan-architect", AIChatActionReview: "review-auditor"}[action]
	if requestedProfile != "" && strings.TrimSpace(requestedProfile) != profile {
		return "", "", "", fmt.Errorf("profile %q is incompatible with read-only subagent action %q", requestedProfile, action)
	}
	return action, profile, "Read-only child: do not write files, run commands, apply patches, call MCP actions, use network, or request approvals.", nil
}

func subagentContextCapsule(parent AIChatRun) AISubagentContextCapsule {
	return AISubagentContextCapsule{
		ID:              "subagent-capsule-" + uuid.NewString(),
		ParentRunID:     parent.ID,
		ParentRevision:  parent.Revision,
		ParentAction:    parent.Action,
		ContextSummary:  subagentContextSummary(parent),
		InputSummary:    truncateUTF8(sanitizedDisplayText(chatRunUserPrompt(chatRunInputs(parent))), 4*1024),
		ResponseSummary: truncateUTF8(sanitizedDisplayText(parent.Response), 4*1024),
		CreatedAt:       utcNow(),
	}
}

func subagentArtifactTitle(mode string) string {
	if mode == subagentExecutionPatchArtifact {
		return "Patch-artifact subagent"
	}
	return "Read-only subagent"
}

func subagentContextSummary(parent AIChatRun) AIContextSummary {
	if parent.ContextSummary != nil {
		return *parent.ContextSummary
	}
	return AIContextSummary{}
}

func (s *Service) StopSubagentRun(projectID string, parentRunID string, childRunID string) (AIChatRun, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil {
		return AIChatRun{}, fmt.Errorf("AI project session is not open")
	}
	child, err := s.GetChatRun(project.ID, childRunID)
	if err != nil {
		return AIChatRun{}, err
	}
	if strings.TrimSpace(child.Links.SourceSubagentParentRunID) != strings.TrimSpace(parentRunID) {
		return AIChatRun{}, fmt.Errorf("child run is not owned by parent %q", parentRunID)
	}
	return s.CancelChatRun(project.ID, child.ID)
}

func (s *Service) SteerSubagentRun(ctx context.Context, projectID string, parentRunID string, req AISteerChatRunRequest) (AIChatSteerResult, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil {
		return AIChatSteerResult{}, fmt.Errorf("AI project session is not open")
	}
	child, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil {
		return AIChatSteerResult{}, err
	}
	if strings.TrimSpace(child.Links.SourceSubagentParentRunID) != strings.TrimSpace(parentRunID) {
		return AIChatSteerResult{}, fmt.Errorf("child run is not owned by parent %q", parentRunID)
	}
	return s.SteerChatRun(ctx, project.ID, req)
}

func (s *Service) recordSubagentCompletion(project *ProjectSession, child AIChatRun) {
	parentID := strings.TrimSpace(child.Links.SourceSubagentParentRunID)
	if project == nil || project.ChatArtifacts == nil || parentID == "" || !isTerminalChatRunStatus(child.Status) {
		return
	}
	payload := AISubagentRunPayload{
		ParentRunID:        parentID,
		ChildRunID:         child.ID,
		Role:               "researcher",
		ReadOnly:           true,
		ContextSummary:     subagentContextSummary(child),
		StructuredEvidence: false,
		Status:             child.Status,
	}
	if existing, err := project.ChatArtifacts.Get("subagent-artifact-" + child.ID); err == nil {
		_ = json.Unmarshal([]byte(existing.PayloadJSON), &payload)
	}
	evidence, evidenceErr := parseSubagentStructuredEvidence(child.Response)
	if evidenceErr == nil {
		payload.Evidence = &evidence
		payload.StructuredEvidence = true
	}
	payload.Status = child.Status
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "subagent-artifact-" + child.ID,
		RunID:            parentID,
		SessionID:        child.SessionID,
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactBackground,
		Status:           child.Status,
		Title:            subagentArtifactTitle(payload.ExecutionMode),
		Summary:          subagentCompletionSummary(child.Status, evidenceErr),
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := project.ChatArtifacts.Upsert(artifact); err == nil {
		s.emitChatArtifactChanged(project, artifact, "ai:subagent:completed")
	}
}

func parseSubagentStructuredEvidence(value string) (AISubagentStructuredEvidence, error) {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "```json")
	value = strings.TrimPrefix(value, "```")
	value = strings.TrimSuffix(strings.TrimSpace(value), "```")
	if value == "" || len(value) > 64*1024 {
		return AISubagentStructuredEvidence{}, fmt.Errorf("child did not return bounded structured evidence")
	}
	var evidence AISubagentStructuredEvidence
	if err := json.Unmarshal([]byte(value), &evidence); err != nil {
		return AISubagentStructuredEvidence{}, fmt.Errorf("child response is not structured evidence")
	}
	for index := range evidence.Findings {
		evidence.Findings[index] = sanitizedDisplayText(evidence.Findings[index])
	}
	for index := range evidence.Evidence {
		evidence.Evidence[index].Kind = sanitizedDisplayText(evidence.Evidence[index].Kind)
		evidence.Evidence[index].Subject = sanitizedDisplayText(evidence.Evidence[index].Subject)
		evidence.Evidence[index].Detail = sanitizedDisplayText(evidence.Evidence[index].Detail)
	}
	for index := range evidence.VerificationGaps {
		evidence.VerificationGaps[index] = sanitizedDisplayText(evidence.VerificationGaps[index])
	}
	if len(evidence.Findings) == 0 && len(evidence.Evidence) == 0 && len(evidence.VerificationGaps) == 0 {
		return AISubagentStructuredEvidence{}, fmt.Errorf("child evidence is empty")
	}
	return evidence, nil
}

func subagentCompletionSummary(status string, evidenceErr error) string {
	if evidenceErr == nil {
		return "Child run " + status + "; validated structured evidence is available to the parent."
	}
	return "Child run " + status + "; no validated structured evidence was produced."
}
