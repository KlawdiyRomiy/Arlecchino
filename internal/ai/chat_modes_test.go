package ai

import (
	"context"
	"strings"
	"testing"
)

func TestSmallTalkBuildAndDebugDoNotAttachToolProposals(t *testing.T) {
	for _, action := range []AIChatAction{AIChatActionBuild, AIChatActionDebug} {
		t.Run(string(action), func(t *testing.T) {
			service := newTestService(t, nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
				Action: action,
				Prompt: "Привет",
			})
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			if final.Status != "completed" {
				t.Fatalf("final run = %#v", final)
			}
			if len(final.ToolProposals) != 0 {
				t.Fatalf("small talk should not expose tool proposals: %#v", final.ToolProposals)
			}
			envelope, err := service.GetChatRunEnvelope("main", run.ID)
			if err != nil {
				t.Fatalf("GetChatRunEnvelope: %v", err)
			}
			if len(envelope.ToolProposals) != 0 || envelope.ToolProposalSummary.Total != 0 {
				t.Fatalf("small talk envelope should not expose tool proposals: %#v", envelope)
			}
		})
	}
}

func TestModeSystemPromptsShareIdentityAndSmallTalkBoundary(t *testing.T) {
	for _, action := range []AIChatAction{
		AIChatActionAsk,
		AIChatActionPlan,
		AIChatActionBuild,
		AIChatActionDebug,
	} {
		prompt := systemPromptForAction(action)
		for _, want := range []string{
			"same identity across Ask, Plan, Build, and Debug",
			"Match the user's language",
			"only a greeting",
		} {
			if !strings.Contains(prompt, want) {
				t.Fatalf("%s prompt missing %q: %s", action, want, prompt)
			}
		}
	}
}

func TestRuntimeStateQuestionsUseBackendStateWithoutProvider(t *testing.T) {
	for _, action := range []AIChatAction{
		AIChatActionAsk,
		AIChatActionPlan,
		AIChatActionBuild,
		AIChatActionDebug,
	} {
		t.Run(string(action), func(t *testing.T) {
			service := newTestService(t, nil)
			if _, err := service.OpenProject("main", t.TempDir()); err != nil {
				t.Fatalf("OpenProject: %v", err)
			}
			run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
				Action: action,
				Prompt: "В каком ты щас режиме?",
			})
			if err != nil {
				t.Fatalf("StartChatRun: %v", err)
			}
			final := waitForRunStatus(t, service, run.ID)
			want := "Сейчас я работаю в режиме " + chatActionDisplayName(action) + "."
			if final.Response != want {
				t.Fatalf("response = %q, want %q", final.Response, want)
			}
			if final.EgressRecordID != "" {
				t.Fatalf("runtime state question should not call provider: %#v", final)
			}
			if len(final.ToolProposals) != 0 {
				t.Fatalf("runtime state question should not expose tool proposals: %#v", final.ToolProposals)
			}
		})
	}
}

func TestRuntimeStateQuestionsCanReportProviderModelAndProfile(t *testing.T) {
	service := newTestService(t, nil)
	if _, err := service.OpenProject("main", t.TempDir()); err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	run, err := service.StartChatRun(context.Background(), "main", AIChatRunRequest{
		Action:     AIChatActionDebug,
		Prompt:     "what current mode, provider, model and profile are you using?",
		ProviderID: "local-test",
		Model:      "local-model",
	})
	if err != nil {
		t.Fatalf("StartChatRun: %v", err)
	}
	final := waitForRunStatus(t, service, run.ID)
	for _, want := range []string{
		"mode: Debug",
		"provider: local-test",
		"model: local-model",
		"profile: debug-operator",
	} {
		if !strings.Contains(final.Response, want) {
			t.Fatalf("response missing %q: %q", want, final.Response)
		}
	}
	if final.EgressRecordID != "" {
		t.Fatalf("runtime state question should not call provider: %#v", final)
	}
	if len(final.ToolProposals) != 0 {
		t.Fatalf("runtime state question should not expose tool proposals: %#v", final.ToolProposals)
	}
}

func TestSmallTalkToolProposalsAreHiddenWhenLoadingOldRuns(t *testing.T) {
	for _, prompt := range []string{"Привет", "В каком ты щас режиме?"} {
		run := normalizeChatRunToolProposals(AIChatRun{
			UserPrompt: prompt,
			ToolProposals: []AIToolProposal{
				{
					ID:             "old-proposal",
					Name:           "apply_code_change",
					ExecutionState: AIToolExecutionStateNotExecutable,
				},
			},
		})
		if len(run.ToolProposals) != 0 {
			t.Fatalf("old non-actionable proposals should be hidden: %#v", run.ToolProposals)
		}
	}
}
