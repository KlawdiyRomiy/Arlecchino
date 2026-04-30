package main

import (
	"arlecchino/internal/mcp"
	"arlecchino/internal/terminal"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// Terminal Management - PTY session lifecycle and I/O

func (a *App) CreateTerminal(id, name string) error {
	return a.CreateTerminalForProject(id, name, a.GetCurrentProjectPath())
}

func (a *App) CreateTerminalForProject(id, name, projectPath string) error {
	workingDir := projectPath
	if workingDir == "" {
		home, _ := os.UserHomeDir()
		workingDir = home
	}

	session, err := a.termManager.Create(id, name, workingDir)
	if err != nil {
		return err
	}

	dataEmitter := newTerminalDataEmitter(func(data []byte) {
		encoded := base64.StdEncoding.EncodeToString(data)
		a.emitEvent("terminal:data", map[string]interface{}{
			"id":   id,
			"data": encoded,
		})
	})
	session.SetOnData(dataEmitter.Push)

	session.SetOnExit(func(code int) {
		dataEmitter.Flush()
		a.emitEvent("terminal:exit", map[string]interface{}{
			"id":   id,
			"code": code,
		})
	})

	session.SetOnMode(func(event terminal.TUIModeEvent) {
		if legacyPTYBootstrapEnabled() && session.ReserveAgentGuideInjection(event) {
			a.tryInjectAgentGuide(session, id)
		}

		a.emitEvent("terminal:mode", map[string]interface{}{
			"id":            id,
			"mode":          event.Mode,
			"active":        event.Active,
			"reason":        event.Reason,
			"confidence":    event.Confidence,
			"sourceSignals": event.SourceSignals,
			"timestamp":     time.Now().UnixMilli(),
		})
	})

	session.SetOnShell(func(event terminal.ShellEvent) {
		payload := map[string]interface{}{
			"id":   id,
			"type": event.Type,
			"cwd":  event.CWD,
			"raw":  event.Raw,
		}
		if event.ExitCode != nil {
			payload["exitCode"] = *event.ExitCode
		}

		a.emitEvent("terminal:shell", payload)
	})

	session.SetOnSemantic(func(event terminal.SemanticEvent) {
		a.emitEvent("terminal:semantic", map[string]interface{}{
			"id":       id,
			"kind":     event.Kind,
			"path":     event.Path,
			"line":     event.Line,
			"column":   event.Column,
			"severity": event.Severity,
			"message":  event.Message,
		})
	})

	a.emitEvent("terminal:created", map[string]interface{}{
		"id":   id,
		"name": name,
	})

	return nil
}

type terminalDataEmitter struct {
	mu         sync.Mutex
	buffer     []byte
	timer      *time.Timer
	emit       func([]byte)
	flushDelay time.Duration
	maxBytes   int
}

func newTerminalDataEmitter(emit func([]byte)) *terminalDataEmitter {
	return &terminalDataEmitter{
		emit:       emit,
		flushDelay: 16 * time.Millisecond,
		maxBytes:   32 << 10,
	}
}

func (e *terminalDataEmitter) Push(data []byte) {
	if e == nil || len(data) == 0 {
		return
	}

	var flushData []byte
	e.mu.Lock()
	e.buffer = append(e.buffer, data...)
	if len(e.buffer) >= e.maxBytes {
		flushData = e.takeLocked()
	} else if e.timer == nil {
		e.timer = time.AfterFunc(e.flushDelay, e.Flush)
	}
	e.mu.Unlock()

	if len(flushData) > 0 {
		e.emit(flushData)
	}
}

func (e *terminalDataEmitter) Flush() {
	if e == nil {
		return
	}

	e.mu.Lock()
	flushData := e.takeLocked()
	e.mu.Unlock()

	if len(flushData) > 0 {
		e.emit(flushData)
	}
}

func (e *terminalDataEmitter) takeLocked() []byte {
	if e.timer != nil {
		e.timer.Stop()
		e.timer = nil
	}
	if len(e.buffer) == 0 {
		return nil
	}
	data := make([]byte, len(e.buffer))
	copy(data, e.buffer)
	e.buffer = e.buffer[:0]
	return data
}

func (a *App) WriteTerminal(id string, data string) error {
	session := a.termManager.Get(id)
	if session == nil {
		return fmt.Errorf("terminal session not found")
	}

	payload := []byte(data)
	if decoded, err := base64.StdEncoding.DecodeString(data); err == nil {
		payload = decoded
	}

	legacyBootstrapEnabled := legacyPTYBootstrapEnabled()
	reservedForInput, shouldForceAgentMode := session.TrackAgentLaunchForInput(payload, legacyBootstrapEnabled)

	if err := session.Write(payload); err != nil {
		if reservedForInput {
			session.RollbackAgentGuideInjection()
		}
		return err
	}

	if shouldForceAgentMode {
		session.ForceAgentCLIMode("agent-launch")
	}

	if reservedForInput {
		a.tryInjectAgentGuide(session, id)
	}

	return nil
}

func (a *App) ResizeTerminal(id string, rows, cols int) error {
	session := a.termManager.Get(id)
	if session == nil {
		return fmt.Errorf("terminal session not found")
	}
	return session.Resize(uint16(rows), uint16(cols))
}

func (a *App) CloseTerminal(id string) error {
	return a.termManager.Close(id)
}

func (a *App) CloseAllTerminals() {
	a.termManager.CloseAll()
}

func (a *App) ListTerminalSessions() []string {
	return a.termManager.List()
}

func (a *App) SendTerminalText(id, text string) error {
	session := a.termManager.Get(id)
	if session == nil {
		return fmt.Errorf("terminal session not found")
	}

	return session.Write([]byte(text))
}

func (a *App) tryInjectAgentGuide(session *terminal.Session, sessionID string) {
	projectRoot := a.GetCurrentProjectPath()
	if projectRoot == "" {
		session.RollbackAgentGuideInjection()
		a.logWarning(fmt.Sprintf("[Terminal] agent guide injection skipped for session %s: empty project root", sessionID))
		return
	}

	guidePath, _, ensureErr := terminal.EnsureAgentGuideFile(projectRoot)
	if ensureErr != nil {
		session.RollbackAgentGuideInjection()
		a.logWarning(fmt.Sprintf("[Terminal] agent guide ensure failed for session %s: %v", sessionID, ensureErr))
		return
	}

	contextPath, contextErr := mcp.EnsureAgentContextFile(projectRoot)
	if contextErr != nil {
		session.RollbackAgentGuideInjection()
		a.logWarning(fmt.Sprintf("[Terminal] agent context ensure failed for session %s: %v", sessionID, contextErr))
		return
	}

	bootstrapMessage := terminal.BuildAgentGuideBootstrapMessage(guidePath, contextPath)
	if bootstrapMessage == "" {
		session.RollbackAgentGuideInjection()
		a.logWarning(fmt.Sprintf("[Terminal] agent guide bootstrap is empty for session %s", sessionID))
		return
	}

	if writeErr := session.Write([]byte(bootstrapMessage)); writeErr != nil {
		session.RollbackAgentGuideInjection()
		a.logWarning(fmt.Sprintf("[Terminal] agent guide bootstrap write failed for session %s: %v", sessionID, writeErr))
	}
}

func legacyPTYBootstrapEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("ARLECCHINO_LEGACY_PTY_BOOTSTRAP")))
	switch value {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
