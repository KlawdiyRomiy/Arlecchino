package ai

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"arlecchino/internal/ai/agents"
)

func TestAgentCapturedDiffUsesDirtyBaselineSnapshot(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	projectRoot := t.TempDir()
	initAgentDirtyBaselineGitRepo(t, projectRoot)
	mainPath := filepath.Join(projectRoot, "main.go")
	helperPath := filepath.Join(projectRoot, "helper.go")
	if err := os.WriteFile(mainPath, []byte("package main\n\nfunc value() string { return \"before\" }\n"), 0o600); err != nil {
		t.Fatalf("WriteFile main: %v", err)
	}
	if err := os.WriteFile(helperPath, []byte("package main\n\nfunc helper() string { return \"before\" }\n"), 0o600); err != nil {
		t.Fatalf("WriteFile helper: %v", err)
	}
	runAgentDirtyBaselineGit(t, projectRoot, "add", "main.go", "helper.go")
	runAgentDirtyBaselineGit(t, projectRoot, "commit", "-m", "initial")
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	runID := "agent-dirty-baseline-run"
	service.mu.Lock()
	service.runs[runID] = &AIChatRun{
		ID:               runID,
		SessionID:        defaultChatSessionID,
		ProjectSessionID: project.ID,
		Action:           AIChatActionBuild,
		Status:           "running",
		RuntimeFamily:    agents.RuntimeFamilyJSONLExec,
		ProviderID:       "agent-cli-codex",
		CreatedAt:        utcNow(),
		UpdatedAt:        utcNow(),
	}
	service.mu.Unlock()
	if err := os.WriteFile(mainPath, []byte("package main\n\nfunc value() string { return \"user-dirty\" }\n"), 0o600); err != nil {
		t.Fatalf("WriteFile user dirty: %v", err)
	}
	baseline := captureAgentWorktreeBaseline(project)
	if baseline.Error != "" {
		t.Fatalf("baseline error: %s", baseline.Error)
	}
	if baseline.Clean {
		t.Fatalf("baseline should be dirty: %#v", baseline)
	}
	if baseline.SnapshotTree == "" {
		t.Fatalf("baseline snapshot tree missing: %#v", baseline)
	}
	if err := os.WriteFile(mainPath, []byte("package main\n\nfunc value() string { return \"agent-change\" }\n"), 0o600); err != nil {
		t.Fatalf("WriteFile agent main: %v", err)
	}
	if err := os.WriteFile(helperPath, []byte("package main\n\nfunc helper() string { return \"agent-helper\" }\n"), 0o600); err != nil {
		t.Fatalf("WriteFile agent helper: %v", err)
	}

	artifact, err := service.recordAgentCapturedDiff(project, runID, AIChatRunRequest{Action: AIChatActionBuild}, baseline)
	if err != nil {
		t.Fatalf("recordAgentCapturedDiff: %v", err)
	}
	if artifact.Status != "applied" {
		t.Fatalf("artifact status = %s, want applied", artifact.Status)
	}
	payload, err := patchPayloadFromArtifact(artifact)
	if err != nil {
		t.Fatalf("patchPayloadFromArtifact: %v", err)
	}
	if !strings.Contains(payload.UnifiedDiff, "user-dirty") || !strings.Contains(payload.UnifiedDiff, "agent-change") {
		t.Fatalf("dirty file baseline-to-agent diff missing:\n%s", payload.UnifiedDiff)
	}
	if strings.Contains(payload.UnifiedDiff, "-func value() string { return \"before\" }") {
		t.Fatalf("captured diff leaked HEAD baseline instead of dirty baseline:\n%s", payload.UnifiedDiff)
	}
	if !strings.Contains(payload.UnifiedDiff, "agent-helper") {
		t.Fatalf("clean file agent diff missing:\n%s", payload.UnifiedDiff)
	}
	if len(payload.CheckpointIDs) != 2 {
		t.Fatalf("checkpoint IDs = %#v", payload.CheckpointIDs)
	}
	if _, err := service.RollbackPatchCheckpoint("main", AIPatchRollbackRequest{ArtifactID: artifact.ID}); err != nil {
		t.Fatalf("RollbackPatchCheckpoint: %v", err)
	}
	mainContent, err := os.ReadFile(mainPath)
	if err != nil {
		t.Fatalf("ReadFile main: %v", err)
	}
	if !strings.Contains(string(mainContent), "user-dirty") || strings.Contains(string(mainContent), "agent-change") {
		t.Fatalf("rollback main content = %q", string(mainContent))
	}
	helperContent, err := os.ReadFile(helperPath)
	if err != nil {
		t.Fatalf("ReadFile helper: %v", err)
	}
	if !strings.Contains(string(helperContent), "before") || strings.Contains(string(helperContent), "agent-helper") {
		t.Fatalf("rollback helper content = %q", string(helperContent))
	}
}

func TestAgentCapturedDiffSkipsUnchangedUnsafeBaseline(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	projectRoot := t.TempDir()
	initAgentDirtyBaselineGitRepo(t, projectRoot)
	if err := os.WriteFile(filepath.Join(projectRoot, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatalf("WriteFile main: %v", err)
	}
	runAgentDirtyBaselineGit(t, projectRoot, "add", "main.go")
	runAgentDirtyBaselineGit(t, projectRoot, "commit", "-m", "initial")
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	runID := "agent-unsafe-unchanged-baseline-run"
	service.mu.Lock()
	service.runs[runID] = &AIChatRun{
		ID:               runID,
		SessionID:        defaultChatSessionID,
		ProjectSessionID: project.ID,
		Action:           AIChatActionAsk,
		Status:           "running",
		RuntimeFamily:    agents.RuntimeFamilyJSONLExec,
		ProviderID:       "agent-cli-codex",
		CreatedAt:        utcNow(),
		UpdatedAt:        utcNow(),
	}
	service.mu.Unlock()
	if err := os.WriteFile(filepath.Join(projectRoot, ".env"), []byte("TOKEN=local\n"), 0o600); err != nil {
		t.Fatalf("WriteFile .env: %v", err)
	}
	baseline := captureAgentWorktreeBaseline(project)
	if baseline.Error == "" {
		t.Fatalf("baseline should reject unsafe snapshot path: %#v", baseline)
	}

	artifact, err := service.recordAgentCapturedDiff(project, runID, AIChatRunRequest{Action: AIChatActionAsk}, baseline)
	if err != nil {
		t.Fatalf("unchanged unsafe baseline should not fail capture: %v", err)
	}
	if artifact.ID != "" {
		t.Fatalf("unchanged unsafe baseline created artifact: %#v", artifact)
	}
}

func TestAgentCapturedDiffSkipsGitUnavailableBaseline(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	projectRoot := t.TempDir()
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	runID := "agent-no-git-baseline-run"
	service.mu.Lock()
	service.runs[runID] = &AIChatRun{
		ID:               runID,
		SessionID:        defaultChatSessionID,
		ProjectSessionID: project.ID,
		Action:           AIChatActionBuild,
		Status:           "running",
		RuntimeFamily:    agents.RuntimeFamilyJSONLExec,
		ProviderID:       "agent-cli-codex",
		CreatedAt:        utcNow(),
		UpdatedAt:        utcNow(),
	}
	service.mu.Unlock()
	baseline := captureAgentWorktreeBaseline(project)
	if !agentBaselineGitUnavailable(baseline.Error) {
		t.Fatalf("baseline should report missing git repo: %#v", baseline)
	}
	if err := os.WriteFile(filepath.Join(projectRoot, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatalf("WriteFile main: %v", err)
	}

	artifact, err := service.recordAgentCapturedDiff(project, runID, AIChatRunRequest{Action: AIChatActionBuild}, baseline)
	if err != nil {
		t.Fatalf("git-unavailable baseline should not fail capture: %v", err)
	}
	if artifact.ID != "" {
		t.Fatalf("git-unavailable baseline created artifact: %#v", artifact)
	}
}

func initAgentDirtyBaselineGitRepo(t *testing.T, root string) {
	t.Helper()
	runAgentDirtyBaselineGit(t, root, "init")
	runAgentDirtyBaselineGit(t, root, "config", "user.email", "test@example.com")
	runAgentDirtyBaselineGit(t, root, "config", "user.name", "Test User")
}

func runAgentDirtyBaselineGit(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, string(output))
	}
}
