package brain

import (
	"container/list"
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"arlecchino/internal/autocomplete"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
	"arlecchino/internal/predictive"
)

var shortPrefixExternalLanguages = map[string]struct{}{
	"bash":  {},
	"go":    {},
	"shell": {},
	"sh":    {},
	"zsh":   {},
}

func externalCompletionMinPrefixRunes(ctx CompletionContext) int {
	if ctx.InImport {
		return 0
	}
	if _, ok := shortPrefixExternalLanguages[strings.ToLower(ctx.Language)]; ok {
		return 1
	}
	return 2
}

func shouldSkipLSP(ctx CompletionContext) bool {
	if ctx.AccessChain != "" {
		return false
	}
	if ctx.TriggerChar != "" {
		// Only treat TriggerChar as meaningful when it contains at least one
		// non-identifier character (e.g. '.', ':', '<', '>', etc.).
		// Frontend may set TriggerChar to the last typed character, which can be
		// a normal letter/digit - that should not prevent short-prefix skipping.
		for _, r := range ctx.TriggerChar {
			isWord :=
				(r >= 'a' && r <= 'z') ||
					(r >= 'A' && r <= 'Z') ||
					(r >= '0' && r <= '9') ||
					r == '_' ||
					r == '$'
			if !isWord {
				return false
			}
		}
	}
	return utf8.RuneCountInString(ctx.Prefix) < externalCompletionMinPrefixRunes(ctx)
}

func shouldSkipIndexGroup(ctx CompletionContext) bool {
	if ctx.InImport {
		return false
	}
	return shouldSkipLSP(ctx)
}

func shouldSkipPatternGroup(ctx CompletionContext) bool {
	if ctx.InImport {
		return false
	}
	if ctx.InString {
		return false
	}
	return shouldSkipLSP(ctx)
}

var LanguageConfidenceThresholds = map[string]float64{
	"go": 0.25, "typescript": 0.25, "javascript": 0.25, "python": 0.25, "rust": 0.25,
	"php": 0.30, "ruby": 0.30, "java": 0.30, "csharp": 0.30, "kotlin": 0.30, "swift": 0.30, "cpp": 0.30, "c": 0.30,
	"elixir": 0.40, "haskell": 0.40, "scala": 0.40, "ocaml": 0.45, "cobol": 0.50,
}

var snippetPlaceholderPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\$\{\d+:[^}]*\}`),
	regexp.MustCompile(`\$\{\d+\}`),
	regexp.MustCompile(`\$\d+`),
	regexp.MustCompile(`\$\{[A-Z_][A-Z0-9_]*\}`),
	regexp.MustCompile(`\$[A-Z_][A-Z0-9_]*`),
}

var snippetCleanupPatterns = []struct {
	replace *regexp.Regexp
	value   string
}{
	{replace: regexp.MustCompile(`\(\s*,\s*`), value: "("},
	{replace: regexp.MustCompile(`,\s*\)`), value: ")"},
	{replace: regexp.MustCompile(`,\s*,`), value: ","},
}

var debugLoggingEnabled = strings.EqualFold(os.Getenv("ARLE_DEBUG"), "1") ||
	strings.EqualFold(os.Getenv("ARLE_DEBUG"), "true")

const (
	lspCompletionTimeout     = 500 * time.Millisecond
	lspFallbackFastWait      = 120 * time.Millisecond
	lspNoFallbackGenericWait = 250 * time.Millisecond
	lspNoFallbackFocusedWait = lspCompletionTimeout
)

func debugLogf(format string, args ...any) {
	if !debugLoggingEnabled {
		return
	}
	log.Printf(format, args...)
}

func GetLanguageConfidenceThreshold(lang string) float64 {
	if threshold, ok := LanguageConfidenceThresholds[strings.ToLower(lang)]; ok {
		return threshold
	}
	return 0.35
}

type CompletionCache struct {
	mu       sync.RWMutex
	capacity int
	ttl      time.Duration
	cache    map[string]*cacheEntry
	order    *list.List
	keyToEl  map[string]*list.Element
}

type cacheEntry struct {
	key        string
	filePath   string
	result     []Suggestion
	expiration time.Time
}

func NewCompletionCache(capacity int, ttl time.Duration) *CompletionCache {
	return &CompletionCache{
		capacity: capacity,
		ttl:      ttl,
		cache:    make(map[string]*cacheEntry),
		order:    list.New(),
		keyToEl:  make(map[string]*list.Element),
	}
}

func (c *CompletionCache) cacheKey(ctx CompletionContext) string {
	h := md5.New()
	// Note: Column removed from key intentionally - same line/prefix should hit cache
	// regardless of exact cursor position within the same token
	h.Write([]byte(fmt.Sprintf(
		"%s:%d:%s:%s:%s:%t:%t:%s:%t:%t:%s:%s",
		ctx.FilePath,
		ctx.Line,
		ctx.Prefix,
		ctx.Language,
		ctx.AccessChain,
		ctx.InImport,
		ctx.InString,
		ctx.StringContextType,
		ctx.IsMethodCall,
		ctx.IsStaticCall,
		ctx.TriggerChar,
		ctx.ImportsHash,
	)))
	return hex.EncodeToString(h.Sum(nil))
}

func (c *CompletionCache) Get(ctx CompletionContext) ([]Suggestion, bool) {
	c.mu.RLock()
	key := c.cacheKey(ctx)
	entry, ok := c.cache[key]
	c.mu.RUnlock()

	if !ok {
		return nil, false
	}

	if time.Now().After(entry.expiration) {
		c.mu.Lock()
		delete(c.cache, key)
		if el, exists := c.keyToEl[key]; exists {
			c.order.Remove(el)
			delete(c.keyToEl, key)
		}
		c.mu.Unlock()
		return nil, false
	}

	c.mu.Lock()
	if el, exists := c.keyToEl[key]; exists {
		c.order.MoveToFront(el)
	}
	c.mu.Unlock()

	return entry.result, true
}

func (c *CompletionCache) Set(ctx CompletionContext, result []Suggestion) {
	c.mu.Lock()
	defer c.mu.Unlock()

	key := c.cacheKey(ctx)

	if entry, ok := c.cache[key]; ok {
		entry.result = result
		entry.expiration = time.Now().Add(c.ttl)
		if el, exists := c.keyToEl[key]; exists {
			c.order.MoveToFront(el)
		}
		return
	}

	for c.order.Len() >= c.capacity {
		oldest := c.order.Back()
		if oldest == nil {
			break
		}
		oldKey := oldest.Value.(string)
		c.order.Remove(oldest)
		delete(c.cache, oldKey)
		delete(c.keyToEl, oldKey)
	}

	entry := &cacheEntry{
		key:        key,
		filePath:   ctx.FilePath,
		result:     result,
		expiration: time.Now().Add(c.ttl),
	}
	c.cache[key] = entry
	el := c.order.PushFront(key)
	c.keyToEl[key] = el
}

func (c *CompletionCache) Invalidate(filePath string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if filePath == "" {
		c.cache = make(map[string]*cacheEntry)
		c.order.Init()
		c.keyToEl = make(map[string]*list.Element)
		return
	}

	for key, entry := range c.cache {
		if entry == nil || entry.filePath != filePath {
			continue
		}
		delete(c.cache, key)
		if el, exists := c.keyToEl[key]; exists {
			c.order.Remove(el)
			delete(c.keyToEl, key)
		}
	}
}

func (b *PredictionBrain) InvalidateCompletionCache(filePath string) {
	if b == nil || b.completionCache == nil {
		return
	}
	b.completionCache.Invalidate(filePath)
}

func (c *CompletionCache) Stats() (size int) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.cache)
}

type PredictionBrain struct {
	mu                sync.RWMutex
	engine            *core.Engine
	usage             *UsageTracker
	enhancedUsage     *EnhancedUsageTracker
	persistentUsage   *PersistentUsageTracker
	lspManager        *lsp.Manager
	virtualStore      *VirtualStore
	predictive        *predictive.Engine
	local             *predictive.LocalCompletions
	fillAll           *predictive.FillAllFields
	config            BrainConfig
	matcher           *predictive.SmartMatcher
	smartRanker       *SmartRanker
	langDetector      *LangDetector
	autoImporter      *AutoImporter
	stringCompletions *StringCompletionProvider
	importCompletions *ImportCompletionProvider
	crossFile         *CrossFileProvider
	importResolver    *ImportChainResolver
	recentSymbols     []string
	arle              *Arle
	docEnricher       *DocEnricher
	stubProvider      *StubProvider
	completionCache   *CompletionCache
	ghostFilter       *GhostTextFilter
	userBehavior      *UserBehavior
	providerManager   *ProviderManager
	lastTrace         atomic.Value
}

type BrainConfig struct {
	MaxSuggestions    int
	MinConfidence     float64
	EnableLSP         bool
	EnableSpeculative bool
	EnableVirtual     bool
	EnablePredictive  bool
	VirtualTTL        time.Duration
	DebounceMs        int
}

type Suggestion struct {
	Text                string
	DisplayText         string
	Kind                core.SymbolKind
	Source              core.SymbolSource
	Score               float64
	Confidence          float64
	Detail              string
	Documentation       string
	TypeInfo            string
	FilePath            string
	Line                int
	Namespace           string
	InsertText          string
	IsSnippet           bool
	Snippet             string
	Extra               map[string]string
	AdditionalTextEdits []core.TextEdit
	MatchResult         *predictive.MatchResult
}

// HighlightPositions returns byte positions for UI highlighting
func (s *Suggestion) HighlightPositions() []int {
	if s.MatchResult == nil {
		return nil
	}
	return s.MatchResult.Positions
}

// MatchType returns the type of match (for filtering ghost text)
func (s *Suggestion) MatchType() predictive.MatchType {
	if s.MatchResult == nil {
		return predictive.MatchNone
	}
	return s.MatchResult.Type
}

type CompletionContext struct {
	FilePath           string
	Content            []byte
	FullContent        []byte
	Line               int
	Column             int
	Prefix             string
	Language           string
	LanguageResolution autocomplete.LanguageResolution
	ImportsHash        string
	TriggerChar        string
	Scope              string
	ParentClass        string
	ContentStartLine   int
	RequestID          string
	Ctx                context.Context

	InString          bool
	InComment         bool
	InImport          bool
	StringValue       string
	StringContextType string
	AccessChain       string
	ResolvedNamespace string
	IsMethodCall      bool
	IsStaticCall      bool
}

type CompletionTrace struct {
	RequestID          string            `json:"requestId"`
	FilePath           string            `json:"filePath"`
	Language           string            `json:"language"`
	Prefix             string            `json:"prefix"`
	AccessChain        string            `json:"accessChain"`
	ResolvedNamespace  string            `json:"resolvedNamespace"`
	DurationMs         int64             `json:"durationMs"`
	SourceDurationsMs  map[string]int64  `json:"sourceDurationsMs"`
	LSPStatus          string            `json:"lspStatus"`
	CacheHit           bool              `json:"cacheHit"`
	BeforeFilter       int               `json:"beforeFilter"`
	AfterPrefixFilter  int               `json:"afterPrefixFilter"`
	AfterContextFilter int               `json:"afterContextFilter"`
	AfterDedup         int               `json:"afterDedup"`
	ResultCount        int               `json:"resultCount"`
	SourceCounts       map[string]int    `json:"sourceCounts"`
	TopSuggestions     []TraceSuggestion `json:"topSuggestions"`
}

type TraceSuggestion struct {
	Text      string            `json:"text"`
	Source    core.SymbolSource `json:"source"`
	Kind      core.SymbolKind   `json:"kind"`
	Namespace string            `json:"namespace,omitempty"`
	Score     float64           `json:"score"`
}

func (b *PredictionBrain) HasARLELanguageSupport(language string) bool {
	b.mu.RLock()
	langDetector := b.langDetector
	b.mu.RUnlock()
	if langDetector == nil || language == "" {
		return false
	}
	language = strings.ToLower(strings.TrimSpace(language))
	for _, supported := range langDetector.SupportedLanguages() {
		if strings.EqualFold(strings.TrimSpace(supported), language) {
			return true
		}
	}
	return false
}

func contentLine(ctx CompletionContext) int {
	if ctx.ContentStartLine <= 0 {
		return ctx.Line
	}
	return ctx.Line - ctx.ContentStartLine + 1
}

func contentLineOffset(ctx CompletionContext) int {
	if ctx.ContentStartLine <= 0 {
		return 0
	}
	return ctx.ContentStartLine - 1
}

func isCanceled(ctx CompletionContext) bool {
	if ctx.Ctx == nil {
		return false
	}
	return ctx.Ctx.Err() != nil
}

var fillAllBlockedCallTargets = map[string]struct{}{
	"if":     {},
	"for":    {},
	"switch": {},
	"while":  {},
	"catch":  {},
	"func":   {},
	"return": {},
}

func isCallTargetChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') ||
		(ch >= 'A' && ch <= 'Z') ||
		(ch >= '0' && ch <= '9') ||
		ch == '_' || ch == '.' || ch == ':' || ch == '>' || ch == '$'
}

func extractCallTargetSuffix(beforeCursor string) string {
	end := len(beforeCursor)
	for end > 0 && beforeCursor[end-1] == ' ' {
		end--
	}
	start := end
	for start > 0 && isCallTargetChar(beforeCursor[start-1]) {
		start--
	}
	return strings.TrimSpace(beforeCursor[start:end])
}

func shouldOfferFillAll(ctx CompletionContext) bool {
	if strings.TrimSpace(ctx.Prefix) != "" {
		return false
	}

	line := contentLine(ctx)
	if line <= 0 {
		return false
	}

	lines := strings.Split(string(ctx.Content), "\n")
	if line > len(lines) {
		return false
	}

	lineText := lines[line-1]
	column := ctx.Column
	if column < 0 {
		column = 0
	}
	if column > len(lineText) {
		column = len(lineText)
	}

	beforeCursor := lineText[:column]
	parenIdx := strings.LastIndex(beforeCursor, "(")
	if parenIdx == -1 {
		return false
	}
	if strings.TrimSpace(beforeCursor[parenIdx+1:]) != "" {
		return false
	}

	target := extractCallTargetSuffix(beforeCursor[:parenIdx])
	if target == "" {
		return false
	}
	if _, blocked := fillAllBlockedCallTargets[strings.ToLower(target)]; blocked {
		return false
	}
	return true
}

func suggestionAddsUsefulCompletion(s Suggestion, prefix string) bool {
	if len(s.AdditionalTextEdits) > 0 {
		return true
	}

	insertText := strings.TrimSpace(s.InsertText)
	if insertText == "" {
		insertText = strings.TrimSpace(s.Text)
	}
	if insertText == "" || prefix == "" {
		return false
	}

	insertLower := strings.ToLower(insertText)
	prefixLower := strings.ToLower(prefix)
	if insertLower == prefixLower {
		return false
	}

	return strings.HasPrefix(insertLower, prefixLower) && len(insertText) > len(prefix)
}

func isExactSelfEchoSuggestion(s Suggestion, prefix string) bool {
	if prefix == "" {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(s.Text), strings.TrimSpace(prefix)) {
		return false
	}
	return !suggestionAddsUsefulCompletion(s, prefix)
}

func NewPredictionBrain(engine *core.Engine, config BrainConfig) *PredictionBrain {
	if config.MaxSuggestions == 0 {
		config.MaxSuggestions = 50
	}
	if config.MinConfidence == 0 {
		config.MinConfidence = 0.1
	}
	if config.VirtualTTL == 0 {
		config.VirtualTTL = 5 * time.Minute
	}

	var vs *VirtualStore
	if config.EnableVirtual && engine != nil {
		vs = NewVirtualStore(engine.Store(), config.VirtualTTL)
	}

	pe := predictive.NewEngine()
	lc := predictive.NewLocalCompletions()
	fa := predictive.NewFillAllFields()
	sm := predictive.NewSmartMatcher()

	if engine != nil && engine.Store() != nil {
		adapter := predictive.NewStoreAdapter(engine.Store(), engine.ProjectRoot())
		pe.SetSymbolProvider(adapter)
	}

	var persistentUsage *PersistentUsageTracker
	if engine != nil && engine.Store() != nil {
		persistentUsage = NewPersistentUsageTracker(engine.Store())
	}

	arle := NewArle(DefaultArleConfig())

	assetsDir := ""
	if arle != nil {
		cfg := DefaultArleConfig()
		if cfg.ModelPath != "" {
			assetsDir = getDirectory(cfg.ModelPath)
		}
	}
	langDetector, _ := NewLangDetector(assetsDir)

	var crossFile *CrossFileProvider
	if engine != nil {
		crossFile = NewCrossFileProvider(engine)
	}

	importResolver := NewImportChainResolver()

	var docEnricher *DocEnricher
	if engine != nil {
		docEnricher = NewDocEnricher(engine.ProjectRoot())
	}

	importCompletions := NewImportCompletionProvider(engine)

	stubProvider := NewStubProviderWithBuiltins()
	if engine != nil {
		stubProvider.SetProjectRoot(engine.ProjectRoot())
	}
	if importCompletions != nil && importCompletions.catalog != nil {
		stubProvider.SetPackageResolver(importCompletions.catalog.ResolveLibraryByOwner)
	}
	stubProvider.LoadStubs()

	completionCache := NewCompletionCache(1000, 5*time.Minute)
	ghostFilter := NewGhostTextFilter()
	ghostFilter.SetIdleTimeout(900 * time.Millisecond)
	userBehavior := NewUserBehavior()
	providerManager := NewProviderManager()

	return &PredictionBrain{
		engine:            engine,
		usage:             NewUsageTracker(),
		enhancedUsage:     NewEnhancedUsageTracker(),
		persistentUsage:   persistentUsage,
		virtualStore:      vs,
		predictive:        pe,
		local:             lc,
		fillAll:           fa,
		config:            config,
		matcher:           sm,
		smartRanker:       NewSmartRanker(persistentUsage, langDetector),
		langDetector:      langDetector,
		autoImporter:      NewAutoImporter(),
		stringCompletions: NewStringCompletionProvider(engine),
		importCompletions: importCompletions,
		crossFile:         crossFile,
		importResolver:    importResolver,
		recentSymbols:     make([]string, 0, 10),
		arle:              arle,
		docEnricher:       docEnricher,
		stubProvider:      stubProvider,
		completionCache:   completionCache,
		ghostFilter:       ghostFilter,
		userBehavior:      userBehavior,
		providerManager:   providerManager,
	}
}

type providerGroupResult struct {
	suggestions []Suggestion
	counts      map[string]int
	durations   map[string]int64
	lspStatus   string
}

func mergeCounts(dst, src map[string]int) {
	for key, value := range src {
		dst[key] = value
	}
}

func mergeDurations(dst, src map[string]int64) {
	for key, value := range src {
		dst[key] += value
	}
}

func elapsedMs(start time.Time) int64 {
	return time.Since(start).Milliseconds()
}

func lspWaitBudget(ctx CompletionContext, fallbackCount int) time.Duration {
	if fallbackCount > 0 {
		return lspFallbackFastWait
	}
	if ctx.InImport || ctx.AccessChain != "" || ctx.IsMethodCall || ctx.IsStaticCall {
		return lspNoFallbackFocusedWait
	}
	return lspNoFallbackGenericWait
}

func contextStatus(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case err != nil:
		return "error"
	default:
		return "complete"
	}
}

func (b *PredictionBrain) collectLocalGroup(
	ctx CompletionContext,
	config BrainConfig,
	fillAll *predictive.FillAllFields,
	local *predictive.LocalCompletions,
	virtualStore *VirtualStore,
) (result providerGroupResult) {
	startedAt := time.Now()
	result = providerGroupResult{
		counts: map[string]int{
			"fillAll":     0,
			"local":       0,
			"virtual":     0,
			"speculative": 0,
		},
		durations: map[string]int64{},
	}
	defer func() {
		result.durations["localGroup"] = elapsedMs(startedAt)
	}()

	if isCanceled(ctx) {
		return result
	}

	if fillAll != nil {
		if isCanceled(ctx) {
			return result
		}
		fillSuggestions := b.fromFillAll(ctx)
		result.suggestions = append(result.suggestions, fillSuggestions...)
		result.counts["fillAll"] = len(fillSuggestions)
	}

	if local != nil {
		if isCanceled(ctx) {
			return result
		}
		localSuggestions := b.fromLocal(ctx)
		result.suggestions = append(result.suggestions, localSuggestions...)
		result.counts["local"] = len(localSuggestions)
	}

	if config.EnableVirtual {
		if virtualStore != nil {
			if isCanceled(ctx) {
				return result
			}
			virtualSuggestions := b.fromVirtual(ctx)
			result.suggestions = append(result.suggestions, virtualSuggestions...)
			result.counts["virtual"] = len(virtualSuggestions)
		} else {
			result.counts["virtual"] = -2
		}
	} else {
		result.counts["virtual"] = -1
	}

	if config.EnableSpeculative {
		if isCanceled(ctx) {
			return result
		}
		specSuggestions := b.fromSpeculative(ctx)
		result.suggestions = append(result.suggestions, specSuggestions...)
		result.counts["speculative"] = len(specSuggestions)
	} else {
		result.counts["speculative"] = -1
	}

	return result
}

func (b *PredictionBrain) collectIndexGroup(ctx CompletionContext) (result providerGroupResult) {
	startedAt := time.Now()
	result = providerGroupResult{
		counts: map[string]int{
			"index":     0,
			"crossFile": 0,
			"facade":    0,
		},
		durations: map[string]int64{},
	}
	defer func() {
		result.durations["indexGroup"] = elapsedMs(startedAt)
	}()

	if isCanceled(ctx) {
		return result
	}
	if shouldSkipIndexGroup(ctx) {
		result.counts["index"] = -4
		result.counts["crossFile"] = -4
		result.counts["facade"] = -4
		return result
	}

	indexSuggestions := b.fromIndex(ctx)
	result.suggestions = append(result.suggestions, indexSuggestions...)
	result.counts["index"] = len(indexSuggestions)

	if isCanceled(ctx) {
		return result
	}
	crossFileSuggestions := b.fromCrossFile(ctx)
	result.suggestions = append(result.suggestions, crossFileSuggestions...)
	result.counts["crossFile"] = len(crossFileSuggestions)

	if isCanceled(ctx) {
		return result
	}
	facadeSuggestions := b.fromFacadeMethods(ctx)
	result.suggestions = append(result.suggestions, facadeSuggestions...)
	result.counts["facade"] = len(facadeSuggestions)

	return result
}

func (b *PredictionBrain) collectPatternGroup(
	ctx CompletionContext,
	predictiveEngine *predictive.Engine,
) (result providerGroupResult) {
	startedAt := time.Now()
	result = providerGroupResult{
		counts: map[string]int{
			"predictive": 0,
			"stubs":      0,
			"keywords":   0,
		},
		durations: map[string]int64{},
	}
	defer func() {
		result.durations["patternGroup"] = elapsedMs(startedAt)
	}()

	if isCanceled(ctx) {
		return result
	}

	skipHeavy := shouldSkipPatternGroup(ctx)
	if skipHeavy {
		result.counts["predictive"] = -4
		result.counts["stubs"] = -4
	}

	if predictiveEngine != nil && !skipHeavy {
		if isCanceled(ctx) {
			return result
		}
		predSuggestions := b.fromPredictive(ctx)
		result.suggestions = append(result.suggestions, predSuggestions...)
		result.counts["predictive"] = len(predSuggestions)
	}

	if isCanceled(ctx) {
		return result
	}
	if !skipHeavy {
		stubSuggestions := b.fromStubs(ctx)
		result.suggestions = append(result.suggestions, stubSuggestions...)
		result.counts["stubs"] = len(stubSuggestions)
	}

	if isCanceled(ctx) {
		return result
	}
	keywordSuggestions := b.fromKeywords(ctx)
	result.suggestions = append(result.suggestions, keywordSuggestions...)
	result.counts["keywords"] = len(keywordSuggestions)

	return result
}

func (b *PredictionBrain) collectExternalGroup(
	ctx CompletionContext,
	config BrainConfig,
	lspManager *lsp.Manager,
) (result providerGroupResult) {
	startedAt := time.Now()
	result = providerGroupResult{
		counts: map[string]int{
			"lsp": 0,
		},
		durations: map[string]int64{},
		lspStatus: "not-run",
	}
	defer func() {
		result.durations["lsp"] = elapsedMs(startedAt)
	}()

	if isCanceled(ctx) {
		result.lspStatus = "canceled"
		return result
	}

	if config.EnableLSP && lspManager != nil {
		if isCanceled(ctx) {
			result.lspStatus = "canceled"
			return result
		}
		if shouldSkipLSP(ctx) {
			result.counts["lsp"] = -4
			result.lspStatus = "skipped-short-prefix"
			return result
		}
		lspSuggestions, status := b.fromLSPWithReason(ctx)
		result.suggestions = append(result.suggestions, lspSuggestions...)
		result.counts["lsp"] = len(lspSuggestions)
		result.lspStatus = status
	} else if !config.EnableLSP {
		result.counts["lsp"] = -1
		result.lspStatus = "disabled"
	} else {
		result.counts["lsp"] = -2
		result.lspStatus = "missing-manager"
	}

	return result
}

func (b *PredictionBrain) Complete(ctx CompletionContext) []Suggestion {
	startedAt := time.Now()
	ctx = withResolvedLanguage(ctx)
	trace := CompletionTrace{
		RequestID:         ctx.RequestID,
		FilePath:          ctx.FilePath,
		Language:          ctx.Language,
		Prefix:            ctx.Prefix,
		AccessChain:       ctx.AccessChain,
		ResolvedNamespace: ctx.ResolvedNamespace,
		SourceCounts:      map[string]int{},
		SourceDurationsMs: map[string]int64{},
		LSPStatus:         "not-run",
	}
	defer func() {
		trace.DurationMs = elapsedMs(startedAt)
		b.lastTrace.Store(trace)
	}()

	debugLogf("[Complete] START lang=%s prefix='%s' line=%d col=%d chain='%s'",
		ctx.Language, ctx.Prefix, ctx.Line, ctx.Column, ctx.AccessChain)

	if isCanceled(ctx) {
		debugLogf("[Complete] CANCELED: request context done")
		return nil
	}

	if ctx.InComment {
		debugLogf("[Complete] SKIP: in comment")
		return nil
	}

	if b.completionCache != nil {
		if cached, ok := b.completionCache.Get(ctx); ok {
			trace.CacheHit = true
			trace.ResultCount = len(cached)
			trace.TopSuggestions = buildTraceSuggestions(cached)
			debugLogf("[Complete] CACHE HIT: %d items", len(cached))
			return cached
		}
	}

	b.mu.RLock()
	fillAll := b.fillAll
	local := b.local
	predictiveEngine := b.predictive
	lspManager := b.lspManager
	virtualStore := b.virtualStore
	config := b.config
	stringCompletions := b.stringCompletions
	importCompletions := b.importCompletions
	b.mu.RUnlock()

	debugLogf("[Complete] Config: EnableLSP=%v EnableVirtual=%v EnablePredictive=%v EnableSpeculative=%v",
		config.EnableLSP, config.EnableVirtual, config.EnablePredictive, config.EnableSpeculative)
	debugLogf("[Complete] Components: lspManager=%v local=%v predictive=%v fillAll=%v",
		lspManager != nil, local != nil, predictiveEngine != nil, fillAll != nil)

	var importSuggestions []Suggestion
	if ctx.InImport && importCompletions != nil {
		importStartedAt := time.Now()
		importCtx := withSourceLanguage(ctx, completionLanguageResolution(ctx).CanonicalID)
		importSuggestions = importCompletions.GetCompletions(importCtx)
		trace.SourceDurationsMs["import"] = elapsedMs(importStartedAt)
		if len(importSuggestions) > 0 {
			debugLogf("[Complete] IMPORT: %d items", len(importSuggestions))
		}
	}

	if ctx.InString {
		if ctx.StringContextType != "" && stringCompletions != nil {
			strSuggestions := stringCompletions.GetCompletions(ctx)
			if len(strSuggestions) > 0 {
				debugLogf("[Complete] STRING (%s): %d items", ctx.StringContextType, len(strSuggestions))
				return strSuggestions
			}
		}
		debugLogf("[Complete] STRING: fallback to normal completions (context=%s)", ctx.StringContextType)
		ctx.InString = false
	}

	b.ResolveAccessChain(&ctx)

	if isCanceled(ctx) {
		return nil
	}

	var suggestions []Suggestion
	counts := make(map[string]int)

	// Use context with timeout to prevent goroutine leak
	// When timeout fires, cancel is called which allows the goroutine to exit
	lspBaseCtx := ctx.Ctx
	if lspBaseCtx == nil {
		lspBaseCtx = context.Background()
	}
	lspCtx, lspCancel := context.WithTimeout(lspBaseCtx, lspCompletionTimeout)
	defer lspCancel()

	externalCh := make(chan providerGroupResult, 1)
	go func() {
		externalCtx := ctx
		externalCtx.Ctx = lspCtx
		result := b.collectExternalGroup(externalCtx, config, lspManager)
		select {
		case externalCh <- result:
		case <-lspCtx.Done():
			// Timeout occurred, discard result to prevent goroutine leak
		}
	}()

	if len(importSuggestions) > 0 {
		counts["import"] = len(importSuggestions)
		suggestions = append(suggestions, importSuggestions...)
	} else {
		localGroup := b.collectLocalGroup(ctx, config, fillAll, local, virtualStore)
		mergeCounts(counts, localGroup.counts)
		mergeDurations(trace.SourceDurationsMs, localGroup.durations)
		suggestions = append(suggestions, localGroup.suggestions...)

		patternGroup := b.collectPatternGroup(ctx, predictiveEngine)
		mergeCounts(counts, patternGroup.counts)
		mergeDurations(trace.SourceDurationsMs, patternGroup.durations)
		suggestions = append(suggestions, patternGroup.suggestions...)

		indexGroup := b.collectIndexGroup(ctx)
		mergeCounts(counts, indexGroup.counts)
		mergeDurations(trace.SourceDurationsMs, indexGroup.durations)
		suggestions = append(suggestions, indexGroup.suggestions...)
	}

	externalGroup := providerGroupResult{counts: map[string]int{"lsp": -3}}
	lspWaitStartedAt := time.Now()
	lspWait := lspWaitBudget(ctx, len(suggestions))
	select {
	case externalGroup = <-externalCh:
		if externalGroup.lspStatus == "" {
			externalGroup.lspStatus = "complete"
		}
	case <-time.After(lspWait):
		externalGroup.lspStatus = "timeout"
	case <-lspCtx.Done():
		externalGroup.lspStatus = contextStatus(lspCtx.Err())
		debugLogf("[Complete] LSP timeout: proceeding without external results")
	}
	if externalGroup.counts == nil {
		externalGroup.counts = map[string]int{}
	}
	if externalGroup.durations == nil {
		externalGroup.durations = map[string]int64{}
	}
	if _, ok := externalGroup.durations["lsp"]; !ok {
		externalGroup.durations["lsp"] = elapsedMs(lspWaitStartedAt)
	}
	trace.LSPStatus = externalGroup.lspStatus
	mergeDurations(trace.SourceDurationsMs, externalGroup.durations)
	mergeCounts(counts, externalGroup.counts)
	if ctx.InImport {
		externalGroup.suggestions = stripAdditionalTextEdits(externalGroup.suggestions)
	}
	suggestions = append(suggestions, externalGroup.suggestions...)
	trace.SourceCounts = cloneCounts(counts)

	debugLogf("[Complete] SOURCES: import=%d fillAll=%d local=%d predictive=%d index=%d crossFile=%d facade=%d lsp=%d virtual=%d spec=%d stubs=%d kw=%d",
		counts["import"], counts["fillAll"], counts["local"], counts["predictive"], counts["index"],
		counts["crossFile"], counts["facade"], counts["lsp"], counts["virtual"],
		counts["speculative"], counts["stubs"], counts["keywords"])

	beforeFilter := len(suggestions)
	suggestions = b.filterByPrefix(ctx.Prefix, ctx.Language, suggestions)
	afterPrefixFilter := len(suggestions)
	suggestions = b.filterByContext(ctx, suggestions)
	afterContextFilter := len(suggestions)
	suggestions = b.deduplicate(suggestions)
	afterDedup := len(suggestions)
	suggestions = b.rank(ctx, suggestions)
	trace.ResolvedNamespace = ctx.ResolvedNamespace
	trace.BeforeFilter = beforeFilter
	trace.AfterPrefixFilter = afterPrefixFilter
	trace.AfterContextFilter = afterContextFilter
	trace.AfterDedup = afterDedup

	debugLogf("[Complete] FILTER: before=%d afterPrefix=%d afterContext=%d afterDedup=%d",
		beforeFilter, afterPrefixFilter, afterContextFilter, afterDedup)

	if len(suggestions) > config.MaxSuggestions {
		suggestions = suggestions[:config.MaxSuggestions]
	}

	if b.docEnricher != nil {
		for i := range suggestions {
			b.docEnricher.EnrichSuggestion(&suggestions[i], ctx.Language)
		}
	}

	if b.completionCache != nil && len(suggestions) > 0 {
		b.completionCache.Set(ctx, suggestions)
	}
	trace.ResultCount = len(suggestions)
	trace.TopSuggestions = buildTraceSuggestions(suggestions)

	debugLogf("[Complete] RESULT: %d suggestions for lang=%s", len(suggestions), ctx.Language)
	return suggestions
}

func buildTraceSuggestions(suggestions []Suggestion) []TraceSuggestion {
	limit := len(suggestions)
	if limit > 8 {
		limit = 8
	}
	result := make([]TraceSuggestion, 0, limit)
	for i := 0; i < limit; i++ {
		s := suggestions[i]
		result = append(result, TraceSuggestion{
			Text:      s.Text,
			Source:    s.Source,
			Kind:      s.Kind,
			Namespace: s.Namespace,
			Score:     s.Score,
		})
	}
	return result
}

func cloneCounts(counts map[string]int) map[string]int {
	cloned := make(map[string]int, len(counts))
	for k, v := range counts {
		cloned[k] = v
	}
	return cloned
}

func withResolvedLanguage(ctx CompletionContext) CompletionContext {
	if ctx.LanguageResolution.CanonicalID == "" {
		ctx.LanguageResolution = autocomplete.Resolve(ctx.Language, ctx.FilePath)
	}
	if strings.TrimSpace(ctx.Language) == "" {
		ctx.Language = ctx.LanguageResolution.CanonicalID
	}
	return ctx
}

func completionLanguageResolution(ctx CompletionContext) autocomplete.LanguageResolution {
	if ctx.LanguageResolution.CanonicalID != "" {
		return ctx.LanguageResolution
	}
	return autocomplete.Resolve(ctx.Language, ctx.FilePath)
}

func withSourceLanguage(ctx CompletionContext, language string) CompletionContext {
	ctx = withResolvedLanguage(ctx)
	if strings.TrimSpace(language) != "" {
		ctx.Language = language
	}
	return ctx
}

func stripAdditionalTextEdits(suggestions []Suggestion) []Suggestion {
	if len(suggestions) == 0 {
		return suggestions
	}
	for i := range suggestions {
		if len(suggestions[i].AdditionalTextEdits) > 0 {
			suggestions[i].AdditionalTextEdits = nil
		}
	}
	return suggestions
}

func (b *PredictionBrain) LastCompletionTrace() CompletionTrace {
	if value := b.lastTrace.Load(); value != nil {
		if trace, ok := value.(CompletionTrace); ok {
			return trace
		}
	}
	return CompletionTrace{}
}

// fromPredictive generates suggestions from the Predictive AST engine
// This provides context-aware code suggestions without AI/ML
func (b *PredictionBrain) fromPredictive(ctx CompletionContext) []Suggestion {
	if b.predictive == nil {
		return nil
	}
	if isCanceled(ctx) {
		return nil
	}
	predictiveLanguage := completionLanguageResolution(ctx).PredictiveID
	if predictiveLanguage == "" {
		return nil
	}

	// Get completions from predictive engine
	line := contentLine(ctx)
	results := b.predictive.GetCompletionsForLanguage(
		predictiveLanguage,
		ctx.FilePath,
		string(ctx.Content),
		line,
		ctx.Column,
		20, // limit
	)

	if len(results) == 0 {
		return nil
	}

	suggestions := make([]Suggestion, 0, len(results))
	for _, r := range results {
		kind := b.mapKeywordKind(r.Kind)
		if r.IsSkeleton {
			kind = core.SymbolKindClass // Use class icon for scaffolds
		}

		insertText := sanitizeInsertText(r.Text)
		if insertText == "" {
			insertText = r.Label
		}

		extra := map[string]string{}
		if r.IsSkeleton {
			extra["is_scaffold"] = "true"
		}

		suggestions = append(suggestions, Suggestion{
			Text:        r.Label,
			DisplayText: r.Label,
			Kind:        kind,
			Source:      core.SourcePredictive,
			Score:       float64(r.Priority) / 10.0,
			Detail:      r.Kind,
			InsertText:  insertText,
			IsSnippet:   false,
			Extra:       extra,
		})
	}

	return suggestions
}

// fromLocal generates suggestions from local file analysis
// This provides completions for symbols in the current file without LSP
func (b *PredictionBrain) fromLocal(ctx CompletionContext) []Suggestion {
	if b.local == nil {
		return nil
	}
	if isCanceled(ctx) {
		return nil
	}
	localLanguage := completionLanguageResolution(ctx).LocalID()
	if localLanguage == "" {
		return nil
	}

	// Get symbols from local file analysis
	line := contentLine(ctx)
	localSymbols := b.local.GetCompletionsForLanguage(ctx.FilePath, ctx.Content, line, ctx.Column, ctx.Prefix, localLanguage)
	offset := contentLineOffset(ctx)
	if offset > 0 {
		for i := range localSymbols {
			localSymbols[i].Line += offset
		}
	}

	if len(localSymbols) == 0 {
		return nil
	}

	suggestions := make([]Suggestion, 0, len(localSymbols))
	for _, sym := range localSymbols {
		// Map local symbol kind to core.SymbolKind
		kind := b.mapLocalKind(sym.Kind)

		// Calculate score - prefer symbols closer to cursor
		score := 5.0 // Base score

		// Boost if symbol is in current scope
		if sym.IsInScope {
			score += 2.0
		}

		// Boost symbols closer to cursor line
		lineDist := abs(sym.Line - ctx.Line)
		if lineDist < 10 {
			score += float64(10-lineDist) * 0.1
		}

		// Boost exact prefix match
		if strings.ToLower(sym.Name) == strings.ToLower(ctx.Prefix) && (sym.Kind == "function" || sym.Kind == "method") {
			score += 1.0
		}

		displayText := sym.Name
		if sym.Signature != "" {
			displayText = sym.Name + sym.Signature
		}

		suggestions = append(suggestions, Suggestion{
			Text:        sym.Name,
			DisplayText: displayText,
			Kind:        kind,
			Source:      core.SourceLocal, // We'll add this source
			Score:       score,
			Detail:      sym.Kind,
			FilePath:    ctx.FilePath,
			Line:        sym.Line,
			InsertText:  b.buildLocalInsertText(sym),
		})
	}

	return suggestions
}

func (b *PredictionBrain) fromFillAll(ctx CompletionContext) []Suggestion {
	if b.fillAll == nil {
		return nil
	}
	if !shouldOfferFillAll(ctx) {
		return nil
	}
	if isCanceled(ctx) {
		return nil
	}
	resolution := completionLanguageResolution(ctx)
	fillLanguage := resolution.FillID
	if fillLanguage == "" {
		return nil
	}

	var signature *predictive.SignatureInfo

	if b.lspManager != nil && resolution.LSPID != "" {
		sigCtx := ctx.Ctx
		if sigCtx == nil {
			sigCtx = context.Background()
		}
		sigHelp, err := b.lspManager.SignatureHelpWithContext(sigCtx, resolution.LSPID, ctx.FilePath, ctx.Line, ctx.Column)
		if err == nil && sigHelp != nil && len(sigHelp.Signatures) > 0 {
			activeSig := sigHelp.Signatures[0]
			if sigHelp.ActiveSignature < len(sigHelp.Signatures) {
				activeSig = sigHelp.Signatures[sigHelp.ActiveSignature]
			}

			signature = &predictive.SignatureInfo{
				Label:      activeSig.Label,
				Parameters: make([]predictive.ParameterInfo, len(activeSig.Parameters)),
			}
			for i, p := range activeSig.Parameters {
				signature.Parameters[i] = predictive.ParameterInfo{
					Label: p.Label,
				}
			}
		}
	}

	if signature == nil {
		signature = b.getSignatureFromIndex(ctx)
	}

	line := contentLine(ctx)
	var fills []predictive.FillSuggestion
	if signature != nil && len(signature.Parameters) > 0 {
		fills = b.fillAll.GetFillSuggestionsWithSignature(ctx.FilePath, ctx.Content, line, ctx.Column, fillLanguage, signature)
	} else {
		fills = b.fillAll.GetFillSuggestions(ctx.FilePath, ctx.Content, line, ctx.Column, fillLanguage)
	}
	if len(fills) == 0 {
		return nil
	}

	suggestions := make([]Suggestion, 0, len(fills))
	for _, fill := range fills {
		insertText := sanitizeInsertText(fill.InsertText)
		if insertText == "" {
			insertText = sanitizeInsertText(fill.DisplayText)
		}
		if strings.TrimSpace(insertText) == "" {
			continue
		}

		display := fill.DisplayText
		if display == "" {
			display = insertText
		}

		suggestions = append(suggestions, Suggestion{
			Text:        display,
			DisplayText: display,
			Kind:        core.SymbolKindText,
			Source:      core.SourceFillAll,
			Score:       fill.Score / 10.0,
			Detail:      "Fill arguments",
			InsertText:  insertText,
			IsSnippet:   false,
		})
	}

	return suggestions
}

func (b *PredictionBrain) getSignatureFromIndex(ctx CompletionContext) *predictive.SignatureInfo {
	if b.engine == nil {
		return nil
	}
	resolution := completionLanguageResolution(ctx)
	indexLanguage := resolution.IndexID
	if indexLanguage == "" {
		return nil
	}

	methodName := b.extractMethodNameAtCursor(ctx)
	if methodName == "" {
		return nil
	}

	query := core.SymbolQuery{
		Name:     methodName,
		Language: indexLanguage,
		Limit:    5,
	}

	symbols, err := b.engine.Query(query)
	if err != nil || len(symbols) == 0 {
		return nil
	}

	for _, sym := range symbols {
		if (sym.Kind == core.SymbolKindMethod || sym.Kind == core.SymbolKindFunction) && sym.Signature != "" {
			signatureLanguage := resolution.FillID
			if signatureLanguage == "" {
				signatureLanguage = resolution.CanonicalID
			}
			params := parseSignatureParams(sym.Signature, signatureLanguage)
			if len(params) > 0 {
				return &predictive.SignatureInfo{
					Label:      sym.Name + sym.Signature,
					Parameters: params,
				}
			}
		}
	}

	return nil
}

func (b *PredictionBrain) extractMethodNameAtCursor(ctx CompletionContext) string {
	content := string(ctx.Content)
	lines := strings.Split(content, "\n")
	line := contentLine(ctx)
	if line <= 0 || line > len(lines) {
		return ""
	}

	lineText := lines[line-1]
	if ctx.Column > len(lineText) {
		return ""
	}

	beforeCursor := lineText[:ctx.Column]

	arrowIdx := strings.LastIndex(beforeCursor, "->")
	doubleColonIdx := strings.LastIndex(beforeCursor, "::")
	dotIdx := strings.LastIndex(beforeCursor, ".")

	startIdx := -1
	if arrowIdx > startIdx {
		startIdx = arrowIdx + 2
	}
	if doubleColonIdx > startIdx {
		startIdx = doubleColonIdx + 2
	}
	if dotIdx > startIdx {
		startIdx = dotIdx + 1
	}

	if startIdx == -1 {
		return ""
	}

	parenIdx := strings.Index(beforeCursor[startIdx:], "(")
	if parenIdx == -1 {
		return ""
	}

	methodName := beforeCursor[startIdx : startIdx+parenIdx]
	methodName = strings.TrimSpace(methodName)

	return methodName
}

func parseSignatureParams(signature, language string) []predictive.ParameterInfo {
	signature = strings.TrimSpace(signature)
	if !strings.HasPrefix(signature, "(") {
		return nil
	}

	closeIdx := strings.Index(signature, ")")
	if closeIdx == -1 {
		return nil
	}

	paramsStr := signature[1:closeIdx]
	if paramsStr == "" {
		return nil
	}

	parts := strings.Split(paramsStr, ",")
	var params []predictive.ParameterInfo

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		params = append(params, predictive.ParameterInfo{
			Label: part,
		})
	}

	return params
}

func (b *PredictionBrain) mapLocalKind(kind string) core.SymbolKind {
	switch kind {
	case "class":
		return core.SymbolKindClass
	case "struct":
		return core.SymbolKindStruct
	case "interface":
		return core.SymbolKindInterface
	case "function":
		return core.SymbolKindFunction
	case "method":
		return core.SymbolKindMethod
	case "property":
		return core.SymbolKindProperty
	case "variable":
		return core.SymbolKindVariable
	case "constant":
		return core.SymbolKindConstant
	case "type":
		return core.SymbolKindType
	default:
		return core.SymbolKindVariable
	}
}

// buildLocalInsertText generates insert text for a local symbol
func (b *PredictionBrain) buildLocalInsertText(sym predictive.LocalSymbol) string {
	switch sym.Kind {
	case "function", "method":
		if sym.Signature != "" {
			return sym.Name + sym.Signature
		}
		return sym.Name + "()"
	default:
		return sym.Name
	}
}

func sanitizeInsertText(text string) string {
	if text == "" || !strings.Contains(text, "$") {
		return text
	}

	cleaned := text
	for _, pattern := range snippetPlaceholderPatterns {
		cleaned = pattern.ReplaceAllString(cleaned, "")
	}
	for _, rule := range snippetCleanupPatterns {
		cleaned = rule.replace.ReplaceAllString(cleaned, rule.value)
	}

	return strings.TrimSpace(cleaned)
}

func lspTextEditsToCore(edits []lsp.TextEdit) []core.TextEdit {
	if len(edits) == 0 {
		return nil
	}
	result := make([]core.TextEdit, 0, len(edits))
	for _, edit := range edits {
		result = append(result, core.TextEdit{
			StartLine:   edit.Range.Start.Line + 1,
			StartColumn: edit.Range.Start.Character + 1,
			EndLine:     edit.Range.End.Line + 1,
			EndColumn:   edit.Range.End.Character + 1,
			Text:        edit.NewText,
		})
	}
	return result
}

// abs returns absolute value of int
func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

func (b *PredictionBrain) fromVirtual(ctx CompletionContext) []Suggestion {
	if b.virtualStore == nil {
		return nil
	}

	entries := b.virtualStore.Get(ctx.FilePath, ctx.Language)
	suggestions := make([]Suggestion, 0, len(entries))

	for _, entry := range entries {
		sym := entry.Symbol
		if ctx.Prefix != "" && !strings.HasPrefix(strings.ToLower(sym.Name), strings.ToLower(ctx.Prefix)) {
			continue
		}

		suggestions = append(suggestions, Suggestion{
			Text:        sym.Name,
			DisplayText: sym.Name,
			Kind:        sym.Kind,
			Source:      core.SourceVirtual,
			Score:       sym.Confidence * 0.9,
			Detail:      sym.Signature,
			FilePath:    sym.FilePath,
			Line:        sym.Line,
			InsertText:  b.buildInsertText(sym, ctx),
			Extra:       sym.Extra,
		})
	}

	return suggestions
}

func (b *PredictionBrain) ResolveAccessChain(ctx *CompletionContext) {
	if ctx.AccessChain == "" {
		return
	}
	*ctx = withResolvedLanguage(*ctx)
	resolution := completionLanguageResolution(*ctx)

	reference := strings.TrimSpace(extractPackageReference(ctx.AccessChain))
	if reference == "" {
		return
	}

	resolved := ""
	resolveContent := ctx.Content
	if len(ctx.FullContent) > 0 {
		resolveContent = ctx.FullContent
	}
	if b.importResolver != nil {
		resolved = b.importResolver.ResolveClassName(ctx.FilePath, resolveContent, reference, resolution.CanonicalID)
	}
	if resolved == "" && b.stubProvider != nil {
		stubLanguage := resolution.StubID()
		if stubLanguage != "" {
			resolved = b.stubProvider.ResolvePackage(reference, stubLanguage)
			if resolved == "" {
				resolved = b.stubProvider.resolvePackageFromCatalog(stubLanguage, reference)
				if resolved != "" {
					b.stubProvider.RememberPackage(stubLanguage, reference, resolved)
				}
			}
		}
	}
	if resolved == "" && b.importCompletions != nil && b.importCompletions.catalog != nil {
		resolved = b.importCompletions.catalog.ResolveLibraryByOwner(resolution.CanonicalID, reference)
	}
	if resolved != "" {
		ctx.ResolvedNamespace = resolved
	}
}

func (b *PredictionBrain) fromIndex(ctx CompletionContext) []Suggestion {
	var suggestions []Suggestion

	if b.engine == nil {
		return suggestions
	}
	if isCanceled(ctx) {
		return suggestions
	}

	prefix := strings.TrimSpace(ctx.Prefix)
	accessClassName := extractClassFromAccessChain(ctx.AccessChain)
	indexLanguage := completionLanguageResolution(ctx).IndexID
	if indexLanguage == "" {
		return suggestions
	}

	query := core.SymbolQuery{
		Name:           prefix, // LIKE search: prefix%
		Language:       indexLanguage,
		Limit:          100,
		IncludePending: true,
	}

	// If in static/method call context with class, filter for methods
	if ctx.IsStaticCall && accessClassName != "" {
		// For static calls like Route::, we want methods
		query.Limit = 50
	} else if len(prefix) < 2 {
		// For very short prefixes without context, limit results to avoid noise
		query.Limit = 30
	}

	symbols, err := b.engine.Query(query)
	if err != nil {
		return suggestions
	}

	prefixLower := strings.ToLower(prefix)
	accessClassLower := strings.ToLower(accessClassName)
	resolvedNS := strings.ToLower(ctx.ResolvedNamespace)

	for _, sym := range symbols {
		symNameLower := strings.ToLower(sym.Name)
		if prefixLower != "" && !strings.HasPrefix(symNameLower, prefixLower) {
			continue
		}

		if isGarbageSymbol(sym.Name) {
			continue
		}

		if ctx.IsStaticCall && accessClassLower != "" {
			if sym.Kind != core.SymbolKindMethod && sym.Kind != core.SymbolKindFunction {
				continue
			}

			if resolvedNS != "" {
				symNS := strings.ToLower(sym.Namespace)
				if !strings.Contains(symNS, resolvedNS) && !strings.HasSuffix(symNS, accessClassLower) {
					continue
				}
			} else if !matchesClassName(sym.Namespace, sym.FilePath, accessClassLower) {
				continue
			}
		}

		// Calculate relevance score
		score := sym.Confidence

		// Boost exact prefix match
		if symNameLower == prefixLower {
			score += 0.5
		}

		// Boost if same file
		if sym.FilePath == ctx.FilePath {
			score += 0.2
		}

		// Boost if symbol belongs to the access chain class
		if accessClassLower != "" {
			symParentLower := strings.ToLower(sym.Namespace)
			symFileLower := strings.ToLower(sym.FilePath)
			// Check if namespace or filename contains the class name
			if strings.Contains(symParentLower, accessClassLower) ||
				strings.Contains(symFileLower, accessClassLower) {
				score += 0.5 // Significant boost for matching class
			}
		}

		// Boost commonly used kinds
		switch sym.Kind {
		case core.SymbolKindFunction, core.SymbolKindMethod:
			score += 0.1
			// Extra boost for methods in static call context
			if ctx.IsStaticCall {
				score += 0.2
			}
		case core.SymbolKindClass:
			score += 0.05
		}

		suggestion := Suggestion{
			Text:          sym.Name,
			DisplayText:   sym.Name,
			Kind:          sym.Kind,
			Source:        sym.Source,
			Score:         score,
			Confidence:    sym.Confidence,
			Namespace:     sym.Namespace,
			Detail:        sym.Signature,
			Documentation: formatDocumentation(sym.DocComment),
			TypeInfo:      extractTypeInfo(sym),
			FilePath:      sym.FilePath,
			Line:          sym.Line,
			InsertText:    b.buildInsertText(sym, ctx),
			Extra:         sym.Extra,
		}

		if b.autoImporter != nil && b.autoImporter.ShouldAutoImport(&sym, ctx) {
			if edit := b.autoImporter.GenerateImportEdit(&sym, ctx); edit != nil {
				suggestion.AdditionalTextEdits = []core.TextEdit{*edit}
			}
		}

		suggestions = append(suggestions, suggestion)
	}

	return suggestions
}

func matchesClassName(namespace, filePath, classNameLower string) bool {
	nsLower := strings.ToLower(namespace)

	if nsLower == classNameLower {
		return true
	}

	if strings.HasSuffix(nsLower, "\\"+classNameLower) {
		return true
	}

	if namespace == "" && strings.Contains(strings.ToLower(filePath), classNameLower) {
		return true
	}

	return false
}

func extractClassFromAccessChain(chain string) string {
	chain = strings.TrimSpace(chain)
	if chain == "" {
		return ""
	}

	// Check for static access (::)
	if strings.HasSuffix(chain, "::") {
		className := strings.TrimSuffix(chain, "::")
		// Remove any namespace prefix, get just the class name
		if idx := strings.LastIndex(className, "\\"); idx != -1 {
			className = className[idx+1:]
		}
		return className
	}

	// Check for instance access (->)
	if strings.HasSuffix(chain, "->") {
		// For instance access like $this-> or $user->, we can't determine class easily
		// Return empty - LSP should handle this better
		return ""
	}

	if strings.HasSuffix(chain, ".") {
		objectName := strings.TrimSuffix(chain, ".")
		return objectName
	}

	return ""
}

var garbagePrefixes = []string{
	"PARTIAL_",
	"PAIR_VALUE_",
	"TOKEN_",
	"T_",
	"SCANNER_",
	"LEXER_",
	"PARSER_",
	"AST_",
	"NODE_",
	"__internal",
	"__parser",
	"__lexer",
}

func isGarbageSymbol(name string) bool {
	nameUpper := strings.ToUpper(name)
	for _, prefix := range garbagePrefixes {
		if strings.HasPrefix(nameUpper, prefix) {
			return true
		}
	}
	if len(name) > 2 && name == strings.ToUpper(name) && strings.Contains(name, "_") {
		return true
	}
	return false
}

func (b *PredictionBrain) fromCrossFile(ctx CompletionContext) []Suggestion {
	if b.crossFile == nil {
		return nil
	}
	if isCanceled(ctx) {
		return nil
	}

	symbols := b.crossFile.GetRelatedSymbols(ctx)
	if len(symbols) == 0 {
		return nil
	}

	suggestions := make([]Suggestion, 0, len(symbols))
	for _, sym := range symbols {
		suggestions = append(suggestions, Suggestion{
			Text:        sym.Name,
			DisplayText: sym.Name,
			Kind:        sym.Kind,
			Source:      core.SourceIndex,
			Score:       0.65,
			Detail:      fmt.Sprintf("from %s", filepath.Base(sym.FilePath)),
			FilePath:    sym.FilePath,
			Line:        sym.Line,
			Namespace:   sym.Namespace,
		})
	}
	return suggestions
}

func (b *PredictionBrain) fromLSP(ctx CompletionContext) []Suggestion {
	suggestions, _ := b.fromLSPWithReason(ctx)
	return suggestions
}

func (b *PredictionBrain) fromLSPWithReason(ctx CompletionContext) ([]Suggestion, string) {
	if b.lspManager == nil {
		debugLogf("[LSP] manager is nil")
		return nil, "missing-manager"
	}
	if isCanceled(ctx) {
		return nil, "canceled"
	}
	lspLanguage := completionLanguageResolution(ctx).LSPID
	if lspLanguage == "" {
		return nil, "no-language"
	}
	if !b.lspManager.HasConfig(lspLanguage) {
		return nil, "no-config"
	}

	debugLogf("[LSP] requesting completions for lang=%s original=%s file=%s line=%d col=%d",
		lspLanguage, ctx.Language, filepath.Base(ctx.FilePath), ctx.Line, ctx.Column)

	lspCtx := ctx.Ctx
	if lspCtx == nil {
		lspCtx = context.Background()
	}
	items, err := b.lspManager.CompleteWithContext(lspCtx, lspLanguage, ctx.FilePath, ctx.Line, ctx.Column)
	if err != nil {
		log.Printf("[LSP] ERROR: %v", err)
		return nil, "error"
	}
	if lspCtx.Err() != nil {
		return nil, contextStatus(lspCtx.Err())
	}
	if len(items) == 0 {
		debugLogf("[LSP] no items returned for lang=%s", lspLanguage)
		return nil, "empty"
	}

	debugLogf("[LSP] got %d items for lang=%s", len(items), lspLanguage)

	suggestions := make([]Suggestion, 0, len(items))
	for _, item := range items {
		kind := b.mapLSPKind(item.Kind)
		insertText := item.InsertText
		if insertText == "" {
			insertText = item.Label
		}
		insertText = sanitizeInsertText(insertText)
		if insertText == "" {
			insertText = item.Label
		}

		documentation := formatLSPDocumentation(item.Documentation)

		additionalEdits := lspTextEditsToCore(item.AdditionalTextEdits)
		if b.autoImporter != nil && b.autoImporter.planner != nil {
			additionalEdits = b.autoImporter.planner.NormalizeTextEdits(ctx, additionalEdits)
		}
		suggestions = append(suggestions, Suggestion{
			Text:                item.Label,
			DisplayText:         item.Label,
			Kind:                kind,
			Source:              core.SourceLSP,
			Score:               0.8,
			Detail:              item.Detail,
			Documentation:       documentation,
			InsertText:          insertText,
			IsSnippet:           false,
			AdditionalTextEdits: additionalEdits,
		})
	}

	return suggestions, "ok"
}

func formatLSPDocumentation(doc any) string {
	if doc == nil {
		return ""
	}

	switch v := doc.(type) {
	case string:
		return strings.TrimSpace(v)
	case map[string]any:
		if value, ok := v["value"].(string); ok {
			return strings.TrimSpace(value)
		}
	case []any:
		var parts []string
		for _, item := range v {
			switch m := item.(type) {
			case string:
				if strings.TrimSpace(m) != "" {
					parts = append(parts, strings.TrimSpace(m))
				}
			case map[string]any:
				if value, ok := m["value"].(string); ok {
					value = strings.TrimSpace(value)
					if value != "" {
						parts = append(parts, value)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	}

	return ""
}

func (b *PredictionBrain) mapLSPKind(kind int) core.SymbolKind {
	lspKindMap := map[int]core.SymbolKind{
		1:  core.SymbolKindVariable,
		2:  core.SymbolKindMethod,
		3:  core.SymbolKindFunction,
		4:  core.SymbolKindFunction,
		5:  core.SymbolKindField,
		6:  core.SymbolKindVariable,
		7:  core.SymbolKindClass,
		8:  core.SymbolKindInterface,
		9:  core.SymbolKindModule,
		10: core.SymbolKindProperty,
		13: core.SymbolKindEnum,
		14: core.SymbolKindConstant,
		22: core.SymbolKindStruct,
		23: core.SymbolKindConstant,
	}

	if k, ok := lspKindMap[kind]; ok {
		return k
	}
	return core.SymbolKindVariable
}

func (b *PredictionBrain) fromStubs(ctx CompletionContext) []Suggestion {
	if b.stubProvider == nil {
		return nil
	}
	stubCtx := ctx
	stubCtx.LanguageResolution = completionLanguageResolution(ctx)
	stubCtx.Language = stubCtx.LanguageResolution.StubID()
	if stubCtx.Language == "" {
		return nil
	}
	if suggestions := b.stubProvider.GetContextCompletions(stubCtx); len(suggestions) > 0 {
		return b.enrichAutoImports(stubCtx, suggestions)
	}

	if packageName := b.detectPackageName(stubCtx); packageName != "" {
		if suggestions := b.stubProvider.GetCompletions(packageName, stubCtx.Prefix, stubCtx.Language); len(suggestions) > 0 {
			return b.enrichAutoImports(stubCtx, suggestions)
		}
	}

	return b.enrichAutoImports(stubCtx, b.stubPackageSuggestions(stubCtx))
}

func (b *PredictionBrain) detectPackageName(ctx CompletionContext) string {
	if reference := extractPackageReference(ctx.AccessChain); reference != "" {
		return reference
	}

	if ctx.ParentClass != "" {
		return ctx.ParentClass
	}

	return ""
}

func (b *PredictionBrain) enrichAutoImports(ctx CompletionContext, suggestions []Suggestion) []Suggestion {
	if len(suggestions) == 0 || b.autoImporter == nil {
		return suggestions
	}

	enriched := make([]Suggestion, len(suggestions))
	copy(enriched, suggestions)
	for i := range enriched {
		if len(enriched[i].AdditionalTextEdits) > 0 {
			continue
		}
		sym := core.Symbol{
			Name:      enriched[i].Text,
			Kind:      enriched[i].Kind,
			Language:  ctx.Language,
			Namespace: enriched[i].Namespace,
		}
		if !b.autoImporter.ShouldAutoImport(&sym, ctx) {
			continue
		}
		if edit := b.autoImporter.GenerateImportEdit(&sym, ctx); edit != nil {
			enriched[i].AdditionalTextEdits = []core.TextEdit{*edit}
		}
	}

	return enriched
}

func (b *PredictionBrain) stubPackageSuggestions(ctx CompletionContext) []Suggestion {
	if b.stubProvider == nil || ctx.AccessChain != "" || ctx.ParentClass != "" {
		return nil
	}
	if strings.TrimSpace(ctx.Prefix) == "" {
		return nil
	}

	packages := b.stubProvider.ListPackages(ctx.Language)
	if len(packages) == 0 {
		return nil
	}

	prefixLower := strings.ToLower(ctx.Prefix)
	seen := make(map[string]struct{}, len(packages))
	suggestions := make([]Suggestion, 0, len(packages))
	for _, pkg := range packages {
		identifier := packageSuggestionIdentifier(pkg, ctx.Language)
		if identifier == "" {
			continue
		}
		identifierLower := strings.ToLower(identifier)
		pkgLower := strings.ToLower(pkg)
		if !strings.HasPrefix(identifierLower, prefixLower) && !strings.HasPrefix(pkgLower, prefixLower) {
			continue
		}
		if _, exists := seen[identifierLower]; exists {
			continue
		}
		seen[identifierLower] = struct{}{}

		kind := core.SymbolKindPackage
		switch ctx.Language {
		case "javascript", "typescript":
			kind = core.SymbolKindModule
		}

		suggestions = append(suggestions, Suggestion{
			Text:        identifier,
			DisplayText: identifier,
			Kind:        kind,
			Source:      core.SourceLibrary,
			Score:       0.88,
			Detail:      pkg,
			InsertText:  identifier,
			Namespace:   pkg,
		})
	}

	if len(suggestions) == 0 {
		return nil
	}

	sort.SliceStable(suggestions, func(i, j int) bool {
		if suggestions[i].Score == suggestions[j].Score {
			return suggestions[i].Text < suggestions[j].Text
		}
		return suggestions[i].Score > suggestions[j].Score
	})

	return suggestions
}

func packageSuggestionIdentifier(pkg, language string) string {
	switch language {
	case "javascript", "typescript":
		return jsModuleIdentifier(pkg)
	case "go":
		if idx := strings.LastIndex(pkg, "/"); idx >= 0 {
			return pkg[idx+1:]
		}
		return pkg
	default:
		return pkg
	}
}

func (b *PredictionBrain) fromSpeculative(ctx CompletionContext) []Suggestion {
	// Currently speculative symbols are handled by engine.Query() in fromIndex()
	// This slot is reserved for additional speculative sources like:
	// - Terminal command predictions (artisan make:model -> predict User.php)
	// - AI-suggested symbols
	// - Cross-project symbol predictions
	return nil
}

func isHTMLLikeLanguage(language string) bool {
	switch language {
	case "html", "blade", "astro", "vue", "svelte":
		return true
	default:
		return false
	}
}

func (b *PredictionBrain) fromKeywords(ctx CompletionContext) []Suggestion {
	resolution := completionLanguageResolution(ctx)
	language := resolution.KeywordID
	if language == "" {
		return nil
	}
	keywordCtx := withSourceLanguage(ctx, language)
	allowAccessKeywords := false
	accessChain := strings.TrimSpace(ctx.AccessChain)
	if ctx.Language == "astro" && strings.HasSuffix(accessChain, "Astro.") {
		allowAccessKeywords = true
		language = "astro"
		keywordCtx.Language = "astro"
	}
	if ctx.Language == "astro" && ctx.TriggerChar == "<" {
		language = "astro"
		keywordCtx.Language = "astro"
	}
	if ctx.Language == "blade" && ctx.TriggerChar == "<" {
		language = "blade"
		keywordCtx.Language = "blade"
	}

	goContext := b.detectGoKeywordContext(keywordCtx)
	bashContext := b.detectBashKeywordContext(keywordCtx)
	htmlContext := ""
	cssContext := ""
	astroContext := ""
	if isHTMLLikeLanguage(ctx.Language) && ctx.TriggerChar == "<" {
		htmlContext = "after_lt"
		language = ctx.Language
		keywordCtx.Language = ctx.Language
	}
	if language == "css" && (ctx.TriggerChar == ":" || b.detectCSSValueContext(keywordCtx)) {
		cssContext = "after_colon"
	}
	if allowAccessKeywords {
		astroContext = "astro_globals"
	}
	if (ctx.IsMethodCall || ctx.IsStaticCall) && htmlContext == "" && cssContext == "" && astroContext == "" {
		return nil
	}
	var keywords []predictive.KeywordInfo
	if astroContext != "" {
		keywords = predictive.GetContextualKeywords(language, astroContext, ctx.Prefix)
	} else if htmlContext != "" {
		keywords = predictive.GetContextualKeywords(language, htmlContext, ctx.Prefix)
	} else if cssContext != "" {
		keywords = predictive.GetContextualKeywords(language, cssContext, ctx.Prefix)
	} else if goContext != "" {
		keywords = predictive.GetContextualKeywords(language, goContext, ctx.Prefix)
	} else if bashContext != "" {
		keywords = predictive.GetContextualKeywords(language, bashContext, ctx.Prefix)
	} else {
		keywords = predictive.GetMatchingKeywords(language, ctx.Prefix)
	}

	if len(keywords) == 0 {
		return nil
	}

	suggestions := make([]Suggestion, 0, len(keywords))
	for _, kw := range keywords {
		kind := b.mapKeywordKind(kw.Kind)
		insertText := sanitizeInsertText(kw.InsertText)
		if insertText == "" {
			insertText = kw.Name
		}

		s := Suggestion{
			Text:        kw.Name,
			DisplayText: kw.Name,
			Kind:        kind,
			Source:      core.SourceKeywords,
			Score:       float64(kw.Priority) / 10.0,
			Detail:      kw.Kind,
			InsertText:  insertText,
			IsSnippet:   false,
		}

		if b.autoImporter != nil && strings.Contains(kw.Name, ".") {
			packageName := kw.Name[:strings.Index(kw.Name, ".")]
			sym := &core.Symbol{
				Name:      kw.Name,
				Kind:      kind,
				Namespace: packageName,
			}
			if edit := b.autoImporter.GenerateImportEdit(sym, ctx); edit != nil {
				s.AdditionalTextEdits = []core.TextEdit{*edit}
			}
		}

		suggestions = append(suggestions, s)
	}

	return suggestions
}

func (b *PredictionBrain) detectGoKeywordContext(ctx CompletionContext) string {
	if ctx.Language != "go" {
		return ""
	}

	content := string(ctx.Content)
	lines := strings.Split(content, "\n")
	line := contentLine(ctx)
	if line <= 0 || line > len(lines) {
		return ""
	}

	lineText := lines[line-1]
	beforeCursor := lineText
	if ctx.Column > 0 && ctx.Column <= len(lineText) {
		beforeCursor = lineText[:ctx.Column]
	}
	beforeCursor = strings.TrimSpace(beforeCursor)

	typeNamePattern := regexp.MustCompile(`^type\s+\w+\s+$`)
	if typeNamePattern.MatchString(beforeCursor + " ") {
		return "after_type"
	}

	if strings.Contains(beforeCursor, "struct {") || strings.Contains(beforeCursor, "struct{") {
		return "struct_field_type"
	}

	for i := line - 2; i >= 0 && i >= line-10; i-- {
		if i < 0 || i >= len(lines) {
			continue
		}
		prevLine := strings.TrimSpace(lines[i])
		if strings.Contains(prevLine, "struct {") || strings.Contains(prevLine, "struct{") {
			if !strings.Contains(prevLine, "}") {
				words := strings.Fields(beforeCursor)
				if len(words) == 1 && !strings.Contains(beforeCursor, " ") {
					return "struct_field_type"
				}
			}
		}
		if strings.HasPrefix(prevLine, "func ") || strings.HasPrefix(prevLine, "type ") {
			break
		}
	}

	return ""
}

func (b *PredictionBrain) detectBashKeywordContext(ctx CompletionContext) string {
	if ctx.Language != "bash" {
		return ""
	}
	if strings.HasPrefix(ctx.Prefix, "$") {
		return "after_dollar"
	}

	content := string(ctx.Content)
	lines := strings.Split(content, "\n")
	line := contentLine(ctx)
	if line <= 0 || line > len(lines) {
		return ""
	}

	lineText := lines[line-1]
	beforeCursor := lineText
	if ctx.Column > 0 && ctx.Column <= len(lineText) {
		beforeCursor = lineText[:ctx.Column]
	}
	beforeCursor = strings.TrimSpace(beforeCursor)

	if regexp.MustCompile(`\b(?:echo|printf)\s*$`).MatchString(beforeCursor) {
		return "after_echo"
	}
	if regexp.MustCompile(`\bread\s*$`).MatchString(beforeCursor) {
		return "after_read"
	}
	if regexp.MustCompile(`\bexport\s*$`).MatchString(beforeCursor) {
		return "after_export"
	}
	if regexp.MustCompile(`(?:\[\[?|\btest)\s*$`).MatchString(beforeCursor) {
		return "after_test"
	}

	return ""
}

func (b *PredictionBrain) detectCSSValueContext(ctx CompletionContext) bool {
	language := completionLanguageResolution(ctx).KeywordID
	if language != "css" {
		return false
	}
	content := string(ctx.Content)
	lines := strings.Split(content, "\n")
	line := contentLine(ctx)
	if line <= 0 || line > len(lines) {
		return false
	}
	lineText := lines[line-1]
	if ctx.Column > 0 && ctx.Column <= len(lineText) {
		lineText = lineText[:ctx.Column-1]
	}
	lastColon := strings.LastIndex(lineText, ":")
	if lastColon == -1 {
		return false
	}
	if strings.Contains(lineText[lastColon:], ";") {
		return false
	}
	if strings.Contains(lineText[lastColon:], "{") || strings.Contains(lineText[lastColon:], "}") {
		return false
	}
	textBefore := ""
	if line > 1 {
		textBefore = strings.Join(lines[:line-1], "\n") + "\n"
	}
	textBefore += lineText
	if strings.Count(textBefore, "{") <= strings.Count(textBefore, "}") {
		return false
	}
	return true
}

func (b *PredictionBrain) mapKeywordKind(kind string) core.SymbolKind {
	switch kind {
	case "keyword":
		return core.SymbolKindText
	case "function":
		return core.SymbolKindFunction
	case "method":
		return core.SymbolKindMethod
	case "class":
		return core.SymbolKindClass
	case "type":
		return core.SymbolKindType
	case "variable":
		return core.SymbolKindVariable
	case "constant":
		return core.SymbolKindConstant
	case "package":
		return core.SymbolKindPackage
	case "module":
		return core.SymbolKindModule
	case "namespace":
		return core.SymbolKindNamespace
	default:
		return core.SymbolKindText
	}
}

func (b *PredictionBrain) deduplicate(suggestions []Suggestion) []Suggestion {
	seenByText := make(map[string]int)
	seenByTextKind := make(map[string]int)
	result := make([]Suggestion, 0, len(suggestions))

	for _, s := range suggestions {
		textLower := strings.ToLower(s.Text)
		keyTextKind := textLower + "|" + string(s.Kind)

		if idx, exists := seenByTextKind[keyTextKind]; exists {
			existing := result[idx]
			if s.Score > existing.Score || (s.Score == existing.Score && sourceRank(s.Source) > sourceRank(existing.Source)) {
				result[idx] = mergeSuggestionMetadata(s, existing)
			} else {
				result[idx] = mergeSuggestionMetadata(existing, s)
			}
			continue
		}

		if idx, exists := seenByText[textLower]; exists {
			existing := result[idx]
			if s.Score > existing.Score+0.5 {
				result[idx] = mergeSuggestionMetadata(s, existing)
				seenByTextKind[keyTextKind] = idx
			} else {
				result[idx] = mergeSuggestionMetadata(existing, s)
			}
			continue
		}

		seenByText[textLower] = len(result)
		seenByTextKind[keyTextKind] = len(result)
		result = append(result, s)
	}

	return result
}

func mergeSuggestionMetadata(preferred Suggestion, other Suggestion) Suggestion {
	if preferred.InsertText == "" && other.InsertText != "" {
		preferred.InsertText = other.InsertText
		preferred.IsSnippet = other.IsSnippet
		preferred.Snippet = other.Snippet
	}

	if preferred.Documentation == "" && other.Documentation != "" {
		preferred.Documentation = other.Documentation
	} else if other.Source == core.SourceLSP && other.Documentation != "" && preferred.Source != core.SourceLSP {
		// Prefer LSP docs when available.
		preferred.Documentation = other.Documentation
	}

	if preferred.TypeInfo == "" && other.TypeInfo != "" {
		preferred.TypeInfo = other.TypeInfo
	}
	if preferred.Detail == "" && other.Detail != "" {
		preferred.Detail = other.Detail
	}
	if preferred.FilePath == "" && other.FilePath != "" {
		preferred.FilePath = other.FilePath
		preferred.Line = other.Line
		preferred.Namespace = other.Namespace
	}

	preferred.AdditionalTextEdits = mergeTextEdits(preferred.AdditionalTextEdits, other.AdditionalTextEdits)

	if preferred.Extra == nil && other.Extra != nil {
		preferred.Extra = make(map[string]string, len(other.Extra))
	}
	for k, v := range other.Extra {
		if preferred.Extra == nil {
			break
		}
		if _, ok := preferred.Extra[k]; ok {
			continue
		}
		preferred.Extra[k] = v
	}

	if preferred.MatchResult == nil && other.MatchResult != nil {
		preferred.MatchResult = other.MatchResult
	}

	return preferred
}

func mergeTextEdits(preferred []core.TextEdit, other []core.TextEdit) []core.TextEdit {
	if len(other) == 0 {
		return preferred
	}
	if len(preferred) == 0 {
		return other
	}

	seen := make(map[string]struct{}, len(preferred))
	for _, e := range preferred {
		key := fmt.Sprintf("%d:%d-%d:%d:%s", e.StartLine, e.StartColumn, e.EndLine, e.EndColumn, e.Text)
		seen[key] = struct{}{}
	}
	for _, e := range other {
		key := fmt.Sprintf("%d:%d-%d:%d:%s", e.StartLine, e.StartColumn, e.EndLine, e.EndColumn, e.Text)
		if _, ok := seen[key]; ok {
			continue
		}
		preferred = append(preferred, e)
		seen[key] = struct{}{}
	}
	return preferred
}

func (b *PredictionBrain) filterByPrefix(prefix, language string, suggestions []Suggestion) []Suggestion {
	normalizedPrefix := normalizePrefixForLanguage(prefix, language)
	limitToVariables := false
	if language == "bash" && strings.HasPrefix(prefix, "$") {
		limitToVariables = true
	}

	if normalizedPrefix == "" || b.matcher == nil {
		result := make([]Suggestion, 0, len(suggestions))
		for i := range suggestions {
			s := suggestions[i]
			if limitToVariables && !isVariableLikeKind(s.Kind) {
				continue
			}
			s.MatchResult = &predictive.MatchResult{
				Matched: true,
				Score:   0.5,
				Type:    predictive.MatchNone,
			}
			result = append(result, s)
		}
		return result
	}

	result := make([]Suggestion, 0, len(suggestions)/2)
	for i := range suggestions {
		s := &suggestions[i]
		if limitToVariables && !isVariableLikeKind(s.Kind) {
			continue
		}
		matchResult := b.matcher.Match(normalizedPrefix, s.Text)

		if !matchResult.Matched && s.DisplayText != "" && s.DisplayText != s.Text {
			matchResult = b.matcher.Match(normalizedPrefix, s.DisplayText)
		}

		if matchResult.Matched {
			if isExactSelfEchoSuggestion(*s, normalizedPrefix) {
				continue
			}
			s.MatchResult = &matchResult
			result = append(result, *s)
		}
	}

	return result
}

func normalizePrefixForLanguage(prefix, language string) string {
	if language == "bash" && strings.HasPrefix(prefix, "$") {
		return strings.TrimPrefix(prefix, "$")
	}
	return prefix
}

func isVariableLikeKind(kind core.SymbolKind) bool {
	switch kind {
	case core.SymbolKindVariable, core.SymbolKindProperty, core.SymbolKindField, core.SymbolKindConstant:
		return true
	default:
		return false
	}
}

func (b *PredictionBrain) filterByContext(ctx CompletionContext, suggestions []Suggestion) []Suggestion {
	if ctx.TriggerChar == "<" && isHTMLLikeLanguage(ctx.Language) {
		return suggestions
	}
	if !ctx.IsStaticCall && !ctx.IsMethodCall {
		return suggestions
	}

	filtered := make([]Suggestion, 0, len(suggestions)/2)
	accessRefLower := strings.ToLower(strings.TrimSpace(extractPackageReference(ctx.AccessChain)))
	resolvedNSLower := strings.ToLower(strings.TrimSpace(ctx.ResolvedNamespace))

	for _, s := range suggestions {
		if s.Extra != nil && s.Extra["is_scaffold"] == "true" {
			continue
		}

		if s.Source == core.SourceKeywords {
			if ctx.Language == "astro" && strings.HasSuffix(strings.TrimSpace(ctx.AccessChain), "Astro.") {
				filtered = append(filtered, s)
			}
			continue
		}

		if s.Source != core.SourceLSP && !isCallableKind(s.Kind) {
			continue
		}

		if accessRefLower != "" && !matchesSuggestionAccessContext(ctx, s, accessRefLower, resolvedNSLower) {
			continue
		}

		filtered = append(filtered, s)
	}

	if len(filtered) > 1 && (resolvedNSLower != "" || accessRefLower != "") {
		hasNamespaceAwareMatch := false
		for _, s := range filtered {
			if strings.TrimSpace(s.Namespace) == "" {
				continue
			}
			if matchesSuggestionAccessContext(ctx, s, accessRefLower, resolvedNSLower) {
				hasNamespaceAwareMatch = true
				break
			}
		}

		if hasNamespaceAwareMatch {
			trimmed := filtered[:0]
			for _, s := range filtered {
				if s.Source == core.SourceLSP && strings.TrimSpace(s.Namespace) == "" {
					continue
				}
				trimmed = append(trimmed, s)
			}
			filtered = trimmed
		}
	}

	return filtered
}

func matchesSuggestionAccessContext(ctx CompletionContext, suggestion Suggestion, accessRefLower, resolvedNSLower string) bool {
	namespaceLower := strings.ToLower(strings.TrimSpace(suggestion.Namespace))
	if resolvedNSLower != "" {
		if namespaceLower == "" {
			return suggestion.Source == core.SourceLSP
		}
		if namespaceMatches(namespaceLower, resolvedNSLower) {
			return true
		}
		if ctx.IsStaticCall {
			return matchesClassName(suggestion.Namespace, suggestion.FilePath, accessRefLower)
		}
		return false
	}

	if accessRefLower == "" {
		return true
	}
	if namespaceLower == "" {
		return suggestion.Source == core.SourceLSP
	}

	if ctx.IsStaticCall {
		return matchesClassName(suggestion.Namespace, suggestion.FilePath, accessRefLower) || namespaceHasTokenSuffix(namespaceLower, accessRefLower)
	}
	if suggestion.Source == core.SourceLibrary {
		return namespaceLower == accessRefLower
	}
	return matchesClassName(suggestion.Namespace, suggestion.FilePath, accessRefLower) || namespaceHasTokenSuffix(namespaceLower, accessRefLower)
}

func namespaceMatches(namespaceLower, resolvedNSLower string) bool {
	return namespaceLower == resolvedNSLower || namespaceHasTokenSuffix(namespaceLower, resolvedNSLower) || namespaceHasTokenSuffix(resolvedNSLower, namespaceLower)
}

func namespaceHasTokenSuffix(namespaceLower, tokenLower string) bool {
	if namespaceLower == tokenLower {
		return true
	}
	for _, sep := range []string{"\\", "::", "/", "."} {
		if strings.HasSuffix(namespaceLower, sep+tokenLower) {
			return true
		}
	}
	return false
}

func isCallableKind(kind core.SymbolKind) bool {
	switch kind {
	case core.SymbolKindMethod, core.SymbolKindFunction, core.SymbolKindProperty, core.SymbolKindField, core.SymbolKindConstant:
		return true
	default:
		return false
	}
}

func sourceRank(source core.SymbolSource) int {
	ranks := map[core.SymbolSource]int{
		core.SourceLSP:        7,
		core.SourceLibrary:    6,
		core.SourceFillAll:    6,
		core.SourceKeywords:   5,
		core.SourceLocal:      4,
		core.SourceAST:        3,
		core.SourcePredictive: 2,
		core.SourceIndex:      1,
		core.SourceVirtual:    0,
	}
	if rank, ok := ranks[source]; ok {
		return rank
	}
	return 0
}

func (b *PredictionBrain) rank(ctx CompletionContext, suggestions []Suggestion) []Suggestion {
	rankCtx := RankingContext{
		Prefix:            ctx.Prefix,
		Language:          ctx.Language,
		FilePath:          ctx.FilePath,
		IsMethodCall:      ctx.IsMethodCall,
		IsStaticCall:      ctx.IsStaticCall,
		AccessChain:       ctx.AccessChain,
		ResolvedNamespace: ctx.ResolvedNamespace,
		ParentClass:       ctx.ParentClass,
		Scope:             ctx.Scope,
		InString:          ctx.InString,
		InImport:          ctx.InImport,
		RecentSymbols:     b.recentSymbols,
	}

	if b.smartRanker != nil && b.enhancedUsage != nil {
		suggestions = b.smartRanker.Rank(suggestions, rankCtx, b.enhancedUsage)
	} else {
		for i := range suggestions {
			suggestions[i].Score = b.calculateScore(ctx, &suggestions[i])
		}
		stableSortSuggestions(suggestions)
	}

	if b.arle != nil && b.arle.Mode() != ArleModeNone {
		suggestions = b.arle.Rerank(suggestions, ctx)
	}

	return suggestions
}

func (b *PredictionBrain) calculateScore(ctx CompletionContext, s *Suggestion) float64 {
	weights := getWeightsForContext(ctx)

	score := s.Score
	if score == 0 {
		score = 0.5
	}

	if s.Confidence > 0 {
		score *= (0.5 + s.Confidence*0.5)
	}

	prefixMatch := b.prefixMatchScore(ctx.Prefix, ctx.Language, s.Text)
	score += prefixMatch * weights.PrefixMatch

	contextMatch := b.contextMatchScore(ctx, s)
	score += contextMatch * weights.ContextMatch

	usage := b.usage.GetScore(s.Text, ctx.FilePath)
	score += usage * weights.UsageFrequency

	if s.FilePath == ctx.FilePath {
		score += weights.SameFile
	}

	kindBonus := b.kindBonus(s.Kind, ctx)
	score += kindBonus * weights.KindBonus

	sourceBonus := b.sourceBonus(s.Source, ctx)
	score += sourceBonus * weights.SourceBonus

	if score > 10.0 {
		score = 10.0
	}

	return score
}

func (b *PredictionBrain) contextMatchScore(ctx CompletionContext, s *Suggestion) float64 {
	return suggestionAccessContextScore(ctx.IsMethodCall, ctx.IsStaticCall, ctx.AccessChain, ctx.ResolvedNamespace, *s)
}

func (b *PredictionBrain) sourceBonus(source core.SymbolSource, ctx CompletionContext) float64 {
	baseBonus := map[core.SymbolSource]float64{
		core.SourceLSP:        1.0,
		core.SourceLibrary:    0.9,
		core.SourceFillAll:    0.95,
		core.SourceKeywords:   0.85,
		core.SourceLocal:      0.8,
		core.SourceAST:        0.7,
		core.SourcePredictive: 0.5,
		core.SourceIndex:      0.4,
		core.SourceVirtual:    0.3,
	}

	bonus, ok := baseBonus[source]
	if !ok {
		bonus = 0.3
	}

	if ctx.IsStaticCall || ctx.IsMethodCall {
		if ctx.ResolvedNamespace != "" {
			if source == core.SourceLSP {
				bonus = 0.85
			} else if source == core.SourceLibrary {
				bonus = 1.0
			}
		} else if ctx.AccessChain != "" {
			if source == core.SourceLSP {
				bonus = 0.75
			} else if source == core.SourceLibrary {
				bonus = 1.0
			}
		} else if source == core.SourceLSP {
			bonus = 1.05
		}
	}

	return bonus
}

func suggestionAccessContextScore(isMethodCall, isStaticCall bool, accessChain, resolvedNamespace string, suggestion Suggestion) float64 {
	if !isMethodCall && !isStaticCall {
		return 0.5
	}

	accessRefLower := strings.ToLower(strings.TrimSpace(extractPackageReference(accessChain)))
	resolvedNSLower := strings.ToLower(strings.TrimSpace(resolvedNamespace))
	if accessRefLower == "" && resolvedNSLower == "" {
		return 0.3
	}

	ctx := CompletionContext{
		IsMethodCall:      isMethodCall,
		IsStaticCall:      isStaticCall,
		AccessChain:       accessChain,
		ResolvedNamespace: resolvedNamespace,
	}
	if !matchesSuggestionAccessContext(ctx, suggestion, accessRefLower, resolvedNSLower) {
		return 0.05
	}

	namespaceLower := strings.ToLower(strings.TrimSpace(suggestion.Namespace))
	score := 0.75
	if resolvedNSLower != "" && namespaceLower != "" && namespaceMatches(namespaceLower, resolvedNSLower) {
		score = 1.0
	} else if accessRefLower != "" && namespaceLower != "" && (namespaceMatches(namespaceLower, accessRefLower) || namespaceHasTokenSuffix(namespaceLower, accessRefLower)) {
		score = 0.9
	} else if namespaceLower == "" {
		score = 0.2
	}

	if suggestion.Source == core.SourceLSP && namespaceLower == "" {
		score -= 0.05
	}
	if score < 0.05 {
		return 0.05
	}
	return score
}

func (b *PredictionBrain) prefixMatchScore(prefix, language, text string) float64 {
	normalizedPrefix := normalizePrefixForLanguage(prefix, language)
	if normalizedPrefix == "" {
		return 0
	}

	if b.matcher == nil {
		return b.legacyPrefixMatchScore(normalizedPrefix, text)
	}

	result := b.matcher.Match(normalizedPrefix, text)
	if !result.Matched {
		return 0
	}
	return result.Score
}

func (b *PredictionBrain) legacyPrefixMatchScore(prefix, text string) float64 {
	lowerPrefix := strings.ToLower(prefix)
	lowerText := strings.ToLower(text)

	if text == prefix {
		return 1.0
	}
	if strings.HasPrefix(lowerText, lowerPrefix) {
		return 0.9 * (float64(len(prefix)) / float64(len(text)))
	}
	if strings.Contains(lowerText, lowerPrefix) {
		return 0.5
	}

	return b.fuzzyScore(lowerPrefix, lowerText)
}

func (b *PredictionBrain) fuzzyScore(pattern, text string) float64 {
	if len(pattern) == 0 {
		return 0
	}

	j := 0
	matches := 0
	for i := 0; i < len(text) && j < len(pattern); i++ {
		if text[i] == pattern[j] {
			matches++
			j++
		}
	}

	if j < len(pattern) {
		return 0
	}

	return float64(matches) / float64(len(text)) * 0.5
}

func (b *PredictionBrain) kindBonus(kind core.SymbolKind, ctx CompletionContext) float64 {
	// Context-aware kind bonuses: prefer methods/properties in method/static call context
	if ctx.IsMethodCall || ctx.IsStaticCall {
		switch kind {
		case core.SymbolKindMethod:
			return 1.0
		case core.SymbolKindFunction:
			return 0.9
		case core.SymbolKindProperty:
			return 0.85
		case core.SymbolKindConstant:
			return 0.8
		case core.SymbolKindField:
			return 0.75
		default:
			return 0.3
		}
	}

	// Default bonuses for general context
	bonuses := map[core.SymbolKind]float64{
		core.SymbolKindMethod:   0.9,
		core.SymbolKindFunction: 0.8,
		core.SymbolKindClass:    0.7,
		core.SymbolKindProperty: 0.6,
		core.SymbolKindVariable: 0.5,
		core.SymbolKindConstant: 0.4,
	}

	if bonus, ok := bonuses[kind]; ok {
		return bonus
	}
	return 0.3
}

func (b *PredictionBrain) buildInsertText(sym core.Symbol, ctx CompletionContext) string {
	switch sym.Kind {
	case core.SymbolKindFunction, core.SymbolKindMethod:
		return b.buildCallableSnippet(sym, ctx)
	case core.SymbolKindClass:
		if ctx.Language == "php" && !ctx.IsStaticCall {
			return "new " + sym.Name + "()"
		}
		return sym.Name
	case core.SymbolKindInterface, core.SymbolKindTrait:
		return sym.Name
	case core.SymbolKindConstant:
		return sym.Name
	case core.SymbolKindProperty, core.SymbolKindField:
		return sym.Name
	case core.SymbolKindVariable:
		return sym.Name
	default:
		return sym.Name
	}
}

func (b *PredictionBrain) buildCallableSnippet(sym core.Symbol, ctx CompletionContext) string {
	if sym.Signature == "" {
		return sym.Name + "()"
	}

	params := parseSignatureParams(sym.Signature, ctx.Language)
	if len(params) == 0 {
		return sym.Name + "()"
	}

	var parts []string
	for _, param := range params {
		paramName := extractParamName(param.Label, ctx.Language)
		if paramName != "" {
			parts = append(parts, paramName)
		}
	}
	if len(parts) == 0 {
		return sym.Name + "()"
	}

	return sym.Name + "(" + strings.Join(parts, ", ") + ")"
}

func extractParamName(label, language string) string {
	label = strings.TrimSpace(label)

	switch language {
	case "php":
		if strings.HasPrefix(label, "$") {
			parts := strings.Fields(label)
			if len(parts) > 0 {
				return strings.TrimPrefix(parts[0], "$")
			}
		}
		parts := strings.Fields(label)
		for _, p := range parts {
			if strings.HasPrefix(p, "$") {
				return strings.TrimPrefix(p, "$")
			}
		}
	case "go":
		parts := strings.Fields(label)
		if len(parts) > 0 {
			return parts[0]
		}
	case "typescript", "javascript":
		parts := strings.Split(label, ":")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	case "python":
		parts := strings.Split(label, ":")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}

	parts := strings.FieldsFunc(label, func(r rune) bool {
		return r == ':' || r == ' ' || r == '=' || r == '$'
	})
	if len(parts) > 0 {
		return parts[0]
	}

	return label
}

func (b *PredictionBrain) RecordUsage(text, filePath string) {
	b.usage.Record(text, filePath)

	b.mu.Lock()
	if len(b.recentSymbols) > 0 {
		lastSymbol := b.recentSymbols[len(b.recentSymbols)-1]
		if b.enhancedUsage != nil {
			b.enhancedUsage.RecordPair(lastSymbol, text)
		}
	}
	b.recentSymbols = append(b.recentSymbols, text)
	if len(b.recentSymbols) > 10 {
		b.recentSymbols = b.recentSymbols[1:]
	}
	b.mu.Unlock()
}

func (b *PredictionBrain) RecordAccepted(suggestion *Suggestion) {
	b.RecordAcceptedWithContext(suggestion, CompletionContext{FilePath: suggestion.FilePath})
}

func (b *PredictionBrain) RecordAcceptedWithContext(suggestion *Suggestion, ctx CompletionContext) {
	b.usage.Record(suggestion.Text, suggestion.FilePath)

	if b.enhancedUsage != nil {
		b.enhancedUsage.Record(suggestion.Text, suggestion.FilePath, "", "", suggestion.Kind)
	}

	if b.persistentUsage != nil {
		b.persistentUsage.Record(suggestion.Text, suggestion.FilePath, "", "", suggestion.Kind)
	}

	if b.smartRanker != nil {
		b.smartRanker.RecordAccepted(suggestion.Text)
	}

	if b.userBehavior != nil {
		b.userBehavior.RecordAccepted(suggestion.Text)
	}

	if b.arle != nil {
		b.arle.RecordAccepted(suggestion, ctx)
	}

	b.mu.Lock()
	if len(b.recentSymbols) > 0 {
		lastSymbol := b.recentSymbols[len(b.recentSymbols)-1]
		if b.enhancedUsage != nil {
			b.enhancedUsage.RecordPair(lastSymbol, suggestion.Text)
		}
		if b.persistentUsage != nil {
			b.persistentUsage.RecordPair(lastSymbol, suggestion.Text)
		}
	}
	b.recentSymbols = append(b.recentSymbols, suggestion.Text)
	if len(b.recentSymbols) > 10 {
		b.recentSymbols = b.recentSymbols[1:]
	}
	b.mu.Unlock()

	if suggestion.Source == core.SourceVirtual && b.virtualStore != nil {
		b.virtualStore.MarkAccepted(suggestion.Text, suggestion.FilePath)
	}
}

func (b *PredictionBrain) RecordTyping(chars int) {
	if b.userBehavior != nil {
		b.userBehavior.RecordTyping(chars)
	}
}

func (b *PredictionBrain) RecordCompletionShown() {
	if b.userBehavior != nil {
		b.userBehavior.RecordShown()
	}
}

func (b *PredictionBrain) RecordGhostRejected() {
	if b.userBehavior != nil {
		b.userBehavior.RecordRejected()
	}
}

func (b *PredictionBrain) GetUserBehavior() *UserBehavior {
	return b.userBehavior
}

func (b *PredictionBrain) AddVirtualSymbol(sym core.Symbol, context string) {
	if b.virtualStore != nil {
		b.virtualStore.Add(sym, context)
	}
}

func (b *PredictionBrain) OnFileCreated(filePath string) {
	if b.virtualStore != nil {
		b.virtualStore.OnFileCreated(filePath)
	}
}

func (b *PredictionBrain) Stop() {
	if b.virtualStore != nil {
		b.virtualStore.Stop()
	}
}

func (b *PredictionBrain) Engine() *core.Engine {
	return b.engine
}

// ScoringWeights defines dynamic weights for different completion contexts.
// Weights should sum to approximately 1.0 for normalized scoring.
type ScoringWeights struct {
	PrefixMatch    float64 // Weight for prefix/fuzzy match quality
	ContextMatch   float64 // Weight for namespace/type matching
	UsageFrequency float64 // Weight for usage history
	SameFile       float64 // Weight for file locality
	KindBonus      float64 // Weight for symbol kind preference
	SourceBonus    float64 // Weight for source priority (LSP > Local > Index)
}

func getWeightsForContext(ctx CompletionContext) ScoringWeights {
	if ctx.IsStaticCall {
		return ScoringWeights{
			PrefixMatch:    0.20,
			ContextMatch:   0.35,
			UsageFrequency: 0.10,
			SameFile:       0.05,
			KindBonus:      0.10,
			SourceBonus:    0.20,
		}
	}

	if ctx.IsMethodCall {
		return ScoringWeights{
			PrefixMatch:    0.25,
			ContextMatch:   0.25,
			UsageFrequency: 0.10,
			SameFile:       0.05,
			KindBonus:      0.10,
			SourceBonus:    0.25,
		}
	}

	return ScoringWeights{
		PrefixMatch:    0.30,
		ContextMatch:   0.10,
		UsageFrequency: 0.15,
		SameFile:       0.10,
		KindBonus:      0.10,
		SourceBonus:    0.25,
	}
}

type GhostTextResult struct {
	Text       string
	Confidence float64
	ShouldShow bool
}

func filterSafeGhostSuggestions(suggestions []Suggestion) []Suggestion {
	if len(suggestions) == 0 {
		return nil
	}

	filtered := make([]Suggestion, 0, len(suggestions))
	for _, s := range suggestions {
		if !isSafeGhostSuggestion(s) {
			continue
		}
		filtered = append(filtered, s)
	}
	return filtered
}

func isSafeGhostSuggestion(s Suggestion) bool {
	// Ghost (особенно word-by-word accept) не умеет применять side-effect edits.
	if len(s.AdditionalTextEdits) > 0 {
		return false
	}
	if s.IsSnippet {
		return false
	}
	insert := sanitizeInsertText(preferInsertText(s))
	return strings.TrimSpace(insert) != ""
}

func (b *PredictionBrain) SelectGhostText(suggestions []Suggestion, prefix string) GhostTextResult {
	suggestions = filterSafeGhostSuggestions(suggestions)
	if len(suggestions) == 0 {
		return GhostTextResult{ShouldShow: false}
	}

	top := suggestions[0]
	insertText := sanitizeInsertText(preferInsertText(top))
	if insertText == "" {
		insertText = top.Text
	}
	ghostText := stripPrefixFromGhostText(insertText, prefix)

	if prefix == "" {
		if top.Score >= 5.0 || top.Source == core.SourceLSP {
			return GhostTextResult{
				Text:       ghostText,
				Confidence: 0.7,
				ShouldShow: true,
			}
		}
		return GhostTextResult{ShouldShow: false}
	}

	if top.MatchResult == nil {
		textLower := strings.ToLower(top.Text)
		insertLower := strings.ToLower(insertText)
		prefixLower := strings.ToLower(prefix)
		if strings.HasPrefix(textLower, prefixLower) || strings.HasPrefix(insertLower, prefixLower) {
			return GhostTextResult{
				Text:       ghostText,
				Confidence: 0.6,
				ShouldShow: true,
			}
		}
		return GhostTextResult{ShouldShow: false}
	}

	matchType := top.MatchResult.Type
	if matchType != predictive.MatchExact && matchType != predictive.MatchPrefix {
		return GhostTextResult{ShouldShow: false}
	}

	if matchType == predictive.MatchPrefix {
		textLower := strings.ToLower(top.Text)
		insertLower := strings.ToLower(insertText)
		prefixLower := strings.ToLower(prefix)
		if !strings.HasPrefix(textLower, prefixLower) && !strings.HasPrefix(insertLower, prefixLower) {
			return GhostTextResult{ShouldShow: false}
		}
	}

	confidence := b.calculateGhostConfidence(suggestions)
	if confidence < 0.3 {
		return GhostTextResult{ShouldShow: false}
	}

	if len(suggestions) > 1 && top.Score > 0 {
		gap := (top.Score - suggestions[1].Score) / top.Score
		minGap := 0.15
		if len(prefix) >= 4 {
			minGap = 0.10
		}
		if gap < minGap {
			return GhostTextResult{ShouldShow: false}
		}
	}

	if ghostText == "" {
		return GhostTextResult{ShouldShow: false}
	}

	return GhostTextResult{
		Text:       ghostText,
		Confidence: confidence,
		ShouldShow: true,
	}
}

func (b *PredictionBrain) SelectGhostTextWithContext(ctx CompletionContext, suggestions []Suggestion, prefix, accessChain string) GhostTextResult {
	suggestions = filterSafeGhostSuggestions(suggestions)
	if len(suggestions) == 0 {
		return GhostTextResult{ShouldShow: false}
	}

	top := suggestions[0]
	insertText := sanitizeInsertText(preferInsertText(top))
	if insertText == "" {
		insertText = top.Text
	}
	ghostText := stripAccessChainAndPrefix(insertText, accessChain, prefix)
	confidence := b.calculateGhostConfidence(suggestions)
	now := time.Now()

	if ghostText == "" {
		return GhostTextResult{ShouldShow: false}
	}

	if b.ghostFilter != nil {
		filterCtx := GhostFilterContext{
			Prefix:       prefix,
			Language:     ctx.Language,
			Suggestions:  suggestions,
			IsMethodCall: strings.Contains(accessChain, "->") || strings.Contains(accessChain, "."),
			IsStaticCall: strings.Contains(accessChain, "::"),
			AccessChain:  accessChain,
			UserBehavior: b.userBehavior,
			Now:          now,
			ActiveMaxLen: 24,
			IdleMaxLen:   120,
			ActiveMinGap: 0.15,
			IdleMinGap:   0.08,
			ActiveTokens: 5,
			IdleTokens:   24,
		}
		if !b.ghostFilter.ShouldShowGhost(filterCtx) {
			return GhostTextResult{ShouldShow: false}
		}

		if b.arle != nil && isIdle(b.userBehavior, now, b.ghostFilter.idleTimeout) {
			arleText := b.GetArleGhostText(ctx)
			if arleText != "" {
				arleText = stripAccessChainAndPrefix(arleText, accessChain, prefix)
				arleText = sanitizeInsertText(arleText)
				arleText = trimTextToTokens(arleText, b.ghostFilter.idleTokenLimit)
				if arleText != "" {
					ghostText = arleText
					if confidence < 0.7 {
						confidence = 0.7
					}
				}
			}
		}
	}

	if top.MatchResult == nil {
		textLower := strings.ToLower(top.Text)
		insertLower := strings.ToLower(insertText)
		prefixLower := strings.ToLower(prefix)
		if strings.HasPrefix(textLower, prefixLower) || strings.HasPrefix(insertLower, prefixLower) || accessChain != "" {
			return GhostTextResult{
				Text:       ghostText,
				Confidence: confidence,
				ShouldShow: true,
			}
		}
		return GhostTextResult{ShouldShow: false}
	}

	matchType := top.MatchResult.Type
	if matchType != predictive.MatchExact && matchType != predictive.MatchPrefix {
		return GhostTextResult{ShouldShow: false}
	}

	if matchType == predictive.MatchPrefix {
		textLower := strings.ToLower(top.Text)
		insertLower := strings.ToLower(insertText)
		prefixLower := strings.ToLower(prefix)
		if !strings.HasPrefix(textLower, prefixLower) && !strings.HasPrefix(insertLower, prefixLower) && accessChain == "" {
			return GhostTextResult{ShouldShow: false}
		}
	}

	if confidence < 0.3 {
		return GhostTextResult{ShouldShow: false}
	}

	return GhostTextResult{
		Text:       ghostText,
		Confidence: confidence,
		ShouldShow: true,
	}
}

func trimTextToTokens(text string, limit int) string {
	if limit <= 0 {
		return ""
	}
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return ""
	}
	if len(fields) <= limit {
		return text
	}
	trimmed := strings.Join(fields[:limit], " ")
	if strings.HasPrefix(text, " ") {
		return " " + trimmed
	}
	return trimmed
}

func stripAccessChainAndPrefix(insertText, accessChain, prefix string) string {
	result := insertText
	insertLower := strings.ToLower(result)

	if accessChain != "" {
		chainLower := strings.ToLower(accessChain)
		if strings.HasPrefix(insertLower, chainLower) {
			result = result[len(chainLower):]
			insertLower = strings.ToLower(result)
		}
	}

	if prefix != "" {
		prefixLower := strings.ToLower(prefix)
		if strings.HasPrefix(insertLower, prefixLower) {
			result = result[len(prefixLower):]
		}
	}

	return result
}

func stripPrefixFromGhostText(insertText, prefix string) string {
	if prefix == "" {
		return insertText
	}

	insertLower := strings.ToLower(insertText)
	prefixLower := strings.ToLower(prefix)

	if strings.HasPrefix(insertLower, prefixLower) {
		return insertText[len(prefix):]
	}

	return insertText
}

func preferInsertText(s Suggestion) string {
	if s.InsertText != "" {
		return s.InsertText
	}
	return s.Text
}

func (b *PredictionBrain) SelectGhostTextWithLanguage(suggestions []Suggestion, prefix, language string) GhostTextResult {
	suggestions = filterSafeGhostSuggestions(suggestions)
	if len(suggestions) == 0 {
		return GhostTextResult{ShouldShow: false}
	}

	if b.ghostFilter != nil {
		filterCtx := GhostFilterContext{
			Prefix:       prefix,
			Language:     language,
			Suggestions:  suggestions,
			UserBehavior: b.userBehavior,
			ActiveMaxLen: 24,
			IdleMaxLen:   120,
			ActiveMinGap: 0.15,
			IdleMinGap:   0.08,
			ActiveTokens: 5,
			IdleTokens:   24,
		}
		if !b.ghostFilter.ShouldShowGhost(filterCtx) {
			return GhostTextResult{ShouldShow: false}
		}
	}

	result := b.SelectGhostText(suggestions, prefix)
	if !result.ShouldShow {
		return result
	}

	langThreshold := GetLanguageConfidenceThreshold(language)
	if b.userBehavior != nil {
		langThreshold = b.userBehavior.AdjustThreshold(langThreshold)
	}

	if result.Confidence < langThreshold {
		return GhostTextResult{ShouldShow: false}
	}

	return result
}

func (b *PredictionBrain) calculateGhostConfidence(suggestions []Suggestion) float64 {
	if len(suggestions) == 0 {
		return 0
	}

	top := suggestions[0]
	confidence := 0.5

	if top.MatchResult != nil {
		confidence += top.MatchResult.Score * 0.3
	}

	confidence += top.Confidence * 0.2

	if top.Source == core.SourceLSP {
		confidence += 0.1
	} else if top.Source == core.SourceLocal {
		confidence += 0.05
	}

	if confidence > 1.0 {
		confidence = 1.0
	}

	return confidence
}

type UsageTracker struct {
	mu      sync.RWMutex
	entries map[string]*UsageEntry
}

type UsageEntry struct {
	Text     string
	Count    int
	LastUsed time.Time
	ByFile   map[string]int
}

func NewUsageTracker() *UsageTracker {
	return &UsageTracker{
		entries: make(map[string]*UsageEntry),
	}
}

func (t *UsageTracker) Record(text, filePath string) {
	t.mu.Lock()
	defer t.mu.Unlock()

	entry, ok := t.entries[text]
	if !ok {
		entry = &UsageEntry{
			Text:   text,
			ByFile: make(map[string]int),
		}
		t.entries[text] = entry
	}

	entry.Count++
	entry.LastUsed = time.Now()
	entry.ByFile[filePath]++
}

func (t *UsageTracker) GetScore(text, filePath string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()

	entry, ok := t.entries[text]
	if !ok {
		return 0
	}

	score := float64(entry.Count) / 100
	if score > 0.5 {
		score = 0.5
	}

	if fileCount, ok := entry.ByFile[filePath]; ok {
		score += float64(fileCount) / 50
	}

	recency := time.Since(entry.LastUsed)
	if recency < time.Minute {
		score += 0.3
	} else if recency < time.Hour {
		score += 0.1
	}

	return score
}

func (b *PredictionBrain) SetLSPManager(manager *lsp.Manager) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lspManager = manager
}

// RecordFileAccess records access to a file for boosting file-local completions
func (b *PredictionBrain) RecordFileAccess(filePath string) {
	if b.usage != nil {
		// Record the file itself to boost its symbols
		b.usage.Record(filePath, filePath)
	}
}

// ExtractPrefix uses Tree-sitter AST analysis to extract the current prefix being typed.
// This provides more accurate prefix extraction than simple text scanning.
func (b *PredictionBrain) ExtractPrefix(filePath string, content []byte, line, column int) predictive.PrefixInfo {
	if b.predictive == nil {
		return predictive.PrefixInfo{}
	}
	return b.predictive.ExtractPrefix(filePath, content, line, column)
}

func (b *PredictionBrain) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.persistentUsage != nil {
		b.persistentUsage.Flush()
	}
	if b.virtualStore != nil {
		b.virtualStore.Cleanup()
	}
	if b.local != nil {
		b.local.Close()
	}
	if b.fillAll != nil {
		b.fillAll.Close()
	}
	if b.arle != nil {
		b.arle.Close()
	}
}

func (b *PredictionBrain) GetArleGhostText(ctx CompletionContext) string {
	if b.arle == nil {
		return ""
	}

	ghostText := b.arle.GenerateGhostText(ctx)

	if ghostText == "" && b.arle.Mode() == ArleModeArleProvider && b.providerManager != nil {
		aiSuggestions, err := b.CompleteWithAI(ctx)
		if err == nil && len(aiSuggestions) > 0 {
			return aiSuggestions[0].InsertText
		}
	}

	return ghostText
}

func (b *PredictionBrain) ArleMode() ArleMode {
	if b.arle == nil {
		return ArleModeNone
	}
	return b.arle.Mode()
}

func (b *PredictionBrain) SetArleMode(mode ArleMode) {
	if b.arle != nil {
		b.arle.SetMode(mode)
	}
}

func (b *PredictionBrain) ArleStats() ArleStats {
	if b.arle == nil {
		return ArleStats{Mode: ArleModeNone, State: ArleUnloaded}
	}
	return b.arle.Stats()
}

func (b *PredictionBrain) RegisterOpenTabs(tabs []string) {
	if b.crossFile != nil {
		b.crossFile.RegisterOpenTabs(tabs)
	}
}

func (b *PredictionBrain) AddOpenTab(filePath string) {
	if b.crossFile != nil {
		b.crossFile.AddOpenTab(filePath)
	}
}

func (b *PredictionBrain) RemoveOpenTab(filePath string) {
	if b.crossFile != nil {
		b.crossFile.RemoveOpenTab(filePath)
	}
}

func (b *PredictionBrain) RegisterProvider(provider AIProvider) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.providerManager != nil {
		b.providerManager.Register(provider)
	}
}

func (b *PredictionBrain) SetPrimaryProvider(name string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.providerManager != nil {
		b.providerManager.SetPrimary(name)
	}
}

func (b *PredictionBrain) SetFallbackProvider(name string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.providerManager != nil {
		b.providerManager.SetFallback(name)
	}
}

func (b *PredictionBrain) ListProviders() []string {
	b.mu.RLock()
	defer b.mu.RUnlock()
	if b.providerManager != nil {
		return b.providerManager.List()
	}
	return nil
}

func (b *PredictionBrain) CompleteWithAI(ctx CompletionContext) ([]Suggestion, error) {
	b.mu.RLock()
	pm := b.providerManager
	b.mu.RUnlock()

	if pm == nil {
		return nil, ErrProviderUnavailable
	}

	prompt := buildCompletionPrompt(ctx)
	completions, err := pm.Complete(context.Background(), prompt, 50)
	if err != nil {
		return nil, err
	}

	suggestions := make([]Suggestion, 0, len(completions))
	for i, c := range completions {
		suggestions = append(suggestions, Suggestion{
			Text:        c,
			DisplayText: c,
			Kind:        core.SymbolKindText,
			Source:      core.SourcePredictive,
			Score:       1.0 - float64(i)*0.1,
			InsertText:  c,
		})
	}

	return suggestions, nil
}

func buildCompletionPrompt(ctx CompletionContext) string {
	lines := strings.Split(string(ctx.Content), "\n")
	line := contentLine(ctx)
	startLine := line - 5
	if startLine < 0 {
		startLine = 0
	}
	endLine := line
	if endLine > len(lines) {
		endLine = len(lines)
	}

	contextLines := lines[startLine:endLine]
	return fmt.Sprintf("Complete this %s code:\n%s", ctx.Language, strings.Join(contextLines, "\n"))
}

func formatDocumentation(docComment string) string {
	if docComment == "" {
		return ""
	}

	doc := strings.TrimSpace(docComment)

	doc = strings.TrimPrefix(doc, "/**")
	doc = strings.TrimPrefix(doc, "/*")
	doc = strings.TrimPrefix(doc, "//")
	doc = strings.TrimPrefix(doc, "#")
	doc = strings.TrimSuffix(doc, "*/")

	lines := strings.Split(doc, "\n")
	var cleaned []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		line = strings.TrimPrefix(line, "*")
		line = strings.TrimPrefix(line, "//")
		line = strings.TrimPrefix(line, "#")
		line = strings.TrimSpace(line)
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}

	result := strings.Join(cleaned, "\n")

	if len(result) > 500 {
		result = result[:500] + "..."
	}

	return result
}

func extractTypeInfo(sym core.Symbol) string {
	switch sym.Kind {
	case core.SymbolKindFunction, core.SymbolKindMethod:
		if sym.Signature != "" {
			return sym.Signature
		}
		return "()"
	case core.SymbolKindVariable, core.SymbolKindProperty, core.SymbolKindField:
		if sym.Signature != "" {
			return sym.Signature
		}
		if sym.Extra != nil {
			if t, ok := sym.Extra["type"]; ok {
				return t
			}
		}
		return ""
	case core.SymbolKindClass, core.SymbolKindInterface, core.SymbolKindStruct:
		return string(sym.Kind)
	case core.SymbolKindConstant:
		if sym.Signature != "" {
			return sym.Signature
		}
		return "const"
	default:
		return ""
	}
}
