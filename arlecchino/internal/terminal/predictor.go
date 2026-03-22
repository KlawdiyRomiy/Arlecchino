package terminal

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"sync"
	"time"
)

// CommandPredictor — главный предиктор команд терминала
type CommandPredictor struct {
	mu           sync.RWMutex
	historyCache *HistoryCache
	safeExecutor *SafeExecutor
	// store будет добавлен позже в Phase 2
}

// PredictionResult — результат предсказания
type PredictionResult struct {
	Text       string  // Полная команда
	Completion string  // Часть для дополнения
	Output     string  // Preview output (для safe commands)
	Source     string  // "history", "plugin", "safe"
	Confidence float64 // 0.0 - 1.0
}

// HistoryEntry — запись в истории команд
type HistoryEntry struct {
	Command    string
	WorkDir    string
	Frequency  int
	LastUsedAt time.Time
}

// SafeCommand — безопасная команда для preview
type SafeCommand struct {
	Name    string
	Args    []string
	Timeout time.Duration
}

// ParsedCommand — распарсенная команда
type ParsedCommand struct {
	Binary       string
	Args         []string
	Flags        map[string]string
	IsPipe       bool
	IsRedirect   bool
	IsIncomplete bool
}

// HistoryCache — кеш истории команд с fuzzy matching
type HistoryCache struct {
	mu      sync.RWMutex
	entries []HistoryEntry
}

// NewHistoryCache создаёт новый кеш истории
func NewHistoryCache() *HistoryCache {
	return &HistoryCache{
		entries: make([]HistoryEntry, 0, 100),
	}
}

// LoadHistory загружает историю из списка команд
func (h *HistoryCache) LoadHistory(commands []HistoryEntry) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.entries = commands
}

// FuzzyMatch ищет команды с fuzzy matching
func (h *HistoryCache) FuzzyMatch(prefix string, limit int) []PredictionResult {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if prefix == "" {
		return h.topCommands(limit)
	}

	matches := make([]matchResult, 0)
	for _, entry := range h.entries {
		if score := h.fuzzyScore(prefix, entry.Command); score > 0 {
			matches = append(matches, matchResult{
				entry: entry,
				score: score,
			})
		}
	}

	h.rankByFrequency(matches)

	results := make([]PredictionResult, 0, limit)
	for i := 0; i < len(matches) && i < limit; i++ {
		entry := matches[i].entry
		results = append(results, PredictionResult{
			Text:       entry.Command,
			Completion: entry.Command[len(prefix):],
			Source:     "history",
			Confidence: h.calculateConfidence(matches[i].score, entry.Frequency),
		})
	}

	return results
}

// topCommands возвращает топ N команд по частоте
func (h *HistoryCache) topCommands(limit int) []PredictionResult {
	sorted := make([]HistoryEntry, len(h.entries))
	copy(sorted, h.entries)

	for i := 0; i < len(sorted)-1; i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].Frequency > sorted[i].Frequency {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	results := make([]PredictionResult, 0, limit)
	for i := 0; i < len(sorted) && i < limit; i++ {
		entry := sorted[i]
		results = append(results, PredictionResult{
			Text:       entry.Command,
			Completion: entry.Command,
			Source:     "history",
			Confidence: float64(entry.Frequency) / 100.0,
		})
	}

	return results
}

// fuzzyScore вычисляет fuzzy matching score
func (h *HistoryCache) fuzzyScore(prefix, command string) int {
	if len(prefix) > len(command) {
		return 0
	}

	prefixLower := toLower(prefix)
	commandLower := toLower(command)

	if hasPrefix(commandLower, prefixLower) {
		return 100
	}

	score := 0
	pi := 0
	for ci := 0; ci < len(commandLower) && pi < len(prefixLower); ci++ {
		if commandLower[ci] == prefixLower[pi] {
			score += 10
			pi++
		}
	}

	if pi == len(prefixLower) {
		return score
	}

	return 0
}

// rankByFrequency сортирует по score, затем по частоте
func (h *HistoryCache) rankByFrequency(matches []matchResult) {
	for i := 0; i < len(matches)-1; i++ {
		for j := i + 1; j < len(matches); j++ {
			if matches[j].score > matches[i].score ||
				(matches[j].score == matches[i].score && matches[j].entry.Frequency > matches[i].entry.Frequency) {
				matches[i], matches[j] = matches[j], matches[i]
			}
		}
	}
}

// calculateConfidence вычисляет уверенность предсказания
func (h *HistoryCache) calculateConfidence(score, frequency int) float64 {
	scorePart := float64(score) / 100.0
	freqPart := float64(frequency) / 100.0
	if freqPart > 1.0 {
		freqPart = 1.0
	}
	return (scorePart*0.7 + freqPart*0.3)
}

type matchResult struct {
	entry HistoryEntry
	score int
}

func toLower(s string) string {
	b := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		b[i] = c
	}
	return string(b)
}

func hasPrefix(s, prefix string) bool {
	if len(prefix) > len(s) {
		return false
	}
	for i := 0; i < len(prefix); i++ {
		if s[i] != prefix[i] {
			return false
		}
	}
	return true
}

// globalCarapaceProvider is a shared carapace provider for completions
var globalCarapaceProvider = NewCarapaceProvider()

// GetStaticPredictions returns predictions using Carapace
// Priority: Carapace > History (handled in terminal_bindings.go)
func GetStaticPredictions(input string) []PredictionResult {
	if input == "" {
		return nil
	}

	// Use Carapace for completions
	return globalCarapaceProvider.GetPredictions(input, "")
}

// SafeExecutor — безопасный исполнитель команд
type SafeExecutor struct {
	mu        sync.RWMutex
	whitelist map[string]bool
}

// NewSafeExecutor создаёт новый безопасный исполнитель
func NewSafeExecutor() *SafeExecutor {
	return &SafeExecutor{
		whitelist: map[string]bool{
			"pwd":      true,
			"ls":       true,
			"git":      true,
			"go":       true,
			"npm":      true,
			"node":     true,
			"php":      true,
			"python":   true,
			"ruby":     true,
			"cargo":    true,
			"composer": true,
			"artisan":  true,
			"which":    true,
			"where":    true,
			"uname":    true,
			"hostname": true,
			"whoami":   true,
			"date":     true,
			"tree":     true,
			"cat":      true,
			"head":     true,
			"tail":     true,
			"grep":     true,
			"find":     true,
			"wc":       true,
			"echo":     true,
			"env":      true,
			"printenv": true,
			"dirname":  true,
			"basename": true,
			"realpath": true,
			"readlink": true,
			"stat":     true,
			"file":     true,
			"type":     true,
			"command":  true,
			"whereis":  true,
		},
	}
}

// IsSafe проверяет безопасность команды
func (s *SafeExecutor) IsSafe(cmd *ParsedCommand) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if cmd == nil || cmd.Binary == "" {
		return false
	}

	if !s.whitelist[cmd.Binary] {
		return false
	}

	simpleCommands := map[string]bool{
		"pwd": true, "ls": true, "whoami": true, "date": true,
		"hostname": true, "uname": true, "which": true, "where": true,
		"dirname": true, "basename": true, "realpath": true,
		"env": true, "printenv": true, "echo": true,
	}
	if simpleCommands[cmd.Binary] {
		return true
	}

	if cmd.Binary == "git" {
		if len(cmd.Args) == 0 {
			return false
		}
		safeGitCommands := map[string]bool{
			"status": true, "branch": true, "log": true, "diff": true,
			"show": true, "ls-files": true, "ls-tree": true, "rev-parse": true,
			"describe": true, "tag": true, "remote": true, "config": true,
		}
		return safeGitCommands[cmd.Args[0]]
	}

	if cmd.Binary == "go" {
		if len(cmd.Args) == 0 {
			return false
		}
		safeGoCommands := map[string]bool{
			"list": true, "version": true, "env": true, "mod": true,
		}
		return safeGoCommands[cmd.Args[0]]
	}

	if cmd.Binary == "npm" || cmd.Binary == "node" {
		if len(cmd.Args) == 0 {
			return true
		}
		unsafeNpmCommands := map[string]bool{
			"install": true, "uninstall": true, "publish": true,
			"unpublish": true, "link": true, "unlink": true,
		}
		return !unsafeNpmCommands[cmd.Args[0]]
	}

	if cmd.Binary == "php" {
		if len(cmd.Args) > 0 && cmd.Args[0] == "artisan" {
			if len(cmd.Args) < 2 {
				return true
			}
			unsafeArtisan := map[string]bool{
				"migrate": true, "db:seed": true, "cache:clear": true,
				"config:cache": true, "route:cache": true, "view:cache": true,
			}
			return !unsafeArtisan[cmd.Args[1]]
		}
		return false
	}

	return false
}

type ExecutionResult struct {
	Output    string
	Error     string
	ExitCode  int
	Duration  time.Duration
	Truncated bool
}

func (s *SafeExecutor) Execute(cmd *ParsedCommand, workDir string, timeout time.Duration) (*ExecutionResult, error) {
	if !s.IsSafe(cmd) {
		return nil, fmt.Errorf("command not in whitelist: %s", cmd.Binary)
	}

	if timeout == 0 {
		timeout = 500 * time.Millisecond
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	execCmd := exec.CommandContext(ctx, cmd.Binary, cmd.Args...)
	execCmd.Dir = workDir

	var stdout, stderr bytes.Buffer
	execCmd.Stdout = &stdout
	execCmd.Stderr = &stderr

	start := time.Now()
	err := execCmd.Run()
	duration := time.Since(start)

	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return nil, fmt.Errorf("execution failed: %w", err)
		}
	}

	const maxOutput = 10 * 1024
	output := stdout.String()
	errOutput := stderr.String()
	truncated := false

	if len(output) > maxOutput {
		output = output[:maxOutput]
		truncated = true
	}
	if len(errOutput) > maxOutput {
		errOutput = errOutput[:maxOutput]
		truncated = true
	}

	return &ExecutionResult{
		Output:    output,
		Error:     errOutput,
		ExitCode:  exitCode,
		Duration:  duration,
		Truncated: truncated,
	}, nil
}
