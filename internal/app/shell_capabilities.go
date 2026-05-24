package app

import "runtime"

type ShellCapabilityStatus string

const (
	ShellCapabilityAvailable           ShellCapabilityStatus = "available"
	ShellCapabilityUnavailable         ShellCapabilityStatus = "unavailable"
	ShellCapabilityExperimental        ShellCapabilityStatus = "experimental"
	ShellCapabilityRequiresBuild       ShellCapabilityStatus = "requires-build"
	ShellCapabilityRequiresEntitlement ShellCapabilityStatus = "requires-entitlement"
	ShellCapabilityPlatformLimited     ShellCapabilityStatus = "platform-limited"
)

type ShellCapabilityDescriptor struct {
	Status ShellCapabilityStatus `json:"status"`
	Reason string                `json:"reason"`
	Source string                `json:"source"`
}

type ShellCapabilitiesSnapshot struct {
	Capabilities map[string]ShellCapabilityDescriptor `json:"capabilities"`
	Platform     string                               `json:"platform"`
	Runtime      string                               `json:"runtime"`
	Version      int                                  `json:"version"`
}

const shellCapabilitiesVersion = 1

func shellCapability(status ShellCapabilityStatus, reason string) ShellCapabilityDescriptor {
	return ShellCapabilityDescriptor{
		Status: status,
		Reason: reason,
		Source: "backend",
	}
}

func buildShellCapabilities(platform string, appReady bool, mainWindowReady bool) ShellCapabilitiesSnapshot {
	nativeMenuStatus := ShellCapabilityUnavailable
	nativeMenuReason := "Application menu is unavailable before the Wails app is initialized."
	if appReady {
		nativeMenuStatus = ShellCapabilityAvailable
		nativeMenuReason = "Application menu is configured by the native shell menu layer."
	}

	dialogStatus := ShellCapabilityUnavailable
	dialogReason := "Dialog capability is unavailable before the Wails app is initialized."
	if appReady {
		dialogStatus = ShellCapabilityAvailable
		dialogReason = "Directory/file dialogs are available through the Wails application dialog service."
	}

	contextMenuStatus := ShellCapabilityUnavailable
	contextMenuReason := "Native context menu routing is unavailable before the main window is initialized."
	if appReady && mainWindowReady {
		contextMenuStatus = ShellCapabilityExperimental
		contextMenuReason = "Scoped context menus can route through the native Wails context menu adapter with DOM menus as fallback."
	}

	materialStatus := ShellCapabilityPlatformLimited
	materialReason := "Material/backdrop behavior is platform-specific and must be verified per window role."
	if platform == "darwin" && mainWindowReady {
		materialStatus = ShellCapabilityAvailable
		materialReason = "macOS transparent backdrop is configured for the main window."
	}

	dockBadgeStatus := ShellCapabilityPlatformLimited
	dockBadgeReason := "Dock/taskbar badges are platform-specific and not wired to a job broker yet."
	if platform != "darwin" {
		dockBadgeReason = "Taskbar badge support is platform-specific and not wired to a job broker yet."
	}

	return ShellCapabilitiesSnapshot{
		Platform: platform,
		Runtime:  "wails-v3",
		Version:  shellCapabilitiesVersion,
		Capabilities: map[string]ShellCapabilityDescriptor{
			"multiWindow": shellCapability(
				ShellCapabilityExperimental,
				"Wails v3 multi-window is present only as a spike path until leases, focus, and packaging are verified.",
			),
			"nativeMenu": shellCapability(nativeMenuStatus, nativeMenuReason),
			"contextMenu": shellCapability(
				contextMenuStatus,
				contextMenuReason,
			),
			"tray": shellCapability(
				ShellCapabilityUnavailable,
				"Tray integration stays disabled while Background Shell Status runs as a read model.",
			),
			"notifications": shellCapability(
				ShellCapabilityUnavailable,
				"Native notification delivery stays disabled; Background Shell Status only produces rate-limited candidates.",
			),
			"backgroundStatus": shellCapability(
				ShellCapabilityAvailable,
				"Background Shell Status read model is available for future tray and notification consumers.",
			),
			"clipboard": shellCapability(
				ShellCapabilityAvailable,
				"Clipboard read/write is available through the frontend runtime wrapper.",
			),
			"dialogs": shellCapability(dialogStatus, dialogReason),
			"customProtocol": shellCapability(
				ShellCapabilityRequiresBuild,
				"Custom protocol handling requires packaged-app registration and strict intent routing.",
			),
			"fileAssociations": shellCapability(
				ShellCapabilityRequiresBuild,
				"File associations require packaged-app registration and open-request routing.",
			),
			"singleInstance": shellCapability(
				ShellCapabilityRequiresBuild,
				"Single-instance routing requires packaged-app launch/open-file handling before it is enabled.",
			),
			"autoUpdate": shellCapability(
				ShellCapabilityExperimental,
				"Auto-update can verify signed ZIP artifacts and apply user-confirmed relaunch installs without Developer ID.",
			),
			"materialBackdrop": shellCapability(materialStatus, materialReason),
			"dockBadges":       shellCapability(dockBadgeStatus, dockBadgeReason),
			"browserOpenURL": shellCapability(
				ShellCapabilityAvailable,
				"External browser opening is available through the frontend runtime wrapper.",
			),
		},
	}
}

func (a *App) GetShellCapabilities() ShellCapabilitiesSnapshot {
	return buildShellCapabilities(
		runtime.GOOS,
		a != nil && a.wailsApp != nil,
		a != nil && a.mainWindow != nil,
	)
}
