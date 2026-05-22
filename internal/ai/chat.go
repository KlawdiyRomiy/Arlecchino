package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"arlecchino/internal/ai/agents"
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
	maxChatToolContinuationRounds  = 3
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
		RuntimeFamily:     req.RuntimeFamily,
		ProviderID:        req.ProviderID,
		Model:             req.Model,
		ReasoningEffort:   req.ReasoningEffort,
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
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runCopy.ID,
		SessionID:        normalizeChatSessionID(runCopy.SessionID),
		ProjectSessionID: project.ID,
		Source:           "chat_runtime",
		Type:             "run_started",
		Status:           runCopy.Status,
		Actor:            "user",
		ProviderID:       runCopy.ProviderID,
		Model:            runCopy.Model,
		Capability:       providers.CapabilityChat,
		Summary:          string(runCopy.Action) + " run started",
	})
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
	if project := s.project(runCopy.ProjectSessionID); project != nil {
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runCopy.ID,
			SessionID:        normalizeChatSessionID(runCopy.SessionID),
			ProjectSessionID: runCopy.ProjectSessionID,
			Source:           "chat_runtime",
			Type:             "run_canceled",
			Status:           "canceled",
			Actor:            "user",
			ProviderID:       runCopy.ProviderID,
			Model:            runCopy.Model,
			Capability:       providers.CapabilityChat,
			Summary:          "Run canceled by user.",
		})
	}
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
	s.updateRun(runID, func(run *AIChatRun) {
		run.MnemonicRequested = req.IncludeMnemonic || req.Context.IncludeMnemonic
	})
	req.Context.Capability = providers.CapabilityChat
	req.Context.Prompt = req.Prompt
	req.Context.IncludeMnemonic = req.IncludeMnemonic
	req.Context.IncludeMCP = req.IncludeMCP || req.Context.IncludeMCP
	req.Context.IncludeSkills = req.IncludeSkills || req.Context.IncludeSkills
	snapshot := s.buildContextSnapshot(project, req.Context)
	contextSummary := summarizeContextSnapshot(snapshot)
	s.recordContextPlaneTimeline(project, runID, req, contextSummary)
	s.updateRun(runID, func(run *AIChatRun) {
		run.ContextSummary = &contextSummary
	})
	s.emitEvent("ai:chat:context-ready", map[string]any{"runId": runID, "contextSummary": contextSummary})
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "context",
		Type:             "context_ready",
		Status:           "ready",
		Actor:            "system",
		Capability:       providers.CapabilityChat,
		DataCategories:   contextSummary.DataCategories,
		Redaction:        contextSummary.Redaction,
		Summary:          contextArtifactSummary(contextSummary),
	})
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactContext, "Context disclosure", contextArtifactSummary(contextSummary), snapshot)
	s.emitRunEnvelope(project.ID, runID)

	if isExternalAgentRuntimeFamily(req.RuntimeFamily) || strings.HasPrefix(strings.TrimSpace(req.ProviderID), "agent-cli-") {
		if contextSummary.MCPContext != nil {
			s.recordRunTimeline(project, AIRunTimelineEvent{
				RunID:            runID,
				SessionID:        normalizeChatSessionID(req.SessionID),
				ProjectSessionID: project.ID,
				Source:           "mcp_context",
				Type:             "mcp_tools_degraded",
				Status:           "degraded",
				Actor:            "system",
				Capability:       providers.CapabilityChat,
				Summary:          "MCP metadata is available; external runtime tool bridge is not enabled.",
			})
		}
		adapter, descriptor, ok := s.resolveAgentAdapter(ctx, req.ProviderID)
		if !ok {
			s.finishRunError(runID, fmt.Sprintf("external agent runtime %q is not available", req.ProviderID))
			return
		}
		if !normalizeConsentPolicy(s.currentSettings().ConsentPolicy).ExternalAgentCLIAccepted {
			s.blockExternalAgentConsent(project, runID, req, snapshot, descriptor)
			return
		}
		modelID, reasoningEffort, err := resolveExternalAgentAccountSelection(req, descriptor)
		if err != nil {
			s.finishRunError(runID, err.Error())
			return
		}
		req.Model = modelID
		req.ReasoningEffort = reasoningEffort
		s.runExternalAgentChat(ctx, project, runID, req, snapshot, contextSummary, adapter, descriptor)
		return
	}

	provider, descriptor, err := s.resolveProvider(req.ProviderID)
	if err != nil {
		s.finishRunError(runID, err.Error())
		return
	}
	if !capabilityAllowed(descriptor.Capabilities, providers.CapabilityChat) {
		s.finishRunError(runID, fmt.Sprintf("provider %s does not support %s", descriptor.ID, providers.CapabilityChat))
		return
	}
	modelRuntimeFamily := modelRuntimeFamilyForDescriptor(req.RuntimeFamily, descriptor)
	s.updateRun(runID, func(run *AIChatRun) {
		run.RuntimeFamily = modelRuntimeFamily
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
		run.ReasoningEffort = req.ReasoningEffort
		run.AgentRuntime = newAIRuntimeProofSummary(descriptor, modelRuntimeFamily, agents.TransportModelAPI, run.Model, req.Action, "running", req.ReasoningEffort)
		run.AgentRuntime.PreflightStatus = "provider_resolved"
		run.AgentRuntime.ConsentStatus = "accepted"
	})
	s.emitRunEnvelope(project.ID, runID)
	system := chatSystemPrompt(req)
	history := s.chatHistoryForPrompt(project, runID, req.SessionID, chatPromptHistoryLimit)
	providerPrompt := buildChatPromptFromSnapshot(snapshot, history)
	generationReq := providers.GenerationRequest{
		Capability:      providers.CapabilityChat,
		Prompt:          providerPrompt,
		System:          system,
		Messages:        buildChatMessagesFromSnapshot(snapshot, history),
		Model:           firstNonEmpty(req.Model, descriptor.DefaultModel),
		ReasoningEffort: req.ReasoningEffort,
		MaxTokens:       req.MaxTokens,
		Stop:            defaultChatStopSequences,
		Stream:          true,
	}
	toolset := generationToolsetForChatRequest(req, descriptor, generationReq.Model)
	if probe, ok := cachedProjectModelCapabilityProbe(project, descriptor.ID, generationReq.Model); ok && shouldBlockBuildForModelProbe(probe) && req.Action == AIChatActionBuild {
		s.finishRunError(runID, fmt.Sprintf("model %s on provider %s failed the live tool capability probe: %s", generationReq.Model, descriptor.ID, firstNonEmpty(probe.Error, probe.Status)))
		return
	}
	if req.Action == AIChatActionBuild && !toolset.ToolSupport {
		s.finishRunError(runID, fmt.Sprintf("model %s on provider %s does not support agent tools required for Build mode; switch to a tool-capable local model such as qwen2.5-coder or use Ask/Plan mode", generationReq.Model, descriptor.ID))
		return
	}
	if req.Action == AIChatActionBuild {
		if err := s.ensureBuildToolCapability(ctx, project, descriptor, generationReq.Model, toolset); err != nil {
			s.finishRunError(runID, err.Error())
			return
		}
	}
	generationReq.Tools = toolset.Tools
	if len(generationReq.Tools) > 0 {
		generationReq.ToolChoice = "auto"
		generationReq.Stream = false
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
		ReasoningEffort:  generationReq.ReasoningEffort,
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
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "provider",
		Type:             "provider_request",
		Status:           "started",
		Actor:            "model",
		ProviderID:       descriptor.ID,
		Model:            generationReq.Model,
		CorrelationID:    requestID,
		Capability:       providers.CapabilityChat,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Summary:          "Provider request started.",
	})
	var streamGuard *chatStreamGuard
	var tokenSink providers.TokenSink
	releaseBufferedProviderResponse := false
	if generationReq.Stream {
		streamGuard = newChatStreamGuard(req, system, generationReq.Prompt)
		tokenSink = func(token string) error {
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
		}
	} else if len(generationReq.Tools) > 0 {
		releaseBufferedProviderResponse = true
		tokenSink = func(token string) error {
			if ctx.Err() != nil || s.runIsCanceled(runID) {
				return context.Canceled
			}
			return nil
		}
	}
	response, err := provider.Generate(ctx, generationReq, tokenSink)
	if streamGuard != nil {
		if releaseToken := streamGuard.Flush(); releaseToken != "" {
			s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": releaseToken})
			s.updateRun(runID, func(run *AIChatRun) {
				run.Response += releaseToken
			})
		}
	}
	record.LatencyMs = time.Since(started).Milliseconds()
	if ctx.Err() != nil || s.runIsCanceled(runID) {
		record.Status = "canceled"
		record.Canceled = true
		applyGenerationUsageToEgress(&record, generationReq, response, descriptor, toolset)
		if project.Egress != nil {
			stored, ledgerErr := project.Egress.Append(record)
			if ledgerErr == nil {
				record = stored
			}
		}
		s.emitEvent("ai:chat:egress-recorded", record)
		s.recordEgressTimeline(project, runID, record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "canceled"
				run.AgentRuntime.HealthStatus = "canceled"
				run.AgentRuntime.ProofState = "canceled"
				run.AgentRuntime.FailureCode = agents.FailureCanceled
			}
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
		applyGenerationUsageToEgress(&record, generationReq, response, descriptor, toolset)
		if project.Egress != nil {
			stored, ledgerErr := project.Egress.Append(record)
			if ledgerErr == nil {
				record = stored
			}
		}
		s.emitEvent("ai:chat:egress-recorded", record)
		s.recordEgressTimeline(project, runID, record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "error"
				run.AgentRuntime.HealthStatus = "error"
				run.AgentRuntime.ProofState = "error"
				run.AgentRuntime.FailureCode = record.ErrorClass
				run.AgentRuntime.BlockedReason = err.Error()
			}
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
	applyGenerationUsageToEgress(&record, generationReq, response, descriptor, toolset)
	if project.Egress != nil {
		stored, ledgerErr := project.Egress.Append(record)
		if ledgerErr == nil {
			record = stored
		}
	}
	s.emitEvent("ai:chat:egress-recorded", record)
	s.recordEgressTimeline(project, runID, record)
	s.updateRun(runID, func(run *AIChatRun) {
		run.EgressRecordID = record.ID
		if run.AgentRuntime != nil {
			run.AgentRuntime.HealthStatus = "provider_response_received"
			if strings.TrimSpace(run.AgentRuntime.ProofState) == "" || run.AgentRuntime.ProofState == "starting" {
				run.AgentRuntime.ProofState = "running"
			}
		}
	})
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "Provider egress", egressArtifactSummary(record), record)
	s.emitRunEnvelope(project.ID, runID)
	finalResponse := cleanChatGeneratedResponse(firstNonEmpty(s.chatRunResponse(runID), response.Text), req, system, generationReq.Prompt)
	finalResponse, fencedToolCallRequests := extractChatToolCallRequests(finalResponse)
	modelToolResponse := finalResponse
	buildPatchArtifactReady := false
	toolCallRequests := chatToolCallRequestsFromGenerationResponse(response)
	fencedStartIndex := len(toolCallRequests)
	for index, toolReq := range fencedToolCallRequests {
		toolCallRequests = append(toolCallRequests, chatToolCallRequestFromToolRequest(toolReq, fencedStartIndex+index))
	}
	fallbackEditUsed := false
	if len(toolCallRequests) == 0 {
		fallback := s.resolveBuildEditFallback(project, runID, req, snapshot, finalResponse)
		if fallback.Attempted {
			releaseBufferedProviderResponse = false
			s.clearChatRunResponse(project.ID, runID)
			if fallback.Err != nil {
				s.finishRunError(runID, fallback.Err.Error())
				return
			}
			if len(fallback.Calls) > 0 {
				toolCallRequests = fallback.Calls
				fallbackEditUsed = true
				finalResponse = firstNonEmpty(fallback.Message, "Prepared fallback edit preview.")
				response.Text = finalResponse
				modelToolResponse = finalResponse
			}
		}
	}
	if rewriteGuard, ok := detectBuildRewriteGuard(req, finalResponse, len(toolCallRequests) > 0); ok {
		releaseBufferedProviderResponse = false
		s.clearChatRunResponse(project.ID, runID)
		s.recordBuildRewriteGuardArtifact(project, runID, rewriteGuard)
		s.emitRunEnvelope(project.ID, runID)
		outcome := s.retryBuildRunAfterRewriteGuard(ctx, project, runID, req, provider, descriptor, generationReq, snapshot, system, finalResponse, rewriteGuard)
		if outcome.Canceled || outcome.Failed {
			return
		}
		if outcome.Record.ID != "" {
			record = outcome.Record
		}
		if outcome.ArtifactReady {
			buildPatchArtifactReady = true
		}
		if outcome.Completed && strings.TrimSpace(outcome.Text) != "" {
			response = outcome.Response
			finalResponse = outcome.Text
			modelToolResponse = finalResponse
			toolCallRequests = nil
		} else {
			s.finishRunError(runID, buildRewriteGuardProtocolError(rewriteGuard))
			return
		}
	}
	if strings.TrimSpace(finalResponse) == "" && len(toolCallRequests) > 0 {
		finalResponse = "Prepared tool results for review."
	}
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
	if releaseBufferedProviderResponse && len(toolCallRequests) == 0 {
		s.emitBufferedChatResponseToken(runID, finalResponse)
	}
	executedToolCalls := []chatExecutedToolCall{}
	if chatActionUsesToolLoop(req.Action) {
		executedToolCalls = s.executeChatToolCalls(ctx, project, runID, req, toolCallRequests)
		if req.Action == AIChatActionBuild {
			if finalResponse, err := s.GetChatRun(project.ID, runID); err == nil {
				if diff, ok := extractGitDiffPatch(finalResponse.Response); ok {
					if _, previewErr := s.PreviewPatch(project.ID, AIPatchPreviewRequest{
						RunID:       runID,
						Title:       "AI patch preview",
						Summary:     "Generated by Build mode; review before applying.",
						UnifiedDiff: diff,
					}); previewErr == nil {
						buildPatchArtifactReady = true
						s.emitRunEnvelope(project.ID, runID)
					}
				}
			}
		}
		if readyMessage, ok := completedReviewArtifactToolMessage(executedToolCalls); ok {
			buildPatchArtifactReady = true
			finalResponse = readyMessage
			s.updateRun(runID, func(run *AIChatRun) {
				run.Response = finalResponse
				run.ProviderID = descriptor.ID
				run.Model = firstNonEmpty(response.Model, generationReq.Model)
				run.ToolProposals = nil
				run.EgressRecordID = record.ID
			})
			s.emitRunEnvelope(project.ID, runID)
		} else if len(executedToolCalls) > 0 {
			if fallbackEditUsed {
				s.finishRunError(runID, fallbackEditToolFailureMessage(executedToolCalls))
				return
			}
			outcome := s.continueChatRunAfterToolResults(ctx, project, runID, req, provider, descriptor, generationReq, snapshot, system, modelToolResponse, executedToolCalls)
			if outcome.Canceled || outcome.Failed {
				return
			}
			if outcome.Record.ID != "" {
				record = outcome.Record
			}
			if outcome.ArtifactReady {
				buildPatchArtifactReady = true
			}
			if outcome.Completed && strings.TrimSpace(outcome.Text) != "" {
				response = outcome.Response
				finalResponse = outcome.Text
				s.updateRun(runID, func(run *AIChatRun) {
					run.Response = finalResponse
					run.ProviderID = descriptor.ID
					run.Model = firstNonEmpty(response.Model, generationReq.Model)
					run.ToolProposals = nil
					run.EgressRecordID = record.ID
				})
				s.emitRunEnvelope(project.ID, runID)
			}
		}
	}
	if req.Action == AIChatActionBuild && !buildPatchArtifactReady {
		buildPatchArtifactReady = s.buildRunHasReviewablePatchArtifact(project, runID)
	}
	if req.Action == AIChatActionBuild && !buildPatchArtifactReady && buildResponseClaimsReviewablePatchArtifact(finalResponse) {
		s.updateRun(runID, func(run *AIChatRun) {
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.HealthStatus = "blocked"
				run.AgentRuntime.ProofState = "blocked"
				run.AgentRuntime.ArtifactState = "missing"
				run.AgentRuntime.FailureCode = agents.FailureBuildArtifactMissing
				run.AgentRuntime.BlockedReason = "Build mode completed without a reviewable patch artifact or accepted no-change evidence"
			}
		})
		s.finishRunError(runID, "Build mode completed without a reviewable patch artifact or accepted no-change evidence")
		return
	}
	s.emitRunEnvelope(project.ID, runID)
	if project.Mnemonic != nil && project.Mnemonic.Enabled() {
		if ctx.Err() == nil && s.projectIsCurrent(projectID, project) {
			_, _ = s.ProposeMnemonicEntry(project.ID, AIMnemonicWriteProposalRequest{
				RunID: runID,
				Entry: AIMnemonicEntryInput{
					Type:       "chat_summary",
					Source:     "ai-chat",
					Tags:       []string{string(req.Action)},
					Content:    summarizeForMnemonic(req.Prompt, cleanChatGeneratedResponse(finalResponse, req, system, generationReq.Prompt)),
					Importance: 5,
					Trust:      mnemonic.TrustGenerated,
					Provenance: map[string]string{"source": "ai-chat-summary", "runId": runID},
				},
				Reason: "Generated chat summary requires review before durable Mnemonic promotion.",
			})
		}
	}
	completionSessionID := normalizeChatSessionID("")
	if currentRun, err := s.GetChatRun(projectID, runID); err == nil {
		completionSessionID = normalizeChatSessionID(currentRun.SessionID)
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        completionSessionID,
		ProjectSessionID: project.ID,
		Source:           "chat_runtime",
		Type:             "run_completed",
		Status:           "completed",
		Actor:            "system",
		ProviderID:       descriptor.ID,
		Model:            firstNonEmpty(response.Model, generationReq.Model),
		Capability:       providers.CapabilityChat,
		Summary:          "Run completed.",
	})
	s.updateRun(runID, func(run *AIChatRun) {
		run.Status = "completed"
		run.CanCancel = false
		run.Response = cleanChatGeneratedResponse(firstNonEmpty(run.Response, response.Text), req, system, generationReq.Prompt)
		run.RuntimeFamily = modelRuntimeFamily
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(response.Model, generationReq.Model)
		run.ToolProposals = nil
		run.EgressRecordID = record.ID
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "completed"
			run.AgentRuntime.HealthStatus = "completed"
			if req.Action == AIChatActionBuild && buildPatchArtifactReady {
				run.AgentRuntime.ProofState = "proved"
				run.AgentRuntime.ProofReason = "model runtime completed through Arlecchino-owned tool and artifact path"
				run.AgentRuntime.ArtifactState = "patch_artifact"
			} else if req.Action == AIChatActionBuild {
				run.AgentRuntime.ProofState = "completed"
				run.AgentRuntime.ProofReason = "model runtime completed without a reviewable patch artifact; no file change was recorded"
				run.AgentRuntime.ArtifactState = "no_patch_artifact"
			} else {
				run.AgentRuntime.ProofState = "proved"
				run.AgentRuntime.ProofReason = "model runtime completed without requiring a build artifact"
				run.AgentRuntime.ArtifactState = "not_required"
			}
		}
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

func chatActionUsesToolLoop(action AIChatAction) bool {
	return action == AIChatActionBuild || action == AIChatActionPlan || action == AIChatActionDebug
}

func modelRuntimeFamilyForDescriptor(requested string, descriptor AIProviderDescriptor) string {
	switch strings.TrimSpace(requested) {
	case agents.RuntimeFamilyModelAgent:
		return agents.RuntimeFamilyModelAgent
	case agents.TransportModelAPI:
		return agents.RuntimeFamilyModelAgent
	}
	switch strings.TrimSpace(descriptor.RuntimeFamily) {
	case agents.RuntimeFamilyModelAgent:
		return agents.RuntimeFamilyModelAgent
	case agents.TransportModelAPI:
		return agents.RuntimeFamilyModelAgent
	}
	return agents.RuntimeFamilyModelAgent
}

func chatActionAllowsContinuationTools(action AIChatAction) bool {
	return action == AIChatActionBuild || action == AIChatActionPlan || action == AIChatActionDebug
}

func (s *Service) emitBufferedChatResponseToken(runID string, response string) {
	if token := sanitizedDisplayChunk(response); strings.TrimSpace(token) != "" {
		s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": token})
	}
}

func (s *Service) ensureBuildToolCapability(ctx context.Context, project *ProjectSession, descriptor AIProviderDescriptor, model string, toolset chatToolset) error {
	if !buildRequiresVerifiedToolProbe(descriptor, toolset) {
		return nil
	}
	model = strings.TrimSpace(firstNonEmpty(model, descriptor.DefaultModel))
	if model == "" {
		return fmt.Errorf("Build mode requires a model before live tool capability probing")
	}
	if probe, ok := cachedProjectModelCapabilityProbe(project, descriptor.ID, model); ok && modelCapabilityProbeFresh(probe) {
		if probe.Status == "verified" && probe.ToolSupport {
			return nil
		}
		return fmt.Errorf("model %s on provider %s failed the live tool capability probe: %s", model, descriptor.ID, firstNonEmpty(probe.Error, probe.Status))
	}
	result, err := s.ProbeModelCapability(ctx, project.ID, AIModelCapabilityProbeRequest{
		ProviderID: descriptor.ID,
		Model:      model,
	})
	if err != nil {
		return fmt.Errorf("model %s on provider %s could not complete the live tool capability probe: %s", model, descriptor.ID, err)
	}
	if result.Status == "verified" && result.ToolSupport {
		return nil
	}
	return fmt.Errorf("model %s on provider %s did not pass the live tool capability probe: %s", model, descriptor.ID, firstNonEmpty(result.Error, result.Status))
}

func buildRequiresVerifiedToolProbe(descriptor AIProviderDescriptor, toolset chatToolset) bool {
	if !toolset.ToolSupport || len(toolset.Tools) == 0 {
		return false
	}
	if toolset.Profile == chatToolProfileFastCurrentFile {
		return false
	}
	return strings.TrimSpace(descriptor.Kind) == "ollama" || strings.TrimSpace(toolset.ToolSupportKind) == "adapter"
}

func (s *Service) buildRunHasReviewablePatchArtifact(project *ProjectSession, runID string) bool {
	if project == nil || project.ChatArtifacts == nil || strings.TrimSpace(runID) == "" {
		return false
	}
	artifacts, err := project.ChatArtifacts.ListByRun(runID)
	if err != nil {
		return false
	}
	for _, artifact := range artifacts {
		if artifact.Kind != AIChatRunArtifactPatchPreview {
			continue
		}
		switch strings.TrimSpace(artifact.Status) {
		case "ready", "applied":
			return true
		}
	}
	return false
}

type chatExecutedToolCall struct {
	Call   chatToolCallRequest
	Result AIToolCallResult
}

type chatToolContinuationOutcome struct {
	Response      providers.GenerationResponse
	Record        AIEgressRecord
	Text          string
	Completed     bool
	ArtifactReady bool
	Canceled      bool
	Failed        bool
}

func completedReviewArtifactToolMessage(results []chatExecutedToolCall) (string, bool) {
	if len(results) == 0 {
		return "", false
	}
	readyCount := 0
	for _, executed := range results {
		result := executed.Result
		if !toolCreatesReviewablePatchArtifact(result.ToolID) {
			return "", false
		}
		if result.Status != "ready" || strings.TrimSpace(result.ArtifactID) == "" {
			return "", false
		}
		readyCount++
	}
	if readyCount == 1 {
		return "Patch preview is ready for review.", true
	}
	return fmt.Sprintf("%d patch previews are ready for review.", readyCount), true
}

func buildResponseClaimsReviewablePatchArtifact(response string) bool {
	text := strings.ToLower(strings.TrimSpace(response))
	if text == "" {
		return false
	}
	return strings.Contains(text, "patch preview is ready") ||
		strings.Contains(text, "patch previews are ready") ||
		strings.Contains(text, "patch artifact is ready") ||
		strings.Contains(text, "patch artifacts are ready") ||
		(strings.Contains(text, "patch") && strings.Contains(text, "ready for review"))
}

func fallbackEditToolFailureMessage(results []chatExecutedToolCall) string {
	for _, executed := range results {
		if message := strings.TrimSpace(executed.Result.Error); message != "" {
			return "model did not produce a reviewable edit operation; no file was changed: " + message
		}
	}
	return "model did not produce a reviewable edit operation; no file was changed"
}

func toolCreatesReviewablePatchArtifact(toolID string) bool {
	switch strings.TrimSpace(toolID) {
	case "file.edit.preview", "file.create.preview", "file.patch.preview":
		return true
	default:
		return false
	}
}

type buildRewriteGuardDecision struct {
	Reason          string `json:"reason"`
	Language        string `json:"language,omitempty"`
	CodeBlockLines  int    `json:"codeBlockLines"`
	Instruction     string `json:"instruction"`
	OriginalExcerpt string `json:"originalExcerpt,omitempty"`
}

type chatToolLoopState struct {
	seen map[string]int
}

func newChatToolLoopState() *chatToolLoopState {
	return &chatToolLoopState{seen: map[string]int{}}
}

func (state *chatToolLoopState) remember(results []chatExecutedToolCall) {
	if state == nil {
		return
	}
	for _, result := range results {
		state.seen[chatToolSignature(result.Call.Request)]++
	}
}

func (state *chatToolLoopState) allow(req AIToolCallRequest) bool {
	if state == nil {
		return true
	}
	signature := chatToolSignature(req)
	if state.seen[signature] >= 2 {
		return false
	}
	state.seen[signature]++
	return true
}

func chatToolSignature(req AIToolCallRequest) string {
	return strings.TrimSpace(req.ToolID) + ":" + toolArgumentsJSON(req.Arguments)
}

func blockedRepeatedChatToolResult(req AIToolCallRequest) AIToolCallResult {
	return AIToolCallResult{
		ID:        "tool-call-" + uuid.NewString(),
		ToolID:    req.ToolID,
		Action:    req.Action,
		Status:    "blocked",
		Error:     "repeated identical tool call blocked; adjust the next call or explain the blocker",
		Arguments: sanitizedToolArguments(req.Arguments),
		CreatedAt: utcNow(),
	}
}

func blockedDisallowedChatToolResult(req AIToolCallRequest, action AIChatAction) AIToolCallResult {
	label := strings.ToLower(strings.TrimSpace(string(action)))
	if label == "" {
		label = "selected"
	}
	return AIToolCallResult{
		ID:        "tool-call-" + uuid.NewString(),
		ToolID:    req.ToolID,
		Action:    req.Action,
		Status:    "blocked",
		Error:     fmt.Sprintf("tool %s is not allowed in %s mode", req.ToolID, label),
		Arguments: sanitizedToolArguments(req.Arguments),
		CreatedAt: utcNow(),
	}
}

func (s *Service) recordDisallowedChatToolArtifact(project *ProjectSession, runID string, req AIToolCallRequest, result AIToolCallResult, action AIChatAction) {
	if project == nil || project.ChatArtifacts == nil || strings.TrimSpace(runID) == "" {
		return
	}
	run, err := s.GetChatRun(project.ID, runID)
	if err != nil {
		return
	}
	kind := AIToolKindContextRead
	if descriptor, ok := s.toolDescriptor(req.ToolID); ok {
		kind = descriptor.Kind
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "artifact-" + shortHash(run.ID+":mode-tool-block:"+result.ID),
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactToolProposal,
		Status:           "blocked",
		Title:            "Tool: " + req.ToolID,
		Summary:          result.Error,
		PayloadJSON: marshalChatArtifactPayload(map[string]any{
			"toolId":        req.ToolID,
			"kind":          kind,
			"action":        req.Action,
			"mode":          action,
			"phase":         "blocked",
			"status":        "blocked",
			"resultStatus":  result.Status,
			"error":         result.Error,
			"arguments":     sanitizedToolArguments(req.Arguments),
			"outputPreview": result.OutputPreview,
			"lifecycle":     []string{"blocked"},
			"events": []map[string]any{
				{
					"phase":  "blocked",
					"status": "blocked",
					"toolId": req.ToolID,
					"mode":   action,
					"error":  result.Error,
					"at":     now,
				},
			},
		}),
		CreatedAt: now,
		UpdatedAt: now,
	}
	_ = project.ChatArtifacts.Upsert(artifact)
	s.emitEvent("ai:tool:lifecycle-recorded", artifact)
}

func allowedChatToolIDsForRequest(req AIChatRunRequest) map[string]struct{} {
	tools := generationToolsForChatRequest(req)
	if buildUsesFastCurrentFileEditToolset(req) {
		tools = filterGenerationTools(tools, providerToolFileEditPreview, providerToolFileCreatePreview)
	}
	if len(tools) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(tools))
	for _, tool := range tools {
		toolID := toolIDForProviderToolName(tool.Name)
		if toolID == "" {
			continue
		}
		allowed[toolID] = struct{}{}
	}
	return allowed
}

func chatToolAllowedForRequest(req AIChatRunRequest, toolID string) bool {
	allowed := allowedChatToolIDsForRequest(req)
	if len(allowed) == 0 {
		return false
	}
	_, ok := allowed[strings.TrimSpace(toolID)]
	return ok
}

func (s *Service) executeChatToolCalls(ctx context.Context, project *ProjectSession, runID string, req AIChatRunRequest, calls []chatToolCallRequest, states ...*chatToolLoopState) []chatExecutedToolCall {
	if len(calls) == 0 {
		return nil
	}
	var loopState *chatToolLoopState
	if len(states) > 0 {
		loopState = states[0]
	}
	if loopState == nil {
		loopState = newChatToolLoopState()
	}
	results := make([]chatExecutedToolCall, 0, len(calls))
	for _, call := range calls {
		toolReq := call.Request
		toolReq.RunID = runID
		if toolReq.Action == "" {
			toolReq.Action = AIToolCallActionPreview
		}
		var result AIToolCallResult
		var toolErr error
		if !chatToolAllowedForRequest(req, toolReq.ToolID) {
			result = blockedDisallowedChatToolResult(toolReq, req.Action)
			s.recordDisallowedChatToolArtifact(project, runID, toolReq, result, req.Action)
		} else if !loopState.allow(toolReq) {
			result = blockedRepeatedChatToolResult(toolReq)
		} else {
			result, toolErr = s.ExecuteToolCall(ctx, project.ID, toolReq)
			if toolErr != nil {
				result = AIToolCallResult{
					ID:        "tool-call-" + uuid.NewString(),
					ToolID:    toolReq.ToolID,
					Action:    toolReq.Action,
					Status:    "error",
					Error:     toolErr.Error(),
					Arguments: sanitizedToolArguments(toolReq.Arguments),
					CreatedAt: utcNow(),
				}
			}
		}
		results = append(results, chatExecutedToolCall{
			Call: chatToolCallRequest{
				Request:      toolReq,
				ProviderCall: normalizedProviderToolCall(call.ProviderCall, toolReq, len(results)),
			},
			Result: result,
		})
		s.emitEvent("ai:chat:tool-result", map[string]any{
			"runId":      runID,
			"toolId":     result.ToolID,
			"status":     result.Status,
			"artifactId": result.ArtifactID,
		})
		s.emitRunEnvelope(project.ID, runID)
	}
	return results
}

func (s *Service) continueChatRunAfterToolResults(ctx context.Context, project *ProjectSession, runID string, req AIChatRunRequest, provider providers.Provider, descriptor AIProviderDescriptor, baseReq providers.GenerationRequest, snapshot AIContextSnapshot, system string, assistantText string, toolResults []chatExecutedToolCall) chatToolContinuationOutcome {
	if len(toolResults) == 0 || ctx.Err() != nil || s.runIsCanceled(runID) {
		return chatToolContinuationOutcome{}
	}
	loopState := newChatToolLoopState()
	loopState.remember(toolResults)
	messages := buildChatToolContinuationMessages(baseReq.Messages, assistantText, toolResults)
	var last chatToolContinuationOutcome
	for round := 0; round < maxChatToolContinuationRounds; round++ {
		allowMoreTools := chatActionAllowsContinuationTools(req.Action) && round < maxChatToolContinuationRounds-1
		continuationReq := baseReq
		continuationReq.Prompt = ""
		continuationReq.Messages = messages
		continuationReq.Stream = false
		continuationReq.Tools = nil
		continuationReq.ToolChoice = "none"
		continuationReq.System = system
		toolset := chatToolset{Profile: chatToolProfileNone, ToolSupport: true}
		if allowMoreTools {
			toolset = generationToolsetForChatRequest(req, descriptor, continuationReq.Model)
			continuationReq.Tools = toolset.Tools
			if len(continuationReq.Tools) > 0 {
				continuationReq.ToolChoice = "auto"
			}
		}
		started := time.Now()
		requestID := uuid.NewString()
		record := AIEgressRecord{
			ID:               "eg-" + requestID,
			RequestID:        requestID,
			ProviderID:       descriptor.ID,
			ProviderKind:     descriptor.Kind,
			Endpoint:         descriptor.Endpoint,
			Model:            continuationReq.Model,
			ReasoningEffort:  continuationReq.ReasoningEffort,
			Capability:       providers.CapabilityChat,
			ProjectPathHash:  hashProjectPath(project.ProjectRoot),
			ProjectSessionID: project.ID,
			DataCategories:   snapshot.DataCategories,
			Redaction:        snapshot.Redaction,
			Status:           "started",
			OptInSource:      "chat_tool_result",
			CreatedAt:        utcNow(),
			RunID:            runID,
			Source:           "chat_tool_result",
			ChatAction:       req.Action,
		}
		response, err := provider.Generate(ctx, continuationReq, nil)
		record.LatencyMs = time.Since(started).Milliseconds()
		if ctx.Err() != nil || s.runIsCanceled(runID) {
			record.Status = "canceled"
			record.Canceled = true
			applyGenerationUsageToEgress(&record, continuationReq, response, descriptor, toolset)
			record = s.recordChatEgress(project, runID, record)
			s.finishRunCanceled(runID, record)
			return chatToolContinuationOutcome{Record: record, Canceled: true}
		}
		if err != nil {
			record.Status = "error"
			record.ErrorClass = errorClass(err)
			applyGenerationUsageToEgress(&record, continuationReq, response, descriptor, toolset)
			record = s.recordChatEgress(project, runID, record)
			s.finishRunError(runID, err.Error())
			return chatToolContinuationOutcome{Record: record, Failed: true}
		}
		record.Status = "completed"
		applyGenerationUsageToEgress(&record, continuationReq, response, descriptor, toolset)
		record = s.recordChatEgress(project, runID, record)
		text := cleanChatGeneratedResponse(response.Text, req, system, baseReq.Prompt)
		text, fencedToolCallRequests := extractChatToolCallRequests(text)
		toolCallRequests := chatToolCallRequestsFromGenerationResponse(response)
		fencedStartIndex := len(toolCallRequests)
		for index, toolReq := range fencedToolCallRequests {
			toolCallRequests = append(toolCallRequests, chatToolCallRequestFromToolRequest(toolReq, fencedStartIndex+index))
		}
		last = chatToolContinuationOutcome{Response: response, Record: record}
		if allowMoreTools && len(toolCallRequests) > 0 {
			if strings.TrimSpace(text) != "" {
				s.updateRun(runID, func(run *AIChatRun) {
					run.Response = text
				})
				s.emitRunEnvelope(project.ID, runID)
			}
			executed := s.executeChatToolCalls(ctx, project, runID, req, toolCallRequests, loopState)
			if len(executed) == 0 {
				if strings.TrimSpace(text) != "" {
					last.Text = text
					last.Completed = true
				}
				return last
			}
			if readyMessage, ok := completedReviewArtifactToolMessage(executed); ok {
				last.Text = readyMessage
				last.Completed = true
				last.ArtifactReady = true
				return last
			}
			messages = buildChatToolContinuationMessages(messages, text, executed)
			continue
		}
		if strings.TrimSpace(text) == "" {
			return last
		}
		last.Text = text
		last.Completed = true
		return last
	}
	return last
}

func (s *Service) retryBuildRunAfterRewriteGuard(ctx context.Context, project *ProjectSession, runID string, req AIChatRunRequest, provider providers.Provider, descriptor AIProviderDescriptor, baseReq providers.GenerationRequest, snapshot AIContextSnapshot, system string, blockedResponse string, guard buildRewriteGuardDecision) chatToolContinuationOutcome {
	if ctx.Err() != nil || s.runIsCanceled(runID) {
		return chatToolContinuationOutcome{}
	}
	retryReq := baseReq
	retryReq.Prompt = ""
	retryReq.Stream = false
	toolset := generationToolsetForChatRequest(req, descriptor, retryReq.Model)
	retryReq.Tools = toolset.Tools
	retryReq.ToolChoice = "auto"
	retryReq.System = system
	retryReq.Messages = append(append([]providers.GenerationMessage{}, baseReq.Messages...),
		providers.GenerationMessage{
			Role:    "assistant",
			Content: strings.TrimSpace(blockedResponse),
		},
		providers.GenerationMessage{
			Role: "user",
			Content: "Arlecchino blocked the previous answer because it looked like a broad full-file rewrite instead of a targeted agent tool call. " +
				guard.Instruction + " Return only the minimal explanation and the required tool call; do not paste a full file.",
		},
	)
	started := time.Now()
	requestID := uuid.NewString()
	record := AIEgressRecord{
		ID:               "eg-" + requestID,
		RequestID:        requestID,
		ProviderID:       descriptor.ID,
		ProviderKind:     descriptor.Kind,
		Endpoint:         descriptor.Endpoint,
		Model:            retryReq.Model,
		ReasoningEffort:  retryReq.ReasoningEffort,
		Capability:       providers.CapabilityChat,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Status:           "started",
		OptInSource:      "chat_rewrite_guard",
		CreatedAt:        utcNow(),
		RunID:            runID,
		Source:           "chat_rewrite_guard",
		ChatAction:       req.Action,
	}
	response, err := provider.Generate(ctx, retryReq, nil)
	record.LatencyMs = time.Since(started).Milliseconds()
	if ctx.Err() != nil || s.runIsCanceled(runID) {
		record.Status = "canceled"
		record.Canceled = true
		applyGenerationUsageToEgress(&record, retryReq, response, descriptor, toolset)
		record = s.recordChatEgress(project, runID, record)
		s.finishRunCanceled(runID, record)
		return chatToolContinuationOutcome{Record: record, Canceled: true}
	}
	if err != nil {
		record.Status = "error"
		record.ErrorClass = errorClass(err)
		applyGenerationUsageToEgress(&record, retryReq, response, descriptor, toolset)
		record = s.recordChatEgress(project, runID, record)
		s.finishRunError(runID, err.Error())
		return chatToolContinuationOutcome{Record: record, Failed: true}
	}
	record.Status = "completed"
	applyGenerationUsageToEgress(&record, retryReq, response, descriptor, toolset)
	record = s.recordChatEgress(project, runID, record)
	text := cleanChatGeneratedResponse(response.Text, req, system, baseReq.Prompt)
	text, fencedToolCallRequests := extractChatToolCallRequests(text)
	toolCallRequests := chatToolCallRequestsFromGenerationResponse(response)
	fencedStartIndex := len(toolCallRequests)
	for index, toolReq := range fencedToolCallRequests {
		toolCallRequests = append(toolCallRequests, chatToolCallRequestFromToolRequest(toolReq, fencedStartIndex+index))
	}
	if len(toolCallRequests) == 0 {
		return chatToolContinuationOutcome{Response: response, Record: record}
	}
	if strings.TrimSpace(text) == "" {
		text = "Prepared targeted tool results for review."
	}
	executed := s.executeChatToolCalls(ctx, project, runID, req, toolCallRequests)
	if len(executed) == 0 {
		return chatToolContinuationOutcome{Response: response, Record: record, Text: text, Completed: true}
	}
	if readyMessage, ok := completedReviewArtifactToolMessage(executed); ok {
		return chatToolContinuationOutcome{Response: response, Record: record, Text: readyMessage, Completed: true, ArtifactReady: true}
	}
	outcome := s.continueChatRunAfterToolResults(ctx, project, runID, req, provider, descriptor, retryReq, snapshot, system, text, executed)
	if outcome.Canceled || outcome.Failed {
		return outcome
	}
	if outcome.Record.ID != "" {
		record = outcome.Record
	}
	if outcome.Completed && strings.TrimSpace(outcome.Text) != "" {
		return outcome
	}
	return chatToolContinuationOutcome{Response: response, Record: record, Text: text, Completed: true}
}

func (s *Service) clearChatRunResponse(projectID string, runID string) {
	s.updateRun(runID, func(run *AIChatRun) {
		run.Response = ""
	})
	if strings.TrimSpace(projectID) != "" {
		s.emitRunEnvelope(projectID, runID)
	}
}

func rewriteGuardTargetPath(projectRoot string, req AIChatRunRequest, snapshot AIContextSnapshot) (string, bool) {
	candidates := []string{
		req.Context.FilePath,
		snapshot.FilePath,
	}
	for _, item := range req.Context.ContextItems {
		if item.Kind == AIContextItemKindFile || item.Kind == AIContextItemKindSelection {
			candidates = append(candidates, item.Path)
		}
	}
	for _, item := range snapshot.ContextItems {
		if item.Kind == AIContextItemKindFile || item.Kind == AIContextItemKindSelection {
			candidates = append(candidates, item.Path)
		}
	}
	for _, snippet := range snapshot.Snippets {
		switch strings.TrimSpace(snippet.Type) {
		case "current_file", "selection", "file":
			candidates = append(candidates, snippet.Path)
		}
	}
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		relPath, ok := normalizeRewriteGuardTargetPath(projectRoot, candidate)
		if !ok {
			continue
		}
		if _, exists := seen[relPath]; exists {
			continue
		}
		seen[relPath] = struct{}{}
		return relPath, true
	}
	return "", false
}

func normalizeRewriteGuardTargetPath(projectRoot string, value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false
	}
	if filepath.IsAbs(value) {
		if evaluated, err := filepath.EvalSymlinks(value); err == nil {
			value = evaluated
		}
		rel, err := filepath.Rel(projectRoot, value)
		if err != nil {
			return "", false
		}
		value = rel
	}
	return normalizePatchPath(value)
}

func fileBytesLookBinary(value []byte) bool {
	for _, b := range value {
		if b == 0 {
			return true
		}
	}
	return false
}

func buildRewriteGuardProtocolError(guard buildRewriteGuardDecision) string {
	return buildRewriteGuardFallbackMessage(guard) + " The model did not produce a reviewable edit tool call, so no file was changed."
}

func (s *Service) recordChatEgress(project *ProjectSession, runID string, record AIEgressRecord) AIEgressRecord {
	if project.Egress != nil {
		stored, ledgerErr := project.Egress.Append(record)
		if ledgerErr == nil {
			record = stored
		}
	}
	s.emitEvent("ai:chat:egress-recorded", record)
	s.recordEgressTimeline(project, runID, record)
	s.updateRun(runID, func(run *AIChatRun) {
		run.EgressRecordID = record.ID
	})
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "Provider egress", egressArtifactSummary(record), record)
	s.emitRunEnvelope(project.ID, runID)
	return record
}

func (s *Service) recordEgressTimeline(project *ProjectSession, runID string, record AIEgressRecord) {
	if project == nil || strings.TrimSpace(runID) == "" {
		return
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		ProjectSessionID: project.ID,
		Source:           firstNonEmpty(record.Source, "provider"),
		Type:             "provider_response",
		Status:           record.Status,
		Actor:            "model",
		ProviderID:       record.ProviderID,
		Model:            record.Model,
		CorrelationID:    record.RequestID,
		Capability:       record.Capability,
		DataCategories:   record.DataCategories,
		Redaction:        record.Redaction,
		Summary:          egressArtifactSummary(record),
	})
}

func buildChatToolContinuationMessages(base []providers.GenerationMessage, assistantText string, toolResults []chatExecutedToolCall) []providers.GenerationMessage {
	messages := make([]providers.GenerationMessage, 0, len(base)+1+len(toolResults))
	messages = append(messages, base...)
	assistantToolCalls := make([]providers.GenerationToolCall, 0, len(toolResults))
	for index, result := range toolResults {
		assistantToolCalls = append(assistantToolCalls, normalizedProviderToolCall(result.Call.ProviderCall, result.Call.Request, index))
	}
	messages = append(messages, providers.GenerationMessage{
		Role:      "assistant",
		Content:   strings.TrimSpace(assistantText),
		ToolCalls: assistantToolCalls,
	})
	for index, result := range toolResults {
		call := normalizedProviderToolCall(result.Call.ProviderCall, result.Call.Request, index)
		messages = append(messages, providers.GenerationMessage{
			Role:       "tool",
			ToolCallID: call.ID,
			Name:       call.Name,
			Content:    chatToolResultContent(result.Result),
		})
	}
	return messages
}

func normalizedProviderToolCall(call providers.GenerationToolCall, req AIToolCallRequest, index int) providers.GenerationToolCall {
	if strings.TrimSpace(call.ID) == "" {
		call.ID = fmt.Sprintf("call_%d", index+1)
	}
	if strings.TrimSpace(call.Name) == "" {
		call.Name = providerToolNameForToolID(req.ToolID)
	}
	if strings.TrimSpace(call.ArgumentsJSON) == "" {
		call.ArgumentsJSON = toolArgumentsJSON(req.Arguments)
	}
	return call
}

func chatToolResultContent(result AIToolCallResult) string {
	payload := map[string]any{
		"toolId":        result.ToolID,
		"action":        result.Action,
		"status":        result.Status,
		"artifactId":    result.ArtifactID,
		"outputPreview": result.OutputPreview,
	}
	if result.Error != "" {
		payload["error"] = result.Error
	}
	if hint := toolResultRecoveryHint(result); hint != "" {
		payload["recoveryHint"] = hint
	}
	if len(result.Audit.TargetPaths) > 0 {
		payload["targetPaths"] = result.Audit.TargetPaths
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Sprintf(`{"toolId":%q,"status":%q}`, result.ToolID, result.Status)
	}
	return string(encoded)
}

func toolResultRecoveryHint(result AIToolCallResult) string {
	if result.ToolID != "file.edit.preview" || result.Status != "blocked" {
		return ""
	}
	errText := strings.ToLower(strings.TrimSpace(result.Error))
	switch {
	case strings.Contains(errText, "path is empty"):
		return "Retry with a project-relative path. If the exact anchor is not already visible, call file.read_range for that path first."
	case strings.Contains(errText, "requires oldtext") ||
		strings.Contains(errText, "requires oldtext anchor") ||
		strings.Contains(errText, "was not found") ||
		strings.Contains(errText, "matched") ||
		strings.Contains(errText, "narrow the edit") ||
		strings.Contains(errText, "whole file") ||
		strings.Contains(errText, "too broad"):
		return "Call file.read_range for the target file, then retry file.edit.preview with an exact unique narrow oldText anchor and minimal newText."
	case strings.Contains(errText, "sensitive"):
		return "Do not read or edit secret-looking paths. Ask the user for a safe target path or a narrower non-sensitive file."
	default:
		return "Adjust the file.edit.preview arguments and retry with a narrow project-local edit."
	}
}

type fencedCodeBlock struct {
	Language string
	Content  string
}

func detectBuildRewriteGuard(req AIChatRunRequest, response string, hasToolCalls bool) (buildRewriteGuardDecision, bool) {
	if req.Action != AIChatActionBuild || hasToolCalls || !buildRunHasConcreteFileEditSurface(req) {
		return buildRewriteGuardDecision{}, false
	}
	if _, ok := extractGitDiffPatch(response); ok {
		return buildRewriteGuardDecision{}, false
	}
	for _, block := range fencedCodeBlocks(response) {
		lineCount := lineCount(block.Content)
		if !codeBlockLooksLikeFullFile(block, response) {
			continue
		}
		return buildRewriteGuardDecision{
			Reason:          "broad_full_file_rewrite",
			Language:        block.Language,
			CodeBlockLines:  lineCount,
			Instruction:     "Use file.read_range to inspect the target if needed, then call file.edit.preview with path, operation, exact narrow oldText anchor, and newText.",
			OriginalExcerpt: truncateUTF8(sanitizedDisplayText(block.Content), 1200),
		}, true
	}
	return buildRewriteGuardDecision{}, false
}

func buildRunHasConcreteFileEditSurface(req AIChatRunRequest) bool {
	if strings.TrimSpace(req.Context.FilePath) != "" {
		return true
	}
	if strings.TrimSpace(req.Context.Selection) != "" || strings.TrimSpace(req.Context.FullText) != "" {
		return true
	}
	for _, item := range req.Context.ContextItems {
		switch item.Kind {
		case AIContextItemKindFile, AIContextItemKindSelection:
			return true
		}
	}
	return false
}

func fencedCodeBlocks(value string) []fencedCodeBlock {
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	blocks := []fencedCodeBlock{}
	var builder strings.Builder
	language := ""
	inBlock := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inBlock && strings.HasPrefix(trimmed, "```") {
			inBlock = true
			language = strings.TrimSpace(strings.TrimPrefix(trimmed, "```"))
			builder.Reset()
			continue
		}
		if inBlock && strings.HasPrefix(trimmed, "```") {
			blocks = append(blocks, fencedCodeBlock{
				Language: strings.ToLower(language),
				Content:  builder.String(),
			})
			inBlock = false
			language = ""
			builder.Reset()
			continue
		}
		if inBlock {
			builder.WriteString(line)
			builder.WriteByte('\n')
		}
	}
	return blocks
}

func codeBlockLooksLikeFullFile(block fencedCodeBlock, surroundingResponse string) bool {
	content := strings.TrimSpace(block.Content)
	if content == "" {
		return false
	}
	lines := lineCount(content)
	language := strings.ToLower(strings.TrimSpace(block.Language))
	if lines >= 30 {
		return true
	}
	if lines < 8 {
		return false
	}
	if lines >= 12 && documentBlockLooksLikeFullFile(language, content) {
		return true
	}
	score := 0
	if sourceOrDocumentLanguageHint(language) {
		score++
	}
	lower := strings.ToLower(content)
	if strings.Contains(lower, "\nimport ") || strings.HasPrefix(lower, "import ") || strings.Contains(lower, "\npackage ") || strings.HasPrefix(lower, "package ") {
		score++
	}
	if strings.Contains(lower, "\nfunc ") || strings.Contains(lower, "\nfunction ") || strings.Contains(lower, "\nclass ") || strings.Contains(lower, "\nexport ") {
		score++
	}
	if strings.Contains(lower, "return (") || strings.Contains(lower, "return <") || strings.Contains(lower, "func main(") {
		score++
	}
	if lines >= 14 {
		score++
	}
	response := strings.ToLower(surroundingResponse)
	if strings.Contains(response, "full file") || strings.Contains(response, "entire file") || strings.Contains(response, "replace the file") || strings.Contains(response, "полный файл") || strings.Contains(response, "весь файл") {
		score++
	}
	return score >= 3
}

func sourceOrDocumentLanguageHint(language string) bool {
	switch strings.TrimSpace(language) {
	case "go", "ts", "tsx", "typescript", "js", "jsx", "javascript", "css", "json", "yaml", "yml", "toml", "py", "python", "rs", "rust", "java", "c", "cpp", "cc", "h", "hpp", "swift", "kt", "kotlin", "rb", "ruby", "php", "sh", "bash", "html", "htm", "xml", "md", "mdx", "markdown", "txt", "text", "rst", "adoc", "asciidoc", "org", "tex", "latex", "csv", "tsv", "ini", "conf", "properties":
		return true
	default:
		return false
	}
}

func documentBlockLooksLikeFullFile(language string, content string) bool {
	language = strings.TrimSpace(strings.ToLower(language))
	lower := strings.ToLower(content)
	switch language {
	case "md", "mdx", "markdown", "rst", "adoc", "asciidoc", "org", "txt", "text":
		return markdownLikeDocumentShape(lower)
	case "json", "yaml", "yml", "toml", "xml", "html", "htm", "csv", "tsv", "ini", "conf", "properties", "tex", "latex":
		return lineCount(content) >= 12
	default:
		return markdownLikeDocumentShape(lower)
	}
}

func markdownLikeDocumentShape(lower string) bool {
	headings := 0
	listItems := 0
	links := 0
	for _, line := range strings.Split(strings.ReplaceAll(lower, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			headings++
		}
		if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") || strings.HasPrefix(trimmed, "+ ") {
			listItems++
		}
		if strings.Contains(trimmed, "](") || strings.Contains(trimmed, "](#") {
			links++
		}
	}
	return headings >= 1 && (listItems >= 4 || links >= 4 || headings >= 2)
}

func buildRewriteGuardFallbackMessage(guard buildRewriteGuardDecision) string {
	if guard.CodeBlockLines > 0 {
		return fmt.Sprintf("Blocked a broad %d-line full-file rewrite. Use a targeted file.edit.preview call with an exact narrow anchor, or a reviewed git-style patch when multiple hunks are genuinely required.", guard.CodeBlockLines)
	}
	return "Blocked a broad full-file rewrite. Use a targeted file.edit.preview call with an exact narrow anchor, or a reviewed git-style patch when multiple hunks are genuinely required."
}

func (s *Service) recordBuildRewriteGuardArtifact(project *ProjectSession, runID string, guard buildRewriteGuardDecision) {
	if project == nil || project.ChatArtifacts == nil || strings.TrimSpace(runID) == "" {
		return
	}
	run, err := s.GetChatRun(project.ID, runID)
	if err != nil {
		return
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "artifact-" + shortHash(runID+":rewrite-guard"),
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactToolProposal,
		Status:           "blocked",
		Title:            "Tool: rewrite.guard",
		Summary:          buildRewriteGuardFallbackMessage(guard),
		PayloadJSON: marshalChatArtifactPayload(map[string]any{
			"toolId":        "rewrite.guard",
			"kind":          AIToolKindFileWrite,
			"action":        "block_full_file_rewrite",
			"phase":         "blocked",
			"status":        "blocked",
			"resultStatus":  "blocked",
			"error":         buildRewriteGuardFallbackMessage(guard),
			"outputPreview": "Suppressed broad full-file content from the chat response.",
			"proposal": map[string]any{
				"name":                   "rewrite.guard",
				"kind":                   AIToolKindFileWrite,
				"riskLevel":              AIToolRiskHardDeny,
				"scopeSummary":           "Blocked broad full-file rewrite response",
				"approvalModeRequired":   AIApprovalModeAskEachTime,
				"allowedByCurrentPolicy": false,
				"hardDenyReason":         AIToolHardDenyReasonOutsideProjectWrite,
			},
			"payload": guard,
			"lifecycle": []string{
				"blocked",
			},
			"events": []map[string]any{
				{
					"phase":  "blocked",
					"status": "blocked",
					"toolId": "rewrite.guard",
					"error":  buildRewriteGuardFallbackMessage(guard),
					"at":     now,
				},
			},
		}),
		CreatedAt: now,
		UpdatedAt: now,
	}
	_ = project.ChatArtifacts.Upsert(artifact)
	s.emitEvent("ai:tool:lifecycle-recorded", artifact)
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
	if run.AgentRuntime != nil {
		run.AgentRuntime.Status = "error"
		run.AgentRuntime.HealthStatus = "error"
		if strings.TrimSpace(run.AgentRuntime.ProofState) == "" || run.AgentRuntime.ProofState == "starting" || run.AgentRuntime.ProofState == "running" {
			run.AgentRuntime.ProofState = "error"
		}
		if strings.TrimSpace(run.AgentRuntime.FailureCode) == "" {
			run.AgentRuntime.FailureCode = agentFailureCodeForResult(agents.Result{Status: "error", Error: run.Error})
		}
		run.AgentRuntime.BlockedReason = run.Error
	}
	run.CanCancel = false
	run.Revision++
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	s.persistChatRun(runCopy)
	s.emitEvent("ai:chat:run-error", runCopy)
	if project := s.project(runCopy.ProjectSessionID); project != nil {
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runCopy.ID,
			SessionID:        normalizeChatSessionID(runCopy.SessionID),
			ProjectSessionID: runCopy.ProjectSessionID,
			Source:           "chat_runtime",
			Type:             "run_error",
			Status:           "error",
			Actor:            "system",
			ProviderID:       runCopy.ProviderID,
			Model:            runCopy.Model,
			Capability:       providers.CapabilityChat,
			Summary:          runCopy.Error,
		})
	}
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
	if strings.TrimSpace(current) != "" || len(response.ToolCalls) > 0 || ctx.Err() != nil || s.runIsCanceled(runID) {
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
	if len(generationReq.Tools) > 0 {
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
	if run.AgentRuntime != nil {
		run.AgentRuntime.Status = "error"
		run.AgentRuntime.HealthStatus = "error"
		if strings.TrimSpace(run.AgentRuntime.ProofState) == "" || run.AgentRuntime.ProofState == "starting" || run.AgentRuntime.ProofState == "running" {
			run.AgentRuntime.ProofState = "error"
		}
		if strings.TrimSpace(run.AgentRuntime.FailureCode) == "" {
			run.AgentRuntime.FailureCode = agentFailureCodeForResult(agents.Result{Status: "error", Error: message})
		}
		run.AgentRuntime.BlockedReason = sanitizedDisplayText(message)
	}
	run.CanCancel = false
	run.Revision++
	run.UpdatedAt = utcNow()
	runCopy := *run
	delete(s.runCancels, runID)
	s.mu.Unlock()
	s.persistChatRun(runCopy)
	s.emitEvent("ai:chat:run-error", runCopy)
	if project := s.project(runCopy.ProjectSessionID); project != nil {
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runCopy.ID,
			SessionID:        normalizeChatSessionID(runCopy.SessionID),
			ProjectSessionID: runCopy.ProjectSessionID,
			Source:           "chat_runtime",
			Type:             "run_error",
			Status:           "error",
			Actor:            "system",
			ProviderID:       runCopy.ProviderID,
			Model:            runCopy.Model,
			Capability:       providers.CapabilityChat,
			Summary:          runCopy.Error,
		})
	}
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
	if run.AgentRuntime != nil {
		run.AgentRuntime.Status = "canceled"
	}
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
	if project := s.project(runCopy.ProjectSessionID); project != nil {
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runCopy.ID,
			SessionID:        normalizeChatSessionID(runCopy.SessionID),
			ProjectSessionID: runCopy.ProjectSessionID,
			Source:           "chat_runtime",
			Type:             "run_canceled",
			Status:           "canceled",
			Actor:            "system",
			ProviderID:       runCopy.ProviderID,
			Model:            runCopy.Model,
			Capability:       providers.CapabilityChat,
			Summary:          "Run canceled.",
		})
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
	if record.TotalTokens > 0 {
		tokenLabel := fmt.Sprintf("%d tokens", record.TotalTokens)
		if record.EstimatedTokens {
			tokenLabel += " estimated"
		}
		parts = append(parts, tokenLabel)
	}
	if record.ToolProfile != "" && record.ToolProfile != chatToolProfileNone {
		parts = append(parts, record.ToolProfile)
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
	case AIChatActionAsk, AIChatActionDebug, AIChatActionPlan, AIChatActionBuild, AIChatActionReview:
		return true
	default:
		return false
	}
}

func (s *Service) resolveChatRunRequest(req AIChatRunRequest) AIChatRunRequest {
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.WorkflowID = strings.TrimSpace(req.WorkflowID)
	req.ProfileID = strings.TrimSpace(req.ProfileID)
	req.ReasoningEffort = normalizeReasoningEffort(req.ReasoningEffort)
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
	case AIChatActionReview:
		return "plan-architect"
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
	if effort := normalizeReasoningEffort(req.ReasoningEffort); effort != "" {
		parts = append(parts, "Reasoning effort: "+effort+".")
	}
	return strings.Join(parts, " ")
}

func normalizeReasoningEffort(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "low", "medium", "high", "xhigh":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func chatModeBoundaryPrompt(req AIChatRunRequest) string {
	if isMinimalChatRequest(req) {
		return "Selected chat mode: Minimal.\nMode boundary: Minimal is general chat. Use no codebase, terminal, MCP, Mnemonic, skill, or workspace context unless the user explicitly attached it."
	}
	label := chatActionLabel(req.Action)
	switch req.Action {
	case AIChatActionAsk:
		return "Selected chat mode: " + label + ".\nMode boundary: Ask is read-only and context-only. You may use only the user message, explicit attachments, and already-provided context. Do not request tool use, terminal checks, file writes, MCP actions, or memory mutation."
	case AIChatActionPlan:
		return "Selected chat mode: " + label + ".\nMode boundary: Plan is read-only. You may gather evidence with diagnostics, bounded file reads, workspace search, and git preview when tools are available, then stop at an implementation plan. Do not create patch artifacts, write files, execute terminal commands, call MCP, or mutate Mnemonic."
	case AIChatActionDebug:
		return "Selected chat mode: " + label + ".\nMode boundary: Debug is diagnostic. You may gather evidence with diagnostics, bounded file reads, workspace search, git preview, and terminal-preview proposals when tools are available. Do not write files or create patch artifacts. Any terminal execution remains user-approved and audit-visible."
	case AIChatActionBuild:
		return "Selected chat mode: " + label + ".\nMode boundary: Build may produce implementation guidance, diffs, patch artifacts, and typed tool proposals. Do not apply changes directly; every mutation requires approval, checkpoint, and audit."
	case AIChatActionReview:
		return "Selected chat mode: " + label + ".\nMode boundary: Review is read-only. Inspect the worktree, diffs, diagnostics, and provided context, then produce findings. Do not write files or apply patches."
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
	case AIChatActionReview:
		return "Review"
	default:
		return "Unknown"
	}
}

func chatLanguageBoundaryPrompt(_ AIChatRunRequest) string {
	return "Language boundary: Reply in the same natural language as the user's request. Preserve code, diffs, identifiers, file paths, commands, and quoted text in their original language."
}

func applyChatContextPolicy(req AIChatRunRequest) AIChatRunRequest {
	if req.ProfileID != minimalChatProfileID && !shouldRouteToMinimalChat(req) {
		return applyAgentContextDefaults(req)
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

func applyAgentContextDefaults(req AIChatRunRequest) AIChatRunRequest {
	req.IncludeMnemonic = true
	req.Context.IncludeMnemonic = true
	req.IncludeMCP = true
	req.Context.IncludeMCP = true
	return req
}

func (s *Service) recordContextPlaneTimeline(project *ProjectSession, runID string, req AIChatRunRequest, summary AIContextSummary) {
	sessionID := normalizeChatSessionID(req.SessionID)
	projectID := ""
	if project != nil {
		projectID = project.ID
	}
	if req.IncludeMnemonic || req.Context.IncludeMnemonic {
		status := "disabled"
		message := "Mnemonic: memory is disabled."
		if project != nil && project.Mnemonic != nil && project.Mnemonic.Enabled() {
			if summary.MnemonicCount > 0 {
				status = "included"
				message = fmt.Sprintf("Mnemonic: %d trusted memory entries included.", summary.MnemonicCount)
			} else {
				status = "empty"
				message = "Mnemonic: no trusted memory entries included."
			}
		}
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        sessionID,
			ProjectSessionID: projectID,
			Source:           "mnemonic_context",
			Type:             "mnemonic_context",
			Status:           status,
			Actor:            "system",
			Summary:          message,
			DataCategories:   []string{"mnemonic"},
			Redaction:        summary.Redaction,
			Capability:       providers.CapabilityChat,
		})
	}
	if req.IncludeMCP || req.Context.IncludeMCP {
		status := "unavailable"
		message := "MCP metadata unavailable."
		dataCategories := []string{"mcp_tool_metadata"}
		if plane := summary.MCPContext; plane != nil {
			if plane.Available {
				status = "metadata_ready"
				message = fmt.Sprintf("MCP metadata ready: %d enabled tools; memory backend %s.", plane.EnabledToolCount, firstNonEmpty(plane.MemoryBackend, "unknown"))
			} else {
				status = "metadata_unavailable"
				message = "MCP metadata unavailable: " + firstNonEmpty(plane.ExecutionState, "not available")
			}
			if plane.MnemonicSharedContext {
				dataCategories = append(dataCategories, "mnemonic")
			}
		}
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        sessionID,
			ProjectSessionID: projectID,
			Source:           "mcp_context",
			Type:             "mcp_context",
			Status:           status,
			Actor:            "system",
			Summary:          message,
			DataCategories:   dataCategories,
			Redaction:        summary.Redaction,
			Capability:       providers.CapabilityChat,
		})
	}
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
	common := "Use the selected mode as capability and approval context, not as a reason to give a canned or artificially short answer. Match the user's language. Use concise Markdown when it improves readability: bold and italic are allowed sparingly, and file paths, commands, symbols, and short technical identifiers should use inline code. Use provided current-file, mentioned-file, workspace, MCP, Mnemonic, and conversation-history context as real context that is already available to you; reading provided context is not a tool action. If the user asks what mode is selected, answer from the selected mode boundary. For actionable requests, either give the requested analysis, plan, or diff, or name the exact missing context; never answer only with a capability confirmation. Do not repeat identical sentences or paragraphs."
	switch action {
	case AIChatActionAsk:
		return common + " In Ask mode, answer the user's question directly using only the user message, explicit attachments, and provided project context. Ask is context-only: do not request tools, do not propose command execution as completed, and do not claim that any file, terminal, MCP, memory, or subagent action has run."
	case AIChatActionDebug:
		return common + " In Debug mode, investigate concrete failures and produce evidence-backed findings, likely root causes, and verification steps. Use diagnostics.read, workspace.grep, file.read_range, git.preview, and terminal.preview when available to gather or propose diagnostic evidence. Do not write files, create patch artifacts, or describe mutations as already executed."
	case AIChatActionBuild:
		return common + " In Build mode, answer normal questions normally. For concrete file edits, use the available tools instead of pasting rewritten files: diagnostics.read, workspace.grep, git.preview, and file.read_range to find anchors, file.edit.preview for narrow edits, file.create.preview for new files, terminal.preview for verification commands, and file.patch.preview only for genuinely multi-file or multi-hunk diffs. For a small local edit when the exact target file and anchor are already visible in provided current-file or mentioned-file context, call file.edit.preview directly instead of calling file.read_range, workspace.grep, diagnostics.read, or terminal.preview only to rediscover the same anchor. Use mcp.execute only when MCP context was explicitly included, and treat subagent.preview as an isolated preview artifact rather than executed background work. Arlecchino will turn edit/create/patch tool calls into reviewable patch artifacts and reject whole-file oldText/newText rewrites. Do not rewrite a whole file for a small local edit. Do not claim any file, terminal, MCP, or subagent action has run."
	case AIChatActionReview:
		return common + " In Review mode, prioritize concrete bugs, regressions, missing tests, unsafe edits, and unclear risk. Findings should lead, with file/path references when available. Do not write files or claim fixes were applied."
	default:
		return common + " In Plan mode, create a concrete implementation or investigation plan grounded in the provided context. Use diagnostics.read, workspace.grep, file.read_range, and git.preview when available to inspect read-only evidence, but stop before patching, terminal execution, MCP calls, file writes, dependency changes, or Mnemonic mutation."
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
	if reason := hardDenyReasonForCommand(proposal.CommandPreview, projectRoot); reason != "" {
		return reason
	}
	for _, path := range proposal.TargetPaths {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		if toolPathLooksSensitive(path) {
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

type chatToolCallBlock struct {
	ToolID    string            `json:"toolId"`
	Tool      string            `json:"tool"`
	Action    AIToolCallAction  `json:"action"`
	Arguments map[string]string `json:"arguments"`
}

func extractChatToolCallRequests(value string) (string, []AIToolCallRequest) {
	if !strings.Contains(value, "```arlecchino-tool") {
		return value, nil
	}
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	visible := []string{}
	block := []string{}
	inToolBlock := false
	requests := []AIToolCallRequest{}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inToolBlock && strings.HasPrefix(trimmed, "```arlecchino-tool") {
			inToolBlock = true
			block = block[:0]
			continue
		}
		if inToolBlock && strings.HasPrefix(trimmed, "```") {
			if req, ok := parseChatToolCallBlock(strings.Join(block, "\n")); ok {
				requests = append(requests, req)
			} else {
				visible = append(visible, "```arlecchino-tool")
				visible = append(visible, block...)
				visible = append(visible, "```")
			}
			inToolBlock = false
			block = block[:0]
			continue
		}
		if inToolBlock {
			block = append(block, line)
			continue
		}
		visible = append(visible, line)
	}
	if inToolBlock {
		visible = append(visible, "```arlecchino-tool")
		visible = append(visible, block...)
	}
	return strings.TrimSpace(strings.Join(visible, "\n")), requests
}

func parseChatToolCallBlock(value string) (AIToolCallRequest, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return AIToolCallRequest{}, false
	}
	var block chatToolCallBlock
	if err := json.Unmarshal([]byte(value), &block); err != nil {
		return AIToolCallRequest{}, false
	}
	toolID := firstNonEmpty(block.ToolID, block.Tool)
	if toolID == "" || !allowedChatToolBlockID(toolID) {
		return AIToolCallRequest{}, false
	}
	action := block.Action
	if action == "" {
		action = AIToolCallActionPreview
	}
	if action != AIToolCallActionPreview {
		return AIToolCallRequest{}, false
	}
	return AIToolCallRequest{
		ToolID:    toolID,
		Action:    action,
		Arguments: block.Arguments,
	}, true
}

func allowedChatToolBlockID(toolID string) bool {
	switch strings.TrimSpace(toolID) {
	case "file.read_range", "file.edit.preview", "file.patch.preview":
		return true
	default:
		return false
	}
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
