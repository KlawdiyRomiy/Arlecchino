package brain

import (
	"github.com/sahilm/fuzzy"
)

type FuzzyMatcher struct {
	minScore int
}

type FuzzyMatch struct {
	Text           string
	Score          int
	MatchedIndexes []int
	Index          int
}

func NewFuzzyMatcher() *FuzzyMatcher {
	return &FuzzyMatcher{
		minScore: -1000,
	}
}

func (m *FuzzyMatcher) SetMinScore(score int) {
	m.minScore = score
}

func (m *FuzzyMatcher) Match(pattern string, candidates []string) []FuzzyMatch {
	if pattern == "" || len(candidates) == 0 {
		return nil
	}

	matches := fuzzy.Find(pattern, candidates)
	result := make([]FuzzyMatch, 0, len(matches))

	for _, match := range matches {
		if match.Score >= m.minScore {
			result = append(result, FuzzyMatch{
				Text:           match.Str,
				Score:          match.Score,
				MatchedIndexes: match.MatchedIndexes,
				Index:          match.Index,
			})
		}
	}

	return result
}

func (m *FuzzyMatcher) MatchOne(pattern string, text string) *FuzzyMatch {
	if pattern == "" || text == "" {
		return nil
	}

	matches := fuzzy.Find(pattern, []string{text})
	if len(matches) == 0 {
		return nil
	}

	match := matches[0]
	if match.Score < m.minScore {
		return nil
	}

	return &FuzzyMatch{
		Text:           match.Str,
		Score:          match.Score,
		MatchedIndexes: match.MatchedIndexes,
		Index:          0,
	}
}

func (m *FuzzyMatcher) ScoreToNormalized(score int) float64 {
	if score <= -1000 {
		return 0.0
	}
	if score >= 100 {
		return 1.0
	}

	normalized := (float64(score) + 1000) / 1100
	if normalized < 0.1 {
		normalized = 0.1
	}
	if normalized > 1.0 {
		normalized = 1.0
	}
	return normalized
}

type fuzzySource struct {
	suggestions []Suggestion
}

func (s fuzzySource) String(i int) string {
	return s.suggestions[i].Text
}

func (s fuzzySource) Len() int {
	return len(s.suggestions)
}

func (m *FuzzyMatcher) MatchSuggestions(pattern string, suggestions []Suggestion) []FuzzyMatch {
	if pattern == "" || len(suggestions) == 0 {
		return nil
	}

	source := fuzzySource{suggestions: suggestions}
	matches := fuzzy.FindFrom(pattern, source)
	result := make([]FuzzyMatch, 0, len(matches))

	for _, match := range matches {
		if match.Score >= m.minScore {
			result = append(result, FuzzyMatch{
				Text:           match.Str,
				Score:          match.Score,
				MatchedIndexes: match.MatchedIndexes,
				Index:          match.Index,
			})
		}
	}

	return result
}
