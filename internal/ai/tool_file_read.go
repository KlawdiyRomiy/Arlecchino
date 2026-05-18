package ai

import (
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	defaultFileReadLineCount    = 80
	maxFileReadLineCount        = 200
	defaultWorkspaceGrepMatches = 40
	maxWorkspaceGrepMatches     = 120
	maxWorkspaceGrepFileBytes   = 512 * 1024
	maxWorkspaceGrepLineBytes   = 400
)

func (s *Service) executeFileReadRangeTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	relPath := strings.TrimSpace(req.Arguments["path"])
	if relPath == "" {
		result.Status = "blocked"
		result.Error = "file read path is empty"
		return result
	}
	if !fileReadRangePathAllowed(relPath) {
		result.Status = "blocked"
		result.Error = "file read path is sensitive or binary-like"
		return result
	}
	absPath, err := safeProjectPath(project.ProjectRoot, relPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	if info.Mode()&os.ModeSymlink != 0 {
		result.Status = "blocked"
		result.Error = "file read target is a symlink"
		return result
	}
	if info.IsDir() {
		result.Status = "blocked"
		result.Error = "file read target is a directory"
		return result
	}
	if info.Size() > maxPatchCheckpointBytes {
		result.Status = "blocked"
		result.Error = "file read target exceeds checkpoint limit"
		return result
	}
	content, err := os.ReadFile(absPath)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	if bytes.IndexByte(content, 0) >= 0 {
		result.Status = "blocked"
		result.Error = "file read target appears binary"
		return result
	}
	startLine := parsePositiveToolInt(req.Arguments["startLine"], 1)
	lineCount := parsePositiveToolInt(req.Arguments["lineCount"], defaultFileReadLineCount)
	if lineCount > maxFileReadLineCount {
		lineCount = maxFileReadLineCount
	}
	output, err := formatFileReadRange(relPath, string(content), startLine, lineCount)
	if err != nil {
		result.Status = "blocked"
		result.Error = err.Error()
		return result
	}
	result.Status = "executed"
	result.OutputPreview = output
	return result
}

func (s *Service) executeWorkspaceGrepTool(project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	pattern := strings.TrimSpace(req.Arguments["pattern"])
	if pattern == "" {
		result.Status = "blocked"
		result.Error = "workspace grep pattern is empty"
		return result
	}
	maxMatches := parsePositiveToolInt(req.Arguments["maxMatches"], defaultWorkspaceGrepMatches)
	if maxMatches > maxWorkspaceGrepMatches {
		maxMatches = maxWorkspaceGrepMatches
	}
	includeGlob := strings.TrimSpace(req.Arguments["includeGlob"])
	useRegex := parseToolBool(req.Arguments["regex"])
	var compiled *regexp.Regexp
	if useRegex {
		re, err := regexp.Compile(pattern)
		if err != nil {
			result.Status = "blocked"
			result.Error = "workspace grep regex is invalid: " + err.Error()
			return result
		}
		compiled = re
	}
	matches := []string{}
	walkErr := filepath.WalkDir(project.ProjectRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if len(matches) >= maxMatches {
			return fs.SkipAll
		}
		name := entry.Name()
		if entry.IsDir() {
			if workspaceGrepSkipDir(name) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(project.ProjectRoot, path)
		if relErr != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if !workspaceGrepPathAllowed(rel, includeGlob) {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil || info.Size() > maxWorkspaceGrepFileBytes {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil || bytes.IndexByte(content, 0) >= 0 {
			return nil
		}
		for lineIndex, line := range strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n") {
			if !workspaceGrepLineMatches(line, pattern, compiled) {
				continue
			}
			matches = append(matches, fmt.Sprintf("%s:%d | %s", rel, lineIndex+1, truncateUTF8(sanitizedDisplayText(line), maxWorkspaceGrepLineBytes)))
			if len(matches) >= maxMatches {
				return fs.SkipAll
			}
		}
		return nil
	})
	if walkErr != nil && walkErr != fs.SkipAll {
		result.Status = "error"
		result.Error = walkErr.Error()
		return result
	}
	if len(matches) == 0 {
		result.Status = "executed"
		result.OutputPreview = "No matches."
		return result
	}
	result.Status = "executed"
	result.OutputPreview = strings.Join(matches, "\n")
	return result
}

func fileReadRangePathAllowed(relPath string) bool {
	clean := normalizeToolPathForPolicy(relPath)
	if clean == "" {
		return false
	}
	if toolPathLooksSensitive(clean) {
		return false
	}
	if toolPathLooksBinaryByExtension(clean) {
		return false
	}
	return true
}

func normalizeToolPathForPolicy(relPath string) string {
	return strings.ToLower(filepath.ToSlash(strings.TrimSpace(relPath)))
}

func toolPathLooksSensitive(relPath string) bool {
	clean := normalizeToolPathForPolicy(relPath)
	if clean == "" {
		return false
	}
	for _, part := range strings.Split(clean, "/") {
		if toolPathPartLooksSensitive(part) {
			return true
		}
	}
	return false
}

func toolPathPartLooksSensitive(part string) bool {
	part = strings.TrimSpace(strings.ToLower(part))
	if part == "" {
		return false
	}
	switch part {
	case ".env", ".git", ".netrc", ".npmrc", ".pypirc", ".pgpass",
		"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
		"private_key", "private-key", "private.key",
		"secret", "secrets", "password", "passwords", "passwd",
		"credential", "credentials", "cookie", "cookies":
		return true
	}
	if strings.HasPrefix(part, ".env.") {
		return true
	}
	ext := filepath.Ext(part)
	base := strings.TrimSuffix(part, ext)
	switch ext {
	case ".pem", ".p12", ".pfx":
		return true
	case ".key":
		return strings.Contains(base, "private") || strings.HasPrefix(base, "id_")
	}
	tokens := splitSensitivePathTokens(base)
	if hasToken(tokens, "private") && hasToken(tokens, "key") {
		return true
	}
	if hasToken(tokens, "id") && hasAnyToken(tokens, "rsa", "dsa", "ecdsa", "ed25519") {
		return true
	}
	sourceLike := toolPathExtensionLooksSource(ext)
	if sourceLike {
		if base == "secret" ||
			base == "secrets" ||
			base == "password" ||
			base == "passwords" ||
			base == "passwd" ||
			base == "credential" ||
			base == "credentials" ||
			base == "cookie" ||
			base == "cookies" {
			return true
		}
	} else if hasAnyToken(tokens, "secret", "secrets", "password", "passwords", "passwd", "credential", "credentials", "cookie", "cookies") {
		return true
	}
	if hasAnyToken(tokens, "token", "tokens") {
		if base == "token" || base == "tokens" {
			return true
		}
		return hasAnyToken(tokens, "access", "auth", "api", "bearer", "refresh", "session", "github", "gitlab", "slack", "openai")
	}
	return false
}

func toolPathExtensionLooksSource(ext string) bool {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case ".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".java", ".kt", ".kts",
		".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".cs", ".swift", ".php", ".lua", ".dart", ".ex", ".exs",
		".scala", ".clj", ".cljs", ".fs", ".fsx", ".erl", ".hrl", ".zig", ".sh", ".bash", ".zsh", ".fish",
		".md", ".mdx":
		return true
	default:
		return false
	}
}

func splitSensitivePathTokens(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9')
	})
}

func hasToken(tokens []string, want string) bool {
	for _, token := range tokens {
		if token == want {
			return true
		}
	}
	return false
}

func hasAnyToken(tokens []string, wants ...string) bool {
	for _, want := range wants {
		if hasToken(tokens, want) {
			return true
		}
	}
	return false
}

func toolPathLooksBinaryByExtension(relPath string) bool {
	ext := filepath.Ext(normalizeToolPathForPolicy(relPath))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".tif", ".tiff", ".ico", ".icns",
		".mp3", ".mp4", ".m4a", ".mov", ".avi", ".mkv", ".webm", ".wav", ".flac", ".ogg",
		".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".dmg", ".pkg", ".iso",
		".exe", ".dll", ".dylib", ".so", ".o", ".a", ".wasm", ".class", ".jar", ".node",
		".ttf", ".otf", ".woff", ".woff2", ".eot",
		".pdf", ".psd", ".ai", ".sketch", ".fig", ".car",
		".db", ".sqlite", ".sqlite3", ".bin":
		return true
	default:
		return false
	}
}

func parsePositiveToolInt(value string, fallback int) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func parseToolBool(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func workspaceGrepSkipDir(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case ".git", "node_modules", "vendor", "dist", "build", ".next", ".vite", ".wails", ".arlecchino":
		return true
	default:
		return false
	}
}

func workspaceGrepPathAllowed(relPath string, includeGlob string) bool {
	if !fileReadRangePathAllowed(relPath) {
		return false
	}
	if strings.TrimSpace(includeGlob) == "" {
		return true
	}
	return workspaceGrepGlobMatch(filepath.ToSlash(includeGlob), filepath.ToSlash(relPath))
}

func workspaceGrepGlobMatch(pattern string, relPath string) bool {
	pattern = strings.TrimSpace(filepath.ToSlash(pattern))
	relPath = strings.TrimSpace(filepath.ToSlash(relPath))
	if pattern == "" {
		return true
	}
	if strings.HasPrefix(pattern, "**/") {
		suffix := strings.TrimPrefix(pattern, "**/")
		if ok, _ := filepath.Match(suffix, filepath.Base(relPath)); ok {
			return true
		}
	}
	if strings.Contains(pattern, "/**/") {
		parts := strings.Split(pattern, "/**/")
		if len(parts) == 2 && strings.HasPrefix(relPath, strings.TrimSuffix(parts[0], "/")+"/") {
			if ok, _ := filepath.Match(parts[1], filepath.Base(relPath)); ok {
				return true
			}
		}
	}
	if ok, _ := filepath.Match(pattern, relPath); ok {
		return true
	}
	if ok, _ := filepath.Match(pattern, filepath.Base(relPath)); ok {
		return true
	}
	return false
}

func workspaceGrepLineMatches(line string, pattern string, regex *regexp.Regexp) bool {
	if regex != nil {
		return regex.MatchString(line)
	}
	return strings.Contains(line, pattern)
}

func formatFileReadRange(relPath string, content string, startLine int, lineCount int) (string, error) {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	lines := strings.Split(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("file is empty")
	}
	if startLine > len(lines) {
		return "", fmt.Errorf("startLine exceeds file length")
	}
	endLine := startLine + lineCount - 1
	if endLine > len(lines) {
		endLine = len(lines)
	}
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("%s:%d-%d\n", filepath.ToSlash(strings.TrimSpace(relPath)), startLine, endLine))
	for index := startLine - 1; index < endLine; index++ {
		builder.WriteString(fmt.Sprintf("%4d | %s\n", index+1, lines[index]))
	}
	if endLine < len(lines) {
		builder.WriteString(fmt.Sprintf("... %d more line(s)\n", len(lines)-endLine))
	}
	return builder.String(), nil
}
