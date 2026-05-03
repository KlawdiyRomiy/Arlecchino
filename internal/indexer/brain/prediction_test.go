package brain

import (
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/indexer/lsp"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPredictionBrain_LocalCompletions(t *testing.T) {
	config := BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  true,
	}

	brain := NewPredictionBrain(nil, config)
	if brain == nil {
		t.Fatal("Failed to create PredictionBrain")
	}

	phpContent := []byte(`<?php
class UserController
{
    private UserService $userService;
    
    public function index()
    {
        // Type here
    }
    
    public function show($id)
    {
        return $this->userService->getUser($id);
    }
}

class UserService
{
    public function getUser($id) {}
    public function createUser($data) {}
}
`)

	ctx := CompletionContext{
		FilePath:    "app/Http/Controllers/UserController.php",
		Content:     phpContent,
		Line:        9,
		Column:      15,
		Prefix:      "",
		Language:    "php",
		TriggerChar: "",
	}

	suggestions := brain.Complete(ctx)

	t.Logf("Got %d suggestions", len(suggestions))
	for i, s := range suggestions {
		if i >= 10 {
			t.Logf("... and %d more", len(suggestions)-10)
			break
		}
		t.Logf("  [%d] %s (%s) source=%s score=%.2f", i, s.Text, s.Kind, s.Source, s.Score)
	}

	localCount := 0
	for _, s := range suggestions {
		if s.Source == core.SourceLocal {
			localCount++
		}
	}

	if localCount == 0 {
		t.Error("Expected at least some local completions, got none")
	} else {
		t.Logf("Got %d local completions", localCount)
	}
}

func TestPredictionBrainReturnsFallbackBeforeSlowLSP(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "slow-lsp")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatalf("write slow lsp script: %v", err)
	}

	manager := lsp.NewManager(dir)
	manager.RegisterServer(lsp.ServerConfig{Language: "php", Command: scriptPath})

	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         true,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  true,
	})
	brain.SetLSPManager(manager)

	content := []byte(`<?php
class UserController
{
    private UserService $userService;

    public function index()
    {
        $us
    }
}

class UserService
{
    public function getUser($id) {}
}
`)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	startedAt := time.Now()
	suggestions := brain.Complete(CompletionContext{
		RequestID: "slow-lsp-fallback",
		FilePath:  filepath.Join(dir, "index.php"),
		Content:   content,
		Line:      7,
		Column:    12,
		Prefix:    "us",
		Language:  "php",
		Ctx:       ctx,
	})
	elapsed := time.Since(startedAt)

	if elapsed > 300*time.Millisecond {
		t.Fatalf("expected fallback before slow LSP, elapsed=%s suggestions=%d", elapsed, len(suggestions))
	}
	if len(suggestions) == 0 {
		t.Fatalf("expected fallback suggestions")
	}

	trace := brain.LastCompletionTrace()
	if trace.LSPStatus != "timeout" {
		t.Fatalf("expected LSP timeout trace, got %#v", trace)
	}
	if trace.DurationMs > 300 {
		t.Fatalf("expected trace duration to stay below popup budget, got %#v", trace)
	}
}

func TestPredictionBrainReturnsKeywordsBeforeSlowLSP(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "slow-go-lsp")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatalf("write slow lsp script: %v", err)
	}

	manager := lsp.NewManager(dir)
	manager.RegisterServer(lsp.ServerConfig{Language: "go", Command: scriptPath})

	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         true,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  true,
	})
	brain.SetLSPManager(manager)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	startedAt := time.Now()
	suggestions := brain.Complete(CompletionContext{
		RequestID: "slow-lsp-keyword-fallback",
		FilePath:  filepath.Join(dir, "main.go"),
		Content:   []byte("package main\n\nfu"),
		Line:      3,
		Column:    3,
		Prefix:    "fu",
		Language:  "go",
		Ctx:       ctx,
	})
	elapsed := time.Since(startedAt)

	if elapsed > 250*time.Millisecond {
		t.Fatalf("expected keyword fallback before slow LSP, elapsed=%s suggestions=%d", elapsed, len(suggestions))
	}
	if !hasSuggestionFromSource(suggestions, "func", core.SourceKeywords) {
		t.Fatalf("expected Go keyword suggestion before LSP, got %#v", suggestions)
	}

	trace := brain.LastCompletionTrace()
	if trace.SourceCounts["keywords"] == 0 {
		t.Fatalf("expected keyword source count in trace, got %#v", trace.SourceCounts)
	}
	if trace.LSPStatus != "timeout" {
		t.Fatalf("expected LSP timeout trace, got %#v", trace)
	}
}

func TestPredictionBrainUnknownLanguageSkipsHeavySources(t *testing.T) {
	dir := t.TempDir()
	manager := lsp.NewManager(dir)
	brain := NewPredictionBrain(nil, BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         true,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  true,
	})
	brain.SetLSPManager(manager)

	brain.Complete(CompletionContext{
		RequestID: "unknown-heavy-skip",
		FilePath:  filepath.Join(dir, "notes.txt"),
		Content:   []byte("plain words"),
		Line:      1,
		Column:    6,
		Prefix:    "words",
		Language:  "unknown",
	})

	trace := brain.LastCompletionTrace()
	for _, source := range []string{"predictive", "stubs", "index", "crossFile", "facade", "lsp"} {
		if trace.SourceCounts[source] != -4 {
			t.Fatalf("expected %s to be skipped for unknown language, got counts=%#v statuses=%#v", source, trace.SourceCounts, trace.SourceStatuses)
		}
	}
	if trace.SourceStatuses["patternGroup"] != "skipped-unknown-language" {
		t.Fatalf("expected pattern skip reason, got %#v", trace.SourceStatuses)
	}
	if trace.SourceStatuses["indexGroup"] != "skipped-unknown-language" {
		t.Fatalf("expected index skip reason, got %#v", trace.SourceStatuses)
	}
	if trace.LSPStatus != "skipped-unknown-language" {
		t.Fatalf("expected LSP skip reason, got %#v", trace)
	}
}

func hasSuggestionFromSource(suggestions []Suggestion, text string, source core.SymbolSource) bool {
	for _, suggestion := range suggestions {
		if suggestion.Text == text && suggestion.Source == source {
			return true
		}
	}
	return false
}

func TestPredictionBrain_TypeScriptCompletions(t *testing.T) {
	config := BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  true,
	}

	brain := NewPredictionBrain(nil, config)

	tsContent := []byte(`
 export class UserService {
     private users: User[] = [];
    
    async findAll(): Promise<User[]> {
        return this.users;
    }
    
    async findOne(id: number): Promise<User | undefined> {
        return this.users.find(u => u.id === id);
    }
    
     async create(data: Partial<User>): Promise<User> {
         // Cursor here
     }
 }
`)

	ctx := CompletionContext{
		FilePath: "src/user/user.service.ts",
		Content:  tsContent,
		Line:     14,
		Column:   10,
		Prefix:   "",
		Language: "typescript",
	}

	suggestions := brain.Complete(ctx)

	t.Logf("TypeScript: Got %d suggestions", len(suggestions))

	foundMethods := make(map[string]bool)
	for _, s := range suggestions {
		if s.Source == core.SourceLocal {
			foundMethods[s.Text] = true
			t.Logf("  Local: %s (%s)", s.Text, s.Kind)
		}
	}

	expectedMethods := []string{"findAll", "findOne", "create"}
	for _, m := range expectedMethods {
		if !foundMethods[m] {
			t.Errorf("Expected to find method '%s' in completions", m)
		}
	}
}

func TestShouldSkipLSP(t *testing.T) {
	tests := []struct {
		name        string
		language    string
		inImport    bool
		prefix      string
		trigger     string
		accessChain string
		want        bool
	}{
		{name: "empty prefix no trigger no chain", prefix: "", trigger: "", accessChain: "", want: true},
		{name: "one rune prefix no trigger no chain", prefix: "a", trigger: "", accessChain: "", want: true},
		{name: "two rune prefix no trigger no chain", prefix: "ab", trigger: "", accessChain: "", want: false},
		{name: "go one rune prefix", language: "go", prefix: "a", trigger: "", accessChain: "", want: false},
		{name: "bash one rune prefix", language: "bash", prefix: "a", trigger: "", accessChain: "", want: false},
		{name: "import prefix bypass", language: "php", prefix: "a", trigger: "", accessChain: "", inImport: true, want: false},
		{name: "one rune prefix with trigger", prefix: "a", trigger: ".", accessChain: "", want: false},
		{name: "one rune prefix with alpha trigger", prefix: "a", trigger: "a", accessChain: "", want: true},
		{name: "empty prefix with '<' trigger", prefix: "", trigger: "<", accessChain: "", want: false},
		{name: "one rune prefix with access chain", prefix: "a", trigger: "", accessChain: "$user->", want: false},
		{name: "unicode one rune", prefix: "\u0444", trigger: "", accessChain: "", want: true},
		{name: "unicode two runes", prefix: "\u0444\u0443", trigger: "", accessChain: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := CompletionContext{Prefix: tt.prefix, TriggerChar: tt.trigger, AccessChain: tt.accessChain, Language: tt.language, InImport: tt.inImport}
			got := shouldSkipLSP(ctx)
			if got != tt.want {
				t.Fatalf("shouldSkipLSP(prefix=%q trigger=%q chain=%q)=%v want=%v",
					tt.prefix, tt.trigger, tt.accessChain, got, tt.want)
			}
		})
	}
}

func TestShouldSkipIndexGroup(t *testing.T) {
	tests := []struct {
		name     string
		ctx      CompletionContext
		wantSkip bool
	}{
		{
			name:     "short prefix non-import",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "", AccessChain: "", InImport: false},
			wantSkip: true,
		},
		{
			name:     "short prefix in import",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "", AccessChain: "", InImport: true},
			wantSkip: false,
		},
		{
			name:     "non-word trigger",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: ".", AccessChain: "", InImport: false},
			wantSkip: false,
		},
		{
			name:     "word trigger",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "a", AccessChain: "", InImport: false},
			wantSkip: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldSkipIndexGroup(tt.ctx)
			if got != tt.wantSkip {
				t.Fatalf("shouldSkipIndexGroup(ctx)=%v want=%v (ctx=%+v)", got, tt.wantSkip, tt.ctx)
			}
		})
	}
}

func TestShouldSkipPatternGroup(t *testing.T) {
	tests := []struct {
		name     string
		ctx      CompletionContext
		wantSkip bool
	}{
		{
			name:     "short prefix normal",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "", AccessChain: "", InImport: false, InString: false},
			wantSkip: true,
		},
		{
			name:     "short prefix in import",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "", AccessChain: "", InImport: true, InString: false},
			wantSkip: false,
		},
		{
			name:     "short prefix in string",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "", AccessChain: "", InImport: false, InString: true},
			wantSkip: false,
		},
		{
			name:     "non-word trigger",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: ".", AccessChain: "", InImport: false, InString: false},
			wantSkip: false,
		},
		{
			name:     "access chain",
			ctx:      CompletionContext{Prefix: "a", TriggerChar: "", AccessChain: "$user->", InImport: false, InString: false},
			wantSkip: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldSkipPatternGroup(tt.ctx)
			if got != tt.wantSkip {
				t.Fatalf("shouldSkipPatternGroup(ctx)=%v want=%v (ctx=%+v)", got, tt.wantSkip, tt.ctx)
			}
		})
	}
}

func TestShouldOfferFillAll(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    bool
	}{
		{name: "empty function call", content: "package main\n\nfunc test() {\n\tconsume(|)\n}", want: true},
		{name: "whitespace inside empty call", content: "package main\n\nfunc test() {\n\tconsume(   |\n}", want: true},
		{name: "existing first argument", content: "package main\n\nfunc test() {\n\tconsume(name, |)\n}", want: false},
		{name: "control keyword", content: "package main\n\nfunc test() {\n\tif (|\n}", want: false},
		{name: "method call", content: "<?php\nfunction test() {\n\t$this->create(|);\n}", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			content, line, column := removePredictionCursorMarker(tt.content)
			ctx := CompletionContext{Content: content, Line: line, Column: column}
			got := shouldOfferFillAll(ctx)
			if got != tt.want {
				t.Fatalf("shouldOfferFillAll()=%v want=%v", got, tt.want)
			}
		})
	}
}

func TestCompletionSourceLanguageResolution(t *testing.T) {
	tests := []struct {
		name       string
		ctx        CompletionContext
		index      string
		predictive string
		local      string
		fill       string
		lsp        string
	}{
		{
			name:       "tsx uses typescript native sources",
			ctx:        CompletionContext{Language: "typescriptreact", FilePath: "/tmp/App.tsx"},
			index:      "typescript",
			predictive: "typescript",
			local:      "typescript",
			fill:       "typescript",
			lsp:        "typescriptreact",
		},
		{
			name:       "jsx uses javascript local and fill without cross-language predictive",
			ctx:        CompletionContext{Language: "javascriptreact", FilePath: "/tmp/App.jsx"},
			index:      "typescript",
			predictive: "",
			local:      "javascript",
			fill:       "javascript",
			lsp:        "javascriptreact",
		},
		{
			name: "unknown stays out of indexed native sources",
			ctx:  CompletionContext{Language: "unknown", FilePath: "/tmp/file.unknown"},
		},
		{
			name: "blade keeps blade lsp id",
			ctx:  CompletionContext{Language: "blade", FilePath: "/tmp/welcome.blade.php"},
			lsp:  "blade",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resolution := completionLanguageResolution(tt.ctx)
			if resolution.IndexID != tt.index || resolution.PredictiveID != tt.predictive ||
				resolution.LocalID() != tt.local || resolution.FillID != tt.fill || resolution.LSPID != tt.lsp {
				t.Fatalf("completionLanguageResolution()=%+v", resolution)
			}
		})
	}
}

func TestPredictionBrain_LastCompletionTrace(t *testing.T) {
	brain := NewPredictionBrain(nil, BrainConfig{MaxSuggestions: 10, MinConfidence: 0.1, EnablePredictive: false, EnableLSP: false})
	brain.stubProvider = NewStubProvider()
	brain.stubProvider.runner = func(name string, args ...string) ([]byte, error) {
		return []byte("func Encode(w any, event any) error\nfunc Decode(data []byte) (Event, error)\n"), nil
	}
	brain.stubProvider.SetPackageResolver(func(language, reference string) string {
		if language == "go" && reference == "sse" {
			return "github.com/gin-contrib/sse"
		}
		return ""
	})

	suggestions := brain.Complete(CompletionContext{
		RequestID:    "trace-1",
		FilePath:     "main.go",
		Language:     "go",
		Content:      []byte("package main\n\nfunc main() {\n\tsse.\n}\n"),
		FullContent:  []byte("package main\n\nfunc main() {\n\tsse.\n}\n"),
		AccessChain:  "sse.",
		IsMethodCall: true,
	})
	if len(suggestions) == 0 {
		t.Fatalf("expected suggestions")
	}
	trace := brain.LastCompletionTrace()
	if trace.RequestID != "trace-1" {
		t.Fatalf("expected request trace to be stored, got %#v", trace)
	}
	if trace.ResolvedNamespace != "github.com/gin-contrib/sse" {
		t.Fatalf("expected resolved namespace in trace, got %#v", trace)
	}
	if trace.ResultCount == 0 || len(trace.TopSuggestions) == 0 {
		t.Fatalf("expected trace to include result summary, got %#v", trace)
	}
}

func TestStripPrefixFromGhostText(t *testing.T) {
	tests := []struct {
		name       string
		insertText string
		prefix     string
		want       string
	}{
		{"empty prefix", "Println()", "", "Println()"},
		{"exact prefix match", "Println()", "P", "rintln()"},
		{"full match", "Println()", "Println", "()"},
		{"case insensitive", "Println()", "p", "rintln()"},
		{"no match", "Println()", "X", "Println()"},
		{"fmt method", "fmt.Println()", "fmt", ".Println()"},
		{"partial word", "forEach", "for", "Each"},
		{"full word", "forEach", "forEach", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripPrefixFromGhostText(tt.insertText, tt.prefix)
			if got != tt.want {
				t.Errorf("stripPrefixFromGhostText(%q, %q) = %q, want %q",
					tt.insertText, tt.prefix, got, tt.want)
			}
		})
	}
}

func TestStripAccessChainAndPrefix(t *testing.T) {
	tests := []struct {
		name        string
		insertText  string
		accessChain string
		prefix      string
		want        string
	}{
		{"no chain no prefix", "Println()", "", "", "Println()"},
		{"chain only", "fmt.Println()", "fmt.", "", "Println()"},
		{"prefix only", "Println()", "", "P", "rintln()"},
		{"chain and prefix", "fmt.Println()", "fmt.", "P", "rintln()"},
		{"method access", "$this->getName()", "$this->", "get", "Name()"},
		{"static access", "Route::get()", "Route::", "g", "et()"},
		{"chain not matching", "Println()", "fmt.", "", "Println()"},
		{"full method strip", "Console.log()", "Console.", "log", "()"},
		{"chain case-insensitive", "Route::get()", "route::", "g", "et()"},
		{"prefix case-insensitive after chain", "Route::get()", "Route::", "G", "et()"},
		{"chain mismatch but prefix matches", "Println()", "fmt.", "p", "rintln()"},
		{"dot access case-insensitive", "Console.Log()", "console.", "l", "og()"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := stripAccessChainAndPrefix(tt.insertText, tt.accessChain, tt.prefix)
			if got != tt.want {
				t.Errorf("stripAccessChainAndPrefix(%q, %q, %q) = %q, want %q",
					tt.insertText, tt.accessChain, tt.prefix, got, tt.want)
			}
		})
	}
}

func TestFilterByContext_DropsScaffoldInMethodCall(t *testing.T) {
	brain := &PredictionBrain{}
	ctx := CompletionContext{IsMethodCall: true}

	suggestions := []Suggestion{
		{
			Text:   "Scaffold",
			Kind:   core.SymbolKindMethod,
			Source: core.SourcePredictive,
			Extra:  map[string]string{"is_scaffold": "true"},
		},
		{
			Text:   "DoWork",
			Kind:   core.SymbolKindMethod,
			Source: core.SourcePredictive,
		},
		{
			Text:   "class",
			Kind:   core.SymbolKindClass,
			Source: core.SourceKeywords,
		},
		{
			Text:   "LspMethod",
			Kind:   core.SymbolKindMethod,
			Source: core.SourceLSP,
		},
	}

	filtered := brain.filterByContext(ctx, suggestions)
	found := map[string]bool{}
	for _, s := range filtered {
		found[s.Text] = true
	}

	if found["Scaffold"] {
		t.Fatal("scaffold suggestion should be filtered in method call")
	}
	if !found["DoWork"] {
		t.Fatal("expected callable suggestion to remain")
	}
	if !found["LspMethod"] {
		t.Fatal("expected LSP suggestion to remain")
	}
	if found["class"] {
		t.Fatal("keyword suggestion should be filtered in method call")
	}
}

func removePredictionCursorMarker(input string) ([]byte, int, int) {
	idx := strings.Index(input, "|")
	if idx < 0 {
		panic("cursor marker not found")
	}

	before := input[:idx]
	line := strings.Count(before, "\n") + 1
	lastNewline := strings.LastIndex(before, "\n")
	column := idx
	if lastNewline >= 0 {
		column = idx - lastNewline - 1
	}

	clean := input[:idx] + input[idx+1:]
	return []byte(clean), line, column
}

func TestPredictionBrain_GoCompletions(t *testing.T) {
	config := BrainConfig{
		MaxSuggestions:    50,
		MinConfidence:     0.1,
		EnableLSP:         false,
		EnableVirtual:     false,
		EnableSpeculative: false,
		EnablePredictive:  true,
	}

	brain := NewPredictionBrain(nil, config)

	goContent := []byte(`package main

type Config struct {
	Host string
	Port int
}

type Server struct {
	config *Config
}

func NewServer(config *Config) *Server {
	return &Server{config: config}
}

func (s *Server) Start() error {
	return nil
}

func main() {
	cfg := &Config{Host: "localhost", Port: 8080}
	server := NewServer(cfg)
	// Cursor here
}
`)

	ctx := CompletionContext{
		FilePath: "cmd/main.go",
		Content:  goContent,
		Line:     24,
		Column:   5,
		Prefix:   "",
		Language: "go",
	}

	suggestions := brain.Complete(ctx)

	t.Logf("Go: Got %d suggestions", len(suggestions))

	foundSymbols := make(map[string]string)
	for _, s := range suggestions {
		if s.Source == core.SourceLocal {
			foundSymbols[s.Text] = string(s.Kind)
			t.Logf("  Local: %s (%s)", s.Text, s.Kind)
		}
	}

	expectedSymbols := []string{"Config", "Server", "NewServer", "Start"}
	for _, name := range expectedSymbols {
		if _, ok := foundSymbols[name]; !ok {
			t.Errorf("Expected to find symbol '%s'", name)
		}
	}
}
