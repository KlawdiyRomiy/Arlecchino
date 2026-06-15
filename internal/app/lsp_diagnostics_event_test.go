package app

import (
	"testing"

	indexerlsp "arlecchino/internal/indexer/lsp"
)

func TestConvertLSPDiagnostics(t *testing.T) {
	got := convertLSPDiagnostics([]indexerlsp.Diagnostic{{
		Range: indexerlsp.Range{
			Start: indexerlsp.Position{Line: 2, Character: 4},
			End:   indexerlsp.Position{Line: 2, Character: 9},
		},
		Severity: 2,
		Code:     501,
		Source:   "gopls",
		Message:  "unused value",
	}})

	if len(got) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(got))
	}
	if got[0].Range.Start.Line != 2 || got[0].Range.Start.Character != 4 {
		t.Fatalf("expected start position 2:4, got %d:%d", got[0].Range.Start.Line, got[0].Range.Start.Character)
	}
	if got[0].Range.End.Line != 2 || got[0].Range.End.Character != 9 {
		t.Fatalf("expected end position 2:9, got %d:%d", got[0].Range.End.Line, got[0].Range.End.Character)
	}
	if got[0].Severity != 2 {
		t.Fatalf("expected severity 2, got %d", got[0].Severity)
	}
	if got[0].Code != "501" {
		t.Fatalf("expected code 501, got %q", got[0].Code)
	}
	if got[0].Source != "gopls" {
		t.Fatalf("expected source gopls, got %q", got[0].Source)
	}
	if got[0].Message != "unused value" {
		t.Fatalf("expected message unused value, got %q", got[0].Message)
	}
}

func TestConvertLSPDiagnosticsReturnsEmptySlice(t *testing.T) {
	got := convertLSPDiagnostics(nil)
	if got == nil {
		t.Fatalf("expected empty diagnostics slice, got nil")
	}
	if len(got) != 0 {
		t.Fatalf("expected empty diagnostics slice, got %d items", len(got))
	}
}

func TestNewLSPDiagnosticsEvent(t *testing.T) {
	got := newLSPDiagnosticsEvent("/tmp", 12, "go", "/tmp/test.go", []indexerlsp.Diagnostic{{
		Range: indexerlsp.Range{
			Start: indexerlsp.Position{Line: 0, Character: 1},
			End:   indexerlsp.Position{Line: 0, Character: 5},
		},
		Severity: 1,
		Message:  "boom",
	}})

	if got.Language != "go" {
		t.Fatalf("expected language go, got %q", got.Language)
	}
	if got.FilePath != "/tmp/test.go" {
		t.Fatalf("expected file path /tmp/test.go, got %q", got.FilePath)
	}
	if got.ProjectPath != "/tmp" {
		t.Fatalf("expected project path /tmp, got %q", got.ProjectPath)
	}
	if got.Generation != 12 {
		t.Fatalf("expected generation 12, got %d", got.Generation)
	}
	if got.URI != "file:///tmp/test.go" {
		t.Fatalf("expected uri file:///tmp/test.go, got %q", got.URI)
	}
	if len(got.Items) != 1 {
		t.Fatalf("expected 1 event item, got %d", len(got.Items))
	}
	if got.Items[0].Message != "boom" {
		t.Fatalf("expected message boom, got %q", got.Items[0].Message)
	}
}

func TestNewLSPDiagnosticsEventUsesArrayForEmptyItems(t *testing.T) {
	got := newLSPDiagnosticsEvent("/tmp", 12, "go", "/tmp/test.go", nil)
	if got.Items == nil {
		t.Fatalf("expected empty diagnostics event items slice, got nil")
	}
	if len(got.Items) != 0 {
		t.Fatalf("expected no diagnostics event items, got %d", len(got.Items))
	}
}
