package main

import "arlecchino/internal/depsync"

type DependencySyncPlan = depsync.Plan
type DependencySyncManager = depsync.Manager
type DependencySyncCommand = depsync.Command

func (a *App) GetDependencySyncPlan(mode string) (depsync.Plan, error) {
	exec := depsync.NewExecutor()
	return exec.BuildPlan(a.GetCurrentProjectPath(), depsync.Mode(mode))
}

func (a *App) SyncProjectDependencies(mode string) (map[string]string, error) {
	exec := depsync.NewExecutor()
	return exec.Execute(a.GetCurrentProjectPath(), depsync.Mode(mode))
}
