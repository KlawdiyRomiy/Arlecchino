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
}

func (e *Engine) NewDependencyTargetResolver() (*DependencyTargetResolver, error) {
	files, err := e.store.GetAllFiles()
	if err != nil {
		return nil, err
	}

	resolver := &DependencyTargetResolver{
		projectRoot:  filepath.Clean(e.projectRoot),
		store:        e.store,
		filesByPath:  make(map[string]File, len(files)),
		filesBySlash: make(map[string]string, len(files)),
		filesByLower: make(map[string]string, len(files)),
		goModulePath: readGoModulePath(e.projectRoot),
	}

	extensionSet := make(map[string]struct{}, 32)
	for path, file := range files {
		clean := filepath.Clean(path)
		resolver.filesByPath[clean] = file
		slash := filepath.ToSlash(clean)
		resolver.filesBySlash[slash] = clean
		resolver.filesByLower[strings.ToLower(slash)] = clean
		if ext := strings.ToLower(filepath.Ext(clean)); ext != "" {
			extensionSet[ext] = struct{}{}
		}
	}
	resolver.knownExtensions = sortedDependencyExtensions(extensionSet)
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
		target := cleanDependencyTarget(edge.ToSymbol)
		if shouldResolveViaSymbolIndex(target) {
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
		if path, ok := r.lookupProjectFile(targetPath); ok {
			results = append(results, ResolvedDependencyTarget{
				Edge:       edges[unresolvedIndexes[i]],
				TargetPath: path,
			})
		}
	}
	return results, nil
}

func (r *DependencyTargetResolver) ResolveEdge(fromPath string, edge Edge) (string, bool) {
	target := cleanDependencyTarget(edge.ToSymbol)
	if target == "" || isExternalDependencyTarget(target) {
		return "", false
	}

	for _, candidate := range r.dependencyCandidates(fromPath, target) {
		if path, ok := r.resolveCandidatePath(candidate); ok {
			return path, true
		}
	}

	return "", false
}

func (r *DependencyTargetResolver) dependencyCandidates(fromPath string, target string) []string {
	candidates := make([]string, 0, 12)
	add := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		candidates = append(candidates, path)
	}

	fromDir := filepath.Dir(filepath.Clean(fromPath))
	normalizedTarget := filepath.FromSlash(strings.ReplaceAll(target, "\\", "/"))

	if filepath.IsAbs(normalizedTarget) {
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
			add(filepath.Join(r.projectRoot, normalizedTarget))
			if strings.Contains(target, "/") {
				add(filepath.Join(fromDir, normalizedTarget))
			}
		}
	}

	if r.goModulePath != "" && (target == r.goModulePath || strings.HasPrefix(target, r.goModulePath+"/")) {
		add(filepath.Join(r.projectRoot, strings.TrimPrefix(strings.TrimPrefix(target, r.goModulePath), "/")))
	}
	if strings.HasPrefix(target, "package:") {
		packagePath := strings.TrimPrefix(target, "package:")
		if slash := strings.Index(packagePath, "/"); slash >= 0 && slash < len(packagePath)-1 {
			rest := packagePath[slash+1:]
			add(filepath.Join(r.projectRoot, "lib", rest))
			add(filepath.Join(r.projectRoot, rest))
		}
	}

	if strings.HasPrefix(target, "crate::") {
		add(filepath.Join(r.projectRoot, strings.ReplaceAll(strings.TrimPrefix(target, "crate::"), "::", "/")))
	}
	if strings.HasPrefix(target, "self::") {
		add(filepath.Join(fromDir, strings.ReplaceAll(strings.TrimPrefix(target, "self::"), "::", "/")))
	}
	if strings.HasPrefix(target, "super::") {
		add(filepath.Join(filepath.Dir(fromDir), strings.ReplaceAll(strings.TrimPrefix(target, "super::"), "::", "/")))
	}

	if strings.Contains(target, ".") && !strings.Contains(target, "/") {
		add(filepath.Join(r.projectRoot, strings.ReplaceAll(target, ".", "/")))
	}
	if strings.Contains(target, "::") {
		add(filepath.Join(r.projectRoot, strings.ReplaceAll(target, "::", "/")))
	}

	return candidates
}

func (r *DependencyTargetResolver) resolveCandidatePath(candidate string) (string, bool) {
	clean := filepath.Clean(candidate)
	if !pathWithinDependencyRoot(clean, r.projectRoot) {
		return "", false
	}

	if path, ok := r.lookupProjectFile(clean); ok {
		return path, true
	}

	for _, expanded := range r.expandCandidatePath(clean) {
		if path, ok := r.lookupProjectFile(expanded); ok {
			return path, true
		}
	}

	return "", false
}

func (r *DependencyTargetResolver) expandCandidatePath(candidate string) []string {
	extensions := r.knownExtensions
	expanded := make([]string, 0, len(extensions)*3+4)
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
		strings.HasPrefix(lower, "//")
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

func sortedDependencyExtensions(extensionSet map[string]struct{}) []string {
	commonOrder := map[string]int{
		".ts": 1, ".tsx": 2, ".js": 3, ".jsx": 4, ".mjs": 5, ".cjs": 6,
		".vue": 7, ".svelte": 8, ".astro": 9,
		".go": 10, ".py": 11, ".pyi": 12, ".rb": 13, ".php": 14,
		".rs": 15, ".java": 16, ".kt": 17, ".kts": 18, ".cs": 19, ".fs": 20,
		".c": 21, ".h": 22, ".cpp": 23, ".hpp": 24, ".cc": 25, ".hh": 26,
		".swift": 27, ".dart": 28, ".sol": 29, ".gd": 30, ".zig": 31,
		".html": 32, ".css": 33, ".scss": 34, ".sass": 35, ".less": 36,
		".json": 37, ".yaml": 38, ".yml": 39, ".xml": 40, ".md": 41,
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
