package app

import (
	"context"
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const projectSessionRouteParam = "arleProjectSession"
const projectWindowClosingEvent = "project-window:closing"

const (
	defaultProjectWindowWidth  = 1440
	defaultProjectWindowHeight = 900
)

type ProjectWindowLaunchResult struct {
	Handled     bool   `json:"handled"`
	ProjectPath string `json:"projectPath"`
	SessionID   string `json:"sessionId"`
	WindowName  string `json:"windowName"`
	Reused      bool   `json:"reused"`
}

type ProjectWindowSessionPayload struct {
	SessionID   string `json:"sessionId"`
	ProjectPath string `json:"projectPath"`
	WindowName  string `json:"windowName"`
}

type ProjectWindowClosingPayload struct {
	SessionID   string `json:"sessionId"`
	ProjectPath string `json:"projectPath"`
	WindowName  string `json:"windowName"`
}

type projectWindowHandle interface {
	Name() string
	Show() application.Window
	Focus()
	Fullscreen() application.Window
	Maximise() application.Window
	OnWindowEvent(events.WindowEventType, func(event *application.WindowEvent)) func()
	EmitEvent(name string, data ...any) bool
}

type projectWindowStateSource interface {
	Size() (width int, height int)
	Position() (x int, y int)
	IsFullscreen() bool
	IsMaximised() bool
}

type projectWindowLaunchState struct {
	width       int
	height      int
	x           int
	y           int
	hasPosition bool
	startState  application.WindowState
}

var newProjectWebviewWindow = func(app *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
	if app == nil || app.wailsApp == nil {
		return nil, fmt.Errorf("wails application is not initialized")
	}
	return app.wailsApp.Window.NewWithOptions(options), nil
}

func (a *App) OpenProjectWindow(path string) (ProjectWindowLaunchResult, error) {
	return a.openProjectWindow(path, a.activeProjectSession())
}

func (a *App) OpenProjectWindowForProjectSession(sessionID string, path string) (ProjectWindowLaunchResult, error) {
	sourceSession, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return ProjectWindowLaunchResult{}, err
	}
	return a.openProjectWindow(path, sourceSession)
}

func (a *App) openProjectWindow(path string, sourceSession *ProjectRuntimeSession) (ProjectWindowLaunchResult, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if err := validateProjectOpenAccess(path); err != nil {
		return ProjectWindowLaunchResult{}, err
	}

	registry := a.ensureProjectSessions()
	if existing := registry.findSessionByPath(path); existing != nil {
		a.focusProjectSessionWindow(existing)
		return ProjectWindowLaunchResult{
			Handled:     true,
			ProjectPath: existing.projectWindowProjectPath(),
			SessionID:   existing.ID,
			WindowName:  existing.WindowName,
			Reused:      true,
		}, nil
	}

	sessionID := a.nextProjectWindowSessionID()
	windowName := "project:" + sessionID
	session := newProjectRuntimeSession(sessionID, windowName)
	session.launchProjectPath = path
	registry.register(session)

	windowURL := buildProjectSessionURL(sessionID)
	launchState := a.projectWindowLaunchStateForSession(sourceSession)
	options := application.WebviewWindowOptions{
		Name:                  windowName,
		Title:                 "Arlecchino - " + filepath.Base(path),
		Width:                 launchState.width,
		Height:                launchState.height,
		MinWidth:              1024,
		MinHeight:             768,
		Frameless:             runtime.GOOS != "darwin",
		URL:                   windowURL,
		StartState:            launchState.startState,
		UseApplicationMenu:    true,
		EnableFileDrop:        true,
		BackgroundType:        application.BackgroundTypeTransparent,
		BackgroundColour:      application.NewRGBA(10, 10, 10, 0),
		MinimiseButtonState:   webviewOwnedWindowButtonState(),
		MaximiseButtonState:   webviewOwnedWindowButtonState(),
		CloseButtonState:      webviewOwnedWindowButtonState(),
		FullscreenButtonState: webviewOwnedWindowButtonState(),
		Mac:                   mainWindowMacOptions(),
		Windows: application.WindowsWindow{
			DisableIcon: false,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	}
	applyProjectWindowLaunchPosition(&options, launchState)
	window, err := newProjectWebviewWindow(a, options)
	if err != nil {
		registry.remove(sessionID)
		return ProjectWindowLaunchResult{}, err
	}
	registry.attachWindowName(sessionID, window.Name())
	actualWindowName := session.WindowName

	window.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if !a.isApplicationTerminating() {
			window.EmitEvent(projectWindowClosingEvent, ProjectWindowClosingPayload{
				SessionID:   sessionID,
				ProjectPath: path,
				WindowName:  actualWindowName,
			})
		}
		a.closeProjectWindowSession(sessionID)
	})
	a.registerWindowFileDropIntents(window)
	if roleWindow, ok := window.(application.Window); ok {
		a.registerWindowRole(roleWindow, WindowRoleProject)
		installNativeWebviewCursorPassthrough(roleWindow)
		a.registerNativeWindowControlsLifecycle(roleWindow)
	}
	registerNativeFullscreenEvents(window)
	window.Show()
	applyProjectWindowVisibleState(window, launchState)
	window.Focus()

	return ProjectWindowLaunchResult{
		Handled:     true,
		ProjectPath: path,
		SessionID:   sessionID,
		WindowName:  actualWindowName,
	}, nil
}

func buildProjectSessionURL(sessionID string) string {
	values := url.Values{}
	values.Set(projectSessionRouteParam, strings.TrimSpace(sessionID))
	return "/?" + values.Encode()
}

func (a *App) projectWindowLaunchState() projectWindowLaunchState {
	return a.projectWindowLaunchStateForSession(a.activeProjectSession())
}

func (a *App) projectWindowLaunchStateForSession(session *ProjectRuntimeSession) projectWindowLaunchState {
	var source projectWindowStateSource
	if window := a.sessionWindow(session); window != nil {
		source = window
	}
	if source == nil && a != nil && a.wailsApp != nil {
		if window := a.wailsApp.Window.Current(); window != nil {
			source = window
		}
	}
	if source == nil && a != nil && a.mainWindow != nil {
		source = a.mainWindow
	}
	return projectWindowLaunchStateFromSource(source)
}

func applyProjectWindowVisibleState(window projectWindowHandle, state projectWindowLaunchState) {
	if window == nil {
		return
	}
	switch state.startState {
	case application.WindowStateFullscreen:
		window.Fullscreen()
	case application.WindowStateMaximised:
		window.Maximise()
	}
}

func projectWindowLaunchStateFromSource(source projectWindowStateSource) projectWindowLaunchState {
	state := projectWindowLaunchState{
		width:      defaultProjectWindowWidth,
		height:     defaultProjectWindowHeight,
		startState: application.WindowStateNormal,
	}
	if source == nil {
		return state
	}

	if width, height := source.Size(); width > 0 && height > 0 {
		state.width = maxProjectWindowDimension(width, 1024)
		state.height = maxProjectWindowDimension(height, 768)
	}
	if source.IsFullscreen() {
		state.startState = application.WindowStateFullscreen
		return state
	}
	if source.IsMaximised() {
		state.startState = application.WindowStateMaximised
		return state
	}

	state.x, state.y = source.Position()
	state.hasPosition = true
	return state
}

func applyProjectWindowLaunchPosition(options *application.WebviewWindowOptions, state projectWindowLaunchState) {
	if options == nil || !state.hasPosition || state.startState != application.WindowStateNormal {
		return
	}
	options.InitialPosition = application.WindowXY
	options.X = state.x
	options.Y = state.y
}

func maxProjectWindowDimension(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func (a *App) GetProjectWindowSession(sessionID string) (ProjectWindowSessionPayload, error) {
	session := a.projectSessionByID(sessionID)
	if session == nil {
		return ProjectWindowSessionPayload{}, fmt.Errorf("project window session not found")
	}
	return projectWindowSessionPayload(session)
}

func (a *App) GetCurrentProjectWindowSession(ctx context.Context) (ProjectWindowSessionPayload, error) {
	registry := a.ensureProjectSessions()
	if window := bindingContextWindow(ctx); window != nil {
		if session := registry.getByWindow(window); session != nil {
			if !session.IsDefault {
				return projectWindowSessionPayload(session)
			}
			// Looking up a detached-project session from the default window is
			// expected during welcome-window startup.
			return ProjectWindowSessionPayload{}, nil
		}
	}

	session := a.activeProjectSession()
	if session == nil || session.IsDefault {
		if pending := registry.singlePendingProjectWindow(); pending != nil {
			return projectWindowSessionPayload(pending)
		}
		// The default window has no project-session identity. This is an
		// expected lookup result during normal welcome-window startup, not a
		// failed bridge invocation.
		return ProjectWindowSessionPayload{}, nil
	}
	return projectWindowSessionPayload(session)
}

func bindingContextWindow(ctx context.Context) application.Window {
	if ctx == nil {
		return nil
	}
	window, _ := ctx.Value(application.WindowKey).(application.Window)
	return window
}

func (a *App) OpenProjectWindowSession(sessionID string, path string) error {
	session := a.projectSessionByID(sessionID)
	if session == nil || session.IsDefault {
		return fmt.Errorf("project window session not found")
	}

	path = filepath.Clean(strings.TrimSpace(path))
	expectedPath := session.projectWindowProjectPath()
	if expectedPath != "" && expectedPath != "." && expectedPath != path {
		return fmt.Errorf("project window session %s is bound to %s, not %s", sessionID, expectedPath, path)
	}

	return a.openProjectInSession(session, path)
}

func projectWindowSessionPayload(session *ProjectRuntimeSession) (ProjectWindowSessionPayload, error) {
	projectPath := session.currentProjectPath()
	if projectPath == "" {
		projectPath = session.projectWindowProjectPath()
	}
	if projectPath == "" || projectPath == "." {
		return ProjectWindowSessionPayload{}, fmt.Errorf("project window session has no project")
	}
	return ProjectWindowSessionPayload{
		SessionID:   session.ID,
		ProjectPath: projectPath,
		WindowName:  session.WindowName,
	}, nil
}

func (a *App) closeProjectWindowSession(sessionID string) {
	session := a.ensureProjectSessions().remove(sessionID)
	if session == nil {
		return
	}
	a.unregisterWindowRoleName(session.WindowName)
	a.clearNativeWindowControlsStateForWindowName(session.WindowName)
	_ = a.closeProjectInSession(session, true)
}
