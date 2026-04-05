package mcp

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	riskReadOnly     = "read-only"
	riskMutating     = "mutating"
	riskExternal     = "external-side-effect"
	riskSensitive    = "sensitive-access"
	riskBoundary     = "boundary-crossing"
	riskBridgeTool   = "bridge-control"
	redactedValue    = "<redacted>"
	defaultAuditLim  = 50
	maxUIEventsBurst = 50
	maxLayoutActions = 20
)

func bridgeBackendToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "ide_backend.project_open",
			Description: "Open project in live IDE backend",
			InputSchema: objectSchema([]string{"path"}, map[string]any{"path": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.project_close",
			Description: "Close current project in live IDE backend",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.project_status",
			Description: "Get current project status from live IDE backend",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.lsp_status",
			Description: "Get LSP runtime status",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.lsp_restart",
			Description: "Restart specific LSP server",
			InputSchema: objectSchema([]string{"language"}, map[string]any{"language": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.lsp_install",
			Description: "Install LSP server by id",
			InputSchema: objectSchema([]string{"server_id"}, map[string]any{"server_id": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.lsp_servers",
			Description: "List LSP servers metadata",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.lsp_definition",
			Description: "Go-to-definition using LSP",
			InputSchema: objectSchema([]string{"file_path", "content"}, map[string]any{
				"file_path": map[string]any{"type": "string"},
				"content":   map[string]any{"type": "string"},
				"line":      map[string]any{"type": "number"},
				"character": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_backend.lsp_hover",
			Description: "Get hover info using LSP",
			InputSchema: objectSchema([]string{"file_path", "content"}, map[string]any{
				"file_path": map[string]any{"type": "string"},
				"content":   map[string]any{"type": "string"},
				"line":      map[string]any{"type": "number"},
				"character": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_backend.lsp_signature",
			Description: "Get signature help using LSP",
			InputSchema: objectSchema([]string{"file_path", "content"}, map[string]any{
				"file_path": map[string]any{"type": "string"},
				"content":   map[string]any{"type": "string"},
				"line":      map[string]any{"type": "number"},
				"character": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_backend.terminal_create",
			Description: "Create terminal session in IDE",
			InputSchema: objectSchema([]string{"id"}, map[string]any{
				"id":      map[string]any{"type": "string"},
				"name":    map[string]any{"type": "string"},
				"command": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_backend.terminal_write",
			Description: "Write data to terminal session",
			InputSchema: objectSchema([]string{"id", "data"}, map[string]any{
				"id":   map[string]any{"type": "string"},
				"data": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_backend.terminal_resize",
			Description: "Resize terminal session",
			InputSchema: objectSchema([]string{"id"}, map[string]any{
				"id":   map[string]any{"type": "string"},
				"rows": map[string]any{"type": "number"},
				"cols": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_backend.terminal_close",
			Description: "Close terminal session",
			InputSchema: objectSchema([]string{"id"}, map[string]any{"id": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.terminal_close_all",
			Description: "Close all terminal sessions",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.dispatch_search_files",
			Description: "Search files using backend dispatcher",
			InputSchema: objectSchema([]string{"pattern"}, map[string]any{"pattern": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.dispatch_search_content",
			Description: "Search content using backend dispatcher",
			InputSchema: objectSchema([]string{"query"}, map[string]any{"query": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.dispatch_search_symbols",
			Description: "Search symbols using backend dispatcher",
			InputSchema: objectSchema([]string{"query"}, map[string]any{"query": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.dispatch_command",
			Description: "Run dispatcher command",
			InputSchema: objectSchema([]string{"input"}, map[string]any{"input": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.git_status",
			Description: "Get git status",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.git_diff",
			Description: "Get git diff",
			InputSchema: objectSchema(nil, map[string]any{
				"file_path": map[string]any{"type": "string"},
				"staged":    map[string]any{"type": "boolean"},
			}),
		},
		{
			Name:        "ide_backend.git_log",
			Description: "Get git log",
			InputSchema: objectSchema(nil, map[string]any{
				"limit":     map[string]any{"type": "number"},
				"file_path": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_backend.git_show",
			Description: "Get git show output",
			InputSchema: objectSchema([]string{"commit_hash"}, map[string]any{"commit_hash": map[string]any{"type": "string"}}),
		},
		{
			Name:        "ide_backend.git_branch",
			Description: "Get current git branch",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_backend.git_branches",
			Description: "Get list of git branches",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
	}
}

func bridgeUIToolDefinitions() []ToolDefinition {
	return []ToolDefinition{
		{
			Name:        "ide_ui.emit_event",
			Description: "Emit IDE UI runtime event instantly",
			InputSchema: objectSchema([]string{"event"}, map[string]any{
				"event":   map[string]any{"type": "string"},
				"payload": map[string]any{},
			}),
		},
		{
			Name:        "ide_ui.preview_open",
			Description: "Open IDE preview window via canonical preview flow",
			InputSchema: objectSchema(nil, map[string]any{
				"id":       map[string]any{"type": "string"},
				"surface":  map[string]any{"type": "string"},
				"url":      map[string]any{"type": "string"},
				"path":     map[string]any{"type": "string"},
				"content":  map[string]any{"type": "string"},
				"line":     map[string]any{"type": "number"},
				"language": map[string]any{"type": "string"},
				"html":     map[string]any{"type": "string"},
				"title":    map[string]any{"type": "string"},
				"mode":     map[string]any{"type": "string"},
				"position": map[string]any{"type": "string"},
				"side":     map[string]any{"type": "string"},
				"pinned":   map[string]any{"type": "boolean"},
			}),
		},
		{
			Name:        "ide_ui.preview_navigate",
			Description: "Navigate existing browser preview window to a new URL",
			InputSchema: objectSchema([]string{"id", "url"}, map[string]any{
				"id":    map[string]any{"type": "string"},
				"url":   map[string]any{"type": "string"},
				"title": map[string]any{"type": "string"},
				"focus": map[string]any{"type": "boolean"},
			}),
		},
		{
			Name:        "ide_ui.preview_focus",
			Description: "Focus existing browser preview window",
			InputSchema: objectSchema([]string{"id"}, map[string]any{
				"id": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_ui.preview_close",
			Description: "Close existing browser preview window",
			InputSchema: objectSchema([]string{"id"}, map[string]any{
				"id": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_ui.list_layout_profiles",
			Description: "List available layout profiles",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_ui.register_layout_profile",
			Description: "Register or update layout profile",
			InputSchema: objectSchema([]string{"name", "actions"}, map[string]any{
				"name":    map[string]any{"type": "string"},
				"actions": map[string]any{"type": "array"},
			}),
		},
		{
			Name:        "ide_ui.apply_layout_profile",
			Description: "Apply layout profile with hot-switch",
			InputSchema: objectSchema([]string{"name"}, map[string]any{
				"name": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_ui.hot_switch",
			Description: "Apply ad-hoc UI actions instantly",
			InputSchema: objectSchema([]string{"actions"}, map[string]any{
				"actions": map[string]any{"type": "array"},
				"label":   map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_ui.list_layout_snapshots",
			Description: "List recent layout hot-switch snapshots",
			InputSchema: objectSchema(nil, map[string]any{
				"limit": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_ui.apply_layout_snapshot",
			Description: "Reapply layout snapshot actions instantly",
			InputSchema: objectSchema([]string{"id"}, map[string]any{
				"id": map[string]any{"type": "string"},
			}),
		},
	}
}

func (s *ToolService) bridgeAvailable() bool {
	if s.bridge == nil {
		return false
	}
	return s.bridge.Available()
}

func (s *ToolService) modeName() string {
	if s.bridgeAvailable() {
		return "bridge"
	}
	return "standalone"
}

func (s *ToolService) AuditLogs(limit int) map[string]any {
	effectiveLimit := limit
	if effectiveLimit <= 0 {
		effectiveLimit = defaultAuditLim
	}

	entries := []AuditEntry{}
	diskPath := ""
	if s.audit != nil {
		entries = s.audit.list(effectiveLimit)
		diskPath = s.audit.diskFilePath()
	}

	return map[string]any{
		"items":    entries,
		"diskPath": diskPath,
		"mode":     s.modeName(),
	}
}

func (s *ToolService) Capabilities() map[string]any {
	toolNames := make([]string, 0, len(s.ToolDefinitions()))
	for _, definition := range s.ToolDefinitions() {
		toolNames = append(toolNames, definition.Name)
	}
	sort.Strings(toolNames)

	layoutNames := make([]string, 0)
	for _, profile := range s.layouts.list() {
		layoutNames = append(layoutNames, profile.Name)
	}
	sort.Strings(layoutNames)

	bridgeMode := ""
	bridgeAvailable := false
	if s.bridge != nil {
		bridgeMode = s.bridge.Mode()
		bridgeAvailable = s.bridge.Available()
	}

	return map[string]any{
		"mode":                s.modeName(),
		"tools":               toolNames,
		"permission":          s.PermissionStatus(),
		"layoutProfiles":      layoutNames,
		"bridgeMode":          bridgeMode,
		"bridgeAvailable":     bridgeAvailable,
		"sensitivePatterns":   append([]string(nil), s.sensitivePaths...),
		"auditDiskPath":       s.audit.diskFilePath(),
		"checkpointDiskPath":  projectStateFilePath(s.projectRoot, changeJournalStateFileName),
		"layoutDiskPath":      projectStateFilePath(s.projectRoot, layoutStateFileName),
		"memoryDiskPath":      s.memory.DiskFilePath(),
		"memoryContextPath":   s.memory.ContextFilePath(),
		"sessionID":           s.sessionID,
		"runtimeHotSwitch":    true,
		"supportsLayoutV1":    true,
		"supportsBackendV1":   true,
		"supportsUIControlV1": true,
		"supportsMemoryV1":    true,
	}
}

func (s *ToolService) recordAudit(toolName string, args map[string]any, err error, startedAt time.Time) {
	if s.audit == nil {
		return
	}

	status := "success"
	if err != nil {
		status = "error"
	}

	entry := newAuditEntry(
		toolName,
		s.riskClassForTool(toolName, args),
		status,
		s.modeName(),
		s.sanitizeAuditArgs(args),
		err,
		startedAt,
	)
	s.audit.append(entry)
}

func (s *ToolService) sanitizeAuditArgs(args map[string]any) map[string]any {
	if args == nil {
		return map[string]any{}
	}

	result := make(map[string]any, len(args))
	for key, value := range args {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		switch normalizedKey {
		case "approval_code", "content", "data":
			result[key] = redactedValue
			continue
		}

		switch typed := value.(type) {
		case string:
			cleaned := strings.NewReplacer("\n", "\\n", "\r", "\\r", "\t", "\\t").Replace(typed)
			if len(cleaned) > 256 {
				result[key] = cleaned[:256] + "..."
			} else {
				result[key] = cleaned
			}
		case []any:
			result[key] = fmt.Sprintf("array(len=%d)", len(typed))
		case []string:
			result[key] = fmt.Sprintf("array(len=%d)", len(typed))
		case map[string]any:
			result[key] = fmt.Sprintf("object(keys=%d)", len(typed))
		default:
			result[key] = value
		}
	}

	return result
}

func (s *ToolService) riskClassForTool(toolName string, args map[string]any) string {
	if strings.HasPrefix(toolName, "ide_backend.") {
		switch toolName {
		case "ide_backend.project_open":
			if pathValue, ok := args["path"].(string); ok && s.pathEscapesProjectRoot(pathValue) {
				return riskBoundary
			}
			return riskMutating
		case "ide_backend.project_close",
			"ide_backend.lsp_restart",
			"ide_backend.lsp_install",
			"ide_backend.terminal_create",
			"ide_backend.terminal_write",
			"ide_backend.terminal_resize",
			"ide_backend.terminal_close",
			"ide_backend.terminal_close_all",
			"ide_backend.dispatch_command":
			return riskExternal
		default:
			return riskBridgeTool
		}
	}

	if strings.HasPrefix(toolName, "ide_ui.") {
		return riskMutating
	}

	switch toolName {
	case "ide_control.write_file", "change_journal.rollback_checkpoint":
		return riskMutating
	case "ide_control.read_file", "change_journal.create_checkpoint":
		if pathValue, ok := args["path"].(string); ok && s.isSensitivePath(pathValue) {
			return riskSensitive
		}
		return riskReadOnly
	default:
		return riskReadOnly
	}
}

func (s *ToolService) bridgeCall(toolName, method string, params map[string]any) (any, error) {
	if !s.bridgeAvailable() {
		return nil, fmt.Errorf("%s requires live IDE bridge", toolName)
	}
	return s.bridge.Call(method, params)
}

func (s *ToolService) bridgeProjectOpen(path string) (any, error) {
	requestedPath := strings.TrimSpace(path)
	if requestedPath == "" {
		return nil, fmt.Errorf("path is empty")
	}

	forceApproval := s.pathEscapesProjectRoot(requestedPath)
	if err := s.requireToolApproval("ide_backend.project_open", forceApproval); err != nil {
		return nil, err
	}

	if err := s.requireToolApproval("ide_backend.project_open", forceApproval); err != nil {
		return nil, err
	}

	return s.bridgeCall("ide_backend.project_open", "project.open", map[string]any{"path": requestedPath})
}

func (s *ToolService) bridgeProjectClose() (any, error) {
	if err := s.requireUserApproval("ide_backend.project_close"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.project_close"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.project_close", "project.close", map[string]any{})
}

func (s *ToolService) bridgeProjectStatus() (any, error) {
	return s.bridgeCall("ide_backend.project_status", "project.status", map[string]any{})
}

func (s *ToolService) bridgeLSPStatus() (any, error) {
	return s.bridgeCall("ide_backend.lsp_status", "lsp.status", map[string]any{})
}

func (s *ToolService) bridgeLSPRestart(language string) (any, error) {
	if err := s.requireUserApproval("ide_backend.lsp_restart"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.lsp_restart"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.lsp_restart", "lsp.restart", map[string]any{"language": language})
}

func (s *ToolService) bridgeLSPInstall(serverID string) (any, error) {
	if err := s.requireUserApproval("ide_backend.lsp_install"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.lsp_install"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.lsp_install", "lsp.install", map[string]any{"server_id": serverID})
}

func (s *ToolService) bridgeLSPServers() (any, error) {
	return s.bridgeCall("ide_backend.lsp_servers", "lsp.servers", map[string]any{})
}

func (s *ToolService) bridgeLSPDefinition(filePath, content string, line, character int) (any, error) {
	resolvedPath, err := s.prepareBridgeFilePath("ide_backend.lsp_definition", filePath)
	if err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.lsp_definition", "lsp.definition", map[string]any{
		"file_path": resolvedPath,
		"content":   content,
		"line":      line,
		"character": character,
	})
}

func (s *ToolService) bridgeLSPHover(filePath, content string, line, character int) (any, error) {
	resolvedPath, err := s.prepareBridgeFilePath("ide_backend.lsp_hover", filePath)
	if err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.lsp_hover", "lsp.hover", map[string]any{
		"file_path": resolvedPath,
		"content":   content,
		"line":      line,
		"character": character,
	})
}

func (s *ToolService) bridgeLSPSignature(filePath, content string, line, character int) (any, error) {
	resolvedPath, err := s.prepareBridgeFilePath("ide_backend.lsp_signature", filePath)
	if err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.lsp_signature", "lsp.signature", map[string]any{
		"file_path": resolvedPath,
		"content":   content,
		"line":      line,
		"character": character,
	})
}

func (s *ToolService) bridgeTerminalCreate(id, name, command string) (any, error) {
	if err := s.requireUserApproval("ide_backend.terminal_create"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.terminal_create"); err != nil {
		return nil, err
	}
	params := map[string]any{"id": id, "name": name}
	if strings.TrimSpace(command) != "" {
		params["command"] = command
	}
	return s.bridgeCall("ide_backend.terminal_create", "terminal.create", params)
}

func (s *ToolService) bridgeTerminalWrite(id, data string) (any, error) {
	if err := s.requireUserApproval("ide_backend.terminal_write"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.terminal_write"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.terminal_write", "terminal.write", map[string]any{"id": id, "data": data})
}

func (s *ToolService) bridgeTerminalResize(id string, rows, cols int) (any, error) {
	if err := s.requireUserApproval("ide_backend.terminal_resize"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.terminal_resize"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.terminal_resize", "terminal.resize", map[string]any{"id": id, "rows": rows, "cols": cols})
}

func (s *ToolService) bridgeTerminalClose(id string) (any, error) {
	if err := s.requireUserApproval("ide_backend.terminal_close"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.terminal_close"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.terminal_close", "terminal.close", map[string]any{"id": id})
}

func (s *ToolService) bridgeTerminalCloseAll() (any, error) {
	if err := s.requireUserApproval("ide_backend.terminal_close_all"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.terminal_close_all"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.terminal_close_all", "terminal.close_all", map[string]any{})
}

func (s *ToolService) bridgeDispatchSearchFiles(pattern string) (any, error) {
	result, err := s.bridgeCall("ide_backend.dispatch_search_files", "dispatch.search_files", map[string]any{"pattern": pattern})
	if err != nil {
		return nil, err
	}
	return s.filterSensitiveBridgeResultItems(result), nil
}

func (s *ToolService) bridgeDispatchSearchContent(query string) (any, error) {
	result, err := s.bridgeCall("ide_backend.dispatch_search_content", "dispatch.search_content", map[string]any{"query": query})
	if err != nil {
		return nil, err
	}
	return s.filterSensitiveBridgeResultItems(result), nil
}

func (s *ToolService) bridgeDispatchSearchSymbols(query string) (any, error) {
	result, err := s.bridgeCall("ide_backend.dispatch_search_symbols", "dispatch.search_symbols", map[string]any{"query": query})
	if err != nil {
		return nil, err
	}
	return s.filterSensitiveBridgeResultItems(result), nil
}

func (s *ToolService) bridgeDispatchCommand(input string) (any, error) {
	if err := s.requireUserApproval("ide_backend.dispatch_command"); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_backend.dispatch_command"); err != nil {
		return nil, err
	}
	return s.bridgeCall("ide_backend.dispatch_command", "dispatch.command", map[string]any{"input": input})
}

func (s *ToolService) bridgeGitStatus() (any, error) {
	return s.bridgeCall("ide_backend.git_status", "git.status", map[string]any{})
}

func (s *ToolService) bridgeGitDiff(filePath string, staged bool) (any, error) {
	return s.bridgeCall("ide_backend.git_diff", "git.diff", map[string]any{"file_path": filePath, "staged": staged})
}

func (s *ToolService) bridgeGitLog(limit int, filePath string) (any, error) {
	return s.bridgeCall("ide_backend.git_log", "git.log", map[string]any{"limit": limit, "file_path": filePath})
}

func (s *ToolService) bridgeGitShow(commitHash string) (any, error) {
	return s.bridgeCall("ide_backend.git_show", "git.show", map[string]any{"commit_hash": commitHash})
}

func (s *ToolService) bridgeGitBranch() (any, error) {
	return s.bridgeCall("ide_backend.git_branch", "git.branch", map[string]any{})
}

func (s *ToolService) bridgeGitBranches() (any, error) {
	return s.bridgeCall("ide_backend.git_branches", "git.branches", map[string]any{})
}

func (s *ToolService) bridgeEmitUIEvent(eventName string, payload any) (any, error) {
	if err := s.requireUserApproval("ide_ui.emit_event"); err != nil {
		return nil, err
	}
	if err := s.allowUIEventBurst(1); err != nil {
		return nil, err
	}
	if err := s.requireUserApproval("ide_ui.emit_event"); err != nil {
		return nil, err
	}

	params := map[string]any{"event": eventName}
	if payload != nil {
		params["payload"] = payload
	}
	return s.bridgeCall("ide_ui.emit_event", "ui.emit_event", params)
}

func (s *ToolService) bridgePreviewOpen(args map[string]any) (any, error) {
	surface := optionalStringArg(args, "surface")
	if surface == "" {
		surface = "browser"
	}
	payload := map[string]any{"surface": surface}
	if id := optionalStringArg(args, "id"); id != "" {
		payload["id"] = id
	}
	if title := optionalStringArg(args, "title"); title != "" {
		payload["title"] = title
	}
	if mode := optionalStringArg(args, "mode"); mode == "floating" || mode == "snapped" {
		payload["mode"] = mode
	}
	if position := optionalStringArg(args, "position"); position == "left" || position == "right" || position == "top" || position == "bottom" {
		payload["position"] = position
	}
	if side := optionalStringArg(args, "side"); side == "left" || side == "right" {
		payload["side"] = side
	}
	if pinned, ok := args["pinned"].(bool); ok {
		payload["pinned"] = pinned
	}
	nestedPayload := map[string]any{}
	if url := optionalStringArg(args, "url"); url != "" {
		nestedPayload["url"] = url
	}
	if path := optionalStringArg(args, "path"); path != "" {
		nestedPayload["path"] = path
	}
	if content := optionalStringArg(args, "content"); content != "" {
		nestedPayload["content"] = content
	}
	if language := optionalStringArg(args, "language"); language != "" {
		nestedPayload["language"] = language
	}
	if html := optionalStringArg(args, "html"); html != "" {
		nestedPayload["htmlContent"] = html
	}
	if line, ok := optionalNumericArg(args, "line"); ok {
		nestedPayload["line"] = line
	}
	if len(nestedPayload) > 0 {
		payload["payload"] = nestedPayload
	}
	return s.bridgeEmitUIEvent("ide:window:open", payload)
}

func optionalNumericArg(args map[string]any, key string) (int, bool) {
	value, ok := args[key]
	if !ok {
		return 0, false
	}

	switch typed := value.(type) {
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case float32:
		return int(typed), true
	default:
		return 0, false
	}
}

func (s *ToolService) bridgePreviewNavigate(id, url string, title string, focus bool) (any, error) {
	payload := map[string]any{
		"id":      id,
		"payload": map[string]any{"url": url},
	}
	if title != "" {
		payload["title"] = title
	}
	if focus {
		payload["focus"] = true
	}
	return s.bridgeEmitUIEvent("ide:window:update", payload)
}

func (s *ToolService) bridgePreviewFocus(id string) (any, error) {
	return s.bridgeEmitUIEvent("ide:window:focus", map[string]any{"id": id})
}

func (s *ToolService) bridgePreviewClose(id string) (any, error) {
	return s.bridgeEmitUIEvent("ide:window:close", map[string]any{"id": id})
}

func (s *ToolService) listLayoutProfiles() map[string]any {
	return map[string]any{
		"items": s.layouts.list(),
	}
}

func (s *ToolService) registerLayoutProfile(name string, actions []LayoutAction) (any, error) {
	if err := s.requireUserApproval("ide_ui.register_layout_profile"); err != nil {
		return nil, err
	}

	if len(actions) > maxLayoutActions {
		return nil, fmt.Errorf("too many layout actions: max %d", maxLayoutActions)
	}

	profile, err := s.layouts.upsert(name, actions)
	if err != nil {
		return nil, err
	}
	if err := s.persistLayouts(); err != nil {
		return nil, err
	}

	return map[string]any{"profile": profile}, nil
}

func (s *ToolService) applyLayoutProfile(name string) (any, error) {
	if err := s.requireUserApproval("ide_ui.apply_layout_profile"); err != nil {
		return nil, err
	}

	profile, ok := s.layouts.get(name)
	if !ok {
		return nil, fmt.Errorf("layout profile not found: %s", name)
	}
	if len(profile.Actions) > maxLayoutActions {
		return nil, fmt.Errorf("layout profile has too many actions: max %d", maxLayoutActions)
	}
	if err := s.allowUIEventBurst(len(profile.Actions)); err != nil {
		return nil, err
	}

	appliedActions := 0
	for _, action := range profile.Actions {
		if err := s.requireUserApproval("ide_ui.apply_layout_profile"); err != nil {
			return nil, err
		}
		_, err := s.bridgeCall("ide_ui.apply_layout_profile", "ui.emit_event", map[string]any{
			"event":   action.Event,
			"payload": action.Payload,
			"source":  "layout-profile",
			"profile": profile.Name,
		})
		if err != nil {
			return nil, err
		}
		appliedActions++
	}

	snapshot := s.layouts.createSnapshot(profile.Name, "layout-profile", profile.Actions)
	if err := s.persistLayouts(); err != nil {
		return nil, err
	}

	return map[string]any{
		"profile":        profile.Name,
		"version":        profile.Version,
		"appliedActions": appliedActions,
		"snapshot":       snapshot,
		"hotSwitch":      true,
	}, nil
}

func (s *ToolService) applyHotSwitch(actions []LayoutAction, label string) (any, error) {
	if err := s.requireUserApproval("ide_ui.hot_switch"); err != nil {
		return nil, err
	}

	if len(actions) == 0 {
		return nil, fmt.Errorf("hot switch actions are empty")
	}
	if len(actions) > maxLayoutActions {
		return nil, fmt.Errorf("too many hot switch actions: max %d", maxLayoutActions)
	}
	if err := s.allowUIEventBurst(len(actions)); err != nil {
		return nil, err
	}

	appliedActions := 0
	for _, action := range actions {
		if err := s.requireUserApproval("ide_ui.hot_switch"); err != nil {
			return nil, err
		}
		_, err := s.bridgeCall("ide_ui.hot_switch", "ui.emit_event", map[string]any{
			"event":   action.Event,
			"payload": action.Payload,
			"source":  "hot-switch",
			"label":   strings.TrimSpace(label),
		})
		if err != nil {
			return nil, err
		}
		appliedActions++
	}

	snapshot := s.layouts.createSnapshot(label, "hot-switch", actions)
	if err := s.persistLayouts(); err != nil {
		return nil, err
	}

	return map[string]any{
		"label":          strings.TrimSpace(label),
		"appliedActions": appliedActions,
		"snapshot":       snapshot,
		"hotSwitch":      true,
	}, nil
}

func (s *ToolService) listLayoutSnapshots(limit int) map[string]any {
	return map[string]any{
		"items": s.layouts.listSnapshots(limit),
	}
}

func (s *ToolService) applyLayoutSnapshot(snapshotID string) (any, error) {
	if err := s.requireUserApproval("ide_ui.apply_layout_snapshot"); err != nil {
		return nil, err
	}

	snapshot, ok := s.layouts.getSnapshot(snapshotID)
	if !ok {
		return nil, fmt.Errorf("layout snapshot not found: %s", snapshotID)
	}
	if len(snapshot.Actions) > maxLayoutActions {
		return nil, fmt.Errorf("layout snapshot has too many actions: max %d", maxLayoutActions)
	}
	if err := s.allowUIEventBurst(len(snapshot.Actions)); err != nil {
		return nil, err
	}

	appliedActions := 0
	for _, action := range snapshot.Actions {
		if err := s.requireUserApproval("ide_ui.apply_layout_snapshot"); err != nil {
			return nil, err
		}
		_, err := s.bridgeCall("ide_ui.apply_layout_snapshot", "ui.emit_event", map[string]any{
			"event":    action.Event,
			"payload":  action.Payload,
			"source":   "layout-snapshot",
			"snapshot": snapshot.ID,
		})
		if err != nil {
			return nil, err
		}
		appliedActions++
	}

	reapplied := s.layouts.createSnapshot(snapshot.Label, "layout-snapshot-reapply", snapshot.Actions)
	if err := s.persistLayouts(); err != nil {
		return nil, err
	}

	return map[string]any{
		"snapshot":       reapplied,
		"appliedActions": appliedActions,
		"hotSwitch":      true,
	}, nil
}

func (s *ToolService) prepareBridgeFilePath(toolName, filePath string) (string, error) {
	resolvedPath, err := resolveProjectPath(s.projectRoot, filePath)
	if err != nil {
		return "", err
	}
	relPath := toRelativePath(s.projectRoot, resolvedPath)
	if err := s.requireSensitiveFileApproval(toolName, relPath); err != nil {
		return "", err
	}
	return resolvedPath, nil
}

func (s *ToolService) pathEscapesProjectRoot(path string) bool {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return false
	}

	candidate := trimmed
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(s.projectRoot, candidate)
	}

	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return true
	}

	return !isPathWithinRoot(s.projectRoot, absCandidate)
}

func (s *ToolService) filterSensitiveBridgeResultItems(result any) any {
	if s.hasSensitiveAccessGrant() {
		return result
	}

	switch typed := result.(type) {
	case []any:
		filtered := make([]any, 0, len(typed))
		for _, item := range typed {
			itemMap, ok := item.(map[string]any)
			if !ok {
				filtered = append(filtered, item)
				continue
			}

			if s.isSensitiveResultPath(bridgeResultPath(itemMap)) {
				continue
			}

			filtered = append(filtered, item)
		}
		return filtered
	case map[string]any:
		if items, ok := typed["items"]; ok {
			typed["items"] = s.filterSensitiveBridgeResultItems(items)
		}
		return typed
	default:
		return result
	}
}

func bridgeResultPath(item map[string]any) string {
	if filePathValue, ok := item["filePath"]; ok {
		if filePath, ok := filePathValue.(string); ok {
			return strings.TrimSpace(filePath)
		}
	}

	if subtitleValue, ok := item["subtitle"]; ok {
		if subtitle, ok := subtitleValue.(string); ok {
			return strings.TrimSpace(subtitle)
		}
	}

	return ""
}

func (s *ToolService) allowUIEventBurst(requested int) error {
	if requested <= 0 {
		return nil
	}

	s.uiRateMu.Lock()
	defer s.uiRateMu.Unlock()

	now := time.Now().UTC()
	if s.uiRateWindow.IsZero() || now.Sub(s.uiRateWindow) >= time.Second {
		s.uiRateWindow = now
		s.uiRateCount = 0
	}

	if requested > maxUIEventsBurst {
		return fmt.Errorf("requested ui events exceed max burst %d", maxUIEventsBurst)
	}

	if s.uiRateCount+requested > maxUIEventsBurst {
		return fmt.Errorf("ui event rate limit exceeded")
	}

	s.uiRateCount += requested
	return nil
}
