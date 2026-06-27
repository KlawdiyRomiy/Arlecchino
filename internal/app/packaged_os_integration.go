package app

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
)

const packagedOSIntegrationVersion = 1

const (
	packagedOSSpikeEnv                = "ARLECCHINO_ENABLE_PACKAGED_OS_SPIKE"
	packagedOSPackagedBuildEnv        = "ARLECCHINO_PACKAGED_BUILD"
	packagedOSNativeTrayEnv           = "ARLECCHINO_ENABLE_NATIVE_TRAY"
	packagedOSNativeNotificationsEnv  = "ARLECCHINO_ENABLE_NATIVE_NOTIFICATIONS"
	packagedOSDisableNotificationsEnv = "ARLECCHINO_DISABLE_NATIVE_NOTIFICATIONS"
	packagedOSDockBadgesEnv           = "ARLECCHINO_ENABLE_DOCK_BADGES"
	packagedOSDisableDockBadgesEnv    = "ARLECCHINO_DISABLE_DOCK_BADGES"
	packagedOSAutoUpdateManifestEnv   = "ARLECCHINO_AUTO_UPDATE_MANIFEST"
	autoUpdateManifestURLEnv          = "ARLECCHINO_AUTO_UPDATE_MANIFEST_URL"
	packagedOSAutoUpdateChannelEnv    = "ARLECCHINO_AUTO_UPDATE_CHANNEL"
	packagedOSAutoUpdatePublicKeyEnv  = "ARLECCHINO_AUTO_UPDATE_PUBLIC_KEY"
	packagedOSAutoUpdateApplyEnv      = "ARLECCHINO_ENABLE_AUTO_UPDATE_APPLY_SMOKE"
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
	Channel      string                         `json:"channel,omitempty"`
	Version      string                         `json:"version,omitempty"`
	Build        string                         `json:"build,omitempty"`
	Sequence     int64                          `json:"sequence,omitempty"`
	Artifacts    []PackagedOSAutoUpdateArtifact `json:"artifacts,omitempty"`
	ReleaseNotes string                         `json:"releaseNotes,omitempty"`
	Mandatory    bool                           `json:"mandatory,omitempty"`
	URL          string                         `json:"url,omitempty"`
	SHA256       string                         `json:"sha256,omitempty"`
	Signature    string                         `json:"signature,omitempty"`
	Notes        string                         `json:"notes,omitempty"`
	Metadata     map[string]json.RawMessage     `json:"metadata,omitempty"`
}

type PackagedOSAutoUpdateArtifact struct {
	Platform  string `json:"platform,omitempty"`
	Arch      string `json:"arch,omitempty"`
	URL       string `json:"url,omitempty"`
	SHA256    string `json:"sha256,omitempty"`
	Signature string `json:"signature,omitempty"`
	Size      int64  `json:"size,omitempty"`
	Kind      string `json:"kind,omitempty"`
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
	packagedBuild := envFlag(packagedOSPackagedBuildEnv)
	return PackagedOSIntegrationOptions{
		PackagedBuild:              packagedBuild,
		SpikeEnabled:               envFlag(packagedOSSpikeEnv),
		NativeTrayEnabled:          envFlag(packagedOSNativeTrayEnv),
		NativeNotificationsEnabled: (packagedBuild || envFlag(packagedOSNativeNotificationsEnv)) && !envFlag(packagedOSDisableNotificationsEnv),
		DockBadgesEnabled:          (packagedBuild || envFlag(packagedOSDockBadgesEnv)) && !envFlag(packagedOSDisableDockBadgesEnv),
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
	notificationsEnabled := options.PackagedBuild && options.NativeNotificationsEnabled
	dockBadgesEnabled := options.PackagedBuild && options.DockBadgesEnabled

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
	notificationReason := "Notification adapter is prepared; native delivery requires a packaged macOS app."
	if options.PackagedBuild {
		notificationStatus = ShellCapabilityExperimental
		notificationReason = "Notification adapter consumes centralized Background Shell notification candidates in packaged macOS builds."
	}
	if notificationsEnabled {
		notificationStatus = ShellCapabilityAvailable
		notificationReason = "Native notification delivery is enabled for packaged macOS builds."
	}

	dockBadgeStatus := ShellCapabilityPlatformLimited
	dockBadgeReason := "Dock/taskbar badge adapter is prepared; native badges require a packaged macOS app."
	if options.PackagedBuild {
		dockBadgeStatus = ShellCapabilityExperimental
		dockBadgeReason = "Dock/taskbar badge adapter mirrors Background Shell attention counts in packaged macOS builds."
	}
	if dockBadgesEnabled {
		dockBadgeStatus = ShellCapabilityAvailable
		dockBadgeReason = "Dock/taskbar badge delivery is enabled for packaged macOS builds."
	}

	autoUpdateStatus := ShellCapabilityExperimental
	autoUpdateReason := "Auto-update runtime can verify signed ZIP artifacts and stage user-confirmed relaunch installs."
	if options.AutoUpdateManifest != nil {
		autoUpdateReason = "Auto-update manifest was read and can be verified by the runtime updater."
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
				Enabled:               true,
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
	manifest = normalizeAutoUpdateManifest(manifest)
	if reason := validateAutoUpdateManifest(manifest); reason != "" {
		return nil, reason
	}

	return &manifest, "Auto-update manifest was read and schema-validated; update install/apply remains gated."
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
