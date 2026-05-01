package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"arlecchino/internal/composer"
	"arlecchino/internal/system"
	"arlecchino/internal/terminal"
)

func TestOpenProject_DoesNotInitializePHPSpecificManagersEagerly(t *testing.T) {
	oldComposerManager := newComposerManager
	oldSystemManager := newSystemManager
	t.Cleanup(func() {
		newComposerManager = oldComposerManager
		newSystemManager = oldSystemManager
	})

	var composerCalls atomic.Int32
	var systemCalls atomic.Int32
	newComposerManager = func(projectPath string) (*composer.ComposerManager, error) {
		composerCalls.Add(1)
		return nil, errors.New("composer manager should not initialize during OpenProject")
	}
	newSystemManager = func(projectPath string) (*system.SystemManager, error) {
		systemCalls.Add(1)
		return nil, errors.New("system manager should not initialize during OpenProject")
	}

	projectPath := t.TempDir()
	app := &App{}
	t.Cleanup(func() {
		_ = app.CloseProject()
	})

	if err := app.OpenProject(projectPath); err != nil {
		t.Fatalf("OpenProject returned error for non-Laravel project: %v", err)
	}

	if got := composerCalls.Load(); got != 0 {
		t.Fatalf("composer manager init calls = %d, want 0", got)
	}
	if got := systemCalls.Load(); got != 0 {
		t.Fatalf("system manager init calls = %d, want 0", got)
	}
}

func TestOpenProject_RejectsUnreadableProjectBeforeChangingState(t *testing.T) {
	parent := t.TempDir()
	projectPath := filepath.Join(parent, "blocked")
	if err := os.Mkdir(projectPath, 0o700); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	if err := os.Chmod(projectPath, 0o300); err != nil {
		t.Fatalf("chmod project unreadable: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(projectPath, 0o700)
	})

	app := &App{}
	err := app.OpenProject(projectPath)
	if err == nil {
		t.Fatal("OpenProject returned nil for unreadable project")
	}
	if !strings.Contains(err.Error(), "project directory is not readable") {
		t.Fatalf("OpenProject error = %v, want unreadable project error", err)
	}
	if got := app.currentProjectPath(); got != "" {
		t.Fatalf("currentProjectPath = %q, want empty after failed open", got)
	}
}

func TestInspectProjectAccess_ReturnsPermissionFailureWithoutError(t *testing.T) {
	parent := t.TempDir()
	projectPath := filepath.Join(parent, "blocked")
	if err := os.Mkdir(projectPath, 0o700); err != nil {
		t.Fatalf("mkdir project: %v", err)
	}
	if err := os.Chmod(projectPath, 0o300); err != nil {
		t.Fatalf("chmod project unreadable: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(projectPath, 0o700)
	})

	inspection := (&App{}).InspectProjectAccess(projectPath)
	if inspection.Accessible {
		t.Fatal("InspectProjectAccess marked unreadable project accessible")
	}
	if inspection.Path != projectPath {
		t.Fatalf("InspectProjectAccess path = %q, want %q", inspection.Path, projectPath)
	}
	if !strings.Contains(inspection.Reason, "project directory is not readable") {
		t.Fatalf("InspectProjectAccess reason = %q, want unreadable project reason", inspection.Reason)
	}
}

func TestAppEnsureComposerManager_InitializesOnce(t *testing.T) {
	oldComposerManager := newComposerManager
	t.Cleanup(func() {
		newComposerManager = oldComposerManager
	})

	var calls atomic.Int32
	newComposerManager = func(projectPath string) (*composer.ComposerManager, error) {
		calls.Add(1)
		return &composer.ComposerManager{ProjectPath: projectPath, ComposerPath: "/bin/echo"}, nil
	}

	app := &App{projectPath: t.TempDir()}

	first, err := app.ensureComposerManager()
	if err != nil {
		t.Fatalf("first ensureComposerManager error = %v", err)
	}
	second, err := app.ensureComposerManager()
	if err != nil {
		t.Fatalf("second ensureComposerManager error = %v", err)
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("composer manager init calls = %d, want 1", got)
	}
	if first != second {
		t.Fatalf("ensureComposerManager returned different manager instances")
	}
}

func TestAppEnsureSystemManager_InitializesOnce(t *testing.T) {
	oldSystemManager := newSystemManager
	t.Cleanup(func() {
		newSystemManager = oldSystemManager
	})

	var calls atomic.Int32
	newSystemManager = func(projectPath string) (*system.SystemManager, error) {
		calls.Add(1)
		return &system.SystemManager{ProjectPath: projectPath, PHPPath: "php"}, nil
	}

	app := &App{projectPath: t.TempDir()}

	first, err := app.ensureSystemManager()
	if err != nil {
		t.Fatalf("first ensureSystemManager error = %v", err)
	}
	second, err := app.ensureSystemManager()
	if err != nil {
		t.Fatalf("second ensureSystemManager error = %v", err)
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("system manager init calls = %d, want 1", got)
	}
	if first != second {
		t.Fatalf("ensureSystemManager returned different manager instances")
	}
}

func TestAppEnsureComposerManager_ConcurrentCallsInitializeOnce(t *testing.T) {
	oldComposerManager := newComposerManager
	t.Cleanup(func() {
		newComposerManager = oldComposerManager
	})

	var calls atomic.Int32
	start := make(chan struct{})
	newComposerManager = func(projectPath string) (*composer.ComposerManager, error) {
		calls.Add(1)
		<-start
		return &composer.ComposerManager{ProjectPath: projectPath, ComposerPath: "/bin/echo"}, nil
	}

	app := &App{projectPath: t.TempDir()}
	results := make(chan *composer.ComposerManager, 2)
	errCh := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			mgr, err := app.ensureComposerManager()
			if err != nil {
				errCh <- err
				return
			}
			results <- mgr
		}()
	}

	for calls.Load() < 1 {
	}
	close(start)
	wg.Wait()
	close(errCh)
	close(results)

	for err := range errCh {
		if err != nil {
			t.Fatalf("ensureComposerManager error = %v", err)
		}
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("composer manager init calls = %d, want 1", got)
	}

	var managers []*composer.ComposerManager
	for mgr := range results {
		managers = append(managers, mgr)
	}
	if len(managers) != 2 {
		t.Fatalf("ensureComposerManager returned %d managers, want 2", len(managers))
	}
	if managers[0] != managers[1] {
		t.Fatalf("concurrent ensureComposerManager returned different manager instances")
	}
}

func TestAppEnsureSystemManager_ConcurrentCallsInitializeOnce(t *testing.T) {
	oldSystemManager := newSystemManager
	t.Cleanup(func() {
		newSystemManager = oldSystemManager
	})

	var calls atomic.Int32
	start := make(chan struct{})
	newSystemManager = func(projectPath string) (*system.SystemManager, error) {
		calls.Add(1)
		<-start
		return &system.SystemManager{ProjectPath: projectPath, PHPPath: "php"}, nil
	}

	app := &App{projectPath: t.TempDir()}
	results := make(chan *system.SystemManager, 2)
	errCh := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			mgr, err := app.ensureSystemManager()
			if err != nil {
				errCh <- err
				return
			}
			results <- mgr
		}()
	}

	for calls.Load() < 1 {
	}
	close(start)
	wg.Wait()
	close(errCh)
	close(results)

	for err := range errCh {
		if err != nil {
			t.Fatalf("ensureSystemManager error = %v", err)
		}
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("system manager init calls = %d, want 1", got)
	}

	var managers []*system.SystemManager
	for mgr := range results {
		managers = append(managers, mgr)
	}
	if len(managers) != 2 {
		t.Fatalf("ensureSystemManager returned %d managers, want 2", len(managers))
	}
	if managers[0] != managers[1] {
		t.Fatalf("concurrent ensureSystemManager returned different manager instances")
	}
}

func TestCloseProject_WaitsForManagerMutexBeforeClearingManagers(t *testing.T) {
	app := &App{
		cmp: &composer.ComposerManager{ProjectPath: t.TempDir(), ComposerPath: "/bin/echo"},
		sys: &system.SystemManager{ProjectPath: t.TempDir(), PHPPath: "php"},
	}

	app.managerMu.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = app.CloseProject()
	}()

	select {
	case <-done:
		t.Fatal("CloseProject returned while managerMu was still locked")
	case <-time.After(25 * time.Millisecond):
	}

	if app.cmp == nil || app.sys == nil {
		t.Fatal("CloseProject cleared managers before acquiring managerMu")
	}

	app.managerMu.Unlock()

	<-done

	if app.cmp != nil || app.sys != nil {
		t.Fatal("CloseProject did not clear managers after acquiring managerMu")
	}
}

func TestCloseProject_ClosesAllTerminalSessions(t *testing.T) {
	workingDir := t.TempDir()
	termManager := terminal.NewManager()
	session, err := termManager.Create("term-1", "Terminal", workingDir)
	if err != nil {
		t.Fatalf("Create terminal session error = %v", err)
	}
	t.Cleanup(func() {
		_ = session.Close()
		termManager.CloseAll()
	})

	app := &App{termManager: termManager, projectPath: workingDir}
	if got := len(termManager.List()); got != 1 {
		t.Fatalf("terminal sessions before CloseProject = %d, want 1", got)
	}

	if err := app.CloseProject(); err != nil {
		t.Fatalf("CloseProject error = %v", err)
	}

	if got := len(termManager.List()); got != 0 {
		t.Fatalf("terminal sessions after CloseProject = %d, want 0", got)
	}
}

func TestOpenProject_PreservesTerminalSessionsAcrossProjectSwitch(t *testing.T) {
	fromDir := t.TempDir()
	toDir := t.TempDir()
	termManager := terminal.NewManager()
	session, err := termManager.Create("term-1", "Terminal", fromDir)
	if err != nil {
		t.Fatalf("Create terminal session error = %v", err)
	}

	app := &App{termManager: termManager, projectPath: fromDir}
	t.Cleanup(func() {
		_ = app.CloseProject()
	})

	if got := len(termManager.List()); got != 1 {
		t.Fatalf("terminal sessions before OpenProject = %d, want 1", got)
	}

	if err := app.OpenProject(toDir); err != nil {
		t.Fatalf("OpenProject error = %v", err)
	}

	if got := len(termManager.List()); got != 1 {
		t.Fatalf("terminal sessions after OpenProject = %d, want 1", got)
	}

	if err := session.Write([]byte("pwd\n")); err != nil {
		t.Fatalf("preserved terminal session write error = %v", err)
	}
}
