package predictive

import (
	"testing"
)

func TestPatternMatcher_MatchLanguage(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	ctx := &FileContext{
		Language:  "php",
		Framework: "laravel",
		FileType:  FileTypeController,
		IsEmpty:   true,
		Position: Position{
			Context: PositionContextFileStart,
		},
	}

	patterns := matcher.Match(ctx)

	phpCount := 0
	for _, p := range patterns {
		if p.Language == "php" || p.Language == "*" {
			phpCount++
		}
	}

	if phpCount == 0 {
		t.Error("Expected at least one PHP pattern")
	}
}

func TestPatternMatcher_MatchFramework(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	ctx := &FileContext{
		Language:  "php",
		Framework: "laravel",
		FileType:  FileTypeController,
		IsEmpty:   true,
		Position: Position{
			Context: PositionContextFileStart,
		},
	}

	patterns := matcher.Match(ctx)

	laravelCount := 0
	for _, p := range patterns {
		if p.Framework == "laravel" || p.Framework == "*" || p.Framework == "" {
			laravelCount++
		}
	}

	if laravelCount == 0 {
		t.Error("Expected at least one Laravel pattern")
	}
}

func TestPatternMatcher_MatchFileType(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	tests := []struct {
		name     string
		fileType FileType
		wantMin  int
	}{
		{"Controller patterns", FileTypeController, 1},
		{"Model patterns", FileTypeModel, 1},
		{"Test patterns", FileTypeTest, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := &FileContext{
				Language:  "php",
				Framework: "laravel",
				FileType:  tt.fileType,
				IsEmpty:   true,
				Position: Position{
					Context: PositionContextClassBody,
				},
			}

			patterns := matcher.Match(ctx)
			if len(patterns) < tt.wantMin {
				t.Errorf("Got %d patterns, want at least %d", len(patterns), tt.wantMin)
			}
		})
	}
}

func TestPatternMatcher_Priority(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	ctx := &FileContext{
		Language:  "php",
		Framework: "laravel",
		FileType:  FileTypeController,
		IsEmpty:   true,
		Position: Position{
			Context: PositionContextClassBody,
		},
	}

	patterns := matcher.Match(ctx)

	if len(patterns) < 2 {
		t.Skip("Not enough patterns to test priority")
	}

	for i := 1; i < len(patterns); i++ {
		if patterns[i-1].Priority < patterns[i].Priority {
			t.Errorf("Patterns not sorted by priority: %d < %d",
				patterns[i-1].Priority, patterns[i].Priority)
		}
	}
}

func TestPatternMatcher_AddCustomPattern(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	customPattern := &Pattern{
		ID:          "custom-test-pattern",
		Name:        "Custom Test",
		Description: "A custom test pattern",
		Template:    "// custom code here",
		Language:    "php",
		Framework:   "",
		Trigger:     PatternTrigger{Type: TriggerTypeEmpty},
		Priority:    100,
	}

	matcher.Register(customPattern)

	ctx := &FileContext{
		Language: "php",
		IsEmpty:  true,
	}

	patterns := matcher.Match(ctx)

	found := false
	for _, p := range patterns {
		if p.ID == "custom-test-pattern" {
			found = true
			break
		}
	}

	if !found {
		t.Error("Custom pattern not found in matches")
	}
}

func TestPatternMatcher_BuiltinCount(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	if len(matcher.patterns) < 10 {
		t.Errorf("Expected at least 10 builtin patterns, got %d", len(matcher.patterns))
	}
}

func TestPatternMatcher_MultiLanguage(t *testing.T) {
	engine := NewEngine()
	matcher := engine.GetMatcher()

	languages := []string{"php", "go", "typescript", "python"}

	for _, lang := range languages {
		t.Run(lang, func(t *testing.T) {
			found := false
			for _, p := range matcher.patterns {
				if p.Language == lang || p.Language == "*" {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("No registered patterns for language %s", lang)
			}
		})
	}
}

func TestPatternRegistry_LoadEmbedded(t *testing.T) {
	registry := NewPatternRegistry()
	if err := registry.LoadEmbedded(); err != nil {
		t.Fatalf("Failed to load embedded patterns: %v", err)
	}

	stats := registry.Stats()
	if len(stats) == 0 {
		t.Error("No patterns loaded from embedded files")
	}

	languages := registry.GetSupportedLanguages()
	if len(languages) < 4 {
		t.Errorf("Expected at least 4 languages, got %d: %v", len(languages), languages)
	}
}

func TestPatternRegistry_GetPatterns(t *testing.T) {
	registry := NewPatternRegistry()
	if err := registry.LoadEmbedded(); err != nil {
		t.Fatalf("Failed to load embedded patterns: %v", err)
	}

	tests := []struct {
		lang      string
		framework string
		wantMin   int
	}{
		{"php", "", 5},
		{"php", "laravel", 5},
		{"python", "", 5},
		{"go", "", 5},
		{"typescript", "", 5},
	}

	for _, tt := range tests {
		name := tt.lang
		if tt.framework != "" {
			name += "_" + tt.framework
		}
		t.Run(name, func(t *testing.T) {
			patterns := registry.GetPatterns(tt.lang, tt.framework)
			if len(patterns) < tt.wantMin {
				t.Errorf("Got %d patterns for %s/%s, want at least %d",
					len(patterns), tt.lang, tt.framework, tt.wantMin)
			}
		})
	}
}
