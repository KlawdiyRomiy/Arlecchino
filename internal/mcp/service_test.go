package mcp

import (
	"arlecchino/internal/dispatcher"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveProjectPath_BlocksTraversal(t *testing.T) {
	root := t.TempDir()

	_, err := resolveProjectPath(root, "../outside.txt")
	if err == nil {
		t.Fatalf("resolveProjectPath() should reject traversal outside project root")
	}
}

func TestToolService_WriteAndRollback(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "src", "main.go")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "allow-write-rollback")

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filePath, []byte("before"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "allow-write-rollback",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.write_file",
	}); err != nil {
		t.Fatalf("CallTool(request_permission) error = %v", err)
	}

	writeResult, err := service.WriteFile("src/main.go", "after", "update-main")
	if err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	if writeResult.CheckpointID == "" {
		t.Fatalf("WriteFile() should return checkpoint id")
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "allow-write-rollback",
		"ttl_seconds":   300,
		"tool_name":     "change_journal.rollback_checkpoint",
	}); err != nil {
		t.Fatalf("CallTool(request_permission rollback) error = %v", err)
	}

	readResult, err := service.ReadFile("src/main.go")
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if readResult.Content != "after" {
		t.Fatalf("ReadFile() content = %q, want %q", readResult.Content, "after")
	}

	rollbackResult, err := service.RollbackCheckpoint(writeResult.CheckpointID)
	if err != nil {
		t.Fatalf("RollbackCheckpoint() error = %v", err)
	}
	if rollbackResult.ID != writeResult.CheckpointID {
		t.Fatalf("RollbackCheckpoint() id = %q, want %q", rollbackResult.ID, writeResult.CheckpointID)
	}

	readAfterRollback, err := service.ReadFile("src/main.go")
	if err != nil {
		t.Fatalf("ReadFile() after rollback error = %v", err)
	}
	if readAfterRollback.Content != "before" {
		t.Fatalf("ReadFile() after rollback = %q, want %q", readAfterRollback.Content, "before")
	}
}

func TestToolService_CallToolWriteFilePreservesRawContent(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "false")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	const rawContent = "first line\nsecond line\n\n"
	if _, err := service.CallTool("ide_control.write_file", map[string]any{
		"path":    "notes.txt",
		"content": rawContent,
	}); err != nil {
		t.Fatalf("CallTool(write_file) error = %v", err)
	}

	data, err := os.ReadFile(filepath.Join(root, "notes.txt"))
	if err != nil {
		t.Fatalf("ReadFile(notes.txt) error = %v", err)
	}
	if string(data) != rawContent {
		t.Fatalf("write_file content = %q, want %q", string(data), rawContent)
	}
}

func TestToolService_WriteFileRequiresUserApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "approval-secret")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.WriteFile("src/main.go", "package main", "no-approval")
	if err == nil {
		t.Fatalf("WriteFile() should fail without user approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("WriteFile() error = %v, want contains %q", err, "requires user approval")
	}
}

func TestToolService_DefaultRequiresUserApproval(t *testing.T) {
	root := t.TempDir()

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	status := service.PermissionStatus()
	if !status.Required {
		t.Fatalf("PermissionStatus().Required = false, want true by default")
	}
	if status.Granted {
		t.Fatalf("PermissionStatus().Granted = true, want false before approval")
	}
}

func TestToolService_ApprovalCanBeDisabledByEnv(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "false")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	status := service.PermissionStatus()
	if status.Required {
		t.Fatalf("PermissionStatus().Required = true, want false when disabled by env")
	}
	if !status.Granted {
		t.Fatalf("PermissionStatus().Granted = false, want true when disabled by env")
	}
}

func TestToolService_RequestPermissionRejectsInvalidApprovalCode(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "correct-code")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "wrong-code",
		"tool_name":     "ide_control.write_file",
	})
	if err == nil {
		t.Fatalf("CallTool(request_permission) should fail on invalid approval code")
	}
	if !strings.Contains(err.Error(), "invalid approval code") {
		t.Fatalf("CallTool(request_permission) error = %v, want contains %q", err, "invalid approval code")
	}
}

func TestToolService_RequestPermissionRequiresLiveApprovalWithoutCode(t *testing.T) {
	root := t.TempDir()

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.CallTool("ide_control.request_permission", map[string]any{
		"tool_name": "ide_control.write_file",
	})
	if err == nil {
		t.Fatalf("CallTool(request_permission) should fail without approval code or live UI")
	}
	if !strings.Contains(err.Error(), "live IDE approval is unavailable") {
		t.Fatalf("CallTool(request_permission) error = %v, want live IDE approval error", err)
	}
}

func TestToolService_RollbackRequiresUserApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "true")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "approval-for-rollback")
	filePath := filepath.Join(root, "src", "main.go")

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filePath, []byte("before"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	checkpoint, err := service.CreateCheckpoint("src/main.go", "before-change")
	if err != nil {
		t.Fatalf("CreateCheckpoint() error = %v", err)
	}

	if err := os.WriteFile(filePath, []byte("after"), 0o644); err != nil {
		t.Fatalf("WriteFile(after) error = %v", err)
	}

	_, err = service.RollbackCheckpoint(checkpoint.ID)
	if err == nil {
		t.Fatalf("RollbackCheckpoint() should fail without user approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("RollbackCheckpoint() error = %v, want contains %q", err, "requires user approval")
	}
}

func TestToolService_ReadSensitiveFileRequiresUserApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "sensitive-read-code")
	envPath := filepath.Join(root, ".env")

	if err := os.WriteFile(envPath, []byte("SECRET_KEY=super-secret"), 0o600); err != nil {
		t.Fatalf("WriteFile(.env) error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.ReadFile(".env")
	if err == nil {
		t.Fatalf("ReadFile(.env) should fail without user approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("ReadFile(.env) error = %v, want contains %q", err, "requires user approval")
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "sensitive-read-code",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.read_file",
	}); err != nil {
		t.Fatalf("CallTool(request_permission) error = %v", err)
	}

	readResult, err := service.ReadFile(".env")
	if err != nil {
		t.Fatalf("ReadFile(.env) after approval error = %v", err)
	}
	if readResult.Content != "SECRET_KEY=super-secret" {
		t.Fatalf("ReadFile(.env) content = %q, want %q", readResult.Content, "SECRET_KEY=super-secret")
	}
}

func TestToolService_CreateCheckpointSensitiveFileRequiresUserApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "checkpoint-sensitive-code")
	envPath := filepath.Join(root, ".env")

	if err := os.WriteFile(envPath, []byte("TOKEN=abc123"), 0o600); err != nil {
		t.Fatalf("WriteFile(.env) error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.CreateCheckpoint(".env", "sensitive-before")
	if err == nil {
		t.Fatalf("CreateCheckpoint(.env) should fail without user approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("CreateCheckpoint(.env) error = %v, want contains %q", err, "requires user approval")
	}
}

func TestToolService_SensitiveWriteRequiresUserApprovalEvenWhenGlobalApprovalDisabled(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "false")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "sensitive-write-code")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.WriteFile(".env", "SECRET=true", "sensitive-write")
	if err == nil {
		t.Fatalf("WriteFile(.env) should require user approval even when global approval is disabled")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("WriteFile(.env) error = %v, want contains %q", err, "requires user approval")
	}
}

func TestToolService_SearchFilesHidesSensitivePathsWithoutApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "search-sensitive")

	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("SECRET=hidden"), 0o600); err != nil {
		t.Fatalf("WriteFile(.env) error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	result, err := service.CallTool("ide_control.search_files", map[string]any{"pattern": ".env"})
	if err != nil {
		t.Fatalf("CallTool(search_files) error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("search_files result type = %T, want map[string]any", result)
	}
	items, ok := resultMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_files items type = %T, want []dispatcher.ResultItem", resultMap["items"])
	}
	if len(items) != 0 {
		t.Fatalf("search_files should hide sensitive paths without approval, got %d items", len(items))
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "search-sensitive",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.search_files",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	resultAfterApproval, err := service.CallTool("ide_control.search_files", map[string]any{"pattern": ".env"})
	if err != nil {
		t.Fatalf("CallTool(search_files) after approval error = %v", err)
	}
	resultAfterApprovalMap, ok := resultAfterApproval.(map[string]any)
	if !ok {
		t.Fatalf("search_files after approval result type = %T, want map[string]any", resultAfterApproval)
	}
	itemsAfterApproval, ok := resultAfterApprovalMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_files after approval items type = %T, want []dispatcher.ResultItem", resultAfterApprovalMap["items"])
	}
	if len(itemsAfterApproval) == 0 {
		t.Fatalf("search_files should return sensitive path after approval")
	}
}

func TestToolService_CheckpointsPersistAcrossServiceRecreation(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "src", "main.go")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "checkpoint-persist")

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filePath, []byte("before"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}
	checkpoint, err := service.CreateCheckpoint("src/main.go", "persist-me")
	if err != nil {
		t.Fatalf("CreateCheckpoint() error = %v", err)
	}

	if err := os.WriteFile(filePath, []byte("after"), 0o644); err != nil {
		t.Fatalf("WriteFile(after) error = %v", err)
	}

	reloaded, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService(reloaded) error = %v", err)
	}

	items, err := reloaded.ListCheckpoints("src/main.go", 10)
	if err != nil {
		t.Fatalf("ListCheckpoints() error = %v", err)
	}
	if len(items) != 1 || items[0].ID != checkpoint.ID {
		t.Fatalf("ListCheckpoints() = %+v, want checkpoint %q", items, checkpoint.ID)
	}

	if _, err := reloaded.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "checkpoint-persist",
		"ttl_seconds":   300,
		"tool_name":     "change_journal.rollback_checkpoint",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	if _, err := reloaded.RollbackCheckpoint(checkpoint.ID); err != nil {
		t.Fatalf("RollbackCheckpoint() error = %v", err)
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if string(content) != "before" {
		t.Fatalf("rollback content = %q, want %q", string(content), "before")
	}
}

func TestToolService_AgentMemoryPersistsAcrossServiceRecreation(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "memory-persist-code")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "memory-persist-code",
		"ttl_seconds":   300,
		"tool_name":     "agent_memory.save",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	entry, err := service.SaveAgentMemory(
		"decision",
		[]string{"mcp", "terminal"},
		"Persist session context for terminal orchestration.",
		8,
	)
	if err != nil {
		t.Fatalf("SaveAgentMemory() error = %v", err)
	}
	if entry.ID == "" {
		t.Fatalf("SaveAgentMemory() should return entry id")
	}

	reloaded, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService(reloaded) error = %v", err)
	}

	items := reloaded.SearchAgentMemory("terminal orchestration", nil, 10)
	if len(items) != 1 {
		t.Fatalf("SearchAgentMemory() len = %d, want 1", len(items))
	}
	if items[0].Content != entry.Content {
		t.Fatalf("SearchAgentMemory() content = %q, want %q", items[0].Content, entry.Content)
	}

	contextPath := AgentContextFilePath(root)
	contextBody, err := os.ReadFile(contextPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", contextPath, err)
	}
	if !strings.Contains(string(contextBody), entry.Content) {
		t.Fatalf("context file should contain saved memory content")
	}
}

func TestToolService_SearchContentHidesSensitiveContentWithoutApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "content-sensitive")

	sensitivePath := filepath.Join(root, "app.secret.json")
	if err := os.WriteFile(sensitivePath, []byte("{\"apiToken\":\"hidden-content\"}"), 0o600); err != nil {
		t.Fatalf("WriteFile(app.secret.json) error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	result, err := service.CallTool("ide_control.search_content", map[string]any{"query": "hidden-content"})
	if err != nil {
		t.Fatalf("CallTool(search_content) error = %v", err)
	}
	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("search_content result type = %T, want map[string]any", result)
	}
	items, ok := resultMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_content items type = %T, want []dispatcher.ResultItem", resultMap["items"])
	}
	if len(items) != 0 {
		t.Fatalf("search_content should hide sensitive content without approval, got %d items", len(items))
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "content-sensitive",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.search_content",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	resultAfterApproval, err := service.CallTool("ide_control.search_content", map[string]any{"query": "hidden-content"})
	if err != nil {
		t.Fatalf("CallTool(search_content) after approval error = %v", err)
	}
	resultAfterApprovalMap, ok := resultAfterApproval.(map[string]any)
	if !ok {
		t.Fatalf("search_content after approval result type = %T, want map[string]any", resultAfterApproval)
	}
	itemsAfterApproval, ok := resultAfterApprovalMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_content after approval items type = %T, want []dispatcher.ResultItem", resultAfterApprovalMap["items"])
	}
	if len(itemsAfterApproval) == 0 {
		t.Fatalf("search_content should return sensitive content after approval")
	}
}

func TestToolService_SearchContentNoMatchesReturnsEmptyItems(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(main.go) error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	result, err := service.CallTool("ide_control.search_content", map[string]any{"query": "missing-value"})
	if err != nil {
		t.Fatalf("CallTool(search_content) error = %v", err)
	}
	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("search_content result type = %T, want map[string]any", result)
	}
	items, ok := resultMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_content items type = %T, want []dispatcher.ResultItem", resultMap["items"])
	}
	if items == nil {
		t.Fatal("search_content items = nil, want empty slice")
	}
	if len(items) != 0 {
		t.Fatalf("search_content items len = %d, want 0", len(items))
	}
}

func TestToolService_SensitiveNestedPathRequiresApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "nested-sensitive")

	sensitiveRelativePath := filepath.Join("configs", ".env", "secret.txt")
	sensitiveAbsolutePath := filepath.Join(root, sensitiveRelativePath)
	if err := os.MkdirAll(filepath.Dir(sensitiveAbsolutePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(sensitive dir) error = %v", err)
	}
	if err := os.WriteFile(sensitiveAbsolutePath, []byte("NESTED_SECRET=true"), 0o600); err != nil {
		t.Fatalf("WriteFile(sensitive nested) error = %v", err)
	}

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.ReadFile(sensitiveRelativePath)
	if err == nil {
		t.Fatalf("ReadFile(nested sensitive) should fail without approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("ReadFile(nested sensitive) error = %v, want contains %q", err, "requires user approval")
	}

	searchBeforeApproval, err := service.CallTool("ide_control.search_files", map[string]any{"pattern": "secret.txt"})
	if err != nil {
		t.Fatalf("search_files before approval error = %v", err)
	}
	searchBeforeApprovalMap, ok := searchBeforeApproval.(map[string]any)
	if !ok {
		t.Fatalf("search_files before approval type = %T, want map[string]any", searchBeforeApproval)
	}
	searchBeforeApprovalItems, ok := searchBeforeApprovalMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_files before approval items type = %T, want []dispatcher.ResultItem", searchBeforeApprovalMap["items"])
	}
	if len(searchBeforeApprovalItems) != 0 {
		t.Fatalf("search_files should hide nested sensitive path without approval")
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "nested-sensitive",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.read_file",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	readAfterApproval, err := service.ReadFile(sensitiveRelativePath)
	if err != nil {
		t.Fatalf("ReadFile(nested sensitive) after approval error = %v", err)
	}
	if readAfterApproval.Content != "NESTED_SECRET=true" {
		t.Fatalf("ReadFile(nested sensitive) content = %q, want %q", readAfterApproval.Content, "NESTED_SECRET=true")
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "nested-sensitive",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.search_files",
	}); err != nil {
		t.Fatalf("request_permission search_files error = %v", err)
	}

	searchAfterApproval, err := service.CallTool("ide_control.search_files", map[string]any{"pattern": "secret.txt"})
	if err != nil {
		t.Fatalf("search_files after approval error = %v", err)
	}
	searchAfterApprovalMap, ok := searchAfterApproval.(map[string]any)
	if !ok {
		t.Fatalf("search_files after approval type = %T, want map[string]any", searchAfterApproval)
	}
	searchAfterApprovalItems, ok := searchAfterApprovalMap["items"].([]dispatcher.ResultItem)
	if !ok {
		t.Fatalf("search_files after approval items type = %T, want []dispatcher.ResultItem", searchAfterApprovalMap["items"])
	}
	if len(searchAfterApprovalItems) == 0 {
		t.Fatalf("search_files should return nested sensitive path after approval")
	}
}

func TestToolService_ListCheckpointsWithFilterAndLimit(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "list-checkpoints-code")

	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "list-checkpoints-code",
		"ttl_seconds":   300,
		"tool_name":     "change_journal.create_checkpoint",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	if _, err := service.CreateCheckpoint("a.txt", "a-1"); err != nil {
		t.Fatalf("CreateCheckpoint(a.txt) error = %v", err)
	}
	if _, err := service.CreateCheckpoint("b.txt", "b-1"); err != nil {
		t.Fatalf("CreateCheckpoint(b.txt) error = %v", err)
	}
	if _, err := service.CreateCheckpoint("a.txt", "a-2"); err != nil {
		t.Fatalf("CreateCheckpoint(a.txt second) error = %v", err)
	}

	filtered, err := service.ListCheckpoints("a.txt", 10)
	if err != nil {
		t.Fatalf("ListCheckpoints() error = %v", err)
	}
	if len(filtered) != 2 {
		t.Fatalf("ListCheckpoints(a.txt) len = %d, want 2", len(filtered))
	}

	limited, err := service.ListCheckpoints("", 1)
	if err != nil {
		t.Fatalf("ListCheckpoints(limit=1) error = %v", err)
	}
	if len(limited) != 1 {
		t.Fatalf("ListCheckpoints(limit=1) len = %d, want 1", len(limited))
	}
}

func TestToolService_CallToolUnknown(t *testing.T) {
	root := t.TempDir()
	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.CallTool("unknown.tool", map[string]any{})
	if err == nil {
		t.Fatalf("CallTool() should fail on unknown tool")
	}
}

func TestToolService_DisabledSettingsExposeNoToolsAndRejectCalls(t *testing.T) {
	root := t.TempDir()
	settingsPath := filepath.Join(t.TempDir(), "mcp-settings.json")
	if _, _, err := SaveSettings(settingsPath, Settings{
		Version:                   settingsVersion,
		Enabled:                   false,
		ApprovalRequired:          true,
		DefaultApprovalTTLSeconds: defaultApprovalTTLSeconds,
	}); err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{SettingsPath: settingsPath})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if tools := service.ToolDefinitions(); len(tools) != 0 {
		t.Fatalf("ToolDefinitions() len = %d, want 0 when MCP is disabled", len(tools))
	}

	_, err = service.CallTool("ide_control.search_files", map[string]any{"pattern": "main"})
	if err == nil {
		t.Fatalf("CallTool(search_files) should fail when MCP is disabled")
	}
	if !strings.Contains(err.Error(), "disabled by settings") {
		t.Fatalf("CallTool(search_files) error = %v, want disabled settings error", err)
	}
	if instructions := service.InitializeInstructions(); !strings.Contains(instructions, "disabled") {
		t.Fatalf("InitializeInstructions() = %q, want disabled message", instructions)
	}
}

func TestToolService_DisabledToolIsFilteredAndRejected(t *testing.T) {
	root := t.TempDir()
	settingsPath := filepath.Join(t.TempDir(), "mcp-settings.json")
	if _, _, err := SaveSettings(settingsPath, Settings{
		Version:                   settingsVersion,
		Enabled:                   true,
		ApprovalRequired:          true,
		DefaultApprovalTTLSeconds: defaultApprovalTTLSeconds,
		DisabledTools:             []string{"ide_control.search_files"},
	}); err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{SettingsPath: settingsPath})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	for _, definition := range service.ToolDefinitions() {
		if definition.Name == "ide_control.search_files" {
			t.Fatalf("ToolDefinitions() should not expose disabled tool %q", definition.Name)
		}
	}

	_, err = service.CallTool("ide_control.search_files", map[string]any{"pattern": "main"})
	if err == nil {
		t.Fatalf("CallTool(search_files) should fail for disabled tool")
	}
	if !strings.Contains(err.Error(), "disabled by Arlecchino MCP settings") {
		t.Fatalf("CallTool(search_files) error = %v, want disabled tool error", err)
	}

	capabilities := service.Capabilities()
	entries, ok := capabilities["toolSettings"].([]ToolSettingsEntry)
	if !ok {
		t.Fatalf("Capabilities().toolSettings type = %T, want []ToolSettingsEntry", capabilities["toolSettings"])
	}
	foundDisabled := false
	for _, entry := range entries {
		if entry.Name == "ide_control.search_files" {
			foundDisabled = true
			if entry.Enabled || entry.EffectiveEnabled {
				t.Fatalf("toolSettings entry = %#v, want disabled", entry)
			}
		}
	}
	if !foundDisabled {
		t.Fatalf("toolSettings should include disabled tool state")
	}
}

func TestResolveProjectPath_RejectsSymlinkOutsideProjectRoot(t *testing.T) {
	projectRoot := t.TempDir()
	outsideRoot := t.TempDir()
	secretPath := filepath.Join(outsideRoot, "secret.txt")

	if err := os.WriteFile(secretPath, []byte("secret"), 0o644); err != nil {
		t.Fatalf("WriteFile(secret) error = %v", err)
	}

	symlinkPath := filepath.Join(projectRoot, "alias.txt")
	if err := os.Symlink(secretPath, symlinkPath); err != nil {
		t.Fatalf("Symlink() error = %v", err)
	}

	_, err := resolveProjectPath(projectRoot, "alias.txt")
	if err == nil {
		t.Fatalf("resolveProjectPath() should reject symlink target outside project root")
	}
	if !strings.Contains(err.Error(), "escapes project root") {
		t.Fatalf("resolveProjectPath() error = %v, want contains %q", err, "escapes project root")
	}
}

func TestToolService_ReadFile_RejectsSymlinkOutsideProjectRoot(t *testing.T) {
	projectRoot := t.TempDir()
	outsideRoot := t.TempDir()
	secretPath := filepath.Join(outsideRoot, "secret.txt")

	if err := os.WriteFile(secretPath, []byte("secret"), 0o644); err != nil {
		t.Fatalf("WriteFile(secret) error = %v", err)
	}

	symlinkPath := filepath.Join(projectRoot, "config.txt")
	if err := os.Symlink(secretPath, symlinkPath); err != nil {
		t.Fatalf("Symlink() error = %v", err)
	}

	service, err := NewToolService(projectRoot)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	_, err = service.ReadFile("config.txt")
	if err == nil {
		t.Fatalf("ReadFile() should reject symlink escape")
	}
	if !strings.Contains(err.Error(), "escapes project root") {
		t.Fatalf("ReadFile() error = %v, want contains %q", err, "escapes project root")
	}
}

func TestNewToolService_ValidationErrors(t *testing.T) {
	nonDirRoot := t.TempDir()
	nonDirFile := filepath.Join(nonDirRoot, "file.txt")
	if err := os.WriteFile(nonDirFile, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile(nonDirFile) error = %v", err)
	}

	tests := []struct {
		name       string
		root       string
		wantErrSub string
	}{
		{
			name:       "empty root",
			root:       "",
			wantErrSub: "project root is empty",
		},
		{
			name:       "missing root",
			root:       filepath.Join(t.TempDir(), "missing"),
			wantErrSub: "no such file or directory",
		},
		{
			name:       "root is file",
			root:       nonDirFile,
			wantErrSub: "not a directory",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewToolService(tt.root)
			if err == nil {
				t.Fatalf("NewToolService(%q) should return error", tt.root)
			}
			if !strings.Contains(err.Error(), tt.wantErrSub) {
				t.Fatalf("NewToolService(%q) error = %v, want contains %q", tt.root, err, tt.wantErrSub)
			}
		})
	}
}

func TestNewToolServiceWithOptions_AuditLogOutsideProjectRootRejected(t *testing.T) {
	projectRoot := t.TempDir()
	outsideRoot := t.TempDir()

	_, err := NewToolServiceWithOptions(projectRoot, ToolServiceOptions{
		AuditLogPath: filepath.Join(outsideRoot, "audit.log"),
	})
	if err == nil {
		t.Fatalf("NewToolServiceWithOptions() should reject audit path outside project root")
	}
}
