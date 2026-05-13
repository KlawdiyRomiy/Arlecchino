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
	runID = strings.TrimSpace(runID)
	s.mu.RLock()
	run := s.runs[runID]
	if run == nil || run.ProjectSessionID != project.ID {
		s.mu.RUnlock()
		return AIChatRunEnvelope{}, fmt.Errorf("chat run %q was not found", runID)
	}
	runCopy := *run
	s.mu.RUnlock()
	return s.buildChatRunEnvelope(project, runCopy), nil
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
	s.mu.RLock()
	runs := []AIChatRun{}
	for _, run := range s.runs {
		if run.ProjectSessionID == project.ID {
			runs = append(runs, *run)
		}
	}
	s.mu.RUnlock()
	sortRunsNewestFirst(runs)
	if len(runs) > limit {
		runs = runs[:limit]
	}
	envelopes := make([]AIChatRunEnvelope, 0, len(runs))
	for _, run := range runs {
		envelopes = append(envelopes, s.buildChatRunEnvelope(project, run))
	}
	return envelopes, nil
}

func (s *Service) ClearChatRuns(projectID string) error {
	projectID = normalizeProjectID(projectID)
	s.waitForRuns(s.cancelRuns(projectID))
	s.mu.Lock()
	for runID, run := range s.runs {
		if run.ProjectSessionID == projectID {
			delete(s.runs, runID)
			delete(s.runCancels, runID)
			delete(s.runDone, runID)
		}
	}
	s.mu.Unlock()
	return nil
}

func (s *Service) buildChatRunEnvelope(project *ProjectSession, run AIChatRun) AIChatRunEnvelope {
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
	return AIChatRunEnvelope{
		ID:                  run.ID,
		SessionID:           run.SessionID,
		ProjectSessionID:    run.ProjectSessionID,
		Action:              run.Action,
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
			RecordID:       record.ID,
			Status:         record.Status,
			ProviderID:     record.ProviderID,
			ProviderKind:   record.ProviderKind,
			Endpoint:       record.Endpoint,
			Model:          record.Model,
			Capability:     record.Capability,
			DataCategories: record.DataCategories,
			Redaction:      record.Redaction,
			LatencyMs:      record.LatencyMs,
			Canceled:       record.Canceled,
			ErrorClass:     record.ErrorClass,
			CreatedAt:      record.CreatedAt,
			RunID:          record.RunID,
			Source:         record.Source,
			ChatAction:     record.ChatAction,
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
