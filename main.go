package main

import (
	"arlecchino/internal/mcp"
	"context"
	"embed"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

var errMCPUsageRequested = errors.New("mcp usage requested")
var errMCPBootstrapUsageRequested = errors.New("mcp bootstrap usage requested")

const mainWindowTitle = "Arlecchino"

type mcpBootstrapOptions struct {
	projectRoot        string
	executablePath     string
	global             bool
	devMode            bool
	devRepoRoot        string
	invocationRoot     string
	executableExplicit bool
}

func main() {
	handled, modeErr := maybeRunMCPServerMode(os.Args[1:])
	if handled {
		if modeErr != nil {
			fmt.Fprintln(os.Stderr, "Error:", modeErr)
			os.Exit(1)
		}
		return
	}

	handled, modeErr = maybeRunMCPBootstrapMode(os.Args[1:])
	if handled {
		if modeErr != nil {
			fmt.Fprintln(os.Stderr, "Error:", modeErr)
			os.Exit(1)
		}
		return
	}

	handled, modeErr = maybeRunWails3PackagedSmokeMode(os.Args[1:])
	if handled {
		if modeErr != nil {
			fmt.Fprintln(os.Stderr, "Error:", modeErr)
			os.Exit(1)
		}
		return
	}

	app := NewApp()
	wailsApp := application.New(application.Options{
		Name:        "Arlecchino",
		Description: "High-performance polyglot IDE",
		Services: []application.Service{
			application.NewServiceWithOptions(app, application.ServiceOptions{Name: "App"}),
		},
		SingleInstance: buildSingleInstanceOptions(app),
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: false,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: false,
		},
	})
	app.attachWailsApplication(wailsApp)
	registerOpenIntentApplicationEvents(app, wailsApp)

	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               "main",
		Title:              mainWindowTitle,
		Width:              1440,
		Height:             900,
		MinWidth:           1024,
		MinHeight:          768,
		Frameless:          runtime.GOOS != "darwin",
		StartState:         application.WindowStateMaximised,
		Hidden:             false,
		URL:                "/",
		UseApplicationMenu: true,
		BackgroundType:     application.BackgroundTypeTransparent,
		BackgroundColour:   application.NewRGBA(10, 10, 10, 0),
		Mac:                mainWindowMacOptions(),
		Windows: application.WindowsWindow{
			DisableIcon: false,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})
	app.attachMainWindow(mainWindow)
	wailsApp.Menu.SetApplicationMenu(app.buildApplicationMenu(nil))
	app.configurePackagedOSNativeDelivery()

	if err := wailsApp.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
	}
}

func maybeRunMCPServerMode(args []string) (bool, error) {
	if len(args) == 0 || args[0] != "mcp-server" {
		return false, nil
	}

	projectRoot, err := resolveMCPServerProjectRoot(args[1:])
	if errors.Is(err, errMCPUsageRequested) {
		printMCPServerUsage()
		return true, nil
	}
	if err != nil {
		return true, err
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	return true, mcp.RunStdioServer(ctx, projectRoot, os.Stdin, os.Stdout, os.Stderr)
}

func resolveMCPServerProjectRoot(args []string) (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	projectRoot := cwd
	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		switch arg {
		case "", "--":
			continue
		case "-h", "--help":
			return "", errMCPUsageRequested
		case "-p", "--project":
			if i+1 >= len(args) {
				return "", fmt.Errorf("missing value for %s", arg)
			}
			projectRoot = strings.TrimSpace(args[i+1])
			i++
			if projectRoot == "" {
				return "", fmt.Errorf("project path is empty")
			}
		default:
			return "", fmt.Errorf("unknown mcp-server argument: %s", arg)
		}
	}

	return projectRoot, nil
}

func printMCPServerUsage() {
	fmt.Fprintln(os.Stdout, "Usage: arlecchino mcp-server [--project <path>]")
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "Starts Arlecchino MCP server over stdio.")
	fmt.Fprintln(os.Stdout, "By default uses current working directory as project root.")
}

func maybeRunMCPBootstrapMode(args []string) (bool, error) {
	if len(args) == 0 || args[0] != "mcp-bootstrap" {
		return false, nil
	}

	bootstrapOptions, err := resolveMCPBootstrapOptions(args[1:])
	if errors.Is(err, errMCPBootstrapUsageRequested) {
		printMCPBootstrapUsage()
		return true, nil
	}
	if err != nil {
		return true, err
	}

	serverCommand, err := resolveMCPBootstrapServerCommand(bootstrapOptions)
	if err != nil {
		return true, err
	}

	paths, err := mcp.EnsureProjectMCPBootstrapWithCommand(bootstrapOptions.projectRoot, serverCommand)
	if err != nil {
		return true, err
	}

	if bootstrapOptions.global {
		globalResult, globalErr := mcp.EnsureUniversalUserMCPBootstrapWithCommand("", serverCommand)
		if globalErr != nil {
			return true, globalErr
		}
		paths = append(paths, globalResult.Paths...)

		fmt.Fprintln(os.Stdout, "CLI registration status:")
		for _, registration := range globalResult.Registrations {
			fmt.Fprintf(os.Stdout, "- %s: %s", registration.Client, registration.Status)
			if strings.TrimSpace(registration.Detail) != "" {
				fmt.Fprintf(os.Stdout, " (%s)", registration.Detail)
			}
			fmt.Fprintln(os.Stdout)
		}
		fmt.Fprintln(os.Stdout, "")
	}

	projectAbs, err := filepath.Abs(bootstrapOptions.projectRoot)
	if err != nil {
		return true, err
	}

	fmt.Fprintln(os.Stdout, "Arlecchino MCP bootstrap completed.")
	fmt.Fprintln(os.Stdout, "Written configuration files:")
	for _, path := range paths {
		fmt.Fprintf(os.Stdout, "- %s\n", path)
	}
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "Next steps:")
	if bootstrapOptions.global {
		fmt.Fprintln(os.Stdout, "- OpenCode/Copilot: restart agent session in any directory.")
		fmt.Fprintln(os.Stdout, "- Qwen/Codex/Claude: if status shows configured, restart session; otherwise run client mcp add manually.")
	} else {
		fmt.Fprintln(os.Stdout, "- OpenCode: restart agent session in this project (uses opencode.json).")
		fmt.Fprintln(os.Stdout, "- Claude Code: restart session in this project (uses .mcp.json).")
		fmt.Fprintf(os.Stdout, "- Codex CLI: codex mcp add arlecchino -- %s\n", renderBootstrapServerCommand(serverCommand, projectAbs))
		fmt.Fprintln(os.Stdout, "- Want all directories? rerun with --global.")
	}

	return true, nil
}

func resolveMCPBootstrapOptions(args []string) (mcpBootstrapOptions, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return mcpBootstrapOptions{}, err
	}

	executablePath, err := os.Executable()
	if err != nil {
		return mcpBootstrapOptions{}, err
	}

	options := mcpBootstrapOptions{
		projectRoot:        cwd,
		executablePath:     executablePath,
		global:             true,
		devMode:            false,
		devRepoRoot:        "",
		invocationRoot:     cwd,
		executableExplicit: false,
	}

	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		switch arg {
		case "", "--":
			continue
		case "-h", "--help":
			return mcpBootstrapOptions{}, errMCPBootstrapUsageRequested
		case "-g", "--global":
			options.global = true
		case "--project-only":
			options.global = false
		case "--dev":
			options.devMode = true
		case "--dev-repo":
			if i+1 >= len(args) {
				return mcpBootstrapOptions{}, fmt.Errorf("missing value for %s", arg)
			}
			options.devRepoRoot = strings.TrimSpace(args[i+1])
			i++
			if options.devRepoRoot == "" {
				return mcpBootstrapOptions{}, fmt.Errorf("dev repo path is empty")
			}
		case "-p", "--project":
			if i+1 >= len(args) {
				return mcpBootstrapOptions{}, fmt.Errorf("missing value for %s", arg)
			}
			options.projectRoot = strings.TrimSpace(args[i+1])
			i++
			if options.projectRoot == "" {
				return mcpBootstrapOptions{}, fmt.Errorf("project path is empty")
			}
		case "-e", "--executable":
			if i+1 >= len(args) {
				return mcpBootstrapOptions{}, fmt.Errorf("missing value for %s", arg)
			}
			options.executablePath = strings.TrimSpace(args[i+1])
			i++
			if options.executablePath == "" {
				return mcpBootstrapOptions{}, fmt.Errorf("executable path is empty")
			}
			options.executableExplicit = true
		default:
			return mcpBootstrapOptions{}, fmt.Errorf("unknown mcp-bootstrap argument: %s", arg)
		}
	}

	if options.devRepoRoot != "" && !options.devMode {
		return mcpBootstrapOptions{}, fmt.Errorf("--dev-repo requires --dev")
	}

	if options.devMode {
		if options.executableExplicit {
			return mcpBootstrapOptions{}, fmt.Errorf("--executable cannot be used with --dev")
		}

		if strings.TrimSpace(options.devRepoRoot) == "" {
			options.devRepoRoot = cwd
		}

		repoAbs, absErr := filepath.Abs(options.devRepoRoot)
		if absErr != nil {
			return mcpBootstrapOptions{}, absErr
		}

		repoInfo, statErr := os.Stat(repoAbs)
		if statErr != nil {
			return mcpBootstrapOptions{}, statErr
		}
		if !repoInfo.IsDir() {
			return mcpBootstrapOptions{}, fmt.Errorf("dev repo path is not a directory")
		}

		options.devRepoRoot = repoAbs
	}

	return options, nil
}

func resolveMCPBootstrapServerCommand(options mcpBootstrapOptions) (mcp.BootstrapServerCommand, error) {
	if options.devMode {
		repoRoot := strings.TrimSpace(options.devRepoRoot)
		if repoRoot == "" {
			return mcp.BootstrapServerCommand{}, fmt.Errorf("dev repo path is empty")
		}

		return mcp.BootstrapServerCommand{
			Executable: "go",
			PrefixArgs: []string{"-C", repoRoot, "run", "."},
		}, nil
	}

	if shouldUseAutoDevBootstrapCommand(options) {
		repoRoot := strings.TrimSpace(options.invocationRoot)
		return mcp.BootstrapServerCommand{
			Executable: "go",
			PrefixArgs: []string{"-C", repoRoot, "run", "."},
		}, nil
	}

	return mcp.BootstrapServerCommand{Executable: options.executablePath}, nil
}

func shouldUseAutoDevBootstrapCommand(options mcpBootstrapOptions) bool {
	if options.executableExplicit {
		return false
	}

	executablePath := strings.TrimSpace(options.executablePath)
	if executablePath == "" {
		return false
	}

	if !isLikelyGoRunExecutable(executablePath) {
		return false
	}

	repoRoot := strings.TrimSpace(options.invocationRoot)
	if repoRoot == "" {
		return false
	}

	return looksLikeArlecchinoRepoRoot(repoRoot)
}

func isLikelyGoRunExecutable(executablePath string) bool {
	trimmedPath := strings.TrimSpace(executablePath)
	if trimmedPath == "" {
		return false
	}

	absPath, err := filepath.Abs(trimmedPath)
	if err != nil {
		return false
	}

	tempDir := os.TempDir()
	if !strings.HasPrefix(absPath, tempDir+string(os.PathSeparator)) {
		return false
	}

	return strings.Contains(absPath, string(os.PathSeparator)+"go-build")
}

func looksLikeArlecchinoRepoRoot(repoRoot string) bool {
	goModPath := filepath.Join(strings.TrimSpace(repoRoot), "go.mod")
	goModData, err := os.ReadFile(goModPath)
	if err != nil {
		return false
	}

	for _, rawLine := range strings.Split(string(goModData), "\n") {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "module ") {
			moduleName := strings.TrimSpace(strings.TrimPrefix(line, "module "))
			return moduleName == "arlecchino"
		}
	}

	return false
}

func renderBootstrapServerCommand(command mcp.BootstrapServerCommand, projectRoot string) string {
	parts := make([]string, 0, len(command.PrefixArgs)+4)
	parts = append(parts, command.Executable)
	parts = append(parts, command.PrefixArgs...)
	parts = append(parts, "mcp-server")
	if strings.TrimSpace(projectRoot) != "" {
		parts = append(parts, "--project", projectRoot)
	}

	quoted := make([]string, 0, len(parts))
	for _, part := range parts {
		quoted = append(quoted, fmt.Sprintf("%q", part))
	}

	return strings.Join(quoted, " ")
}

func printMCPBootstrapUsage() {
	fmt.Fprintln(os.Stdout, "Usage: arlecchino mcp-bootstrap [--project <path>] [--executable <path>] [--global] [--dev] [--dev-repo <path>]")
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "Creates project MCP config files for Arlecchino server:")
	fmt.Fprintln(os.Stdout, "- .mcp.json")
	fmt.Fprintln(os.Stdout, "- opencode.json (mcp.arlecchino)")
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "Default behavior:")
	fmt.Fprintln(os.Stdout, "- Also updates ~/.config/opencode/opencode.json for all directories")
	fmt.Fprintln(os.Stdout, "")
	fmt.Fprintln(os.Stdout, "Optional:")
	fmt.Fprintln(os.Stdout, "- --project-only skips global opencode config update")
	fmt.Fprintln(os.Stdout, "- Auto-dev: when running from go run in arlecchino repo, bootstrap writes go-run MCP command automatically")
	fmt.Fprintln(os.Stdout, "- --dev writes MCP command for `go -C <repo> run . mcp-server`")
	fmt.Fprintln(os.Stdout, "- --dev-repo sets repo root for --dev (default: current directory)")
}
