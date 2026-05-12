package mcp

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMain(m *testing.M) {
	tempDir, err := os.MkdirTemp("", "arlecchino-mcp-tests-")
	if err == nil {
		os.Setenv(envMCPSettingsPath, filepath.Join(tempDir, settingsFileName))
	}

	code := m.Run()

	if err == nil {
		_ = os.RemoveAll(tempDir)
	}
	os.Exit(code)
}
