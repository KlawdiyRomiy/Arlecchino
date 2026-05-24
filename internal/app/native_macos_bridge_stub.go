//go:build !darwin || !arle_swift_bridge

package app

import "fmt"

type nativeMacOSBridgeResponse struct {
	OK       bool
	Bridge   string
	Value    string
	NotFound bool
	Error    string
}

func initializeNativeMacOSBridge(app *App) {}

func nativeMacOSBridgeAvailable() bool {
	return false
}

func callNativeMacOSBridge(operation string, payload any) (nativeMacOSBridgeResponse, error) {
	return nativeMacOSBridgeResponse{}, fmt.Errorf("native macOS Swift bridge is unavailable")
}

func nativeMacOSBridgeNotify(operation string, payload any) bool {
	return false
}
