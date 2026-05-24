package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type fakeFileDropWindow struct {
	handlers map[events.WindowEventType]func(event *application.WindowEvent)
	emits    []fakeFileDropEmit
}

type fakeFileDropEmit struct {
	name string
	data []any
}

func (f *fakeFileDropWindow) OnWindowEvent(eventType events.WindowEventType, handler func(event *application.WindowEvent)) func() {
	if f.handlers == nil {
		f.handlers = make(map[events.WindowEventType]func(event *application.WindowEvent))
	}
	f.handlers[eventType] = handler
	return func() {
		delete(f.handlers, eventType)
	}
}

func (f *fakeFileDropWindow) EmitEvent(name string, data ...any) bool {
	f.emits = append(f.emits, fakeFileDropEmit{name: name, data: data})
	return true
}

func TestRegisterWindowFileDropIntentsRegistersWailsDropHandler(t *testing.T) {
	app := &App{}
	window := &fakeFileDropWindow{}

	app.registerWindowFileDropIntents(window)

	if window.handlers[events.Common.WindowFilesDropped] == nil {
		t.Fatal("WindowFilesDropped handler was not registered")
	}
}

func TestWindowFileDropFolderEmitsOpenProjectToReceivingWindow(t *testing.T) {
	projectPath := t.TempDir()
	window := &fakeFileDropWindow{}

	if !(&App{}).dispatchWindowFileDropIntent(window, []string{projectPath}, "/") {
		t.Fatal("dispatchWindowFileDropIntent = false, want true")
	}

	payload := requireSingleWindowFileDropPayload(t, window)
	if payload["kind"] != "openProject" || payload["projectPath"] != projectPath {
		t.Fatalf("payload = %#v, want openProject for %q", payload, projectPath)
	}
	if payload["source"] != openIntentSourceWindowFileDrop {
		t.Fatalf("source = %#v, want %q", payload["source"], openIntentSourceWindowFileDrop)
	}
}

func TestWindowFileDropFileEmitsOpenFileToReceivingWindow(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	window := &fakeFileDropWindow{}

	if !(&App{}).dispatchWindowFileDropIntent(window, []string{filePath}, "/") {
		t.Fatal("dispatchWindowFileDropIntent = false, want true")
	}

	payload := requireSingleWindowFileDropPayload(t, window)
	if payload["kind"] != "openFile" || payload["path"] != filePath {
		t.Fatalf("payload = %#v, want openFile for %q", payload, filePath)
	}
	if payload["source"] != openIntentSourceWindowFileDrop {
		t.Fatalf("source = %#v, want %q", payload["source"], openIntentSourceWindowFileDrop)
	}
}

func TestWindowFileDropEmitsFirstValidTargetOnly(t *testing.T) {
	firstProjectPath := t.TempDir()
	secondProjectPath := t.TempDir()
	window := &fakeFileDropWindow{}

	if !(&App{}).dispatchWindowFileDropIntent(window, []string{firstProjectPath, secondProjectPath}, "/") {
		t.Fatal("dispatchWindowFileDropIntent = false, want true")
	}

	payload := requireSingleWindowFileDropPayload(t, window)
	if payload["kind"] != "openProject" || payload["projectPath"] != firstProjectPath {
		t.Fatalf("payload = %#v, want first openProject target %q", payload, firstProjectPath)
	}
}

func TestWindowFileDropSkipsInvalidTargetWithoutEmit(t *testing.T) {
	window := &fakeFileDropWindow{}
	missingPath := filepath.Join(t.TempDir(), "missing")

	if (&App{}).dispatchWindowFileDropIntent(window, []string{"", missingPath}, "/") {
		t.Fatal("dispatchWindowFileDropIntent = true, want false")
	}
	if len(window.emits) != 0 {
		t.Fatalf("emits = %#v, want none", window.emits)
	}
}

func requireSingleWindowFileDropPayload(t *testing.T, window *fakeFileDropWindow) map[string]any {
	t.Helper()
	if len(window.emits) != 1 {
		t.Fatalf("emit count = %d, want 1: %#v", len(window.emits), window.emits)
	}
	emit := window.emits[0]
	if emit.name != openIntentEventName {
		t.Fatalf("emit name = %q, want %q", emit.name, openIntentEventName)
	}
	if len(emit.data) != 1 {
		t.Fatalf("emit data count = %d, want 1: %#v", len(emit.data), emit.data)
	}
	payload, ok := emit.data[0].(map[string]any)
	if !ok {
		t.Fatalf("emit payload = %#v, want map[string]any", emit.data[0])
	}
	return payload
}
