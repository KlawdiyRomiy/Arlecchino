package ai

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"arlecchino/internal/ai/agents"
	"arlecchino/internal/ai/providers"
)

func TestAgentRuntimeBuildRejectsArtifactStateWithoutEvidenceArtifact(t *testing.T) {
	service := newTestService(t, nil)
	defer service.Close()
	if _, err := service.SaveConsentPolicy(AIConsentPolicy{ExternalAgentCLIAccepted: true}); err != nil {
		t.Fatalf("SaveConsentPolicy: %v", err)
	}
	projectRoot := t.TempDir()
	initAgentRuntimeKernelGitRepo(t, projectRoot)
	if err := os.WriteFile(filepath.Join(projectRoot, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	runAgentRuntimeKernelGit(t, projectRoot, "add", "main.go")
	runAgentRuntimeKernelGit(t, projectRoot, "commit", "-m", "initial")
	if _, err := service.OpenProject("main", projectRoot); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	adapter := &artifactStateProjectionOnlyAdapter{id: "agent-cli-projection-only"}
	service.agents.Register(adapter)
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action:        AIChatActionBuild,
		RuntimeFamily: agents.RuntimeFamilyJSONLExec,
		ProviderID:    adapter.id,
		Prompt:        "claim no change without evidence",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	if final.Status != "error" {
		t.Fatalf("run status = %s, want error", final.Status)
	}
	if final.AgentRuntime == nil || final.AgentRuntime.FailureCode != agents.FailureBuildArtifactMissing || final.AgentRuntime.ProofState != "blocked" {
		t.Fatalf("artifact-state-only proof = %#v", final.AgentRuntime)
	}
}

type artifactStateProjectionOnlyAdapter struct {
	id string
}

func (a *artifactStateProjectionOnlyAdapter) ID() string {
	return a.id
}

func (a *artifactStateProjectionOnlyAdapter) Descriptor(context.Context) agents.Descriptor {
	return agents.Descriptor{
		ID:                 a.id,
		Name:               "Projection Only Agent",
		Kind:               "test_cli",
		RuntimeFamily:      agents.RuntimeFamilyJSONLExec,
		Transport:          agents.TransportJSONLExec,
		Binary:             "test-cli",
		EndpointClass:      agents.EndpointClassLocalProcess,
		AuthMode:           providers.ProviderAuthModeOAuth,
		AuthStatus:         "ready",
		BillingMode:        "provider_account",
		LegalBasis:         "test_cli",
		RiskTier:           "test",
		RuntimeVersion:     "test-cli 1.0.0",
		AdapterVersion:     "test-adapter-v1",
		ProtocolVersion:    "test-jsonl-v1",
		CompatibilityRange: "test-cli 1.x",
		Capabilities:       []providers.AIProviderCapability{providers.CapabilityChat, providers.CapabilityPatchGeneration},
		SupportedActions:   []string{"ask", "build"},
		Models:             []providers.AIModelDescriptor{{ID: "default", DisplayName: "default"}},
		DefaultModel:       "default",
		Status:             providers.ProviderStatusReady,
	}
}

func (a *artifactStateProjectionOnlyAdapter) Run(_ context.Context, req agents.RunRequest, emit func(agents.Event)) agents.Result {
	emit(agents.Event{
		RunID:     req.RunID,
		Type:      agents.EventStatus,
		Status:    "runtime_proof",
		Payload:   map[string]any{"transport": agents.TransportJSONLExec, "artifactState": "explicit_no_change", "proofState": "proved"},
		CreatedAt: utcNow(),
	})
	emit(agents.Event{
		RunID:     req.RunID,
		Type:      agents.EventStatus,
		Status:    "first_provider_event",
		Payload:   map[string]any{"providerEventType": "turn.started"},
		CreatedAt: utcNow(),
	})
	return agents.Result{
		Status:     "completed",
		Message:    "completed without edits",
		ExitCode:   0,
		Transport:  agents.TransportJSONLExec,
		StartedAt:  utcNow(),
		FinishedAt: utcNow(),
	}
}

func initAgentRuntimeKernelGitRepo(t *testing.T, dir string) {
	t.Helper()
	runAgentRuntimeKernelGit(t, dir, "init")
	runAgentRuntimeKernelGit(t, dir, "config", "user.email", "test@example.invalid")
	runAgentRuntimeKernelGit(t, dir, "config", "user.name", "Test User")
}

func runAgentRuntimeKernelGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}
