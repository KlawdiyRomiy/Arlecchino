package dispatcher

import (
	"reflect"
	"testing"
)

func TestActionRegistry_DefaultsIncludeModernIDEActions(t *testing.T) {
	registry := NewActionRegistry()

	tests := []struct {
		name    string
		handler string
	}{
		{name: "Open Run Dialog", handler: "panel.run"},
		{name: "Open Debug Dialog", handler: "panel.debug"},
		{name: "Open Problems Panel", handler: "panel.problems"},
		{name: "Toggle Browser Preview", handler: "shortcut.browser.preview"},
		{name: "Toggle Window Full Screen", handler: "shortcut.window.toggleFullscreen"},
		{name: "Move Left Panel to Right Side", handler: "panel.move.leftToRight"},
		{name: "Move Browser Preview Top", handler: "preview.move.top"},
		{name: "Git Status", handler: "git.status"},
	}

	for _, tt := range tests {
		t.Run(tt.handler, func(t *testing.T) {
			action := registry.Get(tt.name)
			if action == nil {
				t.Fatalf("Get(%q) returned nil", tt.name)
			}
			if action.Handler != tt.handler {
				t.Fatalf("Handler = %q, want %q", action.Handler, tt.handler)
			}
		})
	}
}

func TestActionRegistry_DefaultsExcludeMisleadingWriteActions(t *testing.T) {
	registry := NewActionRegistry()
	riskyActions := []string{
		"Git Commit",
		"Git Pull",
		"Git Push",
		"Save File",
		"Save All Files",
		"Format Document",
		"Reload",
	}

	for _, name := range riskyActions {
		if action := registry.Get(name); action != nil {
			t.Fatalf("Get(%q) = %#v, want nil", name, action)
		}
	}
}

func TestActionRegistry_CommandPaletteShortcutIsCurrent(t *testing.T) {
	registry := NewActionRegistry()
	action := registry.Get("Open Command Palette")
	if action == nil {
		t.Fatal("Open Command Palette action missing")
	}
	if action.Keybinding != "cmd+shift+f" {
		t.Fatalf("Keybinding = %q, want cmd+shift+f", action.Keybinding)
	}
}

func TestDispatcher_AIQuerySuggestionsUseLiveLauncherModes(t *testing.T) {
	dispatcher := New(DefaultConfig())
	result := dispatcher.Dispatch("@ai")
	if !result.Success {
		t.Fatalf("Dispatch(@ai) success = false, error = %q", result.Error)
	}
	if len(result.Items) == 0 {
		t.Fatal("Dispatch(@ai) returned no AI suggestions")
	}
	hasChat := false
	for _, item := range result.Items {
		if item.ID == "ai-unavailable" || item.Title == "AI недоступен" {
			t.Fatalf("stale unavailable AI suggestion returned: %#v", item)
		}
		if item.Title == "@ai /ask" || item.Title == "@ai /general" {
			t.Fatalf("legacy AI alias leaked into suggestions: %#v", item)
		}
		if item.Title == "@ai /chat" {
			hasChat = true
		}
	}
	if !hasChat {
		t.Fatalf("chat AI suggestion missing: %#v", result.Items)
	}
}

func TestIDEEventEmitter_PreviewHandlersEmitCanonicalEvents(t *testing.T) {
	action := &IDEAction{Name: "Open Browser Preview"}
	tests := []struct {
		name      string
		handler   func(*IDEEventEmitter, *IDEAction) error
		wantEvent string
		wantData  interface{}
	}{
		{
			name:      "open",
			handler:   (*IDEEventEmitter).handlePreviewOpen,
			wantEvent: "ide:panel:open",
			wantData:  "browser",
		},
		{
			name:      "focus",
			handler:   (*IDEEventEmitter).handlePreviewFocus,
			wantEvent: "ide:window:focus",
			wantData:  defaultPreviewWindowIDPayload(),
		},
		{
			name:      "close",
			handler:   (*IDEEventEmitter).handlePreviewClose,
			wantEvent: "ide:window:close",
			wantData:  defaultPreviewWindowIDPayload(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotEvent string
			var gotData []interface{}
			emitter := &IDEEventEmitter{
				emitFn: func(event string, data ...interface{}) error {
					gotEvent = event
					gotData = append(gotData[:0], data...)
					return nil
				},
			}

			if err := tt.handler(emitter, action); err != nil {
				t.Fatalf("handler() error = %v", err)
			}
			if gotEvent != tt.wantEvent {
				t.Fatalf("event = %q, want %q", gotEvent, tt.wantEvent)
			}
			if len(gotData) != 1 {
				t.Fatalf("len(data) = %d, want 1", len(gotData))
			}
			if !equalPayload(gotData[0], tt.wantData) {
				t.Fatalf("payload = %#v, want %#v", gotData[0], tt.wantData)
			}
		})
	}
}

func TestIDEEventEmitter_MenuAndMoveHandlersEmitCanonicalEvents(t *testing.T) {
	action := &IDEAction{Name: "Toggle Browser Preview"}
	tests := []struct {
		name      string
		handler   func(*IDEEventEmitter) ActionHandler
		wantEvent string
		wantData  interface{}
	}{
		{
			name:      "shortcut menu action",
			handler:   func(emitter *IDEEventEmitter) ActionHandler { return emitter.handleMenuAction("browser.preview") },
			wantEvent: "ide:menu:action",
			wantData:  "browser.preview",
		},
		{
			name:      "side panel move",
			handler:   func(emitter *IDEEventEmitter) ActionHandler { return emitter.handleMovePanelSide("left", "right") },
			wantEvent: "ide:panel:move",
			wantData:  map[string]any{"from": "left", "to": "right"},
		},
		{
			name:      "browser preview move",
			handler:   func(emitter *IDEEventEmitter) ActionHandler { return emitter.handleMoveBrowserPreview("top") },
			wantEvent: "ide:panel:move",
			wantData:  map[string]any{"panel": "browser", "position": "top"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotEvent string
			var gotData []interface{}
			emitter := &IDEEventEmitter{
				emitFn: func(event string, data ...interface{}) error {
					gotEvent = event
					gotData = append(gotData[:0], data...)
					return nil
				},
			}

			if err := tt.handler(emitter)(action); err != nil {
				t.Fatalf("handler() error = %v", err)
			}
			if gotEvent != tt.wantEvent {
				t.Fatalf("event = %q, want %q", gotEvent, tt.wantEvent)
			}
			if len(gotData) != 1 {
				t.Fatalf("len(data) = %d, want 1", len(gotData))
			}
			if !equalPayload(gotData[0], tt.wantData) {
				t.Fatalf("payload = %#v, want %#v", gotData[0], tt.wantData)
			}
		})
	}
}

func equalPayload(got, want interface{}) bool {
	if reflect.DeepEqual(got, want) {
		return true
	}

	gotMap, ok := got.(map[string]any)
	if !ok {
		return false
	}
	wantMap, ok := want.(map[string]any)
	if !ok {
		return false
	}
	if len(gotMap) != len(wantMap) {
		return false
	}
	for key, wantValue := range wantMap {
		gotValue, exists := gotMap[key]
		if !exists {
			return false
		}
		wantNested, wantIsMap := wantValue.(map[string]any)
		gotNested, gotIsMap := gotValue.(map[string]any)
		if wantIsMap || gotIsMap {
			if !wantIsMap || !gotIsMap || !equalPayload(gotNested, wantNested) {
				return false
			}
			continue
		}
		if gotValue != wantValue {
			return false
		}
	}
	return true
}
