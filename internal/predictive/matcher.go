package predictive

import (
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// MatchType represents the type of match found
type MatchType int

const (
	MatchNone MatchType = iota
	MatchExact
	MatchPrefix
	MatchWordBoundary
	MatchSubsequence
	MatchContains
)

// String returns the string representation of MatchType
func (mt MatchType) String() string {
	switch mt {
	case MatchExact:
		return "Exact"
	case MatchPrefix:
		return "Prefix"
	case MatchWordBoundary:
		return "WordBoundary"
	case MatchSubsequence:
		return "Subsequence"
	case MatchContains:
		return "Contains"
	default:
		return "None"
	}
}

// MatchResult contains the result of a pattern match
type MatchResult struct {
	Matched   bool
	Score     float64 // 0.0 - 1.0
	Type      MatchType
	Positions []int // matched character positions (for highlighting)
}

// Matcher defines the interface for pattern matching strategies
type Matcher interface {
	Match(pattern, text string) MatchResult
	Name() string
}

// SmartMatcher orchestrates multiple matching strategies
type SmartMatcher struct {
	matchers []Matcher
	// Pool for match result slices to reduce allocations
	posPool sync.Pool
}

// NewSmartMatcher creates a new SmartMatcher with default matchers
func NewSmartMatcher() *SmartMatcher {
	sm := &SmartMatcher{
		matchers: []Matcher{
			&exactMatcher{},
			&prefixMatcher{},
			&wordBoundaryMatcher{},
			&subsequenceMatcher{},
			&containsMatcher{},
		},
		posPool: sync.Pool{
			New: func() interface{} {
				s := make([]int, 0, 32) // pre-allocate for typical identifier length
				return &s
			},
		},
	}
	return sm
}

// Match finds the best match using the chain of responsibility pattern
func (sm *SmartMatcher) Match(pattern, text string) MatchResult {
	// Early exit for empty pattern
	if pattern == "" {
		return MatchResult{Matched: false, Score: 0.0, Type: MatchNone}
	}

	// Try matchers in priority order (highest score first)
	for _, matcher := range sm.matchers {
		result := matcher.Match(pattern, text)
		if result.Matched {
			return result
		}
	}

	return MatchResult{Matched: false, Score: 0.0, Type: MatchNone}
}

// AddMatcher allows plugins to register custom matchers
// Insert at beginning for high priority, end for low priority
func (sm *SmartMatcher) AddMatcher(matcher Matcher, priority bool) {
	if priority {
		sm.matchers = append([]Matcher{matcher}, sm.matchers...)
	} else {
		sm.matchers = append(sm.matchers, matcher)
	}
}

// getPositions retrieves a positions slice from pool
func (sm *SmartMatcher) getPositions() *[]int {
	pos := sm.posPool.Get().(*[]int)
	*pos = (*pos)[:0] // reset length, keep capacity
	return pos
}

// putPositions returns a positions slice to pool
func (sm *SmartMatcher) putPositions(pos *[]int) {
	sm.posPool.Put(pos)
}

// --- Matcher Implementations ---

// exactMatcher matches when pattern equals text (case-insensitive)
type exactMatcher struct{}

func (m *exactMatcher) Name() string { return "Exact" }

func (m *exactMatcher) Match(pattern, text string) MatchResult {
	if !strings.EqualFold(pattern, text) {
		return MatchResult{Matched: false}
	}

	// Generate positions for all characters
	positions := make([]int, 0, utf8.RuneCountInString(text))
	for i := range text {
		positions = append(positions, i)
	}

	return MatchResult{
		Matched:   true,
		Score:     1.0,
		Type:      MatchExact,
		Positions: positions,
	}
}

// prefixMatcher matches when text starts with pattern
type prefixMatcher struct{}

func (m *prefixMatcher) Name() string { return "Prefix" }

func (m *prefixMatcher) Match(pattern, text string) MatchResult {
	patternLower := strings.ToLower(pattern)
	textLower := strings.ToLower(text)

	if !strings.HasPrefix(textLower, patternLower) {
		return MatchResult{Matched: false}
	}

	positions := make([]int, 0, utf8.RuneCountInString(pattern))
	patternRunes := []rune(pattern)
	idx := 0
	for range patternRunes {
		positions = append(positions, idx)
		_, size := utf8.DecodeRuneInString(text[idx:])
		idx += size
	}

	prefixRatio := float64(len(pattern)) / float64(len(text))
	score := 0.7 + (prefixRatio * 0.25)
	if score > 0.95 {
		score = 0.95
	}

	return MatchResult{
		Matched:   true,
		Score:     score,
		Type:      MatchPrefix,
		Positions: positions,
	}
}

// wordBoundaryMatcher matches first letters of words (language-agnostic)
// Supports: CamelCase, snake_case, kebab-case, PascalCase
type wordBoundaryMatcher struct{}

func (m *wordBoundaryMatcher) Name() string { return "WordBoundary" }

func (m *wordBoundaryMatcher) Match(pattern, text string) MatchResult {
	boundaries := extractWordBoundaries(text)
	if len(boundaries) == 0 {
		return MatchResult{Matched: false}
	}

	patternRunes := []rune(strings.ToLower(pattern))
	textRunes := []rune(strings.ToLower(text))

	if len(patternRunes) > len(boundaries) {
		return MatchResult{Matched: false}
	}

	positions := make([]int, 0, len(patternRunes))
	boundaryIdx := 0
	matchedBoundaries := 0

	for _, pr := range patternRunes {
		found := false
		for boundaryIdx < len(boundaries) {
			pos := boundaries[boundaryIdx]
			if textRunes[pos] == pr {
				positions = append(positions, runeIndexToByteIndex(text, pos))
				boundaryIdx++
				matchedBoundaries++
				found = true
				break
			}
			boundaryIdx++
		}
		if !found {
			return MatchResult{Matched: false}
		}
	}

	if matchedBoundaries < len(patternRunes) {
		return MatchResult{Matched: false}
	}

	return MatchResult{
		Matched:   true,
		Score:     0.85,
		Type:      MatchWordBoundary,
		Positions: positions,
	}
}

// subsequenceMatcher matches characters in order (not necessarily contiguous)
type subsequenceMatcher struct{}

func (m *subsequenceMatcher) Name() string { return "Subsequence" }

func (m *subsequenceMatcher) Match(pattern, text string) MatchResult {
	patternRunes := []rune(strings.ToLower(pattern))
	textRunes := []rune(strings.ToLower(text))

	if len(patternRunes) > len(textRunes) {
		return MatchResult{Matched: false}
	}

	positions := make([]int, 0, len(patternRunes))
	textIdx := 0

	for _, pr := range patternRunes {
		found := false
		for textIdx < len(textRunes) {
			if textRunes[textIdx] == pr {
				positions = append(positions, runeIndexToByteIndex(text, textIdx))
				textIdx++
				found = true
				break
			}
			textIdx++
		}
		if !found {
			return MatchResult{Matched: false}
		}
	}

	// Bonus score for consecutive matches
	consecutiveBonus := calculateConsecutiveBonus(positions)
	score := 0.7 + (consecutiveBonus * 0.1)

	return MatchResult{
		Matched:   true,
		Score:     score,
		Type:      MatchSubsequence,
		Positions: positions,
	}
}

// containsMatcher matches if pattern is contained anywhere in text
// Requires minimum 3 chars to avoid false positives like 'p' matching 'append'
type containsMatcher struct{}

func (m *containsMatcher) Name() string { return "Contains" }

func (m *containsMatcher) Match(pattern, text string) MatchResult {
	// Require minimum 3 characters for contains match to avoid noise
	if len(pattern) < 3 {
		return MatchResult{Matched: false}
	}

	patternLower := strings.ToLower(pattern)
	textLower := strings.ToLower(text)

	idx := strings.Index(textLower, patternLower)
	if idx == -1 {
		return MatchResult{Matched: false}
	}

	positions := make([]int, 0, len(pattern))
	for i := range pattern {
		positions = append(positions, idx+i)
	}

	return MatchResult{
		Matched:   true,
		Score:     0.5,
		Type:      MatchContains,
		Positions: positions,
	}
}

// --- Helper Functions ---

// extractWordBoundaries identifies word boundaries in text (language-agnostic)
// Returns rune indices of word starts
func extractWordBoundaries(text string) []int {
	runes := []rune(text)
	if len(runes) == 0 {
		return nil
	}

	boundaries := make([]int, 0, len(runes)/3) // heuristic: average 3 chars per word
	boundaries = append(boundaries, 0)         // first character is always a boundary

	for i := 1; i < len(runes); i++ {
		curr := runes[i]
		prev := runes[i-1]

		// CamelCase/PascalCase: lowercase -> uppercase
		if unicode.IsLower(prev) && unicode.IsUpper(curr) {
			boundaries = append(boundaries, i)
			continue
		}

		// snake_case, kebab-case: delimiter -> letter
		if (prev == '_' || prev == '-') && unicode.IsLetter(curr) {
			boundaries = append(boundaries, i)
			continue
		}

		// Digit boundaries: letter -> digit or digit -> letter
		if (unicode.IsLetter(prev) && unicode.IsDigit(curr)) ||
			(unicode.IsDigit(prev) && unicode.IsLetter(curr)) {
			boundaries = append(boundaries, i)
			continue
		}

		// Uppercase run followed by lowercase: HTTPServer -> [HTTP, Server]
		// XMLHttpRequest -> [XML, Http, Request]
		if i > 0 && i < len(runes)-1 && unicode.IsUpper(prev) && unicode.IsUpper(curr) && unicode.IsLower(runes[i+1]) {
			boundaries = append(boundaries, i)
			continue
		}

		// Start of lowercase after uppercase run: XMLHttpRequest -> "Request" at 'R'
		if i > 1 && unicode.IsUpper(runes[i-2]) && unicode.IsUpper(prev) && unicode.IsLower(curr) {
			continue
		}
	}

	return boundaries
}

// runeIndexToByteIndex converts a rune index to byte index
func runeIndexToByteIndex(s string, runeIdx int) int {
	if runeIdx == 0 {
		return 0
	}

	byteIdx := 0
	for i := 0; i < runeIdx; i++ {
		_, size := utf8.DecodeRuneInString(s[byteIdx:])
		byteIdx += size
	}
	return byteIdx
}

// calculateConsecutiveBonus returns 0.0-1.0 based on consecutive match density
func calculateConsecutiveBonus(positions []int) float64 {
	if len(positions) <= 1 {
		return 0.0
	}

	consecutive := 0
	for i := 1; i < len(positions); i++ {
		if positions[i] == positions[i-1]+1 {
			consecutive++
		}
	}

	return float64(consecutive) / float64(len(positions)-1)
}
