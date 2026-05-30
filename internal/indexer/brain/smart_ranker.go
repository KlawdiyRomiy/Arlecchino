package brain

import (
	"strings"
	"time"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/predictive"
)

type SmartRanker struct {
	matcher         *predictive.SmartMatcher
	fuzzyMatcher    *FuzzyMatcher
	persistentUsage *PersistentUsageTracker
	langDetector    *LangDetector
	weights         RankingWeights
	recentSymbols   []string
	maxRecentSize   int
}

type RankingWeights struct {
	Match        float64
	Frequency    float64
	Recency      float64
	Context      float64
	Locality     float64
	Cooccurrence float64
	ML           float64
}

func DefaultWeights() RankingWeights {
	return RankingWeights{
		Match:        0.25,
		Frequency:    0.20,
		Recency:      0.15,
		Context:      0.15,
		Locality:     0.10,
		Cooccurrence: 0.10,
		ML:           0.05,
	}
}

type RankingContext struct {
	Prefix            string
	Language          string
	FilePath          string
	IsMethodCall      bool
	IsStaticCall      bool
	AccessChain       string
	ResolvedNamespace string
	ParentClass       string
	Scope             string
	InString          bool
	InImport          bool
	RecentSymbols     []string
}

func NewSmartRanker(persistent *PersistentUsageTracker, langDetect *LangDetector) *SmartRanker {
	return &SmartRanker{
		matcher:         predictive.NewSmartMatcher(),
		fuzzyMatcher:    NewFuzzyMatcher(),
		persistentUsage: persistent,
		langDetector:    langDetect,
		weights:         DefaultWeights(),
		recentSymbols:   make([]string, 0, 10),
		maxRecentSize:   10,
	}
}

func (r *SmartRanker) SetWeights(w RankingWeights) {
	r.weights = w
}

func (r *SmartRanker) SetLangDetector(ld *LangDetector) {
	r.langDetector = ld
}

func (r *SmartRanker) RecordAccepted(symbol string) {
	for i, s := range r.recentSymbols {
		if s == symbol {
			copy(r.recentSymbols[1:i+1], r.recentSymbols[0:i])
			r.recentSymbols[0] = symbol
			return
		}
	}

	if len(r.recentSymbols) >= r.maxRecentSize {
		r.recentSymbols = r.recentSymbols[:r.maxRecentSize-1]
	}
	r.recentSymbols = append([]string{symbol}, r.recentSymbols...)
}

func (r *SmartRanker) Rank(suggestions []Suggestion, ctx RankingContext, usage *EnhancedUsageTracker) []Suggestion {
	now := time.Now()
	for i := range suggestions {
		suggestions[i].Score = r.calculateScore(now, &suggestions[i], ctx, usage)
	}

	filtered := make([]Suggestion, 0, len(suggestions))
	for _, s := range suggestions {
		if s.Score > 0 {
			filtered = append(filtered, s)
		}
	}

	stableSortSuggestions(filtered)

	return filtered
}

func (r *SmartRanker) calculateScore(now time.Time, s *Suggestion, ctx RankingContext, usage *EnhancedUsageTracker) float64 {
	kindScore := r.kindScore(s.Kind, ctx)
	if kindScore < 0 {
		return -1.0
	}

	matchScore := r.matchScore(s, ctx.Prefix)
	if matchScore < 0.1 && ctx.Prefix != "" {
		return 0
	}

	freqScore := r.frequencyScore(s)
	recencyScore := r.recencyScore(now, s, ctx, usage)
	contextScore := r.contextScore(s, ctx)
	localityScore := r.localityScore(s, ctx)
	coocScore := r.cooccurrenceScore(s, ctx)
	mlScore := r.mlScore(s, ctx)

	score := r.weights.Match*matchScore +
		r.weights.Frequency*freqScore +
		r.weights.Recency*recencyScore +
		r.weights.Context*contextScore +
		r.weights.Locality*localityScore +
		r.weights.Cooccurrence*coocScore +
		r.weights.ML*mlScore

	score *= r.sourceBoost(s.Source, ctx)

	if s.Source == core.SourceKeywords && s.Score > 0 {
		score += s.Score * 0.05
	}

	if s.Confidence > 0 {
		score *= (0.8 + s.Confidence*0.4)
	}

	recentBoost := r.recentBoost(s.Text)
	if recentBoost > 0 {
		score *= (1.0 + recentBoost*0.15)
	}

	return score
}

func (r *SmartRanker) matchScore(s *Suggestion, prefix string) float64 {
	if prefix == "" {
		return 0.5
	}

	textLower := strings.ToLower(s.Text)
	prefixLower := strings.ToLower(prefix)

	if isExactSelfEchoSuggestion(*s, prefix) {
		r.updateMatchResult(s, predictive.MatchNone, 0.05, nil)
		return 0.05
	}

	if s.Text == prefix {
		r.updateMatchResult(s, predictive.MatchExact, 1.0, nil)
		return 1.0
	}
	if textLower == prefixLower {
		r.updateMatchResult(s, predictive.MatchExact, 0.95, nil)
		return 0.95
	}
	if strings.HasPrefix(textLower, prefixLower) {
		score := 0.9 * (float64(len(prefix)) / float64(len(s.Text)))
		positions := make([]int, len(prefix))
		for i := range positions {
			positions[i] = i
		}
		r.updateMatchResult(s, predictive.MatchPrefix, score, positions)
		return score
	}

	fuzzyMatch := r.fuzzyMatcher.MatchOne(prefix, s.Text)
	if fuzzyMatch == nil {
		return 0.0
	}

	baseScore := r.fuzzyMatcher.ScoreToNormalized(fuzzyMatch.Score)

	if isWordBoundaryMatch(s.Text, fuzzyMatch.MatchedIndexes) {
		baseScore *= 1.1
		if baseScore > 0.85 {
			baseScore = 0.85
		}
		r.updateMatchResult(s, predictive.MatchWordBoundary, baseScore, fuzzyMatch.MatchedIndexes)
	} else {
		if baseScore > 0.7 {
			baseScore = 0.7
		}
		r.updateMatchResult(s, predictive.MatchSubsequence, baseScore, fuzzyMatch.MatchedIndexes)
	}

	if len(prefix) >= 2 && len(s.Text) > len(prefix) {
		excessLength := len(s.Text) - len(prefix)
		lengthPenalty := float64(excessLength) * 0.01
		if lengthPenalty > 0.15 {
			lengthPenalty = 0.15
		}
		baseScore -= lengthPenalty
	}

	if baseScore < 0.1 {
		baseScore = 0.1
	}

	return baseScore
}

func (r *SmartRanker) frequencyScore(s *Suggestion) float64 {
	if r.persistentUsage == nil {
		return 0.5
	}
	return r.persistentUsage.GetFrequencyScore(s.Text)
}

func (r *SmartRanker) recencyScore(now time.Time, s *Suggestion, ctx RankingContext, usage *EnhancedUsageTracker) float64 {
	if usage == nil {
		return 0.5
	}
	return usage.GetScoreAt(now, s.Text, s.Kind, ctx.FilePath, ctx.Language, ctx.Scope) * 0.7
}

func (r *SmartRanker) contextScore(s *Suggestion, ctx RankingContext) float64 {
	score := suggestionAccessContextScore(ctx.IsMethodCall, ctx.IsStaticCall, ctx.AccessChain, ctx.ResolvedNamespace, *s)

	if ctx.ParentClass != "" {
		parentLower := strings.ToLower(ctx.ParentClass)
		if strings.Contains(strings.ToLower(s.Namespace), parentLower) {
			score += 0.2
		}
	}

	if ctx.IsMethodCall || ctx.IsStaticCall {
		switch s.Kind {
		case core.SymbolKindMethod:
			score += 0.3
		case core.SymbolKindFunction:
			score += 0.2
		case core.SymbolKindProperty:
			score += 0.1
		}
	}

	if ctx.Scope != "" {
		scopeKeywords := extractScopeKeywords(ctx.Scope)
		for _, kw := range scopeKeywords {
			if strings.Contains(strings.ToLower(s.Text), kw) {
				score += 0.1
				break
			}
		}
	}

	if score > 1.0 {
		score = 1.0
	}
	return score
}

func (r *SmartRanker) localityScore(s *Suggestion, ctx RankingContext) float64 {
	if s.FilePath == "" || ctx.FilePath == "" {
		return 0.5
	}

	if s.FilePath == ctx.FilePath {
		return 1.0
	}

	sDir := getDirectory(s.FilePath)
	ctxDir := getDirectory(ctx.FilePath)

	if sDir == ctxDir {
		return 0.8
	}

	if strings.HasPrefix(sDir, ctxDir) || strings.HasPrefix(ctxDir, sDir) {
		return 0.6
	}

	return 0.3
}

func (r *SmartRanker) cooccurrenceScore(s *Suggestion, ctx RankingContext) float64 {
	if r.persistentUsage == nil || len(ctx.RecentSymbols) == 0 {
		return 0.5
	}
	return 0.5 + r.persistentUsage.GetCooccurrenceScore(ctx.RecentSymbols, s.Text)*0.5
}

func (r *SmartRanker) mlScore(s *Suggestion, ctx RankingContext) float64 {
	if r.langDetector == nil || !r.langDetector.IsLoaded() {
		return 0.5
	}

	if ctx.Language == "" {
		return 0.5
	}

	return 0.5
}

func (r *SmartRanker) recentBoost(symbol string) float64 {
	for i, s := range r.recentSymbols {
		if s == symbol {
			return 1.0 - float64(i)*0.08
		}
	}
	return 0.0
}

func (r *SmartRanker) kindScore(kind core.SymbolKind, ctx RankingContext) float64 {
	if ctx.AccessChain != "" && strings.HasSuffix(strings.TrimSpace(ctx.AccessChain), ".") {
		if kind == core.SymbolKindPackage || kind == core.SymbolKindModule || kind == core.SymbolKindNamespace {
			return -1.0
		}
	}

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

	if ctx.InImport {
		switch kind {
		case core.SymbolKindPackage, core.SymbolKindModule, core.SymbolKindNamespace:
			return 1.0
		default:
			return 0.3
		}
	}

	switch kind {
	case core.SymbolKindPackage, core.SymbolKindModule, core.SymbolKindNamespace:
		return 0.95
	case core.SymbolKindClass:
		return 0.9
	case core.SymbolKindFunction:
		return 0.85
	case core.SymbolKindMethod:
		return 0.8
	case core.SymbolKindVariable:
		return 0.75
	case core.SymbolKindConstant:
		return 0.7
	case core.SymbolKindInterface:
		return 0.65
	case core.SymbolKindType:
		return 0.6
	case core.SymbolKindSnippet:
		return 0.55
	default:
		return 0.5
	}
}

func (r *SmartRanker) sourceBoost(source core.SymbolSource, ctx RankingContext) float64 {
	boosts := map[core.SymbolSource]float64{
		core.SourceLSP:        1.2,
		core.SourceFillAll:    1.15,
		core.SourceLocal:      1.1,
		core.SourceKeywords:   1.05,
		core.SourceAST:        1.0,
		core.SourcePredictive: 0.95,
		core.SourceIndex:      0.9,
		core.SourceVirtual:    0.85,
		core.SourceLibrary:    0.75,
	}

	boost, ok := boosts[source]
	if !ok {
		boost = 0.9
	}

	if ctx.IsMethodCall || ctx.IsStaticCall {
		if ctx.ResolvedNamespace != "" {
			if source == core.SourceLSP {
				boost = 1.0
			}
		} else if source == core.SourceLSP {
			boost = 1.15
		}
	}

	return boost
}

func (r *SmartRanker) updateMatchResult(s *Suggestion, matchType predictive.MatchType, score float64, positions []int) {
	if s.MatchResult == nil {
		s.MatchResult = &predictive.MatchResult{}
	}
	s.MatchResult.Matched = true
	s.MatchResult.Type = matchType
	s.MatchResult.Score = score
	s.MatchResult.Positions = positions
}

func isWordBoundaryMatch(text string, positions []int) bool {
	if len(positions) == 0 {
		return false
	}

	boundaryCount := 0
	for _, pos := range positions {
		if pos == 0 {
			boundaryCount++
			continue
		}
		if pos < len(text) {
			prev := text[pos-1]
			if prev == '_' || prev == '-' || (prev >= 'a' && prev <= 'z' && text[pos] >= 'A' && text[pos] <= 'Z') {
				boundaryCount++
			}
		}
	}

	return boundaryCount >= len(positions)/2
}

func extractScopeKeywords(scope string) []string {
	keywords := []string{}
	scopeLower := strings.ToLower(scope)

	if strings.Contains(scopeLower, "controller") {
		keywords = append(keywords, "request", "response", "view", "redirect")
	}
	if strings.Contains(scopeLower, "model") {
		keywords = append(keywords, "find", "where", "create", "update", "delete", "save")
	}
	if strings.Contains(scopeLower, "service") {
		keywords = append(keywords, "execute", "process", "handle", "validate")
	}
	if strings.Contains(scopeLower, "repository") {
		keywords = append(keywords, "find", "get", "save", "delete", "query")
	}
	if strings.Contains(scopeLower, "test") {
		keywords = append(keywords, "assert", "expect", "mock", "stub", "verify")
	}

	return keywords
}

func getDirectory(path string) string {
	lastSlash := strings.LastIndex(path, "/")
	if lastSlash == -1 {
		lastSlash = strings.LastIndex(path, "\\")
	}
	if lastSlash == -1 {
		return ""
	}
	return path[:lastSlash]
}
