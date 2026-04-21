package depsync

import "strings"

func buildActionID(manager Manager, cmd Command) string {
	parts := []string{
		strings.TrimSpace(manager.Ecosystem),
		strings.TrimSpace(manager.Tool),
		strings.TrimSpace(manager.Manifest),
		strings.TrimSpace(cmd.Label),
		strings.TrimSpace(cmd.Executable),
		strings.TrimSpace(cmd.Args),
	}
	return strings.Join(parts, "::")
}
