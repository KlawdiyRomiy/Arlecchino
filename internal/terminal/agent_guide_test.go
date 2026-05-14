package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureAgentGuideFile_CreatesMissingFile(t *testing.T) {
	projectRoot := t.TempDir()

	guidePath, created, err := EnsureAgentGuideFile(projectRoot)
	if err != nil {
		t.Fatalf("EnsureAgentGuideFile() error = %v", err)
	}
	if !created {
		t.Fatalf("expected created=true for missing guide file")
	}

	wantPath := filepath.Join(projectRoot, ".arlecchino", "AGENT_GUIDE.md")
	if guidePath != wantPath {
		t.Fatalf("EnsureAgentGuideFile() path = %q, want %q", guidePath, wantPath)
	}

	data, err := os.ReadFile(guidePath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", guidePath, err)
	}

	if len(data) == 0 {
		t.Fatalf("guide file should not be empty")
	}

	text := string(data)
	if strings.Contains(text, AgentGuideAckMarker) {
		t.Fatalf("guide file should not expose ack marker in file content")
	}
}

func TestEnsureAgentGuideFile_CreatesGuideWithoutVisibleVersionOrAckInstruction(t *testing.T) {
	projectRoot := t.TempDir()

	guidePath, _, err := EnsureAgentGuideFile(projectRoot)
	if err != nil {
		t.Fatalf("EnsureAgentGuideFile() error = %v", err)
	}

	data, err := os.ReadFile(guidePath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", guidePath, err)
	}

	text := string(data)
	if strings.Contains(text, "V2") {
		t.Fatalf("guide file should not expose visible version markers")
	}
	if strings.Contains(text, "After reading this file reply exactly:") {
		t.Fatalf("guide file should not instruct explicit ack replies")
	}
	if strings.Contains(text, "IDE_GUIDE_LOADED") {
		t.Fatalf("guide file should not expose ack marker in file content")
	}
	if strings.Contains(text, "Work only inside the current project root.") {
		t.Fatalf("guide file should avoid rigid current-root wording")
	}
	if !strings.Contains(text, "agent_skills.context") {
		t.Fatalf("guide file should point agents to compact skill context")
	}
	if strings.Contains(text, ".arlecchino/skills/*/SKILL.md") {
		t.Fatalf("guide file should not route agents to raw project skill files")
	}

	uiSkillPath := filepath.Join(projectRoot, ".arlecchino", "skills", "ui-layout", "SKILL.md")
	uiSkill, err := os.ReadFile(uiSkillPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", uiSkillPath, err)
	}
	if !strings.Contains(string(uiSkill), "ide_ui.open_panel") {
		t.Fatalf("ui layout skill should include generic panel tools")
	}
}

func TestEnsureAgentGuideFile_PreservesExistingFile(t *testing.T) {
	projectRoot := t.TempDir()
	guideDir := filepath.Join(projectRoot, ".arlecchino")
	guidePath := filepath.Join(guideDir, "AGENT_GUIDE.md")

	if err := os.MkdirAll(guideDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	original := "# custom guide\nkeep me\n"
	if err := os.WriteFile(guidePath, []byte(original), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	gotPath, created, err := EnsureAgentGuideFile(projectRoot)
	if err != nil {
		t.Fatalf("EnsureAgentGuideFile() error = %v", err)
	}
	if created {
		t.Fatalf("expected created=false for existing guide file")
	}
	if gotPath != guidePath {
		t.Fatalf("EnsureAgentGuideFile() path = %q, want %q", gotPath, guidePath)
	}

	data, err := os.ReadFile(guidePath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(data) != original {
		t.Fatalf("existing guide file was overwritten")
	}
}

func TestEnsureAgentGuideFile_RefreshesManagedLegacyGuide(t *testing.T) {
	projectRoot := t.TempDir()
	guideDir := filepath.Join(projectRoot, ".arlecchino")
	guidePath := filepath.Join(guideDir, "AGENT_GUIDE.md")

	if err := os.MkdirAll(guideDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	legacy := strings.TrimSpace(`
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

	if err := os.WriteFile(guidePath, []byte(legacy), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	gotPath, created, err := EnsureAgentGuideFile(projectRoot)
	if err != nil {
		t.Fatalf("EnsureAgentGuideFile() error = %v", err)
	}
	if created {
		t.Fatalf("expected created=false for refreshed managed guide")
	}
	if gotPath != guidePath {
		t.Fatalf("EnsureAgentGuideFile() path = %q, want %q", gotPath, guidePath)
	}

	data, err := os.ReadFile(guidePath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	text := string(data)
	if strings.Contains(text, ".arlecchino/skills/*/SKILL.md") {
		t.Fatalf("refreshed guide should not route agents to raw project skill files")
	}
	if !strings.Contains(text, "agent_skills.context") {
		t.Fatalf("refreshed guide should prefer skill residency context")
	}
	if !strings.Contains(text, ".arlecchino/memory/CONTEXT.md") {
		t.Fatalf("refreshed guide should mention memory context")
	}
	if strings.Contains(text, "Operating rules:") {
		t.Fatalf("refreshed guide should not preserve legacy operating rules section")
	}
}

func TestBuildAgentGuideBootstrapMessage_IncludesPathAndMarker(t *testing.T) {
	guidePath := "/tmp/project/.arlecchino/AGENT_GUIDE.md"
	contextPath := "/tmp/project/.arlecchino/memory/CONTEXT.md"

	message := BuildAgentGuideBootstrapMessage(guidePath, contextPath)
	if message == "" {
		t.Fatalf("bootstrap message should not be empty")
	}
	if !strings.Contains(message, guidePath) {
		t.Fatalf("bootstrap message should contain guide path")
	}
	if !strings.Contains(message, contextPath) {
		t.Fatalf("bootstrap message should contain context path")
	}
	if strings.Contains(message, AgentGuideAckMarker) {
		t.Fatalf("bootstrap message should not require explicit ack marker")
	}
}

func TestShouldInjectAgentGuide_GatesByModeAndDedup(t *testing.T) {
	tests := []struct {
		name            string
		event           TUIModeEvent
		alreadyInjected bool
		want            bool
	}{
		{
			name:  "inject on agent_tui active first time",
			event: TUIModeEvent{Mode: TerminalModeAgentTUI, Active: true, Reason: "alternate-screen"},
			want:  true,
		},
		{
			name:            "skip duplicate during same agent_tui session",
			event:           TUIModeEvent{Mode: TerminalModeAgentTUI, Active: true, Reason: "alternate-screen"},
			alreadyInjected: true,
			want:            false,
		},
		{
			name:  "inject on agent_cli active first time",
			event: TUIModeEvent{Mode: TerminalModeAgentCLI, Active: true, Reason: "agent-launch"},
			want:  true,
		},
		{
			name:  "skip shell mode",
			event: TUIModeEvent{Mode: TerminalModeShell, Active: false, Reason: "shell"},
			want:  false,
		},
		{
			name:  "skip inactive agent_tui",
			event: TUIModeEvent{Mode: TerminalModeAgentTUI, Active: false, Reason: "alternate-screen"},
			want:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldInjectAgentGuide(tt.event, tt.alreadyInjected)
			if got != tt.want {
				t.Fatalf("shouldInjectAgentGuide() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSessionAgentGuideInjectionCycle_ResetsAfterShellFallback(t *testing.T) {
	session := &Session{}

	if !session.reserveAgentGuideInjection(TUIModeEvent{Mode: TerminalModeAgentCLI, Active: true}) {
		t.Fatalf("first reserveAgentGuideInjection() should return true")
	}

	if session.reserveAgentGuideInjection(TUIModeEvent{Mode: TerminalModeAgentCLI, Active: true}) {
		t.Fatalf("second reserveAgentGuideInjection() during same agent session should return false")
	}

	session.resetAgentGuideInjection(TUIModeEvent{Mode: TerminalModeShell, Active: false, Reason: "shell"})

	if !session.reserveAgentGuideInjection(TUIModeEvent{Mode: TerminalModeAgentTUI, Active: true}) {
		t.Fatalf("reserveAgentGuideInjection() should return true after shell fallback reset")
	}
}

func TestShouldInjectAgentGuideForCommand_UsesLaunchDetectionAndDedup(t *testing.T) {
	tests := []struct {
		name            string
		commandLine     string
		alreadyInjected bool
		want            bool
	}{
		{name: "agenthub first launch", commandLine: "agenthub", want: true},
		{name: "wrapped command launch", commandLine: "command agenthub --profile default", want: true},
		{name: "non agent command", commandLine: "npm run dev", want: false},
		{name: "already injected", commandLine: "agenthub", alreadyInjected: true, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldInjectAgentGuideForCommand(tt.commandLine, tt.alreadyInjected)
			if got != tt.want {
				t.Fatalf("shouldInjectAgentGuideForCommand() = %v, want %v", got, tt.want)
			}
		})
	}
}
