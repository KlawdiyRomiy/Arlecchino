package main

import (
	"reflect"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
)

func TestShortcutToMenuAcceleratorRejectsFnShortcuts(t *testing.T) {
	if accelerator, ok := shortcutToMenuAccelerator("fn+f"); ok || accelerator != nil {
		t.Fatalf("shortcutToMenuAccelerator(fn+f) = (%v, %v), want unsupported", accelerator, ok)
	}
}

func TestShortcutToMenuAcceleratorSupportsOptionW(t *testing.T) {
	accelerator, ok := shortcutToMenuAccelerator("option+w")
	if !ok || accelerator == nil {
		t.Fatalf("shortcutToMenuAccelerator(option+w) unsupported")
	}

	if accelerator.Key != "w" {
		t.Fatalf("accelerator.Key = %q, want w", accelerator.Key)
	}
	if len(accelerator.Modifiers) != 1 {
		t.Fatalf("accelerator.Modifiers len = %d, want 1", len(accelerator.Modifiers))
	}
}

func TestMenuAcceleratorForActionKeepsCmdWReservedForWebView(t *testing.T) {
	accelerator := menuAcceleratorForAction("panel.closeFullscreen", map[string][]string{
		"panel.closeFullscreen": {"cmd+w"},
	})
	if accelerator != nil {
		t.Fatalf("panel.closeFullscreen cmd+w accelerator = %v, want nil", accelerator)
	}
}

func TestMenuAcceleratorForActionUsesNativeShortcutWhenSupported(t *testing.T) {
	accelerator := menuAcceleratorForAction("search.toggle", map[string][]string{
		"search.toggle": {"cmd+f"},
	})
	if accelerator == nil {
		t.Fatalf("search.toggle accelerator is nil")
	}
	if accelerator.Key != "f" {
		t.Fatalf("search.toggle accelerator key = %q, want f", accelerator.Key)
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
	if searchItem.Accelerator == nil {
		t.Fatalf("Search accelerator is nil")
	}

	zoomInItem := findMenuItem(t, viewMenu, "Zoom In")
	if zoomInItem.Accelerator == nil || zoomInItem.Accelerator.Key != "+" {
		t.Fatalf("Zoom In accelerator = %v, want cmd+", zoomInItem.Accelerator)
	}

	closeItem := findMenuItem(t, viewMenu, "Close Fullscreen Panel")
	if closeItem.Accelerator == nil {
		t.Fatalf("Close Fullscreen Panel accelerator is nil")
	}

	fullscreenItem := findMenuItem(t, viewMenu, "Enter Full Screen")
	if fullscreenItem.Accelerator != nil {
		t.Fatalf("Enter Full Screen accelerator = %v, want nil for fn shortcut", fullscreenItem.Accelerator)
	}

	if viewMenu.Items[len(viewMenu.Items)-1] != fullscreenItem {
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

func TestBuildApplicationMenuUsesUpdatedPanelAccelerators(t *testing.T) {
	app := NewApp()
	menuModel := app.buildApplicationMenu(map[string][]string{
		"terminal.toggle":     {"cmd+j"},
		"problems.toggle":     {"cmd+i"},
		"problems.fullscreen": {"cmd+shift+i"},
	})

	viewMenu := findSubmenu(t, menuModel, "View")
	assertMenuAccelerator(t, findMenuItem(t, viewMenu, "Toggle Terminal"), "j", keys.CmdOrCtrlKey)
	assertMenuAccelerator(t, findMenuItem(t, viewMenu, "Toggle Problems Panel"), "i", keys.CmdOrCtrlKey)
	assertMenuAccelerator(
		t,
		findMenuItem(t, viewMenu, "Toggle Problems Fullscreen"),
		"i",
		keys.CmdOrCtrlKey,
		keys.ShiftKey,
	)
}

func findSubmenu(t *testing.T, menuModel *menu.Menu, label string) *menu.Menu {
	t.Helper()
	for _, item := range menuModel.Items {
		if item.Label == label && item.SubMenu != nil {
			return item.SubMenu
		}
	}
	t.Fatalf("submenu %q not found", label)
	return nil
}

func findMenuItem(t *testing.T, menuModel *menu.Menu, label string) *menu.MenuItem {
	t.Helper()
	for _, item := range menuModel.Items {
		if item.Label == label {
			return item
		}
	}
	t.Fatalf("menu item %q not found", label)
	return nil
}

func findOptionalMenuItem(menuModel *menu.Menu, label string) *menu.MenuItem {
	for _, item := range menuModel.Items {
		if item.Label == label {
			return item
		}
	}
	return nil
}

func assertMenuAccelerator(t *testing.T, item *menu.MenuItem, key string, modifiers ...keys.Modifier) {
	t.Helper()
	if item.Accelerator == nil {
		t.Fatalf("%s accelerator is nil", item.Label)
	}
	if item.Accelerator.Key != key {
		t.Fatalf("%s accelerator key = %q, want %q", item.Label, item.Accelerator.Key, key)
	}
	if !reflect.DeepEqual(item.Accelerator.Modifiers, modifiers) {
		t.Fatalf("%s accelerator modifiers = %v, want %v", item.Label, item.Accelerator.Modifiers, modifiers)
	}
}
