package main

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestShortcutToMenuAcceleratorRejectsFnShortcuts(t *testing.T) {
	if accelerator, ok := shortcutToMenuAccelerator("fn+f"); ok || accelerator != "" {
		t.Fatalf("shortcutToMenuAccelerator(fn+f) = (%v, %v), want unsupported", accelerator, ok)
	}
}

func TestShortcutToMenuAcceleratorSupportsOptionW(t *testing.T) {
	accelerator, ok := shortcutToMenuAccelerator("option+w")
	if !ok || accelerator == "" {
		t.Fatalf("shortcutToMenuAccelerator(option+w) unsupported")
	}

	if accelerator != "option+w" {
		t.Fatalf("accelerator = %q, want option+w", accelerator)
	}
}

func TestMenuAcceleratorForActionKeepsCmdWReservedForWebView(t *testing.T) {
	accelerator := menuAcceleratorForAction("panel.closeFullscreen", map[string][]string{
		"panel.closeFullscreen": {"cmd+w"},
	})
	if accelerator != "" {
		t.Fatalf("panel.closeFullscreen cmd+w accelerator = %q, want empty", accelerator)
	}
}

func TestMenuAcceleratorForActionUsesNativeShortcutWhenSupported(t *testing.T) {
	accelerator := menuAcceleratorForAction("search.toggle", map[string][]string{
		"search.toggle": {"cmd+f"},
	})
	if accelerator == "" {
		t.Fatalf("search.toggle accelerator is empty")
	}
	if accelerator != "cmd+f" {
		t.Fatalf("search.toggle accelerator = %q, want cmd+f", accelerator)
	}
}

func TestBuildApplicationMenuAddsViewFullscreenActions(t *testing.T) {
	app := NewApp()
	menuModel := app.buildApplicationMenu(map[string][]string{
		"search.toggle":           {"cmd+f"},
		"panel.closeFullscreen":   {"option+w"},
		"window.toggleFullscreen": {"fn+f"},
	})

	viewMenu := findSubmenu(t, menuModel, "View")
	searchItem := findMenuItem(t, viewMenu, "Search")
	if searchItem.GetAccelerator() == "" {
		t.Fatalf("Search accelerator is empty")
	}

	zoomInItem := findMenuItem(t, viewMenu, "Zoom In")
	if zoomInItem.GetAccelerator() == "" {
		t.Fatalf("Zoom In accelerator is empty")
	}

	closeItem := findMenuItem(t, viewMenu, "Close Fullscreen Panel")
	if closeItem.GetAccelerator() == "" {
		t.Fatalf("Close Fullscreen Panel accelerator is empty")
	}

	fullscreenItem := findMenuItem(t, viewMenu, "Enter Full Screen")
	if fullscreenItem.GetAccelerator() != "" {
		t.Fatalf("Enter Full Screen accelerator = %q, want empty for fn shortcut", fullscreenItem.GetAccelerator())
	}

	if lastMenuItem(viewMenu) != fullscreenItem {
		t.Fatalf("Enter Full Screen should be the last View menu item")
	}

	windowMenu := findSubmenu(t, menuModel, "Window")
	if findOptionalMenuItem(windowMenu, "Zoom") != nil {
		t.Fatalf("Window menu should not include non-functional Zoom")
	}
	if findOptionalMenuItem(windowMenu, "Enter Full Screen") != nil {
		t.Fatalf("Window menu should not duplicate Enter Full Screen")
	}
}

func TestBuildApplicationMenuAddsOpenAction(t *testing.T) {
	app := NewApp()
	menuModel := app.buildApplicationMenu(map[string][]string{
		"project.open": {"cmd+o"},
	})

	fileMenu := findSubmenu(t, menuModel, "File")
	assertMenuAccelerator(t, findMenuItem(t, fileMenu, "Open..."), "Cmd+O")
	if findOptionalMenuItem(fileMenu, "Open File...") != nil {
		t.Fatalf("File menu should use one Open action")
	}
	if findOptionalMenuItem(fileMenu, "Open Project...") != nil {
		t.Fatalf("File menu should use one Open action")
	}
	if findSubmenu(t, menuModel, "File").ItemAt(2).Label() != "Open Recent" {
		t.Fatalf("File menu should include Open Recent after Open")
	}
}

func TestApplicationMenuStateDisablesContextualActionsByDefault(t *testing.T) {
	app := NewApp()
	menuModel := app.buildApplicationMenu(map[string][]string{
		"panel.closeFullscreen": {"option+w"},
	})

	viewMenu := findSubmenu(t, menuModel, "View")
	if findMenuItem(t, viewMenu, "Close Fullscreen Panel").Enabled() {
		t.Fatalf("Close Fullscreen Panel enabled = true, want false by default")
	}
	aiMenu := findSubmenu(t, menuModel, "AI")
	if findMenuItem(t, aiMenu, "Stop Agent").Enabled() {
		t.Fatalf("Stop Agent enabled = true, want false by default")
	}
	sourceMenu := findSubmenu(t, menuModel, "Source Control")
	if findMenuItem(t, sourceMenu, "Commit...").Enabled() {
		t.Fatalf("Commit enabled = true, want false by default")
	}

	app.SyncApplicationMenuState(ShellMenuStatePayload{
		CanCloseFullscreenPanel: true,
		CanStopAgent:            true,
		HasGitChanges:           true,
	})

	if !findMenuItem(t, viewMenu, "Close Fullscreen Panel").Enabled() {
		t.Fatalf("Close Fullscreen Panel enabled = false, want true")
	}
	if !findMenuItem(t, aiMenu, "Stop Agent").Enabled() {
		t.Fatalf("Stop Agent enabled = false, want true")
	}
	if !findMenuItem(t, sourceMenu, "Commit...").Enabled() {
		t.Fatalf("Commit enabled = false, want true")
	}
}

func TestBuildApplicationMenuUsesUpdatedPanelAccelerators(t *testing.T) {
	app := NewApp()
	menuModel := app.buildApplicationMenu(map[string][]string{
		"terminal.toggle":     {"cmd+j"},
		"problems.toggle":     {"cmd+i"},
		"problems.fullscreen": {"cmd+shift+i"},
		"ai.fullscreen":       {"cmd+shift+r"},
	})

	viewMenu := findSubmenu(t, menuModel, "View")
	assertMenuAccelerator(t, findMenuItem(t, viewMenu, "Toggle Terminal"), "Cmd+J")
	assertMenuAccelerator(t, findMenuItem(t, viewMenu, "Toggle Problems Panel"), "Cmd+I")
	assertMenuAccelerator(t, findMenuItem(t, viewMenu, "Toggle Problems Fullscreen"), "Cmd+Shift+I")
	assertMenuAccelerator(t, findMenuItem(t, viewMenu, "Toggle AI Fullscreen"), "Cmd+Shift+R")
}

func findSubmenu(t *testing.T, menuModel *application.Menu, label string) *application.Menu {
	t.Helper()
	for i := 0; ; i++ {
		item := menuModel.ItemAt(i)
		if item == nil {
			break
		}
		if item.Label() == label && item.GetSubmenu() != nil {
			return item.GetSubmenu()
		}
	}
	t.Fatalf("submenu %q not found", label)
	return nil
}

func findMenuItem(t *testing.T, menuModel *application.Menu, label string) *application.MenuItem {
	t.Helper()
	for i := 0; ; i++ {
		item := menuModel.ItemAt(i)
		if item == nil {
			break
		}
		if item.Label() == label {
			return item
		}
	}
	t.Fatalf("menu item %q not found", label)
	return nil
}

func findOptionalMenuItem(menuModel *application.Menu, label string) *application.MenuItem {
	for i := 0; ; i++ {
		item := menuModel.ItemAt(i)
		if item == nil {
			break
		}
		if item.Label() == label {
			return item
		}
	}
	return nil
}

func assertMenuAccelerator(t *testing.T, item *application.MenuItem, want string) {
	t.Helper()
	if item.GetAccelerator() != want {
		t.Fatalf("%s accelerator = %q, want %q", item.Label(), item.GetAccelerator(), want)
	}
}

func lastMenuItem(menuModel *application.Menu) *application.MenuItem {
	var last *application.MenuItem
	for i := 0; ; i++ {
		item := menuModel.ItemAt(i)
		if item == nil {
			return last
		}
		last = item
	}
}
