package toolchain

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type Resolution struct {
	RootPath string
	WorkDir  string
	Name     string
	Path     string
	PathDirs []string
	Reason   string
}

func (r Resolution) Available() bool {
	return strings.TrimSpace(r.Path) != "" && strings.TrimSpace(r.Reason) == ""
}

func ResolveExecutable(rootPath, workDir, name string) Resolution {
	rootPath = cleanPath(rootPath)
	workDir = cleanPath(workDir)
	name = strings.TrimSpace(name)
	resolution := Resolution{RootPath: rootPath, WorkDir: workDir, Name: name}
	if name == "" {
		resolution.Reason = "missing executable"
		return resolution
	}

	if filepath.Base(name) != name || strings.HasPrefix(name, ".") {
		return resolvePathExecutable(resolution)
	}

	if path, err := exec.LookPath(name); err == nil && ExecutableFileExists(path) && !executablePathInsideRoot(rootPath, path) {
		resolution.Path = path
		resolution.PathDirs = commandPathDirs(path, rootPath, workDir)
		return resolution
	}

	for _, dir := range CandidateDirs(rootPath, workDir) {
		candidate := filepath.Join(dir, name)
		if ExecutableFileExists(candidate) {
			resolution.Path = candidate
			resolution.PathDirs = commandPathDirs(candidate, rootPath, workDir)
			return resolution
		}
	}

	resolution.Reason = fmt.Sprintf("missing executable %s", name)
	return resolution
}

func CommandEnv(resolution Resolution) []string {
	pathDirs := append([]string(nil), resolution.PathDirs...)
	if resolution.Path != "" {
		if dir := filepath.Dir(resolution.Path); dir != "." && dir != "" {
			pathDirs = append(pathDirs, dir)
		}
	}
	pathDirs = append(pathDirs, RuntimeDirs()...)
	pathDirs = uniqueStrings(pathDirs)
	if len(pathDirs) == 0 {
		return os.Environ()
	}

	env := os.Environ()
	pathValue := strings.Join(pathDirs, string(os.PathListSeparator))
	if existing := filteredExistingPath(resolution.RootPath); existing != "" {
		pathValue += string(os.PathListSeparator) + existing
	}
	hasPath := false
	for idx, value := range env {
		if strings.HasPrefix(value, "PATH=") {
			env[idx] = "PATH=" + pathValue
			hasPath = true
			break
		}
	}
	if !hasPath {
		env = append(env, "PATH="+pathValue)
	}
	return env
}

func CandidateDirs(rootPath, workDir string) []string {
	var candidates []string
	add := func(parts ...string) {
		path := filepath.Join(parts...)
		if strings.TrimSpace(path) != "" {
			candidates = append(candidates, path)
		}
	}
	addRaw := func(path string) {
		if strings.TrimSpace(path) != "" {
			candidates = append(candidates, path)
		}
	}
	addGlob := func(pattern string) {
		matches, _ := filepath.Glob(pattern)
		for i := len(matches) - 1; i >= 0; i-- {
			addRaw(matches[i])
		}
	}

	if home, _ := os.UserHomeDir(); home != "" {
		if composerHome := os.Getenv("COMPOSER_HOME"); composerHome != "" {
			add(composerHome, "vendor", "bin")
		}
		add(home, ".composer", "vendor", "bin")
		add(home, ".config", "composer", "vendor", "bin")
		add(home, "Library", "Application Support", "Composer", "vendor", "bin")
		addGlob(filepath.Join(home, ".gem", "ruby", "*", "bin"))
		addGlob(filepath.Join(home, "Library", "Python", "*", "bin"))
	}
	candidates = append(candidates, RuntimeDirs()...)
	addGlob(filepath.Join("/Library", "Ruby", "Gems", "*", "bin"))
	return filterWorkspaceDirs(rootPath, uniqueStrings(candidates))
}

func RuntimeDirs() []string {
	var candidates []string
	add := func(parts ...string) {
		path := filepath.Join(parts...)
		if strings.TrimSpace(path) != "" {
			candidates = append(candidates, path)
		}
	}
	addRaw := func(path string) {
		if strings.TrimSpace(path) != "" {
			candidates = append(candidates, path)
		}
	}
	addGlob := func(pattern string) {
		matches, _ := filepath.Glob(pattern)
		for i := len(matches) - 1; i >= 0; i-- {
			addRaw(matches[i])
		}
	}

	if npmPrefix := strings.TrimSpace(os.Getenv("NPM_CONFIG_PREFIX")); npmPrefix != "" {
		add(npmPrefix, "bin")
	}
	if home, _ := os.UserHomeDir(); home != "" {
		add(home, ".local", "bin")
		add(home, "go", "bin")
		add(home, ".cargo", "bin")
		add(home, ".npm-global", "bin")
		add(home, ".volta", "bin")
		add(home, ".asdf", "shims")
		add(home, ".pyenv", "shims")
		add(home, ".rbenv", "shims")
		add(home, ".bun", "bin")
		add(home, ".dotnet", "tools")
		add(home, ".opam", "default", "bin")
		add(home, ".cabal", "bin")
		add(home, ".ghcup", "bin")
		add(home, ".local", "share", "mise", "shims")
		add(home, ".config", "mise", "shims")
		add(home, "Library", "pnpm")
		add(home, ".local", "share", "pnpm")
		add(home, "Library", "Application Support", "Coursier", "bin")
		add(home, ".local", "share", "coursier", "bin")
		addGlob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin"))
		addGlob(filepath.Join(home, ".sdkman", "candidates", "*", "current", "bin"))
	}
	addRaw("/opt/homebrew/bin")
	addRaw("/opt/homebrew/sbin")
	addRaw("/usr/local/bin")
	addRaw("/usr/local/sbin")
	addRaw("/usr/bin")
	addRaw("/bin")
	addRaw("/usr/sbin")
	addRaw("/sbin")
	return uniqueStrings(candidates)
}

func ExecutableFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode()&0o111 != 0
}

func resolvePathExecutable(resolution Resolution) Resolution {
	name := resolution.Name
	candidate := name
	if !filepath.IsAbs(candidate) {
		if resolution.WorkDir == "" {
			resolution.Reason = "work directory is required"
			return resolution
		}
		candidate = filepath.Join(resolution.WorkDir, filepath.FromSlash(candidate))
	}
	candidate = filepath.Clean(candidate)

	if resolution.RootPath != "" && !pathWithinRoot(resolution.RootPath, candidate) {
		resolution.Reason = fmt.Sprintf("executable escapes project: %s", name)
		return resolution
	}
	if !resolvedPathWithinRoot(resolution.RootPath, candidate) {
		resolution.Reason = fmt.Sprintf("executable escapes project: %s", name)
		return resolution
	}
	if !ExecutableFileExists(candidate) {
		resolution.Reason = fmt.Sprintf("missing executable %s", name)
		return resolution
	}
	resolution.Path = candidate
	resolution.PathDirs = commandPathDirs(candidate, resolution.RootPath, resolution.WorkDir)
	return resolution
}

func commandPathDirs(path, rootPath, workDir string) []string {
	dirs := []string{}
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		dirs = append(dirs, dir)
	}
	dirs = append(dirs, CandidateDirs(rootPath, workDir)...)
	return uniqueStrings(dirs)
}

func cleanPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return filepath.Clean(path)
	}
	return abs
}

func pathWithinRoot(root, path string) bool {
	if root == "" {
		return true
	}
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	if path == root {
		return true
	}
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != "." && rel != "" && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

func resolvedPathWithinRoot(root, path string) bool {
	if root == "" {
		return true
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return pathWithinRoot(root, path)
	}
	return pathWithinRoot(root, resolved)
}

func executablePathInsideRoot(root, path string) bool {
	if root == "" || path == "" {
		return false
	}
	candidate := path
	if !filepath.IsAbs(candidate) {
		if abs, err := filepath.Abs(candidate); err == nil {
			candidate = abs
		}
	}
	if pathWithinRoot(root, candidate) {
		return true
	}
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return false
	}
	return pathWithinRoot(root, resolved)
}

func filterWorkspaceDirs(root string, dirs []string) []string {
	if root == "" {
		return dirs
	}
	result := make([]string, 0, len(dirs))
	for _, dir := range dirs {
		if executablePathInsideRoot(root, dir) {
			continue
		}
		result = append(result, dir)
	}
	return result
}

func filteredExistingPath(root string) string {
	existing := os.Getenv("PATH")
	if existing == "" {
		return ""
	}
	return strings.Join(filterWorkspaceDirs(root, filepath.SplitList(existing)), string(os.PathListSeparator))
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}
