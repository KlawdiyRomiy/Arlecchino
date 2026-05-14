package mcp

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentSkillsToolsArePureReadUntilApprovedPin(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "skill-code")
	skillDir := filepath.Join(root, ".arlecchino", "skills", "demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(strings.TrimSpace(`
---
name: demo
description: Demo MCP skill.
---

# Demo

Rules:
- Keep MCP skill context compact.
`)+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService: %v", err)
	}
	defer service.Close()

	listResult, err := service.CallTool("agent_skills.list", map[string]any{"limit": 10})
	if err != nil {
		t.Fatalf("agent_skills.list: %v", err)
	}
	if !strings.Contains(toText(listResult), "project:demo") {
		t.Fatalf("skill list missing demo candidate: %#v", listResult)
	}
	contextResult, err := service.CallTool("agent_skills.context", map[string]any{"surface": "agent", "session_id": "default"})
	if err != nil {
		t.Fatalf("agent_skills.context before pin: %v", err)
	}
	if strings.Contains(toText(contextResult), "Keep MCP skill context compact") {
		t.Fatalf("untrusted skill appeared in resident context: %#v", contextResult)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "skill-code",
		"tool_name":     "agent_skills.pin",
	}); err != nil {
		t.Fatalf("request pin permission: %v", err)
	}
	if _, err := service.CallTool("agent_skills.pin", map[string]any{"skill_id": "project:demo", "reviewer": "unit-test"}); err != nil {
		t.Fatalf("agent_skills.pin: %v", err)
	}
	contextResult, err = service.CallTool("agent_skills.context", map[string]any{"surface": "agent", "session_id": "default"})
	if err != nil {
		t.Fatalf("agent_skills.context after pin: %v", err)
	}
	if strings.Contains(toText(contextResult), "Demo MCP skill") {
		t.Fatalf("pinned but inactive skill appeared in resident context: %#v", contextResult)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "skill-code",
		"tool_name":     "agent_skills.activate",
	}); err != nil {
		t.Fatalf("request activate permission: %v", err)
	}
	if _, err := service.CallTool("agent_skills.activate", map[string]any{"skill_id": "project:demo", "surface": "agent", "session_id": "default", "reason": "unit-test"}); err != nil {
		t.Fatalf("agent_skills.activate: %v", err)
	}
	contextResult, err = service.CallTool("agent_skills.context", map[string]any{"surface": "agent", "session_id": "default"})
	if err != nil {
		t.Fatalf("agent_skills.context after activate: %v", err)
	}
	if !strings.Contains(toText(contextResult), "Demo MCP skill") {
		t.Fatalf("trusted active skill missing from context: %#v", contextResult)
	}
}

func TestAgentSkillWriteToolsRequireExplicitApprovalWhenGlobalApprovalDisabled(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "false")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "skill-code")
	skillDir := filepath.Join(root, ".arlecchino", "skills", "demo")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte("---\nname: demo\ndescription: Demo MCP skill.\n---\n# Demo\n"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService: %v", err)
	}
	defer service.Close()

	if _, err := service.CallTool("agent_skills.pin", map[string]any{"skill_id": "project:demo"}); err == nil || !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("agent_skills.pin without explicit approval error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{"approval_code": "skill-code", "tool_name": "agent_skills.pin"}); err != nil {
		t.Fatalf("request pin permission: %v", err)
	}
	if _, err := service.CallTool("agent_skills.pin", map[string]any{"skill_id": "project:demo", "reviewer": "unit-test"}); err != nil {
		t.Fatalf("agent_skills.pin approved: %v", err)
	}

	if _, err := service.CallTool("agent_skills.activate", map[string]any{"skill_id": "project:demo"}); err == nil || !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("agent_skills.activate without explicit approval error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{"approval_code": "skill-code", "tool_name": "agent_skills.activate"}); err != nil {
		t.Fatalf("request activate permission: %v", err)
	}
	if _, err := service.CallTool("agent_skills.activate", map[string]any{"skill_id": "project:demo", "surface": "agent", "session_id": "default"}); err != nil {
		t.Fatalf("agent_skills.activate approved: %v", err)
	}

	if _, err := service.CallTool("agent_skills.dismiss", map[string]any{"skill_id": "project:demo"}); err == nil || !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("agent_skills.dismiss without explicit approval error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{"approval_code": "skill-code", "tool_name": "agent_skills.dismiss"}); err != nil {
		t.Fatalf("request dismiss permission: %v", err)
	}
	if _, err := service.CallTool("agent_skills.dismiss", map[string]any{"skill_id": "project:demo", "surface": "agent", "session_id": "default"}); err != nil {
		t.Fatalf("agent_skills.dismiss approved: %v", err)
	}

	if _, err := service.CallTool("agent_skills.import", map[string]any{"name": "Imported Demo"}); err == nil || !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("agent_skills.import without explicit approval error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{"approval_code": "skill-code", "tool_name": "agent_skills.import"}); err != nil {
		t.Fatalf("request import permission: %v", err)
	}
	if _, err := service.CallTool("agent_skills.import", map[string]any{"name": "Imported Demo"}); err != nil {
		t.Fatalf("agent_skills.import approved: %v", err)
	}
}

func TestRequestPermissionRejectsUnknownToolName(t *testing.T) {
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "approval-code")
	service, err := NewToolService(t.TempDir())
	if err != nil {
		t.Fatalf("NewToolService: %v", err)
	}
	defer service.Close()
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "approval-code",
		"tool_name":     "agent_skills.not_a_tool",
	}); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("request_permission unknown tool error = %v", err)
	}
}

func toText(value any) string {
	return fmt.Sprintf("%#v", value)
}
