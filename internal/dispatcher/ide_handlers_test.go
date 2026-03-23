package dispatcher

import "testing"

func TestActionRegistry_DefaultsIncludePreviewActions(t *testing.T) {
	registry := NewActionRegistry()

	tests := []struct {
		name    string
		handler string
	}{
		{name: "Open preview", handler: "preview.open"},
		{name: "Focus preview", handler: "preview.focus"},
		{name: "Close preview", handler: "preview.close"},
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

func TestIDEEventEmitter_PreviewHandlersEmitCanonicalWindowEvents(t *testing.T) {
	action := &IDEAction{Name: "Open preview"}
	tests := []struct {
		name      string
		handler   func(*IDEEventEmitter, *IDEAction) error
		wantEvent string
		wantData  interface{}
	}{
		{
			name:      "open",
			handler:   (*IDEEventEmitter).handlePreviewOpen,
			wantEvent: "ide:window:open",
			wantData:  defaultPreviewOpenPayload(),
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
			if !equalPreviewPayload(gotData[0], tt.wantData) {
				t.Fatalf("payload = %#v, want %#v", gotData[0], tt.wantData)
			}
		})
	}
}

func equalPreviewPayload(got, want interface{}) bool {
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
			if !wantIsMap || !gotIsMap || !equalPreviewPayload(gotNested, wantNested) {
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
