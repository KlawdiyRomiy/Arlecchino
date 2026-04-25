//go:build !darwin

package main

import wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

func (a *App) ToggleNativeFullscreen() {
	if a.ctx == nil {
		return
	}
	if wailsruntime.WindowIsFullscreen(a.ctx) {
		wailsruntime.WindowUnfullscreen(a.ctx)
		return
	}
	wailsruntime.WindowFullscreen(a.ctx)
}

func (a *App) IsNativeFullscreen() bool {
	if a.ctx == nil {
		return false
	}
	return wailsruntime.WindowIsFullscreen(a.ctx)
}
