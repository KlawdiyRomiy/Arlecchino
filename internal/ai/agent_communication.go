package ai

import (
	"fmt"
	"strings"
	"unicode"

	"arlecchino/internal/ai/providers"
)

func agentRuntimeCommentaryForRequest(req AIChatRunRequest, fallback string, russian string) string {
	for _, char := range req.Prompt {
		if unicode.In(char, unicode.Cyrillic) {
			return russian
		}
	}
	return fallback
}

const (
	builtinAgentRuntimeSkillID    = "agent-runtime"
	builtinAgentCommentarySkillID = "agent-progress-commentary"
	maxAgentStatusTitleBytes      = 180
	maxAgentStatusDetailBytes     = 420
	maxAgentCommentaryBytes       = 700
	maxAgentCommunicationEvents   = 48
)

type agentCommunicationRunState struct {
	LastStatusSignature     string
	LastCommentarySignature string
	Count                   int
}

var agentStatusPhases = map[string]struct{}{
	"starting":    {},
	"planning":    {},
	"context":     {},
	"researching": {},
	"reading":     {},
	"editing":     {},
	"writing":     {},
	"running":     {},
	"testing":     {},
	"verifying":   {},
	"reviewing":   {},
	"waiting":     {},
	"blocked":     {},
	"finalizing":  {},
	"completed":   {},
}

var agentStatusStates = map[string]struct{}{
	"active":   {},
	"done":     {},
	"waiting":  {},
	"blocked":  {},
	"error":    {},
	"canceled": {},
}

var agentCommentaryKinds = map[string]struct{}{
	"progress":     {},
	"milestone":    {},
	"verification": {},
	"warning":      {},
}

func isAgentCommunicationToolID(toolID string) bool {
	switch strings.TrimSpace(toolID) {
	case "agent.status.update", "agent.commentary":
		return true
	default:
		return false
	}
}

func agentCommunicationSkillPrompt(req AIChatRunRequest) string {
	if isMinimalChatRequest(req) {
		return ""
	}
	return "When structured runtime-status or progress-commentary functions are available, use them only for meaningful state changes and concise user-safe milestones. " +
		"Batch communication with the nearest productive tool call; never spend a provider turn only on status or on a pre-final update. The host owns verification and completion phases. " +
		"Do not narrate every read or tool call, do not duplicate host commentary in normal response text, and do not use either tool for a trivial one-answer reply. " +
		"The final answer itself must always be ordinary visible assistant content."
}

func externalAgentCommunicationSkillPrompt() string {
	return "Built-in skills " + builtinAgentRuntimeSkillID + " and " + builtinAgentCommentarySkillID + ": send concise visible commentary after meaningful milestones and before verification, then send one final answer. Do not narrate every command. Arlecchino records baseline Agent Runtime phases independently from structured runtime events and tool activity."
}

func normalizeAgentCommunicationValue(value string, allowed map[string]struct{}, fallback string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		value = fallback
	}
	_, ok := allowed[value]
	return value, ok
}

func agentCommunicationRun(project *ProjectSession, runID string, service *Service, allowTerminal bool) (AIChatRun, error) {
	if project == nil || service == nil || strings.TrimSpace(runID) == "" {
		return AIChatRun{}, fmt.Errorf("agent communication requires an active run")
	}
	run, err := service.GetChatRun(project.ID, runID)
	if err != nil {
		return AIChatRun{}, err
	}
	if !service.runCanUseProject(project, run.ID) {
		return AIChatRun{}, fmt.Errorf("agent communication run is no longer active")
	}
	if !allowTerminal && run.Status != "running" && run.Status != "queued" {
		return AIChatRun{}, fmt.Errorf("agent communication run is no longer active")
	}
	return run, nil
}

func (s *Service) agentCommunicationEventDecision(project *ProjectSession, runID string, eventType string, status string, summary string) (record bool, err error) {
	if s == nil || project == nil || project.RunTimeline == nil {
		return false, fmt.Errorf("agent communication timeline is unavailable")
	}
	signature := strings.Join([]string{eventType, status, strings.TrimSpace(summary)}, "\x00")
	s.agentCommunicationMu.Lock()
	defer s.agentCommunicationMu.Unlock()
	state := s.agentCommunication[runID]
	lastSignature := state.LastStatusSignature
	if eventType == "assistant_commentary" {
		lastSignature = state.LastCommentarySignature
	}
	if lastSignature == signature {
		return false, nil
	}
	if state.Count >= maxAgentCommunicationEvents {
		return false, fmt.Errorf("agent communication event limit reached")
	}
	if eventType == "assistant_commentary" {
		state.LastCommentarySignature = signature
	} else {
		state.LastStatusSignature = signature
	}
	state.Count++
	s.agentCommunication[runID] = state
	return true, nil
}

// recordActiveAgentTimeline serializes the final active-run check with the
// durable append. CancelChatRun and terminal transitions need s.mu exclusively,
// so a communication event is either committed before that transition or
// rejected after it; it cannot slip into the ledger behind a terminal state.
func (s *Service) recordActiveAgentTimeline(project *ProjectSession, event AIRunTimelineEvent) bool {
	if s == nil || project == nil || project.RunTimeline == nil || strings.TrimSpace(event.RunID) == "" {
		return false
	}
	if strings.TrimSpace(event.ProjectSessionID) == "" {
		event.ProjectSessionID = project.ID
	}
	if strings.TrimSpace(event.CreatedAt) == "" {
		event.CreatedAt = utcNow()
	}

	s.mu.RLock()
	if !s.activeRunCanUseProjectLocked(project, event.RunID) {
		s.mu.RUnlock()
		return false
	}
	stored, err := project.RunTimeline.Append(event)
	s.mu.RUnlock()
	if err != nil {
		return false
	}
	if s.activeRunCanUseProject(project, stored.RunID) {
		s.emitRunEvent(project, stored.RunID, "ai:run:timeline-event", stored)
	}
	return true
}

func (s *Service) recordAgentStatus(project *ProjectSession, runID string, phase string, state string, title string, detail string, actor string, toolID string, correlationID string, allowTerminal bool) (bool, error) {
	run, err := agentCommunicationRun(project, runID, s, allowTerminal)
	if err != nil {
		return false, err
	}
	phase, ok := normalizeAgentCommunicationValue(phase, agentStatusPhases, "running")
	if !ok {
		return false, fmt.Errorf("unsupported agent status phase")
	}
	state, ok = normalizeAgentCommunicationValue(state, agentStatusStates, "active")
	if !ok {
		return false, fmt.Errorf("unsupported agent status state")
	}
	title = truncateUTF8(sanitizedDisplayText(title), maxAgentStatusTitleBytes)
	if title == "" {
		return false, fmt.Errorf("agent status title is required")
	}
	detail = truncateUTF8(sanitizedDisplayText(detail), maxAgentStatusDetailBytes)
	summary := title
	if detail != "" && detail != title {
		summary += ": " + detail
	}
	shouldRecord, decisionErr := s.agentCommunicationEventDecision(project, run.ID, "agent_status_"+phase, state, summary)
	if decisionErr != nil || !shouldRecord {
		return false, decisionErr
	}
	event := AIRunTimelineEvent{
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Source:           "agent_runtime",
		Type:             "agent_status_" + phase,
		Status:           state,
		Actor:            firstNonEmpty(actor, "system"),
		ProviderID:       run.ProviderID,
		Model:            run.Model,
		ToolID:           strings.TrimSpace(toolID),
		CorrelationID:    firstNonEmpty(correlationID, "agent-runtime:"+phase),
		Summary:          summary,
		Capability:       providers.CapabilityChat,
	}
	if allowTerminal {
		s.recordRunTimeline(project, event)
	} else if !s.recordActiveAgentTimeline(project, event) {
		return false, nil
	}
	return true, nil
}

func (s *Service) recordAgentCommentary(project *ProjectSession, runID string, kind string, message string, toolID string, correlationID string) (bool, error) {
	run, err := agentCommunicationRun(project, runID, s, false)
	if err != nil {
		return false, err
	}
	kind, ok := normalizeAgentCommunicationValue(kind, agentCommentaryKinds, "progress")
	if !ok {
		return false, fmt.Errorf("unsupported agent commentary kind")
	}
	message = truncateUTF8(sanitizedDisplayText(message), maxAgentCommentaryBytes)
	if message == "" {
		return false, fmt.Errorf("agent commentary message is required")
	}
	shouldRecord, decisionErr := s.agentCommunicationEventDecision(project, run.ID, "assistant_commentary", kind, message)
	if decisionErr != nil || !shouldRecord {
		return false, decisionErr
	}
	if !s.recordActiveAgentTimeline(project, AIRunTimelineEvent{
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Source:           "assistant",
		Type:             "assistant_commentary",
		Status:           kind,
		Actor:            "assistant",
		ProviderID:       run.ProviderID,
		Model:            run.Model,
		ToolID:           strings.TrimSpace(toolID),
		CorrelationID:    firstNonEmpty(correlationID, "agent-commentary:"+kind),
		Summary:          message,
		Capability:       providers.CapabilityChat,
	}) {
		return false, nil
	}
	return true, nil
}

func (s *Service) publishAgentRuntimePhase(project *ProjectSession, runID string, phase string, state string, title string, detail string, commentary string, commentaryKind string, allowTerminal bool) {
	_, _ = s.recordAgentStatus(project, runID, phase, state, title, detail, "system", "", "agent-runtime:"+phase, allowTerminal)
	if strings.TrimSpace(commentary) != "" && !allowTerminal {
		_, _ = s.recordAgentCommentary(project, runID, commentaryKind, commentary, "", "agent-runtime-commentary:"+phase)
	}
}

func (s *Service) executeAgentStatusUpdateTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	recorded, err := s.recordAgentStatus(project, req.RunID, req.Arguments["phase"], req.Arguments["state"], req.Arguments["title"], req.Arguments["detail"], "agent", "agent.status.update", "agent-status:"+req.Arguments["phase"], false)
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		return result
	}
	result.Status = "recorded"
	if recorded {
		result.OutputPreview = "Agent Runtime status recorded."
	} else {
		result.OutputPreview = "Agent Runtime status unchanged."
	}
	return result
}

func (s *Service) executeAgentCommentaryTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	recorded, err := s.recordAgentCommentary(project, req.RunID, req.Arguments["kind"], req.Arguments["message"], "agent.commentary", result.ID)
	if err != nil {
		result.Status = "error"
		result.Error = err.Error()
		return result
	}
	result.Status = "recorded"
	if recorded {
		result.OutputPreview = "Commentary delivered."
	} else {
		result.OutputPreview = "Commentary already delivered."
	}
	return result
}
