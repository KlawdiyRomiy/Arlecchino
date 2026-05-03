package brain

import (
	"testing"
	"time"
)

func TestCompletionCache_KeyIncludesAccessChainAndContextFlags(t *testing.T) {
	cache := NewCompletionCache(10, time.Minute)

	ctxA := CompletionContext{
		FilePath:     "/tmp/a.php",
		Line:         10,
		Column:       5,
		Prefix:       "g",
		Language:     "php",
		AccessChain:  "Route::",
		IsStaticCall: true,
	}
	ctxB := ctxA
	ctxB.AccessChain = "Auth::"

	cache.Set(ctxA, []Suggestion{{Text: "get"}})
	cache.Set(ctxB, []Suggestion{{Text: "guard"}})

	a, ok := cache.Get(ctxA)
	if !ok || len(a) != 1 || a[0].Text != "get" {
		t.Fatalf("expected cache hit for ctxA")
	}
	b, ok := cache.Get(ctxB)
	if !ok || len(b) != 1 || b[0].Text != "guard" {
		t.Fatalf("expected cache hit for ctxB")
	}

	// String/import flags must also separate caches.
	ctxC := ctxA
	ctxC.AccessChain = ""
	ctxC.InImport = true
	cache.Set(ctxC, []Suggestion{{Text: "import_path"}})

	ctxD := ctxA
	ctxD.InString = true
	ctxD.StringContextType = "path"
	cache.Set(ctxD, []Suggestion{{Text: "string_path"}})

	c, ok := cache.Get(ctxC)
	if !ok || len(c) != 1 || c[0].Text != "import_path" {
		t.Fatalf("expected cache hit for ctxC")
	}
	d, ok := cache.Get(ctxD)
	if !ok || len(d) != 1 || d[0].Text != "string_path" {
		t.Fatalf("expected cache hit for ctxD")
	}
}

func TestCompletionCache_KeyIncludesImportsHash(t *testing.T) {
	cache := NewCompletionCache(10, time.Minute)

	ctxA := CompletionContext{
		FilePath:    "/tmp/main.go",
		Line:        5,
		Prefix:      "Pr",
		Language:    "go",
		ImportsHash: "imports-a",
	}
	ctxB := ctxA
	ctxB.ImportsHash = "imports-b"

	cache.Set(ctxA, []Suggestion{{Text: "Println"}})
	cache.Set(ctxB, []Suggestion{{Text: "Printf"}})

	a, ok := cache.Get(ctxA)
	if !ok || len(a) != 1 || a[0].Text != "Println" {
		t.Fatalf("expected cache hit for ctxA")
	}
	b, ok := cache.Get(ctxB)
	if !ok || len(b) != 1 || b[0].Text != "Printf" {
		t.Fatalf("expected cache hit for ctxB")
	}
}

func TestCompletionCache_KeyIncludesDocumentVersion(t *testing.T) {
	cache := NewCompletionCache(10, time.Minute)

	ctxA := CompletionContext{
		FilePath:        "/tmp/main.go",
		Line:            8,
		Prefix:          "",
		Language:        "go",
		AccessChain:     "account.",
		IsMethodCall:    true,
		DocumentVersion: 1,
	}
	ctxB := ctxA
	ctxB.DocumentVersion = 2

	cache.Set(ctxA, []Suggestion{{Text: "ID"}})
	cache.Set(ctxB, []Suggestion{{Text: "DisplayName"}})

	a, ok := cache.Get(ctxA)
	if !ok || len(a) != 1 || a[0].Text != "ID" {
		t.Fatalf("expected cache hit for ctxA")
	}
	b, ok := cache.Get(ctxB)
	if !ok || len(b) != 1 || b[0].Text != "DisplayName" {
		t.Fatalf("expected cache hit for ctxB")
	}
}
