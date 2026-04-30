package main

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
)

const packagedOSIntegrationVersion = 1

const (
	packagedOSSpikeEnv               = "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE"
	packagedOSPackagedBuildEnv       = "ARLECCHINO_PACKAGED_BUILD"
	packagedOSNativeTrayEnv          = "ARLECCHINO_ENABLE_NATIVE_TRAY"
	packagedOSNativeNotificationsEnv = "ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS"
	packagedOSDockBadgesEnv          = "ARLECCHINO_ENABLE_DOCK_BADGES"
	packagedOSAutoUpdateManifestEnv  = "ARLECCHINO_AUTO_UPDATE_MANIFEST"
)

type PackagedOSAdapter struct {
	ID                         string                `json:"id"`
	Label                      string                `json:"label"`
	Capability                 string                `json:"capability"`
	Status                     ShellCapabilityStatus `json:"status"`
	Enabled                    bool                  `json:"enabled"`
	DefaultEnabled             bool                  `json:"defaultEnabled"`
	RequiresPackagedBuild      bool                  `json:"requiresPackagedBuild"`
	Reason                     string                `json:"reason"`
	BackgroundActionCount      int                   `json:"backgroundActionCount,omitempty"`
	NotificationCandidateCount int                   `json:"notificationCandidateCount,omitempty"`
}

type PackagedOSAutoUpdateManifest struct {
	Channel   string `json:"channel,omitempty"`
	Version   string `json:"version,omitempty"`
	URL       string `json:"url,omitempty"`
	Signature string `json:"signature,omitempty"`
	Notes     string `json:"notes,omitempty"`
}

type PackagedOSIntegrationSnapshot struct {
	Version                 int                                    `json:"version"`
	Platform                string                                 `json:"platform"`
	Runtime                 string                                 `json:"runtime"`
	PackagedBuild           bool                                   `json:"packagedBuild"`
	SpikeEnabled            bool                                   `json:"spikeEnabled"`
	NativeTrayEnabled       bool                                   `json:"nativeTrayEnabled"`
	NativeNotificationsSent bool                                   `json:"nativeNotificationsSent"`
	Adapters                map[string]PackagedOSAdapter           `json:"adapters"`
	BackgroundActions       []BackgroundShellAction                `json:"backgroundActions"`
	NotificationCandidates  []BackgroundShellNotificationCandidate `json:"notificationCandidates"`
	AutoUpdateManifest      *PackagedOSAutoUpdateManifest          `json:"autoUpdateManifest,omitempty"`
}

type PackagedOSIntegrationOptions struct {
	PackagedBuild              bool
	SpikeEnabled               bool
	NativeTrayEnabled          bool
	NativeNotificationsEnabled bool
	DockBadgesEnabled          bool
	AutoUpdateManifest         *PackagedOSAutoUpdateManifest
	AutoUpdateManifestReason   string
}

type PackagedOSActionResult struct {
	Handled          bool                         `json:"handled"`
	AdapterID        string                       `json:"adapterId"`
	BackgroundAction *BackgroundShellAction       `json:"backgroundAction,omitempty"`
	BackgroundResult *BackgroundShellActionResult `json:"backgroundResult,omitempty"`
	Message          string                       `json:"message,omitempty"`
}

func envFlag(name string) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	return value == "1" || value == "true" || value == "yes" || value == "on"
}

func defaultPackagedOSIntegrationOptions() PackagedOSIntegrationOptions {
	manifest, manifestReason := readAutoUpdateManifest(os.Getenv(packagedOSAutoUpdateManifestEnv))
	return PackagedOSIntegrationOptions{
		PackagedBuild:              envFlag(packagedOSPackagedBuildEnv),
		SpikeEnabled:               envFlag(packagedOSSpikeEnv),
		NativeTrayEnabled:          envFlag(packagedOSNativeTrayEnv),
		NativeNotificationsEnabled: envFlag(packagedOSNativeNotificationsEnv),
		DockBadgesEnabled:          envFlag(packagedOSDockBadgesEnv),
		AutoUpdateManifest:         manifest,
		AutoUpdateManifestReason:   manifestReason,
	}
}

func buildPackagedOSIntegrationSnapshot(
	platform string,
	background BackgroundShellStatusSnapshot,
	options PackagedOSIntegrationOptions,
) PackagedOSIntegrationSnapshot {
	packagedSpikeReady := options.PackagedBuild && options.SpikeEnabled
	trayEnabled := packagedSpikeReady && options.NativeTrayEnabled
	notificationsEnabled := packagedSpikeReady && options.NativeNotificationsEnabled
	dockBadgesEnabled := packagedSpikeReady && options.DockBadgesEnabled

	trayStatus := ShellCapabilityUnavailable
	trayReason := "Tray adapter is prepared, but native tray remains off until packaged smoke enables it."
	if packagedSpikeReady {
		trayStatus = ShellCapabilityExperimental
		trayReason = "Tray adapter can consume Background Shell actions in packaged spike mode."
	}
	if trayEnabled {
		trayStatus = ShellCapabilityAvailable
		trayReason = "Native tray delivery is enabled by packaged OS spike flags."
	}

	notificationStatus := ShellCapabilityUnavailable
	notificationReason := "Notification adapter is prepared, but native delivery remains off until packaged smoke enables it."
	if packagedSpikeReady {
		notificationStatus = ShellCapabilityExperimental
		notificationReason = "Notification adapter can consume Background Shell notification candidates in packaged spike mode."
	}
	if notificationsEnabled {
		notificationStatus = ShellCapabilityAvailable
		notificationReason = "Native notification delivery is enabled by packaged OS spike flags."
	}

	dockBadgeStatus := ShellCapabilityPlatformLimited
	dockBadgeReason := "Dock/taskbar badge adapter is prepared, but native badges remain off until packaged smoke enables them."
	if packagedSpikeReady {
		dockBadgeStatus = ShellCapabilityExperimental
		dockBadgeReason = "Dock/taskbar badge adapter can mirror Background Shell attention counts in packaged spike mode."
	}
	if dockBadgesEnabled {
		dockBadgeStatus = ShellCapabilityAvailable
		dockBadgeReason = "Dock/taskbar badge delivery is enabled by packaged OS spike flags."
	}

	autoUpdateStatus := ShellCapabilityUnavailable
	autoUpdateReason := "Auto-update remains disabled; manifest reading is available only as a placeholder."
	if options.AutoUpdateManifest != nil {
		autoUpdateStatus = ShellCapabilityExperimental
		autoUpdateReason = "Auto-update manifest was read, but update installation remains disabled."
	} else if strings.TrimSpace(options.AutoUpdateManifestReason) != "" {
		autoUpdateReason = options.AutoUpdateManifestReason
	}

	return PackagedOSIntegrationSnapshot{
		Version:                 packagedOSIntegrationVersion,
		Platform:                platform,
		Runtime:                 "wails-v3",
		PackagedBuild:           options.PackagedBuild,
		SpikeEnabled:            options.SpikeEnabled,
		NativeTrayEnabled:       trayEnabled || background.NativeTrayEnabled,
		NativeNotificationsSent: background.NativeNotificationsSent,
		BackgroundActions:       append([]BackgroundShellAction(nil), background.Actions...),
		NotificationCandidates:  append([]BackgroundShellNotificationCandidate(nil), background.NotificationCandidates...),
		AutoUpdateManifest:      options.AutoUpdateManifest,
		Adapters: map[string]PackagedOSAdapter{
			"customProtocol": {
				ID:                    "customProtocol",
				Label:                 "Custom URL Protocol",
				Capability:            "customProtocol",
				Status:                ShellCapabilityRequiresBuild,
				RequiresPackagedBuild: true,
				Reason:                "arlecchino:// payloads normalize through the strict open-intent allowlist, but OS registration still requires packaged smoke.",
			},
			"fileAssociations": {
				ID:                    "fileAssociations",
				Label:                 "File Associations",
				Capability:            "fileAssociations",
				Status:                ShellCapabilityRequiresBuild,
				RequiresPackagedBuild: true,
				Reason:                "File paths and file:// payloads normalize into open-file/open-project intents, but OS association remains requires-build.",
			},
			"tray": {
				ID:                    "tray",
				Label:                 "Tray",
				Capability:            "tray",
				Status:                trayStatus,
				Enabled:               trayEnabled,
				RequiresPackagedBuild: true,
				Reason:                trayReason,
				BackgroundActionCount: len(background.Actions),
			},
			"notifications": {
				ID:                         "notifications",
				Label:                      "Notifications",
				Capability:                 "notifications",
				Status:                     notificationStatus,
				Enabled:                    notificationsEnabled,
				RequiresPackagedBuild:      true,
				Reason:                     notificationReason,
				NotificationCandidateCount: len(background.NotificationCandidates),
			},
			"dockBadges": {
				ID:                    "dockBadges",
				Label:                 "Dock/Taskbar Badges",
				Capability:            "dockBadges",
				Status:                dockBadgeStatus,
				Enabled:               dockBadgesEnabled,
				RequiresPackagedBuild: true,
				Reason:                dockBadgeReason,
			},
			"autoUpdate": {
				ID:                    "autoUpdate",
				Label:                 "Auto Update",
				Capability:            "autoUpdate",
				Status:                autoUpdateStatus,
				Enabled:               false,
				RequiresPackagedBuild: true,
				Reason:                autoUpdateReason,
			},
		},
	}
}

func readAutoUpdateManifest(path string) (*PackagedOSAutoUpdateManifest, string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, "Auto-update remains disabled; no manifest path is configured."
	}

	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Sprintf("Auto-update manifest is unavailable: %v", err)
	}
	if info.Size() > 1024*1024 {
		return nil, "Auto-update manifest is too large."
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Sprintf("Auto-update manifest could not be read: %v", err)
	}

	var manifest PackagedOSAutoUpdateManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Sprintf("Auto-update manifest is invalid JSON: %v", err)
	}
	manifest.Channel = strings.TrimSpace(manifest.Channel)
	manifest.Version = strings.TrimSpace(manifest.Version)
	manifest.URL = strings.TrimSpace(manifest.URL)
	manifest.Signature = strings.TrimSpace(manifest.Signature)
	manifest.Notes = strings.TrimSpace(manifest.Notes)
	if manifest.Channel == "" && manifest.Version == "" && manifest.URL == "" {
		return nil, "Auto-update manifest has no channel, version, or URL."
	}

	return &manifest, "Auto-update manifest was read; update installation remains disabled."
}

func (a *App) GetPackagedOSIntegrationStatus() PackagedOSIntegrationSnapshot {
	background := emptyBackgroundShellStatusSnapshot()
	if a != nil {
		background = a.GetBackgroundShellStatus()
	}
	return buildPackagedOSIntegrationSnapshot(
		runtime.GOOS,
		background,
		defaultPackagedOSIntegrationOptions(),
	)
}

func (a *App) RunPackagedOSIntegrationAction(actionID string) (PackagedOSActionResult, error) {
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		return PackagedOSActionResult{}, fmt.Errorf("packaged OS action id is empty")
	}

	backgroundActionID := strings.TrimPrefix(actionID, "background:")
	if backgroundActionID == actionID {
		return PackagedOSActionResult{}, fmt.Errorf("unsupported packaged OS action: %s", actionID)
	}

	backgroundResult, err := a.RunBackgroundShellAction(backgroundActionID)
	result := PackagedOSActionResult{
		Handled:          err == nil && backgroundResult.Handled,
		AdapterID:        "background-shell",
		BackgroundResult: &backgroundResult,
		Message:          "Background Shell action routed from packaged OS adapter.",
	}
	if backgroundResult.Action.ID != "" {
		action := backgroundResult.Action
		result.BackgroundAction = &action
	}
	if err != nil {
		return result, err
	}
	return result, nil
}
