package brain

import (
	"os"
	"path/filepath"
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
	case "typescript", "javascript", "typescriptreact", "javascriptreact", "vue", "svelte", "astro", "css", "scss", "sass", "less":
		suggestions = append(suggestions, p.getInstalledNodeModuleCompletions(ctx)...)
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

func (p *ImportCompletionProvider) getInstalledNodeModuleCompletions(ctx CompletionContext) []Suggestion {
	if p.projectRoot == "" {
		return nil
	}

	prefix := strings.ToLower(ctx.Prefix)
	nodeModulesPath := filepath.Join(p.projectRoot, "node_modules")
	entries, err := os.ReadDir(nodeModulesPath)
	if err != nil {
		return nil
	}

	suggestions := make([]Suggestion, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, "@") {
			scopedPath := filepath.Join(nodeModulesPath, name)
			scopedEntries, err := os.ReadDir(scopedPath)
			if err != nil {
				continue
			}
			for _, scopedEntry := range scopedEntries {
				if !scopedEntry.IsDir() {
					continue
				}
				fullName := name + "/" + scopedEntry.Name()
				if prefix != "" && !strings.HasPrefix(strings.ToLower(fullName), prefix) && !strings.Contains(strings.ToLower(fullName), prefix) {
					continue
				}
				suggestions = append(suggestions, Suggestion{Text: fullName, DisplayText: fullName, Kind: core.SymbolKindModule, Source: core.SourceLocal, Score: 0.88, Detail: "installed package", InsertText: quoteImportLiteral(fullName, ctx.Language)})
			}
			continue
		}
		if prefix != "" && !strings.HasPrefix(strings.ToLower(name), prefix) && !strings.Contains(strings.ToLower(name), prefix) {
			continue
		}
		suggestions = append(suggestions, Suggestion{Text: name, DisplayText: name, Kind: core.SymbolKindModule, Source: core.SourceLocal, Score: 0.88, Detail: "installed package", InsertText: quoteImportLiteral(name, ctx.Language)})
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
