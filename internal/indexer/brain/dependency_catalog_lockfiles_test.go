package brain

import (
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
