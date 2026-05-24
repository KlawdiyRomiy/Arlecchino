package main

const (
	openIntentEventName         = "ide:intent:open"
	openIntentFrontendReadyName = "ide:frontend:ready"
	maxPendingOpenIntents       = 32
)

func cloneOpenIntentPayload(payload map[string]any) map[string]any {
	clone := make(map[string]any, len(payload))
	for key, value := range payload {
		clone[key] = value
	}
	return clone
}

func (a *App) startOpenIntentBridge() {
	if a == nil {
		return
	}

	a.onEvent(openIntentFrontendReadyName, func(data ...interface{}) {
		a.markOpenIntentFrontendReady()
	})
	if singleInstanceEnabled() {
		a.dispatchInitialLaunchOpenIntent()
	}
}

func (a *App) markOpenIntentFrontendReady() {
	if a == nil {
		return
	}

	a.openIntentMu.Lock()
	a.openIntentReady = true
	pending := make([]map[string]any, len(a.pendingOpenIntents))
	copy(pending, a.pendingOpenIntents)
	a.pendingOpenIntents = nil
	a.openIntentMu.Unlock()

	for _, payload := range pending {
		a.emitOpenIntentNow(payload)
	}
}

func (a *App) dispatchOpenIntent(payload map[string]any) {
	if a == nil || len(payload) == 0 {
		return
	}

	a.openIntentMu.Lock()
	if !a.openIntentReady {
		if len(a.pendingOpenIntents) >= maxPendingOpenIntents {
			a.pendingOpenIntents = a.pendingOpenIntents[1:]
		}
		a.pendingOpenIntents = append(a.pendingOpenIntents, cloneOpenIntentPayload(payload))
		a.openIntentMu.Unlock()
		traceOpenIntent("queued", payload)
		return
	}
	a.openIntentMu.Unlock()

	a.emitOpenIntentNow(payload)
}

func (a *App) emitOpenIntentNow(payload map[string]any) {
	if a == nil || len(payload) == 0 {
		return
	}

	traceOpenIntent("emitted", payload)
	if a.mainWindow != nil {
		a.mainWindow.EmitEvent(openIntentEventName, cloneOpenIntentPayload(payload))
		return
	}
	a.emitEvent(openIntentEventName, cloneOpenIntentPayload(payload))
}

func (a *App) focusMainWindow() {
	if a == nil {
		return
	}
	if a.showLastActiveWindow() {
		return
	}
	if a.mainWindow == nil {
		return
	}
	a.showAndFocusWindow(a.mainWindow)
}
