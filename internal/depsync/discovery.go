package depsync

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"arlecchino/internal/workspace"
)

const depsyncDiscoveryMaxEntries = 50000

type manifestDir struct {
	Abs   string
	Rel   string
	Depth int
}

type manifestDiscoveryReport struct {
	Dirs       []manifestDir
	Warnings   []string
	Incomplete bool
}

func discoverManifestDirsReport(root string, r registry) (manifestDiscoveryReport, error) {
	return discoverManifestDirsWithReport(root, r, depsyncDiscoveryMaxEntries)
}

func discoverManifestDirsWithReport(root string, r registry, maxEntries int) (manifestDiscoveryReport, error) {
	names := manifestNameSet(r)
	scanner, err := workspace.NewScanner(root, workspace.ScannerOptions{
		MaxEntries:        maxEntries,
		IncludeDirs:       false,
		ContentSniffBytes: 0,
		UseGitIgnore:      true,
		SkipDirs: map[string]struct{}{
			".dart_tool": {},
			".gradle":    {},
			".swiftpm":   {},
			".terraform": {},
			".venv":      {},
			"out":        {},
			"target":     {},
			"venv":       {},
		},
	})
	if err != nil {
		return manifestDiscoveryReport{}, err
	}

	dirsByRel := make(map[string]manifestDir)
	addManifest := func(manifestRel string) error {
		dirRel := manifestDirRel(manifestRel)
		if _, exists := dirsByRel[dirRel]; exists {
			return nil
		}
		dirAbs, err := manifestWorkDir(root, manifestRel)
		if err != nil {
			return err
		}
		dirsByRel[dirRel] = manifestDir{
			Abs:   dirAbs,
			Rel:   dirRel,
			Depth: relDepth(dirRel),
		}
		return nil
	}

	for _, name := range sortedManifestNames(names) {
		if rel, ok := canonicalManifestRelPath(root, filepath.Join(root, name)); ok {
			if err := addManifest(rel); err != nil {
				return manifestDiscoveryReport{}, err
			}
		}
	}

	_, err = scanner.Walk(context.Background(), func(entry workspace.Entry) error {
		if entry.IsDirectory {
			return nil
		}
		if _, ok := names[entry.Name]; !ok {
			return nil
		}
		rel, ok := canonicalManifestRelPath(root, entry.Path)
		if !ok {
			return nil
		}
		return addManifest(rel)
	})
	report := manifestDiscoveryReport{}
	if err != nil {
		if !errors.Is(err, workspace.ErrScanBudgetExceeded) {
			return manifestDiscoveryReport{}, err
		}
		report.Incomplete = true
		report.Warnings = append(report.Warnings, fmt.Sprintf("Dependency manifest discovery stopped after %d entries; some nested manifests may be missing.", maxEntries))
	}

	dirs := make([]manifestDir, 0, len(dirsByRel))
	for _, dir := range dirsByRel {
		dirs = append(dirs, dir)
	}
	sort.Slice(dirs, func(i, j int) bool {
		if dirs[i].Depth != dirs[j].Depth {
			return dirs[i].Depth < dirs[j].Depth
		}
		return dirs[i].Rel < dirs[j].Rel
	})
	report.Dirs = dirs
	return report, nil
}

func manifestNameSet(r registry) map[string]struct{} {
	names := make(map[string]struct{})
	for _, spec := range r {
		for _, name := range spec.ManifestAnyOf {
			name = strings.TrimSpace(name)
			if name != "" {
				names[name] = struct{}{}
			}
		}
	}
	return names
}

func sortedManifestNames(names map[string]struct{}) []string {
	sorted := make([]string, 0, len(names))
	for name := range names {
		sorted = append(sorted, name)
	}
	sort.Strings(sorted)
	return sorted
}

func canonicalManifestRelPath(root, path string) (string, bool) {
	rootAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(root)))
	if err != nil || rootAbs == "" {
		return "", false
	}
	pathAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(path)))
	if err != nil || pathAbs == "" || !pathWithinRoot(rootAbs, pathAbs) {
		return "", false
	}
	info, err := os.Lstat(pathAbs)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", false
	}
	if !resolvedPathWithinRoot(rootAbs, filepath.Dir(pathAbs)) {
		return "", false
	}
	rel, err := filepath.Rel(rootAbs, pathAbs)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	if rel == "." || rel == "" || rel == ".." || strings.HasPrefix(rel, "../") {
		return "", false
	}
	return rel, true
}

func manifestWorkDir(projectPath, manifest string) (string, error) {
	rootAbs, err := filepath.Abs(filepath.Clean(strings.TrimSpace(projectPath)))
	if err != nil {
		return "", err
	}
	if rootAbs == "" {
		return "", fmt.Errorf("project path is required")
	}
	manifest = strings.TrimSpace(manifest)
	if manifest == "" {
		return "", fmt.Errorf("manifest path is required")
	}
	if filepath.IsAbs(manifest) {
		return "", fmt.Errorf("manifest path must be project-relative: %s", manifest)
	}
	manifestPath := filepath.Clean(filepath.FromSlash(manifest))
	if manifestPath == "." || manifestPath == ".." || strings.HasPrefix(manifestPath, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("manifest path escapes project: %s", manifest)
	}
	workDir := rootAbs
	if dir := filepath.Dir(manifestPath); dir != "." {
		workDir = filepath.Join(rootAbs, dir)
	}
	if !pathWithinRoot(rootAbs, workDir) {
		return "", fmt.Errorf("manifest path escapes project: %s", manifest)
	}
	if !resolvedPathWithinRoot(rootAbs, workDir) {
		return "", fmt.Errorf("manifest directory escapes project: %s", manifest)
	}
	return workDir, nil
}

func resolvedPathWithinRoot(root, path string) bool {
	rootEval := root
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		rootEval = resolved
	}
	pathEval, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	return pathWithinRoot(rootEval, pathEval)
}

func pathWithinRoot(root, path string) bool {
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	rel = filepath.ToSlash(rel)
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, "../"))
}

func manifestDirRel(manifestRel string) string {
	dir := filepath.ToSlash(filepath.Dir(filepath.FromSlash(manifestRel)))
	if dir == "." || dir == "" {
		return "."
	}
	return dir
}

func joinManifestRel(dirRel, name string) string {
	if dirRel == "." || dirRel == "" {
		return filepath.ToSlash(name)
	}
	return filepath.ToSlash(filepath.Join(filepath.FromSlash(dirRel), name))
}

func relDepth(rel string) int {
	if rel == "." || rel == "" {
		return 0
	}
	return len(strings.Split(filepath.ToSlash(rel), "/"))
}

func hasAncestorNodeManager(root, dirRel string) bool {
	current := filepath.ToSlash(filepath.Dir(filepath.FromSlash(dirRel)))
	for {
		if current == "." || current == "" {
			return dirHasNodeProject(root)
		}
		if dirHasNodeProject(filepath.Join(root, filepath.FromSlash(current))) {
			return true
		}
		current = filepath.ToSlash(filepath.Dir(filepath.FromSlash(current)))
	}
}

func dirHasNodeProject(dir string) bool {
	return fileExists(filepath.Join(dir, "package.json"))
}

func stringSliceContains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
