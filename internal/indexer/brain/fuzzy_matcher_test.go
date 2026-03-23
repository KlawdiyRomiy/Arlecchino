package brain

import (
	"testing"
)

func TestFuzzyMatcher_Match(t *testing.T) {
	fm := NewFuzzyMatcher()

	tests := []struct {
		name       string
		pattern    string
		candidates []string
		wantFirst  string
		wantLen    int
	}{
		{
			name:       "exact match",
			pattern:    "User",
			candidates: []string{"User", "UserService", "AdminUser"},
			wantFirst:  "User",
			wantLen:    3,
		},
		{
			name:       "prefix match",
			pattern:    "get",
			candidates: []string{"getUser", "getUserById", "setUser", "fetchUser"},
			wantFirst:  "getUser",
			wantLen:    2,
		},
		{
			name:       "fuzzy match camelCase",
			pattern:    "gub",
			candidates: []string{"getUserById", "getUser", "setUser"},
			wantFirst:  "getUserById",
			wantLen:    1,
		},
		{
			name:       "fuzzy match snake_case",
			pattern:    "gub",
			candidates: []string{"get_user_by_id", "get_user", "set_user"},
			wantFirst:  "get_user_by_id",
			wantLen:    1,
		},
		{
			name:       "no match",
			pattern:    "xyz",
			candidates: []string{"getUser", "setUser", "deleteUser"},
			wantFirst:  "",
			wantLen:    0,
		},
		{
			name:       "empty pattern",
			pattern:    "",
			candidates: []string{"getUser", "setUser"},
			wantFirst:  "",
			wantLen:    0,
		},
		{
			name:       "empty candidates",
			pattern:    "get",
			candidates: []string{},
			wantFirst:  "",
			wantLen:    0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			matches := fm.Match(tt.pattern, tt.candidates)

			if len(matches) != tt.wantLen {
				t.Errorf("Match() got %d matches, want %d", len(matches), tt.wantLen)
			}

			if tt.wantLen > 0 && len(matches) > 0 {
				if matches[0].Text != tt.wantFirst {
					t.Errorf("Match() first match = %q, want %q", matches[0].Text, tt.wantFirst)
				}
			}
		})
	}
}

func TestFuzzyMatcher_MatchOne(t *testing.T) {
	fm := NewFuzzyMatcher()

	tests := []struct {
		name        string
		pattern     string
		text        string
		shouldMatch bool
	}{
		{"exact", "User", "User", true},
		{"prefix", "get", "getUser", true},
		{"fuzzy camelCase", "gub", "getUserById", true},
		{"no match", "xyz", "getUser", false},
		{"empty pattern", "", "getUser", false},
		{"empty text", "get", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			match := fm.MatchOne(tt.pattern, tt.text)

			if tt.shouldMatch && match == nil {
				t.Errorf("MatchOne() expected match, got nil")
			}
			if !tt.shouldMatch && match != nil {
				t.Errorf("MatchOne() expected no match, got %+v", match)
			}
		})
	}
}

func TestFuzzyMatcher_MatchedIndexes(t *testing.T) {
	fm := NewFuzzyMatcher()

	match := fm.MatchOne("gub", "getUserById")
	if match == nil {
		t.Fatal("expected match")
	}

	if len(match.MatchedIndexes) == 0 {
		t.Error("MatchedIndexes should not be empty")
	}

	for _, idx := range match.MatchedIndexes {
		if idx < 0 || idx >= len(match.Text) {
			t.Errorf("invalid index %d for text %q", idx, match.Text)
		}
	}
}

func TestFuzzyMatcher_ScoreToNormalized(t *testing.T) {
	fm := NewFuzzyMatcher()

	tests := []struct {
		score   int
		wantMin float64
		wantMax float64
	}{
		{-1000, 0.0, 0.1},
		{-500, 0.4, 0.6},
		{0, 0.8, 1.0},
		{100, 1.0, 1.0},
		{200, 1.0, 1.0},
	}

	for _, tt := range tests {
		normalized := fm.ScoreToNormalized(tt.score)
		if normalized < tt.wantMin || normalized > tt.wantMax {
			t.Errorf("ScoreToNormalized(%d) = %f, want between %f and %f",
				tt.score, normalized, tt.wantMin, tt.wantMax)
		}
	}
}

func TestFuzzyMatcher_MatchSuggestions(t *testing.T) {
	fm := NewFuzzyMatcher()

	suggestions := []Suggestion{
		{Text: "getUserById"},
		{Text: "getUser"},
		{Text: "setUser"},
		{Text: "deleteUser"},
	}

	matches := fm.MatchSuggestions("gub", suggestions)

	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}

	if matches[0].Text != "getUserById" {
		t.Errorf("expected getUserById, got %s", matches[0].Text)
	}

	if matches[0].Index != 0 {
		t.Errorf("expected index 0, got %d", matches[0].Index)
	}
}

func TestIsWordBoundaryMatch(t *testing.T) {
	tests := []struct {
		text      string
		positions []int
		want      bool
	}{
		{"getUserById", []int{0, 3, 7}, true},
		{"get_user_by_id", []int{0, 4, 9}, true},
		{"getUserById", []int{1, 2, 3, 4, 5, 6}, false},
		{"", []int{}, false},
	}

	for _, tt := range tests {
		got := isWordBoundaryMatch(tt.text, tt.positions)
		if got != tt.want {
			t.Errorf("isWordBoundaryMatch(%q, %v) = %v, want %v",
				tt.text, tt.positions, got, tt.want)
		}
	}
}
