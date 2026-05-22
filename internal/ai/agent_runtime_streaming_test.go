package ai

import (
	"testing"

	"arlecchino/internal/ai/agents"
)

func TestAgentRuntimeMessageDeltasPreserveWhitespace(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	runID := "run-agent-runtime-stream-whitespace"
	service.mu.Lock()
	service.runs[runID] = &AIChatRun{
		ID:               runID,
		ProjectSessionID: project.ID,
		Action:           AIChatActionPlan,
		Status:           "running",
		AgentRuntime:     &AIExternalAgentRunSummary{ProofState: "running"},
	}
	service.mu.Unlock()

	for _, token := range []string{"hello", " ", "world", "\n\n", "done"} {
		service.handleAgentRuntimeEvent(project, runID, agents.Event{
			RunID:     runID,
			Type:      agents.EventMessage,
			Status:    "message.delta",
			Text:      token,
			CreatedAt: utcNow(),
		})
	}

	run, err := service.GetChatRun("main", runID)
	if err != nil {
		t.Fatalf("GetChatRun: %v", err)
	}
	if run.Response != "hello world\n\ndone" {
		t.Fatalf("response = %q", run.Response)
	}
}
