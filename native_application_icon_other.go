//go:build !darwin

package main

func (a *App) SetApplicationIconAppearance(string) bool {
	return false
}
