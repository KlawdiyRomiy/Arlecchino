package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	indexerlsp "arlecchino/internal/indexer/lsp"
	"arlecchino/internal/lsp"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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
	Changes map[string][]LSPTextEdit `json:"changes"`
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
	Generation  uint64          `json:"generation"`
	Language    string          `json:"language"`
	Items       []LSPDiagnostic `json:"items"`
}

type LSPDiagnosticsPreloadEvent struct {
	ProjectPath        string `json:"projectPath"`
	Generation         uint64 `json:"generation"`
	Bounded            bool   `json:"bounded"`
	TotalCandidates    int    `json:"totalCandidates"`
	SelectedCandidates int    `json:"selectedCandidates"`
	TotalLanguages     int    `json:"totalLanguages"`
	SelectedLanguages  int    `json:"selectedLanguages"`
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
	ext := filepath.Ext(filePath)
	if ext == "" {
		ext = filepath.Base(filePath)
	}
	if lang := lsp.GetLanguageByExtension(ext); lang != nil {
		return lang.ID
	}
	if lang := lsp.GetLanguageByFilename(filepath.Base(filePath)); lang != nil {
		return lang.ID
	}
	return ""
}

func ensureDocOpen(manager *indexerlsp.Manager, language, filePath, content string) (bool, error) {
	if manager.IsDocOpen(language, filePath) {
		return false, nil
	}
	if err := manager.DidOpen(language, filePath, content); err != nil {
		return false, err
	}
	if manager.IsDocOpen(language, filePath) {
		return true, nil
	}
	return false, nil
}

func convertLSPDiagnostics(diagnostics []indexerlsp.Diagnostic) []LSPDiagnostic {
	if len(diagnostics) == 0 {
		return nil
	}

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
	return LSPDiagnosticsEvent{
		URI:         "file://" + filepath.ToSlash(filePath),
		FilePath:    filePath,
		ProjectPath: projectPath,
		Generation:  generation,
		Language:    language,
		Items:       convertLSPDiagnostics(diagnostics),
	}
}

func shouldSkipPreloadDir(name string) bool {
	switch name {
	case "vendor", "node_modules", ".git", "storage":
		return true
	default:
		return false
	}
}

func (a *App) LSPPreloadProjectDiagnostics(projectPath string) bool {
	return a.lspPreloadProjectDiagnostics(projectPath, a.projectGeneration.Load())
}

// LSPGoToDefinition finds definition using unified LSP manager
func (a *App) LSPGoToDefinition(filePath string, content string, line int, character int) ([]LSPDefinitionResult, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	// Notify LSP about the document
	opened, err := ensureDocOpen(a.lspManager, language, filePath, content)
	if err != nil {
		return nil, fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer a.lspManager.DidClose(language, filePath)
	}

	// Get definition (LSP uses 0-indexed lines)
	locations, err := a.lspManager.GoToDefinition(language, filePath, line, character)
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
	if a.lspManager == nil {
		return "", fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return "", fmt.Errorf("unsupported language for file: %s", filePath)
	}

	// Notify LSP about the document
	opened, err := ensureDocOpen(a.lspManager, language, filePath, content)
	if err != nil {
		return "", fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer a.lspManager.DidClose(language, filePath)
	}

	// Get hover info
	hover, err := a.lspManager.Hover(language, filePath, line, character)
	if err != nil {
		return "", fmt.Errorf("failed to get hover: %w", err)
	}

	return hover, nil
}

// LSPSignatureHelp returns signature help for a function call
func (a *App) LSPSignatureHelp(filePath string, content string, line int, character int) (*SignatureHelpResult, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	// Notify LSP about the document
	opened, err := ensureDocOpen(a.lspManager, language, filePath, content)
	if err != nil {
		return nil, fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer a.lspManager.DidClose(language, filePath)
	}

	// Get signature help
	result, err := a.lspManager.SignatureHelp(language, filePath, line, character)
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
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	diagnostics := a.lspManager.GetDiagnostics(language, filePath)
	if len(diagnostics) == 0 {
		return nil, nil
	}

	return convertLSPDiagnostics(diagnostics), nil
}

func (a *App) LSPGetCodeActions(filePath string, content string, line int, character int) ([]LSPCodeAction, error) {
	if a.lspManager == nil {
		return nil, fmt.Errorf("LSP manager not available")
	}

	language := detectLanguage(filePath)
	if language == "" {
		return nil, fmt.Errorf("unsupported language for file: %s", filePath)
	}

	opened, err := ensureDocOpen(a.lspManager, language, filePath, content)
	if err != nil {
		return nil, fmt.Errorf("failed to open document: %w", err)
	}
	if opened {
		defer a.lspManager.DidClose(language, filePath)
	}

	allDiagnostics := a.lspManager.GetDiagnostics(language, filePath)
	lineDiagnostics := make([]indexerlsp.Diagnostic, 0, len(allDiagnostics))
	for _, diag := range allDiagnostics {
		if diag.Range.Start.Line <= line && diag.Range.End.Line >= line {
			lineDiagnostics = append(lineDiagnostics, diag)
		}
	}

	actions, err := a.lspManager.CodeAction(language, filePath, line, character, lineDiagnostics)
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
		if action.Edit != nil && len(action.Edit.Changes) > 0 {
			item.Edit = &LSPWorkspaceEdit{Changes: make(map[string][]LSPTextEdit, len(action.Edit.Changes))}
			for uri, edits := range action.Edit.Changes {
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
				item.Edit.Changes[uri] = converted
			}
		}
		result = append(result, item)
	}

	return result, nil
}

func (a *App) LSPApplyWorkspaceEdit(edit *LSPWorkspaceEdit) error {
	if edit == nil || len(edit.Changes) == 0 {
		return nil
	}

	projectPath := strings.TrimSpace(a.currentProjectPath())
	if projectPath == "" {
		return fmt.Errorf("project path is required for workspace edits")
	}

	for uri, edits := range edit.Changes {
		path, err := normalizeEditPath(uri)
		if err != nil {
			return fmt.Errorf("failed to normalize workspace edit path %q: %w", uri, err)
		}
		if path == "" || len(edits) == 0 {
			continue
		}

		withinRoot, err := isPathWithinRoot(projectPath, path)
		if err != nil {
			return fmt.Errorf("failed to validate workspace edit path %s: %w", path, err)
		}
		if !withinRoot {
			return fmt.Errorf("workspace edit target outside project root: %s", path)
		}

		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("failed to stat %s: %w", path, err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("workspace edit target is not regular file: %s", path)
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", path, err)
		}

		updated, err := applyTextEditsToString(string(content), edits)
		if err != nil {
			return fmt.Errorf("failed to apply edits for %s: %w", path, err)
		}

		if err := os.WriteFile(path, []byte(updated), info.Mode()); err != nil {
			return fmt.Errorf("failed to write %s: %w", path, err)
		}

		runtime.EventsEmit(a.ctx, "file:changed", path)
	}

	return nil
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
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Languages  []string `json:"languages"`
	Extensions []string `json:"extensions"`
	Installed  bool     `json:"installed"`
	Version    string   `json:"version"`
	CanInstall bool     `json:"canInstall"`
	InstallCmd string   `json:"installCmd"`
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
			ID:         s.ID,
			Name:       s.Name,
			Languages:  s.Languages,
			Extensions: s.Extensions,
			Installed:  s.Installed,
			Version:    s.Version,
			CanInstall: s.CanInstall,
			InstallCmd: s.InstallCmd,
		})
	}

	return result
}

func (a *App) GetLSPForFile(filePath string) *LSPServerInfo {
	if a.lspInstaller == nil {
		return nil
	}

	ext := filepath.Ext(filePath)
	if ext == "" {
		ext = filepath.Base(filePath)
	}

	server := a.lspInstaller.GetServerForExtension(ext)
	if server == nil {
		return nil
	}

	return &LSPServerInfo{
		ID:         server.ID,
		Name:       server.Name,
		Languages:  server.Languages,
		Extensions: server.Extensions,
		Installed:  server.Installed,
		Version:    server.Version,
		CanInstall: server.CanInstall,
		InstallCmd: server.InstallCmd,
	}
}

func (a *App) GetLanguageForFile(filePath string) *LanguageInfoResult {
	ext := filepath.Ext(filePath)
	if ext == "" {
		ext = filepath.Base(filePath)
	}

	lang := lsp.GetLanguageByExtension(ext)
	if lang == nil {
		lang = lsp.GetLanguageByFilename(filepath.Base(filePath))
	}
	if lang == nil {
		return nil
	}

	result := &LanguageInfoResult{
		ID:            lang.ID,
		Name:          lang.Name,
		LSPServerID:   lang.LSPServerID,
		ARLESupported: lang.ARLESupported,
	}

	if a.brain != nil {
		result.ARLESupported = a.brain.HasARLELanguageSupport(lang.ID)
	}

	if a.lspInstaller != nil && lang.LSPServerID != "" {
		server := a.lspInstaller.GetServerByID(lang.LSPServerID)
		if server != nil {
			result.LSPInstalled = server.Installed
			result.CanInstallLSP = server.CanInstall
		}
	}

	return result
}

func (a *App) InstallLSPServer(serverID string) error {
	if a.lspInstaller == nil {
		return fmt.Errorf("LSP installer not available")
	}

	go func() {
		ctx := context.Background()
		err := a.lspInstaller.Install(ctx, serverID)
		if err != nil {
			runtime.EventsEmit(a.ctx, "lsp:install:error", map[string]string{
				"id":    serverID,
				"error": err.Error(),
			})
		} else {
			runtime.EventsEmit(a.ctx, "lsp:install:complete", map[string]string{
				"id": serverID,
			})
		}
	}()

	return nil
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
