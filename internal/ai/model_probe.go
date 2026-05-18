package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	"arlecchino/internal/ai/providers"
)

const modelCapabilityProbeTTL = 12 * time.Hour

func (s *Service) ProbeModelCapability(ctx context.Context, projectID string, req AIModelCapabilityProbeRequest) (AIModelCapabilityProbeResult, error) {
	project := s.project(projectID)
	if project == nil {
		return AIModelCapabilityProbeResult{}, fmt.Errorf("AI project session is not open")
	}
	providerID := strings.TrimSpace(req.ProviderID)
	if providerID == "" {
		providerID = strings.TrimSpace(s.currentSettings().ActiveProviderID)
	}
	provider, descriptor, err := s.resolveProvider(providerID)
	if err != nil {
		return AIModelCapabilityProbeResult{}, err
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = descriptor.DefaultModel
	}
	if model == "" {
		return AIModelCapabilityProbeResult{}, fmt.Errorf("model is not configured")
	}
	if !req.Force && project.ModelCapabilityProbes != nil {
		if cached, ok := project.ModelCapabilityProbes.Get(descriptor.ID, model); ok && modelCapabilityProbeFresh(cached) {
			return cached, nil
		}
	}
	result := s.runModelCapabilityProbe(ctx, project, provider, descriptor, model)
	if project.ModelCapabilityProbes != nil {
		_ = project.ModelCapabilityProbes.Upsert(result)
	}
	s.emitEvent("ai:model:capability-probed", result)
	return result, nil
}

func (s *Service) runModelCapabilityProbe(ctx context.Context, project *ProjectSession, provider providers.Provider, descriptor AIProviderDescriptor, model string) AIModelCapabilityProbeResult {
	started := time.Now()
	now := utcNow()
	result := AIModelCapabilityProbeResult{
		ProviderID:              descriptor.ID,
		Model:                   model,
		Status:                  "running",
		ToolSupportKind:         "none",
		CapabilitySource:        "probe",
		StructuredOutputSupport: false,
		PatchGenerationSupport:  false,
		CheckedAt:               now,
		ExpiresAt:               time.Now().UTC().Add(modelCapabilityProbeTTL).Format(time.RFC3339),
	}
	if !capabilityAllowed(descriptor.Capabilities, providers.CapabilityChat) {
		result.Status = "unsupported"
		result.Error = "provider does not support chat"
		return result
	}
	probeCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	generationReq := providers.GenerationRequest{
		Capability: providers.CapabilityChat,
		System:     "You are checking whether this model can call tools. Call the provided arlecchino_capability_probe tool with ok=true. Do not answer in prose.",
		Prompt:     "Call arlecchino_capability_probe now.",
		Model:      model,
		MaxTokens:  64,
		Tools: []providers.GenerationTool{
			{
				Name:        "arlecchino_capability_probe",
				Description: "Returns whether the selected model can invoke a tool.",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"ok": map[string]any{"type": "boolean"},
					},
					"required": []string{"ok"},
				},
			},
		},
		ToolChoice: "auto",
	}
	record, response, err := s.callProvider(probeCtx, project, descriptor, provider, generationReq, AIContextSnapshot{
		ID:             "model-capability-probe",
		Capability:     providers.CapabilityChat,
		DataCategories: []string{"model_capability_probe"},
		Redaction:      AIRedactionSummary{},
		ByteSize:       len(generationReq.System) + len(generationReq.Prompt),
		CreatedAt:      now,
	}, "model_capability_probe")
	result.LatencyMs = time.Since(started).Milliseconds()
	if record.ID != "" {
		result.EgressRecordID = record.ID
	}
	if err != nil {
		result.Status = "failed"
		result.Error = sanitizedDisplayText(err.Error())
		return result
	}
	for _, call := range response.ToolCalls {
		if call.Name == "arlecchino_capability_probe" {
			result.Status = "verified"
			result.ToolSupport = true
			result.ToolSupportKind = "native"
			result.StructuredOutputSupport = true
			result.PatchGenerationSupport = true
			return result
		}
	}
	result.Status = "unsupported"
	result.Error = "probe completed without a tool call"
	return result
}

func cachedProjectModelCapabilityProbe(project *ProjectSession, providerID string, model string) (AIModelCapabilityProbeResult, bool) {
	if project == nil || project.ModelCapabilityProbes == nil {
		return AIModelCapabilityProbeResult{}, false
	}
	result, ok := project.ModelCapabilityProbes.Get(providerID, model)
	if ok {
		return result, true
	}
	return AIModelCapabilityProbeResult{}, false
}
