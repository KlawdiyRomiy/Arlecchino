package ai

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"arlecchino/internal/ai/mnemonic"
	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const defaultChatSessionID = "default"

func (s *Service) StartChatRun(_ context.Context, projectID string, req AIChatRunRequest) (AIChatRun, error) {
	project := s.project(projectID)
	if project == nil {
		return AIChatRun{}, fmt.Errorf("AI project session is not open")
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return AIChatRun{}, fmt.Errorf("chat prompt is empty")
	}
	if req.Action == "" {
		req.Action = AIChatActionPlan
	}
	if !validChatAction(req.Action) {
		return AIChatRun{}, fmt.Errorf("unsupported chat action %q", req.Action)
	}
	sessionID := strings.TrimSpace(req.SessionID)
	if sessionID == "" {
		sessionID = defaultChatSessionID
	}
	runID := uuid.NewString()
	now := utcNow()
	run := &AIChatRun{
		ID:                runID,
		SessionID:         sessionID,
		ProjectSessionID:  project.ID,
		Action:            req.Action,
		Status:            "running",
		ProviderID:        req.ProviderID,
		Model:             req.Model,
		UserPrompt:        sanitizedDisplayText(req.Prompt),
		MnemonicRequested: req.IncludeMnemonic,
		CanCancel:         true,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	runCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	s.mu.Lock()
	s.runs[runID] = run
	s.runCancels[runID] = cancel
	s.runDone[runID] = done
	runCopy := *run
	s.mu.Unlock()
	s.emitEvent("ai:chat:run-started", runCopy)
	s.emitRunEnvelope(project.ID, runID)

	go func() {
		defer s.markRunDone(runID)
		s.runChat(runCtx, project.ID, runID, req)
	}()
	return runCopy, nil
}

func (s *Service) CancelChatRun(projectID string, runID string) (AIChatRun, error) {
	projectID = normalizeProjectID(projectID)
	runID = strings.TrimSpace(runID)
	s.mu.Lock()
	run := s.runs[runID]
	if run != nil && run.ProjectSessionID != projectID {
		s.mu.Unlock()
		return AIChatRun{}, fmt.Errorf("chat run %q was not found", runID)
	}
	cancel := s.runCancels[runID]
	if cancel != nil {
		cancel()
	}
	if run != nil && run.Status == "running" {
		run.Status = "canceled"
		run.CanCancel = false
		run.UpdatedAt = utcNow()
	}
	runCopy := AIChatRun{}
	if run != nil {
		runCopy = *run
	}
	delete(s.runCancels, runID)
	s.mu.Unlock()
	if run == nil {
		return AIChatRun{}, fmt.Errorf("chat run %q was not found", runID)
	}
	s.emitEvent("ai:chat:run-canceled", runCopy)
	s.emitRunEnvelope(runCopy.ProjectSessionID, runID)
	return runCopy, nil
}

func (s *Service) GetChatRun(projectID string, runID string) (AIChatRun, error) {
	projectID = normalizeProjectID(projectID)
	runID = strings.TrimSpace(runID)
	s.mu.RLock()
	defer s.mu.RUnlock()
	run := s.runs[runID]
	if run == nil || run.ProjectSessionID != projectID {
		return AIChatRun{}, fmt.Errorf("chat run %q was not found", runID)
	}
	return *run, nil
}

func (s *Service) runChat(ctx context.Context, projectID string, runID string, req AIChatRunRequest) {
	project := s.project(projectID)
	if project == nil {
		s.finishRunError(runID, "AI project session is not open")
		return
	}
	req.Context.Capability = providers.CapabilityChat
	req.Context.Prompt = req.Prompt
	req.Context.IncludeMnemonic = req.IncludeMnemonic
	req.Context.IncludeMCP = req.IncludeMCP || req.Context.IncludeMCP
	snapshot := s.buildContextSnapshot(project, req.Context)
	contextSummary := summarizeContextSnapshot(snapshot)
	s.updateRun(runID, func(run *AIChatRun) {
		run.ContextSummary = &contextSummary
	})
	s.emitEvent("ai:chat:context-ready", map[string]any{"runId": runID, "contextSummary": contextSummary})
	s.emitRunEnvelope(project.ID, runID)

	provider, descriptor, err := s.resolveProvider(req.ProviderID)
	if err != nil {
		s.finishRunError(runID, err.Error())
		return
	}
	if !capabilityAllowed(descriptor.Capabilities, providers.CapabilityChat) {
		s.finishRunError(runID, fmt.Sprintf("provider %s does not support %s", descriptor.ID, providers.CapabilityChat))
		return
	}
	s.updateRun(runID, func(run *AIChatRun) {
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
	})
	s.emitRunEnvelope(project.ID, runID)
	system := systemPromptForAction(req.Action)
	generationReq := providers.GenerationRequest{
		Capability: providers.CapabilityChat,
		Prompt:     buildPromptFromSnapshot(snapshot),
		System:     system,
		Model:      firstNonEmpty(req.Model, descriptor.DefaultModel),
		MaxTokens:  req.MaxTokens,
		Stream:     true,
	}
	if generationReq.MaxTokens <= 0 {
		generationReq.MaxTokens = 768
	}
	started := time.Now()
	requestID := uuid.NewString()
	record := AIEgressRecord{
		ID:               "eg-" + requestID,
		RequestID:        requestID,
		ProviderID:       descriptor.ID,
		ProviderKind:     descriptor.Kind,
		Endpoint:         descriptor.Endpoint,
		Model:            generationReq.Model,
		Capability:       providers.CapabilityChat,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Status:           "started",
		OptInSource:      "chat",
		CreatedAt:        utcNow(),
		RunID:            runID,
		Source:           "chat_run",
		ChatAction:       req.Action,
	}
	response, err := provider.Generate(ctx, generationReq, func(token string) error {
		if ctx.Err() != nil || s.runIsCanceled(runID) {
			return context.Canceled
		}
		if token == "" {
			return nil
		}
		token = sanitizedDisplayText(token)
		s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": token})
		s.updateRun(runID, func(run *AIChatRun) {
			run.Response += token
		})
		return nil
	})
	record.LatencyMs = time.Since(started).Milliseconds()
	if ctx.Err() != nil || s.runIsCanceled(runID) {
		record.Status = "canceled"
		record.Canceled = true
		if project.Egress != nil {
			stored, ledgerErr := project.Egress.Append(record)
			if ledgerErr == nil {
				record = stored
			}
		}
		s.emitEvent("ai:chat:egress-recorded", record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
		})
		s.finishRunCanceled(runID, record)
		return
	}
	if err != nil {
		record.Status = "error"
		record.ErrorClass = errorClass(err)
		record.Canceled = ctx.Err() != nil
		if project.Egress != nil {
			stored, ledgerErr := project.Egress.Append(record)
			if ledgerErr == nil {
				record = stored
			}
		}
		s.emitEvent("ai:chat:egress-recorded", record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
		})
		if record.Canceled {
			s.finishRunCanceled(runID, record)
			return
		}
		s.finishRunError(runID, err.Error())
		return
	}
	record.Status = "completed"
	if project.Egress != nil {
		stored, ledgerErr := project.Egress.Append(record)
		if ledgerErr == nil {
			record = stored
		}
	}
	s.emitEvent("ai:chat:egress-recorded", record)
	s.updateRun(runID, func(run *AIChatRun) {
		run.EgressRecordID = record.ID
	})
	s.emitRunEnvelope(project.ID, runID)
	proposals := toolProposalsForAction(req.Action, s.approvalSummaryForProject(project), project.ProjectRoot)
	for _, proposal := range proposals {
		s.emitEvent("ai:chat:tool-proposed", map[string]any{"runId": runID, "proposal": proposal})
	}
	s.updateRun(runID, func(run *AIChatRun) {
		if strings.TrimSpace(run.Response) == "" {
			run.Response = sanitizedDisplayText(response.Text)
		}
		run.Status = "completed"
		run.CanCancel = false
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(response.Model, generationReq.Model)
		run.ToolProposals = proposals
		run.EgressRecordID = record.ID
	})
	s.emitRunEnvelope(project.ID, runID)
	if project.Mnemonic != nil && project.Mnemonic.Enabled() {
		if ctx.Err() == nil && s.projectIsCurrent(projectID, project) {
			_, _ = project.Mnemonic.Save(mnemonic.Entry{
				Type:       "chat_summary",
				Source:     "ai-chat",
				Tags:       []string{string(req.Action)},
				Content:    summarizeForMnemonic(req.Prompt, response.Text),
				Importance: 5,
				Trust:      mnemonic.TrustGenerated,
				Provenance: map[string]string{"source": "ai-chat-summary", "runId": runID},
			})
		}
	}
	if run, err := s.GetChatRun(projectID, runID); err == nil {
		s.emitEvent("ai:chat:run-completed", run)
	}
	s.mu.Lock()
	delete(s.runCancels, runID)
	s.mu.Unlock()
}

func (s *Service) markRunDone(runID string) {
	s.mu.Lock()
	done := s.runDone[runID]
	delete(s.runDone, runID)
	delete(s.runCancels, runID)
	s.mu.Unlock()
	if done != nil {
		close(done)
	}
}

func (s *Service) updateRun(runID string, update func(*AIChatRun)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run := s.runs[runID]
	if run == nil {
		return
	}
	update(run)
	run.UpdatedAt = utcNow()
}

func (s *Service) runIsCanceled(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run := s.runs[runID]
	return run != nil && run.Status == "canceled"
}

func (s *Service) finishRunError(runID string, message string) {
	s.mu.Lock()
	run := s.runs[runID]
	if run == nil || run.Status == "canceled" {
		delete(s.runCancels, runID)
		s.mu.Unlock()
		return
	}
	run.Status = "error"
	run.Error = message
	run.CanCancel = false
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	s.emitEvent("ai:chat:run-error", runCopy)
	s.emitRunEnvelope(runCopy.ProjectSessionID, runID)
}

func (s *Service) finishRunCanceled(runID string, record AIEgressRecord) {
	s.mu.Lock()
	run := s.runs[runID]
	if run == nil {
		delete(s.runCancels, runID)
		s.mu.Unlock()
		return
	}
	shouldEmit := run.Status != "canceled"
	run.Status = "canceled"
	run.CanCancel = false
	run.EgressRecordID = record.ID
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	if shouldEmit {
		s.emitEvent("ai:chat:run-canceled", runCopy)
	}
	s.emitRunEnvelope(runCopy.ProjectSessionID, runID)
}

func validChatAction(action AIChatAction) bool {
	switch action {
	case AIChatActionDebug, AIChatActionPlan, AIChatActionBuild:
		return true
	default:
		return false
	}
}

func systemPromptForAction(action AIChatAction) string {
	switch action {
	case AIChatActionDebug:
		return "You are Arlecchino's local-first debug assistant. Identify likely causes, ask for missing evidence only if required, and do not propose mutations as already executed."
	case AIChatActionBuild:
		return "You are Arlecchino's build assistant. Return an implementation-oriented answer. If tool execution is useful, propose tools only; do not claim any file, terminal, MCP, or subagent action has run."
	default:
		return "You are Arlecchino's planning assistant. Produce a concrete plan grounded in the provided context."
	}
}

func toolProposalsForAction(action AIChatAction, approval AIApprovalSummary, projectRoot string) []AIToolProposal {
	if action != AIChatActionBuild {
		return []AIToolProposal{}
	}
	proposals := []AIToolProposal{
		{
			ID:                   "tool-proposal-context-read",
			Name:                 "read_more_context",
			Description:          "Read additional project context before a build action.",
			Policy:               AIToolPolicyReadOnly,
			Kind:                 AIToolKindContextRead,
			ScopeSummary:         "Project-local read-only context expansion.",
			RiskLevel:            AIToolRiskLow,
			ApprovalModeRequired: AIApprovalModeReadOnlyAllowed,
			Status:               AIToolProposalStatusProposed,
			ExecutionState:       AIToolExecutionStateNotExecutable,
		},
		{
			ID:                   "tool-proposal-apply-change",
			Name:                 "apply_code_change",
			Description:          "Apply a code change after explicit approval.",
			Policy:               AIToolPolicyApprovalRequired,
			Kind:                 AIToolKindFileWrite,
			ScopeSummary:         "Project-scoped file mutation proposal.",
			RiskLevel:            AIToolRiskHigh,
			ApprovalModeRequired: AIApprovalModeFullAccess,
			Status:               AIToolProposalStatusProposed,
			ExecutionState:       AIToolExecutionStateNotExecutable,
		},
		{
			ID:                   "tool-proposal-mcp-ui-context",
			Name:                 "mcp_ui_context_action",
			Description:          "Propose an MCP UI/context action. Actual MCP execution requires separate MCP approval.",
			Policy:               AIToolPolicyApprovalRequired,
			Kind:                 AIToolKindMCP,
			MCPToolName:          "ide_ui.open_file_panel",
			ScopeSummary:         "Project-scoped MCP proposal; AI backend records metadata only.",
			RiskLevel:            AIToolRiskMedium,
			ApprovalModeRequired: AIApprovalModeFullAccess,
			Status:               AIToolProposalStatusProposed,
			ExecutionState:       AIToolExecutionStateNotExecutable,
		},
	}
	for i := range proposals {
		proposals[i] = evaluateToolProposal(proposals[i], approval, projectRoot)
	}
	return proposals
}

func evaluateToolProposal(proposal AIToolProposal, approval AIApprovalSummary, projectRoot string) AIToolProposal {
	if reason := hardDenyReasonForProposal(proposal, projectRoot); reason != "" {
		proposal.HardDenyReason = reason
		proposal.AllowedByCurrentPolicy = false
		proposal.Status = AIToolProposalStatusBlocked
		proposal.RiskLevel = AIToolRiskHardDeny
		return proposal
	}
	switch proposal.ApprovalModeRequired {
	case AIApprovalModeReadOnlyAllowed:
		proposal.AllowedByCurrentPolicy = approval.Mode == AIApprovalModeReadOnlyAllowed || approval.FullAccessActive
	case AIApprovalModeFullAccess:
		proposal.AllowedByCurrentPolicy = approval.FullAccessActive && toolKindAllowed(proposal.Kind, approval.AllowedToolKinds)
	default:
		proposal.AllowedByCurrentPolicy = false
	}
	return proposal
}

func hardDenyReasonForProposal(proposal AIToolProposal, projectRoot string) AIToolHardDenyReason {
	command := strings.ToLower(strings.TrimSpace(proposal.CommandPreview))
	if command != "" && (strings.Contains(command, "rm -rf") || strings.Contains(command, "mkfs") || strings.Contains(command, "diskutil erase") || strings.Contains(command, ":(){")) {
		return AIToolHardDenyReasonDestructiveShell
	}
	for _, path := range proposal.TargetPaths {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if strings.Contains(strings.ToLower(path), ".env") || strings.Contains(strings.ToLower(path), "id_rsa") {
			return AIToolHardDenyReasonSensitivePaths
		}
		if projectRoot != "" && filepath.IsAbs(path) {
			rel, err := filepath.Rel(projectRoot, path)
			if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
				return AIToolHardDenyReasonOutsideProjectWrite
			}
		}
	}
	if endpoint := strings.TrimSpace(proposal.Arguments["endpoint"]); endpoint != "" && !isLoopbackEndpoint(endpoint) {
		return AIToolHardDenyReasonNonLoopbackNetwork
	}
	return ""
}

func summarizeForMnemonic(prompt string, response string) string {
	prompt = strings.TrimSpace(sanitizedDisplayText(prompt))
	response = strings.TrimSpace(sanitizedDisplayText(response))
	if len(response) > 700 {
		response = truncateUTF8(response, 700)
	}
	if len(prompt) > 300 {
		prompt = truncateUTF8(prompt, 300)
	}
	switch {
	case prompt != "" && response != "":
		return "User asked: " + prompt + "\nAssistant answered: " + response
	case response != "":
		return response
	default:
		return prompt
	}
}

func sanitizedDisplayText(value string) string {
	value, _ = sanitizeText(value, AIRedactionSummary{})
	return value
}
