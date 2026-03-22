package brain

import (
	"arlecchino/internal/indexer/core"
)

type AutocompleteAdapter struct {
	brain *PredictionBrain
}

func NewAutocompleteAdapter(brain *PredictionBrain) *AutocompleteAdapter {
	return &AutocompleteAdapter{brain: brain}
}

func (a *AutocompleteAdapter) Complete(filePath string, content []byte, line, column int, prefix, language, triggerChar string) []AdapterCompletion {
	ctx := CompletionContext{
		FilePath:    filePath,
		Content:     content,
		Line:        line,
		Column:      column,
		Prefix:      prefix,
		Language:    language,
		TriggerChar: triggerChar,
	}

	suggestions := a.brain.Complete(ctx)
	result := make([]AdapterCompletion, 0, len(suggestions))

	for _, s := range suggestions {
		result = append(result, AdapterCompletion{
			Label:      s.DisplayText,
			Text:       s.Text,
			InsertText: s.InsertText,
			Kind:       a.mapKind(s.Kind),
			Detail:     s.Detail,
			Score:      s.Score,
			Source:     string(s.Source),
			FilePath:   s.FilePath,
			Line:       s.Line,
			IsSnippet:  s.Snippet != "",
			Snippet:    s.Snippet,
			Extra:      s.Extra,
		})
	}

	return result
}

func (a *AutocompleteAdapter) RecordUsage(text, filePath string) {
	a.brain.RecordUsage(text, filePath)
}

type AdapterCompletion struct {
	Label      string
	Text       string
	InsertText string
	Kind       int
	Detail     string
	Score      float64
	Source     string
	FilePath   string
	Line       int
	IsSnippet  bool
	Snippet    string
	Extra      map[string]string
}

func (a *AutocompleteAdapter) mapKind(kind core.SymbolKind) int {
	kindMap := map[core.SymbolKind]int{
		core.SymbolKindClass:      5,
		core.SymbolKindInterface:  7,
		core.SymbolKindFunction:   3,
		core.SymbolKindMethod:     2,
		core.SymbolKindProperty:   9,
		core.SymbolKindVariable:   6,
		core.SymbolKindConstant:   21,
		core.SymbolKindEnum:       12,
		core.SymbolKindEnumCase:   20,
		core.SymbolKindStruct:     22,
		core.SymbolKindField:      4,
		core.SymbolKindType:       25,
		core.SymbolKindModule:     8,
		core.SymbolKindPackage:    8,
		core.SymbolKindNamespace:  8,
		core.SymbolKindComponent:  5,
		core.SymbolKindDecorator:  17,
		core.SymbolKindTrait:      7,
		core.SymbolKindRoute:      14,
		core.SymbolKindView:       17,
		core.SymbolKindModel:      5,
		core.SymbolKindController: 5,
		core.SymbolKindMiddleware: 3,
		core.SymbolKindMigration:  17,
		core.SymbolKindConfig:     17,
		core.SymbolKindTest:       3,
	}

	if k, ok := kindMap[kind]; ok {
		return k
	}
	return 1
}
