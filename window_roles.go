package main

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type WindowRole string

const (
	WindowRoleMain      WindowRole = "main"
	WindowRoleProject   WindowRole = "project"
	WindowRoleSettings  WindowRole = "settings"
	WindowRolePreview   WindowRole = "preview"
	WindowRoleAgentTask WindowRole = "agentTask"
	WindowRoleUtility   WindowRole = "utility"
)

type windowRoleEntry struct {
	Name     string
	Role     WindowRole
	Window   application.Window
	LastSeen time.Time
}

type WindowRoleRegistry struct {
	mu          sync.Mutex
	entries     map[string]windowRoleEntry
	lastActive  string
	lastByRole  map[WindowRole]string
	unregisters map[string][]func()
}

func NewWindowRoleRegistry() *WindowRoleRegistry {
	return &WindowRoleRegistry{
		entries:     make(map[string]windowRoleEntry),
		lastByRole:  make(map[WindowRole]string),
		unregisters: make(map[string][]func()),
	}
}

func (a *App) registerWindowRole(window application.Window, role WindowRole) {
	if a == nil || window == nil {
		return
	}
	if a.windowRoles == nil {
		a.windowRoles = NewWindowRoleRegistry()
	}
	name := windowRoleName(window)
	if name == "" {
		return
	}

	a.windowRoles.mu.Lock()
	a.windowRoles.entries[name] = windowRoleEntry{
		Name:     name,
		Role:     role,
		Window:   window,
		LastSeen: time.Now(),
	}
	a.windowRoles.lastActive = name
	a.windowRoles.lastByRole[role] = name
	a.windowRoles.mu.Unlock()

	offFocus := window.OnWindowEvent(events.Common.WindowFocus, func(*application.WindowEvent) {
		a.markWindowRoleActive(window)
	})
	offShow := window.OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent) {
		a.markWindowRoleActive(window)
	})
	offMinimise := window.OnWindowEvent(events.Common.WindowMinimise, func(*application.WindowEvent) {
		a.markWindowRoleActive(window)
	})
	offUnMinimise := window.OnWindowEvent(events.Common.WindowUnMinimise, func(*application.WindowEvent) {
		a.markWindowRoleActive(window)
	})

	a.windowRoles.mu.Lock()
	a.windowRoles.unregisters[name] = append(
		a.windowRoles.unregisters[name],
		offFocus,
		offShow,
		offMinimise,
		offUnMinimise,
	)
	a.windowRoles.mu.Unlock()
}

func (a *App) markWindowRoleActive(window application.Window) {
	if a == nil || a.windowRoles == nil || window == nil {
		return
	}
	name := windowRoleName(window)
	if name == "" {
		return
	}
	a.windowRoles.mu.Lock()
	defer a.windowRoles.mu.Unlock()
	entry, ok := a.windowRoles.entries[name]
	if !ok {
		return
	}
	entry.LastSeen = time.Now()
	entry.Window = window
	a.windowRoles.entries[name] = entry
	a.windowRoles.lastActive = name
	a.windowRoles.lastByRole[entry.Role] = name
}

func (a *App) unregisterWindowRole(window application.Window) {
	if a == nil || a.windowRoles == nil || window == nil {
		return
	}
	a.unregisterWindowRoleName(windowRoleName(window))
}

func (a *App) unregisterWindowRoleName(name string) {
	if a == nil || a.windowRoles == nil {
		return
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	a.windowRoles.mu.Lock()
	entry, ok := a.windowRoles.entries[name]
	if ok {
		delete(a.windowRoles.entries, name)
		if a.windowRoles.lastByRole[entry.Role] == name {
			delete(a.windowRoles.lastByRole, entry.Role)
		}
	}
	if a.windowRoles.lastActive == name {
		a.windowRoles.lastActive = ""
	}
	delete(a.windowRoles.unregisters, name)
	a.windowRoles.mu.Unlock()
}

func (a *App) showLastActiveWindow() bool {
	if a == nil {
		return false
	}
	if window := a.lastActiveWindow(); window != nil {
		return a.showAndFocusWindow(window)
	}
	if a.mainWindow != nil {
		return a.showAndFocusWindow(a.mainWindow)
	}
	return false
}

func (a *App) showAndFocusWindow(window application.Window) bool {
	if a == nil || window == nil {
		return false
	}
	if a.wailsApp == nil {
		if window.IsMinimised() {
			window.UnMinimise()
		}
		window.Show()
		window.Focus()
		return true
	}
	application.InvokeAsync(func() {
		a.showApplicationOnMain()
		if window.IsMinimised() {
			window.UnMinimise()
		}
		window.Show()
		window.Focus()
	})
	return true
}

func (a *App) showApplicationOnMain() {
	if a == nil || a.wailsApp == nil {
		return
	}
	_ = nativeMacOSBridgeNotify("app.show", nil)
	a.wailsApp.Show()
}

func (a *App) hideApplicationOnMain() {
	if a == nil || a.wailsApp == nil {
		return
	}
	application.InvokeAsync(func() {
		_ = nativeMacOSBridgeNotify("app.hide", nil)
		a.wailsApp.Hide()
	})
}

func (a *App) lastActiveWindow() application.Window {
	if a == nil || a.windowRoles == nil {
		return nil
	}
	a.windowRoles.mu.Lock()
	defer a.windowRoles.mu.Unlock()
	if entry, ok := a.windowRoles.entries[a.windowRoles.lastActive]; ok && entry.Window != nil {
		return entry.Window
	}
	if name := a.windowRoles.lastByRole[WindowRoleMain]; name != "" {
		if entry, ok := a.windowRoles.entries[name]; ok {
			return entry.Window
		}
	}
	for _, entry := range a.windowRoles.entries {
		if entry.Window != nil {
			return entry.Window
		}
	}
	return nil
}

func (a *App) hasVisibleWindow() bool {
	if a == nil || a.windowRoles == nil {
		return false
	}
	a.windowRoles.mu.Lock()
	defer a.windowRoles.mu.Unlock()
	for _, entry := range a.windowRoles.entries {
		if entry.Window != nil && entry.Window.IsVisible() {
			return true
		}
	}
	return false
}

func windowRoleName(window application.Window) string {
	if window == nil {
		return ""
	}
	if name := strings.TrimSpace(window.Name()); name != "" {
		return name
	}
	return fmt.Sprintf("#%d", window.ID())
}
