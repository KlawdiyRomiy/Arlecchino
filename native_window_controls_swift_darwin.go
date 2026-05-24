//go:build darwin && arle_swift_bridge

package main

/*
#include <stdbool.h>
bool ArleNativePositionWindowControls(
	void* preferredWindow,
	double closeX,
	double closeY,
	double minimiseX,
	double minimiseY,
	double maximiseX,
	double maximiseY
);
*/
import "C"

import (
	"context"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) SetNativeWindowControlsVisible(ctx context.Context, visible bool) bool {
	window := a.nativeWindowControlsTarget(ctx)
	if window == nil {
		return false
	}

	state := application.ButtonHidden
	if visible {
		state = application.ButtonEnabled
	}

	a.updateNativeWindowControlsState(window, func(controlsState *nativeWindowControlsState) {
		controlsState.visibleSet = true
		controlsState.visible = visible
	})

	window.SetCloseButtonState(state)
	window.SetMinimiseButtonState(state)
	window.SetMaximiseButtonState(state)
	window.SetFullscreenButtonState(state)
	a.refreshNativeWindowControlsForWindow(window)
	return true
}

func (a *App) PositionNativeWindowControls(ctx context.Context, closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY float64) bool {
	window := a.nativeWindowControlsTarget(ctx)
	if window == nil {
		return false
	}

	controls := [6]float64{closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY}
	a.updateNativeWindowControlsState(window, func(controlsState *nativeWindowControlsState) {
		controlsState.controlsSet = true
		controlsState.controls = controls
	})

	return a.positionNativeWindowControls(window, controls)
}

func (a *App) RefreshNativeWindowControls(ctx context.Context) bool {
	return a.refreshNativeWindowControlsForWindow(a.nativeWindowControlsTarget(ctx))
}

func (a *App) refreshNativeWindowControlsForWindow(window application.Window) bool {
	state, ok := a.nativeWindowControlsState(window)
	if !ok || !state.controlsSet {
		return false
	}
	return a.positionNativeWindowControls(window, state.controls)
}

func (a *App) positionNativeWindowControls(window application.Window, controls [6]float64) bool {
	var nativeWindow unsafe.Pointer
	if window != nil {
		nativeWindow = window.NativeWindow()
	}
	return bool(C.ArleNativePositionWindowControls(
		nativeWindow,
		C.double(controls[0]),
		C.double(controls[1]),
		C.double(controls[2]),
		C.double(controls[3]),
		C.double(controls[4]),
		C.double(controls[5]),
	))
}
