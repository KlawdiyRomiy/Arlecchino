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

type projectWindowHandle interface {
	Name() string
	Show() application.Window
	Focus()
	OnWindowEvent(events.WindowEventType, func(event *application.WindowEvent)) func()
	EmitEvent(name string, data ...any) bool
}

var newProjectWebviewWindow = func(app *App, options application.WebviewWindowOptions) (projectWindowHandle, error) {
	if app == nil || app.wailsApp == nil {
		return nil, fmt.Errorf("wails application is not initialized")
	}
	return app.wailsApp.Window.NewWithOptions(options), nil
}

func (a *App) OpenProjectWindow(path string) (ProjectWindowLaunchResult, error) {
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
	window, err := newProjectWebviewWindow(a, application.WebviewWindowOptions{
		Name:                  windowName,
		Title:                 "Arlecchino - " + filepath.Base(path),
		Width:                 1440,
		Height:                900,
		MinWidth:              1024,
		MinHeight:             768,
		Frameless:             runtime.GOOS != "darwin",
		URL:                   windowURL,
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
	})
	if err != nil {
		registry.remove(sessionID)
		return ProjectWindowLaunchResult{}, err
	}
	registry.attachWindowName(sessionID, window.Name())
	actualWindowName := session.WindowName

	window.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
		a.closeProjectWindowSession(sessionID)
	})
	a.registerWindowFileDropIntents(window)
	if roleWindow, ok := window.(application.Window); ok {
		a.registerWindowRole(roleWindow, WindowRoleProject)
	}
	registerNativeFullscreenEvents(window)
	window.Show()
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
			return ProjectWindowSessionPayload{}, fmt.Errorf("current window is not a project session")
		}
	}

	session := a.activeProjectSession()
	if session == nil || session.IsDefault {
		if pending := registry.singlePendingProjectWindow(); pending != nil {
			return projectWindowSessionPayload(pending)
		}
		return ProjectWindowSessionPayload{}, fmt.Errorf("current window is not a project session")
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
