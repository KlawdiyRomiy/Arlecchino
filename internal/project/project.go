package project

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var executablePath = os.Executable

type Project struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Framework  string    `json:"framework"` // laravel, django, rails, express, go, unknown
	Version    string    `json:"version"`
	CreatedAt  time.Time `json:"created_at"`
	LastOpened time.Time `json:"last_opened"`
	IsFavorite bool      `json:"is_favorite"`
}

type ProjectManager struct {
	db             *DB
	CurrentProject *Project
}

type DB struct {
	*gorm.DB
}

func NewDB(dbPath string) (*DB, error) {
	dbPath = ResolveDBPath(dbPath)
	if dir := filepath.Dir(dbPath); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	err = db.AutoMigrate(&Project{})
	if err != nil {
		return nil, err
	}

	return &DB{db}, nil
}

func ResolveDBPath(dbPath string) string {
	dbPath = strings.TrimSpace(dbPath)
	if dbPath == "" || filepath.IsAbs(dbPath) {
		return dbPath
	}

	if dataDir := strings.TrimSpace(os.Getenv("ARLECCHINO_DATA_DIR")); dataDir != "" {
		return filepath.Join(dataDir, filepath.Base(dbPath))
	}

	if envFlagString(os.Getenv("ARLECCHINO_PACKAGED_BUILD")) || runningFromAppBundle() {
		if configDir, err := os.UserConfigDir(); err == nil && strings.TrimSpace(configDir) != "" {
			return filepath.Join(configDir, "Arlecchino", filepath.Base(dbPath))
		}
	}

	return dbPath
}

func runningFromAppBundle() bool {
	executable, err := executablePath()
	if err != nil {
		return false
	}
	path := filepath.Clean(executable)
	for path != "." && path != string(filepath.Separator) {
		if strings.HasSuffix(path, ".app") {
			return true
		}
		parent := filepath.Dir(path)
		if parent == path {
			break
		}
		path = parent
	}
	return false
}

func envFlagString(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// OpenProject opens any directory as a project (framework-agnostic)
func (pm *ProjectManager) OpenProject(path string) error {
	// Verify path exists and is a directory
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("path is not a directory")
	}

	name := filepath.Base(path)

	var project Project
	result := pm.db.Where("path = ?", path).First(&project)

	if errors.Is(result.Error, gorm.ErrRecordNotFound) {
		project = Project{
			Name:       name,
			Path:       path,
			Framework:  "unknown", // Will be set by app.go after plugin detection
			Version:    "",
			CreatedAt:  time.Now(),
			LastOpened: time.Now(),
		}
		pm.db.Create(&project)
	} else {
		project.LastOpened = time.Now()
		pm.db.Save(&project)
	}

	pm.CurrentProject = &project
	return nil
}

// UpdateFramework updates the detected framework for current project
func (pm *ProjectManager) UpdateFramework(framework string, version string) {
	if pm.CurrentProject != nil {
		pm.CurrentProject.Framework = framework
		pm.CurrentProject.Version = version
		pm.db.Save(pm.CurrentProject)
	}
}

func (pm *ProjectManager) CloseProject() error {
	pm.CurrentProject = nil
	return nil
}

func (pm *ProjectManager) GetRecentProjects(limit int) ([]Project, error) {
	var projects []Project
	result := pm.db.Order("last_opened desc").Limit(limit).Find(&projects)
	return projects, result.Error
}

func (pm *ProjectManager) RemoveRecentProject(path string) error {
	projectPath := strings.TrimSpace(path)
	if projectPath == "" {
		return errors.New("project path is required")
	}

	return pm.db.Where("path = ?", projectPath).Delete(&Project{}).Error
}

func (pm *ProjectManager) ClearRecentProjects() error {
	query := pm.db.Model(&Project{})
	if pm.CurrentProject != nil {
		currentPath := strings.TrimSpace(pm.CurrentProject.Path)
		if currentPath != "" {
			query = query.Where("path <> ?", currentPath)
		}
	}

	return query.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&Project{}).Error
}

func NewProjectManager(dbPath string) (*ProjectManager, error) {
	db, err := NewDB(dbPath)
	if err != nil {
		return nil, err
	}
	return &ProjectManager{
		db: db,
	}, nil
}
