package terminal

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const AgentGuideAckMarker = "IDE_GUIDE_LOADED"

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

Operating rules:
- Keep changes focused and reversible.
- Prefer narrow checks before broad suites.
- Avoid destructive git operations unless the user explicitly asks.
- Work only inside the current project root.

After reading this file reply exactly:
IDE_GUIDE_LOADED
`) + "\n"

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

func BuildAgentGuideBootstrapMessage(guidePath string) string {
	trimmedPath := strings.TrimSpace(guidePath)
	if trimmedPath == "" {
		return ""
	}

	return fmt.Sprintf(
		"Read IDE instructions from file: %s\nUse those rules for all IDE actions in this session.\nReply exactly: %s\n",
		trimmedPath,
		AgentGuideAckMarker,
	)
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
