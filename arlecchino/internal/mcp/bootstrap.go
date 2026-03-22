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
	opencodeSchemaURL       = "https://opencode.ai/config.json"
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

	opencodeConfigPath, err := ensureProjectOpenCodeConfig(rootAbs, normalizedCommand)
	if err != nil {
		return nil, err
	}

	return []string{mcpConfigPath, opencodeConfigPath}, nil
}

func EnsureUserMCPBootstrap(homeDir, executablePath string) (string, error) {
	command, err := normalizedBootstrapServerCommand(BootstrapServerCommand{Executable: executablePath})
	if err != nil {
		return "", err
	}

	return EnsureUserMCPBootstrapWithCommand(homeDir, command)
}

func EnsureUserMCPBootstrapWithCommand(homeDir string, command BootstrapServerCommand) (string, error) {
	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return "", err
	}

	trimmedHomeDir := strings.TrimSpace(homeDir)
	if trimmedHomeDir == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", homeErr
		}
		trimmedHomeDir = home
	}

	homeAbs, err := filepath.Abs(trimmedHomeDir)
	if err != nil {
		return "", err
	}

	info, statErr := os.Stat(homeAbs)
	if statErr != nil {
		return "", statErr
	}
	if !info.IsDir() {
		return "", fmt.Errorf("home directory is not a directory")
	}

	configPath := filepath.Join(homeAbs, ".config", "opencode", "opencode.json")
	if err := ensureOpenCodeConfigAtPath(configPath, normalizedCommand, ""); err != nil {
		return "", err
	}

	return configPath, nil
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

	openCodePath, err := EnsureUserMCPBootstrapWithCommand(homeDir, normalizedCommand)
	if err != nil {
		return UniversalUserBootstrapResult{}, err
	}

	copilotPath, err := ensureCopilotUserMCPBootstrap(homeDir, normalizedCommand)
	if err != nil {
		return UniversalUserBootstrapResult{}, err
	}

	result := UniversalUserBootstrapResult{
		Paths:         []string{openCodePath, copilotPath},
		Registrations: make([]UniversalCLIRegistration, 0, 3),
	}

	globalArgs := bootstrapServerArgs("", normalizedCommand)

	plans := []struct {
		client     string
		binary     string
		removeArgs []string
		addArgs    []string
	}{
		{
			client:     "qwen",
			binary:     "qwen",
			removeArgs: []string{"mcp", "remove", "-s", "user", arlecchinoMCPServerName},
			addArgs: append(
				[]string{"mcp", "add", "-s", "user", arlecchinoMCPServerName, normalizedCommand.Executable},
				globalArgs...,
			),
		},
		{
			client:     "codex",
			binary:     "codex",
			removeArgs: []string{"mcp", "remove", arlecchinoMCPServerName},
			addArgs: append(
				[]string{"mcp", "add", arlecchinoMCPServerName, "--", normalizedCommand.Executable},
				globalArgs...,
			),
		},
		{
			client:     "claude",
			binary:     "claude",
			removeArgs: []string{"mcp", "remove", "-s", "user", arlecchinoMCPServerName},
			addArgs: append(
				[]string{"mcp", "add", "-s", "user", arlecchinoMCPServerName, "--", normalizedCommand.Executable},
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

func ensureProjectOpenCodeConfig(projectRoot string, command BootstrapServerCommand) (string, error) {
	configPath := filepath.Join(projectRoot, "opencode.json")
	if err := ensureOpenCodeConfigAtPath(configPath, command, projectRoot); err != nil {
		return "", err
	}

	return configPath, nil
}

func ensureOpenCodeConfigAtPath(configPath string, command BootstrapServerCommand, projectRoot string) error {
	configObject, err := readJSONObject(configPath)
	if err != nil {
		return err
	}

	if _, hasSchema := configObject["$schema"]; !hasSchema {
		configObject["$schema"] = opencodeSchemaURL
	}

	mcpSection, err := ensureJSONObjectChild(configObject, "mcp", configPath)
	if err != nil {
		return err
	}

	serializedCommand := make([]any, 0, 1+len(bootstrapServerArgs(projectRoot, command)))
	serializedCommand = append(serializedCommand, command.Executable)
	serializedCommand = append(serializedCommand, toAnySlice(bootstrapServerArgs(projectRoot, command))...)

	mcpSection[arlecchinoMCPServerName] = map[string]any{
		"type":    "local",
		"enabled": true,
		"command": serializedCommand,
	}

	if err := writeJSONObject(configPath, configObject); err != nil {
		return err
	}

	return nil
}

func ensureCopilotUserMCPBootstrap(homeDir string, command BootstrapServerCommand) (string, error) {
	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return "", err
	}

	trimmedHomeDir := strings.TrimSpace(homeDir)
	if trimmedHomeDir == "" {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", homeErr
		}
		trimmedHomeDir = home
	}

	homeAbs, err := filepath.Abs(trimmedHomeDir)
	if err != nil {
		return "", err
	}

	info, statErr := os.Stat(homeAbs)
	if statErr != nil {
		return "", statErr
	}
	if !info.IsDir() {
		return "", fmt.Errorf("home directory is not a directory")
	}

	configPath := filepath.Join(homeAbs, ".copilot", "mcp-config.json")
	configObject, err := readJSONObject(configPath)
	if err != nil {
		return "", err
	}

	mcpServers, err := ensureJSONObjectChild(configObject, "mcpServers", configPath)
	if err != nil {
		return "", err
	}

	mcpServers[arlecchinoMCPServerName] = map[string]any{
		"command": normalizedCommand.Executable,
		"args":    toAnySlice(bootstrapServerArgs("", normalizedCommand)),
		"tools":   []any{},
	}

	if err := writeJSONObject(configPath, configObject); err != nil {
		return "", err
	}

	return configPath, nil
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
