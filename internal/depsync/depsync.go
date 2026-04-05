package depsync

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Mode string

const (
	ModeManual   Mode = "manual"
	ModeSafeAuto Mode = "safe-auto"
	ModeFullAuto Mode = "full-auto"
)

type Command struct {
	Label      string `json:"label"`
	Executable string `json:"executable"`
	Args       string `json:"args"`
	Safe       bool   `json:"safe"`
}

type Manager struct {
	Ecosystem string    `json:"ecosystem"`
	Tool      string    `json:"tool"`
	Manifest  string    `json:"manifest"`
	Commands  []Command `json:"commands"`
}

type Plan struct {
	ProjectPath string    `json:"projectPath"`
	Mode        Mode      `json:"mode"`
	Managers    []Manager `json:"managers"`
}

type Executor struct {
	runner func(dir, name string, args ...string) ([]byte, error)
}

func NewExecutor() *Executor {
	return &Executor{runner: defaultRunner}
}

func defaultRunner(dir, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	return cmd.CombinedOutput()
}

func (e *Executor) BuildPlan(projectPath string, mode Mode) (Plan, error) {
	if strings.TrimSpace(projectPath) == "" {
		return Plan{}, fmt.Errorf("project path is required")
	}
	managers := detectManagers(projectPath, mode)
	return Plan{ProjectPath: projectPath, Mode: mode, Managers: managers}, nil
}

func (e *Executor) Execute(projectPath string, mode Mode) (map[string]string, error) {
	plan, err := e.BuildPlan(projectPath, mode)
	if err != nil {
		return nil, err
	}
	results := make(map[string]string, len(plan.Managers))
	for _, manager := range plan.Managers {
		for _, cmd := range manager.Commands {
			if mode == ModeManual {
				continue
			}
			if mode == ModeSafeAuto && !cmd.Safe {
				continue
			}
			key := manager.Ecosystem + ":" + cmd.Label
			if !commandAvailable(projectPath, cmd.Executable) {
				results[key] = fmt.Sprintf("skipped: missing executable %s", cmd.Executable)
				continue
			}
			args := splitArgs(cmd.Args)
			out, runErr := e.runner(projectPath, cmd.Executable, args...)
			results[key] = strings.TrimSpace(string(out))
			if runErr != nil {
				message := fmt.Sprintf("failed: %v", runErr)
				if trimmed := strings.TrimSpace(string(out)); trimmed != "" {
					message += "\n" + trimmed
				}
				results[key] = message
				continue
			}
		}
	}
	return results, nil
}

func splitArgs(args string) []string {
	if strings.TrimSpace(args) == "" {
		return nil
	}
	return strings.Fields(args)
}

func commandAvailable(projectPath, executable string) bool {
	if strings.TrimSpace(executable) == "" {
		return false
	}
	if strings.HasPrefix(executable, "./") || strings.HasPrefix(executable, "../") {
		_, err := os.Stat(filepath.Join(projectPath, executable))
		return err == nil
	}
	_, err := exec.LookPath(executable)
	return err == nil
}

func detectManagers(projectPath string, mode Mode) []Manager {
	managers := make([]Manager, 0, 8)
	appendIf := func(manifest, ecosystem, tool string, commands []Command) {
		if _, err := os.Stat(filepath.Join(projectPath, manifest)); err == nil {
			managers = append(managers, Manager{
				Ecosystem: ecosystem,
				Tool:      tool,
				Manifest:  manifest,
				Commands:  commandsForMode(commands, mode),
			})
		}
	}

	nodeTool := detectNodeTool(projectPath)
	if nodeTool != "" {
		appendIf("package.json", "node", nodeTool, []Command{
			{Label: "install", Executable: nodeTool, Args: nodeInstallArgs(nodeTool), Safe: true},
			{Label: "update", Executable: nodeTool, Args: nodeUpdateArgs(nodeTool), Safe: false},
		})
	}
	appendIf("go.mod", "go", "go", []Command{
		{Label: "tidy", Executable: "go", Args: "mod tidy", Safe: true},
		{Label: "update", Executable: "sh", Args: "-c go get -u ./... && go mod tidy", Safe: false},
	})
	appendIf("composer.json", "php", "composer", []Command{
		{Label: "install", Executable: "composer", Args: "install", Safe: true},
		{Label: "update", Executable: "composer", Args: "update", Safe: false},
	})
	appendIf("Cargo.toml", "rust", "cargo", []Command{
		{Label: "fetch", Executable: "cargo", Args: "fetch", Safe: true},
		{Label: "update", Executable: "cargo", Args: "update", Safe: false},
	})
	appendIf("Gemfile", "ruby", "bundle", []Command{
		{Label: "install", Executable: "bundle", Args: "install", Safe: true},
		{Label: "update", Executable: "bundle", Args: "update", Safe: false},
	})
	appendIf("pubspec.yaml", "dart", "dart", []Command{
		{Label: "pub-get", Executable: "dart", Args: "pub get", Safe: true},
		{Label: "pub-upgrade", Executable: "dart", Args: "pub upgrade", Safe: false},
	})
	appendIf("Package.swift", "swift", "swift", []Command{
		{Label: "resolve", Executable: "swift", Args: "package resolve", Safe: true},
		{Label: "update", Executable: "swift", Args: "package update", Safe: false},
	})
	appendIf("requirements.txt", "python", "pip", []Command{
		{Label: "install", Executable: "python3", Args: "-m pip install -r requirements.txt", Safe: true},
	})
	appendIf("pyproject.toml", "python", detectPythonTool(projectPath), []Command{
		{Label: "install", Executable: detectPythonExec(projectPath), Args: detectPythonArgs(projectPath, true), Safe: true},
		{Label: "update", Executable: detectPythonExec(projectPath), Args: detectPythonArgs(projectPath, false), Safe: false},
	})
	appendIf("pom.xml", "jvm", "maven", []Command{
		{Label: "resolve", Executable: "mvn", Args: "dependency:resolve", Safe: true},
		{Label: "update", Executable: "mvn", Args: "versions:use-latest-releases", Safe: false},
	})
	if hasGradle(projectPath) {
		managers = append(managers, Manager{
			Ecosystem: "jvm",
			Tool:      detectGradleTool(projectPath),
			Manifest:  detectGradleManifest(projectPath),
			Commands: commandsForMode([]Command{
				{Label: "dependencies", Executable: detectGradleTool(projectPath), Args: "dependencies", Safe: true},
				{Label: "refresh", Executable: detectGradleTool(projectPath), Args: "--refresh-dependencies", Safe: false},
			}, mode),
		})
	}
	appendIf("packages.config", "dotnet", "nuget", []Command{
		{Label: "restore", Executable: "dotnet", Args: "restore", Safe: true},
	})
	appendIf(".terraform.lock.hcl", "terraform", "terraform", []Command{
		{Label: "init", Executable: "terraform", Args: "init -backend=false", Safe: true},
		{Label: "upgrade", Executable: "terraform", Args: "init -upgrade -backend=false", Safe: false},
	})

	return managers
}

func commandsForMode(commands []Command, mode Mode) []Command {
	if mode == ModeManual {
		return commands
	}
	filtered := make([]Command, 0, len(commands))
	for _, cmd := range commands {
		if mode == ModeSafeAuto && !cmd.Safe {
			continue
		}
		filtered = append(filtered, cmd)
	}
	return filtered
}

func detectNodeTool(projectPath string) string {
	for _, pair := range []struct{ file, tool string }{{"pnpm-lock.yaml", "pnpm"}, {"yarn.lock", "yarn"}, {"package-lock.json", "npm"}, {"bun.lockb", "bun"}} {
		if _, err := os.Stat(filepath.Join(projectPath, pair.file)); err == nil {
			return pair.tool
		}
	}
	if _, err := os.Stat(filepath.Join(projectPath, "package.json")); err == nil {
		return "npm"
	}
	return ""
}

func nodeInstallArgs(tool string) string {
	switch tool {
	case "pnpm", "yarn", "bun":
		return "install"
	default:
		return "install"
	}
}

func nodeUpdateArgs(tool string) string {
	switch tool {
	case "pnpm":
		return "update --latest"
	case "yarn":
		return "upgrade"
	case "bun":
		return "update"
	default:
		return "update"
	}
}

func detectPythonTool(projectPath string) string {
	data, err := os.ReadFile(filepath.Join(projectPath, "pyproject.toml"))
	if err != nil {
		return "python3"
	}
	content := string(data)
	if strings.Contains(content, "[tool.poetry]") {
		return "poetry"
	}
	if strings.Contains(content, "[tool.uv") || strings.Contains(content, "uv]") {
		return "uv"
	}
	return "python3"
}

func detectPythonExec(projectPath string) string {
	tool := detectPythonTool(projectPath)
	if tool == "poetry" || tool == "uv" {
		return tool
	}
	return "python3"
}

func detectPythonArgs(projectPath string, safe bool) string {
	switch detectPythonTool(projectPath) {
	case "poetry":
		if safe {
			return "install"
		}
		return "update"
	case "uv":
		if safe {
			return "sync"
		}
		return "lock --upgrade"
	default:
		if safe {
			return "-m pip install -e ."
		}
		return "-m pip install --upgrade -e ."
	}
}

func hasGradle(projectPath string) bool {
	return detectGradleManifest(projectPath) != ""
}

func detectGradleManifest(projectPath string) string {
	for _, name := range []string{"build.gradle.kts", "build.gradle"} {
		if _, err := os.Stat(filepath.Join(projectPath, name)); err == nil {
			return name
		}
	}
	return ""
}

func detectGradleTool(projectPath string) string {
	for _, name := range []string{"gradlew", "gradlew.bat"} {
		if _, err := os.Stat(filepath.Join(projectPath, name)); err == nil {
			return "./" + name
		}
	}
	return "gradle"
}
