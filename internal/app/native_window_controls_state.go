package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type nativeWindowControlsState struct {
	visibleSet  bool
	visible     bool
	controlsSet bool
	controls    [6]float64
}

func nativeWindowControlsStateKey(window application.Window) string {
	if window == nil {
		return ""
	}
	if name := strings.TrimSpace(window.Name()); name != "" {
		return name
	}
	return fmt.Sprintf("#%d", window.ID())
}

func (a *App) nativeWindowControlsTarget(ctx context.Context) application.Window {
	if a == nil {
		return nil
	}
	if window := bindingContextWindow(ctx); window != nil {
		return window
	}
	if a.wailsApp != nil {
		if window := a.wailsApp.Window.Current(); window != nil {
			return window
		}
	}
	if a.mainWindow != nil {
		return a.mainWindow
	}
	return nil
}

func (a *App) updateNativeWindowControlsState(window application.Window, update func(*nativeWindowControlsState)) {
	if a == nil || window == nil || update == nil {
		return
	}
	key := nativeWindowControlsStateKey(window)
	if key == "" {
		return
	}

	a.nativeControlsMu.Lock()
	defer a.nativeControlsMu.Unlock()
	if a.nativeControlsByWindow == nil {
		a.nativeControlsByWindow = make(map[string]nativeWindowControlsState)
	}
	state := a.nativeControlsByWindow[key]
	update(&state)
	a.nativeControlsByWindow[key] = state
}

func (a *App) nativeWindowControlsState(window application.Window) (nativeWindowControlsState, bool) {
	if a == nil || window == nil {
		return nativeWindowControlsState{}, false
	}
	key := nativeWindowControlsStateKey(window)
	if key == "" {
		return nativeWindowControlsState{}, false
	}

	a.nativeControlsMu.Lock()
	defer a.nativeControlsMu.Unlock()
	state, ok := a.nativeControlsByWindow[key]
	return state, ok
}

func (a *App) clearNativeWindowControlsStateForWindowName(windowName string) {
	if a == nil {
		return
	}
	windowName = strings.TrimSpace(windowName)
	if windowName == "" {
		return
	}

	a.nativeControlsMu.Lock()
	defer a.nativeControlsMu.Unlock()
	delete(a.nativeControlsByWindow, windowName)
}
