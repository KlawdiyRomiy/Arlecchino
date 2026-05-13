package main

import (
	"sort"
	"strings"
	"time"

	"arlecchino/internal/ai"
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

	if strings.TrimSpace(projectRoot) != "" {
		_, _ = mcp.EnsureAgentContextFile(projectRoot)
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
		ExecutionState:        string(ai.AIToolExecutionStateNotExecutable),
		ApprovalSummary:       "MCP approvals are separate from AI Full Access and remain tool-scoped.",
		DataCategories:        []string{"mcp_tool_metadata"},
		RedactionSummary:      "metadata only; raw MCP tool output and UI surface payloads are excluded",
		UpdatedAt:             aiNow(),
	}, nil
}

func aiNow() string {
	return time.Now().UTC().Format(time.RFC3339)
}
