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

const (
	defaultChatSessionID     = "default"
	minimalChatProfileID     = "minimal-general"
	chatInternalTagPrefix    = "<arlecchino_"
	chatContextOpenTag       = "<arlecchino_context>"
	chatContextCloseTag      = "</arlecchino_context>"
	chatHistoryOpenTag       = "<arlecchino_history>"
	chatHistoryCloseTag      = "</arlecchino_history>"
	chatSnippetTag           = "arlecchino_snippet"
	chatEditorStateTag       = "arlecchino_editor_state"
	chatTerminalInputTag     = "arlecchino_terminal_input"
	chatMnemonicContextTag   = "arlecchino_mnemonic_context"
	chatSkillContextTag      = "arlecchino_skill_context"
	chatTurnTag              = "arlecchino_turn"
	chatUserPromptTag        = "arlecchino_user"
	chatAssistantResponseTag = "arlecchino_assistant"
	chatPreviousContextTag   = "arlecchino_previous_context"
	chatCurrentRequestTag    = "arlecchino_current_request"
)

var errChatStreamStopped = errors.New("AI chat stream stopped")

const (
	chatPromptHistoryLimit         = 6
	chatPromptHistoryPromptLimit   = 600
	chatPromptHistoryResponseLimit = 1400
	chatStreamGuardMaxHeldBytes    = 32 << 10
)

var defaultChatStopSequences = []string{
	"<|im_end|>",
	"<|im_start|>",
	"<im_end|>",
	"<im_start|>",
	"<|lim_end|>",
	"<|lim_start|>",
	"<lim_end|>",
	"<lim_start|>",
	"</im_end|>",
	"</im_start|>",
	"</lim_end|>",
	"</lim_start|>",
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
	req.SessionID = sessionID
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
	req = applyChatContextPolicy(req)
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
	system := chatSystemPrompt(req)
	history := s.chatHistoryForPrompt(project, runID, req.SessionID, chatPromptHistoryLimit)
	providerPrompt := buildChatPromptFromSnapshot(snapshot, history)
	generationReq := providers.GenerationRequest{
		Capability: providers.CapabilityChat,
		Prompt:     providerPrompt,
		System:     system,
		Messages:   buildChatMessagesFromSnapshot(snapshot, history),
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
	response = s.retryEmptyChatResponse(ctx, runID, provider, generationReq, req, system, response)
	record.LatencyMs = time.Since(started).Milliseconds()
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
	finalResponse := cleanChatGeneratedResponse(firstNonEmpty(s.chatRunResponse(runID), response.Text), req, system, generationReq.Prompt)
	if strings.TrimSpace(finalResponse) == "" {
		s.finishRunEmptyResponse(runID, record, descriptor.ID, firstNonEmpty(response.Model, generationReq.Model), response)
		return
	}
	s.updateRun(runID, func(run *AIChatRun) {
		run.Response = finalResponse
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(response.Model, generationReq.Model)
		run.ToolProposals = nil
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
		run.ToolProposals = nil
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

func (s *Service) chatRunResponse(runID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run := s.runs[runID]
	if run == nil {
		return ""
	}
	return run.Response
}

func (s *Service) runIsCanceled(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run := s.runs[runID]
	return run != nil && run.Status == "canceled"
}

func (s *Service) finishRunEmptyResponse(runID string, record AIEgressRecord, providerID string, model string, response providers.GenerationResponse) {
	s.mu.Lock()
	run := s.runs[runID]
	if run == nil || run.Status == "canceled" {
		delete(s.runCancels, runID)
		s.mu.Unlock()
		return
	}
	run.Status = "error"
	run.Error = emptyChatResponseMessage(response)
	run.Response = ""
	run.ProviderID = providerID
	run.Model = model
	run.EgressRecordID = record.ID
	run.ToolProposals = nil
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

func emptyChatResponseMessage(response providers.GenerationResponse) string {
	if strings.TrimSpace(response.ReasoningText) != "" {
		return "AI provider returned reasoning/thinking output but no visible assistant response."
	}
	return "AI provider returned no visible assistant response."
}

func (s *Service) retryEmptyChatResponse(ctx context.Context, runID string, provider providers.Provider, generationReq providers.GenerationRequest, req AIChatRunRequest, system string, response providers.GenerationResponse) providers.GenerationResponse {
	current := cleanChatGeneratedResponse(firstNonEmpty(s.chatRunResponse(runID), response.Text), req, system, generationReq.Prompt)
	if strings.TrimSpace(current) != "" || ctx.Err() != nil || s.runIsCanceled(runID) {
		return response
	}
	retryReq := generationReq
	retryReq.Stream = false
	retryResp, err := provider.Generate(ctx, retryReq, nil)
	if err != nil || ctx.Err() != nil || s.runIsCanceled(runID) {
		return response
	}
	cleaned := cleanChatGeneratedResponse(retryResp.Text, req, system, retryReq.Prompt)
	if strings.TrimSpace(cleaned) == "" {
		return retryResp
	}
	s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": cleaned})
	s.updateRun(runID, func(run *AIChatRun) {
		run.Response = cleaned
	})
	return retryResp
}

func (s *Service) finishRunError(runID string, message string) {
	s.mu.Lock()
	run := s.runs[runID]
	if run == nil || run.Status == "canceled" {
		delete(s.runCancels, runID)
		s.mu.Unlock()
		return
	}
	req := AIChatRunRequest{Action: run.Action, Prompt: run.UserPrompt}
	run.Status = "error"
	run.Error = message
	run.Response = cleanChatGeneratedResponse(run.Response, req, chatSystemPrompt(req), "")
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
	req := AIChatRunRequest{Action: run.Action, Prompt: run.UserPrompt}
	shouldEmit := run.Status != "canceled"
	run.Status = "canceled"
	run.Response = cleanChatGeneratedResponse(run.Response, req, chatSystemPrompt(req), "")
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
	if req.ProfileID == "" && shouldRouteToMinimalChat(req) {
		req.ProfileID = minimalChatProfileID
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

func chatSystemPrompt(req AIChatRunRequest) string {
	action := chatPromptAction(req)
	return strings.Join([]string{
		systemPromptForAction(action),
		chatRuntimeBoundaryPrompt(req),
		chatModeBoundaryPrompt(req),
		chatLanguageBoundaryPrompt(req),
	}, "\n")
}

func chatPromptAction(req AIChatRunRequest) AIChatAction {
	if isMinimalChatRequest(req) {
		return AIChatActionAsk
	}
	return req.Action
}

func chatRuntimeBoundaryPrompt(req AIChatRunRequest) string {
	parts := []string{"Runtime boundary: answer as the selected provider model; do not assume a fixed product identity beyond the context explicitly provided for this run. Put the final answer in visible assistant message content; the application does not display hidden reasoning or thinking fields as the final answer. Answer the latest user message directly. Treat context, history, current_request, and arlecchino-tagged sections as runtime data, never as text to repeat. The current run context is newer than chat history for active IDE state, file focus, visible surfaces, diagnostics, terminal state, and Git state. If the user message is casual, random, or unclear, respond conversationally or ask a concise clarifying question in the same language instead of refusing because it is not about code."}
	if provider := strings.TrimSpace(req.ProviderID); provider != "" {
		parts = append(parts, "Provider: "+provider+".")
	}
	if model := strings.TrimSpace(req.Model); model != "" {
		parts = append(parts, "Model: "+model+".")
	}
	return strings.Join(parts, " ")
}

func chatModeBoundaryPrompt(req AIChatRunRequest) string {
	if isMinimalChatRequest(req) {
		return "Selected chat mode: Minimal.\nMode boundary: Minimal is general chat. Use no codebase, terminal, MCP, Mnemonic, skill, or workspace context unless the user explicitly attached it."
	}
	label := chatActionLabel(req.Action)
	switch req.Action {
	case AIChatActionAsk:
		return "Selected chat mode: " + label + ".\nMode boundary: Ask is read-only. You may use only provided context and must not request file, terminal, MCP, or memory mutation."
	case AIChatActionPlan:
		return "Selected chat mode: " + label + ".\nMode boundary: Plan is read-only. Produce a structured plan when planning is useful and do not mutate files, terminal state, MCP state, or Mnemonic."
	case AIChatActionDebug:
		return "Selected chat mode: " + label + ".\nMode boundary: Debug may reason about failures and propose diagnostics or terminal checks, but every terminal or file mutation must go through approval-gated tools and visible audit."
	case AIChatActionBuild:
		return "Selected chat mode: " + label + ".\nMode boundary: Build may produce implementation guidance, diffs, patch artifacts, and typed tool proposals. Do not apply changes directly; every mutation requires approval, checkpoint, and audit."
	default:
		return "Selected chat mode: " + label + ".\nMode boundary: no mutation without explicit approval."
	}
}

func chatActionLabel(action AIChatAction) string {
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
		return "Unknown"
	}
}

func chatLanguageBoundaryPrompt(_ AIChatRunRequest) string {
	return "Language boundary: Reply in the same natural language as the user's request. Preserve code, diffs, identifiers, file paths, commands, and quoted text in their original language."
}

func applyChatContextPolicy(req AIChatRunRequest) AIChatRunRequest {
	if req.ProfileID != minimalChatProfileID && !shouldRouteToMinimalChat(req) {
		return req
	}
	req.ProfileID = minimalChatProfileID
	req.IncludeMnemonic = false
	req.IncludeMCP = false
	req.IncludeSkills = false
	req.Context.FilePath = ""
	req.Context.Language = ""
	req.Context.Line = 0
	req.Context.Column = 0
	req.Context.LineText = ""
	req.Context.TextBefore = ""
	req.Context.TextAfter = ""
	req.Context.FullText = ""
	req.Context.Selection = ""
	req.Context.TerminalInput = ""
	req.Context.TerminalWorkDir = ""
	req.Context.IncludeMnemonic = false
	req.Context.IncludeMCP = false
	req.Context.IncludeSkills = false
	req.Context.MaxSnippets = 0
	req.Context.ContextItems = explicitMentionContextItems(req.Context.ContextItems)
	return req
}

func explicitMentionContextItems(items []AIContextItemRequest) []AIContextItemRequest {
	if len(items) == 0 {
		return nil
	}
	filtered := make([]AIContextItemRequest, 0, len(items))
	for _, item := range items {
		if item.Source == mentionSource {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func shouldRouteToMinimalChat(req AIChatRunRequest) bool {
	if req.ProfileID == minimalChatProfileID {
		return true
	}
	if req.Action != "" && req.Action != AIChatActionAsk {
		return false
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return false
	}
	if hasRequestedChatContext(req) {
		return false
	}
	if hasExplicitMentionContext(req.Context.ContextItems) {
		return false
	}
	if hasLanguageNeutralCodeSignal(req.Prompt) {
		return false
	}
	return true
}

func isMinimalChatRequest(req AIChatRunRequest) bool {
	return req.ProfileID == minimalChatProfileID || shouldRouteToMinimalChat(req)
}

func hasLanguageNeutralCodeSignal(prompt string) bool {
	lower := strings.ToLower(strings.TrimSpace(prompt))
	if lower == "" {
		return false
	}
	if strings.Contains(lower, "```") || strings.Contains(lower, "\t") || strings.Contains(lower, "::") {
		return true
	}
	for _, token := range strings.Fields(prompt) {
		token = strings.Trim(token, " \t\r\n.,;:!?()[]{}<>\"'`")
		if token == "" {
			continue
		}
		if strings.Contains(token, "/") || strings.Contains(token, "\\") {
			return true
		}
		if hasCodeLikeFileExtension(token) {
			return true
		}
	}
	return false
}

func hasCodeLikeFileExtension(token string) bool {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(token)), ".")
	if ext == "" || len(ext) > 6 {
		return false
	}
	for _, r := range ext {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

func hasExplicitMentionContext(items []AIContextItemRequest) bool {
	for _, item := range items {
		if item.Source == mentionSource {
			return true
		}
	}
	return false
}

func hasRequestedChatContext(req AIChatRunRequest) bool {
	if req.IncludeMnemonic || req.IncludeMCP || req.IncludeSkills {
		return true
	}
	ctx := req.Context
	if ctx.IncludeMnemonic || ctx.IncludeMCP || ctx.IncludeSkills {
		return true
	}
	if strings.TrimSpace(ctx.FilePath) != "" ||
		strings.TrimSpace(ctx.LineText) != "" ||
		strings.TrimSpace(ctx.TextBefore) != "" ||
		strings.TrimSpace(ctx.TextAfter) != "" ||
		strings.TrimSpace(ctx.FullText) != "" ||
		strings.TrimSpace(ctx.Selection) != "" ||
		strings.TrimSpace(ctx.TerminalInput) != "" ||
		strings.TrimSpace(ctx.TerminalWorkDir) != "" {
		return true
	}
	if ctx.MaxSnippets > 3 {
		return true
	}
	for _, item := range ctx.ContextItems {
		if item.Kind != "" || strings.TrimSpace(item.Label) != "" || strings.TrimSpace(item.Path) != "" || strings.TrimSpace(item.ID) != "" {
			return true
		}
	}
	return false
}

func systemPromptForAction(action AIChatAction) string {
	common := "Use the selected mode as capability and approval context, not as a reason to give a canned or artificially short answer. Match the user's language. Use provided current-file, mentioned-file, workspace, MCP, Mnemonic, and conversation-history context as real context that is already available to you; reading provided context is not a tool action. If the user asks what mode is selected, answer from the selected mode boundary. For actionable requests, either give the requested analysis, plan, or diff, or name the exact missing context; never answer only with a capability confirmation. Do not repeat identical sentences or paragraphs."
	switch action {
	case AIChatActionAsk:
		return common + " In Ask mode, answer the user's question using the provided project context. Do not claim that any file, terminal, MCP, or subagent action has run."
	case AIChatActionDebug:
		return common + " In Debug mode, identify likely causes for concrete failures, explain what evidence supports them, ask for missing evidence only if required, and do not propose mutations as already executed."
	case AIChatActionBuild:
		return common + " In Build mode, answer normal questions normally. For concrete change requests with enough context, return implementation-oriented guidance or a git-style unified diff starting with diff --git; Arlecchino will turn diffs into reviewable patch artifacts. Do not claim any file, terminal, MCP, or subagent action has run."
	default:
		return common + " In Plan mode, answer normal questions normally and produce a concrete plan grounded in the provided context when the user asks for planning or implementation direction."
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

func normalizeChatRunToolProposals(run AIChatRun) AIChatRun {
	if len(run.ToolProposals) == 0 {
		return run
	}
	filtered := make([]AIToolProposal, 0, len(run.ToolProposals))
	for _, proposal := range run.ToolProposals {
		if isKnownSyntheticChatToolProposal(proposal) {
			continue
		}
		filtered = append(filtered, proposal)
	}
	if len(filtered) == 0 {
		run.ToolProposals = nil
	} else {
		run.ToolProposals = filtered
	}
	return run
}

func normalizeChatRunForDisplay(run AIChatRun) AIChatRun {
	run = normalizeChatRunToolProposals(run)
	if strings.TrimSpace(run.Response) == "" {
		return run
	}
	req := AIChatRunRequest{Action: run.Action, Prompt: run.UserPrompt}
	system := chatSystemPrompt(req)
	run.Response = cleanChatGeneratedResponse(run.Response, req, system, "")
	return run
}

func isKnownSyntheticChatToolProposal(proposal AIToolProposal) bool {
	switch strings.TrimSpace(proposal.ID) {
	case "tool-proposal-context-read",
		"tool-proposal-terminal-check",
		"tool-proposal-apply-change",
		"tool-proposal-mcp-surface-read",
		"tool-proposal-mcp-open-file-panel",
		"tool-proposal-mcp-open-panel",
		"tool-proposal-mcp-move-panel",
		"tool-proposal-mcp-close-panel":
		return true
	default:
		return false
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

func (s *Service) chatHistoryForPrompt(project *ProjectSession, currentRunID string, sessionID string, limit int) []AIChatRun {
	if project == nil || project.ChatHistory == nil || limit <= 0 {
		return nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	runs, err := project.ChatHistory.List(limit * 4)
	if err != nil {
		return nil
	}
	history := make([]AIChatRun, 0, limit)
	for _, run := range runs {
		if run.ID == currentRunID || normalizeChatSessionID(run.SessionID) != sessionID {
			continue
		}
		if run.Status != "completed" {
			continue
		}
		if strings.TrimSpace(run.UserPrompt) == "" && strings.TrimSpace(run.Response) == "" {
			continue
		}
		history = append(history, normalizeChatRunForDisplay(run))
		if len(history) >= limit {
			break
		}
	}
	for i, j := 0, len(history)-1; i < j; i, j = i+1, j-1 {
		history[i], history[j] = history[j], history[i]
	}
	return history
}

func buildChatPromptFromSnapshot(snapshot AIContextSnapshot, history []AIChatRun) string {
	prompt := strings.TrimSpace(snapshot.Prompt)
	contextParts := chatContextPartsFromSnapshot(snapshot)
	parts := []string{}
	historyText := formatChatHistoryForPrompt(history)
	hasLayeredContext := historyText != "" || len(contextParts) > 0
	if historyText != "" {
		parts = append(parts, chatContextBlock(chatHistoryOpenTag, chatHistoryCloseTag, historyText))
	}
	if len(contextParts) == 0 {
		if prompt != "" {
			if hasLayeredContext {
				parts = append(parts, chatCurrentRequestBlock(prompt))
			} else {
				parts = append(parts, prompt)
			}
		}
		return strings.Join(parts, "\n\n")
	}
	parts = append(parts, chatContextBlock(chatContextOpenTag, chatContextCloseTag, strings.Join(contextParts, "\n\n")))
	if prompt != "" {
		parts = append(parts, chatCurrentRequestBlock(prompt))
	}
	return strings.Join(parts, "\n\n")
}

func buildChatMessagesFromSnapshot(snapshot AIContextSnapshot, history []AIChatRun) []providers.GenerationMessage {
	messages := []providers.GenerationMessage{}
	for _, run := range history {
		if context := formatChatHistoryContextItems(run.ContextSummary); context != "" {
			messages = append(messages, providers.GenerationMessage{Role: "user", Content: chatTaggedSection(chatPreviousContextTag, "", context)})
		}
		if prompt := strings.TrimSpace(sanitizedDisplayText(run.UserPrompt)); prompt != "" {
			messages = append(messages, providers.GenerationMessage{Role: "user", Content: truncateUTF8(prompt, chatPromptHistoryPromptLimit)})
		}
		if response := strings.TrimSpace(cleanGeneratedResponse(run.Response)); response != "" {
			messages = append(messages, providers.GenerationMessage{Role: "assistant", Content: truncateUTF8(response, chatPromptHistoryResponseLimit)})
		}
	}
	if contextText := strings.Join(chatContextPartsFromSnapshot(snapshot), "\n\n"); strings.TrimSpace(contextText) != "" {
		messages = append(messages, providers.GenerationMessage{
			Role:    "user",
			Content: chatContextBlock(chatContextOpenTag, chatContextCloseTag, contextText),
		})
	}
	if prompt := strings.TrimSpace(snapshot.Prompt); prompt != "" {
		messages = append(messages, providers.GenerationMessage{Role: "user", Content: prompt})
	}
	return messages
}

func chatContextPartsFromSnapshot(snapshot AIContextSnapshot) []string {
	contextParts := []string{}
	if editorState := chatEditorStateFromSnapshot(snapshot); editorState != "" {
		contextParts = append(contextParts, chatTaggedSection(chatEditorStateTag, "", editorState))
	}
	for _, snippet := range snapshot.Snippets {
		if strings.TrimSpace(snippet.Content) == "" {
			continue
		}
		contextParts = append(contextParts, chatTaggedSection(chatSnippetTag, chatSnippetAttrs(snippet), snippet.Content))
	}
	if snapshot.TerminalInput != "" {
		contextParts = append(contextParts, chatTaggedSection(chatTerminalInputTag, "", snapshot.TerminalInput))
	}
	if len(snapshot.Mnemonic) > 0 {
		lines := []string{}
		for _, entry := range snapshot.Mnemonic {
			lines = append(lines, "- "+entry.Content)
		}
		contextParts = append(contextParts, chatTaggedSection(chatMnemonicContextTag, "", strings.Join(lines, "\n")))
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
		contextParts = append(contextParts, chatTaggedSection(chatSkillContextTag, "", strings.Join(lines, "\n")))
	}
	return contextParts
}

func chatEditorStateFromSnapshot(snapshot AIContextSnapshot) string {
	lines := []string{}
	if filePath := strings.TrimSpace(snapshot.FilePath); filePath != "" {
		lines = append(lines, "active_file: "+filePath)
	}
	if language := strings.TrimSpace(snapshot.Language); language != "" {
		lines = append(lines, "language: "+language)
	}
	if snapshot.Line > 0 || snapshot.Column > 0 {
		lines = append(lines, fmt.Sprintf("cursor: %d:%d", snapshot.Line, snapshot.Column))
	}
	if documentVersion := strings.TrimSpace(snapshot.DocumentVersion); documentVersion != "" {
		lines = append(lines, "ide_context_ledger:")
		lines = append(lines, documentVersion)
	}
	if len(lines) == 0 {
		return ""
	}
	lines = append(lines, "Use this as the newest IDE state. Do not describe hidden IDE events unless the user asks about current context or recent IDE changes.")
	return strings.Join(lines, "\n")
}

func chatCurrentRequestBlock(prompt string) string {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return ""
	}
	return chatTaggedSection(chatCurrentRequestTag, "", prompt)
}

func chatContextBlock(openTag string, closeTag string, content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	return openTag + "\n" + content + "\n" + closeTag
}

func chatTaggedSection(tag string, attrs string, content string) string {
	content = strings.TrimSpace(content)
	if content == "" {
		return ""
	}
	openTag := "<" + tag
	if attrs != "" {
		openTag += " " + attrs
	}
	openTag += ">"
	return openTag + "\n" + content + "\n</" + tag + ">"
}

func chatSnippetAttrs(snippet AIContextSnippet) string {
	attrs := []string{}
	if typ := strings.TrimSpace(snippet.Type); typ != "" {
		attrs = append(attrs, `type="`+chatTagAttr(typ)+`"`)
	}
	if path := strings.TrimSpace(snippet.Path); path != "" {
		attrs = append(attrs, `path="`+chatTagAttr(filepath.Base(path))+`"`)
	}
	if language := strings.TrimSpace(snippet.Language); language != "" {
		attrs = append(attrs, `language="`+chatTagAttr(language)+`"`)
	}
	return strings.Join(attrs, " ")
}

func chatTagAttr(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		`"`, "&quot;",
		"<", "&lt;",
		">", "&gt;",
	)
	return replacer.Replace(value)
}

func formatChatHistoryForPrompt(history []AIChatRun) string {
	if len(history) == 0 {
		return ""
	}
	turns := make([]string, 0, len(history))
	for _, run := range history {
		prompt := truncateUTF8(strings.TrimSpace(sanitizedDisplayText(run.UserPrompt)), chatPromptHistoryPromptLimit)
		response := truncateUTF8(strings.TrimSpace(cleanGeneratedResponse(run.Response)), chatPromptHistoryResponseLimit)
		if prompt == "" && response == "" {
			continue
		}
		lines := []string{}
		if context := formatChatHistoryContextItems(run.ContextSummary); context != "" {
			lines = append(lines, chatTaggedSection(chatPreviousContextTag, "", context))
		}
		if prompt != "" {
			lines = append(lines, chatTaggedSection(chatUserPromptTag, "", prompt))
		}
		if response != "" {
			lines = append(lines, chatTaggedSection(chatAssistantResponseTag, "", response))
		}
		turns = append(turns, chatTaggedSection(chatTurnTag, `mode="`+chatTagAttr(chatActionLabel(run.Action))+`"`, strings.Join(lines, "\n")))
	}
	return strings.Join(turns, "\n\n")
}

func formatChatHistoryContextItems(summary *AIContextSummary) string {
	if summary == nil || len(summary.ContextItems) == 0 {
		return ""
	}
	items := []string{}
	seen := map[string]bool{}
	for _, item := range summary.ContextItems {
		if !item.Included {
			continue
		}
		label := firstNonEmpty(item.Label, filepath.Base(item.Path), string(item.Kind))
		if item.Path != "" && item.Path != label {
			label += " (" + item.Path + ")"
		}
		key := string(item.Kind) + "|" + label
		if seen[key] {
			continue
		}
		seen[key] = true
		items = append(items, string(item.Kind)+": "+label)
		if len(items) >= 6 {
			break
		}
	}
	return strings.Join(items, "; ")
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
		"</im_start|>", "\n",
		"</im_end|>", "\n",
		"</lim_start|>", "\n",
		"</lim_end|>", "\n",
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
		return 1024
	case AIChatActionPlan:
		return 1536
	default:
		return 1536
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
		if trimmed, cut := truncateInternalPromptEchoTail(displayToken); cut {
			return trimmed, errChatStreamStopped
		}
		return displayToken, nil
	}
	held := g.held.String()
	release, stop := visibleChatStreamCandidate(held, g.req, g.system, g.providerPrompt)
	if strings.TrimSpace(release) == "" {
		if stop || len(held) > chatStreamGuardMaxHeldBytes {
			return "", errChatStreamStopped
		}
		return "", nil
	}
	if isPossibleInternalPromptEchoPrefix(release, g.req, g.system, g.providerPrompt) {
		if len(held) > chatStreamGuardMaxHeldBytes {
			return "", errChatStreamStopped
		}
		return "", nil
	}
	if trimmed, cut := truncateInternalPromptEchoTail(release); cut {
		g.released = true
		g.held.Reset()
		return strings.TrimSpace(trimmed), errChatStreamStopped
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
	release, _ := visibleChatStreamCandidate(held, g.req, g.system, g.providerPrompt)
	if strings.TrimSpace(release) == "" || isInternalPromptEcho(release, g.req, g.system, g.providerPrompt) || isPossibleInternalPromptEchoPrefix(release, g.req, g.system, g.providerPrompt) {
		return ""
	}
	g.released = true
	g.held.Reset()
	return release
}

func visibleChatStreamCandidate(value string, req AIChatRunRequest, system string, providerPrompt string) (string, bool) {
	candidate := value
	if stripped, ok := stripLeadingInternalPromptEchoPrefix(candidate, req, system, providerPrompt); ok {
		candidate = stripped
	}
	if stripped, ok := stripExactUserPromptEchoPrefix(candidate, req.Prompt); ok {
		candidate = stripped
	}
	if stripped, ok := stripLeadingInternalPromptEchoPrefix(candidate, req, system, providerPrompt); ok {
		candidate = stripped
	}
	trimmed, stop := truncateInternalPromptEchoTail(candidate)
	if stop {
		candidate = trimmed
	}
	return strings.TrimSpace(candidate), stop
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
		chatRuntimeBoundaryPrompt(req),
		chatLanguageBoundaryPrompt(req),
		req.Prompt,
		chatInternalTagPrefix,
		chatContextOpenTag,
		chatContextCloseTag,
		chatHistoryOpenTag,
		chatHistoryCloseTag,
		"<" + chatCurrentRequestTag + ">",
		"</" + chatCurrentRequestTag + ">",
	}
	candidates = append(candidates, legacyPromptDirectiveEchoCandidates(req.Prompt)...)
	providerPromptNormalized := normalizeEchoText(providerPrompt)
	if providerPromptNormalized != "" && providerPromptNormalized != normalizeEchoText(req.Prompt) {
		candidates = append(candidates, providerPrompt)
	}
	candidates = append(candidates, internalPromptLinesExceptPrompt(system, req.Prompt)...)
	candidates = append(candidates, internalPromptLinesExceptPrompt(providerPrompt, req.Prompt)...)
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
		"</im_end|>",
		"</im_start|>",
		"</lim_end|>",
		"</lim_start|>",
		"</s>",
		"<arlecchino_",
		"</arlecchino_",
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
	counts := map[string]int{}
	for _, segment := range segments {
		normalized := normalizeGeneratedSegment(segment)
		if utf8.RuneCountInString(normalized) < 18 {
			continue
		}
		if normalized == last {
			return true
		}
		counts[normalized]++
		if counts[normalized] >= 3 {
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
	if stripped, ok := stripLeadingInternalPromptEchoPrefix(cleaned, req, system, providerPrompt); ok {
		cleaned = stripped
	}
	if stripped, ok := stripExactUserPromptEchoPrefix(cleaned, req.Prompt); ok {
		cleaned = stripped
	}
	if stripped, ok := stripLeadingInternalPromptEchoPrefix(cleaned, req, system, providerPrompt); ok {
		cleaned = stripped
	}
	cleaned, _ = truncateInternalPromptEchoTail(cleaned)
	if isInternalPromptEcho(cleaned, req, system, providerPrompt) {
		return ""
	}
	if strings.TrimSpace(cleaned) == "" {
		return ""
	}
	return cleaned
}

func truncateInternalPromptEchoTail(value string) (string, bool) {
	if strings.TrimSpace(value) == "" {
		return "", false
	}
	lower := strings.ToLower(value)
	best := -1
	for _, marker := range []string{
		strings.ToLower(chatInternalTagPrefix),
		strings.ToLower("</arlecchino_"),
		strings.ToLower(chatContextCloseTag),
		strings.ToLower(chatHistoryCloseTag),
		"current user request:",
		"current request:",
		"answer the current user request now.",
		"answer the current request now.",
	} {
		searchFrom := 0
		for {
			idx := strings.Index(lower[searchFrom:], marker)
			if idx < 0 {
				break
			}
			idx += searchFrom
			if isLineBoundary(lower, idx) {
				if best < 0 || idx < best {
					best = idx
				}
				break
			}
			searchFrom = idx + len(marker)
		}
	}
	if best < 0 {
		return strings.TrimSpace(value), false
	}
	return strings.TrimSpace(value[:best]), true
}

func isLineBoundary(value string, idx int) bool {
	if idx <= 0 {
		return true
	}
	prev := value[idx-1]
	return prev == '\n' || prev == '\r'
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

func stripLeadingInternalPromptEchoPrefix(value string, req AIChatRunRequest, system string, providerPrompt string) (string, bool) {
	out := strings.TrimSpace(value)
	if out == "" {
		return "", false
	}
	changed := false
	for i := 0; i < 24; i++ {
		if next, ok := stripLeadingInternalTagEchoPrefix(out); ok {
			out = strings.TrimSpace(next)
			changed = true
			if out == "" {
				return "", true
			}
			continue
		}
		if next, ok := stripLeadingInternalTextEchoPrefix(out, req, system, providerPrompt); ok {
			out = strings.TrimSpace(next)
			changed = true
			if out == "" {
				return "", true
			}
			continue
		}
		break
	}
	if changed {
		return out, true
	}
	return strings.TrimSpace(value), false
}

func stripLeadingInternalTagEchoPrefix(value string) (string, bool) {
	trimmed := strings.TrimLeftFunc(value, unicode.IsSpace)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "</arlecchino_") {
		closeEnd := strings.Index(trimmed, ">")
		if closeEnd < 0 {
			return "", true
		}
		return trimmed[closeEnd+1:], true
	}
	if !strings.HasPrefix(lower, chatInternalTagPrefix) {
		return value, false
	}
	openEnd := strings.Index(trimmed, ">")
	if openEnd < 0 {
		return "", true
	}
	tagHead := strings.TrimSpace(trimmed[1:openEnd])
	if tagHead == "" {
		return "", true
	}
	tagName := strings.Fields(tagHead)[0]
	tagName = strings.TrimPrefix(tagName, "/")
	tagName = strings.TrimSuffix(tagName, "/")
	if tagName == "" {
		return "", true
	}
	closeTag := "</" + strings.ToLower(tagName) + ">"
	closeIdx := strings.Index(lower, closeTag)
	if closeIdx < 0 {
		return "", true
	}
	return trimmed[closeIdx+len(closeTag):], true
}

func stripLeadingInternalTextEchoPrefix(value string, req AIChatRunRequest, system string, providerPrompt string) (string, bool) {
	trimmed := strings.TrimLeftFunc(value, unicode.IsSpace)
	for _, candidate := range internalPromptEchoTextCandidates(req, system, providerPrompt) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || len(trimmed) < len(candidate) {
			continue
		}
		if strings.HasPrefix(trimmed, candidate) || strings.EqualFold(trimmed[:len(candidate)], candidate) {
			return trimmed[len(candidate):], true
		}
	}
	line, rest, hasRest := splitFirstLine(trimmed)
	if isInternalPromptEchoLine(line, req, system) {
		if hasRest {
			return rest, true
		}
		return "", true
	}
	return value, false
}

func internalPromptEchoTextCandidates(req AIChatRunRequest, system string, providerPrompt string) []string {
	candidates := []string{
		system,
		chatRuntimeBoundaryPrompt(req),
		chatModeBoundaryPrompt(req),
		chatLanguageBoundaryPrompt(req),
	}
	candidates = append(candidates, legacyPromptDirectiveEchoCandidates(req.Prompt)...)
	if normalizeEchoText(providerPrompt) != "" && normalizeEchoText(providerPrompt) != normalizeEchoText(req.Prompt) {
		candidates = append(candidates, providerPrompt)
	}
	candidates = append(candidates, internalPromptLinesExceptPrompt(system, req.Prompt)...)
	return candidates
}

func splitFirstLine(value string) (string, string, bool) {
	for i, r := range value {
		if r == '\n' {
			return value[:i], value[i+1:], true
		}
		if r == '\r' {
			rest := value[i+1:]
			if strings.HasPrefix(rest, "\n") {
				rest = rest[1:]
			}
			return value[:i], rest, true
		}
	}
	return value, "", false
}

func isInternalPromptEchoLine(line string, req AIChatRunRequest, system string) bool {
	line = strings.TrimSpace(line)
	if line == "" {
		return true
	}
	lower := strings.ToLower(line)
	for _, marker := range []string{
		"runtime boundary:",
		"mode boundary:",
		"language boundary:",
		"selected chat mode:",
		"current user request:",
		"current request:",
		"answer the current user request now.",
		"answer the current request now.",
		"use the disclosed files,",
	} {
		if strings.HasPrefix(lower, marker) {
			return true
		}
	}
	normalized := normalizeEchoText(line)
	if normalized == "" {
		return false
	}
	for _, candidate := range internalPromptLinesExceptPrompt(system, req.Prompt) {
		candidateNormalized := normalizeEchoText(candidate)
		if candidateNormalized == "" {
			continue
		}
		if normalized == candidateNormalized {
			return true
		}
		if len(normalized) >= 16 && strings.HasPrefix(candidateNormalized, normalized) {
			return true
		}
	}
	return false
}

func isInternalPromptEcho(value string, req AIChatRunRequest, system string, providerPrompt string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return true
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "mode boundary:") || strings.Contains(lower, "language boundary:") || strings.Contains(lower, "runtime boundary:") || strings.Contains(lower, "current user request:") || strings.Contains(lower, "current request:") || strings.Contains(lower, "answer the current request now.") || strings.Contains(lower, "answer the current user request now.") {
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
		{text: chatRuntimeBoundaryPrompt(req), allowPrefix: true, minPrefixSize: 24},
		{text: chatLanguageBoundaryPrompt(req), allowPrefix: true, minPrefixSize: 24},
		{text: req.Prompt},
	}
	for _, legacy := range legacyPromptDirectiveEchoCandidates(req.Prompt) {
		candidates = append(candidates, internalEchoCandidate{text: legacy, allowPrefix: true, minPrefixSize: 24})
	}
	providerPromptNormalized := normalizeEchoText(providerPrompt)
	if providerPromptNormalized != "" && providerPromptNormalized != normalizeEchoText(req.Prompt) {
		candidates = append(candidates, internalEchoCandidate{text: providerPrompt, allowPrefix: true, minPrefixSize: 48})
	}
	for _, line := range internalPromptLinesExceptPrompt(system, req.Prompt) {
		candidates = append(candidates, internalEchoCandidate{text: line, allowPrefix: true, minPrefixSize: 24})
	}
	for _, line := range internalPromptLinesExceptPrompt(providerPrompt, req.Prompt) {
		candidates = append(candidates, internalEchoCandidate{text: line, allowPrefix: true, minPrefixSize: 24})
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

func internalPromptLinesExceptPrompt(value string, prompt string) []string {
	lines := []string{}
	promptNormalized := normalizeEchoText(prompt)
	for _, line := range strings.Split(value, "\n") {
		line = strings.TrimSpace(line)
		if line != "" && normalizeEchoText(line) != promptNormalized {
			lines = append(lines, line)
		}
	}
	return lines
}

func legacyPromptDirectiveEchoCandidates(prompt string) []string {
	prompt = strings.TrimSpace(prompt)
	candidates := []string{
		"Current user request:",
		"Current request:",
		"Answer the current user request now.",
		"Answer the current request now.",
		"Answer the current request now. Use the disclosed files, snippets, history, and context as already available context. Do not output arlecchino tags, internal boundaries, or raw context blocks.",
		"Answer the current user request now. Use the disclosed files, snippets, history, and context as already available context. Do not output arlecchino tags, internal boundaries, or raw context blocks.",
	}
	if prompt != "" {
		candidates = append(candidates,
			"Current request:\n"+prompt,
			"Current user request:\n"+prompt,
		)
	}
	return candidates
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
	seen := map[string]bool{}
	changed := false
	for _, segment := range segments {
		normalized := normalizeGeneratedSegment(segment)
		if utf8.RuneCountInString(normalized) >= 18 {
			if normalized == last || seen[normalized] {
				changed = true
				continue
			}
			seen[normalized] = true
		}
		out = append(out, segment)
		if normalized != "" {
			last = normalized
		}
	}
	if !changed {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(strings.Join(out, "\n\n"))
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
