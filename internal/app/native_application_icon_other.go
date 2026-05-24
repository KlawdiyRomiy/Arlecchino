//go:build !darwin

package app

func (a *App) SetApplicationIconAppearance(string) bool {
	return false
}
