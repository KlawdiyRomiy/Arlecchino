package ai

import (
	"math"
	"strings"

	"arlecchino/internal/ai/providers"
)

const (
	contextBudgetSourceModelAPI      = "assembled_chat_provider_request"
	contextBudgetSourceExternalAgent = "assembled_external_agent_prompt"
	contextAutoCompactThresholdRatio = 0.85
)

func (s *Service) contextBudgetForSnapshot(project *ProjectSession, snapshot AIContextSnapshot, req AIContextRequest) AIContextBudget {
	providerID := strings.TrimSpace(req.ProviderID)
	if providerID == "" {
		providerID = strings.TrimSpace(s.currentSettings().ActiveProviderID)
	}
	descriptor := s.descriptor(providerID)
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = firstNonEmpty(descriptor.DefaultModel, firstModelID(descriptor.Models))
	}
	chatReq := AIChatRunRequest{
		SessionID:            snapshot.SessionID,
		Action:               normalizeContextBudgetAction(req.Action),
		ProfileID:            strings.TrimSpace(req.ProfileID),
		Prompt:               snapshot.Prompt,
		RuntimeFamily:        strings.TrimSpace(req.RuntimeFamily),
		ProviderID:           providerID,
		Model:                model,
		ReasoningEffort:      strings.TrimSpace(req.ReasoningEffort),
		IncludeMnemonic:      req.IncludeMnemonic,
		IncludeMCP:           req.IncludeMCP,
		IncludeSkills:        req.IncludeSkills,
		IncludeContinuity:    req.IncludeContinuity,
		ContinuityCapsuleIDs: req.ContinuityCapsuleIDs,
		Context:              req,
	}
	chatReq.Context.SessionID = snapshot.SessionID
	chatReq.Context.Prompt = snapshot.Prompt
	chatReq.Context.ProviderID = providerID
	chatReq.Context.Model = model
	chatReq.Context.Action = chatReq.Action
	chatReq.Context.ProfileID = chatReq.ProfileID
	chatReq.Context.RuntimeFamily = chatReq.RuntimeFamily
	chatReq.Context.ReasoningEffort = chatReq.ReasoningEffort

	source := contextBudgetSourceModelAPI
	inputTokens := 0
	if isExternalAgentRuntimeFamily(chatReq.RuntimeFamily) || strings.HasPrefix(providerID, "agent-cli-") || isExternalAgentProviderDescriptor(descriptor) {
		source = contextBudgetSourceExternalAgent
		history := s.chatHistoryForPrompt(project, "", snapshot.SessionID, chatPromptHistoryLimit)
		if compaction, ok := latestIncludedCompactionCapsule(snapshot.Continuity); ok {
			history = s.chatHistoryForPromptAfter(project, "", snapshot.SessionID, chatPromptHistoryLimit, compaction.CreatedAt)
		}
		inputTokens = estimateTokensFromText(buildExternalAgentPromptWithInputs(chatReq, snapshot, summarizeContextSnapshot(snapshot), history, []AIChatRunInput{newUserRunInput(snapshot.Prompt)}))
	} else {
		history := s.chatHistoryForPrompt(project, "", snapshot.SessionID, chatPromptHistoryLimit)
		if compaction, ok := latestIncludedCompactionCapsule(snapshot.Continuity); ok {
			history = s.chatHistoryForPromptAfter(project, "", snapshot.SessionID, chatPromptHistoryLimit, compaction.CreatedAt)
		}
		generationReq := providers.GenerationRequest{
			Capability:      providers.CapabilityChat,
			Prompt:          buildChatPromptFromSnapshot(snapshot, history, []AIChatRunInput{newUserRunInput(snapshot.Prompt)}),
			System:          chatSystemPrompt(chatReq),
			Messages:        buildChatMessagesFromSnapshot(snapshot, history, []AIChatRunInput{newUserRunInput(snapshot.Prompt)}),
			Model:           model,
			ReasoningEffort: chatReq.ReasoningEffort,
			MaxTokens:       defaultChatMaxTokens(chatReq.Action),
			Stop:            defaultChatStopSequences,
			Stream:          true,
		}
		if descriptor.ID != "" {
			toolset := generationToolsetForChatRequest(chatReq, descriptor, generationReq.Model)
			generationReq.Tools = toolset.Tools
			if len(generationReq.Tools) > 0 {
				generationReq.ToolChoice = "auto"
				generationReq.Stream = false
			}
		}
		inputTokens = estimateGenerationInputTokens(generationReq)
	}
	return buildContextBudget(inputTokens, contextWindowForBudget(descriptor, model, req.ContextWindowHint), providerID, model, source)
}

func normalizeContextBudgetAction(action AIChatAction) AIChatAction {
	switch action {
	case AIChatActionAsk, AIChatActionDebug, AIChatActionPlan, AIChatActionBuild, AIChatActionReview:
		return action
	default:
		return AIChatActionAsk
	}
}

func contextWindowForBudget(descriptor providers.AIProviderDescriptor, model string, hint int) int {
	model = strings.TrimSpace(firstNonEmpty(model, descriptor.DefaultModel))
	for _, candidate := range descriptor.Models {
		if candidate.ID == model && candidate.ContextWindow > 0 {
			return candidate.ContextWindow
		}
	}
	if inferred := providers.InferModelContextWindow(descriptor.Kind, model); inferred > 0 {
		return inferred
	}
	if hint > 0 {
		return hint
	}
	for _, candidate := range descriptor.Models {
		if candidate.ContextWindow > 0 {
			return candidate.ContextWindow
		}
	}
	if inferred := providers.InferModelContextWindow(descriptor.Kind, descriptor.DefaultModel); inferred > 0 {
		return inferred
	}
	return 0
}

func buildContextBudget(inputTokens int, contextWindow int, providerID string, model string, source string) AIContextBudget {
	budget := AIContextBudget{
		InputTokens: inputTokens,
		Estimated:   true,
		Source:      source,
		Status:      "estimated",
		ProviderID:  strings.TrimSpace(providerID),
		Model:       strings.TrimSpace(model),
	}
	if contextWindow <= 0 {
		budget.Reason = "context_window_unavailable"
		return budget
	}
	budget.ContextWindow = contextWindow
	budget.UsageRatio = math.Min(1, float64(inputTokens)/float64(contextWindow))
	budget.RemainingTokens = maxInt(0, contextWindow-inputTokens)
	budget.AutoCompactThresholdTokens = int(math.Floor(float64(contextWindow) * contextAutoCompactThresholdRatio))
	budget.RemainingBeforeCompact = maxInt(0, budget.AutoCompactThresholdTokens-inputTokens)
	budget.AutoCompactRecommended = budget.AutoCompactThresholdTokens > 0 && inputTokens >= budget.AutoCompactThresholdTokens
	budget.Status = "ready"
	return budget
}
