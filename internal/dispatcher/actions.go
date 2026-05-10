package dispatcher

import "sync"

type ActionRegistry struct {
	mu      sync.RWMutex
	actions map[string]*IDEAction
}

func NewActionRegistry() *ActionRegistry {
	r := &ActionRegistry{
		actions: make(map[string]*IDEAction),
	}
	r.registerDefaults()
	return r
}

func (r *ActionRegistry) registerDefaults() {
	defaults := []IDEAction{
		{Name: "Open Command Palette", Description: "Open the project command and search surface", Icon: "search", Handler: "panel.search", Keybinding: "cmd+f"},
		{Name: "Open Settings", Description: "Open workspace settings", Icon: "settings", Handler: "app.settings", Keybinding: "cmd+,"},
		{Name: "Toggle Zen Mode", Description: "Hide chrome and snapped panels until their edge is hovered", Icon: "focus", Handler: "shortcut.zenMode.toggle", Keybinding: "cmd+shift+."},
		{Name: "Toggle Window Full Screen", Description: "Enter or exit macOS full screen", Icon: "maximize", Handler: "shortcut.window.toggleFullscreen", Keybinding: "fn+f"},
		{Name: "Copy Project Path", Description: "Copy the active project path", Icon: "copy", Handler: "shortcut.project.copyPath", Keybinding: "cmd+shift+c"},
		{Name: "Open Project", Description: "Open another project folder", Icon: "folder-open", Handler: "shortcut.project.open", Keybinding: "cmd+o"},
		{Name: "New Project", Description: "Create a new project", Icon: "file-plus", Handler: "shortcut.project.new", Keybinding: "cmd+n"},

		{Name: "Run", Description: "Run the active project or file", Icon: "play", Handler: "panel.run"},
		{Name: "Debug", Description: "Debug the active project or file", Icon: "bug", Handler: "panel.debug"},

		{Name: "Open Explorer Panel", Description: "Show file explorer panel", Icon: "folder", Handler: "panel.explorer"},
		{Name: "Toggle Explorer Panel", Description: "Open or close file explorer panel", Icon: "folder", Handler: "shortcut.explorer.toggle", Keybinding: "cmd+e"},
		{Name: "Open Terminal Panel", Description: "Show terminal panel", Icon: "terminal", Handler: "panel.terminal"},
		{Name: "Toggle Terminal Panel", Description: "Open or close terminal panel", Icon: "terminal", Handler: "shortcut.terminal.toggle", Keybinding: "cmd+j"},
		{Name: "Toggle Terminal Fullscreen", Description: "Open Terminal in fullscreen mode or restore it", Icon: "maximize", Handler: "shortcut.terminal.fullscreen", Keybinding: "cmd+shift+j"},
		{Name: "Open AI Panel", Description: "Show AI assistant panel", Icon: "sparkles", Handler: "panel.ai"},
		{Name: "Toggle AI Panel", Description: "Open or close AI assistant panel", Icon: "sparkles", Handler: "shortcut.ai.toggle", Keybinding: "cmd+r"},
		{Name: "Open Git Panel", Description: "Show Git panel", Icon: "git-branch", Handler: "panel.git"},
		{Name: "Toggle Git Panel", Description: "Open or close Git panel", Icon: "git-branch", Handler: "shortcut.git.toggle", Keybinding: "cmd+g"},
		{Name: "Open Problems Panel", Description: "Show Problems panel", Icon: "alert-circle", Handler: "panel.problems"},
		{Name: "Toggle Problems Panel", Description: "Open or close Problems panel", Icon: "alert-circle", Handler: "shortcut.problems.toggle", Keybinding: "cmd+i"},
		{Name: "Toggle Git Fullscreen", Description: "Open Git in fullscreen mode or restore it", Icon: "maximize", Handler: "shortcut.git.fullscreen", Keybinding: "cmd+shift+g"},
		{Name: "Toggle Problems Fullscreen", Description: "Open Problems in fullscreen mode or restore it", Icon: "maximize", Handler: "shortcut.problems.fullscreen", Keybinding: "cmd+shift+i"},
		{Name: "Close Fullscreen Panel", Description: "Close the active fullscreen panel", Icon: "x-circle", Handler: "shortcut.panel.closeFullscreen", Keybinding: "option+w"},
		{Name: "Close Explorer Panel", Description: "Close file explorer panel", Icon: "x-circle", Handler: "panel.close.explorer"},
		{Name: "Close Terminal Panel", Description: "Close terminal panel", Icon: "x-circle", Handler: "panel.close.terminal"},
		{Name: "Close AI Panel", Description: "Close AI assistant panel", Icon: "x-circle", Handler: "panel.close.ai"},
		{Name: "Close Git Panel", Description: "Close Git panel", Icon: "x-circle", Handler: "panel.close.git"},
		{Name: "Close Problems Panel", Description: "Close Problems panel", Icon: "x-circle", Handler: "panel.close.problems"},

		{Name: "Move Left Panel to Right Side", Description: "Move the panel snapped on the left side to the right side", Icon: "move", Handler: "panel.move.leftToRight"},
		{Name: "Move Left Panel to Top Side", Description: "Move the panel snapped on the left side to the top side", Icon: "move", Handler: "panel.move.leftToTop"},
		{Name: "Move Left Panel to Bottom Side", Description: "Move the panel snapped on the left side to the bottom side", Icon: "move", Handler: "panel.move.leftToBottom"},
		{Name: "Move Right Panel to Left Side", Description: "Move the panel snapped on the right side to the left side", Icon: "move", Handler: "panel.move.rightToLeft"},
		{Name: "Move Right Panel to Top Side", Description: "Move the panel snapped on the right side to the top side", Icon: "move", Handler: "panel.move.rightToTop"},
		{Name: "Move Right Panel to Bottom Side", Description: "Move the panel snapped on the right side to the bottom side", Icon: "move", Handler: "panel.move.rightToBottom"},
		{Name: "Move Top Panel to Left Side", Description: "Move the panel snapped on the top side to the left side", Icon: "move", Handler: "panel.move.topToLeft"},
		{Name: "Move Top Panel to Right Side", Description: "Move the panel snapped on the top side to the right side", Icon: "move", Handler: "panel.move.topToRight"},
		{Name: "Move Top Panel to Bottom Side", Description: "Move the panel snapped on the top side to the bottom side", Icon: "move", Handler: "panel.move.topToBottom"},
		{Name: "Move Bottom Panel to Left Side", Description: "Move the panel snapped on the bottom side to the left side", Icon: "move", Handler: "panel.move.bottomToLeft"},
		{Name: "Move Bottom Panel to Right Side", Description: "Move the panel snapped on the bottom side to the right side", Icon: "move", Handler: "panel.move.bottomToRight"},
		{Name: "Move Bottom Panel to Top Side", Description: "Move the panel snapped on the bottom side to the top side", Icon: "move", Handler: "panel.move.bottomToTop"},

		{Name: "Open Browser Preview", Description: "Open browser preview for the active context", Icon: "globe", Handler: "preview.open", Keybinding: "cmd+b"},
		{Name: "Toggle Browser Preview", Description: "Open or close browser preview for the active context", Icon: "globe", Handler: "shortcut.browser.preview", Keybinding: "cmd+b"},
		{Name: "Move Browser Preview Left", Description: "Move browser preview to the left side", Icon: "globe", Handler: "preview.move.left"},
		{Name: "Move Browser Preview Right", Description: "Move browser preview to the right side", Icon: "globe", Handler: "preview.move.right"},
		{Name: "Move Browser Preview Top", Description: "Move browser preview to the top side", Icon: "globe", Handler: "preview.move.top"},
		{Name: "Move Browser Preview Bottom", Description: "Move browser preview to the bottom side", Icon: "globe", Handler: "preview.move.bottom"},
		{Name: "Focus Browser Preview", Description: "Focus browser preview window", Icon: "focus", Handler: "preview.focus"},
		{Name: "Close Browser Preview", Description: "Close browser preview window", Icon: "x-circle", Handler: "preview.close"},

		{Name: "Zoom in", Description: "Increase UI zoom", Icon: "zoom-in", Handler: "view.zoomIn", Keybinding: "cmd+="},
		{Name: "Zoom out", Description: "Decrease UI zoom", Icon: "zoom-out", Handler: "view.zoomOut", Keybinding: "cmd+-"},
		{Name: "Reset zoom", Description: "Reset UI zoom", Icon: "maximize", Handler: "view.zoomReset", Keybinding: "cmd+0"},

		{Name: "Split editor vertical", Description: "Split editor vertically", Icon: "columns", Handler: "editor.splitVertical"},
		{Name: "Split editor horizontal", Description: "Split editor horizontally", Icon: "rows", Handler: "editor.splitHorizontal"},

		{Name: "Git Status", Description: "Show Git status panel", Icon: "git-branch", Handler: "git.status"},
	}

	for _, action := range defaults {
		a := action
		r.actions[a.Name] = &a
	}
}

func (r *ActionRegistry) Register(action *IDEAction) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.actions[action.Name] = action
}

func (r *ActionRegistry) Get(name string) *IDEAction {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.actions[name]
}

func (r *ActionRegistry) All() []*IDEAction {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]*IDEAction, 0, len(r.actions))
	for _, action := range r.actions {
		result = append(result, action)
	}
	return result
}

func (r *ActionRegistry) Match(query string) []*IDEAction {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if query == "" {
		return r.All()
	}

	queryLower := toLower(query)
	var matches []*IDEAction
	for _, action := range r.actions {
		nameLower := toLower(action.Name)
		descLower := toLower(action.Description)
		if containsSubstring(nameLower, queryLower) || containsSubstring(descLower, queryLower) {
			matches = append(matches, action)
		}
	}
	return matches
}

func (r *ActionRegistry) ByHandler(prefix string) []*IDEAction {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []*IDEAction
	for _, action := range r.actions {
		if len(action.Handler) >= len(prefix) && action.Handler[:len(prefix)] == prefix {
			result = append(result, action)
		}
	}
	return result
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		} else {
			b[i] = c
		}
	}
	return string(b)
}

func containsSubstring(s, substr string) bool {
	if len(substr) > len(s) {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
