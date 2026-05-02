//go:build !darwin

package main

func (a *App) SetNativeWindowControlsVisible(bool) bool {
	return false
}
