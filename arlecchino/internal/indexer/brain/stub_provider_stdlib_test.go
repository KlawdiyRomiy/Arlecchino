package brain

import (
	"testing"
)

func TestBuildGoPackageStub_StdlibPackagesSupported(t *testing.T) {
	provider := NewStubProvider()

	// Mock runner для симуляции `go doc -all`
	provider.runner = func(name string, args ...string) ([]byte, error) {
		if name == "go" && len(args) >= 3 && args[0] == "doc" && args[1] == "-all" {
			// Симулируем успешный вывод для любого пакета
			return []byte("func Printf(format string, a ...any) (n int, err error)"), nil
		}
		return nil, nil
	}

	tests := []struct {
		name        string
		importPath  string
		shouldBuild bool
		reason      string
	}{
		{
			name:        "fmt stdlib",
			importPath:  "fmt",
			shouldBuild: true,
			reason:      "top-level stdlib пакет теперь должен поддерживаться",
		},
		{
			name:        "os stdlib",
			importPath:  "os",
			shouldBuild: true,
			reason:      "top-level stdlib пакет теперь должен поддерживаться",
		},
		{
			name:        "strings stdlib",
			importPath:  "strings",
			shouldBuild: true,
			reason:      "top-level stdlib пакет теперь должен поддерживаться",
		},
		{
			name:        "encoding/json stdlib",
			importPath:  "encoding/json",
			shouldBuild: true,
			reason:      "stdlib подпакет должен поддерживаться",
		},
		{
			name:        "github.com/gin-gonic/gin third-party",
			importPath:  "github.com/gin-gonic/gin",
			shouldBuild: true,
			reason:      "third-party пакет должен поддерживаться",
		},
		{
			name:        "empty import path",
			importPath:  "",
			shouldBuild: false,
			reason:      "пустой путь должен блокироваться",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stub := provider.buildGoPackageStub(tt.importPath)
			got := stub != nil

			if got != tt.shouldBuild {
				t.Errorf("buildGoPackageStub(%q) returned stub=%v, want %v\nReason: %s",
					tt.importPath, got, tt.shouldBuild, tt.reason)
			}

			if got {
				t.Logf("✅ Stub created for %q with %d exports", tt.importPath, len(stub.Exports))
			} else {
				t.Logf("❌ Stub blocked for %q: %s", tt.importPath, tt.reason)
			}
		})
	}
}

func TestStubProvider_GetContextCompletions_StdlibSupported(t *testing.T) {
	provider := NewStubProvider()

	// Mock runner для симуляции `go doc -all`
	provider.runner = func(name string, args ...string) ([]byte, error) {
		if name == "go" && len(args) >= 3 && args[0] == "doc" && args[1] == "-all" {
			return []byte("func Printf(format string, a ...any) (n int, err error)"), nil
		}
		return nil, nil
	}

	tests := []struct {
		name        string
		accessChain string
		importSpec  string
		language    string
		prefix      string
		wantCount   int
		reason      string
	}{
		{
			name:        "fmt. autocomplete",
			accessChain: "fmt.",
			importSpec:  `"fmt"`,
			language:    "go",
			prefix:      "",
			wantCount:   1,
			reason:      "fmt должен собираться в runtime snapshot и давать completion",
		},
		{
			name:        "os. autocomplete",
			accessChain: "os.",
			importSpec:  `"os"`,
			language:    "go",
			prefix:      "",
			wantCount:   1,
			reason:      "os должен собираться в runtime snapshot и давать completion",
		},
		{
			name:        "encoding/json. autocomplete",
			accessChain: "json.",
			importSpec:  `json "encoding/json"`,
			language:    "go",
			prefix:      "",
			wantCount:   1,
			reason:      "alias import на stdlib подпакет должен работать",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := CompletionContext{
				Language:    tt.language,
				Prefix:      tt.prefix,
				AccessChain: tt.accessChain,
				Content:     []byte("package main\n\nimport " + tt.importSpec + "\n"),
			}

			suggestions := provider.GetContextCompletions(ctx)
			got := len(suggestions)

			if got != tt.wantCount {
				t.Errorf("GetContextCompletions(%q) returned %d suggestions, want %d\nReason: %s",
					tt.accessChain, got, tt.wantCount, tt.reason)
			}

			if got == 0 {
				t.Logf("❌ No completions for %q: %s", tt.accessChain, tt.reason)
			} else {
				t.Logf("✅ Got %d completions for %q", got, tt.accessChain)
				for _, s := range suggestions {
					t.Logf("  - %s (%s)", s.Text, s.Kind)
				}
			}
		})
	}
}
