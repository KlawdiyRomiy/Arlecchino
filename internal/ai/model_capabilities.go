package ai

import (
	"strings"

	"arlecchino/internal/ai/providers"
)

type modelCapabilityEvidence struct {
	ToolSupport             bool
	ToolSupportKind         string
	ToolSupportReason       string
	StructuredOutputSupport bool
	PatchGenerationSupport  bool
	LowLatency              bool
	CostTier                string
	CapabilitySource        string
}

func modelCapabilityEvidenceFor(provider providers.AIProviderDescriptor, model providers.AIModelDescriptor) modelCapabilityEvidence {
	source := "inferred"
	toolSupport := false
	toolKind := "none"
	reason := "provider has not advertised or implemented tool calling"
	if provider.Kind == "ollama" {
		source = "adapter"
		toolSupport = true
		toolKind = "adapter"
		reason = "Ollama chat adapter can send tool schemas and parse tool calls, but Build requires a live probe before use"
	} else if model.ToolCalling || capabilityAllowed(provider.Capabilities, providers.CapabilityToolCalling) {
		source = "advertised"
		toolSupport = true
		toolKind = "native"
		reason = "provider/model advertises native tool calling"
	} else if providerKindHasOpenAIToolAdapter(provider.Kind) {
		toolSupport = true
		toolKind = "adapter"
		reason = "Arlecchino adapter can send OpenAI-compatible tool schemas"
	}

	structured := model.StructuredOutput || capabilityAllowed(provider.Capabilities, providers.CapabilityStructuredOutput) || toolSupport
	patch := model.PatchGeneration || capabilityAllowed(provider.Capabilities, providers.CapabilityPatchGeneration) || toolSupport
	lowLatency := model.LowLatency || provider.Local
	costTier := strings.TrimSpace(model.CostTier)
	if costTier == "" {
		if provider.Local {
			costTier = "local"
		} else if provider.Frontier {
			costTier = "frontier_unpriced"
		} else {
			costTier = "remote_unpriced"
		}
	}
	return modelCapabilityEvidence{
		ToolSupport:             toolSupport,
		ToolSupportKind:         toolKind,
		ToolSupportReason:       reason,
		StructuredOutputSupport: structured,
		PatchGenerationSupport:  patch,
		LowLatency:              lowLatency,
		CostTier:                costTier,
		CapabilitySource:        source,
	}
}

func providerKindHasOpenAIToolAdapter(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "openai", "lm-studio", "llama.cpp", "huggingface-tgi":
		return true
	default:
		return false
	}
}
