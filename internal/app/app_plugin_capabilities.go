package app

import (
	"fmt"

	"arlecchino/internal/plugins"
)

func (a *App) getDefinitionProvider() plugins.DefinitionProvider {
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry == nil {
		return nil
	}
	p := pluginRegistry.Get("laravel")
	if p == nil {
		return nil
	}
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" || !p.IsApplicable(projectPath) {
		return nil
	}
	provider, ok := p.(plugins.DefinitionProvider)
	if !ok {
		return nil
	}
	return provider
}

func (a *App) getArtisanExecutor() (plugins.ArtisanExecutor, error) {
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry == nil {
		return nil, fmt.Errorf("no Laravel project opened")
	}
	p := pluginRegistry.Get("laravel")
	provider, ok := p.(plugins.ArtisanPlugin)
	if !ok {
		return nil, fmt.Errorf("no Laravel project opened")
	}
	return provider.EnsureArtisanExecutor()
}

func (a *App) getRuntimeInspector() (plugins.RuntimeInspector, error) {
	pluginRegistry := a.activePluginRegistry()
	if pluginRegistry == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	p := pluginRegistry.Get("laravel")
	provider, ok := p.(plugins.RuntimePlugin)
	if !ok {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return provider.EnsureRuntimeInspector()
}
