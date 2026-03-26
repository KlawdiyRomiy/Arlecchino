package laravel

import (
	"errors"
	"sync/atomic"
	"testing"
)

func TestPluginInit_DoesNotInitializeExecOrBridgeEagerly(t *testing.T) {
	oldSimpleExec := newSimpleExec
	oldPHPBridge := newPHPBridge
	t.Cleanup(func() {
		newSimpleExec = oldSimpleExec
		newPHPBridge = oldPHPBridge
	})

	var execCalls atomic.Int32
	var bridgeCalls atomic.Int32
	newSimpleExec = func(projectPath string) (*SimpleExec, error) {
		execCalls.Add(1)
		return nil, errors.New("SimpleExec should not initialize during plugin Init")
	}
	newPHPBridge = func(projectPath string) (*PHPBridge, error) {
		bridgeCalls.Add(1)
		return nil, errors.New("PHP bridge should not initialize during plugin Init")
	}

	p := New()
	t.Cleanup(p.Close)

	if err := p.Init(t.TempDir()); err != nil {
		t.Fatalf("Init returned error: %v", err)
	}

	if got := execCalls.Load(); got != 0 {
		t.Fatalf("SimpleExec init calls = %d, want 0", got)
	}
	if got := bridgeCalls.Load(); got != 0 {
		t.Fatalf("PHP bridge init calls = %d, want 0", got)
	}
}

func TestPluginEnsureExec_InitializesOnce(t *testing.T) {
	oldSimpleExec := newSimpleExec
	t.Cleanup(func() {
		newSimpleExec = oldSimpleExec
	})

	var calls atomic.Int32
	newSimpleExec = func(projectPath string) (*SimpleExec, error) {
		calls.Add(1)
		return &SimpleExec{ProjectPath: projectPath, PHPPath: "php"}, nil
	}

	p := New()
	t.Cleanup(p.Close)
	projectPath := t.TempDir()
	if err := p.Init(projectPath); err != nil {
		t.Fatalf("Init returned error: %v", err)
	}

	first, err := p.EnsureExec()
	if err != nil {
		t.Fatalf("first EnsureExec error = %v", err)
	}
	second, err := p.EnsureExec()
	if err != nil {
		t.Fatalf("second EnsureExec error = %v", err)
	}

	if got := calls.Load(); got != 1 {
		t.Fatalf("SimpleExec init calls = %d, want 1", got)
	}
	if first != second {
		t.Fatalf("EnsureExec returned different exec instances")
	}
	if first.ProjectPath != projectPath {
		t.Fatalf("EnsureExec project path = %q, want %q", first.ProjectPath, projectPath)
	}
}
