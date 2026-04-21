package main

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
	return exec.Execute(a.GetCurrentProjectPath(), depsync.Mode(mode))
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
	return exec.ExecuteWithPolicy(a.GetCurrentProjectPath(), req)
}

func (a *App) ListApprovedDependencyActions() ([]string, error) {
	exec := depsync.NewExecutor()
	return exec.ListApprovedActions(a.GetCurrentProjectPath())
}

func (a *App) ClearApprovedDependencyActions() error {
	exec := depsync.NewExecutor()
	return exec.ClearApprovedActions(a.GetCurrentProjectPath())
}
