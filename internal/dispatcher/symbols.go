package dispatcher

import (
	"arlecchino/internal/indexer/core"
	"strings"
)

type SymbolSearcher struct {
	engine *core.Engine
}

func NewSymbolSearcher(engine *core.Engine) *SymbolSearcher {
	return &SymbolSearcher{
		engine: engine,
	}
}

func (s *SymbolSearcher) Search(query string, limit int) []ResultItem {
	if s.engine == nil || query == "" {
		return nil
	}

	if limit <= 0 {
		limit = 50
	}

	symbols, err := s.engine.Query(core.SymbolQuery{
		Name:  query,
		Limit: limit,
	})
	if err != nil {
		return nil
	}

	results := make([]ResultItem, 0, len(symbols))
	for _, sym := range symbols {
		icon := symbolKindToIcon(sym.Kind)
		subtitle := formatSymbolSubtitle(sym)

		results = append(results, ResultItem{
			ID:       sym.ID,
			Icon:     icon,
			Title:    sym.Name,
			Subtitle: subtitle,
			Action:   "goto",
			FilePath: sym.FilePath,
			Line:     sym.Line,
		})
	}

	return results
}

func (s *SymbolSearcher) SearchByKind(query string, kind core.SymbolKind, limit int) []ResultItem {
	if s.engine == nil {
		return nil
	}

	if limit <= 0 {
		limit = 50
	}

	symbols, err := s.engine.Query(core.SymbolQuery{
		Name:  query,
		Kind:  kind,
		Limit: limit,
	})
	if err != nil {
		return nil
	}

	results := make([]ResultItem, 0, len(symbols))
	for _, sym := range symbols {
		icon := symbolKindToIcon(sym.Kind)
		subtitle := formatSymbolSubtitle(sym)

		results = append(results, ResultItem{
			ID:       sym.ID,
			Icon:     icon,
			Title:    sym.Name,
			Subtitle: subtitle,
			Action:   "goto",
			FilePath: sym.FilePath,
			Line:     sym.Line,
		})
	}

	return results
}

func symbolKindToIcon(kind core.SymbolKind) string {
	switch kind {
	case core.SymbolKindClass:
		return "box"
	case core.SymbolKindInterface:
		return "layers"
	case core.SymbolKindFunction, core.SymbolKindMethod:
		return "code"
	case core.SymbolKindVariable, core.SymbolKindProperty:
		return "tag"
	case core.SymbolKindConstant:
		return "hash"
	case core.SymbolKindStruct:
		return "box"
	case core.SymbolKindEnum:
		return "list"
	case core.SymbolKindModule, core.SymbolKindPackage:
		return "package"
	case core.SymbolKindType:
		return "type"
	case core.SymbolKindRoute:
		return "navigation"
	case core.SymbolKindController:
		return "cpu"
	case core.SymbolKindModel:
		return "database"
	case core.SymbolKindView:
		return "layout"
	case core.SymbolKindTest:
		return "check-circle"
	default:
		return "circle"
	}
}

func formatSymbolSubtitle(sym core.Symbol) string {
	var parts []string

	if sym.Kind != "" {
		parts = append(parts, string(sym.Kind))
	}

	if sym.Namespace != "" {
		parts = append(parts, sym.Namespace)
	}

	if sym.FilePath != "" {
		shortPath := sym.FilePath
		if idx := strings.LastIndex(shortPath, "/"); idx != -1 {
			shortPath = shortPath[idx+1:]
		}
		if sym.Line > 0 {
			parts = append(parts, shortPath+":"+itoa(sym.Line))
		} else {
			parts = append(parts, shortPath)
		}
	}

	return strings.Join(parts, " · ")
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	if n < 0 {
		return "-" + itoa(-n)
	}

	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
