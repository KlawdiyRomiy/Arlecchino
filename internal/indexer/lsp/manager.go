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
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	lspregistry "arlecchino/internal/lsp"
)

type Manager struct {
	mu              sync.RWMutex
	startMu         sync.Mutex
	servers         map[string]*Server
	configs         map[string]ServerConfig
	starting        map[string]chan struct{}
	noConfigLogged  map[string]bool
	openDocsByLang  map[string]map[string]int
	idleTimers      map[string]*time.Timer
	idleTimeout     time.Duration
	completionMu    sync.Mutex
	completionInFly map[string]chan completionResult
	completionCache map[string]completionResult
	completionTTL   time.Duration
	completionMax   int
	completionWait  time.Duration
	diagnosticsMu   sync.RWMutex
	diagnostics     map[string]map[string][]Diagnostic
	diagnosticSeq   uint64
	diagnosticSeen  map[string]uint64
	onDiagnostics   func(language, filePath string, diagnostics []Diagnostic)
	rootPath        string
}

func configLanguageCandidates(language string) []string {
	return lspregistry.LanguageCandidates(language)
}

func normalizeLanguageID(language string) string {
	return lspregistry.TextDocumentLanguageID(language)
}

type completionResult struct {
	items     []CompletionItem
	err       error
	createdAt time.Time
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
	config    ServerConfig
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	stdout    io.ReadCloser
	running   bool
	id        int
	mu        sync.Mutex
	writeMu   sync.Mutex
	pending   map[int]chan *Response
	onNotify  func(method string, params json.RawMessage)
	restarts  int
	lastError string
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
	Kind                int             `json:"kind"`
	Detail              string          `json:"detail,omitempty"`
	Documentation       any             `json:"documentation,omitempty"`
	InsertText          string          `json:"insertText,omitempty"`
	InsertTextFormat    int             `json:"insertTextFormat,omitempty"` // 1 = PlainText, 2 = Snippet
	TextEdit            json.RawMessage `json:"textEdit,omitempty"`
	AdditionalTextEdits []TextEdit      `json:"additionalTextEdits,omitempty"`
	Data                any             `json:"data,omitempty"`
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
	IsIncomplete bool             `json:"isIncomplete"`
	Items        []CompletionItem `json:"items"`
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
	Changes map[string][]TextEdit `json:"changes,omitempty"`
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
	return &Manager{
		servers:         make(map[string]*Server),
		configs:         make(map[string]ServerConfig),
		starting:        make(map[string]chan struct{}),
		noConfigLogged:  make(map[string]bool),
		openDocsByLang:  make(map[string]map[string]int),
		idleTimers:      make(map[string]*time.Timer),
		idleTimeout:     2 * time.Minute,
		completionInFly: make(map[string]chan completionResult),
		completionCache: make(map[string]completionResult),
		completionTTL:   250 * time.Millisecond,
		completionMax:   200,
		completionWait:  500 * time.Millisecond,
		diagnostics:     make(map[string]map[string][]Diagnostic),
		diagnosticSeen:  make(map[string]uint64),
		rootPath:        rootPath,
	}
}

const diagnosticsPublishPollInterval = 25 * time.Millisecond

func (m *Manager) SetDiagnosticsCallback(callback func(language, filePath string, diagnostics []Diagnostic)) {
	m.diagnosticsMu.Lock()
	m.onDiagnostics = callback
	m.diagnosticsMu.Unlock()
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
		<-ch
		return nil, false
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

func (m *Manager) RegisterServer(cfg ServerConfig) {
	cfg.Language = lspregistry.NormalizeLanguageToken(cfg.Language)
	if cfg.Language == "" {
		return
	}
	m.mu.Lock()
	m.configs[cfg.Language] = cfg
	m.mu.Unlock()

	m.startMu.Lock()
	delete(m.noConfigLogged, cfg.Language)
	m.startMu.Unlock()

	log.Printf("[LSP-MGR] Registered server for lang=%s cmd=%s", cfg.Language, cfg.Command)
}

func (m *Manager) ensureStarted(language string) (*Server, error) {
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
		return server, nil
	}
	if ok && (!server.running || !server.isProcessAlive()) {
		m.cleanupServer(language, server)
	}

	ch, shouldStart := m.beginStart(language)
	if !shouldStart {
		m.mu.RLock()
		server = m.servers[language]
		m.mu.RUnlock()
		if server != nil {
			return server, nil
		}
		return nil, fmt.Errorf("server not started for language: %s", language)
	}
	defer m.endStart(language, ch)

	if err := m.Start(language); err != nil {
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
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		return fmt.Errorf("no config for language: %s", language)
	}
	language = resolvedLanguage

	m.mu.RLock()
	server, ok := m.servers[language]
	if ok && server.running && server.isProcessAlive() {
		m.mu.RUnlock()
		return nil
	}
	m.mu.RUnlock()
	if ok {
		m.cleanupServer(language, server)
	}

	m.mu.Lock()
	cfg, ok := m.configs[language]
	m.mu.Unlock()
	if !ok {
		return fmt.Errorf("no config for language: %s", language)
	}

	server, err := m.startServer(cfg)
	if err != nil {
		return err
	}

	m.mu.Lock()
	m.servers[language] = server
	m.mu.Unlock()

	if err := server.initialize(); err != nil {
		server.lastError = err.Error()
		m.mu.Lock()
		current, ok := m.servers[language]
		if ok && current == server {
			delete(m.servers, language)
		}
		m.mu.Unlock()
		_ = server.shutdown()
		return err
	}

	return nil
}

func (m *Manager) Stop(language string) error {
	if resolvedLanguage, ok := m.resolveConfiguredLanguage(language); ok {
		language = resolvedLanguage
	} else {
		language = lspregistry.NormalizeLanguageToken(language)
	}

	m.mu.Lock()
	if timer, ok := m.idleTimers[language]; ok {
		timer.Stop()
		delete(m.idleTimers, language)
	}
	server, ok := m.servers[language]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	delete(m.servers, language)
	m.mu.Unlock()

	return server.shutdown()
}

func (m *Manager) cleanupServer(language string, server *Server) {
	if server == nil {
		return
	}
	shouldShutdown := false
	closeLang := ""
	m.mu.Lock()
	current, ok := m.servers[language]
	if ok && current == server {
		delete(m.servers, language)
		closeLang = language
		shouldShutdown = true
	}
	m.mu.Unlock()
	if shouldShutdown {
		if err := server.shutdown(); err != nil {
			log.Printf("[LSP-MGR] shutdown failed lang=%s err=%v", closeLang, err)
		}
	}
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	servers := make([]*Server, 0, len(m.servers))
	for _, s := range m.servers {
		servers = append(servers, s)
	}
	for _, timer := range m.idleTimers {
		timer.Stop()
	}
	m.servers = make(map[string]*Server)
	m.idleTimers = make(map[string]*time.Timer)
	m.openDocsByLang = make(map[string]map[string]int)
	m.mu.Unlock()

	m.diagnosticsMu.Lock()
	m.diagnostics = make(map[string]map[string][]Diagnostic)
	m.diagnosticSeq = 0
	m.diagnosticSeen = make(map[string]uint64)
	m.onDiagnostics = nil
	m.diagnosticsMu.Unlock()

	for _, s := range servers {
		s.shutdown()
	}
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
	}

	// Start new server
	newServer, err := m.startServer(cfg)
	if err != nil {
		return false, err
	}
	newServer.restarts = restartCount

	if err := newServer.initialize(); err != nil {
		newServer.lastError = err.Error()
		_ = newServer.shutdown()
		return false, err
	}

	m.mu.Lock()
	m.servers[language] = newServer
	m.mu.Unlock()

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
	if ctx == nil {
		ctx = context.Background()
	}

	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil, nil
	}
	language = resolvedLanguage
	select {
	case <-ctx.Done():
		return nil, nil
	default:
	}

	version := m.docVersion(language, filePath)
	cacheKey := fmt.Sprintf("%s|%s|%d|%d|%d", language, filePath, line, column, version)
	if result, ok := m.getCompletionCache(cacheKey); ok {
		return result.items, result.err
	}
	if ch, wait := m.beginCompletion(cacheKey); wait {
		select {
		case result := <-ch:
			return result.items, result.err
		case <-ctx.Done():
			return nil, nil
		case <-time.After(m.completionWait):
			return nil, nil
		}
	}
	defer m.endCompletion(cacheKey)

	server, err := m.ensureStarted(language)
	if err != nil {
		log.Printf("[LSP-MGR] Complete: start failed lang=%s err=%v", language, err)
		return nil, nil
	}

	positionLine := line - 1
	positionColumn := column - 1
	if positionLine < 0 {
		positionLine = 0
	}
	if positionColumn < 0 {
		positionColumn = 0
	}
	items, err := server.completeWithContext(ctx, filePath, positionLine, positionColumn)
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return nil, nil
	}
	items = m.resolveCompletionItems(server, items)
	result := completionResult{items: items, err: err, createdAt: time.Now()}
	m.setCompletionCache(cacheKey, result)
	if err != nil {
		log.Printf("[LSP-MGR] Complete error for lang=%s: %v", language, err)
	}
	return items, err
}

func (m *Manager) resolveCompletionItems(server *Server, items []CompletionItem) []CompletionItem {
	if server == nil || len(items) == 0 {
		return items
	}

	maxResolve := 20
	if len(items) < maxResolve {
		maxResolve = len(items)
	}

	resolved := make([]CompletionItem, len(items))
	copy(resolved, items)

	for i := 0; i < maxResolve; i++ {
		item := resolved[i]
		if item.Data == nil || len(item.AdditionalTextEdits) > 0 {
			continue
		}
		resolvedItem, err := server.resolveCompletionItem(item)
		if err != nil {
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

// DidOpen notifies the LSP server that a file has been opened
func (m *Manager) DidOpen(language, filePath, content string) error {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil
	}
	language = resolvedLanguage
	if m.isDocOpen(language, filePath) {
		return nil
	}

	server, err := m.ensureStarted(language)
	if err != nil {
		log.Printf("[LSP-MGR] DidOpen: start failed lang=%s err=%v", language, err)
		return err
	}

	langID := normalizeLanguageID(language)
	if err := server.DidOpen(filePath, langID, content); err != nil {
		return err
	}
	m.markDocOpen(language, filePath, 1)
	return nil
}

// DidChange notifies the LSP server that a file has been modified
func (m *Manager) DidChange(language, filePath string, version int, content string) error {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.logNoConfig(language)
		return nil
	}
	language = resolvedLanguage
	if !m.isDocOpen(language, filePath) {
		return m.DidOpen(language, filePath, content)
	}

	server, err := m.ensureStarted(language)
	if err != nil {
		log.Printf("[LSP-MGR] DidChange: start failed lang=%s err=%v", language, err)
		return err
	}

	if err := server.DidChange(filePath, version, content); err != nil {
		return err
	}
	m.markDocOpen(language, filePath, version)
	return nil
}

// DidClose notifies the LSP server that a file has been closed
func (m *Manager) DidClose(language, filePath string) error {
	resolvedLanguage, ok := m.resolveConfiguredLanguage(language)
	if !ok {
		m.clearDiagnostics(language, filePath)
		return nil
	}
	language = resolvedLanguage
	m.mu.RLock()
	server, ok := m.servers[language]
	m.mu.RUnlock()

	if !ok {
		m.clearDiagnostics(language, filePath)
		return nil
	}

	if err := server.DidClose(filePath); err != nil {
		return err
	}
	m.clearDiagnostics(language, filePath)
	if m.markDocClosed(language, filePath) {
		m.scheduleIdleStop(language)
	}
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

	actions, err := server.CodeActionWithContext(context.Background(), filePath, line, column, diagnostics)
	if err != nil {
		log.Printf("[LSP-MGR] CodeAction error lang=%s err=%v", language, err)
		return nil, err
	}

	return actions, nil
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

	m.setDiagnostics(language, filePath, payload.Diagnostics)
}

func (m *Manager) setDiagnostics(language, filePath string, diagnostics []Diagnostic) {
	cloned := cloneDiagnostics(diagnostics)

	m.diagnosticsMu.Lock()
	m.diagnosticSeq++
	m.diagnosticSeen[filePath] = m.diagnosticSeq
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
	m.diagnostics[language][filePath] = cloned
	m.diagnosticsMu.Unlock()

	if callback != nil {
		callback(language, filePath, cloneDiagnostics(cloned))
	}
}

func (m *Manager) clearDiagnostics(language, filePath string) {
	m.diagnosticsMu.Lock()
	m.diagnosticSeq++
	m.diagnosticSeen[filePath] = m.diagnosticSeq
	callback := m.onDiagnostics
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

func (m *Manager) WaitForDiagnosticsPublications(ctx context.Context, filePaths []string) bool {
	tracked := make(map[string]uint64, len(filePaths))
	for _, filePath := range filePaths {
		if filePath == "" {
			continue
		}
		tracked[filePath] = 0
	}
	if len(tracked) == 0 {
		return true
	}

	m.diagnosticsMu.RLock()
	for filePath := range tracked {
		tracked[filePath] = m.diagnosticSeen[filePath]
	}
	m.diagnosticsMu.RUnlock()

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

func (m *Manager) haveDiagnosticsPublicationsSince(tracked map[string]uint64) bool {
	m.diagnosticsMu.RLock()
	defer m.diagnosticsMu.RUnlock()

	for filePath, version := range tracked {
		if m.diagnosticSeen[filePath] <= version {
			return false
		}
	}

	return true
}

func cloneDiagnostics(diagnostics []Diagnostic) []Diagnostic {
	if len(diagnostics) == 0 {
		return nil
	}

	cloned := make([]Diagnostic, len(diagnostics))
	copy(cloned, diagnostics)
	return cloned
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

func (m *Manager) IsDocOpen(language, filePath string) bool {
	for _, candidate := range configLanguageCandidates(language) {
		if m.isDocOpen(candidate, filePath) {
			return true
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

func (m *Manager) markDocOpen(language, filePath string, version int) {
	m.mu.Lock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		openDocs = make(map[string]int)
		m.openDocsByLang[language] = openDocs
	}
	openDocs[filePath] = version
	if timer, ok := m.idleTimers[language]; ok {
		timer.Stop()
		delete(m.idleTimers, language)
	}
	m.mu.Unlock()
}

func (m *Manager) docVersion(language, filePath string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		return 0
	}
	return openDocs[filePath]
}

func (m *Manager) markDocClosed(language, filePath string) bool {
	m.mu.Lock()
	openDocs := m.openDocsByLang[language]
	if openDocs == nil {
		m.mu.Unlock()
		return true
	}
	delete(openDocs, filePath)
	if len(openDocs) == 0 {
		delete(m.openDocsByLang, language)
		m.mu.Unlock()
		return true
	}
	m.mu.Unlock()
	return false
}

func (m *Manager) hasOpenDocs(language string) bool {
	m.mu.RLock()
	openDocs := m.openDocsByLang[language]
	open := len(openDocs) > 0
	m.mu.RUnlock()
	return open
}

func (m *Manager) scheduleIdleStop(language string) {
	if m.idleTimeout <= 0 {
		return
	}
	m.mu.Lock()
	if timer, ok := m.idleTimers[language]; ok {
		timer.Stop()
	}
	m.idleTimers[language] = time.AfterFunc(m.idleTimeout, func() {
		if m.hasOpenDocs(language) {
			return
		}
		if err := m.Stop(language); err != nil {
			log.Printf("[LSP-MGR] idle shutdown failed lang=%s err=%v", language, err)
		}
	})
	m.mu.Unlock()
}

func (m *Manager) beginCompletion(key string) (chan completionResult, bool) {
	m.completionMu.Lock()
	if ch, ok := m.completionInFly[key]; ok {
		m.completionMu.Unlock()
		return ch, true
	}
	ch := make(chan completionResult, 1)
	m.completionInFly[key] = ch
	m.completionMu.Unlock()
	return ch, false
}

func (m *Manager) endCompletion(key string) {
	m.completionMu.Lock()
	ch := m.completionInFly[key]
	result, ok := m.completionCache[key]
	delete(m.completionInFly, key)
	m.completionMu.Unlock()
	if ch != nil {
		if ok {
			ch <- result
		}
		close(ch)
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

	return server.SignatureHelpWithContext(ctx, filePath, line, column)
}

func (m *Manager) startServer(cfg ServerConfig) (*Server, error) {
	cmd := exec.Command(cfg.Command, cfg.Args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

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

	return server, nil
}

func (s *Server) initialize() error {
	params := map[string]any{
		"processId": nil,
		"rootUri":   s.config.RootURI,
		"capabilities": map[string]any{
			"textDocument": map[string]any{
				"completion": map[string]any{
					"completionItem": map[string]any{
						"snippetSupport": false,
						"resolveSupport": map[string]any{
							"properties": []string{"additionalTextEdits", "detail", "documentation"},
						},
					},
				},
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

	resp, err := s.request("initialize", params)
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf("initialize error: %s", resp.Error.Message)
	}

	return s.notify("initialized", struct{}{})
}

func (s *Server) shutdown() error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	if !s.running && !s.isProcessAlive() {
		return nil
	}
	s.running = false

	_, _ = s.request("shutdown", nil)
	_ = s.notify("exit", nil)

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
		s.cmd.Process.Kill()
		return ctx.Err()
	case err := <-done:
		return err
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
	return s.completeWithContext(context.Background(), filePath, line, column)
}

func (s *Server) completeWithContext(ctx context.Context, filePath string, line, column int) ([]CompletionItem, error) {
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

	resp, err := s.requestWithContext(ctx, "textDocument/completion", params)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("completion error: %s", resp.Error.Message)
	}

	var list CompletionList
	if err := json.Unmarshal(resp.Result, &list); err != nil {
		var items []CompletionItem
		if err := json.Unmarshal(resp.Result, &items); err != nil {
			return nil, err
		}
		return normalizeCompletionItems(items), nil
	}

	return normalizeCompletionItems(list.Items), nil
}

func (s *Server) resolveCompletionItem(item CompletionItem) (CompletionItem, error) {
	resp, err := s.request("completionItem/resolve", item)
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
	if resolved.Kind == 0 {
		resolved.Kind = base.Kind
	}
	if resolved.Detail == "" {
		resolved.Detail = base.Detail
	}
	if resolved.Documentation == nil {
		resolved.Documentation = base.Documentation
	}
	if resolved.InsertText == "" {
		resolved.InsertText = base.InsertText
	}
	if resolved.InsertTextFormat == 0 {
		resolved.InsertTextFormat = base.InsertTextFormat
	}
	if len(resolved.TextEdit) == 0 {
		resolved.TextEdit = base.TextEdit
	}
	if len(resolved.AdditionalTextEdits) == 0 {
		resolved.AdditionalTextEdits = base.AdditionalTextEdits
	}
	if resolved.Data == nil {
		resolved.Data = base.Data
	}
	return resolved
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

func (s *Server) readLoop() {
	reader := bufio.NewReader(s.stdout)

	for s.running {
		contentLength := 0
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				s.mu.Lock()
				s.running = false
				s.lastError = fmt.Sprintf("read header error: %v", err)
				s.mu.Unlock()
				return
			}
			line = strings.TrimSpace(line)
			if line == "" {
				break
			}
			if strings.HasPrefix(line, "Content-Length:") {
				lenStr := strings.TrimSpace(strings.TrimPrefix(line, "Content-Length:"))
				contentLength, _ = strconv.Atoi(lenStr)
			}
		}

		if contentLength == 0 {
			continue
		}

		body := make([]byte, contentLength)
		_, err := io.ReadFull(reader, body)
		if err != nil {
			s.mu.Lock()
			s.running = false
			s.lastError = fmt.Sprintf("read body error: %v", err)
			s.mu.Unlock()
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
