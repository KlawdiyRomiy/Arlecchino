package execution

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveProfiles_GoMainFile(t *testing.T) {
	service := NewService(nil)
	service.lookPath = func(tool string) (string, error) {
		return "/usr/bin/" + tool, nil
	}

	profiles := service.ResolveProfiles(ResolveRequest{
		ProjectPath:        "/workspace",
		ActiveFilePath:     "/workspace/cmd/api/main.go",
		ActiveFileName:     "main.go",
		ActiveFileContent:  "package main\n\nfunc main() {}\n",
		ActiveFileLanguage: "go",
	})

	if len(profiles.RunProfiles) != 1 {
		t.Fatalf("run profile count = %d, want 1", len(profiles.RunProfiles))
	}

	if got := profiles.RunProfiles[0].Command; got != "go run '/workspace/cmd/api/main.go'" {
		t.Fatalf("run command = %q, want %q", got, "go run '/workspace/cmd/api/main.go'")
	}

	if len(profiles.DebugProfiles) != 1 {
		t.Fatalf("debug profile count = %d, want 1", len(profiles.DebugProfiles))
	}

	if got := profiles.DebugProfiles[0].Command; got != "dlv debug '/workspace/cmd/api'" {
		t.Fatalf("debug command = %q, want %q", got, "dlv debug '/workspace/cmd/api'")
	}
}

func TestResolveProfiles_ProjectPackageJSONScripts(t *testing.T) {
	projectDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectDir, "package.json"), []byte(`{
		"name": "demo",
		"scripts": {
			"start": "node server.js",
			"debug": "node --inspect server.js"
		}
	}`), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}

	service := NewService(nil)
	service.lookPath = func(tool string) (string, error) {
		return "/usr/bin/" + tool, nil
	}

	profiles := service.ResolveProfiles(ResolveRequest{ProjectPath: projectDir})

	if len(profiles.RunProfiles) == 0 {
		t.Fatalf("run profiles should not be empty")
	}

	foundRun := false
	for _, profile := range profiles.RunProfiles {
		if profile.Command == "npm run start" {
			foundRun = true
			break
		}
	}
	if !foundRun {
		t.Fatalf("expected npm run start profile")
	}

	if len(profiles.DebugProfiles) == 0 {
		t.Fatalf("debug profiles should not be empty")
	}

	foundDebug := false
	for _, profile := range profiles.DebugProfiles {
		if profile.Command == "npm run debug" {
			foundDebug = true
			break
		}
	}
	if !foundDebug {
		t.Fatalf("expected npm run debug profile")
	}
}

func TestResolveProfiles_ArlecchinoConfigAndVSCodeImport(t *testing.T) {
	projectDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(projectDir, ".arlecchino"), 0o755); err != nil {
		t.Fatalf("create .arlecchino dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(projectDir, ".vscode"), 0o755); err != nil {
		t.Fatalf("create .vscode dir: %v", err)
	}

	if err := os.WriteFile(filepath.Join(projectDir, ".arlecchino", "execution.json"), []byte(`{
		"runProfiles": [
			{
				"id": "user:run",
				"label": "User Run",
				"description": "run from config",
				"kind": "terminal",
				"command": "make run"
			}
		],
		"debugProfiles": [
			{
				"id": "user:debug",
				"label": "User Debug",
				"description": "debug from config",
				"kind": "terminal",
				"command": "make debug"
			}
		]
	}`), 0o644); err != nil {
		t.Fatalf("write execution config: %v", err)
	}

	if err := os.WriteFile(filepath.Join(projectDir, ".vscode", "launch.json"), []byte(`{
		"version": "0.2.0",
		"configurations": [
			{
				"name": "Go API",
				"type": "go",
				"request": "launch",
				"program": "${workspaceFolder}/cmd/api"
			}
		]
	}`), 0o644); err != nil {
		t.Fatalf("write launch.json: %v", err)
	}

	service := NewService(nil)
	service.lookPath = func(tool string) (string, error) {
		return "/usr/bin/" + tool, nil
	}

	profiles := service.ResolveProfiles(ResolveRequest{ProjectPath: projectDir})

	if len(profiles.RunProfiles) == 0 {
		t.Fatalf("expected run profile from .arlecchino/execution.json")
	}

	if profiles.RunProfiles[0].ID != "user:run" {
		t.Fatalf("first run profile id = %q, want %q", profiles.RunProfiles[0].ID, "user:run")
	}

	foundImported := false
	for _, profile := range profiles.DebugProfiles {
		if profile.Origin == ProfileOriginImported {
			foundImported = true
			break
		}
	}

	if !foundImported {
		t.Fatalf("expected imported debug profile from launch.json")
	}
}
