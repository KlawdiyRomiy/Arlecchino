package wails

import (
	"context"
	"encoding/base64"
	"fmt"

	"arlecchino/internal/terminal"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// TerminalService handles terminal operations for the Wails frontend
type TerminalService struct {
	ctx         context.Context
	manager     *terminal.Manager
	projectPath string
}

// NewTerminalService creates a new terminal service
func NewTerminalService() *TerminalService {
	return &TerminalService{
		manager: terminal.NewManager(),
	}
}

// Startup initializes the service with the Wails context
func (t *TerminalService) Startup(ctx context.Context) {
	t.ctx = ctx
}

// SetProjectPath sets the current project path for terminal working directory
func (t *TerminalService) SetProjectPath(path string) {
	t.projectPath = path
}

// GetProjectPath returns the current project path
func (t *TerminalService) GetProjectPath() string {
	return t.projectPath
}

// Manager returns the underlying terminal manager
func (t *TerminalService) Manager() *terminal.Manager {
	return t.manager
}

// Create creates a new terminal session
func (t *TerminalService) Create(id, name string, workingDir string) error {
	if workingDir == "" {
		workingDir = t.projectPath
	}

	session, err := t.manager.Create(id, name, workingDir)
	if err != nil {
		return err
	}

	// Set up data callback to emit events to frontend
	session.SetOnData(func(data []byte) {
		encoded := base64.StdEncoding.EncodeToString(data)
		runtime.EventsEmit(t.ctx, "terminal:data", map[string]interface{}{
			"id":   id,
			"data": encoded,
		})
	})

	// Set up exit callback
	session.SetOnExit(func(code int) {
		runtime.EventsEmit(t.ctx, "terminal:exit", map[string]interface{}{
			"id":   id,
			"code": code,
		})
	})

	return nil
}

// Write writes data to a terminal session
func (t *TerminalService) Write(id string, data string) error {
	session := t.manager.Get(id)
	if session == nil {
		return fmt.Errorf("terminal session not found: %s", id)
	}

	// Try to decode as base64, fall back to raw string
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return session.Write([]byte(data))
	}
	return session.Write(decoded)
}

// Resize resizes a terminal session
func (t *TerminalService) Resize(id string, rows, cols int) error {
	session := t.manager.Get(id)
	if session == nil {
		return fmt.Errorf("terminal session not found: %s", id)
	}
	return session.Resize(uint16(rows), uint16(cols))
}

// Close closes a terminal session
func (t *TerminalService) Close(id string) error {
	return t.manager.Close(id)
}

// CloseAll closes all terminal sessions
func (t *TerminalService) CloseAll() {
	t.manager.CloseAll()
}

// Get returns a terminal session by ID
func (t *TerminalService) Get(id string) *terminal.Session {
	return t.manager.Get(id)
}
