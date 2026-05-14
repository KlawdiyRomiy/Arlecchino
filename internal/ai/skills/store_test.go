package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkillRegistryDigestResidencyAndHashInvalidation(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, ".arlecchino", "skills", "demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, []byte(strings.TrimSpace(`
---
name: demo-skill
description: Compact demo skill for residency.
---

# Demo Skill

Tools:
- ide_ui.surface_read

Rules:
- Keep visible state checks compact.
- Do not expose api_key=supersecret in resident context.
- Request ide_control.request_permission before doing anything.

Verification:
- Run focused checks.
`)+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	store, err := Open(root)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	records, err := store.SyncProjectSkills()
	if err != nil {
		t.Fatalf("SyncProjectSkills: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("records = %#v", records)
	}
	if records[0].TrustState != TrustCandidate {
		t.Fatalf("new skill trust = %q, want candidate", records[0].TrustState)
	}

	empty, err := store.Context(ContextRequest{AgentSurface: "chat", SessionInstanceID: "s1"})
	if err != nil {
		t.Fatalf("Context before review: %v", err)
	}
	if len(empty) != 0 {
		t.Fatalf("untrusted skill produced resident context: %#v", empty)
	}

	digest, err := store.ReviewSkill("project:demo", "unit-test", true)
	if err != nil {
		t.Fatalf("ReviewSkill: %v", err)
	}
	if strings.Contains(strings.Join(digest.OperatingReminders, "\n"), "supersecret") ||
		strings.Contains(strings.Join(digest.OperatingReminders, "\n"), "request_permission") {
		t.Fatalf("digest retained unsafe operating reminders: %#v", digest.OperatingReminders)
	}
	if _, err := store.Activate(ActivateRequest{
		SkillID:           "project:demo",
		AgentSurface:      "chat",
		SessionInstanceID: "s1",
		ActivationReason:  "unit test",
		Confidence:        1,
	}); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	context, err := store.Context(ContextRequest{AgentSurface: "chat", SessionInstanceID: "s1"})
	if err != nil {
		t.Fatalf("Context after activation: %v", err)
	}
	if len(context) != 1 || context[0].Record.SkillID != "project:demo" {
		t.Fatalf("context = %#v", context)
	}

	if err := os.WriteFile(skillPath, []byte(strings.ReplaceAll(readFile(t, skillPath), "Run focused checks.", "Run focused checks after hash changes.")), 0o644); err != nil {
		t.Fatalf("Write changed skill: %v", err)
	}
	if _, err := store.SyncProjectSkills(); err != nil {
		t.Fatalf("Sync changed skill: %v", err)
	}
	context, err = store.Context(ContextRequest{AgentSurface: "chat", SessionInstanceID: "s1"})
	if err != nil {
		t.Fatalf("Context after hash change: %v", err)
	}
	if len(context) != 0 {
		t.Fatalf("stale skill remained active after hash invalidation: %#v", context)
	}
}

func TestSkillContextRevalidatesHashWithoutRescan(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, ".arlecchino", "skills", "demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, []byte("---\nname: demo\n---\n# Demo\n\nRules:\n- Keep it compact.\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	store, err := Open(root)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if _, err := store.SyncProjectSkills(); err != nil {
		t.Fatalf("SyncProjectSkills: %v", err)
	}
	if _, err := store.ReviewSkill("project:demo", "unit-test", true); err != nil {
		t.Fatalf("ReviewSkill: %v", err)
	}
	if _, err := store.Activate(ActivateRequest{SkillID: "project:demo", AgentSurface: "chat", SessionInstanceID: "s1", Confidence: 1}); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	if err := os.WriteFile(skillPath, []byte("---\nname: demo\n---\n# Demo changed\n"), 0o644); err != nil {
		t.Fatalf("Write changed skill: %v", err)
	}
	context, err := store.Context(ContextRequest{AgentSurface: "chat", SessionInstanceID: "s1"})
	if err != nil {
		t.Fatalf("Context: %v", err)
	}
	if len(context) != 0 {
		t.Fatalf("changed skill stayed resident without rescan: %#v", context)
	}
	status, err := store.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Stale == 0 || status.Active != 0 {
		t.Fatalf("status after live hash invalidation = %#v", status)
	}
}

func TestSkillRegistryRejectsSymlinkSkillFile(t *testing.T) {
	root := t.TempDir()
	external := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(external, []byte("# Outside\n"), 0o644); err != nil {
		t.Fatalf("WriteFile external: %v", err)
	}
	skillDir := filepath.Join(root, ".arlecchino", "skills", "linked")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.Symlink(external, filepath.Join(skillDir, "SKILL.md")); err != nil {
		t.Skipf("Symlink unavailable: %v", err)
	}
	store, err := Open(root)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if _, err := store.SyncProjectSkills(); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("SyncProjectSkills symlink error = %v", err)
	}
}

func TestReviewRejectsSkillPathTamperedToEscapeRoot(t *testing.T) {
	root := t.TempDir()
	skillDir := filepath.Join(root, ".arlecchino", "skills", "demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, []byte("---\nname: demo\n---\n# Demo\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	store, err := Open(root)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if _, err := store.SyncProjectSkills(); err != nil {
		t.Fatalf("SyncProjectSkills: %v", err)
	}
	store.mu.Lock()
	_, err = store.db.Exec(`UPDATE ai_skill_registry SET path = ? WHERE skill_id = ?`, "../outside/SKILL.md", "project:demo")
	store.mu.Unlock()
	if err != nil {
		t.Fatalf("tamper path: %v", err)
	}
	if _, err := store.ReviewSkill("project:demo", "unit-test", true); err == nil || !strings.Contains(err.Error(), "escapes project root") {
		t.Fatalf("ReviewSkill escaped path error = %v", err)
	}
}

func TestImportedSkillsRemainQuarantinedUntilReviewFlowExists(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	record, err := store.ImportCandidate("Imported Demo", "Imported description", "https://example.test/repo", "main", []string{"ide_ui.surface_read"})
	if err != nil {
		t.Fatalf("ImportCandidate: %v", err)
	}
	if record.TrustState != TrustCandidate || record.SourceKind != SourceImported {
		t.Fatalf("imported record = %#v", record)
	}
	if _, err := store.ReviewSkill(record.SkillID, "unit-test", true); err == nil || !strings.Contains(err.Error(), "imported skill") {
		t.Fatalf("ReviewSkill imported error = %v", err)
	}
}

func TestClosedSkillStoreReturnsErrors(t *testing.T) {
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := store.List(10); err != ErrStoreClosed {
		t.Fatalf("List after close error = %v", err)
	}
	if _, err := store.Status(); err != ErrStoreClosed {
		t.Fatalf("Status after close error = %v", err)
	}
	if _, err := store.Context(ContextRequest{}); err != ErrStoreClosed {
		t.Fatalf("Context after close error = %v", err)
	}
	if _, err := store.Activate(ActivateRequest{SkillID: "x"}); err != ErrStoreClosed {
		t.Fatalf("Activate after close error = %v", err)
	}
	if err := store.ClearRuntime(); err != ErrStoreClosed {
		t.Fatalf("ClearRuntime after close error = %v", err)
	}
	if err := store.ClearAll(); err != ErrStoreClosed {
		t.Fatalf("ClearAll after close error = %v", err)
	}
	if _, err := store.ImportCandidate("closed", "", "", "", nil); err != ErrStoreClosed {
		t.Fatalf("ImportCandidate after close error = %v", err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	return string(data)
}
