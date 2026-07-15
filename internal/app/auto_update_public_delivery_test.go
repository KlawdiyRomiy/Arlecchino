package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAutoUpdatePublicDeliveryUsesTokenlessHTTP(t *testing.T) {
	const artifact = "public update artifact"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			t.Errorf("Authorization = %q, want no token for public delivery", authorization)
		}
		if apiVersion := r.Header.Get("X-GitHub-Api-Version"); apiVersion != "" {
			t.Errorf("X-GitHub-Api-Version = %q, want no GitHub API request", apiVersion)
		}

		switch r.URL.Path {
		case "/manifest.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"channel":"beta","version":"0.2.28-beta","build":"149","artifacts":[{"platform":"darwin","arch":"universal","kind":"zip","url":%q}]}`+"\n", server.URL+"/arlecchino-macos-universal.zip")
		case "/arlecchino-macos-universal.zip":
			_, _ = w.Write([]byte(artifact))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	service := NewAutoUpdateService()
	manifest, err := service.readManifest(server.URL + "/manifest.json")
	if err != nil {
		t.Fatalf("readManifest() error = %v", err)
	}
	if len(manifest.Artifacts) != 1 {
		t.Fatalf("manifest artifacts = %d, want 1", len(manifest.Artifacts))
	}

	data, err := service.readArtifact(manifest.Artifacts[0])
	if err != nil {
		t.Fatalf("readArtifact() error = %v", err)
	}
	if got := string(data); got != artifact {
		t.Fatalf("artifact = %q, want %q", got, artifact)
	}
}

func TestAutoUpdateRejectsUnsupportedManifestSource(t *testing.T) {
	service := NewAutoUpdateService()
	if _, err := service.readManifest("retired-release://example.invalid/manifest.json"); err == nil {
		t.Fatal("readManifest accepted unsupported manifest source")
	}
}
