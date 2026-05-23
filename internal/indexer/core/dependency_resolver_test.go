package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDependencyTargetResolver_ResolvesProjectFileReferences(t *testing.T) {
	root := t.TempDir()
	writeResolverFile(t, root, "go.mod", "module example.com/app\n")
	files := []string{
		"src/components/Button.tsx",
		"src/components/index.ts",
		"pkg/service.go",
		"models/user.py",
		"lib/concerns/searchable.rb",
		"include/local.h",
		"pages/Widget.svelte",
		"styles/base.css",
		"assets/icon.svg",
		"schema/user.json",
		"src/vendor.ts",
		"app/Models/User.php",
	}
	for _, file := range files {
		writeResolverFile(t, root, file, "")
	}

	eng, err := NewEngine(EngineConfig{ProjectID: "resolver", ProjectRoot: root, DBPath: filepath.Join(root, ".arlecchino", "brain.db"), Workers: 1})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()
	for _, file := range files {
		path := filepath.Join(root, file)
		if err := eng.recordInventory(path); err != nil {
			t.Fatalf("recordInventory(%s): %v", file, err)
		}
	}

	source := filepath.Join(root, "src", "app.ts")
	writeResolverFile(t, root, "src/app.ts", "")
	if err := eng.recordInventory(source); err != nil {
		t.Fatalf("recordInventory(source): %v", err)
	}
	if err := eng.store.SaveSymbols([]Symbol{{
		Name:     "react",
		Kind:     SymbolKindFunction,
		Language: "typescript",
		FilePath: filepath.Join(root, "src/vendor.ts"),
		Line:     1,
	}, {
		Namespace: `App\Models`,
		Name:      "User",
		Kind:      SymbolKindClass,
		Language:  "php",
		FilePath:  filepath.Join(root, "app/Models/User.php"),
		Line:      1,
	}}); err != nil {
		t.Fatalf("SaveSymbols: %v", err)
	}

	edges := []Edge{
		{ToSymbol: "./components/Button", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "@/components/index", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "example.com/app/pkg/service", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "models.user", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "../lib/concerns/searchable", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "../include/local.h", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "../pages/Widget.svelte", Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "../styles/base.css", Kind: EdgeKindReferences, FilePath: source},
		{ToSymbol: "../assets/icon.svg", Kind: EdgeKindReferences, FilePath: source},
		{ToSymbol: "../schema/user.json", Kind: EdgeKindReferences, FilePath: source},
		{ToSymbol: `App\Models\User`, Kind: EdgeKindImports, FilePath: source},
		{ToSymbol: "react", Kind: EdgeKindImports, FilePath: source},
	}

	resolved, err := eng.ResolveDependencyTargets(source, edges)
	if err != nil {
		t.Fatalf("ResolveDependencyTargets: %v", err)
	}

	got := make(map[string]string)
	for _, item := range resolved {
		got[item.Edge.ToSymbol] = item.TargetPath
	}
	want := map[string]string{
		"./components/Button":         filepath.Join(root, "src/components/Button.tsx"),
		"@/components/index":          filepath.Join(root, "src/components/index.ts"),
		"example.com/app/pkg/service": filepath.Join(root, "pkg/service.go"),
		"models.user":                 filepath.Join(root, "models/user.py"),
		"../lib/concerns/searchable":  filepath.Join(root, "lib/concerns/searchable.rb"),
		"../include/local.h":          filepath.Join(root, "include/local.h"),
		"../pages/Widget.svelte":      filepath.Join(root, "pages/Widget.svelte"),
		"../styles/base.css":          filepath.Join(root, "styles/base.css"),
		"../assets/icon.svg":          filepath.Join(root, "assets/icon.svg"),
		"../schema/user.json":         filepath.Join(root, "schema/user.json"),
		`App\Models\User`:             filepath.Join(root, "app/Models/User.php"),
	}
	for raw, path := range want {
		if got[raw] != path {
			t.Fatalf("resolved[%q]=%q, want %q; all=%v", raw, got[raw], path, got)
		}
	}
	if _, ok := got["react"]; ok {
		t.Fatalf("external package import resolved through symbol fallback unexpectedly: %v", got)
	}
}

func writeResolverFile(t *testing.T, root string, rel string, content string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir %s: %v", rel, err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}
