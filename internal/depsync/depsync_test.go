package depsync

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildPlan_DetectsMultipleManagers(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module example.com/test\ngo 1.24\n")
	writeFile(t, filepath.Join(root, "package.json"), "{}")
	writeFile(t, filepath.Join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
	writeFile(t, filepath.Join(root, "composer.json"), `{"require":{"nesbot/carbon":"^3.0"}}`)

	exec := NewExecutor()
	plan, err := exec.BuildPlan(root, ModeSafeAuto)
	if err != nil {
		t.Fatalf("BuildPlan error: %v", err)
	}
	if len(plan.Managers) < 3 {
		t.Fatalf("expected at least 3 managers, got %d", len(plan.Managers))
	}
	assertHasManager(t, plan, "go", "go")
	assertHasManager(t, plan, "node", "pnpm")
	assertHasManager(t, plan, "php", "composer")
}

func TestBuildPlan_SafeAutoFiltersUnsafeCommands(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module example.com/test\ngo 1.24\n")
	exec := NewExecutor()
	plan, err := exec.BuildPlan(root, ModeSafeAuto)
	if err != nil {
		t.Fatalf("BuildPlan error: %v", err)
	}
	for _, manager := range plan.Managers {
		for _, cmd := range manager.Commands {
			if !cmd.Safe {
				t.Fatalf("safe-auto plan contains unsafe command: %#v", cmd)
			}
		}
	}
}

func TestExecute_ManualDoesNotRunCommands(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module example.com/test\ngo 1.24\n")
	exec := NewExecutor()
	called := false
	exec.runner = func(dir, name string, args ...string) ([]byte, error) {
		called = true
		return nil, nil
	}
	if _, err := exec.Execute(root, ModeManual); err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if called {
		t.Fatalf("manual mode should not run commands")
	}
}

func TestExecute_SkipsMissingExecutables(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "Cargo.toml"), "[package]\nname='demo'\nversion='0.1.0'\n")
	exec := NewExecutor()
	called := false
	exec.runner = func(dir, name string, args ...string) ([]byte, error) {
		called = true
		return nil, nil
	}

	results, err := exec.Execute(root, ModeSafeAuto)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if called {
		t.Fatalf("missing executable should be skipped before runner invocation")
	}
	if got := results["rust:fetch"]; got == "" || !strings.Contains(got, "skipped: missing executable") {
		t.Fatalf("expected skipped result for missing cargo, got %q", got)
	}
}

func TestExecute_ContinuesAfterCommandFailure(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "go.mod"), "module example.com/test\ngo 1.24\n")
	exec := NewExecutor()
	exec.runner = func(dir, name string, args ...string) ([]byte, error) {
		if strings.Join(args, " ") == "mod tidy" {
			return []byte("tidy failed output"), assertErr("boom")
		}
		return []byte("ok"), nil
	}

	results, err := exec.Execute(root, ModeFullAuto)
	if err != nil {
		t.Fatalf("Execute should not fail whole run, got: %v", err)
	}
	if got := results["go:tidy"]; !strings.Contains(got, "failed: boom") {
		t.Fatalf("expected failed marker for go:tidy, got %q", got)
	}
	if _, ok := results["go:update"]; !ok {
		t.Fatalf("expected subsequent command result to be preserved")
	}
}

type assertErr string

func (e assertErr) Error() string { return string(e) }

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := osWriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

var osWriteFile = func(name string, data []byte, perm uint32) error {
	return writeFileCompat(name, data, perm)
}

func assertHasManager(t *testing.T, plan Plan, ecosystem, tool string) {
	t.Helper()
	for _, manager := range plan.Managers {
		if manager.Ecosystem == ecosystem && manager.Tool == tool {
			return
		}
	}
	t.Fatalf("expected manager %s/%s in %#v", ecosystem, tool, plan.Managers)
}
