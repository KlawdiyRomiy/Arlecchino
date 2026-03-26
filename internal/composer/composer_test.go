package composer

import (
	"errors"
	"strings"
	"testing"
)

func TestFindComposer_UsesLookPathResult(t *testing.T) {
	original := composerLookPath
	t.Cleanup(func() { composerLookPath = original })

	composerLookPath = func(name string) (string, error) {
		if name != "composer" {
			t.Fatalf("LookPath called with %q, want composer", name)
		}
		return "/custom/composer", nil
	}

	path, err := findComposer()
	if err != nil {
		t.Fatalf("findComposer returned error: %v", err)
	}
	if path != "/custom/composer" {
		t.Fatalf("findComposer path = %q, want /custom/composer", path)
	}
}

func TestFindComposer_ReturnsPathGuidanceWhenMissing(t *testing.T) {
	original := composerLookPath
	t.Cleanup(func() { composerLookPath = original })

	composerLookPath = func(name string) (string, error) {
		return "", errors.New("missing")
	}

	_, err := findComposer()
	if err == nil {
		t.Fatal("findComposer error = nil, want error")
	}
	if !strings.Contains(err.Error(), "PATH") {
		t.Fatalf("findComposer error = %q, want PATH guidance", err)
	}
}
