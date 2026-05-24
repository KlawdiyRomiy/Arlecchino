package app

import (
	"os"
	"path/filepath"
	"testing"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/plugins"
)

type fakeArtisanExecutor struct {
	runMigrateCalled bool
}

func (f *fakeArtisanExecutor) RunMigrate() error {
	f.runMigrateCalled = true
	return nil
}

func (f *fakeArtisanExecutor) CreateModel(string, plugins.ModelOptions) error { return nil }
func (f *fakeArtisanExecutor) CreateController(string, plugins.ControllerOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateMail(string, plugins.MailOptions) error { return nil }
func (f *fakeArtisanExecutor) CreateNotifications(string, plugins.NotificationOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateComponent(string, plugins.ComponentOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateLivewire(string, plugins.LivewireComponentOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateEnum(string, plugins.EnumClassOptions) error   { return nil }
func (f *fakeArtisanExecutor) CreateEvent(string, plugins.EventClassOptions) error { return nil }
func (f *fakeArtisanExecutor) CreateJob(string, plugins.JobOptions) error          { return nil }
func (f *fakeArtisanExecutor) CreateResource(string, plugins.ResourceClassOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateFactory(string, plugins.FactoryClassOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateSeeder(string, plugins.SeederClassOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreatePolicy(string, plugins.PolicyClassOptions) error {
	return nil
}
func (f *fakeArtisanExecutor) CreateMigration(string, plugins.MigrationOptions) error {
	return nil
}

type fakeRuntimeInspector struct {
	getRouteListResult interface{}
	inspectProject     interface{}
}

func (f *fakeRuntimeInspector) GetMiddlewareList() (interface{}, error) {
	return nil, nil
}

func (f *fakeRuntimeInspector) GetRouteList(string) (interface{}, error) {
	return f.getRouteListResult, nil
}

func (f *fakeRuntimeInspector) AnalyzeModels(string) (interface{}, error) {
	return nil, nil
}

func (f *fakeRuntimeInspector) ExecuteQuery(string, []interface{}) (interface{}, error) {
	return nil, nil
}

func (f *fakeRuntimeInspector) InspectProject() (interface{}, error) {
	return f.inspectProject, nil
}

type fakeLaravelCapabilityPlugin struct {
	routes    []plugins.RouteEntry
	views     []plugins.ViewEntry
	models    map[string]plugins.ModelEntry
	config    []plugins.ConfigEntry
	exec      *fakeArtisanExecutor
	inspector *fakeRuntimeInspector
}

func (f *fakeLaravelCapabilityPlugin) Name() string                     { return "laravel" }
func (f *fakeLaravelCapabilityPlugin) Init(string) error                { return nil }
func (f *fakeLaravelCapabilityPlugin) Close()                           {}
func (f *fakeLaravelCapabilityPlugin) IsApplicable(string) bool         { return true }
func (f *fakeLaravelCapabilityPlugin) GetAdapter() core.LanguageAdapter { return nil }
func (f *fakeLaravelCapabilityPlugin) OnFileChanged(string, []byte)     {}
func (f *fakeLaravelCapabilityPlugin) OnFileSaved(string)               {}

func (f *fakeLaravelCapabilityPlugin) RouteEntries() ([]plugins.RouteEntry, error) {
	return f.routes, nil
}

func (f *fakeLaravelCapabilityPlugin) ViewEntries() ([]plugins.ViewEntry, error) {
	return f.views, nil
}

func (f *fakeLaravelCapabilityPlugin) ModelEntries() (map[string]plugins.ModelEntry, error) {
	return f.models, nil
}

func (f *fakeLaravelCapabilityPlugin) ConfigEntries() ([]plugins.ConfigEntry, error) {
	return f.config, nil
}

func (f *fakeLaravelCapabilityPlugin) EnsureArtisanExecutor() (plugins.ArtisanExecutor, error) {
	return f.exec, nil
}

func (f *fakeLaravelCapabilityPlugin) EnsureRuntimeInspector() (plugins.RuntimeInspector, error) {
	return f.inspector, nil
}

func TestRunMigrate_UsesLaravelArtisanCapability(t *testing.T) {
	exec := &fakeArtisanExecutor{}
	registry := plugins.NewRegistry()
	registry.Register(&fakeLaravelCapabilityPlugin{exec: exec})

	app := &App{plugins: registry, projectPath: t.TempDir()}

	if err := app.RunMigrate(); err != nil {
		t.Fatalf("RunMigrate() error = %v", err)
	}
	if !exec.runMigrateCalled {
		t.Fatal("expected RunMigrate to delegate to capability executor")
	}
}

func TestGetRouteList_UsesLaravelRuntimeCapability(t *testing.T) {
	want := map[string]interface{}{"routes": []string{"profile.edit"}}
	registry := plugins.NewRegistry()
	registry.Register(&fakeLaravelCapabilityPlugin{
		inspector: &fakeRuntimeInspector{getRouteListResult: want},
	})

	app := &App{plugins: registry, projectPath: t.TempDir()}

	got, err := app.GetRouteList("profile")
	if err != nil {
		t.Fatalf("GetRouteList() error = %v", err)
	}
	if gotMap, ok := got.(map[string]interface{}); !ok || len(gotMap) != 1 || gotMap["routes"] == nil {
		t.Fatalf("GetRouteList() got = %#v, want %#v", got, want)
	}
}

func TestGoToDefinition_UsesLaravelDefinitionCapability(t *testing.T) {
	projectPath := t.TempDir()
	routeFile := filepath.Join(projectPath, "routes", "web.php")
	if err := os.MkdirAll(filepath.Dir(routeFile), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(routeFile, []byte("<?php\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	registry := plugins.NewRegistry()
	registry.Register(&fakeLaravelCapabilityPlugin{
		routes: []plugins.RouteEntry{{
			Name:       "profile.edit",
			FilePath:   routeFile,
			LineNumber: 42,
		}},
	})

	app := &App{plugins: registry, projectPath: projectPath}

	results, err := app.GoToDefinition(routeFile, "", 1, 1, "profile.edit", "route('", "')")
	if err != nil {
		t.Fatalf("GoToDefinition() error = %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("GoToDefinition() result count = %d, want 1", len(results))
	}
	if results[0].Path != routeFile || results[0].Line != 42 {
		t.Fatalf("GoToDefinition() got = %#v, want path=%q line=42", results[0], routeFile)
	}
}
