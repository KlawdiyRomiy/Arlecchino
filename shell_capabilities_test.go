package main

import "testing"

func TestBuildShellCapabilities_MainWindowReady(t *testing.T) {
	snapshot := buildShellCapabilities("darwin", true, true)

	if snapshot.Platform != "darwin" {
		t.Fatalf("Platform = %q, want darwin", snapshot.Platform)
	}
	if snapshot.Runtime != "wails-v3" {
		t.Fatalf("Runtime = %q, want wails-v3", snapshot.Runtime)
	}
	if snapshot.Version != shellCapabilitiesVersion {
		t.Fatalf("Version = %d, want %d", snapshot.Version, shellCapabilitiesVersion)
	}

	tests := []struct {
		name   string
		status ShellCapabilityStatus
	}{
		{name: "nativeMenu", status: ShellCapabilityAvailable},
		{name: "dialogs", status: ShellCapabilityAvailable},
		{name: "materialBackdrop", status: ShellCapabilityAvailable},
		{name: "multiWindow", status: ShellCapabilityExperimental},
		{name: "contextMenu", status: ShellCapabilityExperimental},
		{name: "customProtocol", status: ShellCapabilityRequiresBuild},
		{name: "fileAssociations", status: ShellCapabilityRequiresBuild},
		{name: "singleInstance", status: ShellCapabilityRequiresBuild},
		{name: "autoUpdate", status: ShellCapabilityUnavailable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			capability, ok := snapshot.Capabilities[tt.name]
			if !ok {
				t.Fatalf("missing capability %q", tt.name)
			}
			if capability.Status != tt.status {
				t.Fatalf("%s status = %q, want %q", tt.name, capability.Status, tt.status)
			}
			if capability.Source != "backend" {
				t.Fatalf("%s source = %q, want backend", tt.name, capability.Source)
			}
			if capability.Reason == "" {
				t.Fatalf("%s reason must not be empty", tt.name)
			}
		})
	}
}

func TestBuildShellCapabilities_BeforeWindowReady(t *testing.T) {
	snapshot := buildShellCapabilities("linux", false, false)

	tests := []struct {
		name   string
		status ShellCapabilityStatus
	}{
		{name: "nativeMenu", status: ShellCapabilityUnavailable},
		{name: "dialogs", status: ShellCapabilityUnavailable},
		{name: "materialBackdrop", status: ShellCapabilityPlatformLimited},
		{name: "dockBadges", status: ShellCapabilityPlatformLimited},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			capability := snapshot.Capabilities[tt.name]
			if capability.Status != tt.status {
				t.Fatalf("%s status = %q, want %q", tt.name, capability.Status, tt.status)
			}
		})
	}
}
