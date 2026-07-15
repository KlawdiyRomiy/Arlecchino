package mcp

import (
	"arlecchino/internal/dispatcher"
	"arlecchino/internal/terminal"
	"bytes"
	"crypto/subtle"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	defaultJournalCapacity    = 512
	defaultApprovalTTLSeconds = 300
	maxApprovalTTLSeconds     = 3600
	maxMCPTextFileBytes       = int64(2 * 1024 * 1024)
	maxMCPWriteFileBytes      = int64(2 * 1024 * 1024)
	mcpFileSniffBytes         = int64(64 * 1024)
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

var mcpNonTextFileExtensions = map[string]struct{}{
	".7z":      {},
	".app":     {},
	".avif":    {},
	".bin":     {},
	".bmp":     {},
	".bz2":     {},
	".class":   {},
	".db":      {},
	".db3":     {},
	".dll":     {},
	".doc":     {},
	".docx":    {},
	".dylib":   {},
	".exe":     {},
	".gif":     {},
	".gz":      {},
	".heic":    {},
	".icns":    {},
	".ico":     {},
	".jar":     {},
	".jpeg":    {},
	".jpg":     {},
	".mov":     {},
	".mp3":     {},
	".mp4":     {},
	".o":       {},
	".otf":     {},
	".pdf":     {},
	".png":     {},
	".ppt":     {},
	".pptx":    {},
	".rar":     {},
	".sqlite":  {},
	".sqlite3": {},
	".so":      {},
	".tar":     {},
	".tif":     {},
	".tiff":    {},
	".ttf":     {},
	".wasm":    {},
	".wav":     {},
	".webm":    {},
	".webp":    {},
	".woff":    {},
	".woff2":   {},
	".xls":     {},
	".xlsx":    {},
	".xz":      {},
	".zip":     {},
}

var mcpBinaryMagicPrefixes = [][]byte{
	{0x00, 0x61, 0x73, 0x6d},
	{0x1f, 0x8b},
	{0x25, 0x50, 0x44, 0x46, 0x2d},
	{0x42, 0x4d},
	{0x49, 0x44, 0x33},
	{0x4d, 0x5a},
	{0x50, 0x4b, 0x03, 0x04},
	{0x50, 0x4b, 0x05, 0x06},
	{0x50, 0x4b, 0x07, 0x08},
	{0x52, 0x61, 0x72, 0x21},
	{0x7f, 0x45, 0x4c, 0x46},
	{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a},
	{0xff, 0xd8, 0xff},
	[]byte("GIF87a"),
	[]byte("GIF89a"),
	[]byte("SQLite format 3"),
}

type ToolService struct {
	projectRoot               string
	search                    *dispatcher.SearchEngine
	journal                   *changeJournal
	bridge                    IDEBridge
	audit                     *auditLogger
	flightRecorder            *flightRecorder
	layouts                   *layoutRegistry
	memory                    AgentMemoryBackend
	skills                    AgentSkillsBackend
	sessionID                 string
	settings                  Settings
	settingsPath              string
	approvalRequired          bool
	approvalCode              string
	defaultApprovalTTLSeconds int
	approvalExpires           time.Time
	approvalGrants            map[string]time.Time
	approvalMu                sync.RWMutex
	sensitivePaths            []string
	uiRateMu                  sync.Mutex
	uiRateWindow              time.Time
	uiRateCount               int
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
	ToolName         string `json:"toolName,omitempty"`
	ExpiresAt        string `json:"expiresAt,omitempty"`
	RemainingSeconds int    `json:"remainingSeconds,omitempty"`
}

type checkpointRecord struct {
	meta       Checkpoint
	absPath    string
	beforeData []byte
	beforeMode os.FileMode
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
	flightRecorder, err := newFlightRecorder(absRoot, options.FlightRecorderPath, options.FlightRecorderLimit)
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

	memory := options.MemoryBackend
	if memory == nil {
		memory, err = loadMnemonicAgentMemoryStore(absRoot, defaultAgentMemoryLimit)
		if err != nil {
			return nil, err
		}
	}
	skillBackend := options.SkillBackend
	if skillBackend == nil {
		skillBackend, err = loadMnemonicAgentSkillsStore(absRoot)
		if err != nil {
			if closer, ok := memory.(interface{ Close() error }); ok {
				_ = closer.Close()
			}
			return nil, err
		}
	}

	settings, settingsPath, err := LoadSettings(options.SettingsPath)
	if err != nil {
		return nil, err
	}

	approvalRequired := settings.ApprovalRequired
	if envApprovalRequired, ok := parseOptionalBooleanEnv(os.Getenv(envMCPRequireApproval)); ok {
		approvalRequired = envApprovalRequired
	}

	return &ToolService{
		projectRoot:               absRoot,
		search:                    dispatcher.NewSearchEngine(absRoot),
		journal:                   journal,
		bridge:                    bridge,
		audit:                     audit,
		flightRecorder:            flightRecorder,
		layouts:                   layouts,
		memory:                    memory,
		skills:                    skillBackend,
		sessionID:                 fmt.Sprintf("sess-%d", time.Now().UTC().UnixMilli()),
		settings:                  settings,
		settingsPath:              settingsPath,
		approvalRequired:          approvalRequired,
		approvalCode:              strings.TrimSpace(os.Getenv(envMCPApprovalCode)),
		defaultApprovalTTLSeconds: settings.DefaultApprovalTTLSeconds,
		approvalGrants:            map[string]time.Time{},
		sensitivePaths:            append([]string(nil), defaultSensitivePathPatterns...),
	}, nil
}

func (s *ToolService) Close() error {
	if s == nil {
		return nil
	}
	var firstErr error
	if s.skills != nil {
		if err := s.skills.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if s.memory != nil {
		if closer, ok := s.memory.(interface{ Close() error }); ok {
			if err := closer.Close(); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func AllToolDefinitions() []ToolDefinition {
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
			InputSchema: objectSchema(nil, map[string]any{
				"tool_name": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "ide_control.request_permission",
			Description: "Request time-limited IDE control permission for one tool. If approval code is configured, provide it; otherwise this opens a live IDE approval prompt.",
			InputSchema: objectSchema(nil, map[string]any{
				"approval_code": map[string]any{"type": "string"},
				"ttl_seconds":   map[string]any{"type": "number"},
				"tool_name":     map[string]any{"type": "string"},
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
			Name:        "ide_control.flight_recorder",
			Description: "Read the Agent Flight Recorder event timeline",
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
			Name:        "ide_control.arlecchino_state_report",
			Description: "Read-only report of project-local .arlecchino generated, runtime-owned, legacy, and cleanup-candidate state",
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
				"tags":       stringArraySchema(),
				"importance": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "agent_memory.search",
			Description: "Search project-local agent memory",
			InputSchema: objectSchema(nil, map[string]any{
				"query": map[string]any{"type": "string"},
				"tags":  stringArraySchema(),
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
		{
			Name:        "agent_skills.list",
			Description: "List project-local skill residency candidates and trusted skills without reading full skill bodies",
			InputSchema: objectSchema(nil, map[string]any{
				"limit": map[string]any{"type": "number"},
			}),
		},
		{
			Name:        "agent_skills.status",
			Description: "Get project-local skill residency counts and backend status",
			InputSchema: objectSchema(nil, map[string]any{}),
		},
		{
			Name:        "agent_skills.context",
			Description: "Get compact trusted resident skill context; does not include full SKILL.md bodies",
			InputSchema: objectSchema(nil, map[string]any{
				"max_chars":  map[string]any{"type": "number"},
				"surface":    map[string]any{"type": "string"},
				"session_id": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "agent_skills.pin",
			Description: "Review and pin a project-local skill so it can produce trusted compact resident context",
			InputSchema: objectSchema([]string{"skill_id"}, map[string]any{
				"skill_id": map[string]any{"type": "string"},
				"reviewer": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "agent_skills.activate",
			Description: "Activate a trusted pinned skill for the current agent session",
			InputSchema: objectSchema([]string{"skill_id"}, map[string]any{
				"skill_id":   map[string]any{"type": "string"},
				"surface":    map[string]any{"type": "string"},
				"session_id": map[string]any{"type": "string"},
				"reason":     map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "agent_skills.dismiss",
			Description: "Dismiss an active resident skill for the current agent session",
			InputSchema: objectSchema([]string{"skill_id"}, map[string]any{
				"skill_id":   map[string]any{"type": "string"},
				"surface":    map[string]any{"type": "string"},
				"session_id": map[string]any{"type": "string"},
			}),
		},
		{
			Name:        "agent_skills.import",
			Description: "Register imported skill metadata in quarantine; imported skills are not trusted or active by default",
			InputSchema: objectSchema([]string{"name"}, map[string]any{
				"name":        map[string]any{"type": "string"},
				"description": map[string]any{"type": "string"},
				"source_repo": map[string]any{"type": "string"},
				"source_ref":  map[string]any{"type": "string"},
				"tool_hints":  stringArraySchema(),
			}),
		},
	}

	definitions = append(definitions, bridgeBackendToolDefinitions()...)
	definitions = append(definitions, bridgeUIToolDefinitions()...)

	return definitions
}

func (s *ToolService) ToolDefinitions() []ToolDefinition {
	if s == nil {
		return []ToolDefinition{}
	}

	settings, err := s.currentSettings()
	if err != nil || !settings.Enabled {
		return []ToolDefinition{}
	}

	disabled := settings.disabledToolSet()
	definitions := AllToolDefinitions()
	filtered := make([]ToolDefinition, 0, len(definitions))
	for _, definition := range definitions {
		if _, ok := disabled[strings.TrimSpace(definition.Name)]; ok {
			continue
		}
		filtered = append(filtered, definition)
	}
	return filtered
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

	data, err := readMCPTextFile(absPath)
	if err != nil {
		return FileReadResult{}, err
	}

	return FileReadResult{
		Path:    relPath,
		Content: string(data),
	}, nil
}

func (s *ToolService) WriteFile(path, content, checkpointLabel string) (FileWriteResult, error) {
	if int64(len([]byte(content))) > maxMCPWriteFileBytes {
		return FileWriteResult{}, fmt.Errorf("content exceeds MCP write limit (%d bytes)", maxMCPWriteFileBytes)
	}

	if err := s.requireUserApproval("ide_control.write_file"); err != nil {
		return FileWriteResult{}, err
	}

	requestedAbs, err := requestedProjectPathAbs(s.projectRoot, path)
	if err != nil {
		return FileWriteResult{}, err
	}
	if err := ensureNoSymlinkComponents(s.projectRoot, requestedAbs); err != nil {
		return FileWriteResult{}, err
	}

	checkpoint, err := s.createCheckpoint(path, checkpointLabel, "ide_control.write_file")
	if err != nil {
		return FileWriteResult{}, err
	}

	absPath, err := resolveProjectPath(s.projectRoot, path)
	if err != nil {
		return FileWriteResult{}, err
	}

	if err := ensureNoSymlinkComponents(s.projectRoot, filepath.Dir(absPath)); err != nil {
		return FileWriteResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o700); err != nil {
		return FileWriteResult{}, err
	}
	if err := ensureNoSymlinkComponents(s.projectRoot, absPath); err != nil {
		return FileWriteResult{}, err
	}

	if err := s.requireUserApproval("ide_control.write_file"); err != nil {
		return FileWriteResult{}, fmt.Errorf("approval expired before write: %w", err)
	}

	mode := fileWriteMode(absPath, 0o600)
	_, statErr := os.Stat(absPath)
	created := os.IsNotExist(statErr)
	if err := writeFileNoFollow(absPath, []byte(content), mode); err != nil {
		return FileWriteResult{}, err
	}
	if s.bridgeAvailable() {
		eventName := "file:changed"
		if created {
			eventName = "file:created"
		}
		_, _ = s.bridgeCall("ide_control.write_file", "ui.emit_event", map[string]any{
			"event":   eventName,
			"payload": absPath,
		})
	}

	return FileWriteResult{
		Path:         toRelativePath(s.projectRoot, absPath),
		BytesWritten: len(content),
		CheckpointID: checkpoint.ID,
	}, nil
}

func (s *ToolService) SearchFiles(pattern string) []dispatcher.ResultItem {
	items := s.search.SearchFiles(pattern)
	return s.filterSensitiveDispatcherResultItems("ide_control.search_files", items)
}

func (s *ToolService) SearchContent(query string, caseSensitive bool) []dispatcher.ResultItem {
	items := s.search.SearchContent(query, caseSensitive)
	return s.filterSensitiveDispatcherResultItems("ide_control.search_content", items)
}

func (s *ToolService) CreateCheckpoint(path, label string) (Checkpoint, error) {
	return s.createCheckpoint(path, label, "change_journal.create_checkpoint")
}

func (s *ToolService) createCheckpoint(path, label, sensitiveApprovalTool string) (Checkpoint, error) {
	absPath, err := resolveProjectPath(s.projectRoot, path)
	if err != nil {
		return Checkpoint{}, err
	}

	relPath := toRelativePath(s.projectRoot, absPath)
	if err := s.requireSensitiveFileApproval(sensitiveApprovalTool, relPath); err != nil {
		return Checkpoint{}, err
	}

	beforeData, beforeMode, existed, readErr := readFileIfExists(absPath)
	if readErr != nil {
		return Checkpoint{}, readErr
	}

	checkpoint := s.journal.add(relPath, absPath, strings.TrimSpace(label), beforeData, beforeMode, existed)
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
		if err := ensureNoSymlinkComponents(s.projectRoot, filepath.Dir(record.absPath)); err != nil {
			return Checkpoint{}, err
		}
		if err := os.MkdirAll(filepath.Dir(record.absPath), 0o700); err != nil {
			return Checkpoint{}, err
		}
		if err := ensureNoSymlinkComponents(s.projectRoot, record.absPath); err != nil {
			return Checkpoint{}, err
		}
		if err := writeFileNoFollow(record.absPath, record.beforeData, checkpointFileMode(record.beforeMode)); err != nil {
			return Checkpoint{}, err
		}
	} else {
		if err := s.requireUserApproval("change_journal.rollback_checkpoint"); err != nil {
			return Checkpoint{}, fmt.Errorf("approval expired before rollback remove: %w", err)
		}
		if err := ensureNoSymlinkComponents(s.projectRoot, record.absPath); err != nil {
			return Checkpoint{}, err
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
	if err := s.requireToolEnabled(name); err != nil {
		s.recordAudit(name, args, err, startedAt)
		s.recordToolFlightEvent(name, args, err, startedAt)
		return nil, err
	}

	result, err := s.callToolDispatch(name, args)
	s.recordAudit(name, args, err, startedAt)
	s.recordToolFlightEvent(name, args, err, startedAt)
	return result, err
}

func (s *ToolService) requireToolEnabled(name string) error {
	normalizedName := strings.TrimSpace(name)
	if normalizedName == "" {
		return nil
	}
	settings, err := s.currentSettings()
	if err != nil {
		return fmt.Errorf("Arlecchino MCP settings are unavailable: %w", err)
	}
	if !settings.Enabled {
		return fmt.Errorf("Arlecchino MCP is disabled by settings")
	}
	if !settings.ToolEnabled(normalizedName) {
		return fmt.Errorf("%s is disabled by Arlecchino MCP settings", normalizedName)
	}
	return nil
}

func (s *ToolService) currentSettings() (Settings, error) {
	if s == nil {
		return Settings{}, fmt.Errorf("MCP tool service is unavailable")
	}
	settings, _, err := LoadSettings(s.settingsPath)
	if err != nil {
		return Settings{}, err
	}
	return settings, nil
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
		toolName := optionalStringArg(args, "tool_name")
		if toolName == "" {
			toolName = optionalStringArg(args, "tool")
		}
		if toolName != "" {
			return s.PermissionStatusForTool(toolName), nil
		}
		return s.PermissionStatus(), nil
	case "ide_control.request_permission":
		approvalCode := optionalStringArg(args, "approval_code")
		ttlSeconds := optionalIntArg(args, "ttl_seconds", s.defaultApprovalTTL())
		toolName := optionalStringArg(args, "tool_name")
		if toolName == "" {
			toolName = optionalStringArg(args, "tool")
		}
		return s.RequestPermission(approvalCode, ttlSeconds, toolName)
	case "ide_control.audit_logs":
		limit := optionalIntArg(args, "limit", 50)
		return s.AuditLogs(limit), nil
	case "ide_control.flight_recorder":
		limit := optionalIntArg(args, "limit", 50)
		return s.FlightRecorder(limit), nil
	case "ide_control.capabilities":
		return s.Capabilities(), nil
	case "ide_control.arlecchino_state_report":
		return terminal.BuildArlecchinoStateReport(s.projectRoot)
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
	case "agent_skills.list":
		limit := optionalIntArg(args, "limit", 50)
		return map[string]any{"items": s.ListAgentSkills(limit)}, nil
	case "agent_skills.status":
		return s.AgentSkillsStatus(), nil
	case "agent_skills.context":
		maxChars := optionalIntArg(args, "max_chars", 2400)
		surface := optionalStringArg(args, "surface")
		sessionID := optionalStringArg(args, "session_id")
		return map[string]any{"summary": s.AgentSkillsContext(maxChars, surface, sessionID)}, nil
	case "agent_skills.pin":
		if err := s.requireExplicitUserApproval("agent_skills.pin"); err != nil {
			return nil, err
		}
		skillID, err := requiredStringArg(args, "skill_id")
		if err != nil {
			return nil, err
		}
		reviewer := optionalStringArg(args, "reviewer")
		if reviewer == "" {
			reviewer = "mcp-user-approved"
		}
		return s.PinAgentSkill(skillID, reviewer)
	case "agent_skills.activate":
		if err := s.requireExplicitUserApproval("agent_skills.activate"); err != nil {
			return nil, err
		}
		skillID, err := requiredStringArg(args, "skill_id")
		if err != nil {
			return nil, err
		}
		return s.ActivateAgentSkill(skillID, optionalStringArg(args, "surface"), optionalStringArg(args, "session_id"), optionalStringArg(args, "reason"))
	case "agent_skills.dismiss":
		if err := s.requireExplicitUserApproval("agent_skills.dismiss"); err != nil {
			return nil, err
		}
		skillID, err := requiredStringArg(args, "skill_id")
		if err != nil {
			return nil, err
		}
		return nil, s.DismissAgentSkill(skillID, optionalStringArg(args, "surface"), optionalStringArg(args, "session_id"))
	case "agent_skills.import":
		if err := s.requireExplicitUserApproval("agent_skills.import"); err != nil {
			return nil, err
		}
		name, err := requiredStringArg(args, "name")
		if err != nil {
			return nil, err
		}
		return s.ImportAgentSkillCandidate(name, optionalStringArg(args, "description"), optionalStringArg(args, "source_repo"), optionalStringArg(args, "source_ref"), optionalStringSliceArg(args, "tool_hints"))
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
		return s.bridgeEmitUIEvent("ide_ui.emit_event", eventName, args["payload"])
	case "ide_ui.surface_read":
		return s.bridgeSurfaceRead(args)
	case "ide_ui.open_intent":
		return s.bridgeOpenIntent(args)
	case "ide_ui.open_file_panel":
		return s.bridgeOpenFilePanel(args)
	case "ide_ui.open_panel":
		return s.bridgeOpenPanel(args)
	case "ide_ui.move_panel":
		return s.bridgeMovePanel(args)
	case "ide_ui.close_panel":
		return s.bridgeClosePanel(args)
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

	return permissionStatusSnapshot(s.approvalRequired, s.latestApprovalExpiresLocked(), "")
}

func (s *ToolService) PermissionStatusForTool(toolName string) PermissionStatus {
	normalizedTool := normalizeApprovalToolName(toolName)
	if normalizedTool == "" {
		return s.PermissionStatus()
	}

	s.approvalMu.RLock()
	defer s.approvalMu.RUnlock()

	return permissionStatusSnapshot(s.approvalRequired, s.approvalGrants[normalizedTool], normalizedTool)
}

func (s *ToolService) RequestPermission(approvalCode string, ttlSeconds int, toolName string) (PermissionStatus, error) {
	normalizedTool := normalizeApprovalToolName(toolName)
	if normalizedTool == "" {
		return PermissionStatus{}, fmt.Errorf("tool_name is required for scoped permission")
	}
	if !s.toolAvailableForApproval(normalizedTool) {
		return PermissionStatus{}, fmt.Errorf("tool_name %q is not available in current MCP settings", normalizedTool)
	}

	if !s.approvalRequired && s.approvalCode == "" {
		return permissionStatusSnapshot(false, time.Time{}, normalizedTool), nil
	}

	if s.approvalCode != "" {
		if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(approvalCode)), []byte(s.approvalCode)) != 1 {
			return PermissionStatus{}, fmt.Errorf("invalid approval code")
		}
		return s.grantApproval(normalizedTool, ttlSeconds), nil
	}

	ttl, err := s.requestLiveApproval(normalizedTool, ttlSeconds)
	if err != nil {
		return PermissionStatus{}, err
	}

	return s.grantApproval(normalizedTool, ttl), nil
}

func (s *ToolService) toolAvailableForApproval(toolName string) bool {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return false
	}
	for _, definition := range s.ToolDefinitions() {
		if strings.TrimSpace(definition.Name) == toolName {
			return true
		}
	}
	return false
}

func (s *ToolService) requireUserApproval(toolName string) error {
	return s.requireToolApproval(toolName, false)
}

func (s *ToolService) requireExplicitUserApproval(toolName string) error {
	return s.requireToolApproval(toolName, true)
}

func (s *ToolService) requireSensitiveFileApproval(toolName, relPath string) error {
	if !s.isSensitivePath(relPath) {
		return nil
	}

	return s.requireToolApproval(toolName, true)
}

func (s *ToolService) requireToolApproval(toolName string, force bool) error {
	normalizedTool := normalizeApprovalToolName(toolName)
	if s.approvalGateSatisfied(normalizedTool, force) {
		return nil
	}

	if strings.TrimSpace(s.approvalCode) != "" {
		return fmt.Errorf("%s requires user approval; call ide_control.request_permission with tool_name=%q", toolName, normalizedTool)
	}

	ttl, err := s.requestLiveApproval(normalizedTool, s.defaultApprovalTTL())
	if err != nil {
		return fmt.Errorf("%s requires user approval: %w", toolName, err)
	}

	s.grantApproval(normalizedTool, ttl)
	return nil
}

func (s *ToolService) approvalGateSatisfied(toolName string, force bool) bool {
	s.approvalMu.RLock()
	defer s.approvalMu.RUnlock()

	if !force && !s.approvalRequired {
		return true
	}

	expiresAt, ok := s.approvalGrants[normalizeApprovalToolName(toolName)]
	return ok && !expiresAt.IsZero() && time.Now().UTC().Before(expiresAt)
}

func (s *ToolService) grantApproval(toolName string, ttlSeconds int) PermissionStatus {
	s.approvalMu.Lock()
	defer s.approvalMu.Unlock()

	normalizedTool := normalizeApprovalToolName(toolName)
	ttl := s.normalizeApprovalTTL(ttlSeconds)
	s.approvalExpires = time.Now().UTC().Add(time.Duration(ttl) * time.Second)
	if s.approvalGrants == nil {
		s.approvalGrants = map[string]time.Time{}
	}
	s.approvalGrants[normalizedTool] = s.approvalExpires
	return permissionStatusSnapshot(s.approvalRequired, s.approvalExpires, normalizedTool)
}

func (s *ToolService) requestLiveApproval(toolName string, ttlSeconds int) (int, error) {
	if !s.bridgeAvailable() {
		return 0, fmt.Errorf("live IDE approval is unavailable; set %s or approve from the Arlecchino UI", envMCPApprovalCode)
	}

	ttl := s.normalizeApprovalTTL(ttlSeconds)
	requestedAt := time.Now()
	risk := s.riskClassForTool(toolName, map[string]any{})
	s.recordFlightEvent(FlightRecord{
		Type:   "approval.requested",
		Source: "mcp",
		Tool:   toolName,
		Risk:   risk,
		Status: "pending",
		Args: map[string]any{
			"ttl_seconds": ttl,
		},
	})
	result, err := s.bridge.Call("mcp.request_approval", map[string]any{
		"tool_name":   strings.TrimSpace(toolName),
		"ttl_seconds": ttl,
		"risk":        risk,
	})
	if err != nil {
		s.recordFlightEvent(FlightRecord{
			Type:       "approval.resolved",
			Source:     "mcp",
			Tool:       toolName,
			Risk:       risk,
			Status:     "error",
			Error:      err.Error(),
			DurationMs: time.Since(requestedAt).Milliseconds(),
		})
		return 0, err
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		err := fmt.Errorf("approval response has unexpected type %T", result)
		s.recordFlightEvent(FlightRecord{
			Type:       "approval.resolved",
			Source:     "mcp",
			Tool:       toolName,
			Risk:       risk,
			Status:     "error",
			Error:      err.Error(),
			DurationMs: time.Since(requestedAt).Milliseconds(),
		})
		return 0, err
	}

	approved, _ := resultMap["approved"].(bool)
	if !approved {
		err := fmt.Errorf("approval denied")
		s.recordFlightEvent(FlightRecord{
			Type:       "approval.resolved",
			Source:     "mcp",
			Tool:       toolName,
			Risk:       risk,
			Status:     "denied",
			Error:      err.Error(),
			DurationMs: time.Since(requestedAt).Milliseconds(),
		})
		return 0, err
	}

	resolvedTTL := s.normalizeApprovalTTL(optionalIntArg(resultMap, "ttl_seconds", ttl))
	s.recordFlightEvent(FlightRecord{
		Type:       "approval.resolved",
		Source:     "mcp",
		Tool:       toolName,
		Risk:       risk,
		Status:     "approved",
		DurationMs: time.Since(requestedAt).Milliseconds(),
		Args: map[string]any{
			"ttl_seconds": resolvedTTL,
		},
	})
	return resolvedTTL, nil
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

func permissionStatusSnapshot(required bool, expiresAt time.Time, toolName string) PermissionStatus {
	normalizedTool := normalizeApprovalToolName(toolName)
	if !required {
		return PermissionStatus{Required: false, Granted: true, ToolName: normalizedTool}
	}

	now := time.Now().UTC()
	if expiresAt.IsZero() || !now.Before(expiresAt) {
		return PermissionStatus{Required: true, Granted: false, ToolName: normalizedTool}
	}

	remaining := int(expiresAt.Sub(now).Seconds())
	if remaining < 1 {
		remaining = 1
	}

	return PermissionStatus{
		Required:         true,
		Granted:          true,
		ToolName:         normalizedTool,
		ExpiresAt:        expiresAt.Format(time.RFC3339),
		RemainingSeconds: remaining,
	}
}

func normalizeApprovalToolName(raw string) string {
	return strings.TrimSpace(raw)
}

func (s *ToolService) latestApprovalExpiresLocked() time.Time {
	now := time.Now().UTC()
	latest := time.Time{}
	for _, expiresAt := range s.approvalGrants {
		if expiresAt.IsZero() || !now.Before(expiresAt) {
			continue
		}
		if latest.IsZero() || expiresAt.After(latest) {
			latest = expiresAt
		}
	}
	return latest
}

func (s *ToolService) defaultApprovalTTL() int {
	if s == nil {
		return defaultApprovalTTLSeconds
	}
	return normalizeApprovalTTLWithDefault(s.defaultApprovalTTLSeconds, defaultApprovalTTLSeconds)
}

func (s *ToolService) normalizeApprovalTTL(ttlSeconds int) int {
	return normalizeApprovalTTLWithDefault(ttlSeconds, s.defaultApprovalTTL())
}

func normalizeApprovalTTLWithDefault(ttlSeconds int, defaultTTL int) int {
	if defaultTTL <= 0 {
		defaultTTL = defaultApprovalTTLSeconds
	}
	if defaultTTL > maxApprovalTTLSeconds {
		defaultTTL = maxApprovalTTLSeconds
	}
	if ttlSeconds <= 0 {
		return defaultTTL
	}
	if ttlSeconds > maxApprovalTTLSeconds {
		return maxApprovalTTLSeconds
	}
	return ttlSeconds
}

func parseOptionalBooleanEnv(raw string) (bool, bool) {
	normalized := strings.TrimSpace(strings.ToLower(raw))
	switch normalized {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	case "":
		return false, false
	default:
		return false, false
	}
}

func (s *ToolService) hasSensitiveAccessGrant(toolName string) bool {
	return s.approvalGateSatisfied(normalizeApprovalToolName(toolName), true)
}

func (s *ToolService) filterSensitiveDispatcherResultItems(toolName string, items []dispatcher.ResultItem) []dispatcher.ResultItem {
	if len(items) == 0 {
		return items
	}

	if s.hasSensitiveAccessGrant(toolName) {
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

func requestedProjectPathAbs(projectRoot, requestedPath string) (string, error) {
	trimmedPath := strings.TrimSpace(requestedPath)
	if trimmedPath == "" {
		return "", fmt.Errorf("path is required")
	}
	rootResolved, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		return "", fmt.Errorf("cannot resolve project root: %w", err)
	}
	targetPath := trimmedPath
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(rootResolved, targetPath)
	}
	return filepath.Abs(targetPath)
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

func readFileIfExists(path string) ([]byte, os.FileMode, bool, error) {
	info, statErr := os.Stat(path)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return nil, 0, false, nil
		}
		return nil, 0, false, statErr
	}
	if info.IsDir() {
		return nil, 0, false, fmt.Errorf("cannot checkpoint directory: %s", path)
	}
	if info.Size() > maxMCPWriteFileBytes {
		return nil, 0, false, fmt.Errorf("checkpoint source exceeds MCP checkpoint limit (%d bytes): %s", maxMCPWriteFileBytes, path)
	}

	data, err := os.ReadFile(path)
	if err == nil {
		return data, info.Mode().Perm(), true, nil
	}
	return nil, 0, false, err
}

func fileWriteMode(path string, fallback os.FileMode) os.FileMode {
	info, err := os.Stat(path)
	if err == nil && !info.IsDir() {
		return checkpointFileMode(info.Mode().Perm())
	}
	return checkpointFileMode(fallback)
}

func checkpointFileMode(mode os.FileMode) os.FileMode {
	mode = mode.Perm()
	if mode == 0 {
		return 0o600
	}
	return mode
}

func writeFileNoFollow(path string, data []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC|openNoFollowFlag, mode)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := file.Write(data); err != nil {
		return err
	}
	return file.Chmod(mode)
}

func ensureNoSymlinkComponents(projectRoot, targetPath string) error {
	rootResolved, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		return fmt.Errorf("cannot resolve project root: %w", err)
	}

	targetAbs, err := filepath.Abs(targetPath)
	if err != nil {
		return err
	}
	if !isPathWithinRoot(rootResolved, targetAbs) {
		return fmt.Errorf("path escapes project root")
	}

	rel, err := filepath.Rel(rootResolved, targetAbs)
	if err != nil {
		return err
	}
	if rel == "." {
		return nil
	}

	current := rootResolved
	for _, part := range strings.Split(rel, string(os.PathSeparator)) {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, statErr := os.Lstat(current)
		if statErr != nil {
			if os.IsNotExist(statErr) {
				continue
			}
			return statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing to mutate path through symlink component: %s", current)
		}
	}

	return nil
}

func readMCPTextFile(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("cannot read directory as file: %s", path)
	}
	if info.Size() > maxMCPTextFileBytes {
		return nil, fmt.Errorf("file is too large for MCP read_file (%d bytes, limit %d): %s", info.Size(), maxMCPTextFileBytes, path)
	}
	if _, denied := mcpNonTextFileExtensions[strings.ToLower(filepath.Ext(path))]; denied {
		return nil, fmt.Errorf("file appears to be binary or non-text and cannot be read through MCP read_file: %s", path)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if looksBinaryMCPContent(data) {
		return nil, fmt.Errorf("file appears to be binary and cannot be read through MCP read_file: %s", path)
	}
	if !utf8.Valid(data) {
		return nil, fmt.Errorf("file is not valid UTF-8 text and cannot be read through MCP read_file: %s", path)
	}
	return data, nil
}

func looksBinaryMCPContent(content []byte) bool {
	sniff := content
	if int64(len(sniff)) > mcpFileSniffBytes {
		sniff = sniff[:mcpFileSniffBytes]
	}
	for _, prefix := range mcpBinaryMagicPrefixes {
		if bytes.HasPrefix(sniff, prefix) {
			return true
		}
	}
	return bytes.IndexByte(sniff, 0) >= 0
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

func stringArraySchema() map[string]any {
	return map[string]any{
		"type":  "array",
		"items": map[string]any{"type": "string"},
	}
}

func objectArraySchema() map[string]any {
	return map[string]any{
		"type":  "array",
		"items": map[string]any{"type": "object"},
	}
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

func (j *changeJournal) add(relPath, absPath, label string, beforeData []byte, beforeMode os.FileMode, existed bool) Checkpoint {
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
		beforeMode: beforeMode.Perm(),
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
