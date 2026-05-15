package dispatcher

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"arlecchino/internal/workspace"
)

type SearchBackend interface {
	SearchFiles(pattern string, limit int) []ResultItem
	SearchContent(query string, caseSensitive bool, limit int) []ResultItem
	Status() SearchBackendStatus
	Rebuild(context.Context) error
}

type SearchBackendStatus struct {
	Name      string `json:"name"`
	Ready     bool   `json:"ready"`
	Indexed   bool   `json:"indexed"`
	Fallback  bool   `json:"fallback"`
	Message   string `json:"message,omitempty"`
	CachePath string `json:"cachePath,omitempty"`
}

type SearchEngine struct {
	projectPath string
	maxResults  int
	backend     SearchBackend
}

func NewSearchEngine(projectPath string) *SearchEngine {
	engine := &SearchEngine{
		projectPath: projectPath,
		maxResults:  50,
	}
	engine.backend = NewLinearSearchBackend(projectPath)
	return engine
}

func (s *SearchEngine) SetProjectPath(path string) {
	s.projectPath = path
	s.backend = NewLinearSearchBackend(path)
}

func (s *SearchEngine) SetBackend(backend SearchBackend) {
	if backend == nil {
		backend = NewLinearSearchBackend(s.projectPath)
	}
	s.backend = backend
}

func (s *SearchEngine) Status() SearchBackendStatus {
	if s.backend == nil {
		return SearchBackendStatus{Name: "linear", Ready: false, Fallback: true, Message: "search backend is not initialized"}
	}
	return s.backend.Status()
}

func (s *SearchEngine) Rebuild(ctx context.Context) error {
	if s.backend == nil {
		return nil
	}
	return s.backend.Rebuild(ctx)
}

func (s *SearchEngine) SearchFiles(pattern string) []ResultItem {
	if s.backend != nil {
		return s.backend.SearchFiles(pattern, s.maxResults)
	}
	return nil
}

func (s *SearchEngine) SearchContent(query string, caseSensitive bool) []ResultItem {
	if s.backend != nil {
		return s.backend.SearchContent(query, caseSensitive, s.maxResults)
	}
	return []ResultItem{}
}

type LinearSearchBackend struct {
	projectPath string
}

func NewLinearSearchBackend(projectPath string) *LinearSearchBackend {
	return &LinearSearchBackend{projectPath: projectPath}
}

func (b *LinearSearchBackend) Status() SearchBackendStatus {
	return SearchBackendStatus{Name: "linear", Ready: b.projectPath != "", Fallback: true, Message: "linear search backend"}
}

func (b *LinearSearchBackend) Rebuild(context.Context) error {
	return nil
}

func (b *LinearSearchBackend) SearchFiles(pattern string, limit int) []ResultItem {
	if b.projectPath == "" {
		return nil
	}
	limit = normalizeSearchLimit(limit)

	var results []ResultItem
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return results
	}

	patternLower := strings.ToLower(pattern)
	isGlob := strings.ContainsAny(pattern, "*?[]")

	excludeDirs := map[string]bool{
		"node_modules": true,
		"vendor":       true,
		".git":         true,
		"dist":         true,
		"build":        true,
		".idea":        true,
		".vscode":      true,
	}

	scanner, err := workspace.NewScanner(b.projectPath, workspace.ScannerOptions{
		UseGitIgnore: true,
		SkipDirs:     excludeDirsToSet(excludeDirs),
	})
	if err != nil {
		return results
	}
	entries, _, err := scanner.Scan(context.Background())
	if err != nil && !errors.Is(err, workspace.ErrScanBudgetExceeded) {
		return results
	}
	for _, entry := range entries {
		if entry.IsDirectory || len(results) >= limit {
			continue
		}
		relPath := entry.RelPath
		fileName := entry.Name
		fileNameLower := strings.ToLower(fileName)
		relPathLower := strings.ToLower(relPath)

		var matched bool
		if isGlob {
			matched, _ = filepath.Match(strings.ToLower(pattern), fileNameLower)
			if !matched {
				matched, _ = filepath.Match(strings.ToLower(pattern), relPathLower)
			}
		} else {
			matched = strings.Contains(fileNameLower, patternLower) ||
				strings.Contains(relPathLower, patternLower)
		}

		if matched {
			icon := getFileIcon(fileName)
			results = append(results, ResultItem{
				ID:       relPath,
				Icon:     icon,
				Title:    fileName,
				Subtitle: relPath,
				Action:   "open",
				FilePath: entry.Path,
			})
		}
	}

	return results
}

func (b *LinearSearchBackend) SearchContent(query string, caseSensitive bool, limit int) []ResultItem {
	if b.projectPath == "" || query == "" {
		return []ResultItem{}
	}
	limit = normalizeSearchLimit(limit)

	results := make([]ResultItem, 0)

	searchableExts := map[string]bool{
		".go": true, ".js": true, ".ts": true, ".tsx": true, ".jsx": true,
		".php": true, ".py": true, ".rb": true, ".rs": true, ".java": true,
		".c": true, ".cpp": true, ".h": true, ".hpp": true,
		".vue": true, ".svelte": true, ".html": true, ".css": true,
		".scss": true, ".json": true, ".yaml": true, ".yml": true,
		".md": true, ".txt": true, ".sql": true, ".sh": true,
	}
	searchableNames := map[string]bool{
		"dockerfile": true,
		"gemfile":    true,
		"justfile":   true,
		"makefile":   true,
		"procfile":   true,
		"rakefile":   true,
	}

	excludeDirs := map[string]bool{
		"node_modules": true,
		"vendor":       true,
		".git":         true,
		"dist":         true,
		"build":        true,
	}

	if !caseSensitive {
		query = strings.ToLower(query)
	}

	scanner, err := workspace.NewScanner(b.projectPath, workspace.ScannerOptions{
		UseGitIgnore: true,
		SkipDirs:     excludeDirsToSet(excludeDirs),
	})
	if err != nil {
		return results
	}
	entries, _, err := scanner.Scan(context.Background())
	if err != nil && !errors.Is(err, workspace.ErrScanBudgetExceeded) {
		return results
	}
	for _, entry := range entries {
		if entry.IsDirectory || len(results) >= limit {
			continue
		}
		path := entry.Path
		ext := strings.ToLower(filepath.Ext(path))
		if !searchableExts[ext] && !searchableNames[strings.ToLower(entry.Name)] {
			continue
		}

		if entry.Size > 1024*1024 {
			continue
		}

		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}

		lines := strings.Split(string(content), "\n")
		relPath := entry.RelPath

		for lineNum, line := range lines {
			searchLine := line
			if !caseSensitive {
				searchLine = strings.ToLower(line)
			}

			if strings.Contains(searchLine, query) {
				preview := strings.TrimSpace(line)
				if len(preview) > 80 {
					preview = preview[:80] + "..."
				}

				lineStr := strconv.Itoa(lineNum + 1)
				results = append(results, ResultItem{
					ID:       relPath + ":" + lineStr,
					Icon:     "file-text",
					Title:    preview,
					Subtitle: relPath + ":" + lineStr,
					Action:   "open",
					FilePath: path,
					Line:     lineNum + 1,
				})

				if len(results) >= limit {
					break
				}
			}
		}
	}

	return results
}

func excludeDirsToSet(excludeDirs map[string]bool) map[string]struct{} {
	result := make(map[string]struct{}, len(excludeDirs))
	for name, excluded := range excludeDirs {
		if excluded {
			result[name] = struct{}{}
		}
	}
	return result
}

func normalizeSearchLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	return limit
}

func getFileIcon(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))

	switch ext {
	case ".go":
		return "file-code"
	case ".js", ".jsx", ".ts", ".tsx":
		return "file-code"
	case ".php":
		return "file-code"
	case ".py":
		return "file-code"
	case ".rb":
		return "file-code"
	case ".rs":
		return "file-code"
	case ".java":
		return "file-code"
	case ".c", ".cpp", ".h", ".hpp":
		return "file-code"
	case ".html", ".vue", ".svelte":
		return "file-code"
	case ".css", ".scss", ".sass", ".less":
		return "file-code"
	case ".json", ".yaml", ".yml", ".toml":
		return "file-json"
	case ".md", ".txt":
		return "file-text"
	case ".sql":
		return "database"
	case ".sh", ".bash", ".zsh":
		return "terminal"
	case ".png", ".jpg", ".jpeg", ".gif", ".svg":
		return "image"
	default:
		return "file"
	}
}
