package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const appWillTerminateEvent = "app:will-terminate"

func registerApplicationLifecycleEvents(wailsApp *application.App) {
	if wailsApp == nil {
		return
	}

	wailsApp.Event.OnApplicationEvent(events.Mac.ApplicationWillTerminate, func(event *application.ApplicationEvent) {
		wailsApp.Event.Emit(appWillTerminateEvent)
	})
}
