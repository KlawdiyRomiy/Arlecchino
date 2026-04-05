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
	"arlecchino/internal/indexer/adapters"
	"arlecchino/internal/indexer/brain"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
	lspinstaller "arlecchino/internal/lsp"
	"arlecchino/internal/mcp"
	"arlecchino/internal/plugins"
	"arlecchino/internal/plugins/common"
	"arlecchino/internal/plugins/django"
	"arlecchino/internal/plugins/laravel"
	"arlecchino/internal/plugins/rails"
	"arlecchino/internal/project"
	"arlecchino/internal/system"
	"arlecchino/internal/terminal"
	"arlecchino/internal/ui/welcome"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx               context.Context
	cmp               *composer.ComposerManager
	sys               *system.SystemManager
	projectManager    *project.ProjectManager
	welcomeScreen     *welcome.WelcomeScreen
	coreEngine        *core.Engine
	brain             completionBrain
	lspManager        *lsp.Manager
	lspInstaller      *lspinstaller.Installer
	plugins           *plugins.Registry
	termManager       *terminal.Manager
	carapaceProvider  *terminal.CarapaceProvider
	langDetector      *brain.LangDetector
	projectPath       string
	projectGeneration atomic.Uint64
	lastRequestID     atomic.Value
	mcpBridgeServer   *mcp.IDEBridgeServer
	mcpBridgeMu       sync.Mutex
	managerMu         sync.Mutex

	projectCtx    context.Context
	projectCancel context.CancelFunc
	wg            sync.WaitGroup
}

type projectWarmupStep struct {
	name string
	run  func(context.Context) error
}

func NewApp() *App {
	pm, err := project.NewProjectManager("data/projects.db")
	if err != nil {
		return &App{}
	}

	pluginRegistry := plugins.NewRegistry()
	pluginRegistry.Register(common.New())  // Git commands (always available)
	pluginRegistry.Register(laravel.New()) // Laravel/PHP framework
	pluginRegistry.Register(django.New())  // Django/Python framework
	pluginRegistry.Register(rails.New())   // Rails/Ruby framework

	termManager := terminal.NewManager()

	return &App{
		projectManager:   pm,
		welcomeScreen:    welcome.NewWelcomeScreen(pm),
		termManager:      termManager,
		carapaceProvider: terminal.NewCarapaceProvider(),
		plugins:          pluginRegistry,
	}
}
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startMCPBridge()
	a.ensureMCPConfigs()

	installer, err := lspinstaller.NewInstaller(func(progress lspinstaller.InstallProgress) {
		runtime.EventsEmit(ctx, "lsp:install:progress", progress)
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
	_ = a.CloseProject()
}

func (a *App) ensureMCPConfigs() {
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

func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello, %s. Let's create something!", name)
}

func (a *App) SelectDirectory(title string) (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: title,
	})
	return path, err
}

func (a *App) OpenProject(path string) error {
	if a.projectPath != "" {
		_ = a.closeProject(false)
	}

	projectGeneration := a.projectGeneration.Add(1)
	a.projectPath = path
	a.projectCtx, a.projectCancel = context.WithCancel(context.Background())

	if a.projectManager != nil {
		err := a.projectManager.OpenProject(path)
		if err != nil {
			return err
		}
	}

	var lspManager *lsp.Manager
	lspInstaller := a.lspInstaller
	pluginRegistry := a.plugins

	// Initialize core engine and prediction brain
	coreEngine, err := core.NewEngine(core.EngineConfig{
		ProjectID:   path,
		ProjectRoot: path,
		DBPath:      filepath.Join(path, ".arlecchino", "brain.db"),
		Workers:     4,
	})
	if err != nil {
		a.logWarning(fmt.Sprintf("core engine init failed: %v", err))
	} else {
		a.coreEngine = coreEngine
		a.coreEngine.Start()

		// Register language adapters for code indexing
		// Detect framework via plugin system
		framework := ""
		version := ""
		if a.plugins != nil {
			framework = a.plugins.DetectFramework(path)
			if framework == "laravel" {
				if v, err := laravel.GetLaravelVersion(path); err == nil {
					version = v
				}
			}
		}
		// Update project with detected framework
		if a.projectManager != nil {
			a.projectManager.UpdateFramework(framework, version)
		}
		for _, adapter := range adapters.AllAdapters(framework) {
			a.coreEngine.RegisterAdapter(adapter)
		}

		// Listen for indexing lifecycle events
		a.coreEngine.OnIndexing(func(evt core.IndexingEvent) {
			switch evt.Type {
			case core.IndexingStarted:
				a.emitEvent("indexer:started", map[string]any{"total": evt.Total})
			case core.IndexingProgress:
				a.emitEvent("indexer:progress", map[string]any{"current": evt.Current, "total": evt.Total})
			case core.IndexingCompleted:
				a.emitEvent("indexer:completed")
			}
		})

		// Initialize LSP manager for all languages
		a.lspManager = lsp.NewManager(path)
		a.lspManager.SetDiagnosticsCallback(func(language, filePath string, diagnostics []lsp.Diagnostic) {
			if a.projectGeneration.Load() != projectGeneration {
				return
			}
			a.emitEvent(
				"lsp:diagnostics",
				newLSPDiagnosticsEvent(path, projectGeneration, language, filePath, diagnostics),
			)
		})
		lspManager = a.lspManager

		// Initialize prediction brain
		a.brain = brain.NewPredictionBrain(coreEngine, brain.BrainConfig{
			MaxSuggestions:    50,
			MinConfidence:     0.1,
			EnableLSP:         true,
			EnableVirtual:     true,
			EnableSpeculative: true,
		})
		a.brain.SetLSPManager(a.lspManager)

		projectCtx := a.projectCtx
		a.wg.Add(1)
		go func() {
			defer a.wg.Done()
			select {
			case <-projectCtx.Done():
				return
			default:
				a.coreEngine.IndexProject()
			}
		}()
	}

	a.startDeferredProjectWarmup(
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
			name: "lsp configs",
			run: func(ctx context.Context) error {
				if lspManager == nil {
					return nil
				}

				select {
				case <-ctx.Done():
					return nil
				default:
				}

				defaultConfigs := lsp.DefaultConfigs(path)
				installerConfigs := lsp.ConfigsFromInstaller(path, lspInstaller)
				for _, cfg := range lsp.MergeConfigs(defaultConfigs, installerConfigs) {
					select {
					case <-ctx.Done():
						return nil
					default:
					}
					lspManager.RegisterServer(cfg)
				}

				return nil
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

				a.lspPreloadProjectDiagnostics(path, projectGeneration)
				return nil
			},
		},
	)

	a.emitEvent("lsp:ready", map[string]interface{}{
		"message":     "LSP servers are starting...",
		"projectPath": path,
		"generation":  projectGeneration,
	})
	a.startProjectFilesystemWatcher(path, projectGeneration)

	return nil
}

func (a *App) startDeferredProjectWarmup(steps ...projectWarmupStep) {
	if len(steps) == 0 || a.projectCtx == nil {
		return
	}

	ctx := a.projectCtx
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()

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

func (a *App) CloseProject() error {
	return a.closeProject(true)
}

func (a *App) closeProject(closeTerminals bool) error {
	if a.projectCancel != nil {
		a.projectCancel()
	}

	a.wg.Wait()

	if closeTerminals && a.termManager != nil {
		a.termManager.CloseAll()
	}

	if a.plugins != nil {
		a.plugins.CloseAll()
	}

	if a.brain != nil {
		a.brain.Close()
		a.brain = nil
	}

	if a.lspManager != nil {
		a.lspManager.StopAll()
		a.lspManager = nil
	}

	if a.coreEngine != nil {
		a.coreEngine.Stop()
		a.coreEngine = nil
	}

	a.managerMu.Lock()
	a.cmp = nil
	a.sys = nil
	a.managerMu.Unlock()
	a.projectPath = ""
	a.projectCtx = nil
	a.projectCancel = nil

	if a.projectManager != nil {
		return a.projectManager.CloseProject()
	}

	return nil
}

func (a *App) GetCurrentProjectID() string {
	if a.projectManager == nil || a.projectManager.CurrentProject == nil {
		return ""
	}
	return fmt.Sprintf("%d", a.projectManager.CurrentProject.ID)
}

func (a *App) GetCurrentWorkDir() string {
	return a.projectPath
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
	return a.projectPath
}

func (a *App) GetCurrentProjectFramework() string {
	if a.projectManager == nil || a.projectManager.CurrentProject == nil {
		return ""
	}

	return a.projectManager.CurrentProject.Framework
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

	if a.plugins == nil {
		return "", fmt.Errorf("plugin system not initialized")
	}

	creator := a.plugins.GetProjectCreator(framework)
	if creator == nil {
		return "", fmt.Errorf("no project creator available for framework: %s", framework)
	}

	return creator.CreateProject(name, directory)
}

// GetLSPStatus returns health status of all LSP servers
func (a *App) GetLSPStatus() []lsp.ServerStatus {
	if a.lspManager == nil {
		return nil
	}
	return a.lspManager.HealthCheck()
}

// RestartLSPServer restarts a specific LSP server if it's unhealthy
func (a *App) RestartLSPServer(language string) (bool, error) {
	if a.lspManager == nil {
		return false, nil
	}
	return a.lspManager.CheckAndRestart(language)
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
