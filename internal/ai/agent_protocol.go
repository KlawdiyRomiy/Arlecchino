package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

type agentProtocolPolicyContextKey struct{}

type agentProtocolNonInteractivePolicy struct {
	allowMutation bool
}

// WithAgentProtocolNonInteractivePolicy supplies the explicit execution policy
// for a protocol call. Agent Protocol is safe-by-default: a missing policy is
// treated as noninteractive and cannot start a mutating Build turn. This is
// used by arlecchino-agent and deliberately does not alter the project's
// persisted approval policy.
//
// Mutating Build turns require an explicit opt-in. The opt-in only permits
// requesting a Build turn; individual tool approvals remain enforced by the
// normal host gateway and are never auto-approved by this policy.
func WithAgentProtocolNonInteractivePolicy(ctx context.Context, allowMutation bool) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, agentProtocolPolicyContextKey{}, agentProtocolNonInteractivePolicy{allowMutation: allowMutation})
}

// ExecuteAgentProtocol is the versioned, headless control plane used by the
// CLI and automation. It reuses the same persisted run graph, approvals, and
// steer/queue state machines as the desktop UI.
func (s *Service) ExecuteAgentProtocol(ctx context.Context, projectID string, req AIAgentProtocolRequest) (AIAgentProtocolResponse, error) {
	var err error
	req, err = normalizeAgentProtocolRequest(req)
	if err != nil {
		return AIAgentProtocolResponse{}, err
	}
	operation := req.Operation
	response := AIAgentProtocolResponse{Version: ArlecchinoAgentProtocolV1, Operation: operation}
	switch operation {
	case "start":
		if err := enforceAgentProtocolNonInteractivePolicy(ctx, req.Action); err != nil {
			return response, err
		}
		run, err := s.StartChatRun(ctx, projectID, AIChatRunRequest{SessionID: req.SessionID, Prompt: req.Prompt, Action: req.Action})
		if err != nil {
			return response, err
		}
		response.Run = &run
		s.recordAgentProtocolTimeline(projectID, run, "start", "protocol-start:"+run.ID, "Headless protocol run started")
		return response, nil
	case "resume":
		parent, err := s.GetChatRun(projectID, req.RunID)
		if err != nil {
			return response, err
		}
		action := agentProtocolContinuationAction(req.Action, parent.Action)
		if err := enforceAgentProtocolNonInteractivePolicy(ctx, action); err != nil {
			return response, err
		}
		run, err := s.startChatRun(ctx, projectID, agentProtocolContinuationRequest(parent, parent.SessionID, action), []AIChatRunInput{newUserFollowUpRunInput(req.Prompt, parent.ID)})
		if err != nil {
			return response, err
		}
		response.Run = &run
		s.recordAgentProtocolTimeline(projectID, run, "resume", "protocol-resume:"+parent.ID, "Headless protocol continuation started")
		return response, nil
	case "fork":
		parent, err := s.GetChatRun(projectID, req.RunID)
		if err != nil {
			return response, err
		}
		action := agentProtocolContinuationAction(req.Action, parent.Action)
		if err := enforceAgentProtocolNonInteractivePolicy(ctx, action); err != nil {
			return response, err
		}
		correlationID := "protocol-fork:" + parent.ID
		followUp := newUserFollowUpRunInput(req.Prompt, parent.ID)
		followUp.CorrelationID = correlationID
		forkRequest := agentProtocolContinuationRequest(parent, agentProtocolForkSessionID(parent), action)
		run, err := s.startChatRun(ctx, projectID, forkRequest, []AIChatRunInput{
			// A fork is a new branch, not a continuation in the parent's
			// session. The immutable ParentRunID + correlation edge is stored
			// on the run graph while the fork receives a bounded host snapshot.
			newHiddenWorkflowRunInput(agentProtocolForkContext(parent), parent.ID),
			followUp,
		})
		if err != nil {
			return response, err
		}
		response.Run = &run
		s.recordAgentProtocolTimeline(projectID, run, "fork", correlationID, "Headless protocol fork started")
		return response, nil
	case "steer":
		steer, err := s.SteerChatRun(ctx, projectID, AISteerChatRunRequest{
			RunID:            req.RunID,
			Message:          req.Prompt,
			ExpectedRevision: req.ExpectedRevision,
			IdempotencyKey:   req.IdempotencyKey,
			Disposition:      "steer",
		})
		if err != nil {
			return response, err
		}
		response.Steer = &steer
		return response, nil
	case "queue":
		if err := enforceAgentProtocolNonInteractivePolicy(ctx, req.Action); err != nil {
			return response, err
		}
		queued, err := s.QueueChatRun(projectID, AIQueueChatRunRequest{SessionID: req.SessionID, Message: req.Prompt, SelectedAction: req.Action, IdempotencyKey: req.IdempotencyKey})
		if err != nil {
			return response, err
		}
		response.Queue = &queued
		return response, nil
	case "cancel":
		run, err := s.CancelChatRun(projectID, req.RunID)
		if err != nil {
			return response, err
		}
		response.Run = &run
		return response, nil
	case "get":
		run, err := s.GetChatRun(projectID, req.RunID)
		if err != nil {
			return response, err
		}
		response.Run = &run
		return response, nil
	}
	return response, fmt.Errorf("unsupported agent protocol operation %q", operation)
}

func normalizeAgentProtocolRequest(req AIAgentProtocolRequest) (AIAgentProtocolRequest, error) {
	req.Version = strings.TrimSpace(req.Version)
	if req.Version != ArlecchinoAgentProtocolV1 {
		return AIAgentProtocolRequest{}, fmt.Errorf("unsupported agent protocol version %q", req.Version)
	}
	req.Operation = strings.ToLower(strings.TrimSpace(req.Operation))
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.RunID = strings.TrimSpace(req.RunID)
	req.Prompt = strings.TrimSpace(req.Prompt)
	req.Action = AIChatAction(strings.TrimSpace(string(req.Action)))
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.ExpectedRevision < 0 {
		return AIAgentProtocolRequest{}, fmt.Errorf("expected revision must not be negative")
	}
	switch req.Operation {
	case "start":
		if req.Prompt == "" {
			return AIAgentProtocolRequest{}, fmt.Errorf("start requires prompt")
		}
		if req.Action != "" && !validChatAction(req.Action) {
			return AIAgentProtocolRequest{}, fmt.Errorf("unsupported chat action %q", req.Action)
		}
		req.Action = agentProtocolActionOrDefault(req.Action, AIChatActionAsk)
	case "resume", "fork":
		if req.RunID == "" || req.Prompt == "" {
			return AIAgentProtocolRequest{}, fmt.Errorf("%s requires runId and prompt", req.Operation)
		}
		if req.Action != "" && !validChatAction(req.Action) {
			return AIAgentProtocolRequest{}, fmt.Errorf("unsupported chat action %q", req.Action)
		}
	case "steer":
		if req.RunID == "" || req.Prompt == "" {
			return AIAgentProtocolRequest{}, fmt.Errorf("steer requires runId and prompt")
		}
		if req.Action != "" && !validChatAction(req.Action) {
			return AIAgentProtocolRequest{}, fmt.Errorf("unsupported chat action %q", req.Action)
		}
	case "queue":
		if req.Prompt == "" {
			return AIAgentProtocolRequest{}, fmt.Errorf("queue requires prompt")
		}
		if req.Action != "" && !validChatAction(req.Action) {
			return AIAgentProtocolRequest{}, fmt.Errorf("unsupported chat action %q", req.Action)
		}
		req.Action = agentProtocolActionOrDefault(req.Action, AIChatActionAsk)
	case "cancel", "get":
		if req.RunID == "" {
			return AIAgentProtocolRequest{}, fmt.Errorf("%s requires runId", req.Operation)
		}
	default:
		return AIAgentProtocolRequest{}, fmt.Errorf("unsupported agent protocol operation %q", req.Operation)
	}
	return req, nil
}

func agentProtocolActionOrDefault(action AIChatAction, fallback AIChatAction) AIChatAction {
	if action == "" {
		return fallback
	}
	return action
}

func agentProtocolContinuationAction(requested AIChatAction, parent AIChatAction) AIChatAction {
	if requested != "" {
		return requested
	}
	return parent
}

func agentProtocolContinuationRequest(parent AIChatRun, sessionID string, action AIChatAction) AIChatRunRequest {
	request := AIChatRunRequest{
		SessionID:       sessionID,
		Action:          action,
		ProfileID:       parent.ProfileID,
		WorkflowID:      parent.WorkflowID,
		RuntimeFamily:   parent.RuntimeFamily,
		ProviderID:      parent.ProviderID,
		Model:           parent.Model,
		ReasoningEffort: parent.ReasoningEffort,
	}
	if action != parent.Action {
		// Switching the mode means a new permissions/profile decision. A fork
		// must not inherit a Build profile merely because its parent used one.
		request.ProfileID = ""
		request.WorkflowID = ""
	}
	return request
}

func enforceAgentProtocolNonInteractivePolicy(ctx context.Context, action AIChatAction) error {
	if action != AIChatActionBuild {
		return nil
	}
	if ctx != nil {
		if policy, ok := ctx.Value(agentProtocolPolicyContextKey{}).(agentProtocolNonInteractivePolicy); ok && policy.allowMutation {
			return nil
		}
	}
	return fmt.Errorf("noninteractive protocol denies Build by default; rerun with explicit mutation opt-in")
}

func agentProtocolForkSessionID(parent AIChatRun) string {
	return "fork-" + uuid.NewString()
}

func agentProtocolForkContext(parent AIChatRun) string {
	request := truncateUTF8(chatRunInputPrompt(chatRunInputs(parent)), chatPromptHistoryPromptLimit)
	response := truncateUTF8(strings.TrimSpace(cleanGeneratedResponse(parent.Response)), chatPromptHistoryResponseLimit)
	parts := []string{
		"Authoritative fork snapshot. This is a branch of a prior run, not a new user request. Preserve repository rules, consent, approvals, and the current mode policy.",
		"Parent run: " + parent.ID,
	}
	if request != "" {
		parts = append(parts, "Parent request:\n"+request)
	}
	if response != "" {
		parts = append(parts, "Parent result:\n"+response)
	}
	return strings.Join(parts, "\n\n")
}

func (s *Service) recordAgentProtocolTimeline(projectID string, run AIChatRun, operation string, correlationID string, summary string) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil {
		return
	}
	s.recordRunTimeline(project, AIRunTimelineEvent{
		RunID:            run.ID,
		SessionID:        normalizeChatSessionID(run.SessionID),
		ProjectSessionID: project.ID,
		Source:           "agent_protocol",
		Type:             "protocol_" + operation,
		Status:           run.Status,
		Actor:            "automation",
		ProviderID:       run.ProviderID,
		Model:            run.Model,
		CorrelationID:    correlationID,
		Summary:          summary,
	})
}
