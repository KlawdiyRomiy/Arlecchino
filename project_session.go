package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"arlecchino/internal/composer"
	"arlecchino/internal/execution"
	"arlecchino/internal/indexer/core"
	indexerlsp "arlecchino/internal/indexer/lsp"
	"arlecchino/internal/plugins"
	"arlecchino/internal/plugins/common"
	"arlecchino/internal/plugins/django"
	"arlecchino/internal/plugins/laravel"
	"arlecchino/internal/plugins/rails"
	"arlecchino/internal/project"
	"arlecchino/internal/system"
	"arlecchino/internal/terminal"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const defaultProjectSessionID = "main"

type ProjectRuntimeSession struct {
	ID         string
	WindowName string
	IsDefault  bool

	projectManager   *project.ProjectManager
	plugins          *plugins.Registry
	termManager      *terminal.Manager
	executionService *execution.Service

	cmp        *composer.ComposerManager
	sys        *system.SystemManager
	coreEngine *core.Engine
	brain      completionBrain
	lspManager *indexerlsp.Manager

	projectPath       string
	pathMu            sync.RWMutex
	projectGeneration atomic.Uint64

	projectCtx    context.Context
	projectCancel context.CancelFunc
	wg            sync.WaitGroup

	diagnosticsPreloadMu     sync.Mutex
	diagnosticsPreloadCancel context.CancelFunc
	diagnosticsPreloadSeq    uint64
}

type ProjectSessionRegistry struct {
	mu          sync.RWMutex
	sessions    map[string]*ProjectRuntimeSession
	windowIndex map[string]string
}

func NewProjectSessionRegistry() *ProjectSessionRegistry {
	return &ProjectSessionRegistry{
		sessions:    make(map[string]*ProjectRuntimeSession),
		windowIndex: make(map[string]string),
	}
}

func newProjectPluginRegistry() *plugins.Registry {
	registry := plugins.NewRegistry()
	registry.Register(common.New())
	registry.Register(laravel.New())
	registry.Register(django.New())
	registry.Register(rails.New())
	return registry
}

func newProjectManager() *project.ProjectManager {
	manager, err := project.NewProjectManager("data/projects.db")
	if err != nil {
		return nil
	}
	return manager
}

func defaultProjectSessionFromApp(a *App) *ProjectRuntimeSession {
	return &ProjectRuntimeSession{
		ID:               defaultProjectSessionID,
		WindowName:       "main",
		IsDefault:        true,
		projectManager:   a.projectManager,
		plugins:          a.plugins,
		termManager:      a.termManager,
		executionService: a.executionService,
		cmp:              a.cmp,
		sys:              a.sys,
		coreEngine:       a.coreEngine,
		brain:            a.brain,
		lspManager:       a.lspManager,
		projectPath:      a.projectPath,
		projectCtx:       a.projectCtx,
		projectCancel:    a.projectCancel,
	}
}

func newProjectRuntimeSession(id string, windowName string) *ProjectRuntimeSession {
	return &ProjectRuntimeSession{
		ID:             id,
		WindowName:     windowName,
		projectManager: newProjectManager(),
		plugins:        newProjectPluginRegistry(),
		termManager:    terminal.NewManager(),
	}
}

func (s *ProjectRuntimeSession) currentProjectPath() string {
	if s == nil {
		return ""
	}
	s.pathMu.RLock()
	defer s.pathMu.RUnlock()
	return s.projectPath
}

func (s *ProjectRuntimeSession) setProjectPath(path string) {
	if s == nil {
		return
	}
	s.pathMu.Lock()
	s.projectPath = path
	s.pathMu.Unlock()
}

func (r *ProjectSessionRegistry) register(session *ProjectRuntimeSession) {
	if r == nil || session == nil || strings.TrimSpace(session.ID) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[session.ID] = session
	if session.WindowName != "" {
		r.windowIndex[session.WindowName] = session.ID
	}
}

func (r *ProjectSessionRegistry) attachWindow(sessionID string, window application.Window) {
	if r == nil || window == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	session := r.sessions[sessionID]
	if session == nil {
		return
	}
	session.WindowName = window.Name()
	r.windowIndex[window.Name()] = session.ID
}

func (r *ProjectSessionRegistry) get(sessionID string) *ProjectRuntimeSession {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.sessions[sessionID]
}

func (r *ProjectSessionRegistry) getByWindow(window application.Window) *ProjectRuntimeSession {
	if r == nil || window == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.sessions[r.windowIndex[window.Name()]]
}

func (r *ProjectSessionRegistry) findProjectWindowByPath(path string) *ProjectRuntimeSession {
	if r == nil {
		return nil
	}
	clean := filepath.Clean(strings.TrimSpace(path))
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, session := range r.sessions {
		if session == nil || session.IsDefault {
			continue
		}
		if filepath.Clean(session.currentProjectPath()) == clean {
			return session
		}
	}
	return nil
}

func (r *ProjectSessionRegistry) remove(sessionID string) *ProjectRuntimeSession {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	session := r.sessions[sessionID]
	if session == nil {
		return nil
	}
	delete(r.sessions, sessionID)
	if session.WindowName != "" {
		delete(r.windowIndex, session.WindowName)
	}
	return session
}

func (a *App) ensureProjectSessions() *ProjectSessionRegistry {
	if a.projectSessions == nil {
		a.projectSessions = NewProjectSessionRegistry()
		a.projectSessions.register(defaultProjectSessionFromApp(a))
	}
	return a.projectSessions
}

func (a *App) activeProjectSession() *ProjectRuntimeSession {
	if a == nil {
		return nil
	}
	registry := a.ensureProjectSessions()
	if a.wailsApp != nil {
		if window := a.wailsApp.Window.Current(); window != nil {
			if session := registry.getByWindow(window); session != nil {
				return session
			}
		}
	}
	return registry.get(defaultProjectSessionID)
}

func (a *App) projectSessionByID(sessionID string) *ProjectRuntimeSession {
	if a == nil {
		return nil
	}
	return a.ensureProjectSessions().get(strings.TrimSpace(sessionID))
}

func (a *App) syncDefaultProjectSession(session *ProjectRuntimeSession) {
	if a == nil || session == nil || !session.IsDefault {
		return
	}
	a.projectManager = session.projectManager
	a.plugins = session.plugins
	a.termManager = session.termManager
	a.executionService = session.executionService
	a.cmp = session.cmp
	a.sys = session.sys
	a.coreEngine = session.coreEngine
	a.brain = session.brain
	a.lspManager = session.lspManager
	a.projectCtx = session.projectCtx
	a.projectCancel = session.projectCancel
	a.projectGeneration.Store(session.projectGeneration.Load())
	a.setProjectPath(session.currentProjectPath())
}

func (a *App) sessionWindow(session *ProjectRuntimeSession) application.Window {
	if a == nil || a.wailsApp == nil || session == nil || session.WindowName == "" {
		return nil
	}
	window, _ := a.wailsApp.Window.GetByName(session.WindowName)
	return window
}

func (a *App) focusProjectSessionWindow(session *ProjectRuntimeSession) bool {
	window := a.sessionWindow(session)
	if window == nil {
		return false
	}
	window.Restore()
	window.Focus()
	return true
}

func (a *App) nextProjectWindowSessionID() string {
	seq := a.projectWindowSeq.Add(1)
	return fmt.Sprintf("project-session-%d", seq)
}

func (a *App) activeProjectManager() *project.ProjectManager {
	if session := a.activeProjectSession(); session != nil && session.projectManager != nil {
		return session.projectManager
	}
	return a.projectManager
}

func (a *App) activePluginRegistry() *plugins.Registry {
	if session := a.activeProjectSession(); session != nil && session.plugins != nil {
		return session.plugins
	}
	return a.plugins
}

func (a *App) activeTerminalManager() *terminal.Manager {
	if session := a.activeProjectSession(); session != nil && session.termManager != nil {
		return session.termManager
	}
	return a.termManager
}

func (a *App) activeCoreEngine() *core.Engine {
	if session := a.activeProjectSession(); session != nil {
		return session.coreEngine
	}
	return a.coreEngine
}

func (a *App) activeCompletionBrain() completionBrain {
	if session := a.activeProjectSession(); session != nil {
		return session.brain
	}
	return a.brain
}

func (a *App) activeLSPManager() *indexerlsp.Manager {
	if session := a.activeProjectSession(); session != nil {
		return session.lspManager
	}
	return a.lspManager
}

func (a *App) activeProjectGeneration() uint64 {
	if session := a.activeProjectSession(); session != nil {
		return session.projectGeneration.Load()
	}
	return a.projectGeneration.Load()
}

func (a *App) activeExecutionService() *execution.Service {
	session := a.activeProjectSession()
	if session != nil {
		if session.executionService == nil {
			session.executionService = execution.NewService(session.plugins)
		}
		return session.executionService
	}
	if a.executionService == nil {
		a.executionService = execution.NewService(a.plugins)
	}
	return a.executionService
}
