package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"arlecchino/internal/ai"
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
	"arlecchino/internal/processcontrol"
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
	gitStatusMu              sync.Mutex
	gitStatusCalls           map[string]*gitStatusCall
	projectGeneration        atomic.Uint64
	lastRequestID            atomic.Value
	completionRequestsMu     sync.Mutex
	completionRequests       map[string]editorCompletionRequest
	completionResolveRefsMu  sync.Mutex
	completionResolveRefs    map[string]editorCompletionResolveRef
	mcpBridgeServer          *mcp.IDEBridgeServer
	mcpBridgeMu              sync.Mutex
	backgroundShell          *BackgroundShellStatusService
	processGovernor          *processcontrol.Governor
	backgroundCancelMu       sync.Mutex
	backgroundCancelers      map[string]context.CancelFunc
	indexerProgressMu        sync.Mutex
	indexerProgress          map[string]indexerProgressState
	shellMenuMu              sync.Mutex
	shellMenuShortcuts       map[string][]string
	shellMenuState           ShellMenuStatePayload
	shellMenuItems           map[string]*application.MenuItem
	openIntentMu             sync.Mutex
	openIntentReady          bool
	pendingOpenIntents       []map[string]any
	externalIntentMu         sync.Mutex
	pendingMCPApprovalNonces map[string]string
	pendingOAuthStates       map[string]string
	managerMu                sync.Mutex
	nativeControlsMu         sync.Mutex
	nativeControlsByWindow   map[string]nativeWindowControlsState
	windowRoles              *WindowRoleRegistry
	diagnosticsPreloadMu     sync.Mutex
	diagnosticsPreloadCancel context.CancelFunc
	diagnosticsPreloadSeq    uint64
	windowLeases             *WindowLeaseRegistry
	packagedOSNative         *PackagedOSNativeDelivery
	autoUpdater              *AutoUpdateService
	aiService                *ai.Service
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
	if a == nil || window == nil {
		return
	}
	a.mainWindow = window
	a.ensureProjectSessions().attachWindow(defaultProjectSessionID, window)
	a.registerWindowRole(window, WindowRoleMain)
	a.registerWindowFileDropIntents(window)
	installNativeWebviewCursorPassthrough(window)
	registerNativeFullscreenEvents(window)
	a.registerNativeWindowControlsLifecycle(window)
	a.registerMainWindowCloseConfirmation(window)
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
		projectManager:           pm,
		welcomeScreen:            welcome.NewWelcomeScreen(pm),
		termManager:              termManager,
		carapaceProvider:         terminal.NewCarapaceProvider(),
		plugins:                  pluginRegistry,
		executionService:         execution.NewService(pluginRegistry),
		backgroundShell:          NewBackgroundShellStatusService(),
		processGovernor:          processcontrol.NewGovernor(),
		backgroundCancelers:      make(map[string]context.CancelFunc),
		indexerProgress:          make(map[string]indexerProgressState),
		windowLeases:             NewWindowLeaseRegistry(),
		windowRoles:              NewWindowRoleRegistry(),
		pendingMCPApprovalNonces: make(map[string]string),
		pendingOAuthStates:       make(map[string]string),
		packagedOSNative:         NewPackagedOSNativeDelivery(defaultPackagedOSIntegrationOptions()),
		autoUpdater:              NewAutoUpdateService(),
	}
	app.aiService = ai.NewService(ai.ServiceOptions{
		Emit: func(name string, payload any) {
			app.emitEvent(name, payload)
		},
		MCPContextProvider: app.aiMCPContextProvider,
		Diagnostics:        app.aiDiagnosticsProvider,
		MCPExecutor:        app.aiMCPToolExecutor,
	})
	app.closeConfirmationEnabled.Store(true)
	app.projectSessions = NewProjectSessionRegistry()
	app.projectSessions.register(defaultProjectSessionFromApp(app))
	initializeNativeMacOSBridge(app)
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
	a.cleanupStaleProjectEntryUndoStashes()
	a.startOpenIntentBridge()
	a.startFrontendPerfTraceBridge()
	if a.aiService == nil {
		a.aiService = ai.NewService(ai.ServiceOptions{
			Emit: func(name string, payload any) {
				a.emitEvent(name, payload)
			},
			MCPContextProvider: a.aiMCPContextProvider,
			Diagnostics:        a.aiDiagnosticsProvider,
			MCPExecutor:        a.aiMCPToolExecutor,
		})
	}
	if err := a.aiService.Start(ctx); err != nil {
		a.logWarning(fmt.Sprintf("AI service startup failed: %v", err))
	}
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
	started := time.Now()
	a.stopMCPBridge()
	_ = a.closeAllProjectSessions(true)
	if a.aiService != nil {
		stageStarted := time.Now()
		_ = a.aiService.Close()
		logShutdownStage("aiService.close", stageStarted, "")
	}
	logShutdownStage("application.total", started, "")
}

func logShutdownStage(stage string, started time.Time, details string) {
	elapsed := time.Since(started).Truncate(time.Millisecond)
	if elapsed <= 0 {
		elapsed = time.Since(started)
	}
	if details == "" {
		log.Printf("[shutdown] stage=%s duration=%s", stage, elapsed)
		return
	}
	log.Printf("[shutdown] stage=%s duration=%s %s", stage, elapsed, details)
}

func (a *App) ensureMCPConfigs() {
	if envFlagEnabled(envDisableMCPBootstrap) {
		return
	}
	settings, _, err := mcp.LoadSettings("")
	if err != nil || !settings.Enabled {
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
	manager.SetProcessGovernor(a.processGovernor)
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
	for _, cfg := range defaultConfigs {
		manager.RegisterServer(cfg)
	}
	manager.ReplaceInstallerConfigs(installerConfigs)

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
		if err := a.closeProjectInSessionLocked(session, false); err != nil {
			return err
		}
	}

	if session.projectManager != nil {
		if err := session.projectManager.OpenProject(path); err != nil {
			return err
		}
	}

	projectGeneration := session.projectGeneration.Add(1)
	session.setProjectPath(path)
	session.projectCtx, session.projectCancel = context.WithCancel(context.Background())
	a.syncDefaultProjectSession(session)
	if a.aiService != nil {
		aiSession, err := a.aiService.OpenProject(session.ID, path)
		if err != nil {
			a.logWarning(fmt.Sprintf("[AI] failed to open project context: %v", err))
		} else {
			session.aiSession = aiSession
			a.syncDefaultProjectSession(session)
		}
	}

	var lspManager *lsp.Manager
	lspInstaller := a.lspInstaller
	pluginRegistry := session.plugins
	lspManager = a.initProjectLSPManagerForSession(session, path, projectGeneration, lspInstaller)

	// Initialize core engine and prediction brain
	indexerWorkers := core.RecommendedWorkerCount()
	if a.processGovernor != nil {
		indexerWorkers = a.processGovernor.PolicyFor(processcontrol.KindIndexing, 0, 0).WorkerCount
		if indexerWorkers <= 0 {
			indexerWorkers = core.RecommendedWorkerCount()
		}
	}
	coreEngine, err := newCoreEngine(core.EngineConfig{
		ProjectID:   path,
		ProjectRoot: path,
		DBPath:      filepath.Join(path, ".arlecchino", "brain.db"),
		Workers:     indexerWorkers,
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
		var lastIndexerLog time.Time
		session.coreEngine.OnIndexing(func(evt core.IndexingEvent) {
			schedulerStats := coreEngine.SchedulerStats()
			engineStats := coreEngine.Stats()
			a.recordBackgroundIndexerEvent(evt, path, session.ID, projectGeneration, schedulerStats.Pending, schedulerStats.Workers)
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
				"terminal":              evt.Terminal,
			}
			switch evt.Type {
			case core.IndexingStarted:
				a.emitEvent("indexer:started", payload)
				lastIndexerLog = time.Now()
				a.logInfof("[Indexer] started session=%s project=%s generation=%d queue=%d files=%d workers=%d mode=%s",
					session.ID,
					filepath.Base(path),
					projectGeneration,
					schedulerStats.Pending,
					engineStats.TotalFiles,
					schedulerStats.Workers,
					schedulerStats.Mode,
				)
			case core.IndexingProgress:
				a.emitEvent("indexer:progress", payload)
				if time.Since(lastIndexerLog) >= 3*time.Second {
					lastIndexerLog = time.Now()
					a.logInfof("[Indexer] progress session=%s project=%s generation=%d current=%d total=%d queue=%d files=%d mode=%s",
						session.ID,
						filepath.Base(path),
						projectGeneration,
						evt.Current,
						evt.Total,
						schedulerStats.Pending,
						engineStats.TotalFiles,
						schedulerStats.Mode,
					)
				}
			case core.IndexingCompleted:
				a.emitEvent("indexer:completed", payload)
				lastIndexerLog = time.Now()
				a.logInfof("[Indexer] completed session=%s project=%s generation=%d current=%d total=%d queue=%d files=%d mode=%s",
					session.ID,
					filepath.Base(path),
					projectGeneration,
					evt.Current,
					evt.Total,
					schedulerStats.Pending,
					engineStats.TotalFiles,
					schedulerStats.Mode,
				)
			case core.IndexingFailed:
				payload["error"] = evt.Error
				a.emitEvent("indexer:error", payload)
				lastIndexerLog = time.Now()
				a.logInfof("[Indexer] failed session=%s project=%s generation=%d current=%d total=%d queue=%d files=%d error=%s",
					session.ID,
					filepath.Base(path),
					projectGeneration,
					evt.Current,
					evt.Total,
					schedulerStats.Pending,
					engineStats.TotalFiles,
					evt.Error,
				)
			}
		})

		// Initialize prediction brain
		session.brain = brain.NewPredictionBrain(coreEngine, brain.BrainConfig{
			MaxSuggestions:    50,
			MinConfidence:     0.1,
			EnableLSP:         true,
			EnableVirtual:     true,
			EnableSpeculative: true,
			EnablePredictive:  false,
			EnableFacades:     false,
		})
		session.brain.SetLSPManager(lspManager)
		a.syncDefaultProjectSession(session)

		projectCtx := session.projectCtx
		indexCtx, indexCancel := context.WithCancel(projectCtx)
		indexJobID := backgroundIndexerJobID(session.ID, projectGeneration)
		a.registerBackgroundJobCancel(indexJobID, indexCancel)
		session.wg.Add(1)
		go func() {
			defer session.wg.Done()
			defer a.unregisterBackgroundJobCancel(indexJobID)
			select {
			case <-indexCtx.Done():
				return
			default:
				a.logInfof("[Activation] subsystem=indexer reason=%s session=%s project=%s generation=%d", activationWorkspaceOpen, session.ID, filepath.Base(path), projectGeneration)
				if err := coreEngine.IndexProjectContext(indexCtx); err != nil {
					if errors.Is(err, context.Canceled) {
						return
					}
					a.emitEvent("indexer:error", map[string]any{
						"projectPath": path,
						"sessionId":   session.ID,
						"error":       err.Error(),
						"terminal":    true,
					})
				}
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
	)

	if lspManager != nil {
		a.emitEvent("lsp:ready", map[string]interface{}{
			"message":     "LSP servers are starting...",
			"projectPath": path,
			"generation":  projectGeneration,
			"sessionId":   session.ID,
		})
		a.emitLSPDiagnosticsStatusForSession(session.ID, path, projectGeneration, "", "", "ready", "LSP diagnostics manager is ready")
		a.logInfof("[DiagnosticsPreload] startup preload disabled session=%s project=%s generation=%d reason=lazy-lsp",
			session.ID,
			filepath.Base(path),
			projectGeneration,
		)
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

func (a *App) closeAllProjectSessions(closeTerminals bool) error {
	if a == nil {
		return nil
	}
	started := time.Now()
	registry := a.ensureProjectSessions()
	sessions := registry.list()
	if len(sessions) == 0 {
		err := a.closeProjectInSession(nil, closeTerminals)
		logShutdownStage("projectSessions.closeAll", started, "sessions=0")
		return err
	}
	var firstErr error
	for _, session := range sessions {
		if err := a.closeProjectInSession(session, closeTerminals); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	logShutdownStage(
		"projectSessions.closeAll",
		started,
		fmt.Sprintf("sessions=%d closeTerminals=%t", len(sessions), closeTerminals),
	)
	return firstErr
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
	started := time.Now()
	projectPath := session.currentProjectPath()
	a.finalizeProjectEntryHistory(session)
	if session.projectCancel != nil {
		session.projectCancel()
	}
	a.cancelDiagnosticsPreloadForSession(session)

	stageStarted := time.Now()
	session.wg.Wait()
	logShutdownStage("projectSession.waitBackground", stageStarted, "session="+session.ID)

	if snapshot, changed := a.backgroundShell.CancelJobsForProject(projectPath, "Project closed."); changed {
		a.emitBackgroundShellStatusSnapshot(snapshot)
	}

	if session.aiSession != nil {
		if a.aiService != nil {
			_ = a.aiService.CloseProject(session.ID)
		} else {
			_ = session.aiSession.Close()
		}
		session.aiSession = nil
	}

	if closeTerminals && session.termManager != nil {
		stageStarted = time.Now()
		session.termManager.CloseAll()
		logShutdownStage("terminal.closeAll", stageStarted, "session="+session.ID)
	}

	if session.plugins != nil {
		session.plugins.CloseAll()
	}

	if session.brain != nil {
		session.brain.Close()
		session.brain = nil
	}

	if session.lspManager != nil {
		stageStarted = time.Now()
		session.lspManager.StopAll()
		logShutdownStage("lsp.stopAll", stageStarted, "session="+session.ID)
		session.lspManager = nil
	}

	if session.coreEngine != nil {
		stageStarted = time.Now()
		session.coreEngine.Stop()
		logShutdownStage("coreEngine.stop", stageStarted, "session="+session.ID)
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

	var err error
	if session.projectManager != nil {
		err = session.projectManager.CloseProject()
	}

	logShutdownStage("projectSession.total", started, "session="+session.ID)
	return err
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
	session := a.activeProjectSession()
	projectPath := a.currentProjectPath()
	generation := a.activeProjectGeneration()
	sessionID := ""
	if session != nil {
		sessionID = session.ID
		projectPath = session.currentProjectPath()
		generation = session.projectGeneration.Load()
	}
	a.emitLSPDiagnosticsStatusForSession(sessionID, projectPath, generation, language, "", "unavailable", "LSP diagnostics are restarting; retained diagnostics may be stale.")
	restarted, err := manager.ForceRestart(language)
	if err != nil {
		a.emitLSPDiagnosticsStatusForSession(sessionID, projectPath, generation, language, "", "error", err.Error())
		return restarted, err
	}
	if restarted {
		a.emitLSPDiagnosticsStatusForSession(sessionID, projectPath, generation, language, "", "ready", "LSP diagnostics manager is ready")
	}
	return restarted, nil
}

// GetDevToolsStatus returns installation status of development tools (PHP, Go, Node, etc.)
func (a *App) GetDevToolsStatus() []welcome.ToolStatus {
	if a.welcomeScreen == nil {
		return nil
	}
	return a.welcomeScreen.GetToolsStatus()
}
