package mcp

import (
	"arlecchino/internal/terminal"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureAgentContextFile_RewritesLegacyContextDocument(t *testing.T) {
	root := t.TempDir()
	contextPath := AgentContextFilePath(root)
	legacy := "# Arlecchino Mnemonic Memory\n\nThis file is generated from `.arlecchino/memory/session-memory.jsonl`.\n\nNo saved project memory yet.\n"

	if err := os.MkdirAll(filepath.Dir(contextPath), 0o700); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(contextPath, []byte(legacy), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	gotPath, err := EnsureAgentContextFile(root)
	if err != nil {
		t.Fatalf("EnsureAgentContextFile() error = %v", err)
	}
	if gotPath != contextPath {
		t.Fatalf("EnsureAgentContextFile() path = %q, want %q", gotPath, contextPath)
	}

	data, err := os.ReadFile(contextPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	text := string(data)
	if strings.Contains(text, "session-memory.jsonl") {
		t.Fatalf("context document should not keep legacy JSONL wording")
	}
	if !strings.Contains(text, ".arlecchino/ai/mnemonic.db") {
		t.Fatalf("context document should mention Mnemonic database")
	}
}

func TestToolService_ArlecchinoStateReportTool(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(root, ".arlecchino")
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(stateDir, ".DS_Store"), []byte("finder"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}
	defer service.Close()

	result, err := service.CallTool("ide_control.arlecchino_state_report", nil)
	if err != nil {
		t.Fatalf("CallTool(ide_control.arlecchino_state_report) error = %v", err)
	}
	report, ok := result.(terminal.ArlecchinoStateReport)
	if !ok {
		t.Fatalf("state report result type = %T, want terminal.ArlecchinoStateReport", result)
	}
	if !stateReportHasItem(report, terminal.ArlecchinoStateCategoryCleanupCandidate, ".arlecchino/.DS_Store") {
		t.Fatalf("state report missing .DS_Store cleanup item: %#v", report.Items)
	}
}

func stateReportHasItem(report terminal.ArlecchinoStateReport, category, path string) bool {
	for _, item := range report.Items {
		if item.Category == category && item.Path == path {
			return true
		}
	}
	return false
}
