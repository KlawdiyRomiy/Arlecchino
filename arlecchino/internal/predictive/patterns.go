package predictive

import (
	"regexp"
	"sort"
	"strings"
)

type PatternMatcher struct {
	patterns []*Pattern
	byLang   map[string][]*Pattern
	byFrame  map[string][]*Pattern
}

func NewPatternMatcher() *PatternMatcher {
	return &PatternMatcher{
		patterns: make([]*Pattern, 0, 128),
		byLang:   make(map[string][]*Pattern),
		byFrame:  make(map[string][]*Pattern),
	}
}

// Register adds a pattern to the matcher
func (pm *PatternMatcher) Register(p *Pattern) {
	pm.patterns = append(pm.patterns, p)

	// Index by language
	if p.Language != "" && p.Language != "*" {
		pm.byLang[p.Language] = append(pm.byLang[p.Language], p)
	}

	// Index by framework
	if p.Framework != "" && p.Framework != "*" {
		pm.byFrame[p.Framework] = append(pm.byFrame[p.Framework], p)
	}
}

// RegisterAll adds multiple patterns
func (pm *PatternMatcher) RegisterAll(patterns []*Pattern) {
	for _, p := range patterns {
		pm.Register(p)
	}
}

// Match finds patterns matching the given context
func (pm *PatternMatcher) Match(ctx *FileContext) []*Pattern {
	var candidates []*Pattern

	// Get language-specific patterns
	if langPatterns, ok := pm.byLang[ctx.Language]; ok {
		candidates = append(candidates, langPatterns...)
	}

	// Get framework-specific patterns
	if ctx.Framework != "" {
		if framePatterns, ok := pm.byFrame[ctx.Framework]; ok {
			candidates = append(candidates, framePatterns...)
		}
	}

	// Add universal patterns (language = "*")
	if universalPatterns, ok := pm.byLang["*"]; ok {
		candidates = append(candidates, universalPatterns...)
	}

	// Filter by context match
	var matched []*Pattern
	for _, p := range candidates {
		if pm.matchesContext(p, ctx) && pm.matchesTrigger(p, ctx) {
			matched = append(matched, p)
		}
	}

	// Sort by priority (highest first)
	sort.Slice(matched, func(i, j int) bool {
		return matched[i].Priority > matched[j].Priority
	})

	return matched
}

// matchesContext checks if pattern context matches file context
func (pm *PatternMatcher) matchesContext(p *Pattern, ctx *FileContext) bool {
	pc := p.Context

	if len(pc.FileTypes) > 0 {
		found := false
		for _, ft := range pc.FileTypes {
			if FileType(ft) == ctx.FileType {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	} else if pc.FileType != "" && pc.FileType != FileTypeUnknown {
		if ctx.FileType != pc.FileType {
			return false
		}
	}

	if pc.Position != "" && pc.Position != PositionContextUnknown {
		if ctx.Position.Context != pc.Position {
			return false
		}
	}

	if len(pc.Positions) > 0 {
		found := false
		for _, pos := range pc.Positions {
			if PositionContext(pos) == ctx.Position.Context {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// If pattern requires class_body position, verify we're actually in a class
	if pc.Position == PositionContextClassBody && ctx.ClassName == "" && !ctx.Position.InClass {
		return false
	}

	// Check extends
	if pc.Extends != "" {
		if ctx.ClassParent != pc.Extends && !strings.HasSuffix(ctx.ClassParent, pc.Extends) {
			return false
		}
	}

	// Check implements
	if len(pc.Implements) > 0 {
		found := false
		for _, impl := range pc.Implements {
			for _, trait := range ctx.ClassTraits {
				if strings.Contains(trait, impl) {
					found = true
					break
				}
			}
		}
		if !found {
			return false
		}
	}

	// Check trait
	if pc.HasTrait != "" {
		found := false
		for _, t := range ctx.ClassTraits {
			if strings.Contains(t, pc.HasTrait) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Check in method
	if pc.InMethod != "" {
		if ctx.Position.MethodName != pc.InMethod {
			return false
		}
	}

	return true
}

// matchesTrigger checks if pattern trigger matches current state
func (pm *PatternMatcher) matchesTrigger(p *Pattern, ctx *FileContext) bool {
	trigger := p.Trigger

	if p.IsSkeleton {
		validPositions := map[PositionContext]bool{
			PositionContextFileStart:    true,
			PositionContextAfterImports: true,
			PositionContextTopLevel:     true,
			PositionContextClassBody:    true,
		}
		if !validPositions[ctx.Position.Context] {
			return false
		}
	}

	switch trigger.Type {
	case TriggerTypeEmpty:
		return ctx.IsEmpty || (ctx.Position.Context == PositionContextClassBody && ctx.ClassName != "")

	case TriggerTypeAlways:
		if p.Context.Position != "" && p.Context.Position != PositionContextUnknown {
			return ctx.Position.Context == p.Context.Position
		}
		return true

	case TriggerTypeNewLine:
		return true

	case TriggerTypeText:
		return true

	case TriggerTypeRegex:
		if trigger.Value != "" {
			return true
		}

	case TriggerTypePrefix:
		if trigger.Value == "" {
			return true
		}
		return strings.HasPrefix(strings.ToLower(ctx.TypedPrefix), strings.ToLower(trigger.Value))

	case TriggerTypeContext:
		return pm.matchesContextRule(p, ctx, trigger.Value)
	}

	return true
}

func (pm *PatternMatcher) matchesContextRule(p *Pattern, ctx *FileContext, rule string) bool {
	switch rule {
	case "empty_class":
		return ctx.Position.Context == PositionContextClassBody && ctx.IsEmpty
	case "has_constructor":
		return ctx.Position.InClass && ctx.Position.MethodName == "__construct"
	case "in_class":
		return ctx.Position.InClass
	default:
		return true
	}
}

func (pm *PatternMatcher) GetPatternByID(id string) *Pattern {
	for _, p := range pm.patterns {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// AllPatterns returns all registered patterns
func (pm *PatternMatcher) AllPatterns() []*Pattern {
	return pm.patterns
}

// PatternCount returns total number of patterns
func (pm *PatternMatcher) PatternCount() int {
	return len(pm.patterns)
}

// Filter patterns by regex on context text
func matchRegex(pattern, text string) bool {
	if pattern == "" || text == "" {
		return false
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return false
	}
	return re.MatchString(text)
}
