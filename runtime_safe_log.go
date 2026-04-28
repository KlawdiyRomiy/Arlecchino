package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
)

var runtimeEventsEmit = func(_ context.Context, name string, data ...interface{}) {
	if app := application.Get(); app != nil {
		app.Event.Emit(name, data...)
	}
}

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
		if a.wailsApp != nil && a.wailsApp.Logger != nil {
			a.wailsApp.Logger.Debug(fmt.Sprintf(format, args...))
		}
	})
}

func (a *App) logWarning(message string) {
	a.safeRuntimeCall(func() {
		if a.wailsApp != nil && a.wailsApp.Logger != nil {
			a.wailsApp.Logger.Warn(message)
			return
		}
		slog.Warn(message)
	})
}

func (a *App) emitEvent(name string, data ...any) {
	a.safeRuntimeCall(func() {
		runtimeEventsEmit(a.ctx, name, data...)
	})
}

func (a *App) onEvent(name string, callback func(data ...interface{})) func() {
	if a == nil || a.wailsApp == nil {
		return func() {}
	}
	return a.wailsApp.Event.On(name, func(event *application.CustomEvent) {
		if callback == nil {
			return
		}
		if event == nil {
			callback()
			return
		}
		if values, ok := event.Data.([]interface{}); ok {
			callback(values...)
			return
		}
		callback(event.Data)
	})
}
