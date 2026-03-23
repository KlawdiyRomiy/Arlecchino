package brain

import (
	"strings"

	"arlecchino/internal/indexer/core"
)

type StringCompletionProvider struct {
	engine    *core.Engine
	inventory *InventoryProvider
}

func NewStringCompletionProvider(engine *core.Engine) *StringCompletionProvider {
	return &StringCompletionProvider{
		engine:    engine,
		inventory: NewInventoryProvider(engine),
	}
}

func (p *StringCompletionProvider) GetCompletions(ctx CompletionContext) []Suggestion {
	if !ctx.InString || ctx.StringContextType == "" {
		return nil
	}

	switch ctx.StringContextType {
	case "route":
		return p.getRouteCompletions(ctx)
	case "view":
		return p.getViewCompletions(ctx)
	case "config":
		return p.getConfigCompletions(ctx)
	case "path":
		return p.getPathCompletions(ctx)
	case "import":
		return p.getImportStringCompletions(ctx)
	case "trans":
		return p.getTranslationCompletions(ctx)
	}

	return nil
}

func (p *StringCompletionProvider) getRouteCompletions(ctx CompletionContext) []Suggestion {
	if p.engine == nil {
		return nil
	}

	query := core.SymbolQuery{
		Kind:     core.SymbolKindRoute,
		Language: ctx.Language,
		Limit:    50,
	}

	symbols, err := p.engine.Query(query)
	if err != nil {
		return nil
	}

	var suggestions []Suggestion
	prefix := strings.ToLower(ctx.StringValue)

	for _, sym := range symbols {
		nameLower := strings.ToLower(sym.Name)
		if prefix != "" && !strings.HasPrefix(nameLower, prefix) && !strings.Contains(nameLower, prefix) {
			continue
		}

		suggestions = append(suggestions, Suggestion{
			Text:        sym.Name,
			DisplayText: sym.Name,
			Kind:        core.SymbolKindRoute,
			Source:      core.SourceIndex,
			Score:       0.9,
			Detail:      sym.Signature,
			FilePath:    sym.FilePath,
			Line:        sym.Line,
			InsertText:  sym.Name,
		})
	}

	return suggestions
}

func (p *StringCompletionProvider) getViewCompletions(ctx CompletionContext) []Suggestion {
	if p.engine == nil {
		return nil
	}

	query := core.SymbolQuery{
		Kind:     core.SymbolKindView,
		Language: ctx.Language,
		Limit:    50,
	}

	symbols, err := p.engine.Query(query)
	if err != nil {
		return nil
	}

	var suggestions []Suggestion
	prefix := strings.ToLower(ctx.StringValue)

	for _, sym := range symbols {
		nameLower := strings.ToLower(sym.Name)
		if prefix != "" && !strings.HasPrefix(nameLower, prefix) && !strings.Contains(nameLower, prefix) {
			continue
		}

		suggestions = append(suggestions, Suggestion{
			Text:        sym.Name,
			DisplayText: sym.Name,
			Kind:        core.SymbolKindView,
			Source:      core.SourceIndex,
			Score:       0.9,
			Detail:      sym.FilePath,
			FilePath:    sym.FilePath,
			Line:        sym.Line,
			InsertText:  sym.Name,
		})
	}

	return suggestions
}

func (p *StringCompletionProvider) getConfigCompletions(ctx CompletionContext) []Suggestion {
	if p.engine == nil {
		return nil
	}

	query := core.SymbolQuery{
		Kind:     core.SymbolKindConfig,
		Language: ctx.Language,
		Limit:    50,
	}

	symbols, err := p.engine.Query(query)
	if err != nil {
		return nil
	}

	var suggestions []Suggestion
	prefix := strings.ToLower(ctx.StringValue)

	for _, sym := range symbols {
		nameLower := strings.ToLower(sym.Name)
		if prefix != "" && !strings.HasPrefix(nameLower, prefix) && !strings.Contains(nameLower, prefix) {
			continue
		}

		suggestions = append(suggestions, Suggestion{
			Text:        sym.Name,
			DisplayText: sym.Name,
			Kind:        core.SymbolKindConfig,
			Source:      core.SourceIndex,
			Score:       0.9,
			Detail:      sym.Signature,
			FilePath:    sym.FilePath,
			Line:        sym.Line,
			InsertText:  sym.Name,
		})
	}

	return suggestions
}

func (p *StringCompletionProvider) getPathCompletions(ctx CompletionContext) []Suggestion {
	if p.inventory == nil {
		return nil
	}
	return p.inventory.GetPathCompletions(ctx)
}

func (p *StringCompletionProvider) getImportStringCompletions(ctx CompletionContext) []Suggestion {
	if p.engine == nil {
		return nil
	}

	var suggestions []Suggestion
	prefix := strings.ToLower(ctx.StringValue)

	switch ctx.Language {
	case "go":
		query := core.SymbolQuery{
			Kind:     core.SymbolKindPackage,
			Language: "go",
			Limit:    50,
		}
		symbols, err := p.engine.Query(query)
		if err == nil {
			for _, sym := range symbols {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(sym.Name), prefix) {
					continue
				}
				suggestions = append(suggestions, Suggestion{
					Text:        sym.Name,
					DisplayText: sym.Name,
					Kind:        core.SymbolKindPackage,
					Source:      core.SourceIndex,
					Score:       0.9,
					Detail:      sym.Namespace,
					InsertText:  sym.Name,
				})
			}
		}

	case "typescript", "javascript":
		query := core.SymbolQuery{
			Kind:     core.SymbolKindModule,
			Language: ctx.Language,
			Limit:    50,
		}
		symbols, err := p.engine.Query(query)
		if err == nil {
			for _, sym := range symbols {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(sym.Name), prefix) {
					continue
				}
				suggestions = append(suggestions, Suggestion{
					Text:        sym.Name,
					DisplayText: sym.Name,
					Kind:        core.SymbolKindModule,
					Source:      core.SourceIndex,
					Score:       0.9,
					Detail:      sym.FilePath,
					InsertText:  sym.Name,
				})
			}
		}

	case "python":
		query := core.SymbolQuery{
			Kind:     core.SymbolKindModule,
			Language: "python",
			Limit:    50,
		}
		symbols, err := p.engine.Query(query)
		if err == nil {
			for _, sym := range symbols {
				if prefix != "" && !strings.HasPrefix(strings.ToLower(sym.Name), prefix) {
					continue
				}
				suggestions = append(suggestions, Suggestion{
					Text:        sym.Name,
					DisplayText: sym.Name,
					Kind:        core.SymbolKindModule,
					Source:      core.SourceIndex,
					Score:       0.9,
					Detail:      sym.Namespace,
					InsertText:  sym.Name,
				})
			}
		}
	}

	return suggestions
}

func (p *StringCompletionProvider) getTranslationCompletions(ctx CompletionContext) []Suggestion {
	return nil
}
