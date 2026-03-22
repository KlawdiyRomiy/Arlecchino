package utils

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LatestModTime walks provided roots and returns the newest mod time among files
// matching allowed extensions (if any). Directories vendor, node_modules, .git, storage are skipped.
func LatestModTime(roots []string, exts []string) time.Time {
	allowed := map[string]struct{}{}
	for _, ext := range exts {
		allowed[strings.ToLower(ext)] = struct{}{}
	}

	latest := time.Time{}
	for _, root := range roots {
		filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				name := info.Name()
				if name == "vendor" || name == "node_modules" || name == ".git" || name == "storage" {
					return filepath.SkipDir
				}
				return nil
			}
			if len(allowed) > 0 {
				if _, ok := allowed[strings.ToLower(filepath.Ext(path))]; !ok {
					return nil
				}
			}
			mod := info.ModTime()
			if mod.After(latest) {
				latest = mod
			}
			return nil
		})
	}
	return latest
}
