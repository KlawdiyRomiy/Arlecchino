package main

import (
	"fmt"

	"arlecchino/internal/indexer"
	"arlecchino/internal/plugins/laravel"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Laravel Runtime - PHP Bridge operations, indexing, and inspection

// getLaravelPlugin returns Laravel plugin, or nil if not available
func (a *App) getLaravelPlugin() *laravel.Plugin {
	if a.plugins == nil {
		return nil
	}
	p := a.plugins.Get("laravel")
	if p == nil {
		return nil
	}
	lp, ok := p.(*laravel.Plugin)
	if !ok {
		return nil
	}
	return lp
}

// getLaravelBridge returns Laravel PHP bridge from plugin
func (a *App) getLaravelBridge() *laravel.PHPBridge {
	lp := a.getLaravelPlugin()
	if lp == nil {
		return nil
	}
	return lp.Bridge()
}

func (a *App) IsLaravelProject(path string) bool {
	return laravel.IsLaravelProject(path)
}

func (a *App) FindEnv(path string) bool {
	return laravel.FindEnv(path)
}

func (a *App) GetLaravelVersion(path string) (string, error) {
	return laravel.GetLaravelVersion(path)
}

func (a *App) GetMiddlewareList() (interface{}, error) {
	bridge := a.getLaravelBridge()
	if bridge == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return bridge.GetMiddlewareList()
}

func (a *App) GetRouteList(filter string) (interface{}, error) {
	bridge := a.getLaravelBridge()
	if bridge == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return bridge.GetRouteList(filter)
}

func (a *App) AnalyzeModels(modelName string) (interface{}, error) {
	bridge := a.getLaravelBridge()
	if bridge == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return bridge.AnalyzeModels(modelName)
}

func (a *App) ExecuteQuery(query string, bindings []interface{}) (interface{}, error) {
	bridge := a.getLaravelBridge()
	if bridge == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return bridge.ExecuteQuery(query, bindings)
}

func (a *App) GetRelatedFiles(filePath string) ([]indexer.FileRelation, error) {
	if a.idx == nil {
		return nil, fmt.Errorf("no project opened")
	}
	return a.idx.AnalyzeFile(filePath)
}

func (a *App) InspectProject() (*laravel.ProjectStructure, error) {
	bridge := a.getLaravelBridge()
	if bridge == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return bridge.InspectProject()
}

func (a *App) IndexLaravelModels() (string, error) {
	lp := a.getLaravelPlugin()
	if lp == nil || lp.Models() == nil {
		return "{}", nil
	}

	runtime.EventsEmit(a.ctx, "indexing:started", map[string]string{
		"type": "models",
	})

	models, err := lp.Models().Index()
	if err != nil {
		runtime.EventsEmit(a.ctx, "indexing:error", map[string]string{
			"type":  "models",
			"error": err.Error(),
		})
		return "{}", nil
	}

	jsonData, err := lp.Models().ExportJSON(models)
	if err != nil {
		return "{}", nil
	}

	if jsonData == "" {
		jsonData = "{}"
	}

	runtime.EventsEmit(a.ctx, "indexing:completed", map[string]interface{}{
		"type":  "models",
		"count": len(models),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelRoutes() (string, error) {
	lp := a.getLaravelPlugin()
	if lp == nil || lp.Routes() == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	runtime.EventsEmit(a.ctx, "indexing:started", map[string]string{
		"type": "routes",
	})

	routes, err := lp.Routes().Index()
	if err != nil {
		runtime.EventsEmit(a.ctx, "indexing:error", map[string]string{
			"type":  "routes",
			"error": err.Error(),
		})
		return "", err
	}

	jsonData, err := lp.Routes().ExportJSON(routes)
	if err != nil {
		return "", err
	}

	runtime.EventsEmit(a.ctx, "indexing:completed", map[string]interface{}{
		"type":  "routes",
		"count": len(routes),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelViews() (string, error) {
	lp := a.getLaravelPlugin()
	if lp == nil || lp.Views() == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	runtime.EventsEmit(a.ctx, "indexing:started", map[string]string{
		"type": "views",
	})

	views, err := lp.Views().Index()
	if err != nil {
		runtime.EventsEmit(a.ctx, "indexing:error", map[string]string{
			"type":  "views",
			"error": err.Error(),
		})
		return "", err
	}

	jsonData, err := lp.Views().ExportJSON(views)
	if err != nil {
		return "", err
	}

	runtime.EventsEmit(a.ctx, "indexing:completed", map[string]interface{}{
		"type":  "views",
		"count": len(views),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelConfig() (string, error) {
	lp := a.getLaravelPlugin()
	if lp == nil || lp.Config() == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	runtime.EventsEmit(a.ctx, "indexing:started", map[string]string{
		"type": "config",
	})

	keys, err := lp.Config().Index()
	if err != nil {
		runtime.EventsEmit(a.ctx, "indexing:error", map[string]string{
			"type":  "config",
			"error": err.Error(),
		})
		return "", err
	}

	jsonData, err := lp.Config().ExportJSON(keys)
	if err != nil {
		return "", err
	}

	runtime.EventsEmit(a.ctx, "indexing:completed", map[string]interface{}{
		"type":  "config",
		"count": len(keys),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelAll() (map[string]interface{}, error) {
	result := make(map[string]interface{})

	if modelsData, err := a.IndexLaravelModels(); err == nil {
		result["models"] = modelsData
	}

	if routesData, err := a.IndexLaravelRoutes(); err == nil {
		result["routes"] = routesData
	}

	if viewsData, err := a.IndexLaravelViews(); err == nil {
		result["views"] = viewsData
	}

	if configData, err := a.IndexLaravelConfig(); err == nil {
		result["config"] = configData
	}

	return result, nil
}
