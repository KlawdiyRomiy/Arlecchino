package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeriveCloneProjectName(t *testing.T) {
	tests := map[string]string{
		"git@github.com:org/repo.git":             "repo",
		"https://github.com/org/repo.git":         "repo",
		"https://github.com/org/repo.git?depth=1": "repo",
		"ssh://git@github.com/org/repo.git":       "repo",
		"/Users/example/Projects/source.git":      "source",
		"https://github.com/org/repo-without-dot": "repo-without-dot",
		"https://github.com/org/repo-with-slash/": "repo-with-slash",
		"git@gitlab.com:group/subgroup/repo.git":  "repo",
		"https://example.com/group/repo.git#main": "repo",
		"  https://github.com/org/space.git  ":    "space",
	}

	for input, want := range tests {
		if got := deriveCloneProjectName(input); got != want {
			t.Fatalf("deriveCloneProjectName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestNormalizeCloneProjectNameRejectsPathTraversal(t *testing.T) {
	for _, input := range []string{"../repo", "group/repo", `group\repo`, ".", "..", ""} {
		if _, err := normalizeCloneProjectName(input); err == nil {
			t.Fatalf("normalizeCloneProjectName(%q) error = nil, want error", input)
		}
	}
}

func TestSanitizeCloneOutputRedactsCredentials(t *testing.T) {
	repositoryURL := "https://token:secret@example.com/org/repo.git"
	output := "fatal: could not read from https://token:secret@example.com/org/repo.git"

	got := sanitizeCloneOutput(output, repositoryURL)
	if strings.Contains(got, "token") || strings.Contains(got, "secret") {
		t.Fatalf("sanitizeCloneOutput leaked credentials: %q", got)
	}
}

func TestCloneRepositoryClonesLocalRepository(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not available")
	}

	tempDir := t.TempDir()
	sourceDir := filepath.Join(tempDir, "source")
	destinationDir := filepath.Join(tempDir, "destination")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(destinationDir, 0o755); err != nil {
		t.Fatal(err)
	}

	runGit(t, sourceDir, "init")
	if err := os.WriteFile(filepath.Join(sourceDir, "README.md"), []byte("# source\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, sourceDir, "add", "README.md")
	runGit(t, sourceDir, "-c", "user.email=test@example.com", "-c", "user.name=Test User", "commit", "-m", "initial")

	app := &App{}
	clonedPath, err := app.CloneRepository(sourceDir, destinationDir, "")
	if err != nil {
		t.Fatalf("CloneRepository() error = %v", err)
	}

	if clonedPath != filepath.Join(destinationDir, "source") {
		t.Fatalf("CloneRepository() path = %q, want cloned source directory", clonedPath)
	}
	if _, err := os.Stat(filepath.Join(clonedPath, ".git")); err != nil {
		t.Fatalf("cloned repository .git missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(clonedPath, "README.md")); err != nil {
		t.Fatalf("cloned repository file missing: %v", err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()

	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", args, err, string(output))
	}
}
