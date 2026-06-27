package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	lspregistry "arlecchino/internal/lsp"
	"arlecchino/internal/processcontrol"
)

type Manager struct {
	mu                    sync.RWMutex
	startMu               sync.Mutex
	documentMu            sync.Mutex
	servers               map[string]*Server
	configs               map[string]ServerConfig
	installerConfigs      map[string]bool
	installerBaseConfigs  map[string]ServerConfig
	starting              map[string]chan struct{}
	startFailures         map[string]startFailure
	startBackoff          time.Duration
	startTimeoutGap       time.Duration
	noConfigLogged        map[string]bool
	openDocsByLang        map[string]map[string]*openDocState
	idleTimers            map[string]*time.Timer
	idleTimeout           time.Duration
	transientIdleTimeout  time.Duration
	resourceChecks        map[*Server]time.Time
	resourceRestartTimers map[*Server]*time.Timer
	resourceCheckInterval time.Duration
	resourceRestartGrace  time.Duration
	resourceMaxRSSBytes   int64
	processRSSBytes       func(pid int) (int64, error)
	completionMu          sync.Mutex
	completionInFly       map[string]*completionFlight
	completionCache       map[string]completionResult
	completionEpoch       uint64
	completionTTL         time.Duration
	completionMax         int
	completionWait        time.Duration
	diagnosticsMu         sync.RWMutex
	diagnostics           map[string]map[string][]Diagnostic
	diagnosticSeq         uint64
	diagnosticSeen        map[string]uint64
	transientCloseClears  map[string]struct{}
	onDiagnostics         func(language, filePath string, diagnostics []Diagnostic)
	processGovernor       processcontrol.Controller
	rootPath              string
}

type openDocState struct {
	version       int
	userOpen      bool
	transientRefs int
	content       string
	languageID    string
	lastUsedAt    time.Time
	syncedServer  *Server
}

func configLanguageCandidates(language string) []string {
	return lspregistry.LanguageCandidates(language)
}

func normalizeLanguageID(language string) string {
	return lspregistry.TextDocumentLanguageID(language)
}

type completionResult struct {
	response  CompletionResponse
	err       error
	createdAt time.Time
}

type completionFlight struct {
	done   chan struct{}
	result completionResult
}

type CompletionTrigger struct {
	TriggerKind              int
	TriggerCharacter         string
	RetryInvokedOnEmpty      bool
	RetryInvokedOnIncomplete bool
	AccessMemberIntent       bool
}

const (
	completionTriggerInvoked    = 1
	completionTriggerCharacter  = 2
	completionTriggerIncomplete = 3
)

const (
	maxLSPMessageBytes       = 16 << 20
	maxDiagnosticsPerPublish = 5000
	maxDiagnosticTextBytes   = 8192
)

var completionSnippetPlaceholderPattern = regexp.MustCompile(`\$\{[0-9]+(?::[^}]*)?\}|\$[0-9]+`)

var ErrNoConfig = errors.New("lsp server config not found")

type startReasonContextKey struct{}
type coldStartContextKey struct{}

func WithStartReason(ctx context.Context, reason string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return ctx
	}
	return context.WithValue(ctx, startReasonContextKey{}, reason)
}

func WithColdStartAllowed(ctx context.Context, allowed bool) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, coldStartContextKey{}, allowed)
}

func startReasonFromContext(ctx context.Context) string {
	if ctx == nil {
		return "unspecified"
	}
	reason, _ := ctx.Value(startReasonContextKey{}).(string)
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "unspecified"
	}
	return reason
}

func coldStartAllowedFromContext(ctx context.Context) bool {
	if ctx == nil {
		return true
	}
	allowed, ok := ctx.Value(coldStartContextKey{}).(bool)
	if !ok {
		return true
	}
	return allowed
}

func (t CompletionTrigger) normalized() CompletionTrigger {
	switch t.TriggerKind {
	case completionTriggerCharacter:
		if strings.TrimSpace(t.TriggerCharacter) == "" {
			t.TriggerKind = completionTriggerInvoked
			t.TriggerCharacter = ""
			t.AccessMemberIntent = false
		}
	case completionTriggerIncomplete:
		t.TriggerCharacter = ""
	default:
		t.TriggerKind = completionTriggerInvoked
		t.TriggerCharacter = ""
		t.AccessMemberIntent = false
	}
	return t
}

type startFailure struct {
	err     string
	reason  string
	at      time.Time
	retryAt time.Time
}

// ServerStatus represents the health status of an LSP server
type ServerStatus struct {
	Language     string
	Running      bool
	ProcessAlive bool
	LastError    string
	Restarts     int
}

type ServerConfig struct {
	Language    string
	Command     string
	Args        []string
	RootURI     string
	InitParams  map[string]any
	ServerGroup string // Languages sharing same server process (e.g., "clangd" for c/cpp/objectivec)
}

type Server struct {
	config       ServerConfig
	cmd          *exec.Cmd
	stdin        io.WriteCloser
	stdout       io.ReadCloser
	running      bool
	id           int
	mu           sync.Mutex
	writeMu      sync.Mutex
	pending      map[int]chan *Response
	onNotify     func(method string, params json.RawMessage)
	restarts     int
	lastError    string
	capabilities ServerCapabilities
}

type Request struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *ResponseError  `json:"error,omitempty"`
}

type ResponseError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type CompletionItem struct {
	Label               string          `json:"label"`
	LabelDetails        *LabelDetails   `json:"labelDetails,omitempty"`
	Kind                int             `json:"kind"`
	Detail              string          `json:"detail,omitempty"`
	Documentation       any             `json:"documentation,omitempty"`
	Deprecated          bool            `json:"deprecated,omitempty"`
	Preselect           bool            `json:"preselect,omitempty"`
	SortText            string          `json:"sortText,omitempty"`
	FilterText          string          `json:"filterText,omitempty"`
	InsertText          string          `json:"insertText,omitempty"`
	InsertTextFormat    int             `json:"insertTextFormat,omitempty"` // 1 = PlainText, 2 = Snippet
	InsertTextMode      int             `json:"insertTextMode,omitempty"`
	TextEditText        string          `json:"textEditText,omitempty"`
	TextEdit            json.RawMessage `json:"textEdit,omitempty"`
	AdditionalTextEdits []TextEdit      `json:"additionalTextEdits,omitempty"`
	CommitCharacters    []string        `json:"commitCharacters,omitempty"`
	Command             *Command        `json:"command,omitempty"`
	Data                any             `json:"data,omitempty"`
	Tags                []int           `json:"tags,omitempty"`
	FallbackOnly        bool            `json:"-"`
}

type LabelDetails struct {
	Detail      string `json:"detail,omitempty"`
	Description string `json:"description,omitempty"`
}

type TextEdit struct {
	Range   Range  `json:"range"`
	NewText string `json:"newText"`
}

type InsertReplaceEdit struct {
	Insert  Range  `json:"insert"`
	Replace Range  `json:"replace"`
	NewText string `json:"newText"`
}

type CompletionList struct {
	IsIncomplete bool                    `json:"isIncomplete"`
	ItemDefaults *CompletionItemDefaults `json:"itemDefaults,omitempty"`
	Items        []CompletionItem        `json:"items"`
}

type CompletionItemDefaults struct {
	CommitCharacters []string        `json:"commitCharacters,omitempty"`
	EditRange        json.RawMessage `json:"editRange,omitempty"`
	InsertTextFormat int             `json:"insertTextFormat,omitempty"`
	InsertTextMode   int             `json:"insertTextMode,omitempty"`
	Data             any             `json:"data,omitempty"`
}

type CompletionResponse struct {
	Items                         []CompletionItem
	IsIncomplete                  bool
	UsedInvokedFallback           bool
	InvokedFallbackReason         string
	InvokedFallbackRejected       bool
	InvokedFallbackRejectedReason string
}

type CompletionProviderCapability struct {
	TriggerCharacters   []string `json:"triggerCharacters,omitempty"`
	AllCommitCharacters []string `json:"allCommitCharacters,omitempty"`
	ResolveProvider     bool     `json:"resolveProvider,omitempty"`
}

type CompletionCapabilities struct {
	Available         bool
	ResolveProvider   bool
	TriggerCharacters []string
	TextDocumentSync  any
}

type ServerCapabilities struct {
	TextDocumentSync   any                           `json:"textDocumentSync,omitempty"`
	CompletionProvider *CompletionProviderCapability `json:"completionProvider,omitempty"`
}

type InitializeResult struct {
	Capabilities ServerCapabilities `json:"capabilities"`
}

// Location represents a location in a file (for GoToDefinition)
type Location struct {
	URI   string `json:"uri"`
	Range Range  `json:"range"`
}

type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// HoverResult represents the result of a hover request
type HoverResult struct {
	Contents string `json:"contents"`
}

// SignatureHelpResult represents the result of a signature help request
type SignatureHelpResult struct {
	Signatures      []SignatureInfo `json:"signatures"`
	ActiveSignature int             `json:"activeSignature"`
	ActiveParameter int             `json:"activeParameter"`
}

// SignatureInfo represents information about a function signature
type SignatureInfo struct {
	Label         string          `json:"label"`
	Documentation string          `json:"documentation"`
	Parameters    []ParameterInfo `json:"parameters"`
}

// ParameterInfo represents information about a parameter
type ParameterInfo struct {
	Label         string `json:"label"`
	Documentation string `json:"documentation"`
}

type Diagnostic struct {
	Range    Range  `json:"range"`
	Severity int    `json:"severity,omitempty"`
	Code     any    `json:"code,omitempty"`
	Source   string `json:"source,omitempty"`
	Message  string `json:"message"`
}

type PublishDiagnosticsParams struct {
	URI         string       `json:"uri"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

type WorkspaceEdit struct {
	Changes         map[string][]TextEdit `json:"changes,omitempty"`
	DocumentChanges []json.RawMessage     `json:"documentChanges,omitempty"`
}

type FileRename struct {
	OldURI string `json:"oldUri"`
	NewURI string `json:"newUri"`
}

type DiagnosticsPublicationTarget struct {
	Language string
	FilePath string
}

type Command struct {
	Title     string `json:"title,omitempty"`
	Command   string `json:"command"`
	Arguments []any  `json:"arguments,omitempty"`
}

type CodeAction struct {
	Title       string         `json:"title"`
	Kind        string         `json:"kind,omitempty"`
	Diagnostics []Diagnostic   `json:"diagnostics,omitempty"`
	Edit        *WorkspaceEdit `json:"edit,omitempty"`
	Command     *Command       `json:"command,omitempty"`
	IsPreferred bool           `json:"isPreferred,omitempty"`
}

func NewManager(rootPath string) *Manager {
	resourcePolicy := currentLSPResourcePolicy()
	return &Manager{
		servers:               make(map[string]*Server),
		configs:               make(map[string]ServerConfig),
		installerConfigs:      make(map[string]bool),
		installerBaseConfigs:  make(map[string]ServerConfig),
		starting:              make(map[string]chan struct{}),
		startFailures:         make(map[string]startFailure),
		startBackoff:          30 * time.Second,
		startTimeoutGap:       2 * time.Second,
		noConfigLogged:        make(map[string]bool),
		openDocsByLang:        make(map[string]map[string]*openDocState),
		idleTimers:            make(map[string]*time.Timer),
		idleTimeout:           2 * time.Minute,
		transientIdleTimeout:  5 * time.Second,
		resourceChecks:        make(map[*Server]time.Time),
		resourceRestartTimers: make(map[*Server]*time.Timer),
		resourceCheckInterval: resourcePolicy.CheckInterval,
		resourceRestartGrace:  resourcePolicy.RestartGrace,
		resourceMaxRSSBytes:   resourcePolicy.MaxRSSBytes,
		processRSSBytes:       lspProcessRSSBytes,
		completionInFly:       make(map[string]*completionFlight),
		completionCache:       make(map[string]completionResult),
		completionTTL:         250 * time.Millisecond,
		completionMax:         200,
		completionWait:        500 * time.Millisecond,
		diagnostics:           make(map[string]map[string][]Diagnostic),
		diagnosticSeen:        make(map[string]uint64),
		transientCloseClears:  make(map[string]struct{}),
		rootPath:              rootPath,
	}
}

const diagnosticsPublishPollInterval = 25 * time.Millisecond
const transientCloseDiagnosticsClearMaxEntries = 2048

func (m *Manager) SetDiagnosticsCallback(callback func(language, filePath string, diagnostics []Diagnostic)) {
	m.diagnosticsMu.Lock()
	m.onDiagnostics = callback
	m.diagnosticsMu.Unlock()
}

func (m *Manager) SetProcessGovernor(governor processcontrol.Controller) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.processGovernor = governor
	m.mu.Unlock()
}

func (m *Manager) resolveConfiguredLanguage(language string) (string, bool) {
	candidates := configLanguageCandidates(language)
	if len(candidates) == 0 {
		return "", false
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, candidate := range candidates {
		if _, ok := m.configs[candidate]; ok {
			return candidate, true
		}
	}

	return "", false
}

func (m *Manager) resolveServerLanguage(language string) (string, bool) {
	candidates := configLanguageCandidates(language)
	if len(candidates) == 0 {
		return "", false
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, candidate := range candidates {
		if _, ok := m.servers[candidate]; ok {
			return candidate, true
		}
	}

	return "", false
}

func (m *Manager) HasConfig(language string) bool {
	_, ok := m.resolveConfiguredLanguage(language)
	return ok
}

func (m *Manager) logNoConfig(language string) {
	key := lspregistry.NormalizeLanguageToken(language)
	if key == "" {
		key = language
	}
	m.startMu.Lock()
	if m.noConfigLogged[key] {
		m.startMu.Unlock()
		return
	}
	m.noConfigLogged[key] = true
	m.startMu.Unlock()
	log.Printf("[LSP-MGR] No config for language: %s", language)
}

func (m *Manager) beginStart(language string) (chan struct{}, bool) {
	m.startMu.Lock()
	if ch, ok := m.starting[language]; ok {
		m.startMu.Unlock()
		return ch, false
	}
	ch := make(chan struct{})
	m.starting[language] = ch
	m.startMu.Unlock()
	return ch, true
}

func (m *Manager) endStart(language string, ch chan struct{}) {
	m.startMu.Lock()
	delete(m.starting, language)
	close(ch)
	m.startMu.Unlock()
}

func (m *Manager) activeStartFailure(language string) (startFailure, bool) {
	now := time.Now()
	keys := m.startFailureKeys(language)
	m.startMu.Lock()
	defer m.startMu.Unlock()
	for _, key := range keys {
		failure, ok := m.startFailures[key]
		if !ok {
			continue
		}
		if now.Before(failure.retryAt) {
			return failure, true
		}
		delete(m.startFailures, key)
	}
	return startFailure{}, false
}

func (m *Manager) recordStartFailure(language string, err error) {
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	reason := completionFallbackRejectedReason(err)
	backoff := m.startBackoff
	if errors.Is(err, context.DeadlineExceeded) {
		backoff = m.startTimeoutGap
	}
	if backoff <= 0 {
		return
	}
	now := time.Now()
	m.startMu.Lock()
	m.startFailures[language] = startFailure{
		err:     err.Error(),
		reason:  reason,
		at:      now,
		retryAt: now.Add(backoff),
	}
	m.startMu.Unlock()
}

func startFailureError(language string, failure startFailure) error {
	message := fmt.Sprintf("recent start failure for language %s: %s", language, failure.err)
	switch failure.reason {
	case "timeout":
		return fmt.Errorf("%w: %s", context.DeadlineExceeded, message)
	case "canceled":
		return fmt.Errorf("%w: %s", context.Canceled, message)
	default:
		return fmt.Errorf("%s", message)
	}
}

func (m *Manager) clearStartFailure(language string) {
	keys := m.startFailureKeys(language)
	m.startMu.Lock()
	defer m.startMu.Unlock()
	for _, key := range keys {
		delete(m.startFailures, key)
	}
}

func (m *Manager) startFailureKeys(language string) []string {
	keys := []string{language}
	if startKey := m.startKeyForLanguage(language); startKey != "" && startKey != language {
		keys = append(keys, startKey)
	}
	if !strings.HasPrefix(language, "language:") && !strings.HasPrefix(language, "group:") {
		keys = append(keys, "language:"+language)
	}
	return keys
}

func serverGroupKey(cfg ServerConfig) string {
	group := strings.TrimSpace(cfg.ServerGroup)
	if group == "" {
		return ""
	}
	return group
}

func (m *Manager) startKeyForLanguage(language string) string {
	language = strings.TrimSpace(language)
	if language == "" {
		return ""
	}
	m.mu.RLock()
	cfg, ok := m.configs[language]
	m.mu.RUnlock()
	if ok {
		if group := serverGroupKey(cfg); group != "" {
			return "group:" + group
		}
	}
	return "language:" + language
}

func (m *Manager) sharedServerLanguagesLocked(language string, server *Server) []string {
	if server == nil {
		return []string{language}
	}
	cfg, ok := m.configs[language]
	if !ok {
		cfg = server.config
	}
	group := serverGroupKey(cfg)
	languages := make([]string, 0, 4)
	for candidate, candidateCfg := range m.configs {
		if group == "" {
			if candidate == language {
				languages = append(languages, candidate)
			}
			continue
		}
		if serverGroupKey(candidateCfg) == group {
			languages = append(languages, candidate)
		}
	}
	if len(languages) == 0 {
		languages = append(languages, language)
	}
	sort.Strings(languages)
	return languages
}

func (m *Manager) publishServerAliasesLocked(language string, server *Server) []string {
	languages := m.sharedServerLanguagesLocked(language, server)
	for _, alias := range languages {
		m.servers[alias] = server
	}
	return languages
}

func (m *Manager) removeServerAliasesLocked(language string, server *Server) []string {
	languages := m.sharedServerLanguagesLocked(language, server)
	removed := make([]string, 0, len(languages))
	for _, alias := range languages {
		if current, ok := m.servers[alias]; ok && current == server {
			delete(m.servers, alias)
			removed = append(removed, alias)
		}
		if timer, ok := m.idleTimers[alias]; ok {
			timer.Stop()
			delete(m.idleTimers, alias)
		}
	}
	m.clearServerResourceTrackingLocked(server)
	return removed
}

func (m *Manager) detachServerPreservingOpenDocs(language string, server *Server) []string {
	if server == nil {
		return nil
	}
	m.mu.Lock()
	closedLanguages := m.removeServerAliasesLocked(language, server)
	m.markServerDocsUnsyncedLocked(server, closedLanguages)
	m.mu.Unlock()
	return closedLanguages
}

func (m *Manager) uniqueRunningServersLocked() []*Server {
	seen := make(map[*Server]bool, len(m.servers))
	servers := make([]*Server, 0, len(m.servers))
	for _, server := range m.servers {
		if server == nil || seen[server] || !server.running || !server.isProcessAlive() {
			continue
		}
		seen[server] = true
		servers = append(servers, server)
	}
	return servers
}

func uniqueServerPointers(servers []*Server) []*Server {
	if len(servers) <= 1 {
		return servers
	}
	seen := make(map[*Server]bool, len(servers))
	unique := make([]*Server, 0, len(servers))
	for _, server := range servers {
		if server == nil || seen[server] {
			continue
		}
		seen[server] = true
		unique = append(unique, server)
	}
	return unique
}

func (m *Manager) RegisterServer(cfg ServerConfig) {
	cfg = NormalizeServerConfig(cfg)
	cfg.Language = lspregistry.NormalizeLanguageToken(cfg.Language)
	if cfg.Language == "" {
		return
	}
	m.mu.Lock()
	m.configs[cfg.Language] = cfg
	delete(m.installerConfigs, cfg.Language)
	delete(m.installerBaseConfigs, cfg.Language)
	m.mu.Unlock()

	m.startMu.Lock()
	delete(m.noConfigLogged, cfg.Language)
	delete(m.startFailures, cfg.Language)
	m.startMu.Unlock()

	log.Printf("[LSP-MGR] Registered server for lang=%s cmd=%s", cfg.Language, cfg.Command)
}

func (m *Manager) ReplaceInstallerConfigs(configs []ServerConfig) {
	next := make(map[string]ServerConfig, len(configs))
	for _, cfg := range configs {
		cfg = NormalizeServerConfig(cfg)
		cfg.Language = lspregistry.NormalizeLanguageToken(cfg.Language)
		if cfg.Language == "" {
			continue
		}
		next[cfg.Language] = cfg
	}

	var removed []string
	var added []string
	var serversToStop []*Server
	resetLanguages := make(map[string]struct{})

	m.mu.Lock()
	if m.installerConfigs == nil {
		m.installerConfigs = make(map[string]bool)
	}
	if m.installerBaseConfigs == nil {
		m.installerBaseConfigs = make(map[string]ServerConfig)
	}
	for language := range m.installerConfigs {
		if _, ok := next[language]; ok {
			continue
		}
		removed = append(removed, language)
		resetLanguages[language] = struct{}{}
		delete(m.installerConfigs, language)
		if baseCfg, ok := m.installerBaseConfigs[language]; ok {
			m.configs[language] = baseCfg
			delete(m.installerBaseConfigs, language)
		} else {
			delete(m.configs, language)
			delete(m.openDocsByLang, language)
		}
		if timer, ok := m.idleTimers[language]; ok {
			timer.Stop()
			delete(m.idleTimers, language)
		}
		if server, ok := m.servers[language]; ok {
			serversToStop = append(serversToStop, server)
			m.removeServerAliasesLocked(language, server)
		}
	}
	for language, cfg := range next {
		if !m.installerConfigs[language] {
			if current, ok := m.configs[language]; ok {
				m.installerBaseConfigs[language] = current
			}
		}
		if current, ok := m.configs[language]; ok && !reflect.DeepEqual(current, cfg) {
			added = append(added, language)
			resetLanguages[language] = struct{}{}
			if server, ok := m.servers[language]; ok {
				serversToStop = append(serversToStop, server)
				m.removeServerAliasesLocked(language, server)
			}
			if timer, ok := m.idleTimers[language]; ok {
				timer.Stop()
				delete(m.idleTimers, language)
			}
		}
		if !m.installerConfigs[language] {
			added = append(added, language)
		}
		m.configs[language] = cfg
		m.installerConfigs[language] = true
	}
	resetDiagnosticsLanguages := make([]string, 0, len(resetLanguages))
	for language := range resetLanguages {
		delete(m.openDocsByLang, language)
		resetDiagnosticsLanguages = append(resetDiagnosticsLanguages, language)
	}
	m.mu.Unlock()
	serversToStop = uniqueServerPointers(serversToStop)

	if len(removed) > 0 || len(added) > 0 {
		m.startMu.Lock()
		for _, language := range removed {
			delete(m.noConfigLogged, language)
			delete(m.startFailures, language)
		}
		for _, language := range added {
			delete(m.noConfigLogged, language)
			delete(m.startFailures, language)
		}
		m.startMu.Unlock()
	}

	m.clearDiagnosticsForLanguages(resetDiagnosticsLanguages)
	for _, language := range resetDiagnosticsLanguages {
		m.clearCompletionCacheForLanguage(language)
	}
	for _, server := range serversToStop {
		if err := server.shutdown(); err != nil {
			log.Printf("[LSP-MGR] installer config shutdown failed err=%v", err)
		}
	}
}

func (m *Manager) ResetRuntimeState(languages []string, forgetOpenDocs bool) []string {
	if m == nil {
		return nil
	}
	resolved := make([]string, 0, len(languages))
	seen := make(map[string]bool, len(languages))
	for _, language := range languages {
		normalized, ok := m.resolveConfiguredLanguage(language)
		if !ok {
			normalized = lspregistry.NormalizeLanguageToken(language)
		}
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		resolved = append(resolved, normalized)
	}
	if len(resolved) == 0 {
		resolved = m.configuredLanguages()
		m.clearCompletionCache()
		m.clearAllTransientCloseDiagnosticsClears()
		m.startMu.Lock()
		m.startFailures = make(map[string]startFailure)
		m.noConfigLogged = make(map[string]bool)
		m.startMu.Unlock()
		if forgetOpenDocs {
			m.documentMu.Lock()
			m.mu.Lock()
			m.openDocsByLang = make(map[string]map[string]*openDocState)
			m.mu.Unlock()
			m.documentMu.Unlock()
		}
		m.clearDiagnosticsForLanguages(resolved)
		return resolved
	}
	m.startMu.Lock()
	for _, language := range resolved {
		delete(m.startFailures, language)
		delete(m.noConfigLogged, language)
	}
	m.startMu.Unlock()
	for _, language := range resolved {
		m.clearCompletionCacheForLanguage(language)
		m.clearDiagnosticsForLanguages([]string{language})
		if forgetOpenDocs {
			m.forceMarkLanguageClosed(language)
		}
	}
	return resolved
}

func (m *Manager) configuredLanguages() []string {
	if m == nil {
		return nil
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	languages := make([]string, 0, len(m.configs))
	for language := range m.configs {
		if strings.TrimSpace(language) == "" {
			continue
		}
		languages = append(languages, language)
	}
	sort.Strings(languages)
	return languages
}

func (m *Manager) ensureStarted(language string) (*Server, error) {
	return m.ensureStartedWithContext(context.Background(), language)
}

func (m *Manager) ensureStartedWithContext(ctx context.Context, language string) (*Server, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil, fmt.Errorf("no config for language: %s", language)
	}
	language = resolvedLanguage

	m.mu.RLock()
	server, ok := m.servers[language]
	m.mu.RUnlock()

	if ok && server.running && server.isProcessAlive() {
		m.clearStartFailure(m.startKeyForLanguage(language))
		return server, nil
	}
	if ok && (!server.running || !server.isProcessAlive()) {
		m.cleanupServerPreservingOpenDocs(language, server)
	}

	startKey := m.startKeyForLanguage(language)
	if failure, ok := m.activeStartFailure(startKey); ok {
		return nil, startFailureError(language, failure)
	}

	ch, shouldStart := m.beginStart(startKey)
	if !shouldStart {
		select {
		case <-ch:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		m.mu.RLock()
		server = m.servers[language]
		m.mu.RUnlock()
		if server != nil && server.running && server.isProcessAlive() {
			return server, nil
		}
		if failure, ok := m.activeStartFailure(startKey); ok {
			return nil, startFailureError(language, failure)
		}
		return nil, fmt.Errorf("server not started for language: %s", language)
	}
	defer m.endStart(startKey, ch)

	if err := m.StartWithContext(ctx, language); err != nil {
		return nil, err
	}

	m.mu.RLock()
	server = m.servers[language]
	m.mu.RUnlock()
	if server == nil {
		return nil, fmt.Errorf("no server for language after start: %s", language)
	}

	return server, nil
}

func (m *Manager) Start(language string) error {
	return m.StartWithContext(context.Background(), language)
}

func (m *Manager) StartWithContext(ctx context.Context, language string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	startReason := startReasonFromContext(ctx)
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return fmt.Errorf("no config for language: %s", language)
	}
	language = resolvedLanguage
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	m.mu.RLock()
	server, ok := m.servers[language]
	if ok && server.running && server.isProcessAlive() {
		m.mu.RUnlock()
		m.clearStartFailure(m.startKeyForLanguage(language))
		return nil
	}
	m.mu.RUnlock()
	if ok {
		m.cleanupServerPreservingOpenDocs(language, server)
	}

	m.mu.Lock()
	cfg, ok := m.configs[language]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("no config for language: %s", language)
	}

	startKey := m.startKeyForLanguage(language)
	server, err := m.startServer(ctx, cfg, startReason)
	if err != nil {
		m.recordStartFailure(startKey, err)
		return err
	}

	initStartedAt := time.Now()
	if err := server.initializeWithContext(ctx); err != nil {
		server.lastError = err.Error()
		_ = server.abortStartup()
		m.recordStartFailure(startKey, err)
		log.Printf("[LSP-MGR] initialized language=%s command=%s pid=%d reason=%s initDurationMs=%d status=failed error=%v",
			language,
			cfg.Command,
			lspProcessID(server),
			startReason,
			time.Since(initStartedAt).Milliseconds(),
			err,
		)
		return err
	}
	m.mu.Lock()
	m.publishServerAliasesLocked(language, server)
	m.mu.Unlock()
	if err := m.rehydrateOpenDocsForServer(ctx, language, server); err != nil {
		closedLanguages := m.detachServerPreservingOpenDocs(language, server)
		_ = server.shutdown()
		m.recordStartFailure(startKey, err)
		for _, closedLanguage := range closedLanguages {
			m.clearCompletionCacheForLanguage(closedLanguage)
		}
		return err
	}
	logLSPProcessPriority("initialized", cfg, lspProcessID(server), startReason, applyLSPProcessPriority(server.cmd))

	m.clearStartFailure(startKey)
	log.Printf("[LSP-MGR] initialized language=%s command=%s pid=%d root=%s reason=%s initDurationMs=%d status=initialized",
		language,
		cfg.Command,
		lspProcessID(server),
		cfg.RootURI,
		startReason,
		time.Since(initStartedAt).Milliseconds(),
	)
	return nil
}

func (m *Manager) Stop(language string) error {
	if resolvedLanguage, ok := m.resolveConfiguredLanguage(language); ok {
		language = resolvedLanguage
	} else {
		language = lspregistry.NormalizeLanguageToken(language)
	}

	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	m.mu.Lock()
	server, ok := m.servers[language]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	closedLanguages := m.removeServerAliasesLocked(language, server)
	m.mu.Unlock()
	for _, closedLanguage := range closedLanguages {
		m.forceMarkLanguageClosed(closedLanguage)
		m.clearCompletionCacheForLanguage(closedLanguage)
	}

	return server.shutdown()
}

func (m *Manager) cleanupServer(language string, server *Server) {
	if server == nil {
		return
	}
	shouldShutdown := false
	closedLanguages := []string(nil)
	m.mu.Lock()
	current, ok := m.servers[language]
	if ok && current == server {
		closedLanguages = m.removeServerAliasesLocked(language, server)
		shouldShutdown = true
	}
	m.mu.Unlock()
	if shouldShutdown {
		for _, closedLanguage := range closedLanguages {
			m.forceMarkLanguageClosed(closedLanguage)
			m.clearCompletionCacheForLanguage(closedLanguage)
		}
		if err := server.shutdown(); err != nil {
			log.Printf("[LSP-MGR] shutdown failed languages=%s err=%v", strings.Join(closedLanguages, ","), err)
		}
	}
}

func (m *Manager) cleanupServerPreservingOpenDocs(language string, server *Server) {
	if server == nil {
		return
	}
	closedLanguages := m.detachServerPreservingOpenDocs(language, server)
	for _, closedLanguage := range closedLanguages {
		m.clearCompletionCacheForLanguage(closedLanguage)
	}
	if err := server.shutdown(); err != nil {
		log.Printf("[LSP-MGR] shutdown failed languages=%s err=%v", strings.Join(closedLanguages, ","), err)
	}
}

func (m *Manager) StopAll() {
	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	m.mu.Lock()
	servers := make([]*Server, 0, len(m.servers))
	seen := make(map[*Server]bool, len(m.servers))
	for _, s := range m.servers {
		if s != nil && !seen[s] {
			servers = append(servers, s)
			seen[s] = true
		}
	}
	for _, timer := range m.idleTimers {
		timer.Stop()
	}
	for _, timer := range m.resourceRestartTimers {
		timer.Stop()
	}
	m.servers = make(map[string]*Server)
	m.idleTimers = make(map[string]*time.Timer)
	m.resourceChecks = make(map[*Server]time.Time)
	m.resourceRestartTimers = make(map[*Server]*time.Timer)
	m.openDocsByLang = make(map[string]map[string]*openDocState)
	m.mu.Unlock()
	m.clearCompletionCache()

	m.diagnosticsMu.Lock()
	m.diagnostics = make(map[string]map[string][]Diagnostic)
	m.diagnosticSeq = 0
	m.diagnosticSeen = make(map[string]uint64)
	m.transientCloseClears = make(map[string]struct{})
	m.onDiagnostics = nil
	m.diagnosticsMu.Unlock()

	var wg sync.WaitGroup
	for _, s := range servers {
		wg.Add(1)
		go func(server *Server) {
			defer wg.Done()
			if err := server.shutdown(); err != nil {
				log.Printf("[LSP-MGR] shutdown failed err=%v", err)
			}
		}(s)
	}
	wg.Wait()
}

// StartAll starts all registered language servers
// Returns a map of language -> error for any servers that failed to start
func (m *Manager) StartAll() map[string]error {
	m.mu.RLock()
	languages := make([]string, 0, len(m.configs))
	for lang := range m.configs {
		languages = append(languages, lang)
	}
	m.mu.RUnlock()

	errors := make(map[string]error)
	for _, lang := range languages {
		if err := m.Start(lang); err != nil {
			errors[lang] = err
		}
	}
	return errors
}

// HealthCheck returns the status of all registered LSP servers
func (m *Manager) HealthCheck() []ServerStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	statuses := make([]ServerStatus, 0, len(m.configs))
	for lang := range m.configs {
		status := ServerStatus{Language: lang}
		if server, ok := m.servers[lang]; ok {
			status.Running = server.running
			status.ProcessAlive = server.isProcessAlive()
			status.LastError = server.lastError
			status.Restarts = server.restarts
		}
		if status.LastError == "" {
			if failure, ok := m.activeStartFailure(lang); ok {
				status.LastError = failure.err
			}
		}
		statuses = append(statuses, status)
	}
	return statuses
}

// CheckAndRestart checks server health and restarts if needed
// Returns true if server was restarted
func (m *Manager) CheckAndRestart(language string) (bool, error) {
	return m.restartServer(language, false)
}

// ForceRestart restarts server regardless of current health state.
func (m *Manager) ForceRestart(language string) (bool, error) {
	return m.restartServer(language, true)
}

func (m *Manager) restartServer(language string, force bool) (bool, error) {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return false, fmt.Errorf("no config for language: %s", language)
	}
	language = resolvedLanguage

	m.mu.RLock()
	server, hasServer := m.servers[language]
	cfg, hasConfig := m.configs[language]
	m.mu.RUnlock()

	if !hasConfig {
		return false, fmt.Errorf("no config for language: %s", language)
	}
	startKey := m.startKeyForLanguage(language)
	m.clearStartFailure(startKey)
	m.clearCompletionCacheForLanguage(language)

	// Server not started, process died, or explicit force restart.
	needsRestart := force || !hasServer || (hasServer && !server.isProcessAlive())
	if !needsRestart {
		return false, nil
	}

	// Track restart count
	restartCount := 0
	if hasServer {
		restartCount = server.restarts + 1
		server.shutdown()
		m.mu.Lock()
		closedLanguages := m.removeServerAliasesLocked(language, server)
		m.mu.Unlock()
		for _, closedLanguage := range closedLanguages {
			m.forceMarkLanguageClosed(closedLanguage)
			m.clearCompletionCacheForLanguage(closedLanguage)
		}
	}

	// Start new server
	restartCtx := WithStartReason(context.Background(), "restart")
	newServer, err := m.startServer(restartCtx, cfg, "restart")
	if err != nil {
		m.recordStartFailure(startKey, err)
		return false, err
	}
	newServer.restarts = restartCount

	if err := newServer.initialize(); err != nil {
		newServer.lastError = err.Error()
		_ = newServer.shutdown()
		m.recordStartFailure(startKey, err)
		return false, err
	}

	m.mu.Lock()
	m.publishServerAliasesLocked(language, newServer)
	m.mu.Unlock()
	if err := m.rehydrateOpenDocsForServer(restartCtx, language, newServer); err != nil {
		closedLanguages := m.detachServerPreservingOpenDocs(language, newServer)
		_ = newServer.shutdown()
		m.recordStartFailure(startKey, err)
		for _, closedLanguage := range closedLanguages {
			m.clearCompletionCacheForLanguage(closedLanguage)
		}
		return false, err
	}
	m.clearStartFailure(startKey)

	return true, nil
}

// IsServerHealthy returns true if the server is running and responsive
func (m *Manager) IsServerHealthy(language string) bool {
	resolvedLanguage, ok := m.resolveServerLanguage(language)
	if !ok {
		return false
	}

	m.mu.RLock()
	server, ok := m.servers[resolvedLanguage]
	m.mu.RUnlock()
	if !ok {
		return false
	}
	return server.running && server.isProcessAlive()
}

func (m *Manager) Complete(language, filePath string, line, column int) ([]CompletionItem, error) {
	return m.CompleteWithContext(context.Background(), language, filePath, line, column)
}

func (m *Manager) CompleteWithContext(ctx context.Context, language, filePath string, line, column int) ([]CompletionItem, error) {
	return m.CompleteWithTrigger(ctx, language, filePath, line, column, CompletionTrigger{})
}

func (m *Manager) CompleteWithTrigger(ctx context.Context, language, filePath string, line, column int, trigger CompletionTrigger) ([]CompletionItem, error) {
	result, err := m.CompleteWithTriggerResult(ctx, language, filePath, line, column, trigger)
	return result.Items, err
}

func (m *Manager) CompleteWithTriggerResult(ctx context.Context, language, filePath string, line, column int, trigger CompletionTrigger) (CompletionResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	trigger = trigger.normalized()

	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return CompletionResponse{}, fmt.Errorf("%w: %s", ErrNoConfig, language)
	}
	language = resolvedLanguage
	select {
	case <-ctx.Done():
		return CompletionResponse{}, ctx.Err()
	default:
	}

	version := m.docVersion(language, filePath)
	epoch := m.completionCacheEpoch()
	cacheKey := fmt.Sprintf("%d|%s|%s|%d|%d|%d|%d|%s|%t|%t|%t", epoch, language, filePath, line, column, version, trigger.TriggerKind, trigger.TriggerCharacter, trigger.RetryInvokedOnEmpty, trigger.RetryInvokedOnIncomplete, trigger.AccessMemberIntent)
	if result, ok := m.getCompletionCache(cacheKey); ok {
		return result.response, result.err
	}
	if flight, wait := m.beginCompletion(cacheKey); wait {
		select {
		case <-flight.done:
			result := flight.result
			return result.response, result.err
		case <-ctx.Done():
			return CompletionResponse{}, ctx.Err()
		case <-time.After(m.completionWait):
			return CompletionResponse{}, context.DeadlineExceeded
		}
	}
	finish := func(result completionResult) {
		if result.createdAt.IsZero() {
			result.createdAt = time.Now()
		}
		m.endCompletion(cacheKey, result)
	}

	server, err := m.ensureStartedWithContext(ctx, language)
	if err != nil {
		log.Printf("[LSP-MGR] Complete: start failed lang=%s err=%v", language, err)
		finish(completionResult{err: err})
		return CompletionResponse{}, err
	}
	defer m.maybeCheckServerResources(language, server, "completion")
	if err := m.ensureDocSyncedForRequest(ctx, language, filePath, server); err != nil {
		finish(completionResult{err: err})
		return CompletionResponse{}, err
	}

	positionLine, positionColumn := editorPositionToLSPPosition(line, column)
	response, err := server.completeWithContext(ctx, filePath, positionLine, positionColumn, trigger)
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		finish(completionResult{err: err})
		return CompletionResponse{}, err
	}
	result := completionResult{response: response, err: err, createdAt: time.Now()}
	if shouldCacheCompletionResult(response, err, trigger) && m.completionCacheEpoch() == epoch {
		m.setCompletionCache(cacheKey, result)
	}
	finish(result)
	if err != nil {
		log.Printf("[LSP-MGR] Complete error for lang=%s: %v", language, err)
	}
	return response, err
}

func shouldCacheCompletionResult(response CompletionResponse, err error, trigger CompletionTrigger) bool {
	if err != nil {
		return false
	}
	if response.UsedInvokedFallback {
		return false
	}
	if response.InvokedFallbackRejected {
		return false
	}
	if trigger.RetryInvokedOnEmpty && len(response.Items) == 0 {
		return false
	}
	if trigger.RetryInvokedOnIncomplete && response.IsIncomplete {
		return false
	}
	return true
}

func editorPositionToLSPPosition(line, column int) (int, int) {
	positionLine := line - 1
	positionColumn := column - 1
	if positionLine < 0 {
		positionLine = 0
	}
	if positionColumn < 0 {
		positionColumn = 0
	}
	return positionLine, positionColumn
}

func (m *Manager) CompletionCapabilities(language string) CompletionCapabilities {
	var empty CompletionCapabilities
	if m == nil {
		return empty
	}
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return empty
	}
	m.mu.RLock()
	server := m.servers[resolvedLanguage]
	m.mu.RUnlock()
	if server == nil {
		return empty
	}
	return server.completionCapabilities()
}

func (m *Manager) ResolveCompletionItemWithContext(ctx context.Context, language string, item CompletionItem) (CompletionItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return item, nil
	}
	server, err := m.ensureStartedWithContext(ctx, resolvedLanguage)
	if err != nil {
		return item, err
	}
	defer m.maybeCheckServerResources(resolvedLanguage, server, "completion_resolve")
	resolved, err := server.resolveCompletionItemWithContext(ctx, item)
	if err != nil {
		return item, err
	}
	return normalizeCompletionItem(mergeCompletionItem(item, resolved)), nil
}

func (m *Manager) resolveCompletionItems(ctx context.Context, server *Server, items []CompletionItem) []CompletionItem {
	if server == nil || len(items) == 0 {
		return items
	}
	if ctx == nil {
		ctx = context.Background()
	}

	maxResolve := 5
	if len(items) < maxResolve {
		maxResolve = len(items)
	}

	resolved := make([]CompletionItem, len(items))
	copy(resolved, items)

	for i := 0; i < maxResolve; i++ {
		select {
		case <-ctx.Done():
			return resolved
		default:
		}
		item := resolved[i]
		if item.Data == nil || len(item.AdditionalTextEdits) > 0 {
			continue
		}
		resolvedItem, err := server.resolveCompletionItemWithContext(ctx, item)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return resolved
			}
			continue
		}
		resolved[i] = normalizeCompletionItem(mergeCompletionItem(item, resolvedItem))
	}

	return resolved
}

func (m *Manager) getAvailableLanguages() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var langs []string
	for lang := range m.servers {
		langs = append(langs, lang)
	}
	return langs
}

func (m *Manager) GetServer(language string) (*Server, bool) {
	resolvedLanguage, ok := m.resolveServerLanguage(language)
	if !ok {
		resolvedLanguage, ok = m.resolveConfiguredLanguage(language)
		if !ok {
			return nil, false
		}
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	server, ok := m.servers[resolvedLanguage]
	return server, ok
}

func (m *Manager) runningServerForLanguage(language string) (*Server, bool) {
	m.mu.RLock()
	server := m.servers[language]
	m.mu.RUnlock()
	if server == nil || !server.running || !server.isProcessAlive() {
		return nil, false
	}
	return server, true
}

func (m *Manager) HasWarmServerForLanguage(language string) bool {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return false
	}
	_, ok = m.runningServerForLanguage(resolvedLanguage)
	return ok
}

type rehydrateOpenDoc struct {
	language   string
	filePath   string
	content    string
	languageID string
	version    int
}

func (m *Manager) rehydrateOpenDocsForServer(ctx context.Context, language string, server *Server) error {
	if server == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	docs := make([]rehydrateOpenDoc, 0)
	m.mu.RLock()
	languages := m.sharedServerLanguagesLocked(language, server)
	for _, candidate := range languages {
		for filePath, state := range m.openDocsByLang[candidate] {
			if state == nil || !state.userOpen || state.syncedServer == server || state.content == "" {
				continue
			}
			languageID := state.languageID
			if languageID == "" {
				languageID = normalizeLanguageID(candidate)
			}
			version := state.version
			if version <= 0 {
				version = 1
			}
			docs = append(docs, rehydrateOpenDoc{
				language:   candidate,
				filePath:   filePath,
				content:    state.content,
				languageID: languageID,
				version:    version,
			})
		}
	}
	m.mu.RUnlock()

	for _, doc := range docs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := server.DidOpen(doc.filePath, doc.languageID, doc.content); err != nil {
			return err
		}
		m.markDocUserOpenWithContent(doc.language, doc.filePath, doc.version, doc.content, server)
		if doc.version > 1 {
			if err := server.DidChange(doc.filePath, doc.version, doc.content); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *Manager) ensureDocSyncedForRequest(ctx context.Context, language, filePath string, server *Server) error {
	if server == nil || m.isDocSynced(language, filePath, server) {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	m.mu.RLock()
	state := m.openDocsByLang[language][filePath]
	if state == nil || !state.userOpen || state.content == "" {
		m.mu.RUnlock()
		return nil
	}
	content := state.content
	languageID := state.languageID
	if languageID == "" {
		languageID = normalizeLanguageID(language)
	}
	version := state.version
	if version <= 0 {
		version = 1
	}
	m.mu.RUnlock()

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	if err := server.DidOpen(filePath, languageID, content); err != nil {
		return err
	}
	m.markDocUserOpenWithContent(language, filePath, version, content, server)
	if version > 1 {
		if err := server.DidChange(filePath, version, content); err != nil {
			return err
		}
	}
	return nil
}

// DidOpen notifies the LSP server that a file has been opened.
func (m *Manager) DidOpen(language, filePath, content string) error {
	return m.DidOpenWithContext(context.Background(), language, filePath, content)
}

func (m *Manager) DidOpenWithContext(ctx context.Context, language, filePath, content string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil
	}
	language = resolvedLanguage
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	m.clearTransientCloseDiagnosticsClear(language, filePath)

	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	if state, ok := m.docState(language, filePath); ok {
		m.mu.RLock()
		server := m.servers[language]
		m.mu.RUnlock()
		if state.userOpen && server != nil && server.running && server.isProcessAlive() && state.syncedServer == server {
			m.markDocUserOpenWithContent(language, filePath, state.version, content, server)
			return nil
		}
		var err error
		server, err = m.ensureStartedWithContext(ctx, language)
		if err != nil {
			log.Printf("[LSP-MGR] DidOpen: start failed lang=%s err=%v", language, err)
			return err
		}
		if !m.isDocSynced(language, filePath, server) {
			langID := normalizeLanguageID(language)
			if err := server.DidOpen(filePath, langID, content); err != nil {
				return err
			}
			m.markDocUserOpenWithContent(language, filePath, 1, content, server)
			m.clearCompletionCacheForFile(language, filePath)
			return nil
		}
		currentState, _ := m.docState(language, filePath)
		version := currentState.version
		if version <= 0 {
			version = 1
		}
		if content != currentState.content {
			version++
			if err := server.DidChange(filePath, version, content); err != nil {
				return err
			}
		}
		m.markDocUserOpenWithContent(language, filePath, version, content, server)
		m.clearCompletionCacheForFile(language, filePath)
		return nil
	}

	server, err := m.ensureStartedWithContext(ctx, language)
	if err != nil {
		log.Printf("[LSP-MGR] DidOpen: start failed lang=%s err=%v", language, err)
		return err
	}

	langID := normalizeLanguageID(language)
	if err := server.DidOpen(filePath, langID, content); err != nil {
		return err
	}
	m.markDocUserOpenWithContent(language, filePath, 1, content, server)
	m.clearCompletionCacheForFile(language, filePath)
	return nil
}

// DidOpenTransientWithContext opens a document for short-lived background work
// such as diagnostics preload. The document remains open until the matching
// DidCloseTransient call, unless a user-owned open takes over first.
func (m *Manager) DidOpenTransientWithContext(ctx context.Context, language, filePath, content string) (bool, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return false, nil
	}
	language = resolvedLanguage
	select {
	case <-ctx.Done():
		return false, ctx.Err()
	default:
	}

	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	allowColdStart := coldStartAllowedFromContext(ctx)
	if state, ok := m.docState(language, filePath); ok {
		if state.userOpen {
			return false, nil
		}
		if _, ok := m.runningServerForLanguage(language); !ok && !allowColdStart {
			return false, nil
		}
		server, err := m.ensureStartedWithContext(ctx, language)
		if err != nil {
			log.Printf("[LSP-MGR] DidOpenTransient: start failed lang=%s err=%v", language, err)
			return false, err
		}
		if !m.isDocSynced(language, filePath, server) {
			langID := normalizeLanguageID(language)
			if err := server.DidOpen(filePath, langID, content); err != nil {
				return false, err
			}
			m.markDocTransientOpenWithContent(language, filePath, 1, content, server)
			return true, nil
		}
		m.retainDocTransient(language, filePath)
		return true, nil
	}

	if _, ok := m.runningServerForLanguage(language); !ok && !allowColdStart {
		return false, nil
	}
	server, err := m.ensureStartedWithContext(ctx, language)
	if err != nil {
		log.Printf("[LSP-MGR] DidOpenTransient: start failed lang=%s err=%v", language, err)
		return false, err
	}

	langID := normalizeLanguageID(language)
	if err := server.DidOpen(filePath, langID, content); err != nil {
		return false, err
	}
	m.markDocTransientOpenWithContent(language, filePath, 1, content, server)
	return true, nil
}

// DidChange notifies the LSP server that a file has been modified
func (m *Manager) DidChange(language, filePath string, version int, content string) error {
	return m.DidChangeWithContext(context.Background(), language, filePath, version, content)
}

func (m *Manager) DidChangeWithContext(ctx context.Context, language, filePath string, version int, content string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil
	}
	language = resolvedLanguage
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	m.clearTransientCloseDiagnosticsClear(language, filePath)

	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	if version <= 0 {
		version = m.docVersion(language, filePath) + 1
		if version <= 0 {
			version = 1
		}
	}

	server, err := m.ensureStartedWithContext(ctx, language)
	if err != nil {
		log.Printf("[LSP-MGR] DidChange: start failed lang=%s err=%v", language, err)
		return err
	}
	openedForServer := false
	if !m.isDocSynced(language, filePath, server) {
		langID := normalizeLanguageID(language)
		if err := server.DidOpen(filePath, langID, content); err != nil {
			return err
		}
		openedForServer = true
		m.markDocUserOpenWithContent(language, filePath, 1, content, server)
		if version <= 1 {
			return nil
		}
	}
	if current := m.docVersion(language, filePath); !openedForServer && current >= version {
		m.markDocUserOpenWithContent(language, filePath, current, content, server)
		return nil
	}

	if err := server.DidChange(filePath, version, content); err != nil {
		return err
	}
	m.markDocUserOpenWithContent(language, filePath, version, content, server)
	m.clearCompletionCacheForFile(language, filePath)
	return nil
}

// DidClose notifies the LSP server that a file has been closed
func (m *Manager) DidClose(language, filePath string) error {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return nil
	}
	language = resolvedLanguage

	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	m.mu.RLock()
	server, ok := m.servers[language]
	m.mu.RUnlock()

	if !ok {
		m.forceMarkDocClosed(language, filePath)
		m.clearCompletionCacheForFile(language, filePath)
		return nil
	}

	if !server.running || !server.isProcessAlive() {
		m.cleanupServer(language, server)
		m.clearCompletionCacheForFile(language, filePath)
		return nil
	}

	decision := m.prepareDocUserClose(language, filePath)
	if !decision.known {
		m.clearCompletionCacheForFile(language, filePath)
		return nil
	}
	if !decision.shouldClose {
		return nil
	}

	m.suppressTransientCloseDiagnosticsClear(language, filePath)
	if err := server.DidClose(filePath); err != nil {
		m.cleanupServer(language, server)
		return err
	}
	m.commitDocUserClose(language, filePath)
	m.clearCompletionCacheForFile(language, filePath)
	m.scheduleIdleStop(language)
	return nil
}

// DidCloseTransient releases a background-only document open. If the user has
// opened the document while the transient owner was active, this does not send
// textDocument/didClose to the server.
func (m *Manager) DidCloseTransient(language, filePath string) error {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return nil
	}
	language = resolvedLanguage

	m.documentMu.Lock()
	defer m.documentMu.Unlock()

	decision := m.prepareDocTransientClose(language, filePath)
	if !decision.known || !decision.shouldClose {
		return nil
	}

	m.mu.RLock()
	server, ok := m.servers[language]
	m.mu.RUnlock()

	if !ok {
		m.forceMarkDocClosed(language, filePath)
		m.clearCompletionCacheForFile(language, filePath)
		return nil
	}
	if !server.running || !server.isProcessAlive() {
		m.cleanupServer(language, server)
		m.clearCompletionCacheForFile(language, filePath)
		return nil
	}
	m.suppressTransientCloseDiagnosticsClear(language, filePath)
	if err := server.DidClose(filePath); err != nil {
		m.cleanupServer(language, server)
		return err
	}
	m.commitDocTransientClose(language, filePath)
	m.clearCompletionCacheForFile(language, filePath)
	m.scheduleTransientIdleStop(language)
	return nil
}

func (m *Manager) GetDiagnostics(language, filePath string) []Diagnostic {
	candidates := configLanguageCandidates(language)
	if len(candidates) == 0 {
		return nil
	}

	m.diagnosticsMu.RLock()
	defer m.diagnosticsMu.RUnlock()
	for _, candidate := range candidates {
		langDiagnostics := m.diagnostics[candidate]
		if langDiagnostics == nil {
			continue
		}

		diagnostics := langDiagnostics[filePath]
		if len(diagnostics) == 0 {
			continue
		}

		result := make([]Diagnostic, len(diagnostics))
		copy(result, diagnostics)
		return result
	}

	return nil
}

func (m *Manager) CodeAction(language, filePath string, line, column int, diagnostics []Diagnostic) ([]CodeAction, error) {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil, nil
	}
	language = resolvedLanguage

	server, err := m.ensureStarted(language)
	if err != nil {
		log.Printf("[LSP-MGR] CodeAction: start failed lang=%s err=%v", language, err)
		return nil, nil
	}
	defer m.maybeCheckServerResources(language, server, "code_action")
	if err := m.ensureDocSyncedForRequest(context.Background(), language, filePath, server); err != nil {
		return nil, err
	}

	actions, err := server.CodeActionWithContext(context.Background(), filePath, line, column, diagnostics)
	if err != nil {
		log.Printf("[LSP-MGR] CodeAction error lang=%s err=%v", language, err)
		return nil, err
	}

	return actions, nil
}

func (m *Manager) WillRenameFiles(ctx context.Context, files []FileRename) (*WorkspaceEdit, error) {
	if len(files) == 0 {
		return nil, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	m.mu.RLock()
	servers := m.uniqueRunningServersLocked()
	m.mu.RUnlock()

	var merged *WorkspaceEdit
	for _, server := range servers {
		edit, err := server.WillRenameFilesWithContext(ctx, files)
		if err != nil {
			log.Printf("[LSP-MGR] willRenameFiles ignored: %v", err)
			continue
		}
		if edit == nil {
			continue
		}
		if merged == nil {
			merged = &WorkspaceEdit{}
		}
		if len(edit.Changes) > 0 {
			if merged.Changes == nil {
				merged.Changes = make(map[string][]TextEdit, len(edit.Changes))
			}
			for uri, edits := range edit.Changes {
				merged.Changes[uri] = append(merged.Changes[uri], edits...)
			}
		}
		if len(edit.DocumentChanges) > 0 {
			merged.DocumentChanges = append(merged.DocumentChanges, edit.DocumentChanges...)
		}
	}

	return merged, nil
}

func (m *Manager) DidRenameFiles(files []FileRename) {
	if len(files) == 0 {
		return
	}

	m.remapDiagnosticsForRenames(files)
	m.remapOpenDocsForRenames(files)
	m.clearCompletionCache()

	m.mu.RLock()
	servers := m.uniqueRunningServersLocked()
	m.mu.RUnlock()

	for _, server := range servers {
		if err := server.DidRenameFiles(files); err != nil {
			log.Printf("[LSP-MGR] didRenameFiles ignored: %v", err)
		}
	}
}

func (m *Manager) PruneDiagnosticsForPath(pathPrefix string) {
	pathPrefix = filepath.Clean(strings.TrimSpace(pathPrefix))
	if pathPrefix == "." || pathPrefix == "" {
		return
	}

	type prunedDiagnostic struct {
		language string
		filePath string
	}
	pruned := make([]prunedDiagnostic, 0)
	m.diagnosticsMu.Lock()
	callback := m.onDiagnostics
	for language, langDiagnostics := range m.diagnostics {
		for filePath := range langDiagnostics {
			if !isSameOrChildPath(filePath, pathPrefix) {
				continue
			}
			delete(langDiagnostics, filePath)
			delete(m.diagnosticSeen, DiagnosticsPublicationKey(language, filePath))
			m.clearTransientCloseDiagnosticsClearLocked(language, filePath)
			m.diagnosticSeq++
			pruned = append(pruned, prunedDiagnostic{language: language, filePath: filePath})
		}
		if len(langDiagnostics) == 0 {
			delete(m.diagnostics, language)
		}
	}
	m.diagnosticsMu.Unlock()

	if callback != nil {
		for _, item := range pruned {
			callback(item.language, item.filePath, nil)
		}
	}
}

func (m *Manager) remapDiagnosticsForRenames(files []FileRename) {
	type renamePair struct {
		oldPath string
		newPath string
	}
	pairs := make([]renamePair, 0, len(files))
	for _, file := range files {
		oldPath := filepath.Clean(fileURIToPath(file.OldURI))
		newPath := filepath.Clean(fileURIToPath(file.NewURI))
		if oldPath == "." || newPath == "." || oldPath == "" || newPath == "" || oldPath == newPath {
			continue
		}
		pairs = append(pairs, renamePair{oldPath: oldPath, newPath: newPath})
	}
	if len(pairs) == 0 {
		return
	}

	m.diagnosticsMu.Lock()
	for language, langDiagnostics := range m.diagnostics {
		nextDiagnostics := make(map[string][]Diagnostic, len(langDiagnostics))
		for filePath, diagnostics := range langDiagnostics {
			nextPath := filepath.Clean(filePath)
			for _, pair := range pairs {
				if remapped, ok := remapPathPrefix(nextPath, pair.oldPath, pair.newPath); ok {
					nextPath = remapped
				}
			}
			nextDiagnostics[nextPath] = cloneDiagnostics(diagnostics)
		}
		m.diagnostics[language] = nextDiagnostics
	}

	nextSeen := make(map[string]uint64, len(m.diagnosticSeen))
	for key, seq := range m.diagnosticSeen {
		language, filePath, ok := splitDiagnosticsPublicationKey(key)
		if !ok {
			nextSeen[key] = seq
			continue
		}
		nextPath := filepath.Clean(filePath)
		for _, pair := range pairs {
			if remapped, ok := remapPathPrefix(nextPath, pair.oldPath, pair.newPath); ok {
				nextPath = remapped
			}
		}
		nextSeen[DiagnosticsPublicationKey(language, nextPath)] = seq
	}
	m.diagnosticSeen = nextSeen

	if len(m.transientCloseClears) > 0 {
		nextSuppressions := make(map[string]struct{}, len(m.transientCloseClears))
		for key := range m.transientCloseClears {
			language, filePath, ok := splitDiagnosticsPublicationKey(key)
			if !ok {
				nextSuppressions[key] = struct{}{}
				continue
			}
			nextPath := filepath.Clean(filePath)
			for _, pair := range pairs {
				if remapped, ok := remapPathPrefix(nextPath, pair.oldPath, pair.newPath); ok {
					nextPath = remapped
				}
			}
			nextSuppressions[DiagnosticsPublicationKey(language, nextPath)] = struct{}{}
		}
		m.transientCloseClears = nextSuppressions
	}
	m.diagnosticsMu.Unlock()
}

func (m *Manager) remapOpenDocsForRenames(files []FileRename) {
	type renamePair struct {
		oldPath string
		newPath string
	}
	pairs := make([]renamePair, 0, len(files))
	for _, file := range files {
		oldPath := filepath.Clean(fileURIToPath(file.OldURI))
		newPath := filepath.Clean(fileURIToPath(file.NewURI))
		if oldPath == "." || newPath == "." || oldPath == "" || newPath == "" || oldPath == newPath {
			continue
		}
		pairs = append(pairs, renamePair{oldPath: oldPath, newPath: newPath})
	}
	if len(pairs) == 0 {
		return
	}

	m.mu.Lock()
	for language, openDocs := range m.openDocsByLang {
		nextDocs := make(map[string]*openDocState, len(openDocs))
		for filePath, state := range openDocs {
			nextPath := filepath.Clean(filePath)
			for _, pair := range pairs {
				if remapped, ok := remapPathPrefix(nextPath, pair.oldPath, pair.newPath); ok {
					nextPath = remapped
				}
			}
			nextState := *state
			nextDocs[nextPath] = &nextState
		}
		m.openDocsByLang[language] = nextDocs
	}
	m.mu.Unlock()
}

func (m *Manager) handleNotification(language, method string, params json.RawMessage) {
	if method != "textDocument/publishDiagnostics" {
		return
	}

	var payload PublishDiagnosticsParams
	if err := json.Unmarshal(params, &payload); err != nil {
		return
	}

	filePath := fileURIToPath(payload.URI)
	if filePath == "" {
		return
	}

	m.setDiagnostics(m.languageForDiagnostics(language, filePath), filePath, payload.Diagnostics)
}

func (m *Manager) languageForDiagnostics(defaultLanguage string, filePath string) string {
	defaultLanguage = lspregistry.NormalizeLanguageToken(defaultLanguage)
	filePath = filepath.Clean(strings.TrimSpace(filePath))
	if filePath == "" {
		return defaultLanguage
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for language, docs := range m.openDocsByLang {
		if _, ok := docs[filePath]; ok {
			return language
		}
	}
	return defaultLanguage
}

func (m *Manager) setDiagnostics(language, filePath string, diagnostics []Diagnostic) {
	cloned := cloneDiagnostics(diagnostics)

	m.diagnosticsMu.Lock()
	if len(cloned) == 0 && m.shouldSuppressTransientCloseDiagnosticsClearLocked(language, filePath) {
		m.diagnosticsMu.Unlock()
		return
	}
	m.diagnosticSeq++
	m.diagnosticSeen[DiagnosticsPublicationKey(language, filePath)] = m.diagnosticSeq
	callback := m.onDiagnostics
	if len(cloned) == 0 {
		langDiagnostics := m.diagnostics[language]
		if langDiagnostics != nil {
			delete(langDiagnostics, filePath)
			if len(langDiagnostics) == 0 {
				delete(m.diagnostics, language)
			}
		}
		m.diagnosticsMu.Unlock()
		if callback != nil {
			callback(language, filePath, nil)
		}
		return
	}

	if m.diagnostics[language] == nil {
		m.diagnostics[language] = make(map[string][]Diagnostic)
	}
	m.clearTransientCloseDiagnosticsClearLocked(language, filePath)
	m.diagnostics[language][filePath] = cloned
	m.diagnosticsMu.Unlock()

	if callback != nil {
		callback(language, filePath, cloneDiagnostics(cloned))
	}
}

func DiagnosticsPublicationKey(language, filePath string) string {
	language = lspregistry.NormalizeLanguageToken(language)
	filePath = strings.TrimSpace(filePath)
	if filePath != "" {
		filePath = filepath.Clean(filePath)
	}
	return language + "\x00" + filePath
}

func splitDiagnosticsPublicationKey(key string) (string, string, bool) {
	language, filePath, ok := strings.Cut(key, "\x00")
	return language, filePath, ok
}

func transientDiagnosticsClearKey(language, filePath string) string {
	return DiagnosticsPublicationKey(language, filePath)
}

func isSameOrChildPath(path, prefix string) bool {
	path = filepath.Clean(path)
	prefix = filepath.Clean(prefix)
	if path == prefix {
		return true
	}
	rel, err := filepath.Rel(prefix, path)
	if err != nil || rel == "." || rel == ".." {
		return false
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func remapPathPrefix(path, oldPrefix, newPrefix string) (string, bool) {
	path = filepath.Clean(path)
	oldPrefix = filepath.Clean(oldPrefix)
	newPrefix = filepath.Clean(newPrefix)
	if !isSameOrChildPath(path, oldPrefix) {
		return path, false
	}
	rel, err := filepath.Rel(oldPrefix, path)
	if err != nil || rel == "." {
		return newPrefix, true
	}
	return filepath.Clean(filepath.Join(newPrefix, rel)), true
}

func (m *Manager) suppressTransientCloseDiagnosticsClear(language, filePath string) {
	m.diagnosticsMu.Lock()
	if m.transientCloseClears == nil {
		m.transientCloseClears = make(map[string]struct{})
	}
	m.transientCloseClears[transientDiagnosticsClearKey(language, filePath)] = struct{}{}
	m.trimTransientCloseDiagnosticsClearsLocked()
	m.diagnosticsMu.Unlock()
}

func (m *Manager) shouldSuppressTransientCloseDiagnosticsClearLocked(language, filePath string) bool {
	if len(m.transientCloseClears) == 0 {
		return false
	}
	key := transientDiagnosticsClearKey(language, filePath)
	_, ok := m.transientCloseClears[key]
	return ok
}

func (m *Manager) clearTransientCloseDiagnosticsClear(language, filePath string) {
	m.diagnosticsMu.Lock()
	m.clearTransientCloseDiagnosticsClearLocked(language, filePath)
	m.diagnosticsMu.Unlock()
}

func (m *Manager) clearAllTransientCloseDiagnosticsClears() {
	m.diagnosticsMu.Lock()
	m.transientCloseClears = make(map[string]struct{})
	m.diagnosticsMu.Unlock()
}

func (m *Manager) clearTransientCloseDiagnosticsClearLocked(language, filePath string) {
	if len(m.transientCloseClears) == 0 {
		return
	}
	delete(m.transientCloseClears, transientDiagnosticsClearKey(language, filePath))
}

func (m *Manager) clearTransientCloseDiagnosticsClearsForLanguagesLocked(languages map[string]bool) {
	if len(m.transientCloseClears) == 0 || len(languages) == 0 {
		return
	}
	for key := range m.transientCloseClears {
		language, _, ok := strings.Cut(key, "\x00")
		if ok && languages[language] {
			delete(m.transientCloseClears, key)
		}
	}
}

func (m *Manager) trimTransientCloseDiagnosticsClearsLocked() {
	if len(m.transientCloseClears) <= transientCloseDiagnosticsClearMaxEntries {
		return
	}
	for key := range m.transientCloseClears {
		delete(m.transientCloseClears, key)
		if len(m.transientCloseClears) <= transientCloseDiagnosticsClearMaxEntries {
			return
		}
	}
}

func (m *Manager) clearDiagnostics(language, filePath string) {
	m.diagnosticsMu.Lock()
	m.diagnosticSeq++
	m.diagnosticSeen[DiagnosticsPublicationKey(language, filePath)] = m.diagnosticSeq
	callback := m.onDiagnostics
	m.clearTransientCloseDiagnosticsClearLocked(language, filePath)
	langDiagnostics := m.diagnostics[language]
	if langDiagnostics != nil {
		delete(langDiagnostics, filePath)
		if len(langDiagnostics) == 0 {
			delete(m.diagnostics, language)
		}
	}
	m.diagnosticsMu.Unlock()

	if callback != nil {
		callback(language, filePath, nil)
	}
}

func (m *Manager) clearDiagnosticsForLanguages(languages []string) {
	if len(languages) == 0 {
		return
	}
	type clearedDiagnostic struct {
		language string
		filePath string
	}
	languageSet := make(map[string]bool, len(languages))
	for _, language := range languages {
		language = lspregistry.NormalizeLanguageToken(language)
		if language != "" {
			languageSet[language] = true
		}
	}
	if len(languageSet) == 0 {
		return
	}

	var cleared []clearedDiagnostic
	m.diagnosticsMu.Lock()
	callback := m.onDiagnostics
	for language := range languageSet {
		langDiagnostics := m.diagnostics[language]
		for filePath := range langDiagnostics {
			m.diagnosticSeq++
			m.diagnosticSeen[DiagnosticsPublicationKey(language, filePath)] = m.diagnosticSeq
			cleared = append(cleared, clearedDiagnostic{language: language, filePath: filePath})
		}
		delete(m.diagnostics, language)
	}
	m.clearTransientCloseDiagnosticsClearsForLanguagesLocked(languageSet)
	m.diagnosticsMu.Unlock()

	if callback != nil {
		for _, item := range cleared {
			callback(item.language, item.filePath, nil)
		}
	}
}

func (m *Manager) WaitForDiagnosticsPublications(ctx context.Context, targets []DiagnosticsPublicationTarget) bool {
	return m.WaitForDiagnosticsPublicationsSince(ctx, m.CaptureDiagnosticsPublicationBaseline(targets))
}

func (m *Manager) CaptureDiagnosticsPublicationBaseline(targets []DiagnosticsPublicationTarget) map[string]uint64 {
	tracked := make(map[string]uint64, len(targets))
	for _, target := range targets {
		if strings.TrimSpace(target.FilePath) == "" {
			continue
		}
		key := DiagnosticsPublicationKey(target.Language, target.FilePath)
		if strings.HasPrefix(key, "\x00") {
			continue
		}
		tracked[key] = 0
	}
	if len(tracked) == 0 {
		return tracked
	}

	m.diagnosticsMu.RLock()
	for key := range tracked {
		tracked[key] = m.diagnosticSeen[key]
	}
	m.diagnosticsMu.RUnlock()
	return tracked
}

func (m *Manager) WaitForDiagnosticsPublicationsSince(ctx context.Context, tracked map[string]uint64) bool {
	if m.haveDiagnosticsPublicationsSince(tracked) {
		return true
	}

	ticker := time.NewTicker(diagnosticsPublishPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
			if m.haveDiagnosticsPublicationsSince(tracked) {
				return true
			}
		}
	}
}

func (m *Manager) CountDiagnosticsPublicationsSince(tracked map[string]uint64) int {
	m.diagnosticsMu.RLock()
	defer m.diagnosticsMu.RUnlock()

	count := 0
	for key, version := range tracked {
		if m.diagnosticSeen[key] > version {
			count++
		}
	}
	return count
}

func (m *Manager) haveDiagnosticsPublicationsSince(tracked map[string]uint64) bool {
	if len(tracked) == 0 {
		return true
	}
	m.diagnosticsMu.RLock()
	defer m.diagnosticsMu.RUnlock()

	for key, version := range tracked {
		if m.diagnosticSeen[key] <= version {
			return false
		}
	}

	return true
}

func cloneDiagnostics(diagnostics []Diagnostic) []Diagnostic {
	if len(diagnostics) == 0 {
		return nil
	}

	if len(diagnostics) > maxDiagnosticsPerPublish {
		diagnostics = diagnostics[:maxDiagnosticsPerPublish]
	}
	cloned := make([]Diagnostic, len(diagnostics))
	for i := range diagnostics {
		cloned[i] = diagnostics[i]
		cloned[i].Message = truncateDiagnosticText(cloned[i].Message)
		cloned[i].Source = truncateDiagnosticText(cloned[i].Source)
	}
	return cloned
}

func truncateDiagnosticText(value string) string {
	if len(value) <= maxDiagnosticTextBytes {
		return value
	}
	truncated := value[:maxDiagnosticTextBytes]
	for len(truncated) > 0 && !utf8.ValidString(truncated) {
		truncated = truncated[:len(truncated)-1]
	}
	return truncated + "...[truncated]"
}

func fileURIToPath(uri string) string {
	if uri == "" {
		return ""
	}

	if strings.HasPrefix(uri, "file://") {
		parsed, err := url.Parse(uri)
		if err == nil && parsed.Path != "" {
			path := parsed.Path
			if runtime.GOOS == "windows" && strings.HasPrefix(path, "/") && len(path) > 2 {
				path = path[1:]
			}
			return path
		}

		return strings.TrimPrefix(uri, "file://")
	}

	return uri
}

func FilePathToURI(path string) string {
	if path == "" {
		return ""
	}
	clean := filepath.Clean(path)
	if runtime.GOOS == "windows" {
		clean = filepath.ToSlash(clean)
		if len(clean) >= 2 && clean[1] == ':' {
			clean = "/" + clean
		}
	} else {
		clean = filepath.ToSlash(clean)
	}
	return (&url.URL{Scheme: "file", Path: clean}).String()
}

func (m *Manager) IsDocOpen(language, filePath string) bool {
	for _, candidate := range configLanguageCandidates(language) {
		if m.isDocOpen(candidate, filePath) {
			return true
		}
	}
	return false
}

// IsPathOpen reports whether any language bucket currently owns the file path.
func (m *Manager) IsPathOpen(filePath string) bool {
	if strings.TrimSpace(filePath) == "" {
		return false
	}
	cleanPath := filepath.Clean(filePath)

	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, openDocs := range m.openDocsByLang {
		if _, ok := openDocs[filePath]; ok {
			return true
		}
		if cleanPath != filePath {
			if _, ok := openDocs[cleanPath]; ok {
				return true
			}
		}
	}
	return false
}

func (m *Manager) isDocOpen(language, filePath string) bool {
	m.mu.RLock()
	openDocs := m.openDocsByLang[language]
	_, ok := openDocs[filePath]
	m.mu.RUnlock()
	return ok
}

func (m *Manager) isDocSynced(language, filePath string, server *Server) bool {
	if server == nil {
		return false
	}
	m.mu.RLock()
	openDocs := m.openDocsByLang[language]
	state := openDocs[filePath]
	synced := state != nil && state.syncedServer == server
	m.mu.RUnlock()
	return synced
}

func (m *Manager) isDocUserOpen(language, filePath string) bool {
	m.mu.RLock()
	openDocs := m.openDocsByLang[language]
	state := openDocs[filePath]
	open := state != nil && state.userOpen
	m.mu.RUnlock()
	return open
}

func (m *Manager) docState(language, filePath string) (openDocState, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	openDocs := m.openDocsByLang[language]
	state := openDocs[filePath]
	if state == nil {
		return openDocState{}, false
	}
	return *state, true
}

func (m *Manager) ensureOpenDocStateLocked(language, filePath string) *openDocState {
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		openDocs = make(map[string]*openDocState)
		m.openDocsByLang[language] = openDocs
	}
	state := openDocs[filePath]
	if state == nil {
		state = &openDocState{}
		openDocs[filePath] = state
	}
	return state
}

func (m *Manager) stopIdleTimerLocked(language string) {
	if timer, ok := m.idleTimers[language]; ok {
		timer.Stop()
		delete(m.idleTimers, language)
	}
}

func (m *Manager) markDocUserOpen(language, filePath string, version int) {
	m.mu.Lock()
	state := m.ensureOpenDocStateLocked(language, filePath)
	if version > state.version {
		state.version = version
	}
	state.userOpen = true
	state.lastUsedAt = time.Now()
	m.stopIdleTimerLocked(language)
	m.mu.Unlock()
}

func (m *Manager) markDocUserOpenWithContent(language, filePath string, version int, content string, server *Server) {
	m.mu.Lock()
	state := m.ensureOpenDocStateLocked(language, filePath)
	if version > state.version {
		state.version = version
	}
	state.userOpen = true
	state.content = content
	state.languageID = normalizeLanguageID(language)
	state.lastUsedAt = time.Now()
	state.syncedServer = server
	m.stopIdleTimerLocked(language)
	m.mu.Unlock()
}

func (m *Manager) markDocTransientOpen(language, filePath string, version int) {
	m.mu.Lock()
	state := m.ensureOpenDocStateLocked(language, filePath)
	if version > state.version {
		state.version = version
	}
	state.transientRefs++
	state.lastUsedAt = time.Now()
	m.stopIdleTimerLocked(language)
	m.mu.Unlock()
}

func (m *Manager) markDocTransientOpenWithContent(language, filePath string, version int, content string, server *Server) {
	m.mu.Lock()
	state := m.ensureOpenDocStateLocked(language, filePath)
	if version > state.version {
		state.version = version
	}
	state.transientRefs++
	state.content = content
	state.languageID = normalizeLanguageID(language)
	state.lastUsedAt = time.Now()
	state.syncedServer = server
	m.stopIdleTimerLocked(language)
	m.mu.Unlock()
}

func (m *Manager) retainDocTransient(language, filePath string) {
	m.mu.Lock()
	state := m.ensureOpenDocStateLocked(language, filePath)
	state.transientRefs++
	state.lastUsedAt = time.Now()
	m.stopIdleTimerLocked(language)
	m.mu.Unlock()
}

func (m *Manager) markDocOpen(language, filePath string, version int) {
	m.markDocUserOpen(language, filePath, version)
}

func (m *Manager) docVersion(language, filePath string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return 0
	}
	state := openDocs[filePath]
	if state == nil {
		return 0
	}
	return state.version
}

type docCloseDecision struct {
	known       bool
	shouldClose bool
}

func (m *Manager) prepareDocUserClose(language, filePath string) docCloseDecision {
	m.mu.Lock()
	defer m.mu.Unlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return docCloseDecision{}
	}
	state := openDocs[filePath]
	if state == nil || !state.userOpen {
		return docCloseDecision{known: state != nil}
	}
	if state.transientRefs > 0 {
		state.userOpen = false
		return docCloseDecision{known: true}
	}
	return docCloseDecision{known: true, shouldClose: true}
}

func (m *Manager) prepareDocTransientClose(language, filePath string) docCloseDecision {
	m.mu.Lock()
	defer m.mu.Unlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return docCloseDecision{}
	}
	state := openDocs[filePath]
	if state == nil || state.transientRefs <= 0 {
		return docCloseDecision{known: state != nil}
	}
	if state.transientRefs > 1 || state.userOpen {
		state.transientRefs--
		return docCloseDecision{known: true}
	}
	return docCloseDecision{known: true, shouldClose: true}
}

func (m *Manager) commitDocUserClose(language, filePath string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return true
	}
	state := openDocs[filePath]
	if state == nil {
		return true
	}
	state.userOpen = false
	if state.transientRefs > 0 {
		return false
	}
	return deleteOpenDocLocked(m.openDocsByLang, language, filePath)
}

func (m *Manager) commitDocTransientClose(language, filePath string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return true
	}
	state := openDocs[filePath]
	if state == nil {
		return true
	}
	if state.transientRefs > 0 {
		state.transientRefs--
	}
	if state.transientRefs > 0 || state.userOpen {
		return false
	}
	return deleteOpenDocLocked(m.openDocsByLang, language, filePath)
}

func deleteOpenDocLocked(openDocsByLang map[string]map[string]*openDocState, language, filePath string) bool {
	openDocs := openDocsByLang[language]
	if openDocs == nil {
		return true
	}
	delete(openDocs, filePath)
	if len(openDocs) == 0 {
		delete(openDocsByLang, language)
	}
	return true
}

func (m *Manager) forceMarkDocClosed(language, filePath string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return true
	}
	delete(openDocs, filePath)
	if len(openDocs) == 0 {
		delete(m.openDocsByLang, language)
		return true
	}
	return false
}

func (m *Manager) forceMarkLanguageClosed(language string) {
	m.mu.Lock()
	delete(m.openDocsByLang, language)
	m.mu.Unlock()
}

func (m *Manager) markServerDocsUnsyncedLocked(server *Server, languages []string) {
	if server == nil {
		return
	}
	for _, language := range languages {
		for _, state := range m.openDocsByLang[language] {
			if state != nil && state.syncedServer == server {
				state.syncedServer = nil
			}
		}
	}
}

func (m *Manager) hasOpenDocs(language string) bool {
	m.mu.RLock()
	languages := m.sharedServerLanguagesLocked(language, m.servers[language])
	if len(languages) == 0 {
		languages = []string{language}
	}
	for _, candidate := range languages {
		if len(m.openDocsByLang[candidate]) > 0 {
			m.mu.RUnlock()
			return true
		}
	}
	m.mu.RUnlock()
	return false
}

func (m *Manager) scheduleIdleStop(language string) {
	m.scheduleIdleStopAfter(language, m.idleTimeout)
}

func (m *Manager) scheduleTransientIdleStop(language string) {
	timeout := m.transientIdleTimeout
	if timeout <= 0 {
		timeout = m.idleTimeout
	}
	m.scheduleIdleStopAfter(language, timeout)
}

func (m *Manager) scheduleIdleStopAfter(language string, timeout time.Duration) {
	if timeout <= 0 {
		return
	}
	m.mu.Lock()
	if timer, ok := m.idleTimers[language]; ok {
		timer.Stop()
	}
	m.idleTimers[language] = time.AfterFunc(timeout, func() {
		if m.hasOpenDocs(language) {
			return
		}
		if err := m.Stop(language); err != nil {
			log.Printf("[LSP-MGR] idle shutdown failed lang=%s err=%v", language, err)
		}
	})
	m.mu.Unlock()
}

func (m *Manager) clearServerResourceTrackingLocked(server *Server) {
	if server == nil {
		return
	}
	delete(m.resourceChecks, server)
	if timer, ok := m.resourceRestartTimers[server]; ok {
		timer.Stop()
		delete(m.resourceRestartTimers, server)
	}
}

func (m *Manager) maybeCheckServerResources(language string, server *Server, reason string) {
	if m == nil || server == nil || m.resourceMaxRSSBytes <= 0 || m.processRSSBytes == nil {
		return
	}
	pid := lspProcessID(server)
	if pid <= 0 {
		return
	}

	now := time.Now()
	m.mu.Lock()
	if last := m.resourceChecks[server]; !last.IsZero() && m.resourceCheckInterval > 0 && now.Sub(last) < m.resourceCheckInterval {
		m.mu.Unlock()
		return
	}
	m.resourceChecks[server] = now
	m.mu.Unlock()

	rssBytes, err := m.processRSSBytes(pid)
	if err != nil || rssBytes <= m.resourceMaxRSSBytes {
		return
	}
	m.scheduleResourceRestart(language, server, pid, rssBytes, reason)
}

func (m *Manager) scheduleResourceRestart(language string, server *Server, pid int, rssBytes int64, reason string) {
	if server == nil {
		return
	}
	grace := m.resourceRestartGrace
	if grace <= 0 {
		grace = 5 * time.Second
	}

	m.mu.Lock()
	if _, ok := m.resourceRestartTimers[server]; ok {
		m.mu.Unlock()
		return
	}
	m.resourceRestartTimers[server] = time.AfterFunc(grace, func() {
		m.resourceRestartTimerFired(language, server, reason)
	})
	m.mu.Unlock()

	log.Printf("[LSP-MGR] resource limit exceeded lang=%s pid=%d rssMB=%.1f limitMB=%.1f reason=%s action=scheduled_unload graceMs=%d",
		language,
		pid,
		float64(rssBytes)/(1024*1024),
		float64(m.resourceMaxRSSBytes)/(1024*1024),
		reason,
		grace.Milliseconds(),
	)
}

func (m *Manager) resourceRestartTimerFired(language string, server *Server, reason string) {
	if server == nil {
		return
	}
	m.mu.Lock()
	delete(m.resourceRestartTimers, server)
	m.mu.Unlock()

	if pending := server.pendingCount(); pending > 0 {
		m.scheduleResourceRestart(language, server, lspProcessID(server), m.resourceMaxRSSBytes+1, reason+"_pending")
		return
	}
	pid := lspProcessID(server)
	if pid <= 0 || !server.running || !server.isProcessAlive() {
		return
	}
	rssBytes, err := m.processRSSBytes(pid)
	if err != nil || rssBytes <= m.resourceMaxRSSBytes {
		return
	}
	m.stopServerDueToResourcePressure(language, server, pid, rssBytes, m.resourceMaxRSSBytes, reason)
}

func (m *Manager) stopServerDueToResourcePressure(language string, server *Server, pid int, rssBytes int64, limitBytes int64, reason string) {
	if server == nil {
		return
	}
	closedLanguages := m.detachServerPreservingOpenDocs(language, server)
	for _, closedLanguage := range closedLanguages {
		m.clearCompletionCacheForLanguage(closedLanguage)
	}
	log.Printf("[LSP-MGR] resource unload lang=%s languages=%s pid=%d rssMB=%.1f limitMB=%.1f reason=%s action=shutdown_preserve_docs",
		language,
		strings.Join(closedLanguages, ","),
		pid,
		float64(rssBytes)/(1024*1024),
		float64(limitBytes)/(1024*1024),
		reason,
	)
	if err := server.shutdown(); err != nil {
		log.Printf("[LSP-MGR] resource shutdown failed lang=%s pid=%d err=%v", language, pid, err)
	}
}

func (m *Manager) beginCompletion(key string) (*completionFlight, bool) {
	m.completionMu.Lock()
	if flight, ok := m.completionInFly[key]; ok {
		m.completionMu.Unlock()
		return flight, true
	}
	flight := &completionFlight{done: make(chan struct{})}
	m.completionInFly[key] = flight
	m.completionMu.Unlock()
	return flight, false
}

func (m *Manager) endCompletion(key string, result completionResult) {
	m.completionMu.Lock()
	flight := m.completionInFly[key]
	if flight != nil {
		flight.result = result
	}
	delete(m.completionInFly, key)
	m.completionMu.Unlock()
	if flight != nil {
		close(flight.done)
	}
}

func (m *Manager) getCompletionCache(key string) (completionResult, bool) {
	m.completionMu.Lock()
	result, ok := m.completionCache[key]
	if ok && time.Since(result.createdAt) <= m.completionTTL {
		m.completionMu.Unlock()
		return result, true
	}
	if ok {
		delete(m.completionCache, key)
	}
	m.completionMu.Unlock()
	return completionResult{}, false
}

func (m *Manager) completionCacheEpoch() uint64 {
	m.completionMu.Lock()
	epoch := m.completionEpoch
	m.completionMu.Unlock()
	return epoch
}

func (m *Manager) clearCompletionCache() {
	m.completionMu.Lock()
	m.completionEpoch++
	m.completionCache = make(map[string]completionResult)
	m.completionMu.Unlock()
}

func (m *Manager) clearCompletionCacheForLanguage(language string) {
	language = strings.TrimSpace(language)
	if language == "" {
		return
	}
	m.completionMu.Lock()
	m.completionEpoch++
	for key := range m.completionCache {
		parts := strings.SplitN(key, "|", 3)
		if len(parts) >= 2 && parts[1] == language {
			delete(m.completionCache, key)
		}
	}
	m.completionMu.Unlock()
}

func (m *Manager) clearCompletionCacheForFile(language, filePath string) {
	language = strings.TrimSpace(language)
	filePath = strings.TrimSpace(filePath)
	if language == "" || filePath == "" {
		return
	}
	m.completionMu.Lock()
	m.completionEpoch++
	for key := range m.completionCache {
		parts := strings.SplitN(key, "|", 4)
		if len(parts) >= 3 && parts[1] == language && parts[2] == filePath {
			delete(m.completionCache, key)
		}
	}
	m.completionMu.Unlock()
}

func (m *Manager) setCompletionCache(key string, result completionResult) {
	m.completionMu.Lock()
	m.completionCache[key] = result
	m.cleanupCompletionCacheLocked()
	m.completionMu.Unlock()
}

func (m *Manager) cleanupCompletionCacheLocked() {
	if len(m.completionCache) <= m.completionMax {
		return
	}

	now := time.Now()
	for key, entry := range m.completionCache {
		if now.Sub(entry.createdAt) > m.completionTTL {
			delete(m.completionCache, key)
		}
	}

	for len(m.completionCache) > m.completionMax {
		var oldestKey string
		var oldestTime time.Time
		first := true
		for key, entry := range m.completionCache {
			if first || entry.createdAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = entry.createdAt
				first = false
			}
		}
		if oldestKey == "" {
			break
		}
		delete(m.completionCache, oldestKey)
	}
}

// GoToDefinition finds the definition of a symbol at the given position
func (m *Manager) GoToDefinition(language, filePath string, line, column int) ([]Location, error) {
	resolvedLanguage, ok := m.resolveServerLanguage(language)
	if !ok {
		server, err := m.ensureStarted(language)
		if err != nil {
			return nil, nil
		}
		syncLanguage := language
		if configured, ok := m.resolveConfiguredLanguage(language); ok {
			syncLanguage = configured
		}
		defer m.maybeCheckServerResources(syncLanguage, server, "definition")
		if err := m.ensureDocSyncedForRequest(context.Background(), syncLanguage, filePath, server); err != nil {
			return nil, err
		}
		return server.GoToDefinition(filePath, line, column)
	}

	m.mu.RLock()
	server, ok := m.servers[resolvedLanguage]
	m.mu.RUnlock()

	if !ok || server == nil || !server.running || !server.isProcessAlive() {
		started, err := m.ensureStarted(resolvedLanguage)
		if err != nil {
			return nil, nil
		}
		server = started
	}

	defer m.maybeCheckServerResources(resolvedLanguage, server, "definition")
	if err := m.ensureDocSyncedForRequest(context.Background(), resolvedLanguage, filePath, server); err != nil {
		return nil, err
	}
	return server.GoToDefinition(filePath, line, column)
}

// Hover returns hover information for a symbol at the given position
func (m *Manager) Hover(language, filePath string, line, column int) (string, error) {
	resolvedLanguage, ok := m.resolveServerLanguage(language)
	if !ok {
		server, err := m.ensureStarted(language)
		if err != nil {
			return "", nil
		}
		syncLanguage := language
		if configured, ok := m.resolveConfiguredLanguage(language); ok {
			syncLanguage = configured
		}
		defer m.maybeCheckServerResources(syncLanguage, server, "hover")
		if err := m.ensureDocSyncedForRequest(context.Background(), syncLanguage, filePath, server); err != nil {
			return "", err
		}
		return server.Hover(filePath, line, column)
	}

	m.mu.RLock()
	server, ok := m.servers[resolvedLanguage]
	m.mu.RUnlock()

	if !ok || server == nil || !server.running || !server.isProcessAlive() {
		started, err := m.ensureStarted(resolvedLanguage)
		if err != nil {
			return "", nil
		}
		server = started
	}

	defer m.maybeCheckServerResources(resolvedLanguage, server, "hover")
	if err := m.ensureDocSyncedForRequest(context.Background(), resolvedLanguage, filePath, server); err != nil {
		return "", err
	}
	return server.Hover(filePath, line, column)
}

// SignatureHelp returns signature help for a function call at the given position
func (m *Manager) SignatureHelp(language, filePath string, line, column int) (*SignatureHelpResult, error) {
	return m.SignatureHelpWithContext(context.Background(), language, filePath, line, column)
}

func (m *Manager) SignatureHelpWithContext(ctx context.Context, language, filePath string, line, column int) (*SignatureHelpResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	select {
	case <-ctx.Done():
		return nil, nil
	default:
	}

	resolvedLanguage, ok := m.resolveServerLanguage(language)
	if !ok {
		server, err := m.ensureStarted(language)
		if err != nil {
			return nil, nil
		}
		syncLanguage := language
		if configured, ok := m.resolveConfiguredLanguage(language); ok {
			syncLanguage = configured
		}
		defer m.maybeCheckServerResources(syncLanguage, server, "signature_help")
		if err := m.ensureDocSyncedForRequest(ctx, syncLanguage, filePath, server); err != nil {
			return nil, err
		}
		return server.SignatureHelpWithContext(ctx, filePath, line, column)
	}

	m.mu.RLock()
	server, ok := m.servers[resolvedLanguage]
	m.mu.RUnlock()

	if !ok || server == nil || !server.running || !server.isProcessAlive() {
		started, err := m.ensureStarted(resolvedLanguage)
		if err != nil {
			return nil, nil
		}
		server = started
	}

	defer m.maybeCheckServerResources(resolvedLanguage, server, "signature_help")
	if err := m.ensureDocSyncedForRequest(ctx, resolvedLanguage, filePath, server); err != nil {
		return nil, err
	}
	return server.SignatureHelpWithContext(ctx, filePath, line, column)
}

func (m *Manager) startServer(ctx context.Context, cfg ServerConfig, reason string) (*Server, error) {
	startedAt := time.Now()
	if ctx == nil {
		ctx = context.Background()
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "unspecified"
	}
	var governor processcontrol.Controller
	m.mu.RLock()
	governor = m.processGovernor
	m.mu.RUnlock()
	var lease *processcontrol.Lease
	if governor != nil {
		var err error
		lease, err = governor.Acquire(ctx, processcontrol.Request{
			Kind:     processcontrol.KindLSPServer,
			Project:  m.rootPath,
			Root:     cfg.RootURI,
			Language: cfg.Language,
			Group:    cfg.ServerGroup,
			Reason:   reason,
			Command:  cfg.Command,
			Args:     cfg.Args,
		})
		if err != nil {
			log.Printf("[LSP-MGR] start queued canceled language=%s group=%s command=%s root=%s reason=%s durationMs=%d error=%v",
				cfg.Language,
				cfg.ServerGroup,
				cfg.Command,
				cfg.RootURI,
				reason,
				time.Since(startedAt).Milliseconds(),
				err,
			)
			return nil, err
		}
		defer lease.Release("startup-complete")
	}
	cmd := exec.Command(cfg.Command, cfg.Args...)
	cmd.Env = lspProcessEnv(cfg.Command)
	configureLSPProcessGroup(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}

	log.Printf("[LSP-MGR] starting language=%s group=%s command=%s args=%v root=%s reason=%s",
		cfg.Language,
		cfg.ServerGroup,
		cfg.Command,
		cfg.Args,
		cfg.RootURI,
		reason,
	)
	if err := cmd.Start(); err != nil {
		log.Printf("[LSP-MGR] start failed language=%s command=%s args=%v root=%s reason=%s durationMs=%d error=%v",
			cfg.Language,
			cfg.Command,
			cfg.Args,
			cfg.RootURI,
			reason,
			time.Since(startedAt).Milliseconds(),
			err,
		)
		if lease != nil {
			lease.Release("start-failed")
		}
		return nil, err
	}
	if lease != nil {
		lease.RegisterStarted(cmd.Process.Pid)
	}
	logLSPProcessPriority("start", cfg, cmd.Process.Pid, reason, applyLSPProcessPriority(cmd))
	log.Printf("[LSP-MGR] started language=%s command=%s args=%v pid=%d root=%s reason=%s durationMs=%d status=started",
		cfg.Language,
		cfg.Command,
		cfg.Args,
		cmd.Process.Pid,
		cfg.RootURI,
		reason,
		time.Since(startedAt).Milliseconds(),
	)

	server := &Server{
		config:   cfg,
		cmd:      cmd,
		stdin:    stdin,
		stdout:   stdout,
		running:  true,
		pending:  make(map[int]chan *Response),
		onNotify: func(method string, params json.RawMessage) { m.handleNotification(cfg.Language, method, params) },
	}

	go server.readLoop()
	go server.readStderr(stderr)

	return server, nil
}

func logLSPProcessPriority(phase string, cfg ServerConfig, pid int, reason string, result lspProcessPriorityResult) {
	if result.Err != nil {
		log.Printf("[LSP-MGR] priority phase=%s language=%s command=%s pid=%d root=%s reason=%s enabled=%t nice=%d source=%s target=%s status=%s error=%v",
			phase,
			cfg.Language,
			cfg.Command,
			pid,
			cfg.RootURI,
			reason,
			result.Policy.Enabled,
			result.Policy.Nice,
			result.Policy.Source,
			result.Target,
			result.Status,
			result.Err,
		)
		return
	}
	log.Printf("[LSP-MGR] priority phase=%s language=%s command=%s pid=%d root=%s reason=%s enabled=%t nice=%d source=%s target=%s status=%s",
		phase,
		cfg.Language,
		cfg.Command,
		pid,
		cfg.RootURI,
		reason,
		result.Policy.Enabled,
		result.Policy.Nice,
		result.Policy.Source,
		result.Target,
		result.Status,
	)
}

func lspProcessID(server *Server) int {
	if server == nil || server.cmd == nil || server.cmd.Process == nil {
		return 0
	}
	return server.cmd.Process.Pid
}

func lspProcessEnv(command string) []string {
	env := os.Environ()
	pathValue := os.Getenv("PATH")
	paths := filepath.SplitList(pathValue)
	paths = append(paths, lspToolchainPathCandidates(command)...)
	pathValue = strings.Join(uniqueStringList(paths), string(os.PathListSeparator))

	hasPath := false
	for i, entry := range env {
		if strings.HasPrefix(entry, "PATH=") {
			env[i] = "PATH=" + pathValue
			hasPath = true
			break
		}
	}
	if !hasPath {
		env = append(env, "PATH="+pathValue)
	}
	return env
}

func lspToolchainPathCandidates(command string) []string {
	var candidates []string
	if commandDir := filepath.Dir(command); commandDir != "." && commandDir != "" {
		candidates = append(candidates, commandDir)
	}
	candidates = append(candidates, lspregistry.RuntimeToolchainDirs()...)
	return candidates
}

func uniqueStringList(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func (s *Server) initialize() error {
	return s.initializeWithContext(context.Background())
}

func (s *Server) initializeWithContext(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	params := map[string]any{
		"processId": os.Getpid(),
		"rootUri":   s.config.RootURI,
		"capabilities": map[string]any{
			"workspace": map[string]any{
				"fileOperations": map[string]any{
					"dynamicRegistration": false,
					"willRename":          true,
					"didRename":           true,
				},
			},
			"textDocument": map[string]any{
				"completion": completionClientCapabilities(),
				"definition": map[string]any{
					"dynamicRegistration": true,
					"linkSupport":         true,
				},
				"hover": map[string]any{
					"dynamicRegistration": true,
					"contentFormat":       []string{"markdown", "plaintext"},
				},
				"signatureHelp": map[string]any{
					"dynamicRegistration": true,
					"signatureInformation": map[string]any{
						"documentationFormat": []string{"markdown", "plaintext"},
					},
				},
				"codeAction": map[string]any{
					"dynamicRegistration": true,
					"codeActionLiteralSupport": map[string]any{
						"codeActionKind": map[string]any{
							"valueSet": []string{"", "quickfix", "refactor", "refactor.extract", "source", "source.organizeImports"},
						},
					},
				},
				"publishDiagnostics": map[string]any{
					"relatedInformation": true,
				},
			},
		},
	}

	for k, v := range s.config.InitParams {
		params[k] = v
	}

	resp, err := s.requestWithContext(ctx, "initialize", params)
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf("initialize error: %s", resp.Error.Message)
	}
	var initialized InitializeResult
	if len(resp.Result) > 0 {
		if err := json.Unmarshal(resp.Result, &initialized); err == nil {
			s.mu.Lock()
			s.capabilities = initialized.Capabilities
			s.mu.Unlock()
		}
	}

	return s.notify("initialized", struct{}{})
}

func completionClientCapabilities() map[string]any {
	return map[string]any{
		"contextSupport": true,
		"completionList": map[string]any{
			"itemDefaults": []string{
				"commitCharacters",
				"editRange",
				"insertTextFormat",
				"insertTextMode",
				"data",
			},
		},
		"completionItemKind": map[string]any{
			"valueSet": []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25},
		},
		"completionItem": map[string]any{
			"snippetSupport":          true,
			"commitCharactersSupport": true,
			"deprecatedSupport":       true,
			"preselectSupport":        true,
			"insertReplaceSupport":    true,
			"labelDetailsSupport":     true,
			"documentationFormat":     []string{"markdown", "plaintext"},
			"insertTextModeSupport":   map[string]any{"valueSet": []int{1, 2}},
			"tagSupport":              map[string]any{"valueSet": []int{1}},
			"resolveSupport":          map[string]any{"properties": []string{"textEdit", "textEditText", "additionalTextEdits", "command", "data", "detail", "documentation", "sortText", "filterText", "insertText"}},
		},
	}
}

func (s *Server) completionCapabilities() CompletionCapabilities {
	if s == nil {
		return CompletionCapabilities{}
	}
	s.mu.Lock()
	capabilities := s.capabilities
	s.mu.Unlock()
	provider := capabilities.CompletionProvider
	if provider == nil {
		return CompletionCapabilities{TextDocumentSync: capabilities.TextDocumentSync}
	}
	return CompletionCapabilities{
		Available:         true,
		ResolveProvider:   provider.ResolveProvider,
		TriggerCharacters: append([]string(nil), provider.TriggerCharacters...),
		TextDocumentSync:  capabilities.TextDocumentSync,
	}
}

func (s *Server) shutdown() error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	if !s.running && !s.isProcessAlive() {
		return nil
	}

	if s.running && s.isProcessAlive() {
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		_, _ = s.requestWithContext(ctx, "shutdown", nil)
		cancel()
		_ = s.notify("exit", nil)
	}

	s.running = false

	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.stdout != nil {
		_ = s.stdout.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- s.cmd.Wait() }()

	select {
	case <-ctx.Done():
		terminateLSPProcess(s.cmd.Process, 500*time.Millisecond)
		return ctx.Err()
	case err := <-done:
		return err
	}
}

func (s *Server) abortStartup() error {
	if s == nil || s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	s.running = false
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.stdout != nil {
		_ = s.stdout.Close()
	}
	terminateLSPProcess(s.cmd.Process, 25*time.Millisecond)

	done := make(chan error, 1)
	go func() { done <- s.cmd.Wait() }()

	select {
	case err := <-done:
		return err
	case <-time.After(500 * time.Millisecond):
		return context.DeadlineExceeded
	}
}

// isProcessAlive checks if the server process is still running
func (s *Server) isProcessAlive() bool {
	if s.cmd == nil || s.cmd.Process == nil {
		return false
	}
	if runtime.GOOS == "windows" {
		return s.cmd.ProcessState == nil || !s.cmd.ProcessState.Exited()
	}
	err := s.cmd.Process.Signal(syscall.Signal(0))
	return err == nil
}

func (s *Server) complete(filePath string, line, column int) ([]CompletionItem, error) {
	response, err := s.completeWithContext(context.Background(), filePath, line, column, CompletionTrigger{})
	return response.Items, err
}

func (s *Server) completeWithContext(ctx context.Context, filePath string, line, column int, trigger CompletionTrigger) (CompletionResponse, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	trigger = trigger.normalized()
	originalTrigger := trigger
	unsupportedTriggerFallback := false
	if trigger.TriggerKind == completionTriggerCharacter && !s.supportsCompletionTrigger(trigger.TriggerCharacter) {
		trigger = CompletionTrigger{TriggerKind: completionTriggerInvoked}
		unsupportedTriggerFallback = originalTrigger.AccessMemberIntent
	}

	response, err := s.completeOnceWithContext(ctx, filePath, line, column, trigger)
	if err == nil && unsupportedTriggerFallback {
		response.Items = markCompletionItemsFallbackOnly(response.Items)
		response.UsedInvokedFallback = true
		response.InvokedFallbackReason = "unsupported-trigger"
	}
	if err != nil && originalTrigger.RetryInvokedOnEmpty && trigger.TriggerKind == completionTriggerCharacter && ctx.Err() == nil {
		retryResponse, retryErr := s.completeOnceWithContext(ctx, filePath, line, column, CompletionTrigger{TriggerKind: completionTriggerInvoked})
		if retryErr == nil {
			retryResponse.Items = markCompletionItemsFallbackOnly(retryResponse.Items)
			retryResponse.UsedInvokedFallback = true
			retryResponse.InvokedFallbackReason = "error"
			return retryResponse, nil
		}
	}
	if err != nil || trigger.TriggerKind != completionTriggerCharacter {
		return response, err
	}
	if len(response.Items) == 0 {
		if !originalTrigger.RetryInvokedOnEmpty {
			return response, nil
		}
		if ctx.Err() != nil {
			return response, ctx.Err()
		}
		retryResponse, retryErr := s.completeOnceWithContext(ctx, filePath, line, column, CompletionTrigger{TriggerKind: completionTriggerInvoked})
		if retryErr == nil {
			retryResponse.Items = markCompletionItemsFallbackOnly(retryResponse.Items)
			retryResponse.UsedInvokedFallback = true
			retryResponse.InvokedFallbackReason = "empty"
		}
		return retryResponse, retryErr
	}

	if !response.IsIncomplete || !originalTrigger.RetryInvokedOnIncomplete {
		return response, nil
	}
	if ctx.Err() != nil {
		response.InvokedFallbackRejected = true
		response.InvokedFallbackRejectedReason = completionFallbackRejectedReason(ctx.Err())
		return response, nil
	}
	retryResponse, retryErr := s.completeOnceWithContext(ctx, filePath, line, column, CompletionTrigger{TriggerKind: completionTriggerInvoked})
	if retryErr != nil {
		response.InvokedFallbackRejected = true
		response.InvokedFallbackRejectedReason = completionFallbackRejectedReason(retryErr)
		return response, nil
	}
	if len(retryResponse.Items) == 0 {
		response.InvokedFallbackRejected = true
		response.InvokedFallbackRejectedReason = "empty"
		return response, nil
	}
	if !completionResponsesHaveLabelOverlap(response, retryResponse) {
		response.InvokedFallbackRejected = true
		response.InvokedFallbackRejectedReason = "disjoint"
		return response, nil
	}
	if !completionResponseIsMemberSuperset(response, retryResponse) {
		response.InvokedFallbackRejected = true
		response.InvokedFallbackRejectedReason = "not-superset"
		return response, nil
	}
	return mergeCompletionFallbackResponses(response, retryResponse, "incomplete"), nil
}

func completionFallbackRejectedReason(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case err != nil:
		return "error"
	default:
		return ""
	}
}

func completionResponsesHaveLabelOverlap(left, right CompletionResponse) bool {
	leftLabels := completionItemLabelSet(left.Items)
	if len(leftLabels) == 0 {
		return len(right.Items) > 0
	}
	for _, item := range right.Items {
		if _, ok := leftLabels[completionItemLabelKey(item)]; ok {
			return true
		}
	}
	return false
}

func completionResponseIsMemberSuperset(triggerResponse, fallbackResponse CompletionResponse) bool {
	if len(triggerResponse.Items) == 0 {
		return len(fallbackResponse.Items) > 0
	}
	fallbackItems := completionItemsByLabel(fallbackResponse.Items)
	if len(fallbackItems) == 0 {
		return false
	}
	checked := 0
	for _, triggerItem := range triggerResponse.Items {
		label := completionItemLabelKey(triggerItem)
		if label == "" {
			continue
		}
		checked++
		if !completionItemsContainCompatibleMember(fallbackItems[label], triggerItem) {
			return false
		}
	}
	return checked > 0
}

func mergeCompletionFallbackResponses(triggerResponse, fallbackResponse CompletionResponse, reason string) CompletionResponse {
	merged := fallbackResponse
	merged.UsedInvokedFallback = true
	merged.InvokedFallbackReason = reason
	merged.InvokedFallbackRejected = false
	merged.InvokedFallbackRejectedReason = ""
	merged.IsIncomplete = fallbackResponse.IsIncomplete
	triggerItems := completionItemsByLabel(triggerResponse.Items)
	seen := completionItemLabelSet(merged.Items)
	for i, item := range merged.Items {
		key := completionItemLabelKey(item)
		if key == "" {
			continue
		}
		if triggerItem, ok := completionCompatibleMember(triggerItems[key], item); ok {
			merged.Items[i] = mergeCompletionItem(triggerItem, item)
			merged.Items[i].FallbackOnly = false
			continue
		}
		merged.Items[i].FallbackOnly = true
	}
	for _, item := range triggerResponse.Items {
		key := completionItemLabelKey(item)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged.Items = append(merged.Items, item)
	}
	return merged
}

func markCompletionItemsFallbackOnly(items []CompletionItem) []CompletionItem {
	for i := range items {
		items[i].FallbackOnly = true
	}
	return items
}

func completionItemsByLabel(items []CompletionItem) map[string][]CompletionItem {
	byLabel := make(map[string][]CompletionItem, len(items))
	for _, item := range items {
		label := completionItemLabelKey(item)
		if label == "" {
			continue
		}
		byLabel[label] = append(byLabel[label], item)
	}
	return byLabel
}

func completionItemsContainCompatibleMember(items []CompletionItem, target CompletionItem) bool {
	_, ok := completionCompatibleMember(items, target)
	return ok
}

func completionCompatibleMember(items []CompletionItem, target CompletionItem) (CompletionItem, bool) {
	for _, item := range items {
		if completionItemsHaveCompatibleMemberIdentity(target, item) {
			return item, true
		}
	}
	return CompletionItem{}, false
}

func completionItemsHaveCompatibleMemberIdentity(left, right CompletionItem) bool {
	if completionItemLabelKey(left) != completionItemLabelKey(right) {
		return false
	}
	if left.Kind != 0 && right.Kind != 0 && left.Kind != right.Kind {
		return false
	}
	if !completionItemOptionalIdentityMatches(completionItemDetailIdentity(left), completionItemDetailIdentity(right)) {
		return false
	}
	if !completionItemOptionalIdentityMatches(completionItemDataIdentity(left), completionItemDataIdentity(right)) {
		return false
	}
	if !completionItemOptionalIdentityMatches(completionItemAdditionalTextEditsIdentity(left), completionItemAdditionalTextEditsIdentity(right)) {
		return false
	}
	if !completionItemOptionalIdentityMatches(completionItemCommandIdentity(left.Command), completionItemCommandIdentity(right.Command)) {
		return false
	}
	return completionItemComparableInsertShape(left) == completionItemComparableInsertShape(right)
}

func completionItemOptionalIdentityMatches(left, right string) bool {
	return left == "" || right == "" || left == right
}

func completionItemDetailIdentity(item CompletionItem) string {
	parts := []string{strings.TrimSpace(item.Detail)}
	if item.LabelDetails != nil {
		parts = append(parts, strings.TrimSpace(item.LabelDetails.Detail), strings.TrimSpace(item.LabelDetails.Description))
	}
	return strings.ToLower(strings.Join(nonEmptyStrings(parts), "\x00"))
}

func completionItemDataIdentity(item CompletionItem) string {
	if item.Data == nil {
		return ""
	}
	raw, err := json.Marshal(item.Data)
	if err != nil || len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	return string(raw)
}

func completionItemAdditionalTextEditsIdentity(item CompletionItem) string {
	if len(item.AdditionalTextEdits) == 0 {
		return ""
	}
	parts := make([]string, 0, len(item.AdditionalTextEdits))
	for _, edit := range item.AdditionalTextEdits {
		parts = append(parts, completionTextEditIdentity(edit))
	}
	sort.Strings(parts)
	return strings.Join(parts, "\x00")
}

func completionTextEditIdentity(edit TextEdit) string {
	return strings.Join([]string{
		strconv.Itoa(edit.Range.Start.Line),
		strconv.Itoa(edit.Range.Start.Character),
		strconv.Itoa(edit.Range.End.Line),
		strconv.Itoa(edit.Range.End.Character),
		edit.NewText,
	}, ":")
}

func completionItemCommandIdentity(command *Command) string {
	if command == nil {
		return ""
	}
	raw, err := json.Marshal(command.Arguments)
	if err != nil || len(raw) == 0 || string(raw) == "null" {
		raw = nil
	}
	return strings.Join([]string{
		strings.TrimSpace(command.Title),
		strings.TrimSpace(command.Command),
		string(raw),
	}, "\x00")
}

func completionItemComparableInsertShape(item CompletionItem) string {
	insertText := strings.TrimSpace(item.TextEditText)
	if insertText == "" && len(item.TextEdit) > 0 {
		insertText = strings.TrimSpace(extractTextEditText(item.TextEdit))
	}
	if insertText == "" {
		insertText = strings.TrimSpace(item.InsertText)
	}
	if insertText == "" {
		insertText = strings.TrimSpace(item.Label)
	}
	return strings.ToLower(completionSnippetPlaceholderPattern.ReplaceAllString(insertText, ""))
}

func nonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		result = append(result, value)
	}
	return result
}

func completionItemLabelSet(items []CompletionItem) map[string]struct{} {
	labels := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := completionItemLabelKey(item)
		if key == "" {
			continue
		}
		labels[key] = struct{}{}
	}
	return labels
}

func completionItemLabelKey(item CompletionItem) string {
	return strings.ToLower(strings.TrimSpace(item.Label))
}

func (s *Server) completeOnceWithContext(ctx context.Context, filePath string, line, column int, trigger CompletionTrigger) (CompletionResponse, error) {
	completionContext := map[string]any{
		"triggerKind": trigger.TriggerKind,
	}
	if trigger.TriggerKind == completionTriggerCharacter {
		completionContext["triggerCharacter"] = trigger.TriggerCharacter
	}

	params := map[string]any{
		"textDocument": map[string]any{
			"uri": "file://" + filePath,
		},
		"position": map[string]any{
			"line":      line,
			"character": column,
		},
		"context": completionContext,
	}

	resp, err := s.requestWithContext(ctx, "textDocument/completion", params)
	if err != nil {
		return CompletionResponse{}, err
	}
	if resp.Error != nil {
		return CompletionResponse{}, fmt.Errorf("completion error: %s", resp.Error.Message)
	}

	var list CompletionList
	if err := json.Unmarshal(resp.Result, &list); err != nil {
		var items []CompletionItem
		if err := json.Unmarshal(resp.Result, &items); err != nil {
			return CompletionResponse{}, err
		}
		return CompletionResponse{Items: normalizeCompletionItems(items)}, nil
	}

	items := applyCompletionItemDefaults(list.Items, list.ItemDefaults)
	return CompletionResponse{
		Items:        normalizeCompletionItems(items),
		IsIncomplete: list.IsIncomplete,
	}, nil
}

func (s *Server) supportsCompletionTrigger(triggerChar string) bool {
	triggerChar = strings.TrimSpace(triggerChar)
	if triggerChar == "" {
		return false
	}
	capabilities := s.completionCapabilities()
	for _, supported := range capabilities.TriggerCharacters {
		if supported == triggerChar {
			return true
		}
	}
	return false
}

func (s *Server) resolveCompletionItem(item CompletionItem) (CompletionItem, error) {
	return s.resolveCompletionItemWithContext(context.Background(), item)
}

func (s *Server) resolveCompletionItemWithContext(ctx context.Context, item CompletionItem) (CompletionItem, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	resp, err := s.requestWithContext(ctx, "completionItem/resolve", item)
	if err != nil {
		return CompletionItem{}, err
	}
	if resp.Error != nil {
		return CompletionItem{}, fmt.Errorf("resolve error: %s", resp.Error.Message)
	}

	var resolved CompletionItem
	if err := json.Unmarshal(resp.Result, &resolved); err != nil {
		return CompletionItem{}, err
	}

	return resolved, nil
}

func normalizeCompletionItems(items []CompletionItem) []CompletionItem {
	for i := range items {
		items[i] = normalizeCompletionItem(items[i])
	}
	return items
}

func applyCompletionItemDefaults(items []CompletionItem, defaults *CompletionItemDefaults) []CompletionItem {
	if defaults == nil || len(items) == 0 {
		return items
	}
	for i := range items {
		if len(items[i].CommitCharacters) == 0 && len(defaults.CommitCharacters) > 0 {
			items[i].CommitCharacters = append([]string(nil), defaults.CommitCharacters...)
		}
		if items[i].InsertTextFormat == 0 && defaults.InsertTextFormat != 0 {
			items[i].InsertTextFormat = defaults.InsertTextFormat
		}
		if items[i].InsertTextMode == 0 && defaults.InsertTextMode != 0 {
			items[i].InsertTextMode = defaults.InsertTextMode
		}
		if items[i].Data == nil && defaults.Data != nil {
			items[i].Data = defaults.Data
		}
		if len(items[i].TextEdit) == 0 && len(defaults.EditRange) > 0 {
			newText := items[i].TextEditText
			if newText == "" {
				newText = items[i].InsertText
			}
			if newText == "" {
				newText = items[i].Label
			}
			items[i].TextEdit = completionDefaultTextEdit(defaults.EditRange, newText)
		}
	}
	return items
}

func completionDefaultTextEdit(rawRange json.RawMessage, newText string) json.RawMessage {
	if len(rawRange) == 0 {
		return nil
	}
	var insertReplace struct {
		Insert  Range `json:"insert"`
		Replace Range `json:"replace"`
	}
	if rawObjectHasKeys(rawRange, "insert", "replace") && json.Unmarshal(rawRange, &insertReplace) == nil {
		raw, _ := json.Marshal(InsertReplaceEdit{
			Insert:  insertReplace.Insert,
			Replace: insertReplace.Replace,
			NewText: newText,
		})
		return raw
	}
	var editRange Range
	if rawObjectHasKeys(rawRange, "start", "end") && json.Unmarshal(rawRange, &editRange) == nil {
		raw, _ := json.Marshal(TextEdit{Range: editRange, NewText: newText})
		return raw
	}
	return nil
}

func rawObjectHasKeys(raw json.RawMessage, keys ...string) bool {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return false
	}
	for _, key := range keys {
		if _, ok := object[key]; !ok {
			return false
		}
	}
	return true
}

func normalizeCompletionItem(item CompletionItem) CompletionItem {
	if item.InsertText == "" && len(item.TextEdit) > 0 {
		item.InsertText = extractTextEditText(item.TextEdit)
	}
	return item
}

func mergeCompletionItem(base, resolved CompletionItem) CompletionItem {
	if resolved.Label == "" {
		resolved.Label = base.Label
	}
	if resolved.LabelDetails == nil {
		resolved.LabelDetails = base.LabelDetails
	}
	if resolved.Kind == 0 {
		resolved.Kind = base.Kind
	}
	if resolved.Detail == "" {
		resolved.Detail = base.Detail
	}
	if resolved.Documentation == nil {
		resolved.Documentation = base.Documentation
	}
	if !resolved.Deprecated {
		resolved.Deprecated = base.Deprecated
	}
	if !resolved.Preselect {
		resolved.Preselect = base.Preselect
	}
	if resolved.SortText == "" {
		resolved.SortText = base.SortText
	}
	if resolved.FilterText == "" {
		resolved.FilterText = base.FilterText
	}
	if resolved.InsertText == "" {
		resolved.InsertText = base.InsertText
	}
	if resolved.InsertTextFormat == 0 {
		resolved.InsertTextFormat = base.InsertTextFormat
	}
	if resolved.InsertTextMode == 0 {
		resolved.InsertTextMode = base.InsertTextMode
	}
	if resolved.TextEditText == "" {
		resolved.TextEditText = base.TextEditText
	}
	if len(resolved.TextEdit) == 0 {
		resolved.TextEdit = base.TextEdit
	}
	resolved.AdditionalTextEdits = mergeCompletionTextEdits(base.AdditionalTextEdits, resolved.AdditionalTextEdits)
	if len(resolved.CommitCharacters) == 0 {
		resolved.CommitCharacters = base.CommitCharacters
	}
	if resolved.Command == nil {
		resolved.Command = base.Command
	}
	if resolved.Data == nil {
		resolved.Data = base.Data
	}
	if len(resolved.Tags) == 0 {
		resolved.Tags = base.Tags
	}
	return resolved
}

func mergeCompletionTextEdits(base, resolved []TextEdit) []TextEdit {
	if len(base) == 0 {
		return resolved
	}
	if len(resolved) == 0 {
		return base
	}
	merged := make([]TextEdit, 0, len(base)+len(resolved))
	seen := make(map[string]struct{}, len(base)+len(resolved))
	for _, edit := range base {
		key := completionTextEditKey(edit)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, edit)
	}
	for _, edit := range resolved {
		key := completionTextEditKey(edit)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		merged = append(merged, edit)
	}
	return merged
}

func completionTextEditKey(edit TextEdit) string {
	return fmt.Sprintf("%d:%d:%d:%d:%s",
		edit.Range.Start.Line,
		edit.Range.Start.Character,
		edit.Range.End.Line,
		edit.Range.End.Character,
		edit.NewText,
	)
}

func extractTextEditText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}

	var edit TextEdit
	if err := json.Unmarshal(raw, &edit); err == nil && edit.NewText != "" {
		return edit.NewText
	}

	var replace InsertReplaceEdit
	if err := json.Unmarshal(raw, &replace); err == nil && replace.NewText != "" {
		return replace.NewText
	}

	return ""
}

func (s *Server) request(method string, params any) (*Response, error) {
	return s.requestWithContext(context.Background(), method, params)
}

func (s *Server) requestWithContext(ctx context.Context, method string, params any) (*Response, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	s.mu.Lock()
	s.id++
	id := s.id
	ch := make(chan *Response, 1)
	s.pending[id] = ch
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
	}()

	req := Request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	if err := s.send(req); err != nil {
		return nil, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(10 * time.Second):
		return nil, fmt.Errorf("timeout waiting for response")
	}
}

func (s *Server) pendingCount() int {
	if s == nil {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.pending)
}

func (s *Server) notify(method string, params any) error {
	req := Request{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
	}
	return s.send(req)
}

func (s *Server) send(req Request) error {
	return s.sendPayload(req)
}

func isClosedPipeError(err error) bool {
	return errors.Is(err, io.ErrClosedPipe) || errors.Is(err, syscall.EPIPE)
}

func (s *Server) sendPayload(payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(data))
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	_, err = s.stdin.Write([]byte(header))
	if err != nil {
		return err
	}
	_, err = s.stdin.Write(data)
	return err
}

type serverRequestResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result"`
}

func (s *Server) respond(id json.RawMessage, result any) error {
	if len(id) == 0 {
		return nil
	}
	return s.sendPayload(serverRequestResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	})
}

func (s *Server) handleServerRequest(id json.RawMessage, method string, params json.RawMessage) {
	result := serverRequestResult(method, params)
	if err := s.respond(id, result); err != nil {
		s.mu.Lock()
		s.lastError = fmt.Sprintf("server request response error: %v", err)
		s.mu.Unlock()
	}
}

func (s *Server) readStderr(reader io.Reader) {
	if reader == nil {
		return
	}
	scanner := bufio.NewScanner(reader)
	var stderr strings.Builder
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if stderr.Len() > 0 {
			stderr.WriteByte('\n')
		}
		stderr.WriteString(line)
		if stderr.Len() > 4096 {
			break
		}
	}
	message := strings.TrimSpace(stderr.String())
	if message == "" {
		return
	}
	s.mu.Lock()
	if s.lastError == "" {
		s.lastError = message
	}
	s.mu.Unlock()
}

func (s *Server) failPendingRequests(message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "language server connection closed"
	}

	s.mu.Lock()
	pending := make([]chan *Response, 0, len(s.pending))
	for _, ch := range s.pending {
		pending = append(pending, ch)
	}
	s.mu.Unlock()

	response := &Response{
		Error: &ResponseError{
			Code:    -32000,
			Message: message,
		},
	}
	for _, ch := range pending {
		select {
		case ch <- response:
		default:
		}
	}
}

func serverRequestResult(method string, params json.RawMessage) any {
	switch method {
	case "workspace/configuration":
		var payload struct {
			Items []any `json:"items"`
		}
		if err := json.Unmarshal(params, &payload); err != nil || len(payload.Items) == 0 {
			return []any{}
		}
		result := make([]any, len(payload.Items))
		for i := range result {
			result[i] = map[string]any{}
		}
		return result
	case "workspace/workspaceFolders":
		return nil
	case "client/registerCapability",
		"client/unregisterCapability",
		"window/workDoneProgress/create":
		return nil
	default:
		return nil
	}
}

func (s *Server) failReadLoop(message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "language server connection closed"
	}
	s.mu.Lock()
	if s.lastError != "" {
		message = s.lastError
	} else {
		s.lastError = message
	}
	s.running = false
	s.mu.Unlock()
	if s.stdin != nil {
		_ = s.stdin.Close()
	}
	if s.stdout != nil {
		_ = s.stdout.Close()
	}
	s.failPendingRequests(message)
}

func (s *Server) readLoop() {
	reader := bufio.NewReader(s.stdout)

	for s.running {
		contentLength := 0
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				s.failReadLoop(fmt.Sprintf("read header error: %v", err))
				return
			}
			line = strings.TrimSpace(line)
			if line == "" {
				break
			}
			if strings.HasPrefix(line, "Content-Length:") {
				lenStr := strings.TrimSpace(strings.TrimPrefix(line, "Content-Length:"))
				parsedLength, parseErr := strconv.Atoi(lenStr)
				if parseErr != nil || parsedLength < 0 {
					s.failReadLoop(fmt.Sprintf("invalid language server content length: %q", lenStr))
					return
				}
				if parsedLength > maxLSPMessageBytes {
					s.failReadLoop(fmt.Sprintf("language server message too large: %d bytes", parsedLength))
					return
				}
				contentLength = parsedLength
			}
		}

		if contentLength == 0 {
			continue
		}

		body := make([]byte, contentLength)
		_, err := io.ReadFull(reader, body)
		if err != nil {
			s.failReadLoop(fmt.Sprintf("read body error: %v", err))
			return
		}

		var envelope struct {
			ID     *json.RawMessage `json:"id,omitempty"`
			Method string           `json:"method"`
			Params json.RawMessage  `json:"params"`
		}
		if err := json.Unmarshal(body, &envelope); err == nil && envelope.Method != "" {
			if envelope.ID != nil {
				s.handleServerRequest(*envelope.ID, envelope.Method, envelope.Params)
				continue
			}
			if s.onNotify != nil {
				s.onNotify(envelope.Method, envelope.Params)
			}
			continue
		}

		var resp Response
		if err := json.Unmarshal(body, &resp); err != nil {
			continue
		}

		s.mu.Lock()
		if ch, ok := s.pending[resp.ID]; ok {
			ch <- &resp
		}
		s.mu.Unlock()
	}
}

func (s *Server) DidOpen(filePath string, languageID string, content string) error {
	return s.notify("textDocument/didOpen", map[string]any{
		"textDocument": map[string]any{
			"uri":        "file://" + filePath,
			"languageId": languageID,
			"version":    1,
			"text":       content,
		},
	})
}

func (s *Server) DidChange(filePath string, version int, content string) error {
	return s.notify("textDocument/didChange", map[string]any{
		"textDocument": map[string]any{
			"uri":     "file://" + filePath,
			"version": version,
		},
		"contentChanges": []map[string]any{
			{"text": content},
		},
	})
}

func (s *Server) DidClose(filePath string) error {
	return s.notify("textDocument/didClose", map[string]any{
		"textDocument": map[string]any{
			"uri": "file://" + filePath,
		},
	})
}

// GoToDefinition finds the definition of a symbol at the given position
func (s *Server) GoToDefinition(filePath string, line, column int) ([]Location, error) {
	params := map[string]any{
		"textDocument": map[string]any{
			"uri": "file://" + filePath,
		},
		"position": map[string]any{
			"line":      line,
			"character": column,
		},
	}

	resp, err := s.request("textDocument/definition", params)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("definition error: %s", resp.Error.Message)
	}

	// Parse the result - can be Location, []Location, or LocationLink[]
	var locations []Location

	// Try as single Location
	var singleLoc Location
	if err := json.Unmarshal(resp.Result, &singleLoc); err == nil && singleLoc.URI != "" {
		return []Location{singleLoc}, nil
	}

	// Try as []Location
	if err := json.Unmarshal(resp.Result, &locations); err == nil {
		return locations, nil
	}

	// Try as LocationLink[] (some servers return this)
	var links []struct {
		TargetURI   string `json:"targetUri"`
		TargetRange Range  `json:"targetRange"`
	}
	if err := json.Unmarshal(resp.Result, &links); err == nil {
		for _, link := range links {
			locations = append(locations, Location{
				URI:   link.TargetURI,
				Range: link.TargetRange,
			})
		}
		return locations, nil
	}

	return nil, nil
}

// Hover returns hover information for a symbol at the given position
func (s *Server) Hover(filePath string, line, column int) (string, error) {
	params := map[string]any{
		"textDocument": map[string]any{
			"uri": "file://" + filePath,
		},
		"position": map[string]any{
			"line":      line,
			"character": column,
		},
	}

	resp, err := s.request("textDocument/hover", params)
	if err != nil {
		return "", err
	}
	if resp.Error != nil {
		return "", fmt.Errorf("hover error: %s", resp.Error.Message)
	}

	if resp.Result == nil || string(resp.Result) == "null" {
		return "", nil
	}

	// Parse hover result
	var hover struct {
		Contents any `json:"contents"`
	}
	if err := json.Unmarshal(resp.Result, &hover); err != nil {
		return "", nil
	}

	// Contents can be string, MarkupContent, or MarkedString[]
	switch v := hover.Contents.(type) {
	case string:
		return v, nil
	case map[string]any:
		if value, ok := v["value"].(string); ok {
			return value, nil
		}
	case []any:
		// Multiple marked strings - concatenate
		var parts []string
		for _, item := range v {
			switch m := item.(type) {
			case string:
				parts = append(parts, m)
			case map[string]any:
				if value, ok := m["value"].(string); ok {
					parts = append(parts, value)
				}
			}
		}
		return strings.Join(parts, "\n"), nil
	}

	return "", nil
}

func (s *Server) CodeActionWithContext(ctx context.Context, filePath string, line, column int, diagnostics []Diagnostic) ([]CodeAction, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	params := map[string]any{
		"textDocument": map[string]any{
			"uri": "file://" + filePath,
		},
		"range": map[string]any{
			"start": map[string]any{
				"line":      line,
				"character": column,
			},
			"end": map[string]any{
				"line":      line,
				"character": column,
			},
		},
		"context": map[string]any{
			"diagnostics": diagnostics,
		},
	}

	resp, err := s.requestWithContext(ctx, "textDocument/codeAction", params)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("codeAction error: %s", resp.Error.Message)
	}
	if resp.Result == nil || string(resp.Result) == "null" {
		return nil, nil
	}

	var rawItems []json.RawMessage
	if err := json.Unmarshal(resp.Result, &rawItems); err != nil {
		return nil, err
	}

	actions := make([]CodeAction, 0, len(rawItems))
	for _, raw := range rawItems {
		var action CodeAction
		if err := json.Unmarshal(raw, &action); err == nil && action.Title != "" {
			actions = append(actions, action)
			continue
		}

		var cmd Command
		if err := json.Unmarshal(raw, &cmd); err == nil && cmd.Title != "" && cmd.Command != "" {
			copiedCmd := cmd
			actions = append(actions, CodeAction{Title: cmd.Title, Command: &copiedCmd})
		}
	}

	return actions, nil
}

func (s *Server) WillRenameFilesWithContext(ctx context.Context, files []FileRename) (*WorkspaceEdit, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	resp, err := s.requestWithContext(ctx, "workspace/willRenameFiles", map[string]any{
		"files": files,
	})
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		if resp.Error.Code == -32601 {
			return nil, nil
		}
		return nil, fmt.Errorf("willRenameFiles error: %s", resp.Error.Message)
	}
	if resp.Result == nil || string(resp.Result) == "null" {
		return nil, nil
	}

	var edit WorkspaceEdit
	if err := json.Unmarshal(resp.Result, &edit); err != nil {
		return nil, err
	}
	return &edit, nil
}

func (s *Server) DidRenameFiles(files []FileRename) error {
	return s.notify("workspace/didRenameFiles", map[string]any{
		"files": files,
	})
}

// SignatureHelp returns signature help for a function call at the given position
func (s *Server) SignatureHelp(filePath string, line, column int) (*SignatureHelpResult, error) {
	return s.SignatureHelpWithContext(context.Background(), filePath, line, column)
}

func (s *Server) SignatureHelpWithContext(ctx context.Context, filePath string, line, column int) (*SignatureHelpResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	params := map[string]any{
		"textDocument": map[string]any{
			"uri": "file://" + filePath,
		},
		"position": map[string]any{
			"line":      line,
			"character": column,
		},
	}

	resp, err := s.requestWithContext(ctx, "textDocument/signatureHelp", params)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("signatureHelp error: %s", resp.Error.Message)
	}

	if resp.Result == nil || string(resp.Result) == "null" {
		return nil, nil
	}

	var result SignatureHelpResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, err
	}

	return &result, nil
}
