package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"time"
)

const (
	gitFieldSeparator  = "\x00"
	gitRecordSeparator = "\x1e"
)

var gitAllowedSubcommands = map[string]struct{}{
	"add":          {},
	"blame":        {},
	"branch":       {},
	"checkout":     {},
	"commit":       {},
	"diff":         {},
	"fetch":        {},
	"log":          {},
	"pull":         {},
	"push":         {},
	"remote":       {},
	"reset":        {},
	"show":         {},
	"stash":        {},
	"status":       {},
	"symbolic-ref": {},
}

var (
	trashProjectEntry  = moveProjectEntryToTrash
	revealProjectEntry = revealProjectEntryInFileManager
)

func gitCommandTimeout(args []string) time.Duration {
	if len(args) == 0 {
		return 10 * time.Second
	}

	switch args[0] {
	case "fetch", "pull", "push":
		return 90 * time.Second
	case "blame", "log", "show", "diff":
		return 20 * time.Second
	default:
		return 15 * time.Second
	}
}

type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

type ProjectEntryRenameResult struct {
	NewPath     string `json:"newPath"`
	IsDirectory bool   `json:"isDirectory"`
}

type projectEntryRenamedEvent struct {
	OldPath     string `json:"oldPath"`
	NewPath     string `json:"newPath"`
	IsDirectory bool   `json:"isDirectory"`
}

type projectEntryDeletedEvent struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

func (a *App) ReadDirectory(dirPath string) ([]FileEntry, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}

	result := make([]FileEntry, 0, len(entries))
	for _, entry := range entries {
		fullPath := filepath.Join(dirPath, entry.Name())
		result = append(result, FileEntry{
			Name:        entry.Name(),
			Path:        fullPath,
			IsDirectory: entry.IsDir(),
		})
	}

	return result, nil
}

func (a *App) ReadFile(filePath string) (string, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func (a *App) WriteFile(filePath string, content string) error {
	_, statErr := os.Stat(filePath)
	created := os.IsNotExist(statErr)
	if statErr != nil && !created {
		return statErr
	}

	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return err
	}

	eventName := "file:changed"
	if created {
		eventName = "file:created"
	}
	a.emitEvent(eventName, filePath)

	return nil
}

func (a *App) CreateDirectory(dirPath string) error {
	dirPath, err := normalizeRequiredPath(dirPath, "directory path")
	if err != nil {
		return err
	}

	if _, err := os.Stat(dirPath); err == nil {
		return fmt.Errorf("directory already exists: %s", dirPath)
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		return err
	}

	a.emitEvent("project:entry:created", projectEntryCreatedEvent{
		Path:        dirPath,
		IsDirectory: true,
	})

	return nil
}

func (a *App) RenameProjectEntry(path string, newName string) (ProjectEntryRenameResult, error) {
	entryPath, projectPath, err := a.resolveProjectEntryPath(path)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}

	info, err := os.Stat(entryPath)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}

	sanitizedName, err := sanitizeProjectEntryName(newName)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}

	targetPath := filepath.Clean(filepath.Join(filepath.Dir(entryPath), sanitizedName))
	if targetPath != entryPath {
		if err := ensurePathWithinProject(projectPath, targetPath); err != nil {
			return ProjectEntryRenameResult{}, err
		}
		if _, err := os.Stat(targetPath); err == nil {
			return ProjectEntryRenameResult{}, fmt.Errorf("entry already exists: %s", targetPath)
		} else if !os.IsNotExist(err) {
			return ProjectEntryRenameResult{}, err
		}
	}

	if err := os.Rename(entryPath, targetPath); err != nil {
		return ProjectEntryRenameResult{}, fmt.Errorf("rename project entry: %w", err)
	}

	result := ProjectEntryRenameResult{
		NewPath:     targetPath,
		IsDirectory: info.IsDir(),
	}
	a.emitEvent("project:entry:renamed", projectEntryRenamedEvent{
		OldPath:     entryPath,
		NewPath:     targetPath,
		IsDirectory: info.IsDir(),
	})
	return result, nil
}

func (a *App) TrashProjectEntry(path string) error {
	entryPath, _, err := a.resolveProjectEntryPath(path)
	if err != nil {
		return err
	}

	info, err := os.Stat(entryPath)
	if err != nil {
		return err
	}

	if err := trashProjectEntry(entryPath, info.IsDir()); err != nil {
		return err
	}

	a.emitEvent("project:entry:deleted", projectEntryDeletedEvent{
		Path:        entryPath,
		IsDirectory: info.IsDir(),
	})
	return nil
}

func (a *App) RevealProjectEntry(path string) error {
	entryPath, _, err := a.resolveProjectEntryPath(path)
	if err != nil {
		return err
	}

	return revealProjectEntry(entryPath)
}

func normalizeRequiredPath(rawPath string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", fmt.Errorf("%s is required", fieldName)
	}

	absolutePath, err := filepath.Abs(trimmed)
	if err != nil {
		return "", err
	}

	return filepath.Clean(absolutePath), nil
}

func sanitizeProjectEntryName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("new name is required")
	}
	if trimmed == "." || trimmed == ".." {
		return "", fmt.Errorf("new name is invalid: %s", trimmed)
	}
	if strings.ContainsRune(trimmed, '/') || strings.ContainsRune(trimmed, '\\') {
		return "", fmt.Errorf("new name must not contain path separators")
	}

	return trimmed, nil
}

func ensurePathWithinProject(projectPath string, entryPath string) error {
	cleanProject := filepath.Clean(projectPath)
	cleanEntry := filepath.Clean(entryPath)
	if cleanProject == "" || cleanProject == "." {
		return fmt.Errorf("project path is required")
	}
	if cleanEntry == cleanProject {
		return nil
	}

	prefix := cleanProject + string(os.PathSeparator)
	if strings.HasPrefix(cleanEntry, prefix) {
		return nil
	}

	return fmt.Errorf("path is outside current project: %s", cleanEntry)
}

func (a *App) resolveProjectEntryPath(path string) (entryPath string, projectPath string, err error) {
	entryPath, err = normalizeRequiredPath(path, "path")
	if err != nil {
		return "", "", err
	}

	projectPath, err = normalizeRequiredPath(a.currentProjectPath(), "project path")
	if err != nil {
		return "", "", fmt.Errorf("no project opened")
	}

	if err := ensurePathWithinProject(projectPath, entryPath); err != nil {
		return "", "", err
	}

	return entryPath, projectPath, nil
}

func moveProjectEntryToTrash(path string, isDirectory bool) error {
	switch goruntime.GOOS {
	case "darwin":
		script := fmt.Sprintf(`tell application "Finder" to delete POSIX file %q`, path)
		output, err := exec.Command("osascript", "-e", script).CombinedOutput()
		if err != nil {
			return fmt.Errorf("move to Trash failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	case "windows":
		command := buildWindowsTrashCommand(path, isDirectory)
		output, err := exec.Command(
			"powershell",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			command,
		).CombinedOutput()
		if err != nil {
			return fmt.Errorf("move to Recycle Bin failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	default:
		output, err := exec.Command("gio", "trash", path).CombinedOutput()
		if err != nil {
			return fmt.Errorf("move to trash failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	}
}

func revealProjectEntryInFileManager(path string) error {
	pathToReveal := filepath.Clean(path)
	if _, err := os.Stat(pathToReveal); err != nil {
		if os.IsNotExist(err) {
			pathToReveal = filepath.Dir(pathToReveal)
		} else {
			return err
		}
	}

	switch goruntime.GOOS {
	case "darwin":
		output, err := exec.Command("open", "-R", pathToReveal).CombinedOutput()
		if err != nil {
			return fmt.Errorf("reveal in Finder failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	case "windows":
		output, err := exec.Command("explorer", "/select,"+pathToReveal).CombinedOutput()
		if err != nil {
			return fmt.Errorf("reveal in Explorer failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	default:
		output, err := exec.Command("xdg-open", filepath.Dir(pathToReveal)).CombinedOutput()
		if err != nil {
			return fmt.Errorf("reveal in file manager failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	}
}

func buildWindowsTrashCommand(path string, isDirectory bool) string {
	quotedPath := strings.ReplaceAll(path, "'", "''")
	if isDirectory {
		return fmt.Sprintf(
			`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('%s', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
			quotedPath,
		)
	}

	return fmt.Sprintf(
		`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('%s', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
		quotedPath,
	)
}

// FindFileByName searches for a file by name in a directory recursively
// Returns all matching file paths
func (a *App) FindFileByName(searchDir string, fileName string) ([]string, error) {
	var results []string

	err := filepath.Walk(searchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors (permission denied, etc.)
		}

		// Skip vendor, node_modules, .git directories
		if info.IsDir() {
			name := info.Name()
			if name == "vendor" || name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}

		if info.Name() == fileName {
			results = append(results, path)
		}
		return nil
	})

	return results, err
}

// FormatCode formats a file using code formatter (Prettier for JS/TS/HTML/CSS)
func (a *App) FormatCode(filePath string, content string) (string, error) {
	// Get project root to find prettier
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return "", fmt.Errorf("no project opened")
	}

	// Check if file type is supported by Prettier
	ext := strings.ToLower(filepath.Ext(filePath))
	supportedExts := map[string]bool{
		".js":    true,
		".jsx":   true,
		".ts":    true,
		".tsx":   true,
		".json":  true,
		".html":  true,
		".css":   true,
		".scss":  true,
		".md":    true,
		".vue":   true,
		".php":   true,
		".blade": true, // Blade templates
	}

	if !supportedExts[ext] {
		// Return original content for unsupported files
		return content, nil
	}

	// Path to prettier in frontend directory
	prettierPath := filepath.Join(projectPath, "frontend", "node_modules", ".bin", "prettier")

	// Check if prettier exists
	if _, err := os.Stat(prettierPath); os.IsNotExist(err) {
		return "", fmt.Errorf("prettier not found at %s", prettierPath)
	}

	// Create temp file for formatting
	tmpFile, err := os.CreateTemp("", "prettier-*"+ext)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpFile.Name())

	// Write content to temp file
	if err := os.WriteFile(tmpFile.Name(), []byte(content), 0644); err != nil {
		return "", err
	}

	// Run prettier
	cmd := exec.Command(prettierPath, "--write", tmpFile.Name())
	cmd.Dir = filepath.Join(projectPath, "frontend")

	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("prettier error: %s, output: %s", err, string(output))
	}

	// Read formatted content
	formatted, err := os.ReadFile(tmpFile.Name())
	if err != nil {
		return "", err
	}

	return string(formatted), nil
}

// SearchResult represents a single search match
type SearchResult struct {
	File       string `json:"file"`
	Line       int    `json:"line"`
	Column     int    `json:"column"`
	Preview    string `json:"preview"`
	MatchStart int    `json:"matchStart"`
	MatchEnd   int    `json:"matchEnd"`
	Priority   int    `json:"priority"`
}

// isWordChar checks if a character is a word character (alphanumeric or underscore)
func isWordChar(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_'
}

// SearchInProject searches for a query string in all project files
func (a *App) SearchInProject(query string, caseSensitive bool, useRegex bool, wholeWord bool) ([]SearchResult, error) {
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	var results []SearchResult
	maxResults := 500 // Limit results to prevent performance issues

	// Priority mapping for files (higher = more important)
	getFilePriority := func(path string) int {
		lowerPath := strings.ToLower(path)

		// Highest priority: routes
		if strings.Contains(lowerPath, "routes/web.php") {
			return 100
		}
		if strings.Contains(lowerPath, "routes/api.php") {
			return 95
		}
		if strings.HasPrefix(lowerPath, "routes/") {
			return 90
		}

		// High priority: controllers, models
		if strings.HasPrefix(lowerPath, "app/http/controllers/") {
			return 85
		}
		if strings.HasPrefix(lowerPath, "app/models/") {
			return 80
		}

		// Medium-high: views, services
		if strings.Contains(lowerPath, "resources/views/") {
			return 70
		}
		if strings.HasPrefix(lowerPath, "app/services/") {
			return 65
		}

		// Medium: migrations, tests
		if strings.Contains(lowerPath, "database/migrations/") {
			return 50
		}
		if strings.Contains(lowerPath, "tests/") {
			return 45
		}

		// Low priority: config, vendor files, IDE files
		if strings.HasPrefix(lowerPath, ".idea/") {
			return 5
		}
		if strings.HasPrefix(lowerPath, "vendor/") {
			return 3
		}
		if strings.Contains(lowerPath, ".xml") {
			return 2
		}

		// Default priority
		return 40
	}

	// Extensions to search in
	searchableExts := map[string]bool{
		".php": true, ".js": true, ".ts": true, ".tsx": true, ".jsx": true,
		".vue": true, ".html": true, ".blade.php": true, ".css": true,
		".scss": true, ".json": true, ".md": true, ".env": true,
		".sql": true, ".xml": true, ".yaml": true, ".yml": true,
	}

	// Directories to exclude
	excludeDirs := map[string]bool{
		"node_modules": true, "vendor": true, ".git": true,
		"storage": true, "bootstrap/cache": true, "public/build": true,
	}

	err := filepath.Walk(projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}

		// Skip directories in exclude list
		if info.IsDir() {
			relPath, _ := filepath.Rel(projectPath, path)
			if excludeDirs[info.Name()] || excludeDirs[relPath] {
				return filepath.SkipDir
			}
			return nil
		}

		// Check if file extension is searchable
		ext := filepath.Ext(path)
		if ext == "" {
			// Check for .blade.php
			if strings.HasSuffix(path, ".blade.php") {
				ext = ".blade.php"
			} else {
				return nil
			}
		}

		if !searchableExts[ext] {
			return nil
		}

		// Read file
		content, err := os.ReadFile(path)
		if err != nil {
			return nil // Skip unreadable files
		}

		lines := strings.Split(string(content), "\n")
		relPath, _ := filepath.Rel(projectPath, path)

		for lineNum, line := range lines {
			if len(results) >= maxResults {
				return fmt.Errorf("max results reached")
			}

			// Find all matches in the line
			searchLine := line
			if !caseSensitive {
				searchLine = strings.ToLower(line)
				query = strings.ToLower(query)
			}

			matchIndex := strings.Index(searchLine, query)

			for matchIndex >= 0 {
				// Check for whole word match if required
				isWholeWord := true
				if wholeWord {
					// Check character before match
					if matchIndex > 0 {
						prevChar := rune(searchLine[matchIndex-1])
						if isWordChar(prevChar) {
							isWholeWord = false
						}
					}
					// Check character after match
					if matchIndex+len(query) < len(searchLine) {
						nextChar := rune(searchLine[matchIndex+len(query)])
						if isWordChar(nextChar) {
							isWholeWord = false
						}
					}
				}

				if isWholeWord {
					// Create preview (max 100 chars)
					preview := strings.TrimSpace(line)
					previewMatchIndex := matchIndex
					if len(preview) > 100 {
						start := matchIndex - 20
						if start < 0 {
							start = 0
						}
						end := matchIndex + len(query) + 30
						if end > len(preview) {
							end = len(preview)
						}
						preview = preview[start:end]
						previewMatchIndex = matchIndex - start
					}

					results = append(results, SearchResult{
						File:       path,
						Line:       lineNum + 1,
						Column:     matchIndex + 1,
						Preview:    preview,
						MatchStart: previewMatchIndex,
						MatchEnd:   previewMatchIndex + len(query),
						Priority:   getFilePriority(relPath),
					})

					// Only find first match per line to avoid duplicates
					break
				}

				// Find next match in the same line
				nextIndex := strings.Index(searchLine[matchIndex+1:], query)
				if nextIndex >= 0 {
					matchIndex = matchIndex + 1 + nextIndex
				} else {
					break
				}
			}
		}

		return nil
	})

	if err != nil && err.Error() != "max results reached" {
		return nil, err
	}

	// Sort results by priority (higher first)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Priority > results[j].Priority
	})

	return results, nil
}

// RunGitCommand executes a git command in the project directory
func (a *App) RunGitCommand(args []string) (string, error) {
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return "", fmt.Errorf("no project open")
	}
	if len(args) == 0 {
		return "", fmt.Errorf("git command is required")
	}
	if _, ok := gitAllowedSubcommands[args[0]]; !ok {
		return "", fmt.Errorf("git command not allowed: %s", args[0])
	}

	ctx, cancel := context.WithTimeout(context.Background(), gitCommandTimeout(args))
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = projectPath
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("git command timed out")
		}
		errText := strings.TrimSpace(stderr.String())
		if errText == "" {
			errText = strings.TrimSpace(stdout.String())
		}

		normalized := strings.ToLower(errText)
		if strings.Contains(normalized, "not a git repository") {
			return "", fmt.Errorf("not a git repository")
		}

		if errText == "" {
			return "", fmt.Errorf("git command failed: %w", err)
		}

		return "", fmt.Errorf("git error: %s", errText)
	}

	return stdout.String(), nil
}

// GetGitBranch returns the current git branch name
func (a *App) GetGitBranch() (string, error) {
	// Use branch --show-current which works even in empty repos
	output, err := a.RunGitCommand([]string{"branch", "--show-current"})
	if err != nil {
		// Fallback to symbolic-ref for detached HEAD
		output, err = a.RunGitCommand([]string{"symbolic-ref", "--short", "HEAD"})
		if err != nil {
			return "", err
		}
	}
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return "HEAD (detached)", nil
	}
	return trimmed, nil
}

// GetGitStatus returns git status in porcelain format
func (a *App) GetGitStatus() (string, error) {
	return a.RunGitCommand([]string{"status", "--porcelain"})
}

// GetGitBranches returns list of all local branches
func (a *App) GetGitBranches() ([]string, error) {
	output, err := a.RunGitCommand([]string{"branch", "--list", "--sort=-committerdate", "--format=%(refname:short)"})
	if err != nil {
		return nil, err
	}

	branches := []string{}
	for _, line := range strings.Split(output, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			branches = append(branches, trimmed)
		}
	}
	return branches, nil
}

// GetGitDiff returns diff for a specific file or all changes
func (a *App) GetGitDiff(filePath string, staged bool) (string, error) {
	args := []string{"diff", "--no-color", "--diff-algorithm=histogram"}
	if staged {
		args = append(args, "--cached")
	}
	if filePath != "" {
		args = append(args, "--", filePath)
	}
	return a.RunGitCommand(args)
}

// GitCommitInfo represents a single commit
type GitCommitInfo struct {
	Hash        string `json:"hash"`
	ShortHash   string `json:"shortHash"`
	Author      string `json:"author"`
	AuthorEmail string `json:"authorEmail"`
	Date        string `json:"date"`
	Subject     string `json:"subject"`
	Body        string `json:"body"`
	Parents     string `json:"parents"`
}

// GetGitLog returns commit history
func (a *App) GetGitLog(limit int, filePath string) ([]GitCommitInfo, error) {
	if limit <= 0 {
		limit = 50
	}

	format := strings.Join([]string{
		"%H",
		"%h",
		"%an",
		"%ae",
		"%ai",
		"%s",
		"%b",
		"%P",
	}, gitFieldSeparator) + gitRecordSeparator
	args := []string{"log", fmt.Sprintf("-n%d", limit), fmt.Sprintf("--format=%s", format)}

	if filePath != "" {
		args = append(args, "--", filePath)
	}

	output, err := a.RunGitCommand(args)
	if err != nil {
		return nil, err
	}

	var commits []GitCommitInfo
	for _, record := range strings.Split(output, gitRecordSeparator) {
		if record == "" {
			continue
		}
		parts := strings.Split(record, gitFieldSeparator)
		if len(parts) < 8 {
			continue
		}
		commit := GitCommitInfo{
			Hash:        parts[0],
			ShortHash:   parts[1],
			Author:      parts[2],
			AuthorEmail: parts[3],
			Date:        parts[4],
			Subject:     parts[5],
		}
		commit.Body = strings.TrimSpace(parts[6])
		commit.Parents = strings.TrimSpace(parts[7])
		commits = append(commits, commit)
	}
	return commits, nil
}

// GetGitShow returns details of a specific commit
func (a *App) GetGitShow(commitHash string) (string, error) {
	return a.RunGitCommand([]string{"show", "--no-color", "--stat", commitHash})
}

// GetGitCommitDiff returns the diff for a specific commit
func (a *App) GetGitCommitDiff(commitHash string) (string, error) {
	return a.RunGitCommand([]string{"show", "--no-color", "-p", commitHash})
}

// GetGitFileDiffBetweenCommits returns diff of a file between two commits
func (a *App) GetGitFileDiffBetweenCommits(filePath, fromCommit, toCommit string) (string, error) {
	args := []string{"diff", "--no-color", fromCommit, toCommit}
	if filePath != "" {
		args = append(args, "--", filePath)
	}
	return a.RunGitCommand(args)
}

// GetGitFileAtCommit returns file content at specific commit
func (a *App) GetGitFileAtCommit(filePath, commitHash string) (string, error) {
	return a.RunGitCommand([]string{"show", fmt.Sprintf("%s:%s", commitHash, filePath)})
}

// GetGitBlame returns blame info for a file
func (a *App) GetGitBlame(filePath string) (string, error) {
	return a.RunGitCommand([]string{"blame", "--no-progress", "--line-porcelain", filePath})
}
