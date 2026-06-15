package lsp

import (
	"context"
	"errors"
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

func TestWithStartReasonPropagatesToStartupContext(t *testing.T) {
	ctx := WithStartReason(context.Background(), "manual_project_scan")
	if got := startReasonFromContext(ctx); got != "manual_project_scan" {
		t.Fatalf("start reason = %q, want manual_project_scan", got)
	}
	if got := startReasonFromContext(WithStartReason(ctx, "")); got != "manual_project_scan" {
		t.Fatalf("empty reason should preserve parent value, got %q", got)
	}
	if got := startReasonFromContext(context.Background()); got != "unspecified" {
		t.Fatalf("default start reason = %q, want unspecified", got)
	}
}

func TestLSPProcessPriorityPolicyDefaultsToLowImpact(t *testing.T) {
	policy := lspProcessPriorityPolicyFromEnv(func(string) string { return "" })
	if !policy.Enabled {
		t.Fatal("expected default LSP priority policy to be enabled")
	}
	if policy.Nice != defaultLSPProcessNice {
		t.Fatalf("nice = %d, want %d", policy.Nice, defaultLSPProcessNice)
	}
	if policy.Source != "default" {
		t.Fatalf("source = %q, want default", policy.Source)
	}
}

func TestLSPProcessPriorityPolicyCanBeDisabled(t *testing.T) {
	policy := lspProcessPriorityPolicyFromEnv(func(key string) string {
		if key == "ARLECCHINO_LSP_LOW_IMPACT" {
			return "false"
		}
		return ""
	})
	if policy.Enabled {
		t.Fatal("expected disabled LSP priority policy")
	}
	if policy.Nice != 0 {
		t.Fatalf("nice = %d, want 0", policy.Nice)
	}
}

func TestLSPProcessPriorityPolicyClampsNiceOverride(t *testing.T) {
	policy := lspProcessPriorityPolicyFromEnv(func(key string) string {
		if key == "ARLECCHINO_LSP_NICE" {
			return "42"
		}
		return ""
	})
	if !policy.Enabled {
		t.Fatal("expected LSP priority policy to stay enabled")
	}
	if policy.Nice != 19 {
		t.Fatalf("nice = %d, want 19", policy.Nice)
	}
	if policy.Source != "env" {
		t.Fatalf("source = %q, want env", policy.Source)
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

func TestStartFailureBackoffPreservesTimeoutCause(t *testing.T) {
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "slow-lsp")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\nsleep 5\n"), 0o755); err != nil {
		t.Fatalf("write slow lsp script: %v", err)
	}

	m := NewManager(dir)
	m.RegisterServer(ServerConfig{Language: "php", Command: scriptPath})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	_, err := m.CompleteWithContext(ctx, "php", filepath.Join(dir, "index.php"), 1, 1)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("first startup error = %v, want deadline exceeded", err)
	}

	_, err = m.CompleteWithContext(context.Background(), "php", filepath.Join(dir, "index.php"), 1, 1)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("backoff error = %v, want deadline exceeded", err)
	}
}
