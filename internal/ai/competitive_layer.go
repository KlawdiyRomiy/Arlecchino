package ai

import (
	"fmt"
	"sort"
	"strings"

	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

func (s *Service) ListModelCapabilities(projectID string) []AIModelCapabilityDescriptor {
	project := s.project(projectID)
	out := []AIModelCapabilityDescriptor{}
	for _, provider := range s.ListProviders() {
		models := provider.Models
		if len(models) == 0 && provider.DefaultModel != "" {
			models = []providers.AIModelDescriptor{{ID: provider.DefaultModel, DisplayName: provider.DefaultModel, Streaming: true}}
		}
		for _, model := range models {
			evidence := modelCapabilityEvidenceFor(provider, model)
			capability := AIModelCapabilityDescriptor{
				ProviderID:              provider.ID,
				ProviderName:            provider.Name,
				Model:                   firstNonEmpty(model.ID, provider.DefaultModel),
				Local:                   provider.Local,
				Frontier:                provider.Frontier,
				ContextWindow:           model.ContextWindow,
				Streaming:               model.Streaming,
				Capabilities:            provider.Capabilities,
				ToolSupport:             evidence.ToolSupport,
				ToolSupportKind:         evidence.ToolSupportKind,
				ToolSupportReason:       evidence.ToolSupportReason,
				StructuredOutputSupport: evidence.StructuredOutputSupport,
				PatchGenerationSupport:  evidence.PatchGenerationSupport,
				LowLatency:              evidence.LowLatency,
				CostTier:                evidence.CostTier,
				CapabilitySource:        evidence.CapabilitySource,
				VisionSupport:           false,
				CodeEditQuality:         modelCodeEditQuality(provider, model),
				RecommendedModes:        recommendedModesForProvider(provider),
			}
			if probe, ok := cachedProjectModelCapabilityProbe(project, provider.ID, capability.Model); ok && modelCapabilityProbeFresh(probe) {
				capability.ProbeStatus = probe.Status
				capability.ProbeCheckedAt = probe.CheckedAt
				capability.ProbeError = probe.Error
				capability.VerifiedToolSupport = probe.ToolSupport && probe.Status == "verified"
				if probe.Status == "verified" || probe.Status == "unsupported" {
					capability.ToolSupport = probe.ToolSupport
					capability.ToolSupportKind = firstNonEmpty(probe.ToolSupportKind, capability.ToolSupportKind)
					capability.StructuredOutputSupport = probe.StructuredOutputSupport
					capability.PatchGenerationSupport = probe.PatchGenerationSupport
					capability.CapabilitySource = "probe"
				}
			}
			out = append(out, capability)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Local != out[j].Local {
			return out[i].Local
		}
		if out[i].ToolSupport != out[j].ToolSupport {
			return out[i].ToolSupport
		}
		return out[i].ProviderName < out[j].ProviderName
	})
	return out
}

func (s *Service) PreviewBackgroundAgent(projectID string, req AIBackgroundAgentPreviewRequest) (AIBackgroundAgentPreviewResult, error) {
	project := s.project(projectID)
	if project == nil || project.ChatArtifacts == nil {
		return AIBackgroundAgentPreviewResult{}, fmt.Errorf("AI project session is not open")
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		return AIBackgroundAgentPreviewResult{}, fmt.Errorf("background agent prompt is empty")
	}
	if req.Action == "" {
		req.Action = AIChatActionPlan
	}
	runID := strings.TrimSpace(req.RunID)
	if runID != "" {
		if _, err := s.GetChatRun(project.ID, runID); err != nil {
			return AIBackgroundAgentPreviewResult{}, err
		}
	}
	snapshot := s.buildContextSnapshot(project, AIContextRequest{
		Capability:      providers.CapabilityChat,
		Prompt:          req.Prompt,
		IncludeMnemonic: true,
		IncludeSkills:   true,
		MaxBytes:        48 * 1024,
		MaxSnippets:     8,
	})
	payload := AIBackgroundAgentPreviewPayload{
		Prompt:             sanitizedDisplayText(req.Prompt),
		Action:             req.Action,
		ProfileID:          firstNonEmpty(strings.TrimSpace(req.ProfileID), defaultProfileForAction(req.Action)),
		ProjectPathHash:    hashProjectPath(project.ProjectRoot),
		ContextSummary:     summarizeContextSnapshot(snapshot),
		IsolatedSnapshot:   true,
		ExecutionAvailable: false,
		Status:             "preview_only",
		Logs:               []string{"isolated context snapshot prepared", "background execution is disabled until worker isolation is implemented"},
	}
	now := utcNow()
	artifact := AIChatRunArtifact{
		ID:               "background-agent-" + uuid.NewString(),
		RunID:            runID,
		SessionID:        defaultChatSessionID,
		ProjectSessionID: project.ID,
		Kind:             AIChatRunArtifactBackground,
		Status:           payload.Status,
		Title:            "Background agent preview",
		Summary:          "Isolated snapshot prepared; execution disabled",
		PayloadJSON:      marshalChatArtifactPayload(payload),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if runID != "" {
		if run, err := s.GetChatRun(project.ID, runID); err == nil {
			artifact.SessionID = normalizeChatSessionID(run.SessionID)
		}
		if err := project.ChatArtifacts.Upsert(artifact); err != nil {
			return AIBackgroundAgentPreviewResult{}, err
		}
	}
	return AIBackgroundAgentPreviewResult{Artifact: artifact, Payload: payload, Status: payload.Status}, nil
}

func modelCodeEditQuality(provider providers.AIProviderDescriptor, model providers.AIModelDescriptor) string {
	name := strings.ToLower(model.ID + " " + model.DisplayName + " " + provider.Kind)
	switch {
	case strings.Contains(name, "coder") || strings.Contains(name, "code"):
		return "code-focused"
	case provider.Frontier:
		return "frontier"
	case provider.Local:
		return "local-general"
	default:
		return "general"
	}
}

func recommendedModesForProvider(provider providers.AIProviderDescriptor) []AIChatAction {
	if !capabilityAllowed(provider.Capabilities, providers.CapabilityChat) {
		return nil
	}
	if provider.Frontier {
		if isExternalAgentProviderDescriptor(provider) {
			return []AIChatAction{AIChatActionAsk, AIChatActionPlan, AIChatActionDebug, AIChatActionBuild, AIChatActionReview}
		}
		return []AIChatAction{AIChatActionAsk, AIChatActionPlan}
	}
	return []AIChatAction{AIChatActionAsk, AIChatActionPlan, AIChatActionDebug, AIChatActionBuild}
}
