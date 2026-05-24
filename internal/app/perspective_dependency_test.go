package app

import (
	"os"
	"path/filepath"
	"testing"

	"arlecchino/internal/indexer"
	"arlecchino/internal/indexer/core"
)

func TestGetDependencyGraph_ResolvesMixedLanguageProjectFilesOnly(t *testing.T) {
	root := t.TempDir()
	writePerspectiveFile(t, root, "go.mod", "module example.com/app\n")
	for _, rel := range []string{
		"src/main.ts",
		"src/components/Button.tsx",
		"pkg/service.go",
		"src/App.svelte",
		"src/Widget.svelte",
		"schema/app.json",
		"schema/user.json",
		"app/Http/Controllers/UserController.php",
		"app/Models/User.php",
	} {
		writePerspectiveFile(t, root, rel, "")
	}

	eng, err := core.NewEngine(core.EngineConfig{
		ProjectID:   "perspective",
		ProjectRoot: root,
		DBPath:      filepath.Join(root, ".arlecchino", "brain.db"),
		Workers:     1,
	})
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Stop()

	mainPath := filepath.Join(root, "src/main.ts")
	buttonPath := filepath.Join(root, "src/components/Button.tsx")
	servicePath := filepath.Join(root, "pkg/service.go")
	appPath := filepath.Join(root, "src/App.svelte")
	widgetPath := filepath.Join(root, "src/Widget.svelte")
	jsonPath := filepath.Join(root, "schema/app.json")
	userSchemaPath := filepath.Join(root, "schema/user.json")
	controllerPath := filepath.Join(root, "app/Http/Controllers/UserController.php")
	userModelPath := filepath.Join(root, "app/Models/User.php")

	replacePerspectiveFileIndex(t, eng, mainPath, "typescript", nil, []core.Edge{
		{FromSymbol: mainPath, ToSymbol: "@/components/Button", Kind: core.EdgeKindImports, FilePath: mainPath, Line: 1},
		{FromSymbol: mainPath, ToSymbol: "example.com/app/pkg/service", Kind: core.EdgeKindImports, FilePath: mainPath, Line: 2},
		{FromSymbol: mainPath, ToSymbol: "react", Kind: core.EdgeKindImports, FilePath: mainPath, Line: 3},
	})
	replacePerspectiveFileIndex(t, eng, buttonPath, "typescript", []core.Symbol{{Name: "Button", Kind: core.SymbolKindComponent, Language: "typescript", FilePath: buttonPath, Line: 1}}, nil)
	replacePerspectiveFileIndex(t, eng, servicePath, "go", []core.Symbol{{Name: "service", Kind: core.SymbolKindPackage, Language: "go", FilePath: servicePath, Line: 1}}, nil)
	replacePerspectiveFileIndex(t, eng, appPath, "svelte", nil, []core.Edge{{FromSymbol: appPath, ToSymbol: "./Widget.svelte", Kind: core.EdgeKindImports, FilePath: appPath, Line: 1}})
	replacePerspectiveFileIndex(t, eng, widgetPath, "svelte", nil, nil)
	replacePerspectiveFileIndex(t, eng, jsonPath, "json", nil, []core.Edge{{FromSymbol: jsonPath, ToSymbol: "./user.json", Kind: core.EdgeKindReferences, FilePath: jsonPath, Line: 1}})
	replacePerspectiveFileIndex(t, eng, userSchemaPath, "json", nil, nil)
	replacePerspectiveFileIndex(t, eng, controllerPath, "php", []core.Symbol{{Name: "UserController", Kind: core.SymbolKindClass, Namespace: `App\Http\Controllers`, Language: "php", FilePath: controllerPath, Line: 1}}, []core.Edge{{FromSymbol: controllerPath, ToSymbol: `App\Models\User`, Kind: core.EdgeKindImports, FilePath: controllerPath, Line: 2}})
	replacePerspectiveFileIndex(t, eng, userModelPath, "php", []core.Symbol{{Name: "User", Kind: core.SymbolKindClass, Namespace: `App\Models`, Language: "php", FilePath: userModelPath, Line: 1}}, nil)

	app := &App{projectSessions: NewProjectSessionRegistry()}
	session := &ProjectRuntimeSession{ID: defaultProjectSessionID, WindowName: "main", IsDefault: true, coreEngine: eng}
	session.setProjectPath(root)
	app.projectSessions.register(session)

	graph, err := app.GetDependencyGraph(mainPath, 1)
	if err != nil {
		t.Fatalf("GetDependencyGraph(main): %v", err)
	}
	assertGraphHasEdge(t, graph, mainPath, buttonPath)
	assertGraphHasEdge(t, graph, mainPath, servicePath)
	assertGraphLacksNode(t, graph, "react")

	graph, err = app.GetDependencyGraph(appPath, 1)
	if err != nil {
		t.Fatalf("GetDependencyGraph(svelte): %v", err)
	}
	assertGraphHasEdge(t, graph, appPath, widgetPath)

	graph, err = app.GetDependencyGraph(jsonPath, 1)
	if err != nil {
		t.Fatalf("GetDependencyGraph(json): %v", err)
	}
	assertGraphHasEdge(t, graph, jsonPath, userSchemaPath)

	graph, err = app.GetDependencyGraph(controllerPath, 1)
	if err != nil {
		t.Fatalf("GetDependencyGraph(php): %v", err)
	}
	assertGraphHasEdge(t, graph, controllerPath, userModelPath)
}

func replacePerspectiveFileIndex(t *testing.T, eng *core.Engine, path string, language string, symbols []core.Symbol, edges []core.Edge) {
	t.Helper()
	if err := eng.Store().ReplaceFileIndex(path, language, symbols, edges); err != nil {
		t.Fatalf("ReplaceFileIndex(%s): %v", path, err)
	}
}

func assertGraphHasEdge(t *testing.T, graph *indexer.DependencyGraph, source string, target string) {
	t.Helper()
	for _, edge := range graph.Edges {
		if edge.Source == source && edge.Target == target {
			return
		}
	}
	t.Fatalf("graph missing edge %s -> %s; graph=%+v", source, target, graph)
}

func assertGraphLacksNode(t *testing.T, graph *indexer.DependencyGraph, name string) {
	t.Helper()
	for _, node := range graph.Nodes {
		if filepath.Base(node.Path) == name || node.Path == name {
			t.Fatalf("graph contains unexpected node %q: %+v", name, graph)
		}
	}
}

func writePerspectiveFile(t *testing.T, root string, rel string, content string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir %s: %v", rel, err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}
