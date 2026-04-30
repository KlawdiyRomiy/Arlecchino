package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	wails3PackagedSmokeVersion        = 1
	envWails3PackagedSmokeBuildTarget = "ARLECCHINO_WAILS3_SMOKE_BUILD_TARGET"
	envWails3PackagedSmokeLaunchMode  = "ARLECCHINO_WAILS3_SMOKE_LAUNCH_MODE"
	envWails3PackagedSmokeAppBundle   = "ARLECCHINO_WAILS3_SMOKE_APP_BUNDLE"
	envWails3PackagedSmokeBundleID    = "ARLECCHINO_WAILS3_SMOKE_BUNDLE_ID"
	envWails3PackagedSmokeOSHandlers  = "ARLECCHINO_WAILS3_SMOKE_OS_HANDLERS"
	envWails3PackagedSmokeSecondArgs  = "ARLECCHINO_WAILS3_SMOKE_SECOND_INSTANCE_ARGS"
	envWails3PackagedSmokeBackground  = "ARLECCHINO_WAILS3_SMOKE_BACKGROUND_SAMPLE"
)

type Wails3PackagedSmokeReport struct {
	Version               int                            `json:"version"`
	Runtime               string                         `json:"runtime"`
	Platform              string                         `json:"platform"`
	GeneratedAt           string                         `json:"generatedAt"`
	BuildTarget           string                         `json:"buildTarget,omitempty"`
	WorkingDir            string                         `json:"workingDir,omitempty"`
	LaunchArgs            []string                       `json:"launchArgs"`
	OpenIntent            map[string]any                 `json:"openIntent,omitempty"`
	OpenIntentQueued      bool                           `json:"openIntentQueued"`
	ShellCapabilities     ShellCapabilitiesSnapshot      `json:"shellCapabilities"`
	PackagedOSIntegration PackagedOSIntegrationSnapshot  `json:"packagedOSIntegration"`
	BackgroundShell       BackgroundShellStatusSnapshot  `json:"backgroundShell"`
	NativeDelivery        Wails3SmokeNativeDeliveryProbe `json:"nativeDelivery"`
	AutoUpdate            Wails3SmokeAutoUpdateProbe     `json:"autoUpdate"`
	SingleInstance        Wails3SmokeGateStatus          `json:"singleInstance"`
	SecondInstance        Wails3SmokeSecondInstanceProbe `json:"secondInstance,omitempty"`
	WindowLease           Wails3SmokeWindowLeaseSnapshot `json:"windowLease"`
	AppBundle             Wails3SmokeAppBundleSnapshot   `json:"appBundle,omitempty"`
	Checks                []Wails3SmokeCheck             `json:"checks"`
}

type Wails3SmokeGateStatus struct {
	Enabled bool                  `json:"enabled"`
	Status  ShellCapabilityStatus `json:"status"`
	Reason  string                `json:"reason"`
}

type Wails3SmokeWindowLeaseSnapshot struct {
	Available    bool     `json:"available"`
	SpikeEnv     bool     `json:"spikeEnv"`
	ActiveLeases []string `json:"activeLeases"`
	Reason       string   `json:"reason"`
}

type Wails3SmokeSecondInstanceProbe struct {
	Enabled          bool                  `json:"enabled"`
	Status           ShellCapabilityStatus `json:"status"`
	Args             []string              `json:"args,omitempty"`
	OpenIntent       map[string]any        `json:"openIntent,omitempty"`
	OpenIntentQueued bool                  `json:"openIntentQueued"`
	Reason           string                `json:"reason"`
}

type Wails3SmokeNativeDeliveryProbe struct {
	Enabled              bool                            `json:"enabled"`
	Status               ShellCapabilityStatus           `json:"status"`
	TrackedFailureStates []string                        `json:"trackedFailureStates"`
	LastError            string                          `json:"lastError,omitempty"`
	Tray                 Wails3SmokeNativeAdapterProbe   `json:"tray"`
	Notifications        Wails3SmokeNativeAdapterProbe   `json:"notifications"`
	DockBadge            Wails3SmokeNativeDockBadgeProbe `json:"dockBadge"`
	Reason               string                          `json:"reason"`
}

type Wails3SmokeNativeAdapterProbe struct {
	Enabled      bool                  `json:"enabled"`
	Status       ShellCapabilityStatus `json:"status"`
	ActionIDs    []string              `json:"actionIds,omitempty"`
	CandidateIDs []string              `json:"candidateIds,omitempty"`
	Reason       string                `json:"reason"`
}

type Wails3SmokeNativeDockBadgeProbe struct {
	Enabled bool                  `json:"enabled"`
	Status  ShellCapabilityStatus `json:"status"`
	Label   string                `json:"label"`
	Reason  string                `json:"reason"`
}

type Wails3SmokeAutoUpdateProbe struct {
	ManifestPath   string                        `json:"manifestPath,omitempty"`
	ManifestStatus string                        `json:"manifestStatus"`
	InstallEnabled bool                          `json:"installEnabled"`
	Manifest       *PackagedOSAutoUpdateManifest `json:"manifest,omitempty"`
	Status         ShellCapabilityStatus         `json:"status"`
	Reason         string                        `json:"reason"`
}

type Wails3SmokeAppBundleSnapshot struct {
	LaunchMode           string                `json:"launchMode,omitempty"`
	Path                 string                `json:"path,omitempty"`
	BundleID             string                `json:"bundleId,omitempty"`
	RegisteredOSHandlers bool                  `json:"registeredOSHandlers"`
	Status               ShellCapabilityStatus `json:"status"`
	Reason               string                `json:"reason"`
}

type Wails3SmokeCheck struct {
	ID      string                `json:"id"`
	Status  ShellCapabilityStatus `json:"status"`
	Passed  bool                  `json:"passed"`
	Message string                `json:"message"`
}

func maybeRunWails3PackagedSmokeMode(args []string) (bool, error) {
	if len(args) == 0 || args[0] != "wails3-packaged-smoke" {
		return false, nil
	}

	options, err := resolveWails3PackagedSmokeOptions(args[1:])
	if err != nil {
		return true, err
	}
	if options.help {
		printWails3PackagedSmokeUsage()
		return true, nil
	}

	report := buildWails3PackagedSmokeReport(
		nil,
		options.launchArgs,
		options.workingDir,
		time.Now().UTC(),
	)
	encoder := json.NewEncoder(os.Stdout)
	if options.pretty {
		encoder.SetIndent("", "  ")
	}
	return true, encoder.Encode(report)
}

type wails3PackagedSmokeOptions struct {
	help       bool
	pretty     bool
	workingDir string
	launchArgs []string
}

func resolveWails3PackagedSmokeOptions(args []string) (wails3PackagedSmokeOptions, error) {
	options := wails3PackagedSmokeOptions{
		workingDir: currentWorkingDir(),
		launchArgs: []string{"Arlecchino-v3"},
	}

	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		switch arg {
		case "", "--":
			if arg == "--" {
				options.launchArgs = append([]string{"Arlecchino-v3"}, args[i+1:]...)
				return options, nil
			}
		case "-h", "--help":
			options.help = true
			return options, nil
		case "--pretty":
			options.pretty = true
		case "--working-dir":
			if i+1 >= len(args) {
				return options, fmt.Errorf("missing value for %s", arg)
			}
			options.workingDir = strings.TrimSpace(args[i+1])
			i++
		default:
			options.launchArgs = append([]string{"Arlecchino-v3"}, args[i:]...)
			return options, nil
		}
	}

	return options, nil
}

func printWails3PackagedSmokeUsage() {
	fmt.Fprintln(os.Stdout, "Usage: arlecchino wails3-packaged-smoke [--pretty] [--working-dir <path>] [-- <launch args>]")
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "Prints a dev-only Wails v3 packaged smoke report without starting the IDE UI.")
	fmt.Fprintln(os.Stdout, "Launch args after -- are parsed through the same open-intent probe as packaged launches.")
}

func (a *App) GetWails3PackagedSmokeReport(args []string) Wails3PackagedSmokeReport {
	return buildWails3PackagedSmokeReport(a, args, currentWorkingDir(), time.Now().UTC())
}

func buildWails3PackagedSmokeReport(
	app *App,
	args []string,
	workingDir string,
	generatedAt time.Time,
) Wails3PackagedSmokeReport {
	launchArgs := normalizeSmokeLaunchArgs(args)
	background := buildWails3SmokeBackgroundSnapshot(app)

	shellCapabilities := buildShellCapabilities(
		runtime.GOOS,
		app != nil && app.wailsApp != nil,
		app != nil && app.mainWindow != nil,
	)
	packagedOS := buildPackagedOSIntegrationSnapshot(
		runtime.GOOS,
		background,
		defaultPackagedOSIntegrationOptions(),
	)
	nativeDelivery := buildWails3SmokeNativeDeliveryProbe(app, packagedOS, background)
	autoUpdate := buildWails3SmokeAutoUpdateProbe(packagedOS)
	openIntent, hasOpenIntent := buildOpenIntentFromLaunchArgs(launchArgs, workingDir)
	if hasOpenIntent {
		openIntent["source"] = "packaged-smoke"
	}

	singleInstance := buildWails3SmokeSingleInstanceStatus()
	secondInstance := buildWails3SmokeSecondInstanceProbe(app, workingDir, singleInstance)
	windowLease := buildWails3SmokeWindowLeaseSnapshot(app)
	appBundle := buildWails3SmokeAppBundleSnapshot()

	return Wails3PackagedSmokeReport{
		Version:               wails3PackagedSmokeVersion,
		Runtime:               "wails-v3",
		Platform:              runtime.GOOS,
		GeneratedAt:           generatedAt.Format(time.RFC3339),
		BuildTarget:           resolveWails3PackagedSmokeBuildTarget(),
		WorkingDir:            strings.TrimSpace(workingDir),
		LaunchArgs:            launchArgs,
		OpenIntent:            openIntent,
		OpenIntentQueued:      hasOpenIntent && (app == nil || !app.openIntentReady),
		ShellCapabilities:     shellCapabilities,
		PackagedOSIntegration: packagedOS,
		BackgroundShell:       background,
		NativeDelivery:        nativeDelivery,
		AutoUpdate:            autoUpdate,
		SingleInstance:        singleInstance,
		SecondInstance:        secondInstance,
		WindowLease:           windowLease,
		AppBundle:             appBundle,
		Checks: buildWails3PackagedSmokeChecks(
			shellCapabilities,
			packagedOS,
			background,
			nativeDelivery,
			autoUpdate,
			singleInstance,
			secondInstance,
			windowLease,
			appBundle,
			hasOpenIntent,
		),
	}
}

func buildWails3SmokeBackgroundSnapshot(app *App) BackgroundShellStatusSnapshot {
	if app != nil && app.backgroundShell != nil {
		return app.backgroundShell.Snapshot()
	}
	if !envFlagEnabled(envWails3PackagedSmokeBackground) {
		return emptyBackgroundShellStatusSnapshot()
	}

	service := NewBackgroundShellStatusService()
	service.UpsertJob(BackgroundShellJob{
		ID:             "execution:packaged-smoke",
		Kind:           "execution",
		Category:       BackgroundShellCategoryJob,
		Title:          "Packaged smoke command",
		Detail:         "Running packaged smoke action fixture.",
		Status:         BackgroundShellJobRunning,
		Cancelable:     true,
		OwnerSurfaceID: "panel:terminal",
	})
	return service.UpsertJob(BackgroundShellJob{
		ID:              "indexer:packaged-smoke",
		Kind:            "indexer",
		Category:        BackgroundShellCategoryJob,
		Title:           "Packaged smoke indexing",
		Detail:          "Indexing fixture failed for native notification smoke.",
		Status:          BackgroundShellJobFailed,
		NotifyOnFailure: true,
		OwnerSurfaceID:  "panel:problems",
	})
}

func normalizeSmokeLaunchArgs(args []string) []string {
	cleaned := make([]string, 0, len(args)+1)
	for _, arg := range args {
		if strings.TrimSpace(arg) == "" {
			continue
		}
		cleaned = append(cleaned, arg)
	}
	if len(cleaned) == 0 {
		return []string{"Arlecchino-v3"}
	}
	return append([]string(nil), cleaned...)
}

func resolveWails3PackagedSmokeBuildTarget() string {
	if target := strings.TrimSpace(os.Getenv(envWails3PackagedSmokeBuildTarget)); target != "" {
		if filepath.IsAbs(target) {
			return filepath.Clean(target)
		}
		if cwd := currentWorkingDir(); cwd != "" {
			return filepath.Clean(filepath.Join(cwd, target))
		}
		return filepath.Clean(target)
	}
	return ""
}

func buildWails3SmokeSingleInstanceStatus() Wails3SmokeGateStatus {
	enabled := envFlagEnabled(envEnableSingleInstanceSpike)
	if enabled {
		return Wails3SmokeGateStatus{
			Enabled: true,
			Status:  ShellCapabilityExperimental,
			Reason:  "Single-instance spike env is enabled; launch args are routed through the open-intent queue.",
		}
	}
	return Wails3SmokeGateStatus{
		Enabled: false,
		Status:  ShellCapabilityRequiresBuild,
		Reason:  "Single-instance routing remains default-off until packaged smoke validates launch/open-file handoff.",
	}
}

func buildWails3SmokeSecondInstanceProbe(
	app *App,
	workingDir string,
	singleInstance Wails3SmokeGateStatus,
) Wails3SmokeSecondInstanceProbe {
	rawArgs := strings.TrimSpace(os.Getenv(envWails3PackagedSmokeSecondArgs))
	if rawArgs == "" {
		return Wails3SmokeSecondInstanceProbe{
			Enabled: singleInstance.Enabled,
			Status:  singleInstance.Status,
			Reason:  "No second-instance launch probe args were configured.",
		}
	}

	probe := Wails3SmokeSecondInstanceProbe{
		Enabled: singleInstance.Enabled,
		Status:  ShellCapabilityRequiresBuild,
		Reason:  "Second-instance launch probe is gated until ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE=1.",
	}
	if singleInstance.Enabled {
		probe.Status = ShellCapabilityExperimental
		probe.Reason = "Second-instance launch args did not produce an allowed open intent."
	}

	args, err := parseWails3SmokeSecondInstanceArgs(rawArgs)
	if err != nil {
		probe.Reason = err.Error()
		return probe
	}
	probe.Args = args

	openIntent, hasOpenIntent := buildOpenIntentFromLaunchArgs(args, workingDir)
	if !hasOpenIntent {
		return probe
	}
	openIntent["source"] = "single-instance"
	probe.OpenIntent = openIntent
	probe.OpenIntentQueued = app == nil || !app.openIntentReady
	if singleInstance.Enabled {
		probe.Reason = "Second-instance launch args normalize into the queued open-intent contract."
	}
	return probe
}

func parseWails3SmokeSecondInstanceArgs(rawArgs string) ([]string, error) {
	var args []string
	if err := json.Unmarshal([]byte(rawArgs), &args); err != nil {
		return nil, fmt.Errorf("second-instance probe args must be a JSON string array: %w", err)
	}
	cleaned := normalizeSmokeLaunchArgs(args)
	if len(cleaned) == 0 {
		return nil, fmt.Errorf("second-instance probe args are empty")
	}
	return cleaned, nil
}

func buildWails3SmokeNativeDeliveryProbe(
	app *App,
	packagedOS PackagedOSIntegrationSnapshot,
	background BackgroundShellStatusSnapshot,
) Wails3SmokeNativeDeliveryProbe {
	trayAdapter := packagedOS.Adapters["tray"]
	notificationAdapter := packagedOS.Adapters["notifications"]
	dockAdapter := packagedOS.Adapters["dockBadges"]

	lastError := ""
	if app != nil && app.packagedOSNative != nil {
		lastError = app.packagedOSNative.LastError()
	}

	probe := Wails3SmokeNativeDeliveryProbe{
		Enabled: trayAdapter.Enabled || notificationAdapter.Enabled || dockAdapter.Enabled,
		Status:  ShellCapabilityRequiresBuild,
		TrackedFailureStates: []string{
			"startup-failed",
			"no-permission",
			"delivery-failed",
			"action-rejected",
		},
		LastError: lastError,
		Tray: Wails3SmokeNativeAdapterProbe{
			Enabled:   trayAdapter.Enabled,
			Status:    trayAdapter.Status,
			ActionIDs: backgroundActionIDs(background.Actions),
			Reason:    trayAdapter.Reason,
		},
		Notifications: Wails3SmokeNativeAdapterProbe{
			Enabled:      notificationAdapter.Enabled,
			Status:       notificationAdapter.Status,
			CandidateIDs: backgroundNotificationCandidateIDs(background.NotificationCandidates),
			Reason:       notificationAdapter.Reason,
		},
		DockBadge: Wails3SmokeNativeDockBadgeProbe{
			Enabled: dockAdapter.Enabled,
			Status:  dockAdapter.Status,
			Label:   packagedOSNativeDockBadgeLabel(background),
			Reason:  dockAdapter.Reason,
		},
		Reason: "Native delivery remains default-off; packaged smoke can enable tray, notifications, and dock badges with explicit env flags.",
	}
	if probe.Enabled {
		probe.Status = ShellCapabilityExperimental
		probe.Reason = "Native delivery adapters are enabled by packaged smoke flags and projected from Background Shell status."
	}
	if lastError != "" {
		probe.Status = ShellCapabilityUnavailable
	}
	return probe
}

func backgroundActionIDs(actions []BackgroundShellAction) []string {
	ids := make([]string, 0, len(actions))
	for _, action := range actions {
		if id := strings.TrimSpace(action.ID); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func backgroundNotificationCandidateIDs(candidates []BackgroundShellNotificationCandidate) []string {
	ids := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if id := strings.TrimSpace(candidate.ID); id != "" {
			ids = append(ids, id)
		}
	}
	return ids
}

func buildWails3SmokeAutoUpdateProbe(
	packagedOS PackagedOSIntegrationSnapshot,
) Wails3SmokeAutoUpdateProbe {
	manifestPath := strings.TrimSpace(os.Getenv(packagedOSAutoUpdateManifestEnv))
	adapter := packagedOS.Adapters["autoUpdate"]
	manifestStatus := "no-manifest"
	if manifestPath != "" {
		manifestStatus = "invalid-manifest"
	}
	if packagedOS.AutoUpdateManifest != nil {
		manifestStatus = "valid-manifest-read"
	}
	return Wails3SmokeAutoUpdateProbe{
		ManifestPath:   manifestPath,
		ManifestStatus: manifestStatus,
		InstallEnabled: false,
		Manifest:       packagedOS.AutoUpdateManifest,
		Status:         adapter.Status,
		Reason:         adapter.Reason,
	}
}

func buildWails3SmokeWindowLeaseSnapshot(app *App) Wails3SmokeWindowLeaseSnapshot {
	spikeEnabled := envFlagEnabled(envEnableWindowLeaseSpike)
	if app != nil && app.windowLeases != nil {
		snapshot := app.windowLeases.Snapshot(spikeEnabled)
		activeLeases := make([]string, 0, len(snapshot.Leases))
		for _, lease := range snapshot.Leases {
			if lease.Status == WindowLeaseStatusDetached {
				activeLeases = append(activeLeases, lease.SurfaceID)
			}
		}
		return Wails3SmokeWindowLeaseSnapshot{
			Available:    snapshot.DetachedAvailable,
			SpikeEnv:     snapshot.SpikeEnabled,
			ActiveLeases: activeLeases,
			Reason:       snapshot.Reason,
		}
	}
	return Wails3SmokeWindowLeaseSnapshot{
		Available:    spikeEnabled,
		SpikeEnv:     spikeEnabled,
		ActiveLeases: []string{},
		Reason:       emptyWindowLeaseSnapshot(spikeEnabled).Reason,
	}
}

func buildWails3SmokeAppBundleSnapshot() Wails3SmokeAppBundleSnapshot {
	launchMode := strings.TrimSpace(os.Getenv(envWails3PackagedSmokeLaunchMode))
	if launchMode == "" {
		return Wails3SmokeAppBundleSnapshot{
			LaunchMode: "raw-binary",
			Status:     ShellCapabilityRequiresBuild,
			Reason:     "Smoke report was generated from a raw binary, not a packaged .app bundle.",
		}
	}

	bundlePath := strings.TrimSpace(os.Getenv(envWails3PackagedSmokeAppBundle))
	if bundlePath != "" {
		if filepath.IsAbs(bundlePath) {
			bundlePath = filepath.Clean(bundlePath)
		} else if cwd := currentWorkingDir(); cwd != "" {
			bundlePath = filepath.Clean(filepath.Join(cwd, bundlePath))
		} else {
			bundlePath = filepath.Clean(bundlePath)
		}
	}

	status := ShellCapabilityAvailable
	reason := "Smoke report was generated through a packaged .app bundle harness."
	if launchMode != "packaged-app" || bundlePath == "" {
		status = ShellCapabilityRequiresBuild
		reason = "Packaged .app launch metadata is incomplete."
	}

	return Wails3SmokeAppBundleSnapshot{
		LaunchMode:           launchMode,
		Path:                 bundlePath,
		BundleID:             strings.TrimSpace(os.Getenv(envWails3PackagedSmokeBundleID)),
		RegisteredOSHandlers: envFlagEnabled(envWails3PackagedSmokeOSHandlers),
		Status:               status,
		Reason:               reason,
	}
}

func buildWails3PackagedSmokeChecks(
	shell ShellCapabilitiesSnapshot,
	packaged PackagedOSIntegrationSnapshot,
	background BackgroundShellStatusSnapshot,
	nativeDelivery Wails3SmokeNativeDeliveryProbe,
	autoUpdate Wails3SmokeAutoUpdateProbe,
	singleInstance Wails3SmokeGateStatus,
	secondInstance Wails3SmokeSecondInstanceProbe,
	windowLease Wails3SmokeWindowLeaseSnapshot,
	appBundle Wails3SmokeAppBundleSnapshot,
	hasOpenIntent bool,
) []Wails3SmokeCheck {
	checks := []Wails3SmokeCheck{
		{
			ID:      "shell-capabilities",
			Status:  ShellCapabilityAvailable,
			Passed:  len(shell.Capabilities) > 0 && shell.Runtime == "wails-v3",
			Message: "Shell capabilities snapshot is present.",
		},
		{
			ID:      "packaged-os-adapters",
			Status:  ShellCapabilityAvailable,
			Passed:  len(packaged.Adapters) > 0 && packaged.Runtime == "wails-v3",
			Message: "Packaged OS adapter snapshot is present.",
		},
		{
			ID:      "background-shell",
			Status:  ShellCapabilityAvailable,
			Passed:  background.Version == backgroundShellStatusVersion,
			Message: "Background Shell status snapshot is present.",
		},
		{
			ID:      "native-delivery-gate",
			Status:  nativeDelivery.Status,
			Passed:  nativeDelivery.Enabled,
			Message: nativeDelivery.Reason,
		},
		{
			ID:      "auto-update-manifest-gate",
			Status:  autoUpdate.Status,
			Passed:  autoUpdate.ManifestStatus == "valid-manifest-read" && !autoUpdate.InstallEnabled,
			Message: autoUpdate.Reason,
		},
		{
			ID:      "single-instance-gate",
			Status:  singleInstance.Status,
			Passed:  singleInstance.Enabled,
			Message: singleInstance.Reason,
		},
		{
			ID:      "single-instance-second-launch",
			Status:  secondInstance.Status,
			Passed:  secondInstance.Enabled && secondInstance.OpenIntent != nil && secondInstance.OpenIntentQueued,
			Message: secondInstance.Reason,
		},
		{
			ID:      "open-intent-probe",
			Status:  ShellCapabilityExperimental,
			Passed:  hasOpenIntent,
			Message: "Launch args normalize into an open intent when a supported target is provided.",
		},
		{
			ID:      "window-lease",
			Status:  ShellCapabilityExperimental,
			Passed:  windowLease.Available,
			Message: windowLease.Reason,
		},
	}
	if appBundle.LaunchMode == "packaged-app" {
		checks = append(checks, Wails3SmokeCheck{
			ID:      "packaged-app-bundle",
			Status:  appBundle.Status,
			Passed:  appBundle.Status == ShellCapabilityAvailable,
			Message: appBundle.Reason,
		})
	}
	return checks
}
