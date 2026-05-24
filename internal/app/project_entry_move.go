package app

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	indexerlsp "arlecchino/internal/indexer/lsp"
)

type ProjectEntryMoveResult struct {
	OldPath           string `json:"oldPath"`
	NewPath           string `json:"newPath"`
	IsDirectory       bool   `json:"isDirectory"`
	LSPWorkspaceFiles int    `json:"lspWorkspaceFiles"`
	RewrittenFiles    int    `json:"rewrittenFiles"`
	RewrittenImports  int    `json:"rewrittenImports"`
}

type importRewriteResult struct {
	files   int
	imports int
}

var jsTSImportSpecRE = regexp.MustCompile(`(?m)\b(import\s+(?:type\s+)?(?:[^'"\n;]*?\s+from\s+)?|export\s+(?:type\s+)?[^'"\n;]*?\s+from\s+|require\s*\(\s*|import\s*\(\s*)(['"])(\.[^'"]*)(['"])`)

var jsTSImportExtensions = []string{
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
}

func (a *App) MoveProjectEntry(path string, targetDirectory string) (ProjectEntryMoveResult, error) {
	entryPath, projectPath, err := a.resolveProjectEntryPath(path)
	if err != nil {
		return ProjectEntryMoveResult{}, err
	}
	targetDir, err := normalizeRequiredPath(targetDirectory, "target directory")
	if err != nil {
		return ProjectEntryMoveResult{}, err
	}
	if err := ensurePathWithinProject(projectPath, targetDir); err != nil {
		return ProjectEntryMoveResult{}, err
	}
	if entryPath == projectPath {
		return ProjectEntryMoveResult{}, fmt.Errorf("cannot move project root")
	}

	info, err := os.Stat(entryPath)
	if err != nil {
		return ProjectEntryMoveResult{}, err
	}
	targetInfo, err := os.Stat(targetDir)
	if err != nil {
		return ProjectEntryMoveResult{}, fmt.Errorf("target directory unavailable: %w", err)
	}
	if !targetInfo.IsDir() {
		return ProjectEntryMoveResult{}, fmt.Errorf("target is not a directory: %s", targetDir)
	}
	if info.IsDir() && pathWithinRoot(targetDir, entryPath) {
		return ProjectEntryMoveResult{}, fmt.Errorf("cannot move a directory into itself: %s", targetDir)
	}

	targetPath := filepath.Clean(filepath.Join(targetDir, filepath.Base(entryPath)))
	if targetPath == entryPath {
		return ProjectEntryMoveResult{
			OldPath:     entryPath,
			NewPath:     targetPath,
			IsDirectory: info.IsDir(),
		}, nil
	}
	if err := ensurePathWithinProject(projectPath, targetPath); err != nil {
		return ProjectEntryMoveResult{}, err
	}
	if _, err := os.Stat(targetPath); err == nil {
		return ProjectEntryMoveResult{}, fmt.Errorf("entry already exists: %s", targetPath)
	} else if !os.IsNotExist(err) {
		return ProjectEntryMoveResult{}, err
	}

	rename := indexerlsp.FileRename{
		OldURI: indexerlsp.FilePathToURI(entryPath),
		NewURI: indexerlsp.FilePathToURI(targetPath),
	}

	lspWorkspaceFiles := 0
	if manager := a.activeLSPManager(); manager != nil {
		edit, err := manager.WillRenameFiles(context.Background(), []indexerlsp.FileRename{rename})
		if err != nil {
			return ProjectEntryMoveResult{}, err
		}
		converted, err := convertIndexerWorkspaceEdit(edit)
		if err != nil {
			return ProjectEntryMoveResult{}, err
		}
		if converted != nil {
			lspWorkspaceFiles, err = a.applyLSPWorkspaceEdit(converted)
			if err != nil {
				return ProjectEntryMoveResult{}, err
			}
		}
	}

	if err := os.Rename(entryPath, targetPath); err != nil {
		return ProjectEntryMoveResult{}, fmt.Errorf("move project entry: %w", err)
	}

	rewriteResult, err := rewriteRelativeJSTSImportsAfterMove(projectPath, entryPath, targetPath, info.IsDir())
	if err != nil {
		return ProjectEntryMoveResult{}, err
	}
	if manager := a.activeLSPManager(); manager != nil {
		manager.DidRenameFiles([]indexerlsp.FileRename{rename})
	}

	a.emitEvent("project:entry:renamed", projectEntryRenamedEvent{
		OldPath:     entryPath,
		NewPath:     targetPath,
		IsDirectory: info.IsDir(),
	})

	for _, changedPath := range rewriteResult.changedPaths {
		a.emitEvent("file:changed", changedPath)
	}

	return ProjectEntryMoveResult{
		OldPath:           entryPath,
		NewPath:           targetPath,
		IsDirectory:       info.IsDir(),
		LSPWorkspaceFiles: lspWorkspaceFiles,
		RewrittenFiles:    rewriteResult.files,
		RewrittenImports:  rewriteResult.imports,
	}, nil
}

type importRewriteDetails struct {
	importRewriteResult
	changedPaths []string
}

func rewriteRelativeJSTSImportsAfterMove(projectPath string, oldPath string, newPath string, isDirectory bool) (importRewriteDetails, error) {
	result := importRewriteDetails{}
	err := filepath.WalkDir(projectPath, func(currentPath string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if currentPath != projectPath && shouldSkipProjectWatchDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !isJSTSImportFile(currentPath) {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}
		contentBytes, err := os.ReadFile(currentPath)
		if err != nil {
			return nil
		}
		updated, importCount := rewriteRelativeJSTSImportsInFile(string(contentBytes), currentPath, oldPath, newPath, isDirectory)
		if importCount == 0 || updated == string(contentBytes) {
			return nil
		}
		if err := os.WriteFile(currentPath, []byte(updated), info.Mode()); err != nil {
			return err
		}
		result.files++
		result.imports += importCount
		result.changedPaths = append(result.changedPaths, currentPath)
		return nil
	})
	return result, err
}

func rewriteRelativeJSTSImportsInFile(content string, currentPath string, oldPath string, newPath string, isDirectory bool) (string, int) {
	matches := jsTSImportSpecRE.FindAllStringSubmatchIndex(content, -1)
	if len(matches) == 0 {
		return content, 0
	}

	oldImporterPath := remapPathAfterMove(currentPath, newPath, oldPath, isDirectory)
	importerMoved := oldImporterPath != currentPath
	oldImporterDir := filepath.Dir(oldImporterPath)
	currentImporterDir := filepath.Dir(currentPath)

	var builder strings.Builder
	builder.Grow(len(content))
	last := 0
	rewriteCount := 0
	for _, match := range matches {
		specStart, specEnd := match[6], match[7]
		if specStart < 0 || specEnd < 0 {
			continue
		}
		spec := content[specStart:specEnd]
		rewrittenSpec, ok := rewriteRelativeImportSpecifier(spec, oldImporterDir, currentImporterDir, oldPath, newPath, isDirectory, importerMoved)
		if !ok || rewrittenSpec == spec {
			continue
		}
		builder.WriteString(content[last:specStart])
		builder.WriteString(rewrittenSpec)
		last = specEnd
		rewriteCount++
	}

	if rewriteCount == 0 {
		return content, 0
	}
	builder.WriteString(content[last:])
	return builder.String(), rewriteCount
}

func rewriteRelativeImportSpecifier(spec string, oldImporterDir string, currentImporterDir string, oldPath string, newPath string, isDirectory bool, importerMoved bool) (string, bool) {
	baseSpec, suffix := splitImportSpecifierSuffix(spec)
	if baseSpec == "" || !strings.HasPrefix(baseSpec, ".") {
		return "", false
	}

	resolution := resolveRelativeImportTarget(oldImporterDir, baseSpec, oldPath, newPath, isDirectory)
	targetMoved := pathAffectedByMove(resolution.resolvedPath, oldPath, isDirectory)
	if !importerMoved && !targetMoved {
		return "", false
	}

	newResolvedPath := resolution.resolvedPath
	if targetMoved {
		newResolvedPath = remapPathAfterMove(resolution.resolvedPath, oldPath, newPath, isDirectory)
	}
	newDisplayTarget := newResolvedPath
	switch resolution.style {
	case importResolutionStyleExtensionlessFile:
		newDisplayTarget = strings.TrimSuffix(newResolvedPath, filepath.Ext(newResolvedPath))
	case importResolutionStyleIndexDirectory:
		newDisplayTarget = filepath.Dir(newResolvedPath)
	}

	rel, err := filepath.Rel(currentImporterDir, newDisplayTarget)
	if err != nil {
		return "", false
	}
	rel = filepath.ToSlash(rel)
	if rel == "." {
		rel = "./"
	} else if !strings.HasPrefix(rel, ".") {
		rel = "./" + rel
	}
	return rel + suffix, true
}

type importResolutionStyle int

const (
	importResolutionStyleExact importResolutionStyle = iota
	importResolutionStyleExtensionlessFile
	importResolutionStyleIndexDirectory
)

type importResolution struct {
	resolvedPath string
	style        importResolutionStyle
}

func resolveRelativeImportTarget(oldImporterDir string, spec string, oldPath string, newPath string, isDirectory bool) importResolution {
	base := filepath.Clean(filepath.Join(oldImporterDir, filepath.FromSlash(spec)))
	if filepath.Ext(spec) != "" {
		return importResolution{resolvedPath: base, style: importResolutionStyleExact}
	}

	candidates := []importResolution{{resolvedPath: base, style: importResolutionStyleExact}}
	for _, ext := range jsTSImportExtensions {
		candidates = append(candidates, importResolution{
			resolvedPath: base + ext,
			style:        importResolutionStyleExtensionlessFile,
		})
	}
	for _, ext := range jsTSImportExtensions {
		candidates = append(candidates, importResolution{
			resolvedPath: filepath.Join(base, "index"+ext),
			style:        importResolutionStyleIndexDirectory,
		})
	}

	for _, candidate := range candidates {
		actualPath := candidate.resolvedPath
		if pathAffectedByMove(actualPath, oldPath, isDirectory) {
			actualPath = remapPathAfterMove(actualPath, oldPath, newPath, isDirectory)
		}
		if info, err := os.Stat(actualPath); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}

	return importResolution{resolvedPath: base, style: importResolutionStyleExact}
}

func splitImportSpecifierSuffix(spec string) (string, string) {
	queryIndex := strings.IndexAny(spec, "?#")
	if queryIndex < 0 {
		return spec, ""
	}
	return spec[:queryIndex], spec[queryIndex:]
}

func isJSTSImportFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts", ".cjs", ".cts":
		return true
	default:
		return false
	}
}

func pathAffectedByMove(path string, movedPath string, movedIsDir bool) bool {
	path = filepath.Clean(path)
	movedPath = filepath.Clean(movedPath)
	if path == movedPath {
		return true
	}
	return movedIsDir && pathWithinRoot(path, movedPath)
}

func remapPathAfterMove(path string, fromPath string, toPath string, movedIsDir bool) string {
	path = filepath.Clean(path)
	fromPath = filepath.Clean(fromPath)
	toPath = filepath.Clean(toPath)
	if path == fromPath {
		return toPath
	}
	if !movedIsDir || !pathWithinRoot(path, fromPath) {
		return path
	}
	rel, err := filepath.Rel(fromPath, path)
	if err != nil {
		return path
	}
	return filepath.Clean(filepath.Join(toPath, rel))
}

func pathWithinRoot(path string, root string) bool {
	withinRoot, err := isPathWithinRoot(root, path)
	return err == nil && withinRoot
}
