package core

import (
	"path/filepath"
	"strings"
)

var configFileNames = map[string]struct{}{
	"dockerfile":          {},
	"makefile":            {},
	"compose.yml":         {},
	"compose.yaml":        {},
	"docker-compose.yml":  {},
	"docker-compose.yaml": {},
	".env":                {},
}

var configExtensions = map[string]struct{}{
	".ini":  {},
	".json": {},
	".toml": {},
	".yaml": {},
	".yml":  {},
	".xml":  {},
}

var textExtensions = map[string]struct{}{
	".csv":  {},
	".log":  {},
	".md":   {},
	".rst":  {},
	".txt":  {},
	".tsv":  {},
	".lock": {},
}

var assetExtensions = map[string]struct{}{
	".bmp":   {},
	".css":   {},
	".gif":   {},
	".ico":   {},
	".jpeg":  {},
	".jpg":   {},
	".mp3":   {},
	".mp4":   {},
	".png":   {},
	".svg":   {},
	".webm":  {},
	".webp":  {},
	".woff":  {},
	".woff2": {},
}

var binaryExtensions = map[string]struct{}{
	".a":     {},
	".bin":   {},
	".dll":   {},
	".dylib": {},
	".exe":   {},
	".gz":    {},
	".jar":   {},
	".o":     {},
	".pdf":   {},
	".so":    {},
	".tar":   {},
	".wasm":  {},
	".zip":   {},
}

func classifyFileKind(path, language string) FileKind {
	if language != "" {
		return FileKindSource
	}

	base := strings.ToLower(filepath.Base(path))
	if _, ok := configFileNames[base]; ok {
		return FileKindConfig
	}

	ext := strings.ToLower(filepath.Ext(path))
	if ext == "" {
		return FileKindUnknown
	}
	if _, ok := configExtensions[ext]; ok {
		return FileKindConfig
	}
	if _, ok := textExtensions[ext]; ok {
		return FileKindText
	}
	if _, ok := assetExtensions[ext]; ok {
		return FileKindAsset
	}
	if _, ok := binaryExtensions[ext]; ok {
		return FileKindBinary
	}

	return FileKindUnknown
}
