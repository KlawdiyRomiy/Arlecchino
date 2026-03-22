package predictive

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSmartMatcher_Exact(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		text    string
		want    MatchType
		score   float64
	}{
		{"exact match lowercase", "getuser", "getUser", MatchExact, 1.0},
		{"exact match uppercase", "GETUSER", "getuser", MatchExact, 1.0},
		{"exact match mixed", "GetUser", "getuser", MatchExact, 1.0},
		{"not exact", "get", "getUser", MatchPrefix, 0.0},
		{"empty pattern", "", "getUser", MatchNone, 0.0},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Type != tt.want {
				t.Errorf("Match() type = %v, want %v", result.Type, tt.want)
			}
			if tt.score > 0 && result.Matched && result.Score != tt.score {
				t.Errorf("Match() score = %v, want %v", result.Score, tt.score)
			}
		})
	}
}

func TestSmartMatcher_Prefix(t *testing.T) {
	tests := []struct {
		name         string
		pattern      string
		text         string
		wantMatch    bool
		wantMinScore float64
		wantMaxScore float64
		wantPosLen   int
	}{
		{"simple prefix", "get", "getUserById", true, 0.76, 0.78, 3},
		{"full prefix", "getUser", "getUserById", true, 0.85, 0.87, 7},
		{"case insensitive", "GET", "getUserById", true, 0.76, 0.78, 3},
		{"not a prefix", "User", "getUserById", true, 0.7, 0.85, 4},
		{"unicode prefix", "по", "пользователь", true, 0.74, 0.76, 2},
		{"high ratio prefix", "Rou", "Route", true, 0.84, 0.86, 3},
		{"low ratio prefix", "R", "RouteServiceProvider", true, 0.70, 0.72, 1},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatch {
				t.Errorf("Match() matched = %v, want %v", result.Matched, tt.wantMatch)
			}
			if result.Matched && (result.Score < tt.wantMinScore || result.Score > tt.wantMaxScore) {
				t.Errorf("Match() score = %v, want between %v and %v", result.Score, tt.wantMinScore, tt.wantMaxScore)
			}
			if result.Matched && tt.wantPosLen > 0 && len(result.Positions) != tt.wantPosLen {
				t.Errorf("Match() positions length = %v, want %v", len(result.Positions), tt.wantPosLen)
			}
		})
	}
}

func TestSmartMatcher_WordBoundary(t *testing.T) {
	tests := []struct {
		name      string
		pattern   string
		text      string
		wantMatch bool
		wantType  MatchType
	}{
		{"camelCase basic", "gUBI", "getUserById", true, MatchWordBoundary},
		{"camelCase short", "gU", "getUserById", true, MatchWordBoundary},
		{"PascalCase", "GUBI", "GetUserById", true, MatchWordBoundary},
		{"snake_case", "gubi", "get_user_by_id", true, MatchWordBoundary},
		{"kebab-case", "gubi", "get-user-by-id", true, MatchWordBoundary},
		{"mixed case pattern", "GuBi", "getUserById", true, MatchWordBoundary},
		{"too many chars", "gubix", "getUserById", false, MatchNone},
		{"HTTP acronym", "HS", "HTTPServer", true, MatchWordBoundary},
		{"with digits", "g2U", "get2UserById", true, MatchWordBoundary},
		{"emoji boundaries", "gUI", "get_User_Id", true, MatchWordBoundary},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatch {
				t.Errorf("Match() matched = %v, want %v", result.Matched, tt.wantMatch)
			}
			if result.Type != tt.wantType {
				t.Errorf("Match() type = %v, want %v", result.Type, tt.wantType)
			}
			if result.Matched && result.Score != 0.85 {
				t.Errorf("Match() score = %v, want 0.85", result.Score)
			}
		})
	}
}

func TestSmartMatcher_Subsequence(t *testing.T) {
	tests := []struct {
		name         string
		pattern      string
		text         string
		wantMatch    bool
		wantType     MatchType
		wantMinScore float64
		wantMaxScore float64
	}{
		{"scattered subsequence", "gid", "getUserById", true, MatchSubsequence, 0.7, 0.8},
		{"not subsequence", "bgu", "getUserById", false, MatchNone, 0.0, 0.0},
		{"unicode", "пль", "пользователь", true, MatchSubsequence, 0.7, 0.8},
		{"consecutive", "user", "getUserById", true, MatchSubsequence, 0.7, 0.9},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatch {
				t.Errorf("Match() matched = %v, want %v", result.Matched, tt.wantMatch)
			}
			if result.Matched && (result.Score < tt.wantMinScore || result.Score > tt.wantMaxScore) {
				t.Errorf("Match() score = %v, want between %v and %v", result.Score, tt.wantMinScore, tt.wantMaxScore)
			}
			if tt.wantType != MatchNone && result.Type != tt.wantType {
				t.Errorf("Match() type = %v, want %v", result.Type, tt.wantType)
			}
		})
	}
}

func TestSmartMatcher_Contains(t *testing.T) {
	tests := []struct {
		name         string
		pattern      string
		text         string
		wantMatch    bool
		wantMinScore float64
		wantMaxScore float64
	}{
		{"middle match", "User", "getUserById", true, 0.5, 0.9},
		{"end match", "ById", "getUserById", true, 0.5, 0.9},
		{"case insensitive", "BYID", "getUserById", true, 0.5, 0.9},
		{"not contained", "xyz", "getUserById", false, 0.0, 0.0},
		{"unicode", "зова", "пользователь", true, 0.5, 0.8},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatch {
				t.Errorf("Match() matched = %v, want %v", result.Matched, tt.wantMatch)
			}
			if result.Matched && (result.Score < tt.wantMinScore || result.Score > tt.wantMaxScore) {
				t.Errorf("Match() score = %v, want between %v and %v", result.Score, tt.wantMinScore, tt.wantMaxScore)
			}
		})
	}
}

func TestSmartMatcher_PriorityOrder(t *testing.T) {
	tests := []struct {
		name         string
		pattern      string
		text         string
		wantType     MatchType
		wantMinScore float64
	}{
		{"exact over prefix", "get", "get", MatchExact, 1.0},
		{"prefix over word boundary", "get", "getUserById", MatchPrefix, 0.76},
		{"word boundary over subsequence", "gUBI", "getUserById", MatchWordBoundary, 0.85},
		{"subsequence preferred", "gid", "getUserById", MatchSubsequence, 0.7},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Type != tt.wantType {
				t.Errorf("Match() type = %v, want %v", result.Type, tt.wantType)
			}
			if result.Score < tt.wantMinScore {
				t.Errorf("Match() score = %v, want >= %v", result.Score, tt.wantMinScore)
			}
		})
	}
}

func TestSmartMatcher_Unicode(t *testing.T) {
	tests := []struct {
		name      string
		pattern   string
		text      string
		wantMatch bool
	}{
		{"cyrillic prefix", "пол", "пользователь", true},
		{"chinese exact", "用户", "用户", true},
		{"arabic subsequence", "مرح", "مرحبا", true},
		{"emoji in identifier", "get😀", "get😀User", true},
		{"mixed unicode", "gü", "getÜberUser", true},
		{"japanese word boundary", "ユテ", "ユーザーテスト", true},
	}

	sm := NewSmartMatcher()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatch {
				t.Errorf("Match() matched = %v, want %v for pattern=%q text=%q",
					result.Matched, tt.wantMatch, tt.pattern, tt.text)
			}
		})
	}
}

func TestExtractWordBoundaries(t *testing.T) {
	tests := []struct {
		name string
		text string
		want []int
	}{
		{
			"camelCase",
			"getUserById",
			[]int{0, 3, 7, 9},
		},
		{
			"PascalCase",
			"GetUserById",
			[]int{0, 3, 7, 9},
		},
		{
			"snake_case",
			"get_user_by_id",
			[]int{0, 4, 9, 12},
		},
		{
			"kebab-case",
			"get-user-by-id",
			[]int{0, 4, 9, 12},
		},
		{
			"HTTP acronym",
			"HTTPServer",
			[]int{0, 4},
		},
		{
			"XMLHttpRequest",
			"XMLHttpRequest",
			[]int{0, 3, 7},
		},
		{
			"with digits",
			"get2UserBy3Id",
			[]int{0, 3, 4, 8, 10, 11},
		},
		{
			"single word",
			"user",
			[]int{0},
		},
		{
			"empty string",
			"",
			nil,
		},
		{
			"unicode camelCase",
			"getÜberUser",
			[]int{0, 3, 7},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractWordBoundaries(tt.text)
			if len(got) != len(tt.want) {
				t.Errorf("extractWordBoundaries() length = %v, want %v\ngot: %v\nwant: %v",
					len(got), len(tt.want), got, tt.want)
				return
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("extractWordBoundaries() at index %d = %v, want %v\ngot: %v\nwant: %v",
						i, got[i], tt.want[i], got, tt.want)
				}
			}
		})
	}
}

func TestRuneIndexToByteIndex(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		runeIdx  int
		wantByte int
	}{
		{"ascii at 0", "hello", 0, 0},
		{"ascii at 2", "hello", 2, 2},
		{"unicode at 0", "привет", 0, 0},
		{"unicode at 2", "привет", 2, 4},
		{"mixed at 3", "get用户", 3, 3},
		{"emoji at 1", "a😀b", 1, 1},
		{"emoji at 2", "a😀b", 2, 5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := runeIndexToByteIndex(tt.text, tt.runeIdx)
			if got != tt.wantByte {
				t.Errorf("runeIndexToByteIndex() = %v, want %v", got, tt.wantByte)
			}
		})
	}
}

func TestCalculateConsecutiveBonus(t *testing.T) {
	tests := []struct {
		name      string
		positions []int
		want      float64
	}{
		{"all consecutive", []int{0, 1, 2, 3}, 1.0},
		{"none consecutive", []int{0, 2, 4, 6}, 0.0},
		{"half consecutive", []int{0, 1, 3, 4}, 0.666},
		{"single position", []int{5}, 0.0},
		{"two consecutive", []int{5, 6}, 1.0},
		{"two non-consecutive", []int{5, 7}, 0.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := calculateConsecutiveBonus(tt.positions)
			if diff := got - tt.want; diff > 0.01 || diff < -0.01 {
				t.Errorf("calculateConsecutiveBonus() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSmartMatcher_AddMatcher(t *testing.T) {
	sm := NewSmartMatcher()

	customMatcher := &mockMatcher{
		matchFunc: func(pattern, text string) MatchResult {
			if pattern == "custom" && text == "test" {
				return MatchResult{Matched: true, Score: 0.95, Type: MatchExact}
			}
			return MatchResult{Matched: false}
		},
		name: "Custom",
	}

	sm.AddMatcher(customMatcher, true)

	result := sm.Match("custom", "test")
	if !result.Matched {
		t.Error("AddMatcher() custom matcher not working")
	}
	if result.Score != 0.95 {
		t.Errorf("AddMatcher() score = %v, want 0.95", result.Score)
	}
}

func TestMatchType_String(t *testing.T) {
	tests := []struct {
		mt   MatchType
		want string
	}{
		{MatchExact, "Exact"},
		{MatchPrefix, "Prefix"},
		{MatchWordBoundary, "WordBoundary"},
		{MatchSubsequence, "Subsequence"},
		{MatchContains, "Contains"},
		{MatchNone, "None"},
		{MatchType(99), "None"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.mt.String(); got != tt.want {
				t.Errorf("String() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestSmartMatcher_PositionsCorrectness(t *testing.T) {
	sm := NewSmartMatcher()

	tests := []struct {
		name         string
		pattern      string
		text         string
		validateFunc func(t *testing.T, result MatchResult, text string)
	}{
		{
			"exact positions",
			"test",
			"test",
			func(t *testing.T, result MatchResult, text string) {
				if !result.Matched || result.Type != MatchExact {
					t.Errorf("expected exact match")
				}
				if len(result.Positions) != utf8.RuneCountInString(text) {
					t.Errorf("exact match should have positions for all chars")
				}
			},
		},
		{
			"prefix positions",
			"get",
			"getUserById",
			func(t *testing.T, result MatchResult, text string) {
				if !result.Matched || result.Type != MatchPrefix {
					t.Errorf("expected prefix match")
				}
				if len(result.Positions) != 3 {
					t.Errorf("prefix match positions = %d, want 3", len(result.Positions))
				}
				if result.Positions[0] != 0 || result.Positions[1] != 1 || result.Positions[2] != 2 {
					t.Errorf("prefix positions incorrect: %v", result.Positions)
				}
			},
		},
		{
			"positions ordered",
			"gid",
			"getUserById",
			func(t *testing.T, result MatchResult, text string) {
				if !result.Matched {
					t.Errorf("expected match")
				}
				for i := 1; i < len(result.Positions); i++ {
					if result.Positions[i] <= result.Positions[i-1] {
						t.Errorf("positions not ordered: %v", result.Positions)
					}
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			tt.validateFunc(t, result, tt.text)
		})
	}
}

func BenchmarkSmartMatcher_Exact(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("getUserById", "getUserById")
	}
}

func BenchmarkSmartMatcher_Prefix(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("get", "getUserById")
	}
}

func BenchmarkSmartMatcher_WordBoundary(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("gUBI", "getUserById")
	}
}

func BenchmarkSmartMatcher_Subsequence(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("gubi", "getUserById")
	}
}

func BenchmarkSmartMatcher_Contains(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("ById", "getUserById")
	}
}

func BenchmarkSmartMatcher_NoMatch(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("xyz", "getUserById")
	}
}

func BenchmarkSmartMatcher_Unicode(b *testing.B) {
	sm := NewSmartMatcher()
	for i := 0; i < b.N; i++ {
		sm.Match("пол", "пользователь")
	}
}

func BenchmarkExtractWordBoundaries(b *testing.B) {
	texts := []string{
		"getUserById",
		"HTTPServer",
		"XMLHttpRequest",
		"get_user_by_id",
		"get-user-by-id",
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, text := range texts {
			extractWordBoundaries(text)
		}
	}
}

type mockMatcher struct {
	matchFunc func(pattern, text string) MatchResult
	name      string
}

func (m *mockMatcher) Match(pattern, text string) MatchResult {
	return m.matchFunc(pattern, text)
}

func (m *mockMatcher) Name() string {
	return m.name
}

func TestSmartMatcher_Concurrency(t *testing.T) {
	sm := NewSmartMatcher()
	done := make(chan bool)

	for i := 0; i < 10; i++ {
		go func(id int) {
			patterns := []string{"get", "gUBI", "User", "ById", "test"}
			texts := []string{"getUserById", "TestUser", "get_user_by_id"}

			for j := 0; j < 100; j++ {
				pattern := patterns[j%len(patterns)]
				text := texts[j%len(texts)]
				result := sm.Match(pattern, text)
				_ = result
			}
			done <- true
		}(i)
	}

	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestSmartMatcher_EdgeCases(t *testing.T) {
	sm := NewSmartMatcher()

	tests := []struct {
		name      string
		pattern   string
		text      string
		wantMatch bool
	}{
		{"empty pattern", "", "test", false},
		{"empty text", "test", "", false},
		{"both empty", "", "", false},
		{"pattern longer than text", "verylongpattern", "short", false},
		{"single char match", "a", "abc", true},
		{"single char no match", "x", "abc", false},
		{"whitespace in pattern", "get User", "getUserById", false},
		{"special chars", "get@user", "get@user", true},
		{"numbers only", "123", "test123", true},
		{"unicode normalization", "café", "café", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatch {
				t.Errorf("Match() matched = %v, want %v", result.Matched, tt.wantMatch)
			}
		})
	}
}

func TestSmartMatcher_RealWorldIdentifiers(t *testing.T) {
	sm := NewSmartMatcher()

	tests := []struct {
		pattern     string
		text        string
		wantMatched bool
	}{
		{"req", "Request", true},
		{"hreq", "HttpRequest", true},
		{"uvm", "UserViewModel", true},
		{"str", "StringBuilder", true},
		{"db", "DatabaseConnection", true},
		{"conn", "DatabaseConnection", true},
		{"isi", "isInitialized", true},
		{"onfcb", "onFileChangedCallback", true},
	}

	for _, tt := range tests {
		t.Run(tt.pattern+"_in_"+tt.text, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.wantMatched {
				t.Errorf("Match() matched = %v, want %v for %q in %q", result.Matched, tt.wantMatched, tt.pattern, tt.text)
			}
		})
	}
}

func TestSmartMatcher_PHPIdentifiers(t *testing.T) {
	sm := NewSmartMatcher()

	tests := []struct {
		pattern string
		text    string
		matches bool
	}{
		{"gAN", "getActiveNotifications", true},
		{"fud", "findUserById", true},
		{"iui", "isUserInitialized", true},
		{"hlr", "handleLoginRequest", true},
	}

	for _, tt := range tests {
		t.Run(tt.pattern, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.matches {
				t.Errorf("Match(%q, %q) matched = %v, want %v",
					tt.pattern, tt.text, result.Matched, tt.matches)
			}
		})
	}
}

func TestSmartMatcher_MultiLanguageIdentifiers(t *testing.T) {
	sm := NewSmartMatcher()

	tests := []struct {
		lang    string
		pattern string
		text    string
		matches bool
	}{
		{"Go", "gUBI", "GetUserByID", true},
		{"Go", "nc", "NewClient", true},
		{"Python", "gui", "get_user_info", true},
		{"Python", "isi", "is_session_initialized", true},
		{"Ruby", "fub", "find_user_by_email", true},
		{"TypeScript", "uvm", "UserViewModel", true},
		{"TypeScript", "ih", "IUserHandler", true},
		{"PHP", "$gu", "$getUserById", true},
		{"Rust", "rj", "read_json_file", true},
	}

	for _, tt := range tests {
		t.Run(tt.lang+"_"+tt.pattern, func(t *testing.T) {
			result := sm.Match(tt.pattern, tt.text)
			if result.Matched != tt.matches {
				t.Errorf("[%s] Match(%q, %q) matched = %v, want %v",
					tt.lang, tt.pattern, tt.text, result.Matched, tt.matches)
			}
		})
	}
}

func TestSmartMatcher_ScoreOrdering(t *testing.T) {
	sm := NewSmartMatcher()

	text := "getUserById"

	patterns := []struct {
		pattern  string
		minScore float64
	}{
		{"getUserById", 1.0},
		{"gUBI", 0.85},
		{"get", 0.76},
		{"gid", 0.7},
		{"xyz", 0.0},
	}

	var prevScore float64 = 1.1
	for _, tt := range patterns {
		result := sm.Match(tt.pattern, text)
		if tt.minScore > 0.0 && !result.Matched {
			t.Errorf("Match(%q) should match %q", tt.pattern, text)
			continue
		}
		if tt.minScore == 0.0 && result.Matched {
			t.Errorf("Match(%q) should NOT match %q", tt.pattern, text)
			continue
		}
		if !result.Matched {
			continue
		}
		if result.Score >= prevScore {
			t.Errorf("Match(%q) score = %v should be less than previous %v",
				tt.pattern, result.Score, prevScore)
		}
		if result.Score < tt.minScore {
			t.Errorf("Match(%q) score = %v should be >= %v",
				tt.pattern, result.Score, tt.minScore)
		}
		prevScore = result.Score
	}
}

func TestSmartMatcher_LongIdentifiers(t *testing.T) {
	sm := NewSmartMatcher()

	longText := strings.Repeat("VeryLongIdentifier", 10)
	pattern := "VLI"

	result := sm.Match(pattern, longText)
	if !result.Matched {
		t.Error("Should match word boundaries in long identifiers")
	}
	if result.Type != MatchWordBoundary {
		t.Errorf("Type = %v, want %v", result.Type, MatchWordBoundary)
	}
}

func TestSmartMatcher_PrefixRatioScoring(t *testing.T) {
	sm := NewSmartMatcher()

	routeResult := sm.Match("Rou", "Route")
	routerResult := sm.Match("Rou", "Router")
	routeProviderResult := sm.Match("Rou", "RouteServiceProvider")

	if !routeResult.Matched || !routerResult.Matched || !routeProviderResult.Matched {
		t.Fatal("All should match with prefix")
	}

	if routeResult.Score <= routerResult.Score {
		t.Errorf("Route score (%v) should be higher than Router score (%v)", routeResult.Score, routerResult.Score)
	}

	if routerResult.Score <= routeProviderResult.Score {
		t.Errorf("Router score (%v) should be higher than RouteServiceProvider score (%v)", routerResult.Score, routeProviderResult.Score)
	}

	t.Logf("Prefix ratio scores: Route=%v, Router=%v, RouteServiceProvider=%v",
		routeResult.Score, routerResult.Score, routeProviderResult.Score)
}

func TestSmartMatcher_GhostTextDifferentiation(t *testing.T) {
	sm := NewSmartMatcher()

	tests := []struct {
		prefix       string
		candidates   []string
		wantTopMatch string
	}{
		{"Rou", []string{"Route", "Router", "RouteGroup", "RouteServiceProvider"}, "Route"},
		{"pack", []string{"Package", "PackageManager", "PackageInfo"}, "Package"},
		{"Hand", []string{"Handler", "HandleRequest", "HandleError"}, "Handler"},
		{"Use", []string{"User", "UserService", "UserController", "UserRepository"}, "User"},
	}

	for _, tt := range tests {
		t.Run(tt.prefix, func(t *testing.T) {
			var topMatch string
			var topScore float64 = -1

			for _, candidate := range tt.candidates {
				result := sm.Match(tt.prefix, candidate)
				if result.Matched && result.Score > topScore {
					topScore = result.Score
					topMatch = candidate
				}
			}

			if topMatch != tt.wantTopMatch {
				t.Errorf("Top match for %q = %q, want %q (score=%v)", tt.prefix, topMatch, tt.wantTopMatch, topScore)
			}
		})
	}
}
