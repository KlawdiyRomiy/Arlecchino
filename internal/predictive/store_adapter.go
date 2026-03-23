package predictive

import (
	"arlecchino/internal/indexer/core"
)

type StoreAdapter struct {
	store       *core.Store
	projectRoot string
}

func NewStoreAdapter(store *core.Store, projectRoot string) *StoreAdapter {
	return &StoreAdapter{
		store:       store,
		projectRoot: projectRoot,
	}
}

func (a *StoreAdapter) QuerySymbols(query SymbolQuery) []SymbolInfo {
	if a.store == nil {
		return nil
	}

	coreQuery := core.SymbolQuery{
		Name:      query.Name,
		Language:  query.Language,
		Namespace: query.Namespace,
		FilePath:  query.FilePath,
		Limit:     query.Limit,
	}

	if query.Kind != "" {
		coreQuery.Kind = core.SymbolKind(query.Kind)
	}

	symbols, err := a.store.QuerySymbols(coreQuery)
	if err != nil {
		return nil
	}

	result := make([]SymbolInfo, 0, len(symbols))
	for _, sym := range symbols {
		result = append(result, SymbolInfo{
			Name:      sym.Name,
			Kind:      string(sym.Kind),
			Namespace: sym.Namespace,
			FilePath:  sym.FilePath,
			Line:      sym.Line,
			Signature: sym.Signature,
		})
	}

	return result
}

func (a *StoreAdapter) GetProjectRoot() string {
	return a.projectRoot
}

func (a *StoreAdapter) GetStore() *core.Store {
	return a.store
}
