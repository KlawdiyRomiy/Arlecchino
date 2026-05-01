//go:build darwin

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func (a *App) SetNativeWindowControlsVisible(visible bool) bool {
	if a == nil || a.mainWindow == nil {
		return false
	}

	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}

	a.mainWindow.SetCloseButtonState(state)
	a.mainWindow.SetMinimiseButtonState(state)
	a.mainWindow.SetMaximiseButtonState(state)
	return true
}
