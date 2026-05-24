package app

import "arlecchino/internal/depsync"

type DependencySyncPlan = depsync.Plan
type DependencySyncManager = depsync.Manager
type DependencySyncCommand = depsync.Command
type DependencyPolicy = depsync.Policy
type DependencyPolicyPlan = depsync.PolicyPlan
type DependencySyncAction = depsync.Action
type DependencyExecuteRequest = depsync.ExecuteRequest
type DependencyExecuteResult = depsync.ExecuteResult

func (a *App) GetDependencySyncPlan(mode string) (depsync.Plan, error) {
	exec := depsync.NewExecutor()
	return exec.BuildPlan(a.GetCurrentProjectPath(), depsync.Mode(mode))
}

func (a *App) SyncProjectDependencies(mode string) (map[string]string, error) {
	exec := depsync.NewExecutor()
	results, err := exec.Execute(a.GetCurrentProjectPath(), depsync.Mode(mode))
	if err == nil {
		a.refreshDependencyCatalogAfterSync()
	}
	return results, err
}

func (a *App) GetDependencyPolicyPlan(consentMode string) (depsync.PolicyPlan, error) {
	exec := depsync.NewExecutor()
	policy := depsync.DefaultPolicy()
	if consentMode != "" {
		policy.ConsentMode = depsync.ConsentMode(consentMode)
	}
	return exec.BuildPolicyPlan(a.GetCurrentProjectPath(), policy)
}

func (a *App) RunDependencyPolicySync(req depsync.ExecuteRequest) (depsync.ExecuteResult, error) {
	exec := depsync.NewExecutor()
	result, err := exec.ExecuteWithPolicy(a.GetCurrentProjectPath(), req)
	if err == nil && !req.DryRun {
		a.refreshDependencyCatalogAfterSync()
	}
	return result, err
}

func (a *App) ListApprovedDependencyActions() ([]string, error) {
	exec := depsync.NewExecutor()
	return exec.ListApprovedActions(a.GetCurrentProjectPath())
}

func (a *App) ClearApprovedDependencyActions() error {
	exec := depsync.NewExecutor()
	return exec.ClearApprovedActions(a.GetCurrentProjectPath())
}

func (a *App) refreshDependencyCatalogAfterSync() {
	if a == nil {
		return
	}
	type dependencyCatalogRefresher interface {
		RefreshDependencyCatalog()
	}
	if brain, ok := a.activeCompletionBrain().(dependencyCatalogRefresher); ok {
		brain.RefreshDependencyCatalog()
	}
}
