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
	agentRuntimeFamilyInteractiveFallback = agents.RuntimeFamilyInteractiveFallback
	agentTerminalTranscriptLimit          = 48 * 1024
	agentDescriptorProbeTimeout           = 10 * time.Second
)

type agentWorktreeBaseline struct {
	ID               string   `json:"id"`
	ProjectSessionID string   `json:"projectSessionId"`
	ProjectPathHash  string   `json:"projectPathHash"`
	Clean            bool     `json:"clean"`
	SnapshotTree     string   `json:"snapshotTree,omitempty"`
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
	ctx, cancel := context.WithTimeout(context.Background(), agentDescriptorProbeTimeout)
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
	if isExternalAgentRuntimeFamily(descriptor.RuntimeFamily) {
		return true
	}
	return descriptor.EndpointClass == agents.EndpointClassExternalAccount || descriptor.ExternalAccount
}

func isExternalAgentRuntimeFamily(runtimeFamily string) bool {
	switch strings.TrimSpace(runtimeFamily) {
	case agents.RuntimeFamilyStructuredAgent, agents.RuntimeFamilyJSONLExec, agents.RuntimeFamilyInteractiveFallback:
		return true
	default:
		return false
	}
}

func resolveExternalAgentAccountSelection(req AIChatRunRequest, descriptor providers.AIProviderDescriptor) (string, string, error) {
	modelID := strings.TrimSpace(firstNonEmpty(req.Model, descriptor.DefaultModel))
	models := descriptor.Models
	if len(models) == 0 {
		if descriptor.Status == providers.ProviderStatusNeedsAuth || strings.TrimSpace(descriptor.AuthStatus) == "needs_auth" {
			return "", "", fmt.Errorf("sign in to %s before selecting account models", firstNonEmpty(descriptor.Name, descriptor.ID))
		}
		return "", "", fmt.Errorf("%s account model catalog is unavailable", firstNonEmpty(descriptor.Name, descriptor.ID))
	}
	if modelID == "" {
		modelID = strings.TrimSpace(models[0].ID)
	}
	for _, model := range models {
		if strings.TrimSpace(model.ID) != modelID {
			continue
		}
		reasoningEffort := normalizeReasoningEffort(req.ReasoningEffort)
		if reasoningEffort != "" && !reasoningEffortAllowedForModel(reasoningEffort, model) {
			return "", "", fmt.Errorf("reasoning effort %q is not available for model %q on this account", reasoningEffort, modelID)
		}
		return modelID, reasoningEffort, nil
	}
	return "", "", fmt.Errorf("model %q is not available in %s account model catalog", modelID, firstNonEmpty(descriptor.Name, descriptor.ID))
}

func reasoningEffortAllowedForModel(effort string, model providers.AIModelDescriptor) bool {
	effort = normalizeReasoningEffort(effort)
	if effort == "" {
		return true
	}
	for _, candidate := range model.ReasoningEfforts {
		if normalizeReasoningEffort(candidate) == effort {
			return true
		}
	}
	return false
}

func agentRuntimeFamilyForDescriptor(descriptor providers.AIProviderDescriptor) string {
	switch strings.TrimSpace(descriptor.RuntimeFamily) {
	case agents.RuntimeFamilyStructuredAgent, agents.RuntimeFamilyJSONLExec, agents.RuntimeFamilyInteractiveFallback:
		return strings.TrimSpace(descriptor.RuntimeFamily)
	case agents.ProviderKindExternalAgentCLI:
		return agents.RuntimeFamilyInteractiveFallback
	default:
		if descriptor.EndpointClass == agents.EndpointClassExternalAccount || descriptor.ExternalAccount {
			return agents.RuntimeFamilyJSONLExec
		}
		return agents.RuntimeFamilyStructuredAgent
	}
}

func agentRuntimeFamilyForRun(req AIChatRunRequest, descriptor providers.AIProviderDescriptor) string {
	requested := strings.TrimSpace(req.RuntimeFamily)
	if requested == agents.ProviderKindExternalAgentCLI {
		return agents.RuntimeFamilyInteractiveFallback
	}
	if requested != "" && isExternalAgentRuntimeFamily(requested) {
		return requested
	}
	return agentRuntimeFamilyForDescriptor(descriptor)
}

func agentTransportForRuntimeFamily(runtimeFamily string) string {
	switch strings.TrimSpace(runtimeFamily) {
	case agents.RuntimeFamilyStructuredAgent:
		return agents.TransportAppServerSTDIO
	case agents.RuntimeFamilyJSONLExec:
		return agents.TransportJSONLExec
	case agents.RuntimeFamilyInteractiveFallback, agents.ProviderKindExternalAgentCLI:
		return agents.TransportPTYFallback
	default:
		return agents.TransportJSONLExec
	}
}

func agentTransportForRun(runtimeFamily string, descriptor providers.AIProviderDescriptor) string {
	if strings.TrimSpace(descriptor.Transport) != "" && strings.TrimSpace(descriptor.RuntimeFamily) == strings.TrimSpace(runtimeFamily) {
		return strings.TrimSpace(descriptor.Transport)
	}
	return agentTransportForRuntimeFamily(runtimeFamily)
}

func newAIRuntimeProofSummary(descriptor providers.AIProviderDescriptor, runtimeFamily string, transport string, model string, action AIChatAction, status string, reasoningEfforts ...string) *AIExternalAgentRunSummary {
	if transport == "" {
		transport = agentTransportForRuntimeFamily(runtimeFamily)
	}
	if status == "" {
		status = "starting"
	}
	model = firstNonEmpty(model, descriptor.DefaultModel)
	reasoningEffort := ""
	if len(reasoningEfforts) > 0 {
		reasoningEffort = normalizeReasoningEffort(reasoningEfforts[0])
	}
	promptTransport := "provider_request"
	switch strings.TrimSpace(transport) {
	case agents.TransportAppServerSTDIO:
		promptTransport = "stdio_jsonrpc_no_argv"
	case agents.TransportJSONLExec:
		promptTransport = "stdin_jsonl_no_argv"
	case agents.TransportModelAPI:
		promptTransport = "model_api_request"
	case agents.TransportPTYFallback:
		promptTransport = "interactive_terminal_fallback"
	case agents.TransportHTTPServerSSE:
		promptTransport = "http_sse_request_no_argv"
	}
	consentStatus := "pending"
	if runtimeFamily == agents.RuntimeFamilyModelAgent {
		consentStatus = "accepted"
	}
	artifactState := "not_required"
	if action == AIChatActionBuild {
		artifactState = "pending"
	}
	return &AIExternalAgentRunSummary{
		RuntimeID:          descriptor.ID,
		ProviderID:         descriptor.ID,
		Model:              model,
		ReasoningEffort:    reasoningEffort,
		RuntimeFamily:      runtimeFamily,
		Transport:          transport,
		EndpointClass:      firstNonEmpty(descriptor.EndpointClass, descriptor.Endpoint),
		RuntimeBinary:      descriptor.Binary,
		RuntimeVersion:     descriptor.RuntimeVersion,
		AdapterVersion:     firstNonEmpty(descriptor.AdapterVersion, "arlecchino-runtime-v1"),
		ProtocolVersion:    firstNonEmpty(descriptor.ProtocolVersion, descriptor.Kind),
		CompatibilityRange: descriptor.CompatibilityRange,
		AuthStatus:         descriptor.AuthStatus,
		Status:             status,
		HealthStatus:       status,
		ProofState:         status,
		PreflightStatus:    "pending",
		ConsentStatus:      consentStatus,
		ToolPolicy:         "arlecchino_approval_gateway",
		SandboxPolicy:      agentSandboxPolicyForProof(action, runtimeFamily),
		ArtifactState:      artifactState,
		PromptTransport:    promptTransport,
		FallbackRuntime:    runtimeFamily == agents.RuntimeFamilyInteractiveFallback || transport == agents.TransportPTYFallback,
		SourceLinks:        descriptor.SourceLinks,
	}
}

func agentSandboxPolicyForProof(action AIChatAction, runtimeFamily string) string {
	if runtimeFamily == agents.RuntimeFamilyModelAgent {
		switch action {
		case AIChatActionBuild:
			return "arlecchino_tool_approval_required"
		case AIChatActionDebug:
			return "read_only_command_approval_required"
		default:
			return "read_only"
		}
	}
	switch action {
	case AIChatActionBuild:
		return "workspace_write_after_agent_consent"
	case AIChatActionDebug:
		return "read_only_command_approval_required"
	default:
		return "read_only"
	}
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
		RuntimeFamily:    agentRuntimeFamilyInteractiveFallback,
		ProviderID:       descriptor.ID,
		Model:            descriptor.DefaultModel,
		UserPrompt:       "Sign in to " + firstNonEmpty(descriptor.Name, descriptor.ID),
		AgentRuntime:     newAIRuntimeProofSummary(descriptor, agentRuntimeFamilyInteractiveFallback, agents.TransportPTYFallback, descriptor.DefaultModel, AIChatActionAsk, "starting"),
		CanCancel:        true,
		Revision:         1,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	run.AgentRuntime.Operation = "auth_login"
	run.AgentRuntime.AuthFlow = true
	run.AgentRuntime.ConsentStatus = "not_required"
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
		Source:           "interactive_fallback_runtime",
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
		"runtimeFamily": agentRuntimeFamilyInteractiveFallback,
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
	runtimeFamily := agentRuntimeFamilyForRun(req, descriptor)
	transport := agentTransportForRun(runtimeFamily, descriptor)
	s.updateRun(runID, func(run *AIChatRun) {
		run.RuntimeFamily = runtimeFamily
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
		run.ReasoningEffort = req.ReasoningEffort
		run.AgentRuntime = newAIRuntimeProofSummary(descriptor, runtimeFamily, transport, run.Model, req.Action, "starting", req.ReasoningEffort)
	})
	s.emitRunEnvelope(project.ID, runID)

	if !agentSupportsAction(descriptor, req.Action) {
		s.finishRunError(runID, fmt.Sprintf("agent runtime %s does not support %s mode", descriptor.Name, req.Action))
		return
	}
	record := s.startAgentEgressRecord(project, runID, req, descriptor, snapshot)
	if !normalizeConsentPolicy(s.currentSettings().ConsentPolicy).ExternalAgentCLIAccepted {
		s.finishExternalAgentConsentBlocked(project, runID, record)
		return
	}
	baseline := captureAgentWorktreeBaseline(project)
	if baseline.Error == "" {
		s.recordChatRunArtifact(project, runID, AIChatRunArtifactAgentWorktree, "Agent worktree baseline", agentBaselineSummary(baseline), baseline)
	} else {
		s.recordAgentWorktreeBaselineDiagnostic(project, runID, req, baseline)
	}
	s.updateRun(runID, func(run *AIChatRun) {
		if run.AgentRuntime != nil {
			run.AgentRuntime.BaselineID = baseline.ID
			run.AgentRuntime.Status = "running"
			run.AgentRuntime.HealthStatus = "running"
			run.AgentRuntime.ProofState = "running"
			if baseline.Error == "" {
				run.AgentRuntime.PreflightStatus = "baseline_captured"
			} else {
				run.AgentRuntime.PreflightStatus = "baseline_unavailable"
			}
			run.AgentRuntime.ConsentStatus = "accepted"
		}
	})
	s.emitRunEnvelope(project.ID, runID)

	started := time.Now()
	agentPrompt := buildExternalAgentPrompt(req, snapshot, contextSummary)
	result := adapter.Run(ctx, agents.RunRequest{
		RunID:           runID,
		SessionID:       normalizeChatSessionID(req.SessionID),
		ProjectRoot:     project.ProjectRoot,
		Action:          string(req.Action),
		Prompt:          agentPrompt,
		Model:           firstNonEmpty(req.Model, descriptor.DefaultModel),
		ReasoningEffort: req.ReasoningEffort,
		RuntimeFamily:   runtimeFamily,
		Transport:       transport,
		Rows:            34,
		Cols:            116,
		DataCategories:  snapshot.DataCategories,
		RegisterInput:   s.registerAgentTerminalIO,
	}, func(event agents.Event) {
		s.handleAgentRuntimeEvent(project, runID, event)
	})
	s.registerAgentTerminalIO(runID, nil, nil)

	record.LatencyMs = time.Since(started).Milliseconds()
	if result.Status == "canceled" || ctx.Err() != nil || s.runIsCanceled(runID) {
		record.Status = "canceled"
		record.Canceled = true
		record.ErrorClass = agents.FailureCanceled
		record = s.storeAgentEgressRecord(project, runID, record)
		transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "canceled"
				run.AgentRuntime.HealthStatus = "canceled"
				run.AgentRuntime.ProofState = "canceled"
				run.AgentRuntime.FailureCode = agents.FailureCanceled
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
			}
		})
		s.finishRunCanceled(runID, record)
		return
	}
	if result.Status == "error" {
		record.Status = "error"
		record.ErrorClass = firstNonEmpty(agentFailureCodeForResult(result), errorClass(fmt.Errorf("%s", result.Error)))
		record = s.storeAgentEgressRecord(project, runID, record)
		transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "error"
				run.AgentRuntime.HealthStatus = "error"
				run.AgentRuntime.ProofState = "error"
				run.AgentRuntime.FailureCode = record.ErrorClass
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
			}
		})
		s.finishRunError(runID, firstNonEmpty(result.Error, "agent CLI run failed"))
		return
	}
	if !s.agentRuntimeHasProviderEvent(runID) {
		record.Status = "blocked"
		record.ErrorClass = agents.FailureRuntimeUnhealthy
		record = s.storeAgentEgressRecord(project, runID, record)
		transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.HealthStatus = "blocked"
				run.AgentRuntime.ProofState = "blocked"
				run.AgentRuntime.FailureCode = agents.FailureRuntimeUnhealthy
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
				run.AgentRuntime.BlockedReason = "runtime completed without a provider event"
			}
		})
		s.finishRunError(runID, "Runtime completed without proof that the selected provider emitted an event")
		return
	}

	record.Status = "completed"
	record = s.storeAgentEgressRecord(project, runID, record)
	transcriptID := s.recordAgentTranscriptArtifact(project, runID, result)
	diffArtifact, diffErr := s.recordAgentCapturedDiff(project, runID, req, baseline)
	if diffErr != nil {
		record.Status = "blocked"
		record.ErrorClass = agents.FailurePatchCaptureFailed
		record = s.storeAgentEgressRecord(project, runID, record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.HealthStatus = "blocked"
				run.AgentRuntime.ProofState = "blocked"
				run.AgentRuntime.FailureCode = agents.FailurePatchCaptureFailed
				run.AgentRuntime.ArtifactState = "capture_failed"
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
				run.AgentRuntime.BlockedReason = diffErr.Error()
			}
		})
		s.finishRunError(runID, diffErr.Error())
		return
	}
	if req.Action == AIChatActionBuild && diffArtifact.ID == "" {
		evidenceState := s.agentRuntimeArtifactState(runID)
		if buildEvidenceArtifactStateAccepted(evidenceState) {
			s.recordAgentBuildEvidenceArtifact(project, runID, req, result, evidenceState)
			s.updateRun(runID, func(run *AIChatRun) {
				if run.AgentRuntime != nil {
					run.AgentRuntime.ArtifactState = evidenceState
				}
			})
			s.finishAgentRunCompleted(project, runID, req, descriptor, record, result, transcriptID, diffArtifact)
			return
		}
		if agentBaselineGitUnavailable(baseline.Error) {
			s.updateRun(runID, func(run *AIChatRun) {
				if run.AgentRuntime != nil {
					run.AgentRuntime.ArtifactState = "baseline_unavailable"
				}
			})
			s.finishAgentRunCompleted(project, runID, req, descriptor, record, result, transcriptID, diffArtifact)
			return
		}
		record.Status = "blocked"
		record.ErrorClass = agents.FailureBuildArtifactMissing
		record = s.storeAgentEgressRecord(project, runID, record)
		s.updateRun(runID, func(run *AIChatRun) {
			run.EgressRecordID = record.ID
			run.Response = agentRunDisplayResponse(result, nil)
			if run.AgentRuntime != nil {
				run.AgentRuntime.Status = "blocked"
				run.AgentRuntime.HealthStatus = "blocked"
				run.AgentRuntime.ProofState = "blocked"
				run.AgentRuntime.FailureCode = agents.FailureBuildArtifactMissing
				run.AgentRuntime.ArtifactState = "missing"
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

func (s *Service) blockExternalAgentConsent(project *ProjectSession, runID string, req AIChatRunRequest, snapshot AIContextSnapshot, descriptor providers.AIProviderDescriptor) {
	runtimeFamily := agentRuntimeFamilyForRun(req, descriptor)
	transport := agentTransportForRun(runtimeFamily, descriptor)
	s.updateRun(runID, func(run *AIChatRun) {
		run.RuntimeFamily = runtimeFamily
		run.ProviderID = descriptor.ID
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
		run.ReasoningEffort = req.ReasoningEffort
		run.AgentRuntime = newAIRuntimeProofSummary(descriptor, runtimeFamily, transport, run.Model, req.Action, "blocked", req.ReasoningEffort)
	})
	record := s.startAgentEgressRecord(project, runID, req, descriptor, snapshot)
	s.finishExternalAgentConsentBlocked(project, runID, record)
}

func (s *Service) finishExternalAgentConsentBlocked(project *ProjectSession, runID string, record AIEgressRecord) {
	record.Status = "blocked"
	record.ErrorClass = agents.FailureConsentRequired
	record = s.storeAgentEgressRecord(project, runID, record)
	s.updateRun(runID, func(run *AIChatRun) {
		run.EgressRecordID = record.ID
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "blocked"
			run.AgentRuntime.HealthStatus = "blocked"
			run.AgentRuntime.ProofState = "blocked"
			run.AgentRuntime.FailureCode = agents.FailureConsentRequired
			run.AgentRuntime.ConsentStatus = "blocked"
			run.AgentRuntime.BlockedReason = "external agent CLI consent required"
		}
	})
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactEgress, "External agent egress blocked", "External agent CLI consent is required before context is sent.", record)
	s.finishRunError(runID, "external agent CLI consent is required before sending context to this provider-owned CLI")
}

func (s *Service) runExternalAgentAuth(ctx context.Context, project *ProjectSession, runID string, authRunner agents.AuthRunner, adapter agents.Adapter, descriptor providers.AIProviderDescriptor) {
	s.updateRun(runID, func(run *AIChatRun) {
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "running"
			run.AgentRuntime.HealthStatus = "running"
			run.AgentRuntime.ProofState = "running"
			run.AgentRuntime.PreflightStatus = "interactive_fallback_started"
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
				run.AgentRuntime.HealthStatus = "canceled"
				run.AgentRuntime.ProofState = "canceled"
				run.AgentRuntime.FailureCode = agents.FailureCanceled
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
			}
		})
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        defaultChatSessionID,
			ProjectSessionID: project.ID,
			Source:           "agent_runtime",
			Type:             "auth_completed",
			Status:           "canceled",
			Actor:            "system",
			ProviderID:       descriptor.ID,
			Model:            descriptor.DefaultModel,
			Capability:       providers.CapabilityChat,
			Summary:          "Interactive fallback authentication canceled.",
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
				run.AgentRuntime.HealthStatus = "error"
				run.AgentRuntime.ProofState = "error"
				run.AgentRuntime.FailureCode = agentFailureCodeForResult(result)
				run.AgentRuntime.ExitCode = result.ExitCode
				run.AgentRuntime.TranscriptID = transcriptID
				run.AgentRuntime.BlockedReason = sanitizedDisplayText(message)
			}
		})
		s.recordRunTimeline(project, AIRunTimelineEvent{
			RunID:            runID,
			SessionID:        defaultChatSessionID,
			ProjectSessionID: project.ID,
			Source:           "agent_runtime",
			Type:             "auth_completed",
			Status:           "error",
			Actor:            "system",
			ProviderID:       descriptor.ID,
			Model:            descriptor.DefaultModel,
			Capability:       providers.CapabilityChat,
			Summary:          "Interactive fallback authentication failed.",
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
			run.AgentRuntime.HealthStatus = "completed"
			run.AgentRuntime.ProofState = "proved"
			run.AgentRuntime.ProofReason = "interactive auth completed through fallback runtime"
			run.AgentRuntime.ArtifactState = "transcript_evidence"
			run.AgentRuntime.AuthStatus = authStatus
			run.AgentRuntime.ExitCode = result.ExitCode
			run.AgentRuntime.TranscriptID = transcriptID
		}
	})
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        defaultChatSessionID,
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             "auth_completed",
		Status:           "completed",
		Actor:            "system",
		ProviderID:       descriptor.ID,
		Model:            descriptor.DefaultModel,
		Capability:       providers.CapabilityChat,
		Summary:          fmt.Sprintf("Interactive fallback authentication completed in %d ms.", latencyMs),
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
	ctx, cancel := context.WithTimeout(context.Background(), agentDescriptorProbeTimeout)
	defer cancel()
	s.emitEvent("ai:provider:status", agents.DescriptorToProvider(adapter.Descriptor(ctx)))
	s.mu.Lock()
	delete(s.runCancels, runID)
	s.mu.Unlock()
}

func (s *Service) handleAgentRuntimeEvent(project *ProjectSession, runID string, event agents.Event) {
	s.updateAgentRuntimeProofFromEvent(runID, event)
	if event.Type == agents.EventTerminalData {
		s.emitEvent("ai:agent:terminal-data", map[string]any{
			"runId":            runID,
			"projectSessionId": project.ID,
			"data":             string(event.Data),
			"createdAt":        event.CreatedAt,
		})
		return
	}
	if event.Type == agents.EventMessage {
		if event.Text != "" && event.Status == "message.delta" {
			token := sanitizedDisplayChunk(event.Text)
			if token == "" {
				return
			}
			s.emitEvent("ai:chat:token", map[string]any{"runId": runID, "token": token})
			s.updateRun(runID, func(run *AIChatRun) {
				run.Response += token
			})
			return
		}
	}
	if shouldDropAgentRuntimeStatusEvent(event) {
		return
	}
	s.emitEvent("ai:agent:status", map[string]any{
		"runId":            runID,
		"projectSessionId": project.ID,
		"type":             event.Type,
		"status":           event.Status,
		"text":             sanitizedDisplayText(event.Text),
		"payload":          event.Payload,
		"createdAt":        event.CreatedAt,
	})
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             string(event.Type),
		Status:           string(event.Status),
		Actor:            "agent",
		Summary:          sanitizedDisplayText(event.Text),
	})
}

func shouldDropAgentRuntimeStatusEvent(event agents.Event) bool {
	if event.Type != agents.EventStatus {
		return false
	}
	status := strings.ToLower(strings.TrimSpace(event.Status))
	if status == "" {
		return false
	}
	return strings.Contains(status, "delta") ||
		strings.Contains(status, "transcript/chunk") ||
		strings.Contains(status, "command/output") ||
		strings.Contains(status, "exec/output")
}

func (s *Service) updateAgentRuntimeProofFromEvent(runID string, event agents.Event) {
	status := strings.TrimSpace(event.Status)
	if status == "" {
		status = string(event.Type)
	}
	createdAt := firstNonEmpty(event.CreatedAt, utcNow())
	s.updateRun(runID, func(run *AIChatRun) {
		if run.AgentRuntime == nil {
			return
		}
		proof := run.AgentRuntime
		if proof.FirstEventAt == "" {
			proof.FirstEventAt = createdAt
			proof.FirstEventType = status
		}
		proof.LastEventAt = createdAt
		if status == "runtime_proof" && proof.PreflightStatus == "pending" {
			proof.PreflightStatus = "process_started"
		}
		if status == "first_provider_event" {
			proof.PreflightStatus = "first_provider_event"
		}
		if event.Type == agents.EventError {
			proof.HealthStatus = "error"
			proof.ProofState = "error"
		}
		if strings.Contains(status, "blocked") {
			proof.HealthStatus = "blocked"
			proof.ProofState = "blocked"
		}
		if value := runtimePayloadString(event.Payload, "transport"); value != "" {
			proof.Transport = value
		}
		if value := runtimePayloadString(event.Payload, "protocol"); value != "" {
			proof.ProtocolVersion = value
		}
		if value := runtimePayloadString(event.Payload, "sandbox"); value != "" {
			proof.SandboxPolicy = value
		}
		if value := runtimePayloadString(event.Payload, "sandboxPolicy"); value != "" {
			proof.SandboxPolicy = value
		}
		if value := runtimePayloadString(event.Payload, "failureCode"); value != "" {
			proof.FailureCode = value
		}
		if value := runtimePayloadString(event.Payload, "artifactState"); value != "" {
			proof.ArtifactState = value
		}
		if value := runtimePayloadString(event.Payload, "proofState"); value != "" {
			proof.ProofState = value
		}
		if value := runtimePayloadString(event.Payload, "proofReason"); value != "" {
			proof.ProofReason = sanitizedDisplayText(value)
		}
		if value := runtimePayloadString(event.Payload, "threadId"); value != "" {
			proof.ThreadID = value
		} else if value := runtimePayloadString(event.Payload, "thread_id"); value != "" {
			proof.ThreadID = value
		} else if value := runtimePayloadPathString(event.Payload, "thread", "id"); value != "" {
			proof.ThreadID = value
		}
		if value := runtimePayloadString(event.Payload, "turnId"); value != "" {
			proof.TurnID = value
		} else if value := runtimePayloadString(event.Payload, "turn_id"); value != "" {
			proof.TurnID = value
		} else if value := runtimePayloadPathString(event.Payload, "turn", "id"); value != "" {
			proof.TurnID = value
		}
	})
}

func runtimePayloadString(payload map[string]any, key string) string {
	if len(payload) == 0 || key == "" {
		return ""
	}
	value, ok := payload[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case bool:
		return fmt.Sprintf("%t", typed)
	case int, int64, float64:
		return strings.TrimSpace(fmt.Sprint(typed))
	default:
		return ""
	}
}

func runtimePayloadPathString(payload map[string]any, path ...string) string {
	if len(payload) == 0 || len(path) == 0 {
		return ""
	}
	var current any = payload
	for _, segment := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = object[segment]
	}
	switch typed := current.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func (s *Service) agentRuntimeArtifactState(runID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.runs == nil {
		return ""
	}
	run := s.runs[runID]
	if run == nil || run.AgentRuntime == nil {
		return ""
	}
	return strings.TrimSpace(run.AgentRuntime.ArtifactState)
}

func (s *Service) agentRuntimeHasProviderEvent(runID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.runs == nil {
		return false
	}
	run := s.runs[runID]
	if run == nil || run.AgentRuntime == nil {
		return false
	}
	return strings.TrimSpace(run.AgentRuntime.PreflightStatus) == "first_provider_event"
}

func buildEvidenceArtifactStateAccepted(state string) bool {
	switch strings.TrimSpace(state) {
	case "explicit_no_change", "diagnostic_evidence", "test_evidence":
		return true
	default:
		return false
	}
}

func buildArtifactStateCanCompleteWithoutPatch(state string) bool {
	if buildEvidenceArtifactStateAccepted(state) {
		return true
	}
	switch strings.TrimSpace(state) {
	case "baseline_unavailable", "no_patch_artifact", "not_required":
		return true
	default:
		return false
	}
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
		ReasoningEffort:  req.ReasoningEffort,
		Capability:       providers.CapabilityChat,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Status:           "started",
		OptInSource:      "agent_runtime",
		CreatedAt:        utcNow(),
		RunID:            runID,
		Source:           "agent_runtime",
		ChatAction:       req.Action,
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             "provider_request",
		Status:           "started",
		Actor:            "agent",
		ProviderID:       descriptor.ID,
		Model:            record.Model,
		CorrelationID:    requestID,
		Capability:       providers.CapabilityChat,
		DataCategories:   snapshot.DataCategories,
		Redaction:        snapshot.Redaction,
		Summary:          "Agent runtime request started.",
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
	transport := firstNonEmpty(result.Transport, agents.TransportPTYFallback)
	payload := map[string]any{
		"transport":  transport,
		"status":     result.Status,
		"exitCode":   result.ExitCode,
		"startedAt":  result.StartedAt,
		"finishedAt": result.FinishedAt,
		"transcript": transcript,
	}
	title := "Agent runtime transcript"
	summary := "Redacted bounded runtime evidence from the selected agent transport."
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactAgentTerminal, title, summary, payload)
	return "artifact-" + shortHash(runID+":"+string(AIChatRunArtifactAgentTerminal)+":"+title)
}

func (s *Service) recordAgentWorktreeBaselineDiagnostic(project *ProjectSession, runID string, req AIChatRunRequest, baseline agentWorktreeBaseline) {
	if s == nil || project == nil || strings.TrimSpace(baseline.Error) == "" {
		return
	}
	status := "diagnostic"
	summary := "Agent worktree baseline unavailable: " + sanitizedDisplayText(baseline.Error)
	if agentBaselineGitUnavailable(baseline.Error) {
		status = "skipped"
		summary = "Git worktree baseline skipped because this project is not a Git repository."
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             "worktree_baseline",
		Status:           status,
		Actor:            "system",
		Capability:       providers.CapabilityChat,
		Summary:          summary,
	})
}

func (s *Service) recordAgentBuildEvidenceArtifact(project *ProjectSession, runID string, req AIChatRunRequest, result agents.Result, evidenceState string) {
	payload := map[string]any{
		"artifactState": evidenceState,
		"transport":     firstNonEmpty(result.Transport, agents.TransportPTYFallback),
		"status":        result.Status,
		"message":       sanitizedDisplayText(result.Message),
		"action":        req.Action,
		"createdAt":     utcNow(),
	}
	title := "Agent Build evidence"
	summary := "Build completed with typed runtime evidence instead of file changes."
	switch strings.TrimSpace(evidenceState) {
	case "explicit_no_change":
		summary = "Runtime reported an explicit no-change Build result."
	case "diagnostic_evidence":
		summary = "Runtime produced diagnostic evidence instead of a patch."
	case "test_evidence":
		summary = "Runtime produced test evidence instead of a patch."
	}
	s.recordChatRunArtifact(project, runID, AIChatRunArtifactAgentWorktree, title, summary, payload)
}

func (s *Service) finishAgentRunCompleted(project *ProjectSession, runID string, req AIChatRunRequest, descriptor providers.AIProviderDescriptor, record AIEgressRecord, result agents.Result, transcriptID string, diffArtifact AIChatRunArtifact) {
	response := agentRunDisplayResponse(result, &diffArtifact)
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            runID,
		SessionID:        normalizeChatSessionID(req.SessionID),
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             "run_completed",
		Status:           "completed",
		Actor:            "system",
		ProviderID:       descriptor.ID,
		Model:            firstNonEmpty(req.Model, descriptor.DefaultModel),
		Capability:       providers.CapabilityChat,
		Summary:          "Agent runtime run completed.",
	})
	s.updateRun(runID, func(run *AIChatRun) {
		run.Status = "completed"
		run.CanCancel = false
		run.Response = response
		run.ProviderID = descriptor.ID
		run.RuntimeFamily = agentRuntimeFamilyForRun(req, descriptor)
		run.Model = firstNonEmpty(req.Model, descriptor.DefaultModel)
		run.ToolProposals = nil
		run.EgressRecordID = record.ID
		if run.AgentRuntime != nil {
			run.AgentRuntime.Status = "completed"
			run.AgentRuntime.HealthStatus = "completed"
			run.AgentRuntime.ProofState = "proved"
			run.AgentRuntime.ProofReason = "runtime completed with Arlecchino envelope evidence"
			run.AgentRuntime.ExitCode = result.ExitCode
			run.AgentRuntime.TranscriptID = transcriptID
			if diffArtifact.ID != "" {
				run.AgentRuntime.CapturedDiffID = diffArtifact.ID
				run.AgentRuntime.ArtifactState = "captured_diff"
			} else if req.Action == AIChatActionBuild && buildArtifactStateCanCompleteWithoutPatch(run.AgentRuntime.ArtifactState) {
				// Keep typed no-change/diagnostic/test evidence, or an optional baseline skip captured before completion.
			} else if req.Action == AIChatActionBuild {
				run.AgentRuntime.ArtifactState = "missing"
			} else {
				run.AgentRuntime.ArtifactState = "not_required"
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

func agentFailureCodeForResult(result agents.Result) string {
	text := strings.ToLower(strings.TrimSpace(result.Error + " " + result.Message))
	switch {
	case result.Status == "canceled":
		return agents.FailureCanceled
	case strings.Contains(text, "auth") || strings.Contains(text, "login") || strings.Contains(text, "sign in"):
		return agents.FailureAuthRequired
	case strings.Contains(text, "quota") || strings.Contains(text, "billing") || strings.Contains(text, "payment"):
		return agents.FailureQuotaOrBillingBlocked
	case strings.Contains(text, "protected") || strings.Contains(text, "secret") || strings.Contains(text, "credential"):
		return agents.FailureProtectedResourceDenied
	case strings.Contains(text, "unsupported") || strings.Contains(text, "not found") || strings.Contains(text, "unavailable") || strings.Contains(text, "gated"):
		return agents.FailureRuntimeUnavailable
	case strings.Contains(text, "malformed") || strings.Contains(text, "protocol") || strings.Contains(text, "json"):
		return agents.FailureProtocolDrift
	case strings.Contains(text, "approval") || strings.Contains(text, "permission"):
		return agents.FailureProviderApprovalBypass
	default:
		return agents.FailureProviderError
	}
}

func buildExternalAgentPrompt(req AIChatRunRequest, snapshot AIContextSnapshot, summary AIContextSummary) string {
	history := []AIChatRun{}
	contextPrompt := buildChatPromptFromSnapshot(snapshot, history)
	var b strings.Builder
	b.WriteString("You are running as a structured external agent runtime inside Arlecchino AI Chat.\n")
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
	snapshotTree, snapshotErr := captureAgentWorktreeSnapshotTree(project.ProjectRoot)
	if snapshotErr != nil {
		baseline.Error = snapshotErr.Error()
		return baseline
	}
	baseline.SnapshotTree = snapshotTree
	return baseline
}

func agentWorktreeBaselineUnchanged(projectRoot string, baseline agentWorktreeBaseline) (bool, error) {
	status, statusErr := gitOutput(projectRoot, "status", "--short", "--untracked-files=all")
	trackedDiff, trackedErr := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff")
	stagedDiff, stagedErr := gitOutput(projectRoot, "diff", "--cached", "--binary", "--no-ext-diff")
	if statusErr != nil || trackedErr != nil || stagedErr != nil {
		return false, firstNonNilError(statusErr, trackedErr, stagedErr)
	}
	return stringSlicesEqual(filterAgentWorktreeStatus(nonEmptyLines(status)), baseline.StatusShort) &&
		shortHash(trackedDiff) == baseline.TrackedDiffHash &&
		shortHash(stagedDiff) == baseline.StagedDiffHash, nil
}

func (s *Service) recordAgentCapturedDiff(project *ProjectSession, runID string, req AIChatRunRequest, baseline agentWorktreeBaseline) (AIChatRunArtifact, error) {
	if baseline.Error != "" {
		if agentBaselineGitUnavailable(baseline.Error) {
			return AIChatRunArtifact{}, nil
		}
		unchanged, unchangedErr := agentWorktreeBaselineUnchanged(project.ProjectRoot, baseline)
		if unchangedErr == nil && unchanged {
			return AIChatRunArtifact{}, nil
		}
		return s.recordBlockedCapturedDiff(project, runID, req, "", baseline, baseline.Error), fmt.Errorf("agent worktree baseline failed: %s", baseline.Error)
	}
	diff, err := agentWorktreeDiff(project.ProjectRoot, baseline)
	if err != nil {
		return AIChatRunArtifact{}, err
	}
	if strings.TrimSpace(diff) == "" {
		return AIChatRunArtifact{}, nil
	}
	files, validateErr := s.validatePatchFiles(project, diff)
	if validateErr != nil {
		return s.recordBlockedCapturedDiff(project, runID, req, diff, baseline, validateErr.Error()), validateErr
	}
	artifactID := "patch-" + uuid.NewString()
	checkpointIDs := make([]string, 0, len(files))
	for _, file := range files {
		checkpointID, checkpointErr := createGitBaselineCheckpoint(project, artifactID, file.Path, baseline.SnapshotTree)
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
		ReverseDiff:    reverseAgentWorktreeDiff(project.ProjectRoot, baseline),
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
	s.emitAgentCapturedDiffAppliedEvents(project, artifact, files, now)
	return artifact, nil
}

func agentBaselineGitUnavailable(value string) bool {
	text := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(text, "not a git repository")
}

func (s *Service) emitAgentCapturedDiffAppliedEvents(project *ProjectSession, artifact AIChatRunArtifact, files []AIPatchFile, appliedAt string) {
	if s == nil || project == nil || len(files) == 0 {
		return
	}
	eventFiles := make([]map[string]any, 0, len(files))
	for _, file := range files {
		absPath, err := safeProjectPath(project.ProjectRoot, file.Path)
		if err != nil {
			continue
		}
		eventFiles = append(eventFiles, map[string]any{
			"path":         file.Path,
			"absolutePath": absPath,
			"status":       file.Status,
			"created":      !file.Exists,
		})
		if file.Exists {
			s.emitEvent("file:changed", absPath)
		} else {
			s.emitEvent("project:entry:created", map[string]any{
				"path":        absPath,
				"isDirectory": false,
			})
		}
	}
	if len(eventFiles) == 0 {
		return
	}
	s.emitEvent("ai:patch:artifact-applied", map[string]any{
		"artifactId":       artifact.ID,
		"runId":            artifact.RunID,
		"sessionId":        artifact.SessionID,
		"projectSessionId": project.ID,
		"appliedAt":        appliedAt,
		"source":           "captured_direct_write",
		"files":            eventFiles,
	})
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            artifact.RunID,
		SessionID:        normalizeChatSessionID(artifact.SessionID),
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             "patch_captured",
		Status:           "applied",
		Actor:            "agent",
		ArtifactID:       artifact.ID,
		Summary:          fmt.Sprintf("Captured already-applied agent diff for %d file(s).", len(eventFiles)),
	})
	if strings.TrimSpace(artifact.RunID) != "" {
		s.emitRunEnvelope(project.ID, artifact.RunID)
	}
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

func createGitBaselineCheckpoint(project *ProjectSession, artifactID string, relPath string, treeish string) (string, error) {
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
	treeish = firstNonEmpty(strings.TrimSpace(treeish), "HEAD")
	if content, err := gitOutputBytes(project.ProjectRoot, "show", treeish+":"+relPath); err == nil {
		payload.Existed = true
		payload.Mode = uint32(gitFileMode(project.ProjectRoot, treeish, relPath))
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

func gitFileMode(projectRoot string, treeish string, relPath string) os.FileMode {
	treeish = firstNonEmpty(strings.TrimSpace(treeish), "HEAD")
	output, err := gitOutput(projectRoot, "ls-tree", treeish, "--", relPath)
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

func agentWorktreeDiff(projectRoot string, baseline agentWorktreeBaseline) (string, error) {
	if strings.TrimSpace(baseline.SnapshotTree) != "" {
		currentTree, err := captureAgentWorktreeSnapshotTree(projectRoot)
		if err != nil {
			return "", err
		}
		output, err := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff", baseline.SnapshotTree, currentTree)
		if err != nil {
			return "", err
		}
		return ensurePatchTrailingNewline(output), nil
	}
	return agentWorktreeDiffFromHead(projectRoot)
}

func agentWorktreeDiffFromHead(projectRoot string) (string, error) {
	tracked, err := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff", "HEAD")
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

func reverseAgentWorktreeDiff(projectRoot string, baseline agentWorktreeBaseline) string {
	if strings.TrimSpace(baseline.SnapshotTree) != "" {
		currentTree, err := captureAgentWorktreeSnapshotTree(projectRoot)
		if err != nil {
			return ""
		}
		output, err := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff", currentTree, baseline.SnapshotTree)
		if err != nil {
			return ""
		}
		return ensurePatchTrailingNewline(output)
	}
	output, err := gitOutput(projectRoot, "diff", "--binary", "--no-ext-diff", "--reverse", "HEAD")
	if err != nil {
		return ""
	}
	return ensurePatchTrailingNewline(output)
}

func captureAgentWorktreeSnapshotTree(projectRoot string) (string, error) {
	tempDir, err := os.MkdirTemp("", "arlecchino-agent-index-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tempDir)
	env := []string{
		"GIT_INDEX_FILE=" + filepath.Join(tempDir, "index"),
		"GIT_LITERAL_PATHSPECS=1",
	}
	if _, err := gitOutputWithEnv(projectRoot, env, "read-tree", "HEAD"); err != nil {
		return "", err
	}
	paths, err := agentSnapshotCandidatePaths(projectRoot)
	if err != nil {
		return "", err
	}
	if len(paths) > 0 {
		args := append([]string{"add", "-A", "--"}, paths...)
		if _, err := gitOutputWithEnv(projectRoot, env, args...); err != nil {
			return "", err
		}
	}
	tree, err := gitOutputWithEnv(projectRoot, env, "write-tree")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(tree), nil
}

func agentSnapshotCandidatePaths(projectRoot string) ([]string, error) {
	tracked, err := gitOutputBytes(projectRoot, "diff", "--name-only", "-z", "HEAD")
	if err != nil {
		return nil, err
	}
	untracked, err := gitOutputBytes(projectRoot, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	seen := map[string]struct{}{}
	paths := []string{}
	addPath := func(path string) error {
		relPath, ok := normalizePatchPath(path)
		if !ok {
			return fmt.Errorf("unsafe agent snapshot path: %s", path)
		}
		if agentInternalPath(relPath) {
			return nil
		}
		if toolPathLooksSensitive(relPath) {
			return fmt.Errorf("agent snapshot path is sensitive: %s", relPath)
		}
		if toolPathLooksBinaryByExtension(relPath) {
			return fmt.Errorf("agent snapshot path appears binary by extension: %s", relPath)
		}
		if err := validateAgentSnapshotPath(projectRoot, relPath); err != nil {
			return err
		}
		if _, exists := seen[relPath]; exists {
			return nil
		}
		seen[relPath] = struct{}{}
		paths = append(paths, relPath)
		return nil
	}
	for _, path := range nulSeparatedGitPaths(tracked) {
		if err := addPath(path); err != nil {
			return nil, err
		}
	}
	for _, path := range nulSeparatedGitPaths(untracked) {
		if err := addPath(path); err != nil {
			return nil, err
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func validateAgentSnapshotPath(projectRoot string, relPath string) error {
	absPath, err := safeProjectPath(projectRoot, relPath)
	if err != nil {
		return err
	}
	info, err := os.Lstat(absPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("agent snapshot target is not a regular file: %s", relPath)
	}
	if info.Size() > maxPatchCheckpointBytes {
		return fmt.Errorf("agent snapshot target exceeds checkpoint limit: %s", relPath)
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		return err
	}
	if bytes.IndexByte(content, 0) >= 0 {
		return fmt.Errorf("agent snapshot target appears binary: %s", relPath)
	}
	return nil
}

func nulSeparatedGitPaths(output []byte) []string {
	parts := bytes.Split(output, []byte{0})
	paths := make([]string, 0, len(parts))
	for _, part := range parts {
		path := strings.TrimSpace(string(part))
		if path != "" {
			paths = append(paths, path)
		}
	}
	return paths
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

func gitOutputWithEnv(projectRoot string, env []string, args ...string) (string, error) {
	output, err := gitOutputBytesWithEnv(projectRoot, env, args...)
	return string(output), err
}

func gitOutputBytes(projectRoot string, args ...string) ([]byte, error) {
	return gitOutputBytesWithEnv(projectRoot, nil, args...)
}

func gitOutputBytesWithEnv(projectRoot string, env []string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", projectRoot}, args...)...)
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
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
	response := ""
	if strings.TrimSpace(result.Message) != "" {
		response = sanitizedDisplayText(result.Message)
	} else if strings.TrimSpace(result.Transcript) != "" {
		response = compactTranscriptSummary(result.Transcript)
	}
	if artifact != nil && artifact.ID != "" {
		notice := "Arlecchino captured the direct file changes as a reviewable diff artifact."
		if response != "" {
			if strings.Contains(response, notice) {
				return response
			}
			return truncateUTF8(strings.TrimSpace(response)+"\n\n"+notice, 2000)
		}
		return "External agent completed. " + notice
	}
	if response != "" {
		return response
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

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func firstNonNilError(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
