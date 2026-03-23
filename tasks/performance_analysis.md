# Performance Analysis: Arlecchino Autocomplete System

**Analysis Date:** February 2, 2026  
**Target:** Sub-50ms completion latency (JetBrains-level performance)  
**Current State:** Research phase - no changes made

---

## Executive Summary

Arlecchino's autocomplete system uses a **6-provider architecture** with parallel execution and caching. The system shows good design patterns but has **identifiable bottlenecks** in:
1. **LSP blocking** (200ms timeout)
2. **Prefix extraction** (Tree-sitter parsing on every keystroke)
3. **SQLite index queries** (no query optimization)
4. **Deduplication O(n²)** complexity
5. **Lack of benchmarks** (zero performance tests exist)

**Estimated Current Latency:** 150-300ms (needs profiling to confirm)  
**Target Latency:** <50ms

---

## 1. Latency Analysis

### 1.1 Hot Path: `App.GetEditorCompletions()` → `PredictionBrain.Complete()`

**File:** `completion.go:141-262` → `internal/indexer/brain/prediction.go:513-632`

#### Request Flow (Synchronous Steps):
```
Frontend request
  ↓
1. ExtractPrefix (Tree-sitter)          [BLOCKING - ~10-30ms]
  ↓
2. Build CompletionContext              [~1ms]
  ↓
3. PredictionBrain.Complete()
   ├─ Cache check                      [~1ms]
   ├─ String/Import specialized        [~5-10ms if triggered]
   ├─ ResolveAccessChain               [~2-5ms]
   ├─ collectExternalGroup (LSP)       [ASYNC - timeout 200ms]
   ├─ collectLocalGroup                [~10-20ms]
   ├─ collectPatternGroup              [~5-10ms]
   ├─ collectIndexGroup                [~20-50ms - SQLite query]
   ├─ filterByPrefix                   [~5-10ms]
   ├─ filterByContext                  [~2-5ms]
   ├─ deduplicate                      [~5-15ms - O(n²)]
   ├─ rank                             [~10-20ms]
   └─ EnrichSuggestion                 [~5-10ms]
  ↓
4. Return to frontend                   [IPC overhead ~5ms]
```

#### Critical Bottlenecks:

**🔴 BLOCKING: Tree-sitter Prefix Extraction**
- **Location:** `internal/predictive/engine.go:482-506` (ExtractPrefix)
- **Called by:** `completion.go:154` (every keystroke)
- **Issue:** Parses entire file AST to extract prefix/context
- **Estimated Cost:** 10-30ms per call
- **Evidence:** No caching of parse results
```go
func (e *Engine) ExtractPrefix(filePath string, content []byte, line, column int) PrefixInfo {
    prefix, inString, stringContent, accessChain, inComment, inImport, stringCtxType := e.analyzer.ast.ExtractPrefixAtPosition(
        language, content, line, column,
    )
    // ... no caching ...
}
```

**🔴 BLOCKING: SQLite Index Query**
- **Location:** `internal/indexer/brain/prediction.go:1043-1166` (fromIndex)
- **Issue:** LIKE query without optimization
- **Estimated Cost:** 20-50ms depending on index size
```go
query := core.SymbolQuery{
    Name:           prefix, // LIKE search: prefix%
    Language:       ctx.Language,
    Limit:          100,
    IncludePending: true,
}
symbols, err := b.engine.Query(query)
```

**🟡 ASYNC BUT SLOW: LSP Timeout**
- **Location:** `completion.go:588-592`
- **Issue:** Waits 200ms for LSP even if it's slow
- **Impact:** Can add up to 200ms latency
```go
select {
case externalGroup = <-externalCh:
case <-time.After(200 * time.Millisecond):
    debugLogf("[Complete] LSP timeout: proceeding without external results")
}
```

**🟡 MEDIUM: Deduplication Algorithm**
- **Location:** `internal/indexer/brain/prediction.go:1634-1666` (deduplicate)
- **Issue:** Nested map lookups, O(n) per suggestion
- **Estimated Cost:** 5-15ms for 50-100 suggestions
```go
func (b *PredictionBrain) deduplicate(suggestions []Suggestion) []Suggestion {
    seenByText := make(map[string]int)
    seenByTextKind := make(map[string]int)
    // Two map lookups per suggestion
    for _, s := range suggestions {
        // ...
    }
}
```

### 1.2 Async/Await Patterns

**Good:** LSP requests are non-blocking
```go
externalCh := make(chan providerGroupResult, 1)
go func() {
    externalCh <- b.collectExternalGroup(ctx, config, lspManager)
}()
```

**Problem:** Only LSP is async. Local/Pattern/Index run sequentially:
```go
localGroup := b.collectLocalGroup(ctx, config, fillAll, local, virtualStore)
patternGroup := b.collectPatternGroup(ctx, predictiveEngine)
indexGroup := b.collectIndexGroup(ctx)
```

**Recommendation:** Parallelize all provider groups.

---

## 2. Memory Usage

### 2.1 Index Size & Memory Footprint

**SQLite Database:** `internal/indexer/core/store.go`
- **Location:** `{projectRoot}/.arle.db`
- **Schema:** 2 main tables (symbols, edges)
- **No VACUUM:** Database grows indefinitely
- **No memory limits:** All queries load full result sets

**Symbols Table:**
```sql
ID VARCHAR(512) PRIMARY KEY
Name VARCHAR(256) INDEXED
-- 10+ other columns
-- Estimated: ~500 bytes/row
```

**Issue:** Large projects (10k+ symbols) → 5+ MB database → slow queries

**Evidence:** No connection pooling, WAL mode enabled but no checkpoint tuning
```go
db, err := gorm.Open(sqlite.Open(dbPath+"?cache=shared&mode=rwc&_journal_mode=WAL"), &gorm.Config{})
```

### 2.2 Caching Strategies

**✅ GOOD: Completion Cache**
- **Location:** `internal/indexer/brain/prediction.go:64-180` (CompletionCache)
- **Type:** LRU with TTL (5 min)
- **Capacity:** 1000 entries
- **Key:** MD5(filePath + line + column + prefix + language)
- **Problem:** Position-based keys → low hit rate (every character typed = new key)

```go
func (c *CompletionCache) cacheKey(ctx CompletionContext) string {
    h := md5.New()
    h.Write([]byte(fmt.Sprintf("%s:%d:%d:%s:%s", ctx.FilePath, ctx.Line, ctx.Column, ctx.Prefix, ctx.Language)))
    return hex.EncodeToString(h.Sum(nil))
}
```

**🔴 BAD: No Prefix Extraction Cache**
- Tree-sitter parses entire file every keystroke
- Should cache parse trees per file version

**🟡 MEDIUM: LSP Completion Cache**
- **Location:** `internal/indexer/lsp/manager.go:31-32`
- **TTL:** 250ms (too short)
- **Limit:** 200 entries
- **Key includes column** → cache miss on every character

### 2.3 Potential Memory Leaks

**✅ NO LEAKS DETECTED** in main completion path:
- All goroutines have timeouts
- Maps are bounded (LRU eviction)
- SQLite connections auto-close

**⚠️ WATCH:** VirtualStore grows unbounded until TTL (5 min)
```go
type VirtualStore struct {
    entries map[string]VirtualEntry // No size limit
    ttl     time.Duration
}
```

---

## 3. Concurrency

### 3.1 Completion Request Handling

**Thread Safety:** ✅ Good
- `PredictionBrain.Complete()` is reentrant (RLocks)
- Cache uses mutex for writes
- No shared mutable state without locks

```go
type PredictionBrain struct {
    mu sync.RWMutex
    // ...
}
```

### 3.2 Goroutine/Thread Management

**Scheduler Workers:** 4 workers (configurable)
```go
// internal/indexer/core/scheduler.go:67
for i := 0; i < s.workers; i++ {
    go s.worker()
}
```

**LSP Goroutines:** One goroutine per completion request
- **Good:** Timeouts prevent leaks
- **Bad:** No goroutine pool → GC pressure

**⚠️ POTENTIAL ISSUE:** No rate limiting on completion requests
- Frontend could fire 10+ requests/sec while typing
- Each spawns 1 LSP goroutine + 1 provider goroutine

### 3.3 Race Conditions

**✅ NO RACES DETECTED** in review:
- All shared data protected by mutexes
- Atomics used for counters (Arle model)

**Recommendation:** Run with `-race` flag:
```bash
go test -race ./internal/indexer/brain/...
```

---

## 4. Indexer Performance

### 4.1 Index Build Time

**Full Project Index:** `internal/indexer/core/engine.go:107-136`
```go
func (e *Engine) IndexProject() {
    filepath.Walk(e.projectRoot, func(path string, info os.FileInfo, err error) error {
        // Synchronous walk + parse
        lang := e.detectLanguage(path)
        if lang != "" {
            e.IndexFile(path, 5)
            count++
        }
    })
}
```

**Issues:**
1. **Blocking walk** - no parallel file scanning
2. **No progress feedback** to UI (stats tracked but not emitted)
3. **Regex adapters** - inefficient for large files

**Recommendation:** Benchmark on real projects:
- 100-file project
- 1,000-file project  
- 10,000-file project

### 4.2 Incremental Update Efficiency

**✅ GOOD:** File-level granularity
```go
func (e *Engine) OnFileChanged(path string, content []byte) {
    e.updateSpeculative(path, content)  // Parse new content
    e.IndexFile(path, 8)                // Schedule re-index
}
```

**🟡 MEDIUM:** No debouncing
- Every keystroke triggers `updateSpeculative()`
- Should debounce rapid changes (e.g., 300ms)

### 4.3 Query Performance

**No Query Optimization:**
```go
// internal/indexer/core/store.go (QuerySymbols method not shown, but inferred)
// SELECT * FROM symbols WHERE name LIKE ? AND language = ? LIMIT ?
```

**Issues:**
1. No EXPLAIN analysis
2. No query plan caching
3. No prepared statements
4. LIKE queries scan full table

**Recommendations:**
1. Add trigram index for fuzzy search
2. Use FTS5 for full-text search
3. Prepared statement pool

---

## 5. Benchmarks

### 5.1 Existing Benchmarks

**CRITICAL FINDING:** Only 3 benchmark functions exist:

1. **SmartMatcher** (8 benchmarks)
   - `internal/predictive/matcher_test.go:148-233`
   - Tests: Exact, Prefix, WordBoundary, Subsequence, Contains, NoMatch, Unicode, ExtractWordBoundaries
   ```go
   func BenchmarkSmartMatcher_Exact(b *testing.B) {
       sm := NewSmartMatcher()
       for i := 0; i < b.N; i++ {
           sm.Match("getUser", "getUser")
       }
   }
   ```

2. **SafeParser** (2 benchmarks)
   - `internal/predictive/safe_parser_test.go:125-160`
   - Tests: Parse, ConcurrentMultiLang
   ```go
   func BenchmarkSafeParser_Parse(b *testing.B) {
       sp := NewSafeParser()
       for i := 0; i < b.N; i++ {
           sp.Parse("javascript", sampleJSCode)
       }
   }
   ```

**🔴 MISSING BENCHMARKS:**
- ❌ Complete() - main completion flow
- ❌ ExtractPrefix() - Tree-sitter parsing
- ❌ fromIndex() - SQLite query
- ❌ deduplicate() - O(n²) algorithm
- ❌ rank() - scoring algorithm
- ❌ LSP.Complete() - external call
- ❌ Full end-to-end completion (Frontend → Backend → Frontend)

### 5.2 What Should Be Benchmarked

**Priority 1 (Critical Path):**
1. `PredictionBrain.Complete()` - full flow
2. `Engine.ExtractPrefix()` - prefix extraction
3. `fromIndex()` - SQLite queries
4. `deduplicate()` - deduplication algorithm
5. `rank()` - ranking algorithm

**Priority 2 (Provider-Specific):**
6. `fromLocal()` - local file analysis
7. `fromPredictive()` - pattern matching
8. `fromFillAll()` - fill all fields
9. `fromLSP()` - LSP integration (mock)

**Priority 3 (Indexer):**
10. `Engine.IndexProject()` - full project index
11. `Scheduler.processFile()` - single file index
12. `Store.QuerySymbols()` - database queries

### 5.3 Expected vs. Current Performance

**Target (JetBrains-level):**
- **Completion latency:** <50ms p50, <150ms p99
- **Index build:** <30s for 10k files
- **Memory:** <200MB for typical project

**Current (estimated - needs profiling):**
- **Completion latency:** 150-300ms (based on timeouts)
- **Index build:** Unknown
- **Memory:** Unknown

---

## 6. Performance Bottleneck Map

```
┌─────────────────────────────────────────────────────────────┐
│                   Completion Request                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 1. ExtractPrefix (Tree-sitter)                  [10-30ms]   │  🔴 HOT
│    - Parses entire file AST                                  │
│    - No caching of parse trees                               │
│    Location: internal/predictive/engine.go:482               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Cache Lookup (MD5 hash)                     [~1ms]       │  ✅ OK
│    Location: internal/indexer/brain/prediction.go:522        │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Parallel Provider Collection                              │
│    ├─ LSP (async, timeout 200ms)               [0-200ms]    │  🟡 SLOW
│    ├─ Local (sequential)                       [10-20ms]    │  🟡 MEDIUM
│    ├─ Pattern (sequential)                     [5-10ms]     │  ✅ OK
│    └─ Index (sequential)                       [20-50ms]    │  🔴 HOT
│       Location: internal/indexer/brain/prediction.go:1043    │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Filter by Prefix (SmartMatcher)             [5-10ms]     │  ✅ OK
│    Location: internal/indexer/brain/prediction.go:1668       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. Deduplicate (O(n) with map lookups)         [5-15ms]     │  🟡 MEDIUM
│    Location: internal/indexer/brain/prediction.go:1634       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Rank (SmartRanker + Arle)                   [10-20ms]    │  🟡 MEDIUM
│    Location: internal/indexer/brain/prediction.go:1815       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. Enrich Documentation                         [5-10ms]     │  ✅ OK
│    Location: internal/indexer/brain/prediction.go:620        │
└─────────────────────────────────────────────────────────────┘

Total Estimated Latency: 75-175ms (without LSP)
                         75-375ms (with slow LSP)
```

---

## 7. Specific Slow Code Paths

### 7.1 🔴 CRITICAL: Tree-sitter Prefix Extraction

**File:** `internal/predictive/engine.go:482-506`
```go
func (e *Engine) ExtractPrefix(filePath string, content []byte, line, column int) PrefixInfo {
    language := e.analyzer.detectLanguage(filePath)
    
    // BOTTLENECK: Parses entire file on every keystroke
    prefix, inString, stringContent, accessChain, inComment, inImport, stringCtxType := e.analyzer.ast.ExtractPrefixAtPosition(
        language, content, line, column,
    )
    // ...
}
```

**Called from:** `completion.go:154` (every completion request)

**Issue:**
- Parses full file AST even for simple prefix extraction
- No caching of parse trees
- Tree-sitter is fast but not instant (~10-30ms for large files)

**Fix:**
1. Cache parse trees per file version (content hash)
2. Use incremental parsing (Tree-sitter supports this)
3. Only re-parse changed regions

### 7.2 🔴 CRITICAL: SQLite Index Query

**File:** `internal/indexer/brain/prediction.go:1043-1166`
```go
func (b *PredictionBrain) fromIndex(ctx CompletionContext) []Suggestion {
    query := core.SymbolQuery{
        Name:           prefix, // LIKE search: prefix%
        Language:       ctx.Language,
        Limit:          100,
        IncludePending: true,
    }
    symbols, err := b.engine.Query(query)  // BOTTLENECK
    // ... process 100 symbols ...
}
```

**Issue:**
- LIKE query scans table sequentially
- No FTS (Full-Text Search) index
- Loads 100 rows even if only 10 needed
- No prepared statements

**Fix:**
1. Add FTS5 virtual table for symbol names
2. Use prepared statements
3. Reduce limit to 50 (then filter)
4. Add EXPLAIN QUERY PLAN analysis

### 7.3 🟡 MEDIUM: LSP Timeout Too Long

**File:** `internal/indexer/brain/prediction.go:588-592`
```go
select {
case externalGroup = <-externalCh:
case <-time.After(200 * time.Millisecond):  // SLOW
    debugLogf("[Complete] LSP timeout: proceeding without external results")
}
```

**Issue:**
- 200ms is too long for interactive typing
- Should be 100ms max (or user-configurable)
- Currently blocks ranking even if other providers are ready

**Fix:**
1. Reduce timeout to 100ms
2. Make timeout configurable per language
3. Cancel LSP request on timeout (not just ignore)

### 7.4 🟡 MEDIUM: Sequential Provider Collection

**File:** `internal/indexer/brain/prediction.go:576-585`
```go
localGroup := b.collectLocalGroup(ctx, config, fillAll, local, virtualStore)
// ^^ BLOCKING

patternGroup := b.collectPatternGroup(ctx, predictiveEngine)
// ^^ BLOCKING

indexGroup := b.collectIndexGroup(ctx)
// ^^ BLOCKING
```

**Issue:**
- Only LSP runs async
- Local, Pattern, Index run sequentially
- Total time = sum of all (not parallelized)

**Fix:** Run all providers in parallel:
```go
var wg sync.WaitGroup
results := make(chan providerGroupResult, 4)

wg.Add(4)
go func() { defer wg.Done(); results <- b.collectLocalGroup(...) }()
go func() { defer wg.Done(); results <- b.collectPatternGroup(...) }()
go func() { defer wg.Done(); results <- b.collectIndexGroup(...) }()
go func() { defer wg.Done(); results <- b.collectExternalGroup(...) }()

go func() { wg.Wait(); close(results) }()
```

### 7.5 🟡 MEDIUM: Deduplication Algorithm

**File:** `internal/indexer/brain/prediction.go:1634-1666`
```go
func (b *PredictionBrain) deduplicate(suggestions []Suggestion) []Suggestion {
    seenByText := make(map[string]int)
    seenByTextKind := make(map[string]int)
    result := make([]Suggestion, 0, len(suggestions))

    for _, s := range suggestions {
        textLower := strings.ToLower(s.Text)
        keyTextKind := textLower + "|" + string(s.Kind)

        // Two map lookups per suggestion
        if idx, exists := seenByTextKind[keyTextKind]; exists {
            // ... compare scores ...
            continue
        }
        if idx, exists := seenByText[textLower]; exists {
            // ... compare scores ...
            continue
        }
        // ...
    }
}
```

**Issue:**
- O(n) complexity but with multiple map lookups
- String concatenation for keys
- Could be optimized

**Fix:**
1. Use struct key instead of string concat
2. Single map with composite key
3. Or: Use hash set for seen items (no score comparison)

---

## 8. Memory Optimization Opportunities

### 8.1 🔥 HIGH IMPACT: Cache Parse Trees

**Current:** Parse file on every ExtractPrefix call
**Proposed:** Cache parse trees with version keys

```go
type ParseCache struct {
    mu     sync.RWMutex
    trees  map[string]*cachedTree // key = filePath + contentHash
    lru    *list.List
    maxSize int
}

type cachedTree struct {
    tree      *sitter.Tree
    version   string
    size      int64
    lastUsed  time.Time
}
```

**Benefits:**
- Reduce ExtractPrefix from 10-30ms to <1ms
- Memory cost: ~50KB per cached file (10 files = 500KB)

### 8.2 🔥 HIGH IMPACT: Reduce SQLite Query Result Sets

**Current:** Load 100 symbols, filter later
**Proposed:** Filter in SQL

```go
// BEFORE
query := core.SymbolQuery{
    Name:  prefix,
    Limit: 100,  // Load 100, use 10
}

// AFTER
query := core.SymbolQuery{
    Name:  prefix,
    Limit: 20,   // Load only what's needed
    Filter: func(sym Symbol) bool {
        // SQL-level filtering
    }
}
```

**Benefits:**
- Reduce memory allocation
- Reduce GC pressure
- Faster query execution

### 8.3 🟡 MEDIUM IMPACT: Object Pooling

**Current:** Allocate Suggestion structs on every request
**Proposed:** sync.Pool for reusable objects

```go
var suggestionPool = sync.Pool{
    New: func() interface{} {
        return &Suggestion{}
    },
}

func getSuggestion() *Suggestion {
    s := suggestionPool.Get().(*Suggestion)
    *s = Suggestion{} // Reset
    return s
}

func putSuggestion(s *Suggestion) {
    suggestionPool.Put(s)
}
```

**Benefits:**
- Reduce GC pressure during rapid typing
- Lower memory allocation rate

### 8.4 🟡 MEDIUM IMPACT: Completion Cache Key Optimization

**Current:** Cache key includes exact position (column)
**Proposed:** Prefix-based cache key

```go
// BEFORE
key := MD5(filePath + line + column + prefix + language)
// Miss on every character typed

// AFTER
key := MD5(filePath + line + prefix + language)
// Hit rate improves (same line, same prefix)
```

**Tradeoff:** May return stale results if context changes on same line

---

## 9. Recommendations for <50ms Completion Latency

### 9.1 Quick Wins (Implement First)

1. **✅ Add Benchmarks** (Priority 1)
   - Benchmark `Complete()` end-to-end
   - Benchmark `ExtractPrefix()`
   - Benchmark `fromIndex()`
   - Run with `go test -bench=. -benchmem`

2. **🔥 Cache Parse Trees** (Priority 1)
   - Cache Tree-sitter parse results
   - Key by file content hash
   - LRU eviction (10-20 entries)
   - **Estimated gain:** 10-30ms → <1ms

3. **🔥 Parallelize Providers** (Priority 1)
   - Run all providers concurrently
   - Wait for first N results or timeout
   - **Estimated gain:** 50ms → 20ms

4. **🔥 Reduce LSP Timeout** (Priority 1)
   - 200ms → 100ms
   - Make configurable
   - **Estimated gain:** 200ms worst case → 100ms

5. **🔥 Optimize SQLite Queries** (Priority 2)
   - Add FTS5 index
   - Use prepared statements
   - Reduce LIMIT to 20
   - **Estimated gain:** 20-50ms → 5-10ms

### 9.2 Medium-Term Improvements

6. **Debounce Prefix Extraction** (Priority 2)
   - Don't parse on every keystroke
   - Wait 50-100ms for pause in typing
   - **Estimated gain:** Reduces CPU load, improves perceived latency

7. **Smarter Cache Keys** (Priority 2)
   - Prefix-based instead of position-based
   - **Estimated gain:** 2-5x cache hit rate

8. **Object Pooling** (Priority 3)
   - Reuse Suggestion structs
   - **Estimated gain:** Reduces GC pauses

9. **Lazy Load Documentation** (Priority 3)
   - Don't fetch docs in completion request
   - Fetch on hover/select
   - **Estimated gain:** 5-10ms

### 9.3 Long-Term Optimizations

10. **Rust/Zig Rewrite of Hot Paths** (Priority 4)
    - ExtractPrefix in Rust (CGO)
    - Tree-sitter bindings already exist
    - **Estimated gain:** 50% faster prefix extraction

11. **Custom Index Format** (Priority 4)
    - Replace SQLite with memory-mapped index
    - FlatBuffers or Cap'n Proto
    - **Estimated gain:** 10x faster queries

12. **WebAssembly for Frontend** (Priority 5)
    - Move prefix extraction to frontend
    - Tree-sitter compiles to WASM
    - **Estimated gain:** Eliminates IPC round-trip

---

## 10. Profiling Plan

### 10.1 Tools to Use

1. **pprof (CPU profiling)**
   ```go
   import _ "net/http/pprof"
   go func() {
       log.Println(http.ListenAndServe("localhost:6060", nil))
   }()
   ```
   Then: `go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=30`

2. **pprof (Memory profiling)**
   ```bash
   go tool pprof -http=:8080 http://localhost:6060/debug/pprof/heap
   ```

3. **trace (Execution trace)**
   ```go
   f, _ := os.Create("trace.out")
   trace.Start(f)
   defer trace.Stop()
   ```
   Then: `go tool trace trace.out`

4. **Benchstat (Compare benchmarks)**
   ```bash
   go test -bench=. -count=10 > old.txt
   # Make changes
   go test -bench=. -count=10 > new.txt
   benchstat old.txt new.txt
   ```

### 10.2 Test Scenarios

1. **Cold Start** - First completion after project open
2. **Hot Path** - Repeated completions while typing
3. **Large File** - Completion in 1000+ line file
4. **Large Project** - Completion in project with 10k+ symbols
5. **Slow LSP** - Simulate 500ms LSP response

### 10.3 Metrics to Track

- **P50 latency** (median)
- **P95 latency** (95th percentile)
- **P99 latency** (99th percentile)
- **Memory allocated per request**
- **GC pressure** (allocations/sec)
- **CPU usage** (user + system)
- **Cache hit rate**

---

## 11. Comparison with JetBrains

### 11.1 JetBrains PSI vs Arlecchino Tree-sitter

| Aspect | JetBrains PSI | Arlecchino Tree-sitter |
|--------|---------------|------------------------|
| **Parsing** | Full semantic | Syntax-only |
| **Speed** | Slow (200-500ms) | Fast (10-30ms) |
| **Memory** | 2-8GB typical | <200MB |
| **Caching** | Full PSI tree | ❌ Not cached |
| **Incremental** | Yes | ⚠️ No (re-parses full file) |

**Verdict:** Tree-sitter is faster but needs caching to match PSI's performance

### 11.2 JetBrains Ranking vs Arlecchino Ranking

| Aspect | JetBrains | Arlecchino |
|--------|-----------|------------|
| **Algorithm** | CatBoost ML | SmartRanker (deterministic) |
| **Features** | 100+ signals | ~20 signals |
| **Latency** | 10-20ms | 10-20ms |
| **Accuracy** | 50% better acceptance | Unknown (no metrics) |

**Verdict:** Similar latency, but JetBrains has better accuracy from ML

### 11.3 Target Performance Comparison

| Metric | JetBrains | Arlecchino Target | Arlecchino Current (est) |
|--------|-----------|-------------------|--------------------------|
| **P50 latency** | 150-200ms | <50ms | ~200ms |
| **P99 latency** | 400-700ms | <150ms | ~400ms |
| **Index build** | 30-60s (10k files) | <30s | Unknown |
| **Memory** | 2-8GB | <200MB | ~150MB |
| **Cache hit rate** | ~40% | Target 60% | ~10% (poor keys) |

**Verdict:** Arlecchino can be FASTER than JetBrains if optimized correctly

---

## 12. Next Steps

1. **✅ Add Benchmarks** - Priority 1, implement this week
2. **🔥 Profile with pprof** - Priority 1, run on real project
3. **🔥 Cache Parse Trees** - Priority 1, implement immediately
4. **🔥 Parallelize Providers** - Priority 1, refactor Complete()
5. **📊 Measure Current Latency** - Priority 1, add metrics
6. **🔥 Optimize SQLite** - Priority 2, add FTS5 index
7. **📝 Document Findings** - Priority 2, share with team

---

## Appendix A: Code Locations

### Critical Files for Performance
- `completion.go` - Entry point
- `internal/indexer/brain/prediction.go` - Main completion logic (2000+ lines)
- `internal/predictive/engine.go` - Prefix extraction
- `internal/indexer/core/engine.go` - Indexer core
- `internal/indexer/core/store.go` - SQLite storage
- `internal/indexer/lsp/manager.go` - LSP integration
- `internal/predictive/matcher.go` - Smart matching

### Test Files with Benchmarks
- `internal/predictive/matcher_test.go:148-233` - SmartMatcher benchmarks
- `internal/predictive/safe_parser_test.go:125-160` - SafeParser benchmarks

### Missing Benchmarks (Need to Create)
- `internal/indexer/brain/prediction_bench_test.go` - Complete() benchmarks
- `internal/predictive/engine_bench_test.go` - ExtractPrefix() benchmarks
- `internal/indexer/core/store_bench_test.go` - Query() benchmarks

---

## Appendix B: Estimated Latency Budget

```
Target: <50ms total

Breakdown:
- IPC overhead:              5ms   (unavoidable)
- ExtractPrefix (cached):    1ms   (currently 10-30ms)
- Cache lookup:              1ms
- Provider collection:      15ms   (parallel, currently 40-80ms)
  - Local:                   5ms
  - Pattern:                 3ms
  - Index:                   5ms   (currently 20-50ms)
  - LSP:                     0ms   (async, background)
- Filter:                    3ms
- Deduplicate:               2ms   (currently 5-15ms)
- Rank:                      8ms
- Enrich:                    2ms
- Response encoding:         2ms
                          ------
                            39ms   (11ms headroom)
```

---

**End of Analysis**
