package main

import (
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	openIntentSourceOSURL  = "os-url-open"
	openIntentSourceOSFile = "os-file-open"
)

func registerOpenIntentApplicationEvents(owner *App, wailsApp *application.App) {
	if owner == nil || wailsApp == nil {
		return
	}

	wailsApp.Event.OnApplicationEvent(events.Common.ApplicationLaunchedWithUrl, func(event *application.ApplicationEvent) {
		if event == nil || event.Context() == nil {
			return
		}
		target := event.Context().URL()
		traceOpenIntentApplicationEvent(openIntentSourceOSURL, target)
		owner.dispatchOpenIntentFromOSTarget(openIntentSourceOSURL, target, currentWorkingDir())
	})

	wailsApp.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) {
		if event == nil || event.Context() == nil {
			return
		}
		context := event.Context()
		if filename := strings.TrimSpace(context.Filename()); filename != "" {
			traceOpenIntentApplicationEvent(openIntentSourceOSFile, filename)
			owner.dispatchOpenIntentFromOSTarget(openIntentSourceOSFile, filename, currentWorkingDir())
			return
		}
		for _, filename := range context.OpenedFiles() {
			if strings.TrimSpace(filename) == "" {
				continue
			}
			traceOpenIntentApplicationEvent(openIntentSourceOSFile, filename)
			owner.dispatchOpenIntentFromOSTarget(openIntentSourceOSFile, filename, currentWorkingDir())
		}
	})
}

func traceOpenIntentApplicationEvent(source string, target string) {
	traceOpenIntent("application-event", map[string]any{
		"source": strings.TrimSpace(source),
		"target": strings.TrimSpace(target),
	})
}

func (a *App) dispatchOpenIntentFromOSTarget(source string, target string, workingDir string) bool {
	source = strings.TrimSpace(source)
	target = strings.TrimSpace(target)
	if a == nil || target == "" {
		return false
	}

	payload, ok := inferOpenIntentFromLaunchTarget(target, workingDir, 0)
	if !ok {
		traceOpenIntent("rejected", map[string]any{
			"source": source,
			"target": target,
		})
		return false
	}
	payload["source"] = source
	a.focusMainWindow()
	a.dispatchOpenIntent(payload)
	return true
}
