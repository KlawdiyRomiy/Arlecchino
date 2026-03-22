package terminal

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type CarapaceProvider struct {
	mu               sync.RWMutex
	executablesCache map[string]struct{}
	completionCache  map[string]*completionCacheEntry
	historyCache     []string
	historyLoadedAt  time.Time
	available        bool
	carapacePath     string
}

type completionCacheEntry struct {
	completions []CarapaceCompletion
	timestamp   time.Time
}

type CarapaceCompletion struct {
	Value       string `json:"value"`
	Display     string `json:"display"`
	Description string `json:"description"`
	Style       string `json:"style"`
	Tag         string `json:"tag"`
}

const (
	completionCacheTTL  = 30 * time.Second
	completionCacheSize = 100
	carapaceTimeout     = 500 * time.Millisecond
	historyCacheTTL     = 5 * time.Minute
)

var commonCarapacePaths = []string{
	"/opt/homebrew/bin/carapace",
	"/usr/local/bin/carapace",
	"/usr/bin/carapace",
}

var shellBuiltins = []string{
	"cd", "pwd", "echo", "export", "source", ".", "alias", "unalias",
	"pushd", "popd", "dirs", "history", "jobs", "fg", "bg", "disown",
	"read", "eval", "exec", "exit", "return", "shift", "trap",
	"set", "unset", "shopt", "type", "hash", "ulimit", "umask", "wait",
	"true", "false", "test", "[", "[[", "printf", "local", "declare",
	"typeset", "readonly", "let", "getopts", "bind", "builtin", "caller",
	"command", "compgen", "complete", "compopt", "continue", "break",
	"enable", "help", "logout", "mapfile", "readarray", "suspend",
	"times", "coproc", "select", "until", "while", "for", "if", "case",
	"function", "time", "fc", "kill", "whence", "where", "which",
	"autoload", "emulate", "functions", "integer", "float", "setopt",
	"unsetopt", "zstyle", "zmodload", "zle", "bindkey", "vared",
}

var compositeCommands = map[string]string{
	"php artisan":       "artisan",
	"./artisan":         "artisan",
	"python manage.py":  "django-admin",
	"python3 manage.py": "django-admin",
	"./manage.py":       "django-admin",
	"bundle exec rails": "rails",
	"bundle exec rake":  "rake",
	"bundle exec rspec": "rspec",
	"npx":               "",
	"yarn":              "yarn",
	"pnpm":              "pnpm",
}

func NewCarapaceProvider() *CarapaceProvider {
	p := &CarapaceProvider{
		executablesCache: make(map[string]struct{}),
		completionCache:  make(map[string]*completionCacheEntry),
	}

	for _, builtin := range shellBuiltins {
		p.executablesCache[builtin] = struct{}{}
	}

	carapacePath, err := exec.LookPath("carapace")
	if err == nil {
		p.carapacePath = carapacePath
		p.available = true
		go p.refreshExecutablesCache()
		go p.loadShellHistory()
		return p
	}

	for _, path := range commonCarapacePaths {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			p.carapacePath = path
			p.available = true
			break
		}
	}

	home := os.Getenv("HOME")
	if home != "" && !p.available {
		localPath := filepath.Join(home, ".local", "bin", "carapace")
		if info, err := os.Stat(localPath); err == nil && !info.IsDir() {
			p.carapacePath = localPath
			p.available = true
		}
	}

	if p.available {
		go p.refreshExecutablesCache()
	}
	go p.loadShellHistory()

	return p
}

// IsAvailable returns true if carapace-bin is installed
func (p *CarapaceProvider) IsAvailable() bool {
	return p.available
}

// GetCompletions returns completions for a command line
func (p *CarapaceProvider) GetCompletions(input string, workDir string) []CarapaceCompletion {
	if !p.available || input == "" {
		return nil
	}

	// Build cache key
	cacheKey := p.makeCacheKey(input, workDir)

	// Check cache first
	p.mu.RLock()
	if entry, ok := p.completionCache[cacheKey]; ok {
		if time.Since(entry.timestamp) < completionCacheTTL {
			p.mu.RUnlock()
			return entry.completions
		}
	}
	p.mu.RUnlock()

	// Execute carapace
	completions := p.execCarapace(input, workDir)

	// Cache result
	p.mu.Lock()
	// Evict old entries if cache is full
	if len(p.completionCache) >= completionCacheSize {
		p.evictOldestEntry()
	}
	p.completionCache[cacheKey] = &completionCacheEntry{
		completions: completions,
		timestamp:   time.Now(),
	}
	p.mu.Unlock()

	return completions
}

// makeCacheKey creates a cache key optimized for prefix matching
// For "git status --sh" and "git status --sho" we want the same cache entry
func (p *CarapaceProvider) makeCacheKey(input string, workDir string) string {
	parts := strings.Fields(input)
	if len(parts) == 0 {
		return workDir + ":" + input
	}

	// For prefix caching: use command + arg count + prefix of last token
	cmd := parts[0]
	argCount := len(parts) - 1

	// If last token is being typed (no trailing space), use shorter prefix
	lastToken := ""
	if len(parts) > 1 && !strings.HasSuffix(input, " ") {
		last := parts[len(parts)-1]
		// Use first 3 chars of incomplete token for cache key
		if len(last) > 3 {
			lastToken = last[:3]
		} else {
			lastToken = last
		}
		argCount--
	}

	return workDir + ":" + cmd + ":" + string(rune(argCount+'0')) + ":" + lastToken
}

func (p *CarapaceProvider) resolveCompositeCommand(input string) (carapaceCmd string, args []string, originalCmd string) {
	for prefix, cmd := range compositeCommands {
		if strings.HasPrefix(input, prefix+" ") || input == prefix {
			remaining := strings.TrimPrefix(input, prefix)
			remaining = strings.TrimSpace(remaining)
			if cmd == "" {
				parts := strings.Fields(remaining)
				if len(parts) > 0 {
					return parts[0], parts[1:], prefix
				}
				return "", nil, ""
			}
			return cmd, strings.Fields(remaining), prefix
		}
	}

	parts := strings.Fields(input)
	if len(parts) == 0 {
		return "", nil, ""
	}
	return parts[0], parts[1:], parts[0]
}

func (p *CarapaceProvider) execCarapace(input string, workDir string) []CarapaceCompletion {
	ctx, cancel := context.WithTimeout(context.Background(), carapaceTimeout)
	defer cancel()

	carapaceCmd, cmdArgs, _ := p.resolveCompositeCommand(input)
	if carapaceCmd == "" {
		return nil
	}

	if !p.commandExists(carapaceCmd) {
		return nil
	}

	args := []string{carapaceCmd, "export"}
	args = append(args, cmdArgs...)

	if strings.HasSuffix(input, " ") {
		args = append(args, "")
	}

	execCmd := exec.CommandContext(ctx, p.carapacePath, args...)
	if workDir != "" {
		execCmd.Dir = workDir
	}

	var stdout, stderr bytes.Buffer
	execCmd.Stdout = &stdout
	execCmd.Stderr = &stderr

	if err := execCmd.Run(); err != nil {
		return nil
	}

	var response struct {
		Values []CarapaceCompletion `json:"values"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &response); err != nil {
		var completions []CarapaceCompletion
		if err := json.Unmarshal(stdout.Bytes(), &completions); err != nil {
			return nil
		}
		return completions
	}

	return response.Values
}

// commandExists checks if a command exists in PATH
func (p *CarapaceProvider) commandExists(cmd string) bool {
	p.mu.RLock()
	_, exists := p.executablesCache[cmd]
	p.mu.RUnlock()

	if exists {
		return true
	}

	// Fallback to exec.LookPath
	_, err := exec.LookPath(cmd)
	if err == nil {
		p.mu.Lock()
		p.executablesCache[cmd] = struct{}{}
		p.mu.Unlock()
		return true
	}

	return false
}

func (p *CarapaceProvider) GetCommandCompletions(prefix string) []PredictionResult {
	if prefix == "" {
		return nil
	}

	p.mu.RLock()
	defer p.mu.RUnlock()

	lowerPrefix := strings.ToLower(prefix)
	var results []PredictionResult

	for cmd := range p.executablesCache {
		lowerCmd := strings.ToLower(cmd)
		if strings.HasPrefix(lowerCmd, lowerPrefix) && cmd != prefix {
			completion := cmd[len(prefix):]
			if completion != "" {
				results = append(results, PredictionResult{
					Text:       cmd,
					Completion: completion,
					Source:     "command",
					Confidence: 0.85,
				})
			}
		}
	}

	if len(results) > 10 {
		results = results[:10]
	}

	return results
}

func (p *CarapaceProvider) refreshExecutablesCache() {
	pathEnv := os.Getenv("PATH")
	paths := filepath.SplitList(pathEnv)

	fallbackPaths := []string{
		"/bin",
		"/usr/bin",
		"/usr/local/bin",
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
	}
	if home := os.Getenv("HOME"); home != "" {
		fallbackPaths = append(fallbackPaths, filepath.Join(home, "go/bin"))
		fallbackPaths = append(fallbackPaths, filepath.Join(home, ".local/bin"))
	}

	pathSet := make(map[string]struct{})
	for _, p := range paths {
		pathSet[p] = struct{}{}
	}
	for _, p := range fallbackPaths {
		pathSet[p] = struct{}{}
	}

	var allPaths []string
	for p := range pathSet {
		allPaths = append(allPaths, p)
	}

	seen := make(map[string]struct{})

	for _, builtin := range shellBuiltins {
		seen[builtin] = struct{}{}
	}

	for _, dir := range allPaths {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}

			name := entry.Name()
			if _, ok := seen[name]; ok {
				continue
			}

			info, err := entry.Info()
			if err != nil {
				continue
			}

			if info.Mode()&0111 != 0 {
				seen[name] = struct{}{}
			}
		}
	}

	p.mu.Lock()
	p.executablesCache = seen
	p.mu.Unlock()
}

// evictOldestEntry removes the oldest cache entry
func (p *CarapaceProvider) evictOldestEntry() {
	var oldestKey string
	var oldestTime time.Time

	for key, entry := range p.completionCache {
		if oldestKey == "" || entry.timestamp.Before(oldestTime) {
			oldestKey = key
			oldestTime = entry.timestamp
		}
	}

	if oldestKey != "" {
		delete(p.completionCache, oldestKey)
	}
}

// GetPredictions returns predictions formatted for terminal ghost text
func (p *CarapaceProvider) GetPredictions(input string, workDir string) []PredictionResult {
	completions := p.GetCompletions(input, workDir)
	if len(completions) == 0 {
		return nil
	}

	parts := strings.Fields(input)
	if len(parts) == 0 {
		return nil
	}

	results := make([]PredictionResult, 0, len(completions))

	// Determine the last token (what user is typing)
	lastToken := ""
	if len(parts) > 0 && !strings.HasSuffix(input, " ") {
		lastToken = parts[len(parts)-1]
	}

	for _, c := range completions {
		value := c.Value

		// Filter completions that don't match what user is typing
		if lastToken != "" && !strings.HasPrefix(strings.ToLower(value), strings.ToLower(lastToken)) {
			continue
		}

		// Build full command line
		var fullText string
		if strings.HasSuffix(input, " ") {
			fullText = input + value
		} else if len(parts) > 1 {
			// Replace last token with completion
			fullText = strings.Join(parts[:len(parts)-1], " ") + " " + value
		} else {
			fullText = value
		}

		// Calculate completion suffix (what to add after cursor)
		completion := ""
		if strings.HasPrefix(strings.ToLower(value), strings.ToLower(lastToken)) {
			completion = value[len(lastToken):]
		} else if strings.HasSuffix(input, " ") {
			completion = value
		}

		// Add trailing space for non-path completions, "/" for directories
		if c.Style == "carapace.Dir" || strings.HasSuffix(value, "/") {
			if !strings.HasSuffix(completion, "/") {
				completion += "/"
			}
		} else if !strings.HasPrefix(value, "-") && completion != "" {
			completion += " "
		}

		results = append(results, PredictionResult{
			Text:       fullText,
			Completion: completion,
			Source:     "carapace",
			Confidence: 0.95,
		})
	}

	// Limit results
	if len(results) > 10 {
		results = results[:10]
	}

	return results
}

// Preload starts caching completions for common commands
func (p *CarapaceProvider) Preload(commands []string) {
	for _, cmd := range commands {
		go p.GetCompletions(cmd+" ", "")
	}
}

func (p *CarapaceProvider) loadShellHistory() {
	historyPath := p.detectHistoryFile()
	if historyPath == "" {
		return
	}

	file, err := os.Open(historyPath)
	if err != nil {
		return
	}
	defer file.Close()

	seen := make(map[string]struct{})
	var commands []string

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, ": ") {
			if idx := strings.Index(line, ";"); idx > 0 && idx < len(line)-1 {
				line = line[idx+1:]
			}
		}

		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if _, ok := seen[line]; !ok {
			seen[line] = struct{}{}
			commands = append(commands, line)
		}
	}

	if len(commands) > 1000 {
		commands = commands[len(commands)-1000:]
	}

	p.mu.Lock()
	p.historyCache = commands
	p.historyLoadedAt = time.Now()
	p.mu.Unlock()
}

func (p *CarapaceProvider) detectHistoryFile() string {
	if histfile := os.Getenv("HISTFILE"); histfile != "" {
		return histfile
	}

	home := os.Getenv("HOME")
	if home == "" {
		return ""
	}

	zshHistory := filepath.Join(home, ".zsh_history")
	if _, err := os.Stat(zshHistory); err == nil {
		return zshHistory
	}

	bashHistory := filepath.Join(home, ".bash_history")
	if _, err := os.Stat(bashHistory); err == nil {
		return bashHistory
	}

	return ""
}

func (p *CarapaceProvider) GetHistoryCompletions(prefix string, limit int) []PredictionResult {
	p.mu.RLock()
	if time.Since(p.historyLoadedAt) > historyCacheTTL {
		p.mu.RUnlock()
		go p.loadShellHistory()
		p.mu.RLock()
	}
	history := p.historyCache
	p.mu.RUnlock()

	if len(history) == 0 {
		return nil
	}

	prefixLower := strings.ToLower(prefix)
	var results []PredictionResult

	for i := len(history) - 1; i >= 0 && len(results) < limit; i-- {
		cmd := history[i]
		if strings.HasPrefix(strings.ToLower(cmd), prefixLower) && cmd != prefix {
			completion := cmd[len(prefix):]
			results = append(results, PredictionResult{
				Text:       cmd,
				Completion: completion,
				Source:     "history",
				Confidence: 0.7,
			})
		}
	}

	return results
}

func (p *CarapaceProvider) GetHistory(limit int) []string {
	p.mu.RLock()
	if time.Since(p.historyLoadedAt) > historyCacheTTL {
		p.mu.RUnlock()
		go p.loadShellHistory()
		p.mu.RLock()
	}
	history := p.historyCache
	p.mu.RUnlock()

	if len(history) == 0 {
		return nil
	}

	result := make([]string, 0, limit)
	for i := len(history) - 1; i >= 0 && len(result) < limit; i-- {
		result = append(result, history[i])
	}
	return result
}
