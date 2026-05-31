package depsync

import (
	"os"
	"path/filepath"
	"strings"
)

type fileContainsSpec struct {
	File     string
	Contains string
}

type matchSpec struct {
	AnyFiles     []string
	AllFiles     []string
	FileContains []fileContainsSpec
}

type commandSpec struct {
	Label        string
	Executable   string
	Args         string
	Safe         bool
	Capability   DependencyCapability
	MutationRisk MutationRisk
}

type variantSpec struct {
	Tool     string
	When     matchSpec
	Commands []commandSpec
}

type managerSpec struct {
	Ecosystem     string
	ManifestAnyOf []string
	Variants      []variantSpec
}

type registry []managerSpec

func defaultRegistry() registry {
	return registry{
		{
			Ecosystem:     "node",
			ManifestAnyOf: []string{"package.json"},
			Variants: []variantSpec{
				{
					Tool: "pnpm",
					When: matchSpec{AnyFiles: []string{"pnpm-lock.yaml"}},
					Commands: []commandSpec{
						{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "update --latest", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "yarn",
					When: matchSpec{AnyFiles: []string{"yarn.lock"}},
					Commands: []commandSpec{
						{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "upgrade", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "npm",
					When: matchSpec{AnyFiles: []string{"package-lock.json"}},
					Commands: []commandSpec{
						{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "bun",
					When: matchSpec{AnyFiles: []string{"bun.lockb"}},
					Commands: []commandSpec{
						{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "npm",
					Commands: []commandSpec{
						{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
			},
		},
		{
			Ecosystem:     "go",
			ManifestAnyOf: []string{"go.mod"},
			Variants: []variantSpec{{
				Tool: "go",
				Commands: []commandSpec{
					{Label: "tidy", Args: "mod tidy", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "update", Executable: "sh", Args: "-c \"go get -u ./... && go mod tidy\"", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "php",
			ManifestAnyOf: []string{"composer.json"},
			Variants: []variantSpec{{
				Tool: "composer",
				Commands: []commandSpec{
					{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndInstall, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "rust",
			ManifestAnyOf: []string{"Cargo.toml"},
			Variants: []variantSpec{{
				Tool: "cargo",
				Commands: []commandSpec{
					{Label: "fetch", Args: "fetch", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "ruby",
			ManifestAnyOf: []string{"Gemfile"},
			Variants: []variantSpec{{
				Tool: "bundle",
				Commands: []commandSpec{
					{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "dart",
			ManifestAnyOf: []string{"pubspec.yaml"},
			Variants: []variantSpec{{
				Tool: "dart",
				Commands: []commandSpec{
					{Label: "pub-get", Args: "pub get", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "pub-upgrade", Args: "pub upgrade", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "swift",
			ManifestAnyOf: []string{"Package.swift"},
			Variants: []variantSpec{{
				Tool: "swift",
				Commands: []commandSpec{
					{Label: "resolve", Args: "package resolve", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "update", Args: "package update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "python",
			ManifestAnyOf: []string{"requirements.txt"},
			Variants: []variantSpec{{
				Tool: "pip",
				Commands: []commandSpec{{
					Label:        "install",
					Executable:   "python3",
					Args:         "-m pip install -r requirements.txt",
					Safe:         true,
					Capability:   CapabilityResolveOnly,
					MutationRisk: RiskLow,
				}},
			}},
		},
		{
			Ecosystem:     "python",
			ManifestAnyOf: []string{"pyproject.toml"},
			Variants: []variantSpec{
				{
					Tool: "poetry",
					When: matchSpec{FileContains: []fileContainsSpec{{File: "pyproject.toml", Contains: "[tool.poetry]"}}},
					Commands: []commandSpec{
						{Label: "install", Args: "install", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "update", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "uv",
					When: matchSpec{AnyFiles: []string{"uv.lock"}},
					Commands: []commandSpec{
						{Label: "install", Args: "sync", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "lock --upgrade", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "python3",
					Commands: []commandSpec{
						{Label: "install", Args: "-m pip install -e .", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "update", Args: "-m pip install --upgrade -e .", Safe: false, Capability: CapabilityDeclareAndInstall, MutationRisk: RiskHigh},
					},
				},
			},
		},
		{
			Ecosystem:     "jvm",
			ManifestAnyOf: []string{"pom.xml"},
			Variants: []variantSpec{{
				Tool: "maven",
				Commands: []commandSpec{
					{Label: "resolve", Executable: "mvn", Args: "dependency:resolve", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
					{Label: "update", Executable: "mvn", Args: "versions:use-latest-releases", Safe: false, Capability: CapabilityDeclareAndLock, MutationRisk: RiskHigh},
				},
			}},
		},
		{
			Ecosystem:     "jvm",
			ManifestAnyOf: []string{"build.gradle.kts", "build.gradle"},
			Variants: []variantSpec{
				{
					Tool: "./gradlew",
					When: matchSpec{AnyFiles: []string{"gradlew"}},
					Commands: []commandSpec{
						{Label: "dependencies", Args: "dependencies", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "refresh", Args: "--refresh-dependencies", Safe: false, Capability: CapabilityDeclareAndInstall, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "./gradlew.bat",
					When: matchSpec{AnyFiles: []string{"gradlew.bat"}},
					Commands: []commandSpec{
						{Label: "dependencies", Args: "dependencies", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "refresh", Args: "--refresh-dependencies", Safe: false, Capability: CapabilityDeclareAndInstall, MutationRisk: RiskHigh},
					},
				},
				{
					Tool: "gradle",
					Commands: []commandSpec{
						{Label: "dependencies", Args: "dependencies", Safe: true, Capability: CapabilityResolveOnly, MutationRisk: RiskLow},
						{Label: "refresh", Args: "--refresh-dependencies", Safe: false, Capability: CapabilityDeclareAndInstall, MutationRisk: RiskHigh},
					},
				},
			},
		},
		{
			Ecosystem:     "dotnet",
			ManifestAnyOf: []string{"packages.config"},
			Variants: []variantSpec{{
				Tool: "nuget",
				Commands: []commandSpec{{
					Label:        "restore",
					Executable:   "dotnet",
					Args:         "restore",
					Safe:         true,
					Capability:   CapabilityResolveOnly,
					MutationRisk: RiskLow,
				}},
			}},
		},
		{
			Ecosystem:     "terraform",
			ManifestAnyOf: []string{".terraform.lock.hcl"},
			Variants: []variantSpec{{
				Tool: "terraform",
				Commands: []commandSpec{
					{Label: "init", Args: "init -backend=false", Safe: true, Capability: CapabilityInitInfrastructure, MutationRisk: RiskMedium},
					{Label: "upgrade", Args: "init -upgrade -backend=false", Safe: false, Capability: CapabilityInitInfrastructure, MutationRisk: RiskHigh},
				},
			}},
		},
	}
}

func (r registry) Detect(projectPath string, mode Mode) ([]Manager, error) {
	managers, _, err := r.DetectWithReport(projectPath, mode)
	return managers, err
}

func (r registry) DetectWithReport(projectPath string, mode Mode) ([]Manager, manifestDiscoveryReport, error) {
	if strings.TrimSpace(projectPath) == "" {
		return nil, manifestDiscoveryReport{}, nil
	}

	root, err := filepath.Abs(filepath.Clean(strings.TrimSpace(projectPath)))
	if err != nil {
		return nil, manifestDiscoveryReport{}, err
	}

	report, err := discoverManifestDirsReport(root, r)
	if err != nil {
		return nil, manifestDiscoveryReport{}, err
	}

	managers := make([]Manager, 0, len(r))
	for _, dir := range report.Dirs {
		selected := make(map[string]managerSelection)
		for index, spec := range r {
			manager, ok := managerForSpec(root, dir, spec, mode)
			if !ok {
				continue
			}
			selection := managerSelection{
				manager:  manager,
				priority: managerSpecPriority(spec),
				index:    index,
			}
			current, exists := selected[manager.Ecosystem]
			if !exists || selection.priority < current.priority {
				selected[manager.Ecosystem] = selection
			}
		}

		emitted := make(map[string]bool, len(selected))
		for index, spec := range r {
			selection, ok := selected[spec.Ecosystem]
			if !ok || emitted[spec.Ecosystem] || selection.index != index {
				continue
			}
			managers = append(managers, selection.manager)
			emitted[spec.Ecosystem] = true
		}
	}

	return managers, report, nil
}

type managerSelection struct {
	manager  Manager
	priority int
	index    int
}

func managerForSpec(root string, dir manifestDir, spec managerSpec, mode Mode) (Manager, bool) {
	manifest := firstExisting(dir.Abs, spec.ManifestAnyOf)
	if manifest == "" {
		return Manager{}, false
	}
	if spec.Ecosystem == "python" && manifest == "pyproject.toml" && !pyprojectHasDependencySurface(dir.Abs) {
		return Manager{}, false
	}

	variant := pickVariant(dir.Abs, spec.Variants)
	if variant == nil {
		return Manager{}, false
	}
	if spec.Ecosystem == "node" && variantIsFallback(*variant) && dir.Rel != "." && hasAncestorNodeManager(root, dir.Rel) {
		return Manager{}, false
	}

	commands := make([]Command, 0, len(variant.Commands))
	for _, cmdSpec := range variant.Commands {
		execName := strings.TrimSpace(cmdSpec.Executable)
		if execName == "" {
			execName = variant.Tool
		}
		commands = append(commands, Command{
			Label:        cmdSpec.Label,
			Executable:   execName,
			Args:         cmdSpec.Args,
			Safe:         cmdSpec.Safe,
			Capability:   cmdSpec.Capability,
			MutationRisk: cmdSpec.MutationRisk,
		})
	}

	return Manager{
		Ecosystem: spec.Ecosystem,
		Tool:      variant.Tool,
		Manifest:  joinManifestRel(dir.Rel, manifest),
		Commands:  commandsForMode(commands, mode),
	}, true
}

func variantIsFallback(variant variantSpec) bool {
	return len(variant.When.AnyFiles) == 0 &&
		len(variant.When.AllFiles) == 0 &&
		len(variant.When.FileContains) == 0
}

func pyprojectHasDependencySurface(root string) bool {
	if fileExists(filepath.Join(root, "uv.lock")) || fileExists(filepath.Join(root, "poetry.lock")) {
		return true
	}
	data, err := os.ReadFile(filepath.Join(root, "pyproject.toml"))
	if err != nil {
		return false
	}
	content := string(data)
	for _, marker := range []string{
		"[project]",
		"[tool.poetry]",
		"[dependency-groups]",
		"dependencies =",
		"optional-dependencies",
	} {
		if strings.Contains(content, marker) {
			return true
		}
	}
	return false
}

func managerSpecPriority(spec managerSpec) int {
	switch spec.Ecosystem {
	case "python":
		if stringSliceContains(spec.ManifestAnyOf, "pyproject.toml") {
			return 10
		}
		return 20
	case "jvm":
		if stringSliceContains(spec.ManifestAnyOf, "build.gradle") || stringSliceContains(spec.ManifestAnyOf, "build.gradle.kts") {
			return 10
		}
		return 20
	default:
		return 10
	}
}

func firstExisting(root string, names []string) string {
	for _, name := range names {
		if strings.TrimSpace(name) == "" {
			continue
		}
		if manifestFileExists(filepath.Join(root, name)) {
			return name
		}
	}
	return ""
}

func pickVariant(root string, variants []variantSpec) *variantSpec {
	if len(variants) == 0 {
		return nil
	}
	for i := range variants {
		if matchVariant(root, variants[i].When) {
			return &variants[i]
		}
	}
	return nil
}

func matchVariant(root string, spec matchSpec) bool {
	if len(spec.AnyFiles) == 0 && len(spec.AllFiles) == 0 && len(spec.FileContains) == 0 {
		return true
	}

	if len(spec.AnyFiles) > 0 {
		ok := false
		for _, name := range spec.AnyFiles {
			if fileExists(filepath.Join(root, name)) {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}

	for _, name := range spec.AllFiles {
		if !fileExists(filepath.Join(root, name)) {
			return false
		}
	}

	for _, contains := range spec.FileContains {
		path := filepath.Join(root, contains.File)
		data, err := os.ReadFile(path)
		if err != nil {
			return false
		}
		if !strings.Contains(string(data), contains.Contains) {
			return false
		}
	}

	return true
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func manifestFileExists(path string) bool {
	info, err := os.Lstat(path)
	if err != nil {
		return false
	}
	return info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0
}
