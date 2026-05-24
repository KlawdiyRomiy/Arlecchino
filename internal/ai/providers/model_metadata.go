package providers

import "strings"

type modelContextWindowRule struct {
	prefixes []string
	contains []string
	window   int
}

var modelContextWindowRules = []modelContextWindowRule{
	{prefixes: []string{"gpt-5.5"}, window: 1_050_000},
	{prefixes: []string{"gpt-5.4-mini"}, window: 400_000},
	{prefixes: []string{"gpt-5.4"}, window: 1_050_000},
	{contains: []string{"claude-opus-4-7"}, window: 1_000_000},
	{contains: []string{"claude-opus-4-6"}, window: 1_000_000},
	{contains: []string{"claude-sonnet-4-6"}, window: 1_000_000},
	{contains: []string{"claude-"}, window: 200_000},
	{prefixes: []string{"gemini-2.5-pro"}, window: 1_048_576},
	{prefixes: []string{"gemini-2.0-flash"}, window: 1_000_000},
}

// EnrichProviderDescriptorModels preserves provider-reported metadata and fills
// gaps for common model IDs whose list-model endpoints do not expose context windows.
func EnrichProviderDescriptorModels(descriptor AIProviderDescriptor) AIProviderDescriptor {
	for i := range descriptor.Models {
		descriptor.Models[i] = EnrichModelDescriptor(descriptor.Kind, descriptor.Models[i])
	}
	return descriptor
}

func EnrichModelDescriptor(providerKind string, model AIModelDescriptor) AIModelDescriptor {
	if model.ContextWindow <= 0 {
		model.ContextWindow = InferModelContextWindow(providerKind, model.ID)
	}
	return model
}

func InferModelContextWindow(_ string, modelID string) int {
	modelID = normalizedModelContextID(modelID)
	if modelID == "" {
		return 0
	}
	for _, rule := range modelContextWindowRules {
		if modelContextRuleMatches(rule, modelID) {
			return rule.window
		}
	}
	return 0
}

func modelContextRuleMatches(rule modelContextWindowRule, modelID string) bool {
	for _, prefix := range rule.prefixes {
		if strings.HasPrefix(modelID, strings.ToLower(strings.TrimSpace(prefix))) {
			return true
		}
	}
	for _, fragment := range rule.contains {
		if strings.Contains(modelID, strings.ToLower(strings.TrimSpace(fragment))) {
			return true
		}
	}
	return false
}

func normalizedModelContextID(modelID string) string {
	modelID = strings.ToLower(strings.TrimSpace(modelID))
	modelID = strings.TrimPrefix(modelID, "models/")
	if idx := strings.LastIndex(modelID, "/"); idx >= 0 && idx+1 < len(modelID) {
		modelID = modelID[idx+1:]
	}
	return modelID
}
