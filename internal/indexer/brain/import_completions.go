package brain

import (
	"strings"

	"arlecchino/internal/indexer/core"
)

type ImportCompletionProvider struct {
	engine      *core.Engine
	projectRoot string
	catalog     *dependencyCatalog
}

func NewImportCompletionProvider(engine *core.Engine) *ImportCompletionProvider {
	root := ""
	if engine != nil {
		root = engine.ProjectRoot()
	}
	return &ImportCompletionProvider{
		engine:      engine,
		projectRoot: root,
		catalog:     NewDependencyCatalog(root),
	}
}

func (p *ImportCompletionProvider) GetCompletions(ctx CompletionContext) []Suggestion {
	if !ctx.InImport {
		return nil
	}

	suggestions := p.dynamicDependencyCompletions(ctx)

	switch ctx.Language {
	case "go":
		suggestions = append(suggestions, p.getGoProjectPackageCompletions(ctx)...)
	case "php":
		suggestions = append(suggestions, p.getPHPNamespaceCompletions(ctx)...)
	}

	return dedupeImportSuggestions(suggestions)
}

func (p *ImportCompletionProvider) dynamicDependencyCompletions(ctx CompletionContext) []Suggestion {
	if p.catalog == nil {
		return nil
	}
	return p.catalog.Suggestions(ctx.Language, ctx.Prefix)
}

func (p *ImportCompletionProvider) getGoProjectPackageCompletions(ctx CompletionContext) []Suggestion {
	if p.engine == nil {
		return nil
	}

	prefix := strings.ToLower(ctx.Prefix)
	suggestions := make([]Suggestion, 0, 16)
	if p.engine != nil {
		query := core.SymbolQuery{
			Kind:     core.SymbolKindPackage,
			Language: "go",
			Limit:    30,
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
					Score:       0.85,
					Detail:      sym.Namespace,
					InsertText:  quoteImportLiteral(sym.Namespace, ctx.Language),
				})
			}
		}
	}

	return suggestions
}

func (p *ImportCompletionProvider) getPHPNamespaceCompletions(ctx CompletionContext) []Suggestion {
	if p.engine == nil {
		return nil
	}

	var suggestions []Suggestion
	prefix := strings.ToLower(ctx.Prefix)

	query := core.SymbolQuery{
		Language: "php",
		Limit:    50,
	}

	symbols, err := p.engine.Query(query)
	if err != nil {
		return nil
	}

	seenNS := make(map[string]bool)
	for _, sym := range symbols {
		if sym.Namespace == "" {
			continue
		}

		ns := sym.Namespace
		if seenNS[ns] {
			continue
		}

		if prefix != "" && !strings.HasPrefix(strings.ToLower(ns), prefix) && !strings.Contains(strings.ToLower(ns), prefix) {
			continue
		}

		seenNS[ns] = true
		suggestions = append(suggestions, Suggestion{
			Text:        ns,
			DisplayText: ns,
			Kind:        core.SymbolKindNamespace,
			Source:      core.SourceIndex,
			Score:       0.85,
			Detail:      "namespace",
			InsertText:  ns,
		})
	}

	return suggestions
}

func dedupeImportSuggestions(suggestions []Suggestion) []Suggestion {
	if len(suggestions) == 0 {
		return nil
	}
	best := make(map[string]Suggestion, len(suggestions))
	for _, suggestion := range suggestions {
		if suggestion.Text == "" {
			continue
		}
		existing, ok := best[suggestion.Text]
		if !ok || suggestion.Score > existing.Score || (suggestion.Score == existing.Score && dependencySourcePriority(suggestion.Source) > dependencySourcePriority(existing.Source)) {
			best[suggestion.Text] = suggestion
		}
	}
	result := make([]Suggestion, 0, len(best))
	for _, suggestion := range best {
		result = append(result, suggestion)
	}
	return result
}
