package main

import (
	"fmt"

	"arlecchino/internal/composer"
	"arlecchino/internal/system"
)

var (
	newComposerManager = composer.NewComposerManager
	newSystemManager   = system.NewSystemManager
)

func (a *App) ensureComposerManager() (*composer.ComposerManager, error) {
	if a == nil {
		return nil, fmt.Errorf("no project opened")
	}
	projectPath := a.currentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	a.managerMu.Lock()
	defer a.managerMu.Unlock()
	if a.cmp != nil {
		return a.cmp, nil
	}

	cmp, err := newComposerManager(projectPath)
	if err != nil {
		return nil, err
	}
	a.cmp = cmp
	return cmp, nil
}

func (a *App) ensureSystemManager() (*system.SystemManager, error) {
	if a == nil {
		return nil, fmt.Errorf("no project opened")
	}
	projectPath := a.currentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	a.managerMu.Lock()
	defer a.managerMu.Unlock()
	if a.sys != nil {
		return a.sys, nil
	}

	sys, err := newSystemManager(projectPath)
	if err != nil {
		return nil, err
	}
	a.sys = sys
	return sys, nil
}
