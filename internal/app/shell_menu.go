package app

import (
	"path/filepath"
	stdRuntime "runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const menuActionEventName = "ide:menu:action"

var nativeMenuAcceleratorActions = map[string]bool{
	"editor.find":             true,
	"search.toggle":           true,
	"explorer.toggle":         true,
	"terminal.toggle":         true,
	"terminal.fullscreen":     true,
	"ai.toggle":               true,
	"ai.fullscreen":           true,
	"project.new":             true,
	"project.open":            true,
	"settings.toggle":         true,
	"zenMode.toggle":          true,
	"browser.preview":         true,
	"git.toggle":              true,
	"git.fullscreen":          true,
	"problems.toggle":         true,
	"problems.fullscreen":     true,
	"panel.closeFullscreen":   true,
	"window.toggleFullscreen": true,
}

var defaultApplicationMenuShortcuts = map[string][]string{
	"editor.find":             {"cmd+f", "ctrl+f"},
	"search.toggle":           {"cmd+shift+f", "ctrl+shift+f"},
	"explorer.toggle":         {"cmd+e"},
	"terminal.toggle":         {"cmd+j"},
	"terminal.fullscreen":     {"cmd+shift+j"},
	"ai.toggle":               {"cmd+r", "ctrl+r"},
	"ai.fullscreen":           {"cmd+shift+r", "ctrl+shift+r"},
	"project.new":             {"cmd+n", "ctrl+n"},
	"project.open":            {"cmd+o", "ctrl+o"},
	"settings.toggle":         {"cmd+,", "ctrl+,"},
	"zenMode.toggle":          {"cmd+shift+."},
	"browser.preview":         {"cmd+b"},
	"git.toggle":              {"cmd+g"},
	"git.fullscreen":          {"cmd+shift+g"},
	"problems.toggle":         {"cmd+i"},
	"problems.fullscreen":     {"cmd+shift+i"},
	"panel.closeFullscreen":   {"option+w"},
	"window.toggleFullscreen": {"fn+f"},
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

type ShellMenuStatePayload struct {
	HasSelection            bool `json:"hasSelection"`
	CanCloseFullscreenPanel bool `json:"canCloseFullscreenPanel"`
	AIChatFullscreenActive  bool `json:"aiChatFullscreenActive"`
	CanStopAgent            bool `json:"canStopAgent"`
	CanCommit               bool `json:"canCommit"`
	HasGitChanges           bool `json:"hasGitChanges"`
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
		if a.wailsApp != nil {
			a.wailsApp.Menu.SetApplicationMenu(a.buildApplicationMenu(shortcuts))
		}
		a.patchNativeApplicationMenu(shortcuts)
		a.syncNativeApplicationMenuState()
	}
}

func (a *App) SyncApplicationMenuState(payload ShellMenuStatePayload) {
	if a == nil {
		return
	}
	payload.CanCommit = payload.CanCommit || payload.HasGitChanges

	a.shellMenuMu.Lock()
	a.shellMenuState = payload
	items := make(map[string]*application.MenuItem, len(a.shellMenuItems))
	for actionID, item := range a.shellMenuItems {
		items[actionID] = item
	}
	a.shellMenuMu.Unlock()

	setTrackedMenuEnabled(items, "panel.closeFullscreen", payload.CanCloseFullscreenPanel)
	setTrackedMenuEnabled(items, "ai.stopAgent", payload.CanStopAgent)
	setTrackedMenuEnabled(items, "git.commit", payload.CanCommit)
	a.syncNativeApplicationMenuState()
}

func (a *App) buildApplicationMenu(shortcuts map[string][]string) *application.Menu {
	a.shellMenuMu.Lock()
	a.shellMenuItems = make(map[string]*application.MenuItem)
	a.shellMenuMu.Unlock()

	appMenu := application.NewMenu()
	if stdRuntime.GOOS == "darwin" && application.Get() != nil {
		appMenu.AddRole(application.AppMenu)
	}

	fileMenu := appMenu.AddSubmenu("File")
	a.addMenuAction(fileMenu, "New Project", "project.new", shortcuts)
	a.addMenuAction(fileMenu, "Open...", "project.open", shortcuts)
	a.addOpenRecentMenu(fileMenu)

	if stdRuntime.GOOS == "darwin" && application.Get() != nil {
		appMenu.AddRole(application.EditMenu)
	}

	viewMenu := appMenu.AddSubmenu("View")
	a.addMenuAction(viewMenu, "Find in File", "editor.find", shortcuts)
	a.addMenuAction(viewMenu, "Search", "search.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Zen Mode", "zenMode.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Explorer", "explorer.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Terminal", "terminal.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Terminal Fullscreen", "terminal.fullscreen", shortcuts)
	a.addMenuAction(viewMenu, "Toggle AI Panel", "ai.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle AI Fullscreen", "ai.fullscreen", shortcuts)
	viewMenu.AddSeparator()
	a.addMenuAction(viewMenu, "Open Browser Preview", "browser.preview", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Git Panel", "git.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Git Fullscreen", "git.fullscreen", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Problems Panel", "problems.toggle", shortcuts)
	a.addMenuAction(viewMenu, "Toggle Problems Fullscreen", "problems.fullscreen", shortcuts)
	viewMenu.AddSeparator()
	viewMenu.Add("Zoom In").SetAccelerator("cmd+plus").OnClick(a.emitViewZoom("in"))
	viewMenu.Add("Zoom Out").SetAccelerator("cmd+-").OnClick(a.emitViewZoom("out"))
	viewMenu.Add("Actual Size").SetAccelerator("cmd+0").OnClick(a.emitViewZoom("reset"))
	viewMenu.AddSeparator()
	a.addMenuAction(viewMenu, "Close Fullscreen Panel", "panel.closeFullscreen", shortcuts)
	a.addMenuAction(viewMenu, "Enter Full Screen", "window.toggleFullscreen", shortcuts)

	aiMenu := appMenu.AddSubmenu("AI")
	a.addMenuAction(aiMenu, "Stop Agent", "ai.stopAgent", shortcuts)

	sourceControlMenu := appMenu.AddSubmenu("Source Control")
	a.addMenuAction(sourceControlMenu, "Commit...", "git.commit", shortcuts)

	windowMenu := appMenu.AddSubmenu("Window")
	windowMenu.Add("Minimize").SetAccelerator("cmd+m").OnClick(func(_ *application.Context) {
		if window := a.currentNativeWindow(); window != nil {
			window.Minimise()
		}
	})

	helpMenu := appMenu.AddSubmenu("Help")
	a.addMenuAction(helpMenu, "Settings", "settings.toggle", shortcuts)

	a.applyShellMenuStateToTrackedItems()
	return appMenu
}

func (a *App) addOpenRecentMenu(fileMenu *application.Menu) {
	recentMenu := fileMenu.AddSubmenu("Open Recent")
	projects, err := a.GetRecentProjects(10)
	if err != nil || len(projects) == 0 {
		recentMenu.Add("No Recent Projects").SetEnabled(false)
		return
	}
	for _, project := range projects {
		projectPath := strings.TrimSpace(project.Path)
		if projectPath == "" {
			continue
		}
		label := strings.TrimSpace(project.Name)
		if label == "" {
			label = filepath.Base(projectPath)
		}
		path := projectPath
		recentMenu.Add(label).OnClick(func(*application.Context) {
			a.dispatchOpenIntent(map[string]any{
				"kind":        "openProject",
				"projectPath": path,
				"source":      "native-menu",
			})
			a.showLastActiveWindow()
		})
	}
}

func (a *App) addMenuAction(target *application.Menu, label string, actionID string, shortcuts map[string][]string) *application.MenuItem {
	item := target.Add(label).OnClick(a.emitMenuAction(actionID))
	if accelerator := menuAcceleratorForAction(actionID, shortcuts); accelerator != "" {
		item.SetAccelerator(accelerator)
	}
	a.shellMenuMu.Lock()
	if a.shellMenuItems == nil {
		a.shellMenuItems = make(map[string]*application.MenuItem)
	}
	a.shellMenuItems[actionID] = item
	a.shellMenuMu.Unlock()
	return item
}

func (a *App) emitMenuAction(actionID string) func(*application.Context) {
	return func(_ *application.Context) {
		if a.ctx == nil {
			return
		}
		if !a.shellMenuActionEnabled(actionID) {
			return
		}
		switch actionID {
		case "ai.stopAgent":
			a.emitWindowEvent("ide:ai:stop-agent")
			return
		case "git.commit":
			a.emitWindowEvent("ide:git:commit")
			return
		}
		if window := a.currentNativeWindow(); window != nil {
			window.EmitEvent(menuActionEventName, actionID)
			return
		}
		a.emitEvent(menuActionEventName, actionID)
	}
}

func (a *App) emitWindowEvent(name string, payload ...any) {
	if a == nil || a.ctx == nil {
		return
	}
	if window := a.currentNativeWindow(); window != nil {
		if len(payload) == 0 {
			window.EmitEvent(name)
		} else {
			window.EmitEvent(name, payload...)
		}
		return
	}
	if len(payload) == 0 {
		a.emitEvent(name)
	} else {
		a.emitEvent(name, payload...)
	}
}

func (a *App) shellMenuActionEnabled(actionID string) bool {
	switch strings.TrimSpace(actionID) {
	case "panel.closeFullscreen":
		a.shellMenuMu.Lock()
		defer a.shellMenuMu.Unlock()
		return a.shellMenuState.CanCloseFullscreenPanel
	case "ai.stopAgent":
		a.shellMenuMu.Lock()
		defer a.shellMenuMu.Unlock()
		return a.shellMenuState.CanStopAgent
	case "git.commit":
		a.shellMenuMu.Lock()
		defer a.shellMenuMu.Unlock()
		return a.shellMenuState.CanCommit || a.shellMenuState.HasGitChanges
	default:
		return true
	}
}

func (a *App) applyShellMenuStateToTrackedItems() {
	if a == nil {
		return
	}
	a.shellMenuMu.Lock()
	state := a.shellMenuState
	items := make(map[string]*application.MenuItem, len(a.shellMenuItems))
	for actionID, item := range a.shellMenuItems {
		items[actionID] = item
	}
	a.shellMenuMu.Unlock()

	setTrackedMenuEnabled(items, "panel.closeFullscreen", state.CanCloseFullscreenPanel)
	setTrackedMenuEnabled(items, "ai.stopAgent", state.CanStopAgent)
	setTrackedMenuEnabled(items, "git.commit", state.CanCommit || state.HasGitChanges)
}

func setTrackedMenuEnabled(items map[string]*application.MenuItem, actionID string, enabled bool) {
	if item := items[actionID]; item != nil {
		item.SetEnabled(enabled)
	}
}

func (a *App) syncNativeApplicationMenuState() {
	if a == nil || !nativeMacOSBridgeAvailable() {
		return
	}
	a.shellMenuMu.Lock()
	state := a.shellMenuState
	a.shellMenuMu.Unlock()

	recent := a.nativeMenuRecentProjects(10)
	_, _ = callNativeMacOSBridge("menu.updateState", map[string]any{
		"commands": []map[string]any{
			{"title": "Close Fullscreen Panel", "enabled": state.CanCloseFullscreenPanel},
			{"title": "Stop Agent", "enabled": state.CanStopAgent},
			{"title": "Commit...", "enabled": state.CanCommit || state.HasGitChanges},
		},
		"aiChatFullscreenActive": state.AIChatFullscreenActive,
		"recentProjects":         recent,
	})
}

func (a *App) nativeMenuRecentProjects(limit int) []map[string]string {
	if a == nil || a.projectManager == nil {
		return nil
	}
	projects, err := a.GetRecentProjects(limit)
	if err != nil {
		return nil
	}
	result := make([]map[string]string, 0, len(projects))
	for _, project := range projects {
		projectPath := strings.TrimSpace(project.Path)
		if projectPath == "" {
			continue
		}
		title := strings.TrimSpace(project.Name)
		if title == "" {
			title = filepath.Base(projectPath)
		}
		result = append(result, map[string]string{
			"title": title,
			"path":  projectPath,
		})
	}
	return result
}

func (a *App) emitViewZoom(action string) func(*application.Context) {
	return func(_ *application.Context) {
		if a.ctx == nil {
			return
		}
		if window := a.currentNativeWindow(); window != nil {
			window.EmitEvent("ide:view:zoom", action)
			return
		}
		a.emitEvent("ide:view:zoom", action)
	}
}

func (a *App) currentNativeWindow() application.Window {
	if a != nil && a.wailsApp != nil {
		if window := a.wailsApp.Window.Current(); window != nil {
			return window
		}
	}
	if a != nil {
		return a.mainWindow
	}
	return nil
}

func menuAcceleratorForAction(actionID string, shortcuts map[string][]string) string {
	actionShortcuts := menuShortcutsForAction(actionID, shortcuts)
	if len(actionShortcuts) == 0 {
		return ""
	}

	if !nativeMenuAcceleratorActions[actionID] {
		return ""
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

	return ""
}

func menuShortcutsForAction(actionID string, shortcuts map[string][]string) []string {
	if shortcuts != nil {
		if actionShortcuts, ok := shortcuts[actionID]; ok {
			return actionShortcuts
		}
	}
	return defaultApplicationMenuShortcuts[actionID]
}

func shortcutToMenuAccelerator(shortcut string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(strings.ToLower(shortcut)), "+")
	if len(parts) == 0 {
		return "", false
	}

	key := strings.TrimSpace(parts[len(parts)-1])
	if key == "" {
		return "", false
	}

	modifiers := make([]string, 0, len(parts)-1)
	for _, part := range parts[:len(parts)-1] {
		switch strings.TrimSpace(part) {
		case "cmd", "command", "meta":
			modifiers = append(modifiers, "cmd")
		case "ctrl", "control":
			modifiers = append(modifiers, "ctrl")
		case "alt", "option", "opt":
			modifiers = append(modifiers, "option")
		case "shift":
			modifiers = append(modifiers, "shift")
		case "fn", "function", "globe":
			return "", false
		case "":
			continue
		default:
			return "", false
		}
	}

	return strings.Join(append(modifiers, normalizeMenuAcceleratorKey(key)), "+"), true
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
	case "+":
		return "plus"
	default:
		return key
	}
}
