package main

import (
	"encoding/json"
	"errors"
	"fmt"

	"arlecchino/internal/plugins/laravel"
)

// Laravel Runtime - PHP Bridge operations, indexing, and inspection

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
	inspector, err := a.getRuntimeInspector()
	if err != nil {
		return nil, err
	}
	return inspector.GetMiddlewareList()
}

func (a *App) GetRouteList(filter string) (interface{}, error) {
	inspector, err := a.getRuntimeInspector()
	if err != nil {
		return nil, err
	}
	return inspector.GetRouteList(filter)
}

func (a *App) AnalyzeModels(modelName string) (interface{}, error) {
	inspector, err := a.getRuntimeInspector()
	if err != nil {
		return nil, err
	}
	return inspector.AnalyzeModels(modelName)
}

func (a *App) ExecuteQuery(query string, bindings []interface{}) (interface{}, error) {
	inspector, err := a.getRuntimeInspector()
	if err != nil {
		return nil, err
	}
	return inspector.ExecuteQuery(query, bindings)
}

func (a *App) InspectProject() (interface{}, error) {
	inspector, err := a.getRuntimeInspector()
	if err != nil {
		return nil, err
	}
	return inspector.InspectProject()
}

func (a *App) IndexLaravelModels() (string, error) {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	a.emitEvent("indexing:started", map[string]string{
		"type": "models",
	})

	models, err := provider.ModelEntries()
	if err != nil {
		a.emitEvent("indexing:error", map[string]string{
			"type":  "models",
			"error": err.Error(),
		})
		return "", err
	}

	jsonBytes, err := json.Marshal(models)
	if err != nil {
		return "", err
	}
	jsonData := string(jsonBytes)

	if jsonData == "" {
		jsonData = "{}"
	}

	a.emitEvent("indexing:completed", map[string]interface{}{
		"type":  "models",
		"count": len(models),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelRoutes() (string, error) {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	a.emitEvent("indexing:started", map[string]string{
		"type": "routes",
	})

	routes, err := provider.RouteEntries()
	if err != nil {
		a.emitEvent("indexing:error", map[string]string{
			"type":  "routes",
			"error": err.Error(),
		})
		return "", err
	}

	jsonBytes, err := json.Marshal(routes)
	if err != nil {
		return "", err
	}
	jsonData := string(jsonBytes)

	a.emitEvent("indexing:completed", map[string]interface{}{
		"type":  "routes",
		"count": len(routes),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelViews() (string, error) {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	a.emitEvent("indexing:started", map[string]string{
		"type": "views",
	})

	views, err := provider.ViewEntries()
	if err != nil {
		a.emitEvent("indexing:error", map[string]string{
			"type":  "views",
			"error": err.Error(),
		})
		return "", err
	}

	jsonBytes, err := json.Marshal(views)
	if err != nil {
		return "", err
	}
	jsonData := string(jsonBytes)

	a.emitEvent("indexing:completed", map[string]interface{}{
		"type":  "views",
		"count": len(views),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelConfig() (string, error) {
	provider := a.getDefinitionProvider()
	if provider == nil {
		return "", fmt.Errorf("no Laravel project opened")
	}

	a.emitEvent("indexing:started", map[string]string{
		"type": "config",
	})

	keys, err := provider.ConfigEntries()
	if err != nil {
		a.emitEvent("indexing:error", map[string]string{
			"type":  "config",
			"error": err.Error(),
		})
		return "", err
	}

	jsonBytes, err := json.Marshal(keys)
	if err != nil {
		return "", err
	}
	jsonData := string(jsonBytes)

	a.emitEvent("indexing:completed", map[string]interface{}{
		"type":  "config",
		"count": len(keys),
	})

	return jsonData, nil
}

func (a *App) IndexLaravelAll() (map[string]interface{}, error) {
	result := make(map[string]interface{})
	failures := make([]error, 0)

	if modelsData, err := a.IndexLaravelModels(); err == nil {
		result["models"] = modelsData
	} else {
		failures = append(failures, fmt.Errorf("models: %w", err))
	}

	if routesData, err := a.IndexLaravelRoutes(); err == nil {
		result["routes"] = routesData
	} else {
		failures = append(failures, fmt.Errorf("routes: %w", err))
	}

	if viewsData, err := a.IndexLaravelViews(); err == nil {
		result["views"] = viewsData
	} else {
		failures = append(failures, fmt.Errorf("views: %w", err))
	}

	if configData, err := a.IndexLaravelConfig(); err == nil {
		result["config"] = configData
	} else {
		failures = append(failures, fmt.Errorf("config: %w", err))
	}

	if len(failures) > 0 {
		return result, errors.Join(failures...)
	}
	return result, nil
}
