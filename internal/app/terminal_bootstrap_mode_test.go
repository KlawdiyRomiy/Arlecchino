package app

import "testing"

func TestLegacyPTYBootstrapEnabled_DefaultFalse(t *testing.T) {
	t.Setenv("ARLECCHINO_LEGACY_PTY_BOOTSTRAP", "")

	if legacyPTYBootstrapEnabled() {
		t.Fatalf("legacyPTYBootstrapEnabled() should be false by default")
	}
}

func TestLegacyPTYBootstrapEnabled_TruthyValues(t *testing.T) {
	values := []string{"1", "true", "TRUE", "yes", "on"}

	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			t.Setenv("ARLECCHINO_LEGACY_PTY_BOOTSTRAP", value)
			if !legacyPTYBootstrapEnabled() {
				t.Fatalf("legacyPTYBootstrapEnabled() should be true for %q", value)
			}
		})
	}
}
