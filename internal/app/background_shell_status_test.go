package app

import (
	"testing"
	"time"
)

func TestBackgroundShellStatusService_TracksJobsAndNotificationCandidates(t *testing.T) {
	base := time.UnixMilli(1710000000000)
	now := base
	service := NewBackgroundShellStatusService()
	service.setClockForTest(func() time.Time { return now })

	snapshot := service.UpsertJob(BackgroundShellJob{
		ID:       "indexer:1",
		Kind:     "indexing",
		Title:    "Project indexing",
		Status:   BackgroundShellJobRunning,
		Progress: &BackgroundShellProgress{Percent: 25, Current: 5, Total: 20},
	})

	if snapshot.ActiveCount != 1 {
		t.Fatalf("ActiveCount = %d, want 1", snapshot.ActiveCount)
	}
	if len(snapshot.Jobs) != 1 {
		t.Fatalf("job count = %d, want 1", len(snapshot.Jobs))
	}
	if snapshot.Jobs[0].Progress == nil || snapshot.Jobs[0].Progress.Percent != 25 {
		t.Fatalf("progress = %#v, want 25 percent", snapshot.Jobs[0].Progress)
	}
	if len(snapshot.NotificationCandidates) != 0 {
		t.Fatalf("notification candidates = %d, want 0", len(snapshot.NotificationCandidates))
	}

	now = now.Add(time.Second)
	snapshot = service.UpsertJob(BackgroundShellJob{
		ID:              "indexer:1",
		Kind:            "indexing",
		Title:           "Project indexing",
		Status:          BackgroundShellJobFailed,
		Detail:          "Indexing failed.",
		NotifyOnFailure: true,
	})

	if snapshot.ActiveCount != 0 {
		t.Fatalf("ActiveCount = %d, want 0", snapshot.ActiveCount)
	}
	if snapshot.AttentionCount != 1 {
		t.Fatalf("AttentionCount = %d, want 1", snapshot.AttentionCount)
	}
	if len(snapshot.NotificationCandidates) != 1 {
		t.Fatalf("notification candidates = %d, want 1", len(snapshot.NotificationCandidates))
	}
	candidate := snapshot.NotificationCandidates[0]
	if candidate.DedupeKey != "indexer:1:failed" {
		t.Fatalf("DedupeKey = %q, want indexer:1:failed", candidate.DedupeKey)
	}
	if candidate.Severity != BackgroundShellSeverityError {
		t.Fatalf("Severity = %q, want error", candidate.Severity)
	}
	if snapshot.NativeTrayEnabled {
		t.Fatal("NativeTrayEnabled = true, want false")
	}
	if snapshot.NativeNotificationsSent {
		t.Fatal("NativeNotificationsSent = true, want false")
	}
}

func TestBackgroundShellStatusService_RateLimitsRepeatedNotificationCandidates(t *testing.T) {
	base := time.UnixMilli(1710000000000)
	now := base
	service := NewBackgroundShellStatusService()
	service.setClockForTest(func() time.Time { return now })

	failJob := func() BackgroundShellStatusSnapshot {
		service.UpsertJob(BackgroundShellJob{
			ID:              "lsp-install:gopls",
			Kind:            "lsp-install",
			Title:           "Install gopls language server",
			Status:          BackgroundShellJobRunning,
			NotifyOnFailure: true,
		})
		now = now.Add(time.Second)
		return service.UpsertJob(BackgroundShellJob{
			ID:              "lsp-install:gopls",
			Kind:            "lsp-install",
			Title:           "Install gopls language server",
			Status:          BackgroundShellJobFailed,
			Detail:          "go is missing",
			NotifyOnFailure: true,
		})
	}

	snapshot := failJob()
	if len(snapshot.NotificationCandidates) != 1 {
		t.Fatalf("notification candidates after first failure = %d, want 1", len(snapshot.NotificationCandidates))
	}

	now = base.Add(10 * time.Second)
	snapshot = failJob()
	if len(snapshot.NotificationCandidates) != 1 {
		t.Fatalf("notification candidates inside cooldown = %d, want 1", len(snapshot.NotificationCandidates))
	}

	now = base.Add(31 * time.Second)
	snapshot = failJob()
	if len(snapshot.NotificationCandidates) != 2 {
		t.Fatalf("notification candidates after cooldown = %d, want 2", len(snapshot.NotificationCandidates))
	}
}

func TestBackgroundShellStatusService_SeparatesPersistentServicesFromActiveJobs(t *testing.T) {
	base := time.UnixMilli(1710000000000)
	service := NewBackgroundShellStatusService()
	service.setClockForTest(func() time.Time { return base })

	snapshot := service.UpsertJob(BackgroundShellJob{
		ID:       "mcp-bridge",
		Kind:     "mcp-bridge",
		Category: BackgroundShellCategoryService,
		Title:    "MCP bridge",
		Status:   BackgroundShellJobRunning,
		Detail:   "Listening on socket.",
	})

	if snapshot.ActiveCount != 0 {
		t.Fatalf("ActiveCount = %d, want 0", snapshot.ActiveCount)
	}
	if snapshot.ServiceCount != 1 {
		t.Fatalf("ServiceCount = %d, want 1", snapshot.ServiceCount)
	}
	if len(snapshot.Actions) != 0 {
		t.Fatalf("actions = %d, want 0", len(snapshot.Actions))
	}
}

func TestBackgroundShellStatusService_CancelsActiveProjectJobs(t *testing.T) {
	service := NewBackgroundShellStatusService()
	service.UpsertJob(BackgroundShellJob{
		ID:          "indexer:1",
		Kind:        "indexing",
		Title:       "Project indexing",
		ProjectPath: "/tmp/project",
		Status:      BackgroundShellJobRunning,
	})
	service.UpsertJob(BackgroundShellJob{
		ID:          "indexer:2",
		Kind:        "indexing",
		Title:       "Project indexing",
		ProjectPath: "/tmp/other",
		Status:      BackgroundShellJobRunning,
	})

	snapshot, changed := service.CancelJobsForProject("/tmp/project", "Project closed.")
	if !changed {
		t.Fatal("changed = false, want true")
	}
	if snapshot.ActiveCount != 1 {
		t.Fatalf("ActiveCount = %d, want 1", snapshot.ActiveCount)
	}

	var canceled BackgroundShellJob
	for _, job := range snapshot.Jobs {
		if job.ID == "indexer:1" {
			canceled = job
			break
		}
	}
	if canceled.Status != BackgroundShellJobCanceled {
		t.Fatalf("canceled status = %q, want canceled", canceled.Status)
	}
}

func TestBackgroundShellStatusService_RunsActionContracts(t *testing.T) {
	base := time.UnixMilli(1710000000000)
	service := NewBackgroundShellStatusService()
	service.setClockForTest(func() time.Time { return base })

	snapshot := service.UpsertJob(BackgroundShellJob{
		ID:         "execution:tests",
		Kind:       "execution",
		Title:      "Run tests",
		Status:     BackgroundShellJobRunning,
		Cancelable: true,
	})
	if len(snapshot.Actions) != 1 || snapshot.Actions[0].ID != "cancel:execution:tests" {
		t.Fatalf("actions = %#v, want cancel action", snapshot.Actions)
	}

	action, snapshot, handled, err := service.RunAction("cancel:execution:tests")
	if err != nil {
		t.Fatalf("RunAction(cancel) error = %v", err)
	}
	if !handled || action.Intent != "cancel-job" {
		t.Fatalf("cancel action handled=%v action=%#v, want handled cancel-job", handled, action)
	}
	if snapshot.ActiveCount != 0 {
		t.Fatalf("ActiveCount after cancel = %d, want 0", snapshot.ActiveCount)
	}
	if len(snapshot.Actions) != 0 {
		t.Fatalf("actions after cancel = %#v, want empty", snapshot.Actions)
	}

	service.UpsertJob(BackgroundShellJob{
		ID:              "lsp-install:gopls",
		Kind:            "lsp-install",
		Title:           "Install gopls language server",
		Status:          BackgroundShellJobFailed,
		Detail:          "go is missing",
		OwnerSurfaceID:  "panel:terminal",
		NotifyOnFailure: true,
	})
	action, _, handled, err = service.RunAction("focus:panel:terminal")
	if err != nil {
		t.Fatalf("RunAction(focus) error = %v", err)
	}
	if !handled || action.Intent != "focus-surface" || action.OwnerSurfaceID != "panel:terminal" {
		t.Fatalf("focus action handled=%v action=%#v, want focus panel:terminal", handled, action)
	}
}
