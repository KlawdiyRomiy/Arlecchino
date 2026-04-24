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
		{Name: "Open git panel", Description: "Show Git panel", Icon: "git-branch", Handler: "panel.git"},
		{Name: "Open AI panel", Description: "Show AI assistant", Icon: "sparkles", Handler: "panel.ai"},
		{Name: "Open terminal", Description: "Focus terminal", Icon: "terminal", Handler: "panel.terminal"},
		{Name: "Open file explorer", Description: "Show file explorer", Icon: "folder", Handler: "panel.explorer"},
		{Name: "Open search", Description: "Open search panel", Icon: "search", Handler: "panel.search"},

		{Name: "Toggle sidebar", Description: "Show/hide sidebar", Icon: "sidebar", Handler: "toggle.sidebar", Keybinding: "cmd+b"},
		{Name: "Toggle terminal", Description: "Show/hide terminal", Icon: "terminal", Handler: "toggle.terminal", Keybinding: "cmd+`"},
		{Name: "Toggle AI", Description: "Show/hide AI panel", Icon: "sparkles", Handler: "toggle.ai", Keybinding: "cmd+r"},

		{Name: "Split editor vertical", Description: "Split editor vertically", Icon: "columns", Handler: "editor.splitVertical"},
		{Name: "Split editor horizontal", Description: "Split editor horizontally", Icon: "rows", Handler: "editor.splitHorizontal"},
		{Name: "Close tab", Description: "Close current tab", Icon: "x", Handler: "editor.closeTab", Keybinding: "cmd+w"},
		{Name: "Close all tabs", Description: "Close all tabs", Icon: "x-circle", Handler: "editor.closeAllTabs"},
		{Name: "Close other tabs", Description: "Close other tabs", Icon: "x", Handler: "editor.closeOtherTabs"},

		{Name: "New file", Description: "Create new file", Icon: "file-plus", Handler: "file.new", Keybinding: "cmd+n"},
		{Name: "Save", Description: "Save current file", Icon: "save", Handler: "file.save", Keybinding: "cmd+s"},
		{Name: "Save all", Description: "Save all files", Icon: "save", Handler: "file.saveAll", Keybinding: "cmd+shift+s"},

		{Name: "Format document", Description: "Format current file", Icon: "align-left", Handler: "editor.format", Keybinding: "shift+alt+f"},
		{Name: "Go to line", Description: "Jump to line number", Icon: "hash", Handler: "editor.goToLine", Keybinding: "cmd+g"},
		{Name: "Go to definition", Description: "Go to symbol definition", Icon: "arrow-right", Handler: "editor.goToDefinition", Keybinding: "f12"},

		{Name: "Toggle word wrap", Description: "Toggle line wrapping", Icon: "wrap-text", Handler: "editor.toggleWordWrap"},
		{Name: "Toggle minimap", Description: "Show/hide minimap", Icon: "map", Handler: "editor.toggleMinimap"},

		{Name: "Zoom in", Description: "Increase UI zoom", Icon: "zoom-in", Handler: "view.zoomIn", Keybinding: "cmd+="},
		{Name: "Zoom out", Description: "Decrease UI zoom", Icon: "zoom-out", Handler: "view.zoomOut", Keybinding: "cmd+-"},
		{Name: "Reset zoom", Description: "Reset UI zoom", Icon: "maximize", Handler: "view.zoomReset", Keybinding: "cmd+0"},

		{Name: "Open settings", Description: "Open settings", Icon: "settings", Handler: "app.settings", Keybinding: "cmd+,"},
		{Name: "Show keybindings", Description: "Show keyboard shortcuts", Icon: "keyboard", Handler: "app.keybindings"},
		{Name: "Reload window", Description: "Reload application", Icon: "refresh-cw", Handler: "app.reload"},

		{Name: "Git status", Description: "Show git status", Icon: "git-branch", Handler: "git.status"},
		{Name: "Git commit", Description: "Commit changes", Icon: "git-commit", Handler: "git.commit"},
		{Name: "Git push", Description: "Push to remote", Icon: "upload", Handler: "git.push"},
		{Name: "Git pull", Description: "Pull from remote", Icon: "download", Handler: "git.pull"},

		{Name: "Open preview", Description: "Open browser preview window", Icon: "globe", Handler: "preview.open"},
		{Name: "Focus preview", Description: "Focus browser preview window", Icon: "focus", Handler: "preview.focus"},
		{Name: "Close preview", Description: "Close browser preview window", Icon: "x-circle", Handler: "preview.close"},
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
