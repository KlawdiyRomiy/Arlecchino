package app

import (
	"path/filepath"
	"strings"

	"arlecchino/internal/depsync"
	indexerlsp "arlecchino/internal/indexer/lsp"
)

type DependencySyncPlan = depsync.Plan
type DependencySyncManager = depsync.Manager
type DependencySyncCommand = depsync.Command
type DependencyPolicy = depsync.Policy
type DependencyFlatPolicyPlan = depsync.FlatPolicyPlan
type DependencyPolicyPlan = depsync.PolicyPlan
type DependencyPolicyPlanRequest = depsync.PolicyPlanRequest
type DependencySyncActionDescriptor = depsync.ActionDescriptor
type DependencySyncAction = depsync.Action
type DependencyExecuteRequest = depsync.ExecuteRequest
type DependencyFlatExecuteResult = depsync.FlatExecuteResult
type DependencyExecuteResult = depsync.ExecuteResult
type DependencyActionOutcome = depsync.ActionOutcome

func (a *App) GetDependencySyncPlan(mode string) (depsync.Plan, error) {
	exec := depsync.NewExecutor()
	return exec.BuildPlan(a.GetCurrentProjectPath(), depsync.Mode(mode))
}

func (a *App) SyncProjectDependencies(mode string) (map[string]string, error) {
	session := a.activeProjectSession()
	exec := depsync.NewExecutor()
	results, err := exec.Execute(projectPathForDependencySync(session, a), depsync.Mode(mode))
	if err == nil {
		a.refreshRuntimeAfterDependencySyncForSession(session, nil)
	}
	return results, err
}

func (a *App) GetDependencyFlatPolicyPlan(consentMode string) (depsync.FlatPolicyPlan, error) {
	exec := depsync.NewExecutor()
	policy := depsync.DefaultPolicy()
	if consentMode != "" {
		policy.ConsentMode = depsync.ConsentMode(consentMode)
	}
	return exec.BuildFlatPolicyPlan(a.GetCurrentProjectPath(), policy)
}

func (a *App) GetDependencyPolicyPlan(req depsync.PolicyPlanRequest) (depsync.PolicyPlan, error) {
	exec := depsync.NewExecutor()
	return exec.BuildPolicyPlan(a.GetCurrentProjectPath(), req)
}

func (a *App) RunDependencyFlatPolicySync(req depsync.ExecuteRequest) (depsync.FlatExecuteResult, error) {
	session := a.activeProjectSession()
	exec := depsync.NewExecutor()
	result, err := exec.ExecuteWithFlatPolicy(projectPathForDependencySync(session, a), req)
	if err == nil && !req.DryRun {
		a.refreshRuntimeAfterDependencySyncForSession(session, nil)
	}
	return result, err
}

func (a *App) RunDependencyPolicySync(req depsync.ExecuteRequest) (depsync.ExecuteResult, error) {
	session := a.activeProjectSession()
	exec := depsync.NewExecutor()
	result, err := exec.ExecuteWithPolicy(projectPathForDependencySync(session, a), req)
	if err == nil && !req.DryRun {
		a.refreshRuntimeAfterDependencySyncForSession(session, result.Outcomes)
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
	a.refreshRuntimeAfterDependencySyncForSession(a.activeProjectSession(), nil)
}

func (a *App) refreshRuntimeAfterDependencySyncForSession(session *ProjectRuntimeSession, outcomes []depsync.ActionOutcome) {
	if a == nil {
		return
	}
	if session == nil {
		session = a.activeProjectSession()
	}
	type dependencyCatalogRefresher interface {
		RefreshDependencyCatalog()
	}
	brain := a.activeCompletionBrain()
	if session != nil && session.brain != nil {
		brain = session.brain
	}
	if brain, ok := brain.(dependencyCatalogRefresher); ok {
		brain.RefreshDependencyCatalog()
	}
	projectPath := projectPathForDependencySync(session, a)
	if projectPath == "" {
		return
	}
	manager := a.lspManager
	if session != nil && session.lspManager != nil {
		manager = session.lspManager
	}
	if manager == nil || a.lspInstaller == nil {
		return
	}
	workDirs := dependencyOutcomeWorkDirs(projectPath, outcomes)
	manager.ReplaceInstallerConfigs(indexerlsp.ConfigsFromInstallerWithWorkDirs(projectPath, workDirs, a.lspInstaller))
	languages := dependencyOutcomeLanguages(outcomes)
	resetLanguages := manager.ResetRuntimeState(languages, true)
	restarted := make([]string, 0, len(resetLanguages))
	for _, language := range resetLanguages {
		if !manager.HasConfig(language) {
			continue
		}
		if _, ok := manager.GetServer(language); !ok {
			continue
		}
		if restartedOK, err := manager.ForceRestart(language); err == nil && restartedOK {
			restarted = append(restarted, language)
		}
	}
	if session != nil {
		session.lspManager = manager
		if session.brain != nil {
			session.brain.SetLSPManager(manager)
		}
		a.syncDefaultProjectSession(session)
	} else {
		a.lspManager = manager
		if a.brain != nil {
			a.brain.SetLSPManager(manager)
		}
	}
	a.emitEvent("depsync:runtime-refreshed", map[string]any{
		"sessionId":   sessionIDForDependencyEvent(session),
		"projectPath": projectPath,
		"languages":   resetLanguages,
		"restarted":   restarted,
		"workDirs":    workDirs,
	})
}

func projectPathForDependencySync(session *ProjectRuntimeSession, a *App) string {
	if session != nil {
		return strings.TrimSpace(session.currentProjectPath())
	}
	if a != nil {
		return strings.TrimSpace(a.GetCurrentProjectPath())
	}
	return ""
}

func dependencyOutcomeWorkDirs(projectPath string, outcomes []depsync.ActionOutcome) []string {
	projectPath = filepath.Clean(strings.TrimSpace(projectPath))
	seen := map[string]bool{}
	workDirs := make([]string, 0, len(outcomes))
	for _, outcome := range outcomes {
		if outcome.Status != depsync.OutcomeCompleted {
			continue
		}
		manifest := strings.TrimSpace(outcome.Action.Manifest)
		if manifest == "" {
			continue
		}
		workDir := filepath.Clean(filepath.Join(projectPath, filepath.Dir(filepath.FromSlash(manifest))))
		if workDir == "." || workDir == "" || seen[workDir] {
			continue
		}
		seen[workDir] = true
		workDirs = append(workDirs, workDir)
	}
	return workDirs
}

func dependencyOutcomeLanguages(outcomes []depsync.ActionOutcome) []string {
	if len(outcomes) == 0 {
		return nil
	}
	seen := map[string]bool{}
	var languages []string
	add := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(value)
			if value == "" || seen[value] {
				continue
			}
			seen[value] = true
			languages = append(languages, value)
		}
	}
	for _, outcome := range outcomes {
		if outcome.Status != depsync.OutcomeCompleted {
			continue
		}
		switch strings.TrimSpace(outcome.Action.Ecosystem) {
		case "go":
			add("go")
		case "node":
			add("javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "css", "html", "json")
		case "php":
			add("php", "php-laravel")
		case "python":
			add("python")
		case "rust":
			add("rust")
		case "ruby":
			add("ruby")
		case "dart":
			add("dart")
		case "java", "jvm":
			add("java")
			add("kotlin", "scala")
		case "csharp", "dotnet":
			add("csharp")
		case "swift":
			add("swift")
		case "kotlin":
			add("kotlin")
		case "scala":
			add("scala")
		case "terraform":
			add("terraform")
		}
	}
	return languages
}

func sessionIDForDependencyEvent(session *ProjectRuntimeSession) string {
	if session == nil || strings.TrimSpace(session.ID) == "" {
		return defaultProjectSessionID
	}
	return session.ID
}
