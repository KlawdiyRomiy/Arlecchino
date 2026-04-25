package dispatcher

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type SearchEngine struct {
	projectPath string
	maxResults  int
}

func NewSearchEngine(projectPath string) *SearchEngine {
	return &SearchEngine{
		projectPath: projectPath,
		maxResults:  50,
	}
}

func (s *SearchEngine) SetProjectPath(path string) {
	s.projectPath = path
}

func (s *SearchEngine) SearchFiles(pattern string) []ResultItem {
	if s.projectPath == "" {
		return nil
	}

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

	filepath.Walk(s.projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || len(results) >= s.maxResults {
			return nil
		}

		if info.IsDir() {
			if excludeDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}

		relPath, _ := filepath.Rel(s.projectPath, path)
		fileName := info.Name()
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
				FilePath: path,
			})
		}

		return nil
	})

	return results
}

func (s *SearchEngine) SearchContent(query string, caseSensitive bool) []ResultItem {
	if s.projectPath == "" || query == "" {
		return []ResultItem{}
	}

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

	filepath.Walk(s.projectPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || len(results) >= s.maxResults {
			return nil
		}

		if info.IsDir() {
			if excludeDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !searchableExts[ext] && !searchableNames[strings.ToLower(info.Name())] {
			return nil
		}

		if info.Size() > 1024*1024 {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		lines := strings.Split(string(content), "\n")
		relPath, _ := filepath.Rel(s.projectPath, path)

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

				if len(results) >= s.maxResults {
					return filepath.SkipAll
				}
			}
		}

		return nil
	})

	return results
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
