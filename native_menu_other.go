//go:build !darwin

package main

func (a *App) patchNativeApplicationMenu(_ map[string][]string) {}
