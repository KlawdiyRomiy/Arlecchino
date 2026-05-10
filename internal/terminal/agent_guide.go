package terminal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const AgentGuideAckMarker = "IDE_GUIDE_LOADED"
const agentGuideManagedMarker = "<!-- ARLECCHINO_MANAGED_GUIDE_V2 -->"

const (
	agentGuideDirectoryName = ".arlecchino"
	agentGuideFileName      = "AGENT_GUIDE.md"
)

var defaultAgentGuideContent = strings.TrimSpace(`
# Arlecchino Terminal Agent Guide

You are operating inside Arlecchino IDE terminal mode.

Required reads:
1. AGENTS.md in repository root.
2. This file.
3. .arlecchino/AGENT_CONTEXT.md when present.

IDE control tools:
- ide_control.read_file
- ide_control.write_file
- ide_control.search_files
- ide_control.search_content
- ide_control.permission_status
- ide_control.request_permission
- ide_control.audit_logs
- ide_control.capabilities

Checkpoint tools:
- change_journal.create_checkpoint
- change_journal.list_checkpoints
- change_journal.rollback_checkpoint

Local memory tools:
- agent_memory.save
- agent_memory.search
- agent_memory.list
- agent_memory.context

IDE backend tools:
- ide_backend.project_open
- ide_backend.project_close
- ide_backend.project_status
- ide_backend.lsp_status
- ide_backend.lsp_restart
- ide_backend.lsp_install
- ide_backend.lsp_servers
- ide_backend.lsp_definition
- ide_backend.lsp_hover
- ide_backend.lsp_signature
- ide_backend.terminal_create
- ide_backend.terminal_write
- ide_backend.terminal_resize
- ide_backend.terminal_close
- ide_backend.terminal_close_all
- ide_backend.dispatch_search_files
- ide_backend.dispatch_search_content
- ide_backend.dispatch_search_symbols
- ide_backend.dispatch_command
- ide_backend.git_status
- ide_backend.git_diff
- ide_backend.git_log
- ide_backend.git_show
- ide_backend.git_branch
- ide_backend.git_branches

IDE UI tools:
- ide_ui.emit_event
- ide_ui.surface_read
- ide_ui.open_intent
- ide_ui.open_file_panel
- ide_ui.preview_open
- ide_ui.preview_navigate
- ide_ui.preview_focus
- ide_ui.preview_close
- ide_ui.list_layout_profiles
- ide_ui.register_layout_profile
- ide_ui.apply_layout_profile
- ide_ui.hot_switch
- ide_ui.list_layout_snapshots
- ide_ui.apply_layout_snapshot

Interaction rules:
- Stay scoped to the user's requested workspace unless they explicitly direct you elsewhere.
- Keep changes focused and reversible.
- Prefer narrow checks before broad suites.
- Avoid destructive git operations unless the user explicitly asks.
- Use checkpoints before risky file edits.
- Save durable decisions, bug fixes, and workflow context into local memory.
- Approvals are tool-scoped. Request ide_control.request_permission with tool_name set to the exact next tool you need; one approval does not authorize other tools.
- For agent_memory.save/search, pass tags as an array of strings.
- Use ide_ui.open_file_panel for visible side-panel file opens. Do not use dispatch_command, raw ide:file:open, or preview windows for this.
- Treat raw event emission as lower confidence than confirmed tools. Prefer tools that return confirmed:true and inspect mcpRequestId when validating UI work.
- Use ide_ui.surface_read after UI-control actions when visible state matters.
- Do not read, checkpoint, write, or search for secret-like files without explicit approval. Sensitive paths include .env files, SSH keys, certificates, credentials, and secret-named files.
- MCP read_file is for bounded UTF-8 text. Use app/editor preview flows for binary, image, database, archive, and oversized files.
- Terminal, dispatcher, git, project-open, layout, and generic UI-event tools can cause external or destructive effects; request/confirm approval before using them unless the user has already authorized the action.
- Prefer existing project conventions over generic scaffolding.
- Explain actions directly and keep the user informed about meaningful progress.
`) + "\n"

func shouldRefreshManagedAgentGuide(content string) bool {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return true
	}

	if !strings.Contains(trimmed, "# Arlecchino Terminal Agent Guide") {
		return false
	}

	if strings.Contains(trimmed, agentGuideManagedMarker) {
		return true
	}

	if strings.Contains(trimmed, "Operating rules:") {
		return true
	}

	if !strings.Contains(trimmed, ".arlecchino/AGENT_CONTEXT.md when present.") {
		return true
	}

	if !strings.Contains(trimmed, "IDE control tools:") {
		return true
	}

	if !strings.Contains(trimmed, "ide_ui.surface_read") || !strings.Contains(trimmed, "ide_ui.open_intent") {
		return true
	}

	if !strings.Contains(trimmed, "confirmed:true") {
		return true
	}

	if !strings.Contains(trimmed, "tool-scoped") {
		return true
	}

	if strings.Contains(trimmed, "After reading this file reply exactly:") {
		return true
	}

	if strings.Contains(trimmed, AgentGuideAckMarker) {
		return true
	}

	if strings.Contains(trimmed, "Work only inside the current project root.") {
		return true
	}

	return false
}

func AgentGuidePath(projectRoot string) string {
	return filepath.Join(projectRoot, agentGuideDirectoryName, agentGuideFileName)
}

func EnsureAgentGuideFile(projectRoot string) (string, bool, error) {
	trimmedRoot := strings.TrimSpace(projectRoot)
	if trimmedRoot == "" {
		return "", false, fmt.Errorf("project root is empty")
	}

	guidePath := AgentGuidePath(trimmedRoot)
	guideDir := filepath.Dir(guidePath)

	if err := os.MkdirAll(guideDir, 0o755); err != nil {
		return "", false, err
	}

	_, statErr := os.Stat(guidePath)
	if statErr == nil {
		existingContent, err := os.ReadFile(guidePath)
		if err != nil {
			return "", false, err
		}

		if shouldRefreshManagedAgentGuide(string(existingContent)) {
			if err := os.WriteFile(guidePath, []byte(defaultAgentGuideContent), 0o644); err != nil {
				return "", false, err
			}
		}

		return guidePath, false, nil
	}
	if !errors.Is(statErr, os.ErrNotExist) {
		return "", false, statErr
	}

	if err := os.WriteFile(guidePath, []byte(defaultAgentGuideContent), 0o644); err != nil {
		return "", false, err
	}

	return guidePath, true, nil
}

func BuildAgentGuideBootstrapMessage(guidePath, contextPath string) string {
	trimmedPath := strings.TrimSpace(guidePath)
	if trimmedPath == "" {
		return ""
	}

	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("Read IDE instructions from file: %s\n", trimmedPath))
	trimmedContextPath := strings.TrimSpace(contextPath)
	if trimmedContextPath != "" {
		builder.WriteString(fmt.Sprintf("Read project-local session context from file: %s\n", trimmedContextPath))
	}
	builder.WriteString("Use those rules for all IDE actions in this session.\n")
	return builder.String()
}

func shouldInjectAgentGuide(event TUIModeEvent, alreadyInjected bool) bool {
	return isAgentMode(event.Mode) && event.Active && !alreadyInjected
}

func shouldResetAgentGuideInjection(event TUIModeEvent) bool {
	return event.Mode == TerminalModeShell && !event.Active
}

func shouldInjectAgentGuideForCommand(commandLine string, alreadyInjected bool) bool {
	if alreadyInjected {
		return false
	}

	return IsAgentLaunchCommand(strings.TrimSpace(commandLine))
}
