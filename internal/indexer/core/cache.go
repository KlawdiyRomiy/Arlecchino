package core

import (
	"time"

	"github.com/dgraph-io/ristretto/v2"
)

type CacheManager struct {
	ast     *ristretto.Cache[string, []byte]
	symbols *ristretto.Cache[string, []*Symbol]
	general *ristretto.Cache[string, any]
}

type CacheConfig struct {
	ASTMaxCost     int64
	SymbolMaxCost  int64
	GeneralMaxCost int64
	NumCounters    int64
	BufferItems    int64
}

func DefaultCacheConfig() CacheConfig {
	return CacheConfig{
		ASTMaxCost:     100 << 20,
		SymbolMaxCost:  50 << 20,
		GeneralMaxCost: 20 << 20,
		NumCounters:    1e6,
		BufferItems:    64,
	}
}

func NewCacheManager(cfg CacheConfig) (*CacheManager, error) {
	astCache, err := ristretto.NewCache(&ristretto.Config[string, []byte]{
		NumCounters: cfg.NumCounters,
		MaxCost:     cfg.ASTMaxCost,
		BufferItems: cfg.BufferItems,
	})
	if err != nil {
		return nil, err
	}

	symbolCache, err := ristretto.NewCache(&ristretto.Config[string, []*Symbol]{
		NumCounters: cfg.NumCounters / 2,
		MaxCost:     cfg.SymbolMaxCost,
		BufferItems: cfg.BufferItems,
	})
	if err != nil {
		astCache.Close()
		return nil, err
	}

	generalCache, err := ristretto.NewCache(&ristretto.Config[string, any]{
		NumCounters: cfg.NumCounters / 4,
		MaxCost:     cfg.GeneralMaxCost,
		BufferItems: cfg.BufferItems,
	})
	if err != nil {
		astCache.Close()
		symbolCache.Close()
		return nil, err
	}

	return &CacheManager{
		ast:     astCache,
		symbols: symbolCache,
		general: generalCache,
	}, nil
}

func (c *CacheManager) GetAST(key string) ([]byte, bool) {
	return c.ast.Get(key)
}

func (c *CacheManager) SetAST(key string, data []byte) bool {
	return c.ast.Set(key, data, int64(len(data)))
}

func (c *CacheManager) SetASTWithTTL(key string, data []byte, ttl time.Duration) bool {
	return c.ast.SetWithTTL(key, data, int64(len(data)), ttl)
}

func (c *CacheManager) DeleteAST(key string) {
	c.ast.Del(key)
}

func (c *CacheManager) GetSymbols(key string) ([]*Symbol, bool) {
	return c.symbols.Get(key)
}

func (c *CacheManager) SetSymbols(key string, symbols []*Symbol) bool {
	cost := int64(len(symbols) * 200)
	return c.symbols.Set(key, symbols, cost)
}

func (c *CacheManager) SetSymbolsWithTTL(key string, symbols []*Symbol, ttl time.Duration) bool {
	cost := int64(len(symbols) * 200)
	return c.symbols.SetWithTTL(key, symbols, cost, ttl)
}

func (c *CacheManager) DeleteSymbols(key string) {
	c.symbols.Del(key)
}

func (c *CacheManager) Get(key string) (any, bool) {
	return c.general.Get(key)
}

func (c *CacheManager) Set(key string, value any, cost int64) bool {
	return c.general.Set(key, value, cost)
}

func (c *CacheManager) SetWithTTL(key string, value any, cost int64, ttl time.Duration) bool {
	return c.general.SetWithTTL(key, value, cost, ttl)
}

func (c *CacheManager) Delete(key string) {
	c.general.Del(key)
}

func (c *CacheManager) Clear() {
	c.ast.Clear()
	c.symbols.Clear()
	c.general.Clear()
}

func (c *CacheManager) Close() {
	c.ast.Close()
	c.symbols.Close()
	c.general.Close()
}

func (c *CacheManager) Wait() {
	c.ast.Wait()
	c.symbols.Wait()
	c.general.Wait()
}

type CacheStats struct {
	ASTHits       uint64
	ASTMisses     uint64
	SymbolHits    uint64
	SymbolMisses  uint64
	GeneralHits   uint64
	GeneralMisses uint64
}

func (c *CacheManager) Stats() CacheStats {
	astMetrics := c.ast.Metrics
	symbolMetrics := c.symbols.Metrics
	generalMetrics := c.general.Metrics

	return CacheStats{
		ASTHits:       astMetrics.Hits(),
		ASTMisses:     astMetrics.Misses(),
		SymbolHits:    symbolMetrics.Hits(),
		SymbolMisses:  symbolMetrics.Misses(),
		GeneralHits:   generalMetrics.Hits(),
		GeneralMisses: generalMetrics.Misses(),
	}
}

func ASTCacheKey(filePath string, modTime int64) string {
	return filePath + ":" + string(rune(modTime))
}

func (c *CacheManager) GetTree(key string) (any, bool) {
	return c.general.Get("tree:" + key)
}

func (c *CacheManager) SetTree(key string, tree any) bool {
	return c.general.Set("tree:"+key, tree, 1000)
}

func (c *CacheManager) SetTreeWithTTL(key string, tree any, ttl time.Duration) bool {
	return c.general.SetWithTTL("tree:"+key, tree, 1000, ttl)
}

func (c *CacheManager) DeleteTree(key string) {
	c.general.Del("tree:" + key)
}

func SymbolCacheKey(filePath string) string {
	return "symbols:" + filePath
}

func LSPCacheKey(method string, filePath string, line, col int) string {
	return method + ":" + filePath + ":" + string(rune(line)) + ":" + string(rune(col))
}
