package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWails3InfoPlistAcceptsDockDroppedFilesAndFolders(t *testing.T) {
	for _, plistName := range []string{"Info.wails3.plist", "Info.plist", "Info.dev.plist"} {
		t.Run(plistName, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("build", "darwin", plistName))
			if err != nil {
				t.Fatalf("ReadFile(%s) error = %v", plistName, err)
			}

			assertOpenFileDocumentTypes(t, plistName, string(data))
		})
	}
}

func TestDarwinInfoPlistsAreRawLintable(t *testing.T) {
	for _, plistName := range []string{"Info.wails3.plist", "Info.plist", "Info.dev.plist"} {
		t.Run(plistName, func(t *testing.T) {
			path := filepath.Join("build", "darwin", plistName)
			output, err := exec.Command("/usr/bin/plutil", "-lint", path).CombinedOutput()
			if err != nil {
				t.Fatalf("plutil -lint %s failed: %v\n%s", plistName, err, string(output))
			}
		})
	}
}

func TestDarwinInfoPlistsDeclareVersionedAppIconResources(t *testing.T) {
	cases := map[string]string{
		"Info.plist":        "<string>11.0</string>",
		"Info.dev.plist":    "<string>11.0</string>",
		"Info.wails3.plist": "<string>__MIN_MACOS_VERSION__</string>",
	}

	for plistName, minimumVersion := range cases {
		t.Run(plistName, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join("build", "darwin", plistName))
			if err != nil {
				t.Fatalf("ReadFile(%s) error = %v", plistName, err)
			}
			content := string(data)

			for _, expected := range []string{
				"<key>CFBundleIconFile</key>",
				"<string>iconfile</string>",
				"<key>CFBundleIconName</key>",
				"<string>appicon</string>",
				"<key>LSMinimumSystemVersion</key>",
				minimumVersion,
			} {
				if !strings.Contains(content, expected) {
					t.Fatalf("%s missing %s", plistName, expected)
				}
			}
		})
	}
}

func assertOpenFileDocumentTypes(t *testing.T, plistName string, content string) {
	t.Helper()

	for _, expected := range []string{
		"<key>CFBundleDocumentTypes</key>",
		"<key>CFBundleTypeExtensions</key>",
		"<key>LSItemContentTypes</key>",
		"<string>Arlecchino Source File</string>",
		"<string>Editor</string>",
		"<string>go</string>",
		"<string>ts</string>",
		"<string>md</string>",
		"<string>public.data</string>",
		"<string>public.text</string>",
		"<string>public.source-code</string>",
		"<string>Arlecchino Project</string>",
		"<string>arlecchino</string>",
		"<string>io.arlecchino.project</string>",
		"<string>Arlecchino Folder</string>",
		"<string>public.folder</string>",
	} {
		if !strings.Contains(content, expected) {
			t.Fatalf("%s missing %s", plistName, expected)
		}
	}
}
