package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type nativeWindowControlsState struct {
	visibleSet      bool
	visible         bool
	insetSet        bool
	inset           nativeWindowControlsInset
	transientHidden bool
	transientSeq    uint64
}

type nativeWindowControlsInset struct {
	closeCenterX  float64
	buttonCenterY float64
}

var nativeWindowControlsMoveRefreshDelays = [...]time.Duration{
	16 * time.Millisecond,
	75 * time.Millisecond,
	250 * time.Millisecond,
}

const (
	nativeWindowControlsTransientEvent         = "shell:native-window-controls-transient"
	nativeWindowControlsTransientSettleDelay   = 220 * time.Millisecond
	nativeWindowControlsTransientWatchdogDelay = 30 * time.Second
)

type nativeWindowControlsTransientPayload struct {
	Active bool `json:"active"`
}

func nativeWindowControlsVisible(state nativeWindowControlsState) bool {
	return (!state.visibleSet || state.visible) && !state.transientHidden
}

func nativeWindowControlsStateKey(window application.Window) string {
	if window == nil {
		return ""
	}
	if name := strings.TrimSpace(window.Name()); name != "" {
		return name
	}
	return fmt.Sprintf("#%d", window.ID())
}

func (a *App) nativeWindowControlsTarget(ctx context.Context) application.Window {
	if a == nil {
		return nil
	}
	if window := bindingContextWindow(ctx); window != nil {
		return window
	}
	if a.wailsApp != nil {
		if window := a.wailsApp.Window.Current(); window != nil {
			return window
		}
	}
	if a.mainWindow != nil {
		return a.mainWindow
	}
	return nil
}

func (a *App) updateNativeWindowControlsState(window application.Window, update func(*nativeWindowControlsState)) {
	if a == nil || window == nil || update == nil {
		return
	}
	key := nativeWindowControlsStateKey(window)
	if key == "" {
		return
	}

	a.nativeControlsMu.Lock()
	defer a.nativeControlsMu.Unlock()
	if a.nativeControlsByWindow == nil {
		a.nativeControlsByWindow = make(map[string]nativeWindowControlsState)
	}
	state := a.nativeControlsByWindow[key]
	update(&state)
	a.nativeControlsByWindow[key] = state
}

func (a *App) nativeWindowControlsState(window application.Window) (nativeWindowControlsState, bool) {
	if a == nil || window == nil {
		return nativeWindowControlsState{}, false
	}
	key := nativeWindowControlsStateKey(window)
	if key == "" {
		return nativeWindowControlsState{}, false
	}

	a.nativeControlsMu.Lock()
	defer a.nativeControlsMu.Unlock()
	state, ok := a.nativeControlsByWindow[key]
	return state, ok
}

func (a *App) nativeWindowControlsVisible(window application.Window) bool {
	state, ok := a.nativeWindowControlsState(window)
	if !ok {
		return true
	}
	return nativeWindowControlsVisible(state)
}

func (a *App) setNativeWindowControlsTransientHidden(window application.Window, hidden bool) uint64 {
	if a == nil || window == nil {
		return 0
	}
	key := nativeWindowControlsStateKey(window)
	if key == "" {
		return 0
	}

	var seq uint64
	changed := false
	a.nativeControlsMu.Lock()
	if a.nativeControlsByWindow == nil {
		a.nativeControlsByWindow = make(map[string]nativeWindowControlsState)
	}
	state := a.nativeControlsByWindow[key]
	changed = state.transientHidden != hidden
	state.transientHidden = hidden
	state.transientSeq++
	seq = state.transientSeq
	a.nativeControlsByWindow[key] = state
	a.nativeControlsMu.Unlock()

	a.refreshNativeWindowControlsForWindow(window)
	if changed {
		a.emitEvent(nativeWindowControlsTransientEvent, nativeWindowControlsTransientPayload{Active: hidden})
	}
	return seq
}

func (a *App) clearNativeWindowControlsTransientHidden(window application.Window, seq uint64) bool {
	if a == nil || window == nil || seq == 0 {
		return false
	}
	key := nativeWindowControlsStateKey(window)
	if key == "" {
		return false
	}

	changed := false
	a.nativeControlsMu.Lock()
	state, ok := a.nativeControlsByWindow[key]
	if ok && state.transientHidden && state.transientSeq == seq {
		state.transientHidden = false
		state.transientSeq++
		a.nativeControlsByWindow[key] = state
		changed = true
	}
	a.nativeControlsMu.Unlock()

	if !changed {
		return false
	}
	a.refreshNativeWindowControlsForWindow(window)
	a.emitEvent(nativeWindowControlsTransientEvent, nativeWindowControlsTransientPayload{Active: false})
	return true
}

func (a *App) scheduleNativeWindowControlsRefresh(window application.Window) {
	if a == nil || window == nil {
		return
	}

	a.refreshNativeWindowControlsForWindow(window)
	for _, delay := range nativeWindowControlsMoveRefreshDelays {
		delay := delay
		time.AfterFunc(delay, func() {
			a.refreshNativeWindowControlsForWindow(window)
		})
	}
}

func (a *App) refreshNativeWindowControlsDuringMove(window application.Window) {
	a.scheduleNativeWindowControlsRefresh(window)
}

func (a *App) refreshNativeWindowControlsAfterMove(window application.Window) {
	a.scheduleNativeWindowControlsRefresh(window)
	time.AfterFunc(nativeWindowControlsTransientSettleDelay, func() {
		a.refreshNativeWindowControlsForWindow(window)
	})
}

func (a *App) registerNativeWindowControlsLifecycle(window application.Window) {
	if a == nil || window == nil {
		return
	}

	refresh := func(*application.WindowEvent) {
		a.refreshNativeWindowControlsForWindow(window)
	}
	refreshDuringMove := func(*application.WindowEvent) {
		a.refreshNativeWindowControlsDuringMove(window)
	}
	refreshAfterMove := func(*application.WindowEvent) {
		a.refreshNativeWindowControlsAfterMove(window)
	}
	window.OnWindowEvent(events.Common.WindowDidResize, refreshAfterMove)
	window.OnWindowEvent(events.Mac.WindowWillMove, refreshDuringMove)
	window.OnWindowEvent(events.Mac.WindowWillResize, refreshDuringMove)
	window.OnWindowEvent(events.Common.WindowDidMove, refreshAfterMove)
	window.OnWindowEvent(events.Common.WindowMaximise, refreshAfterMove)
	window.OnWindowEvent(events.Common.WindowUnMaximise, refreshAfterMove)
	window.OnWindowEvent(events.Common.WindowFullscreen, refresh)
	window.OnWindowEvent(events.Common.WindowUnFullscreen, refresh)
	window.OnWindowEvent(events.Common.WindowShow, refresh)
	window.OnWindowEvent(events.Common.WindowFocus, refresh)
}

func (a *App) clearNativeWindowControlsStateForWindowName(windowName string) {
	if a == nil {
		return
	}
	windowName = strings.TrimSpace(windowName)
	if windowName == "" {
		return
	}

	a.nativeControlsMu.Lock()
	defer a.nativeControlsMu.Unlock()
	delete(a.nativeControlsByWindow, windowName)
}
