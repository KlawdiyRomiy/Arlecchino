package lsp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func diagnosticsTarget(language, filePath string) DiagnosticsPublicationTarget {
	return DiagnosticsPublicationTarget{Language: language, FilePath: filePath}
}

func publishDiagnosticsParams(t *testing.T, filePath string, diagnostics []Diagnostic) json.RawMessage {
	t.Helper()
	params, err := json.Marshal(PublishDiagnosticsParams{
		URI:         FilePathToURI(filePath),
		Diagnostics: diagnostics,
	})
	if err != nil {
		t.Fatalf("Marshal PublishDiagnosticsParams: %v", err)
	}
	return params
}

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

func TestTransientCloseDoesNotClearDiagnosticsSnapshot(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{
		Language: "go",
		Command:  "/definitely/missing/gopls",
		RootURI:  "file://" + t.TempDir(),
	})
	results := make(chan []Diagnostic, 2)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/preloaded.go"
	m.markDocTransientOpen("go", filePath, 1)
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "preload diagnostic"}})
	<-results

	if err := m.DidCloseTransient("go", filePath); err != nil {
		t.Fatalf("DidCloseTransient error = %v", err)
	}

	select {
	case cleared := <-results:
		t.Fatalf("transient close emitted diagnostics clear: %#v", cleared)
	default:
	}

	stored := m.GetDiagnostics("go", filePath)
	if len(stored) != 1 || stored[0].Message != "preload diagnostic" {
		t.Fatalf("expected transient preload diagnostics to survive close, got %#v", stored)
	}
}

func TestTransientCloseSuppressesCloseInducedEmptyDiagnostics(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan []Diagnostic, 2)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/preloaded.go"
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "preload diagnostic"}})
	<-results

	m.suppressTransientCloseDiagnosticsClear("go", filePath)
	m.setDiagnostics("go", filePath, nil)

	select {
	case cleared := <-results:
		t.Fatalf("close-induced empty diagnostics should be suppressed, got %#v", cleared)
	default:
	}

	stored := m.GetDiagnostics("go", filePath)
	if len(stored) != 1 || stored[0].Message != "preload diagnostic" {
		t.Fatalf("expected diagnostics to survive close-induced empty publish, got %#v", stored)
	}
}

func TestPublishDiagnosticsEmptyClearsStore(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan []Diagnostic, 2)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/published.go"
	m.handleNotification("go", "textDocument/publishDiagnostics", publishDiagnosticsParams(t, filePath, []Diagnostic{{Message: "boom"}}))
	<-results

	m.handleNotification("go", "textDocument/publishDiagnostics", publishDiagnosticsParams(t, filePath, nil))

	cleared := <-results
	if len(cleared) != 0 {
		t.Fatalf("expected real empty publish to clear diagnostics, got %#v", cleared)
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 0 {
		t.Fatalf("expected real empty publish to clear store, got %#v", stored)
	}
}

func TestCloseSuppressionCoversProtocolPublishDiagnosticsEmpty(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan []Diagnostic, 2)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/preloaded.go"
	m.handleNotification("go", "textDocument/publishDiagnostics", publishDiagnosticsParams(t, filePath, []Diagnostic{{Message: "preload diagnostic"}}))
	<-results

	m.suppressTransientCloseDiagnosticsClear("go", filePath)
	m.handleNotification("go", "textDocument/publishDiagnostics", publishDiagnosticsParams(t, filePath, nil))

	select {
	case cleared := <-results:
		t.Fatalf("close-induced protocol empty diagnostics should be suppressed, got %#v", cleared)
	default:
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 1 || stored[0].Message != "preload diagnostic" {
		t.Fatalf("expected diagnostics to survive close-induced protocol empty publish, got %#v", stored)
	}
}

func TestTransientCloseSuppressionCoversRepeatedCloseInducedEmptyDiagnostics(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan []Diagnostic, 3)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/preloaded.go"
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "stale diagnostic"}})
	<-results

	m.suppressTransientCloseDiagnosticsClear("go", filePath)
	m.setDiagnostics("go", filePath, nil)

	select {
	case cleared := <-results:
		t.Fatalf("first close-induced empty diagnostics should be suppressed, got %#v", cleared)
	default:
	}

	m.setDiagnostics("go", filePath, nil)
	select {
	case cleared := <-results:
		t.Fatalf("repeated close-induced empty diagnostics should be suppressed, got %#v", cleared)
	default:
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 1 || stored[0].Message != "stale diagnostic" {
		t.Fatalf("expected diagnostics to survive repeated close-induced empty publishes, got %#v", stored)
	}
}

func TestTransientCloseSuppressionClearedByRealDocumentLifecycle(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan []Diagnostic, 3)

	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/reopened.go"
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "stale diagnostic"}})
	<-results

	m.suppressTransientCloseDiagnosticsClear("go", filePath)
	m.clearTransientCloseDiagnosticsClear("go", filePath)
	m.setDiagnostics("go", filePath, nil)

	cleared := <-results
	if len(cleared) != 0 {
		t.Fatalf("expected real lifecycle clear to allow empty diagnostics, got %#v", cleared)
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 0 {
		t.Fatalf("expected diagnostics to be cleared after real reopen/change, got %#v", stored)
	}
}

func TestStopAllClearsTransientCloseSuppressionState(t *testing.T) {
	m := NewManager(t.TempDir())
	m.suppressTransientCloseDiagnosticsClear("go", "/tmp/preloaded.go")

	m.StopAll()

	m.diagnosticsMu.RLock()
	defer m.diagnosticsMu.RUnlock()
	if len(m.transientCloseClears) != 0 {
		t.Fatalf("expected StopAll to clear transient suppression state, got %#v", m.transientCloseClears)
	}
}

func TestResetRuntimeStateClearsTransientCloseSuppressionState(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{
		Language: "go",
		Command:  "/definitely/missing/gopls",
		RootURI:  "file://" + t.TempDir(),
	})
	m.suppressTransientCloseDiagnosticsClear("go", "/tmp/preloaded.go")

	resetLanguages := m.ResetRuntimeState(nil, false)
	if len(resetLanguages) != 1 || resetLanguages[0] != "go" {
		t.Fatalf("unexpected reset languages: %#v", resetLanguages)
	}

	m.diagnosticsMu.RLock()
	defer m.diagnosticsMu.RUnlock()
	if len(m.transientCloseClears) != 0 {
		t.Fatalf("expected ResetRuntimeState to clear transient suppression state, got %#v", m.transientCloseClears)
	}
}

func TestResetRuntimeStateEvictsDiagnostics(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{
		Language: "go",
		Command:  "/definitely/missing/gopls",
		RootURI:  "file://" + t.TempDir(),
	})
	results := make(chan []Diagnostic, 2)
	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/reset.go"
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "reset evicts"}})
	<-results

	m.ResetRuntimeState([]string{"go"}, false)
	cleared := <-results
	if len(cleared) != 0 {
		t.Fatalf("expected reset to emit diagnostics clear, got %#v", cleared)
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 0 {
		t.Fatalf("expected reset to evict diagnostics, got %#v", stored)
	}
}

func TestDidOpenReturnsStartError(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{
		Language: "go",
		Command:  "/definitely/missing/gopls",
		RootURI:  "file://" + t.TempDir(),
	})

	err := m.DidOpen("go", "/tmp/broken.go", "package main\n")
	if err == nil {
		t.Fatal("expected DidOpen to return LSP start error")
	}
	if m.IsDocOpen("go", "/tmp/broken.go") {
		t.Fatal("document should not be marked open when LSP start fails")
	}
}

func TestDidCloseDoesNotEmitDiagnosticsClear(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{
		Language: "go",
		Command:  "/definitely/missing/gopls",
		RootURI:  "file://" + t.TempDir(),
	})
	results := make(chan []Diagnostic, 2)
	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/closed.go"
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "must remain"}})
	<-results
	m.markDocUserOpen("go", filePath, 1)

	if err := m.DidClose("go", filePath); err != nil {
		t.Fatalf("DidClose error = %v", err)
	}

	select {
	case cleared := <-results:
		t.Fatalf("DidClose emitted diagnostics clear: %#v", cleared)
	default:
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 1 || stored[0].Message != "must remain" {
		t.Fatalf("expected diagnostics to survive DidClose, got %#v", stored)
	}
}

func TestStopDoesNotEmitDiagnosticsClear(t *testing.T) {
	m := NewManager(t.TempDir())
	m.RegisterServer(ServerConfig{Language: "go", Command: "/definitely/missing/gopls"})
	m.mu.Lock()
	m.servers["go"] = &Server{}
	m.mu.Unlock()
	results := make(chan []Diagnostic, 2)
	m.SetDiagnosticsCallback(func(_ string, _ string, diagnostics []Diagnostic) {
		results <- diagnostics
	})

	filePath := "/tmp/idle.go"
	m.setDiagnostics("go", filePath, []Diagnostic{{Message: "idle retained"}})
	<-results

	if err := m.Stop("go"); err != nil {
		t.Fatalf("Stop error = %v", err)
	}

	select {
	case cleared := <-results:
		t.Fatalf("Stop emitted diagnostics clear: %#v", cleared)
	default:
	}
	if stored := m.GetDiagnostics("go", filePath); len(stored) != 1 || stored[0].Message != "idle retained" {
		t.Fatalf("expected diagnostics to survive Stop, got %#v", stored)
	}
}

func TestDidRenameFilesRemapsDiagnosticsCache(t *testing.T) {
	m := NewManager(t.TempDir())
	oldPath := "/tmp/src/old.go"
	newPath := "/tmp/src/new.go"
	m.setDiagnostics("go", oldPath, []Diagnostic{{Message: "renamed"}})
	m.DidRenameFiles([]FileRename{{OldURI: FilePathToURI(oldPath), NewURI: FilePathToURI(newPath)}})

	if stored := m.GetDiagnostics("go", oldPath); len(stored) != 0 {
		t.Fatalf("expected old path diagnostics to be remapped away, got %#v", stored)
	}
	if stored := m.GetDiagnostics("go", newPath); len(stored) != 1 || stored[0].Message != "renamed" {
		t.Fatalf("expected diagnostics under new path, got %#v", stored)
	}
}

func TestPruneDiagnosticsForPathClearsCacheAndNotifies(t *testing.T) {
	m := NewManager(t.TempDir())
	results := make(chan struct {
		filePath    string
		diagnostics []Diagnostic
	}, 2)
	m.SetDiagnosticsCallback(func(_ string, filePath string, diagnostics []Diagnostic) {
		results <- struct {
			filePath    string
			diagnostics []Diagnostic
		}{filePath: filePath, diagnostics: diagnostics}
	})

	removedPath := "/tmp/src/deleted.go"
	keptPath := "/tmp/src/kept.go"
	m.setDiagnostics("go", removedPath, []Diagnostic{{Message: "deleted"}})
	<-results
	m.setDiagnostics("go", keptPath, []Diagnostic{{Message: "kept"}})
	<-results

	m.PruneDiagnosticsForPath("/tmp/src/deleted.go")
	cleared := <-results
	if cleared.filePath != removedPath || len(cleared.diagnostics) != 0 {
		t.Fatalf("expected deleted path clear, got %#v", cleared)
	}
	if stored := m.GetDiagnostics("go", removedPath); len(stored) != 0 {
		t.Fatalf("expected removed path pruned, got %#v", stored)
	}
	if stored := m.GetDiagnostics("go", keptPath); len(stored) != 1 || stored[0].Message != "kept" {
		t.Fatalf("expected sibling path retained, got %#v", stored)
	}
}

func TestWaitForDiagnosticsPublicationsWaitsForTrackedFiles(t *testing.T) {
	m := NewManager(t.TempDir())
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	start := time.Now()
	go func() {
		time.Sleep(40 * time.Millisecond)
		m.setDiagnostics("go", "/tmp/first.go", []Diagnostic{{Message: "first"}})
		time.Sleep(40 * time.Millisecond)
		m.setDiagnostics("go", "/tmp/second.go", nil)
	}()

	if !m.WaitForDiagnosticsPublications(ctx, []DiagnosticsPublicationTarget{
		diagnosticsTarget("go", "/tmp/first.go"),
		diagnosticsTarget("go", "/tmp/second.go"),
	}) {
		t.Fatalf("expected tracked publications to arrive before timeout")
	}

	if elapsed := time.Since(start); elapsed < 70*time.Millisecond {
		t.Fatalf("expected wait to include both tracked publications, got %s", elapsed)
	}
}

func TestWaitForDiagnosticsPublicationsTimesOutWhenTrackedFileIsMissing(t *testing.T) {
	m := NewManager(t.TempDir())
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()

	go func() {
		time.Sleep(30 * time.Millisecond)
		m.setDiagnostics("go", "/tmp/first.go", []Diagnostic{{Message: "first"}})
	}()

	if m.WaitForDiagnosticsPublications(ctx, []DiagnosticsPublicationTarget{
		diagnosticsTarget("go", "/tmp/first.go"),
		diagnosticsTarget("go", "/tmp/missing.go"),
	}) {
		t.Fatalf("expected wait to stop when tracked publication never arrives")
	}
}

func TestWaitForDiagnosticsPublicationsSinceAcceptsPublicationBeforeWait(t *testing.T) {
	m := NewManager(t.TempDir())
	tracked := m.CaptureDiagnosticsPublicationBaseline([]DiagnosticsPublicationTarget{
		diagnosticsTarget("go", "/tmp/fast.go"),
	})
	m.setDiagnostics("go", "/tmp/fast.go", []Diagnostic{{Message: "fast"}})

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	if !m.WaitForDiagnosticsPublicationsSince(ctx, tracked) {
		t.Fatalf("expected baseline wait to accept publication that arrived before wait")
	}
}

func TestDiagnosticsPublicationTrackingIsLanguageScoped(t *testing.T) {
	m := NewManager(t.TempDir())
	filePath := "/tmp/shared.tsx"
	tracked := m.CaptureDiagnosticsPublicationBaseline([]DiagnosticsPublicationTarget{
		diagnosticsTarget("typescript", filePath),
		diagnosticsTarget("javascript", filePath),
	})

	m.setDiagnostics("typescript", filePath, []Diagnostic{{Message: "ts"}})
	if m.haveDiagnosticsPublicationsSince(tracked) {
		t.Fatalf("one language publish should not satisfy another language bucket")
	}

	m.setDiagnostics("javascript", filePath, nil)
	if !m.haveDiagnosticsPublicationsSince(tracked) {
		t.Fatalf("expected both language buckets to be satisfied")
	}
}
