package main

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"sort"
	"strings"
	"time"

	"arlecchino/internal/indexer"
	"arlecchino/internal/indexer/brain"
	"arlecchino/internal/predictive"

	"github.com/google/uuid"
)

// Completions & Predictions - Editor autocomplete and command suggestions

const (
	editorCompletionTimeout            = 325 * time.Millisecond
	editorAccessChainCompletionTimeout = 650 * time.Millisecond
)

// CommandSuggestion represents a terminal command suggestion
type CommandSuggestion struct {
	Text        string `json:"text"`
	Description string `json:"description"`
	Kind        string `json:"kind"`
}

// ClassResult represents a class search result
type ClassResult struct {
	Name      string            `json:"name"`
	Kind      string            `json:"kind"`
	Namespace string            `json:"namespace"`
	FilePath  string            `json:"filePath"`
	Line      int               `json:"line"`
	Pending   bool              `json:"pending"`
	Extra     map[string]string `json:"extra,omitempty"`
}

// EditorCompletionContext represents completion request context
type EditorCompletionContext struct {
	FilePath      string   `json:"filePath"`
	Language      string   `json:"language"`
	Line          int      `json:"line"`
	Column        int      `json:"column"`
	LineText      string   `json:"lineText"`
	TextBefore    string   `json:"textBefore"`
	TextAfter     string   `json:"textAfter"`
	FullText      string   `json:"fullText"`
	CurrentClass  string   `json:"currentClass"`
	CurrentMethod string   `json:"currentMethod"`
	Imports       []string `json:"imports"`
	TriggerChar   string   `json:"triggerChar"`
	RequestID     string   `json:"requestId,omitempty"`
}

type TextEditJSON struct {
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
	Text        string `json:"text"`
}

type EditorCompletion struct {
	Label               string         `json:"label"`
	Text                string         `json:"text"`
	Detail              string         `json:"detail"`
	Documentation       string         `json:"documentation,omitempty"`
	TypeInfo            string         `json:"typeInfo,omitempty"`
	Kind                string         `json:"kind"`
	Source              string         `json:"source"`
	InsertText          string         `json:"insertText"`
	IsSnippet           bool           `json:"isSnippet"`
	Priority            int            `json:"priority"`
	HighlightPositions  []int          `json:"highlightPositions,omitempty"`
	MatchType           string         `json:"matchType,omitempty"`
	AdditionalTextEdits []TextEditJSON `json:"additionalTextEdits,omitempty"`
}

// EditorCompletionResult represents completion response
type EditorCompletionResult struct {
	Primary         *EditorCompletion  `json:"primary"`
	Items           []EditorCompletion `json:"items"`
	GhostText       string             `json:"ghostText,omitempty"`
	GhostConfidence float64            `json:"ghostConfidence,omitempty"`
	ShowGhost       bool               `json:"showGhost"`
	RequestID       string             `json:"requestId,omitempty"`
	Stale           bool               `json:"stale,omitempty"`
}

func (a *App) SuggestCommand(input string) []CommandSuggestion {
	projectPath := a.GetCurrentProjectPath()

	// Use plugin registry for command suggestions
	if a.plugins != nil && projectPath != "" {
		pluginSuggestions := a.plugins.SuggestCommand(projectPath, input)
		if len(pluginSuggestions) > 0 {
			var result []CommandSuggestion
			for _, s := range pluginSuggestions {
				result = append(result, CommandSuggestion{
					Text:        s.Text,
					Description: s.Description,
					Kind:        s.Kind,
				})
			}
			return result
		}
	}

	// Fallback to basic suggestion
	registry := indexer.NewCommandRegistry()
	parser := indexer.NewCommandParser(registry)
	suggestions := parser.Suggest(input)

	var result []CommandSuggestion
	for _, s := range suggestions {
		result = append(result, CommandSuggestion{
			Text:        s.Text,
			Description: s.Description,
			Kind:        s.Kind,
		})
	}
	return result
}

// UpdatePrediction updates the speculative store based on terminal input
func (a *App) UpdatePrediction(input string) {
	projectPath := a.GetCurrentProjectPath()
	if a.plugins != nil && projectPath != "" {
		a.plugins.UpdatePrediction(projectPath, input)
	}
}

// CancelPrediction clears any pending predictions
func (a *App) CancelPrediction() {
	projectPath := a.GetCurrentProjectPath()
	if a.plugins != nil && projectPath != "" {
		a.plugins.CancelPrediction(projectPath)
	}
}

// ConfirmPrediction is called when a command is executed
func (a *App) ConfirmPrediction(input string) {
	projectPath := a.GetCurrentProjectPath()
	if a.plugins != nil && projectPath != "" {
		a.plugins.ConfirmPrediction(projectPath, input)
	}
}

func (a *App) GetEditorCompletions(ctx EditorCompletionContext) EditorCompletionResult {
	if a.brain == nil {
		a.logWarning("[AutocompleteV2][Backend] brain is nil - not initialized")
		return EditorCompletionResult{}
	}

	requestID := uuid.New().String()
	ctx.RequestID = requestID
	a.lastRequestID.Store(requestID)

	textBeforeShort := ctx.TextBefore
	if len(textBeforeShort) > 30 {
		textBeforeShort = textBeforeShort[len(textBeforeShort)-30:]
	}
	a.logDebugf("[AutocompleteV2][Backend] request file=%s lang=%s line=%d col=%d textBefore='%s'",
		ctx.FilePath, ctx.Language, ctx.Line, ctx.Column, textBeforeShort)

	prefixInfo := a.brain.ExtractPrefix(ctx.FilePath, []byte(ctx.FullText), ctx.Line, ctx.Column)
	prefix := prefixInfo.Prefix
	if !prefixInfo.InImport && predictive.DetectImportContextFromText(ctx.TextBefore, ctx.Language) {
		prefixInfo.InImport = true
	}

	if prefix == "" && ctx.TextBefore != "" && prefixInfo.AccessChain == "" {
		prefix = predictive.ExtractCurrentPrefixWithLanguage(ctx.TextBefore, ctx.Language)
	}

	timeout := editorCompletionTimeout
	if prefixInfo.AccessChain != "" && prefix == "" {
		timeout = editorAccessChainCompletionTimeout
	}

	requestCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if !prefixInfo.InString && ctx.TextBefore != "" {
		inString, stringValue, stringContext := predictive.DetectStringContextFromText(ctx.TextBefore)
		if inString && stringContext != "" {
			prefixInfo.InString = true
			prefixInfo.StringContextType = stringContext
			prefixInfo.StringValue = stringValue
			if prefix == "" {
				prefix = stringValue
			}
		}
	}

	isMethodCall := strings.Contains(prefixInfo.AccessChain, "->") || strings.Contains(prefixInfo.AccessChain, ".")
	isStaticCall := strings.Contains(prefixInfo.AccessChain, "::")

	a.logDebugf("[AutocompleteV2][Backend] prefix='%s' chain='%s' static=%v method=%v inString=%v",
		prefix, prefixInfo.AccessChain, isStaticCall, isMethodCall, prefixInfo.InString)

	contentWindow, contentStartLine := extractContextLines(ctx.FullText, ctx.Line, 50)

	brainCtx := brain.CompletionContext{
		FilePath:          ctx.FilePath,
		Content:           []byte(contentWindow),
		FullContent:       []byte(ctx.FullText),
		Line:              ctx.Line,
		Column:            ctx.Column,
		Prefix:            prefix,
		Language:          ctx.Language,
		ImportsHash:       computeImportsHash(ctx.Imports),
		TriggerChar:       ctx.TriggerChar,
		Scope:             ctx.CurrentMethod,
		ParentClass:       ctx.CurrentClass,
		InString:          prefixInfo.InString,
		InComment:         prefixInfo.InComment,
		InImport:          prefixInfo.InImport,
		StringValue:       prefixInfo.StringValue,
		StringContextType: prefixInfo.StringContextType,
		AccessChain:       prefixInfo.AccessChain,
		IsMethodCall:      isMethodCall,
		IsStaticCall:      isStaticCall,
		ContentStartLine:  contentStartLine,
		RequestID:         requestID,
		Ctx:               requestCtx,
	}

	suggestions := a.brain.Complete(brainCtx)

	if last := a.lastRequestID.Load(); last != nil && last.(string) != requestID {
		return EditorCompletionResult{
			RequestID: requestID,
			Stale:     true,
		}
	}

	a.logDebugf("[AutocompleteV2][Backend] suggestions=%d", len(suggestions))
	for i, s := range suggestions {
		if i >= 3 {
			break
		}
		a.logDebugf("[AutocompleteV2][Backend] top%d text='%s' score=%.2f source=%s kind=%s",
			i+1, s.Text, s.Score, s.Source, s.Kind)
	}

	var items []EditorCompletion
	for _, s := range suggestions {
		item := EditorCompletion{
			Label:         s.DisplayText,
			Text:          s.Text,
			Detail:        s.Detail,
			Documentation: s.Documentation,
			TypeInfo:      s.TypeInfo,
			Kind:          string(s.Kind),
			Source:        string(s.Source),
			InsertText:    s.InsertText,
			IsSnippet:     s.IsSnippet,
			Priority:      int(s.Score * 100),
		}
		if s.MatchResult != nil {
			item.HighlightPositions = s.MatchResult.Positions
			item.MatchType = s.MatchResult.Type.String()
		}
		if len(s.AdditionalTextEdits) > 0 {
			for _, edit := range s.AdditionalTextEdits {
				item.AdditionalTextEdits = append(item.AdditionalTextEdits, TextEditJSON{
					StartLine:   edit.StartLine,
					StartColumn: edit.StartColumn,
					EndLine:     edit.EndLine,
					EndColumn:   edit.EndColumn,
					Text:        edit.Text,
				})
			}
		}
		items = append(items, item)
	}

	var primary *EditorCompletion
	if len(items) > 0 {
		primary = &items[0]
	}

	ghostResult := a.brain.SelectGhostTextWithContext(brainCtx, suggestions, prefix, prefixInfo.AccessChain)
	if a.brain != nil && ghostResult.ShouldShow {
		a.brain.RecordCompletionShown()
	}

	a.logDebugf("[AutocompleteV2][Backend] ghost show=%v text='%s' confidence=%.2f",
		ghostResult.ShouldShow, ghostResult.Text, ghostResult.Confidence)

	return EditorCompletionResult{
		Primary:         primary,
		Items:           items,
		GhostText:       ghostResult.Text,
		GhostConfidence: ghostResult.Confidence,
		ShowGhost:       ghostResult.ShouldShow,
		RequestID:       requestID,
	}
}

func extractContextLines(fullContent string, cursorLine, radius int) (string, int) {
	if fullContent == "" {
		return "", 1
	}

	lines := strings.Split(fullContent, "\n")
	if cursorLine <= 0 || cursorLine > len(lines) {
		return fullContent, 1
	}

	startLine := cursorLine - radius
	if startLine < 1 {
		startLine = 1
	}
	endLine := cursorLine + radius
	if endLine > len(lines) {
		endLine = len(lines)
	}

	window := strings.Join(lines[startLine-1:endLine], "\n")
	return window, startLine
}

func computeImportsHash(imports []string) string {
	if len(imports) == 0 {
		return ""
	}

	normalized := make([]string, 0, len(imports))
	for _, imp := range imports {
		candidate := strings.TrimSpace(strings.ToLower(imp))
		if candidate != "" {
			normalized = append(normalized, candidate)
		}
	}

	if len(normalized) == 0 {
		return ""
	}

	sort.Strings(normalized)
	hasher := sha1.New()
	for _, imp := range normalized {
		hasher.Write([]byte(imp))
		hasher.Write([]byte{0})
	}

	return hex.EncodeToString(hasher.Sum(nil))
}

func (a *App) GetInlineSuggestion(filePath, content string, line, column int, prefix string) string {
	if a.brain == nil {
		return ""
	}

	language := detectLanguageFromPath(filePath)

	prefixInfo := a.brain.ExtractPrefix(filePath, []byte(content), line, column)
	if prefixInfo.PositionContext == "function_argument" {
		return ""
	}

	brainCtx := brain.CompletionContext{
		FilePath: filePath,
		Content:  []byte(content),
		Line:     line,
		Column:   column,
		Prefix:   prefix,
		Language: language,
	}

	suggestions := a.brain.Complete(brainCtx)
	if len(suggestions) == 0 {
		return ""
	}

	var bestSuggestion *brain.Suggestion
	var bestScore float64 = -1
	const minConfidenceThreshold = 2.0

	for i := range suggestions {
		s := &suggestions[i]
		text := getCleanInsertText(s)
		if text == "" {
			continue
		}

		score := calculateGhostTextScore(s, text, prefix)

		if score > bestScore {
			bestScore = score
			bestSuggestion = s
		}
	}

	if bestSuggestion == nil || bestScore < minConfidenceThreshold {
		return ""
	}

	text := getCleanInsertText(bestSuggestion)

	lowerText := strings.ToLower(text)
	lowerPrefix := strings.ToLower(prefix)
	if strings.HasPrefix(lowerText, lowerPrefix) {
		return text[len(prefix):]
	}

	return text
}

func detectLanguageFromPath(filePath string) string {
	if strings.HasSuffix(filePath, ".blade.php") {
		return "blade"
	}

	idx := strings.LastIndex(filePath, ".")
	if idx == -1 {
		return "unknown"
	}

	ext := filePath[idx+1:]
	langMap := map[string]string{
		"php":    "php",
		"go":     "go",
		"ts":     "typescript",
		"tsx":    "typescript",
		"js":     "javascript",
		"jsx":    "javascript",
		"py":     "python",
		"rb":     "ruby",
		"vue":    "vue",
		"svelte": "svelte",
	}

	if lang, ok := langMap[ext]; ok {
		return lang
	}
	return "php"
}

func getCleanInsertText(s *brain.Suggestion) string {
	text := s.InsertText
	if text == "" {
		text = s.Text
	}

	if s.IsSnippet {
		text = stripSnippetPlaceholders(text)
	}

	return text
}

func stripSnippetPlaceholders(text string) string {
	result := text

	for i := 0; i < 10; i++ {
		placeholder := "$" + string(rune('0'+i))
		result = strings.ReplaceAll(result, placeholder, "")
	}

	start := 0
	for {
		dollarBrace := strings.Index(result[start:], "${")
		if dollarBrace == -1 {
			break
		}
		dollarBrace += start

		closeBrace := strings.Index(result[dollarBrace:], "}")
		if closeBrace == -1 {
			break
		}
		closeBrace += dollarBrace

		inner := result[dollarBrace+2 : closeBrace]
		colonPos := strings.Index(inner, ":")
		replacement := ""
		if colonPos != -1 {
			replacement = inner[colonPos+1:]
		}

		result = result[:dollarBrace] + replacement + result[closeBrace+1:]
		start = dollarBrace + len(replacement)
	}

	return result
}

func calculateGhostTextScore(s *brain.Suggestion, text, prefix string) float64 {
	score := s.Score

	lowerText := strings.ToLower(text)
	lowerPrefix := strings.ToLower(prefix)
	if strings.HasPrefix(lowerText, lowerPrefix) {
		score += 5.0
		if text == prefix {
			score -= 10.0
		}
	} else {
		score -= 3.0
	}

	switch s.Source {
	case "lsp":
		score += 2.0
	case "local":
		score += 1.5
	case "fill_all":
		score += 3.0
	case "index":
		score += 1.0
	case "predictive":
		score += 0.5
	case "virtual":
		score -= 0.5
	}

	textLen := len(text)
	switch {
	case textLen > 100:
		score -= 3.0
	case textLen > 50:
		score -= 1.5
	case textLen < 3:
		score -= 2.0
	case textLen >= 5 && textLen <= 30:
		score += 1.0
	}

	switch s.Kind {
	case "method", "function":
		score += 1.5
	case "property", "variable":
		score += 1.0
	case "class", "interface":
		score += 0.5
	case "snippet":
		score -= 1.0
	}

	return score
}

func (a *App) RecordCompletionUsage(label string) {
	if a.brain != nil {
		a.brain.RecordUsage(label, "")
	}
}

func (a *App) RecordTypingActivity(chars int) {
	if a.brain != nil {
		a.brain.RecordTyping(chars)
	}
}

func (a *App) RecordGhostRejected() {
	if a.brain != nil {
		a.brain.RecordGhostRejected()
	}
}

func (a *App) RecordGhostShown() {
	if a.brain != nil {
		a.brain.RecordCompletionShown()
	}
}

func (a *App) RecordFileAccess(filePath string) {
	if a.brain != nil {
		a.brain.RecordFileAccess(filePath)
	}
}

// NotifyFileOpened notifies LSP servers when a file is opened in the editor
func (a *App) NotifyFileOpened(filePath, language, content string) {
	if a.lspManager != nil {
		a.lspManager.DidOpen(language, filePath, content)
	}
}

// NotifyFileChanged notifies LSP servers when a file content changes
func (a *App) NotifyFileChanged(filePath, language string, version int, content string) {
	if a.lspManager != nil {
		a.lspManager.DidChange(language, filePath, version, content)
	}
	if a.coreEngine != nil {
		a.coreEngine.OnFileChanged(filePath, []byte(content))
	}
	if a.brain != nil {
		a.brain.InvalidateCompletionCache(filePath)
	}
}

// NotifyFileClosed notifies LSP servers when a file is closed
func (a *App) NotifyFileClosed(filePath, language string) {
	if a.lspManager != nil {
		a.lspManager.DidClose(language, filePath)
	}
}

func (a *App) ParseCommand(input string) map[string]interface{} {
	projectPath := a.GetCurrentProjectPath()

	// Use plugin registry for command parsing
	if a.plugins != nil && projectPath != "" {
		parsed := a.plugins.ParseCommand(projectPath, input)
		if parsed != nil && parsed.Valid {
			return map[string]interface{}{
				"prefix":   parsed.Prefix,
				"command":  parsed.Command,
				"argument": parsed.Argument,
				"flags":    parsed.Flags,
				"valid":    parsed.Valid,
			}
		}
	}

	// Fallback to basic parser
	registry := indexer.NewCommandRegistry()
	parser := indexer.NewCommandParser(registry)
	parsed := parser.Parse(input)

	return map[string]interface{}{
		"raw":      parsed.Raw,
		"prefix":   parsed.Prefix,
		"command":  parsed.Command,
		"argument": parsed.Argument,
		"flags":    parsed.Flags,
		"valid":    parsed.Valid,
	}
}

func (a *App) PredictCommand(input string) *ClassResult {
	projectPath := a.GetCurrentProjectPath()
	if a.plugins == nil || projectPath == "" {
		return nil
	}

	// Update prediction in plugins
	a.plugins.UpdatePrediction(projectPath, input)

	// Parse command to get the argument name
	parsed := a.plugins.ParseCommand(projectPath, input)
	if parsed == nil || !parsed.Valid || parsed.Argument == "" {
		return nil
	}

	// Get pending entry from plugins
	entry := a.plugins.GetPendingEntry(projectPath, parsed.Argument)
	if entry == nil {
		return nil
	}

	return &ClassResult{
		Name:      entry.Name,
		Kind:      entry.Kind,
		Namespace: entry.Namespace,
		FilePath:  entry.FilePath,
		Pending:   true,
	}
}

func (a *App) SearchClasses(prefix string) []ClassResult {
	projectPath := a.GetCurrentProjectPath()
	if a.plugins == nil || projectPath == "" {
		return nil
	}

	pluginResults := a.plugins.SearchClasses(projectPath, prefix)
	var out []ClassResult
	for _, r := range pluginResults {
		out = append(out, ClassResult{
			Name:      r.Name,
			Kind:      r.Kind,
			Namespace: r.Namespace,
			FilePath:  r.FilePath,
			Line:      r.Line,
			Pending:   r.Pending,
		})
	}
	return out
}
