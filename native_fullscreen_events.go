package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const nativeFullscreenChangedEvent = "shell:native-fullscreen-changed"

type nativeFullscreenEventWindow interface {
	OnWindowEvent(events.WindowEventType, func(event *application.WindowEvent)) func()
	EmitEvent(name string, data ...any) bool
}

func registerNativeFullscreenEvents(window nativeFullscreenEventWindow) {
	if window == nil {
		return
	}

	window.OnWindowEvent(events.Common.WindowFullscreen, func(_ *application.WindowEvent) {
		window.EmitEvent(nativeFullscreenChangedEvent, map[string]bool{"fullscreen": true})
	})
	window.OnWindowEvent(events.Common.WindowUnFullscreen, func(_ *application.WindowEvent) {
		window.EmitEvent(nativeFullscreenChangedEvent, map[string]bool{"fullscreen": false})
	})
}
