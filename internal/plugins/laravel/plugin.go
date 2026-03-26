package laravel

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sync"

	"arlecchino/internal/indexer"
	"arlecchino/internal/indexer/adapters"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/plugins"
)

// Plugin implements Laravel-specific IDE features
type Plugin struct {
	projectPath string
	engine      *indexer.Engine // Legacy engine for terminal commands
	adapter     *adapters.LaravelAdapter
	registry    *plugins.CommandRegistry
	initialized bool
	mu          sync.Mutex

	// Laravel-specific components (moved from app.go)
	exec          *SimpleExec
	bridge        *PHPBridge
	modelsIndexer *ModelsIndexer
	routesIndexer *RoutesIndexer
	viewsIndexer  *ViewsIndexer
	configIndexer *ConfigIndexer
}

var (
	newSimpleExec = NewSimpleExec
	newPHPBridge  = NewPHPBridge
)

type runtimeInspector struct {
	bridge *PHPBridge
}

func (r runtimeInspector) GetMiddlewareList() (interface{}, error) {
	return r.bridge.GetMiddlewareList()
}

func (r runtimeInspector) GetRouteList(filter string) (interface{}, error) {
	return r.bridge.GetRouteList(filter)
}

func (r runtimeInspector) AnalyzeModels(modelName string) (interface{}, error) {
	return r.bridge.AnalyzeModels(modelName)
}

func (r runtimeInspector) ExecuteQuery(query string, bindings []interface{}) (interface{}, error) {
	return r.bridge.ExecuteQuery(query, bindings)
}

func (r runtimeInspector) InspectProject() (interface{}, error) {
	return r.bridge.InspectProject()
}

// New creates a new Laravel plugin
func New() *Plugin {
	p := &Plugin{
		registry: plugins.NewCommandRegistry(),
	}
	// Register all Laravel commands
	p.registerArtisanCommands()
	p.registerComposerCommands()
	return p
}

// Name returns the plugin identifier
func (p *Plugin) Name() string {
	return "laravel"
}

// Init initializes the plugin for a project
func (p *Plugin) Init(projectPath string) error {
	p.projectPath = projectPath

	// Initialize legacy engine for terminal command predictions
	engine, err := indexer.NewEngine(projectPath)
	if err != nil {
		return err
	}
	p.engine = engine

	// Initialize Laravel adapter for indexing
	p.adapter = adapters.NewLaravelAdapter()

	// Initialize indexers
	p.modelsIndexer = NewModelsIndexer(projectPath)
	p.routesIndexer = NewRoutesIndexer(projectPath)
	p.viewsIndexer = NewViewsIndexer(projectPath)
	p.configIndexer = NewConfigIndexer(projectPath)

	p.initialized = true
	return nil
}

// Close releases plugin resources
func (p *Plugin) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.engine != nil {
		p.engine.Close()
		p.engine = nil
	}
	p.exec = nil
	if p.bridge != nil {
		p.bridge.Close()
		p.bridge = nil
	}
	p.initialized = false
}

// === Getters for Laravel-specific components ===

// Exec returns the SimpleExec for artisan command execution
func (p *Plugin) Exec() *SimpleExec {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.exec
}

// EnsureExec lazily initializes the SimpleExec for artisan command execution.
func (p *Plugin) EnsureExec() (*SimpleExec, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.projectPath == "" {
		return nil, fmt.Errorf("laravel plugin is not initialized")
	}
	if p.exec != nil {
		return p.exec, nil
	}

	exec, err := newSimpleExec(p.projectPath)
	if err != nil {
		return nil, err
	}
	p.exec = exec
	return p.exec, nil
}

// EnsureArtisanExecutor exposes the Laravel executor through the generic plugin capability seam.
func (p *Plugin) EnsureArtisanExecutor() (plugins.ArtisanExecutor, error) {
	return p.EnsureExec()
}

// Bridge returns the PHP bridge for runtime introspection
func (p *Plugin) Bridge() *PHPBridge {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.bridge
}

// EnsureBridge lazily initializes the PHP bridge for runtime introspection.
func (p *Plugin) EnsureBridge() (*PHPBridge, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.projectPath == "" {
		return nil, fmt.Errorf("laravel plugin is not initialized")
	}
	if p.bridge != nil {
		return p.bridge, nil
	}

	bridge, err := newPHPBridge(p.projectPath)
	if err != nil {
		return nil, err
	}
	p.bridge = bridge
	return p.bridge, nil
}

// EnsureRuntimeInspector exposes the Laravel bridge through the generic plugin capability seam.
func (p *Plugin) EnsureRuntimeInspector() (plugins.RuntimeInspector, error) {
	bridge, err := p.EnsureBridge()
	if err != nil {
		return nil, err
	}
	return runtimeInspector{bridge: bridge}, nil
}

// Models returns the models indexer
func (p *Plugin) Models() *ModelsIndexer {
	return p.modelsIndexer
}

// ModelEntries exposes Laravel model index data through the generic plugin capability seam.
func (p *Plugin) ModelEntries() (map[string]plugins.ModelEntry, error) {
	if p.modelsIndexer == nil {
		return map[string]plugins.ModelEntry{}, nil
	}

	models, err := p.modelsIndexer.Index()
	if err != nil {
		return nil, err
	}

	entries := make(map[string]plugins.ModelEntry, len(models))
	for name, model := range models {
		fields := make([]plugins.ModelField, 0, len(model.Fields))
		for _, field := range model.Fields {
			fields = append(fields, plugins.ModelField{
				Name:     field.Name,
				Type:     field.Type,
				Nullable: field.Nullable,
				Default:  field.Default,
			})
		}

		relationships := make([]plugins.ModelRelationship, 0, len(model.Relationships))
		for _, relationship := range model.Relationships {
			relationships = append(relationships, plugins.ModelRelationship{
				Name:   relationship.Name,
				Type:   relationship.Type,
				Model:  relationship.Model,
				Method: relationship.Method,
			})
		}

		entries[name] = plugins.ModelEntry{
			Name:          model.Name,
			Table:         model.Table,
			Fields:        fields,
			Fillable:      append([]string(nil), model.Fillable...),
			Hidden:        append([]string(nil), model.Hidden...),
			Casts:         maps.Clone(model.Casts),
			Relationships: relationships,
			FilePath:      model.FilePath,
		}
	}

	return entries, nil
}

// Routes returns the routes indexer
func (p *Plugin) Routes() *RoutesIndexer {
	return p.routesIndexer
}

// RouteEntries exposes Laravel route index data through the generic plugin capability seam.
func (p *Plugin) RouteEntries() ([]plugins.RouteEntry, error) {
	if p.routesIndexer == nil {
		return []plugins.RouteEntry{}, nil
	}

	routes, err := p.routesIndexer.Index()
	if err != nil {
		return nil, err
	}

	entries := make([]plugins.RouteEntry, 0, len(routes))
	for _, route := range routes {
		entries = append(entries, plugins.RouteEntry{
			Name:           route.Name,
			Method:         route.Method,
			URI:            route.URI,
			Action:         route.Action,
			Controller:     route.Controller,
			Middleware:     append([]string(nil), route.Middleware...),
			FilePath:       route.FilePath,
			LineNumber:     route.LineNumber,
			ControllerPath: route.ControllerPath,
			ActionLine:     route.ActionLine,
		})
	}

	return entries, nil
}

// Views returns the views indexer
func (p *Plugin) Views() *ViewsIndexer {
	return p.viewsIndexer
}

// ViewEntries exposes Laravel view index data through the generic plugin capability seam.
func (p *Plugin) ViewEntries() ([]plugins.ViewEntry, error) {
	if p.viewsIndexer == nil {
		return []plugins.ViewEntry{}, nil
	}

	views, err := p.viewsIndexer.Index()
	if err != nil {
		return nil, err
	}

	entries := make([]plugins.ViewEntry, 0, len(views))
	for _, view := range views {
		entries = append(entries, plugins.ViewEntry{
			Name:     view.Name,
			Path:     view.Path,
			RelPath:  view.RelPath,
			IsLayout: view.IsLayout,
		})
	}

	return entries, nil
}

// Config returns the config indexer
func (p *Plugin) Config() *ConfigIndexer {
	return p.configIndexer
}

// ConfigEntries exposes Laravel config index data through the generic plugin capability seam.
func (p *Plugin) ConfigEntries() ([]plugins.ConfigEntry, error) {
	if p.configIndexer == nil {
		return []plugins.ConfigEntry{}, nil
	}

	keys, err := p.configIndexer.Index()
	if err != nil {
		return nil, err
	}

	entries := make([]plugins.ConfigEntry, 0, len(keys))
	for _, key := range keys {
		entries = append(entries, plugins.ConfigEntry{
			Key:         key.Key,
			Value:       key.Value,
			File:        key.File,
			Description: key.Description,
		})
	}

	return entries, nil
}

// CreateProject creates a new Laravel project (implements ProjectCreator interface)
func (p *Plugin) CreateProject(name string, directory string) (string, error) {
	exec, err := newSimpleExec(directory)
	if err != nil {
		return "", err
	}
	if err := exec.MakeNewLaravelProject(name); err != nil {
		return "", err
	}
	return directory + "/" + name, nil
}

// IsApplicable checks if this is a Laravel project
func (p *Plugin) IsApplicable(projectPath string) bool {
	// Check for artisan file (Laravel marker)
	artisanPath := filepath.Join(projectPath, "artisan")
	if _, err := os.Stat(artisanPath); err == nil {
		return true
	}

	// Check for composer.json with laravel/framework
	composerPath := filepath.Join(projectPath, "composer.json")
	if _, err := os.Stat(composerPath); err == nil {
		content, err := os.ReadFile(composerPath)
		if err == nil {
			// Simple check for laravel/framework in composer.json
			return containsLaravel(content)
		}
	}

	return false
}

// GetAdapter returns the Laravel language adapter
func (p *Plugin) GetAdapter() core.LanguageAdapter {
	return p.adapter
}

// OnFileChanged handles file change events
func (p *Plugin) OnFileChanged(path string, content []byte) {
	// Legacy engine doesn't need content change notifications
	// It only cares about file creation for pending predictions
}

// OnFileSaved handles file save events
func (p *Plugin) OnFileSaved(path string) {
	// When file is saved, check if it matches a pending prediction
	if p.engine != nil {
		p.engine.OnFileCreated(path)
	}
}

// Commands returns the command registry for this plugin
func (p *Plugin) Commands() *plugins.CommandRegistry {
	return p.registry
}

// ParseCommand parses terminal input for Laravel commands
func (p *Plugin) ParseCommand(input string) *plugins.ParsedCommand {
	if p.engine == nil {
		return nil
	}

	parsed := p.engine.ParseCommand(input)
	if parsed == nil {
		return nil
	}

	return &plugins.ParsedCommand{
		Valid:    parsed.Valid,
		Prefix:   parsed.Prefix,
		Command:  parsed.Command,
		Argument: parsed.Argument,
		Flags:    parsed.Flags,
	}
}

// SuggestCommand returns command suggestions for terminal input
func (p *Plugin) SuggestCommand(input string) []plugins.CommandSuggestion {
	if p.engine == nil {
		return nil
	}

	suggestions := p.engine.SuggestCommand(input)
	result := make([]plugins.CommandSuggestion, len(suggestions))
	for i, s := range suggestions {
		result[i] = plugins.CommandSuggestion{
			Text:        s.Text,
			Description: s.Description,
			Kind:        string(s.Kind),
		}
	}
	return result
}

// UpdatePrediction updates pending file predictions based on input
// This is the "terminal ghost predict" feature - when user types
// "php artisan make:model User", we predict that User.php will be created
func (p *Plugin) UpdatePrediction(input string) {
	if p.engine != nil {
		p.engine.UpdatePrediction(input)
	}
}

// ConfirmPrediction confirms command execution
func (p *Plugin) ConfirmPrediction(input string) {
	if p.engine != nil {
		p.engine.ConfirmPrediction(input)
	}
}

// CancelPrediction cancels current predictions
func (p *Plugin) CancelPrediction() {
	if p.engine != nil {
		p.engine.CancelPrediction()
	}
}

// GetPendingEntry returns a pending entry by name for terminal ghost predict
func (p *Plugin) GetPendingEntry(name string) *plugins.PendingEntry {
	if p.engine == nil {
		return nil
	}

	query := p.engine.Query()
	if query == nil {
		return nil
	}

	result := query.FindClass(name)
	if result == nil || !result.Pending {
		return nil
	}

	return &plugins.PendingEntry{
		Name:      result.Name,
		Kind:      result.Kind,
		Namespace: result.Namespace,
		FilePath:  result.FilePath,
		ProjectID: p.projectPath,
	}
}

// SearchPending searches pending entries by prefix
func (p *Plugin) SearchPending(prefix string) []*plugins.PendingEntry {
	if p.engine == nil {
		return nil
	}

	query := p.engine.Query()
	if query == nil {
		return nil
	}

	results := query.SearchClasses(prefix)
	var entries []*plugins.PendingEntry
	for _, r := range results {
		if r.Pending {
			entries = append(entries, &plugins.PendingEntry{
				Name:      r.Name,
				Kind:      r.Kind,
				Namespace: r.Namespace,
				FilePath:  r.FilePath,
				ProjectID: p.projectPath,
			})
		}
	}
	return entries
}

// SearchClasses searches all classes (both pending and indexed) by prefix
func (p *Plugin) SearchClasses(prefix string) []plugins.ClassResult {
	if p.engine == nil {
		return nil
	}

	query := p.engine.Query()
	if query == nil {
		return nil
	}

	results := query.SearchClasses(prefix)
	var classResults []plugins.ClassResult
	for _, r := range results {
		classResults = append(classResults, plugins.ClassResult{
			Name:      r.Name,
			Kind:      r.Kind,
			Namespace: r.Namespace,
			FilePath:  r.FilePath,
			Line:      r.Line,
			Pending:   r.Pending,
		})
	}
	return classResults
}

// containsLaravel checks if composer.json contains laravel/framework
func containsLaravel(content []byte) bool {
	// Simple string search - could be made more robust with JSON parsing
	return len(content) > 0 &&
		(contains(content, "laravel/framework") ||
			contains(content, "laravel/laravel"))
}

func contains(content []byte, substr string) bool {
	return len(content) >= len(substr) &&
		string(content[:]) != "" &&
		findSubstring(content, []byte(substr)) >= 0
}

func findSubstring(content, substr []byte) int {
	for i := 0; i <= len(content)-len(substr); i++ {
		match := true
		for j := 0; j < len(substr); j++ {
			if content[i+j] != substr[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// Ensure Plugin implements the interfaces
var _ plugins.Plugin = (*Plugin)(nil)
var _ plugins.TerminalPlugin = (*Plugin)(nil)
var _ plugins.CommandsProvider = (*Plugin)(nil)
