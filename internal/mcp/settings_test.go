package mcp

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadSettingsDefaultsWhenFileMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-settings.json")

	settings, diskPath, err := LoadSettings(path)
	if err != nil {
		t.Fatalf("LoadSettings() error = %v", err)
	}
	if diskPath != path {
		t.Fatalf("LoadSettings() disk path = %q, want %q", diskPath, path)
	}
	if !settings.Enabled {
		t.Fatalf("LoadSettings() Enabled = false, want true by default")
	}
	if !settings.ApprovalRequired {
		t.Fatalf("LoadSettings() ApprovalRequired = false, want true by default")
	}
	if settings.DefaultApprovalTTLSeconds != defaultApprovalTTLSeconds {
		t.Fatalf("LoadSettings() TTL = %d, want %d", settings.DefaultApprovalTTLSeconds, defaultApprovalTTLSeconds)
	}
}

func TestSaveSettingsNormalizesDisabledTools(t *testing.T) {
	path := filepath.Join(t.TempDir(), "mcp-settings.json")

	settings, _, err := SaveSettings(path, Settings{
		Version:                   settingsVersion,
		Enabled:                   true,
		ApprovalRequired:          true,
		DefaultApprovalTTLSeconds: 999999,
		DisabledTools: []string{
			"ide_ui.hot_switch",
			" ",
			"ide_control.read_file",
			"ide_ui.hot_switch",
		},
	})
	if err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}
	if settings.DefaultApprovalTTLSeconds != maxApprovalTTLSeconds {
		t.Fatalf("SaveSettings() TTL = %d, want %d", settings.DefaultApprovalTTLSeconds, maxApprovalTTLSeconds)
	}
	wantTools := []string{"ide_control.read_file", "ide_ui.hot_switch"}
	if strings.Join(settings.DisabledTools, ",") != strings.Join(wantTools, ",") {
		t.Fatalf("SaveSettings() DisabledTools = %#v, want %#v", settings.DisabledTools, wantTools)
	}

	if _, err := os.Stat(path); err != nil {
		t.Fatalf("SaveSettings() should create settings file: %v", err)
	}
}

func TestRunStdioServerDisabledSettingsExitsWithoutServing(t *testing.T) {
	root := t.TempDir()
	settingsPath := filepath.Join(t.TempDir(), "mcp-settings.json")
	t.Setenv(envMCPSettingsPath, settingsPath)

	if _, _, err := SaveSettings(settingsPath, Settings{
		Version:                   settingsVersion,
		Enabled:                   false,
		ApprovalRequired:          true,
		DefaultApprovalTTLSeconds: defaultApprovalTTLSeconds,
	}); err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}

	var stderr bytes.Buffer
	if err := RunStdioServer(context.Background(), root, strings.NewReader(""), &bytes.Buffer{}, &stderr); err != nil {
		t.Fatalf("RunStdioServer() error = %v", err)
	}
	if !strings.Contains(stderr.String(), "disabled") {
		t.Fatalf("RunStdioServer() stderr = %q, want disabled message", stderr.String())
	}
}
