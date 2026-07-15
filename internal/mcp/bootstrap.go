package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

const (
	arlecchinoMCPServerName         = "arlecchino"
	maxMCPConfigInspectionFileBytes = 256 << 10
)

type BootstrapServerCommand struct {
	Executable string   `json:"executable"`
	PrefixArgs []string `json:"prefixArgs,omitempty"`
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

	server := map[string]any{
		"command": command.Executable,
		"args":    toAnySlice(bootstrapServerArgs(projectRoot, command)),
	}
	if existing, exists := mcpServers[arlecchinoMCPServerName]; exists && reflect.DeepEqual(existing, server) {
		return configPath, nil
	}
	mcpServers[arlecchinoMCPServerName] = server

	if err := writeJSONObject(configPath, configObject); err != nil {
		return "", err
	}

	return configPath, nil
}

func IsArlecchinoMCPProjectConfig(filePath string) bool {
	name := filepath.Base(filePath)
	if name != ".mcp.json" {
		extension := strings.ToLower(filepath.Ext(name))
		if extension != ".json" && extension != ".jsonc" {
			return false
		}
	}

	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() || info.Size() > maxMCPConfigInspectionFileBytes {
		return false
	}

	config, err := readJSONObject(filePath)
	if err != nil {
		return false
	}
	for _, parentKey := range []string{"mcp", "mcpServers"} {
		parent, ok := config[parentKey].(map[string]any)
		if !ok {
			continue
		}
		if _, configured := parent[arlecchinoMCPServerName]; configured {
			return true
		}
	}
	return false
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
