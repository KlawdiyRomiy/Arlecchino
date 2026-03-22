package brain

import (
	"path/filepath"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/indexer/core"
)

type CrossFileProvider struct {
	mu         sync.RWMutex
	engine     *core.Engine
	cache      map[string]*crossFileCache
	openTabs   []string
	cacheTTL   time.Duration
	maxRelated int
	maxSymbols int
	maxCache   int
}

type crossFileCache struct {
	relatedFiles []string
	symbols      []core.Symbol
	cachedAt     time.Time
}

func NewCrossFileProvider(engine *core.Engine) *CrossFileProvider {
	return &CrossFileProvider{
		engine:     engine,
		cache:      make(map[string]*crossFileCache),
		openTabs:   make([]string, 0, 20),
		cacheTTL:   30 * time.Second,
		maxRelated: 10,
		maxSymbols: 50,
		maxCache:   40,
	}
}

func (p *CrossFileProvider) RegisterOpenTabs(tabs []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.openTabs = tabs
	p.cache = make(map[string]*crossFileCache)
}

func (p *CrossFileProvider) AddOpenTab(filePath string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, t := range p.openTabs {
		if t == filePath {
			return
		}
	}

	p.openTabs = append(p.openTabs, filePath)
	if len(p.openTabs) > 20 {
		p.openTabs = p.openTabs[1:]
	}
}

func (p *CrossFileProvider) RemoveOpenTab(filePath string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for i, t := range p.openTabs {
		if t == filePath {
			p.openTabs = append(p.openTabs[:i], p.openTabs[i+1:]...)
			break
		}
	}
}

func (p *CrossFileProvider) GetRelatedSymbols(ctx CompletionContext) []core.Symbol {
	if p.engine == nil {
		return nil
	}

	cacheKey := ctx.FilePath

	p.mu.RLock()
	cached, ok := p.cache[cacheKey]
	if ok && time.Since(cached.cachedAt) < p.cacheTTL {
		p.mu.RUnlock()
		return cached.symbols
	}
	p.mu.RUnlock()

	relatedFiles := p.findRelatedFiles(ctx.FilePath)
	if len(relatedFiles) == 0 {
		return nil
	}

	symbols := p.collectSymbolsFromFiles(relatedFiles, ctx)

	p.mu.Lock()
	p.cache[cacheKey] = &crossFileCache{
		relatedFiles: relatedFiles,
		symbols:      symbols,
		cachedAt:     time.Now(),
	}
	p.cleanupCacheLocked()
	p.mu.Unlock()

	return symbols
}

func (p *CrossFileProvider) findRelatedFiles(filePath string) []string {
	related := make(map[string]bool)

	p.mu.RLock()
	openTabs := make([]string, len(p.openTabs))
	copy(openTabs, p.openTabs)
	p.mu.RUnlock()

	for _, tab := range openTabs {
		if tab != filePath {
			related[tab] = true
		}
	}

	imports := p.getImportedFiles(filePath)
	for _, f := range imports {
		related[f] = true
	}

	importers := p.getImportingFiles(filePath)
	for _, f := range importers {
		related[f] = true
	}

	extends := p.getExtendedFiles(filePath)
	for _, f := range extends {
		related[f] = true
	}

	implements := p.getImplementedFiles(filePath)
	for _, f := range implements {
		related[f] = true
	}

	var result []string
	for f := range related {
		if f != filePath {
			result = append(result, f)
		}
		if len(result) >= p.maxRelated {
			break
		}
	}

	return result
}

func (p *CrossFileProvider) getImportedFiles(filePath string) []string {
	edges, err := p.engine.QueryEdges(core.EdgeQuery{
		FromSymbol: filePath,
		Kind:       core.EdgeKindImports,
		Limit:      p.maxRelated,
	})
	if err != nil {
		return nil
	}

	var files []string
	for _, edge := range edges {
		resolved := p.resolveImportPath(edge.ToSymbol, filePath)
		if resolved != "" {
			files = append(files, resolved)
		}
	}
	return files
}

func (p *CrossFileProvider) getImportingFiles(filePath string) []string {
	edges, err := p.engine.QueryEdges(core.EdgeQuery{
		ToSymbol: filePath,
		Kind:     core.EdgeKindImports,
		Limit:    p.maxRelated,
	})
	if err != nil {
		return nil
	}

	var files []string
	for _, edge := range edges {
		files = append(files, edge.FromSymbol)
	}
	return files
}

func (p *CrossFileProvider) getExtendedFiles(filePath string) []string {
	symbols, err := p.engine.Query(core.SymbolQuery{
		FilePath: filePath,
		Limit:    20,
	})
	if err != nil {
		return nil
	}

	var parentClasses []string
	for _, sym := range symbols {
		if sym.ParentID != "" {
			parentClasses = append(parentClasses, sym.ParentID)
		}
	}

	if len(parentClasses) == 0 {
		return nil
	}

	var files []string
	for _, parent := range parentClasses {
		parentSymbols, err := p.engine.Query(core.SymbolQuery{
			Name:  parent,
			Kind:  core.SymbolKindClass,
			Limit: 1,
		})
		if err == nil && len(parentSymbols) > 0 {
			files = append(files, parentSymbols[0].FilePath)
		}
	}
	return files
}

func (p *CrossFileProvider) getImplementedFiles(filePath string) []string {
	edges, err := p.engine.QueryEdges(core.EdgeQuery{
		FromSymbol: filePath,
		Kind:       core.EdgeKindImplements,
		Limit:      p.maxRelated,
	})
	if err != nil {
		return nil
	}

	var files []string
	for _, edge := range edges {
		interfaceSymbols, err := p.engine.Query(core.SymbolQuery{
			Name:  edge.ToSymbol,
			Kind:  core.SymbolKindInterface,
			Limit: 1,
		})
		if err == nil && len(interfaceSymbols) > 0 {
			files = append(files, interfaceSymbols[0].FilePath)
		}
	}
	return files
}

func (p *CrossFileProvider) collectSymbolsFromFiles(files []string, ctx CompletionContext) []core.Symbol {
	var allSymbols []core.Symbol
	seen := make(map[string]bool)

	for _, file := range files {
		symbols, err := p.engine.Query(core.SymbolQuery{
			FilePath: file,
			Limit:    30,
		})
		if err != nil {
			continue
		}

		for _, sym := range symbols {
			if seen[sym.ID] {
				continue
			}
			seen[sym.ID] = true

			if p.isRelevantSymbol(sym, ctx) {
				allSymbols = append(allSymbols, sym)
			}

			if len(allSymbols) >= p.maxSymbols {
				return allSymbols
			}
		}
	}

	return allSymbols
}

func (p *CrossFileProvider) isRelevantSymbol(sym core.Symbol, ctx CompletionContext) bool {
	switch sym.Kind {
	case core.SymbolKindClass, core.SymbolKindInterface, core.SymbolKindTrait:
		return true
	case core.SymbolKindFunction, core.SymbolKindMethod:
		return true
	case core.SymbolKindConstant:
		return true
	case core.SymbolKindProperty:
		return ctx.ParentClass != "" && sym.Namespace == ctx.ParentClass
	}
	return false
}

func (p *CrossFileProvider) resolveImportPath(importPath, fromFile string) string {
	if strings.HasPrefix(importPath, ".") {
		dir := filepath.Dir(fromFile)
		resolved := filepath.Join(dir, importPath)
		resolved = filepath.Clean(resolved)

		extensions := []string{".go", ".ts", ".tsx", ".js", ".jsx", ".py", ".php", ".rb"}
		for _, ext := range extensions {
			candidate := resolved + ext
			if p.fileExists(candidate) {
				return candidate
			}
		}

		indexFiles := []string{"index.ts", "index.tsx", "index.js", "index.jsx", "__init__.py"}
		for _, idx := range indexFiles {
			candidate := filepath.Join(resolved, idx)
			if p.fileExists(candidate) {
				return candidate
			}
		}
	}

	symbols, err := p.engine.Query(core.SymbolQuery{
		Namespace: importPath,
		Limit:     1,
	})
	if err == nil && len(symbols) > 0 {
		return symbols[0].FilePath
	}

	return ""
}

func (p *CrossFileProvider) fileExists(path string) bool {
	symbols, err := p.engine.Query(core.SymbolQuery{
		FilePath: path,
		Limit:    1,
	})
	return err == nil && len(symbols) > 0
}

func (p *CrossFileProvider) InvalidateCache(filePath string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	delete(p.cache, filePath)

	for key, cached := range p.cache {
		for _, related := range cached.relatedFiles {
			if related == filePath {
				delete(p.cache, key)
				break
			}
		}
	}
}

func (p *CrossFileProvider) ClearCache() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.cache = make(map[string]*crossFileCache)
}

func (p *CrossFileProvider) Stats() int {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return len(p.cache)
}

func (p *CrossFileProvider) cleanupCacheLocked() {
	if len(p.cache) <= p.maxCache {
		return
	}

	now := time.Now()
	for key, cached := range p.cache {
		if now.Sub(cached.cachedAt) > p.cacheTTL {
			delete(p.cache, key)
		}
	}

	for len(p.cache) > p.maxCache {
		var oldestKey string
		var oldestTime time.Time
		first := true
		for key, cached := range p.cache {
			if first || cached.cachedAt.Before(oldestTime) {
				oldestKey = key
				oldestTime = cached.cachedAt
				first = false
			}
		}
		if oldestKey == "" {
			break
		}
		delete(p.cache, oldestKey)
	}
}
