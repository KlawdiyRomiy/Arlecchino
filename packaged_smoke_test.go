package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBuildWails3PackagedSmokeReport_IncludesRuntimeGates(t *testing.T) {
	t.Setenv(packagedOSPackagedBuildEnv, "1")
	t.Setenv(packagedOSSpikeEnv, "1")
	t.Setenv(envEnableSingleInstanceSpike, "1")
	t.Setenv(envWails3PackagedSmokeBuildTarget, "build/bin/Arlecchino-v3")

	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	writePackagedSmokeTestFile(t, filePath)

	app := &App{backgroundShell: NewBackgroundShellStatusService()}
	app.backgroundShell.UpsertJob(BackgroundShellJob{
		ID:         "execution:tests",
		Kind:       "execution",
		Title:      "Run tests",
		Status:     BackgroundShellJobRunning,
		Cancelable: true,
	})

	report := buildWails3PackagedSmokeReport(
		app,
		[]string{"/tmp/Arlecchino-v3", "--line", "9", "main.go"},
		root,
		time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC),
	)

	if report.Version != wails3PackagedSmokeVersion {
		t.Fatalf("Version = %d, want %d", report.Version, wails3PackagedSmokeVersion)
	}
	if report.Runtime != "wails-v3" {
		t.Fatalf("Runtime = %q, want wails-v3", report.Runtime)
	}
	if report.GeneratedAt != "2026-04-30T10:00:00Z" {
		t.Fatalf("GeneratedAt = %q", report.GeneratedAt)
	}
	if report.OpenIntent == nil || report.OpenIntent["kind"] != "openFile" {
		t.Fatalf("OpenIntent = %#v, want openFile", report.OpenIntent)
	}
	if report.OpenIntent["path"] != filePath || report.OpenIntent["line"] != 9 {
		t.Fatalf("OpenIntent = %#v, want file path with line", report.OpenIntent)
	}
	if !report.OpenIntentQueued {
		t.Fatal("OpenIntentQueued = false, want true before frontend-ready")
	}
	if !report.SingleInstance.Enabled {
		t.Fatal("SingleInstance.Enabled = false, want true when spike env is enabled")
	}
	if report.PackagedOSIntegration.Adapters["tray"].Status != ShellCapabilityExperimental {
		t.Fatalf("tray status = %q, want experimental", report.PackagedOSIntegration.Adapters["tray"].Status)
	}
	if report.BackgroundShell.ActiveCount != 1 {
		t.Fatalf("BackgroundShell.ActiveCount = %d, want 1", report.BackgroundShell.ActiveCount)
	}
	if len(report.Checks) == 0 {
		t.Fatal("Checks is empty")
	}
}

func TestWails3PackagedSmokeReport_DefaultsStayOff(t *testing.T) {
	report := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)

	if report.SingleInstance.Enabled {
		t.Fatal("SingleInstance.Enabled = true, want false by default")
	}
	if report.PackagedOSIntegration.PackagedBuild {
		t.Fatal("PackagedBuild = true, want false by default")
	}
	if report.PackagedOSIntegration.Adapters["notifications"].Enabled {
		t.Fatal("notifications enabled = true, want false by default")
	}
	if report.WindowLease.Available {
		t.Fatal("WindowLease.Available = true, want false before Window Lease v2")
	}
}

func writePackagedSmokeTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
}
