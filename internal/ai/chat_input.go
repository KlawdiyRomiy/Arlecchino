package ai

import "strings"

const chatInputDisplaySummaryLimit = 280

func newUserRunInput(content string) AIChatRunInput {
	return newChatRunInput(AIChatInputOriginUserRequest, content, AIChatInputDisplayKindUserBubble, "", "", true)
}

func newUserFollowUpRunInput(content string, parentRunID string) AIChatRunInput {
	return newChatRunInput(AIChatInputOriginUserFollowUp, content, AIChatInputDisplayKindUserBubble, "", parentRunID, true)
}

func newWorkflowRunInput(content string, summary string, parentRunID string) AIChatRunInput {
	return newChatRunInput(AIChatInputOriginWorkflowInstruction, content, AIChatInputDisplayKindActivity, summary, parentRunID, true)
}

func newHiddenWorkflowRunInput(content string, parentRunID string) AIChatRunInput {
	return newChatRunInput(AIChatInputOriginWorkflowInstruction, content, AIChatInputDisplayKindHidden, "", parentRunID, false)
}

func newSteerContinuationInput(content string, parentRunID string) AIChatRunInput {
	return newChatRunInput(AIChatInputOriginSteer, content, AIChatInputDisplayKindActivity, "Steer accepted — restarting with your change", parentRunID, true)
}

func newChatRunInput(origin AIChatInputOrigin, content string, displayKind AIChatInputDisplayKind, summary string, parentRunID string, userVisible bool) AIChatRunInput {
	return normalizeChatRunInput(AIChatRunInput{
		Origin:         origin,
		Content:        content,
		DisplayKind:    displayKind,
		DisplaySummary: summary,
		ParentRunID:    parentRunID,
		UserVisible:    userVisible,
	})
}

func normalizeChatRunInputs(inputs []AIChatRunInput, legacyPrompt string) []AIChatRunInput {
	normalized := make([]AIChatRunInput, 0, len(inputs))
	for _, input := range inputs {
		input = normalizeChatRunInput(input)
		if input.Content == "" {
			continue
		}
		normalized = append(normalized, input)
	}
	if len(normalized) == 0 && strings.TrimSpace(legacyPrompt) != "" {
		normalized = append(normalized, newUserRunInput(legacyPrompt))
	}
	return normalized
}

func normalizeChatRunInput(input AIChatRunInput) AIChatRunInput {
	input.Content = strings.TrimSpace(input.Content)
	input.ParentRunID = strings.TrimSpace(input.ParentRunID)
	input.CorrelationID = strings.TrimSpace(input.CorrelationID)
	input.DisplaySummary = truncateUTF8(strings.TrimSpace(sanitizedDisplayText(input.DisplaySummary)), chatInputDisplaySummaryLimit)
	if input.Origin == "" {
		input.Origin = AIChatInputOriginUserRequest
	}
	if input.DisplayKind == "" {
		switch input.Origin {
		case AIChatInputOriginUserRequest, AIChatInputOriginUserFollowUp:
			input.DisplayKind = AIChatInputDisplayKindUserBubble
		case AIChatInputOriginWorkflowInstruction, AIChatInputOriginSteer, AIChatInputOriginToolContinuation:
			input.DisplayKind = AIChatInputDisplayKindHidden
		default:
			input.DisplayKind = AIChatInputDisplayKindHidden
		}
	}
	if input.DisplayKind == AIChatInputDisplayKindUserBubble {
		input.UserVisible = true
	}
	return input
}

func chatRunInputs(run AIChatRun) []AIChatRunInput {
	return normalizeChatRunInputs(run.Inputs, run.UserPrompt)
}

func chatRunInputPrompt(inputs []AIChatRunInput) string {
	for _, input := range inputs {
		switch input.Origin {
		case AIChatInputOriginUserRequest, AIChatInputOriginUserFollowUp, AIChatInputOriginSteer:
			if input.Content != "" {
				return input.Content
			}
		}
	}
	for _, input := range inputs {
		if input.Content != "" {
			return input.Content
		}
	}
	return ""
}

func chatRunUserPrompt(inputs []AIChatRunInput) string {
	for _, input := range inputs {
		if input.DisplayKind != AIChatInputDisplayKindUserBubble {
			continue
		}
		if input.Origin != AIChatInputOriginUserRequest && input.Origin != AIChatInputOriginUserFollowUp {
			continue
		}
		if input.Content != "" {
			return sanitizedDisplayText(input.Content)
		}
	}
	return ""
}

func chatRunRequestForCleanup(run AIChatRun) AIChatRunRequest {
	return AIChatRunRequest{Action: run.Action, Prompt: chatRunInputPrompt(chatRunInputs(run))}
}

func (s *Service) runInputs(runID string) []AIChatRunInput {
	s.mu.RLock()
	run := s.runs[runID]
	if run == nil {
		s.mu.RUnlock()
		return nil
	}
	inputs := append([]AIChatRunInput(nil), run.Inputs...)
	legacyPrompt := run.UserPrompt
	s.mu.RUnlock()
	return normalizeChatRunInputs(inputs, legacyPrompt)
}

// modelInputsForRun adds authoritative linked workflow records as a hidden host
// layer. The source remains a run link, never a synthetic user message; this
// keeps an accepted plan available even when normal history was compacted.
func (s *Service) modelInputsForRun(project *ProjectSession, runID string) ([]AIChatRunInput, AIChatRunLinks) {
	s.mu.RLock()
	run := s.runs[runID]
	if run == nil {
		s.mu.RUnlock()
		return nil, AIChatRunLinks{}
	}
	inputs := normalizeChatRunInputs(append([]AIChatRunInput(nil), run.Inputs...), run.UserPrompt)
	links := run.Links
	s.mu.RUnlock()
	return append(inputs, s.linkedWorkflowContextInputs(project, links)...), links
}

func (s *Service) linkedWorkflowContextInputs(project *ProjectSession, links AIChatRunLinks) []AIChatRunInput {
	if project == nil {
		return nil
	}
	inputs := []AIChatRunInput{}
	if planID := strings.TrimSpace(links.SourcePlanRunID); planID != "" {
		if plan, err := s.GetChatRun(project.ID, planID); err == nil {
			inputs = append(inputs, newHiddenWorkflowRunInput(linkedPlanWorkflowContext(plan), plan.ID))
		}
	}
	if buildID := strings.TrimSpace(links.SourceBuildRunID); buildID != "" {
		if build, err := s.GetChatRun(project.ID, buildID); err == nil {
			inputs = append(inputs, newHiddenWorkflowRunInput(linkedBuildWorkflowContext(build), build.ID))
		}
	}
	return inputs
}

func linkedPlanWorkflowContext(plan AIChatRun) string {
	return strings.TrimSpace(strings.Join([]string{
		"Authoritative linked plan context. Treat this as prior run evidence, not as a new user request.",
		"Original user request:",
		chatRunInputPrompt(chatRunInputs(plan)),
		"Accepted plan:",
		strings.TrimSpace(cleanGeneratedResponse(plan.Response)),
	}, "\n\n"))
}

func linkedBuildWorkflowContext(build AIChatRun) string {
	return strings.TrimSpace(strings.Join([]string{
		"Authoritative linked Build context. Treat this as prior run evidence, not as a new user request.",
		"Build request:",
		chatRunInputPrompt(chatRunInputs(build)),
		"Build result:",
		strings.TrimSpace(cleanGeneratedResponse(build.Response)),
	}, "\n\n"))
}

func filterChatHistoryForLinkedRuns(history []AIChatRun, links AIChatRunLinks) []AIChatRun {
	linked := map[string]struct{}{}
	for _, runID := range []string{links.SourcePlanRunID, links.SourceBuildRunID} {
		if runID = strings.TrimSpace(runID); runID != "" {
			linked[runID] = struct{}{}
		}
	}
	if len(linked) == 0 {
		return history
	}
	filtered := make([]AIChatRun, 0, len(history))
	for _, run := range history {
		if _, skip := linked[run.ID]; !skip {
			filtered = append(filtered, run)
		}
	}
	return filtered
}
