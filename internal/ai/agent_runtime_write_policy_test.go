package ai

import "testing"

func TestExternalAgentWorkspaceWriteRequiresHostFullAccessForFileAndTerminal(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	project, err := service.OpenProject("main", t.TempDir())
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	request := AIChatRunRequest{Action: AIChatActionBuild}
	if service.externalAgentWorkspaceWriteAllowed(project, request) {
		t.Fatal("default ask-each-time policy allowed provider-owned workspace writes")
	}

	if _, err := service.SaveApprovalPolicy(project.ID, AIApprovalPolicy{
		Mode:             AIApprovalModeFullAccess,
		AllowedToolKinds: []AIToolKind{AIToolKindFileWrite},
	}); err != nil {
		t.Fatalf("SaveApprovalPolicy file-write only: %v", err)
	}
	if service.externalAgentWorkspaceWriteAllowed(project, request) {
		t.Fatal("file-write-only policy allowed provider shell writes")
	}

	if _, err := service.SaveApprovalPolicy(project.ID, AIApprovalPolicy{
		Mode:             AIApprovalModeFullAccess,
		AllowedToolKinds: []AIToolKind{AIToolKindFileWrite, AIToolKindTerminal},
	}); err != nil {
		t.Fatalf("SaveApprovalPolicy full access: %v", err)
	}
	if !service.externalAgentWorkspaceWriteAllowed(project, request) {
		t.Fatal("explicit Full Access with file and terminal permission did not allow workspace writes")
	}
	if service.externalAgentWorkspaceWriteAllowed(project, AIChatRunRequest{Action: AIChatActionPlan}) {
		t.Fatal("non-Build mode inherited provider workspace writes")
	}
}
