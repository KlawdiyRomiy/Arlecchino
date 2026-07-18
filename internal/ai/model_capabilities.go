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
	} else if providerKindHasToolSchemaAdapter(provider.Kind) {
		source = "adapter"
		toolSupport = true
		toolKind = "adapter"
		reason = "Arlecchino adapter can send the complete host tool schema to this provider transport"
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

// providerKindHasToolSchemaAdapter is intentionally transport-wide. A provider
// may encode host functions as OpenAI tools, Anthropic tools, Gemini function
// declarations, or Ollama tools, but it must never receive a silently reduced
// subset solely because of that wire format.
func providerKindHasToolSchemaAdapter(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "openai", "openai-compatible", "openrouter", "lm-studio", "llama.cpp", "huggingface-tgi", "anthropic", "gemini", "google-gemini", "ollama":
		return true
	default:
		return false
	}
}
