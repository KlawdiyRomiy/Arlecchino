package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const appWillTerminateEvent = "app:will-terminate"

func registerApplicationLifecycleEvents(owner *App, wailsApp *application.App) {
	if wailsApp == nil {
		return
	}

	wailsApp.Event.OnApplicationEvent(events.Mac.ApplicationWillTerminate, func(event *application.ApplicationEvent) {
		wailsApp.Event.Emit(appWillTerminateEvent)
	})

	wailsApp.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) {})
	wailsApp.Event.RegisterApplicationEventHook(events.Mac.ApplicationShouldHandleReopen, func(event *application.ApplicationEvent) {
		if owner == nil {
			return
		}
		event.Cancel()
		if shouldFocusWindowForMacReopen(applicationEventHasVisibleWindows(event), owner.hasVisibleWindow()) {
			owner.showLastActiveWindow()
		}
	})
}

func applicationEventHasVisibleWindows(event *application.ApplicationEvent) bool {
	return event != nil && event.Context() != nil && event.Context().HasVisibleWindows()
}

func shouldRestoreWindowForMacReopen(contextHasVisibleWindows, registryHasVisibleWindow bool) bool {
	return !contextHasVisibleWindows && !registryHasVisibleWindow
}

func shouldFocusWindowForMacReopen(contextHasVisibleWindows, registryHasVisibleWindow bool) bool {
	return contextHasVisibleWindows || registryHasVisibleWindow || shouldRestoreWindowForMacReopen(contextHasVisibleWindows, registryHasVisibleWindow)
}
