package main

import "github.com/wailsapp/wails/v2/pkg/runtime"

func (a *App) safeRuntimeCall(call func()) {
	if a == nil || a.ctx == nil {
		return
	}
	defer func() {
		_ = recover()
	}()
	call()
}

func (a *App) logDebugf(format string, args ...any) {
	a.safeRuntimeCall(func() {
		runtime.LogDebugf(a.ctx, format, args...)
	})
}

func (a *App) logWarning(message string) {
	a.safeRuntimeCall(func() {
		runtime.LogWarning(a.ctx, message)
	})
}

func (a *App) emitEvent(name string, data ...any) {
	a.safeRuntimeCall(func() {
		runtime.EventsEmit(a.ctx, name, data...)
	})
}
