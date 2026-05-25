package app

import (
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const openIntentSourceWindowFileDrop = "window-file-drop"

type windowFileDropIntentTarget interface {
	OnWindowEvent(events.WindowEventType, func(event *application.WindowEvent)) func()
	EmitEvent(name string, data ...any) bool
}

func (a *App) registerWindowFileDropIntents(window windowFileDropIntentTarget) {
	if a == nil || window == nil {
		return
	}
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		if event == nil || event.Context() == nil {
			return
		}
		a.dispatchWindowFileDropIntent(window, event.Context().DroppedFiles(), currentWorkingDir())
	})
}

func (a *App) dispatchWindowFileDropIntent(window windowFileDropIntentTarget, targets []string, workingDir string) bool {
	if a == nil || window == nil {
		return false
	}
	for _, target := range targets {
		target = strings.TrimSpace(target)
		if target == "" {
			continue
		}
		payload, ok := inferOpenIntentFromLaunchTarget(target, workingDir, 0)
		if !ok {
			traceOpenIntent("rejected", map[string]any{
				"source": openIntentSourceWindowFileDrop,
				"target": target,
			})
			continue
		}
		prepared, allowed := a.prepareExternalOpenIntent(payload, openIntentSourceWindowFileDrop, workingDir)
		if !allowed {
			traceOpenIntent("rejected", map[string]any{
				"source": openIntentSourceWindowFileDrop,
				"target": target,
				"reason": "external intent validation rejected payload",
			})
			continue
		}
		traceOpenIntent("emitted", prepared)
		return window.EmitEvent(openIntentEventName, cloneOpenIntentPayload(prepared))
	}
	return false
}
