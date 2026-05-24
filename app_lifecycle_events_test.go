package main

import "testing"

func TestShouldRestoreWindowForMacReopen(t *testing.T) {
	tests := []struct {
		name                     string
		contextHasVisibleWindows bool
		registryHasVisibleWindow bool
		wantShouldRestoreWindow  bool
	}{
		{
			name:                    "hidden application restores last active window",
			wantShouldRestoreWindow: true,
		},
		{
			name:                     "wails context visible window suppresses restore",
			contextHasVisibleWindows: true,
		},
		{
			name:                     "role registry visible window suppresses restore",
			registryHasVisibleWindow: true,
		},
		{
			name:                     "either visible signal suppresses restore",
			contextHasVisibleWindows: true,
			registryHasVisibleWindow: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldRestoreWindowForMacReopen(
				tt.contextHasVisibleWindows,
				tt.registryHasVisibleWindow,
			)
			if got != tt.wantShouldRestoreWindow {
				t.Fatalf("shouldRestoreWindowForMacReopen() = %v, want %v", got, tt.wantShouldRestoreWindow)
			}
		})
	}
}

func TestShouldFocusWindowForMacReopen(t *testing.T) {
	tests := []struct {
		name                     string
		contextHasVisibleWindows bool
		registryHasVisibleWindow bool
		wantShouldFocusWindow    bool
	}{
		{
			name:                  "hidden application restores window",
			wantShouldFocusWindow: true,
		},
		{
			name:                     "visible Wails context still focuses on Dock click",
			contextHasVisibleWindows: true,
			wantShouldFocusWindow:    true,
		},
		{
			name:                     "visible role registry still focuses on Dock click",
			registryHasVisibleWindow: true,
			wantShouldFocusWindow:    true,
		},
		{
			name:                     "visible signals focus idempotently",
			contextHasVisibleWindows: true,
			registryHasVisibleWindow: true,
			wantShouldFocusWindow:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldFocusWindowForMacReopen(
				tt.contextHasVisibleWindows,
				tt.registryHasVisibleWindow,
			)
			if got != tt.wantShouldFocusWindow {
				t.Fatalf("shouldFocusWindowForMacReopen() = %v, want %v", got, tt.wantShouldFocusWindow)
			}
		})
	}
}
