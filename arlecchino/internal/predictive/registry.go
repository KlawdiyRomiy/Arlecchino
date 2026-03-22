package predictive

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path/filepath"
	"strings"
	"sync"
)

//go:embed patterns/*.json
var embeddedPatterns embed.FS

type PatternRegistry struct {
	mu           sync.RWMutex
	patterns     map[string][]Pattern
	frameworkMap map[string][]string
	loader       *Loader
	pluginDirs   []string
	loadedFiles  map[string]bool
}

func NewPatternRegistry() *PatternRegistry {
	return &PatternRegistry{
		patterns:     make(map[string][]Pattern),
		frameworkMap: buildFrameworkMap(),
		loader:       NewLoader(),
		pluginDirs:   make([]string, 0),
		loadedFiles:  make(map[string]bool),
	}
}

func buildFrameworkMap() map[string][]string {
	return map[string][]string{
		"php":        {"laravel", "symfony", "wordpress"},
		"python":     {"django", "fastapi", "flask"},
		"typescript": {"react", "nextjs", "nestjs", "vue"},
		"javascript": {"react", "nextjs", "express", "vue"},
		"ruby":       {"rails", "sinatra"},
		"go":         {"gin", "fiber", "echo"},
		"vue":        {"nuxt"},
	}
}

func (r *PatternRegistry) LoadEmbedded() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return fs.WalkDir(embeddedPatterns, "patterns", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if d.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}

		data, err := embeddedPatterns.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read embedded file %s: %w", path, err)
		}

		patterns, lang, framework, err := r.parsePatternFile(data)
		if err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}

		r.storePatterns(lang, framework, patterns)
		r.loadedFiles[path] = true

		return nil
	})
}

func (r *PatternRegistry) LoadFromDir(dir string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	return filepath.Walk(dir, func(path string, info fs.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}

		if r.loadedFiles[path] {
			return nil
		}

		patterns, err := r.loader.LoadFile(path)
		if err != nil {
			return nil
		}

		if len(patterns) > 0 {
			lang := patterns[0].Language
			framework := patterns[0].Framework
			r.storePatterns(lang, framework, patterns)
			r.loadedFiles[path] = true
		}

		return nil
	})
}

func (r *PatternRegistry) AddPluginDir(dir string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pluginDirs = append(r.pluginDirs, dir)
}

func (r *PatternRegistry) LoadPlugins() error {
	for _, dir := range r.pluginDirs {
		if err := r.LoadFromDir(dir); err != nil {
			return err
		}
	}
	return nil
}

func (r *PatternRegistry) parsePatternFile(data []byte) ([]Pattern, string, string, error) {
	var file struct {
		Version   string `json:"version"`
		Name      string `json:"name"`
		Language  string `json:"language"`
		Framework string `json:"framework"`
		Patterns  []struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Description string `json:"description"`
			Language    string `json:"language"`
			Framework   string `json:"framework,omitempty"`
			Context     struct {
				FileTypes []string `json:"fileTypes,omitempty"`
				Positions []string `json:"positions,omitempty"`
			} `json:"context"`
			Trigger struct {
				Type  string `json:"type"`
				Value string `json:"value,omitempty"`
			} `json:"trigger"`
			Template   string `json:"template,omitempty"`
			Generator  string `json:"generator,omitempty"`
			Priority   int    `json:"priority"`
			Builtin    bool   `json:"builtin"`
			IsSkeleton bool   `json:"isSkeleton,omitempty"`
		} `json:"patterns"`
	}

	if err := json.Unmarshal(data, &file); err != nil {
		return nil, "", "", err
	}

	patterns := make([]Pattern, 0, len(file.Patterns))

	for _, p := range file.Patterns {
		lang := p.Language
		if lang == "" {
			lang = file.Language
		}

		fw := p.Framework
		if fw == "" {
			fw = file.Framework
		}

		pattern := Pattern{
			ID:          p.ID,
			Name:        p.Name,
			Description: p.Description,
			Language:    lang,
			Framework:   fw,
			Template:    p.Template,
			Generator:   p.Generator,
			Priority:    p.Priority,
			Builtin:     p.Builtin,
			IsSkeleton:  p.IsSkeleton,
			Context: PatternContext{
				FileTypes: p.Context.FileTypes,
				Positions: r.normalizePositions(p.Context.Positions),
			},
			Trigger: PatternTrigger{
				Type:  r.normalizeTriggerType(p.Trigger.Type),
				Value: p.Trigger.Value,
			},
		}

		patterns = append(patterns, pattern)
	}

	return patterns, file.Language, file.Framework, nil
}

func (r *PatternRegistry) normalizePositions(positions []string) []string {
	result := make([]string, 0, len(positions))
	for _, p := range positions {
		switch strings.ToLower(p) {
		case "file_start":
			result = append(result, string(PositionContextFileStart))
		case "after_imports":
			result = append(result, string(PositionContextAfterImports))
		case "top_level":
			result = append(result, string(PositionContextTopLevel))
		case "class_body":
			result = append(result, string(PositionContextClassBody))
		case "method_body":
			result = append(result, string(PositionContextMethodBody))
		case "method_params":
			result = append(result, string(PositionContextMethodParams))
		default:
			result = append(result, p)
		}
	}
	return result
}

func (r *PatternRegistry) normalizeTriggerType(t string) TriggerType {
	switch strings.ToLower(t) {
	case "empty":
		return TriggerTypeEmpty
	case "text":
		return TriggerTypeText
	case "regex":
		return TriggerTypeRegex
	case "newline":
		return TriggerTypeNewLine
	case "always":
		return TriggerTypeAlways
	default:
		return TriggerTypeAlways
	}
}

func (r *PatternRegistry) storePatterns(lang, framework string, patterns []Pattern) {
	key := r.makeKey(lang, framework)
	r.patterns[key] = append(r.patterns[key], patterns...)

	if lang != "*" && framework == "" {
		r.patterns[lang] = append(r.patterns[lang], patterns...)
	}
}

func (r *PatternRegistry) makeKey(lang, framework string) string {
	if framework == "" {
		return lang
	}
	return lang + "_" + framework
}

func (r *PatternRegistry) GetPatterns(lang, framework string) []Pattern {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []Pattern

	if common, ok := r.patterns["*"]; ok {
		result = append(result, common...)
	}

	if langPatterns, ok := r.patterns[lang]; ok {
		result = append(result, langPatterns...)
	}

	if framework != "" {
		key := r.makeKey(lang, framework)
		if fwPatterns, ok := r.patterns[key]; ok {
			result = append(result, fwPatterns...)
		}
	}

	return result
}

func (r *PatternRegistry) GetPatternsForContext(ctx FileContext) []Pattern {
	patterns := r.GetPatterns(ctx.Language, ctx.Framework)

	filtered := make([]Pattern, 0, len(patterns))
	for _, p := range patterns {
		if r.matchesContext(p, ctx) {
			filtered = append(filtered, p)
		}
	}

	return filtered
}

func (r *PatternRegistry) matchesContext(p Pattern, ctx FileContext) bool {
	if len(p.Context.FileTypes) > 0 {
		found := false
		for _, ft := range p.Context.FileTypes {
			if ft == string(ctx.FileType) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	if len(p.Context.Positions) > 0 {
		found := false
		for _, pos := range p.Context.Positions {
			if pos == string(ctx.Position.Context) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	return true
}

func (r *PatternRegistry) RegisterPattern(p Pattern) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.storePatterns(p.Language, p.Framework, []Pattern{p})
}

func (r *PatternRegistry) GetSupportedLanguages() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	seen := make(map[string]bool)
	var languages []string

	for key := range r.patterns {
		if key == "*" {
			continue
		}
		lang := strings.Split(key, "_")[0]
		if !seen[lang] {
			seen[lang] = true
			languages = append(languages, lang)
		}
	}

	return languages
}

func (r *PatternRegistry) GetFrameworksForLanguage(lang string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if frameworks, ok := r.frameworkMap[lang]; ok {
		return frameworks
	}
	return nil
}

func (r *PatternRegistry) Stats() map[string]int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	stats := make(map[string]int)
	for key, patterns := range r.patterns {
		stats[key] = len(patterns)
	}
	return stats
}

func (r *PatternRegistry) LoadGenerated() {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, p := range generatedPatterns {
		r.storePatterns(p.Language, p.Framework, []Pattern{p})
	}
}
