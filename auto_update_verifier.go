package main

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const maxAutoUpdateSmokeArtifactBytes = 256 * 1024 * 1024

type PackagedOSAutoUpdateVerification struct {
	Status            string                        `json:"status"`
	Reason            string                        `json:"reason"`
	Channel           string                        `json:"channel,omitempty"`
	Version           string                        `json:"version,omitempty"`
	Platform          string                        `json:"platform,omitempty"`
	Arch              string                        `json:"arch,omitempty"`
	Artifact          *PackagedOSAutoUpdateArtifact `json:"artifact,omitempty"`
	DownloadPath      string                        `json:"downloadPath,omitempty"`
	ChecksumVerified  bool                          `json:"checksumVerified"`
	SignatureVerified bool                          `json:"signatureVerified"`
	Staged            bool                          `json:"staged"`
	InstallEnabled    bool                          `json:"installEnabled"`
	Mandatory         bool                          `json:"mandatory"`
}

func normalizeAutoUpdateManifest(manifest PackagedOSAutoUpdateManifest) PackagedOSAutoUpdateManifest {
	manifest.Channel = strings.TrimSpace(manifest.Channel)
	manifest.Version = strings.TrimSpace(manifest.Version)
	manifest.URL = strings.TrimSpace(manifest.URL)
	manifest.SHA256 = strings.ToLower(strings.TrimSpace(manifest.SHA256))
	manifest.Signature = strings.TrimSpace(manifest.Signature)
	manifest.Notes = strings.TrimSpace(manifest.Notes)
	manifest.ReleaseNotes = strings.TrimSpace(manifest.ReleaseNotes)
	if manifest.ReleaseNotes == "" {
		manifest.ReleaseNotes = manifest.Notes
	}

	artifacts := make([]PackagedOSAutoUpdateArtifact, 0, len(manifest.Artifacts)+1)
	for _, artifact := range manifest.Artifacts {
		artifact = normalizeAutoUpdateArtifact(artifact)
		if artifact.URL != "" {
			artifacts = append(artifacts, artifact)
		}
	}
	if len(artifacts) == 0 && manifest.URL != "" {
		artifacts = append(artifacts, normalizeAutoUpdateArtifact(PackagedOSAutoUpdateArtifact{
			Platform:  runtime.GOOS,
			Arch:      runtime.GOARCH,
			URL:       manifest.URL,
			SHA256:    manifest.SHA256,
			Signature: manifest.Signature,
		}))
	}
	manifest.Artifacts = artifacts
	return manifest
}

func normalizeAutoUpdateArtifact(artifact PackagedOSAutoUpdateArtifact) PackagedOSAutoUpdateArtifact {
	artifact.Platform = strings.ToLower(strings.TrimSpace(artifact.Platform))
	artifact.Arch = strings.ToLower(strings.TrimSpace(artifact.Arch))
	artifact.URL = strings.TrimSpace(artifact.URL)
	artifact.SHA256 = strings.ToLower(strings.TrimSpace(artifact.SHA256))
	artifact.Signature = strings.TrimSpace(artifact.Signature)
	artifact.Kind = strings.ToLower(strings.TrimSpace(artifact.Kind))
	return artifact
}

func validateAutoUpdateManifest(manifest PackagedOSAutoUpdateManifest) string {
	if manifest.Channel == "" {
		return "Auto-update manifest has no channel."
	}
	if !isValidAutoUpdateVersion(manifest.Version) {
		return "Auto-update manifest has invalid version."
	}
	if len(manifest.Artifacts) == 0 {
		return "Auto-update manifest has no platform artifacts."
	}
	for _, artifact := range manifest.Artifacts {
		if artifact.Platform == "" {
			return "Auto-update manifest artifact has no platform."
		}
		if artifact.URL == "" {
			return "Auto-update manifest artifact has no URL."
		}
		if artifact.SHA256 == "" || !isHexSHA256(artifact.SHA256) {
			return "Auto-update manifest artifact has invalid SHA256."
		}
		if artifact.Signature == "" {
			return "Auto-update manifest artifact has no detached signature."
		}
	}
	return ""
}

func isValidAutoUpdateVersion(version string) bool {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	parts := strings.Split(version, ".")
	if len(parts) < 3 {
		return false
	}
	for i := 0; i < 3; i++ {
		part := parts[i]
		if i == 2 {
			part = strings.SplitN(part, "-", 2)[0]
			part = strings.SplitN(part, "+", 2)[0]
		}
		if part == "" {
			return false
		}
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

func isHexSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func selectAutoUpdateArtifact(manifest *PackagedOSAutoUpdateManifest, platform string, arch string) (PackagedOSAutoUpdateArtifact, bool) {
	if manifest == nil {
		return PackagedOSAutoUpdateArtifact{}, false
	}
	platform = strings.ToLower(strings.TrimSpace(platform))
	arch = strings.ToLower(strings.TrimSpace(arch))
	for _, artifact := range manifest.Artifacts {
		if artifact.Platform != platform {
			continue
		}
		if artifact.Arch != "" && artifact.Arch != arch && artifact.Arch != "universal" {
			continue
		}
		return artifact, true
	}
	return PackagedOSAutoUpdateArtifact{}, false
}

func verifyAutoUpdateForSmoke(manifest *PackagedOSAutoUpdateManifest) PackagedOSAutoUpdateVerification {
	channel := strings.TrimSpace(os.Getenv(packagedOSAutoUpdateChannelEnv))
	if channel == "" {
		channel = "alpha"
	}
	result := PackagedOSAutoUpdateVerification{
		Status:   "no-manifest",
		Reason:   "Auto-update remains disabled; no manifest path is configured.",
		Channel:  channel,
		Platform: runtime.GOOS,
		Arch:     runtime.GOARCH,
	}
	if manifest == nil {
		return result
	}

	result.Status = "valid-manifest-read"
	result.Reason = "Auto-update manifest was read and schema-validated; install/apply remains disabled."
	result.Version = manifest.Version
	result.Mandatory = manifest.Mandatory
	if manifest.Channel != channel {
		result.Status = "channel-mismatch"
		result.Reason = fmt.Sprintf("Auto-update manifest channel %q does not match configured channel %q.", manifest.Channel, channel)
		return result
	}

	artifact, ok := selectAutoUpdateArtifact(manifest, runtime.GOOS, runtime.GOARCH)
	if !ok {
		result.Status = "platform-mismatch"
		result.Reason = fmt.Sprintf("Auto-update manifest has no artifact for %s/%s.", runtime.GOOS, runtime.GOARCH)
		return result
	}
	result.Artifact = cloneAutoUpdateArtifactPtr(artifact)

	if !envFlag(packagedOSAutoUpdateApplyEnv) {
		return result
	}
	result.InstallEnabled = true

	data, path, err := downloadAutoUpdateArtifactForSmoke(artifact)
	if err != nil {
		result.Status = "download-failed"
		result.Reason = err.Error()
		return result
	}
	result.DownloadPath = path

	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != artifact.SHA256 {
		result.Status = "checksum-mismatch"
		result.Reason = "Auto-update artifact SHA256 did not match manifest."
		return result
	}
	result.ChecksumVerified = true

	publicKey, err := decodeAutoUpdatePublicKey(os.Getenv(packagedOSAutoUpdatePublicKeyEnv))
	if err != nil {
		result.Status = "signature-key-invalid"
		result.Reason = err.Error()
		return result
	}
	signature, err := decodeAutoUpdateSignature(artifact.Signature)
	if err != nil {
		result.Status = "signature-invalid"
		result.Reason = err.Error()
		return result
	}
	if !ed25519.Verify(publicKey, data, signature) {
		result.Status = "signature-mismatch"
		result.Reason = "Auto-update artifact detached signature did not verify."
		return result
	}
	result.SignatureVerified = true
	result.Staged = true
	result.Status = "staged-apply-ready"
	result.Reason = "Auto-update artifact was downloaded to temp, checksum verified, signature verified and staged for explicit smoke apply."
	return result
}

func cloneAutoUpdateArtifactPtr(artifact PackagedOSAutoUpdateArtifact) *PackagedOSAutoUpdateArtifact {
	cloned := artifact
	return &cloned
}

func downloadAutoUpdateArtifactForSmoke(artifact PackagedOSAutoUpdateArtifact) ([]byte, string, error) {
	parsed, err := url.Parse(artifact.URL)
	if err != nil {
		return nil, "", fmt.Errorf("auto-update artifact URL is invalid: %w", err)
	}

	var data []byte
	switch parsed.Scheme {
	case "file":
		data, err = os.ReadFile(parsed.Path)
	case "http", "https":
		client := http.Client{Timeout: 30 * time.Second}
		resp, requestErr := client.Get(artifact.URL)
		if requestErr != nil {
			err = requestErr
			break
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, "", fmt.Errorf("auto-update artifact download returned HTTP %d", resp.StatusCode)
		}
		data, err = io.ReadAll(io.LimitReader(resp.Body, maxAutoUpdateSmokeArtifactBytes+1))
	default:
		return nil, "", fmt.Errorf("auto-update artifact URL scheme %q is unsupported", parsed.Scheme)
	}
	if err != nil {
		return nil, "", fmt.Errorf("auto-update artifact could not be read: %w", err)
	}
	if len(data) > maxAutoUpdateSmokeArtifactBytes {
		return nil, "", fmt.Errorf("auto-update artifact exceeds smoke size limit")
	}

	stageDir, err := os.MkdirTemp("", "arlecchino-update-stage-*")
	if err != nil {
		return nil, "", fmt.Errorf("auto-update stage dir could not be created: %w", err)
	}
	stagePath := filepath.Join(stageDir, "artifact")
	if err := os.WriteFile(stagePath, data, 0o600); err != nil {
		return nil, "", fmt.Errorf("auto-update artifact could not be staged: %w", err)
	}
	return data, stagePath, nil
}

func decodeAutoUpdatePublicKey(value string) (ed25519.PublicKey, error) {
	decoded, err := decodeAutoUpdateBinary(value)
	if err != nil {
		return nil, fmt.Errorf("auto-update public key is invalid: %w", err)
	}
	if len(decoded) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("auto-update public key has length %d, want %d", len(decoded), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(decoded), nil
}

func decodeAutoUpdateSignature(value string) ([]byte, error) {
	decoded, err := decodeAutoUpdateBinary(value)
	if err != nil {
		return nil, fmt.Errorf("auto-update signature is invalid: %w", err)
	}
	if len(decoded) != ed25519.SignatureSize {
		return nil, fmt.Errorf("auto-update signature has length %d, want %d", len(decoded), ed25519.SignatureSize)
	}
	return decoded, nil
}

func decodeAutoUpdateBinary(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, fmt.Errorf("empty value")
	}
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	if decoded, err := hex.DecodeString(value); err == nil {
		return decoded, nil
	}
	var raw json.RawMessage
	if err := json.Unmarshal([]byte(value), &raw); err == nil && len(raw) > 0 {
		return nil, fmt.Errorf("expected base64 or hex, got JSON")
	}
	return nil, fmt.Errorf("expected base64 or hex")
}
