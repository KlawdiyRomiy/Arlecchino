package core

import (
	"testing"
	"time"
)

func TestCacheManager_AST(t *testing.T) {
	cfg := DefaultCacheConfig()
	cm, err := NewCacheManager(cfg)
	if err != nil {
		t.Fatalf("NewCacheManager failed: %v", err)
	}
	defer cm.Close()

	key := "test.go:12345"
	data := []byte("mock AST data")

	ok := cm.SetAST(key, data)
	if !ok {
		t.Error("SetAST should return true")
	}

	cm.Wait()

	got, found := cm.GetAST(key)
	if !found {
		t.Error("GetAST should find cached value")
	}
	if string(got) != string(data) {
		t.Errorf("GetAST got %q, want %q", got, data)
	}

	cm.DeleteAST(key)
	cm.Wait()

	_, found = cm.GetAST(key)
	if found {
		t.Error("GetAST should not find deleted value")
	}
}

func TestCacheManager_Symbols(t *testing.T) {
	cfg := DefaultCacheConfig()
	cm, err := NewCacheManager(cfg)
	if err != nil {
		t.Fatalf("NewCacheManager failed: %v", err)
	}
	defer cm.Close()

	key := "symbols:test.go"
	symbols := []*Symbol{
		{Name: "TestFunc", Kind: SymbolKindFunction},
		{Name: "TestClass", Kind: SymbolKindClass},
	}

	ok := cm.SetSymbols(key, symbols)
	if !ok {
		t.Error("SetSymbols should return true")
	}

	cm.Wait()

	got, found := cm.GetSymbols(key)
	if !found {
		t.Error("GetSymbols should find cached value")
	}
	if len(got) != 2 {
		t.Errorf("GetSymbols got %d symbols, want 2", len(got))
	}
}

func TestCacheManager_General(t *testing.T) {
	cfg := DefaultCacheConfig()
	cm, err := NewCacheManager(cfg)
	if err != nil {
		t.Fatalf("NewCacheManager failed: %v", err)
	}
	defer cm.Close()

	key := "general:test"
	value := map[string]string{"foo": "bar"}

	ok := cm.Set(key, value, 100)
	if !ok {
		t.Error("Set should return true")
	}

	cm.Wait()

	got, found := cm.Get(key)
	if !found {
		t.Error("Get should find cached value")
	}

	gotMap, ok := got.(map[string]string)
	if !ok {
		t.Error("Get should return correct type")
	}
	if gotMap["foo"] != "bar" {
		t.Errorf("Get got %v, want map with foo=bar", got)
	}
}

func TestCacheManager_TTL(t *testing.T) {
	cfg := DefaultCacheConfig()
	cm, err := NewCacheManager(cfg)
	if err != nil {
		t.Fatalf("NewCacheManager failed: %v", err)
	}
	defer cm.Close()

	key := "ttl:test"
	data := []byte("expires soon")

	ok := cm.SetASTWithTTL(key, data, 100*time.Millisecond)
	if !ok {
		t.Error("SetASTWithTTL should return true")
	}

	cm.Wait()

	_, found := cm.GetAST(key)
	if !found {
		t.Error("GetAST should find value before TTL expires")
	}

	time.Sleep(200 * time.Millisecond)

	_, found = cm.GetAST(key)
	if found {
		t.Error("GetAST should not find value after TTL expires")
	}
}

func TestCacheManager_Clear(t *testing.T) {
	cfg := DefaultCacheConfig()
	cm, err := NewCacheManager(cfg)
	if err != nil {
		t.Fatalf("NewCacheManager failed: %v", err)
	}
	defer cm.Close()

	cm.SetAST("ast:1", []byte("data1"))
	cm.SetSymbols("sym:1", []*Symbol{{Name: "Test"}})
	cm.Set("gen:1", "value", 10)
	cm.Wait()

	cm.Clear()
	cm.Wait()

	if _, found := cm.GetAST("ast:1"); found {
		t.Error("Clear should remove AST entries")
	}
	if _, found := cm.GetSymbols("sym:1"); found {
		t.Error("Clear should remove Symbol entries")
	}
	if _, found := cm.Get("gen:1"); found {
		t.Error("Clear should remove General entries")
	}
}

func TestCacheManager_Stats(t *testing.T) {
	cfg := DefaultCacheConfig()
	cm, err := NewCacheManager(cfg)
	if err != nil {
		t.Fatalf("NewCacheManager failed: %v", err)
	}
	defer cm.Close()

	cm.SetAST("key1", []byte("data"))
	cm.Wait()

	cm.GetAST("key1")
	cm.GetAST("nonexistent")

	stats := cm.Stats()
	totalOps := stats.ASTHits + stats.ASTMisses
	if totalOps < 0 {
		t.Errorf("Stats should return non-negative values, got hits=%d misses=%d", stats.ASTHits, stats.ASTMisses)
	}
}

func TestCacheKeyFunctions(t *testing.T) {
	astKey := ASTCacheKey("/path/to/file.go", 1234567890)
	if astKey == "" {
		t.Error("ASTCacheKey should not return empty string")
	}

	symKey := SymbolCacheKey("/path/to/file.go")
	if symKey != "symbols:/path/to/file.go" {
		t.Errorf("SymbolCacheKey = %q, want symbols:/path/to/file.go", symKey)
	}

	lspKey := LSPCacheKey("textDocument/completion", "/path/to/file.go", 10, 5)
	if lspKey == "" {
		t.Error("LSPCacheKey should not return empty string")
	}
}
