package ai

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"arlecchino/internal/ai/providers"
)

func applyGenerationUsageToEgress(record *AIEgressRecord, req providers.GenerationRequest, response providers.GenerationResponse, descriptor providers.AIProviderDescriptor, toolset chatToolset) {
	if record == nil {
		return
	}
	usage := generationUsageForEgress(req, response)
	record.InputTokens = usage.InputTokens
	record.OutputTokens = usage.OutputTokens
	record.TotalTokens = usage.TotalTokens
	record.EstimatedTokens = usage.Estimated
	record.TokenSource = usage.Source
	record.ToolProfile = toolset.Profile
	record.ToolSchemaCount = len(req.Tools)
	record.ToolSupportKind = toolset.ToolSupportKind
	applyGenerationCostToEgress(record, descriptor)
}

func generationUsageForEgress(req providers.GenerationRequest, response providers.GenerationResponse) providers.GenerationTokenUsage {
	usage := normalizeGenerationUsage(response.Usage)
	if usage.TotalTokens > 0 {
		return usage
	}
	input := estimateGenerationInputTokens(req)
	output := estimateGenerationOutputTokens(response)
	if input == 0 && output == 0 {
		return providers.GenerationTokenUsage{}
	}
	return providers.GenerationTokenUsage{
		InputTokens:  input,
		OutputTokens: output,
		TotalTokens:  input + output,
		Estimated:    true,
		Source:       "estimated",
	}
}

func normalizeGenerationUsage(usage providers.GenerationTokenUsage) providers.GenerationTokenUsage {
	if usage.TotalTokens == 0 && (usage.InputTokens > 0 || usage.OutputTokens > 0) {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
	}
	if usage.Source == "" && usage.TotalTokens > 0 {
		if usage.Estimated {
			usage.Source = "estimated"
		} else {
			usage.Source = "provider"
		}
	}
	return usage
}

func estimateGenerationInputTokens(req providers.GenerationRequest) int {
	parts := []string{}
	if strings.TrimSpace(req.System) != "" {
		parts = append(parts, req.System)
	}
	if strings.TrimSpace(req.Prompt) != "" {
		parts = append(parts, req.Prompt)
	}
	for _, message := range req.Messages {
		if strings.TrimSpace(message.Content) != "" {
			parts = append(parts, message.Role, message.Content)
		}
		if len(message.ToolCalls) > 0 {
			encoded, err := json.Marshal(message.ToolCalls)
			if err == nil {
				parts = append(parts, string(encoded))
			}
		}
	}
	if len(req.Tools) > 0 {
		encoded, err := json.Marshal(req.Tools)
		if err == nil {
			parts = append(parts, string(encoded))
		}
	}
	return estimateTokensFromText(strings.Join(parts, "\n"))
}

func estimateGenerationOutputTokens(response providers.GenerationResponse) int {
	parts := []string{}
	if strings.TrimSpace(response.Text) != "" {
		parts = append(parts, response.Text)
	}
	if strings.TrimSpace(response.ReasoningText) != "" {
		parts = append(parts, response.ReasoningText)
	}
	if len(response.ToolCalls) > 0 {
		encoded, err := json.Marshal(response.ToolCalls)
		if err == nil {
			parts = append(parts, string(encoded))
		}
	}
	return estimateTokensFromText(strings.Join(parts, "\n"))
}

func estimateTokensFromText(value string) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	count := utf8.RuneCountInString(value)
	tokens := (count + 3) / 4
	if tokens < 1 {
		return 1
	}
	return tokens
}

func applyGenerationCostToEgress(record *AIEgressRecord, descriptor providers.AIProviderDescriptor) {
	if record == nil || record.TotalTokens == 0 {
		return
	}
	record.CostCurrency = "USD"
	switch {
	case descriptor.Local:
		record.CostSource = "local_provider"
		record.CostEstimated = false
	case descriptor.Frontier:
		record.CostSource = "unpriced_frontier_provider"
		record.CostEstimated = true
	default:
		record.CostSource = "unpriced_provider"
		record.CostEstimated = true
	}
}
