package ai

import (
	"context"
	"fmt"
	"strings"

	"arlecchino/internal/ai/agents"
	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const maxChatSteerMessageBytes = 16 * 1024

type pendingSteerFallback struct {
	Steer  AIChatRunSteer
	Action AIChatAction
}

func (s *Service) registerLiveRunController(runID string, controller agents.LiveRunController) {
	if s == nil || strings.TrimSpace(runID) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if controller == nil {
		delete(s.liveRunControllers, runID)
		return
	}
	if run := s.runs[runID]; run != nil && run.Status == "running" && s.currentRunOwnerLocked(runID) != nil {
		s.liveRunControllers[runID] = controller
	}
}

func (s *Service) SteerChatRun(ctx context.Context, projectID string, req AISteerChatRunRequest) (AIChatSteerResult, error) {
	projectID = normalizeProjectID(projectID)
	project := s.project(projectID)
	if project == nil || project.ChatSteers == nil {
		return AIChatSteerResult{}, fmt.Errorf("AI project session is not open")
	}
	s.chatSteerMu.Lock()
	defer s.chatSteerMu.Unlock()
	req.RunID = strings.TrimSpace(req.RunID)
	req.Message = strings.TrimSpace(req.Message)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	req.Disposition = firstNonEmpty(strings.ToLower(strings.TrimSpace(req.Disposition)), "steer")
	if req.RunID == "" || req.Message == "" {
		return AIChatSteerResult{}, fmt.Errorf("run id and steer message are required")
	}
	if len(req.Message) > maxChatSteerMessageBytes {
		return AIChatSteerResult{}, fmt.Errorf("steer message is too large")
	}
	if req.Disposition != "steer" && req.Disposition != "redirect" {
		return AIChatSteerResult{}, fmt.Errorf("unsupported steer disposition %q", req.Disposition)
	}
	if existing, ok, err := project.ChatSteers.FindByIdempotency(req.RunID, req.IdempotencyKey); err != nil {
		return AIChatSteerResult{}, err
	} else if ok {
		return steerResult(existing, s.currentRunRevision(req.RunID)), nil
	}

	s.mu.Lock()
	run := s.runs[req.RunID]
	if run == nil || run.ProjectSessionID != projectID || s.currentRunOwnerLocked(req.RunID) != project {
		s.mu.Unlock()
		return AIChatSteerResult{}, fmt.Errorf("chat run %q was not found", req.RunID)
	}
	if run.Status != "running" || !run.CanCancel {
		s.mu.Unlock()
		return AIChatSteerResult{}, fmt.Errorf("chat run %q is not active", req.RunID)
	}
	if req.ExpectedRevision > 0 && req.ExpectedRevision != run.Revision {
		revision := run.Revision
		s.mu.Unlock()
		return AIChatSteerResult{}, fmt.Errorf("chat run revision conflict: expected %d, current %d", req.ExpectedRevision, revision)
	}
	sequence := 1
	if previous, err := project.ChatSteers.ListByRun(req.RunID); err == nil {
		sequence += len(previous)
	}
	steer := normalizeChatRunSteer(AIChatRunSteer{
		ID:               "steer-" + uuid.NewString(),
		TargetRunID:      req.RunID,
		SessionID:        run.SessionID,
		ProjectSessionID: project.ID,
		Text:             req.Message,
		Disposition:      req.Disposition,
		State:            AIChatSteerStateReceived,
		Sequence:         sequence,
		ExpectedRevision: run.Revision,
		IdempotencyKey:   req.IdempotencyKey,
		CreatedAt:        utcNow(),
		UpdatedAt:        utcNow(),
	})
	controller := s.liveRunControllers[req.RunID]
	run.Revision++
	run.UpdatedAt = utcNow()
	runCopy := *run
	s.mu.Unlock()
	if err := project.ChatSteers.Upsert(steer); err != nil {
		return AIChatSteerResult{}, err
	}
	s.persistChatRun(project, runCopy)
	s.recordSteerTimeline(project, runCopy, steer, "steer_received", "received", "Steer received")
	s.emitRunEnvelope(project.ID, runCopy.ID)

	if req.Disposition == "steer" && controller != nil && controller.Alive() && controller.Capabilities().SupportsNativeSteer {
		return s.forwardNativeSteer(ctx, project, runCopy, steer, controller)
	}
	return s.startSteerFallback(project, runCopy, steer, req.SelectedAction)
}

func (s *Service) forwardNativeSteer(ctx context.Context, project *ProjectSession, run AIChatRun, steer AIChatRunSteer, controller agents.LiveRunController) (AIChatSteerResult, error) {
	steer.State = AIChatSteerStateForwarded
	steer.Capability = "native"
	steer.UpdatedAt = utcNow()
	if err := project.ChatSteers.Upsert(steer); err != nil {
		return AIChatSteerResult{}, err
	}
	s.recordSteerTimeline(project, run, steer, "steer_forwarded", "forwarded", "Steer forwarded to the active runtime")

	result, err := controller.Steer(ctx, agents.SteerRequest{Message: steer.Text, IdempotencyKey: steer.IdempotencyKey})
	if err != nil || result.State != "applied" {
		return s.rejectNativeSteer(project, run, steer, result, err, "Steer was not accepted by the active runtime")
	}
	// The native request may race cancellation after it was forwarded. Do not
	// report a late provider acknowledgement as applied when the host has
	// already canceled or superseded the Arlecchino run.
	if !s.nativeSteerRunActive(project, run.ID) {
		return s.rejectNativeSteer(project, run, steer, result, nil, "Steer was canceled before the runtime confirmed it")
	}
	steer.State = AIChatSteerStateApplied
	steer.Capability = "native"
	steer.AppliedByRuntime = true
	steer.UpdatedAt = utcNow()
	if err := project.ChatSteers.Upsert(steer); err != nil {
		return AIChatSteerResult{}, err
	}
	s.recordSteerTimeline(project, run, steer, "steer_applied", "applied", "Steer applied by the active runtime")
	s.emitRunEnvelope(project.ID, run.ID)
	return steerResult(steer, s.currentRunRevision(run.ID)), nil
}

func (s *Service) rejectNativeSteer(project *ProjectSession, run AIChatRun, steer AIChatRunSteer, result agents.SteerResult, cause error, summary string) (AIChatSteerResult, error) {
	steer.State = AIChatSteerStateRejected
	steer.Capability = firstNonEmpty(result.Capability, "native")
	if cause != nil {
		steer.Error = cause.Error()
	}
	steer.UpdatedAt = utcNow()
	_ = project.ChatSteers.Upsert(steer)
	s.recordSteerTimeline(project, run, steer, "steer_rejected", "rejected", summary)
	s.emitRunEnvelope(project.ID, run.ID)
	return steerResult(steer, s.currentRunRevision(run.ID)), cause
}

func (s *Service) nativeSteerRunActive(project *ProjectSession, runID string) bool {
	if s == nil || project == nil || strings.TrimSpace(runID) == "" {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	run := s.runs[runID]
	return run != nil && s.currentRunOwnerLocked(runID) == project && run.Status == "running" && run.CanCancel
}

func (s *Service) startSteerFallback(project *ProjectSession, run AIChatRun, steer AIChatRunSteer, redirectAction AIChatAction) (AIChatSteerResult, error) {
	steer.State = AIChatSteerStateFallbackPending
	steer.Capability = "interrupt_continue"
	steer.UpdatedAt = utcNow()
	if err := project.ChatSteers.Upsert(steer); err != nil {
		return AIChatSteerResult{}, err
	}
	s.mu.Lock()
	current := s.runs[run.ID]
	if current == nil || current.Status != "running" || s.currentRunOwnerLocked(run.ID) != project {
		s.mu.Unlock()
		steer.State = AIChatSteerStateRejected
		steer.Error = "run completed before fallback steering could start"
		steer.UpdatedAt = utcNow()
		_ = project.ChatSteers.Upsert(steer)
		return steerResult(steer, s.currentRunRevision(run.ID)), nil
	}
	if cancel := s.runCancels[run.ID]; cancel != nil {
		cancel()
	}
	current.Status = "canceled"
	current.CanCancel = false
	current.Revision++
	current.UpdatedAt = utcNow()
	currentCopy := *current
	action := current.Action
	if steer.Disposition == "redirect" {
		action = redirectAction
		if !validChatAction(action) {
			action = AIChatActionAsk
		}
	}
	s.steerFallbacks[run.ID] = pendingSteerFallback{Steer: steer, Action: action}
	delete(s.liveRunControllers, run.ID)
	s.mu.Unlock()
	s.invalidateRunApprovals(project, run.ID)
	s.persistChatRun(project, currentCopy)
	s.recordSteerTimeline(project, currentCopy, steer, "steer_fallback_started", "fallback_pending", "Steer accepted; restarting after the active run stops")
	s.emitRunEnvelope(project.ID, run.ID)
	return steerResult(steer, currentCopy.Revision), nil
}

func (s *Service) completeSteerFallback(project *ProjectSession, previous AIChatRun, fallback pendingSteerFallback) {
	if s == nil || project == nil || fallback.Steer.ID == "" || s.project(project.ID) != project {
		return
	}
	steer := fallback.Steer
	inputs := []AIChatRunInput{newSteerContinuationInput(steer.Text, previous.ID)}
	if steer.Disposition == "redirect" {
		inputs = []AIChatRunInput{newUserRunInput(steer.Text)}
	} else {
		inputs = append(inputs, newHiddenWorkflowRunInput(steerFallbackWorkflowContext(previous), previous.ID))
	}
	request := AIChatRunRequest{
		SessionID:       previous.SessionID,
		Action:          fallback.Action,
		ProfileID:       previous.ProfileID,
		RuntimeFamily:   previous.RuntimeFamily,
		ProviderID:      previous.ProviderID,
		Model:           previous.Model,
		ReasoningEffort: previous.ReasoningEffort,
		Links:           previous.Links,
	}
	if steer.Disposition == "redirect" {
		// A redirect is a fresh user task, not a continuation. In particular it
		// must not retain a Build profile, workflow links, or approvals inferred
		// from the interrupted branch.
		request.ProfileID = ""
		request.Links = AIChatRunLinks{}
	}
	continuation, err := s.startChatRun(context.Background(), project.ID, request, inputs)
	if err != nil {
		steer.State = AIChatSteerStateRejected
		steer.Error = err.Error()
		steer.UpdatedAt = utcNow()
		_ = project.ChatSteers.Upsert(steer)
		return
	}
	steer.State = AIChatSteerStateApplied
	steer.ContinuationRunID = continuation.ID
	steer.UpdatedAt = utcNow()
	_ = project.ChatSteers.Upsert(steer)
	s.recordSteerTimeline(project, continuation, steer, "steer_continuation_started", "applied", "Steer continuation started")
	s.emitRunEnvelope(project.ID, previous.ID)
}

func steerFallbackWorkflowContext(previous AIChatRun) string {
	return strings.TrimSpace(strings.Join([]string{
		"The linked run was interrupted before it reached a terminal answer.",
		"Preserve the active mode, approval policy, and protected-resource rules. Continue only from verified prior evidence.",
		"Previous task:",
		chatRunInputPrompt(chatRunInputs(previous)),
	}, "\n\n"))
}

func (s *Service) invalidateRunApprovals(project *ProjectSession, runID string) {
	if s == nil || project == nil || strings.TrimSpace(runID) == "" {
		return
	}
	s.deleteToolApprovalsForRuns(project.ID, map[string]struct{}{runID: {}})
	if project.ToolApprovalGrants != nil {
		_ = project.ToolApprovalGrants.DeleteRuns([]string{runID})
	}
	if project.PendingApprovals != nil {
		_ = project.PendingApprovals.DeleteRuns([]string{runID})
	}
}

func (s *Service) recordSteerTimeline(project *ProjectSession, run AIChatRun, steer AIChatRunSteer, eventType string, status string, summary string) {
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Source:           "steer",
		Type:             eventType,
		Status:           status,
		Actor:            "user",
		ProviderID:       run.ProviderID,
		Model:            run.Model,
		CorrelationID:    steer.ID,
		Capability:       providers.CapabilityChat,
		Summary:          summary,
	})
}

func steerResult(steer AIChatRunSteer, revision int64) AIChatSteerResult {
	return AIChatSteerResult{RunID: steer.TargetRunID, SteerID: steer.ID, State: steer.State, ContinuationRunID: steer.ContinuationRunID, Capability: steer.Capability, Revision: revision}
}

func (s *Service) currentRunRevision(runID string) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if run := s.runs[runID]; run != nil {
		return run.Revision
	}
	return 0
}

func (s *Service) QueueChatRun(projectID string, req AIQueueChatRunRequest) (AIQueuedChatRun, error) {
	projectID = normalizeProjectID(projectID)
	project := s.project(projectID)
	if project == nil || project.ChatQueue == nil {
		return AIQueuedChatRun{}, fmt.Errorf("AI project session is not open")
	}
	s.chatQueueMu.Lock()
	defer s.chatQueueMu.Unlock()
	req.SessionID = normalizeChatSessionID(req.SessionID)
	req.Message = strings.TrimSpace(req.Message)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.Message == "" {
		return AIQueuedChatRun{}, fmt.Errorf("queued message is empty")
	}
	if !validChatAction(req.SelectedAction) {
		req.SelectedAction = AIChatActionAsk
	}
	items, err := project.ChatQueue.ListSession(req.SessionID)
	if err != nil {
		return AIQueuedChatRun{}, err
	}
	for _, item := range items {
		if req.IdempotencyKey != "" && item.IdempotencyKey == req.IdempotencyKey {
			return item, nil
		}
	}
	position := 0
	for _, item := range items {
		if item.Status == "pending" && item.Position >= position {
			position = item.Position + 1
		}
	}
	queued := normalizeQueuedChatRun(AIQueuedChatRun{ID: "queue-" + uuid.NewString(), SessionID: req.SessionID, ProjectSessionID: project.ID, Message: req.Message, SelectedAction: req.SelectedAction, Position: position, Status: "pending", IdempotencyKey: req.IdempotencyKey, CreatedAt: utcNow(), UpdatedAt: utcNow()})
	items = append(items, queued)
	if err := project.ChatQueue.ReplaceSession(req.SessionID, items); err != nil {
		return AIQueuedChatRun{}, err
	}
	s.emitEvent("ai:chat:queue-updated", queued)
	s.recordQueueTimeline(project, req.SessionID, "queue_added", queued.ID, "Queued follow-up added")
	return queued, nil
}

func (s *Service) ListQueuedChatRuns(projectID string, sessionID string) ([]AIQueuedChatRun, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ChatQueue == nil {
		return []AIQueuedChatRun{}, nil
	}
	items, err := project.ChatQueue.ListSession(sessionID)
	if err != nil {
		return nil, err
	}
	result := make([]AIQueuedChatRun, 0, len(items))
	for _, item := range items {
		if item.Status == "pending" || item.Status == "reserved" {
			result = append(result, item)
		}
	}
	return result, nil
}

func (s *Service) UpdateQueuedChatRun(projectID string, sessionID string, req AIUpdateQueuedChatRunRequest) (AIQueuedChatRun, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ChatQueue == nil {
		return AIQueuedChatRun{}, fmt.Errorf("AI project session is not open")
	}
	s.chatQueueMu.Lock()
	defer s.chatQueueMu.Unlock()
	items, err := project.ChatQueue.ListSession(sessionID)
	if err != nil {
		return AIQueuedChatRun{}, err
	}
	found := -1
	for index := range items {
		if items[index].ID == strings.TrimSpace(req.ID) && items[index].Status == "pending" {
			found = index
			break
		}
	}
	if found < 0 {
		return AIQueuedChatRun{}, fmt.Errorf("queued message %q was not found", req.ID)
	}
	if message := strings.TrimSpace(req.Message); message != "" {
		items[found].Message = message
	}
	if req.Reorder {
		pending := make([]AIQueuedChatRun, 0, len(items))
		for _, item := range items {
			if item.Status == "pending" {
				pending = append(pending, item)
			}
		}
		sortQueuedChatRuns(pending)
		current := 0
		for index := range pending {
			if pending[index].ID == req.ID {
				current = index
				break
			}
		}
		target := req.Position
		if target >= len(pending) {
			target = len(pending) - 1
		}
		if target < 0 {
			target = 0
		}
		moved := pending[current]
		pending = append(pending[:current], pending[current+1:]...)
		pending = append(pending[:target], append([]AIQueuedChatRun{moved}, pending[target:]...)...)
		for index := range pending {
			pending[index].Position = index
			pending[index].UpdatedAt = utcNow()
			for itemIndex := range items {
				if items[itemIndex].ID == pending[index].ID {
					items[itemIndex] = pending[index]
				}
			}
		}
	}
	updated := AIQueuedChatRun{}
	for index := range items {
		if items[index].ID == req.ID {
			items[index].UpdatedAt = utcNow()
			updated = items[index]
			break
		}
	}
	if err := project.ChatQueue.ReplaceSession(sessionID, items); err != nil {
		return AIQueuedChatRun{}, err
	}
	s.emitEvent("ai:chat:queue-updated", updated)
	return updated, nil
}

func (s *Service) RemoveQueuedChatRun(projectID string, sessionID string, queueID string) error {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ChatQueue == nil {
		return fmt.Errorf("AI project session is not open")
	}
	s.chatQueueMu.Lock()
	defer s.chatQueueMu.Unlock()
	items, err := project.ChatQueue.ListSession(sessionID)
	if err != nil {
		return err
	}
	found := false
	for index := range items {
		if items[index].ID == strings.TrimSpace(queueID) && items[index].Status == "pending" {
			items[index].Status = "removed"
			items[index].UpdatedAt = utcNow()
			found = true
		}
	}
	if !found {
		return fmt.Errorf("queued message %q was not found", queueID)
	}
	if err := project.ChatQueue.ReplaceSession(sessionID, items); err != nil {
		return err
	}
	s.emitEvent("ai:chat:queue-updated", AIQueuedChatRun{
		ID:               strings.TrimSpace(queueID),
		SessionID:        normalizeChatSessionID(sessionID),
		ProjectSessionID: project.ID,
		Status:           "removed",
	})
	s.recordQueueTimeline(project, sessionID, "queue_removed", queueID, "Queued follow-up removed")
	return nil
}

func (s *Service) consumeQueuedChatRun(project *ProjectSession, terminal AIChatRun) {
	if s == nil || project == nil || project.ChatQueue == nil || s.project(project.ID) != project {
		return
	}
	s.chatQueueMu.Lock()
	defer s.chatQueueMu.Unlock()
	if s.hasActiveSessionRun(project, terminal.SessionID, terminal.ID) {
		return
	}
	items, err := project.ChatQueue.ListSession(terminal.SessionID)
	if err != nil {
		return
	}
	sortQueuedChatRuns(items)
	reserved := -1
	for index := range items {
		if items[index].Status == "pending" {
			items[index].Status = "reserved"
			items[index].ReservedByRunID = terminal.ID
			items[index].UpdatedAt = utcNow()
			reserved = index
			break
		}
	}
	if reserved < 0 || project.ChatQueue.ReplaceSession(terminal.SessionID, items) != nil {
		return
	}
	item := items[reserved]
	s.recordQueueTimeline(project, terminal.SessionID, "queue_consumed", item.ID, "Queued follow-up reserved for execution")
	next, err := s.StartChatRun(context.Background(), project.ID, AIChatRunRequest{
		SessionID: item.SessionID,
		Action:    item.SelectedAction,
		Prompt:    item.Message,
		Links: AIChatRunLinks{
			SourceQueueItemID: item.ID,
			SourceQueueRunID:  terminal.ID,
		},
	})
	if err != nil {
		items[reserved].Status = "pending"
		items[reserved].ReservedByRunID = ""
		items[reserved].UpdatedAt = utcNow()
		_ = project.ChatQueue.ReplaceSession(item.SessionID, items)
		return
	}
	items[reserved].Status = "consumed"
	items[reserved].ReservedByRunID = next.ID
	items[reserved].UpdatedAt = utcNow()
	_ = project.ChatQueue.ReplaceSession(item.SessionID, items)
	s.emitEvent("ai:chat:queue-updated", items[reserved])
}

func (s *Service) hasActiveSessionRun(project *ProjectSession, sessionID string, exceptRunID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for runID, run := range s.runs {
		if runID == exceptRunID || s.currentRunOwnerLocked(runID) != project || normalizeChatSessionID(run.SessionID) != normalizeChatSessionID(sessionID) {
			continue
		}
		if run.Status == "running" || run.Status == "queued" {
			return true
		}
	}
	return false
}

func (s *Service) recordQueueTimeline(project *ProjectSession, sessionID string, eventType string, correlationID string, summary string) {
	s.recordRunTimeline(project, AIRunTimelineEvent{SessionID: normalizeChatSessionID(sessionID), ProjectSessionID: project.ID, Source: "queue", Type: eventType, Status: "recorded", Actor: "user", CorrelationID: correlationID, Capability: providers.CapabilityChat, Summary: summary, CreatedAt: utcNow()})
}
