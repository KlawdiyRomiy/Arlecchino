package agents

import (
	"context"
	"strings"
	"sync"
)

var codexDesiredDisabledFeatures = []string{
	"apps",
	"plugins",
	"enable_mcp_apps",
	"builtin_mcp",
	"hooks",
	"plugin_hooks",
}

var codexFallbackDisabledFeatures = []string{
	"apps",
	"plugins",
	"enable_mcp_apps",
	"hooks",
	"plugin_hooks",
}

var codexFeatureCache = struct {
	sync.Mutex
	byBinary map[string]map[string]bool
}{
	byBinary: map[string]map[string]bool{},
}

func codexDisableFeatureArgs(ctx context.Context, binary string) []string {
	supported, ok := codexSupportedFeatures(ctx, binary)
	if !ok {
		return codexDisableFeatureArgsForFeatures(codexFallbackDisabledFeatures)
	}
	return codexDisableFeatureArgsForSupportedFeatures(supported)
}

func codexDisableFeatureArgsForSupportedFeatures(supported map[string]bool) []string {
	features := make([]string, 0, len(codexDesiredDisabledFeatures))
	for _, feature := range codexDesiredDisabledFeatures {
		if supported[feature] {
			features = append(features, feature)
		}
	}
	return codexDisableFeatureArgsForFeatures(features)
}

func codexSupportedFeatures(ctx context.Context, binary string) (map[string]bool, bool) {
	cacheKey := strings.TrimSpace(binary)
	if cacheKey == "" {
		return nil, false
	}
	codexFeatureCache.Lock()
	cached, ok := codexFeatureCache.byBinary[cacheKey]
	codexFeatureCache.Unlock()
	if ok {
		return cached, true
	}
	output, err := runCommandWithTimeout(ctx, codexShortProbeTimeout, binary, "features", "list")
	if err != nil {
		return nil, false
	}
	features := codexParseFeatureList(output)
	if len(features) == 0 {
		return nil, false
	}
	codexFeatureCache.Lock()
	codexFeatureCache.byBinary[cacheKey] = features
	codexFeatureCache.Unlock()
	return features, true
}

func codexParseFeatureList(output string) map[string]bool {
	features := map[string]bool{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		name := strings.TrimSpace(fields[0])
		if name == "" || strings.Contains(name, ":") {
			continue
		}
		features[name] = true
	}
	return features
}

func codexDisableFeatureArgsForFeatures(features []string) []string {
	args := make([]string, 0, len(features)*2)
	for _, feature := range features {
		feature = strings.TrimSpace(feature)
		if feature == "" {
			continue
		}
		args = append(args, "--disable", feature)
	}
	return args
}
