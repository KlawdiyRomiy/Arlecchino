package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBuildPackagedOSIntegrationSnapshot_DefaultsOff(t *testing.T) {
	background := BackgroundShellStatusSnapshot{
		Actions: []BackgroundShellAction{
			{
				ID:      "cancel:indexer:1",
				Label:   "Cancel",
				Intent:  "cancel-job",
				JobID:   "indexer:1",
				Enabled: true,
			},
		},
		NotificationCandidates: []BackgroundShellNotificationCandidate{
			{
				ID:        "notification:indexer:1",
				JobID:     "indexer:1",
				Severity:  BackgroundShellSeverityError,
				Title:     "Project indexing",
				Body:      "Indexing failed.",
				DedupeKey: "indexer:1:failed",
				CreatedAt: 1710000000000,
			},
		},
	}

	snapshot := buildPackagedOSIntegrationSnapshot(
		"darwin",
		background,
		PackagedOSIntegrationOptions{},
	)

	if snapshot.Version != packagedOSIntegrationVersion {
		t.Fatalf("Version = %d, want %d", snapshot.Version, packagedOSIntegrationVersion)
	}
	if snapshot.PackagedBuild {
		t.Fatal("PackagedBuild = true, want false")
	}
	if snapshot.NativeTrayEnabled {
		t.Fatal("NativeTrayEnabled = true, want false")
	}
	if snapshot.Adapters["customProtocol"].Status != ShellCapabilityRequiresBuild {
		t.Fatalf("customProtocol status = %q", snapshot.Adapters["customProtocol"].Status)
	}
	if snapshot.Adapters["tray"].Status != ShellCapabilityUnavailable {
		t.Fatalf("tray status = %q, want unavailable", snapshot.Adapters["tray"].Status)
	}
	if snapshot.Adapters["notifications"].NotificationCandidateCount != 1 {
		t.Fatalf("notification count = %d, want 1", snapshot.Adapters["notifications"].NotificationCandidateCount)
	}
	if snapshot.Adapters["tray"].BackgroundActionCount != 1 {
		t.Fatalf("tray action count = %d, want 1", snapshot.Adapters["tray"].BackgroundActionCount)
	}
	if !snapshot.Adapters["autoUpdate"].Enabled {
		t.Fatal("autoUpdate enabled = false, want true")
	}
}

func TestBuildPackagedOSIntegrationSnapshot_PackagedNativeDefaults(t *testing.T) {
	snapshot := buildPackagedOSIntegrationSnapshot(
		"darwin",
		emptyBackgroundShellStatusSnapshot(),
		PackagedOSIntegrationOptions{
			PackagedBuild:              true,
			NativeNotificationsEnabled: true,
			DockBadgesEnabled:          true,
		},
	)

	if snapshot.Adapters["tray"].Status != ShellCapabilityUnavailable {
		t.Fatalf("tray status = %q, want unavailable", snapshot.Adapters["tray"].Status)
	}
	if snapshot.Adapters["notifications"].Status != ShellCapabilityAvailable {
		t.Fatalf("notifications status = %q, want available", snapshot.Adapters["notifications"].Status)
	}
	if snapshot.Adapters["dockBadges"].Status != ShellCapabilityAvailable {
		t.Fatalf("dockBadges status = %q, want available", snapshot.Adapters["dockBadges"].Status)
	}
	if !snapshot.Adapters["autoUpdate"].Enabled {
		t.Fatal("autoUpdate enabled = false, want true")
	}
}

func TestReadAutoUpdateManifest_ReadsAndEnablesRuntimeUpdates(t *testing.T) {
	manifestPath := filepath.Join(t.TempDir(), "update.json")
	if err := os.WriteFile(
		manifestPath,
		[]byte(`{"channel":"beta","version":"0.2.0-beta","artifacts":[{"platform":"darwin","arch":"arm64","url":"https://example.invalid/arlecchino.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","signature":"placeholder"}]}`),
		0o600,
	); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	manifest, reason := readAutoUpdateManifest(manifestPath)
	if manifest == nil {
		t.Fatalf("manifest = nil, reason = %q", reason)
	}
	if manifest.Channel != "beta" || manifest.Version != "0.2.0-beta" {
		t.Fatalf("manifest = %#v, want beta 0.2.0-beta", manifest)
	}

	snapshot := buildPackagedOSIntegrationSnapshot(
		"darwin",
		emptyBackgroundShellStatusSnapshot(),
		PackagedOSIntegrationOptions{
			AutoUpdateManifest:       manifest,
			AutoUpdateManifestReason: reason,
		},
	)
	if snapshot.Adapters["autoUpdate"].Status != ShellCapabilityExperimental {
		t.Fatalf("autoUpdate status = %q, want experimental", snapshot.Adapters["autoUpdate"].Status)
	}
	if !snapshot.Adapters["autoUpdate"].Enabled {
		t.Fatal("autoUpdate enabled = false, want true")
	}
}

func TestRunPackagedOSIntegrationAction_RoutesBackgroundActions(t *testing.T) {
	app := &App{backgroundShell: NewBackgroundShellStatusService()}
	app.backgroundShell.UpsertJob(BackgroundShellJob{
		ID:         "execution:tests",
		Kind:       "execution",
		Title:      "Run tests",
		Status:     BackgroundShellJobRunning,
		Cancelable: true,
	})

	result, err := app.RunPackagedOSIntegrationAction("background:cancel:execution:tests")
	if err != nil {
		t.Fatalf("RunPackagedOSIntegrationAction error = %v", err)
	}
	if !result.Handled || result.BackgroundAction == nil || result.BackgroundAction.Intent != "cancel-job" {
		t.Fatalf("result = %#v, want handled cancel-job", result)
	}
	if result.BackgroundResult == nil || result.BackgroundResult.Snapshot.ActiveCount != 0 {
		t.Fatalf("background result = %#v, want no active jobs", result.BackgroundResult)
	}
}
