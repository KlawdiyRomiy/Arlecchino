package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"arlecchino/internal/ai/mnemonic"
)

const (
	projectBootstrapFileName = "bootstrap.json"
	projectBootstrapFormat   = "arlecchino.project-bootstrap"
	projectBootstrapVersion  = 1
)

// ProjectBootstrap is the small, versioned on-disk contract shared by MCP,
// Arle, and Arlecchino IDE. Paths are deliberately fixed relative paths in v1.
type ProjectBootstrap struct {
	Format       string                `json:"format"`
	Version      int                   `json:"version"`
	Paths        ProjectBootstrapPaths `json:"paths"`
	Capabilities []string              `json:"capabilities"`
	CreatedBy    string                `json:"createdBy,omitempty"`
}

type ProjectBootstrapPaths struct {
	MnemonicDB string `json:"mnemonicDb"`
	Context    string `json:"context"`
	Skills     string `json:"skills"`
}

var defaultProjectBootstrap = ProjectBootstrap{
	Format:  projectBootstrapFormat,
	Version: projectBootstrapVersion,
	Paths: ProjectBootstrapPaths{
		MnemonicDB: "ai/mnemonic.db",
		Context:    "memory/CONTEXT.md",
		Skills:     "skills",
	},
	Capabilities: []string{"mnemonic", "memory-context", "skills"},
}

func ProjectBootstrapPath(projectRoot string) string {
	return filepath.Join(strings.TrimSpace(projectRoot), ".arlecchino", projectBootstrapFileName)
}

func CanonicalProjectRoot(projectRoot string) (string, error) {
	return normalizeBootstrapProjectRoot(projectRoot)
}

func ReadProjectBootstrap(projectRoot string) (ProjectBootstrap, bool, error) {
	root, err := normalizeBootstrapProjectRoot(projectRoot)
	if err != nil {
		return ProjectBootstrap{}, false, err
	}

	data, err := os.ReadFile(ProjectBootstrapPath(root))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ProjectBootstrap{}, false, nil
		}
		return ProjectBootstrap{}, false, err
	}

	var bootstrap ProjectBootstrap
	if err := json.Unmarshal(data, &bootstrap); err != nil {
		return ProjectBootstrap{}, true, fmt.Errorf("decode %s: %w", projectBootstrapFileName, err)
	}
	if err := validateProjectBootstrap(bootstrap); err != nil {
		return ProjectBootstrap{}, true, err
	}
	return bootstrap, true, nil
}

// EnsureProjectBootstrap creates the shared state only when the marker is
// absent. Existing bootstrap and project files are read and preserved.
func EnsureProjectBootstrap(projectRoot, createdBy string) (ProjectBootstrap, error) {
	root, err := normalizeBootstrapProjectRoot(projectRoot)
	if err != nil {
		return ProjectBootstrap{}, err
	}

	if bootstrap, exists, err := ReadProjectBootstrap(root); err != nil {
		return ProjectBootstrap{}, err
	} else if exists {
		return bootstrap, nil
	}

	stateRoot := filepath.Join(root, ".arlecchino")
	for _, dir := range []string{
		stateRoot,
		filepath.Join(stateRoot, "ai"),
		filepath.Join(stateRoot, "memory"),
		filepath.Join(stateRoot, "skills"),
	} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return ProjectBootstrap{}, err
		}
	}

	// Opening through Mnemonic is what creates/migrates the canonical database.
	store, err := mnemonic.Open(root, true)
	if err != nil {
		return ProjectBootstrap{}, err
	}
	if err := store.Close(); err != nil {
		return ProjectBootstrap{}, err
	}

	contextPath := filepath.Join(root, ".arlecchino", filepath.FromSlash(defaultProjectBootstrap.Paths.Context))
	if _, err := os.Stat(contextPath); errors.Is(err, os.ErrNotExist) {
		if _, err := EnsureAgentContextFile(root); err != nil {
			return ProjectBootstrap{}, err
		}
	} else if err != nil {
		return ProjectBootstrap{}, err
	}

	bootstrap := defaultProjectBootstrap
	bootstrap.CreatedBy = strings.TrimSpace(createdBy)
	if bootstrap.CreatedBy == "" {
		bootstrap.CreatedBy = "unknown"
	}
	data, err := json.MarshalIndent(bootstrap, "", "  ")
	if err != nil {
		return ProjectBootstrap{}, err
	}
	data = append(data, '\n')

	path := ProjectBootstrapPath(root)
	created, err := atomicallyCreateBootstrap(path, data)
	if err != nil {
		return ProjectBootstrap{}, err
	}
	if !created {
		winner, exists, readErr := ReadProjectBootstrap(root)
		if readErr != nil {
			return ProjectBootstrap{}, readErr
		}
		if exists {
			return winner, nil
		}
		return ProjectBootstrap{}, fmt.Errorf("bootstrap disappeared during concurrent initialization")
	}
	return bootstrap, nil
}

func atomicallyCreateBootstrap(path string, data []byte) (bool, error) {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".bootstrap-*")
	if err != nil {
		return false, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return false, err
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return false, err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return false, err
	}
	if err := temporary.Close(); err != nil {
		return false, err
	}
	if err := os.Link(temporaryPath, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

type ProjectBootstrapStatus struct {
	ProjectRoot       string `json:"projectRoot"`
	BootstrapPath     string `json:"bootstrapPath"`
	BootstrapPresent  bool   `json:"bootstrapPresent"`
	BootstrapValid    bool   `json:"bootstrapValid"`
	MnemonicDBPresent bool   `json:"mnemonicDbPresent"`
	ContextPresent    bool   `json:"contextPresent"`
	SkillsPresent     bool   `json:"skillsPresent"`
}

func InspectProjectBootstrap(projectRoot string) (ProjectBootstrapStatus, error) {
	root, err := normalizeBootstrapProjectRoot(projectRoot)
	if err != nil {
		return ProjectBootstrapStatus{}, err
	}
	status := ProjectBootstrapStatus{
		ProjectRoot:   root,
		BootstrapPath: ProjectBootstrapPath(root),
	}
	bootstrap, exists, err := ReadProjectBootstrap(root)
	if err != nil {
		status.BootstrapPresent = exists
		return status, err
	}
	status.BootstrapPresent = exists
	status.BootstrapValid = exists
	paths := defaultProjectBootstrap.Paths
	if exists {
		paths = bootstrap.Paths
	}
	status.MnemonicDBPresent = fileExists(filepath.Join(root, ".arlecchino", filepath.FromSlash(paths.MnemonicDB)))
	status.ContextPresent = fileExists(filepath.Join(root, ".arlecchino", filepath.FromSlash(paths.Context)))
	status.SkillsPresent = directoryExists(filepath.Join(root, ".arlecchino", filepath.FromSlash(paths.Skills)))
	return status, nil
}

func validateProjectBootstrap(bootstrap ProjectBootstrap) error {
	if bootstrap.Format != projectBootstrapFormat {
		return fmt.Errorf("unsupported Arlecchino bootstrap format %q", bootstrap.Format)
	}
	if bootstrap.Version != projectBootstrapVersion {
		return fmt.Errorf("unsupported Arlecchino bootstrap version %d", bootstrap.Version)
	}
	if bootstrap.Paths != defaultProjectBootstrap.Paths {
		return fmt.Errorf("unsupported Arlecchino bootstrap paths")
	}
	for _, capability := range bootstrap.Capabilities {
		if strings.TrimSpace(capability) == "" {
			return fmt.Errorf("Arlecchino bootstrap contains an empty capability")
		}
	}
	return nil
}

func normalizeBootstrapProjectRoot(projectRoot string) (string, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		var err error
		root, err = os.Getwd()
		if err != nil {
			return "", err
		}
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(root)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project root is not a directory: %s", root)
	}
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	return root, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func directoryExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
