package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"arlecchino/internal/ai/providers"
	"arlecchino/internal/ai/skills"
	"arlecchino/internal/mcp"
)

func TestContextPreviewIncludesTrustedResidentSkillDigestOnly(t *testing.T) {
	projectRoot := t.TempDir()
	skillDir := filepath.Join(projectRoot, ".arlecchino", "skills", "ai-demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(strings.TrimSpace(`
---
name: ai-demo
description: Trusted compact AI skill.
---

# AI Demo

Rules:
- Keep generated context compact.

Verification:
- Check that only the digest is used.

FULL SKILL BODY SENTINEL SHOULD NOT APPEAR IN PROVIDER PROMPT.
`)+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	service := newTestService(t, nil)
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}

	snapshot, err := service.ContextPreview("main", AIContextRequest{Prompt: "x", IncludeSkills: true})
	if err != nil {
		t.Fatalf("ContextPreview before trust: %v", err)
	}
	if len(snapshot.Skills) != 0 {
		t.Fatalf("untrusted skill leaked into snapshot: %#v", snapshot.Skills)
	}

	if _, err := project.Skills.ReviewSkill("project:ai-demo", "unit-test", true); err != nil {
		t.Fatalf("ReviewSkill: %v", err)
	}
	if _, err := project.Skills.Activate(skills.ActivateRequest{
		SkillID:           "project:ai-demo",
		AgentSurface:      string(providers.CapabilityChat),
		SessionInstanceID: "default",
		ActivationReason:  "unit test",
		Confidence:        1,
	}); err != nil {
		t.Fatalf("Activate: %v", err)
	}

	snapshot, err = service.ContextPreview("main", AIContextRequest{Prompt: "x", IncludeSkills: true})
	if err != nil {
		t.Fatalf("ContextPreview after trust: %v", err)
	}
	if len(snapshot.Skills) != 1 {
		t.Fatalf("skills = %#v", snapshot.Skills)
	}
	if !containsString(snapshot.DataCategories, "skill_residency") {
		t.Fatalf("data categories missing skill_residency: %#v", snapshot.DataCategories)
	}
	prompt := buildPromptFromSnapshot(snapshot)
	if !strings.Contains(prompt, "Resident skill context") {
		t.Fatalf("prompt missing resident skill context: %q", prompt)
	}
	if strings.Contains(prompt, "FULL SKILL BODY SENTINEL") {
		t.Fatalf("prompt leaked full skill body: %q", prompt)
	}
	if snapshot.ByteSize == 0 || snapshot.Redaction.SanitizedBytes == 0 {
		t.Fatalf("skill context was not included in byte accounting: %#v", snapshot.Redaction)
	}
}

func TestClearMnemonicClearsSkillRuntimeAndGeneratedContext(t *testing.T) {
	projectRoot := t.TempDir()
	skillDir := filepath.Join(projectRoot, ".arlecchino", "skills", "ai-demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(strings.TrimSpace(`
---
name: ai-demo
description: Trusted compact AI skill.
---

# AI Demo

Rules:
- Keep generated context compact.
`)+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	service := newTestService(t, nil)
	project, err := service.OpenProject("main", projectRoot)
	if err != nil {
		t.Fatalf("OpenProject: %v", err)
	}
	if _, err := project.Mnemonic.Save(fromAIEntry(AIMnemonicEntry{Type: "note", Content: "old generated context", Importance: 5})); err != nil {
		t.Fatalf("save mnemonic: %v", err)
	}
	contextPath, err := mcp.EnsureAgentContextFile(projectRoot)
	if err != nil {
		t.Fatalf("EnsureAgentContextFile: %v", err)
	}
	if _, err := project.Skills.ReviewSkill("project:ai-demo", "unit-test", true); err != nil {
		t.Fatalf("ReviewSkill: %v", err)
	}
	if _, err := project.Skills.Activate(skills.ActivateRequest{
		SkillID:           "project:ai-demo",
		AgentSurface:      string(providers.CapabilityChat),
		SessionInstanceID: "default",
		ActivationReason:  "unit test",
		Confidence:        1,
	}); err != nil {
		t.Fatalf("Activate: %v", err)
	}

	if err := service.ClearMnemonic("main"); err != nil {
		t.Fatalf("ClearMnemonic: %v", err)
	}
	snapshot, err := service.ContextPreview("main", AIContextRequest{Prompt: "x", IncludeMnemonic: true, IncludeSkills: true})
	if err != nil {
		t.Fatalf("ContextPreview: %v", err)
	}
	if len(snapshot.Mnemonic) != 0 || len(snapshot.Skills) != 0 {
		t.Fatalf("clear mnemonic left context: mnemonic=%#v skills=%#v", snapshot.Mnemonic, snapshot.Skills)
	}
	status, err := project.Skills.Status()
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if status.Active != 0 {
		t.Fatalf("clear mnemonic left active skill residency: %#v", status)
	}
	data, err := os.ReadFile(contextPath)
	if err != nil {
		t.Fatalf("ReadFile context: %v", err)
	}
	if strings.Contains(string(data), "old generated context") || !strings.Contains(string(data), "No saved project memory yet.") {
		t.Fatalf("generated context file was not reset: %s", string(data))
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
