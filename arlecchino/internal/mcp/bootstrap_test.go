package mcp

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestEnsureProjectMCPBootstrap_CreatesConfigs(t *testing.T) {
	projectRoot := t.TempDir()
	executablePath := "/Applications/Arlecchino.app/Contents/MacOS/Arlecchino"

	paths, err := EnsureProjectMCPBootstrap(projectRoot, executablePath)
	if err != nil {
		t.Fatalf("EnsureProjectMCPBootstrap() error = %v", err)
	}

	if len(paths) != 2 {
		t.Fatalf("EnsureProjectMCPBootstrap() paths len = %d, want 2", len(paths))
	}

	projectAbs, err := filepath.Abs(projectRoot)
	if err != nil {
		t.Fatalf("Abs(projectRoot) error = %v", err)
	}

	mcpConfig := readJSONMap(t, filepath.Join(projectAbs, ".mcp.json"))
	mcpServers := requireJSONMap(t, mcpConfig, "mcpServers")
	arlecchinoServer := requireJSONMap(t, mcpServers, "arlecchino")

	if got := requireJSONString(t, arlecchinoServer, "command"); got != executablePath {
		t.Fatalf(".mcp.json command = %q, want %q", got, executablePath)
	}

	if gotArgs := requireStringSlice(t, arlecchinoServer, "args"); !reflect.DeepEqual(gotArgs, []string{"mcp-server", "--project", projectAbs}) {
		t.Fatalf(".mcp.json args = %#v, want %#v", gotArgs, []string{"mcp-server", "--project", projectAbs})
	}

	opencodeConfig := readJSONMap(t, filepath.Join(projectAbs, "opencode.json"))
	mcpSection := requireJSONMap(t, opencodeConfig, "mcp")
	opencodeServer := requireJSONMap(t, mcpSection, "arlecchino")

	if gotType := requireJSONString(t, opencodeServer, "type"); gotType != "local" {
		t.Fatalf("opencode.json mcp.arlecchino.type = %q, want %q", gotType, "local")
	}
	if gotEnabled := requireJSONBool(t, opencodeServer, "enabled"); !gotEnabled {
		t.Fatalf("opencode.json mcp.arlecchino.enabled = false, want true")
	}

	if gotCommand := requireStringSlice(t, opencodeServer, "command"); !reflect.DeepEqual(gotCommand, []string{executablePath, "mcp-server", "--project", projectAbs}) {
		t.Fatalf("opencode.json mcp.arlecchino.command = %#v, want %#v", gotCommand, []string{executablePath, "mcp-server", "--project", projectAbs})
	}
}

func TestEnsureProjectMCPBootstrap_MergesExistingConfigs(t *testing.T) {
	projectRoot := t.TempDir()
	projectAbs, err := filepath.Abs(projectRoot)
	if err != nil {
		t.Fatalf("Abs(projectRoot) error = %v", err)
	}

	executablePath := "/usr/local/bin/arlecchino"

	existingMCP := map[string]any{
		"mcpServers": map[string]any{
			"filesystem": map[string]any{
				"command": "node",
				"args":    []any{"filesystem.js"},
			},
		},
	}
	writeJSONMap(t, filepath.Join(projectAbs, ".mcp.json"), existingMCP)

	existingOpenCode := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"plugin":  []any{"mnemonic"},
		"mcp": map[string]any{
			"filesystem": map[string]any{
				"type":    "local",
				"enabled": true,
			},
		},
	}
	writeJSONMap(t, filepath.Join(projectAbs, "opencode.json"), existingOpenCode)

	_, err = EnsureProjectMCPBootstrap(projectAbs, executablePath)
	if err != nil {
		t.Fatalf("EnsureProjectMCPBootstrap() error = %v", err)
	}

	mcpConfig := readJSONMap(t, filepath.Join(projectAbs, ".mcp.json"))
	mcpServers := requireJSONMap(t, mcpConfig, "mcpServers")
	if _, ok := mcpServers["filesystem"]; !ok {
		t.Fatalf("existing .mcp.json server filesystem should be preserved")
	}
	if _, ok := mcpServers["arlecchino"]; !ok {
		t.Fatalf("new .mcp.json server arlecchino should be present")
	}

	opencodeConfig := readJSONMap(t, filepath.Join(projectAbs, "opencode.json"))
	if _, ok := opencodeConfig["plugin"]; !ok {
		t.Fatalf("existing opencode.json plugin section should be preserved")
	}

	mcpSection := requireJSONMap(t, opencodeConfig, "mcp")
	if _, ok := mcpSection["filesystem"]; !ok {
		t.Fatalf("existing opencode.json mcp.filesystem should be preserved")
	}
	if _, ok := mcpSection["arlecchino"]; !ok {
		t.Fatalf("opencode.json mcp.arlecchino should be present")
	}
}

func TestEnsureProjectMCPBootstrap_InvalidJSON(t *testing.T) {
	projectRoot := t.TempDir()
	projectAbs, err := filepath.Abs(projectRoot)
	if err != nil {
		t.Fatalf("Abs(projectRoot) error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(projectAbs, ".mcp.json"), []byte("{"), 0o644); err != nil {
		t.Fatalf("WriteFile(.mcp.json) error = %v", err)
	}

	_, err = EnsureProjectMCPBootstrap(projectAbs, "/usr/local/bin/arlecchino")
	if err == nil {
		t.Fatalf("EnsureProjectMCPBootstrap() should fail on invalid existing JSON")
	}
	if !strings.Contains(err.Error(), ".mcp.json") {
		t.Fatalf("EnsureProjectMCPBootstrap() error = %v, want contains %q", err, ".mcp.json")
	}
}

func TestEnsureProjectMCPBootstrapWithCommand_UsesPrefixArgs(t *testing.T) {
	projectRoot := t.TempDir()
	projectAbs, err := filepath.Abs(projectRoot)
	if err != nil {
		t.Fatalf("Abs(projectRoot) error = %v", err)
	}

	devRepoRoot := t.TempDir()
	command := BootstrapServerCommand{
		Executable: "go",
		PrefixArgs: []string{"-C", devRepoRoot, "run", "."},
	}

	_, err = EnsureProjectMCPBootstrapWithCommand(projectAbs, command)
	if err != nil {
		t.Fatalf("EnsureProjectMCPBootstrapWithCommand() error = %v", err)
	}

	mcpConfig := readJSONMap(t, filepath.Join(projectAbs, ".mcp.json"))
	mcpServers := requireJSONMap(t, mcpConfig, "mcpServers")
	server := requireJSONMap(t, mcpServers, "arlecchino")

	if got := requireJSONString(t, server, "command"); got != "go" {
		t.Fatalf(".mcp.json command = %q, want %q", got, "go")
	}

	wantArgs := []string{"-C", devRepoRoot, "run", ".", "mcp-server", "--project", projectAbs}
	if gotArgs := requireStringSlice(t, server, "args"); !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf(".mcp.json args = %#v, want %#v", gotArgs, wantArgs)
	}

	opencodeConfig := readJSONMap(t, filepath.Join(projectAbs, "opencode.json"))
	mcpSection := requireJSONMap(t, opencodeConfig, "mcp")
	opencodeServer := requireJSONMap(t, mcpSection, "arlecchino")

	wantOpenCodeCommand := []string{"go", "-C", devRepoRoot, "run", ".", "mcp-server", "--project", projectAbs}
	if gotCommand := requireStringSlice(t, opencodeServer, "command"); !reflect.DeepEqual(gotCommand, wantOpenCodeCommand) {
		t.Fatalf("opencode.json mcp.arlecchino.command = %#v, want %#v", gotCommand, wantOpenCodeCommand)
	}
}

func TestEnsureUserMCPBootstrap_CreatesGlobalOpenCodeConfig(t *testing.T) {
	homeDir := t.TempDir()
	executablePath := "/usr/local/bin/arlecchino"

	configPath, err := EnsureUserMCPBootstrap(homeDir, executablePath)
	if err != nil {
		t.Fatalf("EnsureUserMCPBootstrap() error = %v", err)
	}

	homeAbs, err := filepath.Abs(homeDir)
	if err != nil {
		t.Fatalf("Abs(homeDir) error = %v", err)
	}

	wantConfigPath := filepath.Join(homeAbs, ".config", "opencode", "opencode.json")
	if configPath != wantConfigPath {
		t.Fatalf("EnsureUserMCPBootstrap() path = %q, want %q", configPath, wantConfigPath)
	}

	config := readJSONMap(t, configPath)
	if gotSchema := requireJSONString(t, config, "$schema"); gotSchema != "https://opencode.ai/config.json" {
		t.Fatalf("opencode schema = %q, want %q", gotSchema, "https://opencode.ai/config.json")
	}

	mcpSection := requireJSONMap(t, config, "mcp")
	server := requireJSONMap(t, mcpSection, "arlecchino")

	if gotType := requireJSONString(t, server, "type"); gotType != "local" {
		t.Fatalf("mcp.arlecchino.type = %q, want %q", gotType, "local")
	}
	if gotEnabled := requireJSONBool(t, server, "enabled"); !gotEnabled {
		t.Fatalf("mcp.arlecchino.enabled = false, want true")
	}

	if gotCommand := requireStringSlice(t, server, "command"); !reflect.DeepEqual(gotCommand, []string{executablePath, "mcp-server"}) {
		t.Fatalf("mcp.arlecchino.command = %#v, want %#v", gotCommand, []string{executablePath, "mcp-server"})
	}
}

func TestEnsureUserMCPBootstrap_MergesExistingGlobalConfig(t *testing.T) {
	homeDir := t.TempDir()
	homeAbs, err := filepath.Abs(homeDir)
	if err != nil {
		t.Fatalf("Abs(homeDir) error = %v", err)
	}

	executablePath := "/Users/test/Arlecchino"
	configPath := filepath.Join(homeAbs, ".config", "opencode", "opencode.json")

	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll(config dir) error = %v", err)
	}

	existingConfig := map[string]any{
		"$schema": "https://opencode.ai/config.json",
		"plugin":  []any{"mnemonic"},
		"mcp": map[string]any{
			"filesystem": map[string]any{
				"type":    "local",
				"enabled": true,
			},
		},
	}
	writeJSONMap(t, configPath, existingConfig)

	_, err = EnsureUserMCPBootstrap(homeAbs, executablePath)
	if err != nil {
		t.Fatalf("EnsureUserMCPBootstrap() error = %v", err)
	}

	updatedConfig := readJSONMap(t, configPath)
	if _, ok := updatedConfig["plugin"]; !ok {
		t.Fatalf("existing plugin section should be preserved")
	}

	mcpSection := requireJSONMap(t, updatedConfig, "mcp")
	if _, ok := mcpSection["filesystem"]; !ok {
		t.Fatalf("existing mcp.filesystem should be preserved")
	}
	if _, ok := mcpSection["arlecchino"]; !ok {
		t.Fatalf("mcp.arlecchino should be added")
	}
}

func TestEnsureUserMCPBootstrap_AcceptsTrailingCommasJSON(t *testing.T) {
	homeDir := t.TempDir()
	homeAbs, err := filepath.Abs(homeDir)
	if err != nil {
		t.Fatalf("Abs(homeDir) error = %v", err)
	}

	configPath := filepath.Join(homeAbs, ".config", "opencode", "opencode.json")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll(config dir) error = %v", err)
	}

	rawWithTrailingCommas := `{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "mnemonic",
  ],
  "mcp": {
    "filesystem": {
      "type": "local",
      "enabled": true,
    },
  },
}`

	if err := os.WriteFile(configPath, []byte(rawWithTrailingCommas), 0o644); err != nil {
		t.Fatalf("WriteFile(opencode.json) error = %v", err)
	}

	_, err = EnsureUserMCPBootstrap(homeAbs, "/usr/local/bin/arlecchino")
	if err != nil {
		t.Fatalf("EnsureUserMCPBootstrap() error = %v", err)
	}

	updated := readJSONMap(t, configPath)
	mcpSection := requireJSONMap(t, updated, "mcp")
	if _, ok := mcpSection["filesystem"]; !ok {
		t.Fatalf("mcp.filesystem should be preserved after merge")
	}
	if _, ok := mcpSection["arlecchino"]; !ok {
		t.Fatalf("mcp.arlecchino should be added after merge")
	}
}

func TestEnsureUserMCPBootstrapWithCommand_UsesPrefixArgs(t *testing.T) {
	homeDir := t.TempDir()
	homeAbs, err := filepath.Abs(homeDir)
	if err != nil {
		t.Fatalf("Abs(homeDir) error = %v", err)
	}

	devRepoRoot := t.TempDir()
	command := BootstrapServerCommand{
		Executable: "go",
		PrefixArgs: []string{"-C", devRepoRoot, "run", "."},
	}

	configPath, err := EnsureUserMCPBootstrapWithCommand(homeAbs, command)
	if err != nil {
		t.Fatalf("EnsureUserMCPBootstrapWithCommand() error = %v", err)
	}

	config := readJSONMap(t, configPath)
	mcpSection := requireJSONMap(t, config, "mcp")
	server := requireJSONMap(t, mcpSection, "arlecchino")

	wantCommand := []string{"go", "-C", devRepoRoot, "run", ".", "mcp-server"}
	if gotCommand := requireStringSlice(t, server, "command"); !reflect.DeepEqual(gotCommand, wantCommand) {
		t.Fatalf("mcp.arlecchino.command = %#v, want %#v", gotCommand, wantCommand)
	}
}

func TestEnsureUniversalUserMCPBootstrap_ConfiguresOpenCodeAndCopilotAndCLI(t *testing.T) {
	homeDir := t.TempDir()
	homeAbs, err := filepath.Abs(homeDir)
	if err != nil {
		t.Fatalf("Abs(homeDir) error = %v", err)
	}

	executablePath := "/usr/local/bin/arlecchino"
	runner := &fakeCommandRunner{
		lookups: map[string]string{
			"qwen":   "/usr/local/bin/qwen",
			"codex":  "/usr/local/bin/codex",
			"claude": "/usr/local/bin/claude",
		},
	}

	result, err := ensureUniversalUserMCPBootstrapWithRunner(homeAbs, executablePath, runner)
	if err != nil {
		t.Fatalf("ensureUniversalUserMCPBootstrapWithRunner() error = %v", err)
	}

	if len(result.Paths) != 2 {
		t.Fatalf("result.Paths len = %d, want 2", len(result.Paths))
	}

	openCodePath := filepath.Join(homeAbs, ".config", "opencode", "opencode.json")
	copilotPath := filepath.Join(homeAbs, ".copilot", "mcp-config.json")

	if !containsString(result.Paths, openCodePath) {
		t.Fatalf("result.Paths should contain %q", openCodePath)
	}
	if !containsString(result.Paths, copilotPath) {
		t.Fatalf("result.Paths should contain %q", copilotPath)
	}

	copilotConfig := readJSONMap(t, copilotPath)
	mcpServers := requireJSONMap(t, copilotConfig, "mcpServers")
	copilotServer := requireJSONMap(t, mcpServers, "arlecchino")

	if got := requireJSONString(t, copilotServer, "command"); got != executablePath {
		t.Fatalf("copilot mcp command = %q, want %q", got, executablePath)
	}
	if gotArgs := requireStringSlice(t, copilotServer, "args"); !reflect.DeepEqual(gotArgs, []string{"mcp-server"}) {
		t.Fatalf("copilot mcp args = %#v, want %#v", gotArgs, []string{"mcp-server"})
	}

	wantCalls := []string{
		"qwen mcp remove -s user arlecchino",
		"qwen mcp add -s user arlecchino /usr/local/bin/arlecchino mcp-server",
		"codex mcp remove arlecchino",
		"codex mcp add arlecchino -- /usr/local/bin/arlecchino mcp-server",
		"claude mcp remove -s user arlecchino",
		"claude mcp add -s user arlecchino -- /usr/local/bin/arlecchino mcp-server",
	}

	if !reflect.DeepEqual(runner.calls, wantCalls) {
		t.Fatalf("runner.calls = %#v, want %#v", runner.calls, wantCalls)
	}
}

func TestEnsureUniversalUserMCPBootstrap_SkipsMissingCLI(t *testing.T) {
	homeDir := t.TempDir()
	runner := &fakeCommandRunner{
		lookups: map[string]string{},
	}

	result, err := ensureUniversalUserMCPBootstrapWithRunner(homeDir, "/usr/local/bin/arlecchino", runner)
	if err != nil {
		t.Fatalf("ensureUniversalUserMCPBootstrapWithRunner() error = %v", err)
	}

	if len(result.Registrations) != 3 {
		t.Fatalf("result.Registrations len = %d, want 3", len(result.Registrations))
	}

	for _, registration := range result.Registrations {
		if registration.Status != "skipped" {
			t.Fatalf("registration %s status = %q, want %q", registration.Client, registration.Status, "skipped")
		}
	}

	if len(runner.calls) != 0 {
		t.Fatalf("runner.calls should be empty when all CLIs missing, got %#v", runner.calls)
	}
}

func TestEnsureUniversalUserMCPBootstrapWithCommand_UsesPrefixArgsInCLIRegistration(t *testing.T) {
	homeDir := t.TempDir()
	homeAbs, err := filepath.Abs(homeDir)
	if err != nil {
		t.Fatalf("Abs(homeDir) error = %v", err)
	}

	devRepoRoot := t.TempDir()
	command := BootstrapServerCommand{
		Executable: "go",
		PrefixArgs: []string{"-C", devRepoRoot, "run", "."},
	}

	runner := &fakeCommandRunner{
		lookups: map[string]string{
			"qwen":   "/usr/local/bin/qwen",
			"codex":  "/usr/local/bin/codex",
			"claude": "/usr/local/bin/claude",
		},
	}

	result, err := ensureUniversalUserMCPBootstrapWithCommandAndRunner(homeAbs, command, runner)
	if err != nil {
		t.Fatalf("ensureUniversalUserMCPBootstrapWithCommandAndRunner() error = %v", err)
	}

	if len(result.Paths) != 2 {
		t.Fatalf("result.Paths len = %d, want 2", len(result.Paths))
	}

	copilotPath := filepath.Join(homeAbs, ".copilot", "mcp-config.json")
	copilotConfig := readJSONMap(t, copilotPath)
	mcpServers := requireJSONMap(t, copilotConfig, "mcpServers")
	server := requireJSONMap(t, mcpServers, "arlecchino")
	if got := requireJSONString(t, server, "command"); got != "go" {
		t.Fatalf("copilot command = %q, want %q", got, "go")
	}
	wantCopilotArgs := []string{"-C", devRepoRoot, "run", ".", "mcp-server"}
	if gotArgs := requireStringSlice(t, server, "args"); !reflect.DeepEqual(gotArgs, wantCopilotArgs) {
		t.Fatalf("copilot args = %#v, want %#v", gotArgs, wantCopilotArgs)
	}

	wantCalls := []string{
		"qwen mcp remove -s user arlecchino",
		"qwen mcp add -s user arlecchino go -C " + devRepoRoot + " run . mcp-server",
		"codex mcp remove arlecchino",
		"codex mcp add arlecchino -- go -C " + devRepoRoot + " run . mcp-server",
		"claude mcp remove -s user arlecchino",
		"claude mcp add -s user arlecchino -- go -C " + devRepoRoot + " run . mcp-server",
	}

	if !reflect.DeepEqual(runner.calls, wantCalls) {
		t.Fatalf("runner.calls = %#v, want %#v", runner.calls, wantCalls)
	}
}

type fakeCommandRunner struct {
	lookups map[string]string
	calls   []string
}

func (f *fakeCommandRunner) LookPath(name string) (string, error) {
	if path, ok := f.lookups[name]; ok {
		return path, nil
	}
	return "", errors.New("not found")
}

func (f *fakeCommandRunner) Run(name string, args ...string) error {
	f.calls = append(f.calls, strings.TrimSpace(name+" "+strings.Join(args, " ")))
	return nil
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func readJSONMap(t *testing.T, filePath string) map[string]any {
	t.Helper()

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", filePath, err)
	}

	var object map[string]any
	if err := json.Unmarshal(data, &object); err != nil {
		t.Fatalf("Unmarshal(%q) error = %v", filePath, err)
	}

	return object
}

func writeJSONMap(t *testing.T, filePath string, object map[string]any) {
	t.Helper()

	data, err := json.MarshalIndent(object, "", "  ")
	if err != nil {
		t.Fatalf("MarshalIndent(%q) error = %v", filePath, err)
	}

	if err := os.WriteFile(filePath, append(data, '\n'), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", filePath, err)
	}
}

func requireJSONMap(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()

	value, ok := parent[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}

	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("key %q should be object, got %T", key, value)
	}

	return object
}

func requireJSONString(t *testing.T, parent map[string]any, key string) string {
	t.Helper()

	value, ok := parent[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}

	text, ok := value.(string)
	if !ok {
		t.Fatalf("key %q should be string, got %T", key, value)
	}

	return text
}

func requireJSONBool(t *testing.T, parent map[string]any, key string) bool {
	t.Helper()

	value, ok := parent[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}

	flag, ok := value.(bool)
	if !ok {
		t.Fatalf("key %q should be bool, got %T", key, value)
	}

	return flag
}

func requireStringSlice(t *testing.T, parent map[string]any, key string) []string {
	t.Helper()

	value, ok := parent[key]
	if !ok {
		t.Fatalf("missing key %q", key)
	}

	array, ok := value.([]any)
	if !ok {
		t.Fatalf("key %q should be []any, got %T", key, value)
	}

	result := make([]string, 0, len(array))
	for _, item := range array {
		text, ok := item.(string)
		if !ok {
			t.Fatalf("key %q contains non-string item type %T", key, item)
		}
		result = append(result, text)
	}

	return result
}
