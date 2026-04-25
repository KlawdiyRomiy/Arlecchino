package main

import (
	stdRuntime "runtime"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const menuActionEventName = "ide:menu:action"

var nativeMenuAcceleratorActions = map[string]bool{
	"search.toggle":           true,
	"explorer.toggle":         true,
	"terminal.toggle":         true,
	"ai.toggle":               true,
	"project.new":             true,
	"project.open":            true,
	"settings.toggle":         true,
	"browser.preview":         true,
	"git.toggle":              true,
	"git.fullscreen":          true,
	"problems.toggle":         true,
	"problems.fullscreen":     true,
	"panel.closeFullscreen":   true,
	"window.toggleFullscreen": true,
}

var reservedWebViewShortcuts = map[string]bool{
	"cmd+w":  true,
	"ctrl+w": true,
}

type ApplicationMenuShortcutPayload struct {
	ActionID  string   `json:"actionId"`
	Label     string   `json:"label"`
	Group     string   `json:"group"`
	Shortcuts []string `json:"shortcuts"`
}

func (a *App) SyncApplicationMenuShortcuts(payload []ApplicationMenuShortcutPayload) {
	shortcuts := make(map[string][]string, len(payload))
	for _, item := range payload {
		actionID := strings.TrimSpace(item.ActionID)
		if actionID == "" {
			continue
		}

		normalized := make([]string, 0, len(item.Shortcuts))
		for _, shortcut := range item.Shortcuts {
			shortcut = strings.TrimSpace(shortcut)
			if shortcut != "" {
				normalized = append(normalized, shortcut)
			}
		}
		shortcuts[actionID] = normalized
	}

	a.shellMenuMu.Lock()
	a.shellMenuShortcuts = shortcuts
	a.shellMenuMu.Unlock()

	if a.ctx != nil {
		wailsruntime.MenuSetApplicationMenu(a.ctx, a.buildApplicationMenu(shortcuts))
		a.patchNativeApplicationMenu(shortcuts)
	}
}

func (a *App) buildApplicationMenu(shortcuts map[string][]string) *menu.Menu {
	appMenu := menu.NewMenu()
	if stdRuntime.GOOS == "darwin" {
		appMenu.Append(menu.AppMenu())
	}

	fileMenu := appMenu.AddSubmenu("File")
	a.addMenuAction(fileMenu, "New Project", "project.new", shortcuts)
	a.addMenuAction(fileMenu, "Open Project...", "project.open", shortcuts)

	if stdRuntime.GOOS == "darwin" {
		appMenu.Append(menu.EditMenu())
	}

	viewMenu := appMenu.AddSubmenu("View")
	a.addMenuAction(viewMenu, "Search", "search.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Explorer", "explorer.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Terminal", "terminal.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle AI Panel", "ai.toggle", shortcuts)
	viewMenu.AddSeparator()
	a.addMenuAction(viewMenu, "Open Browser Preview", "browser.preview", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Git Panel", "git.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Git Fullscreen", "git.fullscreen", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Problems Panel", "problems.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Problems Fullscreen", "problems.fullscreen", shortcuts)
	viewMenu.AddSeparator()
	viewMenu.AddText("Zoom In", keys.CmdOrCtrl("+"), a.emitViewZoom("in"))
	viewMenu.AddText("Zoom Out", keys.CmdOrCtrl("-"), a.emitViewZoom("out"))
	viewMenu.AddText("Actual Size", keys.CmdOrCtrl("0"), a.emitViewZoom("reset"))
	viewMenu.AddSeparator()
	a.addMenuAction(viewMenu, "Close Fullscreen Panel", "panel.closeFullscreen", shortcuts)
	a.addMenuAction(viewMenu, "Enter Full Screen", "window.toggleFullscreen", shortcuts)

	windowMenu := appMenu.AddSubmenu("Window")
	windowMenu.AddText("Minimize", keys.CmdOrCtrl("m"), func(_ *menu.CallbackData) {
		if a.ctx != nil {
			wailsruntime.WindowMinimise(a.ctx)
		}
	})

	helpMenu := appMenu.AddSubmenu("Help")
	a.addMenuAction(helpMenu, "Settings", "settings.toggle", shortcuts)

	return appMenu
}

func (a *App) addMenuAction(target *menu.Menu, label string, actionID string, shortcuts map[string][]string) {
	target.AddText(label, menuAcceleratorForAction(actionID, shortcuts), a.emitMenuAction(actionID))
}

func (a *App) emitMenuAction(actionID string) menu.Callback {
	return func(_ *menu.CallbackData) {
		if a.ctx == nil {
			return
		}
		wailsruntime.EventsEmit(a.ctx, menuActionEventName, actionID)
	}
}

func (a *App) emitViewZoom(action string) menu.Callback {
	return func(_ *menu.CallbackData) {
		if a.ctx == nil {
			return
		}
		wailsruntime.EventsEmit(a.ctx, "ide:view:zoom", action)
	}
}

func menuAcceleratorForAction(actionID string, shortcuts map[string][]string) *keys.Accelerator {
	actionShortcuts := shortcuts[actionID]
	if len(actionShortcuts) == 0 {
		return nil
	}

	if !nativeMenuAcceleratorActions[actionID] {
		return nil
	}

	for _, shortcut := range actionShortcuts {
		if reservedWebViewShortcuts[normalizeMenuShortcut(shortcut)] {
			continue
		}

		accelerator, ok := shortcutToMenuAccelerator(shortcut)
		if ok {
			return accelerator
		}
	}

	return nil
}

func shortcutToMenuAccelerator(shortcut string) (*keys.Accelerator, bool) {
	parts := strings.Split(strings.TrimSpace(strings.ToLower(shortcut)), "+")
	if len(parts) == 0 {
		return nil, false
	}

	key := strings.TrimSpace(parts[len(parts)-1])
	if key == "" {
		return nil, false
	}

	modifiers := make([]keys.Modifier, 0, len(parts)-1)
	for _, part := range parts[:len(parts)-1] {
		switch strings.TrimSpace(part) {
		case "cmd", "command", "meta":
			modifiers = append(modifiers, keys.CmdOrCtrlKey)
		case "ctrl", "control":
			modifiers = append(modifiers, keys.ControlKey)
		case "alt", "option", "opt":
			modifiers = append(modifiers, keys.OptionOrAltKey)
		case "shift":
			modifiers = append(modifiers, keys.ShiftKey)
		case "fn", "function", "globe":
			return nil, false
		case "":
			continue
		default:
			return nil, false
		}
	}

	return &keys.Accelerator{Key: normalizeMenuAcceleratorKey(key), Modifiers: modifiers}, true
}

func normalizeMenuShortcut(shortcut string) string {
	parts := strings.Split(strings.TrimSpace(strings.ToLower(shortcut)), "+")
	if len(parts) == 0 {
		return ""
	}

	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		switch part {
		case "command", "meta":
			part = "cmd"
		case "control":
			part = "ctrl"
		case "alt", "opt":
			part = "option"
		case "function", "globe":
			part = "fn"
		}
		if part != "" {
			normalized = append(normalized, part)
		}
	}

	return strings.Join(normalized, "+")
}

func normalizeMenuAcceleratorKey(key string) string {
	switch key {
	case "space":
		return " "
	case "enter":
		return "return"
	case "escape":
		return "esc"
	default:
		return key
	}
}
