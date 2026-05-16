package ai

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"arlecchino/internal/ai/mnemonic"
	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const defaultChatSessionID = "default"

var errChatStreamStopped = errors.New("AI chat stream stopped")

var defaultChatStopSequences = []string{
	"<|im_end|>",
	"<|im_start|>",
	"<im_end|>",
	"<im_start|>",
	"<|lim_end|>",
	"<|lim_start|>",
	"<lim_end|>",
	"<lim_start|>",
	"</s>",
	"\nuser:",
	"\nassistant:",
	"\nsystem:",
	"\nUser:",
	"\nAssistant:",
	"\nSystem:",
}

func (s *Service) StartChatRun(_ context.Context, projectID string, req AIChatRunRequest) (AIChatRun, error) {
	project := s.project(projectID)
	if project == nil {
		return AIChatRun{}, fmt.Errorf("AI project session is not open")
	}
	req = s.resolveChatRunRequest(req)
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
		ProfileID:         req.ProfileID,
		WorkflowID:        req.WorkflowID,
		Status:            "running",
		ProviderID:        req.ProviderID,
		Model:             req.Model,
		UserPrompt:        sanitizedDisplayText(req.Prompt),
		MnemonicRequested: req.IncludeMnemonic,
		CanCancel:         true,
		Revision:          1,
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
	s.persistChatRun(runCopy)
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
		run.Revision++
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
	s.persistChatRun(runCopy)
	s.emitEvent("ai:chat:run-canceled", runCopy)
	s.emitRunEnvelope(runCopy.ProjectSessionID, runID)
	return runCopy, nil
}

func (s *Service) GetChatRun(projectID string, runID string) (AIChatRun, error) {
	projectID = normalizeProjectID(projectID)
	project := s.project(projectID)
	runID = strings.TrimSpace(runID)
	s.mu.RLock()
	run := s.runs[runID]
	if run != nil && run.ProjectSessionID == projectID {
		runCopy := *run
		s.mu.RUnlock()
		return normalizeChatRunForDisplay(runCopy), nil
	}
	s.mu.RUnlock()
	if project == nil {
		return AIChatRun{}, fmt.Errorf("AI project session is not open")
	}
	if project.ChatHistory != nil {
		runs, err := project.ChatHistory.List(0)
		if err != nil {
			return AIChatRun{}, err
		}
		for _, candidate := range runs {
			if candidate.ID == runID {
				return normalizeLoadedChatRun(project.ID, candidate), nil
			}
		}
	}
	return AIChatRun{}, fmt.Errorf("chat run %q was not found", runID)
}

func (s *Service) runChat(ctx context.Context, projectID string, runID string, req AIChatRunRequest) {
	project := s.project(projectID)
	if project == nil {
		s.finishRunError(runID, "AI project session is not open")
		return
	}
	if response, ok := s.preflightChatResponseForRequest(req); ok {
		s.finishRunCompleted(runID, response)
		return
	}
	req.Context.Capability = providers.CapabilityChat
	req.Context.Prompt = req.Prompt
	req.Context.IncludeMnemonic = req.IncludeMnemonic
	req.Context.IncludeMCP = req.IncludeMCP || req.Context.IncludeMCP
	req.Context.IncludeSkills = req.IncludeSkills || req.Context.IncludeSkills
	snapshot := s.buildContextSnapshot(project, req.Context)
	contextSummary := summarizeContextSnapshot(snapshot)
	s.updateRun(runID, func(run *AIChatRun) {
		run.ContextSummary = &contextSummary
	})
	s.emitEvent("ai:chat:context-ready", map[string]any{"runId": runID, "contextSummary": contextSummary})
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactContext, "Context disclosure", contextArtifactSummary(contextSummary), snapshot)
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
	system := systemPromptForAction(req.Action) + "\n" + chatModeBoundaryPrompt(req)
	generationReq := providers.GenerationRequest{
		Capability: providers.CapabilityChat,
		Prompt:     buildChatPromptFromSnapshot(snapshot),
		System:     system,
		Model:      firstNonEmpty(req.Model, descriptor.DefaultModel),
		MaxTokens:  req.MaxTokens,
		Stop:       defaultChatStopSequences,
		Stream:     true,
	}
	if generationReq.MaxTokens <= 0 {
		generationReq.MaxTokens = defaultChatMaxTokens(req.Action)
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
	streamGuard := newChatStreamGuard(req, system, generationReq.Prompt)
	response, err := provider.Generate(ctx, generationReq, func(token string) error {
		if ctx.Err() != nil || s.runIsCanceled(runID) {
			return context.Canceled
		}
		if token == "" {
			return nil
		}
		displayToken := sanitizedDisplayChunk(token)
		releaseToken, observeErr := streamGuard.Observe(token, displayToken)
		if releaseToken != "" {
			s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": releaseToken})
			s.updateRun(runID, func(run *AIChatRun) {
				run.Response += releaseToken
			})
		}
		return observeErr
	})
	if releaseToken := streamGuard.Flush(); releaseToken != "" {
		s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": releaseToken})
		s.updateRun(runID, func(run *AIChatRun) {
			run.Response += releaseToken
		})
	}
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
		s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "Provider egress", egressArtifactSummary(record), record)
		s.finishRunCanceled(runID, record)
		return
	}
	stoppedByGuard := errors.Is(err, errChatStreamStopped)
	if err != nil && !stoppedByGuard {
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
		s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "Provider egress", egressArtifactSummary(record), record)
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
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "Provider egress", egressArtifactSummary(record), record)
	s.emitRunEnvelope(project.ID, runID)
	proposals := toolProposalsForAction(req.Action, s.approvalSummaryForProject(project), project.ProjectRoot, req.Prompt)
	for _, proposal := range proposals {
		s.emitEvent("ai:chat:tool-proposed", map[string]any{"runId": runID, "proposal": proposal})
	}
	if len(proposals) > 0 {
		s.recordChatRunArtifact(project, runID, AIChatRunArtifactToolProposal, "Tool proposals", toolProposalArtifactSummary(proposals), proposals)
	}
	s.updateRun(runID, func(run *AIChatRun) {
		run.Response = cleanChatGeneratedResponse(firstNonEmpty(run.Response, response.Text), req, system, generationReq.Prompt)
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(response.Model, generationReq.Model)
		run.ToolProposals = proposals
		run.EgressRecordID = record.ID
	})
	if req.Action == AIChatActionBuild {
		if finalResponse, err := s.GetChatRun(project.ID, runID); err == nil {
			if diff, ok := extractGitDiffPatch(finalResponse.Response); ok {
				if _, previewErr := s.PreviewPatch(project.ID, AIPatchPreviewRequest{
					RunID:       runID,
					Title:       "AI patch preview",
					Summary:     "Generated by Build mode; review before applying.",
					UnifiedDiff: diff,
				}); previewErr == nil {
					s.emitRunEnvelope(project.ID, runID)
				}
			}
		}
	}
	s.emitRunEnvelope(project.ID, runID)
	if project.Mnemonic != nil && project.Mnemonic.Enabled() {
		if ctx.Err() == nil && s.projectIsCurrent(projectID, project) {
			entry, _ := project.Mnemonic.Save(mnemonic.Entry{
				Type:       "chat_summary",
				Source:     "ai-chat",
				Tags:       []string{string(req.Action)},
				Content:    summarizeForMnemonic(req.Prompt, cleanChatGeneratedResponse(response.Text, req, system, generationReq.Prompt)),
				Importance: 5,
				Trust:      mnemonic.TrustGenerated,
				Provenance: map[string]string{"source": "ai-chat-summary", "runId": runID},
			})
			s.recordChatRunArtifact(project, runID, AIChatRunArtifactMemory, "Mnemonic update", "Generated chat summary saved to Mnemonic", map[string]string{
				"id":     entry.ID,
				"type":   entry.Type,
				"source": entry.Source,
				"trust":  string(entry.Trust),
			})
		}
	}
	s.updateRun(runID, func(run *AIChatRun) {
		run.Status = "completed"
		run.CanCancel = false
		run.Response = cleanChatGeneratedResponse(firstNonEmpty(run.Response, response.Text), req, system, generationReq.Prompt)
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(response.Model, generationReq.Model)
		run.ToolProposals = proposals
		run.EgressRecordID = record.ID
	})
	s.emitRunEnvelope(project.ID, runID)
	if run, err := s.GetChatRun(projectID, runID); err == nil {
		s.persistChatRun(run)
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
	run := s.runs[runID]
	if run == nil {
		s.mu.Unlock()
		return
	}
	update(run)
	run.Revision++
	run.UpdatedAt = utcNow()
	s.mu.Unlock()
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
	run.Response = cleanGeneratedResponse(run.Response)
	run.CanCancel = false
	run.Revision++
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	s.persistChatRun(runCopy)
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
	run.Response = cleanGeneratedResponse(run.Response)
	run.CanCancel = false
	run.EgressRecordID = record.ID
	run.Revision++
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	s.persistChatRun(runCopy)
	if shouldEmit {
		s.emitEvent("ai:chat:run-canceled", runCopy)
	}
	s.emitRunEnvelope(runCopy.ProjectSessionID, runID)
}

func (s *Service) finishRunCompleted(runID string, response string) {
	s.mu.Lock()
	run := s.runs[runID]
	if run == nil || run.Status == "canceled" {
		delete(s.runCancels, runID)
		s.mu.Unlock()
		return
	}
	run.Status = "completed"
	run.Response = cleanGeneratedResponse(response)
	run.CanCancel = false
	run.Revision++
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	s.persistChatRun(runCopy)
	s.emitRunEnvelope(runCopy.ProjectSessionID, runID)
	s.emitEvent("ai:chat:run-completed", runCopy)
}

func (s *Service) persistChatRun(run AIChatRun) {
	project := s.project(run.ProjectSessionID)
	if project == nil || project.ChatHistory == nil {
		return
	}
	run.SessionID = normalizeChatSessionID(run.SessionID)
	_ = project.ChatHistory.Upsert(run)
}

func contextArtifactSummary(summary AIContextSummary) string {
	parts := []string{
		fmt.Sprintf("%d snippets", summary.SnippetCount),
		fmt.Sprintf("%d bytes", summary.ByteSize),
	}
	if summary.MnemonicCount > 0 {
		parts = append(parts, fmt.Sprintf("%d mnemonic", summary.MnemonicCount))
	}
	if summary.SkillCount > 0 {
		parts = append(parts, fmt.Sprintf("%d skills", summary.SkillCount))
	}
	if summary.MCPIncluded {
		parts = append(parts, "MCP metadata")
	}
	if summary.Redaction.SecretsRedacted > 0 || summary.Redaction.PathsRedacted > 0 {
		parts = append(parts, "redacted")
	}
	if summary.Redaction.Truncated {
		parts = append(parts, "truncated")
	}
	return strings.Join(parts, ", ")
}

func egressArtifactSummary(record AIEgressRecord) string {
	parts := []string{record.Status}
	if record.ProviderID != "" {
		parts = append(parts, record.ProviderID)
	}
	if record.Model != "" {
		parts = append(parts, record.Model)
	}
	if record.Canceled {
		parts = append(parts, "canceled")
	}
	if record.ErrorClass != "" {
		parts = append(parts, record.ErrorClass)
	}
	return strings.Join(parts, ", ")
}

func toolProposalArtifactSummary(proposals []AIToolProposal) string {
	if len(proposals) == 0 {
		return "no proposals"
	}
	summary := summarizeToolProposals(proposals)
	parts := []string{fmt.Sprintf("%d proposed", summary.Total)}
	if summary.AllowedByPolicy > 0 {
		parts = append(parts, fmt.Sprintf("%d allowed by policy", summary.AllowedByPolicy))
	}
	if summary.HardDenied > 0 {
		parts = append(parts, fmt.Sprintf("%d hard denied", summary.HardDenied))
	}
	if summary.NotExecutableInSlice > 0 {
		parts = append(parts, "preview only")
	}
	return strings.Join(parts, ", ")
}

func validChatAction(action AIChatAction) bool {
	switch action {
	case AIChatActionAsk, AIChatActionDebug, AIChatActionPlan, AIChatActionBuild:
		return true
	default:
		return false
	}
}

func (s *Service) resolveChatRunRequest(req AIChatRunRequest) AIChatRunRequest {
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.WorkflowID = strings.TrimSpace(req.WorkflowID)
	req.ProfileID = strings.TrimSpace(req.ProfileID)
	for _, workflow := range s.ListPromptWorkflows() {
		if req.WorkflowID != "" && workflow.ID == req.WorkflowID {
			req.Action = workflow.Action
			req.ProfileID = firstNonEmpty(req.ProfileID, workflow.ProfileID)
			break
		}
		if workflow.Slash != "" && strings.HasPrefix(req.Prompt, workflow.Slash) {
			req.WorkflowID = workflow.ID
			req.Action = workflow.Action
			req.ProfileID = firstNonEmpty(req.ProfileID, workflow.ProfileID)
			req.Prompt = strings.TrimSpace(strings.TrimPrefix(req.Prompt, workflow.Slash))
			break
		}
	}
	if req.Action == "" {
		req.Action = AIChatActionPlan
	}
	req.ProfileID = firstNonEmpty(req.ProfileID, defaultProfileForAction(req.Action))
	return req
}

func defaultProfileForAction(action AIChatAction) string {
	switch action {
	case AIChatActionAsk:
		return "ask-readonly"
	case AIChatActionDebug:
		return "debug-operator"
	case AIChatActionBuild:
		return "build-reviewer"
	default:
		return "plan-architect"
	}
}

func chatModeBoundaryPrompt(req AIChatRunRequest) string {
	switch req.Action {
	case AIChatActionAsk:
		return "Mode boundary: Ask is read-only. You may use only disclosed context and must not request file, terminal, MCP, or memory mutation."
	case AIChatActionPlan:
		return "Mode boundary: Plan is read-only. Produce a structured plan and do not mutate files, terminal state, MCP state, or Mnemonic."
	case AIChatActionDebug:
		return "Mode boundary: Debug may propose diagnostics or terminal checks, but every terminal or file mutation must go through approval-gated tools and visible audit."
	case AIChatActionBuild:
		return "Mode boundary: Build may produce patch artifacts and typed tool proposals. Do not apply changes directly; every mutation requires approval, checkpoint, and audit."
	default:
		return "Mode boundary: no mutation without explicit approval."
	}
}

func systemPromptForAction(action AIChatAction) string {
	common := "You are Arlecchino, the local-first codebase assistant inside the IDE. Keep the same identity across Ask, Plan, Build, and Debug modes. Match the user's language. If the user's message is only a greeting, thanks, or small talk, answer briefly and do not invent a plan, patch, diagnostic, or tool action."
	switch action {
	case AIChatActionAsk:
		return common + " In Ask mode, answer the user's question using the provided project context. Do not claim that any file, terminal, MCP, or subagent action has run."
	case AIChatActionDebug:
		return common + " In Debug mode, identify likely causes for concrete failures, ask for missing evidence only if required, and do not propose mutations as already executed."
	case AIChatActionBuild:
		return common + " In Build mode, return an implementation-oriented answer only for concrete change requests. When changing files, output a git-style unified diff starting with diff --git; Arlecchino will turn it into a reviewable patch artifact. Do not claim any file, terminal, MCP, or subagent action has run."
	default:
		return common + " In Plan mode, produce a concrete plan grounded in the provided context only when the user asks for planning or implementation direction."
	}
}

func toolProposalsForAction(action AIChatAction, approval AIApprovalSummary, projectRoot string, prompt string) []AIToolProposal {
	if action != AIChatActionBuild && action != AIChatActionDebug {
		return []AIToolProposal{}
	}
	if shouldSuppressToolProposalsForPrompt(prompt) {
		return []AIToolProposal{}
	}
	proposals := []AIToolProposal{
		{
			ID:                   "tool-proposal-context-read",
			Name:                 "read_more_context",
			Description:          "Read additional project context before continuing.",
			Policy:               AIToolPolicyReadOnly,
			Kind:                 AIToolKindContextRead,
			ScopeSummary:         "Project-local read-only context expansion.",
			RiskLevel:            AIToolRiskLow,
			ApprovalModeRequired: AIApprovalModeReadOnlyAllowed,
			Status:               AIToolProposalStatusProposed,
			ExecutionState:       AIToolExecutionStateNotExecutable,
		},
	}
	if action == AIChatActionDebug {
		proposals = append(proposals, AIToolProposal{
			ID:                   "tool-proposal-terminal-check",
			Name:                 "preview_diagnostic_command",
			Description:          "Preview a diagnostic terminal command before running tests or checks.",
			Policy:               AIToolPolicyApprovalRequired,
			Kind:                 AIToolKindTerminal,
			ScopeSummary:         "Project-scoped terminal diagnostic proposal.",
			RiskLevel:            AIToolRiskMedium,
			ApprovalModeRequired: AIApprovalModeFullAccess,
			Status:               AIToolProposalStatusProposed,
			ExecutionState:       AIToolExecutionStateNotExecutable,
		})
		for i := range proposals {
			proposals[i] = evaluateToolProposal(proposals[i], approval, projectRoot)
		}
		return proposals
	}
	proposals = append(proposals,
		AIToolProposal{
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
		mcpToolProposal("tool-proposal-mcp-surface-read", "mcp_surface_read", "Inspect visible IDE panels and surface state through MCP.", "ide_ui.surface_read"),
		mcpToolProposal("tool-proposal-mcp-open-file-panel", "mcp_open_file_panel", "Open a project file in the visible side code panel through MCP.", "ide_ui.open_file_panel"),
		mcpToolProposal("tool-proposal-mcp-open-panel", "mcp_open_panel", "Open Explorer, Git, Problems, AI Chat, terminal, code, or preview panels through MCP.", "ide_ui.open_panel"),
		mcpToolProposal("tool-proposal-mcp-move-panel", "mcp_move_panel", "Move or resize visible IDE panels through MCP.", "ide_ui.move_panel"),
		mcpToolProposal("tool-proposal-mcp-close-panel", "mcp_close_panel", "Close visible IDE panels through MCP.", "ide_ui.close_panel"),
	)
	for i := range proposals {
		proposals[i] = evaluateToolProposal(proposals[i], approval, projectRoot)
	}
	return proposals
}

func mcpToolProposal(id, name, description, toolName string) AIToolProposal {
	return AIToolProposal{
		ID:                   id,
		Name:                 name,
		Description:          description,
		Policy:               AIToolPolicyApprovalRequired,
		Kind:                 AIToolKindMCP,
		MCPToolName:          toolName,
		ScopeSummary:         "Project-scoped MCP proposal; AI backend records metadata only.",
		RiskLevel:            AIToolRiskMedium,
		ApprovalModeRequired: AIApprovalModeFullAccess,
		Status:               AIToolProposalStatusProposed,
		ExecutionState:       AIToolExecutionStateNotExecutable,
	}
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

func (s *Service) preflightChatResponseForRequest(req AIChatRunRequest) (string, bool) {
	if response, ok := s.runtimeStateResponseForChatRequest(req); ok {
		return response, true
	}
	if isModeLabelChatPrompt(req.Prompt) {
		return modeLabelChatResponse(req), true
	}
	if isAmbiguousShortChatPrompt(req.Prompt) {
		return ambiguousChatPromptResponse(req.Prompt), true
	}
	if isSmallTalkOnlyChatPrompt(req.Prompt) {
		return smallTalkChatResponse(req.Prompt), true
	}
	return "", false
}

func isSmallTalkOnlyChatPrompt(prompt string) bool {
	words := normalizedChatPromptWords(prompt)
	if len(words) == 0 {
		return true
	}
	if len(words) > 8 {
		return false
	}
	for _, word := range words {
		if !chatSmallTalkWord(word) {
			return false
		}
	}
	return true
}

func normalizeChatRunToolProposals(run AIChatRun) AIChatRun {
	if shouldSuppressToolProposalsForPrompt(run.UserPrompt) {
		run.ToolProposals = nil
	}
	return run
}

func normalizeChatRunForDisplay(run AIChatRun) AIChatRun {
	run = normalizeChatRunToolProposals(run)
	if strings.TrimSpace(run.Response) == "" {
		return run
	}
	req := AIChatRunRequest{Action: run.Action, Prompt: run.UserPrompt}
	system := systemPromptForAction(req.Action) + "\n" + chatModeBoundaryPrompt(req)
	run.Response = cleanChatGeneratedResponse(run.Response, req, system, "")
	return run
}

func shouldSuppressToolProposalsForPrompt(prompt string) bool {
	return isSmallTalkOnlyChatPrompt(prompt) || isRuntimeStateQuestion(prompt) || isModeLabelChatPrompt(prompt) || isAmbiguousShortChatPrompt(prompt)
}

func isModeLabelChatPrompt(prompt string) bool {
	words := normalizedChatPromptWords(prompt)
	if len(words) != 1 {
		return false
	}
	switch words[0] {
	case "ask", "аск", "спросить", "plan", "план", "build", "билд", "debug", "дебаг":
		return true
	default:
		return false
	}
}

func isAmbiguousShortChatPrompt(prompt string) bool {
	words := normalizedChatPromptWords(prompt)
	if len(words) == 0 {
		return true
	}
	if len(words) > 2 {
		return false
	}
	for _, word := range words {
		switch word {
		case "what", "huh", "why", "что", "чего", "че", "чё", "зачем", "почему":
			continue
		default:
			return false
		}
	}
	return true
}

func modeLabelChatResponse(req AIChatRunRequest) string {
	mode := chatActionDisplayName(req.Action)
	if containsCyrillic(req.Prompt) {
		return "Сейчас выбран режим " + mode + ". Опиши задачу, и я продолжу в этом режиме."
	}
	return "Mode " + mode + " is selected. Describe the task and I will continue in that mode."
}

func ambiguousChatPromptResponse(prompt string) string {
	if containsCyrillic(prompt) {
		return "Уточни, что нужно сделать или проверить."
	}
	return "Clarify what you want me to do or inspect."
}

func smallTalkChatResponse(prompt string) string {
	words := normalizedChatPromptWords(prompt)
	for _, word := range words {
		switch word {
		case "thanks", "thank", "спасибо":
			if containsCyrillic(prompt) {
				return "Пожалуйста."
			}
			return "You're welcome."
		}
	}
	if containsCyrillic(prompt) {
		return "Привет. Чем помочь?"
	}
	return "Hi. How can I help?"
}

func (s *Service) runtimeStateResponseForChatRequest(req AIChatRunRequest) (string, bool) {
	topics := runtimeStateTopics(req.Prompt)
	if len(topics) == 0 {
		return "", false
	}
	settings := s.currentSettings()
	russian := containsCyrillic(req.Prompt)
	parts := make([]string, 0, len(topics))
	for _, topic := range topics {
		switch topic {
		case "mode":
			mode := chatActionDisplayName(req.Action)
			if russian && len(topics) == 1 {
				return "Сейчас я работаю в режиме " + mode + ".", true
			}
			if russian {
				parts = append(parts, "режим: "+mode)
			} else {
				parts = append(parts, "mode: "+mode)
			}
		case "provider":
			provider := firstNonEmpty(req.ProviderID, settings.ActiveProviderID, "not selected")
			if russian && provider == "not selected" {
				provider = "не выбран"
			}
			if russian {
				parts = append(parts, "провайдер: "+provider)
			} else {
				parts = append(parts, "provider: "+provider)
			}
		case "model":
			model := firstNonEmpty(req.Model, settings.ActiveModel, "not selected")
			if russian && model == "not selected" {
				model = "не выбрана"
			}
			if russian {
				parts = append(parts, "модель: "+model)
			} else {
				parts = append(parts, "model: "+model)
			}
		case "profile":
			profile := firstNonEmpty(req.ProfileID, "default")
			if russian && profile == "default" {
				profile = "по умолчанию"
			}
			if russian {
				parts = append(parts, "профиль: "+profile)
			} else {
				parts = append(parts, "profile: "+profile)
			}
		}
	}
	if len(parts) == 0 {
		return "", false
	}
	if russian {
		return "Текущее состояние AI Chat: " + strings.Join(parts, "; ") + ".", true
	}
	return "Current AI Chat state: " + strings.Join(parts, "; ") + ".", true
}

func isRuntimeStateQuestion(prompt string) bool {
	return len(runtimeStateTopics(prompt)) > 0
}

func runtimeStateTopics(prompt string) []string {
	words := normalizedChatPromptWords(prompt)
	if len(words) == 0 || len(words) > 10 {
		return nil
	}
	hasStateCue := false
	topics := []string{}
	seen := map[string]bool{}
	for _, word := range words {
		if word == "mode" || strings.HasPrefix(word, "режим") {
			if !seen["mode"] {
				topics = append(topics, "mode")
				seen["mode"] = true
			}
		}
		if word == "provider" || strings.HasPrefix(word, "провайдер") {
			if !seen["provider"] {
				topics = append(topics, "provider")
				seen["provider"] = true
			}
		}
		if word == "model" || strings.HasPrefix(word, "модел") {
			if !seen["model"] {
				topics = append(topics, "model")
				seen["model"] = true
			}
		}
		if word == "profile" || strings.HasPrefix(word, "профил") {
			if !seen["profile"] {
				topics = append(topics, "profile")
				seen["profile"] = true
			}
		}
		switch word {
		case "what", "which", "current", "active", "you", "your",
			"using", "selected", "now", "каком", "какой", "какая", "какую",
			"текущий", "текущая", "активный", "активная", "сейчас", "щас",
			"сча", "ты", "тебя", "используешь", "выбран", "выбрана":
			hasStateCue = true
		}
	}
	if !hasStateCue || len(topics) == 0 {
		return nil
	}
	return topics
}

func chatActionDisplayName(action AIChatAction) string {
	switch action {
	case AIChatActionAsk:
		return "Ask"
	case AIChatActionPlan:
		return "Plan"
	case AIChatActionBuild:
		return "Build"
	case AIChatActionDebug:
		return "Debug"
	default:
		return string(action)
	}
}

func containsCyrillic(value string) bool {
	for _, r := range value {
		if unicode.In(r, unicode.Cyrillic) {
			return true
		}
	}
	return false
}

func normalizedChatPromptWords(prompt string) []string {
	prompt = strings.TrimSpace(strings.ToLower(prompt))
	if prompt == "" {
		return nil
	}
	fields := strings.FieldsFunc(prompt, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	words := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.TrimSpace(field)
		if field != "" {
			words = append(words, field)
		}
	}
	return words
}

func chatSmallTalkWord(word string) bool {
	switch word {
	case "hi", "hello", "hey", "there", "yo", "thanks", "thank", "you", "ok", "okay",
		"привет", "здравствуй", "здравствуйте", "добрый", "доброе", "день", "вечер", "утро",
		"спасибо", "как", "дела", "ок", "окей", "ладно":
		return true
	default:
		return false
	}
}

func summarizeForMnemonic(prompt string, response string) string {
	prompt = strings.TrimSpace(sanitizedDisplayText(prompt))
	response = strings.TrimSpace(cleanGeneratedResponse(response))
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

func buildChatPromptFromSnapshot(snapshot AIContextSnapshot) string {
	contextParts := []string{}
	for _, snippet := range snapshot.Snippets {
		if strings.TrimSpace(snippet.Content) == "" {
			continue
		}
		label := snippet.Type
		if snippet.Path != "" {
			label += " " + filepath.Base(snippet.Path)
		}
		contextParts = append(contextParts, label+":\n"+snippet.Content)
	}
	if snapshot.TerminalInput != "" {
		contextParts = append(contextParts, "Terminal input:\n"+snapshot.TerminalInput)
	}
	if len(snapshot.Mnemonic) > 0 {
		lines := []string{}
		for _, entry := range snapshot.Mnemonic {
			lines = append(lines, "- "+entry.Content)
		}
		contextParts = append(contextParts, "Mnemonic context:\n"+strings.Join(lines, "\n"))
	}
	if len(snapshot.Skills) > 0 {
		lines := []string{}
		for _, skill := range snapshot.Skills {
			line := "- " + skill.Name + ": " + skill.Summary
			if len(skill.OperatingReminders) > 0 {
				line += " | reminders: " + strings.Join(skill.OperatingReminders, "; ")
			}
			if len(skill.AvoidRules) > 0 {
				line += " | avoid: " + strings.Join(skill.AvoidRules, "; ")
			}
			if len(skill.ToolHints) > 0 {
				line += " | tool hints: " + strings.Join(skill.ToolHints, ", ")
			}
			lines = append(lines, line)
		}
		contextParts = append(contextParts, "Resident skill context:\n"+strings.Join(lines, "\n"))
	}
	prompt := strings.TrimSpace(snapshot.Prompt)
	if len(contextParts) == 0 {
		return prompt
	}
	parts := []string{}
	if prompt != "" {
		parts = append(parts, "Request:\n"+prompt)
	}
	parts = append(parts, contextParts...)
	return strings.Join(parts, "\n\n")
}

func sanitizedDisplayText(value string) string {
	return sanitizeChatDisplayText(value, true)
}

func sanitizedDisplayChunk(value string) string {
	return sanitizeChatDisplayText(value, false)
}

func sanitizeChatDisplayText(value string, trim bool) string {
	hadStopMarker := containsChatStopMarker(value)
	value, _ = sanitizeText(value, AIRedactionSummary{})
	value = strings.NewReplacer(
		"<|im_start|>", "\n",
		"<|im_end|>", "\n",
		"<im_start|>", "\n",
		"<im_end|>", "\n",
		"<|lim_start|>", "\n",
		"<|lim_end|>", "\n",
		"<lim_start|>", "\n",
		"<lim_end|>", "\n",
	).Replace(value)
	lines := strings.Split(value, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.EqualFold(trimmed, "user") || strings.EqualFold(trimmed, "assistant") || strings.EqualFold(trimmed, "system") || strings.EqualFold(trimmed, "intent") {
			continue
		}
		if strings.HasPrefix(strings.ToLower(trimmed), "intent:") || strings.HasPrefix(strings.ToLower(trimmed), "user intent:") {
			continue
		}
		out = append(out, line)
	}
	result := strings.Join(out, "\n")
	if hadStopMarker && strings.TrimSpace(result) == "" {
		return ""
	}
	if trim {
		return strings.TrimSpace(result)
	}
	return result
}

func defaultChatMaxTokens(action AIChatAction) int {
	switch action {
	case AIChatActionAsk:
		return 256
	case AIChatActionPlan:
		return 512
	default:
		return 768
	}
}

type chatStreamGuard struct {
	raw            strings.Builder
	text           strings.Builder
	held           strings.Builder
	released       bool
	req            AIChatRunRequest
	system         string
	providerPrompt string
}

func newChatStreamGuard(req AIChatRunRequest, system string, providerPrompt string) *chatStreamGuard {
	return &chatStreamGuard{req: req, system: system, providerPrompt: providerPrompt}
}

func (g *chatStreamGuard) Observe(rawToken string, displayToken string) (string, error) {
	if rawToken != "" {
		g.raw.WriteString(rawToken)
	}
	if displayToken != "" {
		g.text.WriteString(displayToken)
		if !g.released {
			g.held.WriteString(displayToken)
		}
	}
	if containsChatStopMarker(g.raw.String()) || shouldStopRepeatedGeneratedText(g.text.String()) {
		return "", errChatStreamStopped
	}
	if displayToken == "" {
		return "", nil
	}
	if g.released {
		return displayToken, nil
	}
	held := g.held.String()
	if isInternalPromptEcho(held, g.req, g.system, g.providerPrompt) {
		return "", errChatStreamStopped
	}
	if isPossibleInternalPromptEchoPrefix(held, g.req, g.system, g.providerPrompt) {
		return "", nil
	}
	release := held
	if stripped, ok := stripExactUserPromptEchoPrefix(release, g.req.Prompt); ok {
		release = stripped
	}
	g.released = true
	g.held.Reset()
	return release, nil
}

func (g *chatStreamGuard) Flush() string {
	if g.released {
		return ""
	}
	held := g.held.String()
	if strings.TrimSpace(held) == "" || isInternalPromptEcho(held, g.req, g.system, g.providerPrompt) || isPossibleInternalPromptEchoPrefix(held, g.req, g.system, g.providerPrompt) {
		return ""
	}
	g.released = true
	g.held.Reset()
	return held
}

func isPossibleInternalPromptEchoPrefix(value string, req AIChatRunRequest, system string, providerPrompt string) bool {
	normalized := normalizeEchoText(value)
	if normalized == "" {
		return true
	}
	if len(normalized) >= 96 {
		return false
	}
	candidates := []string{
		system,
		chatModeBoundaryPrompt(req),
		req.Prompt,
		"User intent:\n" + req.Prompt,
		"Request:\n" + req.Prompt,
	}
	providerPromptNormalized := normalizeEchoText(providerPrompt)
	if providerPromptNormalized != "" && providerPromptNormalized != normalizeEchoText(req.Prompt) {
		candidates = append(candidates, providerPrompt)
	}
	for _, internal := range candidates {
		internalNormalized := normalizeEchoText(internal)
		if internalNormalized == "" {
			continue
		}
		if strings.HasPrefix(internalNormalized, normalized) {
			return true
		}
	}
	return false
}

func containsChatStopMarker(value string) bool {
	if value == "" {
		return false
	}
	lower := strings.ToLower(value)
	for _, marker := range []string{
		"<|im_end|>",
		"<|im_start|>",
		"<im_end|>",
		"<im_start|>",
		"<|lim_end|>",
		"<|lim_start|>",
		"<lim_end|>",
		"<lim_start|>",
		"</s>",
		"\nuser:",
		"\nassistant:",
		"\nsystem:",
		"\nuser intent:",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func shouldStopRepeatedGeneratedText(value string) bool {
	segments := generatedTextSegments(value)
	last := ""
	for _, segment := range segments {
		normalized := normalizeGeneratedSegment(segment)
		if utf8.RuneCountInString(normalized) < 18 {
			continue
		}
		if normalized == last {
			return true
		}
		last = normalized
	}
	return false
}

func cleanGeneratedResponse(value string) string {
	return collapseRepeatedGeneratedSegments(sanitizedDisplayText(value))
}

func cleanChatGeneratedResponse(value string, req AIChatRunRequest, system string, providerPrompt string) string {
	cleaned := collapseRepeatedGeneratedSegments(sanitizedDisplayText(value))
	cleaned = stripInternalPromptLabelLines(cleaned)
	if stripped, ok := stripExactUserPromptEchoPrefix(cleaned, req.Prompt); ok {
		cleaned = stripped
	}
	if isInternalPromptEcho(cleaned, req, system, providerPrompt) {
		return fallbackChatResponse(req)
	}
	if strings.TrimSpace(cleaned) == "" {
		return fallbackChatResponse(req)
	}
	return cleaned
}

func stripInternalPromptLabelLines(value string) string {
	lines := strings.Split(value, "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		lower := strings.ToLower(trimmed)
		switch lower {
		case "request:", "request", "user request:", "user request", "task:", "task", "system prompt:", "system prompt", "developer prompt:", "developer prompt":
			continue
		default:
			out = append(out, line)
		}
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func stripExactUserPromptEchoPrefix(value string, prompt string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	prompt = strings.TrimSpace(prompt)
	if trimmed == "" || prompt == "" {
		return value, false
	}
	if !strings.HasPrefix(trimmed, prompt) {
		return value, false
	}
	if len(trimmed) == len(prompt) {
		return "", true
	}
	suffix := strings.TrimLeft(trimmed[len(prompt):], " \t")
	if strings.HasPrefix(suffix, "\n") || strings.HasPrefix(suffix, "\r") {
		return strings.TrimSpace(suffix), true
	}
	return value, false
}

func isInternalPromptEcho(value string, req AIChatRunRequest, system string, providerPrompt string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return true
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "mode boundary:") || strings.Contains(lower, "you are arlecchino") {
		return true
	}
	normalized := normalizeEchoText(trimmed)
	type internalEchoCandidate struct {
		text          string
		allowPrefix   bool
		minPrefixSize int
	}
	candidates := []internalEchoCandidate{
		{text: system, allowPrefix: true, minPrefixSize: 48},
		{text: chatModeBoundaryPrompt(req), allowPrefix: true, minPrefixSize: 24},
		{text: req.Prompt},
		{text: "User intent:\n" + req.Prompt, allowPrefix: true, minPrefixSize: 24},
		{text: "Request:\n" + req.Prompt, allowPrefix: true, minPrefixSize: 24},
	}
	providerPromptNormalized := normalizeEchoText(providerPrompt)
	if providerPromptNormalized != "" && providerPromptNormalized != normalizeEchoText(req.Prompt) {
		candidates = append(candidates, internalEchoCandidate{text: providerPrompt, allowPrefix: true, minPrefixSize: 48})
	}
	for _, candidate := range candidates {
		internal := strings.TrimSpace(candidate.text)
		if internal == "" {
			continue
		}
		internalNormalized := normalizeEchoText(internal)
		if internalNormalized == "" {
			continue
		}
		if normalized == internalNormalized {
			return true
		}
		if !candidate.allowPrefix {
			continue
		}
		minPrefixSize := candidate.minPrefixSize
		if minPrefixSize <= 0 {
			minPrefixSize = 48
		}
		if len(internalNormalized) >= minPrefixSize && strings.HasPrefix(internalNormalized, normalized) && len(normalized) >= minPrefixSize {
			return true
		}
		if len(internalNormalized) >= minPrefixSize && strings.HasPrefix(normalized, internalNormalized[:min(minPrefixSize, len(internalNormalized))]) {
			return true
		}
	}
	return false
}

func fallbackChatResponse(req AIChatRunRequest) string {
	if containsCyrillic(req.Prompt) {
		switch req.Action {
		case AIChatActionPlan:
			return "Уточни, какой план нужно составить."
		case AIChatActionBuild:
			return "Уточни, какое изменение нужно подготовить."
		case AIChatActionDebug:
			return "Уточни, какую проблему нужно разобрать."
		default:
			return "Уточни вопрос."
		}
	}
	switch req.Action {
	case AIChatActionPlan:
		return "Clarify what plan you want me to produce."
	case AIChatActionBuild:
		return "Clarify what change you want me to prepare."
	case AIChatActionDebug:
		return "Clarify what problem you want me to investigate."
	default:
		return "Clarify the question."
	}
}

func normalizeEchoText(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func collapseRepeatedGeneratedSegments(value string) string {
	segments := generatedTextSegments(value)
	if len(segments) <= 1 {
		return strings.TrimSpace(value)
	}
	out := make([]string, 0, len(segments))
	last := ""
	changed := false
	for _, segment := range segments {
		normalized := normalizeGeneratedSegment(segment)
		if utf8.RuneCountInString(normalized) >= 18 && normalized == last {
			changed = true
			continue
		}
		out = append(out, segment)
		if normalized != "" {
			last = normalized
		}
	}
	if !changed {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(strings.Join(out, ""))
}

func generatedTextSegments(value string) []string {
	segments := []string{}
	var current strings.Builder
	for _, r := range value {
		current.WriteRune(r)
		if r == '.' || r == '!' || r == '?' || r == '\n' || r == '。' || r == '！' || r == '？' {
			segment := strings.TrimSpace(current.String())
			if segment != "" {
				segments = append(segments, segment)
			}
			current.Reset()
		}
	}
	if tail := strings.TrimSpace(current.String()); tail != "" {
		segments = append(segments, tail)
	}
	return segments
}

func normalizeGeneratedSegment(value string) string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(value)))
	if len(fields) == 0 {
		return ""
	}
	return strings.Join(fields, "")
}
