package core

import (
	"context"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

type sqlCounter struct {
	writes atomic.Int64
}

func (c *sqlCounter) reset()                                             { c.writes.Store(0) }
func (c *sqlCounter) count() int64                                       { return c.writes.Load() }
func (c *sqlCounter) LogMode(_ gormlogger.LogLevel) gormlogger.Interface { return c }
func (c *sqlCounter) Info(_ context.Context, _ string, _ ...any)         {}
func (c *sqlCounter) Warn(_ context.Context, _ string, _ ...any)         {}
func (c *sqlCounter) Error(_ context.Context, _ string, _ ...any)        {}
func (c *sqlCounter) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	if strings.HasPrefix(sql, "INSERT") || strings.HasPrefix(sql, "UPDATE") {
		c.writes.Add(1)
	}
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := NewStore(dbPath, "proj-test")
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func injectCounter(s *Store, c *sqlCounter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.db = s.db.Session(&gorm.Session{Logger: c})
}

func TestSaveSymbols_UsesBatchWrite(t *testing.T) {
	s := newTestStore(t)
	counter := &sqlCounter{}
	injectCounter(s, counter)

	const n = 10
	syms := make([]Symbol, n)
	for i := range syms {
		syms[i] = Symbol{
			Name:     "Sym" + string(rune('A'+i)),
			Kind:     SymbolKindFunction,
			Language: "go",
			FilePath: "/tmp/a.go",
			Line:     i + 1,
		}
	}

	counter.reset()
	if err := s.SaveSymbols(syms); err != nil {
		t.Fatalf("SaveSymbols: %v", err)
	}

	got := counter.count()
	if got != 1 {
		t.Errorf("SaveSymbols(%d symbols) issued %d write statements, want 1 (batch)", n, got)
	}
}

func TestSaveEdges_UsesBatchWrite(t *testing.T) {
	s := newTestStore(t)
	counter := &sqlCounter{}
	injectCounter(s, counter)

	const n = 8
	edges := make([]Edge, n)
	for i := range edges {
		edges[i] = Edge{
			FromSymbol: "From" + string(rune('A'+i)),
			ToSymbol:   "To" + string(rune('A'+i)),
			Kind:       EdgeKindCalls,
			FilePath:   "/tmp/a.go",
			Line:       i + 1,
		}
	}

	counter.reset()
	if err := s.SaveEdges(edges); err != nil {
		t.Fatalf("SaveEdges: %v", err)
	}

	got := counter.count()
	if got != 1 {
		t.Errorf("SaveEdges(%d edges) issued %d write statements, want 1 (batch)", n, got)
	}
}

func TestSaveFiles_UsesBatchWrite(t *testing.T) {
	s := newTestStore(t)
	counter := &sqlCounter{}
	injectCounter(s, counter)

	files := []File{
		{Path: "/tmp/a.go", Language: "go", Kind: FileKindSource, Size: 12},
		{Path: "/tmp/b.md", Kind: FileKindText, Size: 8},
		{Path: "/tmp/c.png", Kind: FileKindAsset, Size: 4},
	}

	counter.reset()
	if err := s.SaveFiles(files); err != nil {
		t.Fatalf("SaveFiles: %v", err)
	}

	got := counter.count()
	if got != 1 {
		t.Errorf("SaveFiles(%d files) issued %d write statements, want 1 (batch)", len(files), got)
	}
}

func TestSaveSymbols_ExtraJSONRoundTrip(t *testing.T) {
	s := newTestStore(t)

	sym := Symbol{
		Name:     "Foo",
		Kind:     SymbolKindFunction,
		Language: "php",
		FilePath: "/app/Foo.php",
		Line:     1,
		Extra:    map[string]string{"visibility": "public", "abstract": "true"},
	}
	if err := s.SaveSymbols([]Symbol{sym}); err != nil {
		t.Fatalf("SaveSymbols: %v", err)
	}

	results, err := s.QuerySymbols(SymbolQuery{Name: "Foo", FilePath: "/app/Foo.php"})
	if err != nil {
		t.Fatalf("QuerySymbols: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("got %d results, want 1", len(results))
	}

	got := results[0].Extra
	if got["visibility"] != "public" {
		t.Errorf("Extra[visibility] = %q, want %q", got["visibility"], "public")
	}
	if got["abstract"] != "true" {
		t.Errorf("Extra[abstract] = %q, want %q", got["abstract"], "true")
	}
}

func TestSaveSymbols_DeleteThenResave(t *testing.T) {
	s := newTestStore(t)
	const path = "/app/Model.php"

	first := []Symbol{
		{Name: "OldMethod", Kind: SymbolKindMethod, Language: "php", FilePath: path, Line: 5},
		{Name: "StaleFunc", Kind: SymbolKindFunction, Language: "php", FilePath: path, Line: 10},
	}
	if err := s.SaveSymbols(first); err != nil {
		t.Fatalf("SaveSymbols first: %v", err)
	}

	if err := s.DeleteFileSymbols(path); err != nil {
		t.Fatalf("DeleteFileSymbols: %v", err)
	}

	second := []Symbol{
		{Name: "NewMethod", Kind: SymbolKindMethod, Language: "php", FilePath: path, Line: 3},
	}
	if err := s.SaveSymbols(second); err != nil {
		t.Fatalf("SaveSymbols second: %v", err)
	}

	results, err := s.QuerySymbols(SymbolQuery{FilePath: path})
	if err != nil {
		t.Fatalf("QuerySymbols: %v", err)
	}

	for _, r := range results {
		if r.Name == "OldMethod" || r.Name == "StaleFunc" {
			t.Errorf("stale symbol %q still present after delete+re-save", r.Name)
		}
	}
	if len(results) != 1 || results[0].Name != "NewMethod" {
		t.Errorf("got symbols %v, want exactly [NewMethod]", symbolNames(results))
	}
}

func TestSaveEdges_DuplicatesPreserved(t *testing.T) {
	s := newTestStore(t)

	edges := []Edge{
		{FromSymbol: "A", ToSymbol: "B", Kind: EdgeKindCalls, FilePath: "/tmp/x.go", Line: 1},
		{FromSymbol: "A", ToSymbol: "B", Kind: EdgeKindCalls, FilePath: "/tmp/x.go", Line: 1},
	}
	if err := s.SaveEdges(edges); err != nil {
		t.Fatalf("SaveEdges: %v", err)
	}

	results, err := s.QueryEdges(EdgeQuery{FromSymbol: "A", ToSymbol: "B"})
	if err != nil {
		t.Fatalf("QueryEdges: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("got %d edges, want 2 (duplicates must be preserved)", len(results))
	}
}

func TestSaveSymbols_LargeBatchBoundary(t *testing.T) {
	s := newTestStore(t)

	syms := make([]Symbol, symbolBatchSize)
	for i := range syms {
		syms[i] = Symbol{
			Name:     "LargeSym" + strconv.Itoa(i),
			Kind:     SymbolKindFunction,
			Language: "go",
			FilePath: "/tmp/large.go",
			Line:     i + 1,
		}
	}

	if err := s.SaveSymbols(syms); err != nil {
		t.Fatalf("SaveSymbols large batch: %v", err)
	}

	results, err := s.QuerySymbols(SymbolQuery{FilePath: "/tmp/large.go"})
	if err != nil {
		t.Fatalf("QuerySymbols: %v", err)
	}
	if len(results) != len(syms) {
		t.Errorf("got %d symbols, want %d", len(results), len(syms))
	}
}

func TestSaveSymbols_MultiBatch(t *testing.T) {
	s := newTestStore(t)
	counter := &sqlCounter{}
	injectCounter(s, counter)

	syms := make([]Symbol, symbolBatchSize+1)
	for i := range syms {
		syms[i] = Symbol{
			Name:     "MultiSym" + strconv.Itoa(i),
			Kind:     SymbolKindFunction,
			Language: "go",
			FilePath: "/tmp/multi.go",
			Line:     i + 1,
		}
	}

	counter.reset()
	if err := s.SaveSymbols(syms); err != nil {
		t.Fatalf("SaveSymbols multi batch: %v", err)
	}
	if got := counter.count(); got != 2 {
		t.Errorf("SaveSymbols(%d symbols) issued %d write statements, want 2", len(syms), got)
	}

	results, err := s.QuerySymbols(SymbolQuery{FilePath: "/tmp/multi.go"})
	if err != nil {
		t.Fatalf("QuerySymbols: %v", err)
	}
	if len(results) != len(syms) {
		t.Errorf("got %d symbols, want %d", len(results), len(syms))
	}
}

func TestSaveEdges_LargeBatchBoundary(t *testing.T) {
	s := newTestStore(t)

	edges := make([]Edge, edgeBatchSize)
	for i := range edges {
		edges[i] = Edge{
			FromSymbol: "LargeFrom" + strconv.Itoa(i),
			ToSymbol:   "LargeTo" + strconv.Itoa(i),
			Kind:       EdgeKindCalls,
			FilePath:   "/tmp/large.go",
			Line:       i + 1,
		}
	}

	if err := s.SaveEdges(edges); err != nil {
		t.Fatalf("SaveEdges large batch: %v", err)
	}

	results, err := s.QueryEdges(EdgeQuery{Kind: EdgeKindCalls})
	if err != nil {
		t.Fatalf("QueryEdges: %v", err)
	}
	if len(results) != len(edges) {
		t.Errorf("got %d edges, want %d", len(results), len(edges))
	}
}

func TestSaveEdges_MultiBatch(t *testing.T) {
	s := newTestStore(t)
	counter := &sqlCounter{}
	injectCounter(s, counter)

	edges := make([]Edge, edgeBatchSize+1)
	for i := range edges {
		edges[i] = Edge{
			FromSymbol: "MultiFrom" + strconv.Itoa(i),
			ToSymbol:   "MultiTo" + strconv.Itoa(i),
			Kind:       EdgeKindCalls,
			FilePath:   "/tmp/multi.go",
			Line:       i + 1,
		}
	}

	counter.reset()
	if err := s.SaveEdges(edges); err != nil {
		t.Fatalf("SaveEdges multi batch: %v", err)
	}
	if got := counter.count(); got != 2 {
		t.Errorf("SaveEdges(%d edges) issued %d write statements, want 2", len(edges), got)
	}

	results, err := s.QueryEdges(EdgeQuery{Kind: EdgeKindCalls})
	if err != nil {
		t.Fatalf("QueryEdges: %v", err)
	}
	if len(results) != len(edges) {
		t.Errorf("got %d edges, want %d", len(results), len(edges))
	}
}

func symbolNames(syms []Symbol) []string {
	names := make([]string, len(syms))
	for i, s := range syms {
		names[i] = s.Name
	}
	return names
}
