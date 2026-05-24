package app

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"arlecchino/internal/ai"
	indexerlsp "arlecchino/internal/indexer/lsp"
	"arlecchino/internal/mcp"
)

func (a *App) aiMCPContextProvider(projectRoot string) (ai.AIMCPContextPlane, error) {
	settings, _, err := mcp.LoadSettings("")
	if err != nil {
		return ai.AIMCPContextPlane{}, err
	}

	entries := mcp.BuildToolSettingsEntries(settings)
	groups := map[string]*ai.AIMCPToolGroupSummary{}
	enabledTools := 0
	disabledTools := 0
	for _, entry := range entries {
		groupName := strings.TrimSpace(entry.Group)
		if groupName == "" {
			groupName = "Other"
		}
		group := groups[groupName]
		if group == nil {
			group = &ai.AIMCPToolGroupSummary{Name: groupName}
			groups[groupName] = group
		}
		group.Total++
		if entry.EffectiveEnabled {
			group.Enabled++
			enabledTools++
		} else {
			group.Disabled++
			disabledTools++
		}
	}

	groupNames := make([]string, 0, len(groups))
	for name := range groups {
		groupNames = append(groupNames, name)
	}
	sort.Strings(groupNames)
	groupSummaries := make([]ai.AIMCPToolGroupSummary, 0, len(groupNames))
	for _, name := range groupNames {
		groupSummaries = append(groupSummaries, *groups[name])
	}

	bridgeRunning := false
	if a != nil {
		a.mcpBridgeMu.Lock()
		bridgeRunning = a.mcpBridgeServer != nil
		a.mcpBridgeMu.Unlock()
	}

	return ai.AIMCPContextPlane{
		Enabled:               settings.Enabled,
		Available:             settings.Enabled,
		BridgeRunning:         bridgeRunning,
		BridgeAvailable:       bridgeRunning,
		ToolCount:             len(entries),
		EnabledToolCount:      enabledTools,
		DisabledToolCount:     disabledTools,
		ToolGroups:            groupSummaries,
		MemoryBackend:         "mnemonic",
		MemoryContextPath:     ".arlecchino/memory/CONTEXT.md",
		MnemonicSharedContext: true,
		ExecutionState:        "approval_gated",
		ApprovalSummary:       "MCP approvals are separate from AI Full Access and remain tool-scoped.",
		DataCategories:        []string{"mcp_tool_metadata"},
		RedactionSummary:      "metadata only; raw MCP tool output and UI surface payloads are excluded",
		UpdatedAt:             aiNow(),
	}, nil
}

func (a *App) aiDiagnosticsProvider(projectRoot string, filePath string, language string, limit int) (string, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return "", fmt.Errorf("LSP diagnostics manager is not available")
	}
	projectRoot = filepath.Clean(strings.TrimSpace(projectRoot))
	if projectRoot == "" {
		return "", fmt.Errorf("project root is empty")
	}
	absPath := strings.TrimSpace(filePath)
	if absPath == "" {
		return "", fmt.Errorf("diagnostics path is empty")
	}
	if !filepath.IsAbs(absPath) {
		absPath = filepath.Join(projectRoot, filepath.FromSlash(absPath))
	}
	rel, err := filepath.Rel(projectRoot, absPath)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("diagnostics path escapes project")
	}
	languages := diagnosticsLanguageCandidates(language, absPath)
	for _, candidate := range languages {
		diagnostics := manager.GetDiagnostics(candidate, absPath)
		if len(diagnostics) > 0 {
			return formatAIDiagnostics(filepath.ToSlash(rel), candidate, diagnostics, limit), nil
		}
	}
	return fmt.Sprintf("No diagnostics for %s.", filepath.ToSlash(rel)), nil
}

func (a *App) aiMCPToolExecutor(ctx context.Context, projectRoot string, toolName string, arguments map[string]any) (any, error) {
	service, err := mcp.NewToolServiceWithOptions(projectRoot, mcp.ToolServiceOptions{EnableBridgeAutoDetect: true})
	if err != nil {
		return nil, err
	}
	defer service.Close()
	type result struct {
		value any
		err   error
	}
	done := make(chan result, 1)
	go func() {
		value, callErr := service.CallTool(toolName, arguments)
		done <- result{value: value, err: callErr}
	}()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-done:
		return result.value, result.err
	}
}

func aiNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func diagnosticsLanguageCandidates(language string, filePath string) []string {
	candidates := []string{}
	add := func(value string) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			return
		}
		for _, existing := range candidates {
			if existing == value {
				return
			}
		}
		candidates = append(candidates, value)
	}
	add(language)
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".go":
		add("go")
	case ".ts":
		add("typescript")
		add("ts")
	case ".tsx":
		add("typescriptreact")
		add("tsx")
		add("typescript")
	case ".js":
		add("javascript")
		add("js")
	case ".jsx":
		add("javascriptreact")
		add("jsx")
		add("javascript")
	case ".py":
		add("python")
	case ".rs":
		add("rust")
	case ".java":
		add("java")
	case ".swift":
		add("swift")
	case ".kt":
		add("kotlin")
	}
	return candidates
}

func formatAIDiagnostics(relPath string, language string, diagnostics []indexerlsp.Diagnostic, limit int) string {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if len(diagnostics) > limit {
		diagnostics = diagnostics[:limit]
	}
	lines := []string{fmt.Sprintf("%s diagnostics (%s):", relPath, firstNonEmptyString(language, "unknown"))}
	for _, diagnostic := range diagnostics {
		line := diagnostic.Range.Start.Line + 1
		column := diagnostic.Range.Start.Character + 1
		severity := diagnosticSeverityLabel(diagnostic.Severity)
		source := strings.TrimSpace(diagnostic.Source)
		if source == "" {
			source = "lsp"
		}
		code := ""
		if diagnostic.Code != nil {
			if encoded, err := json.Marshal(diagnostic.Code); err == nil {
				code = " " + string(encoded)
			}
		}
		lines = append(lines, fmt.Sprintf("%s:%d:%d [%s] %s%s: %s", relPath, line, column, severity, source, code, strings.TrimSpace(diagnostic.Message)))
	}
	return strings.Join(lines, "\n")
}

func diagnosticSeverityLabel(severity int) string {
	switch severity {
	case 1:
		return "error"
	case 2:
		return "warning"
	case 3:
		return "info"
	case 4:
		return "hint"
	default:
		return "diagnostic"
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
