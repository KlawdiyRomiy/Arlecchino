package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	projectWindowLaunchFlag = "--project-window"
	projectWindowRouteParam = "arleProjectWindow"
)

type ProjectWindowLaunchResult struct {
	Handled     bool   `json:"handled"`
	ProjectPath string `json:"projectPath"`
}

type projectWindowLaunchPayload struct {
	ProjectPath string `json:"projectPath"`
	Source      string `json:"source,omitempty"`
}

type projectWindowLaunchCommand struct {
	Name string
	Args []string
}

var startProjectWindowProcess = func(command projectWindowLaunchCommand) error {
	cmd := exec.Command(command.Name, command.Args...)
	return cmd.Start()
}

func (a *App) OpenProjectWindow(path string) (ProjectWindowLaunchResult, error) {
	path = strings.TrimSpace(path)
	if err := validateProjectOpenAccess(path); err != nil {
		return ProjectWindowLaunchResult{}, err
	}

	command, err := buildCurrentProjectWindowLaunchCommand(path)
	if err != nil {
		return ProjectWindowLaunchResult{}, err
	}
	if err := startProjectWindowProcess(command); err != nil {
		return ProjectWindowLaunchResult{}, fmt.Errorf("launch project window: %w", err)
	}

	return ProjectWindowLaunchResult{
		Handled:     true,
		ProjectPath: filepath.Clean(path),
	}, nil
}

func buildCurrentProjectWindowLaunchCommand(projectPath string) (projectWindowLaunchCommand, error) {
	executable, err := os.Executable()
	if err != nil {
		return projectWindowLaunchCommand{}, fmt.Errorf("resolve executable: %w", err)
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return projectWindowLaunchCommand{}, fmt.Errorf("resolve executable path: %w", err)
	}

	return buildProjectWindowLaunchCommand(
		projectPath,
		executable,
		findProjectWindowAppBundlePath(executable),
		runtime.GOOS,
	), nil
}

func buildProjectWindowLaunchCommand(projectPath string, executablePath string, appBundlePath string, goos string) projectWindowLaunchCommand {
	args := []string{projectWindowLaunchFlag, "--open-project", filepath.Clean(projectPath)}
	if goos == "darwin" && strings.TrimSpace(appBundlePath) != "" {
		return projectWindowLaunchCommand{
			Name: "/usr/bin/open",
			Args: append([]string{
				"-n",
				filepath.Clean(appBundlePath),
				"--args",
			}, args...),
		}
	}

	return projectWindowLaunchCommand{
		Name: executablePath,
		Args: args,
	}
}

func findProjectWindowAppBundlePath(path string) string {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" || path == "." {
		return ""
	}
	for {
		if strings.HasSuffix(path, ".app") {
			return path
		}
		parent := filepath.Dir(path)
		if parent == path || parent == "." {
			return ""
		}
		path = parent
	}
}

func isProjectWindowLaunchArgs(args []string) bool {
	for _, arg := range stripExecutableArg(args) {
		if strings.TrimSpace(arg) == projectWindowLaunchFlag {
			return true
		}
	}
	return false
}

func buildProjectWindowLaunchPayloadFromLaunchArgs(args []string, workingDir string) (projectWindowLaunchPayload, bool) {
	if !isProjectWindowLaunchArgs(args) {
		return projectWindowLaunchPayload{}, false
	}

	payload, ok := buildOpenIntentFromLaunchArgs(args, workingDir)
	if !ok || payload["kind"] != "openProject" {
		return projectWindowLaunchPayload{}, false
	}

	projectPath, ok := payload["projectPath"].(string)
	if !ok || strings.TrimSpace(projectPath) == "" {
		return projectWindowLaunchPayload{}, false
	}

	return projectWindowLaunchPayload{
		ProjectPath: filepath.Clean(projectPath),
		Source:      "project-window",
	}, true
}

func buildProjectWindowURL(payload projectWindowLaunchPayload) (string, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	values := url.Values{}
	values.Set(projectWindowRouteParam, base64.RawURLEncoding.EncodeToString(data))
	return "/?" + values.Encode(), nil
}
