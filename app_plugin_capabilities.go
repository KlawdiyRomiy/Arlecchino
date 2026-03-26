package main

import (
	"fmt"

	"arlecchino/internal/plugins"
)

func (a *App) getDefinitionProvider() plugins.DefinitionProvider {
	if a.plugins == nil {
		return nil
	}
	p := a.plugins.Get("laravel")
	provider, ok := p.(plugins.DefinitionProvider)
	if !ok {
		return nil
	}
	return provider
}

func (a *App) getArtisanExecutor() (plugins.ArtisanExecutor, error) {
	if a.plugins == nil {
		return nil, fmt.Errorf("no Laravel project opened")
	}
	p := a.plugins.Get("laravel")
	provider, ok := p.(plugins.ArtisanPlugin)
	if !ok {
		return nil, fmt.Errorf("no Laravel project opened")
	}
	return provider.EnsureArtisanExecutor()
}

func (a *App) getRuntimeInspector() (plugins.RuntimeInspector, error) {
	if a.plugins == nil {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	p := a.plugins.Get("laravel")
	provider, ok := p.(plugins.RuntimePlugin)
	if !ok {
		return nil, fmt.Errorf("no PHP Bridge available")
	}
	return provider.EnsureRuntimeInspector()
}
