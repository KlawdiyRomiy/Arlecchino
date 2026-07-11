package predictive

import (
	"log"
	"path/filepath"
	"sort"
	"strings"

	"arlecchino/internal/indexer/core"
)

type Engine struct {
	analyzer  *ContextAnalyzer
	matcher   *PatternMatcher
	generator *Generator
	registry  *PatternRegistry
}

func NewEngine() *Engine {
	registry := NewPatternRegistry()
	if err := registry.LoadEmbedded(); err != nil {
		log.Printf("[Predictive] Failed to load embedded patterns: %v", err)
	}

	e := &Engine{
		analyzer:  NewContextAnalyzer(),
		matcher:   NewPatternMatcher(),
		generator: NewGenerator(),
		registry:  registry,
	}

	e.syncRegistryToMatcher()

	return e
}

func (e *Engine) syncRegistryToMatcher() {
	for _, lang := range e.registry.GetSupportedLanguages() {
		patterns := e.registry.GetPatterns(lang, "")
		for i := range patterns {
			e.matcher.Register(&patterns[i])
		}

		for _, fw := range e.registry.GetFrameworksForLanguage(lang) {
			fwPatterns := e.registry.GetPatterns(lang, fw)
			for i := range fwPatterns {
				e.matcher.Register(&fwPatterns[i])
			}
		}
	}
}

func (e *Engine) Predict(filePath, content string, line, column int) []Suggestion {
	return e.predict(filePath, []byte(content), line, column, "")
}

func (e *Engine) PredictForLanguage(language, filePath, content string, line, column int) []Suggestion {
	return e.predict(filePath, []byte(content), line, column, language)
}

func (e *Engine) PredictForLanguageBytes(language, filePath string, content []byte, line, column int) []Suggestion {
	return e.predict(filePath, content, line, column, language)
}

func (e *Engine) predict(filePath string, content []byte, line, column int, languageOverride string) []Suggestion {
	ctx := e.analyzer.Analyze(filePath, content, line, column)
	if ctx == nil {
		return nil
	}
	if languageOverride != "" {
		ctx.Language = languageOverride
	}

	prefixInfo := e.ExtractPrefixFast(filePath, content, line, column)
	ctx.TypedPrefix = prefixInfo.Prefix

	if prefixInfo.InString || prefixInfo.InComment {
		return nil
	}

	if e.NeedsScaffoldWithContent(ctx, string(content)) {
		log.Printf("[Predict] scaffold for %s (%s)", ctx.FileType, filepath.Base(filePath))
		return e.generateScaffold(ctx)
	}

	allPatterns := e.matcher.Match(ctx)

	patterns := e.filterPatternsByPrefix(allPatterns, ctx.TypedPrefix)
	if len(patterns) > 0 {
		log.Printf("[Predict] %s:%d prefix=%q pos=%s → %d/%d patterns",
			filepath.Base(filePath), line, ctx.TypedPrefix, ctx.Position.Context, len(patterns), len(allPatterns))
	}
	if len(patterns) == 0 {
		return nil
	}
	suggestions := make([]Suggestion, 0, len(patterns))
	for _, pattern := range patterns {
		code, metadata := e.generator.GenerateWithMetadata(ctx, pattern)
		if code != "" {
			// Use Name if Description is empty
			displayText := pattern.Description
			if displayText == "" {
				displayText = pattern.Name
			}
			if displayText == "" {
				displayText = pattern.ID
			}

			suggestions = append(suggestions, Suggestion{
				Text:                 code,
				DisplayText:          displayText,
				Score:                float64(pattern.Priority),
				Pattern:              pattern,
				IsScaffold:           pattern.IsSkeleton,
				HasResolvedData:      metadata.HasResolvedData,
				UsesFallbackDefaults: metadata.UsesFallbackDefaults,
				InsertText:           code,
				Source:               core.SourcePredictive,
			})
		}
	}

	return suggestions
}

func (e *Engine) NeedsScaffold(ctx *FileContext, content string) bool {
	return e.NeedsScaffoldWithContent(ctx, content)
}
func (e *Engine) NeedsScaffoldWithContent(ctx *FileContext, content string) bool {
	switch ctx.FileType {
	case FileTypeRoute, FileTypeConfig, FileTypeView, FileTypeMigration:
		return false
	}

	content = strings.TrimSpace(content)

	if len(content) == 0 {
		return true
	}

	// PHP file with only opening tag
	if ctx.Language == "php" {
		if content == "<?php" || content == "<?php\n" || content == "<?php\r\n" {
			return true
		}
	}

	// TypeScript/JavaScript with only imports
	if ctx.Language == "typescript" || ctx.Language == "javascript" {
		lines := strings.Split(content, "\n")
		hasCode := false
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "import ") || strings.HasPrefix(line, "//") {
				continue
			}
			hasCode = true
			break
		}
		if !hasCode {
			return true
		}
	}

	// Python with only imports
	if ctx.Language == "python" {
		lines := strings.Split(content, "\n")
		hasCode := false
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "import ") || strings.HasPrefix(line, "from ") || strings.HasPrefix(line, "#") {
				continue
			}
			hasCode = true
			break
		}
		if !hasCode {
			return true
		}
	}

	// Go with only package declaration
	if ctx.Language == "go" {
		lines := strings.Split(content, "\n")
		hasCode := false
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "package ") || strings.HasPrefix(line, "import ") || strings.HasPrefix(line, "//") {
				continue
			}
			hasCode = true
			break
		}
		if !hasCode {
			return true
		}
	}

	return false
}

// generateScaffold generates a scaffold for the file
func (e *Engine) generateScaffold(ctx *FileContext) []Suggestion {
	scaffoldID := e.getScaffoldID(ctx)
	if scaffoldID == "" {
		return nil
	}

	code := e.generator.Generate(ctx, &Pattern{
		Generator: scaffoldID,
	})

	if code == "" {
		return nil
	}

	return []Suggestion{{
		Text:        code,
		DisplayText: "Generate " + string(ctx.FileType) + " scaffold",
		Score:       1000, // Highest priority for scaffolds
		IsScaffold:  true,
		InsertText:  code,
		Source:      core.SourcePredictive,
	}}
}

// getScaffoldID returns the scaffold generator ID based on file context
func (e *Engine) getScaffoldID(ctx *FileContext) string {
	// Laravel scaffolds
	if ctx.Framework == "laravel" {
		switch ctx.FileType {
		case FileTypeController:
			return "laravel_controller_scaffold"
		case FileTypeModel:
			return "laravel_model_scaffold"
		case FileTypeService:
			return "laravel_service_scaffold"
		case FileTypeMigration:
			return "laravel_migration_scaffold"
		case FileTypeRequest:
			return "laravel_request_scaffold"
		case FileTypeTest:
			return "laravel_test_scaffold"
		}
	}

	// NestJS scaffolds
	if ctx.Framework == "nestjs" {
		switch ctx.FileType {
		case FileTypeController:
			return "nestjs_controller_scaffold"
		case FileTypeService:
			return "nestjs_service_scaffold"
		}
	}

	// React scaffolds
	if ctx.Framework == "react" {
		if ctx.FileType == FileTypeComponent {
			return "react_component_scaffold"
		}
	}

	// Django scaffolds
	if ctx.Framework == "django" {
		switch ctx.FileType {
		case FileTypeView:
			return "django_view_scaffold"
		case FileTypeModel:
			return "django_model_scaffold"
		}
	}

	// Rails scaffolds
	if ctx.Framework == "rails" {
		switch ctx.FileType {
		case FileTypeController:
			return "rails_controller_scaffold"
		case FileTypeModel:
			return "rails_model_scaffold"
		case FileTypeMigration:
			return "rails_migration_scaffold"
		case FileTypeService:
			return "rails_service_scaffold"
		case FileTypeJob:
			return "rails_job_scaffold"
		case FileTypeMail:
			return "rails_mailer_scaffold"
		}
	}

	// Vue scaffolds
	if ctx.Framework == "vue" {
		if ctx.FileType == FileTypeComponent {
			return "vue_component_scaffold"
		}
	}

	return ""
}

// RegisterPattern registers a custom pattern
func (e *Engine) RegisterPattern(pattern Pattern) {
	e.matcher.Register(&pattern)
}

// RegisterGenerator registers a custom generator
func (e *Engine) RegisterGenerator(id string, fn GeneratorFunc) {
	e.generator.Register(id, fn)
}

// LoadPatterns loads patterns from JSON files
func (e *Engine) LoadPatterns(path string) error {
	loader := NewLoader()
	patterns, err := loader.LoadDir(path)
	if err != nil {
		return err
	}
	for i := range patterns {
		e.matcher.Register(&patterns[i])
	}
	return nil
}

// GetAnalyzer returns the context analyzer
func (e *Engine) GetAnalyzer() *ContextAnalyzer {
	return e.analyzer
}

// GetMatcher returns the pattern matcher
func (e *Engine) GetMatcher() *PatternMatcher {
	return e.matcher
}

func (e *Engine) GetGenerator() *Generator {
	return e.generator
}

func (e *Engine) SetSymbolProvider(sp SymbolProvider) {
	e.generator.SetSymbolProvider(sp)
}

func (e *Engine) RegisterPluginProvider(provider PluginResolverProvider) {
	e.generator.RegisterPluginProvider(provider)
}

func (e *Engine) filterPatternsByPrefix(patterns []*Pattern, prefix string) []*Pattern {
	if len(patterns) == 0 {
		return nil
	}

	prefixLower := strings.ToLower(strings.TrimSpace(prefix))

	if prefixLower == "" {
		type scoredPattern struct {
			pattern *Pattern
			score   int
		}
		scored := make([]scoredPattern, 0, len(patterns))
		for _, p := range patterns {
			score := p.Priority
			if p.Trigger.Type == TriggerTypeEmpty {
				score += 20
			}
			scored = append(scored, scoredPattern{p, score})
		}
		sort.Slice(scored, func(i, j int) bool {
			return scored[i].score > scored[j].score
		})
		maxResults := 20
		if len(scored) < maxResults {
			maxResults = len(scored)
		}
		filtered := make([]*Pattern, maxResults)
		for i := 0; i < maxResults; i++ {
			filtered[i] = scored[i].pattern
		}
		return filtered
	}

	filtered := make([]*Pattern, 0, len(patterns)/2)

	for _, p := range patterns {
		if e.patternMatchesPrefix(p, prefixLower) {
			filtered = append(filtered, p)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].Priority > filtered[j].Priority
	})

	if len(filtered) > 25 {
		return filtered[:25]
	}

	return filtered
}

func (e *Engine) patternMatchesPrefix(p *Pattern, prefixLower string) bool {
	if p.Trigger.Type == TriggerTypePrefix && p.Trigger.Value != "" {
		triggerLower := strings.ToLower(p.Trigger.Value)
		if strings.HasPrefix(triggerLower, prefixLower) || strings.HasPrefix(prefixLower, triggerLower) {
			return true
		}
	}

	keywords := e.extractKeywords(p.Name)
	for _, kw := range keywords {
		if strings.HasPrefix(kw, prefixLower) {
			return true
		}
	}

	return false
}

func (e *Engine) extractKeywords(name string) []string {
	name = strings.ToLower(name)

	keywords := []string{name}

	words := strings.Fields(name)
	for _, w := range words {
		keywords = append(keywords, w)
	}

	for _, w := range words {
		if len(w) >= 3 {
			keywords = append(keywords, w[:3])
		}
	}

	abbrev := ""
	for _, w := range words {
		if len(w) > 0 {
			abbrev += string(w[0])
		}
	}
	if len(abbrev) >= 2 {
		keywords = append(keywords, abbrev)
	}

	return keywords
}

// CompletionResult represents a completion result for integration with brain
type CompletionResult struct {
	Text       string
	Label      string
	Priority   int
	Kind       string // "scaffold", "completion", "snippet"
	IsSkeleton bool
}

// GetCompletions returns completions in a format suitable for brain integration
func (e *Engine) GetCompletions(filePath, content string, line, column int, limit int) []CompletionResult {
	return e.GetCompletionsForLanguage("", filePath, content, line, column, limit)
}

func (e *Engine) GetCompletionsForLanguage(language, filePath, content string, line, column int, limit int) []CompletionResult {
	return e.getCompletionResults(e.PredictForLanguage(language, filePath, content, line, column), limit)
}

func (e *Engine) GetCompletionsForLanguageBytes(language, filePath string, content []byte, line, column int, limit int) []CompletionResult {
	return e.getCompletionResults(e.PredictForLanguageBytes(language, filePath, content, line, column), limit)
}

func (e *Engine) getCompletionResults(suggestions []Suggestion, limit int) []CompletionResult {
	if len(suggestions) == 0 {
		return nil
	}

	// Limit results
	if limit > 0 && len(suggestions) > limit {
		suggestions = suggestions[:limit]
	}

	results := make([]CompletionResult, 0, len(suggestions))
	for _, s := range suggestions {
		if s.IsScaffold {
			continue
		}
		if s.Pattern != nil && (!s.HasResolvedData || s.UsesFallbackDefaults) {
			continue
		}

		kind := "completion"
		results = append(results, CompletionResult{
			Text:       s.Text,
			Label:      s.DisplayText,
			Priority:   int(s.Score),
			Kind:       kind,
			IsSkeleton: s.IsScaffold,
		})
	}

	if len(results) == 0 {
		return nil
	}

	return results
}

type PrefixInfo struct {
	Prefix            string
	InString          bool
	InComment         bool
	InImport          bool
	StringValue       string
	StringContextType string
	AccessChain       string
	Language          string
	PositionContext   string
}

func (e *Engine) ExtractPrefix(filePath string, content []byte, line, column int) PrefixInfo {
	return e.extractPrefix(filePath, content, line, column, true)
}

// ExtractPrefixFast extracts the completion-relevant prefix flags with one
// Tree-sitter parse. Callers that need PositionContext must use ExtractPrefix.
func (e *Engine) ExtractPrefixFast(filePath string, content []byte, line, column int) PrefixInfo {
	return e.extractPrefix(filePath, content, line, column, false)
}

func (e *Engine) extractPrefix(filePath string, content []byte, line, column int, includePositionContext bool) PrefixInfo {
	language := e.analyzer.detectLanguage(filePath)

	prefix, inString, stringContent, accessChain, inComment, inImport, stringCtxType := e.analyzer.ast.ExtractPrefixAtPosition(
		language, content, line, column,
	)

	posCtx := ""
	if includePositionContext {
		ctx := e.analyzer.Analyze(filePath, content, line, column)
		if ctx != nil {
			posCtx = string(ctx.Position.Context)
		}
	}

	return PrefixInfo{
		Prefix:            prefix,
		InString:          inString,
		InComment:         inComment,
		InImport:          inImport,
		StringValue:       stringContent,
		StringContextType: stringCtxType,
		AccessChain:       accessChain,
		Language:          language,
		PositionContext:   posCtx,
	}
}
