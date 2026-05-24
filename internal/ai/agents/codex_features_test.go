package agents

import (
	"strings"
	"testing"
)

func TestCodexFeatureListParserHandlesMultiWordStages(t *testing.T) {
	features := codexParseFeatureList(`
apps                                    stable             true
enable_mcp_apps                         under development  false
hooks                                   stable             true
plugin_hooks                            stable             true
`)
	for _, feature := range []string{"apps", "enable_mcp_apps", "hooks", "plugin_hooks"} {
		if !features[feature] {
			t.Fatalf("feature %q was not parsed from feature list: %#v", feature, features)
		}
	}
	if features["builtin_mcp"] {
		t.Fatalf("absent feature was parsed: %#v", features)
	}
}

func TestCodexDisableFeatureArgsFilterUnsupportedDesiredFeatures(t *testing.T) {
	args := codexDisableFeatureArgsForSupportedFeatures(map[string]bool{
		"apps":            true,
		"plugins":         true,
		"enable_mcp_apps": true,
		"hooks":           true,
		"plugin_hooks":    true,
	})
	joined := strings.Join(args, "\x00")
	for _, feature := range []string{"apps", "plugins", "enable_mcp_apps", "hooks", "plugin_hooks"} {
		if !codexFeatureArgPairPresent(args, feature) {
			t.Fatalf("feature %q was not disabled in filtered argv: %#v", feature, args)
		}
	}
	if strings.Contains(joined, "builtin_mcp") {
		t.Fatalf("unsupported feature was disabled in filtered argv: %#v", args)
	}
}

func codexFeatureArgPairPresent(args []string, feature string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--disable" && args[i+1] == feature {
			return true
		}
	}
	return false
}
