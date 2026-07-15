package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	autoUpdateStatusEvent       = "auto-update:status"
	autoUpdateStatusVersion     = 1
	autoUpdateCacheDirEnv       = "ARLECCHINO_AUTO_UPDATE_CACHE_DIR"
	autoUpdateStateDirEnv       = "ARLECCHINO_AUTO_UPDATE_STATE_DIR"
	autoUpdateGitHubReleasesURL = "https://github.com/KlawdiyRomiy/Arlecchino/releases"
	autoUpdateMaxManifestBytes  = 1024 * 1024
	autoUpdateStateVersion      = 1

	autoUpdateHTTPDialTimeout           = 30 * time.Second
	autoUpdateHTTPResponseHeaderTimeout = 45 * time.Second
	autoUpdateHTTPManifestTimeout       = 90 * time.Second
	autoUpdateHTTPArtifactTimeout       = 90 * time.Minute
)

type AutoUpdateState string

const (
	AutoUpdateStateIdle           AutoUpdateState = "idle"
	AutoUpdateStateChecking       AutoUpdateState = "checking"
	AutoUpdateStateAvailable      AutoUpdateState = "available"
	AutoUpdateStateNotAvailable   AutoUpdateState = "not-available"
	AutoUpdateStateDownloading    AutoUpdateState = "downloading"
	AutoUpdateStateStaged         AutoUpdateState = "staged"
	AutoUpdateStateApplying       AutoUpdateState = "applying"
	AutoUpdateStateFailed         AutoUpdateState = "failed"
	AutoUpdateStateManualRequired AutoUpdateState = "manual-required"
)

type AutoUpdateStatus struct {
	Version        int                              `json:"version"`
	State          AutoUpdateState                  `json:"state"`
	Reason         string                           `json:"reason,omitempty"`
	Channel        string                           `json:"channel,omitempty"`
	Current        BuildInfo                        `json:"current"`
	ManifestSource string                           `json:"manifestSource,omitempty"`
	Manifest       *PackagedOSAutoUpdateManifest    `json:"manifest,omitempty"`
	Artifact       *PackagedOSAutoUpdateArtifact    `json:"artifact,omitempty"`
	Verification   PackagedOSAutoUpdateVerification `json:"verification"`
	DownloadPath   string                           `json:"downloadPath,omitempty"`
	StagingDir     string                           `json:"stagingDir,omitempty"`
	StagedAppPath  string                           `json:"stagedAppPath,omitempty"`
	TargetVersion  string                           `json:"targetVersion,omitempty"`
	TargetBuild    string                           `json:"targetBuild,omitempty"`
	TargetSequence int64                            `json:"targetSequence,omitempty"`
	ReleaseNotes   string                           `json:"releaseNotes,omitempty"`
	Mandatory      bool                             `json:"mandatory"`
	Progress       float64                          `json:"progress"`
	ApplyAvailable bool                             `json:"applyAvailable"`
	ManualURL      string                           `json:"manualUrl,omitempty"`
	ReportPath     string                           `json:"reportPath,omitempty"`
	UpdatedAt      int64                            `json:"updatedAt"`
}

type AutoUpdateService struct {
	mu                  sync.Mutex
	status              AutoUpdateStatus
	client              *http.Client
	inspectCodeIdentity macOSCodeIdentityInspector
}

type autoUpdateStageResult struct {
	StagingDir    string
	StagedAppPath string
	Version       string
	Build         string
}

type autoUpdateRollbackState struct {
	Version  int                                       `json:"version"`
	Channels map[string]autoUpdateRollbackChannelState `json:"channels,omitempty"`
}

type autoUpdateRollbackChannelState struct {
	Sequence  int64  `json:"sequence"`
	Version   string `json:"version,omitempty"`
	Build     string `json:"build,omitempty"`
	UpdatedAt int64  `json:"updatedAt"`
}

type autoUpdateApplyPlan struct {
	AppPID                         int
	CurrentAppPath                 string
	StagedAppPath                  string
	BackupAppPath                  string
	ReportPath                     string
	ExpectedBundleID               string
	ExpectedRequirementFingerprint string
}

func NewAutoUpdateService() *AutoUpdateService {
	status := baseAutoUpdateStatus()
	status.State = AutoUpdateStateIdle
	status.Reason = "Auto-update is idle."
	return &AutoUpdateService{
		status:              status,
		client:              newAutoUpdateHTTPClient(),
		inspectCodeIdentity: inspectMacOSAppCodeIdentity,
	}
}

func newAutoUpdateHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: autoUpdateHTTPDialTimeout, KeepAlive: 30 * time.Second}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          10,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   autoUpdateHTTPDialTimeout,
			ResponseHeaderTimeout: autoUpdateHTTPResponseHeaderTimeout,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
}

func (a *App) GetAutoUpdateStatus() AutoUpdateStatus {
	if a == nil || a.autoUpdater == nil {
		return baseAutoUpdateStatus()
	}
	return a.autoUpdater.snapshot()
}

func (a *App) CheckForAutoUpdate() AutoUpdateStatus {
	if a == nil || a.autoUpdater == nil {
		status := baseAutoUpdateStatus()
		status.State = AutoUpdateStateFailed
		status.Reason = "Auto-update service is unavailable."
		return status
	}
	status := a.autoUpdater.check()
	a.emitAutoUpdateStatus(status)
	return status
}

func (a *App) DownloadAutoUpdate() AutoUpdateStatus {
	if a == nil || a.autoUpdater == nil {
		status := baseAutoUpdateStatus()
		status.State = AutoUpdateStateFailed
		status.Reason = "Auto-update service is unavailable."
		return status
	}
	status := a.autoUpdater.downloadAndStage()
	a.emitAutoUpdateStatus(status)
	return status
}

func (a *App) ApplyStagedAutoUpdate() AutoUpdateStatus {
	if a == nil || a.autoUpdater == nil {
		status := baseAutoUpdateStatus()
		status.State = AutoUpdateStateFailed
		status.Reason = "Auto-update service is unavailable."
		return status
	}
	status := a.autoUpdater.apply(a)
	a.emitAutoUpdateStatus(status)
	return status
}

func (a *App) CancelAutoUpdate() AutoUpdateStatus {
	if a == nil || a.autoUpdater == nil {
		status := baseAutoUpdateStatus()
		status.State = AutoUpdateStateIdle
		status.Reason = "Auto-update service is unavailable."
		return status
	}
	status := a.autoUpdater.cancel()
	a.emitAutoUpdateStatus(status)
	return status
}

func (a *App) emitAutoUpdateStatus(status AutoUpdateStatus) {
	if a != nil {
		a.emitEvent(autoUpdateStatusEvent, status)
	}
}

func baseAutoUpdateStatus() AutoUpdateStatus {
	current := currentBuildInfo()
	return AutoUpdateStatus{
		Version:      autoUpdateStatusVersion,
		State:        AutoUpdateStateIdle,
		Channel:      current.Channel,
		Current:      current,
		ManualURL:    autoUpdateGitHubReleasesURL,
		UpdatedAt:    time.Now().UnixMilli(),
		Verification: PackagedOSAutoUpdateVerification{Channel: current.Channel, Platform: runtime.GOOS, Arch: runtime.GOARCH},
	}
}

func (s *AutoUpdateService) snapshot() AutoUpdateStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneAutoUpdateStatus(s.status)
}

func (s *AutoUpdateService) setStatus(status AutoUpdateStatus) AutoUpdateStatus {
	status.UpdatedAt = time.Now().UnixMilli()
	s.mu.Lock()
	s.status = cloneAutoUpdateStatus(status)
	s.mu.Unlock()
	return status
}

func (s *AutoUpdateService) check() AutoUpdateStatus {
	status := baseAutoUpdateStatus()
	status.State = AutoUpdateStateChecking
	status.Reason = "Checking for updates."
	s.setStatus(status)

	source := resolveAutoUpdateManifestSource()
	status.ManifestSource = source
	if source == "" {
		status.State = AutoUpdateStateManualRequired
		status.Reason = "No auto-update manifest is configured; use the manual DMG release flow."
		return s.setStatus(status)
	}

	manifest, err := s.readManifest(source)
	if err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}
	manifest = normalizeAutoUpdateManifest(manifest)
	if reason := validateAutoUpdateManifest(manifest); reason != "" {
		status.State = AutoUpdateStateFailed
		status.Reason = reason
		return s.setStatus(status)
	}
	status.Manifest = &manifest
	status.TargetVersion = manifest.Version
	status.TargetBuild = manifest.Build
	status.TargetSequence = autoUpdateManifestSequence(manifest)
	status.ReleaseNotes = manifest.ReleaseNotes
	status.Mandatory = manifest.Mandatory
	status.Verification.Version = manifest.Version
	status.Verification.Mandatory = manifest.Mandatory

	if manifest.Channel != status.Channel {
		status.State = AutoUpdateStateNotAvailable
		status.Reason = fmt.Sprintf("Manifest channel %q does not match configured channel %q.", manifest.Channel, status.Channel)
		return s.setStatus(status)
	}

	artifact, ok := selectAutoUpdateArtifact(&manifest, runtime.GOOS, runtime.GOARCH)
	if !ok {
		status.State = AutoUpdateStateNotAvailable
		status.Reason = fmt.Sprintf("No update artifact for %s/%s.", runtime.GOOS, runtime.GOARCH)
		return s.setStatus(status)
	}
	status.Artifact = cloneAutoUpdateArtifactPtr(artifact)
	status.Verification.Artifact = cloneAutoUpdateArtifactPtr(artifact)

	compare := compareAutoUpdateTarget(manifest, status.Current)
	if compare <= 0 && status.Current.Version != "" && status.Current.Version != "0.0.0-dev" {
		status.State = AutoUpdateStateNotAvailable
		status.Reason = fmt.Sprintf("Current version %s is up to date for channel %s.", autoUpdateBuildLabel(status.Current.Version, status.Current.Build), status.Channel)
		return s.setStatus(status)
	}

	if artifact.Kind != "" && artifact.Kind != "zip" {
		status.State = AutoUpdateStateManualRequired
		status.Reason = fmt.Sprintf("Update artifact kind %q requires manual installer flow.", artifact.Kind)
		return s.setStatus(status)
	}

	if err := enforceAutoUpdateRollbackFloor(status.Channel, status.Current, manifest); err != nil {
		status.State = AutoUpdateStateNotAvailable
		status.Reason = err.Error()
		return s.setStatus(status)
	}

	status.State = AutoUpdateStateAvailable
	status.Reason = fmt.Sprintf("Version %s is available.", autoUpdateBuildLabel(manifest.Version, manifest.Build))
	status.Progress = 0
	status.ApplyAvailable = false
	return s.setStatus(status)
}

func (s *AutoUpdateService) downloadAndStage() AutoUpdateStatus {
	status := s.snapshot()
	if status.State != AutoUpdateStateAvailable || status.Artifact == nil || status.Manifest == nil {
		status = s.check()
		if status.State != AutoUpdateStateAvailable {
			return status
		}
	}

	status.State = AutoUpdateStateDownloading
	status.Reason = "Downloading update artifact."
	status.Progress = 0.1
	s.setStatus(status)

	cacheDir, err := autoUpdateCacheDir()
	if err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}
	if err := os.MkdirAll(cacheDir, 0o700); err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = fmt.Sprintf("Auto-update cache directory could not be created: %v", err)
		return s.setStatus(status)
	}

	data, err := s.readArtifact(*status.Artifact)
	if err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}
	downloadPath := filepath.Join(cacheDir, artifactCacheName(status.TargetVersion, *status.Artifact))
	if err := os.WriteFile(downloadPath, data, 0o600); err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = fmt.Sprintf("Auto-update artifact could not be cached: %v", err)
		return s.setStatus(status)
	}
	status.DownloadPath = downloadPath
	status.Progress = 0.45

	verification, err := verifyRuntimeAutoUpdateArtifact(data, status.Channel, status.TargetVersion, *status.Artifact)
	if err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		status.Verification = verification
		return s.setStatus(status)
	}
	status.Verification = verification
	status.Progress = 0.7

	stageRoot := filepath.Join(cacheDir, "staged")
	_ = os.RemoveAll(stageRoot)
	if err := os.MkdirAll(stageRoot, 0o700); err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = fmt.Sprintf("Auto-update staging directory could not be created: %v", err)
		return s.setStatus(status)
	}
	stage, err := stageAutoUpdateZip(data, stageRoot, s.verifyPermissionStableStagedApp)
	if err != nil {
		_ = os.RemoveAll(stageRoot)
		status.StagingDir = ""
		status.StagedAppPath = ""
		status.ApplyAvailable = false
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}
	if err := validateAutoUpdateStagedTarget(stage, *status.Manifest); err != nil {
		_ = os.RemoveAll(stageRoot)
		status.StagingDir = ""
		status.StagedAppPath = ""
		status.ApplyAvailable = false
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}

	transitionNote := ""
	currentBundle := currentAppBundlePath()
	if runtime.GOOS == "darwin" && currentBundle != "" {
		if _, note, err := validateAutoUpdateCodeIdentityTransition(currentBundle, stage.StagedAppPath, s.inspectCodeIdentity); err != nil {
			_ = os.RemoveAll(stageRoot)
			status.StagingDir = ""
			status.StagedAppPath = ""
			status.ApplyAvailable = false
			status.State = AutoUpdateStateFailed
			status.Reason = err.Error()
			return s.setStatus(status)
		} else {
			transitionNote = note
		}
	}

	if err := recordVerifiedAutoUpdateSequence(status.Channel, *status.Manifest); err != nil {
		_ = os.RemoveAll(stageRoot)
		status.StagingDir = ""
		status.StagedAppPath = ""
		status.ApplyAvailable = false
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}

	status.StagingDir = stage.StagingDir
	status.StagedAppPath = stage.StagedAppPath
	status.Progress = 1
	status.ApplyAvailable = currentBundle != "" && isPathWritable(filepath.Dir(currentBundle))
	if status.ApplyAvailable {
		status.State = AutoUpdateStateStaged
		status.Reason = "Update is verified and ready to install after confirmation."
		if transitionNote != "" {
			status.Reason += " " + transitionNote
		}
	} else {
		status.State = AutoUpdateStateManualRequired
		status.Reason = "Update is verified, but the current app bundle is not writable. Use the DMG replacement flow."
		if transitionNote != "" {
			status.Reason += " " + transitionNote
		}
	}
	return s.setStatus(status)
}

func (s *AutoUpdateService) apply(owner *App) AutoUpdateStatus {
	status := s.snapshot()
	if status.State != AutoUpdateStateStaged || status.StagedAppPath == "" {
		status.State = AutoUpdateStateFailed
		status.Reason = "No staged update is ready to apply."
		return s.setStatus(status)
	}
	if runtime.GOOS != "darwin" {
		status.State = AutoUpdateStateManualRequired
		status.Reason = "Automatic bundle replacement is only implemented for macOS."
		return s.setStatus(status)
	}

	currentBundle := currentAppBundlePath()
	if currentBundle == "" {
		status.State = AutoUpdateStateManualRequired
		status.Reason = "Current process is not running from an app bundle. Use the manual DMG replacement flow."
		return s.setStatus(status)
	}
	if !isPathWritable(filepath.Dir(currentBundle)) {
		status.State = AutoUpdateStateManualRequired
		status.Reason = "Current app bundle is not writable. Use the manual DMG replacement flow."
		return s.setStatus(status)
	}

	stagedIdentity, transitionNote, err := validateAutoUpdateCodeIdentityTransition(currentBundle, status.StagedAppPath, s.inspectCodeIdentity)
	if err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}

	cacheDir, err := autoUpdateCacheDir()
	if err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = err.Error()
		return s.setStatus(status)
	}
	helperDir := filepath.Join(cacheDir, "apply")
	if err := os.MkdirAll(helperDir, 0o700); err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = fmt.Sprintf("Auto-update apply helper directory could not be created: %v", err)
		return s.setStatus(status)
	}

	plan := autoUpdateApplyPlan{
		AppPID:                         os.Getpid(),
		CurrentAppPath:                 currentBundle,
		StagedAppPath:                  status.StagedAppPath,
		BackupAppPath:                  filepath.Join(helperDir, "Arlecchino.app.backup"),
		ReportPath:                     filepath.Join(helperDir, "apply-report.json"),
		ExpectedBundleID:               stagedIdentity.BundleID,
		ExpectedRequirementFingerprint: stagedIdentity.StableRequirementFingerprint,
	}
	helperPath := filepath.Join(helperDir, "apply-update.zsh")
	if err := os.WriteFile(helperPath, []byte(buildAutoUpdateApplyHelperScript(plan)), 0o700); err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = fmt.Sprintf("Auto-update apply helper could not be written: %v", err)
		return s.setStatus(status)
	}
	cmd := exec.Command("/bin/zsh", helperPath)
	if err := cmd.Start(); err != nil {
		status.State = AutoUpdateStateFailed
		status.Reason = fmt.Sprintf("Auto-update apply helper could not start: %v", err)
		return s.setStatus(status)
	}

	status.State = AutoUpdateStateApplying
	status.ReportPath = plan.ReportPath
	status.Reason = "Arlecchino will quit, replace the app bundle, and relaunch."
	if transitionNote != "" {
		status.Reason += " " + transitionNote
	}
	status = s.setStatus(status)

	go func() {
		time.Sleep(300 * time.Millisecond)
		if owner != nil && owner.wailsApp != nil {
			owner.wailsApp.Quit()
			return
		}
		os.Exit(0)
	}()

	return status
}

func (s *AutoUpdateService) cancel() AutoUpdateStatus {
	status := s.snapshot()
	if status.StagingDir != "" {
		_ = os.RemoveAll(status.StagingDir)
	}
	if status.DownloadPath != "" {
		_ = os.Remove(status.DownloadPath)
	}
	next := baseAutoUpdateStatus()
	next.State = AutoUpdateStateIdle
	next.Reason = "Auto-update was canceled."
	return s.setStatus(next)
}

func (s *AutoUpdateService) readManifest(source string) (PackagedOSAutoUpdateManifest, error) {
	source = strings.TrimSpace(source)
	parsed, err := url.Parse(source)
	if err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https" || parsed.Scheme == "file") {
		data, err := s.readURLBytes(source, autoUpdateMaxManifestBytes)
		if err != nil {
			return PackagedOSAutoUpdateManifest{}, fmt.Errorf("auto-update manifest could not be read: %w", err)
		}
		var manifest PackagedOSAutoUpdateManifest
		if err := json.Unmarshal(data, &manifest); err != nil {
			return PackagedOSAutoUpdateManifest{}, fmt.Errorf("auto-update manifest is invalid JSON: %w", err)
		}
		return manifest, nil
	}

	manifest, reason := readAutoUpdateManifest(source)
	if manifest == nil {
		return PackagedOSAutoUpdateManifest{}, fmt.Errorf("%s", reason)
	}
	return *manifest, nil
}

func (s *AutoUpdateService) readArtifact(artifact PackagedOSAutoUpdateArtifact) ([]byte, error) {
	data, err := s.readURLBytesWithTimeout(artifact.URL, maxAutoUpdateSmokeArtifactBytes, autoUpdateHTTPArtifactTimeout)
	if err != nil {
		return nil, fmt.Errorf("auto-update artifact download failed: %w", err)
	}
	return data, nil
}

func (s *AutoUpdateService) readURLBytes(rawURL string, limit int64) ([]byte, error) {
	return s.readURLBytesWithTimeout(rawURL, limit, autoUpdateHTTPManifestTimeout)
}

func (s *AutoUpdateService) readURLBytesWithTimeout(rawURL string, limit int64, timeout time.Duration) ([]byte, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("URL is invalid: %w", err)
	}
	switch parsed.Scheme {
	case "file":
		data, err := os.ReadFile(parsed.Path)
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > limit {
			return nil, fmt.Errorf("file exceeds size limit")
		}
		return data, nil
	case "http", "https":
		req, err := http.NewRequest(http.MethodGet, rawURL, nil)
		if err != nil {
			return nil, err
		}
		return s.readHTTPResponseBytes(req, limit, timeout, "response")
	default:
		return nil, fmt.Errorf("URL scheme %q is unsupported", parsed.Scheme)
	}
}

func (s *AutoUpdateService) readHTTPResponseBytes(req *http.Request, limit int64, timeout time.Duration, limitLabel string) ([]byte, error) {
	if req == nil {
		return nil, fmt.Errorf("request is nil")
	}
	client := s.client
	if client == nil {
		client = newAutoUpdateHTTPClient()
	}

	if timeout > 0 {
		ctx, cancel := context.WithTimeout(req.Context(), timeout)
		req = req.WithContext(ctx)
		defer cancel()
	}

	resp, err := client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, fmt.Errorf("download timed out after %s", timeout)
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > limit {
		return nil, fmt.Errorf("%s exceeds size limit", limitLabel)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, fmt.Errorf("download timed out after %s while reading response body", timeout)
		}
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("%s exceeds size limit", limitLabel)
	}
	return data, nil
}

func resolveAutoUpdateManifestSource() string {
	if value := strings.TrimSpace(os.Getenv(autoUpdateManifestURLEnv)); value != "" {
		return value
	}
	if value := strings.TrimSpace(buildManifestURL); value != "" {
		return value
	}
	return strings.TrimSpace(os.Getenv(packagedOSAutoUpdateManifestEnv))
}

func verifyRuntimeAutoUpdateArtifact(data []byte, channel string, version string, artifact PackagedOSAutoUpdateArtifact) (PackagedOSAutoUpdateVerification, error) {
	result := PackagedOSAutoUpdateVerification{
		Status:   "verifying",
		Channel:  channel,
		Version:  version,
		Platform: runtime.GOOS,
		Arch:     runtime.GOARCH,
		Artifact: cloneAutoUpdateArtifactPtr(artifact),
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != artifact.SHA256 {
		result.Status = "checksum-mismatch"
		result.Reason = "Auto-update artifact SHA256 did not match manifest."
		return result, fmt.Errorf("%s", result.Reason)
	}
	result.ChecksumVerified = true

	publicKey, err := decodeAutoUpdatePublicKey(resolveAutoUpdatePublicKey())
	if err != nil {
		result.Status = "signature-key-invalid"
		result.Reason = err.Error()
		return result, err
	}
	signature, err := decodeAutoUpdateSignature(artifact.Signature)
	if err != nil {
		result.Status = "signature-invalid"
		result.Reason = err.Error()
		return result, err
	}
	if !ed25519.Verify(publicKey, data, signature) {
		result.Status = "signature-mismatch"
		result.Reason = "Auto-update artifact detached signature did not verify."
		return result, fmt.Errorf("%s", result.Reason)
	}
	result.SignatureVerified = true
	result.Staged = true
	result.InstallEnabled = true
	result.Status = "verified"
	result.Reason = "Auto-update artifact checksum and detached signature verified."
	return result, nil
}

func stageAutoUpdateZip(data []byte, stageRoot string, verifyStagedApp func(string) error) (autoUpdateStageResult, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return autoUpdateStageResult{}, fmt.Errorf("auto-update artifact is not a valid ZIP: %w", err)
	}
	stagingDir, err := os.MkdirTemp(stageRoot, "candidate-*")
	if err != nil {
		return autoUpdateStageResult{}, fmt.Errorf("auto-update staging directory could not be created: %w", err)
	}
	extractDir := filepath.Join(stagingDir, "extract")
	if err := os.MkdirAll(extractDir, 0o700); err != nil {
		return autoUpdateStageResult{}, fmt.Errorf("auto-update extract directory could not be created: %w", err)
	}

	for _, file := range reader.File {
		if shouldSkipAutoUpdateZipEntry(file.Name) {
			continue
		}
		if err := extractZipFile(file, extractDir); err != nil {
			return autoUpdateStageResult{}, err
		}
	}

	appPath := filepath.Join(extractDir, "Arlecchino.app")
	if err := validateStagedAppBundle(appPath, verifyStagedApp); err != nil {
		return autoUpdateStageResult{}, err
	}
	version := readPlistRaw(filepath.Join(appPath, "Contents", "Info.plist"), "CFBundleShortVersionString")
	build := readPlistRaw(filepath.Join(appPath, "Contents", "Info.plist"), "CFBundleVersion")
	return autoUpdateStageResult{StagingDir: stagingDir, StagedAppPath: appPath, Version: version, Build: build}, nil
}

func shouldSkipAutoUpdateZipEntry(name string) bool {
	name = filepath.ToSlash(filepath.Clean(name))
	if name == "." {
		return false
	}
	parts := strings.Split(name, "/")
	for _, part := range parts {
		if part == "__MACOSX" || strings.HasPrefix(part, "._") {
			return true
		}
	}
	return false
}

func extractZipFile(file *zip.File, destinationRoot string) error {
	name := filepath.Clean(file.Name)
	if name == "." || strings.HasPrefix(name, ".."+string(filepath.Separator)) || filepath.IsAbs(name) {
		return fmt.Errorf("auto-update ZIP contains unsafe path %q", file.Name)
	}
	if file.FileInfo().Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("auto-update ZIP contains unsupported symlink %q", file.Name)
	}

	target := filepath.Join(destinationRoot, name)
	if !strings.HasPrefix(target, destinationRoot+string(filepath.Separator)) && target != destinationRoot {
		return fmt.Errorf("auto-update ZIP path escapes staging directory: %q", file.Name)
	}
	if file.FileInfo().IsDir() {
		return os.MkdirAll(target, file.FileInfo().Mode().Perm())
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	input, err := file.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.FileInfo().Mode().Perm())
	if err != nil {
		return err
	}
	defer output.Close()
	_, err = io.Copy(output, input)
	return err
}

func validateStagedAppBundle(appPath string, verifyStagedApp func(string) error) error {
	info, err := os.Stat(appPath)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("auto-update ZIP must contain Arlecchino.app")
	}
	infoPlist := filepath.Join(appPath, "Contents", "Info.plist")
	if _, err := os.Stat(infoPlist); err != nil {
		return fmt.Errorf("staged Arlecchino.app has no Info.plist: %w", err)
	}
	executable := filepath.Join(appPath, "Contents", "MacOS", "Arlecchino")
	if stat, err := os.Stat(executable); err != nil {
		return fmt.Errorf("staged Arlecchino.app has no executable: %w", err)
	} else if stat.Mode()&0o111 == 0 {
		return fmt.Errorf("staged Arlecchino.app executable is not executable")
	}
	if err := validatePackagedRuntimeAssets(appPath); err != nil {
		return err
	}
	if version := readPlistRaw(infoPlist, "CFBundleShortVersionString"); strings.TrimSpace(version) == "" {
		return fmt.Errorf("staged Arlecchino.app has no CFBundleShortVersionString")
	}
	if build := readPlistRaw(infoPlist, "CFBundleVersion"); strings.TrimSpace(build) == "" {
		return fmt.Errorf("staged Arlecchino.app has no CFBundleVersion")
	}
	if verifyStagedApp != nil {
		if err := verifyStagedApp(appPath); err != nil {
			return fmt.Errorf("staged Arlecchino.app verification failed: %w", err)
		}
	}
	return nil
}

func (s *AutoUpdateService) verifyPermissionStableStagedApp(appPath string) error {
	if _, err := verifyPermissionStableMacOSUpdateCandidate(appPath, s.inspectCodeIdentity); err != nil {
		return fmt.Errorf("macOS code identity is not permission-stable: %w", err)
	}
	return nil
}

func validatePackagedRuntimeAssets(appPath string) error {
	for _, name := range []string{"arle_model.onnx", "arle_tokenizer.json"} {
		path := filepath.Join(appPath, "Contents", "Resources", "assets", name)
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("staged Arlecchino.app is missing runtime asset %s: %w", name, err)
		}
		if info.IsDir() {
			return fmt.Errorf("staged Arlecchino.app runtime asset %s is a directory", name)
		}
		if info.Size() == 0 {
			return fmt.Errorf("staged Arlecchino.app runtime asset %s is empty", name)
		}
		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("staged Arlecchino.app runtime asset %s is unreadable: %w", name, err)
		}
		_ = file.Close()
	}
	onnxRuntimePath := filepath.Join(appPath, "Contents", "Frameworks", "libonnxruntime.dylib")
	info, err := os.Stat(onnxRuntimePath)
	if err != nil {
		return fmt.Errorf("staged Arlecchino.app is missing ONNX Runtime: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("staged Arlecchino.app ONNX Runtime is a directory")
	}
	if info.Size() == 0 {
		return fmt.Errorf("staged Arlecchino.app ONNX Runtime is empty")
	}
	file, err := os.Open(onnxRuntimePath)
	if err != nil {
		return fmt.Errorf("staged Arlecchino.app ONNX Runtime is unreadable: %w", err)
	}
	_ = file.Close()
	return nil
}

func readPlistRaw(infoPlist string, key string) string {
	if runtime.GOOS != "darwin" {
		return readPlistRawFallback(infoPlist, key)
	}
	output, err := exec.Command("/usr/bin/plutil", "-extract", key, "raw", "-o", "-", infoPlist).Output()
	if err != nil {
		return readPlistRawFallback(infoPlist, key)
	}
	return strings.TrimSpace(string(output))
}

func readPlistRawFallback(infoPlist string, key string) string {
	data, err := os.ReadFile(infoPlist)
	if err != nil {
		return ""
	}
	content := string(data)
	keyMarker := "<key>" + key + "</key>"
	keyIndex := strings.Index(content, keyMarker)
	if keyIndex < 0 {
		return ""
	}
	remainder := content[keyIndex+len(keyMarker):]
	start := strings.Index(remainder, "<string>")
	end := strings.Index(remainder, "</string>")
	if start < 0 || end < 0 || end <= start {
		return ""
	}
	return strings.TrimSpace(remainder[start+len("<string>") : end])
}

func autoUpdateCacheDir() (string, error) {
	if value := strings.TrimSpace(os.Getenv(autoUpdateCacheDirEnv)); value != "" {
		return value, nil
	}
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("user cache directory is unavailable: %w", err)
	}
	return filepath.Join(cacheRoot, "Arlecchino", "updates"), nil
}

func autoUpdateStateDir() (string, error) {
	if value := strings.TrimSpace(os.Getenv(autoUpdateStateDirEnv)); value != "" {
		return value, nil
	}
	configRoot, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("user config directory is unavailable: %w", err)
	}
	return filepath.Join(configRoot, "Arlecchino"), nil
}

func autoUpdateRollbackStatePath() (string, error) {
	stateDir, err := autoUpdateStateDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(stateDir, "auto-update-state.json"), nil
}

func readAutoUpdateRollbackState() (autoUpdateRollbackState, error) {
	state := autoUpdateRollbackState{Version: autoUpdateStateVersion, Channels: map[string]autoUpdateRollbackChannelState{}}
	path, err := autoUpdateRollbackStatePath()
	if err != nil {
		return state, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return state, nil
		}
		return state, fmt.Errorf("auto-update rollback state could not be read: %w", err)
	}
	if err := json.Unmarshal(data, &state); err != nil {
		return autoUpdateRollbackState{}, fmt.Errorf("auto-update rollback state is invalid: %w", err)
	}
	if state.Channels == nil {
		state.Channels = map[string]autoUpdateRollbackChannelState{}
	}
	for channel, entry := range state.Channels {
		if entry.Sequence < 0 {
			return autoUpdateRollbackState{}, fmt.Errorf("auto-update rollback state has invalid sequence for channel %q", channel)
		}
	}
	if state.Version == 0 {
		state.Version = autoUpdateStateVersion
	}
	return state, nil
}

func writeAutoUpdateRollbackState(state autoUpdateRollbackState) error {
	path, err := autoUpdateRollbackStatePath()
	if err != nil {
		return err
	}
	if state.Version == 0 {
		state.Version = autoUpdateStateVersion
	}
	if state.Channels == nil {
		state.Channels = map[string]autoUpdateRollbackChannelState{}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("auto-update rollback state directory could not be created: %w", err)
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("auto-update rollback state could not be encoded: %w", err)
	}
	data = append(data, '\n')
	tmp, err := os.CreateTemp(filepath.Dir(path), ".auto-update-state-*.json")
	if err != nil {
		return fmt.Errorf("auto-update rollback state temp file could not be created: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("auto-update rollback state could not be written: %w", err)
	}
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("auto-update rollback state permissions could not be set: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("auto-update rollback state could not be closed: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("auto-update rollback state could not be replaced: %w", err)
	}
	return nil
}

func normalizeAutoUpdateChannelKey(channel string) string {
	return strings.ToLower(strings.TrimSpace(channel))
}

func autoUpdateBuildSequence(build string) int64 {
	build = strings.TrimSpace(build)
	if build == "" {
		return 0
	}
	sequence, err := strconv.ParseInt(build, 10, 64)
	if err != nil || sequence <= 0 {
		return 0
	}
	return sequence
}

func autoUpdateManifestSequence(manifest PackagedOSAutoUpdateManifest) int64 {
	if manifest.Sequence > 0 {
		return manifest.Sequence
	}
	return autoUpdateBuildSequence(manifest.Build)
}

func autoUpdateCurrentSequence(current BuildInfo) int64 {
	if current.Version == "" || current.Version == "0.0.0-dev" {
		return 0
	}
	return autoUpdateBuildSequence(current.Build)
}

func enforceAutoUpdateRollbackFloor(channel string, current BuildInfo, manifest PackagedOSAutoUpdateManifest) error {
	targetSequence := autoUpdateManifestSequence(manifest)
	floorSequence := autoUpdateCurrentSequence(current)
	state, err := readAutoUpdateRollbackState()
	if err != nil {
		return err
	}
	if entry, ok := state.Channels[normalizeAutoUpdateChannelKey(channel)]; ok && entry.Sequence > floorSequence {
		floorSequence = entry.Sequence
	}
	if floorSequence <= 0 {
		return nil
	}
	if targetSequence <= 0 {
		return fmt.Errorf("Auto-update manifest has no monotonic sequence or numeric build; refusing update after sequence %d.", floorSequence)
	}
	if targetSequence < floorSequence {
		return fmt.Errorf("Auto-update manifest sequence %d is older than previously accepted sequence %d.", targetSequence, floorSequence)
	}
	return nil
}

func recordVerifiedAutoUpdateSequence(channel string, manifest PackagedOSAutoUpdateManifest) error {
	sequence := autoUpdateManifestSequence(manifest)
	if sequence <= 0 {
		return fmt.Errorf("Auto-update manifest has no monotonic sequence or numeric build; verified update was not accepted.")
	}
	state, err := readAutoUpdateRollbackState()
	if err != nil {
		return err
	}
	channelKey := normalizeAutoUpdateChannelKey(channel)
	if current, ok := state.Channels[channelKey]; ok && sequence < current.Sequence {
		return fmt.Errorf("Auto-update manifest sequence %d is older than previously accepted sequence %d.", sequence, current.Sequence)
	}
	state.Channels[channelKey] = autoUpdateRollbackChannelState{
		Sequence:  sequence,
		Version:   strings.TrimSpace(manifest.Version),
		Build:     strings.TrimSpace(manifest.Build),
		UpdatedAt: time.Now().UnixMilli(),
	}
	if err := writeAutoUpdateRollbackState(state); err != nil {
		return err
	}
	return nil
}

func validateAutoUpdateStagedTarget(stage autoUpdateStageResult, manifest PackagedOSAutoUpdateManifest) error {
	if strings.TrimSpace(stage.Version) != strings.TrimSpace(manifest.Version) {
		return fmt.Errorf("staged Arlecchino.app version %q does not match manifest version %q", stage.Version, manifest.Version)
	}
	if strings.TrimSpace(stage.Build) != strings.TrimSpace(manifest.Build) {
		return fmt.Errorf("staged Arlecchino.app build %q does not match manifest build %q", stage.Build, manifest.Build)
	}
	return nil
}

func artifactCacheName(version string, artifact PackagedOSAutoUpdateArtifact) string {
	version = strings.NewReplacer("/", "-", ":", "-").Replace(strings.TrimSpace(version))
	if version == "" {
		version = "candidate"
	}
	kind := artifact.Kind
	if kind == "" {
		kind = "zip"
	}
	return fmt.Sprintf("arlecchino-%s-%s-%s.%s", version, runtime.GOOS, runtime.GOARCH, kind)
}

func isPathWritable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}
	probe, err := os.CreateTemp(path, ".arlecchino-write-test-*")
	if err != nil {
		return false
	}
	name := probe.Name()
	_ = probe.Close()
	_ = os.Remove(name)
	return true
}

func buildAutoUpdateApplyHelperScript(plan autoUpdateApplyPlan) string {
	current := shellQuote(plan.CurrentAppPath)
	staged := shellQuote(plan.StagedAppPath)
	backup := shellQuote(plan.BackupAppPath)
	report := shellQuote(plan.ReportPath)
	expectedBundleID := shellQuote(plan.ExpectedBundleID)
	expectedRequirementFingerprint := shellQuote(plan.ExpectedRequirementFingerprint)
	pid := strconv.Itoa(plan.AppPID)
	return `#!/bin/zsh
set -euo pipefail

APP_PID=` + shellQuote(pid) + `
CURRENT_APP=` + current + `
STAGED_APP=` + staged + `
BACKUP_APP=` + backup + `
REPORT_PATH=` + report + `
EXPECTED_BUNDLE_ID=` + expectedBundleID + `
EXPECTED_REQUIREMENT_SHA=` + expectedRequirementFingerprint + `

write_report() {
  local status="$1"
  local reason="$2"
  local escaped_status="${status//\\/\\\\}"
  escaped_status="${escaped_status//\"/\\\"}"
  local escaped_reason="${reason//\\/\\\\}"
  escaped_reason="${escaped_reason//\"/\\\"}"
  escaped_reason="${escaped_reason//$'\n'/\\n}"
  /bin/mkdir -p "$(/usr/bin/dirname "$REPORT_PATH")"
  /usr/bin/printf '{"status":"%s","reason":"%s","updatedAt":%s}\n' \
    "$escaped_status" \
    "$escaped_reason" \
    "$(/bin/date +%s)" > "$REPORT_PATH"
}

restore_backup() {
  /bin/rm -rf "$CURRENT_APP"
  if [[ -d "$BACKUP_APP" ]]; then
    /usr/bin/ditto "$BACKUP_APP" "$CURRENT_APP"
  fi
}

while /bin/kill -0 "$APP_PID" >/dev/null 2>&1; do
  /bin/sleep 0.25
done

/bin/rm -rf "$BACKUP_APP"
if [[ -d "$CURRENT_APP" ]]; then
  /usr/bin/ditto "$CURRENT_APP" "$BACKUP_APP"
fi

if ! /bin/rm -rf "$CURRENT_APP"; then
  write_report failed "Could not remove current app bundle."
  exit 1
fi

if ! /usr/bin/ditto "$STAGED_APP" "$CURRENT_APP"; then
  restore_backup
  write_report failed "Could not copy staged app bundle."
  exit 1
fi

if ! /usr/bin/codesign --verify --deep --strict --verbose=2 "$CURRENT_APP" >/tmp/arlecchino-update-codesign.log 2>&1; then
  restore_backup
  write_report failed "$(/bin/cat /tmp/arlecchino-update-codesign.log)"
  exit 1
fi

if [[ -n "$EXPECTED_BUNDLE_ID" ]]; then
  ACTUAL_BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$CURRENT_APP/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$ACTUAL_BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]]; then
    restore_backup
    write_report failed "Installed app bundle id did not match the verified update candidate."
    exit 1
  fi
fi

if [[ -n "$EXPECTED_REQUIREMENT_SHA" ]]; then
  if ! REQUIREMENT_LINE="$(/usr/bin/codesign -d -r- "$CURRENT_APP" 2>&1 | /usr/bin/awk '/designated =>/ { sub(/^[[:space:]]*/, "", $0); print; found=1 } END { exit found ? 0 : 1 }')"; then
    restore_backup
    write_report failed "Installed app designated requirement could not be read."
    exit 1
  fi
  ACTUAL_REQUIREMENT_SHA="$(/usr/bin/printf '%s' "$REQUIREMENT_LINE" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}')"
  if [[ "$ACTUAL_REQUIREMENT_SHA" != "$EXPECTED_REQUIREMENT_SHA" ]]; then
    restore_backup
    write_report failed "Installed app macOS signing identity did not match the verified update candidate."
    exit 1
  fi
fi

/usr/bin/open "$CURRENT_APP"
/bin/rm -rf "$BACKUP_APP"
write_report succeeded "Arlecchino.app was replaced and relaunched."
`
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

func compareAutoUpdateVersions(left string, right string) int {
	leftVersion := parseAutoUpdateVersion(left)
	rightVersion := parseAutoUpdateVersion(right)
	for i := 0; i < 3; i++ {
		if leftVersion.Core[i] > rightVersion.Core[i] {
			return 1
		}
		if leftVersion.Core[i] < rightVersion.Core[i] {
			return -1
		}
	}
	return compareAutoUpdatePrerelease(leftVersion.Prerelease, rightVersion.Prerelease)
}

func compareAutoUpdateTarget(manifest PackagedOSAutoUpdateManifest, current BuildInfo) int {
	versionCompare := compareAutoUpdateVersions(manifest.Version, current.Version)
	if versionCompare != 0 {
		return versionCompare
	}
	return compareAutoUpdateBuilds(manifest.Build, current.Build)
}

func compareAutoUpdateBuilds(left string, right string) int {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == right {
		return 0
	}
	if left == "" {
		return 0
	}
	if right == "" {
		return 1
	}

	leftNumber, leftErr := strconv.Atoi(left)
	rightNumber, rightErr := strconv.Atoi(right)
	if leftErr == nil && rightErr == nil {
		if leftNumber > rightNumber {
			return 1
		}
		if leftNumber < rightNumber {
			return -1
		}
		return 0
	}

	return strings.Compare(left, right)
}

func autoUpdateBuildLabel(version string, build string) string {
	version = strings.TrimSpace(version)
	build = strings.TrimSpace(build)
	if build == "" {
		return version
	}
	return fmt.Sprintf("%s build %s", version, build)
}

type autoUpdateVersion struct {
	Core       [3]int
	Prerelease []string
}

func parseAutoUpdateVersion(version string) autoUpdateVersion {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	version = strings.SplitN(version, "+", 2)[0]
	coreText := version
	prereleaseText := ""
	if before, after, ok := strings.Cut(version, "-"); ok {
		coreText = before
		prereleaseText = after
	}

	parts := strings.Split(coreText, ".")
	parsed := autoUpdateVersion{}
	for i := 0; i < len(parts) && i < 3; i++ {
		value, _ := strconv.Atoi(parts[i])
		parsed.Core[i] = value
	}
	if prereleaseText != "" {
		parsed.Prerelease = strings.Split(prereleaseText, ".")
	}
	return parsed
}

func compareAutoUpdatePrerelease(left []string, right []string) int {
	if len(left) == 0 && len(right) == 0 {
		return 0
	}
	if len(left) == 0 {
		return 1
	}
	if len(right) == 0 {
		return -1
	}

	limit := len(left)
	if len(right) < limit {
		limit = len(right)
	}
	for i := 0; i < limit; i++ {
		compare := compareAutoUpdatePrereleaseIdentifier(left[i], right[i])
		if compare != 0 {
			return compare
		}
	}
	if len(left) > len(right) {
		return 1
	}
	if len(left) < len(right) {
		return -1
	}
	return 0
}

func compareAutoUpdatePrereleaseIdentifier(left string, right string) int {
	leftNumber, leftNumeric := parseAutoUpdatePrereleaseNumber(left)
	rightNumber, rightNumeric := parseAutoUpdatePrereleaseNumber(right)
	switch {
	case leftNumeric && rightNumeric:
		if leftNumber > rightNumber {
			return 1
		}
		if leftNumber < rightNumber {
			return -1
		}
		return 0
	case leftNumeric:
		return -1
	case rightNumeric:
		return 1
	default:
		return strings.Compare(left, right)
	}
}

func parseAutoUpdatePrereleaseNumber(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return parsed, true
}

func cloneAutoUpdateStatus(status AutoUpdateStatus) AutoUpdateStatus {
	cloned := status
	if status.Manifest != nil {
		manifest := *status.Manifest
		manifest.Artifacts = append([]PackagedOSAutoUpdateArtifact(nil), status.Manifest.Artifacts...)
		cloned.Manifest = &manifest
	}
	if status.Artifact != nil {
		artifact := *status.Artifact
		cloned.Artifact = &artifact
	}
	if status.Verification.Artifact != nil {
		artifact := *status.Verification.Artifact
		cloned.Verification.Artifact = &artifact
	}
	return cloned
}
