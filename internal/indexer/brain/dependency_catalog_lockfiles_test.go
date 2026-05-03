package brain

import (
	"arlecchino/internal/indexer/core"
	"path/filepath"
	"testing"
)

func TestDependencyCatalog_SuggestionsFromLockfiles(t *testing.T) {
	tests := []struct {
		name     string
		language string
		setup    func(t *testing.T, root string)
		want     string
	}{
		{
			name:     "node package-lock",
			language: "typescript",
			setup: func(t *testing.T, root string) {
				writeTestFile(t, filepath.Join(root, "package-lock.json"), `{"dependencies":{"react":{"version":"18.3.1"}}}`)
			},
			want: "react",
		},
		{
			name:     "php composer lock",
			language: "php",
			setup: func(t *testing.T, root string) {
				writeTestFile(t, filepath.Join(root, "composer.lock"), `{"packages":[{"name":"nesbot/carbon","version":"3.8.0"}]}`)
			},
			want: "nesbot/carbon",
		},
		{
			name:     "rust cargo lock",
			language: "rust",
			setup: func(t *testing.T, root string) {
				writeTestFile(t, filepath.Join(root, "Cargo.lock"), "[[package]]\nname = \"serde\"\nversion = \"1.0.0\"\n")
			},
			want: "serde",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			tc.setup(t, root)

			catalog := NewDependencyCatalog(root)
			suggestions := catalog.Suggestions(tc.language, "")
			assertSuggestionText(t, suggestions, tc.want)
		})
	}
}

func TestDependencyCatalog_NodeCacheSharedAcrossLanguageFamily(t *testing.T) {
	root := t.TempDir()
	writeTestFile(t, filepath.Join(root, "package.json"), `{"dependencies":{"zustand":"5.0.8"}}`)

	catalog := NewDependencyCatalog(root)
	typescript := catalog.Suggestions("typescript", "zus")
	javascript := catalog.Suggestions("javascript", "zus")

	assertSuggestionText(t, typescript, "zustand")
	assertSuggestionText(t, javascript, "zustand")
}

func TestDependencyCatalog_GoStdlibSkipsInternalPackages(t *testing.T) {
	root := t.TempDir()
	catalog := NewDependencyCatalog(root)
	catalog.commandRunner = func(name string, args ...string) ([]byte, error) {
		if name != "go" || len(args) != 2 || args[0] != "list" || args[1] != "std" {
			t.Fatalf("unexpected command: %s %#v", name, args)
		}
		return []byte("crypto/internal/fips140deps/time\nfmt\ninternal/testenv\ntime\nvendor/foo\n"), nil
	}

	suggestions := catalog.Suggestions("go", "time")
	assertSuggestionText(t, suggestions, "time")
	for _, suggestion := range suggestions {
		if suggestion.Text == "crypto/internal/fips140deps/time" {
			t.Fatalf("internal stdlib package leaked into suggestions: %#v", suggestions)
		}
	}

	if got := catalog.ResolveLibraryByOwner("go", "time"); got != "time" {
		t.Fatalf("expected time owner to resolve to public stdlib package, got %q", got)
	}
	if got := catalog.ResolveLibraryByOwner("go", "fmt"); got != "fmt" {
		t.Fatalf("expected fmt owner to resolve to public stdlib package, got %q", got)
	}
}

func TestDependencyCatalog_ResolveAmbiguousSuffixReturnsEmpty(t *testing.T) {
	catalog := &dependencyCatalog{
		cache: map[string]dependencyCacheEntry{
			"go": {
				fingerprint: "",
				entries: []dependencyEntry{
					{Name: "github.com/acme/client", Kind: core.SymbolKindPackage, Source: core.SourceLibrary, Owner: "client"},
					{Name: "github.com/example/client", Kind: core.SymbolKindPackage, Source: core.SourceLibrary, Owner: "client"},
				},
			},
		},
		cacheStatus: map[string]string{},
	}

	if got := catalog.ResolveLibraryByOwner("go", "client"); got != "" {
		t.Fatalf("expected ambiguous owner to stay unresolved, got %q", got)
	}
}
