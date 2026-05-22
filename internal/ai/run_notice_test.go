package ai

import (
	"strings"
	"testing"

	"arlecchino/internal/ai/agents"
)

func TestRunNoticeForProviderError(t *testing.T) {
	notice := runNoticeForRun(AIChatRun{
		ID:     "run-provider-error",
		Action: AIChatActionAsk,
		Status: "error",
		Error:  "provider failed: 500 internal server error",
	}, nil)
	if notice == nil {
		t.Fatal("missing run notice")
	}
	if notice.Severity != "error" || notice.Title != "AI run failed" {
		t.Fatalf("notice = %#v", notice)
	}
	if !strings.Contains(notice.Details, "500 internal server error") {
		t.Fatalf("notice details = %q", notice.Details)
	}
	if notice.NotificationID != "ai-chat-run:run-provider-error:notice" {
		t.Fatalf("notification id = %q", notice.NotificationID)
	}
}

func TestRunNoticeSkipsGitUnavailableBaselineFailure(t *testing.T) {
	notice := runNoticeForRun(AIChatRun{
		ID:     "run-baseline",
		Action: AIChatActionBuild,
		Status: "error",
		Error:  "agent worktree baseline failed: fatal: not a git repository (or any of the parent directories): .git",
		AgentRuntime: &AIExternalAgentRunSummary{
			Status:        "error",
			ProofState:    "error",
			FailureCode:   agents.FailureDirtyBaseline,
			BlockedReason: "agent worktree baseline failed",
		},
	}, nil)
	if notice != nil {
		t.Fatalf("git-unavailable baseline should stay out of required notifications: %#v", notice)
	}
}

func TestRunNoticeForBuildArtifactMissing(t *testing.T) {
	notice := runNoticeForRun(AIChatRun{
		ID:     "run-build-missing",
		Action: AIChatActionBuild,
		Status: "completed",
		AgentRuntime: &AIExternalAgentRunSummary{
			Status:        "blocked",
			ProofState:    "blocked",
			FailureCode:   agents.FailureBuildArtifactMissing,
			BlockedReason: "Build mode completed without a reviewable patch artifact or accepted no-change evidence",
		},
	}, nil)
	if notice == nil {
		t.Fatal("missing run notice")
	}
	if notice.Severity != "warning" || notice.Title != "Build proof missing" {
		t.Fatalf("notice = %#v", notice)
	}
}

func TestRunNoticeUsesLatestRunErrorTimeline(t *testing.T) {
	notice := runNoticeForRun(AIChatRun{
		ID:     "run-timeline",
		Action: AIChatActionPlan,
		Status: "error",
	}, []AIRunTimelineEvent{
		{ID: "early", Type: "run_error", Summary: "early failure"},
		{ID: "late", Type: "run_error", Summary: "late failure"},
	})
	if notice == nil {
		t.Fatal("missing run notice")
	}
	if !strings.Contains(notice.Details, "late failure") {
		t.Fatalf("notice details = %q", notice.Details)
	}
}

func TestRunNoticeSkipsCanceledAndSuccessfulRuns(t *testing.T) {
	if notice := runNoticeForRun(AIChatRun{
		ID:     "run-canceled",
		Action: AIChatActionAsk,
		Status: "canceled",
		Error:  "context canceled",
	}, nil); notice != nil {
		t.Fatalf("canceled notice = %#v", notice)
	}
	if notice := runNoticeForRun(AIChatRun{
		ID:     "run-ok",
		Action: AIChatActionAsk,
		Status: "completed",
	}, nil); notice != nil {
		t.Fatalf("successful notice = %#v", notice)
	}
}
