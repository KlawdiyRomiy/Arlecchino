package main

import (
	"context"
	"net/url"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"arlecchino/internal/indexer/core"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type fakeProjectWindow struct {
	name    string
	shown   bool
	focused bool
}

func (f *fakeProjectWindow) Name() string {
	return f.name
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
	var createCount int
	fakeWindow := &fakeProjectWindow{}
	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		createCount++
		gotOptions = options
		fakeWindow.name = "actual-" + options.Name
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
	reused, err := app.OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("second OpenProjectWindow returned error: %v", err)
	}
	if !reused.Reused || reused.SessionID != result.SessionID {
		t.Fatalf("reused result = %#v, want existing pending session %q", reused, result.SessionID)
	}
	if reused.ProjectPath != filepath.Clean(projectPath) || reused.WindowName != fakeWindow.Name() {
		t.Fatalf("reused project/window = %q/%q, want %q/%q", reused.ProjectPath, reused.WindowName, filepath.Clean(projectPath), fakeWindow.Name())
	}
	if createCount != 1 {
		t.Fatalf("window create count = %d, want one window before frontend hydration", createCount)
	}
	expectedWindowName := "project:" + result.SessionID
	if gotOptions.Name != expectedWindowName {
		t.Fatalf("window name = %q, want %q", gotOptions.Name, expectedWindowName)
	}
	if result.WindowName != fakeWindow.Name() {
		t.Fatalf("result window name = %q, want actual window name %q", result.WindowName, fakeWindow.Name())
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
	session := app.projectSessionByID(result.SessionID)
	if session == nil {
		t.Fatalf("project session %q was not registered", result.SessionID)
	}
	if got := session.currentProjectPath(); got != "" {
		t.Fatalf("session current project path = %q, want deferred open before frontend hydration", got)
	}
	if session.projectManager != nil && session.projectManager.CurrentProject != nil {
		t.Fatal("project manager was opened before the project window frontend hydrated")
	}

	payload, err := app.GetProjectWindowSession(result.SessionID)
	if err != nil {
		t.Fatalf("GetProjectWindowSession returned error: %v", err)
	}
	if payload.ProjectPath != filepath.Clean(projectPath) || payload.SessionID != result.SessionID {
		t.Fatalf("payload = %#v, want project session payload", payload)
	}
	registry := app.ensureProjectSessions()
	registry.mu.RLock()
	currentSessionID := registry.windowIndex[fakeWindow.Name()]
	registry.mu.RUnlock()
	if currentSessionID != result.SessionID {
		t.Fatalf("current window resolved to %q, want session %q", currentSessionID, result.SessionID)
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

func TestGetCurrentProjectWindowSessionFallsBackToSinglePendingWindow(t *testing.T) {
	projectPath := t.TempDir()
	app := NewApp()

	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		return &fakeProjectWindow{name: "actual-" + options.Name}, nil
	}
	defer func() {
		newProjectWebviewWindow = previousFactory
	}()

	result, err := app.OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("OpenProjectWindow returned error: %v", err)
	}
	defer app.closeProjectWindowSession(result.SessionID)

	payload, err := app.GetCurrentProjectWindowSession(context.Background())
	if err != nil {
		t.Fatalf("GetCurrentProjectWindowSession returned error: %v", err)
	}
	if payload.SessionID != result.SessionID || payload.ProjectPath != filepath.Clean(projectPath) {
		t.Fatalf("payload = %#v, want pending session %q for %q", payload, result.SessionID, filepath.Clean(projectPath))
	}
}

func TestOpenProjectWindowSessionOpensExplicitSession(t *testing.T) {
	projectPath := t.TempDir()
	app := NewApp()

	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		return &fakeProjectWindow{name: "actual-" + options.Name}, nil
	}
	defer func() {
		newProjectWebviewWindow = previousFactory
	}()

	result, err := app.OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("OpenProjectWindow returned error: %v", err)
	}
	defer app.closeProjectWindowSession(result.SessionID)

	if err := app.OpenProjectWindowSession(result.SessionID, projectPath); err != nil {
		t.Fatalf("OpenProjectWindowSession returned error: %v", err)
	}
	session := app.projectSessionByID(result.SessionID)
	if session == nil {
		t.Fatalf("project session %q was not registered", result.SessionID)
	}
	if got := session.currentProjectPath(); got != filepath.Clean(projectPath) {
		t.Fatalf("session current project path = %q, want %q", got, filepath.Clean(projectPath))
	}
	if got := app.projectSessionByID(defaultProjectSessionID).currentProjectPath(); got != "" {
		t.Fatalf("default session project path = %q, want untouched", got)
	}
}

func TestProjectWindowSessionCloseWaitsForOpenLifecycle(t *testing.T) {
	projectPath := t.TempDir()
	app := NewApp()

	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		return &fakeProjectWindow{name: "actual-" + options.Name}, nil
	}
	defer func() {
		newProjectWebviewWindow = previousFactory
	}()

	result, err := app.OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("OpenProjectWindow returned error: %v", err)
	}

	previousNewCoreEngine := newCoreEngine
	engineCreateStarted := make(chan struct{})
	releaseEngineCreate := make(chan struct{})
	var releaseOnce sync.Once
	releaseEngine := func() {
		releaseOnce.Do(func() {
			close(releaseEngineCreate)
		})
	}
	newCoreEngine = func(cfg core.EngineConfig) (*core.Engine, error) {
		close(engineCreateStarted)
		<-releaseEngineCreate
		return previousNewCoreEngine(cfg)
	}
	defer func() {
		releaseEngine()
		newCoreEngine = previousNewCoreEngine
	}()

	openDone := make(chan error, 1)
	go func() {
		openDone <- app.OpenProjectWindowSession(result.SessionID, projectPath)
	}()

	select {
	case <-engineCreateStarted:
	case <-time.After(time.Second):
		t.Fatal("OpenProjectWindowSession did not reach engine creation")
	}

	closeDone := make(chan struct{})
	go func() {
		app.closeProjectWindowSession(result.SessionID)
		close(closeDone)
	}()

	select {
	case <-closeDone:
		t.Fatal("project window session closed while project open lifecycle was still running")
	case <-time.After(50 * time.Millisecond):
	}

	releaseEngine()

	select {
	case err := <-openDone:
		if err != nil {
			t.Fatalf("OpenProjectWindowSession returned error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("OpenProjectWindowSession did not finish after engine creation was released")
	}

	select {
	case <-closeDone:
	case <-time.After(time.Second):
		t.Fatal("project window session close did not finish after project open completed")
	}
}

func TestOpenProjectWindowSessionRejectsMismatchedProject(t *testing.T) {
	projectPath := t.TempDir()
	otherPath := t.TempDir()
	app := NewApp()

	previousFactory := newProjectWebviewWindow
	newProjectWebviewWindow = func(_ *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
		return &fakeProjectWindow{name: "actual-" + options.Name}, nil
	}
	defer func() {
		newProjectWebviewWindow = previousFactory
	}()

	result, err := app.OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("OpenProjectWindow returned error: %v", err)
	}
	defer app.closeProjectWindowSession(result.SessionID)

	if err := app.OpenProjectWindowSession(result.SessionID, otherPath); err == nil {
		t.Fatal("OpenProjectWindowSession accepted a project path that does not match the session launch path")
	}
}
