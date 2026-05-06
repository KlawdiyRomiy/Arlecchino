package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWails3InfoPlistAcceptsDockDroppedFilesAndFolders(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("build", "darwin", "Info.wails3.plist"))
	if err != nil {
		t.Fatalf("ReadFile(Info.wails3.plist) error = %v", err)
	}

	content := string(data)
	for _, expected := range []string{
		"<key>CFBundleDocumentTypes</key>",
		"<key>LSItemContentTypes</key>",
		"<string>public.data</string>",
		"<string>public.folder</string>",
	} {
		if !strings.Contains(content, expected) {
			t.Fatalf("Info.wails3.plist missing %s", expected)
		}
	}
}
