package mcp

import (
	"arlecchino/internal/dispatcher"
	"crypto/subtle"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultJournalCapacity    = 512
	defaultApprovalTTLSeconds = 300
	maxApprovalTTLSeconds     = 3600
	envMCPRequireApproval     = "ARLECCHINO_MCP_REQUIRE_APPROVAL"
	envMCPApprovalCode        = "ARLECCHINO_MCP_APPROVAL_CODE"
)

var defaultSensitivePathPatterns = []string{
	".env",
	".env.*",
	"*/.env",
	"*/.env.*",
	"*/.env/*",
	"*/.ssh/*",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"*.crt",
	"*.cer",
	"*.der",
	"id_rsa",
	"id_ed25519",
	"*credentials*.json",
	"*secret*.json",
	"*credentials*",
	"*secret*",
}

type ToolService struct {
	projectRoot      string
	search           *dispatcher.SearchEngine
	journal          *changeJournal
	bridge           IDEBridge
	audit            *auditLogger
	layouts          *layoutRegistry
	memory           *agentMemoryStore
	sessionID        string
	approvalRequired bool
	approvalCode     string
	approvalExpires  time.Time
	approvalMu       sync.RWMutex
	sensitivePaths   []string
	uiRateMu         sync.Mutex
	uiRateWindow     time.Time
	uiRateCount      int
}

type FileReadResult struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type FileWriteResult struct {
	Path         string `json:"path"`
	BytesWritten int    `json:"bytesWritten"`
	CheckpointID string `json:"checkpointId"`
}

type Checkpoint struct {
	ID        string    `json:"id"`
	Path      string    `json:"path"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"createdAt"`
	Existed   bool      `json:"existed"`
}

type ToolDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type PermissionStatus struct {
	Required         bool   `json:"required"`
	Granted          bool   `json:"granted"`
	ExpiresAt        string `json:"expiresAt,omitempty"`
	RemainingSeconds int    `json:"remainingSeconds,omitempty"`
}

type checkpointRecord struct {
	meta       Checkpoint
	absPath    string
	beforeData []byte
}

type changeJournal struct {
	mu       sync.RWMutex
	records  map[string]checkpointRecord
	order    []string
	counter  uint64
	capacity int
}

func NewToolService(projectRoot string) (*ToolService, error) {
	return NewToolServiceWithOptions(projectRoot, ToolServiceOptions{})
}

func NewToolServiceWithOptions(projectRoot string, options ToolServiceOptions) (*ToolService, error) {
	trimmedRoot := strings.TrimSpace(projectRoot)
	if trimmedRoot == "" {
		return nil, fmt.Errorf("project root is empty")
	}

	absRoot, err := filepath.Abs(trimmedRoot)
	if err != nil {
		return nil, err
	}

	info, statErr := os.Stat(absRoot)
	if statErr != nil {
		return nil, statErr
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("project root is not a directory")
	}

	bridge := options.Bridge
	if bridge == nil && options.EnableBridgeAutoDetect {
		candidate := NewSocketIDEBridgeClient(options.BridgeMetadataPath)
		if candidate.Available() {
			bridge = candidate
		}
	}

	audit, err := newAuditLogger(absRoot, options.AuditLogPath, options.AuditMemoryLimit)
	if err != nil {
		return nil, err
	}

	journal, err := loadChangeJournal(absRoot, defaultJournalCapacity)
	if err != nil {
		return nil, err
	}

	layouts, err := loadLayoutRegistry(absRoot)
	if err != nil {
		return nil, err
	}

	memory, err := loadAgentMemoryStore(absRoot, defaultAgentMemoryLimit)
	if err != nil {
		return nil, err
	}

	return &ToolService{
		projectRoot:      absRoot,
		search:           dispatcher.NewSearchEngine(absRoot),
		journal:          journal,
		bridge:           bridge,
		audit:            audit,
		layouts:          layouts,
		memory:           memory,
		sessionID:        fmt.Sprintf("sess-%d", time.Now().UTC().UnixMilli()),
		approvalRequired: parseBooleanEnvDefaultTrue(os.Getenv(envMCPRequireApproval)),
		approvalCode:     strings.TrimSpace(os.Getenv(envMCPApprovalCode)),
		sensitivePaths:   append([]string(nil), defaultSensitivePathPatterns...),
	}, nil
}

func (s *ToolService) ToolDefinitions() []ToolDefinition {
	definitions := []ToolDefinition{
		{
			Name:        "ide_control.read_file",
			Description: "Read a file from project root",
			InputSchema: objectSchema([]string{"path"}, map[string]any{
				"path": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_control.write_file",
			Description: "Write file and create rollback checkpoint",
			InputSchema: objectSchema([]string{"path", "content"}, map[string]any{
				"path":             map[string]any{"type": "string"},
				"content":          map[string]any{"type": "string"},
				"checkpoint_label": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_control.search_files",
			Description: "Search files in project",
			InputSchema: objectSchema([]string{"pattern"}, map[string]any{
				"pattern": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_control.search_content",
			Description: "Search text content in project files",
			InputSchema: objectSchema([]string{"query"}, map[string]any{
				"query":          map[string]any{"type": "string"},
				"case_sensitive": map[string]any{"type": "boolean"},
			}),
		},
		{
			Name:        "ide_control.permission_status",
			Description: "Get current IDE control permission status",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "ide_control.request_permission",
			Description: "Request time-limited IDE control permission. If approval code is configured, provide it; otherwise this opens a live IDE approval prompt.",
			InputSchema: objectSchema(nil, map[string]any{
				"approval_code": map[string]any{"type": "string"},
				"ttl_seconds":   map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_control.audit_logs",
			Description: "Read in-memory and disk audit logs",
			InputSchema: objectSchema(nil, map[string]any{
				"limit": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "ide_control.capabilities",
			Description: "Get MCP capabilities, mode, policies, and tool list",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "change_journal.create_checkpoint",
			Description: "Create checkpoint for a file before manual edits",
			InputSchema: objectSchema([]string{"path"}, map[string]any{
				"path":  map[string]any{"type": "string"},
				"label": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "change_journal.list_checkpoints",
			Description: "List available checkpoints",
			InputSchema: objectSchema(nil, map[string]any{
				"path":  map[string]any{"type": "string"},
				"limit": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "change_journal.rollback_checkpoint",
			Description: "Rollback file content to checkpoint state",
			InputSchema: objectSchema([]string{"id"}, map[string]any{
				"id": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "agent_memory.save",
			Description: "Save project-local agent memory entry",
			InputSchema: objectSchema([]string{"content"}, map[string]any{
				"content":    map[string]any{"type": "string"},
				"type":       map[string]any{"type": "string"},
				"tags":       map[string]any{"type": "array"},
				"importance": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "agent_memory.search",
			Description: "Search project-local agent memory",
			InputSchema: objectSchema(nil, map[string]any{
				"query": map[string]any{"type": "string"},
				"tags":  map[string]any{"type": "array"},
				"limit": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "agent_memory.list",
			Description: "List recent project-local agent memory entries",
			InputSchema: objectSchema(nil, map[string]any{
				"limit": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "agent_memory.context",
			Description: "Get compact project-local memory context summary",
			InputSchema: objectSchema(nil, map[string]any{
				"max_chars": map[string]any{"type": "number"},
			}),
		},
	}

	definitions = append(definitions, bridgeBackendToolDefinitions()...)
	definitions = append(definitions, bridgeUIToolDefinitions()...)

	return definitions
}

func (s *ToolService) ReadFile(path string) (FileReadResult, error) {
	absPath, err := resolveProjectPath(s.projectRoot, path)
	if err != nil {
		return FileReadResult{}, err
	}

	relPath := toRelativePath(s.projectRoot, absPath)
	if err := s.requireSensitiveFileApproval("ide_control.read_file", relPath); err != nil {
		return FileReadResult{}, err
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return FileReadResult{}, err
	}

	return FileReadResult{
		Path:    relPath,
		Content: string(data),
	}, nil
}

func (s *ToolService) WriteFile(path, content, checkpointLabel string) (FileWriteResult, error) {
	if err := s.requireUserApproval("ide_control.write_file"); err != nil {
		return FileWriteResult{}, err
	}

	checkpoint, err := s.CreateCheckpoint(path, checkpointLabel)
	if err != nil {
		return FileWriteResult{}, err
	}

	absPath, err := resolveProjectPath(s.projectRoot, path)
	if err != nil {
		return FileWriteResult{}, err
	}

	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return FileWriteResult{}, err
	}

	if err := s.requireUserApproval("ide_control.write_file"); err != nil {
		return FileWriteResult{}, fmt.Errorf("approval expired before write: %w", err)
	}

	if err := os.WriteFile(absPath, []byte(content), 0o644); err != nil {
		return FileWriteResult{}, err
	}

	return FileWriteResult{
		Path:         toRelativePath(s.projectRoot, absPath),
		BytesWritten: len(content),
		CheckpointID: checkpoint.ID,
	}, nil
}

func (s *ToolService) SearchFiles(pattern string) []dispatcher.ResultItem {
	items := s.search.SearchFiles(pattern)
	return s.filterSensitiveDispatcherResultItems(items)
}

func (s *ToolService) SearchContent(query string, caseSensitive bool) []dispatcher.ResultItem {
	items := s.search.SearchContent(query, caseSensitive)
	return s.filterSensitiveDispatcherResultItems(items)
}

func (s *ToolService) CreateCheckpoint(path, label string) (Checkpoint, error) {
	absPath, err := resolveProjectPath(s.projectRoot, path)
	if err != nil {
		return Checkpoint{}, err
	}

	relPath := toRelativePath(s.projectRoot, absPath)
	if err := s.requireSensitiveFileApproval("change_journal.create_checkpoint", relPath); err != nil {
		return Checkpoint{}, err
	}

	beforeData, existed, readErr := readFileIfExists(absPath)
	if readErr != nil {
		return Checkpoint{}, readErr
	}

	checkpoint := s.journal.add(relPath, absPath, strings.TrimSpace(label), beforeData, existed)
	if err := s.persistJournal(); err != nil {
		return Checkpoint{}, err
	}
	return checkpoint, nil
}

func (s *ToolService) ListCheckpoints(path string, limit int) ([]Checkpoint, error) {
	pathFilter := ""
	if strings.TrimSpace(path) != "" {
		absPath, err := resolveProjectPath(s.projectRoot, path)
		if err != nil {
			return nil, err
		}
		pathFilter = toRelativePath(s.projectRoot, absPath)
	}

	return s.journal.list(pathFilter, limit), nil
}

func (s *ToolService) RollbackCheckpoint(id string) (Checkpoint, error) {
	if err := s.requireUserApproval("change_journal.rollback_checkpoint"); err != nil {
		return Checkpoint{}, err
	}

	record, ok := s.journal.get(strings.TrimSpace(id))
	if !ok {
		return Checkpoint{}, fmt.Errorf("checkpoint not found")
	}

	if record.meta.Existed {
		if err := s.requireUserApproval("change_journal.rollback_checkpoint"); err != nil {
			return Checkpoint{}, fmt.Errorf("approval expired before rollback write: %w", err)
		}
		if err := os.MkdirAll(filepath.Dir(record.absPath), 0o755); err != nil {
			return Checkpoint{}, err
		}
		if err := os.WriteFile(record.absPath, record.beforeData, 0o644); err != nil {
			return Checkpoint{}, err
		}
	} else {
		if err := s.requireUserApproval("change_journal.rollback_checkpoint"); err != nil {
			return Checkpoint{}, fmt.Errorf("approval expired before rollback remove: %w", err)
		}
		if err := os.Remove(record.absPath); err != nil && !os.IsNotExist(err) {
			return Checkpoint{}, err
		}
	}

	return record.meta, nil
}

func (s *ToolService) CallTool(name string, args map[string]any) (any, error) {
	if args == nil {
		args = map[string]any{}
	}

	startedAt := time.Now()
	result, err := s.callToolDispatch(name, args)
	s.recordAudit(name, args, err, startedAt)
	return result, err
}

func (s *ToolService) callToolDispatch(name string, args map[string]any) (any, error) {
	if args == nil {
		args = map[string]any{}
	}

	switch name {
	case "ide_control.read_file":
		path, err := requiredStringArg(args, "path")
		if err != nil {
			return nil, err
		}
		return s.ReadFile(path)
	case "ide_control.write_file":
		path, err := requiredStringArg(args, "path")
		if err != nil {
			return nil, err
		}
		content, err := requiredRawStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		label := optionalStringArg(args, "checkpoint_label")
		return s.WriteFile(path, content, label)
	case "ide_control.search_files":
		pattern, err := requiredStringArg(args, "pattern")
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": s.SearchFiles(pattern)}, nil
	case "ide_control.search_content":
		query, err := requiredStringArg(args, "query")
		if err != nil {
			return nil, err
		}
		caseSensitive := optionalBoolArg(args, "case_sensitive")
		return map[string]any{"items": s.SearchContent(query, caseSensitive)}, nil
	case "ide_control.permission_status":
		return s.PermissionStatus(), nil
	case "ide_control.request_permission":
		approvalCode := optionalStringArg(args, "approval_code")
		ttlSeconds := optionalIntArg(args, "ttl_seconds", defaultApprovalTTLSeconds)
		return s.RequestPermission(approvalCode, ttlSeconds)
	case "ide_control.audit_logs":
		limit := optionalIntArg(args, "limit", 50)
		return s.AuditLogs(limit), nil
	case "ide_control.capabilities":
		return s.Capabilities(), nil
	case "change_journal.create_checkpoint":
		path, err := requiredStringArg(args, "path")
		if err != nil {
			return nil, err
		}
		label := optionalStringArg(args, "label")
		return s.CreateCheckpoint(path, label)
	case "change_journal.list_checkpoints":
		path := optionalStringArg(args, "path")
		limit := optionalIntArg(args, "limit", 50)
		items, err := s.ListCheckpoints(path, limit)
		if err != nil {
			return nil, err
		}
		return map[string]any{"items": items}, nil
	case "change_journal.rollback_checkpoint":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		return s.RollbackCheckpoint(id)
	case "agent_memory.save":
		content, err := requiredStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		entryType := optionalStringArg(args, "type")
		tags := optionalStringSliceArg(args, "tags")
		importance := optionalIntArg(args, "importance", 5)
		return s.SaveAgentMemory(entryType, tags, content, importance)
	case "agent_memory.search":
		query := optionalStringArg(args, "query")
		if strings.TrimSpace(query) == "" {
			query = optionalStringArg(args, "content")
		}
		if strings.TrimSpace(query) == "" {
			query = optionalStringArg(args, "term")
		}
		tags := optionalStringSliceArg(args, "tags")
		limit := optionalIntArg(args, "limit", 25)
		return map[string]any{
			"items":               s.SearchAgentMemory(query, tags, limit),
			"query":               strings.TrimSpace(query),
			"memory_disk_path":    s.memory.DiskFilePath(),
			"memory_context_path": s.memory.ContextFilePath(),
		}, nil
	case "agent_memory.list":
		limit := optionalIntArg(args, "limit", 50)
		return map[string]any{"items": s.ListAgentMemory(limit)}, nil
	case "agent_memory.context":
		maxChars := optionalIntArg(args, "max_chars", defaultAgentContextChars)
		return map[string]any{"summary": s.AgentMemoryContext(maxChars)}, nil
	case "ide_backend.project_open":
		path, err := requiredStringArg(args, "path")
		if err != nil {
			return nil, err
		}
		return s.bridgeProjectOpen(path)
	case "ide_backend.project_close":
		return s.bridgeProjectClose()
	case "ide_backend.project_status":
		return s.bridgeProjectStatus()
	case "ide_backend.lsp_status":
		return s.bridgeLSPStatus()
	case "ide_backend.lsp_restart":
		language, err := requiredStringArg(args, "language")
		if err != nil {
			return nil, err
		}
		return s.bridgeLSPRestart(language)
	case "ide_backend.lsp_install":
		serverID, err := requiredStringArg(args, "server_id")
		if err != nil {
			return nil, err
		}
		return s.bridgeLSPInstall(serverID)
	case "ide_backend.lsp_servers":
		return s.bridgeLSPServers()
	case "ide_backend.lsp_definition":
		filePath, err := requiredStringArg(args, "file_path")
		if err != nil {
			return nil, err
		}
		content, err := requiredStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		line := optionalIntArg(args, "line", 0)
		character := optionalIntArg(args, "character", 0)
		return s.bridgeLSPDefinition(filePath, content, line, character)
	case "ide_backend.lsp_hover":
		filePath, err := requiredStringArg(args, "file_path")
		if err != nil {
			return nil, err
		}
		content, err := requiredStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		line := optionalIntArg(args, "line", 0)
		character := optionalIntArg(args, "character", 0)
		return s.bridgeLSPHover(filePath, content, line, character)
	case "ide_backend.lsp_signature":
		filePath, err := requiredStringArg(args, "file_path")
		if err != nil {
			return nil, err
		}
		content, err := requiredStringArg(args, "content")
		if err != nil {
			return nil, err
		}
		line := optionalIntArg(args, "line", 0)
		character := optionalIntArg(args, "character", 0)
		return s.bridgeLSPSignature(filePath, content, line, character)
	case "ide_backend.terminal_create":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		name := optionalStringArg(args, "name")
		if strings.TrimSpace(name) == "" {
			name = "Terminal"
		}
		command := optionalStringArg(args, "command")
		return s.bridgeTerminalCreate(id, name, command)
	case "ide_backend.terminal_write":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		data, err := requiredStringArg(args, "data")
		if err != nil {
			return nil, err
		}
		return s.bridgeTerminalWrite(id, data)
	case "ide_backend.terminal_resize":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		rows := optionalIntArg(args, "rows", 24)
		cols := optionalIntArg(args, "cols", 80)
		return s.bridgeTerminalResize(id, rows, cols)
	case "ide_backend.terminal_close":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		return s.bridgeTerminalClose(id)
	case "ide_backend.terminal_close_all":
		return s.bridgeTerminalCloseAll()
	case "ide_backend.dispatch_search_files":
		pattern, err := requiredStringArg(args, "pattern")
		if err != nil {
			return nil, err
		}
		return s.bridgeDispatchSearchFiles(pattern)
	case "ide_backend.dispatch_search_content":
		query, err := requiredStringArg(args, "query")
		if err != nil {
			return nil, err
		}
		return s.bridgeDispatchSearchContent(query)
	case "ide_backend.dispatch_search_symbols":
		query, err := requiredStringArg(args, "query")
		if err != nil {
			return nil, err
		}
		return s.bridgeDispatchSearchSymbols(query)
	case "ide_backend.dispatch_command":
		input, err := requiredStringArg(args, "input")
		if err != nil {
			return nil, err
		}
		return s.bridgeDispatchCommand(input)
	case "ide_backend.git_status":
		return s.bridgeGitStatus()
	case "ide_backend.git_diff":
		filePath := optionalStringArg(args, "file_path")
		staged := optionalBoolArg(args, "staged")
		return s.bridgeGitDiff(filePath, staged)
	case "ide_backend.git_log":
		limit := optionalIntArg(args, "limit", 50)
		filePath := optionalStringArg(args, "file_path")
		return s.bridgeGitLog(limit, filePath)
	case "ide_backend.git_show":
		commitHash, err := requiredStringArg(args, "commit_hash")
		if err != nil {
			return nil, err
		}
		return s.bridgeGitShow(commitHash)
	case "ide_backend.git_branch":
		return s.bridgeGitBranch()
	case "ide_backend.git_branches":
		return s.bridgeGitBranches()
	case "ide_ui.emit_event":
		eventName, err := requiredStringArg(args, "event")
		if err != nil {
			return nil, err
		}
		return s.bridgeEmitUIEvent(eventName, args["payload"])
	case "ide_ui.open_file_panel":
		return s.bridgeOpenFilePanel(args)
	case "ide_ui.preview_open":
		return s.bridgePreviewOpen(args)
	case "ide_ui.preview_navigate":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		url, err := requiredStringArg(args, "url")
		if err != nil {
			return nil, err
		}
		title := optionalStringArg(args, "title")
		focus := optionalBoolArg(args, "focus")
		return s.bridgePreviewNavigate(id, url, title, focus)
	case "ide_ui.preview_focus":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		return s.bridgePreviewFocus(id)
	case "ide_ui.preview_close":
		id, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		return s.bridgePreviewClose(id)
	case "ide_ui.list_layout_profiles":
		return s.listLayoutProfiles(), nil
	case "ide_ui.register_layout_profile":
		profileName, err := requiredStringArg(args, "name")
		if err != nil {
			return nil, err
		}
		actions, err := parseLayoutActions(args["actions"])
		if err != nil {
			return nil, err
		}
		return s.registerLayoutProfile(profileName, actions)
	case "ide_ui.apply_layout_profile":
		profileName, err := requiredStringArg(args, "name")
		if err != nil {
			return nil, err
		}
		return s.applyLayoutProfile(profileName)
	case "ide_ui.list_layout_snapshots":
		limit := optionalIntArg(args, "limit", 50)
		return s.listLayoutSnapshots(limit), nil
	case "ide_ui.apply_layout_snapshot":
		snapshotID, err := requiredStringArg(args, "id")
		if err != nil {
			return nil, err
		}
		return s.applyLayoutSnapshot(snapshotID)
	case "ide_ui.hot_switch":
		actions, err := parseLayoutActions(args["actions"])
		if err != nil {
			return nil, err
		}
		label := optionalStringArg(args, "label")
		return s.applyHotSwitch(actions, label)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}

func (s *ToolService) PermissionStatus() PermissionStatus {
	s.approvalMu.RLock()
	defer s.approvalMu.RUnlock()

	return permissionStatusSnapshot(s.approvalRequired, s.approvalExpires)
}

func (s *ToolService) RequestPermission(approvalCode string, ttlSeconds int) (PermissionStatus, error) {
	if !s.approvalRequired && s.approvalCode == "" {
		return permissionStatusSnapshot(false, time.Time{}), nil
	}

	if s.approvalCode != "" {
		if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(approvalCode)), []byte(s.approvalCode)) != 1 {
			return PermissionStatus{}, fmt.Errorf("invalid approval code")
		}
		return s.grantApproval(ttlSeconds), nil
	}

	ttl, err := s.requestLiveApproval("ide_control.request_permission", ttlSeconds)
	if err != nil {
		return PermissionStatus{}, err
	}

	return s.grantApproval(ttl), nil
}

func (s *ToolService) requireUserApproval(toolName string) error {
	return s.requireToolApproval(toolName, false)
}

func (s *ToolService) requireSensitiveFileApproval(toolName, relPath string) error {
	if !s.isSensitivePath(relPath) {
		return nil
	}

	return s.requireToolApproval(toolName, true)
}

func (s *ToolService) requireToolApproval(toolName string, force bool) error {
	if s.approvalGateSatisfied(force) {
		return nil
	}

	if strings.TrimSpace(s.approvalCode) != "" {
		return fmt.Errorf("%s requires user approval; call ide_control.request_permission", toolName)
	}

	ttl, err := s.requestLiveApproval(toolName, defaultApprovalTTLSeconds)
	if err != nil {
		return fmt.Errorf("%s requires user approval: %w", toolName, err)
	}

	s.grantApproval(ttl)
	return nil
}

func (s *ToolService) approvalGateSatisfied(force bool) bool {
	s.approvalMu.RLock()
	defer s.approvalMu.RUnlock()

	if !force && !s.approvalRequired {
		return true
	}

	return !s.approvalExpires.IsZero() && time.Now().UTC().Before(s.approvalExpires)
}

func (s *ToolService) grantApproval(ttlSeconds int) PermissionStatus {
	s.approvalMu.Lock()
	defer s.approvalMu.Unlock()

	ttl := normalizeApprovalTTL(ttlSeconds)
	s.approvalExpires = time.Now().UTC().Add(time.Duration(ttl) * time.Second)
	return permissionStatusSnapshot(s.approvalRequired, s.approvalExpires)
}

func (s *ToolService) requestLiveApproval(toolName string, ttlSeconds int) (int, error) {
	if !s.bridgeAvailable() {
		return 0, fmt.Errorf("live IDE approval is unavailable; set %s or approve from the Arlecchino UI", envMCPApprovalCode)
	}

	ttl := normalizeApprovalTTL(ttlSeconds)
	result, err := s.bridge.Call("mcp.request_approval", map[string]any{
		"tool_name":   strings.TrimSpace(toolName),
		"ttl_seconds": ttl,
		"risk":        s.riskClassForTool(toolName, map[string]any{}),
	})
	if err != nil {
		return 0, err
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		return 0, fmt.Errorf("approval response has unexpected type %T", result)
	}

	approved, _ := resultMap["approved"].(bool)
	if !approved {
		return 0, fmt.Errorf("approval denied")
	}

	return normalizeApprovalTTL(optionalIntArg(resultMap, "ttl_seconds", ttl)), nil
}

func (s *ToolService) isSensitivePath(relPath string) bool {
	normalizedPath := strings.ToLower(strings.TrimSpace(filepath.ToSlash(relPath)))
	if normalizedPath == "" {
		return false
	}

	baseName := filepath.Base(normalizedPath)
	for _, pattern := range s.sensitivePaths {
		if matchesSensitivePattern(normalizedPath, baseName, pattern) {
			return true
		}
	}

	return false
}

func matchesSensitivePattern(normalizedPath, baseName, pattern string) bool {
	normalizedPattern := strings.ToLower(strings.TrimSpace(pattern))
	if normalizedPattern == "" {
		return false
	}

	if strings.Contains(normalizedPattern, "/") {
		matched, err := filepath.Match(normalizedPattern, normalizedPath)
		return err == nil && matched
	}

	matched, err := filepath.Match(normalizedPattern, baseName)
	return err == nil && matched
}

func permissionStatusSnapshot(required bool, expiresAt time.Time) PermissionStatus {
	if !required {
		return PermissionStatus{Required: false, Granted: true}
	}

	now := time.Now().UTC()
	if expiresAt.IsZero() || !now.Before(expiresAt) {
		return PermissionStatus{Required: true, Granted: false}
	}

	remaining := int(expiresAt.Sub(now).Seconds())
	if remaining < 1 {
		remaining = 1
	}

	return PermissionStatus{
		Required:         true,
		Granted:          true,
		ExpiresAt:        expiresAt.Format(time.RFC3339),
		RemainingSeconds: remaining,
	}
}

func normalizeApprovalTTL(ttlSeconds int) int {
	if ttlSeconds <= 0 {
		return defaultApprovalTTLSeconds
	}
	if ttlSeconds > maxApprovalTTLSeconds {
		return maxApprovalTTLSeconds
	}
	return ttlSeconds
}

func parseBooleanEnvDefaultTrue(raw string) bool {
	normalized := strings.TrimSpace(strings.ToLower(raw))
	switch normalized {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	case "":
		return true
	default:
		return true
	}
}

func (s *ToolService) hasSensitiveAccessGrant() bool {
	s.approvalMu.RLock()
	defer s.approvalMu.RUnlock()

	if s.approvalExpires.IsZero() {
		return false
	}

	return time.Now().UTC().Before(s.approvalExpires)
}

func (s *ToolService) filterSensitiveDispatcherResultItems(items []dispatcher.ResultItem) []dispatcher.ResultItem {
	if len(items) == 0 {
		return items
	}

	if s.hasSensitiveAccessGrant() {
		return items
	}

	filtered := make([]dispatcher.ResultItem, 0, len(items))
	for _, item := range items {
		candidatePath := strings.TrimSpace(item.FilePath)
		if candidatePath == "" {
			candidatePath = strings.TrimSpace(item.Subtitle)
		}

		if s.isSensitiveResultPath(candidatePath) {
			continue
		}

		filtered = append(filtered, item)
	}

	return filtered
}

func (s *ToolService) isSensitiveResultPath(candidate string) bool {
	normalized := strings.TrimSpace(candidate)
	if normalized == "" {
		return false
	}

	if separatorIndex := strings.Index(normalized, ":"); separatorIndex > 0 {
		normalized = normalized[:separatorIndex]
	}

	if filepath.IsAbs(normalized) {
		normalized = toRelativePath(s.projectRoot, normalized)
	}

	return s.isSensitivePath(normalized)
}

func resolveProjectPath(projectRoot, requestedPath string) (string, error) {
	trimmedRoot := strings.TrimSpace(projectRoot)
	if trimmedRoot == "" {
		return "", fmt.Errorf("project root is empty")
	}

	trimmedPath := strings.TrimSpace(requestedPath)
	if trimmedPath == "" {
		return "", fmt.Errorf("path is required")
	}

	rootAbs, err := filepath.Abs(trimmedRoot)
	if err != nil {
		return "", err
	}

	rootResolved, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", fmt.Errorf("cannot resolve project root: %w", err)
	}

	targetPath := trimmedPath
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(rootResolved, targetPath)
	}

	targetAbs, err := filepath.Abs(targetPath)
	if err != nil {
		return "", err
	}

	targetResolved, err := resolveSymlinkAwareTarget(targetAbs)
	if err != nil {
		return "", err
	}

	if !isPathWithinRoot(rootResolved, targetResolved) {
		return "", fmt.Errorf("path escapes project root")
	}

	return targetResolved, nil
}

func resolveSymlinkAwareTarget(targetAbs string) (string, error) {
	if resolved, err := filepath.EvalSymlinks(targetAbs); err == nil {
		return resolved, nil
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot resolve path: %w", err)
	}

	current := targetAbs
	missingParts := make([]string, 0, 4)

	for {
		_, statErr := os.Lstat(current)
		if statErr == nil {
			resolvedCurrent, resolveErr := filepath.EvalSymlinks(current)
			if resolveErr != nil {
				return "", fmt.Errorf("cannot resolve path: %w", resolveErr)
			}

			for i := len(missingParts) - 1; i >= 0; i-- {
				resolvedCurrent = filepath.Join(resolvedCurrent, missingParts[i])
			}

			return resolvedCurrent, nil
		}

		if !os.IsNotExist(statErr) {
			return "", statErr
		}

		parent := filepath.Dir(current)
		if parent == current {
			return targetAbs, nil
		}

		missingParts = append(missingParts, filepath.Base(current))
		current = parent
	}
}

func isPathWithinRoot(rootAbs, targetAbs string) bool {
	if rootAbs == targetAbs {
		return true
	}
	prefix := rootAbs + string(os.PathSeparator)
	return strings.HasPrefix(targetAbs, prefix)
}

func toRelativePath(rootAbs, targetAbs string) string {
	resolvedRoot, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		resolvedRoot = rootAbs
	}

	resolvedTarget, err := resolveSymlinkAwareTarget(targetAbs)
	if err != nil {
		resolvedTarget = targetAbs
	}

	rel, err := filepath.Rel(resolvedRoot, resolvedTarget)
	if err != nil {
		return targetAbs
	}
	return filepath.ToSlash(rel)
}

func readFileIfExists(path string) ([]byte, bool, error) {
	data, err := os.ReadFile(path)
	if err == nil {
		return data, true, nil
	}
	if os.IsNotExist(err) {
		return nil, false, nil
	}
	return nil, false, err
}

func objectSchema(required []string, properties map[string]any) map[string]any {
	schema := map[string]any{
		"type":       "object",
		"properties": properties,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func requiredStringArg(args map[string]any, key string) (string, error) {
	value, ok := args[key]
	if !ok {
		return "", fmt.Errorf("missing required argument: %s", key)
	}

	stringValue, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("argument %s must be string", key)
	}

	trimmed := strings.TrimSpace(stringValue)
	if trimmed == "" {
		return "", fmt.Errorf("argument %s is empty", key)
	}

	return trimmed, nil
}

func requiredRawStringArg(args map[string]any, key string) (string, error) {
	value, ok := args[key]
	if !ok {
		return "", fmt.Errorf("missing required argument: %s", key)
	}

	stringValue, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("argument %s must be string", key)
	}

	return stringValue, nil
}

func optionalStringArg(args map[string]any, key string) string {
	value, ok := args[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func optionalStringSliceArg(args map[string]any, key string) []string {
	value, ok := args[key]
	if !ok {
		return []string{}
	}

	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			stringValue, ok := item.(string)
			if !ok {
				continue
			}
			result = append(result, stringValue)
		}
		return result
	case string:
		if strings.TrimSpace(typed) == "" {
			return []string{}
		}
		return []string{typed}
	default:
		return []string{}
	}
}

func optionalBoolArg(args map[string]any, key string) bool {
	value, ok := args[key]
	if !ok {
		return false
	}
	boolValue, ok := value.(bool)
	if !ok {
		return false
	}
	return boolValue
}

func optionalIntArg(args map[string]any, key string, fallback int) int {
	value, ok := args[key]
	if !ok {
		return fallback
	}

	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err != nil {
			return fallback
		}
		return parsed
	default:
		return fallback
	}
}

func newChangeJournal(capacity int) *changeJournal {
	if capacity <= 0 {
		capacity = defaultJournalCapacity
	}
	return &changeJournal{
		records:  make(map[string]checkpointRecord),
		order:    make([]string, 0, capacity),
		capacity: capacity,
	}
}

func (j *changeJournal) add(relPath, absPath, label string, beforeData []byte, existed bool) Checkpoint {
	j.mu.Lock()
	defer j.mu.Unlock()

	j.counter++
	id := fmt.Sprintf("cp-%d-%d", time.Now().UnixMilli(), j.counter)
	meta := Checkpoint{
		ID:        id,
		Path:      relPath,
		Label:     label,
		CreatedAt: time.Now().UTC(),
		Existed:   existed,
	}

	j.records[id] = checkpointRecord{
		meta:       meta,
		absPath:    absPath,
		beforeData: append([]byte(nil), beforeData...),
	}
	j.order = append(j.order, id)

	for len(j.order) > j.capacity {
		oldestID := j.order[0]
		j.order = j.order[1:]
		delete(j.records, oldestID)
	}

	return meta
}

func (j *changeJournal) get(id string) (checkpointRecord, bool) {
	j.mu.RLock()
	defer j.mu.RUnlock()

	record, ok := j.records[id]
	return record, ok
}

func (j *changeJournal) list(pathFilter string, limit int) []Checkpoint {
	j.mu.RLock()
	defer j.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	result := make([]Checkpoint, 0, min(limit, len(j.order)))

	for i := len(j.order) - 1; i >= 0; i-- {
		if len(result) >= limit {
			break
		}

		record := j.records[j.order[i]]
		if pathFilter != "" && record.meta.Path != pathFilter {
			continue
		}

		result = append(result, record.meta)
	}

	return result
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
