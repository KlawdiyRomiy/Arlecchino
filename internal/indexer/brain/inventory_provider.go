package brain

import (
	"path/filepath"
	"strings"

	"arlecchino/internal/indexer/core"
)

const inventorySearchLimit = 256

const (
	inventoryFileScore = 0.82
	inventoryDirScore  = 0.84
)

type InventoryProvider struct {
	engine *core.Engine
}

func NewInventoryProvider(engine *core.Engine) *InventoryProvider {
	return &InventoryProvider{engine: engine}
}

func (p *InventoryProvider) GetPathCompletions(ctx CompletionContext) []Suggestion {
	if p == nil || p.engine == nil {
		return nil
	}

	searchDir, prefix, ok := resolveInventorySearch(ctx.FilePath, ctx.StringValue, p.engine.ProjectRoot())
	if !ok {
		return nil
	}

	files, err := p.engine.Store().SearchFilesInDir(searchDir, inventorySearchLimit)
	if err != nil || len(files) == 0 {
		return nil
	}

	prefixLower := strings.ToLower(prefix)
	seen := make(map[string]struct{}, 16)
	suggestions := make([]Suggestion, 0, 16)

	for _, file := range files {
		relPath, err := filepath.Rel(searchDir, file.Path)
		if err != nil || relPath == "." || relPath == "" {
			continue
		}
		if strings.HasPrefix(relPath, "..") {
			continue
		}

		relPath = filepath.ToSlash(relPath)
		item := relPath
		isDir := false
		if idx := strings.IndexByte(relPath, '/'); idx >= 0 {
			item = relPath[:idx]
			isDir = true
		}

		if prefixLower != "" && !strings.HasPrefix(strings.ToLower(item), prefixLower) {
			continue
		}

		insertText := item
		kind := core.SymbolKindText
		detail := relPath
		score := inventoryFileScore
		if isDir {
			insertText += "/"
			kind = core.SymbolKindModule
			detail = item + "/"
			score = inventoryDirScore
		}

		if _, ok := seen[insertText]; ok {
			continue
		}
		seen[insertText] = struct{}{}

		suggestions = append(suggestions, Suggestion{
			Text:        insertText,
			DisplayText: insertText,
			Kind:        kind,
			Source:      core.SourceIndex,
			Score:       score,
			Detail:      detail,
			FilePath:    file.Path,
			InsertText:  insertText,
		})
	}

	return suggestions
}

func resolveInventorySearch(filePath, rawValue, projectRoot string) (string, string, bool) {
	if filePath == "" || projectRoot == "" {
		return "", "", false
	}

	rawValue = filepath.ToSlash(strings.TrimSpace(rawValue))
	if rawValue == "" {
		rawValue = "./"
	}

	trailingSlash := strings.HasSuffix(rawValue, "/")
	dirPart := rawValue
	prefix := ""
	if !trailingSlash {
		dirPart = filepath.ToSlash(filepath.Dir(rawValue))
		prefix = filepath.Base(rawValue)
	}

	if strings.HasPrefix(rawValue, "/") {
		dirPart = strings.TrimPrefix(dirPart, "/")
		if dirPart == "." {
			dirPart = ""
		}
		return filepath.Clean(filepath.Join(projectRoot, filepath.FromSlash(dirPart))), prefix, true
	}

	return filepath.Clean(filepath.Join(filepath.Dir(filePath), filepath.FromSlash(dirPart))), prefix, true
}
