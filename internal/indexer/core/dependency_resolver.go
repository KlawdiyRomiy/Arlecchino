package core

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type ResolvedDependencyTarget struct {
	Edge       Edge
	TargetPath string
}

type DependencyTargetResolver struct {
	projectRoot     string
	store           *Store
	filesByPath     map[string]File
	filesBySlash    map[string]string
	filesByLower    map[string]string
	knownExtensions []string
	goModulePath    string
	dartPackageName string
}

const maxDependencyExtensions = 256

func (e *Engine) NewDependencyTargetResolver() (*DependencyTargetResolver, error) {
	files, err := e.store.GetAllFiles()
	if err != nil {
		return nil, err
	}

	resolver := &DependencyTargetResolver{
		projectRoot:     filepath.Clean(e.projectRoot),
		store:           e.store,
		filesByPath:     make(map[string]File, len(files)),
		filesBySlash:    make(map[string]string, len(files)),
		filesByLower:    make(map[string]string, len(files)),
		goModulePath:    readGoModulePath(e.projectRoot),
		dartPackageName: readDartPackageName(e.projectRoot),
	}

	e.mu.RLock()
	registeredSuffixes := make(map[string]struct{}, len(e.suffixMap))
	for suffix := range e.suffixMap {
		registeredSuffixes[suffix] = struct{}{}
	}
	e.mu.RUnlock()
	registeredExtensions := make(map[string]struct{}, len(registeredSuffixes))
	fallbackExtensions := make(map[string]struct{}, 32)
	for path, file := range files {
		clean := filepath.Clean(path)
		resolver.filesByPath[clean] = file
		slash := filepath.ToSlash(clean)
		resolver.filesBySlash[slash] = clean
		resolver.filesByLower[strings.ToLower(slash)] = clean
		for _, ext := range dependencyPathExtensions(clean) {
			if _, ok := registeredSuffixes[ext]; ok {
				registeredExtensions[ext] = struct{}{}
				delete(fallbackExtensions, ext)
				continue
			}
			if _, registered := registeredExtensions[ext]; !registered {
				fallbackExtensions[ext] = struct{}{}
			}
		}
	}
	resolver.knownExtensions = sortedDependencyExtensions(registeredExtensions)
	if len(resolver.knownExtensions) < maxDependencyExtensions {
		fallback := sortedDependencyExtensions(fallbackExtensions)
		remaining := maxDependencyExtensions - len(resolver.knownExtensions)
		if len(fallback) > remaining {
			fallback = fallback[:remaining]
		}
		resolver.knownExtensions = append(resolver.knownExtensions, fallback...)
	} else if len(resolver.knownExtensions) > maxDependencyExtensions {
		resolver.knownExtensions = resolver.knownExtensions[:maxDependencyExtensions]
	}
	return resolver, nil
}

func (e *Engine) ResolveDependencyTargets(fromPath string, edges []Edge) ([]ResolvedDependencyTarget, error) {
	resolver, err := e.NewDependencyTargetResolver()
	if err != nil {
		return nil, err
	}
	return resolver.ResolveEdges(fromPath, edges)
}

func (r *DependencyTargetResolver) ResolveEdges(fromPath string, edges []Edge) ([]ResolvedDependencyTarget, error) {
	results := make([]ResolvedDependencyTarget, 0, len(edges))
	unresolved := make([]string, 0, len(edges))
	unresolvedIndexes := make([]int, 0, len(edges))

	for i, edge := range edges {
		if targetPath, ok := r.ResolveEdge(fromPath, edge); ok {
			results = append(results, ResolvedDependencyTarget{Edge: edge, TargetPath: targetPath})
			continue
		}
		target := cleanDependencyTargetForSource(fromPath, edge.ToSymbol)
		if r.shouldResolveViaSymbolIndex(fromPath, target) {
			unresolved = append(unresolved, target)
			unresolvedIndexes = append(unresolvedIndexes, i)
		}
	}

	if len(unresolved) == 0 || r.store == nil {
		return results, nil
	}

	symbolResolved, err := r.store.ResolveImportFiles(unresolved)
	if err != nil {
		return results, err
	}
	for i, raw := range unresolved {
		targetPath, ok := symbolResolved[raw]
		if !ok {
			continue
		}
		if path, ok := r.lookupProjectFile(targetPath); ok && pathWithinDependencyRoot(path, r.projectRoot) {
			results = append(results, ResolvedDependencyTarget{
				Edge:       edges[unresolvedIndexes[i]],
				TargetPath: path,
			})
		}
	}
	return results, nil
}

func (r *DependencyTargetResolver) ResolveEdge(fromPath string, edge Edge) (string, bool) {
	target := cleanDependencyTargetForSource(fromPath, edge.ToSymbol)
	if target == "" || r.isExternalDependencyTargetForSource(fromPath, target) {
		return "", false
	}

	for _, candidate := range r.dependencyCandidates(fromPath, target) {
		if path, ok := r.resolveCandidatePath(fromPath, candidate); ok {
			return path, true
		}
	}

	return "", false
}

func (r *DependencyTargetResolver) dependencyCandidates(fromPath string, target string) []string {
	candidates := make([]string, 0, 12)
	seen := make(map[string]struct{}, 12)
	add := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		path = filepath.Clean(path)
		if _, ok := seen[path]; ok {
			return
		}
		seen[path] = struct{}{}
		candidates = append(candidates, path)
	}
	addProjectRelative := func(rel string) {
		rel = strings.TrimSpace(rel)
		if rel == "" {
			return
		}
		rel = filepath.FromSlash(strings.TrimPrefix(strings.ReplaceAll(rel, "\\", "/"), "/"))
		add(filepath.Join(r.projectRoot, rel))
		for _, sourceRoot := range dependencySourceRoots() {
			add(filepath.Join(r.projectRoot, sourceRoot, rel))
		}
	}

	fromDir := filepath.Dir(filepath.Clean(fromPath))
	normalizedTarget := filepath.FromSlash(strings.ReplaceAll(target, "\\", "/"))
	fromExt := strings.ToLower(filepath.Ext(fromPath))
	fromSlash := strings.ToLower(filepath.ToSlash(fromPath))

	if r.goModulePath != "" && (target == r.goModulePath || strings.HasPrefix(target, r.goModulePath+"/")) {
		add(filepath.Join(r.projectRoot, strings.TrimPrefix(strings.TrimPrefix(target, r.goModulePath), "/")))
	} else if fromExt == ".dart" && strings.HasPrefix(target, "package:") {
		packagePath := strings.TrimPrefix(target, "package:")
		if slash := strings.Index(packagePath, "/"); slash >= 0 && slash < len(packagePath)-1 && packagePath[:slash] == r.dartPackageName {
			rest := packagePath[slash+1:]
			add(filepath.Join(r.projectRoot, "lib", rest))
			add(filepath.Join(r.projectRoot, rest))
		}
	} else if strings.HasPrefix(target, "res://") && fromExt == ".gd" {
		addProjectRelative(strings.TrimPrefix(target, "res://"))
	} else if strings.HasPrefix(target, "/") {
		add(filepath.Join(r.projectRoot, strings.TrimPrefix(target, "/")))
	} else if filepath.IsAbs(normalizedTarget) {
		add(normalizedTarget)
	} else {
		switch {
		case strings.HasPrefix(target, "@/"):
			aliasTarget := strings.TrimPrefix(target, "@/")
			add(filepath.Join(r.projectRoot, aliasTarget))
			add(filepath.Join(r.projectRoot, "src", aliasTarget))
		case strings.HasPrefix(target, "~/"):
			aliasTarget := strings.TrimPrefix(target, "~/")
			add(filepath.Join(r.projectRoot, aliasTarget))
			add(filepath.Join(r.projectRoot, "src", aliasTarget))
		case strings.HasPrefix(target, "/"):
			add(filepath.Join(r.projectRoot, strings.TrimPrefix(target, "/")))
		case strings.HasPrefix(target, "."):
			add(filepath.Join(fromDir, normalizedTarget))
			if !strings.HasPrefix(target, "./") && !strings.HasPrefix(target, "../") {
				dots := 0
				for dots < len(target) && target[dots] == '.' {
					dots++
				}
				modulePath := strings.TrimLeft(target, ".")
				baseDir := fromDir
				for i := 1; i < dots; i++ {
					baseDir = filepath.Dir(baseDir)
				}
				if modulePath != "" {
					add(filepath.Join(baseDir, strings.ReplaceAll(modulePath, ".", "/")))
				}
			}
		default:
			if dependencyTargetLooksPathLike(target) || strings.Contains(target, ".") || strings.Contains(target, `\`) || bareDependencyTargetMayBeLocal(fromPath, target) {
				addProjectRelative(normalizedTarget)
			} else {
				add(filepath.Join(r.projectRoot, normalizedTarget))
			}
			if dependencyTargetLooksPathLike(target) || bareDependencyTargetMayBeLocal(fromPath, target) {
				add(filepath.Join(fromDir, normalizedTarget))
			}
		}
	}

	if strings.HasPrefix(target, "crate::") {
		for _, rel := range scopedDependencyPrefixes(strings.TrimPrefix(target, "crate::")) {
			addProjectRelative(rel)
		}
	}
	if strings.HasPrefix(target, "self::") {
		for _, rel := range scopedDependencyPrefixes(strings.TrimPrefix(target, "self::")) {
			add(filepath.Join(fromDir, rel))
		}
	}
	if strings.HasPrefix(target, "super::") {
		for _, rel := range scopedDependencyPrefixes(strings.TrimPrefix(target, "super::")) {
			add(filepath.Join(filepath.Dir(fromDir), rel))
		}
	}

	if strings.Contains(target, ".") && !strings.Contains(target, "/") {
		dotted := strings.ReplaceAll(target, ".", "/")
		addProjectRelative(dotted)
		if snake := dependencySnakePath(dotted); snake != dotted {
			addProjectRelative(snake)
		}
		if fromExt == ".clj" || fromExt == ".cljs" || fromExt == ".cljc" {
			addProjectRelative(strings.ReplaceAll(dotted, "-", "_"))
		}
		if fromExt == ".adb" || fromExt == ".ads" {
			addProjectRelative(strings.ToLower(strings.ReplaceAll(target, ".", "-")))
		}
	}
	if strings.Contains(target, "::") {
		namespacePath := strings.ReplaceAll(target, "::", "/")
		addProjectRelative(namespacePath)
		if snake := dependencySnakePath(namespacePath); snake != namespacePath {
			addProjectRelative(snake)
		}
	}

	if strings.HasSuffix(fromSlash, ".blade.php") {
		viewTarget := target
		viewRoot := "resources/views"
		if strings.HasPrefix(viewTarget, "component:") {
			viewTarget = strings.TrimPrefix(viewTarget, "component:")
			viewRoot = "resources/views/components"
		}
		viewTarget = strings.ReplaceAll(viewTarget, ".", "/")
		add(filepath.Join(r.projectRoot, viewRoot, filepath.FromSlash(viewTarget)))
	}
	if strings.HasSuffix(fromSlash, ".erb") {
		templateTarget := filepath.FromSlash(strings.TrimPrefix(strings.ReplaceAll(target, "\\", "/"), "/"))
		add(filepath.Join(r.projectRoot, "app", "views", templateTarget))
		if partial := dependencyPartialPath(templateTarget); partial != "" {
			add(filepath.Join(r.projectRoot, "app", "views", partial))
		}
	}

	if fromExt == ".scss" || fromExt == ".sass" {
		if partial := dependencyPartialPath(normalizedTarget); partial != "" {
			if strings.HasPrefix(target, ".") || !filepath.IsAbs(normalizedTarget) {
				add(filepath.Join(fromDir, partial))
			}
			addProjectRelative(filepath.ToSlash(partial))
		}
	}

	if (fromExt == ".erl" || fromExt == ".hrl") && strings.Contains(filepath.ToSlash(normalizedTarget), "/include/") {
		slashTarget := filepath.ToSlash(normalizedTarget)
		if marker := strings.Index(slashTarget, "/include/"); marker >= 0 {
			add(filepath.Join(r.projectRoot, filepath.FromSlash(slashTarget[marker+1:])))
			add(filepath.Join(r.projectRoot, "apps", filepath.FromSlash(slashTarget)))
		}
	}

	if fromExt == ".cmake" || strings.EqualFold(filepath.Base(fromPath), "CMakeLists.txt") {
		add(filepath.Join(r.projectRoot, "cmake", "Modules", normalizedTarget))
	}

	return candidates
}

func dependencySourceRoots() []string {
	return []string{
		"src",
		"lib",
		"app",
		"pkg",
		"source",
		"sources",
		"Sources",
		"resources/views",
		"app/views",
		"include",
		"test",
		"src/main/java",
		"src/main/kotlin",
		"src/main/scala",
		"src/main/groovy",
		"src/main/resources",
		"src/test/java",
		"src/test/kotlin",
		"src/test/scala",
	}
}

func scopedDependencyPrefixes(target string) []string {
	parts := strings.Split(strings.Trim(target, ":"), "::")
	paths := make([]string, 0, len(parts))
	for end := len(parts); end > 0; end-- {
		clean := make([]string, 0, end)
		for _, part := range parts[:end] {
			part = strings.TrimSpace(part)
			if part != "" {
				clean = append(clean, part)
			}
		}
		if len(clean) > 0 {
			paths = append(paths, filepath.Join(clean...))
		}
	}
	return paths
}

func dependencyPartialPath(target string) string {
	dir, base := filepath.Split(target)
	if base == "" || strings.HasPrefix(base, "_") {
		return ""
	}
	return filepath.Join(dir, "_"+base)
}

func dependencyTargetLooksPathLike(target string) bool {
	target = strings.ReplaceAll(target, "\\", "/")
	return strings.Contains(target, "/") || filepath.Ext(target) != ""
}

func bareDependencyTargetMayBeLocal(fromPath string, target string) bool {
	if target == "" || dependencyTargetLooksPathLike(target) || strings.ContainsAny(target, ".:") {
		return false
	}
	switch strings.ToLower(filepath.Ext(fromPath)) {
	case ".rs", ".zig", ".gleam", ".ml", ".mli", ".ex", ".exs", ".erl", ".hrl",
		".fs", ".fsi", ".fsx", ".pas", ".pp", ".inc", ".lisp", ".lsp", ".cl",
		".el", ".jl", ".lua", ".gd", ".swift", ".rb", ".rake", ".cob", ".cbl", ".cpy",
		".f", ".for", ".f90", ".f95", ".f03", ".adb", ".ads", ".scss", ".sass", ".tex",
		".ltx", ".sty", ".cls", ".asm", ".s", ".sql", ".pro", ".pl":
		return true
	default:
		return false
	}
}

func dependencySnakePath(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	parts := strings.Split(path, "/")
	for i, part := range parts {
		parts[i] = dependencyCamelToSnake(part)
	}
	return strings.Join(parts, "/")
}

func dependencyCamelToSnake(value string) string {
	if value == "" {
		return value
	}
	var b strings.Builder
	b.Grow(len(value) + 4)
	for i := 0; i < len(value); i++ {
		ch := value[i]
		if ch >= 'A' && ch <= 'Z' {
			if i > 0 {
				prev := value[i-1]
				nextLower := i+1 < len(value) && value[i+1] >= 'a' && value[i+1] <= 'z'
				prevWord := (prev >= 'a' && prev <= 'z') || (prev >= '0' && prev <= '9') || (prev >= 'A' && prev <= 'Z' && nextLower)
				if prevWord && prev != '_' && prev != '-' {
					b.WriteByte('_')
				}
			}
			ch += 'a' - 'A'
		}
		b.WriteByte(ch)
	}
	return b.String()
}

func (r *DependencyTargetResolver) resolveCandidatePath(fromPath string, candidate string) (string, bool) {
	clean := filepath.Clean(candidate)
	if !pathWithinDependencyRoot(clean, r.projectRoot) {
		return "", false
	}

	if path, ok := r.lookupProjectFile(clean); ok {
		return path, true
	}

	for _, expanded := range r.expandCandidatePath(fromPath, clean) {
		if path, ok := r.lookupProjectFile(expanded); ok {
			return path, true
		}
	}

	return "", false
}

func (r *DependencyTargetResolver) expandCandidatePath(fromPath string, candidate string) []string {
	extensions := r.knownExtensions
	expanded := make([]string, 0, len(extensions)*2+6)
	fromExt := strings.ToLower(filepath.Ext(fromPath))
	if fromExt == ".cmake" || strings.EqualFold(filepath.Base(fromPath), "CMakeLists.txt") {
		expanded = append(expanded, filepath.Join(candidate, "CMakeLists.txt"))
	}
	if fromExt == ".tf" || fromExt == ".tfvars" || fromExt == ".hcl" {
		expanded = append(expanded, filepath.Join(candidate, "main.tf"))
	}
	hasExt := filepath.Ext(candidate) != ""
	if !hasExt {
		for _, ext := range extensions {
			expanded = append(expanded, candidate+ext)
		}
	}

	for _, ext := range extensions {
		expanded = append(expanded, filepath.Join(candidate, "index"+ext))
	}
	expanded = append(expanded,
		filepath.Join(candidate, "mod.rs"),
		filepath.Join(candidate, "lib.rs"),
		filepath.Join(candidate, "__init__.py"),
	)
	return expanded
}

func (r *DependencyTargetResolver) lookupProjectFile(path string) (string, bool) {
	clean := filepath.Clean(path)
	if _, ok := r.filesByPath[clean]; ok {
		return clean, true
	}
	slash := filepath.ToSlash(clean)
	if actual, ok := r.filesBySlash[slash]; ok {
		return actual, true
	}
	actual, ok := r.filesByLower[strings.ToLower(slash)]
	return actual, ok
}

func cleanDependencyTarget(target string) string {
	target = strings.TrimSpace(target)
	target = strings.Trim(target, `"'<>`)
	if target == "" {
		return ""
	}
	if hash := strings.Index(target, "#"); hash >= 0 {
		target = target[:hash]
	}
	if query := strings.Index(target, "?"); query >= 0 {
		target = target[:query]
	}
	target = strings.TrimSpace(target)
	target = strings.Trim(target, `"'`)
	return target
}

func cleanDependencyTargetForSource(fromPath string, target string) string {
	target = cleanDependencyTarget(target)
	if strings.EqualFold(filepath.Ext(fromPath), ".php") || strings.HasSuffix(strings.ToLower(fromPath), ".blade.php") {
		target = strings.TrimSpace(strings.TrimPrefix(target, `\`))
		lower := strings.ToLower(target)
		for _, prefix := range []string{"function ", "const "} {
			if strings.HasPrefix(lower, prefix) {
				target = strings.TrimSpace(target[len(prefix):])
				break
			}
		}
	}
	return target
}

func isExternalDependencyTarget(target string) bool {
	lower := strings.ToLower(target)
	return lower == "" ||
		strings.HasPrefix(lower, "#") ||
		strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "data:") ||
		strings.HasPrefix(lower, "mailto:") ||
		strings.HasPrefix(lower, "tel:") ||
		strings.HasPrefix(lower, "npm:") ||
		strings.HasPrefix(lower, "jsr:") ||
		strings.HasPrefix(lower, "node:") ||
		strings.HasPrefix(lower, "dart:") ||
		strings.HasPrefix(lower, "builtin:") ||
		strings.HasPrefix(lower, "user://") ||
		strings.HasPrefix(lower, "uid://") ||
		strings.HasPrefix(lower, "//")
}

func (r *DependencyTargetResolver) isExternalDependencyTargetForSource(fromPath string, target string) bool {
	if isExternalDependencyTarget(target) {
		return true
	}
	if strings.HasPrefix(target, "package:") {
		if !strings.EqualFold(filepath.Ext(fromPath), ".dart") {
			return true
		}
		packagePath := strings.TrimPrefix(target, "package:")
		slash := strings.Index(packagePath, "/")
		return slash <= 0 || packagePath[:slash] != r.dartPackageName
	}
	if strings.EqualFold(filepath.Ext(fromPath), ".go") && r.goModulePath != "" {
		return target != r.goModulePath && !strings.HasPrefix(target, r.goModulePath+"/")
	}
	return false
}

func (r *DependencyTargetResolver) shouldResolveViaSymbolIndex(fromPath string, target string) bool {
	if strings.HasPrefix(target, "package:") {
		if !strings.EqualFold(filepath.Ext(fromPath), ".dart") {
			return false
		}
		packagePath := strings.TrimPrefix(target, "package:")
		slash := strings.Index(packagePath, "/")
		return slash > 0 && packagePath[:slash] == r.dartPackageName
	}
	if strings.EqualFold(filepath.Ext(fromPath), ".go") && r.goModulePath != "" {
		if target != r.goModulePath && !strings.HasPrefix(target, r.goModulePath+"/") {
			return false
		}
	}
	return shouldResolveViaSymbolIndex(target)
}

func shouldResolveViaSymbolIndex(target string) bool {
	if target == "" || isExternalDependencyTarget(target) {
		return false
	}
	if strings.Contains(target, `\`) ||
		strings.Contains(target, "::") ||
		strings.Contains(target, ".") ||
		strings.Contains(target, "/") ||
		strings.HasPrefix(target, "component:") {
		return true
	}
	first := rune(target[0])
	return first >= 'A' && first <= 'Z'
}

func pathWithinDependencyRoot(path, root string) bool {
	path = filepath.Clean(path)
	root = filepath.Clean(root)
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func readGoModulePath(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "module ") {
			return strings.TrimSpace(strings.TrimPrefix(line, "module "))
		}
	}
	return ""
}

func readDartPackageName(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "pubspec.yaml"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "name:") {
			continue
		}
		name := strings.TrimSpace(strings.TrimPrefix(line, "name:"))
		if comment := strings.Index(name, " #"); comment >= 0 {
			name = name[:comment]
		}
		return strings.Trim(strings.TrimSpace(name), `"'`)
	}
	return ""
}

func dependencyPathExtensions(path string) []string {
	base := strings.ToLower(filepath.Base(path))
	extensions := make([]string, 0, 2)
	if ext := filepath.Ext(base); ext != "" {
		extensions = append(extensions, ext)
	}
	for _, compound := range []string{".blade.php", ".html.erb", ".env.local", ".env.example"} {
		if strings.HasSuffix(base, compound) && (len(extensions) == 0 || extensions[0] != compound) {
			extensions = append(extensions, compound)
		}
	}
	return extensions
}

func sortedDependencyExtensions(extensionSet map[string]struct{}) []string {
	commonOrder := map[string]int{
		".ts": 1, ".tsx": 2, ".js": 3, ".jsx": 4, ".mjs": 5, ".cjs": 6,
		".vue": 7, ".svelte": 8, ".astro": 9,
		".go": 10, ".py": 11, ".pyi": 12, ".rb": 13, ".html.erb": 13, ".php": 14, ".blade.php": 14,
		".rs": 15, ".java": 16, ".kt": 17, ".kts": 18, ".cs": 19, ".fs": 20,
		".c": 21, ".h": 22, ".cpp": 23, ".hpp": 24, ".cc": 25, ".hh": 26,
		".swift": 27, ".dart": 28, ".sol": 29, ".gd": 30, ".zig": 31,
		".html": 32, ".css": 33, ".scss": 34, ".sass": 35, ".less": 36,
		".json": 37, ".yaml": 38, ".yml": 39, ".xml": 40, ".md": 41,
	}
	for _, ext := range []string{
		".htm", ".xhtml", ".blade.php", ".sql", ".pyw", ".pyx", ".sh", ".bash", ".zsh", ".fish",
		".csx", ".cxx", ".hxx", ".ps1", ".psm1", ".psd1", ".phtml", ".php3", ".php4", ".php5", ".phps",
		".mod", ".sum", ".work", ".lua", ".asm", ".s", ".m", ".r", ".rmd", ".groovy", ".gradle", ".vb", ".vbs",
		".bas", ".cls", ".frm", ".mat", ".pm", ".pod", ".t", ".ex", ".exs", ".scala", ".sc", ".pas", ".pp",
		".inc", ".dpr", ".lisp", ".lsp", ".cl", ".el", ".erl", ".hrl", ".f", ".for", ".f90", ".f95", ".f03",
		".adb", ".ads", ".fsi", ".fsx", ".ml", ".mli", ".gleam", ".pro", ".p", ".cob", ".cbl", ".cpy", ".hs",
		".lhs", ".jl", ".clj", ".cljs", ".cljc", ".edn", ".mm", ".jsonc", ".json5", ".xsl", ".xsd", ".svg",
		".wsdl", ".toml", ".ini", ".cfg", ".conf", ".nginx", ".diff", ".patch", ".dockerfile", ".markdown", ".mdx",
		".tf", ".tfvars", ".hcl", ".mk", ".cmake", ".tex", ".ltx", ".sty", ".wgsl", ".glsl", ".vert", ".frag",
		".geom", ".env", ".env.local", ".env.example",
	} {
		if _, exists := commonOrder[ext]; !exists {
			commonOrder[ext] = 100
		}
	}

	extensions := make([]string, 0, len(extensionSet))
	for ext := range extensionSet {
		extensions = append(extensions, ext)
	}
	sort.Slice(extensions, func(i, j int) bool {
		pi, iok := commonOrder[extensions[i]]
		pj, jok := commonOrder[extensions[j]]
		if iok && jok && pi != pj {
			return pi < pj
		}
		if iok != jok {
			return iok
		}
		return extensions[i] < extensions[j]
	})
	return extensions
}
