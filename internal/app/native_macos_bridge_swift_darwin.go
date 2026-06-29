//go:build darwin && arle_swift_bridge

package app

/*
#cgo LDFLAGS: -L/tmp/Arlecchino-wails-build/native/macos -larlecchino_native -framework AppKit -framework Foundation -framework Security -framework UserNotifications
#include <stdbool.h>
#include <stdlib.h>

typedef void (*ArleNativeCallback)(const char*, const char*);

char* ArleNativeCall(const char* operation, const char* json);
void ArleNativeSetCallback(ArleNativeCallback callback);
void ArleNativeFree(char* value);

void ArleNativeToggleFullscreen(void);
bool ArleNativeIsFullscreen(void);
bool ArleNativePositionWindowControls(
	void* preferredWindow,
	double closeX,
	double closeY,
	double minimiseX,
	double minimiseY,
	double maximiseX,
	double maximiseY,
	bool visible,
	bool occluded
);

extern void arleNativeBridgeCallback(char* event, char* json);

static inline void arleNativeInstallCallback(void) {
	ArleNativeSetCallback((ArleNativeCallback)arleNativeBridgeCallback);
}
*/
import "C"

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"unsafe"
)

type nativeMacOSBridgeResponse struct {
	OK       bool            `json:"ok"`
	Bridge   string          `json:"bridge,omitempty"`
	Value    string          `json:"value,omitempty"`
	NotFound bool            `json:"notFound,omitempty"`
	Error    string          `json:"error,omitempty"`
	Raw      json.RawMessage `json:"-"`
}

var nativeMacOSBridgeOwner struct {
	sync.Mutex
	app *App
}

func initializeNativeMacOSBridge(app *App) {
	nativeMacOSBridgeOwner.Lock()
	nativeMacOSBridgeOwner.app = app
	nativeMacOSBridgeOwner.Unlock()
	C.arleNativeInstallCallback()
	_, _ = callNativeMacOSBridge("menu.configure", nil)
}

func nativeMacOSBridgeAvailable() bool {
	response, err := callNativeMacOSBridge("ping", nil)
	return err == nil && response.OK && response.Bridge == "swift"
}

func callNativeMacOSBridge(operation string, payload any) (nativeMacOSBridgeResponse, error) {
	operation = strings.TrimSpace(operation)
	if operation == "" {
		return nativeMacOSBridgeResponse{}, fmt.Errorf("native macOS bridge operation is empty")
	}

	var payloadJSON []byte
	var err error
	if payload == nil {
		payloadJSON = []byte("{}")
	} else {
		payloadJSON, err = json.Marshal(payload)
		if err != nil {
			return nativeMacOSBridgeResponse{}, err
		}
	}

	cOperation := C.CString(operation)
	cPayload := C.CString(string(payloadJSON))
	defer C.free(unsafe.Pointer(cOperation))
	defer C.free(unsafe.Pointer(cPayload))

	result := C.ArleNativeCall(cOperation, cPayload)
	if result == nil {
		return nativeMacOSBridgeResponse{}, fmt.Errorf("native macOS bridge returned no result for %s", operation)
	}
	defer C.ArleNativeFree(result)

	resultJSON := C.GoString(result)
	var response nativeMacOSBridgeResponse
	response.Raw = json.RawMessage(resultJSON)
	if err := json.Unmarshal([]byte(resultJSON), &response); err != nil {
		return nativeMacOSBridgeResponse{}, err
	}
	if !response.OK && response.Error != "" {
		return response, fmt.Errorf("%s", response.Error)
	}
	return response, nil
}

func nativeMacOSBridgeNotify(operation string, payload any) bool {
	response, err := callNativeMacOSBridge(operation, payload)
	return err == nil && response.OK
}

//export arleNativeBridgeCallback
func arleNativeBridgeCallback(event *C.char, payload *C.char) {
	eventName := strings.TrimSpace(C.GoString(event))
	if eventName == "" {
		return
	}
	var data map[string]any
	if payload != nil {
		_ = json.Unmarshal([]byte(C.GoString(payload)), &data)
	}
	nativeMacOSBridgeOwner.Lock()
	app := nativeMacOSBridgeOwner.app
	nativeMacOSBridgeOwner.Unlock()
	if app == nil {
		return
	}
	app.handleNativeMacOSBridgeEvent(eventName, data)
}

func (a *App) handleNativeMacOSBridgeEvent(eventName string, payload map[string]any) {
	switch strings.TrimSpace(eventName) {
	case "menu.openRecent":
		if path, _ := payload["projectPath"].(string); strings.TrimSpace(path) != "" {
			a.dispatchOpenIntent(map[string]any{
				"kind":        "openProject",
				"projectPath": strings.TrimSpace(path),
				"source":      "native-menu",
			})
			a.showLastActiveWindow()
		}
	case "menu.action":
		actionID, _ := payload["actionId"].(string)
		actionID = strings.TrimSpace(actionID)
		if actionID == "" {
			return
		}
		if window := a.currentNativeWindow(); window != nil {
			window.EmitEvent(menuActionEventName, actionID)
			return
		}
		a.emitEvent(menuActionEventName, actionID)
	case "notification.response":
		a.handleNativeNotificationBridgeResponse(payload)
	case "notification.delivered":
		a.handleNativeNotificationBridgeDelivered(payload)
	case "notification.error", "notification.denied":
		a.handleNativeNotificationBridgeFailure(eventName, payload)
	}
}
