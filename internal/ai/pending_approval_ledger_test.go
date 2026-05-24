package ai

import (
	"context"
	"testing"
)

func TestPendingApprovalsUseLedgerForToolLifecycle(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	projectRoot := t.TempDir()
	if _, err := service.OpenProject("main", projectRoot); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action: AIChatActionBuild,
		Prompt: "terminal check",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	if final := waitForRunStatus(t, service, run.ID); final.Status != "completed" {
		t.Fatalf("final run = %#v", final)
	}
	args := map[string]string{"command": "printf ok"}
	required, err := service.ExecuteToolCall(context.Background(), "main", AIToolCallRequest{
		RunID:     run.ID,
		ToolID:    "terminal.preview",
		Action:    AIToolCallActionExecute,
		Arguments: args,
	})
	if err != nil {
		t.Fatalf("ExecuteToolCall approval required: %v", err)
	}
	if required.Status != "approval_required" {
		t.Fatalf("required = %#v", required)
	}
	pending, err := service.ListPendingApprovals("main", 10)
	if err != nil {
		t.Fatalf("ListPendingApprovals pending: %v", err)
	}
	if len(pending) != 1 || pending[0].RunID != run.ID || pending[0].ToolID != "terminal.preview" || pending[0].CommandPreview != "printf ok" {
		t.Fatalf("pending approvals = %#v", pending)
	}
	if _, err := service.SaveApprovalPolicy("main", AIApprovalPolicy{
		Mode:             AIApprovalModeFullAccess,
		AllowedToolKinds: []AIToolKind{AIToolKindTerminal},
	}); err != nil {
		t.Fatalf("SaveApprovalPolicy: %v", err)
	}
	executed, err := service.ExecuteToolCall(context.Background(), "main", AIToolCallRequest{
		RunID:     run.ID,
		ToolID:    "terminal.preview",
		Action:    AIToolCallActionExecute,
		Arguments: args,
	})
	if err != nil {
		t.Fatalf("ExecuteToolCall approved: %v", err)
	}
	if executed.Status != "executed" {
		t.Fatalf("executed = %#v", executed)
	}
	pending, err = service.ListPendingApprovals("main", 10)
	if err != nil {
		t.Fatalf("ListPendingApprovals resolved: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("resolved pending approvals = %#v", pending)
	}
}
