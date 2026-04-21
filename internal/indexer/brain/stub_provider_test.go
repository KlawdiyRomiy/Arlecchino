package brain

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStubProvider_LoadStubs(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	if _, err := os.Stat(stubsDir); os.IsNotExist(err) {
		t.Skip("No stubs directory found, skipping test")
	}

	provider := NewStubProvider()
	err := provider.LoadStubs()
	if err != nil {
		t.Fatalf("Failed to load stubs: %v", err)
	}

	stats := provider.Stats()
	t.Logf("Loaded stubs: %+v", stats)

	if len(stats) == 0 {
		t.Log("No stubs loaded (directory may be empty)")
	}
}

func TestStubProvider_GetCompletions(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	if _, err := os.Stat(stubsDir); os.IsNotExist(err) {
		t.Skip("No stubs directory found, skipping test")
	}

	provider := NewStubProvider()
	provider.LoadStubs()

	tests := []struct {
		name     string
		pkg      string
		prefix   string
		language string
		wantMin  int
	}{
		{"axios get", "axios", "ge", "javascript", 1},
		{"axios all", "axios", "", "javascript", 5},
		{"requests get", "requests", "ge", "python", 1},
		{"gin Default", "gin", "De", "go", 1},
		{"unknown package", "unknown", "", "javascript", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions := provider.GetCompletions(tt.pkg, tt.prefix, tt.language)
			if len(suggestions) < tt.wantMin {
				t.Errorf("GetCompletions(%s, %s, %s) got %d suggestions, want at least %d",
					tt.pkg, tt.prefix, tt.language, len(suggestions), tt.wantMin)
			}
			for _, s := range suggestions {
				t.Logf("  - %s (%s) score=%.2f", s.Text, s.Kind, s.Score)
			}
		})
	}
}

func TestStubProvider_HasPackage(t *testing.T) {
	homeDir, _ := os.UserHomeDir()
	stubsDir := filepath.Join(homeDir, ".arlecchino", "stubs")

	if _, err := os.Stat(stubsDir); os.IsNotExist(err) {
		t.Skip("No stubs directory found, skipping test")
	}

	provider := NewStubProvider()
	provider.LoadStubs()

	tests := []struct {
		pkg      string
		language string
		want     bool
	}{
		{"axios", "javascript", true},
		{"requests", "python", true},
		{"gin", "go", true},
		{"unknown", "javascript", false},
	}

	for _, tt := range tests {
		t.Run(tt.pkg+"/"+tt.language, func(t *testing.T) {
			got := provider.HasPackage(tt.pkg, tt.language)
			if got != tt.want {
				t.Errorf("HasPackage(%s, %s) = %v, want %v", tt.pkg, tt.language, got, tt.want)
			}
		})
	}
}

func TestStubProvider_LoadStubs_IncludesDartAndSwift(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "dart", "http.stub.json"), `{
		"package":"http",
		"exports":{"get":{"signature":"get(Uri url)","kind":"function"}}
	}`)
	writeTestFile(t, filepath.Join(root, "swift", "URLSession.stub.json"), `{
		"package":"URLSession",
		"exports":{"shared":{"signature":"class var shared: URLSession","kind":"property"}}
	}`)

	provider := NewStubProvider()
	provider.SetStubsDir(root)
	if err := provider.LoadStubs(); err != nil {
		t.Fatalf("LoadStubs() failed: %v", err)
	}

	if !provider.HasPackage("http", "dart") {
		t.Fatal("expected dart disk stub to be loaded")
	}
	if !provider.HasPackage("URLSession", "swift") {
		t.Fatal("expected swift disk stub to be loaded")
	}
}

func TestStubProvider_GetContextCompletions_BuiltinsCoverRustDartSwift(t *testing.T) {
	provider := NewStubProviderWithBuiltins()
	provider.SetPackageResolver(func(language, reference string) string {
		switch language + ":" + reference {
		case "rust:serde_json":
			return "serde_json"
		case "dart:http":
			return "http"
		}
		return ""
	})

	tests := []struct {
		name       string
		ctx        CompletionContext
		wantSymbol string
	}{
		{
			name: "rust serde_json members",
			ctx: CompletionContext{Language: "rust", AccessChain: "serde_json."},
			wantSymbol: "from_str",
		},
		{
			name: "dart http members",
			ctx: CompletionContext{Language: "dart", AccessChain: "http."},
			wantSymbol: "get",
		},
		{
			name: "swift URLSession members",
			ctx: CompletionContext{Language: "swift", AccessChain: "URLSession."},
			wantSymbol: "shared",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			suggestions := provider.GetContextCompletions(tt.ctx)
			if len(suggestions) == 0 {
				t.Fatalf("expected suggestions, got %#v", suggestions)
			}
			for _, suggestion := range suggestions {
				if suggestion.Text == tt.wantSymbol {
					return
				}
			}
			t.Fatalf("expected symbol %q in %#v", tt.wantSymbol, suggestions)
		})
	}
}
