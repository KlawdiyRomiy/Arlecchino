package depsync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
)

func buildActionID(manager Manager, cmd Command) string {
	parts := []string{
		strings.TrimSpace(manager.Ecosystem),
		strings.TrimSpace(manager.Tool),
		filepath.ToSlash(strings.TrimSpace(manager.Manifest)),
		strings.TrimSpace(cmd.Label),
		strings.TrimSpace(cmd.Executable),
		strings.TrimSpace(cmd.Args),
	}
	encoded, _ := json.Marshal(parts)
	sum := sha256.Sum256(encoded)
	readable := []string{
		sanitizeActionIDPart(parts[0]),
		sanitizeActionIDPart(parts[1]),
		sanitizeActionIDPart(parts[2]),
		sanitizeActionIDPart(parts[3]),
	}
	return "depsync:v1:" + hex.EncodeToString(sum[:12]) + ":" + strings.Join(readable, ":")
}

func sanitizeActionIDPart(value string) string {
	value = strings.TrimSpace(value)
	value = strings.NewReplacer(
		":", "%3A",
		"\n", "%0A",
		"\r", "%0D",
	).Replace(value)
	if value == "" {
		return "_"
	}
	return value
}
