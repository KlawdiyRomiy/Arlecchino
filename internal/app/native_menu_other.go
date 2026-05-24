//go:build !darwin

package app

func (a *App) patchNativeApplicationMenu(_ map[string][]string) {}
