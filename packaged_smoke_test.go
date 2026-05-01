package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
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
	if report.AppBundle.LaunchMode != "raw-binary" {
		t.Fatalf("AppBundle.LaunchMode = %q, want raw-binary", report.AppBundle.LaunchMode)
	}
}

func TestWails3PackagedSmokeReport_IncludesPackagedAppBundleMetadata(t *testing.T) {
	bundlePath := filepath.Join(t.TempDir(), "ArlecchinoV3Smoke.app")
	t.Setenv(envWails3PackagedSmokeLaunchMode, "packaged-app")
	t.Setenv(envWails3PackagedSmokeAppBundle, bundlePath)
	t.Setenv(envWails3PackagedSmokeBundleID, "dev.arlecchino.v3smoke")

	report := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)

	if report.AppBundle.LaunchMode != "packaged-app" {
		t.Fatalf("LaunchMode = %q, want packaged-app", report.AppBundle.LaunchMode)
	}
	if report.AppBundle.Path != bundlePath {
		t.Fatalf("Path = %q, want %q", report.AppBundle.Path, bundlePath)
	}
	if report.AppBundle.BundleID != "dev.arlecchino.v3smoke" {
		t.Fatalf("BundleID = %q", report.AppBundle.BundleID)
	}
	if report.AppBundle.Status != ShellCapabilityAvailable {
		t.Fatalf("Status = %q, want available", report.AppBundle.Status)
	}
	if !smokeChecksContain(report.Checks, "packaged-app-bundle") {
		t.Fatalf("Checks = %#v, want packaged-app-bundle", report.Checks)
	}
}

func TestWails3PackagedSmokeReport_NormalizesPackagedProtocolPayload(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	writePackagedSmokeTestFile(t, filePath)
	protocolURL := "arlecchino://open?file=" + url.QueryEscape("main.go")

	report := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3", protocolURL},
		root,
		time.Unix(0, 0).UTC(),
	)

	if report.OpenIntent == nil || report.OpenIntent["kind"] != "openFile" {
		t.Fatalf("OpenIntent = %#v, want protocol openFile", report.OpenIntent)
	}
	if report.OpenIntent["path"] != filePath || report.OpenIntent["source"] != "packaged-smoke" {
		t.Fatalf("OpenIntent = %#v, want packaged-smoke file path", report.OpenIntent)
	}
	if report.PackagedOSIntegration.Adapters["customProtocol"].Status != ShellCapabilityRequiresBuild {
		t.Fatalf("customProtocol status = %q, want requires-build", report.PackagedOSIntegration.Adapters["customProtocol"].Status)
	}
}

func TestWails3PackagedSmokeReport_SecondInstanceProbeUsesQueuedOpenIntent(t *testing.T) {
	t.Setenv(envEnableSingleInstanceSpike, "1")
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	writePackagedSmokeTestFile(t, filePath)
	t.Setenv(envWails3PackagedSmokeSecondArgs, `["Arlecchino-v3","--open-file","main.go"]`)

	report := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		root,
		time.Unix(0, 0).UTC(),
	)

	if !report.SecondInstance.Enabled {
		t.Fatal("SecondInstance.Enabled = false, want true")
	}
	if report.SecondInstance.OpenIntent == nil || report.SecondInstance.OpenIntent["kind"] != "openFile" {
		t.Fatalf("SecondInstance.OpenIntent = %#v, want openFile", report.SecondInstance.OpenIntent)
	}
	if report.SecondInstance.OpenIntent["path"] != filePath {
		t.Fatalf("path = %#v, want %s", report.SecondInstance.OpenIntent["path"], filePath)
	}
	if report.SecondInstance.OpenIntent["source"] != "single-instance" {
		t.Fatalf("source = %#v, want single-instance", report.SecondInstance.OpenIntent["source"])
	}
	if !report.SecondInstance.OpenIntentQueued {
		t.Fatal("SecondInstance.OpenIntentQueued = false, want true before frontend-ready")
	}
	if !smokeChecksPassed(report.Checks, "single-instance-second-launch") {
		t.Fatalf("Checks = %#v, want passing single-instance-second-launch", report.Checks)
	}
}

func TestWails3PackagedSmokeReport_NativeDeliveryProbeUsesBackgroundShellSample(t *testing.T) {
	t.Setenv(packagedOSPackagedBuildEnv, "1")
	t.Setenv(packagedOSSpikeEnv, "1")
	t.Setenv(packagedOSNativeTrayEnv, "1")
	t.Setenv(packagedOSNativeNotificationsEnv, "1")
	t.Setenv(packagedOSDockBadgesEnv, "1")
	t.Setenv(envWails3PackagedSmokeBackground, "1")

	report := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)

	if report.BackgroundShell.ActiveCount != 1 || report.BackgroundShell.AttentionCount != 1 {
		t.Fatalf("BackgroundShell = %#v, want active and attention sample", report.BackgroundShell)
	}
	if !report.NativeDelivery.Enabled {
		t.Fatal("NativeDelivery.Enabled = false, want true")
	}
	if !report.NativeDelivery.Tray.Enabled || len(report.NativeDelivery.Tray.ActionIDs) == 0 {
		t.Fatalf("Tray probe = %#v, want projected actions", report.NativeDelivery.Tray)
	}
	if !report.NativeDelivery.Notifications.Enabled || len(report.NativeDelivery.Notifications.CandidateIDs) == 0 {
		t.Fatalf("Notifications probe = %#v, want projected candidates", report.NativeDelivery.Notifications)
	}
	if !report.NativeDelivery.DockBadge.Enabled || report.NativeDelivery.DockBadge.Label != "1" {
		t.Fatalf("DockBadge probe = %#v, want label 1", report.NativeDelivery.DockBadge)
	}
	if !smokeChecksPassed(report.Checks, "native-delivery-gate") {
		t.Fatalf("Checks = %#v, want passing native-delivery-gate", report.Checks)
	}
}

func TestWails3PackagedSmokeReport_AutoUpdateManifestGateStates(t *testing.T) {
	defaultReport := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)
	if defaultReport.AutoUpdate.ManifestStatus != "no-manifest" {
		t.Fatalf("ManifestStatus = %q, want no-manifest", defaultReport.AutoUpdate.ManifestStatus)
	}
	if defaultReport.AutoUpdate.InstallEnabled {
		t.Fatal("InstallEnabled = true, want false")
	}

	invalidPath := filepath.Join(t.TempDir(), "invalid-update.json")
	if err := os.WriteFile(invalidPath, []byte("{"), 0o600); err != nil {
		t.Fatalf("write invalid manifest: %v", err)
	}
	t.Setenv(packagedOSAutoUpdateManifestEnv, invalidPath)
	invalidReport := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)
	if invalidReport.AutoUpdate.ManifestStatus != "invalid-manifest" {
		t.Fatalf("ManifestStatus = %q, want invalid-manifest", invalidReport.AutoUpdate.ManifestStatus)
	}
	if invalidReport.AutoUpdate.Manifest != nil {
		t.Fatalf("Manifest = %#v, want nil", invalidReport.AutoUpdate.Manifest)
	}

	validPath := filepath.Join(t.TempDir(), "valid-update.json")
	if err := os.WriteFile(
		validPath,
		[]byte(`{"channel":"alpha","version":"0.1.0","artifacts":[{"platform":"darwin","arch":"arm64","url":"https://example.invalid/update.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","signature":"placeholder"}]}`),
		0o600,
	); err != nil {
		t.Fatalf("write valid manifest: %v", err)
	}
	t.Setenv(packagedOSAutoUpdateManifestEnv, validPath)
	validReport := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)
	if validReport.AutoUpdate.ManifestStatus != "valid-manifest-read" {
		t.Fatalf("ManifestStatus = %q, want valid-manifest-read", validReport.AutoUpdate.ManifestStatus)
	}
	if validReport.AutoUpdate.Manifest == nil || validReport.AutoUpdate.Manifest.Version != "0.1.0" {
		t.Fatalf("Manifest = %#v, want version 0.1.0", validReport.AutoUpdate.Manifest)
	}
	if validReport.AutoUpdate.InstallEnabled {
		t.Fatal("InstallEnabled = true, want false")
	}
	if !smokeChecksPassed(validReport.Checks, "auto-update-manifest-gate") {
		t.Fatalf("Checks = %#v, want passing auto-update-manifest-gate", validReport.Checks)
	}
}

func TestWails3PackagedSmokeReport_AutoUpdateApplySmokeVerifiesArtifact(t *testing.T) {
	root := t.TempDir()
	artifactPath := filepath.Join(root, "Arlecchino-v3.zip")
	artifactBytes := []byte("signed artifact")
	if err := os.WriteFile(artifactPath, artifactBytes, 0o600); err != nil {
		t.Fatalf("write artifact: %v", err)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}
	sum := sha256.Sum256(artifactBytes)
	signature := ed25519.Sign(privateKey, artifactBytes)

	manifestPath := filepath.Join(root, "update.json")
	manifest := `{
  "channel": "alpha",
  "version": "0.1.0",
  "releaseNotes": "Smoke update",
  "mandatory": false,
  "artifacts": [{
    "platform": "darwin",
    "arch": "arm64",
    "url": "` + (&url.URL{Scheme: "file", Path: artifactPath}).String() + `",
    "sha256": "` + hex.EncodeToString(sum[:]) + `",
    "signature": "` + base64.StdEncoding.EncodeToString(signature) + `"
  }]
}`
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	t.Setenv(packagedOSAutoUpdateManifestEnv, manifestPath)
	t.Setenv(packagedOSAutoUpdateApplyEnv, "1")
	t.Setenv(packagedOSAutoUpdatePublicKeyEnv, base64.StdEncoding.EncodeToString(publicKey))

	report := buildWails3PackagedSmokeReport(
		nil,
		[]string{"Arlecchino-v3"},
		"/",
		time.Unix(0, 0).UTC(),
	)
	if report.AutoUpdate.ManifestStatus != "staged-apply-ready" {
		t.Fatalf("ManifestStatus = %q, want staged-apply-ready: %#v", report.AutoUpdate.ManifestStatus, report.AutoUpdate.Verification)
	}
	if !report.AutoUpdate.InstallEnabled {
		t.Fatal("InstallEnabled = false, want true under explicit smoke flag")
	}
	if !report.AutoUpdate.Verification.ChecksumVerified || !report.AutoUpdate.Verification.SignatureVerified || !report.AutoUpdate.Verification.Staged {
		t.Fatalf("Verification = %#v, want checksum/signature/staged", report.AutoUpdate.Verification)
	}
}

func TestSelectAutoUpdateArtifactAcceptsUniversalDarwinArtifact(t *testing.T) {
	manifest := PackagedOSAutoUpdateManifest{
		Artifacts: []PackagedOSAutoUpdateArtifact{
			{
				Platform: "darwin",
				Arch:     "universal",
				URL:      "https://example.invalid/Arlecchino.zip",
				SHA256:   "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		},
	}

	artifact, ok := selectAutoUpdateArtifact(&manifest, "darwin", "amd64")
	if !ok {
		t.Fatal("selectAutoUpdateArtifact = false, want true for amd64 universal artifact")
	}
	if artifact.Arch != "universal" {
		t.Fatalf("Arch = %q, want universal", artifact.Arch)
	}

	if _, ok := selectAutoUpdateArtifact(&manifest, "darwin", "arm64"); !ok {
		t.Fatal("selectAutoUpdateArtifact = false, want true for arm64 universal artifact")
	}
}

func TestWails3PackagedSmokeReport_MatrixLaunchTargets(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	writePackagedSmokeTestFile(t, filePath)
	fileURL := url.URL{Scheme: "file", Path: filePath}

	tests := []struct {
		name        string
		args        []string
		wantKind    string
		wantPath    string
		wantURL     string
		wantSurface string
	}{
		{
			name:     "open-file",
			args:     []string{"Arlecchino-v3", "--open-file", "main.go"},
			wantKind: "openFile",
			wantPath: filePath,
		},
		{
			name:     "file-url",
			args:     []string{"Arlecchino-v3", fileURL.String()},
			wantKind: "openFile",
			wantPath: filePath,
		},
		{
			name:     "protocol-file",
			args:     []string{"Arlecchino-v3", "arlecchino://open?file=" + url.QueryEscape("main.go")},
			wantKind: "openFile",
			wantPath: filePath,
		},
		{
			name:     "preview",
			args:     []string{"Arlecchino-v3", "--open-preview", "https://example.test/app"},
			wantKind: "openPreview",
			wantURL:  "https://example.test/app",
		},
		{
			name:        "focus",
			args:        []string{"Arlecchino-v3", "arlecchino://focus?surface=panel:ai-chat"},
			wantKind:    "focusSurface",
			wantSurface: "panel:aiChat",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			report := buildWails3PackagedSmokeReport(nil, tt.args, root, time.Unix(0, 0).UTC())
			if report.OpenIntent == nil {
				t.Fatal("OpenIntent = nil, want intent")
			}
			if report.OpenIntent["kind"] != tt.wantKind {
				t.Fatalf("kind = %v, want %s", report.OpenIntent["kind"], tt.wantKind)
			}
			if report.OpenIntent["source"] != "packaged-smoke" {
				t.Fatalf("source = %v, want packaged-smoke", report.OpenIntent["source"])
			}
			if tt.wantPath != "" && report.OpenIntent["path"] != tt.wantPath {
				t.Fatalf("path = %v, want %s", report.OpenIntent["path"], tt.wantPath)
			}
			if tt.wantURL != "" && report.OpenIntent["url"] != tt.wantURL {
				t.Fatalf("url = %v, want %s", report.OpenIntent["url"], tt.wantURL)
			}
			if tt.wantSurface != "" && report.OpenIntent["surfaceId"] != tt.wantSurface {
				t.Fatalf("surfaceId = %v, want %s", report.OpenIntent["surfaceId"], tt.wantSurface)
			}
		})
	}
}

func TestWails3PackagedSmokeReport_GatedSnapshot(t *testing.T) {
	t.Setenv(packagedOSPackagedBuildEnv, "1")
	t.Setenv(packagedOSSpikeEnv, "1")
	t.Setenv(packagedOSNativeTrayEnv, "1")
	t.Setenv(packagedOSNativeNotificationsEnv, "1")
	t.Setenv(packagedOSDockBadgesEnv, "1")
	t.Setenv(envEnableSingleInstanceSpike, "1")
	t.Setenv(envEnableWindowLeaseSpike, "1")

	report := buildWails3PackagedSmokeReport(
		&App{windowLeases: NewWindowLeaseRegistry()},
		[]string{"Arlecchino-v3", "--open-preview", "https://example.test/app"},
		"/",
		time.Unix(0, 0).UTC(),
	)

	if !report.SingleInstance.Enabled {
		t.Fatal("SingleInstance.Enabled = false, want true")
	}
	if !report.WindowLease.Available || !report.WindowLease.SpikeEnv {
		t.Fatalf("WindowLease = %#v, want available spike", report.WindowLease)
	}
	if !report.PackagedOSIntegration.Adapters["tray"].Enabled {
		t.Fatal("tray enabled = false, want true")
	}
	if !report.PackagedOSIntegration.Adapters["notifications"].Enabled {
		t.Fatal("notifications enabled = false, want true")
	}
	if !report.PackagedOSIntegration.Adapters["dockBadges"].Enabled {
		t.Fatal("dockBadges enabled = false, want true")
	}
}

func writePackagedSmokeTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}
}

func smokeChecksContain(checks []Wails3SmokeCheck, id string) bool {
	for _, check := range checks {
		if check.ID == id {
			return true
		}
	}
	return false
}

func smokeChecksPassed(checks []Wails3SmokeCheck, id string) bool {
	for _, check := range checks {
		if check.ID == id {
			return check.Passed
		}
	}
	return false
}
