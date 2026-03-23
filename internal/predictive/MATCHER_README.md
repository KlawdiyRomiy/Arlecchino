# SmartMatcher - Language-Agnostic Autocomplete Pattern Matching

## Overview

SmartMatcher is a high-performance, language-agnostic pattern matching system for autocomplete filtering in Arlecchino IDE. It's designed to work equally well with PHP, Go, TypeScript, Python, Ruby, and any other programming language.

## Design Principles

1. **Original** - Not a copy of JetBrains CamelHumpMatcher; implements novel language-agnostic word boundary detection
2. **Fast** - O(n) complexity with minimal allocations (40-208 B/op depending on match type)
3. **Extensible** - Plugins can register custom matchers via `AddMatcher()`
4. **Thread-safe** - Safe for concurrent use across multiple goroutines
5. **Unicode-aware** - Handles emoji in identifiers, non-ASCII characters, multi-byte runes

## Match Types (Priority Order)

| Type | Score | Example | Description |
|------|-------|---------|-------------|
| **Exact** | 1.0 | `getUserById` == `getUserById` | Case-insensitive exact match |
| **Prefix** | 0.9 | `get` → `getUserById` | Text starts with pattern |
| **WordBoundary** | 0.85 | `gUBI` → `getUserById` | First letters of words (camelCase, snake_case, etc.) |
| **Subsequence** | 0.7-0.8 | `gubi` → `getUserById` | Characters in order (bonus for consecutive) |
| **Contains** | 0.5 | `User` → `getUserById` | Pattern contained anywhere in text |

## Word Boundary Detection

Automatically detects boundaries in all naming conventions:

- **CamelCase**: `getUserById` → [get, User, By, Id]
- **PascalCase**: `GetUserById` → [Get, User, By, Id]
- **snake_case**: `get_user_by_id` → [get, user, by, id]
- **kebab-case**: `get-user-by-id` → [get, user, by, id]
- **Acronyms**: `HTTPServer` → [HTTP, Server]
- **Digits**: `get2UserBy3Id` → [get, 2, User, By, 3, Id]

## Usage

```go
// Create matcher (reuse across requests for best performance)
matcher := predictive.NewSmartMatcher()

// Match pattern against text
result := matcher.Match("gUBI", "getUserById")

if result.Matched {
    fmt.Printf("Type: %s, Score: %.2f\n", result.Type, result.Score)
    // Output: Type: WordBoundary, Score: 0.85
    
    // Positions for highlighting: [0, 3, 7, 9]
    fmt.Printf("Positions: %v\n", result.Positions)
}
```

### Adding Custom Matchers

```go
type myMatcher struct{}

func (m *myMatcher) Name() string { return "Custom" }

func (m *myMatcher) Match(pattern, text string) predictive.MatchResult {
    // Your custom matching logic
    if /* custom condition */ {
        return predictive.MatchResult{
            Matched: true,
            Score: 0.95,
            Type: predictive.MatchExact,
            Positions: /* matched positions */,
        }
    }
    return predictive.MatchResult{Matched: false}
}

// Add with high priority (checked before defaults)
matcher.AddMatcher(&myMatcher{}, true)

// Or low priority (fallback after defaults)
matcher.AddMatcher(&myMatcher{}, false)
```

## Performance

Benchmarks on Apple M1 (darwin/arm64):

| Operation | ns/op | B/op | allocs/op |
|-----------|-------|------|-----------|
| Exact | 42.80 | 96 | 1 |
| Prefix | 106.8 | 40 | 2 |
| WordBoundary | 370.1 | 152 | 7 |
| Subsequence | 345.6 | 136 | 5 |
| Contains | 580.1 | 208 | 10 |
| Unicode | 310.4 | 24 | 1 |

**Key metrics**:
- **< 600ns** for worst case (Contains with full scan)
- **Minimal allocations** (1-10 per match)
- **Thread-safe** (no shared mutable state)

## Integration with Autocomplete

```go
// In your autocomplete handler
func (b *PredictionBrain) filterCandidates(pattern string, candidates []Symbol) []Symbol {
    matcher := NewSmartMatcher()
    
    var results []struct {
        symbol Symbol
        match  MatchResult
    }
    
    for _, candidate := range candidates {
        result := matcher.Match(pattern, candidate.Name)
        if result.Matched {
            results = append(results, struct {
                symbol Symbol
                match  MatchResult
            }{candidate, result})
        }
    }
    
    // Sort by score (descending)
    sort.Slice(results, func(i, j int) bool {
        return results[i].match.Score > results[j].match.Score
    })
    
    // Extract sorted symbols
    filtered := make([]Symbol, len(results))
    for i, r := range results {
        filtered[i] = r.symbol
    }
    
    return filtered
}
```

## Testing

```bash
# Run all tests
go test ./internal/predictive/

# Run specific test
go test -run TestSmartMatcher_WordBoundary ./internal/predictive/

# Run benchmarks
go test -bench=. -benchmem ./internal/predictive/

# Run with coverage
go test -cover ./internal/predictive/
```

## Implementation Details

### Consecutive Bonus

Subsequence matches get a bonus (0.0-0.1) based on consecutive character density:
- All consecutive: +0.1 → score 0.8
- Half consecutive: +0.05 → score 0.75
- None consecutive: +0.0 → score 0.7

### Unicode Handling

All matchers properly handle:
- Multi-byte UTF-8 runes
- Emoji in identifiers (`get😀User`)
- Non-ASCII alphabets (Cyrillic, Chinese, Arabic, etc.)
- Normalization-agnostic matching

### Memory Optimization

- Sync.Pool for position slices (reduces GC pressure)
- Pre-allocated slices with capacity hints
- Minimal string allocations (reuse lowercased strings)

## Future Enhancements

Potential improvements (not yet implemented):
1. **Fuzzy matching** - Levenshtein distance for typos
2. **Abbreviation learning** - User-specific abbreviation patterns
3. **Context awareness** - Boost scores based on recent usage
4. **Language-specific matchers** - Optimize for language conventions

## License

Part of Arlecchino IDE - See project LICENSE
