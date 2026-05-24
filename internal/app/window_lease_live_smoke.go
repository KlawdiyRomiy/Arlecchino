package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	wails3WindowLeaseLiveSmokeVersion   = 1
	envWails3WindowLeaseLiveSmokeReport = "ARLECCHINO_WAILS3_WINDOW_LEASE_SMOKE_REPORT"
	envWails3WindowLeaseLiveSmokeQuit   = "ARLECCHINO_WAILS3_WINDOW_LEASE_SMOKE_QUIT"
)

type Wails3WindowLeaseLiveSmokeReport struct {
	Version      int                          `json:"version"`
	Runtime      string                       `json:"runtime"`
	Platform     string                       `json:"platform"`
	GeneratedAt  string                       `json:"generatedAt"`
	SpikeEnabled bool                         `json:"spikeEnabled"`
	Before       WindowLeaseSnapshot          `json:"before"`
	DetachProbes []WindowLeaseLiveActionProbe `json:"detachProbes"`
	ReturnProbes []WindowLeaseLiveActionProbe `json:"returnProbes"`
	AfterDetach  WindowLeaseSnapshot          `json:"afterDetach"`
	AfterReturn  WindowLeaseSnapshot          `json:"afterReturn"`
	Checks       []Wails3SmokeCheck           `json:"checks"`
}

type WindowLeaseLiveActionProbe struct {
	SurfaceID      string          `json:"surfaceId"`
	Role           WindowLeaseRole `json:"role"`
	Kind           string          `json:"kind"`
	Handled        bool            `json:"handled"`
	Message        string          `json:"message,omitempty"`
	NativeWindowID string          `json:"nativeWindowId,omitempty"`
	Status         string          `json:"status,omitempty"`
	Error          string          `json:"error,omitempty"`
}

func (a *App) startWindowLeaseLiveSmokeIfConfigured() {
	reportPath := strings.TrimSpace(os.Getenv(envWails3WindowLeaseLiveSmokeReport))
	if a == nil || reportPath == "" {
		return
	}

	go func() {
		time.Sleep(900 * time.Millisecond)
		report := a.runWindowLeaseLiveSmoke()
		_ = writeWindowLeaseLiveSmokeReport(reportPath, report)
		if envFlagEnabled(envWails3WindowLeaseLiveSmokeQuit) && a.wailsApp != nil {
			time.Sleep(250 * time.Millisecond)
			a.wailsApp.Quit()
		}
	}()
}

func (a *App) runWindowLeaseLiveSmoke() Wails3WindowLeaseLiveSmokeReport {
	report := Wails3WindowLeaseLiveSmokeReport{
		Version:      wails3WindowLeaseLiveSmokeVersion,
		Runtime:      "wails-v3",
		Platform:     runtime.GOOS,
		GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		SpikeEnabled: envFlagEnabled(envEnableWindowLeaseSpike),
	}
	if a == nil || a.windowLeases == nil {
		report.Before = emptyWindowLeaseSnapshot(report.SpikeEnabled)
		report.AfterDetach = report.Before
		report.AfterReturn = report.Before
		report.Checks = buildWindowLeaseLiveSmokeChecks(report)
		return report
	}

	report.Before = a.GetWindowLeaseStatus()
	payloads := windowLeaseLiveSmokePayloads()
	for _, payload := range payloads {
		report.DetachProbes = append(report.DetachProbes, a.runWindowLeaseLiveProbe("detach", payload))
	}
	report.AfterDetach = a.GetWindowLeaseStatus()

	for _, payload := range payloads {
		probe := a.runWindowLeaseLiveProbe("close-window", payload)
		a.handleDetachedWindowClosing(payload.SurfaceID)
		if record, ok := a.GetWindowLeaseStatus().LeasesBySurfaceID[payload.SurfaceID]; ok {
			probe.Status = string(record.Status)
		}
		report.ReturnProbes = append(report.ReturnProbes, probe)
	}
	report.AfterReturn = a.GetWindowLeaseStatus()
	report.Checks = buildWindowLeaseLiveSmokeChecks(report)
	return report
}

func (a *App) runWindowLeaseLiveProbe(kind string, payload WindowLeaseActionPayload) WindowLeaseLiveActionProbe {
	probe := WindowLeaseLiveActionProbe{
		SurfaceID: payload.SurfaceID,
		Role:      payload.Role,
		Kind:      kind,
	}
	actionID, err := BuildWindowLeaseActionID(kind, payload)
	if err != nil {
		probe.Error = err.Error()
		return probe
	}
	result, err := a.RunWindowLeaseAction(actionID)
	if err != nil {
		probe.Error = err.Error()
		return probe
	}
	probe.Handled = result.Handled
	probe.Message = result.Message
	if result.Record != nil {
		probe.NativeWindowID = result.Record.NativeWindowID
		probe.Status = string(result.Record.Status)
		return probe
	}
	if record, ok := result.Snapshot.LeasesBySurfaceID[payload.SurfaceID]; ok {
		probe.NativeWindowID = record.NativeWindowID
		probe.Status = string(record.Status)
	}
	return probe
}

func windowLeaseLiveSmokePayloads() []WindowLeaseActionPayload {
	return []WindowLeaseActionPayload{
		{
			SurfaceID:       "preview:window-lease-smoke-browser",
			PreviewWindowID: "window-lease-smoke-browser",
			Role:            WindowLeaseRolePreview,
			AppletKind:      "browser",
			Title:           "Window Lease Smoke Preview",
			URL:             "https://example.test/window-lease",
			Pinned:          true,
			ReturnTarget:    WindowLeaseReturnTarget{HostMode: "snapped", Position: "right"},
			Payload:         map[string]any{"url": "https://example.test/window-lease"},
		},
		{
			SurfaceID:    "panel:git",
			Role:         WindowLeaseRoleGitHelper,
			AppletKind:   "git",
			Title:        "Git",
			ReturnTarget: WindowLeaseReturnTarget{HostMode: "snapped", Position: "left"},
			Payload:      map[string]any{"projectPath": currentWorkingDir()},
		},
		{
			SurfaceID:    "panel:problems",
			Role:         WindowLeaseRoleProblemsHelper,
			AppletKind:   "problems",
			Title:        "Problems",
			ReturnTarget: WindowLeaseReturnTarget{HostMode: "snapped", Position: "bottom"},
			Payload:      map[string]any{"projectPath": currentWorkingDir(), "activeFilePath": filepath.Join(currentWorkingDir(), "main.go")},
		},
		{
			SurfaceID:    "panel:terminal",
			Role:         WindowLeaseRoleTerminalHelper,
			AppletKind:   "terminal",
			Title:        "Terminal",
			ReturnTarget: WindowLeaseReturnTarget{HostMode: "floating", Position: "bottom"},
			Payload:      map[string]any{"projectPath": currentWorkingDir()},
		},
	}
}

func buildWindowLeaseLiveSmokeChecks(report Wails3WindowLeaseLiveSmokeReport) []Wails3SmokeCheck {
	checks := []Wails3SmokeCheck{
		{ID: "window-lease-spike-enabled", Status: ShellCapabilityExperimental, Passed: report.SpikeEnabled, Message: "ARLECCHINO_ENABLE_WINDOW_LEASE_SPIKE=1 is required."},
		{ID: "window-lease-detach-all", Status: ShellCapabilityExperimental, Passed: len(report.DetachProbes) == 4 && allWindowLeaseProbesHandled(report.DetachProbes), Message: "Preview, Git, Problems and Terminal helpers must detach."},
		{ID: "window-lease-native-ids", Status: ShellCapabilityExperimental, Passed: allWindowLeaseProbesHaveNativeIDs(report.DetachProbes), Message: "Every detached helper must receive a native window id."},
		{ID: "window-lease-return-all", Status: ShellCapabilityExperimental, Passed: len(report.ReturnProbes) == 4 && allWindowLeaseProbesHandled(report.ReturnProbes), Message: "Every detached helper must accept close/return."},
		{ID: "window-lease-after-return-attached", Status: ShellCapabilityExperimental, Passed: noWindowLeaseDetachedRecords(report.AfterReturn), Message: "All leases should return to attached after close/return."},
	}
	return checks
}

func allWindowLeaseProbesHandled(probes []WindowLeaseLiveActionProbe) bool {
	for _, probe := range probes {
		if !probe.Handled || probe.Error != "" {
			return false
		}
	}
	return len(probes) > 0
}

func allWindowLeaseProbesHaveNativeIDs(probes []WindowLeaseLiveActionProbe) bool {
	for _, probe := range probes {
		if strings.TrimSpace(probe.NativeWindowID) == "" {
			return false
		}
	}
	return len(probes) > 0
}

func noWindowLeaseDetachedRecords(snapshot WindowLeaseSnapshot) bool {
	for _, lease := range snapshot.Leases {
		if lease.Status == WindowLeaseStatusDetached {
			return false
		}
	}
	return true
}

func writeWindowLeaseLiveSmokeReport(path string, report Wails3WindowLeaseLiveSmokeReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
