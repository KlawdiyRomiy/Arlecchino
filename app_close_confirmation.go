package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const appCloseRequestedEvent = "app:close-requested"

func (a *App) SetCloseConfirmationEnabled(enabled bool) bool {
	if a == nil {
		return false
	}
	a.closeConfirmationEnabled.Store(enabled)
	if !enabled {
		a.closeConfirmationPending.Store(false)
	}
	return true
}

func (a *App) ConfirmApplicationClose() bool {
	if a == nil {
		return false
	}
	a.closeConfirmationAllowed.Store(true)
	a.closeConfirmationPending.Store(false)
	if a.wailsApp == nil {
		return false
	}
	a.wailsApp.Quit()
	return true
}

func (a *App) CancelApplicationClose() bool {
	if a == nil {
		return false
	}
	a.closeConfirmationPending.Store(false)
	return true
}

func (a *App) shouldQuitApplication() bool {
	return a.allowOrRequestApplicationClose("quit")
}

func (a *App) registerMainWindowCloseConfirmation(window *application.WebviewWindow) {
	if a == nil || window == nil {
		return
	}
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !a.allowOrRequestApplicationClose("window") {
			event.Cancel()
		}
	})
}

func (a *App) allowOrRequestApplicationClose(source string) bool {
	if a == nil {
		return true
	}
	if a.closeConfirmationAllowed.Load() || !a.closeConfirmationEnabled.Load() {
		return true
	}
	if a.closeConfirmationPending.CompareAndSwap(false, true) {
		a.emitApplicationCloseRequested(source)
	}
	return false
}

func (a *App) emitApplicationCloseRequested(source string) {
	payload := map[string]string{
		"kind":      "application",
		"source":    source,
		"sessionId": defaultProjectSessionID,
	}
	if a.mainWindow != nil {
		a.mainWindow.EmitEvent(appCloseRequestedEvent, payload)
		return
	}
	if a.wailsApp != nil {
		a.wailsApp.Event.Emit(appCloseRequestedEvent, payload)
	}
}
