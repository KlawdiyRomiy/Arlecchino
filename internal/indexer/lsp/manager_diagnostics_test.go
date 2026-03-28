package lsp

import "testing"

func TestSetDiagnosticsCallbackReceivesClonedSnapshot(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan struct {
		language    string
		filePath    string
		diagnostics []Diagnostic
	}, 1)

	m.SetDiagnosticsCallback(func(language, filePath string, diagnostics []Diagnostic) {
		results <- struct {
			language    string
			filePath    string
			diagnostics []Diagnostic
		}{
			language:    language,
			filePath:    filePath,
			diagnostics: diagnostics,
		}
	})

	input := []Diagnostic{{
		Severity: 1,
		Message:  "undefined symbol",
		Source:   "gopls",
	}}

	m.setDiagnostics("go", "/tmp/test.go", input)
	input[0].Message = "mutated"

	got := <-results
	if got.language != "go" {
		t.Fatalf("expected language go, got %q", got.language)
	}
	if got.filePath != "/tmp/test.go" {
		t.Fatalf("expected file path /tmp/test.go, got %q", got.filePath)
	}
	if len(got.diagnostics) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(got.diagnostics))
	}
	if got.diagnostics[0].Message != "undefined symbol" {
		t.Fatalf("expected cloned diagnostic message, got %q", got.diagnostics[0].Message)
	}

	stored := m.GetDiagnostics("go", "/tmp/test.go")
	if len(stored) != 1 {
		t.Fatalf("expected stored diagnostic, got %d", len(stored))
	}
	if stored[0].Message != "undefined symbol" {
		t.Fatalf("expected stored diagnostic to remain unchanged, got %q", stored[0].Message)
	}
}

func TestClearDiagnosticsNotifiesWithEmptySnapshot(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan []Diagnostic, 2)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	m.setDiagnostics("go", "/tmp/test.go", []Diagnostic{{Message: "boom"}})
	<-results

	m.clearDiagnostics("go", "/tmp/test.go")
	cleared := <-results
	if len(cleared) != 0 {
		t.Fatalf("expected empty diagnostics after clear, got %d", len(cleared))
	}

	stored := m.GetDiagnostics("go", "/tmp/test.go")
	if len(stored) != 0 {
		t.Fatalf("expected diagnostics store to be empty, got %d", len(stored))
	}
}
