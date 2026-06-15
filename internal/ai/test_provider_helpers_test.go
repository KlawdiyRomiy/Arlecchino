package ai

import (
	"context"
	"sync"

	"arlecchino/internal/ai/providers"
)

func isTestCapabilityProbeRequest(req providers.GenerationRequest) bool {
	for _, tool := range req.Tools {
		if tool.Name == "arlecchino_capability_probe" {
			return true
		}
	}
	return false
}

func testCapabilityProbeResponse(model string) providers.GenerationResponse {
	return providers.GenerationResponse{
		Model: model,
		ToolCalls: []providers.GenerationToolCall{
			{
				ID:            "call_capability_probe",
				Name:          "arlecchino_capability_probe",
				ArgumentsJSON: `{"ok":true}`,
			},
		},
	}
}

type sequenceProvider struct {
	mu         sync.Mutex
	descriptor providers.AIProviderDescriptor
	responses  []providers.GenerationResponse
	requests   []providers.GenerationRequest
	calls      int
}

func (p *sequenceProvider) Descriptor() providers.AIProviderDescriptor {
	return p.descriptor
}

func (p *sequenceProvider) ListModels(context.Context) ([]providers.AIModelDescriptor, error) {
	return p.descriptor.Models, nil
}

func (p *sequenceProvider) HealthCheck(context.Context) providers.AIProviderDescriptor {
	descriptor := p.descriptor
	descriptor.Status = providers.ProviderStatusReady
	return descriptor
}

func (p *sequenceProvider) Generate(_ context.Context, req providers.GenerationRequest, sink providers.TokenSink) (providers.GenerationResponse, error) {
	if isTestCapabilityProbeRequest(req) {
		return testCapabilityProbeResponse(firstNonEmpty(req.Model, p.descriptor.DefaultModel)), nil
	}

	p.mu.Lock()
	index := p.calls
	p.calls++
	p.requests = append(p.requests, req)
	p.mu.Unlock()

	response := providers.GenerationResponse{Model: firstNonEmpty(req.Model, p.descriptor.DefaultModel)}
	if index < len(p.responses) {
		response = p.responses[index]
		if response.Model == "" {
			response.Model = firstNonEmpty(req.Model, p.descriptor.DefaultModel)
		}
	}
	if sink != nil && response.Text != "" {
		if err := sink(response.Text); err != nil {
			return providers.GenerationResponse{}, err
		}
	}
	return response, nil
}

func (p *sequenceProvider) Requests() []providers.GenerationRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]providers.GenerationRequest(nil), p.requests...)
}
