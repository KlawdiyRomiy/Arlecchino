package app

import (
	"testing"

	"arlecchino/internal/project"
)

func TestGetCurrentProjectFramework_ReturnsEmptyWhenNoProject(t *testing.T) {
	app := &App{}

	if got := app.GetCurrentProjectFramework(); got != "" {
		t.Fatalf("GetCurrentProjectFramework() = %q, want empty string", got)
	}
}

func TestGetCurrentProjectFramework_ReturnsCurrentProjectFramework(t *testing.T) {
	app := &App{
		projectManager: &project.ProjectManager{
			CurrentProject: &project.Project{Framework: "laravel"},
		},
	}

	if got := app.GetCurrentProjectFramework(); got != "laravel" {
		t.Fatalf("GetCurrentProjectFramework() = %q, want %q", got, "laravel")
	}
}
