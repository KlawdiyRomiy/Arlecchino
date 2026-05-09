//go:build !darwin

package main

func (a *App) SetNativeWindowControlsVisible(bool) bool {
	return false
}

func (a *App) PositionNativeWindowControls(float64, float64, float64, float64, float64, float64) bool {
	return false
}

func (a *App) RefreshNativeWindowControls() bool {
	return false
}
