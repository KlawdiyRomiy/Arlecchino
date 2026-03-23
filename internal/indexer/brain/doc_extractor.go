package brain

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type LocalDocExtractor struct {
	mu    sync.RWMutex
	cache map[string]*DocEntry
	ttl   time.Duration
}

type DocEntry struct {
	Symbol      string
	Package     string
	Language    string
	Description string
	Signature   string
	Parameters  []ParamDoc
	Returns     string
	Examples    []string
	Source      DocSource
	FetchedAt   time.Time
}

type ParamDoc struct {
	Name        string
	Type        string
	Description string
	Optional    bool
	Default     string
}

type DocSource int

const (
	DocSourceLocal DocSource = iota
	DocSourceCache
	DocSourceContext7
	DocSourceGitHub
)

func NewLocalDocExtractor() *LocalDocExtractor {
	return &LocalDocExtractor{
		cache: make(map[string]*DocEntry),
		ttl:   24 * time.Hour,
	}
}

func (e *LocalDocExtractor) ExtractFromFile(filePath string, symbolName string) *DocEntry {
	e.mu.RLock()
	cacheKey := filePath + "|" + symbolName
	if entry, ok := e.cache[cacheKey]; ok && time.Since(entry.FetchedAt) < e.ttl {
		e.mu.RUnlock()
		return entry
	}
	e.mu.RUnlock()

	ext := strings.ToLower(filepath.Ext(filePath))
	var entry *DocEntry

	switch ext {
	case ".ts", ".tsx", ".js", ".jsx":
		entry = e.extractJSDoc(filePath, symbolName)
	case ".py", ".pyi":
		entry = e.extractPythonDoc(filePath, symbolName)
	case ".go":
		entry = e.extractGoDoc(filePath, symbolName)
	case ".php":
		entry = e.extractPHPDoc(filePath, symbolName)
	case ".rb":
		entry = e.extractRubyDoc(filePath, symbolName)
	}

	if entry != nil {
		e.mu.Lock()
		e.cache[cacheKey] = entry
		e.mu.Unlock()
	}

	return entry
}

func (e *LocalDocExtractor) ExtractFromDTS(dtsPath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(dtsPath)
	if err != nil {
		return nil
	}

	return e.parseTypeScriptDocs(string(content), symbolName)
}

func (e *LocalDocExtractor) ExtractFromPYI(pyiPath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(pyiPath)
	if err != nil {
		return nil
	}

	return e.parsePythonStubs(string(content), symbolName)
}

var jsDocPattern = regexp.MustCompile("(?s)/\\*\\*\\s*(.*?)\\*/\\s*(?:export\\s+)?(?:async\\s+)?(?:function|class|const|let|var|interface|type)\\s+(\\w+)")
var jsDocParamPattern = regexp.MustCompile("@param\\s+(?:\\{([^}]+)\\}\\s+)?(\\w+)\\s*-?\\s*(.*)")
var jsDocReturnPattern = regexp.MustCompile("@returns?\\s+(?:\\{([^}]+)\\}\\s+)?(.*)")
var jsDocExamplePattern = regexp.MustCompile("@example\\s*\\n?\\s*(?:```\\w*\\n)?([\\s\\S]*?)(?:```|@|\\*/)")

func (e *LocalDocExtractor) extractJSDoc(filePath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	return e.parseTypeScriptDocs(string(content), symbolName)
}

func (e *LocalDocExtractor) parseTypeScriptDocs(content string, symbolName string) *DocEntry {
	matches := jsDocPattern.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) >= 3 && match[2] == symbolName {
			docBlock := match[1]
			entry := &DocEntry{
				Symbol:    symbolName,
				Language:  "typescript",
				Source:    DocSourceLocal,
				FetchedAt: time.Now(),
			}

			lines := strings.Split(docBlock, "\n")
			var descLines []string
			for _, line := range lines {
				line = strings.TrimSpace(line)
				line = strings.TrimPrefix(line, "*")
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "@") {
					break
				}
				if line != "" {
					descLines = append(descLines, line)
				}
			}
			entry.Description = strings.Join(descLines, " ")

			paramMatches := jsDocParamPattern.FindAllStringSubmatch(docBlock, -1)
			for _, pm := range paramMatches {
				param := ParamDoc{Name: pm[2]}
				if len(pm) > 1 {
					param.Type = pm[1]
				}
				if len(pm) > 3 {
					param.Description = strings.TrimSpace(pm[3])
				}
				entry.Parameters = append(entry.Parameters, param)
			}

			returnMatch := jsDocReturnPattern.FindStringSubmatch(docBlock)
			if len(returnMatch) > 2 {
				entry.Returns = strings.TrimSpace(returnMatch[2])
			}

			exampleMatches := jsDocExamplePattern.FindAllStringSubmatch(docBlock, -1)
			for _, em := range exampleMatches {
				if len(em) > 1 {
					entry.Examples = append(entry.Examples, strings.TrimSpace(em[1]))
				}
			}

			return entry
		}
	}
	return nil
}

var pythonDocPattern = regexp.MustCompile("(?s)(?:def|class)\\s+(\\w+).*?:\\s*(?:'''|\"\"\")(.*?)(?:'''|\"\"\")")
var pythonParamPattern = regexp.MustCompile("(?m)^\\s*(\\w+)(?:\\s*\\([^)]+\\))?\\s*:\\s*(.+)$")
var pythonReturnsPattern = regexp.MustCompile("(?m)Returns:\\s*\\n\\s*(.+)")

func (e *LocalDocExtractor) extractPythonDoc(filePath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	return e.parsePythonDocs(string(content), symbolName)
}

func (e *LocalDocExtractor) parsePythonDocs(content string, symbolName string) *DocEntry {
	matches := pythonDocPattern.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) >= 3 && match[1] == symbolName {
			docstring := match[2]
			entry := &DocEntry{
				Symbol:    symbolName,
				Language:  "python",
				Source:    DocSourceLocal,
				FetchedAt: time.Now(),
			}

			lines := strings.Split(docstring, "\n")
			var descLines []string
			inArgs := false
			for _, line := range lines {
				trimmed := strings.TrimSpace(line)
				if strings.HasPrefix(trimmed, "Args:") || strings.HasPrefix(trimmed, "Parameters:") {
					inArgs = true
					continue
				}
				if strings.HasPrefix(trimmed, "Returns:") || strings.HasPrefix(trimmed, "Raises:") {
					inArgs = false
					continue
				}
				if !inArgs && trimmed != "" && !strings.HasPrefix(trimmed, ":") {
					descLines = append(descLines, trimmed)
				}
			}
			entry.Description = strings.Join(descLines, " ")

			paramMatches := pythonParamPattern.FindAllStringSubmatch(docstring, -1)
			for _, pm := range paramMatches {
				if len(pm) >= 3 {
					entry.Parameters = append(entry.Parameters, ParamDoc{
						Name:        pm[1],
						Description: strings.TrimSpace(pm[2]),
					})
				}
			}

			returnMatch := pythonReturnsPattern.FindStringSubmatch(docstring)
			if len(returnMatch) > 1 {
				entry.Returns = strings.TrimSpace(returnMatch[1])
			}

			return entry
		}
	}
	return nil
}

func (e *LocalDocExtractor) parsePythonStubs(content string, symbolName string) *DocEntry {
	return e.parsePythonDocs(content, symbolName)
}

var goDocPattern = regexp.MustCompile("(?m)^//\\s*(.+)\\nfunc\\s+(?:\\([^)]+\\)\\s+)?(\\w+)")

func (e *LocalDocExtractor) extractGoDoc(filePath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	text := string(content)
	funcPattern := regexp.MustCompile("(?m)((?://[^\\n]*\\n)+)func\\s+(?:\\([^)]+\\)\\s+)?" + regexp.QuoteMeta(symbolName))
	match := funcPattern.FindStringSubmatch(text)
	if match == nil {
		return nil
	}

	docBlock := match[1]
	var descLines []string
	for _, line := range strings.Split(docBlock, "\n") {
		line = strings.TrimPrefix(strings.TrimSpace(line), "//")
		line = strings.TrimSpace(line)
		if line != "" {
			descLines = append(descLines, line)
		}
	}

	return &DocEntry{
		Symbol:      symbolName,
		Language:    "go",
		Description: strings.Join(descLines, " "),
		Source:      DocSourceLocal,
		FetchedAt:   time.Now(),
	}
}

var phpDocPattern = regexp.MustCompile("(?s)/\\*\\*\\s*(.*?)\\*/\\s*(?:public|private|protected|static|\\s)*function\\s+(\\w+)")
var phpDocParamPattern = regexp.MustCompile("@param\\s+(\\S+)\\s+\\$(\\w+)\\s*(.*)")

func (e *LocalDocExtractor) extractPHPDoc(filePath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	matches := phpDocPattern.FindAllStringSubmatch(string(content), -1)
	for _, match := range matches {
		if len(match) >= 3 && match[2] == symbolName {
			docBlock := match[1]
			entry := &DocEntry{
				Symbol:    symbolName,
				Language:  "php",
				Source:    DocSourceLocal,
				FetchedAt: time.Now(),
			}

			lines := strings.Split(docBlock, "\n")
			var descLines []string
			for _, line := range lines {
				line = strings.TrimSpace(line)
				line = strings.TrimPrefix(line, "*")
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "@") {
					break
				}
				if line != "" {
					descLines = append(descLines, line)
				}
			}
			entry.Description = strings.Join(descLines, " ")

			paramMatches := phpDocParamPattern.FindAllStringSubmatch(docBlock, -1)
			for _, pm := range paramMatches {
				entry.Parameters = append(entry.Parameters, ParamDoc{
					Type:        pm[1],
					Name:        pm[2],
					Description: strings.TrimSpace(pm[3]),
				})
			}

			returnMatch := jsDocReturnPattern.FindStringSubmatch(docBlock)
			if len(returnMatch) > 1 {
				entry.Returns = strings.TrimSpace(returnMatch[1])
			}

			return entry
		}
	}
	return nil
}

var rubyDocPattern = regexp.MustCompile("(?m)^(\\s*#[^\\n]*\\n)+\\s*def\\s+(\\w+)")

func (e *LocalDocExtractor) extractRubyDoc(filePath string, symbolName string) *DocEntry {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}

	text := string(content)
	funcPattern := regexp.MustCompile("(?m)((?:\\s*#[^\\n]*\\n)+)\\s*def\\s+" + regexp.QuoteMeta(symbolName))
	match := funcPattern.FindStringSubmatch(text)
	if match == nil {
		return nil
	}

	docBlock := match[1]
	var descLines []string
	for _, line := range strings.Split(docBlock, "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimPrefix(line, "#")
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "@") {
			descLines = append(descLines, line)
		}
	}

	return &DocEntry{
		Symbol:      symbolName,
		Language:    "ruby",
		Description: strings.Join(descLines, " "),
		Source:      DocSourceLocal,
		FetchedAt:   time.Now(),
	}
}

func (e *LocalDocExtractor) FindDTSFile(packageName string, projectRoot string) string {
	paths := []string{
		filepath.Join(projectRoot, "node_modules", packageName, "index.d.ts"),
		filepath.Join(projectRoot, "node_modules", packageName, "dist", "index.d.ts"),
		filepath.Join(projectRoot, "node_modules", "@types", packageName, "index.d.ts"),
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (e *LocalDocExtractor) FindPYIFile(packageName string, projectRoot string) string {
	paths := []string{
		filepath.Join(projectRoot, ".venv", "lib", "python3.11", "site-packages", packageName, "__init__.pyi"),
		filepath.Join(projectRoot, "venv", "lib", "python3.11", "site-packages", packageName, "__init__.pyi"),
		filepath.Join(projectRoot, ".venv", "lib", "python3.12", "site-packages", packageName, "__init__.pyi"),
	}

	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (e *LocalDocExtractor) ClearCache() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.cache = make(map[string]*DocEntry)
}

func (e *LocalDocExtractor) CleanupExpired() {
	e.mu.Lock()
	defer e.mu.Unlock()

	now := time.Now()
	for key, entry := range e.cache {
		if now.Sub(entry.FetchedAt) > e.ttl {
			delete(e.cache, key)
		}
	}
}
