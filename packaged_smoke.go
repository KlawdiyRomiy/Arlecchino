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
	SingleInstance        Wails3SmokeGateStatus          `json:"singleInstance"`
	WindowLease           Wails3SmokeWindowLeaseSnapshot `json:"windowLease"`
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
	background := emptyBackgroundShellStatusSnapshot()
	if app != nil && app.backgroundShell != nil {
		background = app.backgroundShell.Snapshot()
	}

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
	openIntent, hasOpenIntent := buildOpenIntentFromLaunchArgs(launchArgs, workingDir)
	if hasOpenIntent {
		openIntent["source"] = "packaged-smoke"
	}

	singleInstance := buildWails3SmokeSingleInstanceStatus()
	windowLease := buildWails3SmokeWindowLeaseSnapshot(app)

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
		SingleInstance:        singleInstance,
		WindowLease:           windowLease,
		Checks: buildWails3PackagedSmokeChecks(
			shellCapabilities,
			packagedOS,
			background,
			singleInstance,
			windowLease,
			hasOpenIntent,
		),
	}
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

func buildWails3PackagedSmokeChecks(
	shell ShellCapabilitiesSnapshot,
	packaged PackagedOSIntegrationSnapshot,
	background BackgroundShellStatusSnapshot,
	singleInstance Wails3SmokeGateStatus,
	windowLease Wails3SmokeWindowLeaseSnapshot,
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
			ID:      "single-instance-gate",
			Status:  singleInstance.Status,
			Passed:  singleInstance.Enabled,
			Message: singleInstance.Reason,
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
	return checks
}
