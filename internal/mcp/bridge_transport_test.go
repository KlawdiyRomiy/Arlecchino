package mcp

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDefaultBridgeMetadataPath_UsesEnvOverrideAbsolute(t *testing.T) {
	overridePath := filepath.Join(t.TempDir(), "custom-bridge.json")
	t.Setenv(envBridgeMetadataPath, overridePath)

	if got := DefaultBridgeMetadataPath(); got != overridePath {
		t.Fatalf("DefaultBridgeMetadataPath() = %q, want %q", got, overridePath)
	}
}

func TestDefaultBridgeMetadataPath_UsesEnvOverrideRelative(t *testing.T) {
	t.Setenv(envBridgeMetadataPath, "bridge-dev.json")

	got := DefaultBridgeMetadataPath()
	if strings.TrimSpace(got) == "" {
		t.Fatalf("DefaultBridgeMetadataPath() should not be empty")
	}
	if !strings.HasSuffix(got, filepath.Join("arlecchino", "bridge-dev.json")) && !strings.HasSuffix(got, "bridge-dev.json") {
		t.Fatalf("DefaultBridgeMetadataPath() = %q, want suffix contains %q", got, "bridge-dev.json")
	}
}

func TestIDEBridgeServerAndClient_RoundTrip(t *testing.T) {
	metadataPath := filepath.Join(t.TempDir(), "mcp-bridge.json")

	server, err := NewIDEBridgeServerWithMetadataPath(func(method string, params map[string]any) (any, error) {
		return map[string]any{
			"method": method,
			"params": params,
		}, nil
	}, metadataPath)
	if err != nil {
		t.Fatalf("NewIDEBridgeServerWithMetadataPath() error = %v", err)
	}

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop()
	})

	client := NewSocketIDEBridgeClient(metadataPath)
	if !client.Available() {
		t.Fatalf("client should detect available bridge")
	}

	result, err := client.Call("project.status", map[string]any{"probe": "ok"})
	if err != nil {
		t.Fatalf("Call() error = %v", err)
	}

	resultMap, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("Call() result type = %T, want map[string]any", result)
	}

	if resultMap["method"] != "project.status" {
		t.Fatalf("Call() method = %v, want %q", resultMap["method"], "project.status")
	}
	paramsMap, ok := resultMap["params"].(map[string]any)
	if !ok {
		t.Fatalf("Call() params type = %T, want map[string]any", resultMap["params"])
	}
	if paramsMap["probe"] != "ok" {
		t.Fatalf("Call() params.probe = %v, want %q", paramsMap["probe"], "ok")
	}
}

func TestIDEBridgeClient_UnauthorizedTokenRejected(t *testing.T) {
	metadataPath := filepath.Join(t.TempDir(), "mcp-bridge.json")

	server, err := NewIDEBridgeServerWithMetadataPath(func(method string, params map[string]any) (any, error) {
		return map[string]any{"ok": true}, nil
	}, metadataPath)
	if err != nil {
		t.Fatalf("NewIDEBridgeServerWithMetadataPath() error = %v", err)
	}

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop()
	})

	data, err := os.ReadFile(metadataPath)
	if err != nil {
		t.Fatalf("ReadFile(metadata) error = %v", err)
	}

	var metadata map[string]any
	if err := json.Unmarshal(data, &metadata); err != nil {
		t.Fatalf("Unmarshal(metadata) error = %v", err)
	}
	metadata["token"] = "invalid-token"
	patched, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("Marshal(metadata) error = %v", err)
	}
	if err := os.WriteFile(metadataPath, patched, 0o600); err != nil {
		t.Fatalf("WriteFile(metadata) error = %v", err)
	}

	client := NewSocketIDEBridgeClient(metadataPath)
	_, err = client.Call("project.status", map[string]any{})
	if err == nil {
		t.Fatalf("Call() should fail with unauthorized token")
	}
	if !strings.Contains(err.Error(), "unauthorized bridge token") {
		t.Fatalf("Call() error = %v, want contains %q", err, "unauthorized bridge token")
	}
}

func TestIDEBridgeServer_StopRemovesMetadataAndSocket(t *testing.T) {
	metadataPath := filepath.Join(t.TempDir(), "mcp-bridge.json")

	server, err := NewIDEBridgeServerWithMetadataPath(func(method string, params map[string]any) (any, error) {
		return map[string]any{"ok": true}, nil
	}, metadataPath)
	if err != nil {
		t.Fatalf("NewIDEBridgeServerWithMetadataPath() error = %v", err)
	}

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}

	socketPath := server.SocketPath()
	if strings.TrimSpace(socketPath) == "" {
		t.Fatalf("SocketPath() must not be empty after Start")
	}

	if err := server.Stop(); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}

	if _, err := os.Stat(metadataPath); !os.IsNotExist(err) {
		t.Fatalf("metadata file should be removed on Stop, got err=%v", err)
	}
	if _, err := os.Stat(socketPath); !os.IsNotExist(err) {
		t.Fatalf("socket file should be removed on Stop, got err=%v", err)
	}
}

func TestIDEBridgeClient_TokenExpires(t *testing.T) {
	metadataPath := filepath.Join(t.TempDir(), "mcp-bridge.json")

	server, err := NewIDEBridgeServerWithMetadataPath(func(method string, params map[string]any) (any, error) {
		return map[string]any{"ok": true}, nil
	}, metadataPath)
	if err != nil {
		t.Fatalf("NewIDEBridgeServerWithMetadataPath() error = %v", err)
	}

	server.tokenTTL = 120 * time.Millisecond
	server.rotateTTL = 10 * time.Second

	if err := server.Start(); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop()
	})

	client := NewSocketIDEBridgeClient(metadataPath)
	time.Sleep(200 * time.Millisecond)

	_, err = client.Call("project.status", map[string]any{})
	if err == nil {
		t.Fatalf("Call() should fail after token expiration")
	}
	if !strings.Contains(err.Error(), "token expired") {
		t.Fatalf("Call() error = %v, want contains %q", err, "token expired")
	}
}
