package brain

import (
	"testing"
	"time"

	"arlecchino/internal/indexer/core"
)

func TestFilterModel_Predict(t *testing.T) {
	model := NewFilterModel()

	tests := []struct {
		name     string
		features FilterFeatures
		wantMin  float64
		wantMax  float64
	}{
		{
			name: "high confidence suggestion",
			features: FilterFeatures{
				PrefixLength:     4,
				CompletionLength: 10,
				GapPercentage:    0.5,
				Source:           core.SourceLSP,
				MatchScore:       0.9,
				Confidence:       0.8,
				Language:         "go",
				AcceptanceRate:   0.4,
			},
			wantMin: 0.7,
			wantMax: 1.0,
		},
		{
			name: "low confidence suggestion",
			features: FilterFeatures{
				PrefixLength:     1,
				CompletionLength: 50,
				GapPercentage:    0.05,
				Source:           core.SourceVirtual,
				MatchScore:       0.3,
				Confidence:       0.2,
				Language:         "unknown",
				AcceptanceRate:   0.05,
			},
			wantMin: 0.3,
			wantMax: 0.6,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			score := model.Predict(tt.features)
			if score < tt.wantMin || score > tt.wantMax {
				t.Errorf("Predict() = %v, want [%v, %v]", score, tt.wantMin, tt.wantMax)
			}
		})
	}
}

func TestFilterModel_ShouldShow(t *testing.T) {
	model := NewFilterModel()

	goodFeatures := FilterFeatures{
		PrefixLength:     3,
		CompletionLength: 15,
		GapPercentage:    0.4,
		Source:           core.SourceLSP,
		MatchScore:       0.85,
		Confidence:       0.7,
		Language:         "typescript",
		AcceptanceRate:   0.35,
	}

	if !model.ShouldShow(goodFeatures) {
		t.Error("expected ShouldShow=true for good features")
	}

	badFeatures := FilterFeatures{
		PrefixLength:     0,
		CompletionLength: 100,
		GapPercentage:    0.0,
		Source:           core.SourceVirtual,
		MatchScore:       0.0,
		Confidence:       0.0,
		Language:         "unknown",
		AcceptanceRate:   0.0,
	}

	score := model.Predict(badFeatures)
	if score > 0.6 {
		t.Errorf("expected lower score for bad features, got %v", score)
	}
}

func TestGhostTextFilter_ShouldShowGhost(t *testing.T) {
	filter := NewGhostTextFilter()

	suggestions := []Suggestion{
		{Text: "fmt.Println", Score: 0.9, Source: core.SourceLSP, Confidence: 0.8},
		{Text: "fmt.Printf", Score: 0.5, Source: core.SourceLSP, Confidence: 0.6},
	}

	if !filter.ShouldShowGhost(GhostFilterContext{
		Prefix:       "fmt",
		Language:     "go",
		Suggestions:  suggestions,
		Now:          time.Now(),
		ActiveMaxLen: 24,
		IdleMaxLen:   120,
		ActiveMinGap: 0.15,
		IdleMinGap:   0.08,
		ActiveTokens: 5,
		IdleTokens:   24,
	}) {
		t.Error("expected ghost to show for good suggestions with gap")
	}

	noGapSuggestions := []Suggestion{
		{Text: "one", Score: 0.5, Source: core.SourceIndex},
		{Text: "two", Score: 0.49, Source: core.SourceIndex},
	}

	if filter.ShouldShowGhost(GhostFilterContext{
		Prefix:       "o",
		Language:     "go",
		Suggestions:  noGapSuggestions,
		Now:          time.Now(),
		ActiveMaxLen: 24,
		IdleMaxLen:   120,
		ActiveMinGap: 0.15,
		IdleMinGap:   0.08,
		ActiveTokens: 5,
		IdleTokens:   24,
	}) {
		t.Error("expected no ghost for suggestions without gap")
	}

	if filter.ShouldShowGhost(GhostFilterContext{
		Prefix:       "test",
		Language:     "go",
		Suggestions:  nil,
		Now:          time.Now(),
		ActiveMaxLen: 24,
		IdleMaxLen:   120,
		ActiveMinGap: 0.15,
		IdleMinGap:   0.08,
		ActiveTokens: 5,
		IdleTokens:   24,
	}) {
		t.Error("expected no ghost for empty suggestions")
	}
}

func TestUserBehavior_TypingSpeed(t *testing.T) {
	ub := NewUserBehavior()

	for i := 0; i < 10; i++ {
		ub.RecordTyping(5)
		time.Sleep(10 * time.Millisecond)
	}

	speed := ub.GetTypingSpeed()
	if speed <= 0 {
		t.Errorf("expected positive typing speed, got %v", speed)
	}
}

func TestUserBehavior_AcceptanceRate(t *testing.T) {
	ub := NewUserBehavior()

	for i := 0; i < 10; i++ {
		ub.RecordShown()
	}

	for i := 0; i < 4; i++ {
		ub.RecordAccepted("symbol" + string(rune('0'+i)))
	}

	rate := ub.GetAcceptanceRate()
	if rate < 0.35 || rate > 0.45 {
		t.Errorf("expected acceptance rate ~0.4, got %v", rate)
	}
}

func TestUserBehavior_AdjustThreshold(t *testing.T) {
	ub := NewUserBehavior()

	base := 0.5

	for i := 0; i < 10; i++ {
		ub.RecordShown()
	}
	for i := 0; i < 5; i++ {
		ub.RecordAccepted("sym")
	}

	adjusted := ub.AdjustThreshold(base)
	if adjusted >= base {
		t.Errorf("expected lower threshold for high acceptance, got %v vs %v", adjusted, base)
	}

	ub.Reset()
	for i := 0; i < 100; i++ {
		ub.RecordShown()
	}
	ub.RecordAccepted("one")

	adjusted = ub.AdjustThreshold(base)
	if adjusted <= base {
		t.Errorf("expected higher threshold for low acceptance, got %v vs %v", adjusted, base)
	}
}

func TestUserBehavior_SessionSymbols(t *testing.T) {
	ub := NewUserBehavior()

	ub.RecordAccepted("first")
	ub.RecordAccepted("second")
	ub.RecordAccepted("third")

	symbols := ub.GetSessionSymbols()
	if len(symbols) != 3 {
		t.Errorf("expected 3 symbols, got %d", len(symbols))
	}

	if symbols[0] != "third" {
		t.Errorf("expected 'third' as first (most recent), got %s", symbols[0])
	}

	ub.RecordAccepted("first")
	symbols = ub.GetSessionSymbols()
	if symbols[0] != "first" {
		t.Errorf("expected 'first' moved to front, got %s", symbols[0])
	}
}
