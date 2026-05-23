package adapters

import (
	"strings"
	"testing"

	"arlecchino/internal/indexer/core"
	lspregistry "arlecchino/internal/lsp"
)

func TestAllAdapters_CoversEveryRegisteredLanguageWithAtLeastOneExtension(t *testing.T) {
	adapters := AllAdapters("")
	ownedExtensions := make(map[string]struct{})
	for _, adapter := range adapters {
		for _, ext := range adapter.Extensions() {
			ownedExtensions[strings.ToLower(ext)] = struct{}{}
		}
	}

	for _, info := range lspregistry.GetARLESupportedLanguages() {
		if info == nil || len(info.Extensions) == 0 {
			continue
		}
		covered := false
		for _, ext := range info.Extensions {
			if _, ok := ownedExtensions[strings.ToLower(ext)]; ok {
				covered = true
				break
			}
		}
		if !covered {
			t.Fatalf("language %s has no indexed adapter extension; extensions=%v", info.ID, info.Extensions)
		}
	}
}

func TestGenericDependencyAdapter_ParseRepresentativeDependencies(t *testing.T) {
	tests := []struct {
		name     string
		language string
		content  string
		want     []string
		kind     core.EdgeKind
	}{
		{name: "java import", language: "java", content: "import com.example.UserService;\n", want: []string{"com.example.UserService"}, kind: core.EdgeKindImports},
		{name: "c include", language: "c", content: "#include \"local.h\"\n", want: []string{"local.h"}, kind: core.EdgeKindImports},
		{name: "rust module", language: "rust", content: "mod parser;\nuse crate::model::User;\n", want: []string{"parser", "crate::model::User"}, kind: core.EdgeKindImports},
		{name: "csharp using", language: "csharp", content: "using App.Models;\n", want: []string{"App.Models"}, kind: core.EdgeKindImports},
		{name: "svelte import", language: "svelte", content: "import Widget from './Widget.svelte';\n", want: []string{"./Widget.svelte"}, kind: core.EdgeKindImports},
		{name: "css refs", language: "css", content: "@import './base.css';\n.icon { background: url(\"./icon.svg\"); }\n", want: []string{"./base.css", "./icon.svg"}, kind: core.EdgeKindReferences},
		{name: "terraform source", language: "terraform", content: "source = \"./modules/network\"\n", want: []string{"./modules/network"}, kind: core.EdgeKindReferences},
		{name: "cmake include", language: "cmake", content: "include(cmake/CompilerWarnings.cmake)\n", want: []string{"cmake/CompilerWarnings.cmake"}, kind: core.EdgeKindImports},
		{name: "markdown link", language: "markdown", content: "[Guide](docs/guide.md)\n", want: []string{"docs/guide.md"}, kind: core.EdgeKindReferences},
		{name: "json ref", language: "json", content: `{"$ref": "./schema/user.json"}`, want: []string{"./schema/user.json"}, kind: core.EdgeKindReferences},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter := NewGenericDependencyAdapter(tt.language, []string{".test"})
			_, edges, err := adapter.ParseContent("sample.test", []byte(tt.content))
			if err != nil {
				t.Fatalf("ParseContent: %v", err)
			}
			for _, want := range tt.want {
				if !hasEdge(edges, want) {
					t.Fatalf("edges missing %q: %#v", want, edges)
				}
			}
		})
	}
}

func hasEdge(edges []core.Edge, target string) bool {
	for _, edge := range edges {
		if edge.ToSymbol == target {
			return true
		}
	}
	return false
}
