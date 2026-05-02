package main

import (
	"net/url"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type fakeProjectWindow struct {
	shown   bool
	focused bool
}

func (f *fakeProjectWindow) Show() application.Window {
	f.shown = true
	return nil
}

func (f *fakeProjectWindow) Focus() {
	f.focused = true
}

func (f *fakeProjectWindow) OnWindowEvent(events.WindowEventType, func(event *application.WindowEvent)) func() {
	return func() {}
}

func (f *fakeProjectWindow) EmitEvent(string, ...any) bool {
	return false
}

func TestBuildProjectSessionURLUsesSessionParam(t *testing.T) {
	rawURL := buildProjectSessionURL("project-session-7")
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse project session URL: %v", err)
	}
	if parsed.Query().Get(projectSessionRouteParam) != "project-session-7" {
		t.Fatalf("URL %q is missing project session param", rawURL)
	}
	if parsed.Query().Get("arleProjectWindow") != "" {
		t.Fatalf("URL %q uses removed project-window launch param", rawURL)
	}
}

func TestProjectWindowLaunchDoesNotBypassSingleInstance(t *testing.T) {
	t.Setenv(envEnableSingleInstanceSpike, "1")

	if !singleInstanceEnabledForLaunchArgs([]string{"Arlecchino", "--open-project", t.TempDir()}) {
		t.Fatal("normal open-project launch did not enable single-instance")
	}
}

func TestOpenProjectWindowCreatesInProcessWailsWindow(t *testing.T) {
	projectPath := t.TempDir()
	app := NewApp()

	var gotOptions application.WebviewWindowOptions
	fakeWindow := &fakeProjectWindow{}
	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		gotOptions = options
		return fakeWindow, nil
	}
	defer func() {
		newProjectWebviewWindow = previousFactory
	}()

	result, err := app.OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("OpenProjectWindow returned error: %v", err)
	}
	defer app.closeProjectWindowSession(result.SessionID)
	if !result.Handled || result.ProjectPath != filepath.Clean(projectPath) || result.SessionID == "" {
		t.Fatalf("result = %#v, want handled session result", result)
	}
	if result.Reused {
		t.Fatal("first project window was marked as reused")
	}
	if gotOptions.Name != result.WindowName {
		t.Fatalf("window name = %q, want %q", gotOptions.Name, result.WindowName)
	}
	if gotOptions.URL != buildProjectSessionURL(result.SessionID) {
		t.Fatalf("window URL = %q, want project session URL", gotOptions.URL)
	}
	if gotOptions.Mac.TitleBar != mainWindowMacOptions().TitleBar {
		t.Fatalf("project window titlebar = %v, want main titlebar", gotOptions.Mac.TitleBar)
	}
	if !hasMacWindowCollectionBehavior(gotOptions.Mac.CollectionBehavior, application.MacWindowCollectionBehaviorParticipatesInCycle) {
		t.Fatal("project window does not participate in macOS window cycle")
	}
	if !fakeWindow.shown || !fakeWindow.focused {
		t.Fatalf("fake window shown=%v focused=%v, want both true", fakeWindow.shown, fakeWindow.focused)
	}

	payload, err := app.GetProjectWindowSession(result.SessionID)
	if err != nil {
		t.Fatalf("GetProjectWindowSession returned error: %v", err)
	}
	if payload.ProjectPath != filepath.Clean(projectPath) || payload.SessionID != result.SessionID {
		t.Fatalf("payload = %#v, want project session payload", payload)
	}
}

func TestOpenProjectWindowValidatesAccessBeforeCreatingWindow(t *testing.T) {
	app := NewApp()
	var createCount int
	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		createCount++
		return &fakeProjectWindow{}, nil
	}
	defer func() {
		newProjectWebviewWindow = previousFactory
	}()

	_, err := app.OpenProjectWindow(filepath.Join(t.TempDir(), "missing"))
	if err == nil {
		t.Fatal("OpenProjectWindow accepted an inaccessible path")
	}
	if createCount != 0 {
		t.Fatalf("window create count = %d, want 0", createCount)
	}
}
