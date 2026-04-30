package main

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildOpenIntentFromLaunchArgsInfersProjectDirectory(t *testing.T) {
	root := t.TempDir()

	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", root},
		"/",
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want true")
	}
	if payload["kind"] != "openProject" {
		t.Fatalf("kind = %v, want openProject", payload["kind"])
	}
	if payload["projectPath"] != root {
		t.Fatalf("projectPath = %v, want %v", payload["projectPath"], root)
	}
}

func TestBuildOpenIntentFromLaunchArgsInfersFileWithLine(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "--line", "7", "main.go"},
		root,
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want true")
	}
	if payload["kind"] != "openFile" {
		t.Fatalf("kind = %v, want openFile", payload["kind"])
	}
	if payload["path"] != filePath {
		t.Fatalf("path = %v, want %v", payload["path"], filePath)
	}
	if payload["line"] != 7 {
		t.Fatalf("line = %v, want 7", payload["line"])
	}
}

func TestBuildOpenIntentFromLaunchArgsSupportsExplicitPreviewURL(t *testing.T) {
	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "--open-preview", "https://example.test/app"},
		"/",
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want true")
	}
	if payload["kind"] != "openPreview" {
		t.Fatalf("kind = %v, want openPreview", payload["kind"])
	}
	if payload["surface"] != "browser" {
		t.Fatalf("surface = %v, want browser", payload["surface"])
	}
	if payload["url"] != "https://example.test/app" {
		t.Fatalf("url = %v, want https://example.test/app", payload["url"])
	}
}

func TestBuildOpenIntentFromLaunchArgsSupportsCustomProtocolOpenFile(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	protocolURL := "arlecchino://open/file?path=" + url.QueryEscape("main.go") + "&line=12"
	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "--open-url", protocolURL},
		root,
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want true")
	}
	if payload["kind"] != "openFile" {
		t.Fatalf("kind = %v, want openFile", payload["kind"])
	}
	if payload["path"] != filePath || payload["line"] != 12 {
		t.Fatalf("payload = %#v, want file path with line", payload)
	}
}

func TestBuildOpenIntentFromLaunchArgsSupportsCustomProtocolPreviewAndFocus(t *testing.T) {
	previewURL := "arlecchino://open?preview=" + url.QueryEscape("https://example.test/app")
	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", previewURL},
		"/",
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want preview intent")
	}
	if payload["kind"] != "openPreview" || payload["url"] != "https://example.test/app" {
		t.Fatalf("payload = %#v, want browser preview", payload)
	}

	focusURL := "arlecchino://focus?surface=" + url.QueryEscape("panel:ai-chat")
	payload, ok = buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", focusURL},
		"/",
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want focus intent")
	}
	if payload["kind"] != "focusSurface" || payload["surfaceId"] != "panel:aiChat" {
		t.Fatalf("payload = %#v, want canonical panel focus", payload)
	}
}

func TestBuildOpenIntentFromLaunchArgsSupportsFileURLAssociation(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	fileURL := url.URL{Scheme: "file", Path: filePath}

	payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "--line", "4", fileURL.String()},
		"/",
	)
	if !ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() ok = false, want true")
	}
	if payload["kind"] != "openFile" || payload["path"] != filePath || payload["line"] != 4 {
		t.Fatalf("payload = %#v, want file association openFile", payload)
	}
}

func TestBuildOpenIntentFromLaunchArgsRejectsUnsafeCustomProtocolPayloads(t *testing.T) {
	unsupported := []string{
		"arlecchino://open?command=rm%20-rf%20/",
		"arlecchino://open?preview=file:///etc/passwd",
		"arlecchino://focus?surface=terminal",
		"arlecchino://focus?preview=../../secret",
	}
	for _, target := range unsupported {
		if payload, ok := buildOpenIntentFromLaunchArgs(
			[]string{"/tmp/Arlecchino", target},
			"/",
		); ok {
			t.Fatalf("buildOpenIntentFromLaunchArgs(%q) = %#v, true; want nil, false", target, payload)
		}
	}
}

func TestBuildOpenIntentFromLaunchArgsRejectsUnsupportedTargets(t *testing.T) {
	if payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "file:///tmp/secret.txt"},
		"/",
	); ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() = %#v, true; want nil, false", payload)
	}

	if payload, ok := buildOpenIntentFromLaunchArgs(
		[]string{"/tmp/Arlecchino", "--unknown", "missing.go"},
		"/",
	); ok {
		t.Fatalf("buildOpenIntentFromLaunchArgs() = %#v, true; want nil, false", payload)
	}
}

func TestBuildSingleInstanceOptionsIsGatedByEnvironment(t *testing.T) {
	t.Setenv(envEnableSingleInstanceSpike, "")
	if options := buildSingleInstanceOptions(&App{}); options != nil {
		t.Fatalf("buildSingleInstanceOptions() = %#v, want nil when env is disabled", options)
	}

	t.Setenv(envEnableSingleInstanceSpike, "1")
	options := buildSingleInstanceOptions(&App{})
	if options == nil {
		t.Fatalf("buildSingleInstanceOptions() = nil, want options when env is enabled")
	}
	if options.UniqueID != singleInstanceUniqueID {
		t.Fatalf("UniqueID = %q, want %q", options.UniqueID, singleInstanceUniqueID)
	}
	if options.OnSecondInstanceLaunch == nil {
		t.Fatalf("OnSecondInstanceLaunch = nil, want callback")
	}
}
