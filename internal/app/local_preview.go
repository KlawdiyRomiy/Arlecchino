package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/toolchain"
)

const (
	localPreviewURLPrefix       = "/preview"
	localPreviewReadTimeout     = 5 * time.Second
	localPreviewWriteTimeout    = 30 * time.Second
	localPreviewIdleTimeout     = 60 * time.Second
	localPreviewMaxHeaderBytes  = 8 * 1024
	localPreviewTokenBytes      = 24
	localPreviewProjectKeyBytes = 12
	localPreviewJekyllTimeout   = 45 * time.Second
	localPreviewOutputLimit     = 4000
)

type LocalPreviewURL struct {
	URL         string `json:"url"`
	FilePath    string `json:"filePath"`
	ProjectPath string `json:"projectPath"`
	PreviewPath string `json:"previewPath,omitempty"`
	SiteRoot    string `json:"siteRoot,omitempty"`
	Mode        string `json:"mode,omitempty"`
}

type localPreviewProject struct {
	root     string
	realRoot string
}

type localPreviewServer struct {
	token  string
	base   string
	server *http.Server

	mu         sync.RWMutex
	projects   map[string]localPreviewProject
	projectKey map[string]string
}

func (a *App) GetLocalPreviewURL(ctx context.Context, filePath string) (LocalPreviewURL, error) {
	session := a.projectSessionForContext(ctx)
	projectPath := ""
	if session != nil {
		projectPath = strings.TrimSpace(session.currentProjectPath())
	}
	if projectPath == "" && a != nil {
		projectPath = strings.TrimSpace(a.currentProjectPath())
	}
	if projectPath == "" {
		return LocalPreviewURL{}, fmt.Errorf("no project opened")
	}

	resolved, err := resolveLocalPreviewPath(projectPath, filePath)
	if err != nil {
		return LocalPreviewURL{}, err
	}

	server, err := a.ensureLocalPreviewServer()
	if err != nil {
		return LocalPreviewURL{}, err
	}
	target, err := a.resolveLocalPreviewTarget(ctx, server, resolved)
	if err != nil {
		return LocalPreviewURL{}, err
	}
	previewURL, err := server.URL(target.serveRoot, target.servePath)
	if err != nil {
		return LocalPreviewURL{}, err
	}

	return LocalPreviewURL{
		URL:         previewURL,
		FilePath:    target.sourcePath,
		ProjectPath: resolved.projectRoot,
		PreviewPath: target.servePath,
		SiteRoot:    target.siteRoot,
		Mode:        target.mode,
	}, nil
}

type resolvedLocalPreviewPath struct {
	projectRoot string
	filePath    string
}

type localPreviewTarget struct {
	serveRoot   string
	servePath   string
	sourcePath  string
	projectRoot string
	siteRoot    string
	mode        string
}

type jekyllPreviewBuildCommand struct {
	path string
	args []string
	env  []string
}

func resolveLocalPreviewPath(projectPath string, filePath string) (resolvedLocalPreviewPath, error) {
	root, err := resolveProjectEntryRootFromPath(projectPath)
	if err != nil {
		return resolvedLocalPreviewPath{}, err
	}
	resolved, err := resolveProjectEntryPathInRoot(root, filePath, true)
	if err != nil {
		return resolvedLocalPreviewPath{}, err
	}
	if resolved.IsDirectory {
		return resolvedLocalPreviewPath{}, fmt.Errorf("preview target is a directory: %s", resolved.Path)
	}

	return resolvedLocalPreviewPath{
		projectRoot: root.Abs,
		filePath:    resolved.Path,
	}, nil
}

func (a *App) resolveLocalPreviewTarget(ctx context.Context, server *localPreviewServer, resolved resolvedLocalPreviewPath) (localPreviewTarget, error) {
	target := localPreviewTarget{
		serveRoot:   resolved.projectRoot,
		servePath:   resolved.filePath,
		sourcePath:  resolved.filePath,
		projectRoot: resolved.projectRoot,
		mode:        "file",
	}

	siteRoot, ok, err := findJekyllSiteRoot(resolved.projectRoot, resolved.filePath)
	if err != nil {
		return localPreviewTarget{}, err
	}
	if !ok || !shouldRenderWithJekyll(siteRoot, resolved.filePath) {
		return target, nil
	}

	buildRoot, err := a.buildJekyllPreview(ctx, server, resolved.projectRoot, siteRoot)
	if err != nil {
		if canServeLocalPreviewSourceFallback(resolved.filePath) {
			target.mode = "file-fallback"
			return target, nil
		}
		return localPreviewTarget{}, err
	}
	previewPath, err := chooseJekyllPreviewPath(siteRoot, resolved.filePath, buildRoot)
	if err != nil {
		return localPreviewTarget{}, err
	}

	target.serveRoot = buildRoot
	target.servePath = previewPath
	target.siteRoot = siteRoot
	target.mode = "jekyll"
	return target, nil
}

func findJekyllSiteRoot(projectRoot string, filePath string) (string, bool, error) {
	projectRoot = filepath.Clean(projectRoot)
	current := filepath.Dir(filepath.Clean(filePath))
	for {
		withinProject, err := isPathWithinRoot(projectRoot, current)
		if err != nil || !withinProject {
			return "", false, err
		}
		if fileExists(filepath.Join(current, "_config.yml")) || fileExists(filepath.Join(current, "_config.yaml")) {
			return current, true, nil
		}
		if current == projectRoot {
			return "", false, nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", false, nil
		}
		current = parent
	}
}

func shouldRenderWithJekyll(siteRoot string, filePath string) bool {
	rel, err := filepath.Rel(siteRoot, filePath)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	lowerRel := strings.ToLower(rel)
	if jekyllRelativePathHasSegment(rel, "_includes") || jekyllRelativePathHasSegment(rel, "_layouts") {
		return true
	}
	if strings.HasSuffix(lowerRel, ".html.liquid") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != ".html" && ext != ".htm" && ext != ".md" && ext != ".markdown" {
		return false
	}
	return fileLooksLikeJekyllPage(filePath)
}

func jekyllRelativePathHasSegment(relPath string, segment string) bool {
	for _, current := range strings.Split(filepath.ToSlash(relPath), "/") {
		if current == segment {
			return true
		}
	}
	return false
}

func fileLooksLikeJekyllPage(filePath string) bool {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return false
	}
	if len(content) > 64*1024 {
		content = content[:64*1024]
	}
	text := strings.TrimLeft(string(content), "\ufeff\r\n\t ")
	if strings.HasPrefix(text, "---\n") || strings.HasPrefix(text, "---\r\n") {
		return true
	}
	return strings.Contains(text, "{%") || strings.Contains(text, "{{")
}

func canServeLocalPreviewSourceFallback(filePath string) bool {
	lowerPath := strings.ToLower(filePath)
	if strings.HasSuffix(lowerPath, ".html.liquid") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	return ext == ".html" || ext == ".htm"
}

func (a *App) buildJekyllPreview(ctx context.Context, server *localPreviewServer, projectRoot string, siteRoot string) (string, error) {
	if a == nil {
		return "", fmt.Errorf("app is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	a.localPreviewBuildMu.Lock()
	defer a.localPreviewBuildMu.Unlock()

	buildRoot, err := a.prepareJekyllPreviewBuildDirLocked(siteRoot)
	if err != nil {
		return "", err
	}
	basePath, err := server.PathPrefix(buildRoot)
	if err != nil {
		return "", err
	}
	command, err := resolveJekyllPreviewBuildCommand(projectRoot, siteRoot, buildRoot, server.base, basePath)
	if err != nil {
		return "", err
	}

	if err := runJekyllPreviewBuildCommand(ctx, siteRoot, command); err != nil {
		return "", err
	}

	return buildRoot, nil
}

func runJekyllPreviewBuildCommand(ctx context.Context, siteRoot string, command jekyllPreviewBuildCommand) error {
	output, err := runLocalPreviewCommand(ctx, siteRoot, command)
	if err == nil {
		return nil
	}
	if localPreviewDisableDiskCacheUnsupported(output) {
		command.args = removeStringArg(command.args, "--disable-disk-cache")
		output, err = runLocalPreviewCommand(ctx, siteRoot, command)
		if err == nil {
			return nil
		}
	}
	if err == context.DeadlineExceeded {
		return fmt.Errorf("Jekyll preview build timed out after %s", localPreviewJekyllTimeout)
	}
	return fmt.Errorf("Jekyll preview build failed: %w%s%s", err, formatLocalPreviewCommandOutput(output), localPreviewJekyllBuildHint(output, siteRoot))
}

func runLocalPreviewCommand(ctx context.Context, siteRoot string, command jekyllPreviewBuildCommand) (string, error) {
	buildCtx, cancel := context.WithTimeout(ctx, localPreviewJekyllTimeout)
	defer cancel()
	cmd := exec.CommandContext(buildCtx, command.path, command.args...)
	cmd.Dir = siteRoot
	cmd.Env = command.env
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	err := cmd.Run()
	if buildCtx.Err() == context.DeadlineExceeded {
		return output.String(), buildCtx.Err()
	}
	return output.String(), err
}

func localPreviewDisableDiskCacheUnsupported(output string) bool {
	output = strings.ToLower(output)
	return strings.Contains(output, "disable-disk-cache") &&
		(strings.Contains(output, "invalid option") ||
			strings.Contains(output, "unknown option") ||
			strings.Contains(output, "unrecognized option"))
}

func removeStringArg(args []string, value string) []string {
	result := args[:0]
	for _, arg := range args {
		if arg == value {
			continue
		}
		result = append(result, arg)
	}
	return result
}

func (a *App) prepareJekyllPreviewBuildDirLocked(siteRoot string) (string, error) {
	if a.localPreviewBuildDirs == nil {
		a.localPreviewBuildDirs = make(map[string]string)
	}
	key := filepath.Clean(siteRoot)
	buildRoot := a.localPreviewBuildDirs[key]
	if buildRoot == "" {
		dir, err := os.MkdirTemp("", "arlecchino-jekyll-preview-*")
		if err != nil {
			return "", err
		}
		buildRoot = dir
		a.localPreviewBuildDirs[key] = buildRoot
	}
	if err := cleanLocalPreviewBuildDir(buildRoot); err != nil {
		return "", err
	}
	return buildRoot, nil
}

func cleanLocalPreviewBuildDir(buildRoot string) error {
	entries, err := os.ReadDir(buildRoot)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(buildRoot, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) cleanupLocalPreviewBuildDirs() {
	if a == nil {
		return
	}

	a.localPreviewBuildMu.Lock()
	dirs := make([]string, 0, len(a.localPreviewBuildDirs))
	for _, dir := range a.localPreviewBuildDirs {
		dirs = append(dirs, dir)
	}
	a.localPreviewBuildDirs = nil
	a.localPreviewBuildMu.Unlock()

	for _, dir := range dirs {
		_ = os.RemoveAll(dir)
	}
}

func resolveJekyllPreviewBuildCommand(projectRoot string, siteRoot string, buildRoot string, siteURL string, basePath string) (jekyllPreviewBuildCommand, error) {
	args := []string{
		"build",
		"--source", siteRoot,
		"--destination", buildRoot,
		"--trace",
		"--disable-disk-cache",
		"--url", siteURL,
		"--baseurl", basePath,
	}

	if fileExists(filepath.Join(siteRoot, "Gemfile")) {
		resolution := toolchain.ResolveExecutable(projectRoot, siteRoot, "bundle")
		if resolution.Available() {
			env := appendJekyllPreviewEnv(toolchain.CommandEnv(resolution), filepath.Join(siteRoot, "Gemfile"))
			return jekyllPreviewBuildCommand{
				path: resolution.Path,
				args: append([]string{"exec", "jekyll"}, args...),
				env:  env,
			}, nil
		}
	}

	resolution := toolchain.ResolveExecutable(projectRoot, siteRoot, "jekyll")
	if !resolution.Available() {
		return jekyllPreviewBuildCommand{}, fmt.Errorf("Jekyll preview requires Bundler or Jekyll to be available locally")
	}
	return jekyllPreviewBuildCommand{
		path: resolution.Path,
		args: args,
		env:  appendJekyllPreviewEnv(toolchain.CommandEnv(resolution), ""),
	}, nil
}

func appendJekyllPreviewEnv(env []string, gemfile string) []string {
	filtered := make([]string, 0, len(env)+2)
	for _, value := range env {
		if strings.HasPrefix(value, "JEKYLL_ENV=") || strings.HasPrefix(value, "BUNDLE_GEMFILE=") {
			continue
		}
		filtered = append(filtered, value)
	}
	filtered = append(filtered, "JEKYLL_ENV=development")
	if gemfile != "" {
		filtered = append(filtered, "BUNDLE_GEMFILE="+gemfile)
	}
	return filtered
}

func formatLocalPreviewCommandOutput(output string) string {
	output = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(output, "\r\n", "\n"), "\r", "\n"))
	if output == "" {
		return ""
	}
	if len(output) > localPreviewOutputLimit {
		output = "..." + output[len(output)-localPreviewOutputLimit:]
	}
	return "\n\n" + output
}

func localPreviewJekyllBuildHint(output string, siteRoot string) string {
	normalized := strings.ToLower(output)
	if strings.Contains(normalized, "install missing gem executables") ||
		strings.Contains(normalized, "could not find gem") ||
		strings.Contains(normalized, "bundler: command not found: jekyll") {
		return "\n\nRun `bundle install` in " + siteRoot + " and retry the preview."
	}
	return ""
}

func chooseJekyllPreviewPath(siteRoot string, sourcePath string, buildRoot string) (string, error) {
	if !isJekyllTemplateSource(siteRoot, sourcePath) {
		if candidate, ok := jekyllOutputPathForSource(siteRoot, sourcePath, buildRoot); ok {
			return candidate, nil
		}
	}
	if fileExists(filepath.Join(buildRoot, "index.html")) {
		return filepath.Join(buildRoot, "index.html"), nil
	}
	if fileExists(filepath.Join(buildRoot, "404.html")) {
		return filepath.Join(buildRoot, "404.html"), nil
	}

	var firstHTML string
	err := filepath.WalkDir(buildRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == buildRoot {
			return nil
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Ext(name), ".html") {
			firstHTML = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if firstHTML != "" {
		return firstHTML, nil
	}
	return "", fmt.Errorf("Jekyll preview build did not produce an HTML page")
}

func isJekyllTemplateSource(siteRoot string, sourcePath string) bool {
	rel, err := filepath.Rel(siteRoot, sourcePath)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	return jekyllRelativePathHasSegment(rel, "_includes") || jekyllRelativePathHasSegment(rel, "_layouts")
}

func jekyllOutputPathForSource(siteRoot string, sourcePath string, buildRoot string) (string, bool) {
	rel, err := filepath.Rel(siteRoot, sourcePath)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	if rel == "." || strings.HasPrefix(rel, "../") || rel == ".." {
		return "", false
	}
	lowerRel := strings.ToLower(rel)
	switch {
	case strings.HasSuffix(lowerRel, ".html.liquid"):
		rel = rel[:len(rel)-len(".liquid")]
	case strings.HasSuffix(lowerRel, ".md"):
		rel = rel[:len(rel)-len(".md")] + ".html"
	case strings.HasSuffix(lowerRel, ".markdown"):
		rel = rel[:len(rel)-len(".markdown")] + ".html"
	}
	candidate := filepath.Join(buildRoot, filepath.FromSlash(rel))
	if fileExists(candidate) {
		return candidate, true
	}
	return "", false
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func (a *App) ensureLocalPreviewServer() (*localPreviewServer, error) {
	if a == nil {
		return nil, fmt.Errorf("app is unavailable")
	}

	a.localPreviewMu.Lock()
	defer a.localPreviewMu.Unlock()
	if a.localPreviewServer != nil {
		return a.localPreviewServer, nil
	}

	server, err := newLocalPreviewServer()
	if err != nil {
		return nil, err
	}
	a.localPreviewServer = server
	return server, nil
}

func (a *App) stopLocalPreviewServer() {
	if a == nil {
		return
	}

	a.localPreviewMu.Lock()
	server := a.localPreviewServer
	a.localPreviewServer = nil
	a.localPreviewMu.Unlock()
	if server == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = server.Close(ctx)
	a.cleanupLocalPreviewBuildDirs()
}

func newLocalPreviewServer() (*localPreviewServer, error) {
	token, err := randomLocalPreviewToken()
	if err != nil {
		return nil, err
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	preview := &localPreviewServer{
		token:      token,
		base:       "http://" + listener.Addr().String(),
		projects:   make(map[string]localPreviewProject),
		projectKey: make(map[string]string),
	}
	httpServer := &http.Server{
		Handler:           preview,
		ReadHeaderTimeout: localPreviewReadTimeout,
		WriteTimeout:      localPreviewWriteTimeout,
		IdleTimeout:       localPreviewIdleTimeout,
		MaxHeaderBytes:    localPreviewMaxHeaderBytes,
	}
	preview.server = httpServer

	go func() {
		if err := httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Fprintf(os.Stderr, "[ARLE] local preview server stopped unexpectedly: %v\n", err)
		}
	}()

	return preview, nil
}

func randomLocalPreviewToken() (string, error) {
	buf := make([]byte, localPreviewTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *localPreviewServer) Close(ctx context.Context) error {
	if s == nil || s.server == nil {
		return nil
	}
	return s.server.Shutdown(ctx)
}

func (s *localPreviewServer) URL(projectRoot string, filePath string) (string, error) {
	if s == nil {
		return "", fmt.Errorf("local preview server is unavailable")
	}
	projectRoot, err := normalizeRequiredPath(projectRoot, "project path")
	if err != nil {
		return "", err
	}
	filePath, err = normalizeRequiredPath(filePath, "file path")
	if err != nil {
		return "", err
	}
	if err := ensurePathWithinProject(projectRoot, filePath); err != nil {
		return "", err
	}

	key, err := s.registerProject(projectRoot)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(projectRoot, filePath)
	if err != nil {
		return "", err
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	if rel == "." || strings.HasPrefix(rel, "../") || rel == ".." {
		return "", fmt.Errorf("file path is outside current project: %s", filePath)
	}
	if !localPreviewRelativePathAllowed(rel) {
		return "", fmt.Errorf("preview path is not allowed: %s", filePath)
	}

	escapedRel := escapePreviewPathSegments(rel)
	return fmt.Sprintf("%s%s/%s/%s/%s", s.base, localPreviewURLPrefix, s.token, key, escapedRel), nil
}

func (s *localPreviewServer) PathPrefix(projectRoot string) (string, error) {
	if s == nil {
		return "", fmt.Errorf("local preview server is unavailable")
	}
	projectRoot, err := normalizeRequiredPath(projectRoot, "project path")
	if err != nil {
		return "", err
	}
	key, err := s.registerProject(projectRoot)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s/%s", localPreviewURLPrefix, s.token, key), nil
}

func (s *localPreviewServer) registerProject(projectRoot string) (string, error) {
	realRoot, err := filepath.EvalSymlinks(projectRoot)
	if err != nil {
		return "", err
	}
	realRoot = filepath.Clean(realRoot)

	s.mu.Lock()
	defer s.mu.Unlock()
	if key := s.projectKey[realRoot]; key != "" {
		return key, nil
	}

	sum := sha256.Sum256([]byte(s.token + "\x00" + realRoot))
	key := base64.RawURLEncoding.EncodeToString(sum[:localPreviewProjectKeyBytes])
	s.projectKey[realRoot] = key
	s.projects[key] = localPreviewProject{
		root:     filepath.Clean(projectRoot),
		realRoot: realRoot,
	}
	return key, nil
}

func escapePreviewPathSegments(value string) string {
	segments := strings.Split(value, "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}

func (s *localPreviewServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	project, relPath, ok := s.resolveRequestPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !localPreviewRelativePathAllowed(relPath) {
		http.NotFound(w, r)
		return
	}

	resolved, err := resolveProjectEntryPathInRoot(projectEntryResolvedRoot{
		Abs:      project.root,
		Resolved: project.realRoot,
	}, filepath.FromSlash(relPath), true)
	if err != nil || resolved.IsDirectory || resolved.Info == nil {
		http.NotFound(w, r)
		return
	}

	file, err := os.Open(resolved.Path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	if contentType := localPreviewContentType(resolved.Path); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, resolved.Info.Name(), resolved.Info.ModTime(), file)
}

func (s *localPreviewServer) resolveRequestPath(requestPath string) (localPreviewProject, string, bool) {
	cleanPath := path.Clean("/" + requestPath)
	prefix := localPreviewURLPrefix + "/"
	if !strings.HasPrefix(cleanPath, prefix) {
		return localPreviewProject{}, "", false
	}
	trimmed := strings.TrimPrefix(cleanPath, prefix)
	parts := strings.SplitN(trimmed, "/", 3)
	if len(parts) != 3 || parts[0] != s.token || parts[1] == "" || parts[2] == "" {
		return localPreviewProject{}, "", false
	}

	s.mu.RLock()
	project, ok := s.projects[parts[1]]
	s.mu.RUnlock()
	if !ok {
		return localPreviewProject{}, "", false
	}

	relPath := path.Clean("/" + parts[2])
	relPath = strings.TrimPrefix(relPath, "/")
	if relPath == "" || relPath == "." {
		return localPreviewProject{}, "", false
	}
	return project, relPath, true
}

func localPreviewRelativePathAllowed(relPath string) bool {
	relPath = path.Clean("/" + relPath)
	if relPath == "/" || strings.Contains(relPath, "\x00") {
		return false
	}
	for _, segment := range strings.Split(strings.TrimPrefix(relPath, "/"), "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}
	return true
}

func localPreviewContentType(filePath string) string {
	if strings.HasSuffix(strings.ToLower(filePath), ".html.liquid") {
		return "text/html; charset=utf-8"
	}
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == ".js" || ext == ".mjs" {
		return "text/javascript; charset=utf-8"
	}
	if ext == ".css" {
		return "text/css; charset=utf-8"
	}
	if ext == ".html" || ext == ".htm" {
		return "text/html; charset=utf-8"
	}
	return mime.TypeByExtension(ext)
}
