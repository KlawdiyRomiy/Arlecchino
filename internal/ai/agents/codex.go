package agents

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/creack/pty"
)

const (
	codexAdapterID       = "agent-cli-codex"
	codexAdapterKind     = "codex_cli"
	codexDefaultModelID  = "codex-cli-default"
	codexTranscriptLimit = 64 * 1024
)

var secretLikeTerminalPattern = regexp.MustCompile(`(?i)(bearer\s+|api[_-]?key\s*[:=]\s*["']?|token\s*[:=]\s*["']?|secret\s*[:=]\s*["']?|password\s*[:=]\s*["']?)[A-Za-z0-9._\-+/=]{8,}["']?`)
var emailLikeTerminalPattern = regexp.MustCompile(`(?i)[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}`)

type CodexAdapter struct {
	binary   string
	mu       sync.Mutex
	cached   Descriptor
	cachedAt time.Time
}

type codexOutputObserver struct {
	seen map[string]bool
}

func NewCodexAdapter() *CodexAdapter {
	return &CodexAdapter{binary: strings.TrimSpace(os.Getenv("ARLECCHINO_CODEX_CLI_BINARY"))}
}

func (a *CodexAdapter) ID() string {
	return codexAdapterID
}

func (a *CodexAdapter) Descriptor(ctx context.Context) Descriptor {
	a.mu.Lock()
	if !a.cachedAt.IsZero() && time.Since(a.cachedAt) < 10*time.Second {
		cached := a.cached
		a.mu.Unlock()
		return cached
	}
	a.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	descriptor := Descriptor{
		ID:            codexAdapterID,
		Name:          "Codex CLI",
		Kind:          codexAdapterKind,
		Binary:        "codex",
		EndpointClass: EndpointClassExternalAccount,
		AuthMode:      providers.ProviderAuthModeOAuth,
		AuthStatus:    "unknown",
		BillingMode:   "provider_account",
		LegalBasis:    "official_cli_user_installed",
		RiskTier:      "external_account_cli",
		Capabilities: []providers.AIProviderCapability{
			providers.CapabilityChat,
			providers.CapabilityPatchGeneration,
			providers.CapabilityStructuredOutput,
		},
		SupportedActions: []string{"ask", "plan", "build", "debug", "review"},
		Models: []providers.AIModelDescriptor{
			{
				ID:              codexDefaultModelID,
				DisplayName:     "Codex CLI default",
				Streaming:       true,
				PatchGeneration: true,
			},
		},
		DefaultModel:  codexDefaultModelID,
		Status:        providers.ProviderStatusError,
		Reason:        "Codex CLI was not checked.",
		SourceLinks:   []string{"https://developers.openai.com/codex/cli", "https://developers.openai.com/codex/cli/features"},
		LastCheckedAt: now,
	}
	binary, err := a.binaryPath()
	if err != nil {
		descriptor.Status = providers.ProviderStatusError
		descriptor.Reason = "Codex CLI binary was not found on PATH."
		return a.cacheDescriptor(descriptor)
	}
	descriptor.Binary = binary
	version, versionErr := runShortCommand(ctx, binary, "--version")
	if versionErr != nil {
		descriptor.Status = providers.ProviderStatusError
		descriptor.Reason = "Codex CLI version check failed."
		return a.cacheDescriptor(descriptor)
	}
	if strings.TrimSpace(version) != "" {
		descriptor.Reason = sanitizeCLIStatusLine(version)
	}
	auth, authErr := runShortCommand(ctx, binary, "login", "status")
	if authErr != nil {
		descriptor.Status = providers.ProviderStatusNeedsAuth
		descriptor.AuthStatus = "needs_auth"
		descriptor.Reason = "Sign in with the official Codex CLI flow."
		return a.cacheDescriptor(descriptor)
	}
	descriptor.Status = providers.ProviderStatusReady
	descriptor.AuthStatus = "ready"
	if auth = sanitizeCLIStatusLine(auth); auth != "" {
		descriptor.Reason = auth
	}
	return a.cacheDescriptor(descriptor)
}

func (a *CodexAdapter) cacheDescriptor(descriptor Descriptor) Descriptor {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cached = descriptor
	a.cachedAt = time.Now()
	return descriptor
}

func (a *CodexAdapter) Invalidate() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.cached = Descriptor{}
	a.cachedAt = time.Time{}
}

func (a *CodexAdapter) Run(ctx context.Context, req RunRequest, emit func(Event)) Result {
	startedAt := time.Now().UTC().Format(time.RFC3339)
	binary, err := a.binaryPath()
	if err != nil {
		return UnsupportedResult(err.Error())
	}
	if strings.TrimSpace(req.ProjectRoot) == "" {
		return UnsupportedResult("project root is required")
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return UnsupportedResult("agent prompt is empty")
	}
	rows := req.Rows
	if rows == 0 {
		rows = 30
	}
	cols := req.Cols
	if cols == 0 {
		cols = 110
	}
	args := []string{
		"--no-alt-screen",
		"-C", req.ProjectRoot,
		"-s", "workspace-write",
		"-a", "on-request",
	}
	if model := strings.TrimSpace(req.Model); model != "" && model != codexDefaultModelID {
		args = append(args, "-m", model)
	}
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = req.ProjectRoot
	cmd.Env = codexProcessEnv(
		"ARLECCHINO_EXTERNAL_AGENT_RUN_ID=" + req.RunID,
	)

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	defer ptmx.Close()

	if req.RegisterInput != nil {
		req.RegisterInput(req.RunID, func(data []byte) error {
			_, writeErr := ptmx.Write(data)
			return writeErr
		}, func(nextRows uint16, nextCols uint16) error {
			if nextRows == 0 || nextCols == 0 {
				return nil
			}
			return pty.Setsize(ptmx, &pty.Winsize{Rows: nextRows, Cols: nextCols})
		})
		defer req.RegisterInput(req.RunID, nil, nil)
	}

	emit(NewEvent(req.RunID, EventStatus, "started", "Agent CLI process started.", nil))
	go func() {
		timer := time.NewTimer(450 * time.Millisecond)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			_, _ = ptmx.Write([]byte(req.Prompt + "\n"))
		}
	}()

	var transcript transcriptBuffer
	observer := newCodexOutputObserver()
	var readDone sync.WaitGroup
	readDone.Add(1)
	go func() {
		defer readDone.Done()
		buffer := make([]byte, 4096)
		for {
			n, readErr := ptmx.Read(buffer)
			if n > 0 {
				chunk := redactTerminalChunk(buffer[:n])
				transcript.Write(chunk)
				emit(NewEvent(req.RunID, EventTerminalData, "stream", "", chunk))
				observer.Observe(req.RunID, transcript.String(), emit)
			}
			if readErr != nil {
				if !errors.Is(readErr, io.EOF) {
					emit(NewEvent(req.RunID, EventStatus, "stream_closed", sanitizeCLIStatusLine(readErr.Error()), nil))
				}
				return
			}
		}
	}()

	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()

	var waitErr error
	select {
	case <-ctx.Done():
		terminateProcessGroup(cmd.Process)
		waitErr = <-waitCh
	case waitErr = <-waitCh:
	}
	_ = ptmx.Close()
	readDone.Wait()

	exitCode := 0
	if waitErr != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339)
	if ctx.Err() != nil {
		return Result{
			Status:     "canceled",
			Message:    "Agent CLI run was canceled.",
			ExitCode:   exitCode,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	if waitErr != nil {
		return Result{
			Status:     "error",
			Message:    "Agent CLI run failed.",
			Error:      FormatExitError(exitCode, transcript.String()),
			ExitCode:   exitCode,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	return Result{
		Status:     "completed",
		Message:    "Agent CLI run completed.",
		ExitCode:   exitCode,
		Transcript: transcript.String(),
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}
}

func (a *CodexAdapter) RunAuth(ctx context.Context, req AuthRequest, emit func(Event)) Result {
	startedAt := time.Now().UTC().Format(time.RFC3339)
	binary, err := a.binaryPath()
	if err != nil {
		return UnsupportedResult(err.Error())
	}
	rows := req.Rows
	if rows == 0 {
		rows = 30
	}
	cols := req.Cols
	if cols == 0 {
		cols = 110
	}
	workdir := strings.TrimSpace(req.ProjectRoot)
	if workdir == "" {
		if home, homeErr := os.UserHomeDir(); homeErr == nil {
			workdir = home
		}
	}
	cmd := exec.CommandContext(ctx, binary, "login")
	if workdir != "" {
		cmd.Dir = workdir
	}
	cmd.Env = codexProcessEnv(
		"ARLECCHINO_EXTERNAL_AGENT_AUTH_RUN_ID=" + req.RunID,
	)

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return Result{Status: "error", Error: err.Error(), ExitCode: -1, StartedAt: startedAt, FinishedAt: time.Now().UTC().Format(time.RFC3339)}
	}
	defer ptmx.Close()

	if req.RegisterInput != nil {
		req.RegisterInput(req.RunID, func(data []byte) error {
			_, writeErr := ptmx.Write(data)
			return writeErr
		}, func(nextRows uint16, nextCols uint16) error {
			if nextRows == 0 || nextCols == 0 {
				return nil
			}
			return pty.Setsize(ptmx, &pty.Winsize{Rows: nextRows, Cols: nextCols})
		})
		defer req.RegisterInput(req.RunID, nil, nil)
	}

	emit(NewEvent(req.RunID, EventStatus, "auth_started", "Agent CLI authentication process started.", nil))
	var transcript transcriptBuffer
	observer := newCodexOutputObserver()
	var readDone sync.WaitGroup
	readDone.Add(1)
	go func() {
		defer readDone.Done()
		buffer := make([]byte, 4096)
		for {
			n, readErr := ptmx.Read(buffer)
			if n > 0 {
				chunk := redactTerminalChunk(buffer[:n])
				transcript.Write(chunk)
				emit(NewEvent(req.RunID, EventTerminalData, "stream", "", chunk))
				observer.Observe(req.RunID, transcript.String(), emit)
			}
			if readErr != nil {
				if !errors.Is(readErr, io.EOF) {
					emit(NewEvent(req.RunID, EventStatus, "stream_closed", sanitizeCLIStatusLine(readErr.Error()), nil))
				}
				return
			}
		}
	}()

	waitCh := make(chan error, 1)
	go func() {
		waitCh <- cmd.Wait()
	}()

	var waitErr error
	select {
	case <-ctx.Done():
		terminateProcessGroup(cmd.Process)
		waitErr = <-waitCh
	case waitErr = <-waitCh:
	}
	_ = ptmx.Close()
	readDone.Wait()

	exitCode := 0
	if waitErr != nil {
		exitCode = -1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	finishedAt := time.Now().UTC().Format(time.RFC3339)
	if ctx.Err() != nil {
		return Result{
			Status:     "canceled",
			Message:    "Agent CLI authentication was canceled.",
			ExitCode:   exitCode,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	if waitErr != nil {
		return Result{
			Status:     "error",
			Message:    "Agent CLI authentication failed.",
			Error:      FormatExitError(exitCode, transcript.String()),
			ExitCode:   exitCode,
			Transcript: transcript.String(),
			StartedAt:  startedAt,
			FinishedAt: finishedAt,
		}
	}
	a.Invalidate()
	return Result{
		Status:     "completed",
		Message:    "Agent CLI authentication completed.",
		ExitCode:   exitCode,
		Transcript: transcript.String(),
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}
}

func codexProcessEnv(extra ...string) []string {
	env := append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"NO_UPDATE_NOTIFIER=1",
		"GIT_TERMINAL_PROMPT=0",
		"GH_PROMPT_DISABLED=1",
		"ARLECCHINO_EXTERNAL_AGENT_UI=gui",
		"ARLECCHINO_EXTERNAL_AGENT_TRANSPORT=hidden_pty",
	)
	return append(env, extra...)
}

func newCodexOutputObserver() *codexOutputObserver {
	return &codexOutputObserver{seen: map[string]bool{}}
}

func (o *codexOutputObserver) Observe(runID string, transcript string, emit func(Event)) {
	if o == nil || emit == nil {
		return
	}
	text := normalizeCodexTerminalText(transcript)
	if text == "" {
		return
	}
	if strings.Contains(text, "Do you trust the contents of this directory?") {
		path := extractCodexPromptValue(text, `(?m)^\s*>?\s*You are in\s+(.+)$`)
		message := "Codex is asking whether to trust this project directory before loading project-local config, hooks, and exec policies."
		if path != "" {
			message += " Directory: " + path
		}
		o.emitOnce(runID, "trust_project_prompt", message, emit)
	}
	if strings.Contains(text, "Codex just got an upgrade") || strings.Contains(text, "Update now (runs") {
		o.emitOnce(runID, "update_prompt", "Codex CLI is showing an update prompt. The current run needs a GUI decision before continuing.", emit)
	}
	if strings.Contains(text, "MCP server is not logged in") || strings.Contains(text, "MCP startup incomplete") {
		o.emitOnce(runID, "mcp_notice", "Codex reported MCP startup or account notices. Arlecchino keeps them as runtime notices, not chat output.", emit)
	}
	if strings.Contains(text, "needs your approval") || strings.Contains(text, "Approval requested") || strings.Contains(text, "requires approval by policy") {
		o.emitOnce(runID, "approval_prompt", "Codex is asking for an approval through the provider CLI.", emit)
	}
	if strings.Contains(text, "Your session has expired") || strings.Contains(text, "Please reauthenticate") {
		o.emitOnce(runID, "auth_required", "Codex reports that the provider account needs authentication.", emit)
	}
}

func (o *codexOutputObserver) emitOnce(runID string, status string, text string, emit func(Event)) {
	if o.seen[status] {
		return
	}
	o.seen[status] = true
	emit(NewEvent(runID, EventStatus, status, sanitizeCLIStatusLine(text), nil))
}

func normalizeCodexTerminalText(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	return strings.TrimSpace(value)
}

func extractCodexPromptValue(text string, pattern string) string {
	matches := regexp.MustCompile(pattern).FindStringSubmatch(text)
	if len(matches) < 2 {
		return ""
	}
	return strings.TrimSpace(matches[1])
}

func (a *CodexAdapter) binaryPath() (string, error) {
	if strings.TrimSpace(a.binary) != "" {
		return a.binary, nil
	}
	path, err := exec.LookPath("codex")
	if err != nil {
		return "", err
	}
	return path, nil
}

func runShortCommand(parent context.Context, binary string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil && cmd.Process != nil {
		terminateProcessGroup(cmd.Process)
	}
	if err != nil {
		return string(output), err
	}
	return string(output), nil
}

func terminateProcessGroup(process *os.Process) {
	if process == nil {
		return
	}
	pid := process.Pid
	if pid <= 0 {
		_ = process.Kill()
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	timer := time.NewTimer(1500 * time.Millisecond)
	defer timer.Stop()
	<-timer.C
	_ = syscall.Kill(-pid, syscall.SIGKILL)
}

func redactTerminalChunk(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	redacted := secretLikeTerminalPattern.ReplaceAll(data, []byte("${1}<redacted>"))
	redacted = emailLikeTerminalPattern.ReplaceAll(redacted, []byte("<account>"))
	return append([]byte(nil), redacted...)
}

func sanitizeCLIStatusLine(value string) string {
	value = string(redactTerminalChunk([]byte(value)))
	value = strings.ReplaceAll(value, "\r\n", "\n")
	lines := strings.Split(value, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(line, "@") {
			line = "CLI account status detected."
		}
		kept = append(kept, line)
		if len(kept) >= 2 {
			break
		}
	}
	return strings.Join(kept, " ")
}

type transcriptBuffer struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *transcriptBuffer) Write(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buffer.Len()+len(chunk) > codexTranscriptLimit {
		excess := b.buffer.Len() + len(chunk) - codexTranscriptLimit
		current := b.buffer.Bytes()
		if excess < len(current) {
			next := append([]byte(nil), current[excess:]...)
			b.buffer.Reset()
			_, _ = b.buffer.Write(next)
		} else {
			b.buffer.Reset()
		}
	}
	_, _ = b.buffer.Write(chunk)
}

func (b *transcriptBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return strings.TrimSpace(b.buffer.String())
}
