package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type fakeBridgeCall struct {
	Method string
	Params map[string]any
}

type fakeBridge struct {
	mu       sync.Mutex
	calls    []fakeBridgeCall
	response map[string]any
}

func newFakeBridge() *fakeBridge {
	return &fakeBridge{
		response: map[string]any{},
	}
}

func (f *fakeBridge) Mode() string {
	return "fake"
}

func (f *fakeBridge) Available() bool {
	return true
}

func (f *fakeBridge) Call(method string, params map[string]any) (any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	copyParams := map[string]any{}
	for k, v := range params {
		copyParams[k] = v
	}
	f.calls = append(f.calls, fakeBridgeCall{Method: method, Params: copyParams})

	if response, ok := f.response[method]; ok {
		return response, nil
	}

	return map[string]any{"ok": true}, nil
}

func (f *fakeBridge) methodCalls(method string) []fakeBridgeCall {
	f.mu.Lock()
	defer f.mu.Unlock()

	result := make([]fakeBridgeCall, 0, len(f.calls))
	for _, call := range f.calls {
		if call.Method == method {
			result = append(result, call)
		}
	}
	return result
}

func TestToolService_ToolDefinitionsAlwaysIncludeBridgeTools(t *testing.T) {
	root := t.TempDir()

	standalone, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	toolNames := map[string]bool{}
	for _, definition := range standalone.ToolDefinitions() {
		toolNames[definition.Name] = true
	}

	required := []string{
		"ide_backend.project_open",
		"ide_backend.project_close",
		"ide_backend.project_status",
		"ide_backend.lsp_status",
		"ide_backend.terminal_create",
		"ide_backend.git_status",
		"agent_memory.save",
		"agent_memory.context",
		"ide_control.flight_recorder",
		"ide_ui.emit_event",
		"ide_ui.surface_read",
		"ide_ui.open_intent",
		"ide_ui.open_file_panel",
		"ide_ui.open_panel",
		"ide_ui.move_panel",
		"ide_ui.close_panel",
		"ide_ui.preview_open",
		"ide_ui.preview_navigate",
		"ide_ui.preview_focus",
		"ide_ui.preview_close",
		"ide_ui.apply_layout_profile",
		"ide_ui.list_layout_profiles",
		"ide_ui.hot_switch",
	}
	for _, toolName := range required {
		if !toolNames[toolName] {
			t.Fatalf("standalone ToolDefinitions() missing tool %q — all tools must be registered regardless of bridge", toolName)
		}
	}

	// Verify bridge-tools return graceful error when called without bridge
	_, err = standalone.CallTool("ide_backend.project_status", map[string]any{})
	if err == nil {
		t.Fatalf("ide_backend.project_status should fail without bridge")
	}
	if !strings.Contains(err.Error(), "requires live IDE bridge") {
		t.Fatalf("ide_backend.project_status error = %v, want contains %q", err, "requires live IDE bridge")
	}
}

func TestToolService_OpenIntentEmitsConfirmedOpenIntentEvent(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(main.go) error = %v", err)
	}
	resolvedFilePath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		t.Fatalf("EvalSymlinks(main.go) error = %v", err)
	}

	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "open-intent")
	bridge := newFakeBridge()
	bridge.response["ui.emit_event"] = map[string]any{
		"emitted":   true,
		"confirmed": true,
	}
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "open-intent",
		"ttl_seconds":   60,
		"tool_name":     "ide_ui.open_intent",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	result, err := service.CallTool("ide_ui.open_intent", map[string]any{
		"kind": "file.open",
		"path": "main.go",
		"line": 3,
	})
	if err != nil {
		t.Fatalf("open_intent error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("open_intent result type = %T, want map[string]any", result)
	}
	if resultMap["mcpRequestId"] == "" {
		t.Fatalf("open_intent result missing mcpRequestId: %#v", resultMap)
	}

	calls := bridge.methodCalls("ui.emit_event")
	if len(calls) != 1 {
		t.Fatalf("ui.emit_event call count = %d, want 1", len(calls))
	}
	if calls[0].Params["event"] != "ide:intent:open" {
		t.Fatalf("event = %v, want ide:intent:open", calls[0].Params["event"])
	}
	payload, ok := calls[0].Params["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload type = %T, want map[string]any", calls[0].Params["payload"])
	}
	if payload["kind"] != "openFile" {
		t.Fatalf("payload kind = %v, want openFile", payload["kind"])
	}
	if payload["path"] != resolvedFilePath {
		t.Fatalf("payload path = %v, want %v", payload["path"], resolvedFilePath)
	}
	if payload["line"] != 3 {
		t.Fatalf("payload line = %v, want 3", payload["line"])
	}
	if payload["source"] != "mcp" {
		t.Fatalf("payload source = %v, want mcp", payload["source"])
	}
}

func TestToolService_OpenFilePanelEmitsConfirmedPanelOpen(t *testing.T) {
	root := t.TempDir()
	makefilePath := filepath.Join(root, "Makefile")
	if err := os.WriteFile(makefilePath, []byte("dev-start:\n\tgo run .\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(Makefile) error = %v", err)
	}
	resolvedMakefilePath, err := filepath.EvalSymlinks(makefilePath)
	if err != nil {
		t.Fatalf("EvalSymlinks(Makefile) error = %v", err)
	}

	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "open-file-panel")
	bridge := newFakeBridge()
	bridge.response["ui.emit_event"] = map[string]any{
		"emitted":   true,
		"event":     "ide:panel:open",
		"confirmed": true,
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "open-file-panel",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.open_file_panel",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	result, err := service.CallTool("ide_ui.open_file_panel", map[string]any{
		"path":     "Makefile",
		"line":     1,
		"position": "right",
		"width":    620,
	})
	if err != nil {
		t.Fatalf("open_file_panel error = %v", err)
	}
	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("open_file_panel result type = %T, want map[string]any", result)
	}
	if requestID, ok := resultMap["mcpRequestId"].(string); !ok || requestID == "" {
		t.Fatalf("open_file_panel result missing mcpRequestId: %#v", resultMap)
	}

	calls := bridge.methodCalls("ui.emit_event")
	if len(calls) != 1 {
		t.Fatalf("ui.emit_event calls = %d, want 1", len(calls))
	}
	call := calls[0]
	if got := call.Params["event"]; got != "ide:panel:open" {
		t.Fatalf("event = %v, want ide:panel:open", got)
	}
	if requestID, ok := call.Params["mcpRequestId"].(string); !ok || requestID == "" {
		t.Fatalf("bridge call missing mcpRequestId: %#v", call.Params)
	}
	payload, ok := call.Params["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload type = %T, want map[string]any", call.Params["payload"])
	}
	wantPayload := map[string]any{
		"panel":    "code",
		"path":     resolvedMakefilePath,
		"line":     1,
		"position": "right",
		"mode":     "snapped",
		"width":    620,
	}
	if !equalBridgePayload(payload, wantPayload) {
		t.Fatalf("payload = %#v, want %#v", payload, wantPayload)
	}
}

func TestToolService_GenericPanelToolsEmitConfirmedPanelEvents(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "panel-tools")

	bridge := newFakeBridge()
	bridge.response["ui.emit_event"] = map[string]any{
		"emitted":   true,
		"confirmed": true,
	}
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	for _, toolName := range []string{"ide_ui.open_panel", "ide_ui.move_panel", "ide_ui.close_panel"} {
		if _, err := service.CallTool("ide_control.request_permission", map[string]any{
			"approval_code": "panel-tools",
			"ttl_seconds":   300,
			"tool_name":     toolName,
		}); err != nil {
			t.Fatalf("request_permission(%s) error = %v", toolName, err)
		}
	}

	if _, err := service.CallTool("ide_ui.open_panel", map[string]any{
		"panel":    "explorer",
		"position": "left",
		"mode":     "snapped",
	}); err != nil {
		t.Fatalf("open_panel error = %v", err)
	}
	if _, err := service.CallTool("ide_ui.move_panel", map[string]any{
		"panel":    "explorer",
		"position": "right",
		"width":    320,
	}); err != nil {
		t.Fatalf("move_panel error = %v", err)
	}
	if _, err := service.CallTool("ide_ui.close_panel", map[string]any{
		"panel": "explorer",
	}); err != nil {
		t.Fatalf("close_panel error = %v", err)
	}

	calls := bridge.methodCalls("ui.emit_event")
	if len(calls) != 3 {
		t.Fatalf("ui.emit_event calls = %d, want 3", len(calls))
	}
	wantEvents := []string{"ide:panel:open", "ide:panel:move", "ide:panel:close"}
	for index, wantEvent := range wantEvents {
		if got := calls[index].Params["event"]; got != wantEvent {
			t.Fatalf("call[%d] event = %v, want %s", index, got, wantEvent)
		}
		if requestID, ok := calls[index].Params["mcpRequestId"].(string); !ok || requestID == "" {
			t.Fatalf("call[%d] missing mcpRequestId: %#v", index, calls[index].Params)
		}
		payload, ok := calls[index].Params["payload"].(map[string]any)
		if !ok {
			t.Fatalf("call[%d] payload type = %T, want map[string]any", index, calls[index].Params["payload"])
		}
		if payload["panel"] != "explorer" {
			t.Fatalf("call[%d] panel = %v, want explorer", index, payload["panel"])
		}
	}
}

func TestToolService_SurfaceReadReturnsFrontendReadModel(t *testing.T) {
	root := t.TempDir()
	bridge := newFakeBridge()
	bridge.response["ui.emit_event"] = map[string]any{
		"emitted":   true,
		"event":     "ide:surface:read",
		"confirmed": true,
		"result": map[string]any{
			"revision":        float64(7),
			"activeSurfaceId": "panel:explorer",
			"sessionIds":      []any{"panel:explorer"},
		},
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	result, err := service.CallTool("ide_ui.surface_read", map[string]any{
		"eventLimit":    3,
		"includeEvents": false,
	})
	if err != nil {
		t.Fatalf("surface_read error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("surface_read result type = %T, want map[string]any", result)
	}
	if resultMap["confirmed"] != true {
		t.Fatalf("surface_read confirmed = %v, want true", resultMap["confirmed"])
	}
	if requestID, ok := resultMap["mcpRequestId"].(string); !ok || requestID == "" {
		t.Fatalf("surface_read result missing mcpRequestId: %#v", resultMap)
	}
	surface, ok := resultMap["surface"].(map[string]any)
	if !ok {
		t.Fatalf("surface_read surface type = %T, want map[string]any", resultMap["surface"])
	}
	if surface["activeSurfaceId"] != "panel:explorer" {
		t.Fatalf("activeSurfaceId = %v, want panel:explorer", surface["activeSurfaceId"])
	}

	calls := bridge.methodCalls("ui.emit_event")
	if len(calls) != 1 {
		t.Fatalf("ui.emit_event calls = %d, want 1", len(calls))
	}
	call := calls[0]
	if got := call.Params["event"]; got != "ide:surface:read" {
		t.Fatalf("event = %v, want ide:surface:read", got)
	}
	if requestID, ok := call.Params["mcpRequestId"].(string); !ok || requestID == "" {
		t.Fatalf("bridge call missing mcpRequestId: %#v", call.Params)
	}
	payload, ok := call.Params["payload"].(map[string]any)
	if !ok {
		t.Fatalf("payload type = %T, want map[string]any", call.Params["payload"])
	}
	if payload["eventLimit"] != 3 {
		t.Fatalf("eventLimit = %v, want 3", payload["eventLimit"])
	}
	if payload["includeEvents"] != false {
		t.Fatalf("includeEvents = %v, want false", payload["includeEvents"])
	}
}

func TestToolService_WriteFileNotifiesLiveFrontend(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "write-notify")
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(main.go) error = %v", err)
	}
	resolvedPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		t.Fatalf("EvalSymlinks(main.go) error = %v", err)
	}

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}
	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "write-notify",
		"ttl_seconds":   300,
		"tool_name":     "ide_control.write_file",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	if _, err := service.WriteFile("main.go", "package main\nfunc updated() {}\n", "update-main"); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	calls := bridge.methodCalls("ui.emit_event")
	if len(calls) != 1 {
		t.Fatalf("ui.emit_event calls = %d, want 1", len(calls))
	}
	if calls[0].Params["event"] != "file:changed" {
		t.Fatalf("event = %v, want file:changed", calls[0].Params["event"])
	}
	if calls[0].Params["payload"] != resolvedPath {
		t.Fatalf("payload = %v, want %v", calls[0].Params["payload"], resolvedPath)
	}
}

func TestToolService_ProjectOpenRequiresUserApproval(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "true")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "bridge-approval")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	_, err = service.CallTool("ide_backend.project_open", map[string]any{"path": root})
	if err == nil {
		t.Fatalf("project_open should fail without user approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("project_open error = %v, want contains %q", err, "requires user approval")
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "bridge-approval",
		"ttl_seconds":   300,
		"tool_name":     "ide_backend.project_open",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	_, err = service.CallTool("ide_backend.project_open", map[string]any{"path": root})
	if err != nil {
		t.Fatalf("project_open after approval error = %v", err)
	}

	if len(bridge.methodCalls("project.open")) != 1 {
		t.Fatalf("project.open bridge calls = %d, want 1", len(bridge.methodCalls("project.open")))
	}
}

func TestToolService_RequestPermissionUsesLiveBridgeApproval(t *testing.T) {
	root := t.TempDir()

	bridge := newFakeBridge()
	bridge.response["mcp.request_approval"] = map[string]any{
		"approved":    true,
		"ttl_seconds": 120,
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	result, err := service.CallTool("ide_control.request_permission", map[string]any{
		"ttl_seconds": 120,
		"tool_name":   "ide_control.write_file",
	})
	if err != nil {
		t.Fatalf("request_permission live approval error = %v", err)
	}

	status, ok := result.(PermissionStatus)
	if !ok {
		t.Fatalf("request_permission result type = %T, want PermissionStatus", result)
	}
	if !status.Required || !status.Granted {
		t.Fatalf("request_permission status = %+v, want required and granted", status)
	}

	approvalCalls := bridge.methodCalls("mcp.request_approval")
	if len(approvalCalls) != 1 {
		t.Fatalf("mcp.request_approval calls = %d, want 1", len(approvalCalls))
	}
	if approvalCalls[0].Params["tool_name"] != "ide_control.write_file" {
		t.Fatalf("approval tool_name = %v, want ide_control.write_file", approvalCalls[0].Params["tool_name"])
	}

	if _, err := service.WriteFile("src/main.go", "package main", "after-ui-approval"); err != nil {
		t.Fatalf("WriteFile() after live approval error = %v", err)
	}
}

func TestToolService_LiveBridgeApprovalDenialBlocksMutatingTool(t *testing.T) {
	root := t.TempDir()

	bridge := newFakeBridge()
	bridge.response["mcp.request_approval"] = map[string]any{
		"approved": false,
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	_, err = service.WriteFile("src/main.go", "package main", "denied")
	if err == nil {
		t.Fatalf("WriteFile() should fail when live approval is denied")
	}
	if !strings.Contains(err.Error(), "approval denied") {
		t.Fatalf("WriteFile() error = %v, want approval denied", err)
	}

	if len(bridge.methodCalls("mcp.request_approval")) != 1 {
		t.Fatalf("mcp.request_approval calls = %d, want 1", len(bridge.methodCalls("mcp.request_approval")))
	}
}

func TestToolService_ProjectOpenOutsideRootRequiresApprovalWhenGlobalDisabled(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_REQUIRE_APPROVAL", "false")
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "force-boundary")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	_, err = service.CallTool("ide_backend.project_open", map[string]any{"path": outside})
	if err == nil {
		t.Fatalf("project_open outside root should require approval even when global gate disabled")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("project_open outside root error = %v, want contains %q", err, "requires user approval")
	}
}

func TestToolService_AuditLogsPersistToDisk(t *testing.T) {
	root := t.TempDir()
	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.search_files", map[string]any{"pattern": "*.go"}); err != nil {
		t.Fatalf("search_files error = %v", err)
	}

	auditResult, err := service.CallTool("ide_control.audit_logs", map[string]any{"limit": 10})
	if err != nil {
		t.Fatalf("audit_logs error = %v", err)
	}

	auditMap, ok := auditResult.(map[string]any)
	if !ok {
		t.Fatalf("audit_logs result type = %T, want map[string]any", auditResult)
	}
	items, ok := auditMap["items"].([]AuditEntry)
	if !ok {
		t.Fatalf("audit_logs items type = %T, want []AuditEntry", auditMap["items"])
	}
	if len(items) == 0 {
		t.Fatalf("audit_logs should contain at least one entry")
	}

	diskPath, ok := auditMap["diskPath"].(string)
	if !ok || strings.TrimSpace(diskPath) == "" {
		t.Fatalf("audit_logs diskPath = %v, want non-empty string", auditMap["diskPath"])
	}
	diskData, err := os.ReadFile(diskPath)
	if err != nil {
		t.Fatalf("ReadFile(audit disk) error = %v", err)
	}
	if len(strings.TrimSpace(string(diskData))) == 0 {
		t.Fatalf("audit disk log must not be empty")
	}
}

func TestToolService_FlightRecorderRecordsUIAckAndRedactsArgs(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "flight-code")

	bridge := newFakeBridge()
	bridge.response["ui.emit_event"] = map[string]any{
		"confirmed": true,
		"result":    map[string]any{"opened": true},
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "flight-code",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.open_file_panel",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	if _, err := service.CallTool("ide_ui.open_file_panel", map[string]any{
		"path":    "src/main.go",
		"content": "SECRET_TOKEN=123",
	}); err != nil {
		t.Fatalf("open_file_panel error = %v", err)
	}

	result, err := service.CallTool("ide_control.flight_recorder", map[string]any{"limit": 20})
	if err != nil {
		t.Fatalf("flight_recorder error = %v", err)
	}
	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("flight_recorder result type = %T, want map[string]any", result)
	}
	items, ok := resultMap["items"].([]FlightRecord)
	if !ok {
		t.Fatalf("flight_recorder items type = %T, want []FlightRecord", resultMap["items"])
	}

	var sawRequested, sawAck, sawTool bool
	for _, item := range items {
		switch item.Type {
		case "agent.ui.requested":
			if item.Tool == "ide_ui.open_file_panel" && item.CorrelationID != "" {
				sawRequested = true
			}
		case "agent.ui.acknowledged":
			if item.Tool == "ide_ui.open_file_panel" && item.Status == "acknowledged" {
				sawAck = true
			}
		case "mcp.tool.completed":
			if item.Tool == "ide_ui.open_file_panel" {
				sawTool = true
				if item.Args["content"] != redactedValue {
					t.Fatalf("flight recorder content arg = %#v, want redacted", item.Args["content"])
				}
			}
		}
	}
	if !sawRequested || !sawAck || !sawTool {
		t.Fatalf("flight recorder events requested=%v ack=%v tool=%v, want all true", sawRequested, sawAck, sawTool)
	}
	if diskPath, ok := resultMap["diskPath"].(string); !ok || strings.TrimSpace(diskPath) == "" {
		t.Fatalf("flight_recorder diskPath = %#v, want non-empty string", resultMap["diskPath"])
	} else {
		diskData, err := os.ReadFile(diskPath)
		if err != nil {
			t.Fatalf("ReadFile(flight recorder disk) error = %v", err)
		}
		diskText := string(diskData)
		if !strings.Contains(diskText, "mcp.tool.completed") {
			t.Fatalf("flight recorder disk log missing tool completion event: %s", diskText)
		}
		if strings.Contains(diskText, "SECRET_TOKEN=123") {
			t.Fatalf("flight recorder disk log contains unredacted secret: %s", diskText)
		}
	}
}

func TestToolService_FlightRecorderRecordsLiveApproval(t *testing.T) {
	root := t.TempDir()

	bridge := newFakeBridge()
	bridge.response["mcp.request_approval"] = map[string]any{
		"approved":    true,
		"ttl_seconds": 120,
	}

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_backend.terminal_create", map[string]any{
		"id":   "term-1",
		"name": "Terminal",
	}); err != nil {
		t.Fatalf("terminal_create error = %v", err)
	}

	result := service.FlightRecorder(20)
	items, ok := result["items"].([]FlightRecord)
	if !ok {
		t.Fatalf("FlightRecorder items type = %T, want []FlightRecord", result["items"])
	}

	var requested, resolved bool
	for _, item := range items {
		if item.Type == "approval.requested" && item.Tool == "ide_backend.terminal_create" {
			requested = true
		}
		if item.Type == "approval.resolved" && item.Tool == "ide_backend.terminal_create" && item.Status == "approved" {
			resolved = true
		}
	}
	if !requested || !resolved {
		t.Fatalf("approval recorder events requested=%v resolved=%v, want both true", requested, resolved)
	}
}

func TestToolService_ApplyLayoutProfileEmitsEventsImmediately(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "layout-code")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "layout-code",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.apply_layout_profile",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	result, err := service.CallTool("ide_ui.apply_layout_profile", map[string]any{"name": "terminal_focus"})
	if err != nil {
		t.Fatalf("apply_layout_profile error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("apply_layout_profile result type = %T, want map[string]any", result)
	}
	appliedActions, ok := resultMap["appliedActions"].(int)
	if !ok || appliedActions <= 0 {
		t.Fatalf("apply_layout_profile appliedActions = %v, want > 0", resultMap["appliedActions"])
	}

	eventCalls := bridge.methodCalls("ui.emit_event")
	if len(eventCalls) == 0 {
		t.Fatalf("apply_layout_profile should emit ui.emit_event bridge calls")
	}
}

func TestToolService_PreviewToolsEmitCanonicalWindowEvents(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "preview-code")
	readmePath, err := resolveProjectPath(root, "README.md")
	if err != nil {
		t.Fatalf("resolve README path: %v", err)
	}

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	tests := []struct {
		name        string
		toolName    string
		args        map[string]any
		wantEvent   string
		wantPayload map[string]any
	}{
		{
			name:     "open",
			toolName: "ide_ui.preview_open",
			args: map[string]any{
				"id":    "preview-test",
				"url":   "http://localhost:3000",
				"title": "Preview",
			},
			wantEvent: "ide:window:open",
			wantPayload: map[string]any{
				"id":      "preview-test",
				"surface": "browser",
				"title":   "Preview",
				"payload": map[string]any{"url": "http://localhost:3000"},
			},
		},
		{
			name:     "open file surface",
			toolName: "ide_ui.preview_open",
			args: map[string]any{
				"id":      "preview-file",
				"surface": "file",
				"path":    "README.md",
				"line":    12,
				"title":   "README preview",
			},
			wantEvent: "ide:window:open",
			wantPayload: map[string]any{
				"id":      "preview-file",
				"surface": "file",
				"title":   "README preview",
				"payload": map[string]any{"path": readmePath, "line": 12},
			},
		},
		{
			name:     "navigate",
			toolName: "ide_ui.preview_navigate",
			args: map[string]any{
				"id":  "preview-test",
				"url": "http://localhost:4000",
			},
			wantEvent: "ide:window:update",
			wantPayload: map[string]any{
				"id":      "preview-test",
				"payload": map[string]any{"url": "http://localhost:4000"},
			},
		},
		{
			name:      "focus",
			toolName:  "ide_ui.preview_focus",
			args:      map[string]any{"id": "preview-test"},
			wantEvent: "ide:window:focus",
			wantPayload: map[string]any{
				"id": "preview-test",
			},
		},
		{
			name:      "close",
			toolName:  "ide_ui.preview_close",
			args:      map[string]any{"id": "preview-test"},
			wantEvent: "ide:window:close",
			wantPayload: map[string]any{
				"id": "preview-test",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := service.CallTool("ide_control.request_permission", map[string]any{
				"approval_code": "preview-code",
				"ttl_seconds":   300,
				"tool_name":     tt.toolName,
			}); err != nil {
				t.Fatalf("request_permission error = %v", err)
			}

			before := len(bridge.methodCalls("ui.emit_event"))

			if _, err := service.CallTool(tt.toolName, tt.args); err != nil {
				t.Fatalf("CallTool(%q) error = %v", tt.toolName, err)
			}

			calls := bridge.methodCalls("ui.emit_event")
			if len(calls) != before+1 {
				t.Fatalf("ui.emit_event calls = %d, want %d", len(calls), before+1)
			}

			lastCall := calls[len(calls)-1]
			if got := lastCall.Params["event"]; got != tt.wantEvent {
				t.Fatalf("event = %v, want %q", got, tt.wantEvent)
			}

			payload, ok := lastCall.Params["payload"].(map[string]any)
			if !ok {
				t.Fatalf("payload type = %T, want map[string]any", lastCall.Params["payload"])
			}
			if !equalBridgePayload(payload, tt.wantPayload) {
				t.Fatalf("payload = %#v, want %#v", payload, tt.wantPayload)
			}
		})
	}
}

func TestToolService_PreviewOpenRejectsUnsafePathAndRawContentWithoutApproval(t *testing.T) {
	root := t.TempDir()
	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}
	defer service.Close()

	_, err = service.CallTool("ide_ui.preview_open", map[string]any{"path": "../outside.md"})
	if err == nil {
		t.Fatal("preview_open should reject outside-project path")
	}
	if !strings.Contains(err.Error(), "escapes project root") {
		t.Fatalf("preview_open path error = %v", err)
	}

	_, err = service.CallTool("ide_ui.preview_open", map[string]any{"content": "raw terminal dump"})
	if err == nil {
		t.Fatal("preview_open content should require user approval")
	}
	if !strings.Contains(err.Error(), "requires user approval") {
		t.Fatalf("preview_open content error = %v", err)
	}
}

func equalBridgePayload(got, want map[string]any) bool {
	if len(got) != len(want) {
		return false
	}
	for key, wantValue := range want {
		gotValue, ok := got[key]
		if !ok {
			return false
		}
		wantMap, wantIsMap := wantValue.(map[string]any)
		gotMap, gotIsMap := gotValue.(map[string]any)
		if wantIsMap || gotIsMap {
			if !wantIsMap || !gotIsMap || !equalBridgePayload(gotMap, wantMap) {
				return false
			}
			continue
		}
		if gotValue != wantValue {
			return false
		}
	}
	return true
}

func TestToolService_RegisterAndApplyCustomLayoutProfile(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "custom-layout")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "custom-layout",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.register_layout_profile",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	actions := []map[string]any{
		{
			"event":   "ide:panel:open",
			"payload": "terminal",
		},
		{
			"event":   "ide:editor:split",
			"payload": "horizontal",
		},
	}
	if _, err := service.CallTool("ide_ui.register_layout_profile", map[string]any{
		"name":    "custom-test",
		"actions": actions,
	}); err != nil {
		t.Fatalf("register_layout_profile error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "custom-layout",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.apply_layout_profile",
	}); err != nil {
		t.Fatalf("request_permission apply error = %v", err)
	}

	if _, err := service.CallTool("ide_ui.apply_layout_profile", map[string]any{"name": "custom-test"}); err != nil {
		t.Fatalf("apply_layout_profile(custom-test) error = %v", err)
	}

	eventCalls := bridge.methodCalls("ui.emit_event")
	if len(eventCalls) < 2 {
		t.Fatalf("ui.emit_event calls = %d, want at least 2", len(eventCalls))
	}

	payloads := make([]string, 0, len(eventCalls))
	for _, call := range eventCalls {
		encoded, _ := json.Marshal(call.Params)
		payloads = append(payloads, string(encoded))
	}
	joined := strings.Join(payloads, "\n")
	if !strings.Contains(joined, "ide:panel:open") || !strings.Contains(joined, "ide:editor:split") {
		t.Fatalf("ui.emit_event payloads do not contain expected events: %s", joined)
	}
}

func TestToolService_AuditDiskPathLivesInProjectRoot(t *testing.T) {
	root := t.TempDir()
	service, err := NewToolService(root)
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	result, err := service.CallTool("ide_control.audit_logs", map[string]any{"limit": 1})
	if err != nil {
		t.Fatalf("audit_logs error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("audit_logs result type = %T, want map[string]any", result)
	}
	diskPath, ok := resultMap["diskPath"].(string)
	if !ok {
		t.Fatalf("audit_logs diskPath type = %T, want string", resultMap["diskPath"])
	}

	rel, relErr := filepath.Rel(root, diskPath)
	if relErr != nil {
		t.Fatalf("filepath.Rel(root,diskPath) error = %v", relErr)
	}
	if strings.HasPrefix(rel, "..") {
		t.Fatalf("audit disk path %q must remain inside project root %q", diskPath, root)
	}
}

func TestToolService_CapabilitiesExposeBridgeModeAndProfiles(t *testing.T) {
	root := t.TempDir()
	bridge := newFakeBridge()

	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	result, err := service.CallTool("ide_control.capabilities", map[string]any{})
	if err != nil {
		t.Fatalf("capabilities error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("capabilities result type = %T, want map[string]any", result)
	}

	if resultMap["mode"] != "bridge" {
		t.Fatalf("capabilities mode = %v, want %q", resultMap["mode"], "bridge")
	}

	if resultMap["supportsUIControl"] != true {
		t.Fatalf("supportsUIControl = %v, want true", resultMap["supportsUIControl"])
	}
	if resultMap["supportsSurfaceRuntime"] != true {
		t.Fatalf("supportsSurfaceRuntime = %v, want true", resultMap["supportsSurfaceRuntime"])
	}
	if resultMap["memoryBackend"] != "mnemonic" {
		t.Fatalf("memoryBackend = %v, want mnemonic", resultMap["memoryBackend"])
	}
	if resultMap["mnemonicSharedContext"] != true {
		t.Fatalf("mnemonicSharedContext = %v, want true", resultMap["mnemonicSharedContext"])
	}

	layoutProfiles, ok := resultMap["layoutProfiles"].([]string)
	if !ok {
		t.Fatalf("layoutProfiles type = %T, want []string", resultMap["layoutProfiles"])
	}
	if len(layoutProfiles) == 0 {
		t.Fatalf("layoutProfiles should not be empty")
	}
}

func TestToolService_HotSwitchCreatesSnapshotAndReapplyWorks(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "hotswitch-code")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "hotswitch-code",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.hot_switch",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	actions := []map[string]any{
		{"event": "ide:panel:open", "payload": "terminal"},
		{"event": "ide:tui:assist:open"},
	}
	hotSwitchResult, err := service.CallTool("ide_ui.hot_switch", map[string]any{
		"actions": actions,
		"label":   "review-live",
	})
	if err != nil {
		t.Fatalf("hot_switch error = %v", err)
	}

	hotSwitchMap, ok := hotSwitchResult.(map[string]any)
	if !ok {
		t.Fatalf("hot_switch result type = %T, want map[string]any", hotSwitchResult)
	}
	snapshotAny, ok := hotSwitchMap["snapshot"]
	if !ok {
		t.Fatalf("hot_switch result missing snapshot")
	}

	snapshotMap, ok := snapshotAny.(LayoutSnapshot)
	if !ok {
		t.Fatalf("hot_switch snapshot type = %T, want LayoutSnapshot", snapshotAny)
	}

	listResult, err := service.CallTool("ide_ui.list_layout_snapshots", map[string]any{"limit": 5})
	if err != nil {
		t.Fatalf("list_layout_snapshots error = %v", err)
	}
	listMap, ok := listResult.(map[string]any)
	if !ok {
		t.Fatalf("list_layout_snapshots result type = %T, want map[string]any", listResult)
	}
	items, ok := listMap["items"].([]LayoutSnapshot)
	if !ok {
		t.Fatalf("list_layout_snapshots items type = %T, want []LayoutSnapshot", listMap["items"])
	}
	if len(items) == 0 {
		t.Fatalf("list_layout_snapshots should return at least one snapshot")
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "hotswitch-code",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.apply_layout_snapshot",
	}); err != nil {
		t.Fatalf("request_permission apply snapshot error = %v", err)
	}

	if _, err := service.CallTool("ide_ui.apply_layout_snapshot", map[string]any{"id": snapshotMap.ID}); err != nil {
		t.Fatalf("apply_layout_snapshot error = %v", err)
	}

	eventCalls := bridge.methodCalls("ui.emit_event")
	if len(eventCalls) < 4 {
		t.Fatalf("ui.emit_event calls = %d, want >= 4 after hot_switch + snapshot apply", len(eventCalls))
	}
}

func TestToolService_LayoutSnapshotsPersistAcrossServiceRecreation(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "layout-persist")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "layout-persist",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.hot_switch",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	result, err := service.CallTool("ide_ui.hot_switch", map[string]any{
		"actions": []map[string]any{{
			"event":   "ide:panel:open",
			"payload": "git",
		}},
		"label": "persisted-layout",
	})
	if err != nil {
		t.Fatalf("hot_switch error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("hot_switch result type = %T, want map[string]any", result)
	}
	snapshot, ok := resultMap["snapshot"].(LayoutSnapshot)
	if !ok {
		t.Fatalf("hot_switch snapshot type = %T, want LayoutSnapshot", resultMap["snapshot"])
	}

	reloaded, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions(reloaded) error = %v", err)
	}

	if _, err := reloaded.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "layout-persist",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.apply_layout_snapshot",
	}); err != nil {
		t.Fatalf("request_permission(reloaded) error = %v", err)
	}

	listResult, err := reloaded.CallTool("ide_ui.list_layout_snapshots", map[string]any{"limit": 10})
	if err != nil {
		t.Fatalf("list_layout_snapshots error = %v", err)
	}
	listMap, ok := listResult.(map[string]any)
	if !ok {
		t.Fatalf("list_layout_snapshots result type = %T, want map[string]any", listResult)
	}
	items, ok := listMap["items"].([]LayoutSnapshot)
	if !ok {
		t.Fatalf("list_layout_snapshots items type = %T, want []LayoutSnapshot", listMap["items"])
	}
	if len(items) == 0 || items[0].ID != snapshot.ID {
		t.Fatalf("list_layout_snapshots first item = %+v, want %q", items, snapshot.ID)
	}

	if _, err := reloaded.CallTool("ide_ui.apply_layout_snapshot", map[string]any{"id": snapshot.ID}); err != nil {
		t.Fatalf("apply_layout_snapshot(reloaded) error = %v", err)
	}
}

func TestToolService_TerminalCreateAcceptsCommand(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "terminal-command")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "terminal-command",
		"ttl_seconds":   300,
		"tool_name":     "ide_backend.terminal_create",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	if _, err := service.CallTool("ide_backend.terminal_create", map[string]any{
		"id":      "term-1",
		"name":    "Terminal",
		"command": "npm test",
	}); err != nil {
		t.Fatalf("terminal_create error = %v", err)
	}

	calls := bridge.methodCalls("terminal.create")
	if len(calls) != 1 {
		t.Fatalf("terminal.create calls = %d, want 1", len(calls))
	}
	if calls[0].Params["command"] != "npm test" {
		t.Fatalf("terminal.create command = %#v, want %q", calls[0].Params["command"], "npm test")
	}
}

func TestDefaultLayoutProfiles_TerminalFocusUsesNormalPanelOpenInTUI(t *testing.T) {
	profiles := defaultLayoutProfiles()
	var terminalFocus *LayoutProfile
	for index := range profiles {
		if profiles[index].Name == "terminal_focus" {
			terminalFocus = &profiles[index]
			break
		}
	}
	if terminalFocus == nil {
		t.Fatalf("terminal_focus profile not found")
	}
	if len(terminalFocus.Actions) != 3 {
		t.Fatalf("terminal_focus actions len = %d, want 3", len(terminalFocus.Actions))
	}
	if terminalFocus.Actions[0].Event != "ide:panel:open" {
		t.Fatalf("first action = %q, want ide:panel:open", terminalFocus.Actions[0].Event)
	}
	payload, ok := terminalFocus.Actions[0].Payload.(map[string]any)
	if !ok {
		t.Fatalf("first action payload type = %T, want map[string]any", terminalFocus.Actions[0].Payload)
	}
	if payload["panel"] != "terminal" || payload["position"] != "bottom" || payload["mode"] != "snapped" {
		t.Fatalf("terminal_focus panel payload = %#v, want terminal bottom snapped", payload)
	}
	if terminalFocus.Actions[2].Event != "ide:panel:open" {
		t.Fatalf("third action = %q, want ide:panel:open", terminalFocus.Actions[2].Event)
	}
	assistPayload, ok := terminalFocus.Actions[2].Payload.(map[string]any)
	if !ok {
		t.Fatalf("third action payload type = %T, want map[string]any", terminalFocus.Actions[2].Payload)
	}
	if assistPayload["panel"] != "explorer" || assistPayload["position"] != "right" || assistPayload["mode"] != "snapped" {
		t.Fatalf("third action payload = %#v, want explorer right snapped", assistPayload)
	}
}

func TestToolService_HotSwitchRejectsTooManyActions(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "too-many-actions")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "too-many-actions",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.hot_switch",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	actions := make([]map[string]any, 0, maxLayoutActions+1)
	for i := 0; i < maxLayoutActions+1; i++ {
		actions = append(actions, map[string]any{
			"event":   "ide:panel:open",
			"payload": "terminal",
		})
	}

	_, err = service.CallTool("ide_ui.hot_switch", map[string]any{
		"actions": actions,
		"label":   "oversized",
	})
	if err == nil {
		t.Fatalf("hot_switch should reject too many actions")
	}
	if !strings.Contains(err.Error(), "too many hot switch actions") {
		t.Fatalf("hot_switch error = %v, want contains %q", err, "too many hot switch actions")
	}
}

func TestToolService_UIRateLimitRejectsBurst(t *testing.T) {
	root := t.TempDir()
	t.Setenv("ARLECCHINO_MCP_APPROVAL_CODE", "ui-rate-limit")

	bridge := newFakeBridge()
	service, err := NewToolServiceWithOptions(root, ToolServiceOptions{Bridge: bridge})
	if err != nil {
		t.Fatalf("NewToolServiceWithOptions() error = %v", err)
	}

	if _, err := service.CallTool("ide_control.request_permission", map[string]any{
		"approval_code": "ui-rate-limit",
		"ttl_seconds":   300,
		"tool_name":     "ide_ui.hot_switch",
	}); err != nil {
		t.Fatalf("request_permission error = %v", err)
	}

	actions := make([]map[string]any, 0, maxLayoutActions)
	for i := 0; i < maxLayoutActions; i++ {
		actions = append(actions, map[string]any{
			"event":   "ide:panel:open",
			"payload": "terminal",
		})
	}

	for i := 0; i < 2; i++ {
		if _, err := service.CallTool("ide_ui.hot_switch", map[string]any{
			"actions": actions,
			"label":   "rate-check",
		}); err != nil {
			t.Fatalf("hot_switch call %d unexpected error = %v", i+1, err)
		}
	}

	_, err = service.CallTool("ide_ui.hot_switch", map[string]any{
		"actions": actions,
		"label":   "rate-overflow",
	})
	if err == nil {
		t.Fatalf("hot_switch should fail when ui rate limit exceeded")
	}
	if !strings.Contains(err.Error(), "rate limit") {
		t.Fatalf("hot_switch rate-limit error = %v, want contains %q", err, "rate limit")
	}
}
