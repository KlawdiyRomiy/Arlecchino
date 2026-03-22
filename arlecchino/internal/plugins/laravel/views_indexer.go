package laravel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type ViewIndexInfo struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	RelPath  string `json:"relPath"`
	IsLayout bool   `json:"isLayout"`
}

type ViewsIndexer struct {
	projectPath string
}

func NewViewsIndexer(projectPath string) *ViewsIndexer {
	return &ViewsIndexer{projectPath: projectPath}
}

func (v *ViewsIndexer) Index() ([]ViewIndexInfo, error) {
	views := []ViewIndexInfo{}
	viewsDir := filepath.Join(v.projectPath, "resources", "views")

	if _, err := os.Stat(viewsDir); os.IsNotExist(err) {
		return views, nil
	}

	err := filepath.Walk(viewsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}

		if !strings.HasSuffix(path, ".blade.php") {
			return nil
		}

		relPath, _ := filepath.Rel(viewsDir, path)
		name := v.pathToViewName(relPath)
		isLayout := strings.Contains(relPath, "layouts") || strings.Contains(relPath, "layout")

		views = append(views, ViewIndexInfo{
			Name:     name,
			Path:     path,
			RelPath:  relPath,
			IsLayout: isLayout,
		})

		return nil
	})

	return views, err
}

func (v *ViewsIndexer) pathToViewName(relPath string) string {
	name := strings.TrimSuffix(relPath, ".blade.php")
	name = strings.ReplaceAll(name, string(filepath.Separator), ".")
	return name
}

func (v *ViewsIndexer) ExportJSON(views []ViewIndexInfo) (string, error) {
	data, err := json.MarshalIndent(views, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}
