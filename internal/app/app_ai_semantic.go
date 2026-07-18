package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"arlecchino/internal/ai"
)

// aiSemanticProvider presents existing IDE intelligence through one bounded,
// read-only contract. Each response states its source so a text-index fallback
// is never represented as an LSP fact.
func (a *App) aiSemanticProvider(projectRoot string, req ai.AISemanticQueryRequest) (ai.AISemanticQueryResult, error) {
	projectRoot, err := filepath.Abs(filepath.Clean(strings.TrimSpace(projectRoot)))
	if err != nil || projectRoot == "" {
		return ai.AISemanticQueryResult{}, fmt.Errorf("semantic project root is invalid")
	}
	activeRoot := strings.TrimSpace(a.GetCurrentProjectPath())
	if activeRoot != "" {
		activeRoot, _ = filepath.Abs(filepath.Clean(activeRoot))
		if activeRoot != projectRoot {
			return ai.AISemanticQueryResult{}, fmt.Errorf("semantic adapter is bound to a different project session")
		}
	}
	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 40
	}
	operation := strings.TrimSpace(req.Operation)
	switch operation {
	case "symbols":
		query := strings.TrimSpace(req.Query)
		if query == "" {
			return ai.AISemanticQueryResult{}, fmt.Errorf("semantic symbols query is empty")
		}
		items := a.SearchSymbols(query)
		return semanticIndexResult(operation, "workspace_symbol_index", fmt.Sprintf("%d symbol candidates", len(items)), items, limit)
	case "references":
		query := strings.TrimSpace(req.Query)
		if query == "" {
			return ai.AISemanticQueryResult{}, fmt.Errorf("semantic references query is empty")
		}
		items := a.SearchContent(query)
		return semanticIndexResult(operation, "workspace_text_index", fmt.Sprintf("%d lexical reference candidates; not LSP-verified references", len(items)), items, limit)
	case "definition":
		path, content, err := readSemanticProjectFile(projectRoot, req.Path)
		if err != nil {
			return ai.AISemanticQueryResult{}, err
		}
		if req.Line <= 0 {
			return ai.AISemanticQueryResult{}, fmt.Errorf("semantic definition requires a 1-based line")
		}
		locations, err := a.LSPGoToDefinition(path, content, req.Line-1, maxInt(req.Character, 0))
		if err != nil {
			return ai.AISemanticQueryResult{}, err
		}
		return semanticJSONResult(operation, "lsp", fmt.Sprintf("%d LSP definition locations", len(locations)), takeSemanticItems(locations, limit))
	case "diagnostics":
		if strings.TrimSpace(req.Path) == "" {
			return ai.AISemanticQueryResult{}, fmt.Errorf("semantic diagnostics requires a project-relative path")
		}
		value, err := a.aiDiagnosticsProvider(projectRoot, req.Path, "", limit)
		if err != nil {
			return ai.AISemanticQueryResult{}, err
		}
		return ai.AISemanticQueryResult{Operation: operation, Source: "lsp_diagnostics", Summary: "bounded diagnostics", Payload: value}, nil
	case "call_hierarchy":
		path, content, err := readSemanticProjectFile(projectRoot, req.Path)
		if err != nil {
			return ai.AISemanticQueryResult{}, err
		}
		if req.Line <= 0 {
			return ai.AISemanticQueryResult{}, fmt.Errorf("semantic call hierarchy requires a 1-based line")
		}
		edges, err := a.LSPCallHierarchy(path, content, req.Line-1, maxInt(req.Character, 0))
		if err != nil {
			return ai.AISemanticQueryResult{}, err
		}
		return semanticJSONResult(operation, "lsp_call_hierarchy", fmt.Sprintf("%d LSP call hierarchy edges", len(edges)), takeSemanticItems(edges, limit))
	default:
		return ai.AISemanticQueryResult{}, fmt.Errorf("unsupported semantic operation %q", operation)
	}
}

func semanticIndexResult(operation, source, summary string, items []ResultItemJS, limit int) (ai.AISemanticQueryResult, error) {
	return semanticJSONResult(operation, source, summary, takeSemanticItems(items, limit))
}

func semanticJSONResult(operation, source, summary string, payload any) (ai.AISemanticQueryResult, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ai.AISemanticQueryResult{}, err
	}
	return ai.AISemanticQueryResult{Operation: operation, Source: source, Summary: summary, Payload: string(encoded)}, nil
}

func readSemanticProjectFile(projectRoot, requested string) (string, string, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" {
		return "", "", fmt.Errorf("semantic definition requires a project-relative path")
	}
	path := requested
	if !filepath.IsAbs(path) {
		path = filepath.Join(projectRoot, filepath.FromSlash(path))
	}
	path = filepath.Clean(path)
	rel, err := filepath.Rel(projectRoot, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", "", fmt.Errorf("semantic path escapes project")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", "", err
	}
	if len(content) > 2<<20 {
		return "", "", fmt.Errorf("semantic file exceeds the 2 MiB safety limit")
	}
	return path, string(content), nil
}

func takeSemanticItems[T any](items []T, limit int) []T {
	if len(items) <= limit {
		return items
	}
	return items[:limit]
}
