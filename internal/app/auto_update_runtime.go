package app

import (
	"archive/zip"
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	autoUpdateGitHubReleasesURL = "https://github.com/KlawdiyRomiy/Arlecchino/releases"
	autoUpdateMaxManifestBytes  = 1024 * 1024
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
	githubAPIBase       string
	tokenStore          autoUpdateTokenStore
}

type autoUpdateStageResult struct {
	StagingDir    string
	StagedAppPath string
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
		client:              &http.Client{Timeout: 45 * time.Second},
		inspectCodeIdentity: inspectMacOSAppCodeIdentity,
		githubAPIBase:       autoUpdateGitHubAPIBaseURL,
		tokenStore:          defaultAutoUpdateTokenStore(),
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
		var manualRequired autoUpdateManualRequiredError
		if errors.As(err, &manualRequired) {
			status.State = AutoUpdateStateManualRequired
			status.Reason = manualRequired.Error()
		} else {
			status.State = AutoUpdateStateFailed
			status.Reason = redactAutoUpdateError(err.Error())
		}
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
		var manualRequired autoUpdateManualRequiredError
		if errors.As(err, &manualRequired) {
			status.State = AutoUpdateStateManualRequired
			status.Reason = manualRequired.Error()
		} else {
			status.State = AutoUpdateStateFailed
			status.Reason = redactAutoUpdateError(err.Error())
		}
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
	if err == nil && parsed.Scheme == autoUpdateGitHubReleaseScheme {
		return s.readGitHubReleaseManifest(source)
	}
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
	return s.readURLBytes(artifact.URL, maxAutoUpdateSmokeArtifactBytes)
}

func (s *AutoUpdateService) readURLBytes(rawURL string, limit int64) ([]byte, error) {
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
		if s.isGitHubReleaseAssetAPIURL(rawURL) {
			token, tokenErr := s.resolveGitHubToken()
			if tokenErr != nil {
				var manualRequired autoUpdateManualRequiredError
				if errors.As(tokenErr, &manualRequired) {
					return nil, manualRequired
				}
				return nil, tokenErr
			}
			req.Header.Set("Accept", "application/octet-stream")
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-GitHub-Api-Version", autoUpdateGitHubAPIVersion)
		}
		resp, err := s.client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > limit {
			return nil, fmt.Errorf("response exceeds size limit")
		}
		return data, nil
	default:
		return nil, fmt.Errorf("URL scheme %q is unsupported", parsed.Scheme)
	}
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
	return autoUpdateStageResult{StagingDir: stagingDir, StagedAppPath: appPath}, nil
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
	leftParts := parseAutoUpdateVersionParts(left)
	rightParts := parseAutoUpdateVersionParts(right)
	for i := 0; i < 3; i++ {
		if leftParts[i] > rightParts[i] {
			return 1
		}
		if leftParts[i] < rightParts[i] {
			return -1
		}
	}
	return strings.Compare(strings.TrimSpace(left), strings.TrimSpace(right))
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

func parseAutoUpdateVersionParts(version string) [3]int {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	version = strings.SplitN(version, "-", 2)[0]
	version = strings.SplitN(version, "+", 2)[0]
	parts := strings.Split(version, ".")
	var parsed [3]int
	for i := 0; i < len(parts) && i < 3; i++ {
		value, _ := strconv.Atoi(parts[i])
		parsed[i] = value
	}
	return parsed
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
