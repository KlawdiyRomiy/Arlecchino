package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

const maxPendingOutputChunks = 256
const previewCandidateTTL = time.Minute

type Session struct {
	ID                    string
	Name                  string
	cmd                   *exec.Cmd
	pty                   *os.File
	ctx                   context.Context
	cancel                context.CancelFunc
	mu                    sync.Mutex
	onData                func(data []byte)
	pendingOutput         [][]byte
	onExit                func(code int)
	onMode                func(event TUIModeEvent)
	onShell               func(event ShellEvent)
	onSemantic            func(event SemanticEvent)
	mode                  *TUIModeDetector
	semanticParser        *semanticParser
	workingDir            string
	agentInputBuffer      string
	agentGuideInjected    bool
	previewCandidateUntil time.Time
}

type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	shell    string
}

func NewManager() *Manager {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}
	return &Manager{
		sessions: make(map[string]*Session),
		shell:    shell,
	}
}

func (m *Manager) Create(id, name, workingDir string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.sessions[id]; exists {
		return nil, fmt.Errorf("session %s already exists", id)
	}

	ctx, cancel := context.WithCancel(context.Background())

	cmd := exec.CommandContext(ctx, m.shell, "-l")
	cmd.Dir = workingDir
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start pty: %w", err)
	}

	session := &Session{
		ID:             id,
		Name:           name,
		cmd:            cmd,
		pty:            ptmx,
		ctx:            ctx,
		cancel:         cancel,
		semanticParser: newSemanticParser(),
		workingDir:     workingDir,
	}

	session.mode = NewTUIModeDetector(func(event TUIModeEvent) {
		session.resetAgentGuideInjection(event)
		if session.onMode != nil {
			session.onMode(event)
		}
	})

	m.sessions[id] = session

	go session.readLoop()
	go session.waitForExit()

	return session, nil
}

func (s *Session) readLoop() {
	buf := make([]byte, 4096)
	for {
		select {
		case <-s.ctx.Done():
			return
		default:
			n, err := s.pty.Read(buf)
			if err != nil {
				if err != io.EOF {
					fmt.Printf("pty read error: %v\n", err)
				}
				return
			}
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				if s.mode != nil {
					s.mode.Consume(data)
				}
				if s.semanticParser != nil {
					shellEvents, semanticEvents := s.semanticParser.Consume(data)
					for _, event := range shellEvents {
						s.emitShellEvent(event)
					}
					for _, event := range semanticEvents {
						filteredEvent, ok := s.filterSemanticEvent(event, time.Now())
						if !ok {
							continue
						}
						s.emitSemanticEvent(filteredEvent)
					}
				}
				s.handleOutputChunk(data)
			}
		}
	}
}

func (s *Session) waitForExit() {
	err := s.cmd.Wait()
	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		}
	}
	if s.onExit != nil {
		s.onExit(code)
	}
}

func (s *Session) Write(data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.pty.Write(data)
	return err
}

func (s *Session) Resize(rows, cols uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return pty.Setsize(s.pty, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

func (s *Session) SetOnData(fn func(data []byte)) {
	s.mu.Lock()
	if fn == nil {
		s.onData = nil
		s.pendingOutput = nil
		s.mu.Unlock()
		return
	}

	s.onData = nil
	pendingOutput := s.pendingOutput
	s.pendingOutput = nil
	s.mu.Unlock()

	for {
		for _, chunk := range pendingOutput {
			fn(chunk)
		}

		s.mu.Lock()
		if len(s.pendingOutput) == 0 {
			s.onData = fn
			s.mu.Unlock()
			return
		}

		pendingOutput = s.pendingOutput
		s.pendingOutput = nil
		s.mu.Unlock()
	}
}

func (s *Session) handleOutputChunk(data []byte) {
	if s.ctx != nil {
		select {
		case <-s.ctx.Done():
			return
		default:
		}
	}

	s.mu.Lock()
	onData := s.onData
	if onData == nil {
		bufferedData := make([]byte, len(data))
		copy(bufferedData, data)

		if len(s.pendingOutput) >= maxPendingOutputChunks {
			s.pendingOutput = append(s.pendingOutput[1:], bufferedData)
		} else {
			s.pendingOutput = append(s.pendingOutput, bufferedData)
		}

		s.mu.Unlock()
		return
	}
	s.mu.Unlock()

	onData(data)
}

func (s *Session) SetOnExit(fn func(code int)) {
	s.onExit = fn
}

func (s *Session) SetOnMode(fn func(event TUIModeEvent)) {
	s.onMode = fn
}

func (s *Session) SetOnShell(fn func(event ShellEvent)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onShell = fn
}

func (s *Session) SetOnSemantic(fn func(event SemanticEvent)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onSemantic = fn
}

func (s *Session) emitShellEvent(event ShellEvent) {
	s.mu.Lock()
	onShell := s.onShell
	s.mu.Unlock()

	if onShell != nil {
		onShell(event)
	}
}

func (s *Session) emitSemanticEvent(event SemanticEvent) {
	s.mu.Lock()
	onSemantic := s.onSemantic
	s.mu.Unlock()

	if onSemantic != nil {
		onSemantic(event)
	}
}

func (s *Session) ReserveAgentGuideInjection(event TUIModeEvent) bool {
	return s.reserveAgentGuideInjection(event)
}

func (s *Session) ReserveAgentGuideInjectionForInput(data []byte) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	shouldReserve, _ := s.trackAgentLaunchForInputLocked(data, true)
	return shouldReserve
}

func (s *Session) TrackAgentLaunchForInput(data []byte, reserveGuideInjection bool) (bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.trackAgentLaunchForInputLocked(data, reserveGuideInjection)
}

func (s *Session) trackAgentLaunchForInputLocked(data []byte, reserveGuideInjection bool) (bool, bool) {
	shouldReserve := false
	shouldActivateTUI := false

	for _, b := range data {
		switch b {
		case '\r', '\n':
			commandLine := s.agentInputBuffer

			if IsAgentLaunchCommand(commandLine) {
				shouldActivateTUI = true
			}
			if IsPreviewCandidateCommand(commandLine) {
				s.previewCandidateUntil = time.Now().Add(previewCandidateTTL)
			}

			if reserveGuideInjection && shouldInjectAgentGuideForCommand(commandLine, s.agentGuideInjected) {
				s.agentGuideInjected = true
				shouldReserve = true
			}
			s.agentInputBuffer = ""
		case 0x7f, 0x08:
			if len(s.agentInputBuffer) > 0 {
				s.agentInputBuffer = s.agentInputBuffer[:len(s.agentInputBuffer)-1]
			}
		default:
			if b >= 0x20 && b != 0x7f {
				s.agentInputBuffer += string(b)
			}
		}
	}

	return shouldReserve, shouldActivateTUI
}

func (s *Session) ForceTUIMode(reason string) {
	s.mu.Lock()
	modeDetector := s.mode
	s.mu.Unlock()

	if modeDetector == nil {
		return
	}

	modeDetector.Force(TUIModeEvent{
		Mode:          TerminalModeAgentTUI,
		Active:        true,
		Reason:        reason,
		Confidence:    0.92,
		SourceSignals: []string{"forced:agent_tui"},
	})
}

func (s *Session) ForceAgentCLIMode(reason string) {
	s.mu.Lock()
	modeDetector := s.mode
	s.mu.Unlock()

	if modeDetector == nil {
		return
	}

	modeDetector.Force(TUIModeEvent{
		Mode:          TerminalModeAgentCLI,
		Active:        true,
		Reason:        reason,
		Confidence:    0.72,
		SourceSignals: []string{"input:agent-launch"},
	})
}

func (s *Session) RollbackAgentGuideInjection() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentGuideInjected = false
}

func (s *Session) reserveAgentGuideInjection(event TUIModeEvent) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !shouldInjectAgentGuide(event, s.agentGuideInjected) {
		return false
	}

	s.agentGuideInjected = true
	return true
}

func (s *Session) resetAgentGuideInjection(event TUIModeEvent) {
	if !shouldResetAgentGuideInjection(event) {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentInputBuffer = ""
	s.agentGuideInjected = false
	s.previewCandidateUntil = time.Time{}
}

func (s *Session) filterSemanticEvent(event SemanticEvent, now time.Time) (SemanticEvent, bool) {
	if event.Kind != "preview_url" {
		return event, true
	}
	if event.source == semanticSourceOSC {
		return event, true
	}
	if s.hasActivePreviewCandidate(now) {
		return event, true
	}
	return SemanticEvent{}, false
}

func (s *Session) hasActivePreviewCandidate(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.previewCandidateUntil.IsZero() && !now.After(s.previewCandidateUntil)
}

func (s *Session) Close() error {
	s.cancel()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pty != nil {
		s.pty.Close()
	}
	if s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
	return nil
}

func (m *Manager) Get(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[id]
}

func (m *Manager) Close(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, exists := m.sessions[id]
	if !exists {
		return fmt.Errorf("session %s not found", id)
	}

	err := session.Close()
	delete(m.sessions, id)
	return err
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, session := range m.sessions {
		session.Close()
		delete(m.sessions, id)
	}
}

func (m *Manager) List() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	return ids
}
