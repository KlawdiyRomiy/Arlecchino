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
	agentSkillsDirectory    = "skills"
)

var defaultAgentGuideContent = strings.TrimSpace(`
# Arlecchino Terminal Agent Skill Index

You are operating inside Arlecchino IDE terminal mode.

Required reads:
1. AGENTS.md in repository root.
2. This file.
3. .arlecchino/skills/*/SKILL.md files that match the task.
4. .arlecchino/memory/CONTEXT.md when present.

Skill map:
- .arlecchino/skills/ide-control/SKILL.md: safe file operations, checkpoints, approvals, audit.
- .arlecchino/skills/ui-layout/SKILL.md: visible IDE panels, TUI layout, surface state, code panels.
- .arlecchino/skills/backend-runtime/SKILL.md: live backend, LSP, terminal, git, dispatcher control.
- .arlecchino/skills/project-memory/SKILL.md: mnemonic memory list/search/context/save workflow.

Use the matching skill instead of treating this file as one large instruction blob.
`) + "\n"

type agentSkillFile struct {
	RelativePath string
	Content      string
}

var defaultAgentSkillFiles = []agentSkillFile{
	{
		RelativePath: filepath.Join(agentSkillsDirectory, "ide-control", "SKILL.md"),
		Content: strings.TrimSpace(`
---
name: arlecchino-ide-control
description: Safe project-local file operations, checkpoints, approvals, and audit for Arlecchino terminal agents.
---

# Arlecchino IDE Control

Use this skill before reading, writing, checkpointing, rolling back, or auditing project files.

Tools:
- ide_control.read_file
- ide_control.write_file
- ide_control.search_files
- ide_control.search_content
- ide_control.permission_status
- ide_control.request_permission
- ide_control.audit_logs
- ide_control.flight_recorder
- ide_control.capabilities
- change_journal.create_checkpoint
- change_journal.list_checkpoints
- change_journal.rollback_checkpoint

Rules:
- Stay scoped to the user's requested workspace unless they explicitly direct you elsewhere.
- Use checkpoints before risky edits.
- Approvals are tool-scoped. Request ide_control.request_permission with tool_name set to the exact next tool.
- Do not read, checkpoint, write, or search secret-like files without explicit approval.
- MCP read_file is for bounded UTF-8 text; use app/editor preview flows for binary, image, database, archive, and oversized files.
`) + "\n",
	},
	{
		RelativePath: filepath.Join(agentSkillsDirectory, "ui-layout", "SKILL.md"),
		Content: strings.TrimSpace(`
---
name: arlecchino-ui-layout
description: Visible IDE panel control, TUI-mode layout, surface runtime state, and side code panels.
---

# Arlecchino UI Layout

Use this skill when the task depends on what is visibly open in the IDE.

Tools:
- ide_ui.surface_read
- ide_ui.open_panel
- ide_ui.move_panel
- ide_ui.close_panel
- ide_ui.open_file_panel
- ide_ui.open_intent
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
- ide_ui.emit_event

Rules:
- TUI mode is the same IDE with the terminal in the center instead of the main code editor. Side panels still use the normal panel layout.
- Use ide_ui.open_file_panel for visible side-panel file opens. Do not substitute preview windows.
- Use ide_ui.open_panel, move_panel, and close_panel for Explorer, Git, Problems, AI Chat, terminal, markdown preview, and other panel control.
- Use ide_ui.surface_read after UI-control actions when visible state matters.
- Treat raw event emission as lower confidence than confirmed tools that return confirmed:true.
`) + "\n",
	},
	{
		RelativePath: filepath.Join(agentSkillsDirectory, "backend-runtime", "SKILL.md"),
		Content: strings.TrimSpace(`
---
name: arlecchino-backend-runtime
description: Live Arlecchino backend, LSP, terminal, git, dispatcher, and project runtime control.
---

# Arlecchino Backend Runtime

Use this skill for live IDE backend operations.

Tools:
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

Rules:
- Terminal, dispatcher, git, project-open, and LSP mutating tools can have external effects; request approval unless the user has already authorized the exact action.
- Prefer backend search and LSP tools when the live IDE context is useful; prefer safe file tools for direct file reads.
`) + "\n",
	},
	{
		RelativePath: filepath.Join(agentSkillsDirectory, "project-memory", "SKILL.md"),
		Content: strings.TrimSpace(`
---
name: arlecchino-project-memory
description: Project-local mnemonic memory for durable decisions, workflows, fixes, and handoffs.
---

# Arlecchino Project Memory

Use this skill for mnemonic memory.

Files:
- .arlecchino/ai/mnemonic.db: project-local Mnemonic graph shared with the AI backend.
- .arlecchino/memory/CONTEXT.md: generated compact TUI recall document.

Tools:
- agent_memory.context
- agent_memory.list
- agent_memory.search
- agent_memory.save

Rules:
- Read agent_memory.context or search/list memory early when prior project context can change the answer.
- Save durable decisions, bug fixes, workflow discoveries, and handoff summaries.
- Use tags as an array of strings, not a comma-separated string.
- Keep memory entries factual and project-local; do not store secrets or private credentials.
`) + "\n",
	},
}

func shouldRefreshManagedAgentGuide(content string) bool {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return true
	}

	managedGuide := strings.Contains(trimmed, "# Arlecchino Terminal Agent Guide") ||
		strings.Contains(trimmed, "# Arlecchino Terminal Agent Skill Index")
	if !managedGuide {
		return false
	}

	if strings.Contains(trimmed, agentGuideManagedMarker) {
		return true
	}

	if strings.Contains(trimmed, "Operating rules:") {
		return true
	}

	if strings.Contains(trimmed, ".arlecchino/AGENT_CONTEXT.md when present.") {
		return true
	}

	if !strings.Contains(trimmed, ".arlecchino/skills/*/SKILL.md") {
		return true
	}

	if !strings.Contains(trimmed, ".arlecchino/memory/CONTEXT.md when present.") {
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

func agentSkillPath(projectRoot, relativePath string) string {
	return filepath.Join(projectRoot, agentGuideDirectoryName, relativePath)
}

func ensureAgentSkillFiles(projectRoot string) error {
	for _, skill := range defaultAgentSkillFiles {
		path := agentSkillPath(projectRoot, skill.RelativePath)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}

		_, err := os.Stat(path)
		if err == nil {
			continue
		}
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := os.WriteFile(path, []byte(skill.Content), 0o644); err != nil {
			return err
		}
	}
	return nil
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
	if err := ensureAgentSkillFiles(trimmedRoot); err != nil {
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
