package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	maxInteractionQuestionOptions     = 4
	linkedReviewMinChangedFiles       = 3
	linkedReviewMinDiffHunks          = 4
	linkedReviewMinChangedLines       = 80
	linkedReviewStatusSkippedNoPlan   = "skipped_unlinked_build"
	linkedReviewStatusSkippedTooSmall = "skipped_small_build"
)

func normalizeInteractionQuestionPayload(runID string, arguments map[string]string) (AIInteractionQuestionPayload, error) {
	prompt := sanitizedDisplayText(firstNonEmpty(arguments["prompt"], arguments["question"], arguments["message"]))
	if strings.TrimSpace(prompt) == "" {
		return AIInteractionQuestionPayload{}, fmt.Errorf("question prompt is empty")
	}
	options, err := parseInteractionQuestionOptions(arguments)
	if err != nil {
		return AIInteractionQuestionPayload{}, err
	}
	if len(options) == 0 {
		return AIInteractionQuestionPayload{}, fmt.Errorf("question options are empty")
	}
	now := utcNow()
	questionID := strings.TrimSpace(arguments["questionId"])
	if questionID == "" {
		questionID = "question-" + shortHash(runID+":"+prompt+":"+toolArgumentsJSON(arguments))
	}
	return AIInteractionQuestionPayload{
		QuestionID:        questionID,
		Prompt:            prompt,
		Options:           options,
		AllowCustomAnswer: true,
		Status:            "pending",
		CreatedAt:         now,
		UpdatedAt:         now,
	}, nil
}

func parseInteractionQuestionOptions(arguments map[string]string) ([]AIInteractionQuestionOption, error) {
	raw := strings.TrimSpace(arguments["options"])
	if raw == "" {
		return nil, fmt.Errorf("question options are empty")
	}
	var decoded []AIInteractionQuestionOption
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		var labels []string
		if labelErr := json.Unmarshal([]byte(raw), &labels); labelErr != nil {
			return nil, fmt.Errorf("question options must be a JSON array")
		}
		for index, label := range labels {
			decoded = append(decoded, AIInteractionQuestionOption{
				ID:    fmt.Sprintf("option-%d", index+1),
				Label: label,
				Value: label,
			})
		}
	}
	options := make([]AIInteractionQuestionOption, 0, min(len(decoded), maxInteractionQuestionOptions))
	for index, option := range decoded {
		if len(options) >= maxInteractionQuestionOptions {
			break
		}
		label := sanitizedDisplayText(option.Label)
		if strings.TrimSpace(label) == "" {
			return nil, fmt.Errorf("question option %d label is empty", index+1)
		}
		id := strings.TrimSpace(option.ID)
		if id == "" {
			id = fmt.Sprintf("option-%d", index+1)
		}
		value := sanitizedDisplayText(firstNonEmpty(option.Value, label))
		description := sanitizedDisplayText(option.Description)
		options = append(options, AIInteractionQuestionOption{
			ID:          id,
			Label:       label,
			Value:       value,
			Description: description,
		})
	}
	return options, nil
}

func interactionQuestionArtifactID(runID string, questionID string) string {
	return "artifact-" + shortHash(runID+":interaction_question:"+questionID)
}

func planGateArtifactID(planRunID string) string {
	return "artifact-" + shortHash(planRunID+":workflow_plan_gate")
}

func (s *Service) recordInteractionQuestionArtifact(project *ProjectSession, runID string, payload AIInteractionQuestionPayload) (AIChatRunArtifact, error) {
	if project == nil || project.ChatArtifacts == nil {
		return AIChatRunArtifact{}, fmt.Errorf("AI project session is not open")
	}
	run, err := s.GetChatRun(project.ID, runID)
	if err != nil {
		return AIChatRunArtifact{}, err
	}
	now := utcNow()
	payload.UpdatedAt = now
	if payload.CreatedAt == "" {
		payload.CreatedAt = now
	}
	artifact := AIChatRunArtifact{
		ID:               interactionQuestionArtifactID(run.ID, payload.QuestionID),
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactInteractionQuestion,
		Status:           payload.Status,
		Title:            "Question",
		Summary:          payload.Prompt,
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        payload.CreatedAt,
		UpdatedAt:        now,
	}
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIChatRunArtifact{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:chat:question-updated")
	return artifact, nil
}

func (s *Service) executeInteractionQuestionTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	payload, err := normalizeInteractionQuestionPayload(req.RunID, req.Arguments)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	artifact, err := s.recordInteractionQuestionArtifact(project, req.RunID, payload)
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		return result
	}
	result.Status = "waiting"
	result.ArtifactID = artifact.ID
	result.OutputPreview = payload.Prompt
	return result
}

func chatToolResultsContainInteractionQuestion(results []chatExecutedToolCall) (string, bool) {
	for _, executed := range results {
		if executed.Result.ToolID == "interaction.question" && executed.Result.ArtifactID != "" {
			return "Waiting for your answer.", true
		}
	}
	return "", false
}

func (s *Service) SubmitQuestionAnswer(ctx context.Context, projectID string, req AIQuestionAnswerRequest) (AIQuestionAnswerResult, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return AIQuestionAnswerResult{}, fmt.Errorf("AI project session is not open")
	}
	run, err := s.GetChatRun(project.ID, req.RunID)
	if err != nil {
		return AIQuestionAnswerResult{}, err
	}
	artifact, payload, err := s.questionArtifactForRun(project, run.ID, req.QuestionID)
	if err != nil {
		return AIQuestionAnswerResult{}, err
	}
	if payload.Status == "answered" {
		return AIQuestionAnswerResult{}, fmt.Errorf("question %q is already answered", payload.QuestionID)
	}
	answer, optionID, err := selectedQuestionAnswer(payload, req)
	if err != nil {
		return AIQuestionAnswerResult{}, err
	}
	now := utcNow()
	payload.Status = "answered"
	payload.SelectedOptionID = optionID
	payload.SelectedValue = answer
	payload.CustomAnswer = sanitizedDisplayText(req.CustomAnswer)
	payload.AnsweredAt = now
	payload.UpdatedAt = now
	artifact.Status = payload.Status
	artifact.Summary = payload.Prompt
	artifact.PayloadJSON = marshalChatArtifactPayload(payload)
	artifact.UpdatedAt = now
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIQuestionAnswerResult{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:chat:question-updated")
	nextRun, err := s.startChatRun(ctx, project.ID, AIChatRunRequest{
		SessionID:     run.SessionID,
		Action:        run.Action,
		ProfileID:     run.ProfileID,
		RuntimeFamily: run.RuntimeFamily,
		ProviderID:    run.ProviderID,
		Model:         run.Model,
		Links:         linksForQuestionAnswerContinuation(run),
	}, []AIChatRunInput{
		newUserFollowUpRunInput(answer, run.ID),
		newHiddenWorkflowRunInput(buildQuestionAnswerContinuationPrompt(payload), run.ID),
	})
	if err != nil {
		return AIQuestionAnswerResult{}, err
	}
	return AIQuestionAnswerResult{Artifact: artifact, Payload: payload, Run: nextRun, Status: "answered"}, nil
}

func (s *Service) questionArtifactForRun(project *ProjectSession, runID string, questionID string) (AIChatRunArtifact, AIInteractionQuestionPayload, error) {
	artifacts, err := project.ChatArtifacts.ListByRun(runID)
	if err != nil {
		return AIChatRunArtifact{}, AIInteractionQuestionPayload{}, err
	}
	questionID = strings.TrimSpace(questionID)
	for _, artifact := range artifacts {
		if artifact.Kind != AIChatRunArtifactInteractionQuestion {
			continue
		}
		var payload AIInteractionQuestionPayload
		if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
			continue
		}
		if questionID == "" || payload.QuestionID == questionID {
			return artifact, payload, nil
		}
	}
	return AIChatRunArtifact{}, AIInteractionQuestionPayload{}, fmt.Errorf("question %q was not found", questionID)
}

func selectedQuestionAnswer(payload AIInteractionQuestionPayload, req AIQuestionAnswerRequest) (string, string, error) {
	if custom := sanitizedDisplayText(req.CustomAnswer); strings.TrimSpace(custom) != "" {
		return custom, "", nil
	}
	optionID := strings.TrimSpace(req.OptionID)
	if optionID == "" {
		return "", "", fmt.Errorf("question answer is empty")
	}
	for _, option := range payload.Options {
		if option.ID == optionID {
			return firstNonEmpty(option.Value, option.Label), option.ID, nil
		}
	}
	return "", "", fmt.Errorf("question option %q was not found", optionID)
}

func buildQuestionAnswerContinuationPrompt(question AIInteractionQuestionPayload) string {
	return strings.TrimSpace(strings.Join([]string{
		"Continue the linked run after the user's separate follow-up answer to a clarifying question.",
		"The user answer is a direct instruction and takes priority over this workflow procedure.",
		"Question:",
		question.Prompt,
	}, "\n"))
}

func linksForQuestionAnswerContinuation(run AIChatRun) AIChatRunLinks {
	links := run.Links
	if run.Action == AIChatActionPlan && links.SourcePlanRunID == "" {
		links.SourcePlanRunID = run.ID
	}
	if run.Action == AIChatActionBuild && links.SourceBuildRunID == "" {
		links.SourceBuildRunID = run.ID
	}
	return links
}

func (s *Service) recordPlanGateIfNeeded(project *ProjectSession, runID string, action AIChatAction) {
	if project == nil || project.ChatArtifacts == nil || action != AIChatActionPlan {
		return
	}
	run, err := s.GetChatRun(project.ID, runID)
	completionAccepted := run.Status == "completed" || ((run.Status == "running" || run.Status == "queued") && !run.CanCancel)
	if err != nil || !completionAccepted || strings.TrimSpace(run.Response) == "" {
		return
	}
	if s.runHasPendingInteractionQuestion(project, runID) {
		return
	}
	if _, _, err := s.planGateArtifact(project, runID); err == nil {
		return
	}
	now := utcNow()
	payload := AIPlanGatePayload{
		PlanRunID: runID,
		State:     AIPlanGateStatePending,
		CreatedAt: now,
		UpdatedAt: now,
	}
	artifact := AIChatRunArtifact{
		ID:               planGateArtifactID(runID),
		RunID:            runID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactWorkflowPlanGate,
		Status:           string(payload.State),
		Title:            "Plan gate",
		Summary:          "Awaiting plan decision.",
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	_ = project.ChatArtifacts.Upsert(artifact)
	s.emitChatArtifactChanged(project, artifact, "ai:chat:plan-gate-updated")
}

func (s *Service) runHasPendingInteractionQuestion(project *ProjectSession, runID string) bool {
	if project == nil || project.ChatArtifacts == nil {
		return false
	}
	artifacts, err := project.ChatArtifacts.ListByRun(runID)
	if err != nil {
		return false
	}
	for _, artifact := range artifacts {
		if artifact.Kind != AIChatRunArtifactInteractionQuestion {
			continue
		}
		var payload AIInteractionQuestionPayload
		if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
			continue
		}
		if strings.TrimSpace(payload.Status) == "pending" {
			return true
		}
	}
	return false
}

func (s *Service) planGateArtifact(project *ProjectSession, planRunID string) (AIChatRunArtifact, AIPlanGatePayload, error) {
	if project == nil || project.ChatArtifacts == nil {
		return AIChatRunArtifact{}, AIPlanGatePayload{}, fmt.Errorf("AI project session is not open")
	}
	artifact, err := project.ChatArtifacts.Get(planGateArtifactID(planRunID))
	if err != nil {
		return AIChatRunArtifact{}, AIPlanGatePayload{}, err
	}
	var payload AIPlanGatePayload
	if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
		return AIChatRunArtifact{}, AIPlanGatePayload{}, err
	}
	return artifact, payload, nil
}

func (s *Service) AcceptPlan(ctx context.Context, projectID string, req AIAcceptPlanRequest) (AIWorkflowRunResult, error) {
	project := s.project(projectID)
	if project == nil {
		return AIWorkflowRunResult{}, fmt.Errorf("AI project session is not open")
	}
	planRun, err := s.GetChatRun(project.ID, req.PlanRunID)
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	if planRun.Action != AIChatActionPlan || planRun.Status != "completed" {
		return AIWorkflowRunResult{}, fmt.Errorf("plan run %q is not completed", req.PlanRunID)
	}
	s.recordPlanGateIfNeeded(project, planRun.ID, planRun.Action)
	artifact, payload, err := s.planGateArtifact(project, planRun.ID)
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	if payload.State != AIPlanGateStatePending && payload.State != AIPlanGateStateAccepted {
		return AIWorkflowRunResult{}, fmt.Errorf("plan run %q cannot be accepted from state %q", req.PlanRunID, payload.State)
	}
	if payload.AcceptedBuildRunID != "" {
		run, err := s.GetChatRun(project.ID, payload.AcceptedBuildRunID)
		return AIWorkflowRunResult{Run: run, Artifact: artifact, Status: string(payload.State), Started: false}, err
	}
	buildRun, err := s.startChatRun(ctx, project.ID, AIChatRunRequest{
		SessionID:     planRun.SessionID,
		Action:        AIChatActionBuild,
		ProfileID:     "build-reviewer",
		RuntimeFamily: planRun.RuntimeFamily,
		ProviderID:    planRun.ProviderID,
		Model:         planRun.Model,
		Links: AIChatRunLinks{
			SourcePlanRunID: planRun.ID,
		},
	}, []AIChatRunInput{
		newWorkflowRunInput(buildAcceptedPlanPrompt(), "Plan accepted — Build started", planRun.ID),
	})
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	now := utcNow()
	payload.State = AIPlanGateStateAccepted
	payload.AcceptedBuildRunID = buildRun.ID
	payload.UpdatedAt = now
	artifact.Status = string(payload.State)
	artifact.Summary = "Plan accepted; Build run started."
	artifact.PayloadJSON = marshalChatArtifactPayload(payload)
	artifact.UpdatedAt = now
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIWorkflowRunResult{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:chat:plan-gate-updated")
	return AIWorkflowRunResult{Run: buildRun, Artifact: artifact, Status: string(payload.State), Started: true}, nil
}

func buildAcceptedPlanPrompt() string {
	return "Build the accepted linked plan. Keep the implementation scoped to that plan and preserve existing approval, artifact, verification, and audit rules."
}

func (s *Service) RequestPlanRevision(ctx context.Context, projectID string, req AIRequestPlanRevisionRequest) (AIWorkflowRunResult, error) {
	project := s.project(projectID)
	if project == nil {
		return AIWorkflowRunResult{}, fmt.Errorf("AI project session is not open")
	}
	planRun, err := s.GetChatRun(project.ID, req.PlanRunID)
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	if planRun.Action != AIChatActionPlan || planRun.Status != "completed" {
		return AIWorkflowRunResult{}, fmt.Errorf("plan run %q is not completed", req.PlanRunID)
	}
	s.recordPlanGateIfNeeded(project, planRun.ID, planRun.Action)
	artifact, payload, err := s.planGateArtifact(project, planRun.ID)
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	if payload.State != AIPlanGateStatePending && payload.State != AIPlanGateStateRevisionRequested {
		return AIWorkflowRunResult{}, fmt.Errorf("plan run %q cannot be revised from state %q", req.PlanRunID, payload.State)
	}
	reason := sanitizedDisplayText(req.Reason)
	revisionInputs := []AIChatRunInput{
		newHiddenWorkflowRunInput(buildPlanRevisionPrompt(), planRun.ID),
	}
	if reason != "" {
		revisionInputs = append([]AIChatRunInput{newUserFollowUpRunInput(reason, planRun.ID)}, revisionInputs...)
	}
	revisionRun, err := s.startChatRun(ctx, project.ID, AIChatRunRequest{
		SessionID:     planRun.SessionID,
		Action:        AIChatActionPlan,
		ProfileID:     "plan-architect",
		RuntimeFamily: planRun.RuntimeFamily,
		ProviderID:    planRun.ProviderID,
		Model:         planRun.Model,
		Links: AIChatRunLinks{
			SourcePlanRunID: planRun.ID,
		},
	}, revisionInputs)
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	now := utcNow()
	payload.State = AIPlanGateStateRevisionRequested
	payload.RevisionReason = reason
	payload.RevisionPlanRunIDs = append(payload.RevisionPlanRunIDs, revisionRun.ID)
	payload.UpdatedAt = now
	artifact.Status = string(payload.State)
	artifact.Summary = "Plan revision requested."
	artifact.PayloadJSON = marshalChatArtifactPayload(payload)
	artifact.UpdatedAt = now
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIWorkflowRunResult{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:chat:plan-gate-updated")
	return AIWorkflowRunResult{Run: revisionRun, Artifact: artifact, Status: string(payload.State), Started: true}, nil
}

func buildPlanRevisionPrompt() string {
	return "Revise the linked implementation plan. The user's separate follow-up gives the requested changes; keep repository rules, safety policy, and mode constraints in force."
}

func (s *Service) StartLinkedReview(ctx context.Context, projectID string, req AIStartLinkedReviewRequest) (AIWorkflowRunResult, error) {
	project := s.project(projectID)
	if project == nil {
		return AIWorkflowRunResult{}, fmt.Errorf("AI project session is not open")
	}
	buildRun, err := s.GetChatRun(project.ID, req.BuildRunID)
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	if buildRun.Action != AIChatActionBuild || buildRun.Status != "completed" {
		return AIWorkflowRunResult{}, fmt.Errorf("build run %q is not completed", req.BuildRunID)
	}
	if status, ok := s.linkedReviewSkipStatus(project, buildRun); ok {
		return AIWorkflowRunResult{Run: buildRun, Status: status, Started: false}, nil
	}
	if existing, ok := s.findLinkedReviewRun(project, buildRun.ID); ok {
		return AIWorkflowRunResult{Run: existing, Status: "existing", Started: false}, nil
	}
	reviewRun, err := s.startChatRun(ctx, project.ID, AIChatRunRequest{
		SessionID:     buildRun.SessionID,
		Action:        AIChatActionReview,
		ProfileID:     "review-auditor",
		RuntimeFamily: buildRun.RuntimeFamily,
		ProviderID:    buildRun.ProviderID,
		Model:         buildRun.Model,
		Links: AIChatRunLinks{
			SourcePlanRunID:         buildRun.Links.SourcePlanRunID,
			SourceBuildRunID:        buildRun.ID,
			AutoReviewForBuildRunID: buildRun.ID,
		},
	}, []AIChatRunInput{
		newWorkflowRunInput(buildLinkedReviewPrompt(), "Linked review started", buildRun.ID),
	})
	if err != nil {
		return AIWorkflowRunResult{}, err
	}
	return AIWorkflowRunResult{Run: reviewRun, Status: "started", Started: true}, nil
}

func (s *Service) linkedReviewSkipStatus(project *ProjectSession, buildRun AIChatRun) (string, bool) {
	if strings.TrimSpace(buildRun.Links.SourcePlanRunID) == "" {
		return linkedReviewStatusSkippedNoPlan, true
	}
	if !s.buildRunHasLargeReviewSurface(project, buildRun.ID) {
		return linkedReviewStatusSkippedTooSmall, true
	}
	return "", false
}

type linkedReviewSurface struct {
	files        map[string]struct{}
	diffHunks    int
	changedLines int
}

func (s *Service) buildRunHasLargeReviewSurface(project *ProjectSession, buildRunID string) bool {
	if project == nil || project.ChatArtifacts == nil {
		return false
	}
	artifacts, err := project.ChatArtifacts.ListByRun(buildRunID)
	if err != nil {
		return false
	}
	surface := linkedReviewSurface{files: map[string]struct{}{}}
	for _, artifact := range artifacts {
		if artifact.Kind != AIChatRunArtifactPatchPreview || !patchArtifactCanTriggerLinkedReview(artifact.Status) {
			continue
		}
		var payload AIPatchArtifactPayload
		if err := json.Unmarshal([]byte(artifact.PayloadJSON), &payload); err != nil {
			continue
		}
		for _, file := range payload.Files {
			if path := strings.TrimSpace(file.Path); path != "" {
				surface.files[path] = struct{}{}
			}
		}
		if len(payload.Files) == 0 {
			for _, path := range patchPathsForReviewSurface(payload.UnifiedDiff) {
				surface.files[path] = struct{}{}
			}
		}
		hunks, changed := patchDiffSurface(payload.UnifiedDiff)
		surface.diffHunks += hunks
		surface.changedLines += changed
	}
	return len(surface.files) >= linkedReviewMinChangedFiles ||
		surface.diffHunks >= linkedReviewMinDiffHunks ||
		surface.changedLines >= linkedReviewMinChangedLines
}

func patchArtifactCanTriggerLinkedReview(status string) bool {
	switch strings.TrimSpace(status) {
	case "ready", "applied":
		return true
	default:
		return false
	}
}

func patchPathsForReviewSurface(diff string) []string {
	paths, err := patchPaths(diff)
	if err != nil {
		return nil
	}
	return paths
}

func patchDiffSurface(diff string) (int, int) {
	hunks := 0
	changed := 0
	for _, line := range strings.Split(diff, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.HasPrefix(line, "@@ ") {
			hunks++
			continue
		}
		if strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---") {
			continue
		}
		if strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-") {
			changed++
		}
	}
	return hunks, changed
}

func linkedReviewDisplayPrompt(buildRun AIChatRun) string {
	shortBuildID := strings.TrimSpace(buildRun.ID)
	if len(shortBuildID) > 8 {
		shortBuildID = shortBuildID[:8]
	}
	if shortBuildID == "" {
		return "Background review for large Build run"
	}
	return "Background review for large Build run " + shortBuildID
}

func (s *Service) findLinkedReviewRun(project *ProjectSession, buildRunID string) (AIChatRun, bool) {
	buildRunID = strings.TrimSpace(buildRunID)
	if buildRunID == "" {
		return AIChatRun{}, false
	}
	s.mu.RLock()
	for _, run := range s.runs {
		if run.ProjectSessionID == project.ID && run.Action == AIChatActionReview && (run.Links.AutoReviewForBuildRunID == buildRunID || run.Links.SourceBuildRunID == buildRunID) {
			copy := *run
			s.mu.RUnlock()
			return copy, true
		}
	}
	s.mu.RUnlock()
	if project.ChatHistory == nil {
		return AIChatRun{}, false
	}
	runs, err := project.ChatHistory.List(0)
	if err != nil {
		return AIChatRun{}, false
	}
	for _, run := range runs {
		if run.Action == AIChatActionReview && (run.Links.AutoReviewForBuildRunID == buildRunID || run.Links.SourceBuildRunID == buildRunID) {
			return normalizeLoadedChatRun(project.ID, run), true
		}
	}
	return AIChatRun{}, false
}

func buildLinkedReviewPrompt() string {
	return "Review the completed linked Build run against its accepted plan. Stay read-only. Lead with concrete findings, missing verification, and mismatches. If there are no issues, say that clearly."
}
