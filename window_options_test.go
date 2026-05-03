package main

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func hasMacWindowCollectionBehavior(
	value application.MacWindowCollectionBehavior,
	flag application.MacWindowCollectionBehavior,
) bool {
	return value&flag == flag
}

func TestMacWindowOptionsParticipateInWindowCycle(t *testing.T) {
	for name, behavior := range map[string]application.MacWindowCollectionBehavior{
		"main":     mainWindowMacOptions().CollectionBehavior,
		"detached": detachedWindowMacOptions().CollectionBehavior,
	} {
		if !hasMacWindowCollectionBehavior(
			behavior,
			application.MacWindowCollectionBehaviorParticipatesInCycle,
		) {
			t.Fatalf("%s window collection behavior = %d, want ParticipatesInCycle", name, behavior)
		}
		if !hasMacWindowCollectionBehavior(
			behavior,
			application.MacWindowCollectionBehaviorFullScreenPrimary,
		) {
			t.Fatalf("%s window collection behavior = %d, want FullScreenPrimary", name, behavior)
		}
	}
}

func TestProjectWindowsUseMainWindowMacOptions(t *testing.T) {
	options := mainWindowMacOptions()
	if options.TitleBar != application.MacTitleBarHiddenInsetUnified {
		t.Fatalf("project window titlebar = %v, want main hidden inset unified", options.TitleBar)
	}
	if options.InvisibleTitleBarHeight != 0 {
		t.Fatalf("project window invisible titlebar height = %d, want webview-owned drag regions", options.InvisibleTitleBarHeight)
	}
}
