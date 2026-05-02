package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

const (
	autoUpdateGitHubReleaseScheme    = "github-release"
	autoUpdateGitHubOwner            = "KlawdiyRomiy"
	autoUpdateGitHubRepo             = "Arlecchino"
	autoUpdateGitHubAPIBaseURL       = "https://api.github.com"
	autoUpdateGitHubAPIVersion       = "2022-11-28"
	autoUpdateGitHubTokenEnv         = "ARLECCHINO_GITHUB_TOKEN"
	autoUpdateGitHubKeychainService  = "io.arlecchino.ide.updater"
	autoUpdateGitHubKeychainAccount  = "github-release-token"
	autoUpdatePrivateReleaseAuthInfo = "Private GitHub release access is not configured."
)

var errAutoUpdateTokenNotFound = errors.New("private update token not found")

type PrivateUpdateAuthStatus struct {
	Provider        string `json:"provider"`
	Repository      string `json:"repository,omitempty"`
	ManifestSource  string `json:"manifestSource,omitempty"`
	Configured      bool   `json:"configured"`
	Source          string `json:"source,omitempty"`
	EnvOverride     bool   `json:"envOverride"`
	KeychainService string `json:"keychainService,omitempty"`
	KeychainAccount string `json:"keychainAccount,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

type autoUpdateManualRequiredError struct {
	reason string
}

func (e autoUpdateManualRequiredError) Error() string {
	return e.reason
}

type autoUpdateTokenStore interface {
	FindToken() (string, error)
	SaveToken(token string) error
	ClearToken() error
}

type keychainAutoUpdateTokenStore struct{}

type unsupportedAutoUpdateTokenStore struct{}

type githubReleaseSource struct {
	Owner string
	Repo  string
	Mode  string
	Tag   string
	Asset string
}

type githubReleaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type githubReleaseResponse struct {
	TagName string               `json:"tag_name"`
	Assets  []githubReleaseAsset `json:"assets"`
}

func (a *App) GetPrivateUpdateAuthStatus() PrivateUpdateAuthStatus {
	if a == nil || a.autoUpdater == nil {
		return privateUpdateAuthStatusUnavailable("Auto-update service is unavailable.")
	}
	return a.autoUpdater.privateUpdateAuthStatus()
}

func (a *App) SavePrivateUpdateToken(token string) PrivateUpdateAuthStatus {
	if a == nil || a.autoUpdater == nil {
		return privateUpdateAuthStatusUnavailable("Auto-update service is unavailable.")
	}
	if err := a.autoUpdater.savePrivateUpdateToken(token); err != nil {
		status := a.autoUpdater.privateUpdateAuthStatus()
		status.Configured = false
		status.Reason = redactAutoUpdateError(err.Error())
		return status
	}
	return a.autoUpdater.privateUpdateAuthStatus()
}

func (a *App) ClearPrivateUpdateToken() PrivateUpdateAuthStatus {
	if a == nil || a.autoUpdater == nil {
		return privateUpdateAuthStatusUnavailable("Auto-update service is unavailable.")
	}
	if err := a.autoUpdater.clearPrivateUpdateToken(); err != nil {
		status := a.autoUpdater.privateUpdateAuthStatus()
		status.Reason = redactAutoUpdateError(err.Error())
		return status
	}
	return a.autoUpdater.privateUpdateAuthStatus()
}

func defaultAutoUpdateTokenStore() autoUpdateTokenStore {
	if runtime.GOOS == "darwin" {
		return keychainAutoUpdateTokenStore{}
	}
	return unsupportedAutoUpdateTokenStore{}
}

func privateUpdateAuthStatusUnavailable(reason string) PrivateUpdateAuthStatus {
	return PrivateUpdateAuthStatus{
		Provider:        autoUpdateGitHubReleaseScheme,
		Repository:      autoUpdateGitHubOwner + "/" + autoUpdateGitHubRepo,
		Configured:      false,
		KeychainService: autoUpdateGitHubKeychainService,
		KeychainAccount: autoUpdateGitHubKeychainAccount,
		Reason:          reason,
	}
}

func (s *AutoUpdateService) privateUpdateAuthStatus() PrivateUpdateAuthStatus {
	status := PrivateUpdateAuthStatus{
		Provider:        autoUpdateGitHubReleaseScheme,
		Repository:      autoUpdateGitHubOwner + "/" + autoUpdateGitHubRepo,
		ManifestSource:  resolveAutoUpdateManifestSource(),
		KeychainService: autoUpdateGitHubKeychainService,
		KeychainAccount: autoUpdateGitHubKeychainAccount,
	}
	source, err := parseGitHubReleaseSource(status.ManifestSource)
	if err != nil {
		status.Reason = "Private GitHub release manifest source is not configured."
		return status
	}
	status.Repository = source.Owner + "/" + source.Repo

	if token := strings.TrimSpace(os.Getenv(autoUpdateGitHubTokenEnv)); token != "" {
		status.Configured = true
		status.Source = "env"
		status.EnvOverride = true
		status.Reason = "Private GitHub release token is provided by environment."
		return status
	}
	token, err := s.effectiveTokenStore().FindToken()
	if err == nil && strings.TrimSpace(token) != "" {
		status.Configured = true
		status.Source = "keychain"
		status.Reason = "Private GitHub release token is stored in Keychain."
		return status
	}
	if err != nil && !errors.Is(err, errAutoUpdateTokenNotFound) {
		status.Reason = redactAutoUpdateError(err.Error())
		return status
	}
	status.Reason = autoUpdatePrivateReleaseAuthInfo
	return status
}

func (s *AutoUpdateService) savePrivateUpdateToken(token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("private GitHub release token is empty")
	}
	return s.effectiveTokenStore().SaveToken(token)
}

func (s *AutoUpdateService) clearPrivateUpdateToken() error {
	return s.effectiveTokenStore().ClearToken()
}

func (s *AutoUpdateService) resolveGitHubToken() (string, error) {
	if token := strings.TrimSpace(os.Getenv(autoUpdateGitHubTokenEnv)); token != "" {
		return token, nil
	}
	token, err := s.effectiveTokenStore().FindToken()
	if err == nil && strings.TrimSpace(token) != "" {
		return strings.TrimSpace(token), nil
	}
	if err != nil && !errors.Is(err, errAutoUpdateTokenNotFound) {
		return "", err
	}
	return "", autoUpdateManualRequiredError{reason: autoUpdatePrivateReleaseAuthInfo}
}

func (s *AutoUpdateService) effectiveTokenStore() autoUpdateTokenStore {
	if s != nil && s.tokenStore != nil {
		return s.tokenStore
	}
	return defaultAutoUpdateTokenStore()
}

func parseGitHubReleaseSource(rawSource string) (githubReleaseSource, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawSource))
	if err != nil {
		return githubReleaseSource{}, fmt.Errorf("GitHub release source is invalid: %w", err)
	}
	if parsed.Scheme != autoUpdateGitHubReleaseScheme {
		return githubReleaseSource{}, fmt.Errorf("GitHub release source scheme %q is unsupported", parsed.Scheme)
	}
	parts := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	if parsed.Host == "" || len(parts) < 3 {
		return githubReleaseSource{}, fmt.Errorf("GitHub release source must be github-release://owner/repo/latest/asset or github-release://owner/repo/tag/tag/asset")
	}
	source := githubReleaseSource{
		Owner: parsed.Host,
		Repo:  unescapePathPart(parts[0]),
		Mode:  unescapePathPart(parts[1]),
	}
	switch source.Mode {
	case "latest":
		source.Asset = unescapePathPart(strings.Join(parts[2:], "/"))
	case "tag":
		if len(parts) < 4 {
			return githubReleaseSource{}, fmt.Errorf("GitHub release tag source must include tag and asset name")
		}
		source.Tag = unescapePathPart(parts[2])
		source.Asset = unescapePathPart(strings.Join(parts[3:], "/"))
	default:
		return githubReleaseSource{}, fmt.Errorf("GitHub release source mode %q is unsupported", source.Mode)
	}
	if source.Owner != autoUpdateGitHubOwner || source.Repo != autoUpdateGitHubRepo {
		return githubReleaseSource{}, fmt.Errorf("GitHub release source repository %s/%s is not allowed", source.Owner, source.Repo)
	}
	if strings.TrimSpace(source.Asset) == "" {
		return githubReleaseSource{}, fmt.Errorf("GitHub release source asset name is empty")
	}
	return source, nil
}

func unescapePathPart(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

func (s *AutoUpdateService) readGitHubReleaseManifest(source string) (PackagedOSAutoUpdateManifest, error) {
	parsedSource, err := parseGitHubReleaseSource(source)
	if err != nil {
		return PackagedOSAutoUpdateManifest{}, err
	}
	token, err := s.resolveGitHubToken()
	if err != nil {
		return PackagedOSAutoUpdateManifest{}, err
	}
	release, err := s.fetchGitHubRelease(parsedSource, token)
	if err != nil {
		return PackagedOSAutoUpdateManifest{}, err
	}
	assetURL := ""
	for _, asset := range release.Assets {
		if asset.Name == parsedSource.Asset {
			assetURL = strings.TrimSpace(asset.URL)
			break
		}
	}
	if assetURL == "" {
		return PackagedOSAutoUpdateManifest{}, fmt.Errorf("GitHub release asset %q was not found", parsedSource.Asset)
	}
	data, err := s.readURLBytes(assetURL, autoUpdateMaxManifestBytes)
	if err != nil {
		return PackagedOSAutoUpdateManifest{}, fmt.Errorf("GitHub release manifest asset could not be read: %w", err)
	}
	var manifest PackagedOSAutoUpdateManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return PackagedOSAutoUpdateManifest{}, fmt.Errorf("GitHub release manifest asset is invalid JSON: %w", err)
	}
	return manifest, nil
}

func (s *AutoUpdateService) fetchGitHubRelease(source githubReleaseSource, token string) (githubReleaseResponse, error) {
	endpoint := strings.TrimRight(s.githubAPIBase, "/") + "/repos/" + url.PathEscape(source.Owner) + "/" + url.PathEscape(source.Repo)
	switch source.Mode {
	case "latest":
		endpoint += "/releases/latest"
	case "tag":
		endpoint += "/releases/tags/" + url.PathEscape(source.Tag)
	default:
		return githubReleaseResponse{}, fmt.Errorf("GitHub release source mode %q is unsupported", source.Mode)
	}
	data, err := s.readGitHubAPIBytes(endpoint, "application/vnd.github+json", token, autoUpdateMaxManifestBytes)
	if err != nil {
		return githubReleaseResponse{}, err
	}
	var release githubReleaseResponse
	if err := json.Unmarshal(data, &release); err != nil {
		return githubReleaseResponse{}, fmt.Errorf("GitHub release response is invalid JSON: %w", err)
	}
	return release, nil
}

func (s *AutoUpdateService) readGitHubAPIBytes(rawURL string, accept string, token string, limit int64) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-GitHub-Api-Version", autoUpdateGitHubAPIVersion)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("GitHub API response exceeds size limit")
	}
	return data, nil
}

func (s *AutoUpdateService) isGitHubReleaseAssetAPIURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	base, err := url.Parse(strings.TrimRight(s.githubAPIBase, "/"))
	if err != nil {
		return false
	}
	if parsed.Scheme != base.Scheme || !strings.EqualFold(parsed.Host, base.Host) {
		return false
	}
	allowedPrefix := "/repos/" + autoUpdateGitHubOwner + "/" + autoUpdateGitHubRepo + "/releases/assets/"
	return strings.HasPrefix(parsed.EscapedPath(), allowedPrefix)
}

func redactAutoUpdateError(value string) string {
	for _, secret := range []string{os.Getenv(autoUpdateGitHubTokenEnv)} {
		secret = strings.TrimSpace(secret)
		if secret == "" {
			continue
		}
		value = strings.ReplaceAll(value, secret, "[redacted]")
	}
	return value
}

func (keychainAutoUpdateTokenStore) FindToken() (string, error) {
	output, err := exec.Command(
		"/usr/bin/security",
		"find-generic-password",
		"-w",
		"-s", autoUpdateGitHubKeychainService,
		"-a", autoUpdateGitHubKeychainAccount,
	).CombinedOutput()
	if err != nil {
		if strings.Contains(strings.ToLower(string(output)), "could not be found") {
			return "", errAutoUpdateTokenNotFound
		}
		return "", fmt.Errorf("Keychain token lookup failed: %s", strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func (keychainAutoUpdateTokenStore) SaveToken(token string) error {
	output, err := exec.Command(
		"/usr/bin/security",
		"add-generic-password",
		"-U",
		"-s", autoUpdateGitHubKeychainService,
		"-a", autoUpdateGitHubKeychainAccount,
		"-w", token,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("Keychain token save failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func (keychainAutoUpdateTokenStore) ClearToken() error {
	output, err := exec.Command(
		"/usr/bin/security",
		"delete-generic-password",
		"-s", autoUpdateGitHubKeychainService,
		"-a", autoUpdateGitHubKeychainAccount,
	).CombinedOutput()
	if err != nil && !strings.Contains(strings.ToLower(string(output)), "could not be found") {
		return fmt.Errorf("Keychain token delete failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func (unsupportedAutoUpdateTokenStore) FindToken() (string, error) {
	return "", errAutoUpdateTokenNotFound
}

func (unsupportedAutoUpdateTokenStore) SaveToken(string) error {
	return fmt.Errorf("Keychain token storage is only available on macOS")
}

func (unsupportedAutoUpdateTokenStore) ClearToken() error {
	return nil
}
