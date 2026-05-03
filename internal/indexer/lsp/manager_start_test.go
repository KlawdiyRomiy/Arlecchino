package lsp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCompleteWithContextHonorsStartupContext(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "slow-lsp")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatalf("write slow lsp script: %v", err)
	}

	m := NewManager(dir)
	m.RegisterServer(ServerConfig{Language: "php", Command: scriptPath})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	startedAt := time.Now()
	_, _ = m.CompleteWithContext(ctx, "php", filepath.Join(dir, "index.php"), 1, 1)
	if elapsed := time.Since(startedAt); elapsed > 300*time.Millisecond {
		t.Fatalf("completion startup ignored context, elapsed=%s", elapsed)
	}
}

func TestDidChangeWithContextHonorsStartupContext(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "slow-lsp")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatalf("write slow lsp script: %v", err)
	}

	m := NewManager(dir)
	m.RegisterServer(ServerConfig{Language: "php", Command: scriptPath})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	startedAt := time.Now()
	_ = m.DidChangeWithContext(ctx, "php", filepath.Join(dir, "index.php"), 2, "<?php\n")
	if elapsed := time.Since(startedAt); elapsed > 300*time.Millisecond {
		t.Fatalf("didChange startup ignored context, elapsed=%s", elapsed)
	}
}

func TestStartFailureBackoffSkipsRepeatedMissingServerStart(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	m.startBackoff = time.Second
	m.RegisterServer(ServerConfig{
		Language: "php",
		Command:  filepath.Join(dir, "missing-phpactor"),
	})

	_, _ = m.CompleteWithContext(context.Background(), "php", filepath.Join(dir, "index.php"), 1, 1)

	failure, ok := m.activeStartFailure("php")
	if !ok {
		t.Fatalf("expected missing server start to record backoff")
	}
	if !strings.Contains(failure.err, "missing-phpactor") {
		t.Fatalf("expected failure to mention missing command, got %q", failure.err)
	}

	startedAt := time.Now()
	_, _ = m.CompleteWithContext(context.Background(), "php", filepath.Join(dir, "index.php"), 1, 1)
	if elapsed := time.Since(startedAt); elapsed > 50*time.Millisecond {
		t.Fatalf("expected repeated start to be skipped by backoff, elapsed=%s", elapsed)
	}
}
