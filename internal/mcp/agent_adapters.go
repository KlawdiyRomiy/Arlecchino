package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"
)

const (
	agentMCPAdapterVersion      = 1
	agentMCPAdapterDirectory    = "agent-mcp-adapters"
	agentMCPStdioTransport      = "mcp-stdio"
	agentMCPACPTransport        = "acp"
	maxAgentMCPAdapterFileBytes = 256 << 10
	maxProjectMCPConfigFiles    = 128
	maxClientConfigFiles        = 32
	agentMCPCLICommandTimeout   = 3 * time.Second
)

type AgentMCPAdapter struct {
	Version        int                   `json:"version"`
	ID             string                `json:"id"`
	Transport      string                `json:"transport"`
	LaunchBinaries []string              `json:"launchBinaries,omitempty"`
	Config         AgentMCPAdapterConfig `json:"config"`
}

type AgentMCPAdapterConfig struct {
	Path         string         `json:"path"`
	ServerParent string         `json:"serverParent"`
	Server       map[string]any `json:"server"`
}

type AgentMCPAttachmentResult struct {
	AdapterID string `json:"adapterId"`
	Path      string `json:"path,omitempty"`
	Status    string `json:"status"`
	Detail    string `json:"detail,omitempty"`
}

func EnsureDiscoveredAgentMCPAttachments(projectRoot string, command BootstrapServerCommand, includeUserAdapters bool) ([]AgentMCPAttachmentResult, error) {
	projectAbs, err := normalizeProjectRoot(projectRoot)
	if err != nil {
		return nil, err
	}

	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return nil, err
	}

	adapterDirs := agentMCPAdapterDirectories(projectAbs, includeUserAdapters)
	return ensureAgentMCPAttachments(adapterDirs, projectAbs, normalizedCommand)
}

func DiscoveredAgentMCPLaunchBinaries(projectRoot string, includeUserAdapters bool) []string {
	projectAbs, err := normalizeProjectRoot(projectRoot)
	if err != nil {
		return nil
	}
	descriptors, _ := readAgentMCPAdapters(agentMCPAdapterDirectories(projectAbs, includeUserAdapters))
	seen := make(map[string]struct{})
	binaries := make([]string, 0)
	for _, descriptor := range descriptors {
		for _, binary := range descriptor.adapter.LaunchBinaries {
			trimmedBinary := strings.TrimSpace(binary)
			if trimmedBinary == "" {
				continue
			}
			if _, exists := seen[trimmedBinary]; exists {
				continue
			}
			seen[trimmedBinary] = struct{}{}
			binaries = append(binaries, trimmedBinary)
		}
	}
	sort.Strings(binaries)
	return binaries
}

func EnsureInferredProjectMCPAttachments(projectRoot string, command BootstrapServerCommand) ([]AgentMCPAttachmentResult, error) {
	projectAbs, err := normalizeProjectRoot(projectRoot)
	if err != nil {
		return nil, err
	}

	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(projectAbs)
	if err != nil {
		return nil, err
	}

	results := make([]AgentMCPAttachmentResult, 0)
	processed := 0
	for _, entry := range entries {
		if processed >= maxProjectMCPConfigFiles {
			break
		}
		if entry.IsDir() || !isProjectMCPConfigFilename(entry.Name()) {
			continue
		}
		processed++

		configPath := filepath.Join(projectAbs, entry.Name())
		result, ok := ensureInferredProjectMCPAttachment(configPath, projectAbs, normalizedCommand)
		if ok {
			results = append(results, result)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Path < results[j].Path
	})
	return results, nil
}

func EnsureDiscoveredClientProjectMCPAttachment(projectRoot, binary string, command BootstrapServerCommand) (AgentMCPAttachmentResult, bool, error) {
	projectAbs, err := normalizeProjectRoot(projectRoot)
	if err != nil {
		return AgentMCPAttachmentResult{}, false, err
	}

	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return AgentMCPAttachmentResult{}, false, err
	}

	configName := clientConfigName(binary)
	if configName == "" {
		return AgentMCPAttachmentResult{}, false, nil
	}

	seeds, err := discoverClientProjectConfigSeeds(configName)
	if err != nil {
		return AgentMCPAttachmentResult{}, false, err
	}
	if len(seeds) == 0 {
		return AgentMCPAttachmentResult{}, false, nil
	}

	for _, seed := range seeds {
		configPath := filepath.Join(projectAbs, seed.filename)
		result, handled := ensureDiscoveredClientProjectMCPAttachment(configPath, projectAbs, normalizedCommand, seed.config)
		if handled {
			return result, true, nil
		}
	}

	return AgentMCPAttachmentResult{}, false, nil
}

type clientProjectConfigSeed struct {
	filename string
	config   map[string]any
}

func clientConfigName(binary string) string {
	trimmedBinary := strings.TrimSpace(binary)
	if trimmedBinary == "" {
		return ""
	}
	return strings.TrimSpace(filepath.Base(trimmedBinary))
}

func discoverClientProjectConfigSeeds(binary string) ([]clientProjectConfigSeed, error) {
	seeds := make([]clientProjectConfigSeed, 0)
	seenFilenames := make(map[string]struct{})
	for _, configRoot := range clientConfigRoots() {
		clientConfigDir := filepath.Join(configRoot, binary)
		entries, err := os.ReadDir(clientConfigDir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		for _, entry := range entries {
			if len(seeds) >= maxClientConfigFiles || entry.IsDir() || !isProjectMCPConfigFilename(entry.Name()) {
				continue
			}
			if _, seen := seenFilenames[entry.Name()]; seen {
				continue
			}

			config, readErr := readJSONObject(filepath.Join(clientConfigDir, entry.Name()))
			if readErr != nil || !isClientProjectConfigSeed(config) {
				continue
			}
			seenFilenames[entry.Name()] = struct{}{}
			seeds = append(seeds, clientProjectConfigSeed{filename: entry.Name(), config: config})
		}
	}

	sort.Slice(seeds, func(i, j int) bool {
		return seeds[i].filename < seeds[j].filename
	})
	return seeds, nil
}

func clientConfigRoots() []string {
	roots := make([]string, 0, 3)
	appendRoot := func(path string) {
		trimmedPath := strings.TrimSpace(path)
		if trimmedPath == "" {
			return
		}
		for _, existing := range roots {
			if existing == trimmedPath {
				return
			}
		}
		roots = append(roots, trimmedPath)
	}

	appendRoot(os.Getenv("XDG_CONFIG_HOME"))
	if configRoot, err := os.UserConfigDir(); err == nil {
		appendRoot(configRoot)
	}
	if homeDir, err := os.UserHomeDir(); err == nil {
		appendRoot(filepath.Join(homeDir, ".config"))
	}
	return roots
}

func isClientProjectConfigSeed(config map[string]any) bool {
	if schema, ok := config["$schema"].(string); ok && strings.TrimSpace(schema) != "" {
		return true
	}
	_, hasMCP := config["mcp"].(map[string]any)
	return hasMCP
}

func ensureDiscoveredClientProjectMCPAttachment(configPath, projectRoot string, command BootstrapServerCommand, seed map[string]any) (AgentMCPAttachmentResult, bool) {
	config, err := readJSONObject(configPath)
	if err != nil {
		return AgentMCPAttachmentResult{AdapterID: "discovered-client-config", Path: configPath, Status: "failed", Detail: err.Error()}, true
	}

	if _, hasSchema := config["$schema"]; !hasSchema {
		if schema, ok := seed["$schema"].(string); ok && strings.TrimSpace(schema) != "" {
			config["$schema"] = schema
		}
	}

	parent, err := ensureJSONObjectChild(config, "mcp", configPath)
	if err != nil {
		return AgentMCPAttachmentResult{AdapterID: "discovered-client-config", Path: configPath, Status: "unsupported_config", Detail: err.Error()}, true
	}

	server := localMCPServerConfig(projectRoot, command)
	if existing, configured := parent[arlecchinoMCPServerName]; configured && reflect.DeepEqual(existing, server) {
		return AgentMCPAttachmentResult{AdapterID: "discovered-client-config", Path: configPath, Status: "already_configured"}, true
	}

	parent[arlecchinoMCPServerName] = server
	if err := writeJSONObject(configPath, config); err != nil {
		return AgentMCPAttachmentResult{AdapterID: "discovered-client-config", Path: configPath, Status: "failed", Detail: err.Error()}, true
	}

	return AgentMCPAttachmentResult{AdapterID: "discovered-client-config", Path: configPath, Status: "configured"}, true
}

func localMCPServerConfig(projectRoot string, command BootstrapServerCommand) map[string]any {
	argv := append([]string{command.Executable}, bootstrapServerArgs(projectRoot, command)...)
	return map[string]any{
		"type":    "local",
		"command": toAnySlice(argv),
	}
}

func isProjectMCPConfigFilename(name string) bool {
	trimmedName := strings.TrimSpace(name)
	if trimmedName == ".mcp.json" {
		return false
	}
	extension := strings.ToLower(filepath.Ext(trimmedName))
	return extension == ".json" || extension == ".jsonc"
}

func ensureInferredProjectMCPAttachment(configPath, projectRoot string, command BootstrapServerCommand) (AgentMCPAttachmentResult, bool) {
	info, err := os.Stat(configPath)
	if err != nil || info.IsDir() || info.Size() > maxAgentMCPAdapterFileBytes {
		return AgentMCPAttachmentResult{}, false
	}

	configObject, err := readJSONObject(configPath)
	if err != nil {
		return AgentMCPAttachmentResult{}, false
	}

	for _, parentKey := range []string{"mcp", "mcpServers"} {
		parent, exists := configObject[parentKey].(map[string]any)
		if !exists {
			continue
		}

		server, inferred := inferredMCPServerConfig(parent, projectRoot, command)
		if !inferred {
			if _, configured := parent[arlecchinoMCPServerName]; configured {
				return AgentMCPAttachmentResult{AdapterID: "inferred-project-config", Path: configPath, Status: "already_configured"}, true
			}
			return AgentMCPAttachmentResult{AdapterID: "inferred-project-config", Path: configPath, Status: "unsupported_config", Detail: "MCP server shape could not be inferred"}, true
		}

		if existing, configured := parent[arlecchinoMCPServerName]; configured && reflect.DeepEqual(existing, server) {
			return AgentMCPAttachmentResult{AdapterID: "inferred-project-config", Path: configPath, Status: "already_configured"}, true
		}

		parent[arlecchinoMCPServerName] = server
		if err := writeJSONObject(configPath, configObject); err != nil {
			return AgentMCPAttachmentResult{AdapterID: "inferred-project-config", Path: configPath, Status: "failed", Detail: err.Error()}, true
		}
		return AgentMCPAttachmentResult{AdapterID: "inferred-project-config", Path: configPath, Status: "configured"}, true
	}

	return AgentMCPAttachmentResult{}, false
}

func inferredMCPServerConfig(parent map[string]any, projectRoot string, command BootstrapServerCommand) (map[string]any, bool) {
	keys := make([]string, 0, len(parent))
	for key := range parent {
		if key != arlecchinoMCPServerName {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)

	for _, key := range keys {
		existing, ok := parent[key].(map[string]any)
		if !ok {
			continue
		}

		switch existingCommand := existing["command"].(type) {
		case []any:
			if !isStringArray(existingCommand) {
				continue
			}
			server := map[string]any{
				"command": toAnySlice(append([]string{command.Executable}, bootstrapServerArgs(projectRoot, command)...)),
			}
			if serverType, ok := existing["type"].(string); ok && strings.TrimSpace(serverType) != "" {
				server["type"] = serverType
			}
			if _, enabled := existing["enabled"].(bool); enabled {
				server["enabled"] = true
			}
			return server, true
		case string:
			if strings.TrimSpace(existingCommand) == "" {
				continue
			}
			server := map[string]any{
				"command": command.Executable,
				"args":    toAnySlice(bootstrapServerArgs(projectRoot, command)),
			}
			if serverType, ok := existing["type"].(string); ok && strings.TrimSpace(serverType) != "" {
				server["type"] = serverType
			}
			if _, enabled := existing["enabled"].(bool); enabled {
				server["enabled"] = true
			}
			return server, true
		}
	}

	return nil, false
}

func isStringArray(values []any) bool {
	if len(values) == 0 {
		return false
	}
	for _, value := range values {
		if _, ok := value.(string); !ok {
			return false
		}
	}
	return true
}

func EnsureCanonicalMCPCLIAttachment(projectRoot, binary string, command BootstrapServerCommand) (AgentMCPAttachmentResult, bool, error) {
	projectAbs, err := normalizeProjectRoot(projectRoot)
	if err != nil {
		return AgentMCPAttachmentResult{}, false, err
	}

	normalizedCommand, err := normalizedBootstrapServerCommand(command)
	if err != nil {
		return AgentMCPAttachmentResult{}, false, err
	}

	trimmedBinary := strings.TrimSpace(binary)
	if trimmedBinary == "" {
		return AgentMCPAttachmentResult{}, false, nil
	}
	resolvedBinary, err := exec.LookPath(trimmedBinary)
	if err != nil {
		return AgentMCPAttachmentResult{}, false, nil
	}

	help, err := runAgentMCPCLICommand(projectAbs, resolvedBinary, "mcp", "add", "--help")
	addSyntax, supported := canonicalMCPCLIAddSyntax(help)
	if err != nil || !supported {
		return AgentMCPAttachmentResult{}, false, nil
	}

	result := AgentMCPAttachmentResult{AdapterID: "mcp-cli", Path: resolvedBinary}
	listed, listErr := runAgentMCPCLICommand(projectAbs, resolvedBinary, "mcp", "list")
	if listErr == nil && strings.Contains(strings.ToLower(listed), arlecchinoMCPServerName) {
		result.Status = "already_configured"
		return result, true, nil
	}

	args := []string{"mcp", "add", arlecchinoMCPServerName}
	if addSyntax == mcpCLIAddSyntaxDoubleDash {
		args = append(args, "--")
	}
	args = append(args, normalizedCommand.Executable)
	args = append(args, bootstrapServerArgs(projectAbs, normalizedCommand)...)
	if _, err := runAgentMCPCLICommand(projectAbs, resolvedBinary, args...); err != nil {
		result.Status = "failed"
		result.Detail = err.Error()
		return result, true, nil
	}

	result.Status = "configured"
	return result, true, nil
}

type mcpCLIAddSyntax int

const (
	mcpCLIAddSyntaxDirect mcpCLIAddSyntax = iota
	mcpCLIAddSyntaxDoubleDash
)

func canonicalMCPCLIAddSyntax(help string) (mcpCLIAddSyntax, bool) {
	normalizedHelp := strings.ToLower(help)
	if !strings.Contains(normalizedHelp, "mcp add") || !strings.Contains(normalizedHelp, "<name>") {
		return mcpCLIAddSyntaxDirect, false
	}
	if strings.Contains(normalizedHelp, "<name> <commandorurl>") {
		return mcpCLIAddSyntaxDirect, true
	}
	if strings.Contains(normalizedHelp, "-- <command>") {
		return mcpCLIAddSyntaxDoubleDash, true
	}
	return mcpCLIAddSyntaxDirect, false
}

func runAgentMCPCLICommand(projectRoot, binary string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), agentMCPCLICommandTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, args...)
	command.Dir = projectRoot
	output, err := command.CombinedOutput()
	if ctx.Err() != nil {
		return string(output), ctx.Err()
	}
	if err != nil {
		return string(output), err
	}
	return string(output), nil
}

func normalizeProjectRoot(projectRoot string) (string, error) {
	trimmedRoot := strings.TrimSpace(projectRoot)
	if trimmedRoot == "" {
		return "", fmt.Errorf("project root is empty")
	}

	projectAbs, err := filepath.Abs(trimmedRoot)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(projectAbs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project root is not a directory")
	}
	return projectAbs, nil
}

func agentMCPAdapterDirectories(projectRoot string, includeUserAdapters bool) []string {
	directories := []string{filepath.Join(projectRoot, ".arlecchino", agentMCPAdapterDirectory)}
	if !includeUserAdapters {
		return directories
	}

	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return directories
	}
	return append(directories, filepath.Join(configDir, "arlecchino", agentMCPAdapterDirectory))
}

func ensureAgentMCPAttachments(adapterDirs []string, projectRoot string, command BootstrapServerCommand) ([]AgentMCPAttachmentResult, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	descriptors, results := readAgentMCPAdapters(adapterDirs)
	seen := make(map[string]struct{}, len(descriptors))
	for _, descriptor := range descriptors {
		if _, exists := seen[descriptor.adapter.ID]; exists {
			results = append(results, AgentMCPAttachmentResult{
				AdapterID: descriptor.adapter.ID,
				Path:      descriptor.path,
				Status:    "invalid",
				Detail:    "duplicate adapter id",
			})
			continue
		}
		seen[descriptor.adapter.ID] = struct{}{}

		result := attachAgentMCPAdapter(descriptor.adapter, projectRoot, homeDir, configDir, command)
		results = append(results, result)
	}

	return results, nil
}

type discoveredAgentMCPAdapter struct {
	path    string
	adapter AgentMCPAdapter
}

func readAgentMCPAdapters(adapterDirs []string) ([]discoveredAgentMCPAdapter, []AgentMCPAttachmentResult) {
	descriptors := make([]discoveredAgentMCPAdapter, 0)
	results := make([]AgentMCPAttachmentResult, 0)

	for _, adapterDir := range adapterDirs {
		entries, err := os.ReadDir(adapterDir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			results = append(results, AgentMCPAttachmentResult{
				Path:   adapterDir,
				Status: "failed",
				Detail: err.Error(),
			})
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
				continue
			}

			path := filepath.Join(adapterDir, entry.Name())
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				results = append(results, AgentMCPAttachmentResult{Path: path, Status: "failed", Detail: readErr.Error()})
				continue
			}
			if len(data) > maxAgentMCPAdapterFileBytes {
				results = append(results, AgentMCPAttachmentResult{Path: path, Status: "invalid", Detail: "adapter declaration exceeds size limit"})
				continue
			}

			var adapter AgentMCPAdapter
			if err := json.Unmarshal(data, &adapter); err != nil {
				results = append(results, AgentMCPAttachmentResult{Path: path, Status: "invalid", Detail: fmt.Sprintf("parse adapter declaration: %v", err)})
				continue
			}
			if err := validateAgentMCPAdapter(adapter); err != nil {
				results = append(results, AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: path, Status: "invalid", Detail: err.Error()})
				continue
			}
			descriptors = append(descriptors, discoveredAgentMCPAdapter{path: path, adapter: adapter})
		}
	}

	sort.Slice(descriptors, func(i, j int) bool {
		return descriptors[i].path < descriptors[j].path
	})
	sort.Slice(results, func(i, j int) bool {
		return results[i].Path < results[j].Path
	})
	return descriptors, results
}

func validateAgentMCPAdapter(adapter AgentMCPAdapter) error {
	if adapter.Version != agentMCPAdapterVersion {
		return fmt.Errorf("unsupported adapter version %d", adapter.Version)
	}
	if !isSafeAgentMCPAdapterID(adapter.ID) {
		return fmt.Errorf("adapter id must contain only letters, digits, '.', '-', or '_'")
	}
	if strings.TrimSpace(adapter.Transport) == "" {
		return fmt.Errorf("adapter transport is empty")
	}
	if adapter.Transport != agentMCPStdioTransport && adapter.Transport != agentMCPACPTransport {
		return fmt.Errorf("unsupported adapter transport %q", adapter.Transport)
	}
	for _, binary := range adapter.LaunchBinaries {
		if strings.TrimSpace(binary) == "" {
			return fmt.Errorf("adapter launch binaries cannot contain empty values")
		}
	}
	if adapter.Transport == agentMCPACPTransport {
		return nil
	}
	if strings.TrimSpace(adapter.Config.Path) == "" {
		return fmt.Errorf("adapter config path is empty")
	}
	if !strings.HasPrefix(adapter.Config.ServerParent, "/") {
		return fmt.Errorf("adapter serverParent must be a JSON pointer")
	}
	if len(adapter.Config.Server) == 0 {
		return fmt.Errorf("adapter server template is empty")
	}
	return nil
}

func isSafeAgentMCPAdapterID(id string) bool {
	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" || len(trimmedID) > 128 {
		return false
	}
	for _, r := range trimmedID {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func attachAgentMCPAdapter(adapter AgentMCPAdapter, projectRoot, homeDir, configDir string, command BootstrapServerCommand) AgentMCPAttachmentResult {
	if adapter.Transport == agentMCPACPTransport {
		return AgentMCPAttachmentResult{
			AdapterID: adapter.ID,
			Status:    "requires_acp_runtime",
			Detail:    "ACP agents are connected by the runtime launcher, not terminal configuration",
		}
	}

	configPath, err := expandAgentMCPPath(adapter.Config.Path, projectRoot, homeDir, configDir)
	if err != nil {
		return AgentMCPAttachmentResult{AdapterID: adapter.ID, Status: "invalid", Detail: err.Error()}
	}

	server, err := expandAgentMCPServerTemplate(adapter.Config.Server, projectRoot, command)
	if err != nil {
		return AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: configPath, Status: "invalid", Detail: err.Error()}
	}

	configObject, err := readJSONObject(configPath)
	if err != nil {
		return AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: configPath, Status: "failed", Detail: err.Error()}
	}
	parent, err := ensureJSONObjectPointer(configObject, adapter.Config.ServerParent, configPath)
	if err != nil {
		return AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: configPath, Status: "failed", Detail: err.Error()}
	}

	if existing, exists := parent[arlecchinoMCPServerName]; exists && reflect.DeepEqual(existing, server) {
		return AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: configPath, Status: "already_configured"}
	}

	parent[arlecchinoMCPServerName] = server
	if err := writeJSONObject(configPath, configObject); err != nil {
		return AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: configPath, Status: "failed", Detail: err.Error()}
	}
	return AgentMCPAttachmentResult{AdapterID: adapter.ID, Path: configPath, Status: "configured"}
}

func expandAgentMCPPath(template, projectRoot, homeDir, configDir string) (string, error) {
	path := strings.TrimSpace(template)
	replacements := map[string]string{
		"${project.root}": projectRoot,
		"${user.home}":    homeDir,
		"${user.config}":  configDir,
	}
	for token, value := range replacements {
		path = strings.ReplaceAll(path, token, value)
	}
	if strings.Contains(path, "${") {
		return "", fmt.Errorf("adapter config path contains an unknown template variable")
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("adapter config path must resolve to an absolute path")
	}

	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !isPathWithin(resolved, projectRoot) && !isPathWithin(resolved, homeDir) && !isPathWithin(resolved, configDir) {
		return "", fmt.Errorf("adapter config path must stay within the project or user configuration directories")
	}
	return resolved, nil
}

func isPathWithin(path, root string) bool {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative)
}

func expandAgentMCPServerTemplate(template map[string]any, projectRoot string, command BootstrapServerCommand) (map[string]any, error) {
	baseArgs := bootstrapServerArgs("", command)
	projectArgs := bootstrapServerArgs(projectRoot, command)
	values := map[string]any{
		"${arlecchino.command}":     command.Executable,
		"${arlecchino.args}":        toAnySlice(baseArgs),
		"${arlecchino.argv}":        toAnySlice(append([]string{command.Executable}, baseArgs...)),
		"${arlecchino.projectArgs}": toAnySlice(projectArgs),
		"${arlecchino.projectArgv}": toAnySlice(append([]string{command.Executable}, projectArgs...)),
		"${project.root}":           projectRoot,
	}

	expanded, err := expandAgentMCPTemplateValue(template, values)
	if err != nil {
		return nil, err
	}
	server, ok := expanded.(map[string]any)
	if !ok || len(server) == 0 {
		return nil, fmt.Errorf("adapter server template must resolve to an object")
	}
	return server, nil
}

func expandAgentMCPTemplateValue(value any, values map[string]any) (any, error) {
	switch typed := value.(type) {
	case string:
		if replacement, exists := values[typed]; exists {
			return cloneAgentMCPTemplateValue(replacement), nil
		}
		for token, replacement := range values {
			if strings.Contains(typed, token) {
				text, ok := replacement.(string)
				if !ok {
					return nil, fmt.Errorf("template variable %s must be the whole JSON value", token)
				}
				typed = strings.ReplaceAll(typed, token, text)
			}
		}
		if strings.Contains(typed, "${") {
			return nil, fmt.Errorf("server template contains an unknown template variable")
		}
		return typed, nil
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, child := range typed {
			expanded, err := expandAgentMCPTemplateValue(child, values)
			if err != nil {
				return nil, err
			}
			result[key] = expanded
		}
		return result, nil
	case []any:
		result := make([]any, 0, len(typed))
		for _, child := range typed {
			expanded, err := expandAgentMCPTemplateValue(child, values)
			if err != nil {
				return nil, err
			}
			result = append(result, expanded)
		}
		return result, nil
	default:
		return typed, nil
	}
}

func cloneAgentMCPTemplateValue(value any) any {
	switch typed := value.(type) {
	case []any:
		result := make([]any, len(typed))
		copy(result, typed)
		return result
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, child := range typed {
			result[key] = cloneAgentMCPTemplateValue(child)
		}
		return result
	default:
		return typed
	}
}

func ensureJSONObjectPointer(object map[string]any, pointer, filePath string) (map[string]any, error) {
	if pointer == "" {
		return object, nil
	}
	if !strings.HasPrefix(pointer, "/") {
		return nil, fmt.Errorf("%s: JSON pointer must start with '/'", filepath.Base(filePath))
	}

	current := object
	for _, rawSegment := range strings.Split(strings.TrimPrefix(pointer, "/"), "/") {
		segment, err := unescapeJSONPointerSegment(rawSegment)
		if err != nil {
			return nil, err
		}
		if segment == "" {
			return nil, fmt.Errorf("%s: JSON pointer contains an empty segment", filepath.Base(filePath))
		}

		next, exists := current[segment]
		if !exists {
			child := map[string]any{}
			current[segment] = child
			current = child
			continue
		}
		child, ok := next.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s: JSON pointer %q does not resolve to an object", filepath.Base(filePath), pointer)
		}
		current = child
	}
	return current, nil
}

func unescapeJSONPointerSegment(segment string) (string, error) {
	var result strings.Builder
	for i := 0; i < len(segment); i++ {
		if segment[i] != '~' {
			result.WriteByte(segment[i])
			continue
		}
		if i+1 >= len(segment) {
			return "", fmt.Errorf("invalid JSON pointer escape")
		}
		i++
		switch segment[i] {
		case '0':
			result.WriteByte('~')
		case '1':
			result.WriteByte('/')
		default:
			return "", fmt.Errorf("invalid JSON pointer escape")
		}
	}
	return result.String(), nil
}
