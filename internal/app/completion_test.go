package app

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
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
	prefixInfo    predictive.PrefixInfo
	hasPrefixInfo bool

	seenCtx brain.CompletionContext
}

func (f *fakeBrain) ExtractPrefix(filePath string, content []byte, line, column int) predictive.PrefixInfo {
	if f.hasPrefixInfo {
		return f.prefixInfo
	}
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

func (f *fakeBrain) ResolveCompletionItem(ctx context.Context, req brain.CompletionResolveRequest) (brain.ResolvedCompletion, error) {
	return brain.ResolvedCompletion{}, nil
}

func (f *fakeBrain) LastCompletionTrace() brain.CompletionTrace {
	return brain.CompletionTrace{}
}

func (f *fakeBrain) CompletionTraceForRequest(requestID string) (brain.CompletionTrace, bool) {
	return brain.CompletionTrace{}, false
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

func TestEditorCompletionAccessMemberAuthoritativeAcceptsLSPMemberProof(t *testing.T) {
	if !editorCompletionAccessMemberAuthoritative(brain.Suggestion{Source: core.SourceIndex}, "lsp-member") {
		t.Fatal("expected lsp-member proof to be authoritative in access context")
	}
	if !editorCompletionAccessMemberAuthoritative(brain.Suggestion{
		Source:    core.SourceIndex,
		Namespace: "Route",
	}, "self-static-member") {
		t.Fatal("expected indexed static member proof with namespace to be authoritative")
	}
	if editorCompletionAccessMemberAuthoritative(brain.Suggestion{Source: core.SourceLSP}, "lsp-fallback-member") {
		t.Fatal("did not expect fallback-only member proof to be actionable in access context")
	}
	if editorCompletionAccessMemberAuthoritative(brain.Suggestion{Source: core.SourceLSP}, "project-symbol") {
		t.Fatal("did not expect generic LSP source to be authoritative without member proof")
	}
	if editorCompletionAccessMemberAuthoritative(brain.Suggestion{
		Source:    core.SourcePredictive,
		Namespace: "Route",
	}, "self-static-member") {
		t.Fatal("did not expect predictive/template static members to be authoritative")
	}
	if editorCompletionAccessMemberAuthoritative(brain.Suggestion{
		Source:    core.SourceLibrary,
		Namespace: "axios",
	}, "receiver-member") {
		t.Fatal("did not expect library catalog members to be authoritative without LSP/import proof")
	}
}

func TestEditorCompletionRequiresSafeEditsBeforeApply(t *testing.T) {
	if !editorCompletionRequiresSafeEditsBeforeApply(false, brain.Suggestion{
		Source: core.SourceLSP,
		Kind:   core.SymbolKindPackage,
	}, "lsp-resolve-edit", false) {
		t.Fatal("expected bare package completion outside import context to require safe edits")
	}
	if editorCompletionRequiresSafeEditsBeforeApply(true, brain.Suggestion{
		Source: core.SourceLSP,
		Kind:   core.SymbolKindPackage,
	}, "lsp-resolve-edit", false) {
		t.Fatal("did not expect import-context package completion to require safe edit side effects")
	}
	if !editorCompletionRequiresSafeEditsBeforeApply(false, brain.Suggestion{
		Source: core.SourceLSP,
		Command: &lsp.Command{
			Title:   "apply import",
			Command: "apply",
		},
	}, "lsp-resolve-edit", false) {
		t.Fatal("expected command-backed completion to require safe text edits before apply")
	}
	if editorCompletionRequiresSafeEditsBeforeApply(false, brain.Suggestion{
		Source: core.SourceLSP,
		Kind:   core.SymbolKindMethod,
	}, "lsp-resolve-edit", false) {
		t.Fatal("did not expect plain LSP method resolve metadata to require safe edits")
	}
}

func TestEditorCompletionRequiresResolveBeforeApply(t *testing.T) {
	primaryEdit := &brain.CompletionPrimaryTextEdit{NewText: "log.Fatal($0)"}
	importEdit := []core.TextEdit{{StartLine: 2, StartColumn: 1, EndLine: 2, EndColumn: 1, Text: "import \"log\"\n\n"}}

	tests := []struct {
		name              string
		resolveToken      string
		primaryTextEdit   *brain.CompletionPrimaryTextEdit
		additionalEdits   []core.TextEdit
		command           *lsp.Command
		requiresSafeEdits bool
		want              bool
	}{
		{name: "no token", requiresSafeEdits: true, want: false},
		{name: "ready import edit", resolveToken: "token", additionalEdits: importEdit, requiresSafeEdits: true, want: false},
		{name: "plain primary edit metadata resolve", resolveToken: "token", primaryTextEdit: primaryEdit, want: false},
		{name: "primary-only import-required edit", resolveToken: "token", primaryTextEdit: primaryEdit, requiresSafeEdits: true, want: true},
		{name: "safe edit required but unresolved", resolveToken: "token", requiresSafeEdits: true, want: true},
		{name: "plain metadata resolve", resolveToken: "token", want: false},
		{name: "command side effect", resolveToken: "token", command: &lsp.Command{Title: "apply import", Command: "apply"}, requiresSafeEdits: true, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := editorCompletionRequiresResolveBeforeApply(tt.resolveToken, tt.primaryTextEdit, tt.additionalEdits, tt.command, tt.requiresSafeEdits)
			if got != tt.want {
				t.Fatalf("requiresResolveBeforeApply = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEditorCompletionFallbackMemberDoesNotTrustSideEffects(t *testing.T) {
	if editorCompletionTrustsSideEffects("lsp-fallback-member") {
		t.Fatal("did not expect fallback-only member proof to trust import or resolve side effects")
	}
	if !editorCompletionTrustsSideEffects("lsp-member") {
		t.Fatal("expected validated LSP member proof to trust completion side effects")
	}
	if editorCompletionAutoImportAllowed(brain.Suggestion{
		AutoImportAllowed:   true,
		AdditionalTextEdits: []core.TextEdit{{Text: `import "log"`}},
	}, "lsp-fallback-member") {
		t.Fatal("did not expect fallback-only member proof to allow auto-import")
	}
}

func TestEditorCompletionResolveBudgetAllowsLSPAutoImport(t *testing.T) {
	if editorCompletionResolveTimeout < 750*time.Millisecond {
		t.Fatalf("resolve timeout = %s, want enough budget for LSP auto-import resolve", editorCompletionResolveTimeout)
	}
	if editorCompletionResolveRefTTL < 30*time.Second {
		t.Fatalf("resolve ref TTL = %s, want enough time for popup selection dwell", editorCompletionResolveRefTTL)
	}
}

func TestRememberEditorCompletionResolveRefCapsStoredRefs(t *testing.T) {
	app := &App{}
	for i := 0; i < editorCompletionResolveRefLimit+10; i++ {
		app.rememberEditorCompletionResolveRef(
			"token-"+strconv.Itoa(i),
			editorCompletionResolveRef{createdAt: time.Now().Add(time.Duration(i) * time.Millisecond)},
		)
	}
	if got := len(app.completionResolveRefs); got > editorCompletionResolveRefLimit {
		t.Fatalf("completion resolve refs = %d, want <= %d", got, editorCompletionResolveRefLimit)
	}
}

func TestLookupEditorCompletionResolveRefRejectsExpiredRef(t *testing.T) {
	app := &App{}
	app.rememberEditorCompletionResolveRef(
		"expired-token",
		editorCompletionResolveRef{
			completionID:    "completion-expired",
			documentVersion: 7,
			createdAt:       time.Now().Add(-editorCompletionResolveRefTTL - time.Second),
		},
	)

	if _, ok := app.lookupEditorCompletionResolveRef("expired-token", EditorCompletionResolveRequest{
		CompletionID:    "completion-expired",
		DocumentVersion: 7,
	}); ok {
		t.Fatal("expected expired completion resolve ref to be rejected")
	}
	if _, exists := app.completionResolveRefs["expired-token"]; exists {
		t.Fatal("expected expired completion resolve ref to be removed")
	}
}

func TestEditorCompletionResolveRefAllowsNewerDocumentVersionForSameIdentity(t *testing.T) {
	ref := editorCompletionResolveRef{
		completionID:    "completion-log-fatal",
		stableKey:       "lsp-log-fatal",
		documentVersion: 7,
		sessionID:       "session-a",
		surfaceID:       "editor-a",
	}

	if editorCompletionResolveRefMatches(ref, EditorCompletionResolveRequest{
		CompletionID:    "completion-log-fatal",
		StableKey:       "lsp-log-fatal",
		DocumentVersion: 6,
		SessionID:       "session-a",
		SurfaceID:       "editor-a",
	}) {
		t.Fatal("expected older document version to be rejected")
	}

	if !editorCompletionResolveRefMatches(ref, EditorCompletionResolveRequest{
		CompletionID:    "completion-log-fatal",
		StableKey:       "lsp-log-fatal",
		DocumentVersion: 8,
		SessionID:       "session-a",
		SurfaceID:       "editor-a",
	}) {
		t.Fatal("expected newer document version with same completion identity to be accepted")
	}

	if editorCompletionResolveRefMatches(ref, EditorCompletionResolveRequest{
		CompletionID:    "completion-log-fatal",
		StableKey:       "different-stable-key",
		DocumentVersion: 8,
		SessionID:       "session-a",
		SurfaceID:       "editor-a",
	}) {
		t.Fatal("expected changed stable key to be rejected even with newer document version")
	}
}

func TestEditorCompletionAccessIntentUsesAccessOperator(t *testing.T) {
	ctx := EditorCompletionContext{AccessOperator: "."}
	if !editorCompletionHasAccessIntent(ctx, "") {
		t.Fatal("expected access operator to mark completion as access intent")
	}
	if !editorCompletionIsMethodCall(ctx, "") {
		t.Fatal("expected dot access operator to mark method/member call")
	}
	if editorCompletionIsStaticCall(ctx, "") {
		t.Fatal("did not expect dot access operator to mark static call")
	}
}

func TestEditorCompletionAccessOperatorStaticCall(t *testing.T) {
	ctx := EditorCompletionContext{AccessOperator: "::"}
	if !editorCompletionHasAccessIntent(ctx, "") {
		t.Fatal("expected static access operator to mark completion as access intent")
	}
	if !editorCompletionIsStaticCall(ctx, "") {
		t.Fatal("expected :: access operator to mark static call")
	}
	if editorCompletionIsMethodCall(ctx, "") {
		t.Fatal("did not expect :: access operator to mark method call")
	}
}

func TestEditorCompletionAccessInfoFromText(t *testing.T) {
	tests := []struct {
		name       string
		textBefore string
		operator   string
		wantChain  string
		wantPrefix string
	}{
		{name: "bare dot", textBefore: "router.", operator: ".", wantChain: "router.", wantPrefix: ""},
		{name: "typed dot", textBefore: "router.g", operator: ".", wantChain: "router.", wantPrefix: "g"},
		{
			name:       "bare dot in multiline text before",
			textBefore: "func main() {\n\t// context.\n\t// do not resolve `axios`\n\tfmt.",
			operator:   ".",
			wantChain:  "fmt.",
			wantPrefix: "",
		},
		{name: "static typed", textBefore: "Route::g", operator: "::", wantChain: "Route::", wantPrefix: "g"},
		{name: "arrow typed", textBefore: "ptr->b", operator: "->", wantChain: "ptr->", wantPrefix: "b"},
		{name: "numeric rejected", textBefore: "1.", operator: ".", wantChain: "", wantPrefix: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotChain, gotPrefix := editorCompletionAccessInfoFromText(tt.textBefore, tt.operator)
			if gotChain != tt.wantChain || gotPrefix != tt.wantPrefix {
				t.Fatalf("accessInfo(%q, %q) = (%q, %q), want (%q, %q)", tt.textBefore, tt.operator, gotChain, gotPrefix, tt.wantChain, tt.wantPrefix)
			}
		})
	}
}

func TestGetEditorCompletionsInfersAccessChainFromFrontendOperator(t *testing.T) {
	tests := []struct {
		name       string
		textBefore string
		column     int
		wantChain  string
		wantPrefix string
		wantString bool
	}{
		{name: "bare member", textBefore: "router.", column: len("router.") + 1, wantChain: "router.", wantPrefix: ""},
		{name: "typed member", textBefore: "router.g", column: len("router.g") + 1, wantChain: "router.", wantPrefix: "g"},
		{
			name:       "bare member with multiline full text before",
			textBefore: "func main() {\n\t// context.\n\t// No-proof probe: do not declare `axios`.\n\tfmt.",
			column:     len("\tfmt.") + 1,
			wantChain:  "fmt.",
			wantPrefix: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fb := &fakeBrain{hasPrefixInfo: true, prefixInfo: predictive.PrefixInfo{Prefix: "router"}}
			a := &App{brain: fb}

			a.GetEditorCompletions(EditorCompletionContext{
				FilePath:       "/tmp/main.go",
				Language:       "go",
				Line:           1,
				Column:         tt.column,
				LineText:       tt.textBefore,
				TextBefore:     tt.textBefore,
				FullText:       tt.textBefore,
				AccessOperator: ".",
			})

			fb.mu.Lock()
			seen := fb.seenCtx
			fb.mu.Unlock()
			if seen.AccessChain != tt.wantChain {
				t.Fatalf("AccessChain = %q, want %q", seen.AccessChain, tt.wantChain)
			}
			if seen.Prefix != tt.wantPrefix {
				t.Fatalf("Prefix = %q, want %q", seen.Prefix, tt.wantPrefix)
			}
			if seen.InString != tt.wantString {
				t.Fatalf("InString = %v, want %v", seen.InString, tt.wantString)
			}
			if !seen.IsMethodCall || seen.IsStaticCall {
				t.Fatalf("method/static flags = %v/%v, want method-only", seen.IsMethodCall, seen.IsStaticCall)
			}
		})
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
