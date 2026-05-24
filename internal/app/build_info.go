package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var (
	buildVersion      = "0.0.0-dev"
	buildNumber       = "0"
	buildCommit       = "dev"
	buildTime         = ""
	buildChannel      = "beta"
	buildManifestURL  = ""
	buildUpdatePubKey = ""
)

type BuildInfo struct {
	Runtime       string `json:"runtime"`
	Mode          string `json:"mode"`
	Packaged      bool   `json:"packaged"`
	Platform      string `json:"platform"`
	Arch          string `json:"arch"`
	BundlePath    string `json:"bundlePath,omitempty"`
	Executable    string `json:"executablePath,omitempty"`
	Version       string `json:"version"`
	Build         string `json:"build"`
	Commit        string `json:"gitSha"`
	BuiltAt       string `json:"builtAt,omitempty"`
	Channel       string `json:"channel"`
	ManifestURL   string `json:"updateManifestUrl,omitempty"`
	PublicKeyHint string `json:"updatePublicKey,omitempty"`
}

func (a *App) GetBuildInfo() BuildInfo {
	return currentBuildInfo()
}

func currentBuildInfo() BuildInfo {
	executable, _ := os.Executable()
	executable, _ = filepath.Abs(executable)
	bundlePath := findAppBundlePath(executable)
	channel := strings.TrimSpace(os.Getenv(packagedOSAutoUpdateChannelEnv))
	if channel == "" {
		channel = strings.TrimSpace(buildChannel)
	}
	if channel == "" {
		channel = "beta"
	}
	manifestURL := strings.TrimSpace(os.Getenv(autoUpdateManifestURLEnv))
	if manifestURL == "" {
		manifestURL = strings.TrimSpace(buildManifestURL)
	}

	packaged := bundlePath != "" || envFlag(packagedOSPackagedBuildEnv)
	mode := "dev"
	if packaged {
		mode = "packaged"
	}

	return BuildInfo{
		Runtime:       "wails-v3",
		Mode:          mode,
		Packaged:      packaged,
		Platform:      runtime.GOOS,
		Arch:          runtime.GOARCH,
		BundlePath:    bundlePath,
		Executable:    executable,
		Version:       strings.TrimSpace(buildVersion),
		Build:         strings.TrimSpace(buildNumber),
		Commit:        strings.TrimSpace(buildCommit),
		BuiltAt:       normalizedBuildTime(buildTime),
		Channel:       channel,
		ManifestURL:   manifestURL,
		PublicKeyHint: publicKeyHint(resolveAutoUpdatePublicKey()),
	}
}

func normalizedBuildTime(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC().Format(time.RFC3339)
	}
	return value
}

func currentAppBundlePath() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return ""
	}
	return findAppBundlePath(executable)
}

func findAppBundlePath(path string) string {
	path = filepath.Clean(path)
	for path != "." && path != string(filepath.Separator) {
		if strings.HasSuffix(path, ".app") {
			return path
		}
		parent := filepath.Dir(path)
		if parent == path {
			break
		}
		path = parent
	}
	return ""
}

func resolveAutoUpdatePublicKey() string {
	if value := strings.TrimSpace(os.Getenv(packagedOSAutoUpdatePublicKeyEnv)); value != "" {
		return value
	}
	return strings.TrimSpace(buildUpdatePubKey)
}

func publicKeyHint(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if len(value) <= 12 {
		return value
	}
	return value[:6] + "..." + value[len(value)-6:]
}
