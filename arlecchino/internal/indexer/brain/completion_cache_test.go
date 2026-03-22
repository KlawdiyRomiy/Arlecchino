package brain

import (
	"testing"
	"time"
)

func TestCompletionCache_InvalidateByFilePath(t *testing.T) {
	cache := NewCompletionCache(10, time.Minute)

	ctxA := CompletionContext{
		FilePath:    "/tmp/a.go",
		Line:        1,
		Column:      1,
		Prefix:      "fo",
		Language:    "go",
		TriggerChar: "",
	}
	ctxB := CompletionContext{
		FilePath:    "/tmp/b.go",
		Line:        2,
		Column:      3,
		Prefix:      "ba",
		Language:    "go",
		TriggerChar: "",
	}

	cache.Set(ctxA, []Suggestion{{Text: "foo"}})
	cache.Set(ctxB, []Suggestion{{Text: "bar"}})

	if _, ok := cache.Get(ctxA); !ok {
		t.Fatalf("expected cache hit for ctxA")
	}
	if _, ok := cache.Get(ctxB); !ok {
		t.Fatalf("expected cache hit for ctxB")
	}

	cache.Invalidate(ctxA.FilePath)

	if _, ok := cache.Get(ctxA); ok {
		t.Fatalf("expected cache miss for ctxA after invalidation")
	}
	if _, ok := cache.Get(ctxB); !ok {
		t.Fatalf("expected ctxB to remain cached")
	}

	cache.Invalidate("")
	if _, ok := cache.Get(ctxB); ok {
		t.Fatalf("expected cache miss for ctxB after global invalidation")
	}
}
