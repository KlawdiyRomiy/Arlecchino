package main

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"arlecchino/internal/mcp"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const bridgeMaxStringSliceItems = 100

func (a *App) startMCPBridge() {
	if a == nil {
		return
	}

	if a.mcpBridgeServer != nil {
		return
	}

	server, err := mcp.NewIDEBridgeServer(a.handleMCPBridgeCall)
	if err != nil {
		fmt.Printf("[MCP Bridge] init failed: %v\n", err)
		return
	}

	if err := server.Start(); err != nil {
		fmt.Printf("[MCP Bridge] start failed: %v\n", err)
		return
	}

	a.mcpBridgeServer = server
	fmt.Printf("[MCP Bridge] listening on %s\n", server.SocketPath())
}

func (a *App) stopMCPBridge() {
	if a == nil || a.mcpBridgeServer == nil {
		return
	}

	if err := a.mcpBridgeServer.Stop(); err != nil {
		fmt.Printf("[MCP Bridge] stop failed: %v\n", err)
	}

	a.mcpBridgeServer = nil
}

func (a *App) handleMCPBridgeCall(method string, params map[string]any) (any, error) {
	a.mcpBridgeMu.Lock()
	defer a.mcpBridgeMu.Unlock()

	if params == nil {
		params = map[string]any{}
	}

	switch strings.TrimSpace(method) {
	case "project.open":
		path, err := bridgeRequiredString(params, "path")
		if err != nil {
			return nil, err
		}
		if err := a.OpenProject(path); err != nil {
			return nil, err
		}
		return map[string]any{"opened": true, "path": path}, nil
	case "project.close":
		if err := a.closeProject(false); err != nil {
			return nil, err
		}
		return map[string]any{"closed": true}, nil
	case "project.status":
		projectPath := a.GetCurrentProjectPath()
		return map[string]any{
			"projectPath": projectPath,
			"workDir":     a.GetCurrentWorkDir(),
			"projectID":   a.GetCurrentProjectID(),
			"isOpen":      strings.TrimSpace(projectPath) != "",
		}, nil
	case "lsp.status":
		return a.GetLSPStatus(), nil
	case "lsp.restart":
		language, err := bridgeRequiredString(params, "language")
		if err != nil {
			return nil, err
		}
		restarted, err := a.RestartLSPServer(language)
		if err != nil {
			return nil, err
		}
		return map[string]any{"language": language, "restarted": restarted}, nil
	case "lsp.install":
		serverID, err := bridgeRequiredString(params, "server_id")
		if err != nil {
			return nil, err
		}
		if err := a.InstallLSPServer(serverID); err != nil {
			return nil, err
		}
		return map[string]any{"serverID": serverID, "started": true}, nil
	case "lsp.servers":
		return a.GetAllLSPServers(), nil
	case "lsp.definition":
		filePath, err := bridgeRequiredString(params, "file_path")
		if err != nil {
			return nil, err
		}
		content, err := bridgeRequiredString(params, "content")
		if err != nil {
			return nil, err
		}
		line := bridgeOptionalInt(params, "line", 0)
		character := bridgeOptionalInt(params, "character", 0)
		return a.LSPGoToDefinition(filePath, content, line, character)
	case "lsp.hover":
		filePath, err := bridgeRequiredString(params, "file_path")
		if err != nil {
			return nil, err
		}
		content, err := bridgeRequiredString(params, "content")
		if err != nil {
			return nil, err
		}
		line := bridgeOptionalInt(params, "line", 0)
		character := bridgeOptionalInt(params, "character", 0)
		hover, err := a.LSPHover(filePath, content, line, character)
		if err != nil {
			return nil, err
		}
		trimmed := strings.TrimSpace(hover)
		return map[string]any{
			"hover":      hover,
			"hasContent": trimmed != "",
			"emptyReason": func() string {
				if trimmed == "" {
					return "no symbol hover at requested position"
				}
				return ""
			}(),
		}, nil
	case "lsp.signature":
		filePath, err := bridgeRequiredString(params, "file_path")
		if err != nil {
			return nil, err
		}
		content, err := bridgeRequiredString(params, "content")
		if err != nil {
			return nil, err
		}
		line := bridgeOptionalInt(params, "line", 0)
		character := bridgeOptionalInt(params, "character", 0)
		return a.LSPSignatureHelp(filePath, content, line, character)
	case "terminal.create":
		id, err := bridgeRequiredString(params, "id")
		if err != nil {
			return nil, err
		}
		name := bridgeOptionalString(params, "name")
		if strings.TrimSpace(name) == "" {
			name = "Terminal"
		}
		command := bridgeOptionalString(params, "command")
		if err := a.CreateTerminal(id, name); err != nil {
			return nil, err
		}
		if command != "" {
			if err := a.WriteTerminal(id, command+"\n"); err != nil {
				return nil, err
			}
		}
		runtime.EventsEmit(a.ctx, "ide:panel:open", map[string]any{
			"panel":    "terminal",
			"focus":    true,
			"position": "bottom",
			"mode":     "snapped",
		})
		return map[string]any{"id": id, "created": true, "commandWritten": command != ""}, nil
	case "terminal.write":
		id, err := bridgeRequiredString(params, "id")
		if err != nil {
			return nil, err
		}
		data, err := bridgeRequiredString(params, "data")
		if err != nil {
			return nil, err
		}
		if err := a.WriteTerminal(id, data); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "written": true}, nil
	case "terminal.resize":
		id, err := bridgeRequiredString(params, "id")
		if err != nil {
			return nil, err
		}
		rows := bridgeOptionalInt(params, "rows", 24)
		cols := bridgeOptionalInt(params, "cols", 80)
		if err := a.ResizeTerminal(id, rows, cols); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "rows": rows, "cols": cols}, nil
	case "terminal.close":
		id, err := bridgeRequiredString(params, "id")
		if err != nil {
			return nil, err
		}
		if err := a.CloseTerminal(id); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "closed": true}, nil
	case "terminal.close_all":
		a.CloseAllTerminals()
		return map[string]any{"closed": true}, nil
	case "dispatch.search_files":
		pattern, err := bridgeRequiredString(params, "pattern")
		if err != nil {
			return nil, err
		}
		return a.SearchFiles(pattern), nil
	case "dispatch.search_content":
		query, err := bridgeRequiredString(params, "query")
		if err != nil {
			return nil, err
		}
		return a.SearchContent(query), nil
	case "dispatch.search_symbols":
		query, err := bridgeRequiredString(params, "query")
		if err != nil {
			return nil, err
		}
		return a.SearchSymbols(query), nil
	case "dispatch.command":
		input, err := bridgeRequiredString(params, "input")
		if err != nil {
			return nil, err
		}
		return a.DispatchCommand(input), nil
	case "git.status":
		status, err := a.GetGitStatus()
		if err != nil {
			return nil, err
		}
		return map[string]any{"status": status}, nil
	case "git.diff":
		filePath := bridgeOptionalString(params, "file_path")
		staged := bridgeOptionalBool(params, "staged", false)
		diff, err := a.GetGitDiff(filePath, staged)
		if err != nil {
			return nil, err
		}
		return map[string]any{"diff": diff}, nil
	case "git.log":
		limit := bridgeOptionalInt(params, "limit", 50)
		filePath := bridgeOptionalString(params, "file_path")
		items, err := a.GetGitLog(limit, filePath)
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": items}, nil
	case "git.show":
		commitHash, err := bridgeRequiredString(params, "commit_hash")
		if err != nil {
			return nil, err
		}
		body, err := a.GetGitShow(commitHash)
		if err != nil {
			return nil, err
		}
		return map[string]any{"output": body}, nil
	case "git.branch":
		branch, err := a.GetGitBranch()
		if err != nil {
			return nil, err
		}
		return map[string]any{"branch": branch}, nil
	case "git.branches":
		branches, err := a.GetGitBranches()
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": branches}, nil
	case "ui.emit_event":
		eventName, err := bridgeRequiredString(params, "event")
		if err != nil {
			return nil, err
		}
		if !bridgeEventAllowed(eventName) {
			return nil, fmt.Errorf("event is not allowed: %s", eventName)
		}

		payload, hasPayload := params["payload"]
		if hasPayload {
			runtime.EventsEmit(a.ctx, eventName, payload)
		} else {
			runtime.EventsEmit(a.ctx, eventName)
		}

		return map[string]any{
			"emitted":   true,
			"event":     eventName,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		}, nil
	default:
		return nil, fmt.Errorf("unknown bridge method: %s", method)
	}
}

func bridgeRequiredString(params map[string]any, key string) (string, error) {
	value, ok := params[key]
	if !ok {
		return "", fmt.Errorf("%s is required", key)
	}

	result, ok := value.(string)
	if !ok || strings.TrimSpace(result) == "" {
		return "", fmt.Errorf("%s must be non-empty string", key)
	}

	return strings.TrimSpace(result), nil
}

func bridgeOptionalString(params map[string]any, key string) string {
	value, ok := params[key]
	if !ok {
		return ""
	}

	text, ok := value.(string)
	if !ok {
		return ""
	}

	return strings.TrimSpace(text)
}

func bridgeOptionalInt(params map[string]any, key string, defaultValue int) int {
	value, ok := params[key]
	if !ok {
		return defaultValue
	}

	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case uint:
		return int(typed)
	case uint8:
		return int(typed)
	case uint16:
		return int(typed)
	case uint32:
		return int(typed)
	case uint64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}

	return defaultValue
}

func bridgeOptionalBool(params map[string]any, key string, defaultValue bool) bool {
	value, ok := params[key]
	if !ok {
		return defaultValue
	}

	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		switch normalized {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}

	return defaultValue
}

func bridgeRequiredStringSlice(params map[string]any, key string) ([]string, error) {
	value, ok := params[key]
	if !ok {
		return nil, fmt.Errorf("missing required parameter: %s", key)
	}

	switch typed := value.(type) {
	case []string:
		normalized := make([]string, 0, len(typed))
		for _, item := range typed {
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				normalized = append(normalized, trimmed)
			}
		}
		if len(normalized) > bridgeMaxStringSliceItems {
			return nil, fmt.Errorf("parameter %s exceeds max items (%d)", key, bridgeMaxStringSliceItems)
		}
		return normalized, nil
	case []any:
		normalized := make([]string, 0, len(typed))
		for index, raw := range typed {
			item, ok := raw.(string)
			if !ok {
				return nil, fmt.Errorf("parameter %s item %d must be a string", key, index)
			}
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				normalized = append(normalized, trimmed)
			}
		}
		if len(normalized) > bridgeMaxStringSliceItems {
			return nil, fmt.Errorf("parameter %s exceeds max items (%d)", key, bridgeMaxStringSliceItems)
		}
		return normalized, nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return []string{}, nil
		}
		return []string{trimmed}, nil
	default:
		return nil, fmt.Errorf("parameter %s must be an array of strings", key)
	}
}

func bridgeEventAllowed(eventName string) bool {
	normalized := strings.TrimSpace(eventName)
	if normalized == "" {
		return false
	}
	if !strings.HasPrefix(normalized, "ide:") {
		return false
	}
	return true
}
