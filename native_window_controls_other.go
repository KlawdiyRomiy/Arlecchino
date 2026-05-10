//go:build !darwin

package main

import "context"

func (a *App) SetNativeWindowControlsVisible(context.Context, bool) bool {
	return false
}

func (a *App) PositionNativeWindowControls(context.Context, float64, float64, float64, float64, float64, float64) bool {
	return false
}

func (a *App) RefreshNativeWindowControls(context.Context) bool {
	return false
}
