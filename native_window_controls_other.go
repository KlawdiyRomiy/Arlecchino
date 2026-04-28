//go:build !darwin

package main

func (a *App) PositionNativeWindowControls(closeX, closeY, minimiseX, minimiseY, maximiseX, maximiseY float64) {
}

func (a *App) RefreshNativeWindowControls() {
}
