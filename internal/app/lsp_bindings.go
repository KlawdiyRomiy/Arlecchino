package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"arlecchino/internal/autocomplete"
	indexerlsp "arlecchino/internal/indexer/lsp"
	"arlecchino/internal/lsp"
)

// LSP Protocol Bindings - Unified LSP integration for multiple languages

// LSPDefinitionResult represents a definition location from LSP
type LSPDefinitionResult struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Char int    `json:"char"`
}

// SignatureHelpResult represents a signature help result for frontend
type SignatureHelpResult struct {
	Signatures      []SignatureInfo `json:"signatures"`
	ActiveSignature int             `json:"activeSignature"`
	ActiveParameter int             `json:"activeParameter"`
}

// SignatureInfo represents a function signature
type SignatureInfo struct {
	Label         string          `json:"label"`
	Documentation string          `json:"documentation"`
	Parameters    []ParameterInfo `json:"parameters"`
}

// ParameterInfo represents a parameter info
type ParameterInfo struct {
	Label         string `json:"label"`
	Documentation string `json:"documentation"`
}

type LSPPosition struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

type LSPRange struct {
	Start LSPPosition `json:"start"`
	End   LSPPosition `json:"end"`
}

type LSPTextEdit struct {
	Range   LSPRange `json:"range"`
	NewText string   `json:"newText"`
}

type LSPWorkspaceEdit struct {
	Changes         map[string][]LSPTextEdit `json:"changes,omitempty"`
	DocumentChanges []LSPDocumentChange      `json:"documentChanges,omitempty"`
}

type LSPTextDocumentIdentifier struct {
	URI string `json:"uri"`
}

type LSPDocumentChange struct {
	TextDocument *LSPTextDocumentIdentifier `json:"textDocument,omitempty"`
	Edits        []LSPTextEdit              `json:"edits,omitempty"`
	Kind         string                     `json:"kind,omitempty"`
}

type LSPDiagnostic struct {
	Range    LSPRange `json:"range"`
	Severity int      `json:"severity"`
	Code     string   `json:"code,omitempty"`
	Source   string   `json:"source,omitempty"`
	Message  string   `json:"message"`
}

type LSPDiagnosticsEvent struct {
	URI         string          `json:"uri"`
	FilePath    string          `json:"filePath"`
	ProjectPath string          `json:"projectPath"`
	SessionID   string          `json:"sessionId,omitempty"`
	Generation  uint64          `json:"generation"`
	Language    string          `json:"language"`
	Items       []LSPDiagnostic `json:"items"`
}

type LSPDiagnosticsStatusEvent struct {
	ProjectPath string `json:"projectPath"`
	SessionID   string `json:"sessionId,omitempty"`
	Generation  uint64 `json:"generation"`
	Language    string `json:"language,omitempty"`
	FilePath    string `json:"filePath,omitempty"`
	State       string `json:"state"`
	Message     string `json:"message"`
}

type LSPDiagnosticsPreloadEvent struct {
	ProjectPath                  string `json:"projectPath"`
	SessionID                    string `json:"sessionId,omitempty"`
	Generation                   uint64 `json:"generation"`
	Bounded                      bool   `json:"bounded"`
	CoverageState                string `json:"coverageState,omitempty"`
	CoverageMode                 string `json:"coverageMode,omitempty"`
	TotalCandidates              int    `json:"totalCandidates"`
	SelectedCandidates           int    `json:"selectedCandidates"`
	CheckedCandidates            int    `json:"checkedCandidates"`
	FailedCandidates             int    `json:"failedCandidates"`
	TotalLanguages               int    `json:"totalLanguages"`
	SelectedLanguages            int    `json:"selectedLanguages"`
	TimedOut                     bool   `json:"timedOut"`
	SkippedCandidates            int    `json:"skippedCandidates,omitempty"`
	OversizedCandidates          int    `json:"oversizedCandidates,omitempty"`
	UnsafeCandidates             int    `json:"unsafeCandidates,omitempty"`
	UnsupportedCandidates        int    `json:"unsupportedCandidates,omitempty"`
	NoServerCandidates           int    `json:"noServerCandidates,omitempty"`
	OpenFailedCandidates         int    `json:"openFailedCandidates,omitempty"`
	PublicationTimeoutCandidates int    `json:"publicationTimeoutCandidates,omitempty"`
	Message                      string `json:"message,omitempty"`
}

type LSPCodeAction struct {
	Title       string            `json:"title"`
	Kind        string            `json:"kind,omitempty"`
	IsPreferred bool              `json:"isPreferred,omitempty"`
	Edit        *LSPWorkspaceEdit `json:"edit,omitempty"`
	HasCommand  bool              `json:"hasCommand"`
}

// detectLanguage detects the language from file path
func detectLanguage(filePath string) string {
	info, resolution := resolveLanguageInfoForFile(filePath)
	if info == nil || resolution.LSPID == "" {
		return ""
	}
	return resolution.LSPID
}

func resolveLanguageInfoForFile(filePath string) (*lsp.LanguageInfo, autocomplete.LanguageResolution) {
	resolution := autocomplete.Resolve("", filePath)
	info := lsp.GetLanguageByID(resolution.CanonicalID)
	if info == nil {
		return nil, resolution
	}
	return info, resolution
}

func ensureDocOpen(manager *indexerlsp.Manager, language, filePath, content string) (bool, error) {
	if manager.IsDocOpen(language, filePath) {
		return false, nil
	}
	ctx := indexerlsp.WithStartReason(context.Background(), activationLanguageOpen)
	return manager.DidOpenTransientWithContext(ctx, language, filePath, content)
}

func convertLSPDiagnostics(diagnostics []indexerlsp.Diagnostic) []LSPDiagnostic {
	result := make([]LSPDiagnostic, 0, len(diagnostics))
	for _, d := range diagnostics {
		code := ""
		if d.Code != nil {
			code = fmt.Sprintf("%v", d.Code)
		}
		result = append(result, LSPDiagnostic{
			Range: LSPRange{
				Start: LSPPosition{Line: d.Range.Start.Line, Character: d.Range.Start.Character},
				End:   LSPPosition{Line: d.Range.End.Line, Character: d.Range.End.Character},
			},
			Severity: d.Severity,
			Code:     code,
			Source:   d.Source,
			Message:  d.Message,
		})
	}

	return result
}

func newLSPDiagnosticsEvent(projectPath string, generation uint64, language, filePath string, diagnostics []indexerlsp.Diagnostic) LSPDiagnosticsEvent {
	return newLSPDiagnosticsEventForSession(projectPath, generation, "", language, filePath, diagnostics)
}

func newLSPDiagnosticsEventForSession(projectPath string, generation uint64, sessionID string, language, filePath string, diagnostics []indexerlsp.Diagnostic) LSPDiagnosticsEvent {
	return LSPDiagnosticsEvent{
		URI:         "file://" + filepath.ToSlash(filePath),
		FilePath:    filePath,
		ProjectPath: projectPath,
		SessionID:   sessionID,
		Generation:  generation,
		Language:    language,
		Items:       convertLSPDiagnostics(diagnostics),
	}
}

func newLSPDiagnosticsStatusEvent(projectPath string, generation uint64, language, filePath, state, message string) LSPDiagnosticsStatusEvent {
	return newLSPDiagnosticsStatusEventForSession("", projectPath, generation, language, filePath, state, message)
}

func newLSPDiagnosticsStatusEventForSession(sessionID string, projectPath string, generation uint64, language, filePath, state, message string) LSPDiagnosticsStatusEvent {
	return LSPDiagnosticsStatusEvent{
		ProjectPath: projectPath,
		SessionID:   sessionID,
		Generation:  generation,
		Language:    language,
		FilePath:    filePath,
		State:       state,
		Message:     message,
	}
}

func (a *App) emitLSPDiagnosticsStatusForProject(projectPath string, generation uint64, language, filePath, state, message string) {
	a.emitLSPDiagnosticsStatusForSession("", projectPath, generation, language, filePath, state, message)
}

func (a *App) emitLSPDiagnosticsStatusForSession(sessionID string, projectPath string, generation uint64, language, filePath, state, message string) {
	a.emitEvent(
		"lsp:diagnostics:status",
		newLSPDiagnosticsStatusEventForSession(sessionID, projectPath, generation, language, filePath, state, message),
	)
}

func (a *App) emitLSPDiagnosticsStatus(language, filePath, state, message string) {
	session := a.activeProjectSession()
	sessionID := ""
	if session != nil {
		sessionID = session.ID
	}
	a.emitLSPDiagnosticsStatusForSession(
		sessionID,
		a.currentProjectPath(),
		a.activeProjectGeneration(),
		language,
		filePath,
		state,
		message,
	)
}

func shouldSkipPreloadDir(name string) bool {
	switch name {
	case "vendor",
		"node_modules",
		".arlecchino",
		".git",
		"storage",
		".build",
		".swiftpm",
		"DerivedData",
		".venv",
		".pytest_cache",
		".mypy_cache",
		"target",
		".gradle",
		"dist",
		"build",
		"coverage",
		".next",
		".nuxt":
		return true
	default:
		return false
	}
}

func (a *App) LSPPreloadProjectDiagnostics(projectPath string) bool {
	session := a.activeProjectSession()
	if session != nil {
		a.logInfof("[Activation] subsystem=diagnostics reason=%s session=%s project=%s generation=%d", activationManualProjectScan, session.ID, filepath.Base(projectPath), session.projectGeneration.Load())
	}
	return a.lspPreloadProjectDiagnosticsForSessionWithOptions(
		session,
		projectPath,
		a.activeProjectGeneration(),
		diagnosticsPreloadRunOptions{Mode: diagnosticsPreloadModeManualFull},
	)
}

// LSPGoToDefinition finds definition using unified LSP manager
func (a *App) LSPGoToDefinition(filePath string, content string, line int, character int) ([]LSPDefinitionResult, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	// Notify LSP about the document
	opened, err := ensureDocOpen(manager, language, filePath, content)
	if err != nil {
		return nil, fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer manager.DidCloseTransient(language, filePath)
	}

	// Get definition (LSP uses 0-indexed lines)
	locations, err := manager.GoToDefinition(language, filePath, line, character)
	if err != nil {
		return nil, fmt.Errorf("failed to get definition: %w", err)
	}

	// Convert to result format
	var results []LSPDefinitionResult
	for _, loc := range locations {
		// Remove file:// prefix
		path := loc.URI
		if len(path) > 7 && path[:7] == "file://" {
			path = path[7:]
		}
		results = append(results, LSPDefinitionResult{
			Path: path,
			Line: loc.Range.Start.Line + 1, // LSP is 0-indexed, we want 1-indexed
			Char: loc.Range.Start.Character,
		})
	}

	return results, nil
}

// LSPHover returns hover information for a symbol
func (a *App) LSPHover(filePath string, content string, line int, character int) (string, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return "", fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return "", fmt.Errorf("unsupported language for file: %s", filePath)
	}

	// Notify LSP about the document
	opened, err := ensureDocOpen(manager, language, filePath, content)
	if err != nil {
		return "", fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer manager.DidCloseTransient(language, filePath)
	}

	// Get hover info
	hover, err := manager.Hover(language, filePath, line, character)
	if err != nil {
		return "", fmt.Errorf("failed to get hover: %w", err)
	}

	return hover, nil
}

// LSPSignatureHelp returns signature help for a function call
func (a *App) LSPSignatureHelp(filePath string, content string, line int, character int) (*SignatureHelpResult, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	// Notify LSP about the document
	opened, err := ensureDocOpen(manager, language, filePath, content)
	if err != nil {
		return nil, fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer manager.DidCloseTransient(language, filePath)
	}

	// Get signature help
	result, err := manager.SignatureHelp(language, filePath, line, character)
	if err != nil {
		return nil, fmt.Errorf("failed to get signature help: %w", err)
	}

	if result == nil {
		return nil, nil
	}

	// Convert from LSP types to app types
	appResult := &SignatureHelpResult{
		ActiveSignature: result.ActiveSignature,
		ActiveParameter: result.ActiveParameter,
	}

	for _, sig := range result.Signatures {
		sigInfo := SignatureInfo{
			Label:         sig.Label,
			Documentation: sig.Documentation,
		}
		for _, param := range sig.Parameters {
			sigInfo.Parameters = append(sigInfo.Parameters, ParameterInfo{
				Label:         param.Label,
				Documentation: param.Documentation,
			})
		}
		appResult.Signatures = append(appResult.Signatures, sigInfo)
	}

	return appResult, nil
}

func (a *App) LSPGetDiagnostics(filePath string) ([]LSPDiagnostic, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	diagnostics := manager.GetDiagnostics(language, filePath)
	if len(diagnostics) == 0 {
		return []LSPDiagnostic{}, nil
	}

	return convertLSPDiagnostics(diagnostics), nil
}

func (a *App) LSPGetCodeActions(filePath string, content string, line int, character int) ([]LSPCodeAction, error) {
	manager := a.activeLSPManager()
	if manager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	opened, err := ensureDocOpen(manager, language, filePath, content)
	if err != nil {
		return nil, fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer manager.DidCloseTransient(language, filePath)
	}

	allDiagnostics := manager.GetDiagnostics(language, filePath)
	lineDiagnostics := make([]indexerlsp.Diagnostic, 0, len(allDiagnostics))
	for _, diag := range allDiagnostics {
		if diag.Range.Start.Line <= line && diag.Range.End.Line >= line {
			lineDiagnostics = append(lineDiagnostics, diag)
		}
	}

	actions, err := manager.CodeAction(language, filePath, line, character, lineDiagnostics)
	if err != nil {
		return nil, fmt.Errorf("failed to get code actions: %w", err)
	}
	if len(actions) == 0 {
		return nil, nil
	}

	result := make([]LSPCodeAction, 0, len(actions))
	for _, action := range actions {
		item := LSPCodeAction{
			Title:       action.Title,
			Kind:        action.Kind,
			IsPreferred: action.IsPreferred,
			HasCommand:  action.Command != nil,
		}
		if action.Edit != nil {
			converted, err := convertIndexerWorkspaceEdit(action.Edit)
			if err != nil {
				if isUnsupportedLSPResourceOperationError(err) {
					continue
				}
				return nil, fmt.Errorf("failed to convert code action workspace edit %q: %w", action.Title, err)
			}
			item.Edit = converted
		}
		result = append(result, item)
	}

	return result, nil
}

func (a *App) LSPApplyWorkspaceEdit(edit *LSPWorkspaceEdit) error {
	_, err := a.applyLSPWorkspaceEdit(edit)
	return err
}

func (a *App) applyLSPWorkspaceEdit(edit *LSPWorkspaceEdit) (int, error) {
	if edit == nil || (len(edit.Changes) == 0 && len(edit.DocumentChanges) == 0) {
		return 0, nil
	}

	projectPath := strings.TrimSpace(a.currentProjectPath())
	if projectPath == "" {
		return 0, fmt.Errorf("project path is required for workspace edits")
	}

	changes, err := collectWorkspaceTextEdits(edit)
	if err != nil {
		return 0, err
	}
	changedFiles := 0
	for uri, edits := range edit.Changes {
		path, err := normalizeEditPath(uri)
		if err != nil {
			return 0, fmt.Errorf("failed to normalize workspace edit path %q: %w", uri, err)
		}
		if path == "" || len(edits) == 0 {
			continue
		}
		changes[path] = append(changes[path], edits...)
	}

	for path, edits := range changes {
		withinRoot, err := isPathWithinRoot(projectPath, path)
		if err != nil {
			return 0, fmt.Errorf("failed to validate workspace edit path %s: %w", path, err)
		}
		if !withinRoot {
			return 0, fmt.Errorf("workspace edit target outside project root: %s", path)
		}

		info, err := os.Stat(path)
		if err != nil {
			return 0, fmt.Errorf("failed to stat %s: %w", path, err)
		}
		if !info.Mode().IsRegular() {
			return 0, fmt.Errorf("workspace edit target is not regular file: %s", path)
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return 0, fmt.Errorf("failed to read %s: %w", path, err)
		}

		updated, err := applyTextEditsToString(string(content), edits)
		if err != nil {
			return 0, fmt.Errorf("failed to apply edits for %s: %w", path, err)
		}
		if updated == string(content) {
			continue
		}

		if err := os.WriteFile(path, []byte(updated), info.Mode()); err != nil {
			return 0, fmt.Errorf("failed to write %s: %w", path, err)
		}

		changedFiles++
		a.emitEvent("file:changed", path)
	}

	return changedFiles, nil
}

func convertIndexerWorkspaceEdit(edit *indexerlsp.WorkspaceEdit) (*LSPWorkspaceEdit, error) {
	if edit == nil {
		return nil, nil
	}

	converted := &LSPWorkspaceEdit{}
	if len(edit.Changes) > 0 {
		converted.Changes = make(map[string][]LSPTextEdit, len(edit.Changes))
		for uri, edits := range edit.Changes {
			converted.Changes[uri] = convertIndexerTextEdits(edits)
		}
	}
	if len(edit.DocumentChanges) > 0 {
		converted.DocumentChanges = make([]LSPDocumentChange, 0, len(edit.DocumentChanges))
		for index, raw := range edit.DocumentChanges {
			if len(raw) == 0 {
				continue
			}
			var change LSPDocumentChange
			if err := json.Unmarshal(raw, &change); err != nil {
				return nil, fmt.Errorf("malformed documentChanges[%d]: %w", index, err)
			}
			if change.Kind != "" {
				return nil, fmt.Errorf("unsupported documentChanges[%d] resource operation: %s", index, change.Kind)
			}
			converted.DocumentChanges = append(converted.DocumentChanges, change)
		}
	}
	if len(converted.Changes) == 0 && len(converted.DocumentChanges) == 0 {
		return nil, nil
	}
	return converted, nil
}

func isUnsupportedLSPResourceOperationError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "resource operation")
}

func convertIndexerTextEdits(edits []indexerlsp.TextEdit) []LSPTextEdit {
	if len(edits) == 0 {
		return nil
	}
	converted := make([]LSPTextEdit, 0, len(edits))
	for _, edit := range edits {
		converted = append(converted, LSPTextEdit{
			Range: LSPRange{
				Start: LSPPosition{Line: edit.Range.Start.Line, Character: edit.Range.Start.Character},
				End:   LSPPosition{Line: edit.Range.End.Line, Character: edit.Range.End.Character},
			},
			NewText: edit.NewText,
		})
	}
	return converted
}

func collectWorkspaceTextEdits(edit *LSPWorkspaceEdit) (map[string][]LSPTextEdit, error) {
	changes := make(map[string][]LSPTextEdit)
	if edit == nil {
		return changes, nil
	}

	for _, change := range edit.DocumentChanges {
		if change.Kind != "" {
			return nil, fmt.Errorf("workspace edit resource operation is unsupported: %s", change.Kind)
		}
		if change.TextDocument == nil || strings.TrimSpace(change.TextDocument.URI) == "" || len(change.Edits) == 0 {
			continue
		}
		path, err := normalizeEditPath(change.TextDocument.URI)
		if err != nil {
			return nil, fmt.Errorf("failed to normalize workspace edit path %q: %w", change.TextDocument.URI, err)
		}
		if path == "" {
			continue
		}
		changes[path] = append(changes[path], change.Edits...)
	}

	return changes, nil
}

func normalizeEditPath(uri string) (string, error) {
	if uri == "" {
		return "", nil
	}

	if strings.Contains(uri, "://") {
		parsed, err := url.Parse(uri)
		if err != nil {
			return "", err
		}
		if parsed.Scheme != "file" {
			return "", fmt.Errorf("unsupported uri scheme: %s", parsed.Scheme)
		}
		if parsed.Host != "" && parsed.Host != "localhost" {
			return "", fmt.Errorf("unsupported file uri host: %s", parsed.Host)
		}

		decodedPath, err := url.PathUnescape(parsed.Path)
		if err != nil {
			return "", err
		}
		if decodedPath == "" {
			return "", nil
		}

		if len(decodedPath) >= 3 && decodedPath[0] == '/' && decodedPath[2] == ':' {
			decodedPath = decodedPath[1:]
		}

		resolved, err := filepath.Abs(filepath.Clean(decodedPath))
		if err != nil {
			return "", err
		}
		return resolved, nil
	}

	resolved, err := filepath.Abs(filepath.Clean(uri))
	if err != nil {
		return "", err
	}

	return resolved, nil
}

func isPathWithinRoot(rootPath, targetPath string) (bool, error) {
	cleanRoot, err := filepath.Abs(filepath.Clean(rootPath))
	if err != nil {
		return false, err
	}

	cleanTarget, err := filepath.Abs(filepath.Clean(targetPath))
	if err != nil {
		return false, err
	}

	rel, err := filepath.Rel(cleanRoot, cleanTarget)
	if err != nil {
		return false, err
	}

	if rel == "." {
		return true, nil
	}

	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false, nil
	}

	return true, nil
}

func applyTextEditsToString(content string, edits []LSPTextEdit) (string, error) {
	if len(edits) == 0 {
		return content, nil
	}

	type computedEdit struct {
		start int
		end   int
		text  string
	}

	computed := make([]computedEdit, 0, len(edits))
	for _, edit := range edits {
		start, err := positionToOffset(content, edit.Range.Start)
		if err != nil {
			return "", err
		}
		end, err := positionToOffset(content, edit.Range.End)
		if err != nil {
			return "", err
		}
		if start > end {
			return "", fmt.Errorf("invalid edit range: start %d after end %d", start, end)
		}
		computed = append(computed, computedEdit{start: start, end: end, text: edit.NewText})
	}

	sort.Slice(computed, func(i, j int) bool {
		if computed[i].start == computed[j].start {
			return computed[i].end > computed[j].end
		}
		return computed[i].start > computed[j].start
	})

	updated := content
	for _, edit := range computed {
		if edit.start < 0 || edit.end > len(updated) {
			return "", fmt.Errorf("edit range out of bounds")
		}
		updated = updated[:edit.start] + edit.text + updated[edit.end:]
	}

	return updated, nil
}

func positionToOffset(content string, position LSPPosition) (int, error) {
	if position.Line < 0 || position.Character < 0 {
		return 0, fmt.Errorf("invalid position")
	}

	lines := strings.Split(content, "\n")
	if position.Line >= len(lines) {
		return 0, fmt.Errorf("line out of range")
	}

	lineText := lines[position.Line]
	lineByteOffset, err := runeColumnToByteOffset(lineText, position.Character)
	if err != nil {
		return 0, err
	}

	offset := 0
	for i := 0; i < position.Line; i++ {
		offset += len(lines[i]) + 1
	}

	return offset + lineByteOffset, nil
}

func runeColumnToByteOffset(text string, column int) (int, error) {
	if column < 0 {
		return 0, fmt.Errorf("negative column")
	}
	if column == 0 {
		return 0, nil
	}

	runes := 0
	for byteOffset := range text {
		if runes == column {
			return byteOffset, nil
		}
		runes++
	}

	if runes == column {
		return len(text), nil
	}

	return 0, fmt.Errorf("column out of range")
}

type LSPServerInfo struct {
	ID                       string   `json:"id"`
	Name                     string   `json:"name"`
	Languages                []string `json:"languages"`
	Extensions               []string `json:"extensions"`
	Installed                bool     `json:"installed"`
	Version                  string   `json:"version"`
	CanInstall               bool     `json:"canInstall"`
	InstallCmd               string   `json:"installCmd"`
	InstallType              string   `json:"installType"`
	Dependencies             []string `json:"dependencies"`
	InstallUnavailableReason string   `json:"installUnavailableReason"`
}

type LanguageInfoResult struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	LSPServerID   string `json:"lspServerId"`
	LSPInstalled  bool   `json:"lspInstalled"`
	CanInstallLSP bool   `json:"canInstallLsp"`
	ARLESupported bool   `json:"arleSupported"`
}

func (a *App) GetAllLSPServers() []LSPServerInfo {
	if a.lspInstaller == nil {
		return nil
	}

	servers := a.lspInstaller.GetAllServers()
	result := make([]LSPServerInfo, 0, len(servers))

	for _, s := range servers {
		result = append(result, LSPServerInfo{
			ID:                       s.ID,
			Name:                     s.Name,
			Languages:                s.Languages,
			Extensions:               s.Extensions,
			Installed:                s.Installed,
			Version:                  s.Version,
			CanInstall:               s.CanInstall,
			InstallCmd:               s.InstallCmd,
			InstallType:              s.InstallType,
			Dependencies:             append([]string(nil), s.Dependencies...),
			InstallUnavailableReason: lspInstallUnavailableReason(s),
		})
	}

	return result
}

func (a *App) GetLSPForFile(filePath string) *LSPServerInfo {
	if a.lspInstaller == nil {
		return nil
	}

	lang, _ := resolveLanguageInfoForFile(filePath)
	if lang == nil || lang.LSPServerID == "" {
		return nil
	}

	server := a.lspInstaller.GetServerByID(lang.LSPServerID)
	if server == nil {
		return nil
	}
	rootPath := a.currentProjectPath()
	binaryPath := a.lspInstaller.GetBinaryPathForRoot(server.ID, rootPath)

	return &LSPServerInfo{
		ID:                       server.ID,
		Name:                     server.Name,
		Languages:                server.Languages,
		Extensions:               server.Extensions,
		Installed:                binaryPath != "",
		Version:                  server.Version,
		CanInstall:               server.CanInstall,
		InstallCmd:               server.InstallCmd,
		InstallType:              server.InstallType,
		Dependencies:             append([]string(nil), server.Dependencies...),
		InstallUnavailableReason: lspInstallUnavailableReason(server),
	}
}

func (a *App) GetLanguageForFile(filePath string) *LanguageInfoResult {
	lang, _ := resolveLanguageInfoForFile(filePath)
	if lang == nil {
		return nil
	}

	result := &LanguageInfoResult{
		ID:            lang.ID,
		Name:          lang.Name,
		LSPServerID:   lang.LSPServerID,
		ARLESupported: lang.ARLESupported,
	}

	if brain := a.activeCompletionBrain(); brain != nil {
		result.ARLESupported = brain.HasARLELanguageSupport(lang.ID)
	}

	if a.lspInstaller != nil && lang.LSPServerID != "" {
		server := a.lspInstaller.GetServerByID(lang.LSPServerID)
		if server != nil {
			result.LSPInstalled = a.lspInstaller.GetBinaryPathForRoot(lang.LSPServerID, a.currentProjectPath()) != ""
			result.CanInstallLSP = server.CanInstall
		}
	}

	return result
}

func (a *App) InstallLSPServer(serverID string) error {
	if a.lspInstaller == nil {
		return fmt.Errorf("LSP installer not available")
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	session := a.activeProjectSession()
	return a.lspInstaller.InstallAsync(ctx, serverID, func(err error) {
		if err != nil {
			a.emitEvent("lsp:install:error", map[string]string{
				"id":    serverID,
				"error": err.Error(),
			})
		} else {
			a.refreshLSPConfigsFromInstallerForSession(session)
			a.emitEvent("lsp:install:complete", map[string]string{
				"id": serverID,
			})
		}
	})
}

func (a *App) refreshLSPConfigsFromInstallerForSession(session *ProjectRuntimeSession) {
	if a == nil || a.lspInstaller == nil {
		return
	}
	if session == nil {
		session = a.activeProjectSession()
	}

	var manager *indexerlsp.Manager
	projectPath := ""
	generation := uint64(0)
	if session != nil {
		manager = session.lspManager
		projectPath = session.currentProjectPath()
		generation = session.projectGeneration.Load()
	} else {
		manager = a.lspManager
		projectPath = a.currentProjectPath()
		generation = a.projectGeneration.Load()
	}
	if projectPath == "" {
		return
	}
	if manager == nil {
		manager = a.initProjectLSPManagerForSession(session, projectPath, generation, a.lspInstaller)
	}
	manager.ReplaceInstallerConfigs(indexerlsp.ConfigsFromInstaller(projectPath, a.lspInstaller))
	if session != nil {
		session.lspManager = manager
		if session.brain != nil {
			session.brain.SetLSPManager(manager)
		}
		a.syncDefaultProjectSession(session)
		return
	}
	a.lspManager = manager
	if a.brain != nil {
		a.brain.SetLSPManager(manager)
	}
}

func (a *App) IsLSPInstalling(serverID string) bool {
	if a.lspInstaller == nil {
		return false
	}
	return a.lspInstaller.IsInstalling(serverID)
}

func (a *App) GetLSPBinaryPath(serverID string) string {
	if a.lspInstaller == nil {
		return ""
	}
	return a.lspInstaller.GetBinaryPath(serverID)
}
