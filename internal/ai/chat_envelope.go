package ai

import (
	"fmt"
	"strings"
	"time"

	"arlecchino/internal/ai/agents"
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
	runIDs := make([]string, 0, len(runs))
	for _, run := range runs {
		runIDs = append(runIDs, run.ID)
	}
	timelinesByRun := map[string][]AIRunTimelineEvent{}
	if project.RunTimeline != nil && len(runIDs) > 0 {
		if eventsByRun, err := project.RunTimeline.ListByRuns(runIDs, 80); err == nil {
			timelinesByRun = eventsByRun
		}
	}
	egressByRun := map[string][]AIEgressRecord{}
	if project.Egress != nil && len(runIDs) > 0 {
		if recordsByRun, err := project.Egress.ListByRuns(runIDs, 0); err == nil {
			egressByRun = recordsByRun
		}
	}
	envelopes := make([]AIChatRunEnvelope, 0, len(runs))
	for _, run := range runs {
		timeline := timelinesByRun[run.ID]
		egressRecords := egressByRun[run.ID]
		envelopes = append(envelopes, s.buildChatRunEnvelopeWithTimelineAndEgress(project, run, &timeline, &egressRecords))
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
	if project != nil && project.PendingApprovals != nil {
		if err := project.PendingApprovals.Clear(); err != nil {
			return err
		}
	}
	if project != nil && project.Continuity != nil {
		if err := project.Continuity.Clear(project.ID); err != nil {
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
	if project != nil && project.PendingApprovals != nil {
		if err := project.PendingApprovals.DeleteRuns(ids); err != nil {
			return err
		}
	}
	if project != nil && project.Continuity != nil {
		if err := project.Continuity.DeleteSession(project.ID, sessionID); err != nil {
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

func runNoticeForRun(run AIChatRun, timeline []AIRunTimelineEvent) *AIChatRunNotice {
	status := strings.TrimSpace(run.Status)
	if status == "canceled" {
		return nil
	}

	runtime := run.AgentRuntime
	runtimeStatus := ""
	runtimeProof := ""
	runtimeFailure := ""
	runtimeBlocked := ""
	if runtime != nil {
		runtimeStatus = strings.TrimSpace(runtime.Status)
		runtimeProof = strings.TrimSpace(runtime.ProofState)
		runtimeFailure = strings.TrimSpace(runtime.FailureCode)
		runtimeBlocked = strings.TrimSpace(runtime.BlockedReason)
	}

	latestRunError := latestRunErrorSummary(timeline)
	details := sanitizedDisplayText(firstNonEmpty(run.Error, runtimeBlocked, latestRunError))
	if agentBaselineGitUnavailable(details) {
		return nil
	}
	hasRuntimeFailure := runtimeStatus == "error" || runtimeStatus == "blocked" || runtimeProof == "error" || runtimeProof == "blocked" || runtimeFailure != ""
	if status != "error" && !hasRuntimeFailure && details == "" {
		return nil
	}
	if runtimeFailure == agents.FailureCanceled || runtimeStatus == "canceled" || runtimeProof == "canceled" {
		return nil
	}

	severity := "error"
	if status != "error" && (runtimeStatus == "blocked" || runtimeProof == "blocked") {
		severity = "warning"
	}

	title := runNoticeTitle(runtimeFailure, details)
	message := runNoticeMessage(title, details, runtimeFailure)
	notificationID := strings.TrimSpace(run.ID)
	if notificationID != "" {
		notificationID = "ai-chat-run:" + notificationID + ":notice"
	}

	return &AIChatRunNotice{
		Severity:       severity,
		Title:          title,
		Message:        message,
		Details:        compactRunNoticeDetails(details),
		Source:         "AI Runtime",
		Tag:            string(run.Action),
		NotificationID: notificationID,
	}
}

func latestRunErrorSummary(timeline []AIRunTimelineEvent) string {
	for index := len(timeline) - 1; index >= 0; index-- {
		event := timeline[index]
		if event.Type == "run_error" && strings.TrimSpace(event.Summary) != "" {
			return event.Summary
		}
	}
	return ""
}

func runNoticeTitle(failureCode string, details string) string {
	normalizedFailure := strings.TrimSpace(failureCode)
	normalizedDetails := strings.ToLower(strings.TrimSpace(details))
	switch normalizedFailure {
	case agents.FailureNoReviewableArtifact:
		return "Build proof missing"
	case agents.FailureConsentRequired:
		return "Runtime consent required"
	case agents.FailureProviderNotConfigured:
		return "Provider not configured"
	case agents.FailureProviderNotRunning:
		return "Provider runtime unavailable"
	case agents.FailureRuntimeTimeout:
		return "Provider timed out"
	case agents.FailureToolDenied:
		return "Tool approval blocked"
	case agents.FailureProtectedResourceDenied:
		return "Protected resource blocked"
	}
	switch {
	case strings.Contains(normalizedDetails, "baseline") || strings.Contains(normalizedDetails, "not a git repository"):
		return "Worktree baseline failed"
	case strings.Contains(normalizedDetails, "deadline exceeded") || strings.Contains(normalizedDetails, "timeout"):
		return "Provider timed out"
	case strings.Contains(normalizedDetails, "does not support agent tools") || strings.Contains(normalizedDetails, "tool-capable"):
		return "Tool-capable model required"
	case strings.Contains(normalizedDetails, "consent"):
		return "Runtime consent required"
	default:
		return "AI run failed"
	}
}

func runNoticeMessage(title string, details string, failureCode string) string {
	switch title {
	case "Worktree baseline failed":
		return "The agent could not establish a clean worktree baseline."
	case "Build proof missing":
		return "The run ended without reviewable diff or accepted no-change evidence."
	case "Provider timed out":
		return "The provider did not complete the run in time."
	case "Runtime consent required":
		return "Runtime consent is required before this provider can continue."
	case "Tool-capable model required":
		return "Switch to a model that can use the required agent tools."
	case "Provider not configured":
		return "Select and configure a compatible AI provider."
	case "Provider runtime unavailable":
		return "Start the selected runtime or choose another provider."
	case "Tool approval blocked":
		return "A tool request was blocked by the current approval policy."
	case "Protected resource blocked":
		return "The runtime tried to access a protected resource."
	}
	if strings.TrimSpace(failureCode) != "" {
		return "The runtime reported a failure."
	}
	if details != "" {
		return compactRunNoticeDetails(details)
	}
	return "The runtime needs attention."
}

func compactRunNoticeDetails(value string) string {
	const max = 1200
	text := sanitizedDisplayText(value)
	if len(text) <= max {
		return text
	}
	return strings.TrimSpace(text[:max-3]) + "..."
}

func (s *Service) buildChatRunEnvelopeWithTimeline(project *ProjectSession, run AIChatRun, timelineOverride *[]AIRunTimelineEvent) AIChatRunEnvelope {
	return s.buildChatRunEnvelopeWithTimelineAndEgress(project, run, timelineOverride, nil)
}

func (s *Service) buildChatRunEnvelopeWithTimelineAndEgress(project *ProjectSession, run AIChatRun, timelineOverride *[]AIRunTimelineEvent, egressRecords *[]AIEgressRecord) AIChatRunEnvelope {
	run = normalizeChatRunToolProposals(run)
	approval := s.approvalSummaryForProject(project)
	consent := s.consentSummary()
	providerEnvelope := s.providerEnvelopeForRun(run)
	egressSummary := s.egressSummaryForRunRecords(project, run, egressRecords)
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
		RuntimeFamily:       run.RuntimeFamily,
		ProviderID:          firstNonEmpty(run.ProviderID, providerIDFromEnvelope(providerEnvelope)),
		Model:               firstNonEmpty(run.Model, modelFromEnvelope(providerEnvelope)),
		ReasoningEffort:     run.ReasoningEffort,
		Error:               sanitizedDisplayText(run.Error),
		RunNotice:           runNoticeForRun(run, timeline),
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
		AgentRuntime:        run.AgentRuntime,
		Links:               run.Links,
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
		if agentDescriptor, agentOK := s.agentProviderDescriptor(providerID); agentOK {
			descriptor = agentDescriptor
			ok = true
		}
	}
	if !ok {
		return nil
	}
	envelope := providerEnvelopeFromDescriptor(descriptor, firstNonEmpty(run.Model, descriptor.DefaultModel))
	return &envelope
}

func providerEnvelopeFromDescriptor(descriptor AIProviderDescriptor, model string) AIProviderEnvelope {
	return AIProviderEnvelope{
		ProviderID:         descriptor.ID,
		Kind:               descriptor.Kind,
		RuntimeFamily:      descriptor.RuntimeFamily,
		Transport:          descriptor.Transport,
		Endpoint:           descriptor.Endpoint,
		EndpointClass:      descriptor.EndpointClass,
		Model:              firstNonEmpty(model, descriptor.DefaultModel),
		Status:             descriptor.Status,
		AuthStatus:         descriptor.AuthStatus,
		BillingMode:        descriptor.BillingMode,
		LegalBasis:         descriptor.LegalBasis,
		RiskTier:           descriptor.RiskTier,
		SourceLinks:        descriptor.SourceLinks,
		RuntimeVersion:     descriptor.RuntimeVersion,
		AdapterVersion:     descriptor.AdapterVersion,
		ProtocolVersion:    descriptor.ProtocolVersion,
		CompatibilityRange: descriptor.CompatibilityRange,
		Local:              descriptor.Local,
		Frontier:           descriptor.Frontier,
		ExternalAccount:    descriptor.ExternalAccount,
	}
}

func (s *Service) egressSummaryForRunRecords(project *ProjectSession, run AIChatRun, recordsOverride *[]AIEgressRecord) *AIEgressSummary {
	if project == nil || project.Egress == nil {
		return nil
	}
	records := []AIEgressRecord{}
	if recordsOverride != nil {
		records = append(records, (*recordsOverride)...)
	} else if strings.TrimSpace(run.ID) != "" {
		if runRecords, err := project.Egress.ListByRun(run.ID, 0); err == nil {
			records = runRecords
		}
	}
	if len(records) == 0 && strings.TrimSpace(run.EgressRecordID) != "" {
		if record, ok, err := project.Egress.FindByID(run.EgressRecordID); err == nil && ok {
			records = append(records, record)
		}
	}
	return aggregateEgressSummaryForRun(run, records)
}

func aggregateEgressSummaryForRun(run AIChatRun, records []AIEgressRecord) *AIEgressSummary {
	if len(records) == 0 {
		return nil
	}
	latestByRequest := map[string]AIEgressRecord{}
	requestOrder := []string{}
	for index, record := range records {
		key := strings.TrimSpace(record.RequestID)
		if key == "" {
			key = strings.TrimSpace(record.ID)
		}
		if key == "" {
			key = fmt.Sprintf("record-%d", index)
		}
		if _, exists := latestByRequest[key]; !exists {
			requestOrder = append(requestOrder, key)
		}
		latestByRequest[key] = record
	}
	latestRecords := make([]AIEgressRecord, 0, len(requestOrder))
	for _, key := range requestOrder {
		latestRecords = append(latestRecords, latestByRequest[key])
	}
	finalRecord := records[len(records)-1]
	summary := &AIEgressSummary{
		RecordID:        finalRecord.ID,
		Status:          finalRecord.Status,
		FinalStatus:     finalRecord.Status,
		ProviderID:      firstNonEmpty(run.ProviderID, finalRecord.ProviderID),
		ProviderKind:    finalRecord.ProviderKind,
		Endpoint:        finalRecord.Endpoint,
		Model:           firstNonEmpty(run.Model, finalRecord.Model),
		ReasoningEffort: firstNonEmpty(run.ReasoningEffort, finalRecord.ReasoningEffort),
		Capability:      finalRecord.Capability,
		Redaction:       mergeEgressRedactions(latestRecords),
		Canceled:        finalRecord.Canceled,
		ErrorClass:      finalRecord.ErrorClass,
		CreatedAt:       finalRecord.CreatedAt,
		RunID:           firstNonEmpty(run.ID, finalRecord.RunID),
		Source:          finalRecord.Source,
		ChatAction:      finalRecord.ChatAction,
		RequestCount:    len(latestRecords),
	}
	if summary.ChatAction == "" {
		summary.ChatAction = run.Action
	}

	tokenSources := []string{}
	costSources := []string{}
	toolProfiles := []string{}
	toolSupportKinds := []string{}
	var costCurrency string
	var costMicros int64
	var pricedRecords int
	mixedCurrency := false
	hasTokenEvidence := false
	for _, record := range latestRecords {
		if record.ID != "" {
			summary.RecordIDs = appendUniqueString(summary.RecordIDs, record.ID)
		}
		if record.ProviderID != "" {
			summary.ProviderIDs = appendUniqueString(summary.ProviderIDs, record.ProviderID)
		}
		if record.Model != "" {
			summary.Models = appendUniqueString(summary.Models, record.Model)
		}
		summary.DataCategories = appendUniqueStrings(summary.DataCategories, record.DataCategories)
		summary.InputTokens += record.InputTokens
		summary.OutputTokens += record.OutputTokens
		totalTokens := record.TotalTokens
		if totalTokens == 0 && (record.InputTokens > 0 || record.OutputTokens > 0) {
			totalTokens = record.InputTokens + record.OutputTokens
		}
		summary.TotalTokens += totalTokens
		if totalTokens > 0 || record.InputTokens > 0 || record.OutputTokens > 0 {
			hasTokenEvidence = true
		}
		if record.EstimatedTokens {
			summary.EstimatedTokens = true
		}
		if record.TokenSource != "" {
			tokenSources = appendUniqueString(tokenSources, record.TokenSource)
		}
		if record.LatencyMs > 0 {
			summary.APIDurationMs += record.LatencyMs
		}
		if record.Canceled {
			summary.Canceled = true
		}
		if record.CostEstimated {
			summary.CostEstimated = true
		}
		if record.CostSource != "" {
			costSources = appendUniqueString(costSources, record.CostSource)
		}
		if record.CostMicros > 0 {
			pricedRecords++
			if costCurrency == "" {
				costCurrency = record.CostCurrency
			} else if record.CostCurrency != "" && record.CostCurrency != costCurrency {
				mixedCurrency = true
			}
			costMicros += record.CostMicros
		}
		if record.ToolProfile != "" {
			toolProfiles = appendUniqueString(toolProfiles, record.ToolProfile)
		}
		if record.ToolSchemaCount > summary.ToolSchemaCount {
			summary.ToolSchemaCount = record.ToolSchemaCount
		}
		if record.ToolSupportKind != "" {
			toolSupportKinds = appendUniqueString(toolSupportKinds, record.ToolSupportKind)
		}
	}
	if len(summary.ProviderIDs) > 0 && summary.ProviderID == "" {
		summary.ProviderID = summary.ProviderIDs[0]
	}
	if len(summary.Models) > 0 && summary.Model == "" {
		summary.Model = summary.Models[0]
	}
	summary.MixedProviders = len(summary.ProviderIDs) > 1
	summary.MixedModels = len(summary.Models) > 1
	summary.LatencyMs = summary.APIDurationMs
	summary.TokenSource = aggregateSourceLabel(tokenSources, hasTokenEvidence, summary.EstimatedTokens, "unavailable")
	summary.CostMicros, summary.CostCurrency, summary.CostSource = aggregateCostFields(costMicros, costCurrency, pricedRecords, mixedCurrency, costSources)
	summary.ToolProfile = aggregateStringField(toolProfiles, "none")
	summary.ToolSupportKind = aggregateStringField(toolSupportKinds, "")
	if terminalRunStatus(run.Status) {
		if durationMs, ok := durationMsBetween(run.CreatedAt, run.UpdatedAt); ok {
			summary.WallDurationMs = durationMs
		}
	}
	summary.FirstTokenAt = run.FirstTokenAt
	if firstTokenLatencyMs, ok := durationMsBetween(run.CreatedAt, run.FirstTokenAt); ok {
		summary.FirstTokenLatencyMs = firstTokenLatencyMs
	}
	return summary
}

func appendUniqueString(values []string, next string) []string {
	next = strings.TrimSpace(next)
	if next == "" {
		return values
	}
	for _, value := range values {
		if value == next {
			return values
		}
	}
	return append(values, next)
}

func appendUniqueStrings(values []string, next []string) []string {
	for _, value := range next {
		values = appendUniqueString(values, value)
	}
	return values
}

func mergeEgressRedactions(records []AIEgressRecord) AIRedactionSummary {
	var summary AIRedactionSummary
	for _, record := range records {
		redaction := record.Redaction
		summary.SecretsRedacted += redaction.SecretsRedacted
		summary.PathsRedacted += redaction.PathsRedacted
		summary.Truncated = summary.Truncated || redaction.Truncated
		summary.OriginalBytes += redaction.OriginalBytes
		summary.SanitizedBytes += redaction.SanitizedBytes
		summary.BlockedCategories = appendUniqueStrings(summary.BlockedCategories, redaction.BlockedCategories)
		summary.AppliedRules = appendUniqueStrings(summary.AppliedRules, redaction.AppliedRules)
	}
	return summary
}

func aggregateSourceLabel(values []string, hasEvidence bool, estimated bool, unavailable string) string {
	if len(values) == 1 {
		return values[0]
	}
	if len(values) > 1 {
		return "mixed"
	}
	if !hasEvidence {
		return unavailable
	}
	if estimated {
		return "estimated"
	}
	return "provider"
}

func aggregateStringField(values []string, emptyValue string) string {
	if len(values) == 0 {
		return emptyValue
	}
	if len(values) == 1 {
		return values[0]
	}
	return "mixed"
}

func aggregateCostFields(costMicros int64, costCurrency string, pricedRecords int, mixedCurrency bool, costSources []string) (int64, string, string) {
	if mixedCurrency {
		return 0, "", "mixed_currency"
	}
	if pricedRecords > 0 {
		return costMicros, costCurrency, aggregateStringField(costSources, "priced")
	}
	if len(costSources) > 1 {
		return 0, "", "mixed_or_unpriced"
	}
	if len(costSources) == 1 {
		return 0, "", costSources[0]
	}
	return 0, "", "unpriced"
}

func terminalRunStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "error", "canceled", "blocked":
		return true
	default:
		return false
	}
}

func durationMsBetween(start string, end string) (int64, bool) {
	if strings.TrimSpace(start) == "" || strings.TrimSpace(end) == "" {
		return 0, false
	}
	startTime, err := time.Parse(time.RFC3339, start)
	if err != nil {
		return 0, false
	}
	endTime, err := time.Parse(time.RFC3339, end)
	if err != nil {
		return 0, false
	}
	if endTime.Before(startTime) {
		return 0, false
	}
	return endTime.Sub(startTime).Milliseconds(), true
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
	if provider.EndpointClass == "remote_byok" {
		summary.ProviderPolicyAllowed = consent.RemoteBYOKProvidersAccepted
		summary.RetentionSummary = "remote BYOK provider call; Arlecchino stores metadata-only egress locally"
	}
	if provider.Frontier {
		summary.ProviderPolicyAllowed = consent.FrontierProvidersAccepted
		summary.RetentionSummary = "frontier provider API call; Arlecchino stores metadata-only egress locally"
	}
	if provider.EndpointClass == "local_process_external_account" || provider.ExternalAccount {
		summary.ProviderPolicyAllowed = consent.ExternalAgentCLIAccepted
		summary.RetentionSummary = "external CLI account; Arlecchino stores metadata and redacted transcript locally"
	}
	return summary
}

func endpointClass(provider *AIProviderEnvelope) string {
	if provider == nil || provider.Endpoint == "" {
		if provider != nil && provider.EndpointClass != "" {
			return provider.EndpointClass
		}
		return "unknown"
	}
	if provider.EndpointClass != "" {
		return provider.EndpointClass
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
