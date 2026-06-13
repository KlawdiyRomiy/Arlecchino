package ai

import (
	"strings"

	"arlecchino/internal/ai/agents"
)

type RuntimeStepState string

const (
	RuntimeStepRequested RuntimeStepState = "requested"
	RuntimeStepProposed  RuntimeStepState = "proposed"
	RuntimeStepApproved  RuntimeStepState = "approved"
	RuntimeStepDenied    RuntimeStepState = "denied"
	RuntimeStepExecuting RuntimeStepState = "executing"
	RuntimeStepEvidenced RuntimeStepState = "evidenced"
	RuntimeStepCompleted RuntimeStepState = "completed"
	RuntimeStepBlocked   RuntimeStepState = "blocked"
	RuntimeStepCanceled  RuntimeStepState = "canceled"
)

type RuntimeTurn struct {
	RunID         string `json:"runId"`
	ThreadID      string `json:"threadId"`
	TurnID        string `json:"turnId"`
	RuntimeFamily string `json:"runtimeFamily"`
	Transport     string `json:"transport"`
	Action        string `json:"action"`
	CreatedAt     string `json:"createdAt"`
}

type RuntimeItem struct {
	RunID         string `json:"runId"`
	ThreadID      string `json:"threadId"`
	TurnID        string `json:"turnId"`
	ItemID        string `json:"itemId"`
	CorrelationID string `json:"correlationId"`
	Kind          string `json:"kind"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
}

type RuntimeStep struct {
	RunID         string           `json:"runId"`
	ThreadID      string           `json:"threadId,omitempty"`
	TurnID        string           `json:"turnId,omitempty"`
	ItemID        string           `json:"itemId,omitempty"`
	CorrelationID string           `json:"correlationId"`
	State         RuntimeStepState `json:"state"`
	ToolID        string           `json:"toolId,omitempty"`
	ArtifactID    string           `json:"artifactId,omitempty"`
	FailureCode   string           `json:"failureCode,omitempty"`
	CreatedAt     string           `json:"createdAt"`
	UpdatedAt     string           `json:"updatedAt"`
}

type RuntimePermissionRequest struct {
	RunID                string   `json:"runId"`
	ThreadID             string   `json:"threadId,omitempty"`
	TurnID               string   `json:"turnId,omitempty"`
	ItemID               string   `json:"itemId,omitempty"`
	ApprovalID           string   `json:"approvalId,omitempty"`
	CorrelationID        string   `json:"correlationId"`
	ToolID               string   `json:"toolId"`
	RequestedPermissions []string `json:"requestedPermissions,omitempty"`
	GrantedPermissions   []string `json:"grantedPermissions,omitempty"`
	DeniedPermissions    []string `json:"deniedPermissions,omitempty"`
	Scope                string   `json:"scope,omitempty"`
	Reason               string   `json:"reason,omitempty"`
}

type RuntimeBuildEvidence struct {
	RunID         string            `json:"runId"`
	Kind          string            `json:"kind"`
	Status        string            `json:"status"`
	CorrelationID string            `json:"correlationId,omitempty"`
	Summary       string            `json:"summary,omitempty"`
	Details       string            `json:"details,omitempty"`
	Source        string            `json:"source,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	CreatedAt     string            `json:"createdAt"`
}

func syntheticRuntimeTurn(runID string, action AIChatAction, runtimeFamily string, transport string) RuntimeTurn {
	now := utcNow()
	return RuntimeTurn{
		RunID:         strings.TrimSpace(runID),
		ThreadID:      "thread-" + shortHash(runID+":model-thread"),
		TurnID:        "turn-" + shortHash(runID+":model-turn"),
		RuntimeFamily: firstNonEmpty(runtimeFamily, agents.RuntimeFamilyModelAgent),
		Transport:     firstNonEmpty(transport, agents.TransportModelAPI),
		Action:        string(action),
		CreatedAt:     now,
	}
}

func runtimeCorrelationID(parts ...string) string {
	joined := strings.Join(parts, ":")
	if strings.TrimSpace(joined) == "" {
		joined = utcNow()
	}
	return "runtime-corr-" + shortHash(joined)
}
