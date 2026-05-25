package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureAgentGuideFile_RefreshesExactLegacyProjectMemorySkill(t *testing.T) {
	projectRoot := t.TempDir()
	skillPath := agentSkillPath(projectRoot, filepath.FromSlash(projectMemorySkillRelativePath))

	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(skillPath, []byte(legacyProjectMemorySkillContent), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if _, _, err := EnsureAgentGuideFile(projectRoot); err != nil {
		t.Fatalf("EnsureAgentGuideFile() error = %v", err)
	}

	data, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	text := string(data)
	if strings.Contains(text, "session-memory.jsonl") {
		t.Fatalf("legacy project memory skill should be refreshed away from JSONL memory")
	}
	if !strings.Contains(text, ".arlecchino/ai/mnemonic.db") {
		t.Fatalf("project memory skill should mention Mnemonic database")
	}
	if !strings.Contains(text, "agent_skills.context") {
		t.Fatalf("project memory skill should route through skill residency context")
	}
}

func TestEnsureAgentGuideFile_PreservesModifiedProjectMemorySkill(t *testing.T) {
	projectRoot := t.TempDir()
	skillPath := agentSkillPath(projectRoot, filepath.FromSlash(projectMemorySkillRelativePath))
	modified := strings.Replace(legacyProjectMemorySkillContent, "Tools:\n", "Local note: preserve this project-specific guidance.\n\nTools:\n", 1)

	if err := os.MkdirAll(filepath.Dir(skillPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(skillPath, []byte(modified), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if _, _, err := EnsureAgentGuideFile(projectRoot); err != nil {
		t.Fatalf("EnsureAgentGuideFile() error = %v", err)
	}

	data, err := os.ReadFile(skillPath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(data) != modified {
		t.Fatalf("modified project memory skill was overwritten")
	}

	report, err := BuildArlecchinoStateReport(projectRoot)
	if err != nil {
		t.Fatalf("BuildArlecchinoStateReport() error = %v", err)
	}
	if !terminalReportHasItem(report, ArlecchinoStateCategoryStaleGenerated, ".arlecchino/skills/project-memory/SKILL.md") {
		t.Fatalf("expected report to flag modified stale project memory skill, got %#v", report.Items)
	}
}

func TestBuildAgentGuideBootstrapMessage_KeepsRawSkillsOutOfProviderContext(t *testing.T) {
	message := BuildAgentGuideBootstrapMessage(
		"/tmp/project/.arlecchino/AGENT_GUIDE.md",
		"/tmp/project/.arlecchino/memory/CONTEXT.md",
	)
	if !strings.Contains(message, "do not load raw skill files into provider context") {
		t.Fatalf("bootstrap message should keep raw skill files out of provider context")
	}
}

func TestBuildArlecchinoStateReport_ReportsCandidatesWithoutDeleting(t *testing.T) {
	projectRoot := t.TempDir()
	stateDir := filepath.Join(projectRoot, ".arlecchino")
	paths := []string{
		filepath.Join(stateDir, ".DS_Store"),
		filepath.Join(stateDir, "AGENT_CONTEXT.md"),
		filepath.Join(stateDir, "mcp-audit.pre-root-layout.log"),
		filepath.Join(stateDir, "brain.db"),
		filepath.Join(stateDir, "memory", "CONTEXT.md"),
		filepath.Join(stateDir, "pre-root-layout-data", "projects.db"),
		filepath.Join(stateDir, "finder-duplicate-quarantine-20260324-002904", "manifest.json"),
	}
	for _, path := range paths {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll(%q) error = %v", path, err)
		}
		content := "fixture\n"
		if strings.HasSuffix(path, filepath.Join("memory", "CONTEXT.md")) {
			content = "This file is generated from `.arlecchino/memory/session-memory.jsonl`.\n"
		}
		if strings.HasSuffix(path, "brain.db") {
			content = ""
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", path, err)
		}
	}

	report, err := BuildArlecchinoStateReport(projectRoot)
	if err != nil {
		t.Fatalf("BuildArlecchinoStateReport() error = %v", err)
	}

	assertTerminalReportItem(t, report, ArlecchinoStateCategoryCleanupCandidate, ".arlecchino/.DS_Store")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryCleanupCandidate, ".arlecchino/pre-root-layout-data")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryCleanupCandidate, ".arlecchino/mcp-audit.pre-root-layout.log")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryCleanupCandidate, ".arlecchino/finder-duplicate-quarantine-20260324-002904")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryLegacyArtifact, ".arlecchino/AGENT_CONTEXT.md")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryRuntimeOwned, ".arlecchino/brain.db")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryStaleGenerated, ".arlecchino/memory/CONTEXT.md")
	assertTerminalReportItem(t, report, ArlecchinoStateCategoryDoNotMove, ".arlecchino")

	for _, path := range paths {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("BuildArlecchinoStateReport() should not delete %q: %v", path, err)
		}
	}
}

func assertTerminalReportItem(t *testing.T, report ArlecchinoStateReport, category, path string) {
	t.Helper()
	if !terminalReportHasItem(report, category, path) {
		t.Fatalf("report missing category=%q path=%q items=%#v", category, path, report.Items)
	}
}

func terminalReportHasItem(report ArlecchinoStateReport, category, path string) bool {
	for _, item := range report.Items {
		if item.Category == category && item.Path == path {
			return true
		}
	}
	return false
}
