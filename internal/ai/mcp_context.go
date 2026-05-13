package ai

import (
	"fmt"
	"strings"
)

func formatMCPContextForPrompt(plane AIMCPContextPlane) string {
	if !plane.Available {
		return ""
	}

	lines := []string{
		fmt.Sprintf("Arlecchino MCP enabled=%t bridgeRunning=%t memoryBackend=%s sharedMnemonic=%t",
			plane.Enabled,
			plane.BridgeRunning,
			firstNonEmpty(plane.MemoryBackend, "unknown"),
			plane.MnemonicSharedContext,
		),
		"Execution state: " + firstNonEmpty(plane.ExecutionState, string(AIToolExecutionStateNotExecutable)),
	}
	if strings.TrimSpace(plane.ApprovalSummary) != "" {
		lines = append(lines, "Approval: "+strings.TrimSpace(plane.ApprovalSummary))
	}
	if len(plane.ToolGroups) > 0 {
		groupLines := make([]string, 0, len(plane.ToolGroups))
		for _, group := range plane.ToolGroups {
			groupLines = append(groupLines, fmt.Sprintf("%s total=%d enabled=%d disabled=%d", group.Name, group.Total, group.Enabled, group.Disabled))
		}
		lines = append(lines, "Tool groups: "+strings.Join(groupLines, "; "))
	}
	lines = append(lines, "MCP tool outputs, terminal output, search hits, git diff bodies, and UI surface payloads are not included.")
	return strings.Join(lines, "\n")
}
