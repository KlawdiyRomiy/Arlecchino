package app

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"arlecchino/internal/indexer/brain"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
	"arlecchino/internal/predictive"
)

type fakeBrain struct {
	mu            sync.Mutex
	calls         int
	firstStarted  chan struct{}
	firstBlock    chan struct{}
	waitForCancel bool
	sawNonNilCtx  bool
	sawCanceled   bool
	invalidated   string

	seenCtx brain.CompletionContext
}

func (f *fakeBrain) ExtractPrefix(filePath string, content []byte, line, column int) predictive.PrefixInfo {
	return predictive.PrefixInfo{Prefix: "foo"}
}

func (f *fakeBrain) Complete(ctx brain.CompletionContext) []brain.Suggestion {
	f.mu.Lock()
	f.calls += 1
	call := f.calls
	if f.calls == 1 && f.firstStarted != nil {
		close(f.firstStarted)
	}
	f.seenCtx = ctx
	f.mu.Unlock()

	if call == 1 && f.firstBlock != nil {
		<-f.firstBlock
	}

	if ctx.Ctx != nil {
		f.mu.Lock()
		f.sawNonNilCtx = true
		wait := f.waitForCancel
		f.mu.Unlock()
		if wait {
			<-ctx.Ctx.Done()
			f.mu.Lock()
			f.sawCanceled = true
			f.mu.Unlock()
			return nil
		}
	}

	return []brain.Suggestion{{Text: "foo", InsertText: "foo"}}
}

func (f *fakeBrain) ResolveCompletionItem(ctx context.Context, token string) (brain.ResolvedCompletion, error) {
	return brain.ResolvedCompletion{}, nil
}

func (f *fakeBrain) LastCompletionTrace() brain.CompletionTrace {
	return brain.CompletionTrace{}
}

func (f *fakeBrain) SelectGhostTextWithContext(ctx brain.CompletionContext, suggestions []brain.Suggestion, prefix, accessChain string) brain.GhostTextResult {
	return brain.GhostTextResult{ShouldShow: false}
}

func (f *fakeBrain) HasARLELanguageSupport(language string) bool {
	return true
}

func (f *fakeBrain) RecordCompletionShown()             {}
func (f *fakeBrain) RecordUsage(label, filePath string) {}
func (f *fakeBrain) RecordTyping(chars int)             {}
func (f *fakeBrain) RecordGhostRejected()               {}
func (f *fakeBrain) RecordFileAccess(filePath string)   {}
func (f *fakeBrain) InvalidateCompletionCache(filePath string) {
	f.mu.Lock()
	f.invalidated = filePath
	f.mu.Unlock()
}
func (f *fakeBrain) SetLSPManager(manager *lsp.Manager) {}
func (f *fakeBrain) Close()                             {}

func TestComputeCompletionImportsHashIncludesImportSection(t *testing.T) {
	frontendImports := []string{"fmt"}
	before := computeCompletionImportsHash(`package main

import "fmt"

func main() {}
`, "go", frontendImports)
	after := computeCompletionImportsHash(`package main

import (
	"fmt"
	"time"
)

func main() {}
`, "go", frontendImports)

	if before == "" || after == "" {
		t.Fatal("expected non-empty import hashes")
	}
	if before == after {
		t.Fatalf("expected import section change to alter completion hash, got %q", before)
	}
}

func TestDetectLanguageFromPathUsesCanonicalResolver(t *testing.T) {
	tests := []struct {
		filePath string
		want     string
	}{
		{filePath: "/tmp/App.tsx", want: "typescriptreact"},
		{filePath: "/tmp/App.jsx", want: "javascriptreact"},
		{filePath: "/tmp/welcome.blade.php", want: "blade"},
		{filePath: "/tmp/file.unknown", want: "unknown"},
	}

	for _, tt := range tests {
		if got := detectLanguageFromPath(tt.filePath); got != tt.want {
			t.Fatalf("detectLanguageFromPath(%q)=%q want %q", tt.filePath, got, tt.want)
		}
	}
}

func TestExtractContextLines_Windowed(t *testing.T) {
	content := "a\nb\nc\nd\ne\nf\ng\nh\ni\nj"

	window, start := extractContextLines(content, 5, 2)
	if start != 3 {
		t.Fatalf("expected start line 3, got %d", start)
	}
	expected := "c\nd\ne\nf\ng"
	if window != expected {
		t.Fatalf("unexpected window:\n%s", window)
	}
}

func TestExtractContextLines_ClampEdges(t *testing.T) {
	content := "a\nb\nc"

	window, start := extractContextLines(content, 1, 5)
	if start != 1 {
		t.Fatalf("expected start line 1, got %d", start)
	}
	if window != content {
		t.Fatalf("unexpected window at start edge")
	}

	window, start = extractContextLines(content, 3, 5)
	if start != 1 {
		t.Fatalf("expected start line 1, got %d", start)
	}
	if window != content {
		t.Fatalf("unexpected window at end edge")
	}
}

func TestExtractContextLines_EmptyOrInvalid(t *testing.T) {
	window, start := extractContextLines("", 1, 2)
	if window != "" || start != 1 {
		t.Fatalf("expected empty window with start=1")
	}

	content := "a\nb"
	window, start = extractContextLines(content, 0, 2)
	if window != content || start != 1 {
		t.Fatalf("expected full content for invalid line")
	}
}

func TestRequestOrchestration(t *testing.T) {
	fb := &fakeBrain{
		firstStarted: make(chan struct{}),
		firstBlock:   make(chan struct{}),
	}

	a := &App{brain: fb}

	ctx1 := EditorCompletionContext{
		FilePath:   "/tmp/a.go",
		Language:   "go",
		Line:       1,
		Column:     1,
		LineText:   "foo",
		TextBefore: "foo",
		TextAfter:  "",
		FullText:   "foo\n",
	}
	ctx2 := EditorCompletionContext{
		FilePath:   "/tmp/a.go",
		Language:   "go",
		Line:       1,
		Column:     1,
		LineText:   "foo",
		TextBefore: "foo",
		TextAfter:  "",
		FullText:   "foo\n",
	}

	res1Ch := make(chan EditorCompletionResult, 1)
	go func() {
		res1Ch <- a.GetEditorCompletions(ctx1)
	}()

	select {
	case <-fb.firstStarted:
	case <-time.After(2 * time.Second):
		t.Fatalf("timeout waiting for first completion to start")
	}

	res2 := a.GetEditorCompletions(ctx2)
	if res2.Stale {
		t.Fatalf("expected second result to be fresh")
	}

	close(fb.firstBlock)
	res1 := <-res1Ch
	if !res1.Stale {
		t.Fatalf("expected first result to be stale after second request")
	}
}

func TestContextCancel(t *testing.T) {
	fb := &fakeBrain{waitForCancel: true}
	a := &App{brain: fb}

	ctx := EditorCompletionContext{
		FilePath:   "/tmp/a.go",
		Language:   "go",
		Line:       1,
		Column:     1,
		LineText:   "foo",
		TextBefore: "foo",
		TextAfter:  "",
		FullText:   "foo\n",
	}

	start := time.Now()
	_ = a.GetEditorCompletions(ctx)
	elapsed := time.Since(start)
	if elapsed > 500*time.Millisecond {
		t.Fatalf("expected requestCtx timeout propagation, took %v", elapsed)
	}
	fb.mu.Lock()
	sawNonNilCtx := fb.sawNonNilCtx
	sawCanceled := fb.sawCanceled
	fb.mu.Unlock()
	if !sawNonNilCtx {
		t.Fatalf("expected brain ctx.Ctx to be non-nil")
	}
	if !sawCanceled {
		t.Fatalf("expected brain ctx.Ctx to be canceled")
	}
}

func TestGetEditorCompletionsPassesDocumentVersion(t *testing.T) {
	fb := &fakeBrain{}
	a := &App{brain: fb}

	_ = a.GetEditorCompletions(EditorCompletionContext{
		FilePath:   "/tmp/a.go",
		Language:   "go",
		Line:       1,
		Column:     4,
		Version:    42,
		LineText:   "foo",
		TextBefore: "foo",
		FullText:   "foo\n",
	})

	fb.mu.Lock()
	got := fb.seenCtx.DocumentVersion
	fb.mu.Unlock()
	if got != 42 {
		t.Fatalf("expected document version 42 in brain context, got %d", got)
	}
}

func TestNotifyFileChanged_InvalidatesCompletionCache(t *testing.T) {
	fb := &fakeBrain{}
	a := &App{brain: fb}

	a.NotifyFileChanged("/tmp/a.go", "go", 2, "package main\n")

	fb.mu.Lock()
	got := fb.invalidated
	fb.mu.Unlock()
	if got != "/tmp/a.go" {
		t.Fatalf("expected invalidated filePath %q, got %q", "/tmp/a.go", got)
	}
}

func TestNotifyFileOpenedEmitsDiagnosticsStatusOnLSPError(t *testing.T) {
	previous := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = previous
	})

	events := make(chan LSPDiagnosticsStatusEvent, 1)
	runtimeEventsEmit = func(_ context.Context, name string, data ...interface{}) {
		if name != "lsp:diagnostics:status" || len(data) == 0 {
			return
		}
		event, ok := data[0].(LSPDiagnosticsStatusEvent)
		if !ok {
			t.Fatalf("expected LSPDiagnosticsStatusEvent, got %T", data[0])
		}
		events <- event
	}

	manager := lsp.NewManager(t.TempDir())
	manager.RegisterServer(lsp.ServerConfig{
		Language: "go",
		Command:  "/definitely/missing/gopls",
		RootURI:  "file://" + t.TempDir(),
	})
	app := &App{ctx: context.Background(), lspManager: manager}
	app.setProjectPath("/tmp/project")
	app.projectGeneration.Store(9)

	app.NotifyFileOpened("/tmp/broken.go", "go", "package main\n")

	select {
	case event := <-events:
		if event.ProjectPath != "/tmp/project" || event.Generation != 9 {
			t.Fatalf("unexpected diagnostics status scope: %#v", event)
		}
		if event.Language != "go" || event.FilePath != "/tmp/broken.go" {
			t.Fatalf("unexpected diagnostics status target: %#v", event)
		}
		if event.State != "error" || event.Message == "" {
			t.Fatalf("unexpected diagnostics status: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("expected diagnostics status event")
	}
}

func TestNotifyFileChanged_RegistersUnknownFileInInventory(t *testing.T) {
	dir := t.TempDir()
	engine, err := core.NewEngine(core.EngineConfig{
		ProjectID:   dir,
		ProjectRoot: dir,
		DBPath:      filepath.Join(dir, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer engine.Stop()

	filePath := filepath.Join(dir, "notes", "draft.md")
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	a := &App{brain: &fakeBrain{}, coreEngine: engine}
	a.NotifyFileChanged(filePath, "markdown", 1, "# draft\n")

	meta, err := engine.Store().GetFile(filePath)
	if err != nil {
		t.Fatalf("GetFile: %v", err)
	}
	if meta == nil {
		t.Fatalf("expected file metadata for %s after NotifyFileChanged", filePath)
	}
	if meta.Kind != core.FileKindText {
		t.Fatalf("Kind = %q, want %q", meta.Kind, core.FileKindText)
	}
}
