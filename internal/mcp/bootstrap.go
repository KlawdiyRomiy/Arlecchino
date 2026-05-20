package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	arlecchinoMCPServerName = "arlecchino"
)

type UniversalUserBootstrapResult struct {
	Paths         []string                   `json:"paths"`
	Registrations []UniversalCLIRegistration `json:"registrations"`
}

type UniversalCLIRegistration struct {
	Client string `json:"client"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type BootstrapServerCommand struct {
	Executable string   `json:"executable"`
	PrefixArgs []string `json:"prefixArgs,omitempty"`
}

type commandRunner interface {
	LookPath(name string) (string, error)
	Run(name string, args ...string) error
}

type systemCommandRunner struct{}

func (r systemCommandRunner) LookPath(name string) (string, error) {
	return exec.LookPath(name)
}

func (r systemCommandRunner) Run(name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

func EnsureProjectMCPBootstrap(projectRoot, executablePath string) ([]string, error) {
	command, err := normalizedBootstrapServerCommand(BootstrapServerCommand{Executable: executablePath})
	if err != nil {
		return nil, err
	}

	return EnsureProjectMCPBootstrapWithCommand(projectRoot, command)
}

func EnsureProjectMCPBootstrapWithCommand(projectRoot string, command BootstrapServerCommand) ([]string, error) {
	trimmedRoot := strings.TrimSpace(projectRoot)
	if trimmedRoot == "" {
		return nil, fmt.Errorf("project root is empty")
	}

	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return nil, err
	}

	rootAbs, err := filepath.Abs(trimmedRoot)
	if err != nil {
		return nil, err
	}

	info, statErr := os.Stat(rootAbs)
	if statErr != nil {
		return nil, statErr
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("project root is not a directory")
	}

	mcpConfigPath, err := ensureMCPJSONConfig(rootAbs, normalizedCommand)
	if err != nil {
		return nil, err
	}

	return []string{mcpConfigPath}, nil
}

func EnsureUserMCPBootstrap(homeDir, executablePath string) (string, error) {
	command, err := normalizedBootstrapServerCommand(BootstrapServerCommand{Executable: executablePath})
	if err != nil {
		return "", err
	}

	return EnsureUserMCPBootstrapWithCommand(homeDir, command)
}

func EnsureUserMCPBootstrapWithCommand(homeDir string, command BootstrapServerCommand) (string, error) {
	if _, err := normalizedBootstrapServerCommand(command); err != nil {
		return "", err
	}
	return "", nil
}

func disableLegacyOpenCodeMCPEntries(homeDir, projectRoot string) ([]string, error) {
	paths := make([]string, 0, 2)

	userPath, changed, err := disableLegacyUserOpenCodeMCPEntry(homeDir)
	if err != nil {
		return paths, err
	}
	if changed {
		paths = append(paths, userPath)
	}

	if strings.TrimSpace(projectRoot) != "" {
		projectPath, projectChanged, projectErr := disableLegacyProjectOpenCodeMCPEntry(projectRoot)
		if projectErr != nil {
			return paths, projectErr
		}
		if projectChanged {
			paths = append(paths, projectPath)
		}
	}

	return paths, nil
}

func DisableUniversalUserMCPBootstrap(homeDir, projectRoot string) (UniversalUserBootstrapResult, error) {
	return disableUniversalUserMCPBootstrapWithRunner(homeDir, projectRoot, systemCommandRunner{})
}

func disableUniversalUserMCPBootstrapWithRunner(homeDir, projectRoot string, runner commandRunner) (UniversalUserBootstrapResult, error) {
	result := UniversalUserBootstrapResult{
		Paths:         make([]string, 0, 4),
		Registrations: make([]UniversalCLIRegistration, 0, 3),
	}

	openCodePaths, err := disableLegacyOpenCodeMCPEntries(homeDir, projectRoot)
	if err != nil {
		return result, err
	}
	result.Paths = append(result.Paths, openCodePaths...)

	copilotPath, changed, err := removeCopilotUserMCPBootstrap(homeDir)
	if err != nil {
		return result, err
	}
	if changed {
		result.Paths = append(result.Paths, copilotPath)
	}

	if strings.TrimSpace(projectRoot) != "" {
		projectPath, projectChanged, projectErr := removeProjectMCPJSONConfig(projectRoot)
		if projectErr != nil {
			return result, projectErr
		}
		if projectChanged {
			result.Paths = append(result.Paths, projectPath)
		}
	}

	plans := []struct {
		client     string
		binary     string
		removeArgs []string
	}{
		{
			client:     "qwen",
			binary:     "qwen",
			removeArgs: []string{"mcp", "remove", arlecchinoMCPServerName},
		},
		{
			client:     "codex",
			binary:     "codex",
			removeArgs: []string{"mcp", "remove", arlecchinoMCPServerName},
		},
		{
			client:     "claude",
			binary:     "claude",
			removeArgs: []string{"mcp", "remove", arlecchinoMCPServerName},
		},
	}

	for _, plan := range plans {
		if _, lookErr := runner.LookPath(plan.binary); lookErr != nil {
			result.Registrations = append(result.Registrations, UniversalCLIRegistration{
				Client: plan.client,
				Status: "skipped",
				Detail: "CLI not found in PATH",
			})
			continue
		}

		if removeErr := runner.Run(plan.binary, plan.removeArgs...); removeErr != nil {
			result.Registrations = append(result.Registrations, UniversalCLIRegistration{
				Client: plan.client,
				Status: "failed",
				Detail: removeErr.Error(),
			})
			continue
		}

		result.Registrations = append(result.Registrations, UniversalCLIRegistration{
			Client: plan.client,
			Status: "removed",
			Detail: "removed from user scope",
		})
	}

	return result, nil
}

func disableLegacyUserOpenCodeMCPEntry(homeDir string) (string, bool, error) {
	trimmedHomeDir := strings.TrimSpace(homeDir)
	if trimmedHomeDir == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", false, homeErr
		}
		trimmedHomeDir = home
	}

	homeAbs, err := filepath.Abs(trimmedHomeDir)
	if err != nil {
		return "", false, err
	}

	return disableLegacyOpenCodeMCPEntryAtPath(filepath.Join(homeAbs, ".config", "opencode", "opencode.json"))
}

func disableLegacyProjectOpenCodeMCPEntry(projectRoot string) (string, bool, error) {
	projectAbs, err := filepath.Abs(strings.TrimSpace(projectRoot))
	if err != nil {
		return "", false, err
	}
	return disableLegacyOpenCodeMCPEntryAtPath(filepath.Join(projectAbs, "opencode.json"))
}

func EnsureUniversalUserMCPBootstrap(homeDir, executablePath string) (UniversalUserBootstrapResult, error) {
	command, err := normalizedBootstrapServerCommand(BootstrapServerCommand{Executable: executablePath})
	if err != nil {
		return UniversalUserBootstrapResult{}, err
	}

	return EnsureUniversalUserMCPBootstrapWithCommand(homeDir, command)
}

func EnsureUniversalUserMCPBootstrapWithCommand(homeDir string, command BootstrapServerCommand) (UniversalUserBootstrapResult, error) {
	return ensureUniversalUserMCPBootstrapWithCommandAndRunner(homeDir, command, systemCommandRunner{})
}

func ensureUniversalUserMCPBootstrapWithRunner(homeDir, executablePath string, runner commandRunner) (UniversalUserBootstrapResult, error) {
	command, err := normalizedBootstrapServerCommand(BootstrapServerCommand{Executable: executablePath})
	if err != nil {
		return UniversalUserBootstrapResult{}, err
	}

	return ensureUniversalUserMCPBootstrapWithCommandAndRunner(homeDir, command, runner)
}

func ensureUniversalUserMCPBootstrapWithCommandAndRunner(homeDir string, command BootstrapServerCommand, runner commandRunner) (UniversalUserBootstrapResult, error) {
	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return UniversalUserBootstrapResult{}, err
	}

	result := UniversalUserBootstrapResult{
		Paths:         []string{},
		Registrations: make([]UniversalCLIRegistration, 0, 1),
	}

	globalArgs := bootstrapServerArgs("", normalizedCommand)

	plans := []struct {
		client     string
		binary     string
		removeArgs []string
		addArgs    []string
	}{
		{
			client:     "codex",
			binary:     "codex",
			removeArgs: []string{"mcp", "remove", arlecchinoMCPServerName},
			addArgs: append(
				[]string{"mcp", "add", arlecchinoMCPServerName, "--", normalizedCommand.Executable},
				globalArgs...,
			),
		},
	}

	for _, plan := range plans {
		if _, lookErr := runner.LookPath(plan.binary); lookErr != nil {
			result.Registrations = append(result.Registrations, UniversalCLIRegistration{
				Client: plan.client,
				Status: "skipped",
				Detail: "CLI not found in PATH",
			})
			continue
		}

		_ = runner.Run(plan.binary, plan.removeArgs...)
		if addErr := runner.Run(plan.binary, plan.addArgs...); addErr != nil {
			result.Registrations = append(result.Registrations, UniversalCLIRegistration{
				Client: plan.client,
				Status: "failed",
				Detail: addErr.Error(),
			})
			continue
		}

		result.Registrations = append(result.Registrations, UniversalCLIRegistration{
			Client: plan.client,
			Status: "configured",
			Detail: "registered at user scope",
		})
	}

	return result, nil
}

func normalizedBootstrapServerCommand(command BootstrapServerCommand) (BootstrapServerCommand, error) {
	executable := strings.TrimSpace(command.Executable)
	if executable == "" {
		return BootstrapServerCommand{}, fmt.Errorf("executable path is empty")
	}

	if filepath.IsAbs(executable) || strings.Contains(executable, string(os.PathSeparator)) {
		absExecutable, err := filepath.Abs(executable)
		if err != nil {
			return BootstrapServerCommand{}, err
		}
		executable = absExecutable
	}

	prefixArgs := make([]string, 0, len(command.PrefixArgs))
	for _, arg := range command.PrefixArgs {
		trimmedArg := strings.TrimSpace(arg)
		if trimmedArg == "" {
			continue
		}
		prefixArgs = append(prefixArgs, trimmedArg)
	}

	return BootstrapServerCommand{
		Executable: executable,
		PrefixArgs: prefixArgs,
	}, nil
}

func ensureMCPJSONConfig(projectRoot string, command BootstrapServerCommand) (string, error) {
	configPath := filepath.Join(projectRoot, ".mcp.json")
	configObject, err := readJSONObject(configPath)
	if err != nil {
		return "", err
	}

	mcpServers, err := ensureJSONObjectChild(configObject, "mcpServers", configPath)
	if err != nil {
		return "", err
	}

	mcpServers[arlecchinoMCPServerName] = map[string]any{
		"command": command.Executable,
		"args":    toAnySlice(bootstrapServerArgs(projectRoot, command)),
	}

	if err := writeJSONObject(configPath, configObject); err != nil {
		return "", err
	}

	return configPath, nil
}

func disableLegacyOpenCodeMCPEntryAtPath(configPath string) (string, bool, error) {
	trimmedPath := strings.TrimSpace(configPath)
	if trimmedPath == "" {
		return "", false, fmt.Errorf("opencode config path is empty")
	}

	if _, err := os.Stat(trimmedPath); err != nil {
		if os.IsNotExist(err) {
			return trimmedPath, false, nil
		}
		return trimmedPath, false, err
	}

	configObject, err := readJSONObject(trimmedPath)
	if err != nil {
		return trimmedPath, false, err
	}

	rawMCPSection, ok := configObject["mcp"]
	if !ok {
		return trimmedPath, false, nil
	}
	mcpSection, ok := rawMCPSection.(map[string]any)
	if !ok {
		return trimmedPath, false, fmt.Errorf("%s: key %q must be object", filepath.Base(trimmedPath), "mcp")
	}

	rawServer, ok := mcpSection[arlecchinoMCPServerName]
	if !ok {
		return trimmedPath, false, nil
	}
	server, ok := rawServer.(map[string]any)
	if !ok {
		return trimmedPath, false, fmt.Errorf("%s: mcp.%s must be object", filepath.Base(trimmedPath), arlecchinoMCPServerName)
	}

	if current, ok := server["enabled"].(bool); ok && !current {
		return trimmedPath, false, nil
	}

	server["enabled"] = false
	if err := writeJSONObject(trimmedPath, configObject); err != nil {
		return trimmedPath, false, err
	}

	return trimmedPath, true, nil
}

func removeProjectMCPJSONConfig(projectRoot string) (string, bool, error) {
	projectAbs, err := filepath.Abs(strings.TrimSpace(projectRoot))
	if err != nil {
		return "", false, err
	}
	return removeJSONChildAtPath(filepath.Join(projectAbs, ".mcp.json"), "mcpServers", arlecchinoMCPServerName)
}

func removeCopilotUserMCPBootstrap(homeDir string) (string, bool, error) {
	trimmedHomeDir := strings.TrimSpace(homeDir)
	if trimmedHomeDir == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", false, homeErr
		}
		trimmedHomeDir = home
	}

	homeAbs, err := filepath.Abs(trimmedHomeDir)
	if err != nil {
		return "", false, err
	}

	return removeJSONChildAtPath(filepath.Join(homeAbs, ".copilot", "mcp-config.json"), "mcpServers", arlecchinoMCPServerName)
}

func removeJSONChildAtPath(configPath, parentKey, childKey string) (string, bool, error) {
	trimmedPath := strings.TrimSpace(configPath)
	if trimmedPath == "" {
		return "", false, fmt.Errorf("config path is empty")
	}

	if _, err := os.Stat(trimmedPath); err != nil {
		if os.IsNotExist(err) {
			return trimmedPath, false, nil
		}
		return trimmedPath, false, err
	}

	configObject, err := readJSONObject(trimmedPath)
	if err != nil {
		return trimmedPath, false, err
	}

	rawParent, ok := configObject[parentKey]
	if !ok {
		return trimmedPath, false, nil
	}
	parent, ok := rawParent.(map[string]any)
	if !ok {
		return trimmedPath, false, fmt.Errorf("%s: key %q must be object", filepath.Base(trimmedPath), parentKey)
	}

	if _, ok := parent[childKey]; !ok {
		return trimmedPath, false, nil
	}

	delete(parent, childKey)
	if err := writeJSONObject(trimmedPath, configObject); err != nil {
		return trimmedPath, false, err
	}

	return trimmedPath, true, nil
}

func bootstrapServerArgs(projectRoot string, command BootstrapServerCommand) []string {
	args := make([]string, 0, len(command.PrefixArgs)+3)
	args = append(args, command.PrefixArgs...)
	args = append(args, "mcp-server")
	if strings.TrimSpace(projectRoot) != "" {
		args = append(args, "--project", projectRoot)
	}
	return args
}

func readJSONObject(filePath string) (map[string]any, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}

	if strings.TrimSpace(string(data)) == "" {
		return map[string]any{}, nil
	}

	data = trimUTF8BOM(data)

	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		sanitized := stripTrailingCommasJSON(data)
		if sanitizeErr := json.Unmarshal(sanitized, &object); sanitizeErr != nil {
			return nil, fmt.Errorf("parse %s: %w", filepath.Base(filePath), err)
		}
	}
	if object == nil {
		return map[string]any{}, nil
	}

	return object, nil
}

func ensureJSONObjectChild(parent map[string]any, key, filePath string) (map[string]any, error) {
	value, exists := parent[key]
	if !exists {
		child := map[string]any{}
		parent[key] = child
		return child, nil
	}

	child, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s: key %q must be object", filepath.Base(filePath), key)
	}

	return child, nil
}

func writeJSONObject(filePath string, object map[string]any) error {
	encoded, err := json.MarshalIndent(object, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}

	return os.WriteFile(filePath, append(encoded, '\n'), 0o644)
}

func toAnySlice(items []string) []any {
	result := make([]any, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	return result
}

func trimUTF8BOM(data []byte) []byte {
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return data[3:]
	}
	return data
}

func stripTrailingCommasJSON(data []byte) []byte {
	out := make([]byte, 0, len(data))
	inString := false
	escaped := false

	for _, b := range data {
		if inString {
			out = append(out, b)
			if escaped {
				escaped = false
				continue
			}
			if b == '\\' {
				escaped = true
				continue
			}
			if b == '"' {
				inString = false
			}
			continue
		}

		if b == '"' {
			inString = true
			out = append(out, b)
			continue
		}

		if b == '}' || b == ']' {
			trimIndex := len(out) - 1
			for trimIndex >= 0 && (out[trimIndex] == ' ' || out[trimIndex] == '\n' || out[trimIndex] == '\r' || out[trimIndex] == '\t') {
				trimIndex--
			}
			if trimIndex >= 0 && out[trimIndex] == ',' {
				out = append(out[:trimIndex], out[trimIndex+1:]...)
			}
		}

		out = append(out, b)
	}

	return out
}
