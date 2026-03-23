package brain

import (
	"arlecchino/internal/indexer/core"
	"testing"
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
		prefix      string
		trigger     string
		accessChain string
		want        bool
	}{
		{name: "empty prefix no trigger no chain", prefix: "", trigger: "", accessChain: "", want: true},
		{name: "one rune prefix no trigger no chain", prefix: "a", trigger: "", accessChain: "", want: true},
		{name: "two rune prefix no trigger no chain", prefix: "ab", trigger: "", accessChain: "", want: false},
		{name: "one rune prefix with trigger", prefix: "a", trigger: ".", accessChain: "", want: false},
		{name: "one rune prefix with alpha trigger", prefix: "a", trigger: "a", accessChain: "", want: true},
		{name: "empty prefix with '<' trigger", prefix: "", trigger: "<", accessChain: "", want: false},
		{name: "one rune prefix with access chain", prefix: "a", trigger: "", accessChain: "$user->", want: false},
		{name: "unicode one rune", prefix: "\u0444", trigger: "", accessChain: "", want: true},
		{name: "unicode two runes", prefix: "\u0444\u0443", trigger: "", accessChain: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := CompletionContext{Prefix: tt.prefix, TriggerChar: tt.trigger, AccessChain: tt.accessChain}
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
