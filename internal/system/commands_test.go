package system

import (
	"errors"
	"strings"
	"testing"
)

func TestFindPHP_UsesLookPathResult(t *testing.T) {
	original := systemLookPath
	t.Cleanup(func() { systemLookPath = original })

	systemLookPath = func(name string) (string, error) {
		if name != "php" {
			t.Fatalf("LookPath called with %q, want php", name)
		}
		return "/custom/php", nil
	}

	path, err := findPHP()
	if err != nil {
		t.Fatalf("findPHP returned error: %v", err)
	}
	if path != "/custom/php" {
		t.Fatalf("findPHP path = %q, want /custom/php", path)
	}
}

func TestFindPHP_ReturnsPathGuidanceWhenMissing(t *testing.T) {
	original := systemLookPath
	t.Cleanup(func() { systemLookPath = original })

	systemLookPath = func(name string) (string, error) {
		return "", errors.New("missing")
	}

	_, err := findPHP()
	if err == nil {
		t.Fatal("findPHP error = nil, want error")
	}
	if !strings.Contains(err.Error(), "PATH") {
		t.Fatalf("findPHP error = %q, want PATH guidance", err)
	}
}
