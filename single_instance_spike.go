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
