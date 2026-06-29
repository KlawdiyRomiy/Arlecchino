//go:build !darwin

package app

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func (a *App) SetNativeWindowControlsVisible(context.Context, bool) bool {
	return false
}

func (a *App) SetNativeWindowControlsOccluded(context.Context, bool) bool {
	return false
}

func (a *App) PositionNativeWindowControls(context.Context, float64, float64, float64, float64, float64, float64) bool {
	return false
}

func (a *App) RefreshNativeWindowControls(context.Context) bool {
	return false
}

func (a *App) refreshNativeWindowControlsForWindow(application.Window) bool {
	return false
}
