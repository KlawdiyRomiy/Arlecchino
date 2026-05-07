package main

import (
	"os"
	"path/filepath"
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestActiveCoreEngineForPathPrefersContainingSession(t *testing.T) {
	parentRoot := t.TempDir()
	nestedRoot := filepath.Join(parentRoot, "nested")
	if err := os.MkdirAll(nestedRoot, 0755); err != nil {
		t.Fatalf("mkdir nested root: %v", err)
	}

	app := NewApp()
	parentEngine := &core.Engine{}
	nestedEngine := &core.Engine{}

	parentSession := app.projectSessions.get(defaultProjectSessionID)
	parentSession.coreEngine = parentEngine
	parentSession.setProjectPath(parentRoot)

	nestedSession := &ProjectRuntimeSession{
		ID:         "project-session-nested",
		WindowName: "project:project-session-nested",
		coreEngine: nestedEngine,
	}
	nestedSession.setProjectPath(nestedRoot)
	app.projectSessions.register(nestedSession)

	if got := app.activeCoreEngineForPath(filepath.Join(nestedRoot, "main.go")); got != nestedEngine {
		t.Fatalf("nested path resolved to %p, want nested engine %p", got, nestedEngine)
	}
	if got := app.activeCoreEngineForPath(filepath.Join(parentRoot, "main.go")); got != parentEngine {
		t.Fatalf("parent path resolved to %p, want parent engine %p", got, parentEngine)
	}
	if got := app.activeCoreEngineForPath(filepath.Join(t.TempDir(), "outside.go")); got != parentEngine {
		t.Fatalf("outside path resolved to %p, want active/default engine %p", got, parentEngine)
	}
}

func TestPathWithinRootUsesPathBoundaries(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatalf("mkdir root: %v", err)
	}

	if !pathWithinRoot(filepath.Join(root, "src", "main.go"), root) {
		t.Fatal("child path was not treated as inside root")
	}
	if !pathWithinRoot(root, root) {
		t.Fatal("root path was not treated as inside itself")
	}
	if pathWithinRoot(root+"-sibling", root) {
		t.Fatal("sibling prefix path was treated as inside root")
	}
}
