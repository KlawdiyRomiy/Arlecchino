package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"arlecchino/internal/composer"
	"arlecchino/internal/execution"
	"arlecchino/internal/indexer/adapters"
	"arlecchino/internal/indexer/brain"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
	lspinstaller "arlecchino/internal/lsp"
	"arlecchino/internal/mcp"
	"arlecchino/internal/plugins"
	"arlecchino/internal/plugins/laravel"
	"arlecchino/internal/project"
	"arlecchino/internal/system"
	"arlecchino/internal/terminal"
	"arlecchino/internal/ui/welcome"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const envDisableMCPBootstrap = "ARLECCHINO_DISABLE_MCP_BOOTSTRAP"

type App struct {
	ctx                      context.Context
	wailsApp                 *application.App
	mainWindow               *application.WebviewWindow
	cmp                      *composer.ComposerManager
	sys                      *system.SystemManager
	projectManager           *project.ProjectManager
	welcomeScreen            *welcome.WelcomeScreen
	coreEngine               *core.Engine
	brain                    completionBrain
	lspManager               *lsp.Manager
	lspInstaller             *lspinstaller.Installer
	plugins                  *plugins.Registry
	termManager              *terminal.Manager
	carapaceProvider         *terminal.CarapaceProvider
	executionService         *execution.Service
	langDetector             *brain.LangDetector
	projectPath              string
	pathMu                   sync.RWMutex
	projectGeneration        atomic.Uint64
	lastRequestID            atomic.Value
	mcpBridgeServer          *mcp.IDEBridgeServer
	mcpBridgeMu              sync.Mutex
	backgroundShell          *BackgroundShellStatusService
	shellMenuMu              sync.Mutex
	shellMenuShortcuts       map[string][]string
	openIntentMu             sync.Mutex
	openIntentReady          bool
	pendingOpenIntents       []map[string]any
	managerMu                sync.Mutex
	nativeControlsMu         sync.Mutex
	nativeControlsByWindow   map[string]nativeWindowControlsState
	diagnosticsPreloadMu     sync.Mutex
	diagnosticsPreloadCancel context.CancelFunc
	diagnosticsPreloadSeq    uint64
	windowLeases             *WindowLeaseRegistry
	packagedOSNative         *PackagedOSNativeDelivery
	autoUpdater              *AutoUpdateService
	projectSessions          *ProjectSessionRegistry
	projectWindowSeq         atomic.Uint64
	closeConfirmationEnabled atomic.Bool
	closeConfirmationAllowed atomic.Bool
	closeConfirmationPending atomic.Bool

	projectCtx    context.Context
	projectCancel context.CancelFunc
	wg            sync.WaitGroup
}

type ProjectAccessInspection struct {
	Path       string `json:"path"`
	Accessible bool   `json:"accessible"`
	Reason     string `json:"reason"`
}

func (a *App) attachWailsApplication(app *application.App) {
	a.wailsApp = app
}

func (a *App) attachMainWindow(window *application.WebviewWindow) {
	a.mainWindow = window
	if a != nil && window != nil {
		a.ensureProjectSessions().attachWindow(defaultProjectSessionID, window)
		registerNativeFullscreenEvents(window)
		a.registerMainWindowCloseConfirmation(window)
	}
}

func (a *App) setProjectPath(path string) {
	a.pathMu.Lock()
	a.projectPath = path
	a.pathMu.Unlock()
}

func (a *App) currentProjectPath() string {
	if session := a.activeProjectSession(); session != nil {
		return session.currentProjectPath()
	}
	a.pathMu.RLock()
	defer a.pathMu.RUnlock()
	return a.projectPath
}

type projectWarmupStep struct {
	name string
	run  func(context.Context) error
}

func NewApp() *App {
	pm, err := project.NewProjectManager("data/projects.db")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ARLE] project manager init failed: %v\n", err)
	}

	pluginRegistry := newProjectPluginRegistry()

	termManager := terminal.NewManager()

	app := &App{
		projectManager:   pm,
		welcomeScreen:    welcome.NewWelcomeScreen(pm),
		termManager:      termManager,
		carapaceProvider: terminal.NewCarapaceProvider(),
		plugins:          pluginRegistry,
		executionService: execution.NewService(pluginRegistry),
		backgroundShell:  NewBackgroundShellStatusService(),
		windowLeases:     NewWindowLeaseRegistry(),
		packagedOSNative: NewPackagedOSNativeDelivery(defaultPackagedOSIntegrationOptions()),
		autoUpdater:      NewAutoUpdateService(),
	}
	app.closeConfirmationEnabled.Store(true)
	app.projectSessions = NewProjectSessionRegistry()
	app.projectSessions.register(defaultProjectSessionFromApp(app))
	return app
}

func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.startup(ctx)
	a.startPackagedOSNativeLiveSmokeIfConfigured()
	a.startWindowLeaseLiveSmokeIfConfigured()
	return nil
}

func (a *App) ServiceShutdown() error {
	a.shutdown(a.ctx)
	return nil
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startOpenIntentBridge()
	a.startMCPBridge()
	a.ensureMCPConfigs()

	installer, err := lspinstaller.NewInstaller(func(progress lspinstaller.InstallProgress) {
		a.recordBackgroundLSPInstallProgress(progress)
		a.emitEvent("lsp:install:progress", progress)
	})
	if err == nil {
		a.lspInstaller = installer
	}

	assetsDir := brain.DefaultArleConfig().ModelPath
	if assetsDir != "" {
		assetsDir = filepath.Dir(assetsDir)
	}
	a.langDetector, _ = brain.NewLangDetector(assetsDir)
}

func (a *App) shutdown(_ context.Context) {
	a.stopMCPBridge()
	_ = a.CloseProject(context.Background())
}

func (a *App) ensureMCPConfigs() {
	if envFlagEnabled(envDisableMCPBootstrap) {
		return
	}

	go func() {
		exe, err := os.Executable()
		if err != nil {
			return
		}
		home, err := os.UserHomeDir()
		if err != nil {
			return
		}
		mcp.EnsureUniversalUserMCPBootstrap(home, exe)
	}()
}

func envFlagEnabled(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello, %s. Let's create something!", name)
}

func (a *App) SelectDirectory(title string) (string, error) {
	if a == nil || a.wailsApp == nil {
		return "", fmt.Errorf("application is not initialized")
	}
	return a.wailsApp.Dialog.OpenFile().
		SetTitle(title).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection()
}

func (a *App) SelectOpenTarget(title string) (map[string]any, error) {
	if a == nil || a.wailsApp == nil {
		return nil, fmt.Errorf("application is not initialized")
	}
	target, err := a.wailsApp.Dialog.OpenFile().
		SetTitle(title).
		CanChooseDirectories(true).
		CanChooseFiles(true).
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(target) == "" {
		return nil, nil
	}
	payload, ok := inferOpenIntentFromLaunchTarget(target, currentWorkingDir(), 0)
	if !ok {
		return nil, fmt.Errorf("unsupported open target: %s", target)
	}
	return payload, nil
}

func (a *App) InspectProjectAccess(path string) ProjectAccessInspection {
	inspection := ProjectAccessInspection{
		Path:       strings.TrimSpace(path),
		Accessible: true,
	}
	if err := validateProjectOpenAccess(path); err != nil {
		inspection.Accessible = false
		inspection.Reason = err.Error()
	}
	return inspection
}

func (a *App) initProjectLSPManagerForSession(session *ProjectRuntimeSession, path string, projectGeneration uint64, installer *lspinstaller.Installer) *lsp.Manager {
	manager := lsp.NewManager(path)
	manager.SetDiagnosticsCallback(func(language, filePath string, diagnostics []lsp.Diagnostic) {
		if session != nil && session.projectGeneration.Load() != projectGeneration {
			return
		}
		sessionID := ""
		if session != nil {
			sessionID = session.ID
		}
		a.emitEvent(
			"lsp:diagnostics",
			newLSPDiagnosticsEventForSession(path, projectGeneration, sessionID, language, filePath, diagnostics),
		)
	})

	defaultConfigs := lsp.DefaultConfigs(path)
	installerConfigs := lsp.ConfigsFromInstaller(path, installer)
	for _, cfg := range lsp.MergeConfigs(defaultConfigs, installerConfigs) {
		manager.RegisterServer(cfg)
	}

	if session != nil {
		session.lspManager = manager
		a.syncDefaultProjectSession(session)
	} else {
		a.lspManager = manager
	}
	return manager
}

func (a *App) OpenProject(ctx context.Context, path string) error {
	return a.openProjectInSession(a.projectSessionForContext(ctx), path)
}

func (a *App) openProjectInSession(session *ProjectRuntimeSession, path string) error {
	if session == nil {
		session = defaultProjectSessionFromApp(a)
	}
	if err := validateProjectOpenAccess(path); err != nil {
		return err
	}

	session.lifecycleMu.Lock()
	defer session.lifecycleMu.Unlock()

	if session.currentProjectPath() != "" {
		_ = a.closeProjectInSessionLocked(session, false)
	}

	projectGeneration := session.projectGeneration.Add(1)
	session.setProjectPath(path)
	session.projectCtx, session.projectCancel = context.WithCancel(context.Background())
	a.syncDefaultProjectSession(session)

	if session.projectManager != nil {
		err := session.projectManager.OpenProject(path)
		if err != nil {
			return err
		}
	}

	var lspManager *lsp.Manager
	lspInstaller := a.lspInstaller
	pluginRegistry := session.plugins
	lspManager = a.initProjectLSPManagerForSession(session, path, projectGeneration, lspInstaller)

	// Initialize core engine and prediction brain
	coreEngine, err := newCoreEngine(core.EngineConfig{
		ProjectID:   path,
		ProjectRoot: path,
		DBPath:      filepath.Join(path, ".arlecchino", "brain.db"),
		Workers:     core.RecommendedWorkerCount(),
	})
	if err != nil {
		a.logWarning(fmt.Sprintf("core engine init failed: %v", err))
	} else {
		session.coreEngine = coreEngine
		session.coreEngine.Start()
		a.syncDefaultProjectSession(session)

		// Register language adapters for code indexing
		// Detect framework via plugin system
		framework := ""
		version := ""
		if session.plugins != nil {
			framework = session.plugins.DetectFramework(path)
			if framework == "laravel" {
				if v, err := laravel.GetLaravelVersion(path); err == nil {
					version = v
				}
			}
		}
		// Update project with detected framework
		if session.projectManager != nil {
			session.projectManager.UpdateFramework(framework, version)
		}
		for _, adapter := range adapters.AllAdapters(framework) {
			session.coreEngine.RegisterAdapter(adapter)
		}

		// Listen for indexing lifecycle events
		session.coreEngine.OnIndexing(func(evt core.IndexingEvent) {
			a.recordBackgroundIndexerEvent(evt, path, projectGeneration)
			schedulerStats := coreEngine.SchedulerStats()
			engineStats := coreEngine.Stats()
			payload := map[string]any{
				"current":               evt.Current,
				"total":                 evt.Total,
				"queueDepth":            schedulerStats.Pending,
				"projectFileCount":      engineStats.TotalFiles,
				"mode":                  string(schedulerStats.Mode),
				"backgroundDelayMs":     schedulerStats.BackgroundJobDelayMs,
				"configuredWorkerCount": schedulerStats.Workers,
				"projectPath":           path,
				"sessionId":             session.ID,
			}
			switch evt.Type {
			case core.IndexingStarted:
				a.emitEvent("indexer:started", payload)
			case core.IndexingProgress:
				a.emitEvent("indexer:progress", payload)
			case core.IndexingCompleted:
				a.emitEvent("indexer:completed", payload)
			}
		})

		// Initialize prediction brain
		session.brain = brain.NewPredictionBrain(coreEngine, brain.BrainConfig{
			MaxSuggestions:    50,
			MinConfidence:     0.1,
			EnableLSP:         true,
			EnableVirtual:     true,
			EnableSpeculative: true,
		})
		session.brain.SetLSPManager(lspManager)
		a.syncDefaultProjectSession(session)

		projectCtx := session.projectCtx
		session.wg.Add(1)
		go func() {
			defer session.wg.Done()
			select {
			case <-projectCtx.Done():
				return
			default:
				_ = coreEngine.IndexProjectContext(projectCtx)
			}
		}()
	}

	a.startDeferredProjectWarmupForSession(session,
		projectWarmupStep{
			name: "agent guide",
			run: func(context.Context) error {
				if _, _, err := terminal.EnsureAgentGuideFile(path); err != nil {
					return err
				}
				_, err := mcp.EnsureAgentContextFile(path)
				return err
			},
		},
		projectWarmupStep{
			name: "plugins",
			run: func(context.Context) error {
				if pluginRegistry == nil {
					return nil
				}
				return pluginRegistry.InitAll(path)
			},
		},
		projectWarmupStep{
			name: "diagnostics preload",
			run: func(ctx context.Context) error {
				if lspManager == nil {
					return nil
				}

				select {
				case <-ctx.Done():
					return nil
				default:
				}

				a.lspPreloadProjectDiagnosticsForSession(session, path, projectGeneration)
				return nil
			},
		},
	)

	if lspManager != nil {
		a.emitEvent("lsp:ready", map[string]interface{}{
			"message":     "LSP servers are starting...",
			"projectPath": path,
			"generation":  projectGeneration,
			"sessionId":   session.ID,
		})
		a.emitLSPDiagnosticsStatusForSession(session.ID, path, projectGeneration, "", "", "ready", "LSP diagnostics manager is ready")
	} else {
		a.emitLSPDiagnosticsStatusForSession(session.ID, path, projectGeneration, "", "", "unavailable", "LSP diagnostics manager is not available")
	}
	a.startProjectFilesystemWatcherForSession(session, path, projectGeneration)

	return nil
}

func validateProjectOpenAccess(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return fmt.Errorf("project path is required")
	}

	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("project path is not accessible: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("project path is not a directory: %s", path)
	}
	if _, err := os.ReadDir(path); err != nil {
		return fmt.Errorf("project directory is not readable: %w", err)
	}

	return nil
}

func (a *App) startDeferredProjectWarmup(steps ...projectWarmupStep) {
	a.startDeferredProjectWarmupForSession(a.activeProjectSession(), steps...)
}

func (a *App) startDeferredProjectWarmupForSession(session *ProjectRuntimeSession, steps ...projectWarmupStep) {
	if session == nil || len(steps) == 0 || session.projectCtx == nil {
		return
	}

	ctx := session.projectCtx
	session.wg.Add(1)
	go func() {
		defer session.wg.Done()

		for _, step := range steps {
			select {
			case <-ctx.Done():
				return
			default:
			}

			if err := step.run(ctx); err != nil {
				a.logWarning(fmt.Sprintf("[ProjectWarmup] %s error: %v", step.name, err))
			}
		}
	}()
}

func (a *App) CloseProject(ctx context.Context) error {
	return a.closeProjectInSession(a.projectSessionForContext(ctx), true)
}

func (a *App) closeProject(closeTerminals bool) error {
	return a.closeProjectInSession(a.activeProjectSession(), closeTerminals)
}

func (a *App) closeProjectInSession(session *ProjectRuntimeSession, closeTerminals bool) error {
	if session == nil {
		session = defaultProjectSessionFromApp(a)
	}
	session.lifecycleMu.Lock()
	defer session.lifecycleMu.Unlock()

	return a.closeProjectInSessionLocked(session, closeTerminals)
}

func (a *App) closeProjectInSessionLocked(session *ProjectRuntimeSession, closeTerminals bool) error {
	projectPath := session.currentProjectPath()
	if session.projectCancel != nil {
		session.projectCancel()
	}
	a.cancelDiagnosticsPreloadForSession(session)

	session.wg.Wait()

	if snapshot, changed := a.backgroundShell.CancelJobsForProject(projectPath, "Project closed."); changed {
		a.emitBackgroundShellStatusSnapshot(snapshot)
	}

	if closeTerminals && session.termManager != nil {
		session.termManager.CloseAll()
	}

	if session.plugins != nil {
		session.plugins.CloseAll()
	}

	if session.brain != nil {
		session.brain.Close()
		session.brain = nil
	}

	if session.lspManager != nil {
		session.lspManager.StopAll()
		session.lspManager = nil
	}

	if session.coreEngine != nil {
		session.coreEngine.Stop()
		session.coreEngine = nil
	}

	a.managerMu.Lock()
	session.cmp = nil
	session.sys = nil
	session.setProjectPath("")
	session.projectCtx = nil
	session.projectCancel = nil
	a.syncDefaultProjectSession(session)
	a.managerMu.Unlock()

	if session.projectManager != nil {
		return session.projectManager.CloseProject()
	}

	return nil
}

func (a *App) GetCurrentProjectID() string {
	manager := a.activeProjectManager()
	if manager == nil || manager.CurrentProject == nil {
		return ""
	}
	return fmt.Sprintf("%d", manager.CurrentProject.ID)
}

func (a *App) GetCurrentWorkDir() string {
	return a.currentProjectPath()
}

func (a *App) GetRecentProjects(limit int) ([]project.Project, error) {
	if a.projectManager == nil {
		return nil, fmt.Errorf("project manager not initialized")
	}
	return a.projectManager.GetRecentProjects(limit)
}

func (a *App) ValidateEnvironment() map[string]bool {
	if a.welcomeScreen == nil {
		return map[string]bool{
			"php":      false,
			"composer": false,
			"artisan":  false,
		}
	}
	return a.welcomeScreen.ValidateEnvironment()
}

// GetCurrentProjectPath returns the current project root path
func (a *App) GetCurrentProjectPath() string {
	return a.currentProjectPath()
}

func (a *App) GetCurrentProjectFramework() string {
	manager := a.activeProjectManager()
	if manager == nil || manager.CurrentProject == nil {
		return ""
	}

	return manager.CurrentProject.Framework
}

func (a *App) CreateNewProject(name string, directory string, framework string) (string, error) {
	name = strings.TrimSpace(name)
	directory = strings.TrimSpace(directory)
	framework = strings.TrimSpace(framework)
	if name == "" {
		return "", fmt.Errorf("project name is required")
	}
	if directory == "" {
		return "", fmt.Errorf("project directory is required")
	}

	projectPath := filepath.Join(directory, name)
	if _, err := os.Stat(projectPath); err == nil {
		return "", fmt.Errorf("project already exists: %s", projectPath)
	} else if !os.IsNotExist(err) {
		return "", err
	}

	if framework == "" {
		if err := os.MkdirAll(projectPath, 0o755); err != nil {
			return "", err
		}
		return projectPath, nil
	}

	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry == nil {
		return "", fmt.Errorf("plugin system not initialized")
	}

	creator := pluginRegistry.GetProjectCreator(framework)
	if creator == nil {
		return "", fmt.Errorf("no project creator available for framework: %s", framework)
	}

	return creator.CreateProject(name, directory)
}

// GetLSPStatus returns health status of all LSP servers
func (a *App) GetLSPStatus() []lsp.ServerStatus {
	manager := a.activeLSPManager()
	if manager == nil {
		return nil
	}
	return manager.HealthCheck()
}

// RestartLSPServer force-restarts a specific LSP server.
func (a *App) RestartLSPServer(language string) (bool, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return false, nil
	}
	return manager.ForceRestart(language)
}

// GetDevToolsStatus returns installation status of development tools (PHP, Go, Node, etc.)
func (a *App) GetDevToolsStatus() []welcome.ToolStatus {
	if a.welcomeScreen == nil {
		return nil
	}
	return a.welcomeScreen.GetToolsStatus()
}

// GetLSPInstallStatus returns installation status of LSP servers
func (a *App) GetLSPInstallStatus() []welcome.ToolStatus {
	if a.welcomeScreen == nil {
		return nil
	}
	return a.welcomeScreen.GetLSPStatus()
}

// InstallDevTool installs a development tool or LSP server
func (a *App) InstallDevTool(toolName string) (string, error) {
	if a.welcomeScreen == nil {
		return "", fmt.Errorf("welcome screen not initialized")
	}
	return a.welcomeScreen.InstallTool(toolName)
}
