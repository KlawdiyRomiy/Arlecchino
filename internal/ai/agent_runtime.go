package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"arlecchino/internal/ai/agents"
	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const (
	agentRuntimeFamilyExternalCLI = agents.RuntimeFamilyExternalAgentCLI
	agentTerminalTranscriptLimit  = 48 * 1024
)

type agentWorktreeBaseline struct {
	ID               string   `json:"id"`
	ProjectSessionID string   `json:"projectSessionId"`
	ProjectPathHash  string   `json:"projectPathHash"`
	Clean            bool     `json:"clean"`
	StatusShort      []string `json:"statusShort,omitempty"`
	TrackedDiffHash  string   `json:"trackedDiffHash,omitempty"`
	StagedDiffHash   string   `json:"stagedDiffHash,omitempty"`
	UntrackedPaths   []string `json:"untrackedPaths,omitempty"`
	Error            string   `json:"error,omitempty"`
	CreatedAt        string   `json:"createdAt"`
}

func (s *Service) agentProviderDescriptor(providerID string) (providers.AIProviderDescriptor, bool) {
	providerID = strings.TrimSpace(providerID)
	if s == nil || s.agents == nil || providerID == "" {
		return providers.AIProviderDescriptor{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for _, descriptor := range s.agents.Descriptors(ctx) {
		if descriptor.ID == providerID {
			return agents.DescriptorToProvider(descriptor), true
		}
	}
	return providers.AIProviderDescriptor{}, false
}

func (s *Service) resolveAgentAdapter(ctx context.Context, providerID string) (agents.Adapter, providers.AIProviderDescriptor, bool) {
	providerID = strings.TrimSpace(providerID)
	if s == nil || s.agents == nil || providerID == "" {
		return nil, providers.AIProviderDescriptor{}, false
	}
	adapter, ok := s.agents.Adapter(providerID)
	if !ok {
		return nil, providers.AIProviderDescriptor{}, false
	}
	descriptor := agents.DescriptorToProvider(adapter.Descriptor(ctx))
	return adapter, descriptor, true
}

func isExternalAgentProviderDescriptor(descriptor providers.AIProviderDescriptor) bool {
	return descriptor.RuntimeFamily == agentRuntimeFamilyExternalCLI || descriptor.EndpointClass == agents.EndpointClassExternalAccount || descriptor.ExternalAccount
}

func (s *Service) registerAgentTerminalIO(runID string, write func([]byte) error, resize func(uint16, uint16) error) {
	if s == nil || strings.TrimSpace(runID) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.agentInputs == nil {
		s.agentInputs = map[string]func([]byte) error{}
	}
	if s.agentResizes == nil {
		s.agentResizes = map[string]func(uint16, uint16) error{}
	}
	if write == nil {
		delete(s.agentInputs, runID)
	} else {
		s.agentInputs[runID] = write
	}
	if resize == nil {
		delete(s.agentResizes, runID)
	} else {
		s.agentResizes[runID] = resize
	}
}

func (s *Service) WriteAgentTerminalInput(projectID string, runID string, data string) error {
	projectID = normalizeProjectID(projectID)
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return fmt.Errorf("agent run id is empty")
	}
	if _, err := s.GetChatRun(projectID, runID); err != nil {
		return err
	}
	if len(data) > 16*1024 {
		return fmt.Errorf("agent terminal input exceeds 16 KiB")
	}
	s.mu.RLock()
	write := s.agentInputs[runID]
	s.mu.RUnlock()
	if write == nil {
		return fmt.Errorf("agent terminal input is not available for run %q", runID)
	}
	return write([]byte(data))
}

func (s *Service) ResizeAgentTerminal(projectID string, runID string, rows int, cols int) error {
	projectID = normalizeProjectID(projectID)
	runID = strings.TrimSpace(runID)
	if _, err := s.GetChatRun(projectID, runID); err != nil {
		return err
	}
	if rows <= 0 || cols <= 0 || rows > 300 || cols > 500 {
		return fmt.Errorf("invalid agent terminal size")
	}
	s.mu.RLock()
	resize := s.agentResizes[runID]
	s.mu.RUnlock()
	if resize == nil {
		return nil
	}
	return resize(uint16(rows), uint16(cols))
}

func (s *Service) StartAgentAuthRun(ctx context.Context, projectID string, providerID string) (AIChatRun, error) {
	project := s.project(projectID)
	if project == nil {
		return AIChatRun{}, fmt.Errorf("AI project session is not open")
	}
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return AIChatRun{}, fmt.Errorf("agent provider id is empty")
	}
	adapter, descriptor, ok := s.resolveAgentAdapter(ctx, providerID)
	if !ok {
		return AIChatRun{}, fmt.Errorf("agent runtime %q is unavailable", providerID)
	}
	authRunner, ok := adapter.(agents.AuthRunner)
	if !ok {
		return AIChatRun{}, fmt.Errorf("agent runtime %q does not expose an interactive auth flow", providerID)
	}
	runID := uuid.NewString()
	now := utcNow()
	sessionID := defaultChatSessionID
	run := &AIChatRun{
		ID:               runID,
		SessionID:        sessionID,
		ProjectSessionID: project.ID,
		Action:           AIChatActionAsk,
		Status:           "running",
		RuntimeFamily:    agentRuntimeFamilyExternalCLI,
		ProviderID:       descriptor.ID,
		Model:            descriptor.DefaultModel,
		UserPrompt:       "Sign in to " + firstNonEmpty(descriptor.Name, descriptor.ID),
		AgentRuntime: &AIExternalAgentRunSummary{
			RuntimeID:     descriptor.ID,
			RuntimeFamily: agentRuntimeFamilyExternalCLI,
			Operation:     "auth_login",
			Transport:     "pty",
			EndpointClass: descriptor.EndpointClass,
			AuthStatus:    descriptor.AuthStatus,
			AuthFlow:      true,
			Status:        "starting",
			SourceLinks:   descriptor.SourceLinks,
		},
		CanCancel: true,
		Revision:  1,
		CreatedAt: now,
		UpdatedAt: now,
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
		SessionID:        sessionID,
		ProjectSessionID: project.ID,
		Source:           "external_agent_cli",
		Type:             "auth_started",
		Status:           "running",
		Actor:            "user",
		ProviderID:       descriptor.ID,
		Model:            descriptor.DefaultModel,
		Capability:       providers.CapabilityChat,
		Summary:          "External agent CLI authentication started.",
	})
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "External agent auth disclosure", "Authentication starts the official provider CLI locally. Arlecchino does not receive or store provider credentials.", map[string]any{
		"providerId":    descriptor.ID,
		"runtimeFamily": agentRuntimeFamilyExternalCLI,
		"endpointClass": descriptor.EndpointClass,
		"authMode":      descriptor.AuthMode,
		"legalBasis":    descriptor.LegalBasis,
		"dataCategories": []string{
			"provider/runtime metadata",
		},
	})
	s.emitRunEnvelope(project.ID, runID)
	go func() {
		defer s.markRunDone(runID)
		s.runExternalAgentAuth(runCtx, project, runID, authRunner, adapter, descriptor)
	}()
	return runCopy, nil
}

func (s *Service) runExternalAgentChat(ctx context.Context, project *ProjectSession, runID string, req AIChatRunRequest, snapshot AIContextSnapshot, contextSummary AIContextSummary, adapter agents.Adapter, descriptor providers.AIProviderDescriptor) {
	s.updateRun(runID, func(run *AIChatRun) {
		run.RuntimeFamily = agentRuntimeFamilyExternalCLI
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
		run.AgentRuntime = &AIExternalAgentRunSummary{
			RuntimeID:     descriptor.ID,
			RuntimeFamily: agentRuntimeFamilyExternalCLI,
			Transport:     "pty",
			EndpointClass: descriptor.EndpointClass,
			AuthStatus:    descriptor.AuthStatus,
			Status:        "starting",
			SourceLinks:   descriptor.SourceLinks,
		}
	})
	s.emitRunEnvelope(project.ID, runID)

	if !agentSupportsAction(descriptor, req.Action) {
		s.finishRunError(runID, fmt.Sprintf("agent runtime %s does not support %s mode", descriptor.Name, req.Action))
		return
	}
	record := s.startAgentEgressRecord(project, runID, req, descriptor, snapshot)
	if !normalizeConsentPolicy(s.currentSettings().ConsentPolicy).ExternalAgentCLIAccepted {
		record.Status = "blocked"
		record.ErrorClass = "external_agent_cli_consent_required"
		record = s.storeAgentEgressRecord(project, runID, record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.BlockedReason = "external agent CLI consent required"
			}
		})
		s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "External agent egress blocked", "External agent CLI consent is required before context is sent.", record)
		s.finishRunError(runID, "external agent CLI consent is required before sending context to this provider-owned CLI")
		return
	}
	baseline := captureAgentWorktreeBaseline(project)
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactAgentWorktree, "Agent worktree baseline", agentBaselineSummary(baseline), baseline)
	s.updateRun(runID, func(run *AIChatRun) {
		if run.AgentRuntime != nil {
			run.AgentRuntime.BaselineID = baseline.ID
			run.AgentRuntime.Status = "running"
		}
	})
	s.emitRunEnvelope(project.ID, runID)

	started := time.Now()
	agentPrompt := buildExternalAgentPrompt(req, snapshot, contextSummary)
	result := adapter.Run(ctx, agents.RunRequest{
		RunID:          runID,
		SessionID:      normalizeChatSessionID(req.SessionID),
		ProjectRoot:    project.ProjectRoot,
		Action:         string(req.Action),
		Prompt:         agentPrompt,
		Model:          firstNonEmpty(req.Model, descriptor.DefaultModel),
		Rows:           34,
		Cols:           116,
		DataCategories: snapshot.DataCategories,
		RegisterInput:  s.registerAgentTerminalIO,
	}, func(event agents.Event) {
		s.handleAgentRuntimeEvent(project, runID, event)
	})
	s.registerAgentTerminalIO(runID, nil, nil)

	record.LatencyMs = time.Since(started).Milliseconds()
	if result.Status == "canceled" || ctx.Err() != nil || s.runIsCanceled(runID) {
		record.Status = "canceled"
		record.Canceled = true
		record = s.storeAgentEgressRecord(project, runID, record)
		transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "canceled"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
			}
		})
		s.finishRunCanceled(runID, record)
		return
	}
	if result.Status == "error" {
		record.Status = "error"
		record.ErrorClass = errorClass(fmt.Errorf("%s", result.Error))
		record = s.storeAgentEgressRecord(project, runID, record)
		transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "error"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
			}
		})
		s.finishRunError(runID, firstNonEmpty(result.Error, "agent CLI run failed"))
		return
	}

	record.Status = "completed"
	record = s.storeAgentEgressRecord(project, runID, record)
	transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
	diffArtifact, diffErr := s.recordAgentCapturedDiff(project, runID, req, baseline)
	if diffErr != nil {
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
				run.AgentRuntime.BlockedReason = diffErr.Error()
			}
		})
		s.finishRunError(runID, diffErr.Error())
		return
	}
	if req.Action == AIChatActionBuild && diffArtifact.ID == "" {
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
				run.AgentRuntime.BlockedReason = "build completed without reviewable diff evidence"
			}
		})
		s.finishRunError(runID, "Build mode completed without a reviewable patch or captured direct diff artifact")
		return
	}
	s.finishAgentRunCompleted(project, runID, req, descriptor, record, result, transcriptID, diffArtifact)
}

func (s *Service) runExternalAgentAuth(ctx context.Context, project *ProjectSession, runID string, authRunner agents.AuthRunner, adapter agents.Adapter, descriptor providers.AIProviderDescriptor) {
	s.updateRun(runID, func(run *AIChatRun) {
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "running"
		}
	})
	s.emitRunEnvelope(project.ID, runID)
	started := time.Now()
	result := authRunner.RunAuth(ctx, agents.AuthRequest{
		RunID:         runID,
		SessionID:     defaultChatSessionID,
		ProjectRoot:   project.ProjectRoot,
		Rows:          34,
		Cols:          116,
		RegisterInput: s.registerAgentTerminalIO,
	}, func(event agents.Event) {
		s.handleAgentRuntimeEvent(project, runID, event)
	})
	s.registerAgentTerminalIO(runID, nil, nil)
	transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
	if invalidator, ok := adapter.(agents.CacheInvalidator); ok {
		invalidator.Invalidate()
	}
	if result.Status == "canceled" || ctx.Err() != nil || s.runIsCanceled(runID) {
		s.updateRun(runID, func(run *AIChatRun) {
			run.Status = "canceled"
			run.CanCancel = false
			run.Response = "External agent authentication was canceled."
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "canceled"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
			}
		})
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        defaultChatSessionID,
			ProjectSessionID: project.ID,
			Source:           "external_agent_cli",
			Type:             "auth_completed",
			Status:           "canceled",
			Actor:            "system",
			ProviderID:       descriptor.ID,
			Model:            descriptor.DefaultModel,
			Capability:       providers.CapabilityChat,
			Summary:          "External agent CLI authentication canceled.",
		})
		if run, err := s.GetChatRun(project.ID, runID); err == nil {
			s.persistChatRun(run)
			s.emitEvent("ai:chat:run-canceled", run)
		}
		s.finishAgentAuthCleanup(runID, adapter)
		return
	}
	if result.Status == "error" {
		message := firstNonEmpty(result.Error, "agent CLI authentication failed")
		s.updateRun(runID, func(run *AIChatRun) {
			run.Status = "error"
			run.Error = sanitizedDisplayText(message)
			run.CanCancel = false
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "error"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
				run.AgentRuntime.BlockedReason = sanitizedDisplayText(message)
			}
		})
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        defaultChatSessionID,
			ProjectSessionID: project.ID,
			Source:           "external_agent_cli",
			Type:             "auth_completed",
			Status:           "error",
			Actor:            "system",
			ProviderID:       descriptor.ID,
			Model:            descriptor.DefaultModel,
			Capability:       providers.CapabilityChat,
			Summary:          "External agent CLI authentication failed.",
		})
		if run, err := s.GetChatRun(project.ID, runID); err == nil {
			s.persistChatRun(run)
			s.emitEvent("ai:chat:run-error", run)
		}
		s.finishAgentAuthCleanup(runID, adapter)
		return
	}
	authStatus := "ready"
	if fresh := adapter.Descriptor(context.Background()); fresh.AuthStatus != "" {
		authStatus = fresh.AuthStatus
	}
	latencyMs := time.Since(started).Milliseconds()
	s.updateRun(runID, func(run *AIChatRun) {
		run.Status = "completed"
		run.CanCancel = false
		run.Response = "External agent authentication completed. Refreshing provider status."
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "completed"
			run.AgentRuntime.AuthStatus = authStatus
			run.AgentRuntime.ExitCode = result.ExitCode
			run.AgentRuntime.TranscriptID = transcriptID
		}
	})
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        defaultChatSessionID,
		ProjectSessionID: project.ID,
		Source:           "external_agent_cli",
		Type:             "auth_completed",
		Status:           "completed",
		Actor:            "system",
		ProviderID:       descriptor.ID,
		Model:            descriptor.DefaultModel,
		Capability:       providers.CapabilityChat,
		Summary:          fmt.Sprintf("External agent CLI authentication completed in %d ms.", latencyMs),
	})
	if run, err := s.GetChatRun(project.ID, runID); err == nil {
		s.persistChatRun(run)
		s.emitEvent("ai:chat:run-completed", run)
	}
	s.finishAgentAuthCleanup(runID, adapter)
}

func (s *Service) finishAgentAuthCleanup(runID string, adapter agents.Adapter) {
	if invalidator, ok := adapter.(agents.CacheInvalidator); ok {
		invalidator.Invalidate()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	s.emitEvent("ai:provider:status", agents.DescriptorToProvider(adapter.Descriptor(ctx)))
	s.mu.Lock()
	delete(s.runCancels, runID)
	s.mu.Unlock()
}

func (s *Service) handleAgentRuntimeEvent(project *ProjectSession, runID string, event agents.Event) {
	if event.Type == agents.EventTerminalData {
		s.emitEvent("ai:agent:terminal-data", map[string]any{
			"runId":            runID,
			"projectSessionId": project.ID,
			"data":             string(event.Data),
			"createdAt":        event.CreatedAt,
		})
		return
	}
	s.emitEvent("ai:agent:status", map[string]any{
		"runId":            runID,
		"projectSessionId": project.ID,
		"type":             event.Type,
		"status":           event.Status,
		"text":             sanitizedDisplayText(event.Text),
		"createdAt":        event.CreatedAt,
	})
}

func (s *Service) startAgentEgressRecord(project *ProjectSession, runID string, req AIChatRunRequest, descriptor providers.AIProviderDescriptor, snapshot AIContextSnapshot) AIEgressRecord {
	requestID := uuid.NewString()
	record := AIEgressRecord{
		ID:               "eg-" + requestID,
		RequestID:        requestID,
		ProviderID:       descriptor.ID,
		ProviderKind:     descriptor.Kind,
		Endpoint:         firstNonEmpty(descriptor.EndpointClass, descriptor.Endpoint),
		Model:            firstNonEmpty(req.Model, descriptor.DefaultModel),
		Capability:       providers.CapabilityChat,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Status:           "started",
		OptInSource:      "external_agent_cli",
		CreatedAt:        utcNow(),
		RunID:            runID,
		Source:           "external_agent_cli",
		ChatAction:       req.Action,
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "external_agent_cli",
		Type:             "provider_request",
		Status:           "started",
		Actor:            "agent",
		ProviderID:       descriptor.ID,
		Model:            record.Model,
		CorrelationID:    requestID,
		Capability:       providers.CapabilityChat,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Summary:          "External agent CLI request started.",
	})
	return record
}

func (s *Service) storeAgentEgressRecord(project *ProjectSession, runID string, record AIEgressRecord) AIEgressRecord {
	if project != nil && project.Egress != nil {
		if stored, err := project.Egress.Append(record); err == nil {
			record = stored
		}
	}
	s.emitEvent("ai:chat:egress-recorded", record)
	s.recordEgressTimeline(project, runID, record)
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "External agent egress", egressArtifactSummary(record), record)
	return record
}

func (s *Service) recordAgentTranscriptArtifact(project *ProjectSession, runID string, result agents.Result) string {
	transcript := truncateUTF8(result.Transcript, agentTerminalTranscriptLimit)
	payload := map[string]any{
		"transport":  "pty",
		"status":     result.Status,
		"exitCode":   result.ExitCode,
		"startedAt":  result.StartedAt,
		"finishedAt": result.FinishedAt,
		"transcript": transcript,
	}
	title := "Agent terminal transcript"
	summary := "Redacted bounded transcript from the external agent CLI."
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactAgentTerminal, title, summary, payload)
	return "artifact-" + shortHash(runID+":"+string(AIChatRunArtifactAgentTerminal)+":"+title)
}

func (s *Service) finishAgentRunCompleted(project *ProjectSession, runID string, req AIChatRunRequest, descriptor providers.AIProviderDescriptor, record AIEgressRecord, result agents.Result, transcriptID string, diffArtifact AIChatRunArtifact) {
	response := agentRunDisplayResponse(result, &diffArtifact)
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "chat_runtime",
		Type:             "run_completed",
		Status:           "completed",
		Actor:            "system",
		ProviderID:       descriptor.ID,
		Model:            firstNonEmpty(req.Model, descriptor.DefaultModel),
		Capability:       providers.CapabilityChat,
		Summary:          "External agent CLI run completed.",
	})
	s.updateRun(runID, func(run *AIChatRun) {
		run.Status = "completed"
		run.CanCancel = false
		run.Response = response
		run.ProviderID = descriptor.ID
		run.RuntimeFamily = agentRuntimeFamilyExternalCLI
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
		run.ToolProposals = nil
		run.EgressRecordID = record.ID
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "completed"
			run.AgentRuntime.ExitCode = result.ExitCode
			run.AgentRuntime.TranscriptID = transcriptID
			if diffArtifact.ID != "" {
				run.AgentRuntime.CapturedDiffID = diffArtifact.ID
			}
		}
	})
	s.emitRunEnvelope(project.ID, runID)
	if run, err := s.GetChatRun(project.ID, runID); err == nil {
		s.persistChatRun(run)
		s.emitEvent("ai:chat:run-completed", run)
	}
	s.mu.Lock()
	delete(s.runCancels, runID)
	s.mu.Unlock()
}

func agentSupportsAction(descriptor providers.AIProviderDescriptor, action AIChatAction) bool {
	if len(descriptor.SupportedActions) == 0 {
		return action == AIChatActionAsk || action == AIChatActionPlan || action == AIChatActionBuild || action == AIChatActionDebug
	}
	for _, candidate := range descriptor.SupportedActions {
		if candidate == string(action) {
			return true
		}
	}
	return false
}

func buildExternalAgentPrompt(req AIChatRunRequest, snapshot AIContextSnapshot, summary AIContextSummary) string {
	history := []AIChatRun{}
	contextPrompt := buildChatPromptFromSnapshot(snapshot, history)
	var b strings.Builder
	b.WriteString("You are running as an external terminal agent inside Arlecchino AI Chat.\n")
	b.WriteString("Mode: ")
	b.WriteString(string(req.Action))
	b.WriteString(". Keep all visible work grounded in the supplied Arlecchino context.\n")
	b.WriteString("Do not claim file changes unless the files are actually changed in the project worktree; Arlecchino will capture and validate git diff evidence after you exit.\n")
	b.WriteString("Do not read or write secrets, token files, .env files, provider auth storage, cookies, keychains, or paths outside the project.\n")
	if req.Action == AIChatActionBuild {
		b.WriteString("For Build mode, either make concrete project file changes or clearly explain why no change is needed; terminal transcript alone is not accepted as build output.\n")
	}
	if len(summary.DataCategories) > 0 {
		b.WriteString("Context data categories disclosed to the user: ")
		b.WriteString(strings.Join(summary.DataCategories, ", "))
		b.WriteString(".\n")
	}
	b.WriteString("\n")
	b.WriteString(contextPrompt)
	return b.String()
}

func captureAgentWorktreeBaseline(project *ProjectSession) agentWorktreeBaseline {
	baseline := agentWorktreeBaseline{
		ID:               "agent-baseline-" + uuid.NewString(),
		ProjectSessionID: project.ID,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		CreatedAt:        utcNow(),
	}
	status, statusErr := gitOutput(project.ProjectRoot, "status", "--short", "--untracked-files=all")
	trackedDiff, trackedErr := gitOutput(project.ProjectRoot, "diff", "--binary", "--no-ext-diff")
	stagedDiff, stagedErr := gitOutput(project.ProjectRoot, "diff", "--cached", "--binary", "--no-ext-diff")
	if statusErr != nil || trackedErr != nil || stagedErr != nil {
		baseline.Error = firstNonEmpty(errorString(statusErr), errorString(trackedErr), errorString(stagedErr))
		return baseline
	}
	baseline.StatusShort = filterAgentWorktreeStatus(nonEmptyLines(status))
	baseline.TrackedDiffHash = shortHash(trackedDiff)
	baseline.StagedDiffHash = shortHash(stagedDiff)
	baseline.UntrackedPaths = untrackedPathsFromStatus(baseline.StatusShort)
	baseline.Clean = len(baseline.StatusShort) == 0 && strings.TrimSpace(trackedDiff) == "" && strings.TrimSpace(stagedDiff) == ""
	return baseline
}

func (s *Service) recordAgentCapturedDiff(project *ProjectSession, runID string, req AIChatRunRequest, baseline agentWorktreeBaseline) (AIChatRunArtifact, error) {
	diff, err := agentWorktreeDiff(project.ProjectRoot)
	if err != nil {
		return AIChatRunArtifact{}, err
	}
	if strings.TrimSpace(diff) == "" {
		return AIChatRunArtifact{}, nil
	}
	if baseline.Error != "" {
		return s.recordBlockedCapturedDiff(project, runID, req, diff, baseline, baseline.Error), fmt.Errorf("agent worktree baseline failed: %s", baseline.Error)
	}
	if !baseline.Clean {
		return s.recordBlockedCapturedDiff(project, runID, req, diff, baseline, "dirty_baseline_conflict"), fmt.Errorf("agent changed the worktree, but the baseline was already dirty; review the diff manually before accepting or rolling back")
	}
	files, validateErr := s.validatePatchFiles(project, diff)
	if validateErr != nil {
		return s.recordBlockedCapturedDiff(project, runID, req, diff, baseline, validateErr.Error()), validateErr
	}
	artifactID := "patch-" + uuid.NewString()
	checkpointIDs := make([]string, 0, len(files))
	for _, file := range files {
		checkpointID, checkpointErr := createGitBaselineCheckpoint(project, artifactID, file.Path)
		if checkpointErr != nil {
			return s.recordBlockedCapturedDiff(project, runID, req, diff, baseline, checkpointErr.Error()), checkpointErr
		}
		checkpointIDs = append(checkpointIDs, checkpointID)
	}
	now := utcNow()
	payload := AIPatchArtifactPayload{
		UnifiedDiff:    ensurePatchTrailingNewline(diff),
		Files:          files,
		CheckReady:     false,
		CheckpointIDs:  checkpointIDs,
		Source:         "captured_direct_write",
		AlreadyApplied: true,
		BaselineID:     baseline.ID,
		ReverseDiff:    reverseAgentWorktreeDiff(project.ProjectRoot),
		AppliedAt:      now,
	}
	artifact := AIChatRunArtifact{
		ID:               artifactID,
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactPatchPreview,
		Status:           patchArtifactStatus(payload),
		Title:            "Captured agent diff",
		Summary:          patchPreviewSummary(payload),
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := project.ChatArtifacts.Upsert(artifact); err != nil {
		return AIChatRunArtifact{}, err
	}
	s.emitChatArtifactChanged(project, artifact, "ai:agent:captured-diff")
	return artifact, nil
}

func (s *Service) recordBlockedCapturedDiff(project *ProjectSession, runID string, req AIChatRunRequest, diff string, baseline agentWorktreeBaseline, reason string) AIChatRunArtifact {
	payload := AIPatchArtifactPayload{
		UnifiedDiff: ensurePatchTrailingNewline(diff),
		CheckReady:  false,
		CheckError:  sanitizedDisplayText(reason),
		Source:      "captured_direct_write",
		BaselineID:  baseline.ID,
	}
	if files, err := patchPaths(diff); err == nil {
		for _, path := range files {
			payload.Files = append(payload.Files, AIPatchFile{Path: path, Status: "blocked"})
		}
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "patch-" + uuid.NewString(),
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactPatchPreview,
		Status:           "blocked",
		Title:            "Blocked captured agent diff",
		Summary:          sanitizedDisplayText(reason),
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if project != nil && project.ChatArtifacts != nil {
		if err := project.ChatArtifacts.Upsert(artifact); err == nil {
			s.emitChatArtifactChanged(project, artifact, "ai:agent:captured-diff-blocked")
		}
	}
	return artifact
}

func createGitBaselineCheckpoint(project *ProjectSession, artifactID string, relPath string) (string, error) {
	relPath, ok := normalizePatchPath(relPath)
	if !ok {
		return "", fmt.Errorf("unsafe patch path: %s", relPath)
	}
	if toolPathLooksSensitive(relPath) {
		return "", fmt.Errorf("patch target is sensitive: %s", relPath)
	}
	payload := patchCheckpointPayload{
		ID:               "checkpoint-" + uuid.NewString(),
		ArtifactID:       artifactID,
		ProjectSessionID: project.ID,
		Path:             relPath,
		CreatedAt:        utcNow(),
	}
	if content, err := gitOutputBytes(project.ProjectRoot, "show", "HEAD:"+relPath); err == nil {
		payload.Existed = true
		payload.Mode = uint32(gitFileMode(project.ProjectRoot, relPath))
		if payload.Mode == 0 {
			payload.Mode = 0o644
		}
		payload.OriginalHash = contentHash(content)
		payload.ContentBase64 = base64.StdEncoding.EncodeToString(content)
	} else {
		payload.Existed = false
		payload.OriginalHash = "missing"
	}
	if err := writePatchCheckpointPayload(project.ProjectRoot, payload); err != nil {
		return "", err
	}
	return payload.ID, nil
}

func gitFileMode(projectRoot string, relPath string) os.FileMode {
	output, err := gitOutput(projectRoot, "ls-tree", "HEAD", "--", relPath)
	if err != nil {
		return 0
	}
	fields := strings.Fields(output)
	if len(fields) < 1 {
		return 0
	}
	switch fields[0] {
	case "100755":
		return 0o755
	case "100644":
		return 0o644
	default:
		return 0
	}
}

func agentWorktreeDiff(projectRoot string) (string, error) {
	tracked, err := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff")
	if err != nil {
		return "", err
	}
	untracked, err := gitOutput(projectRoot, "ls-files", "--others", "--exclude-standard")
	if err != nil {
		return "", err
	}
	var b strings.Builder
	if strings.TrimSpace(tracked) != "" {
		b.WriteString(ensurePatchTrailingNewline(tracked))
	}
	for _, relPath := range filterAgentInternalPaths(nonEmptyLines(untracked)) {
		patch, patchErr := untrackedFilePatch(projectRoot, relPath)
		if patchErr != nil {
			return "", patchErr
		}
		if patch != "" {
			b.WriteString(patch)
		}
	}
	return b.String(), nil
}

func reverseAgentWorktreeDiff(projectRoot string) string {
	output, err := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff", "--reverse")
	if err != nil {
		return ""
	}
	return ensurePatchTrailingNewline(output)
}

func untrackedFilePatch(projectRoot string, relPath string) (string, error) {
	relPath, ok := normalizePatchPath(relPath)
	if !ok {
		return "", fmt.Errorf("unsafe untracked path: %s", relPath)
	}
	if toolPathLooksSensitive(relPath) {
		return "", fmt.Errorf("untracked agent file is sensitive: %s", relPath)
	}
	if toolPathLooksBinaryByExtension(relPath) {
		return "", fmt.Errorf("untracked agent file appears binary: %s", relPath)
	}
	absPath, err := safeProjectPath(projectRoot, relPath)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("untracked agent target is not a regular file: %s", relPath)
	}
	if info.Size() > maxPatchPreviewBytes {
		return "", fmt.Errorf("untracked agent file exceeds preview limit: %s", relPath)
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}
	if bytes.IndexByte(content, 0) >= 0 {
		return "", fmt.Errorf("untracked agent file appears binary: %s", relPath)
	}
	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	mode := "100644"
	if info.Mode().Perm()&0o111 != 0 {
		mode = "100755"
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("diff --git a/%s b/%s\n", relPath, relPath))
	b.WriteString(fmt.Sprintf("new file mode %s\n", mode))
	b.WriteString("index 0000000..")
	b.WriteString(contentHash(content)[:7])
	b.WriteString("\n--- /dev/null\n")
	b.WriteString(fmt.Sprintf("+++ b/%s\n", relPath))
	b.WriteString(fmt.Sprintf("@@ -0,0 +1,%d @@\n", len(lines)))
	for _, line := range lines {
		b.WriteString("+")
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String(), nil
}

func gitOutput(projectRoot string, args ...string) (string, error) {
	output, err := gitOutputBytes(projectRoot, args...)
	return string(output), err
}

func gitOutputBytes(projectRoot string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", projectRoot}, args...)...)
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return output, ctx.Err()
	}
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return output, fmt.Errorf("%s", message)
	}
	return output, nil
}

func agentBaselineSummary(baseline agentWorktreeBaseline) string {
	if baseline.Error != "" {
		return "baseline unavailable: " + baseline.Error
	}
	if baseline.Clean {
		return "clean worktree baseline captured"
	}
	return fmt.Sprintf("dirty baseline captured: %d status entr%s", len(baseline.StatusShort), pluralSuffix(len(baseline.StatusShort)))
}

func agentRunDisplayResponse(result agents.Result, artifact *AIChatRunArtifact) string {
	if artifact != nil && artifact.ID != "" {
		return "External agent completed and Arlecchino captured a reviewable direct diff artifact."
	}
	if strings.TrimSpace(result.Message) != "" {
		return sanitizedDisplayText(result.Message)
	}
	if strings.TrimSpace(result.Transcript) != "" {
		return compactTranscriptSummary(result.Transcript)
	}
	return "External agent run completed."
}

func compactTranscriptSummary(transcript string) string {
	lines := nonEmptyLines(transcript)
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > 4 {
		lines = lines[len(lines)-4:]
	}
	for i := range lines {
		lines[i] = sanitizedDisplayText(lines[i])
	}
	return truncateUTF8(strings.Join(lines, "\n"), 1600)
}

func nonEmptyLines(value string) []string {
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func untrackedPathsFromStatus(lines []string) []string {
	paths := []string{}
	for _, line := range lines {
		if strings.HasPrefix(line, "?? ") {
			paths = append(paths, strings.TrimSpace(strings.TrimPrefix(line, "?? ")))
		}
	}
	sort.Strings(paths)
	return paths
}

func filterAgentWorktreeStatus(lines []string) []string {
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		path := strings.TrimSpace(line)
		if len(path) > 3 {
			path = strings.TrimSpace(path[3:])
		}
		if agentInternalPath(path) {
			continue
		}
		out = append(out, line)
	}
	return out
}

func filterAgentInternalPaths(paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		if agentInternalPath(path) {
			continue
		}
		out = append(out, path)
	}
	return out
}

func agentInternalPath(path string) bool {
	path = filepath.ToSlash(strings.TrimSpace(path))
	return path == ".arlecchino" || strings.HasPrefix(path, ".arlecchino/")
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
