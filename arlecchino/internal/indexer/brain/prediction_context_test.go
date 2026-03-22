package brain

import "testing"

func TestContentLineOffset(t *testing.T) {
	ctx := CompletionContext{
		Line:             10,
		ContentStartLine: 6,
	}

	if got := contentLine(ctx); got != 5 {
		t.Fatalf("expected content line 5, got %d", got)
	}
	if got := contentLineOffset(ctx); got != 5 {
		t.Fatalf("expected offset 5, got %d", got)
	}
}

func TestContentLine_Defaults(t *testing.T) {
	ctx := CompletionContext{
		Line:             7,
		ContentStartLine: 0,
	}

	if got := contentLine(ctx); got != 7 {
		t.Fatalf("expected content line 7, got %d", got)
	}
	if got := contentLineOffset(ctx); got != 0 {
		t.Fatalf("expected offset 0, got %d", got)
	}
}

func TestIsCanceled(t *testing.T) {
	ctx := CompletionContext{}
	if isCanceled(ctx) {
		t.Fatalf("expected not canceled for nil context")
	}
}
