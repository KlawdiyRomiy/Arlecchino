package ai

import (
	"fmt"
	"strings"
)

func (s *Service) GetChatRunEnvelope(projectID string, runID string) (AIChatRunEnvelope, error) {
	project := s.project(projectID)
	if project == nil {
		return AIChatRunEnvelope{}, fmt.Errorf("AI project session is not open")
	}
	run, err := s.GetChatRun(project.ID, runID)
	if err != nil {
		return AIChatRunEnvelope{}, err
	}
	return s.buildChatRunEnvelope(project, run), nil
}

func (s *Service) ListChatRuns(projectID string, limit int) ([]AIChatRunEnvelope, error) {
	project := s.project(projectID)
	if project == nil {
		return []AIChatRunEnvelope{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	runsByID := map[string]AIChatRun{}
	if project.ChatHistory != nil {
		persistedRuns, err := project.ChatHistory.List(limit)
		if err != nil {
			return nil, err
		}
		for _, run := range persistedRuns {
			run = normalizeLoadedChatRun(project.ID, run)
			runsByID[run.ID] = run
		}
	}
	s.mu.RLock()
	for _, run := range s.runs {
		if run.ProjectSessionID == project.ID {
			runsByID[run.ID] = *run
		}
	}
	s.mu.RUnlock()
	runs := make([]AIChatRun, 0, len(runsByID))
	for _, run := range runsByID {
		runs = append(runs, run)
	}
	sortRunsNewestFirst(runs)
	if len(runs) > limit {
		runs = runs[:limit]
	}
	timelinesByRun := map[string][]AIRunTimelineEvent{}
	if project.RunTimeline != nil && len(runs) > 0 {
		runIDs := make([]string, 0, len(runs))
		for _, run := range runs {
			runIDs = append(runIDs, run.ID)
		}
		if eventsByRun, err := project.RunTimeline.ListByRuns(runIDs, 80); err == nil {
			timelinesByRun = eventsByRun
		}
	}
	envelopes := make([]AIChatRunEnvelope, 0, len(runs))
	for _, run := range runs {
		timeline := timelinesByRun[run.ID]
		envelopes = append(envelopes, s.buildChatRunEnvelopeWithTimeline(project, run, &timeline))
	}
	return envelopes, nil
}

func (s *Service) ClearChatRuns(projectID string) error {
	projectID = normalizeProjectID(projectID)
	project := s.project(projectID)
	s.waitForRuns(s.cancelRuns(projectID))
	s.clearToolApprovalsForProject(projectID)
	s.mu.Lock()
	for runID, run := range s.runs {
		if run.ProjectSessionID == projectID {
			delete(s.runs, runID)
			delete(s.runCancels, runID)
			delete(s.runDone, runID)
		}
	}
	s.mu.Unlock()
	if project != nil && project.ChatHistory != nil {
		if err := project.ChatHistory.Clear(); err != nil {
			return err
		}
	}
	if project != nil && project.ChatArtifacts != nil {
		if err := project.ChatArtifacts.Clear(); err != nil {
			return err
		}
	}
	if project != nil && project.RunTimeline != nil {
		if err := project.RunTimeline.Clear(); err != nil {
			return err
		}
	}
	if project != nil && project.ToolApprovalGrants != nil {
		if err := project.ToolApprovalGrants.Clear(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) DeleteChatSession(projectID string, sessionID string) error {
	projectID = normalizeProjectID(projectID)
	sessionID = normalizeChatSessionID(sessionID)
	project := s.project(projectID)
	waiters := []runWaiter{}
	runIDs := map[string]struct{}{}

	if project != nil && project.ChatHistory != nil {
		runs, err := project.ChatHistory.List(0)
		if err != nil {
			return err
		}
		for _, run := range runs {
			if normalizeChatSessionID(run.SessionID) == sessionID {
				runIDs[run.ID] = struct{}{}
			}
		}
	}

	s.mu.Lock()
	for runID, run := range s.runs {
		if run.ProjectSessionID != projectID || normalizeChatSessionID(run.SessionID) != sessionID {
			continue
		}
		runIDs[runID] = struct{}{}
		if done := s.runDone[runID]; done != nil {
			waiters = append(waiters, runWaiter{runID: runID, done: done})
		}
		if run.Status == "running" || run.Status == "queued" {
			run.Status = "canceled"
			run.CanCancel = false
			run.UpdatedAt = utcNow()
		}
		if cancel := s.runCancels[runID]; cancel != nil {
			cancel()
		}
		delete(s.runCancels, runID)
	}
	s.mu.Unlock()

	s.waitForRuns(waiters)

	s.mu.Lock()
	for runID, run := range s.runs {
		if run.ProjectSessionID == projectID && normalizeChatSessionID(run.SessionID) == sessionID {
			delete(s.runs, runID)
			delete(s.runCancels, runID)
			delete(s.runDone, runID)
		}
	}
	s.mu.Unlock()
	s.deleteToolApprovalsForRuns(projectID, runIDs)

	if project != nil && project.ChatHistory != nil {
		if err := project.ChatHistory.DeleteSession(sessionID); err != nil {
			return err
		}
	}
	if project != nil && project.ChatArtifacts != nil {
		if err := project.ChatArtifacts.DeleteSession(sessionID); err != nil {
			return err
		}
	}
	ids := runIDList(runIDs)
	if project != nil && project.RunTimeline != nil {
		if err := project.RunTimeline.DeleteRuns(ids); err != nil {
			return err
		}
	}
	if project != nil && project.ToolApprovalGrants != nil {
		if err := project.ToolApprovalGrants.DeleteRuns(ids); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) deleteToolApprovalsForRuns(projectID string, runIDs map[string]struct{}) {
	if s == nil || len(runIDs) == 0 {
		return
	}
	projectID = normalizeProjectID(projectID)
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, grant := range s.toolApprovals {
		if normalizeProjectID(grant.ProjectSessionID) == projectID {
			if _, ok := runIDs[grant.RunID]; ok {
				delete(s.toolApprovals, key)
			}
		}
	}
}

func (s *Service) clearToolApprovalsForProject(projectID string) {
	if s == nil {
		return
	}
	projectID = normalizeProjectID(projectID)
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, grant := range s.toolApprovals {
		if normalizeProjectID(grant.ProjectSessionID) == projectID {
			delete(s.toolApprovals, key)
		}
	}
}

func runIDList(runIDs map[string]struct{}) []string {
	ids := make([]string, 0, len(runIDs))
	for runID := range runIDs {
		if strings.TrimSpace(runID) != "" {
			ids = append(ids, runID)
		}
	}
	return ids
}

func (s *Service) buildChatRunEnvelope(project *ProjectSession, run AIChatRun) AIChatRunEnvelope {
	return s.buildChatRunEnvelopeWithTimeline(project, run, nil)
}

func (s *Service) buildChatRunEnvelopeWithTimeline(project *ProjectSession, run AIChatRun, timelineOverride *[]AIRunTimelineEvent) AIChatRunEnvelope {
	run = normalizeChatRunToolProposals(run)
	approval := s.approvalSummaryForProject(project)
	consent := s.consentSummary()
	providerEnvelope := s.providerEnvelopeForRun(run)
	egressSummary := s.egressSummaryForRun(project, run)
	disclosure := disclosureSummary(providerEnvelope, run.ContextSummary, consent, firstNonEmpty(sourceFromEgress(egressSummary), "chat_run"))
	mnemonic := AIMnemonicInclusionSummary{
		Requested: run.MnemonicRequested,
		Enabled:   project != nil && project.Mnemonic != nil && project.Mnemonic.Enabled(),
		Included:  run.ContextSummary != nil && run.ContextSummary.MnemonicCount > 0,
	}
	if run.ContextSummary != nil {
		mnemonic.Count = run.ContextSummary.MnemonicCount
	}
	timeline := []AIRunTimelineEvent{}
	if timelineOverride != nil {
		timeline = append(timeline, (*timelineOverride)...)
	} else if project != nil && project.RunTimeline != nil {
		if events, err := project.RunTimeline.ListByRun(run.ID, 80); err == nil {
			timeline = events
		}
	}
	return AIChatRunEnvelope{
		ID:                  run.ID,
		SessionID:           run.SessionID,
		ProjectSessionID:    run.ProjectSessionID,
		Action:              run.Action,
		ProfileID:           run.ProfileID,
		WorkflowID:          run.WorkflowID,
		Status:              run.Status,
		ProviderID:          firstNonEmpty(run.ProviderID, providerIDFromEnvelope(providerEnvelope)),
		Model:               firstNonEmpty(run.Model, modelFromEnvelope(providerEnvelope)),
		Error:               sanitizedDisplayText(run.Error),
		CanCancel:           run.CanCancel,
		ContextSummary:      run.ContextSummary,
		ProviderEnvelope:    providerEnvelope,
		EgressSummary:       egressSummary,
		DisclosureSummary:   disclosure,
		ApprovalSummary:     approval,
		ConsentSummary:      consent,
		ToolProposals:       run.ToolProposals,
		ToolProposalSummary: summarizeToolProposals(run.ToolProposals),
		MnemonicInclusion:   mnemonic,
		Timeline:            timeline,
		Revision:            run.Revision,
		CreatedAt:           run.CreatedAt,
		UpdatedAt:           run.UpdatedAt,
	}
}

func (s *Service) emitRunEnvelope(projectID string, runID string) {
	project := s.project(projectID)
	if project == nil {
		return
	}
	envelope, err := s.GetChatRunEnvelope(project.ID, runID)
	if err != nil {
		return
	}
	s.emitEvent("ai:chat:run-envelope-updated", envelope)
}

func (s *Service) providerEnvelopeForRun(run AIChatRun) *AIProviderEnvelope {
	providerID := strings.TrimSpace(run.ProviderID)
	if providerID == "" {
		providerID = strings.TrimSpace(s.currentSettings().ActiveProviderID)
	}
	if providerID == "" {
		return nil
	}
	s.mu.RLock()
	descriptor, ok := s.descriptors[providerID]
	s.mu.RUnlock()
	if !ok {
		return nil
	}
	return &AIProviderEnvelope{
		ProviderID: descriptor.ID,
		Kind:       descriptor.Kind,
		Endpoint:   descriptor.Endpoint,
		Model:      firstNonEmpty(run.Model, descriptor.DefaultModel),
		Status:     descriptor.Status,
		Local:      descriptor.Local,
		Frontier:   descriptor.Frontier,
	}
}

func (s *Service) egressSummaryForRun(project *ProjectSession, run AIChatRun) *AIEgressSummary {
	if project == nil || project.Egress == nil || strings.TrimSpace(run.EgressRecordID) == "" {
		return nil
	}
	records, err := project.Egress.List(200)
	if err != nil {
		return nil
	}
	for i := len(records) - 1; i >= 0; i-- {
		record := records[i]
		if record.ID != run.EgressRecordID {
			continue
		}
		return &AIEgressSummary{
			RecordID:        record.ID,
			Status:          record.Status,
			ProviderID:      record.ProviderID,
			ProviderKind:    record.ProviderKind,
			Endpoint:        record.Endpoint,
			Model:           record.Model,
			Capability:      record.Capability,
			DataCategories:  record.DataCategories,
			Redaction:       record.Redaction,
			LatencyMs:       record.LatencyMs,
			Canceled:        record.Canceled,
			ErrorClass:      record.ErrorClass,
			CreatedAt:       record.CreatedAt,
			RunID:           record.RunID,
			Source:          record.Source,
			ChatAction:      record.ChatAction,
			InputTokens:     record.InputTokens,
			OutputTokens:    record.OutputTokens,
			TotalTokens:     record.TotalTokens,
			EstimatedTokens: record.EstimatedTokens,
			TokenSource:     record.TokenSource,
			CostMicros:      record.CostMicros,
			CostCurrency:    record.CostCurrency,
			CostEstimated:   record.CostEstimated,
			CostSource:      record.CostSource,
			ToolProfile:     record.ToolProfile,
			ToolSchemaCount: record.ToolSchemaCount,
			ToolSupportKind: record.ToolSupportKind,
		}
	}
	return nil
}

func disclosureSummary(provider *AIProviderEnvelope, contextSummary *AIContextSummary, consent AIConsentSummary, optInSource string) AIContextDisclosureSummary {
	summary := AIContextDisclosureSummary{
		OptInSource:      optInSource,
		RetentionSummary: "local provider call; Arlecchino stores metadata-only egress locally",
	}
	if contextSummary != nil {
		summary.DataCategories = contextSummary.DataCategories
	}
	if provider == nil {
		return summary
	}
	summary.ProviderID = provider.ProviderID
	summary.ProviderKind = provider.Kind
	summary.EndpointClass = endpointClass(provider)
	summary.Model = provider.Model
	summary.Local = provider.Local
	summary.Frontier = provider.Frontier
	summary.ProviderPolicyAllowed = provider.Local && !provider.Frontier && consent.LocalProvidersAccepted
	return summary
}

func endpointClass(provider *AIProviderEnvelope) string {
	if provider == nil || provider.Endpoint == "" {
		return "unknown"
	}
	switch {
	case provider.Frontier:
		return "frontier"
	case isLoopbackEndpoint(provider.Endpoint):
		return "loopback"
	case provider.Local:
		return "local_non_loopback"
	default:
		return "remote"
	}
}

func sourceFromEgress(summary *AIEgressSummary) string {
	if summary == nil {
		return ""
	}
	return summary.Source
}

func summarizeToolProposals(proposals []AIToolProposal) AIToolProposalSummary {
	summary := AIToolProposalSummary{Total: len(proposals)}
	for _, proposal := range proposals {
		if proposal.AllowedByCurrentPolicy {
			summary.AllowedByPolicy++
		}
		if proposal.HardDenyReason != "" || proposal.Status == AIToolProposalStatusBlocked {
			summary.HardDenied++
		}
		if proposal.ExecutionState == AIToolExecutionStateNotExecutable {
			summary.NotExecutableInSlice++
		}
	}
	return summary
}

func sortRunsNewestFirst(runs []AIChatRun) {
	for i := 0; i < len(runs); i++ {
		for j := i + 1; j < len(runs); j++ {
			if runs[j].UpdatedAt > runs[i].UpdatedAt {
				runs[i], runs[j] = runs[j], runs[i]
			}
		}
	}
}

func providerIDFromEnvelope(envelope *AIProviderEnvelope) string {
	if envelope == nil {
		return ""
	}
	return envelope.ProviderID
}

func modelFromEnvelope(envelope *AIProviderEnvelope) string {
	if envelope == nil {
		return ""
	}
	return envelope.Model
}
