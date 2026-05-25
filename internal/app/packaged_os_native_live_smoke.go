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
	wails3NativeDeliveryLiveSmokeVersion   = 1
	envWails3NativeDeliveryLiveSmokeReport = "ARLECCHINO_WAILS3_NATIVE_DELIVERY_SMOKE_REPORT"
	envWails3NativeDeliveryLiveSmokeQuit   = "ARLECCHINO_WAILS3_NATIVE_DELIVERY_SMOKE_QUIT"
)

type Wails3NativeDeliveryLiveSmokeReport struct {
	Version         int                                 `json:"version"`
	Runtime         string                              `json:"runtime"`
	Platform        string                              `json:"platform"`
	GeneratedAt     string                              `json:"generatedAt"`
	PackagedBuild   bool                                `json:"packagedBuild"`
	SpikeEnabled    bool                                `json:"spikeEnabled"`
	BackgroundShell BackgroundShellStatusSnapshot       `json:"backgroundShell"`
	NativeDelivery  PackagedOSNativeDeliveryLiveStatus  `json:"nativeDelivery"`
	ActionProbe     PackagedOSNativeDeliveryActionProbe `json:"actionProbe"`
	Checks          []Wails3SmokeCheck                  `json:"checks"`
}

type PackagedOSNativeDeliveryLiveStatus struct {
	Enabled                         bool     `json:"enabled"`
	DeliveryAttempted               bool     `json:"deliveryAttempted"`
	TrayEnabled                     bool     `json:"trayEnabled"`
	TrayReady                       bool     `json:"trayReady"`
	TrayActionIDs                   []string `json:"trayActionIds,omitempty"`
	NotificationsEnabled            bool     `json:"notificationsEnabled"`
	NotificationStartupAttempted    bool     `json:"notificationStartupAttempted"`
	NotificationReady               bool     `json:"notificationReady"`
	NotificationPermissionRequested bool     `json:"notificationPermissionRequested"`
	NotificationPermissionStatus    string   `json:"notificationPermissionStatus,omitempty"`
	NotificationCandidateCount      int      `json:"notificationCandidateCount"`
	NotificationDeliveryAttempted   bool     `json:"notificationDeliveryAttempted"`
	NotificationDeliveryResult      string   `json:"notificationDeliveryResult,omitempty"`
	SentNotificationCount           int      `json:"sentNotificationCount"`
	NotificationDedupeSuppressed    bool     `json:"notificationDedupeSuppressed"`
	DockBadgeEnabled                bool     `json:"dockBadgeEnabled"`
	DockStartupAttempted            bool     `json:"dockStartupAttempted"`
	DockReady                       bool     `json:"dockReady"`
	DockBadgeLabel                  string   `json:"dockBadgeLabel"`
	FailureStates                   []string `json:"failureStates,omitempty"`
	LastError                       string   `json:"lastError,omitempty"`
}

type PackagedOSNativeDeliveryActionProbe struct {
	Accepted        bool   `json:"accepted"`
	AcceptedAction  string `json:"acceptedAction,omitempty"`
	Rejected        bool   `json:"rejected"`
	RejectedAction  string `json:"rejectedAction,omitempty"`
	RejectedMessage string `json:"rejectedMessage,omitempty"`
}

func (a *App) startPackagedOSNativeLiveSmokeIfConfigured() {
	reportPath := strings.TrimSpace(os.Getenv(envWails3NativeDeliveryLiveSmokeReport))
	if a == nil || reportPath == "" {
		return
	}

	go func() {
		time.Sleep(750 * time.Millisecond)
		report := a.runPackagedOSNativeLiveSmoke()
		_ = writePackagedOSNativeLiveSmokeReport(reportPath, report)
		if envFlagEnabled(envWails3NativeDeliveryLiveSmokeQuit) && a.wailsApp != nil {
			time.Sleep(250 * time.Millisecond)
			a.wailsApp.Quit()
		}
	}()
}

func (a *App) runPackagedOSNativeLiveSmoke() Wails3NativeDeliveryLiveSmokeReport {
	options := defaultPackagedOSIntegrationOptions()
	report := Wails3NativeDeliveryLiveSmokeReport{
		Version:       wails3NativeDeliveryLiveSmokeVersion,
		Runtime:       "wails-v3",
		Platform:      runtime.GOOS,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		PackagedBuild: options.PackagedBuild,
		SpikeEnabled:  options.SpikeEnabled,
	}
	if a == nil || a.backgroundShell == nil {
		report.NativeDelivery = packagedOSNativeDeliveryLiveStatus(nil, options, emptyBackgroundShellStatusSnapshot())
		report.Checks = buildPackagedOSNativeLiveSmokeChecks(report)
		return report
	}

	a.seedPackagedOSNativeLiveSmokeBackground()
	_ = a.applyPackagedOSNativeDelivery(a.backgroundShell.Snapshot())
	second := a.applyPackagedOSNativeDelivery(a.backgroundShell.Snapshot())
	report.BackgroundShell = second
	report.ActionProbe = a.runPackagedOSNativeLiveSmokeActionProbe(second)
	report.NativeDelivery = packagedOSNativeDeliveryLiveStatus(a.packagedOSNative, options, second)
	report.Checks = buildPackagedOSNativeLiveSmokeChecks(report)
	return report
}

func (a *App) seedPackagedOSNativeLiveSmokeBackground() {
	now := time.Now().UnixMilli()
	a.backgroundShell.UpsertJob(BackgroundShellJob{
		ID:             "native-smoke:execution",
		Kind:           "execution",
		Category:       BackgroundShellCategoryJob,
		Title:          "Native smoke command",
		Detail:         "Running native delivery smoke fixture.",
		Status:         BackgroundShellJobRunning,
		Cancelable:     true,
		OwnerSurfaceID: "panel:terminal",
		StartedAt:      now,
		UpdatedAt:      now,
	})
	a.backgroundShell.UpsertJob(BackgroundShellJob{
		ID:              "native-smoke:indexer",
		Kind:            "indexer",
		Category:        BackgroundShellCategoryJob,
		Title:           "Native smoke indexing",
		Detail:          "Indexing failed for native delivery smoke.",
		Status:          BackgroundShellJobFailed,
		NotifyOnFailure: true,
		OwnerSurfaceID:  "panel:problems",
		StartedAt:       now,
		UpdatedAt:       now,
		CompletedAt:     now,
	})
}

func (a *App) runPackagedOSNativeLiveSmokeActionProbe(snapshot BackgroundShellStatusSnapshot) PackagedOSNativeDeliveryActionProbe {
	probe := PackagedOSNativeDeliveryActionProbe{
		RejectedAction: "background:missing-native-smoke-action",
	}
	for _, action := range snapshot.Actions {
		if action.Intent == "cancel-job" && action.Enabled {
			probe.AcceptedAction = "background:" + action.ID
			break
		}
	}
	if probe.AcceptedAction != "" {
		if result, err := a.RunPackagedOSIntegrationAction(probe.AcceptedAction); err == nil && result.Handled {
			probe.Accepted = true
		}
	}
	if _, err := a.RunPackagedOSIntegrationAction(probe.RejectedAction); err != nil {
		probe.Rejected = true
		probe.RejectedMessage = err.Error()
		if a.packagedOSNative != nil {
			a.packagedOSNative.recordFailureState("action-rejected")
		}
	}
	return probe
}

func packagedOSNativeDeliveryLiveStatus(
	delivery *PackagedOSNativeDelivery,
	options PackagedOSIntegrationOptions,
	snapshot BackgroundShellStatusSnapshot,
) PackagedOSNativeDeliveryLiveStatus {
	status := PackagedOSNativeDeliveryLiveStatus{
		Enabled:                    packagedOSNativeDeliveryReady(options),
		TrayEnabled:                packagedOSNativeTrayReady(options),
		NotificationsEnabled:       packagedOSNativeNotificationsReady(options),
		NotificationCandidateCount: len(snapshot.NotificationCandidates),
		DockBadgeEnabled:           packagedOSNativeDockBadgesReady(options),
		DockBadgeLabel:             packagedOSNativeDockBadgeLabel(snapshot),
	}

	if delivery == nil {
		return status
	}

	delivery.mu.Lock()
	sentKeys := make(map[string]int64, len(delivery.sentNotificationKeys))
	for key, sentAt := range delivery.sentNotificationKeys {
		sentKeys[key] = sentAt
	}
	sentNotificationKeyCount := len(sentKeys)
	status.TrayReady = delivery.trayReady
	status.NotificationStartupAttempted = delivery.notificationStartupAttempted
	status.NotificationReady = delivery.notificationReady
	status.NotificationPermissionRequested = delivery.notificationPermissionRequested
	status.NotificationPermissionStatus = delivery.notificationPermissionStatus
	status.NotificationDeliveryAttempted = delivery.notificationDeliveryAttempted
	status.NotificationDeliveryResult = delivery.notificationDeliveryResult
	status.SentNotificationCount = delivery.sentNotificationCount
	status.DockStartupAttempted = delivery.dockStartupAttempted
	status.DockReady = delivery.dockReady
	status.LastError = delivery.lastError
	status.FailureStates = delivery.failureStatesLocked()
	delivery.mu.Unlock()

	model := buildPackagedOSNativeTrayModel(snapshot)
	for _, action := range model.Actions {
		status.TrayActionIDs = append(status.TrayActionIDs, action.ID)
	}
	status.NotificationDedupeSuppressed =
		sentNotificationKeyCount > 0 &&
			len(selectPackagedOSNativeNotificationCandidates(snapshot, sentKeys, time.Now().UnixMilli())) < len(snapshot.NotificationCandidates)
	status.DeliveryAttempted = status.TrayReady || status.NotificationStartupAttempted || status.DockStartupAttempted || status.DockReady
	return status
}

func buildPackagedOSNativeLiveSmokeChecks(report Wails3NativeDeliveryLiveSmokeReport) []Wails3SmokeCheck {
	return []Wails3SmokeCheck{
		{
			ID:      "native-delivery-live-gate",
			Status:  ShellCapabilityExperimental,
			Passed:  report.NativeDelivery.Enabled && report.NativeDelivery.DeliveryAttempted,
			Message: "Packaged app attempted native delivery through explicit smoke env gates.",
		},
		{
			ID:      "native-tray-live",
			Status:  ShellCapabilityExperimental,
			Passed:  !report.NativeDelivery.TrayEnabled || report.NativeDelivery.TrayReady,
			Message: "Tray startup is attempted only when the native tray env gate is enabled.",
		},
		{
			ID:      "native-action-path",
			Status:  ShellCapabilityAvailable,
			Passed:  report.ActionProbe.Accepted && report.ActionProbe.Rejected,
			Message: "Background Shell action routing has accepted and rejected paths.",
		},
		{
			ID:      "native-dock-badge-live",
			Status:  ShellCapabilityExperimental,
			Passed:  !report.NativeDelivery.DockBadgeEnabled || report.NativeDelivery.DockReady,
			Message: "Dock badge startup is attempted only when the dock badge env gate is enabled.",
		},
		{
			ID:      "native-notification-live",
			Status:  ShellCapabilityExperimental,
			Passed:  !report.NativeDelivery.NotificationsEnabled || report.NativeDelivery.NotificationReady || len(report.NativeDelivery.FailureStates) > 0,
			Message: "Notification smoke records permission/startup/delivery failure states when native notification delivery is enabled.",
		},
	}
}

func writePackagedOSNativeLiveSmokeReport(path string, report Wails3NativeDeliveryLiveSmokeReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}
