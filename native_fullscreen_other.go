//go:build !darwin

package main

func (a *App) ToggleNativeFullscreen() {
	if a == nil || a.mainWindow == nil {
		return
	}
	if a.mainWindow.IsFullscreen() {
		a.mainWindow.UnFullscreen()
		return
	}
	a.mainWindow.Fullscreen()
}

func (a *App) IsNativeFullscreen() bool {
	if a == nil || a.mainWindow == nil {
		return false
	}
	return a.mainWindow.IsFullscreen()
}
