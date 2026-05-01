package main

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"path/filepath"
	"runtime"
	"testing"
)

func TestProjectWindowLaunchArgsBuildRoutePayload(t *testing.T) {
	projectPath := t.TempDir()
	args := []string{"Arlecchino", projectWindowLaunchFlag, "--open-project", projectPath}

	payload, ok := buildProjectWindowLaunchPayloadFromLaunchArgs(args, "")
	if !ok {
		t.Fatal("project-window launch args were not parsed")
	}
	if payload.ProjectPath != projectPath {
		t.Fatalf("ProjectPath = %q, want %q", payload.ProjectPath, projectPath)
	}

	rawURL, err := buildProjectWindowURL(payload)
	if err != nil {
		t.Fatalf("buildProjectWindowURL returned error: %v", err)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse project window URL: %v", err)
	}
	encoded := parsed.Query().Get(projectWindowRouteParam)
	if encoded == "" {
		t.Fatalf("URL %q is missing %s", rawURL, projectWindowRouteParam)
	}

	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode project window payload: %v", err)
	}
	var decoded projectWindowLaunchPayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal project window payload: %v", err)
	}
	if decoded.ProjectPath != projectPath {
		t.Fatalf("decoded ProjectPath = %q, want %q", decoded.ProjectPath, projectPath)
	}
}

func TestProjectWindowLaunchBypassesSingleInstance(t *testing.T) {
	t.Setenv(envEnableSingleInstanceSpike, "1")

	if !singleInstanceEnabledForLaunchArgs([]string{"Arlecchino", "--open-project", t.TempDir()}) {
		t.Fatal("normal open-project launch did not enable single-instance")
	}
	if singleInstanceEnabledForLaunchArgs([]string{"Arlecchino", projectWindowLaunchFlag, "--open-project", t.TempDir()}) {
		t.Fatal("project-window launch enabled single-instance")
	}
}

func TestBuildProjectWindowLaunchCommandUsesPackagedMacOpen(t *testing.T) {
	projectPath := filepath.Join(t.TempDir(), "project")
	command := buildProjectWindowLaunchCommand(
		projectPath,
		"/Applications/Arlecchino.app/Contents/MacOS/Arlecchino",
		"/Applications/Arlecchino.app",
		"darwin",
	)

	if command.Name != "/usr/bin/open" {
		t.Fatalf("command name = %q, want /usr/bin/open", command.Name)
	}
	wantArgs := []string{
		"-n",
		"/Applications/Arlecchino.app",
		"--args",
		projectWindowLaunchFlag,
		"--open-project",
		filepath.Clean(projectPath),
	}
	if !equalStringSlices(command.Args, wantArgs) {
		t.Fatalf("command args = %#v, want %#v", command.Args, wantArgs)
	}
}

func TestBuildProjectWindowLaunchCommandUsesExecutableForRawBinary(t *testing.T) {
	projectPath := filepath.Join(t.TempDir(), "project")
	command := buildProjectWindowLaunchCommand(projectPath, "/tmp/arlecchino", "", runtime.GOOS)

	if command.Name != "/tmp/arlecchino" {
		t.Fatalf("command name = %q, want raw executable", command.Name)
	}
	wantArgs := []string{projectWindowLaunchFlag, "--open-project", filepath.Clean(projectPath)}
	if !equalStringSlices(command.Args, wantArgs) {
		t.Fatalf("command args = %#v, want %#v", command.Args, wantArgs)
	}
}

func TestOpenProjectWindowValidatesAccessAndLaunches(t *testing.T) {
	projectPath := t.TempDir()
	var launched []projectWindowLaunchCommand
	previousStarter := startProjectWindowProcess
	startProjectWindowProcess = func(command projectWindowLaunchCommand) error {
		launched = append(launched, command)
		return nil
	}
	defer func() {
		startProjectWindowProcess = previousStarter
	}()

	result, err := (&App{}).OpenProjectWindow(projectPath)
	if err != nil {
		t.Fatalf("OpenProjectWindow returned error: %v", err)
	}
	if !result.Handled || result.ProjectPath != projectPath {
		t.Fatalf("result = %#v, want handled project path", result)
	}
	if len(launched) != 1 {
		t.Fatalf("launch count = %d, want 1", len(launched))
	}

	_, err = (&App{}).OpenProjectWindow(filepath.Join(t.TempDir(), "missing"))
	if err == nil {
		t.Fatal("OpenProjectWindow accepted an inaccessible path")
	}
	if len(launched) != 1 {
		t.Fatalf("launch count after invalid path = %d, want 1", len(launched))
	}
}

func equalStringSlices(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
