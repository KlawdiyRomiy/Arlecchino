package main

import (
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	envEnableSingleInstanceSpike = "ARLECCHINO_ENABLE_SINGLE_INSTANCE_SPIKE"
	singleInstanceUniqueID       = "com.arlecchino.ide.wails3-spike"
	customProtocolScheme         = "arlecchino"
)

func buildSingleInstanceOptions(app *App) *application.SingleInstanceOptions {
	if !envFlagEnabled(envEnableSingleInstanceSpike) {
		return nil
	}

	return &application.SingleInstanceOptions{
		UniqueID: singleInstanceUniqueID,
		OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
			if app == nil {
				return
			}
			app.focusMainWindow()
			if payload, ok := buildOpenIntentFromLaunchArgs(data.Args, data.WorkingDir); ok {
				payload["source"] = "single-instance"
				app.dispatchOpenIntent(payload)
			}
		},
		AdditionalData: map[string]string{
			"source": "single-instance",
		},
	}
}

func (a *App) dispatchInitialLaunchOpenIntent() {
	if payload, ok := buildOpenIntentFromLaunchArgs(os.Args, currentWorkingDir()); ok {
		payload["source"] = "launch-args"
		a.dispatchOpenIntent(payload)
	}
}

func buildOpenIntentFromLaunchArgs(args []string, workingDir string) (map[string]any, bool) {
	normalizedArgs := stripExecutableArg(args)
	if len(normalizedArgs) == 0 {
		return nil, false
	}

	line := 0
	for i := 0; i < len(normalizedArgs); i++ {
		arg := strings.TrimSpace(normalizedArgs[i])
		if arg == "" || arg == "--" {
			continue
		}

		switch arg {
		case "--line", "-l":
			if i+1 < len(normalizedArgs) {
				line = parsePositiveLine(normalizedArgs[i+1])
				i++
			}
			continue
		case "--open-project":
			if i+1 >= len(normalizedArgs) {
				return nil, false
			}
			return map[string]any{
				"kind":        "openProject",
				"projectPath": resolveLaunchPath(normalizedArgs[i+1], workingDir),
			}, true
		case "--open-file":
			if i+1 >= len(normalizedArgs) {
				return nil, false
			}
			return openFileIntent(resolveLaunchPath(normalizedArgs[i+1], workingDir), line), true
		case "--open-preview":
			if i+1 >= len(normalizedArgs) {
				return nil, false
			}
			return openPreviewIntent(normalizedArgs[i+1])
		case "--open-url":
			if i+1 >= len(normalizedArgs) {
				return nil, false
			}
			return inferOpenIntentFromLaunchTarget(normalizedArgs[i+1], workingDir, line)
		}

		if strings.HasPrefix(arg, "-") {
			continue
		}

		if payload, ok := inferOpenIntentFromLaunchTarget(arg, workingDir, line); ok {
			return payload, true
		}
	}

	return nil, false
}

func stripExecutableArg(args []string) []string {
	if len(args) == 0 {
		return nil
	}
	if len(args) == 1 {
		return nil
	}
	return args[1:]
}

func inferOpenIntentFromLaunchTarget(target string, workingDir string, line int) (map[string]any, bool) {
	if payload, ok := customProtocolOpenIntent(target, workingDir, line); ok {
		return payload, true
	}
	if payload, ok := fileURLAssociationOpenIntent(target, workingDir, line); ok {
		return payload, true
	}
	if payload, ok := openPreviewIntent(target); ok {
		return payload, true
	}

	resolvedPath := resolveLaunchPath(target, workingDir)
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return nil, false
	}
	if info.IsDir() {
		return map[string]any{
			"kind":        "openProject",
			"projectPath": resolvedPath,
		}, true
	}

	return openFileIntent(resolvedPath, line), true
}

func customProtocolOpenIntent(rawURL string, workingDir string, line int) (map[string]any, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || !strings.EqualFold(parsed.Scheme, customProtocolScheme) {
		return nil, false
	}

	action, target := customProtocolActionTarget(parsed)
	values := parsed.Query()
	switch action {
	case "open":
		switch target {
		case "project":
			path := firstQueryValue(values, "project", "projectPath", "path")
			return projectIntentFromExternalPath(path, workingDir)
		case "file":
			path := firstQueryValue(values, "file", "filePath", "path")
			return fileIntentFromExternalPath(path, workingDir, protocolLine(values, line))
		case "preview":
			return openPreviewIntent(firstQueryValue(values, "preview", "previewUrl", "url"))
		case "":
			if path := firstQueryValue(values, "project", "projectPath"); path != "" {
				return projectIntentFromExternalPath(path, workingDir)
			}
			if path := firstQueryValue(values, "file", "filePath"); path != "" {
				return fileIntentFromExternalPath(path, workingDir, protocolLine(values, line))
			}
			if previewURL := firstQueryValue(values, "preview", "previewUrl", "url"); previewURL != "" {
				return openPreviewIntent(previewURL)
			}
		}
	case "open-project":
		return projectIntentFromExternalPath(firstQueryValue(values, "project", "projectPath", "path"), workingDir)
	case "open-file":
		return fileIntentFromExternalPath(
			firstQueryValue(values, "file", "filePath", "path"),
			workingDir,
			protocolLine(values, line),
		)
	case "open-preview":
		return openPreviewIntent(firstQueryValue(values, "preview", "previewUrl", "url"))
	case "focus", "focus-surface":
		return focusSurfaceIntentFromProtocol(values)
	}

	return nil, false
}

func customProtocolActionTarget(parsed *url.URL) (string, string) {
	host := normalizeProtocolSegment(parsed.Host)
	segments := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	target := ""
	if len(segments) > 0 {
		if unescaped, err := url.PathUnescape(segments[0]); err == nil {
			target = normalizeProtocolSegment(unescaped)
		}
	}
	switch host {
	case "open":
		return "open", target
	case "focus":
		return "focus", target
	case "open-project", "open-file", "open-preview", "focus-surface":
		return host, target
	default:
		return host, target
	}
}

func normalizeProtocolSegment(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	return normalized
}

func firstQueryValue(values url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(values.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func protocolLine(values url.Values, fallback int) int {
	if line := parsePositiveLine(firstQueryValue(values, "line")); line > 0 {
		return line
	}
	return fallback
}

func projectIntentFromExternalPath(path string, workingDir string) (map[string]any, bool) {
	resolvedPath := resolveLaunchPath(path, workingDir)
	info, err := os.Stat(resolvedPath)
	if err != nil || !info.IsDir() {
		return nil, false
	}
	return map[string]any{
		"kind":        "openProject",
		"projectPath": resolvedPath,
	}, true
}

func fileIntentFromExternalPath(path string, workingDir string, line int) (map[string]any, bool) {
	resolvedPath := resolveLaunchPath(path, workingDir)
	info, err := os.Stat(resolvedPath)
	if err != nil || info.IsDir() {
		return nil, false
	}
	return openFileIntent(resolvedPath, line), true
}

func fileURLAssociationOpenIntent(rawURL string, workingDir string, line int) (map[string]any, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || !strings.EqualFold(parsed.Scheme, "file") {
		return nil, false
	}
	if parsed.Host != "" && parsed.Host != "localhost" {
		return nil, false
	}
	path, err := url.PathUnescape(parsed.Path)
	if err != nil {
		return nil, false
	}
	resolvedPath := resolveLaunchPath(path, workingDir)
	info, err := os.Stat(resolvedPath)
	if err != nil {
		return nil, false
	}
	if info.IsDir() {
		return map[string]any{
			"kind":        "openProject",
			"projectPath": resolvedPath,
		}, true
	}
	return openFileIntent(resolvedPath, line), true
}

func focusSurfaceIntentFromProtocol(values url.Values) (map[string]any, bool) {
	surfaceID := firstQueryValue(values, "surface", "surfaceId")
	if surfaceID != "" {
		canonicalSurfaceID, ok := canonicalProtocolSurfaceID(surfaceID)
		if !ok {
			return nil, false
		}
		return map[string]any{
			"kind":      "focusSurface",
			"surfaceId": canonicalSurfaceID,
		}, true
	}
	previewWindowID := firstQueryValue(values, "preview", "previewWindowId", "windowId")
	if previewWindowID != "" {
		if !isSafeProtocolIdentifier(previewWindowID) {
			return nil, false
		}
		return map[string]any{
			"kind":            "focusSurface",
			"previewWindowId": previewWindowID,
		}, true
	}
	panelID := firstQueryValue(values, "panel", "panelId")
	if panelID != "" {
		panelID = normalizeProtocolPanelID(panelID)
		if !isAllowedProtocolPanelID(panelID) {
			return nil, false
		}
		return map[string]any{
			"kind":    "focusSurface",
			"panelId": panelID,
		}, true
	}
	return nil, false
}

func canonicalProtocolSurfaceID(surfaceID string) (string, bool) {
	if strings.HasPrefix(surfaceID, "panel:") {
		panelID := normalizeProtocolPanelID(strings.TrimPrefix(surfaceID, "panel:"))
		if !isAllowedProtocolPanelID(panelID) {
			return "", false
		}
		return "panel:" + panelID, true
	}
	if strings.HasPrefix(surfaceID, "preview:") {
		previewID := strings.TrimPrefix(surfaceID, "preview:")
		if !isSafeProtocolIdentifier(previewID) {
			return "", false
		}
		return "preview:" + previewID, true
	}
	return "", false
}

func normalizeProtocolPanelID(panelID string) string {
	switch normalizeProtocolSegment(panelID) {
	case "aichat", "ai-chat", "ai":
		return "aiChat"
	default:
		return normalizeProtocolSegment(panelID)
	}
}

func isAllowedProtocolPanelID(panelID string) bool {
	switch panelID {
	case "explorer", "terminal", "aiChat", "git", "problems", "code":
		return true
	default:
		return false
	}
}

func isSafeProtocolIdentifier(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' ||
			char == '_' ||
			char == ':' ||
			char == '.' {
			continue
		}
		return false
	}
	return true
}

func openFileIntent(path string, line int) map[string]any {
	payload := map[string]any{
		"kind": "openFile",
		"path": path,
	}
	if line > 0 {
		payload["line"] = line
	}
	return payload
}

func openPreviewIntent(rawURL string) (map[string]any, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, false
	}
	if parsed.Host == "" {
		return nil, false
	}

	return map[string]any{
		"kind":    "openPreview",
		"surface": "browser",
		"url":     parsed.String(),
	}, true
}

func resolveLaunchPath(path string, workingDir string) string {
	trimmedPath := strings.TrimSpace(path)
	if trimmedPath == "" {
		return ""
	}
	if filepath.IsAbs(trimmedPath) {
		return filepath.Clean(trimmedPath)
	}

	base := strings.TrimSpace(workingDir)
	if base == "" {
		base = currentWorkingDir()
	}
	if base == "" {
		return filepath.Clean(trimmedPath)
	}
	return filepath.Clean(filepath.Join(base, trimmedPath))
}

func parsePositiveLine(value string) int {
	line, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || line < 1 {
		return 0
	}
	return line
}

func currentWorkingDir() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	return dir
}
