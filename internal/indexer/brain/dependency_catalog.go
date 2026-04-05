package brain

import (
	"bufio"
	"encoding/json"
	"encoding/xml"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/indexer/core"
)

type dependencyEntry struct {
	Name    string
	Version string
	Detail  string
	Kind    core.SymbolKind
	Source  core.SymbolSource
	Insert  string
}

type dependencyCacheEntry struct {
	fingerprint string
	entries     []dependencyEntry
	loadedAt    time.Time
}

type dependencyCatalog struct {
	root          string
	mu            sync.RWMutex
	cache         map[string]dependencyCacheEntry
	commandRunner func(name string, args ...string) ([]byte, error)
}

func NewDependencyCatalog(root string) *dependencyCatalog {
	return &dependencyCatalog{
		root:          root,
		cache:         make(map[string]dependencyCacheEntry),
		commandRunner: defaultDependencyCommandRunner,
	}
}

func defaultDependencyCommandRunner(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

func (c *dependencyCatalog) Suggestions(language, prefix string) []Suggestion {
	entries := c.entriesForLanguage(language)
	if len(entries) == 0 {
		return nil
	}

	prefixLower := strings.ToLower(prefix)
	suggestions := make([]Suggestion, 0, len(entries))
	for _, entry := range entries {
		nameLower := strings.ToLower(entry.Name)
		if prefixLower != "" && !strings.HasPrefix(nameLower, prefixLower) && !strings.Contains(nameLower, prefixLower) {
			continue
		}
		suggestions = append(suggestions, Suggestion{
			Text:        entry.Name,
			DisplayText: entry.Name,
			Kind:        entry.Kind,
			Source:      entry.Source,
			Score:       0.92,
			Detail:      entry.Detail,
			InsertText:  entry.Insert,
			Namespace:   entry.Name,
		})
	}

	if len(suggestions) == 0 {
		return nil
	}

	sort.SliceStable(suggestions, func(i, j int) bool {
		if suggestions[i].Score == suggestions[j].Score {
			return suggestions[i].Text < suggestions[j].Text
		}
		return suggestions[i].Score > suggestions[j].Score
	})

	return suggestions
}

func (c *dependencyCatalog) ResolveLibraryByOwner(language, owner string) string {
	owner = strings.ToLower(strings.TrimSpace(owner))
	if owner == "" {
		return ""
	}

	for _, entry := range c.entriesForLanguage(language) {
		name := strings.TrimSpace(entry.Name)
		if name == "" {
			continue
		}

		if strings.ToLower(name) == owner {
			return name
		}

		if packageSuggestionIdentifier(name, language) == owner {
			return name
		}

		if idx := strings.LastIndex(name, "/"); idx >= 0 {
			if strings.ToLower(name[idx+1:]) == owner {
				return name
			}
		}
	}

	return ""
}

func (c *dependencyCatalog) entriesForLanguage(language string) []dependencyEntry {
	files := c.manifestFiles(language)
	fingerprint := c.manifestFingerprint(files)

	c.mu.RLock()
	if cached, ok := c.cache[language]; ok && cached.fingerprint == fingerprint {
		entries := append([]dependencyEntry(nil), cached.entries...)
		c.mu.RUnlock()
		return entries
	}
	c.mu.RUnlock()

	entries := c.loadEntries(language)

	c.mu.Lock()
	c.cache[language] = dependencyCacheEntry{
		fingerprint: fingerprint,
		entries:     append([]dependencyEntry(nil), entries...),
		loadedAt:    time.Now(),
	}
	c.mu.Unlock()

	return entries
}

func (c *dependencyCatalog) manifestFiles(language string) []string {
	if c.root == "" {
		return nil
	}

	switch normalizeDependencyLanguage(language) {
	case "go":
		return []string{filepath.Join(c.root, "go.mod")}
	case "node":
		return []string{filepath.Join(c.root, "package.json")}
	case "python":
		return []string{filepath.Join(c.root, "requirements.txt"), filepath.Join(c.root, "pyproject.toml")}
	case "php":
		return []string{filepath.Join(c.root, "composer.json")}
	case "rust":
		return []string{filepath.Join(c.root, "Cargo.toml")}
	case "ruby":
		return []string{filepath.Join(c.root, "Gemfile"), filepath.Join(c.root, "Gemfile.lock")}
	case "jvm":
		return []string{filepath.Join(c.root, "pom.xml"), filepath.Join(c.root, "build.gradle"), filepath.Join(c.root, "build.gradle.kts")}
	case "dotnet":
		return []string{filepath.Join(c.root, "packages.config")}
	case "dart":
		return []string{filepath.Join(c.root, "pubspec.yaml")}
	case "swift":
		return []string{filepath.Join(c.root, "Package.swift")}
	case "terraform":
		return []string{filepath.Join(c.root, ".terraform.lock.hcl")}
	default:
		return nil
	}
}

func (c *dependencyCatalog) manifestFingerprint(files []string) string {
	if len(files) == 0 {
		return ""
	}

	parts := make([]string, 0, len(files))
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil {
			parts = append(parts, file+":missing")
			continue
		}
		parts = append(parts, file+":"+info.ModTime().UTC().Format(time.RFC3339Nano)+":"+strconv.FormatInt(info.Size(), 10))
	}
	return strings.Join(parts, "|")
}

func (c *dependencyCatalog) loadEntries(language string) []dependencyEntry {
	entries := make([]dependencyEntry, 0, 32)
	entries = append(entries, c.loadManifestEntries(language)...)
	entries = append(entries, c.loadInstalledEntries(language)...)
	return dedupeDependencyEntries(entries)
}

func (c *dependencyCatalog) loadManifestEntries(language string) []dependencyEntry {
	if c.root == "" {
		return nil
	}

	switch normalizeDependencyLanguage(language) {
	case "go":
		return c.loadGoManifestEntries()
	case "node":
		return c.loadNodeManifestEntries()
	case "python":
		return c.loadPythonManifestEntries()
	case "php":
		return c.loadComposerManifestEntries()
	case "rust":
		return c.loadCargoManifestEntries()
	case "ruby":
		return c.loadGemfileEntries()
	case "jvm":
		return c.loadJVMEntries()
	case "dotnet":
		return c.loadDotNetEntries()
	case "dart":
		return c.loadPubspecEntries()
	case "swift":
		return c.loadSwiftPackageEntries()
	case "terraform":
		return c.loadTerraformEntries()
	default:
		return nil
	}
}

func (c *dependencyCatalog) loadInstalledEntries(language string) []dependencyEntry {
	if c.root == "" {
		return nil
	}
	if normalizeDependencyLanguage(language) != "node" {
		return nil
	}

	nodeModulesPath := filepath.Join(c.root, "node_modules")
	entries, err := os.ReadDir(nodeModulesPath)
	if err != nil {
		return nil
	}

	modules := make([]dependencyEntry, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, "@") {
			scopedPath := filepath.Join(nodeModulesPath, name)
			scopedEntries, err := os.ReadDir(scopedPath)
			if err != nil {
				continue
			}
			for _, scopedEntry := range scopedEntries {
				if !scopedEntry.IsDir() {
					continue
				}
				fullName := name + "/" + scopedEntry.Name()
				modules = append(modules, dependencyEntry{
					Name:   fullName,
					Detail: "installed package",
					Kind:   core.SymbolKindModule,
					Source: core.SourceLocal,
					Insert: quoteImportLiteral(fullName, language),
				})
			}
			continue
		}

		modules = append(modules, dependencyEntry{
			Name:   name,
			Detail: "installed package",
			Kind:   core.SymbolKindModule,
			Source: core.SourceLocal,
			Insert: quoteImportLiteral(name, language),
		})
	}

	return modules
}

func (c *dependencyCatalog) loadGoManifestEntries() []dependencyEntry {
	goModPath := filepath.Join(c.root, "go.mod")
	data, err := os.ReadFile(goModPath)
	if err != nil {
		return c.loadGoStdlibEntries()
	}

	entries := c.loadGoStdlibEntries()
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	inRequireBlock := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		if strings.HasPrefix(line, "require (") {
			inRequireBlock = true
			continue
		}
		if inRequireBlock {
			if line == ")" {
				inRequireBlock = false
				continue
			}
			entries = append(entries, goDependencyEntry(line))
			continue
		}
		if strings.HasPrefix(line, "require ") {
			entries = append(entries, goDependencyEntry(strings.TrimSpace(strings.TrimPrefix(line, "require "))))
		}
	}

	return dedupeDependencyEntries(entries)
}

func (c *dependencyCatalog) loadGoStdlibEntries() []dependencyEntry {
	if c.commandRunner == nil {
		return nil
	}

	output, err := c.commandRunner("go", "list", "std")
	if err != nil {
		return nil
	}

	lines := strings.Split(string(output), "\n")
	entries := make([]dependencyEntry, 0, len(lines))
	for _, line := range lines {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		entries = append(entries, dependencyEntry{
			Name:   name,
			Detail: "stdlib package",
			Kind:   core.SymbolKindPackage,
			Source: core.SourceLibrary,
			Insert: quoteImportLiteral(name, "go"),
		})
	}
	return entries
}

func (c *dependencyCatalog) loadNodeManifestEntries() []dependencyEntry {
	packageJSONPath := filepath.Join(c.root, "package.json")
	data, err := os.ReadFile(packageJSONPath)
	if err != nil {
		return nil
	}

	var manifest struct {
		Dependencies         map[string]string `json:"dependencies"`
		DevDependencies      map[string]string `json:"devDependencies"`
		PeerDependencies     map[string]string `json:"peerDependencies"`
		OptionalDependencies map[string]string `json:"optionalDependencies"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil
	}

	entries := make([]dependencyEntry, 0, len(manifest.Dependencies)+len(manifest.DevDependencies)+len(manifest.PeerDependencies)+len(manifest.OptionalDependencies))
	entries = append(entries, packageJSONEntries(manifest.Dependencies, "dependency")...)
	entries = append(entries, packageJSONEntries(manifest.DevDependencies, "devDependency")...)
	entries = append(entries, packageJSONEntries(manifest.PeerDependencies, "peerDependency")...)
	entries = append(entries, packageJSONEntries(manifest.OptionalDependencies, "optionalDependency")...)
	return dedupeDependencyEntries(entries)
}

func packageJSONEntries(deps map[string]string, detailPrefix string) []dependencyEntry {
	if len(deps) == 0 {
		return nil
	}
	entries := make([]dependencyEntry, 0, len(deps))
	for name, version := range deps {
		detail := detailPrefix
		if version != "" {
			detail += " " + version
		}
		entries = append(entries, dependencyEntry{
			Name:    name,
			Version: version,
			Detail:  detail,
			Kind:    core.SymbolKindModule,
			Source:  core.SourceLibrary,
			Insert:  quoteImportLiteral(name, "typescript"),
		})
	}
	return entries
}

func (c *dependencyCatalog) loadPythonManifestEntries() []dependencyEntry {
	entries := make([]dependencyEntry, 0, 16)
	requirementsPath := filepath.Join(c.root, "requirements.txt")
	if data, err := os.ReadFile(requirementsPath); err == nil {
		entries = append(entries, parseRequirementsEntries(string(data))...)
	}
	pyprojectPath := filepath.Join(c.root, "pyproject.toml")
	if data, err := os.ReadFile(pyprojectPath); err == nil {
		entries = append(entries, parsePyProjectEntries(string(data))...)
	}
	return dedupeDependencyEntries(entries)
}

func parseRequirementsEntries(data string) []dependencyEntry {
	scanner := bufio.NewScanner(strings.NewReader(data))
	entries := make([]dependencyEntry, 0, 8)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") {
			continue
		}
		name, version := splitVersionSpec(line)
		entries = append(entries, dependencyEntry{
			Name:    name,
			Version: version,
			Detail:  versionDetail("dependency", version),
			Kind:    core.SymbolKindModule,
			Source:  core.SourceLibrary,
			Insert:  name,
		})
	}
	return entries
}

func parsePyProjectEntries(data string) []dependencyEntry {
	entries := make([]dependencyEntry, 0, 8)
	scanner := bufio.NewScanner(strings.NewReader(data))
	inProjectDeps := false
	inPoetryDeps := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch line {
		case "[project]":
			inProjectDeps = false
			inPoetryDeps = false
		case "[tool.poetry.dependencies]":
			inProjectDeps = false
			inPoetryDeps = true
		case "[tool.poetry.group.dev.dependencies]":
			inProjectDeps = false
			inPoetryDeps = true
		default:
			if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
				inProjectDeps = false
				inPoetryDeps = false
			}
		}

		if strings.HasPrefix(line, "dependencies = [") {
			inProjectDeps = true
			continue
		}
		if inProjectDeps {
			if strings.HasPrefix(line, "]") {
				inProjectDeps = false
				continue
			}
			item := strings.Trim(strings.TrimSuffix(line, ","), `"'`)
			if item == "" {
				continue
			}
			name, version := splitVersionSpec(item)
			entries = append(entries, dependencyEntry{
				Name:    name,
				Version: version,
				Detail:  versionDetail("dependency", version),
				Kind:    core.SymbolKindModule,
				Source:  core.SourceLibrary,
				Insert:  name,
			})
			continue
		}

		if inPoetryDeps {
			if line == "" || strings.HasPrefix(line, "python =") || strings.HasPrefix(line, "#") {
				continue
			}
			name, value, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			depName := strings.TrimSpace(name)
			version := strings.Trim(strings.TrimSpace(value), `"'`)
			entries = append(entries, dependencyEntry{
				Name:    depName,
				Version: version,
				Detail:  versionDetail("dependency", version),
				Kind:    core.SymbolKindModule,
				Source:  core.SourceLibrary,
				Insert:  depName,
			})
		}
	}
	return entries
}

func (c *dependencyCatalog) loadComposerManifestEntries() []dependencyEntry {
	composerPath := filepath.Join(c.root, "composer.json")
	data, err := os.ReadFile(composerPath)
	if err != nil {
		return nil
	}

	var manifest struct {
		Require    map[string]string `json:"require"`
		RequireDev map[string]string `json:"require-dev"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil
	}

	entries := make([]dependencyEntry, 0, len(manifest.Require)+len(manifest.RequireDev))
	for name, version := range manifest.Require {
		if name == "php" {
			continue
		}
		entries = append(entries, dependencyEntry{Name: name, Version: version, Detail: versionDetail("composer", version), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
	}
	for name, version := range manifest.RequireDev {
		entries = append(entries, dependencyEntry{Name: name, Version: version, Detail: versionDetail("composer-dev", version), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
	}
	return entries
}

func (c *dependencyCatalog) loadCargoManifestEntries() []dependencyEntry {
	cargoPath := filepath.Join(c.root, "Cargo.toml")
	data, err := os.ReadFile(cargoPath)
	if err != nil {
		return nil
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	inDependencies := false
	entries := make([]dependencyEntry, 0, 16)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			inDependencies = line == "[dependencies]" || line == "[workspace.dependencies]"
			continue
		}
		if !inDependencies || line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		depName := strings.TrimSpace(name)
		version := strings.TrimSpace(value)
		version = strings.Trim(version, `"{ }`)
		entries = append(entries, dependencyEntry{
			Name:    depName,
			Version: version,
			Detail:  versionDetail("crate", version),
			Kind:    core.SymbolKindModule,
			Source:  core.SourceLibrary,
			Insert:  depName,
		})
	}
	return entries
}

func (c *dependencyCatalog) loadGemfileEntries() []dependencyEntry {
	gemfilePath := filepath.Join(c.root, "Gemfile")
	data, err := os.ReadFile(gemfilePath)
	if err != nil {
		return nil
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := make([]dependencyEntry, 0, 8)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "gem ") {
			continue
		}
		line = strings.TrimPrefix(line, "gem ")
		parts := strings.Split(line, ",")
		name := strings.Trim(parts[0], `"' `)
		version := ""
		if len(parts) > 1 {
			version = strings.Trim(parts[1], `"' `)
		}
		entries = append(entries, dependencyEntry{Name: name, Version: version, Detail: versionDetail("gem", version), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
	}
	return entries
}

type pomProject struct {
	Dependencies []struct {
		GroupID    string `xml:"groupId"`
		ArtifactID string `xml:"artifactId"`
		Version    string `xml:"version"`
	} `xml:"dependencies>dependency"`
}

func (c *dependencyCatalog) loadJVMEntries() []dependencyEntry {
	pomPath := filepath.Join(c.root, "pom.xml")
	if data, err := os.ReadFile(pomPath); err == nil {
		var project pomProject
		if xml.Unmarshal(data, &project) == nil {
			entries := make([]dependencyEntry, 0, len(project.Dependencies))
			for _, dep := range project.Dependencies {
				name := strings.TrimSpace(dep.GroupID)
				if dep.ArtifactID != "" {
					if name != "" {
						name += ":"
					}
					name += strings.TrimSpace(dep.ArtifactID)
				}
				if name == "" {
					continue
				}
				entries = append(entries, dependencyEntry{Name: name, Version: strings.TrimSpace(dep.Version), Detail: versionDetail("maven", strings.TrimSpace(dep.Version)), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
			}
			return entries
		}
	}

	for _, name := range []string{"build.gradle", "build.gradle.kts"} {
		path := filepath.Join(c.root, name)
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		return parseGradleEntries(string(data))
	}
	return nil
}

func parseGradleEntries(data string) []dependencyEntry {
	scanner := bufio.NewScanner(strings.NewReader(data))
	entries := make([]dependencyEntry, 0, 8)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.Contains(line, "implementation") && !strings.Contains(line, "api") && !strings.Contains(line, "testImplementation") {
			continue
		}
		quote := firstQuotedValue(line)
		if quote == "" {
			continue
		}
		name, version := splitGradleCoordinate(quote)
		entries = append(entries, dependencyEntry{Name: name, Version: version, Detail: versionDetail("gradle", version), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
	}
	return entries
}

func (c *dependencyCatalog) loadDotNetEntries() []dependencyEntry {
	packagesPath := filepath.Join(c.root, "packages.config")
	data, err := os.ReadFile(packagesPath)
	if err != nil {
		return nil
	}

	var manifest struct {
		Packages []struct {
			ID      string `xml:"id,attr"`
			Version string `xml:"version,attr"`
		} `xml:"package"`
	}
	if err := xml.Unmarshal(data, &manifest); err != nil {
		return nil
	}

	entries := make([]dependencyEntry, 0, len(manifest.Packages))
	for _, pkg := range manifest.Packages {
		entries = append(entries, dependencyEntry{Name: pkg.ID, Version: pkg.Version, Detail: versionDetail("nuget", pkg.Version), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: pkg.ID})
	}
	return entries
}

func (c *dependencyCatalog) loadPubspecEntries() []dependencyEntry {
	pubspecPath := filepath.Join(c.root, "pubspec.yaml")
	data, err := os.ReadFile(pubspecPath)
	if err != nil {
		return nil
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := make([]dependencyEntry, 0, 8)
	inDependencies := false
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), " \t")
		trimmed := strings.TrimSpace(line)
		if trimmed == "dependencies:" || trimmed == "dev_dependencies:" {
			inDependencies = true
			continue
		}
		if strings.HasSuffix(trimmed, ":") && !strings.HasPrefix(trimmed, "-") && trimmed != "dependencies:" && trimmed != "dev_dependencies:" {
			inDependencies = false
		}
		if !inDependencies || trimmed == "" || strings.HasPrefix(trimmed, "#") || !strings.Contains(trimmed, ":") {
			continue
		}
		name, value, _ := strings.Cut(trimmed, ":")
		depName := strings.TrimSpace(name)
		version := strings.TrimSpace(value)
		entries = append(entries, dependencyEntry{Name: depName, Version: version, Detail: versionDetail("pub", version), Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: depName})
	}
	return entries
}

func (c *dependencyCatalog) loadSwiftPackageEntries() []dependencyEntry {
	packagePath := filepath.Join(c.root, "Package.swift")
	data, err := os.ReadFile(packagePath)
	if err != nil {
		return nil
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := make([]dependencyEntry, 0, 8)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.Contains(line, ".package(") {
			continue
		}
		url := firstQuotedValue(line)
		if url == "" {
			continue
		}
		name := strings.TrimSuffix(filepath.Base(url), ".git")
		entries = append(entries, dependencyEntry{Name: name, Detail: url, Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
	}
	return entries
}

func (c *dependencyCatalog) loadTerraformEntries() []dependencyEntry {
	lockPath := filepath.Join(c.root, ".terraform.lock.hcl")
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return nil
	}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	entries := make([]dependencyEntry, 0, 8)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "provider ") {
			continue
		}
		name := strings.Trim(strings.TrimPrefix(line, "provider "), `"{ `)
		entries = append(entries, dependencyEntry{Name: name, Detail: "terraform provider", Kind: core.SymbolKindModule, Source: core.SourceLibrary, Insert: name})
	}
	return entries
}

func normalizeDependencyLanguage(language string) string {
	switch language {
	case "javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro", "css", "scss", "sass", "less":
		return "node"
	case "java", "kotlin", "groovy", "scala":
		return "jvm"
	case "csharp", "fsharp":
		return "dotnet"
	default:
		return language
	}
}

func goDependencyEntry(line string) dependencyEntry {
	fields := strings.Fields(line)
	name := ""
	version := ""
	if len(fields) > 0 {
		name = fields[0]
	}
	if len(fields) > 1 {
		version = fields[1]
	}
	return dependencyEntry{
		Name:    name,
		Version: version,
		Detail:  versionDetail("module", version),
		Kind:    core.SymbolKindPackage,
		Source:  core.SourceLibrary,
		Insert:  quoteImportLiteral(name, "go"),
	}
}

func quoteImportLiteral(name, language string) string {
	switch normalizeDependencyLanguage(language) {
	case "go":
		return `"` + name + `"`
	case "node":
		return "'" + name + "'"
	default:
		return name
	}
}

func dedupeDependencyEntries(entries []dependencyEntry) []dependencyEntry {
	if len(entries) == 0 {
		return nil
	}
	best := make(map[string]dependencyEntry, len(entries))
	for _, entry := range entries {
		if entry.Name == "" {
			continue
		}
		existing, ok := best[entry.Name]
		if !ok || dependencySourcePriority(entry.Source) > dependencySourcePriority(existing.Source) {
			best[entry.Name] = entry
		}
	}
	result := make([]dependencyEntry, 0, len(best))
	for _, entry := range best {
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}

func dependencySourcePriority(source core.SymbolSource) int {
	switch source {
	case core.SourceLocal:
		return 3
	case core.SourceLibrary:
		return 2
	default:
		return 1
	}
}

func versionDetail(prefix, version string) string {
	if version == "" {
		return prefix
	}
	return prefix + " " + version
}

func splitVersionSpec(spec string) (string, string) {
	trimmed := strings.TrimSpace(spec)
	for _, sep := range []string{"==", ">=", "<=", "~=", "!="} {
		if strings.Contains(trimmed, sep) {
			parts := strings.SplitN(trimmed, sep, 2)
			return strings.TrimSpace(parts[0]), sep + strings.TrimSpace(parts[1])
		}
	}
	for idx, r := range trimmed {
		if r == ' ' || r == '<' || r == '>' || r == '=' || r == '~' || r == '!' {
			return strings.TrimSpace(trimmed[:idx]), strings.TrimSpace(trimmed[idx:])
		}
	}
	return trimmed, ""
}

func splitGradleCoordinate(value string) (string, string) {
	parts := strings.Split(value, ":")
	if len(parts) < 3 {
		return value, ""
	}
	return strings.Join(parts[:2], ":"), parts[2]
}

func firstQuotedValue(line string) string {
	for _, quote := range []byte{'\'', '"'} {
		start := strings.IndexByte(line, quote)
		if start == -1 {
			continue
		}
		end := strings.IndexByte(line[start+1:], quote)
		if end == -1 {
			continue
		}
		return line[start+1 : start+1+end]
	}
	return ""
}
