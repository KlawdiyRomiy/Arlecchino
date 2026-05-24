//go:build darwin && arle_swift_bridge

package main

/*
#include <stdbool.h>
void ArleNativeToggleFullscreen(void);
bool ArleNativeIsFullscreen(void);
*/
import "C"

func (a *App) ToggleNativeFullscreen() {
	C.ArleNativeToggleFullscreen()
}

func (a *App) IsNativeFullscreen() bool {
	return bool(C.ArleNativeIsFullscreen())
}
