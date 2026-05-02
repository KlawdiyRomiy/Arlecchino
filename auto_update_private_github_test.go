package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeAutoUpdateTokenStore struct {
	token string
	err   error
	saved string
	clear bool
}

func (s *fakeAutoUpdateTokenStore) FindToken() (string, error) {
	if s.err != nil {
		return "", s.err
	}
	if strings.TrimSpace(s.token) == "" {
		return "", errAutoUpdateTokenNotFound
	}
	return s.token, nil
}

func (s *fakeAutoUpdateTokenStore) SaveToken(token string) error {
	s.saved = token
	s.token = token
	return nil
}

func (s *fakeAutoUpdateTokenStore) ClearToken() error {
	s.clear = true
	s.token = ""
	return nil
}

func TestParseGitHubReleaseSource(t *testing.T) {
	source, err := parseGitHubReleaseSource("github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-update-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if source.Owner != "KlawdiyRomiy" || source.Repo != "Arlecchino" || source.Mode != "latest" || source.Asset != "arlecchino-update-manifest.json" {
		t.Fatalf("source = %#v", source)
	}

	source, err = parseGitHubReleaseSource("github-release://KlawdiyRomiy/Arlecchino/tag/v0.2.0/arlecchino-update-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if source.Mode != "tag" || source.Tag != "v0.2.0" || source.Asset != "arlecchino-update-manifest.json" {
		t.Fatalf("tag source = %#v", source)
	}

	for _, raw := range []string{
		"https://github.com/KlawdiyRomiy/Arlecchino/releases/latest",
		"github-release://Other/Arlecchino/latest/manifest.json",
		"github-release://KlawdiyRomiy/Arlecchino/tag/manifest.json",
	} {
		if _, err := parseGitHubReleaseSource(raw); err == nil {
			t.Fatalf("parseGitHubReleaseSource(%q) succeeded, want error", raw)
		}
	}
}

func TestPrivateGitHubManifestMissingTokenIsManualRequired(t *testing.T) {
	service := NewAutoUpdateService()
	service.tokenStore = &fakeAutoUpdateTokenStore{}

	_, err := service.readManifest("github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-update-manifest.json")
	if err == nil {
		t.Fatal("readManifest succeeded without private token")
	}
	var manualRequired autoUpdateManualRequiredError
	if !errors.As(err, &manualRequired) {
		t.Fatalf("err = %T %v, want autoUpdateManualRequiredError", err, err)
	}
}

func TestPrivateGitHubManifestUsesTokenAndAssetAPI(t *testing.T) {
	const token = "github_pat_test_secret"
	var releaseAuth string
	var manifestAuth string
	var manifestAccept string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/KlawdiyRomiy/Arlecchino/releases/latest":
			releaseAuth = r.Header.Get("Authorization")
			_ = json.NewEncoder(w).Encode(githubReleaseResponse{
				TagName: "v0.2.0",
				Assets: []githubReleaseAsset{{
					Name: "arlecchino-update-manifest.json",
					URL:  serverAssetURL(r, "/repos/KlawdiyRomiy/Arlecchino/releases/assets/1"),
				}},
			})
		case "/repos/KlawdiyRomiy/Arlecchino/releases/assets/1":
			manifestAuth = r.Header.Get("Authorization")
			manifestAccept = r.Header.Get("Accept")
			_, _ = w.Write([]byte(`{
				"channel": "alpha",
				"version": "0.2.0",
				"artifacts": [{
					"platform": "darwin",
					"arch": "universal",
					"kind": "zip",
					"url": "https://api.github.com/repos/KlawdiyRomiy/Arlecchino/releases/assets/2",
					"sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					"signature": "bbbb"
				}]
			}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	service := NewAutoUpdateService()
	service.githubAPIBase = server.URL
	service.tokenStore = &fakeAutoUpdateTokenStore{token: token}

	manifest, err := service.readManifest("github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-update-manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Version != "0.2.0" {
		t.Fatalf("manifest version = %q", manifest.Version)
	}
	if releaseAuth != "Bearer "+token {
		t.Fatalf("release Authorization = %q", releaseAuth)
	}
	if manifestAuth != "Bearer "+token {
		t.Fatalf("manifest Authorization = %q", manifestAuth)
	}
	if manifestAccept != "application/octet-stream" {
		t.Fatalf("manifest Accept = %q", manifestAccept)
	}
}

func TestPrivateUpdateAuthStatusAndTokenMutation(t *testing.T) {
	t.Setenv(autoUpdateManifestURLEnv, "github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-update-manifest.json")
	store := &fakeAutoUpdateTokenStore{}
	service := NewAutoUpdateService()
	service.tokenStore = store

	status := service.privateUpdateAuthStatus()
	if status.Configured || status.Reason != autoUpdatePrivateReleaseAuthInfo {
		t.Fatalf("status = %#v, want missing private token", status)
	}

	if err := service.savePrivateUpdateToken("  token-value  "); err != nil {
		t.Fatal(err)
	}
	if store.saved != "token-value" {
		t.Fatalf("saved token = %q, want trimmed token", store.saved)
	}
	status = service.privateUpdateAuthStatus()
	if !status.Configured || status.Source != "keychain" {
		t.Fatalf("status after save = %#v", status)
	}

	if err := service.clearPrivateUpdateToken(); err != nil {
		t.Fatal(err)
	}
	if !store.clear {
		t.Fatal("clear token was not called")
	}
}

func TestReadURLBytesOnlyAuthorizesAllowedGitHubAssetURL(t *testing.T) {
	const token = "github_pat_allowed"
	var allowedAuth string
	var otherAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/KlawdiyRomiy/Arlecchino/releases/assets/2":
			allowedAuth = r.Header.Get("Authorization")
		case "/repos/KlawdiyRomiy/Other/releases/assets/2":
			otherAuth = r.Header.Get("Authorization")
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte("ok"))
	}))
	defer server.Close()

	service := NewAutoUpdateService()
	service.githubAPIBase = server.URL
	service.tokenStore = &fakeAutoUpdateTokenStore{token: token}

	if _, err := service.readURLBytes(server.URL+"/repos/KlawdiyRomiy/Arlecchino/releases/assets/2", 16); err != nil {
		t.Fatal(err)
	}
	if _, err := service.readURLBytes(server.URL+"/repos/KlawdiyRomiy/Other/releases/assets/2", 16); err != nil {
		t.Fatal(err)
	}
	if allowedAuth != "Bearer "+token {
		t.Fatalf("allowed Authorization = %q", allowedAuth)
	}
	if otherAuth != "" {
		t.Fatalf("other Authorization = %q, want empty", otherAuth)
	}
}

func serverAssetURL(r *http.Request, path string) string {
	return "http://" + r.Host + path
}
