package app

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestRuntimeAutoUpdateVerifySuccessAndFailure(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	data := []byte("signed update artifact")
	sum := sha256.Sum256(data)
	signature := ed25519.Sign(privateKey, data)
	t.Setenv(packagedOSAutoUpdatePublicKeyEnv, base64.StdEncoding.EncodeToString(publicKey))

	artifact := PackagedOSAutoUpdateArtifact{
		Platform:  "darwin",
		Arch:      "universal",
		Kind:      "zip",
		URL:       "file:///tmp/arlecchino-macos-universal.zip",
		SHA256:    hex.EncodeToString(sum[:]),
		Signature: base64.StdEncoding.EncodeToString(signature),
	}

	verification, err := verifyRuntimeAutoUpdateArtifact(data, "beta", "0.2.0", artifact)
	if err != nil {
		t.Fatal(err)
	}
	if !verification.ChecksumVerified || !verification.SignatureVerified || verification.Status != "verified" {
		t.Fatalf("verification = %#v, want checksum/signature verified", verification)
	}

	artifact.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, []byte("other")))
	verification, err = verifyRuntimeAutoUpdateArtifact(data, "beta", "0.2.0", artifact)
	if err == nil {
		t.Fatal("verifyRuntimeAutoUpdateArtifact succeeded with wrong signature")
	}
	if verification.Status != "signature-mismatch" {
		t.Fatalf("status = %q, want signature-mismatch", verification.Status)
	}
}

func TestStageAutoUpdateZipAcceptsArlecchinoApp(t *testing.T) {
	data := buildTestUpdateZip(t, true)
	stage, err := stageAutoUpdateZip(data, t.TempDir(), func(string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(stage.StagedAppPath, "Arlecchino.app") {
		t.Fatalf("StagedAppPath = %q, want Arlecchino.app", stage.StagedAppPath)
	}
}

func TestStageAutoUpdateZipSkipsAppleDoubleEntries(t *testing.T) {
	data := buildTestUpdateZip(t, true, "Arlecchino.app/Contents/._Info.plist", "Arlecchino.app/Contents/MacOS/._Arlecchino", "__MACOSX/Arlecchino.app/._Contents")
	stage, err := stageAutoUpdateZip(data, t.TempDir(), func(string) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"Contents/._Info.plist",
		"Contents/MacOS/._Arlecchino",
	} {
		if _, err := os.Stat(filepath.Join(stage.StagedAppPath, path)); !os.IsNotExist(err) {
			t.Fatalf("AppleDouble entry %q was extracted", path)
		}
	}
}

func TestStageAutoUpdateZipRejectsMalformedOrMissingApp(t *testing.T) {
	if _, err := stageAutoUpdateZip([]byte("not a zip"), t.TempDir(), nil); err == nil {
		t.Fatal("stageAutoUpdateZip accepted malformed ZIP")
	}

	data := buildTestUpdateZip(t, false)
	if _, err := stageAutoUpdateZip(data, t.TempDir(), nil); err == nil {
		t.Fatal("stageAutoUpdateZip accepted ZIP without Arlecchino.app")
	}
}

func TestStageAutoUpdateZipRejectsAppWithoutRuntimeAssets(t *testing.T) {
	data := buildTestUpdateZipWithoutRuntimeAssets(t)
	if _, err := stageAutoUpdateZip(data, t.TempDir(), nil); err == nil {
		t.Fatal("stageAutoUpdateZip accepted ZIP without runtime assets")
	}
}

func TestBuildAutoUpdateApplyHelperScriptUsesBackupRestoreAndRelaunch(t *testing.T) {
	script := buildAutoUpdateApplyHelperScript(autoUpdateApplyPlan{
		AppPID:         123,
		CurrentAppPath: "/Applications/Arlecchino.app",
		StagedAppPath:  "/tmp/stage/Arlecchino.app",
		BackupAppPath:  "/tmp/backup/Arlecchino.app.backup",
		ReportPath:     "/tmp/report.json",
	})
	for _, fragment := range []string{
		"/usr/bin/ditto \"$CURRENT_APP\" \"$BACKUP_APP\"",
		"/usr/bin/ditto \"$STAGED_APP\" \"$CURRENT_APP\"",
		"/usr/bin/codesign --verify --deep --strict --verbose=2 \"$CURRENT_APP\"",
		"/usr/bin/open \"$CURRENT_APP\"",
		"write_report failed",
	} {
		if !strings.Contains(script, fragment) {
			t.Fatalf("helper script missing %q:\n%s", fragment, script)
		}
	}
}

func TestCompareAutoUpdateVersions(t *testing.T) {
	if compareAutoUpdateVersions("0.2.0", "0.1.9") <= 0 {
		t.Fatal("0.2.0 should be newer than 0.1.9")
	}
	if compareAutoUpdateVersions("0.2.0", "0.2.0") != 0 {
		t.Fatal("same versions should compare equal")
	}
	if compareAutoUpdateVersions("0.1.0", "0.2.0") >= 0 {
		t.Fatal("0.1.0 should be older than 0.2.0")
	}
}

func TestCompareAutoUpdateTargetUsesBuildWhenVersionMatches(t *testing.T) {
	current := BuildInfo{Version: "0.2.0-beta", Build: "104"}
	if compareAutoUpdateTarget(PackagedOSAutoUpdateManifest{Version: "0.2.0-beta", Build: "105"}, current) <= 0 {
		t.Fatal("same version with newer build should be available")
	}
	if compareAutoUpdateTarget(PackagedOSAutoUpdateManifest{Version: "0.2.0-beta", Build: "104"}, current) != 0 {
		t.Fatal("same version and build should compare equal")
	}
	if compareAutoUpdateTarget(PackagedOSAutoUpdateManifest{Version: "0.2.0-beta", Build: "103"}, current) >= 0 {
		t.Fatal("same version with older build should not be newer")
	}
	if compareAutoUpdateTarget(PackagedOSAutoUpdateManifest{Version: "0.2.1-beta", Build: "1"}, current) <= 0 {
		t.Fatal("newer version should win regardless of build")
	}
}

func TestAutoUpdateCheckRejectsRollbackBelowPersistedSequence(t *testing.T) {
	withAutoUpdateBuildInfo(t, "0.2.14-beta", "134", "beta")
	t.Setenv(autoUpdateStateDirEnv, t.TempDir())

	if err := recordVerifiedAutoUpdateSequence("beta", PackagedOSAutoUpdateManifest{
		Version:  "0.2.15-beta",
		Build:    "136",
		Sequence: 136,
	}); err != nil {
		t.Fatalf("record high-watermark: %v", err)
	}

	manifestPath := writeAutoUpdateManifestFixture(t, PackagedOSAutoUpdateManifest{
		Channel:  "beta",
		Version:  "0.2.15-beta",
		Build:    "135",
		Sequence: 135,
		Artifacts: []PackagedOSAutoUpdateArtifact{{
			Platform:  runtime.GOOS,
			Arch:      "universal",
			Kind:      "zip",
			URL:       "file:///tmp/arlecchino-135.zip",
			SHA256:    strings.Repeat("a", 64),
			Signature: "placeholder",
		}},
	})
	t.Setenv(autoUpdateManifestURLEnv, (&url.URL{Scheme: "file", Path: manifestPath}).String())

	status := NewAutoUpdateService().check()
	if status.State != AutoUpdateStateNotAvailable {
		t.Fatalf("State = %q, want not-available: %s", status.State, status.Reason)
	}
	if !strings.Contains(status.Reason, "older than previously accepted sequence 136") {
		t.Fatalf("Reason = %q, want rollback rejection", status.Reason)
	}
}

func TestAutoUpdateCheckUsesBuildAsLegacyRollbackSequence(t *testing.T) {
	withAutoUpdateBuildInfo(t, "0.2.14-beta", "134", "beta")
	t.Setenv(autoUpdateStateDirEnv, t.TempDir())

	if err := recordVerifiedAutoUpdateSequence("beta", PackagedOSAutoUpdateManifest{
		Version:  "0.2.15-beta",
		Build:    "136",
		Sequence: 136,
	}); err != nil {
		t.Fatalf("record high-watermark: %v", err)
	}

	manifestPath := writeAutoUpdateManifestFixture(t, PackagedOSAutoUpdateManifest{
		Channel: "beta",
		Version: "0.2.15-beta",
		Build:   "135",
		Artifacts: []PackagedOSAutoUpdateArtifact{{
			Platform:  runtime.GOOS,
			Arch:      "universal",
			Kind:      "zip",
			URL:       "file:///tmp/arlecchino-135.zip",
			SHA256:    strings.Repeat("a", 64),
			Signature: "placeholder",
		}},
	})
	t.Setenv(autoUpdateManifestURLEnv, (&url.URL{Scheme: "file", Path: manifestPath}).String())

	status := NewAutoUpdateService().check()
	if status.State != AutoUpdateStateNotAvailable {
		t.Fatalf("State = %q, want not-available: %s", status.State, status.Reason)
	}
	if !strings.Contains(status.Reason, "sequence 135 is older than previously accepted sequence 136") {
		t.Fatalf("Reason = %q, want legacy build rollback rejection", status.Reason)
	}
}

func TestAutoUpdateCheckAllowsSamePersistedSequenceForRetry(t *testing.T) {
	withAutoUpdateBuildInfo(t, "0.2.14-beta", "134", "beta")
	t.Setenv(autoUpdateStateDirEnv, t.TempDir())

	if err := recordVerifiedAutoUpdateSequence("beta", PackagedOSAutoUpdateManifest{
		Version:  "0.2.15-beta",
		Build:    "136",
		Sequence: 136,
	}); err != nil {
		t.Fatalf("record high-watermark: %v", err)
	}

	manifestPath := writeAutoUpdateManifestFixture(t, PackagedOSAutoUpdateManifest{
		Channel:  "beta",
		Version:  "0.2.15-beta",
		Build:    "136",
		Sequence: 136,
		Artifacts: []PackagedOSAutoUpdateArtifact{{
			Platform:  runtime.GOOS,
			Arch:      "universal",
			Kind:      "zip",
			URL:       "file:///tmp/arlecchino-136.zip",
			SHA256:    strings.Repeat("a", 64),
			Signature: "placeholder",
		}},
	})
	t.Setenv(autoUpdateManifestURLEnv, (&url.URL{Scheme: "file", Path: manifestPath}).String())

	status := NewAutoUpdateService().check()
	if status.State != AutoUpdateStateAvailable {
		t.Fatalf("State = %q, want available: %s", status.State, status.Reason)
	}
}

func TestDownloadAutoUpdateRecordsVerifiedSequence(t *testing.T) {
	withAutoUpdateBuildInfo(t, "0.2.14-beta", "134", "beta")
	t.Setenv(autoUpdateStateDirEnv, t.TempDir())
	t.Setenv(autoUpdateCacheDirEnv, t.TempDir())

	zipPath := filepath.Join(t.TempDir(), "Arlecchino.zip")
	zipData := buildTestUpdateZipWithVersion(t, true, "0.2.15-beta", "136")
	if err := os.WriteFile(zipPath, zipData, 0o600); err != nil {
		t.Fatalf("write update zip: %v", err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(packagedOSAutoUpdatePublicKeyEnv, base64.StdEncoding.EncodeToString(publicKey))
	sum := sha256.Sum256(zipData)
	signature := ed25519.Sign(privateKey, zipData)

	manifestPath := writeAutoUpdateManifestFixture(t, PackagedOSAutoUpdateManifest{
		Channel:  "beta",
		Version:  "0.2.15-beta",
		Build:    "136",
		Sequence: 136,
		Artifacts: []PackagedOSAutoUpdateArtifact{{
			Platform:  runtime.GOOS,
			Arch:      "universal",
			Kind:      "zip",
			URL:       (&url.URL{Scheme: "file", Path: zipPath}).String(),
			SHA256:    hex.EncodeToString(sum[:]),
			Signature: base64.StdEncoding.EncodeToString(signature),
		}},
	})
	t.Setenv(autoUpdateManifestURLEnv, (&url.URL{Scheme: "file", Path: manifestPath}).String())

	service := NewAutoUpdateService()
	service.inspectCodeIdentity = testStableCodeIdentityInspector
	if status := service.check(); status.State != AutoUpdateStateAvailable {
		t.Fatalf("check state = %q, want available: %s", status.State, status.Reason)
	}
	status := service.downloadAndStage()
	if status.State == AutoUpdateStateFailed {
		t.Fatalf("downloadAndStage failed: %s", status.Reason)
	}

	state, err := readAutoUpdateRollbackState()
	if err != nil {
		t.Fatalf("read rollback state: %v", err)
	}
	entry := state.Channels["beta"]
	if entry.Sequence != 136 || entry.Version != "0.2.15-beta" || entry.Build != "136" {
		t.Fatalf("rollback state = %#v, want sequence 136 version/build", entry)
	}
}

func TestDownloadAutoUpdateRejectsManifestVersionBuildMismatch(t *testing.T) {
	withAutoUpdateBuildInfo(t, "0.2.14-beta", "134", "beta")
	t.Setenv(autoUpdateStateDirEnv, t.TempDir())
	t.Setenv(autoUpdateCacheDirEnv, t.TempDir())

	zipPath := filepath.Join(t.TempDir(), "Arlecchino.zip")
	zipData := buildTestUpdateZipWithVersion(t, true, "0.2.15-beta", "135")
	if err := os.WriteFile(zipPath, zipData, 0o600); err != nil {
		t.Fatalf("write update zip: %v", err)
	}
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(packagedOSAutoUpdatePublicKeyEnv, base64.StdEncoding.EncodeToString(publicKey))
	sum := sha256.Sum256(zipData)
	signature := ed25519.Sign(privateKey, zipData)

	manifestPath := writeAutoUpdateManifestFixture(t, PackagedOSAutoUpdateManifest{
		Channel:  "beta",
		Version:  "0.2.15-beta",
		Build:    "136",
		Sequence: 136,
		Artifacts: []PackagedOSAutoUpdateArtifact{{
			Platform:  runtime.GOOS,
			Arch:      "universal",
			Kind:      "zip",
			URL:       (&url.URL{Scheme: "file", Path: zipPath}).String(),
			SHA256:    hex.EncodeToString(sum[:]),
			Signature: base64.StdEncoding.EncodeToString(signature),
		}},
	})
	t.Setenv(autoUpdateManifestURLEnv, (&url.URL{Scheme: "file", Path: manifestPath}).String())

	service := NewAutoUpdateService()
	service.inspectCodeIdentity = testStableCodeIdentityInspector
	if status := service.check(); status.State != AutoUpdateStateAvailable {
		t.Fatalf("check state = %q, want available before artifact validation: %s", status.State, status.Reason)
	}
	status := service.downloadAndStage()
	if status.State != AutoUpdateStateFailed {
		t.Fatalf("downloadAndStage state = %q, want failed", status.State)
	}
	if !strings.Contains(status.Reason, `build "135" does not match manifest build "136"`) {
		t.Fatalf("Reason = %q, want staged build mismatch", status.Reason)
	}
}

func buildTestUpdateZip(t *testing.T, includeApp bool, extraEntries ...string) []byte {
	return buildTestUpdateZipWithVersion(t, includeApp, "0.2.0", "2", extraEntries...)
}

func buildTestUpdateZipWithVersion(t *testing.T, includeApp bool, version string, build string, extraEntries ...string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	if includeApp {
		addZipFile(t, writer, "Arlecchino.app/Contents/Info.plist", 0o644, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>`+version+`</string>
  <key>CFBundleVersion</key>
  <string>`+build+`</string>
</dict>
</plist>
`)
		addZipFile(t, writer, "Arlecchino.app/Contents/MacOS/Arlecchino", 0o755, "#!/bin/zsh\nexit 0\n")
		addZipFile(t, writer, "Arlecchino.app/Contents/Resources/assets/arle_model.onnx", 0o644, "model\n")
		addZipFile(t, writer, "Arlecchino.app/Contents/Resources/assets/arle_tokenizer.json", 0o644, "{}\n")
	} else {
		addZipFile(t, writer, "README.txt", 0o644, "no app here\n")
	}
	for _, entry := range extraEntries {
		addZipFile(t, writer, entry, 0o644, "appledouble metadata\n")
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func writeAutoUpdateManifestFixture(t *testing.T, manifest PackagedOSAutoUpdateManifest) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "update.json")
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	return path
}

func withAutoUpdateBuildInfo(t *testing.T, version string, build string, channel string) {
	t.Helper()
	oldVersion := buildVersion
	oldBuild := buildNumber
	oldChannel := buildChannel
	oldManifestURL := buildManifestURL
	buildVersion = version
	buildNumber = build
	buildChannel = channel
	buildManifestURL = ""
	t.Setenv(packagedOSAutoUpdateChannelEnv, channel)
	t.Cleanup(func() {
		buildVersion = oldVersion
		buildNumber = oldBuild
		buildChannel = oldChannel
		buildManifestURL = oldManifestURL
	})
}

func testStableCodeIdentityInspector(string) (macOSCodeIdentity, error) {
	return macOSCodeIdentity{
		BundleID:                     "com.arlecchino.app",
		IdentityKind:                 macOSCodeIdentityLocalCertificate,
		PermissionStability:          macOSPermissionStabilityLocalMachineStable,
		DesignatedRequirement:        "designated => identifier \"com.arlecchino.app\"",
		StableRequirementFingerprint: "test-stable-requirement",
	}, nil
}

func buildTestUpdateZipWithoutRuntimeAssets(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	addZipFile(t, writer, "Arlecchino.app/Contents/Info.plist", 0o644, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundleVersion</key>
  <string>2</string>
</dict>
</plist>
`)
	addZipFile(t, writer, "Arlecchino.app/Contents/MacOS/Arlecchino", 0o755, "#!/bin/zsh\nexit 0\n")
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func addZipFile(t *testing.T, writer *zip.Writer, name string, mode uint32, content string) {
	t.Helper()
	header := &zip.FileHeader{Name: name}
	header.SetMode(os.FileMode(mode))
	file, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
}
