//go:build darwin && arle_swift_bridge

package app

import "strings"

func (a *App) patchNativeApplicationMenu(shortcuts map[string][]string) {
	shortcut := firstMenuShortcut(shortcuts, "window.toggleFullscreen")
	parsed := parseShortcutParts(shortcut)
	payload := map[string]any{
		"submenu": "View",
		"item":    "Enter Full Screen",
	}
	if parsed.key != "" && parsed.hasModifier("fn") {
		payload["key"] = parsed.key
	}
	_, _ = callNativeMacOSBridge("menu.patchFullscreenShortcut", payload)
}

type shortcutParts struct {
	key       string
	modifiers map[string]bool
}

func (s shortcutParts) hasModifier(modifier string) bool {
	return s.modifiers[modifier]
}

func parseShortcutParts(shortcut string) shortcutParts {
	parts := strings.Split(strings.TrimSpace(strings.ToLower(shortcut)), "+")
	if len(parts) == 0 {
		return shortcutParts{}
	}

	result := shortcutParts{
		key:       strings.TrimSpace(parts[len(parts)-1]),
		modifiers: make(map[string]bool, len(parts)-1),
	}
	for _, part := range parts[:len(parts)-1] {
		part = strings.TrimSpace(part)
		switch part {
		case "function", "globe":
			part = "fn"
		}
		if part != "" {
			result.modifiers[part] = true
		}
	}
	return result
}

func firstMenuShortcut(shortcuts map[string][]string, actionID string) string {
	for _, shortcut := range menuShortcutsForAction(actionID, shortcuts) {
		if strings.TrimSpace(shortcut) != "" {
			return shortcut
		}
	}
	return ""
}
