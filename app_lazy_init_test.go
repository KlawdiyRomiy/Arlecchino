package main

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"arlecchino/internal/composer"
	"arlecchino/internal/system"
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

	app := &App{}
	t.Cleanup(func() {
		_ = app.CloseProject()
	})

	if err := app.OpenProject(t.TempDir()); err != nil {
		t.Fatalf("OpenProject returned error for non-Laravel project: %v", err)
	}

	if got := composerCalls.Load(); got != 0 {
		t.Fatalf("composer manager init calls = %d, want 0", got)
	}
	if got := systemCalls.Load(); got != 0 {
		t.Fatalf("system manager init calls = %d, want 0", got)
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
