package app

import (
	"fmt"

	"arlecchino/internal/composer"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/system"
)

var (
	newComposerManager = composer.NewComposerManager
	newCoreEngine      = core.NewEngine
	newSystemManager   = system.NewSystemManager
)

func (a *App) ensureComposerManager() (*composer.ComposerManager, error) {
	if a == nil {
		return nil, fmt.Errorf("no project opened")
	}
	a.managerMu.Lock()
	defer a.managerMu.Unlock()

	session := a.activeProjectSession()
	projectPath := a.currentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	if session != nil {
		if session.cmp != nil {
			return session.cmp, nil
		}
	} else if a.cmp != nil {
		return a.cmp, nil
	}

	cmp, err := newComposerManager(projectPath)
	if err != nil {
		return nil, err
	}
	if session != nil {
		session.cmp = cmp
		a.syncDefaultProjectSession(session)
	} else {
		a.cmp = cmp
	}
	return cmp, nil
}

func (a *App) ensureSystemManager() (*system.SystemManager, error) {
	if a == nil {
		return nil, fmt.Errorf("no project opened")
	}
	a.managerMu.Lock()
	defer a.managerMu.Unlock()

	session := a.activeProjectSession()
	projectPath := a.currentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	if session != nil {
		if session.sys != nil {
			return session.sys, nil
		}
	} else if a.sys != nil {
		return a.sys, nil
	}

	sys, err := newSystemManager(projectPath)
	if err != nil {
		return nil, err
	}
	if session != nil {
		session.sys = sys
		a.syncDefaultProjectSession(session)
	} else {
		a.sys = sys
	}
	return sys, nil
}
