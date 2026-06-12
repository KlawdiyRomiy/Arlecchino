package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	projectEntryUndoMaxDeleteBytes    = int64(50 * 1024 * 1024)
	projectEntryUndoMaxDeleteItems    = 2000
	projectEntryUndoStartupCleanupAge = 24 * time.Hour
	projectEntryUndoStashDirName      = ".arlecchino-undo"
	projectEntryUndoRegistryFile      = "stash-roots.txt"
	projectEntryUndoApplicationName   = "Arlecchino"
)

var projectEntrySensitivePathPatterns = []string{
	".env",
	".env.*",
	"*/.env",
	"*/.env.*",
	"*/.env/*",
	"*/.ssh/*",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	"*.crt",
	"*.cer",
	"*.der",
	"id_rsa",
	"id_ed25519",
	"*credentials*.json",
	"*secret*.json",
	"*credentials*",
	"*secret*",
}

var macOSPackageDirectoryExtensions = map[string]struct{}{
	".app":         {},
	".appex":       {},
	".bundle":      {},
	".framework":   {},
	".kext":        {},
	".plugin":      {},
	".workflow":    {},
	".xcodeproj":   {},
	".xcworkspace": {},
}

type ProjectEntryCreateRequest struct {
	Type          string `json:"type"`
	DirectoryPath string `json:"directoryPath"`
	Name          string `json:"name"`
}

type ProjectEntryCreateResult struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

type ProjectEntryRenameRequest struct {
	Path    string `json:"path"`
	NewName string `json:"newName"`
}

type ProjectEntryTrashTarget struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
	DisplayName string `json:"displayName,omitempty"`
}

type ProjectEntryTrashRequest struct {
	Entries []ProjectEntryTrashTarget `json:"entries"`
}

type ProjectEntryTrashResult struct {
	Count int `json:"count"`
}

type ProjectEntryUndoState struct {
	CanUndo   bool   `json:"canUndo"`
	CanRedo   bool   `json:"canRedo"`
	UndoLabel string `json:"undoLabel,omitempty"`
	RedoLabel string `json:"redoLabel,omitempty"`
}

type projectEntryHistory struct {
	mu   sync.Mutex
	undo []projectEntryOperation
	redo []projectEntryOperation
}

type projectEntryOperation struct {
	ID        string
	Kind      string
	Label     string
	CreatedAt time.Time

	Create *projectEntryCreateOperation
	Rename *projectEntryRenameOperation
	Trash  *projectEntryTrashOperation
}

type projectEntryCreateOperation struct {
	Path        string
	IsDirectory bool
	Fingerprint projectEntryFingerprint
}

type projectEntryRenameOperation struct {
	OldPath     string
	NewPath     string
	IsDirectory bool
}

type projectEntryTrashOperation struct {
	StashRoot string
	Entries   []projectEntryTrashOperationEntry
}

type projectEntryTrashOperationEntry struct {
	OriginalPath string
	StashPath    string
	IsDirectory  bool
}

type projectEntryResolvedRoot struct {
	Abs      string
	Resolved string
}

type projectEntryResolvedPath struct {
	Path        string
	Resolved    string
	Relative    string
	Info        os.FileInfo
	IsDirectory bool
}

type projectEntryFingerprint struct {
	IsDirectory bool
	Size        int64
	Mode        os.FileMode
	ModUnixNano int64
}

type guardedTrashCandidate struct {
	Path        string
	Relative    string
	IsDirectory bool
	StashPath   string
}

func (a *App) CreateProjectEntry(ctx context.Context, req ProjectEntryCreateRequest) (ProjectEntryCreateResult, error) {
	session, root, unlock, err := a.lockProjectEntryMutationSession(ctx)
	if err != nil {
		return ProjectEntryCreateResult{}, err
	}
	defer unlock()

	entryType := strings.ToLower(strings.TrimSpace(req.Type))
	if entryType != "file" && entryType != "folder" {
		return ProjectEntryCreateResult{}, fmt.Errorf("entry type must be file or folder")
	}

	dir, err := resolveProjectEntryPathInRoot(root, req.DirectoryPath, true)
	if err != nil {
		return ProjectEntryCreateResult{}, err
	}
	if !dir.Info.IsDir() {
		return ProjectEntryCreateResult{}, fmt.Errorf("target directory is not a directory: %s", dir.Path)
	}

	name, err := sanitizeProjectEntryName(req.Name)
	if err != nil {
		return ProjectEntryCreateResult{}, err
	}
	targetPath := filepath.Clean(filepath.Join(dir.Path, name))
	if _, err := resolveProjectEntryPathInRoot(root, targetPath, false); err != nil {
		return ProjectEntryCreateResult{}, err
	}
	if _, err := os.Lstat(targetPath); err == nil {
		return ProjectEntryCreateResult{}, fmt.Errorf("entry already exists: %s", targetPath)
	} else if !os.IsNotExist(err) {
		return ProjectEntryCreateResult{}, err
	}

	isDirectory := entryType == "folder"
	if isDirectory {
		if err := os.Mkdir(targetPath, 0o755); err != nil {
			return ProjectEntryCreateResult{}, fmt.Errorf("create project folder: %w", err)
		}
	} else {
		file, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return ProjectEntryCreateResult{}, fmt.Errorf("create project file: %w", err)
		}
		if err := file.Close(); err != nil {
			return ProjectEntryCreateResult{}, err
		}
	}

	info, err := os.Lstat(targetPath)
	if err != nil {
		return ProjectEntryCreateResult{}, err
	}
	session.projectEntryHistory.push(projectEntryOperation{
		ID:        newProjectEntryOperationID(),
		Kind:      "create",
		Label:     "Create " + filepath.Base(targetPath),
		CreatedAt: time.Now().UTC(),
		Create: &projectEntryCreateOperation{
			Path:        targetPath,
			IsDirectory: isDirectory,
			Fingerprint: projectEntryFingerprintFromInfo(info),
		},
	})

	a.emitEvent("project:entry:created", projectEntryCreatedEvent{Path: targetPath, IsDirectory: isDirectory})
	return ProjectEntryCreateResult{Path: targetPath, IsDirectory: isDirectory}, nil
}

func (a *App) RenameProjectEntryWithHistory(ctx context.Context, req ProjectEntryRenameRequest) (ProjectEntryRenameResult, error) {
	session, root, unlock, err := a.lockProjectEntryMutationSession(ctx)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}
	defer unlock()

	source, err := resolveProjectEntryPathInRoot(root, req.Path, true)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}
	if source.Path == root.Abs || source.Resolved == root.Resolved {
		return ProjectEntryRenameResult{}, fmt.Errorf("cannot rename project root")
	}

	name, err := sanitizeProjectEntryName(req.NewName)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}
	targetPath := filepath.Clean(filepath.Join(filepath.Dir(source.Path), name))
	if targetPath == source.Path {
		return ProjectEntryRenameResult{NewPath: source.Path, IsDirectory: source.IsDirectory}, nil
	}
	if _, err := resolveProjectEntryPathInRoot(root, targetPath, false); err != nil {
		return ProjectEntryRenameResult{}, err
	}
	if _, err := os.Lstat(targetPath); err == nil {
		return ProjectEntryRenameResult{}, fmt.Errorf("entry already exists: %s", targetPath)
	} else if !os.IsNotExist(err) {
		return ProjectEntryRenameResult{}, err
	}

	if err := os.Rename(source.Path, targetPath); err != nil {
		return ProjectEntryRenameResult{}, fmt.Errorf("rename project entry: %w", err)
	}

	a.remapLSPDiagnosticsForProjectEntry(source.Path, targetPath)
	session.projectEntryHistory.push(projectEntryOperation{
		ID:        newProjectEntryOperationID(),
		Kind:      "rename",
		Label:     "Rename " + filepath.Base(source.Path),
		CreatedAt: time.Now().UTC(),
		Rename: &projectEntryRenameOperation{
			OldPath:     source.Path,
			NewPath:     targetPath,
			IsDirectory: source.IsDirectory,
		},
	})

	a.emitEvent("project:entry:renamed", projectEntryRenamedEvent{
		OldPath:     source.Path,
		NewPath:     targetPath,
		IsDirectory: source.IsDirectory,
	})
	return ProjectEntryRenameResult{NewPath: targetPath, IsDirectory: source.IsDirectory}, nil
}

func (a *App) TrashProjectEntries(ctx context.Context, req ProjectEntryTrashRequest) (ProjectEntryTrashResult, error) {
	session, root, unlock, err := a.lockProjectEntryMutationSession(ctx)
	if err != nil {
		return ProjectEntryTrashResult{}, err
	}
	defer unlock()
	if len(req.Entries) == 0 {
		return ProjectEntryTrashResult{}, fmt.Errorf("no entries selected")
	}

	entries, err := prepareGuardedTrashCandidates(root, session.ID, req.Entries)
	if err != nil {
		return ProjectEntryTrashResult{}, err
	}
	if len(entries) == 0 {
		return ProjectEntryTrashResult{}, fmt.Errorf("no entries selected")
	}

	operation := projectEntryOperation{
		ID:        newProjectEntryOperationID(),
		Kind:      "trash",
		Label:     trashOperationLabel(entries),
		CreatedAt: time.Now().UTC(),
		Trash: &projectEntryTrashOperation{
			StashRoot: projectEntryStashRootFromPath(entries[0].StashPath),
			Entries:   make([]projectEntryTrashOperationEntry, 0, len(entries)),
		},
	}

	moved := make([]guardedTrashCandidate, 0, len(entries))
	for _, entry := range entries {
		currentEntry, err := resolveProjectEntryPathInRoot(root, entry.Path, true)
		if err != nil {
			rollbackGuardedTrashMoves(moved)
			return ProjectEntryTrashResult{}, err
		}
		if err := validateUndoableTrashTarget(currentEntry); err != nil {
			rollbackGuardedTrashMoves(moved)
			return ProjectEntryTrashResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(entry.StashPath), 0o700); err != nil {
			rollbackGuardedTrashMoves(moved)
			return ProjectEntryTrashResult{}, err
		}
		if !projectEntryStashPathCanBeUsed(operation.Trash.StashRoot, entry.StashPath, true) {
			rollbackGuardedTrashMoves(moved)
			return ProjectEntryTrashResult{}, fmt.Errorf("undo stash path is unsafe: %s", entry.StashPath)
		}
		if err := os.Rename(entry.Path, entry.StashPath); err != nil {
			rollbackGuardedTrashMoves(moved)
			return ProjectEntryTrashResult{}, fmt.Errorf("undoable trash requires same-volume rename for %s: %w", entry.Path, err)
		}
		moved = append(moved, entry)
		operation.Trash.Entries = append(operation.Trash.Entries, projectEntryTrashOperationEntry{
			OriginalPath: entry.Path,
			StashPath:    entry.StashPath,
			IsDirectory:  entry.IsDirectory,
		})
	}

	session.projectEntryHistory.push(operation)
	for _, entry := range entries {
		a.pruneLSPDiagnosticsForProjectEntry(entry.Path)
		a.emitEvent("project:entry:deleted", projectEntryDeletedEvent{Path: entry.Path, IsDirectory: entry.IsDirectory})
	}
	return ProjectEntryTrashResult{Count: len(entries)}, nil
}

func (a *App) UndoProjectEntryOperation(ctx context.Context) (ProjectEntryUndoState, error) {
	session, root, unlock, err := a.lockProjectEntryMutationSession(ctx)
	if err != nil {
		return ProjectEntryUndoState{}, err
	}
	defer unlock()
	op, ok := session.projectEntryHistory.peekUndo()
	if !ok {
		return session.projectEntryHistory.state(), nil
	}
	if err := a.applyProjectEntryUndo(root, op); err != nil {
		return session.projectEntryHistory.state(), err
	}
	session.projectEntryHistory.commitUndoToRedo()
	return session.projectEntryHistory.state(), nil
}

func (a *App) RedoProjectEntryOperation(ctx context.Context) (ProjectEntryUndoState, error) {
	session, root, unlock, err := a.lockProjectEntryMutationSession(ctx)
	if err != nil {
		return ProjectEntryUndoState{}, err
	}
	defer unlock()
	op, ok := session.projectEntryHistory.peekRedo()
	if !ok {
		return session.projectEntryHistory.state(), nil
	}
	updatedOp, err := a.applyProjectEntryRedo(root, op)
	if err != nil {
		return session.projectEntryHistory.state(), err
	}
	session.projectEntryHistory.commitRedoToUndo(updatedOp)
	return session.projectEntryHistory.state(), nil
}

func (a *App) GetProjectEntryUndoState(ctx context.Context) (ProjectEntryUndoState, error) {
	session, _, err := a.projectEntrySession(ctx)
	if err != nil {
		return ProjectEntryUndoState{}, err
	}
	return session.projectEntryHistory.state(), nil
}

func (a *App) applyProjectEntryUndo(root projectEntryResolvedRoot, op projectEntryOperation) error {
	switch op.Kind {
	case "create":
		if op.Create == nil {
			return fmt.Errorf("create operation is missing data")
		}
		if _, err := resolveProjectEntryPathInRoot(root, op.Create.Path, true); err != nil {
			return err
		}
		if err := ensureCreatedEntryUnchanged(*op.Create); err != nil {
			return err
		}
		if op.Create.IsDirectory {
			if err := os.Remove(op.Create.Path); err != nil {
				return err
			}
		} else if err := os.Remove(op.Create.Path); err != nil {
			return err
		}
		a.pruneLSPDiagnosticsForProjectEntry(op.Create.Path)
		a.emitEvent("project:entry:deleted", projectEntryDeletedEvent{Path: op.Create.Path, IsDirectory: op.Create.IsDirectory})
		return nil
	case "rename":
		if op.Rename == nil {
			return fmt.Errorf("rename operation is missing data")
		}
		if err := validateProjectEntryRenameReplay(root, op.Rename.NewPath, op.Rename.OldPath); err != nil {
			return err
		}
		if err := renameWithoutCollision(op.Rename.NewPath, op.Rename.OldPath); err != nil {
			return err
		}
		a.remapLSPDiagnosticsForProjectEntry(op.Rename.NewPath, op.Rename.OldPath)
		a.emitEvent("project:entry:renamed", projectEntryRenamedEvent{OldPath: op.Rename.NewPath, NewPath: op.Rename.OldPath, IsDirectory: op.Rename.IsDirectory})
		return nil
	case "trash":
		if op.Trash == nil {
			return fmt.Errorf("trash operation is missing data")
		}
		if err := renameTrashOperationEntries(root, *op.Trash, true); err != nil {
			return err
		}
		for _, entry := range op.Trash.Entries {
			a.emitEvent("project:entry:created", projectEntryCreatedEvent{Path: entry.OriginalPath, IsDirectory: entry.IsDirectory})
		}
		return nil
	default:
		return fmt.Errorf("unknown project entry operation: %s", op.Kind)
	}
}

func (a *App) applyProjectEntryRedo(root projectEntryResolvedRoot, op projectEntryOperation) (projectEntryOperation, error) {
	switch op.Kind {
	case "create":
		if op.Create == nil {
			return op, fmt.Errorf("create operation is missing data")
		}
		if _, err := resolveProjectEntryPathInRoot(root, op.Create.Path, false); err != nil {
			return op, err
		}
		if _, err := os.Lstat(op.Create.Path); err == nil {
			return op, fmt.Errorf("entry already exists: %s", op.Create.Path)
		} else if !os.IsNotExist(err) {
			return op, err
		}
		if op.Create.IsDirectory {
			if err := os.Mkdir(op.Create.Path, 0o755); err != nil {
				return op, err
			}
		} else {
			file, err := os.OpenFile(op.Create.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
			if err != nil {
				return op, err
			}
			if err := file.Close(); err != nil {
				return op, err
			}
		}
		info, err := os.Lstat(op.Create.Path)
		if err != nil {
			return op, err
		}
		op.Create.Fingerprint = projectEntryFingerprintFromInfo(info)
		a.emitEvent("project:entry:created", projectEntryCreatedEvent{Path: op.Create.Path, IsDirectory: op.Create.IsDirectory})
		return op, nil
	case "rename":
		if op.Rename == nil {
			return op, fmt.Errorf("rename operation is missing data")
		}
		if err := validateProjectEntryRenameReplay(root, op.Rename.OldPath, op.Rename.NewPath); err != nil {
			return op, err
		}
		if err := renameWithoutCollision(op.Rename.OldPath, op.Rename.NewPath); err != nil {
			return op, err
		}
		a.remapLSPDiagnosticsForProjectEntry(op.Rename.OldPath, op.Rename.NewPath)
		a.emitEvent("project:entry:renamed", projectEntryRenamedEvent{OldPath: op.Rename.OldPath, NewPath: op.Rename.NewPath, IsDirectory: op.Rename.IsDirectory})
		return op, nil
	case "trash":
		if op.Trash == nil {
			return op, fmt.Errorf("trash operation is missing data")
		}
		if err := renameTrashOperationEntries(root, *op.Trash, false); err != nil {
			return op, err
		}
		for _, entry := range op.Trash.Entries {
			a.pruneLSPDiagnosticsForProjectEntry(entry.OriginalPath)
			a.emitEvent("project:entry:deleted", projectEntryDeletedEvent{Path: entry.OriginalPath, IsDirectory: entry.IsDirectory})
		}
		return op, nil
	default:
		return op, fmt.Errorf("unknown project entry operation: %s", op.Kind)
	}
}

func (a *App) projectEntryMutationSession(ctx context.Context) (*ProjectRuntimeSession, projectEntryResolvedRoot, error) {
	session, root, err := a.projectEntrySession(ctx)
	if err != nil {
		return nil, projectEntryResolvedRoot{}, err
	}
	if a.hasAnotherOpenSessionForResolvedRoot(session, root.Resolved) {
		return nil, projectEntryResolvedRoot{}, fmt.Errorf("undoable Explorer actions are disabled while the same project is open in another window")
	}
	return session, root, nil
}

func (a *App) lockProjectEntryMutationSession(ctx context.Context) (*ProjectRuntimeSession, projectEntryResolvedRoot, func(), error) {
	session, _, err := a.projectEntryMutationSession(ctx)
	if err != nil {
		return nil, projectEntryResolvedRoot{}, nil, err
	}
	session.lifecycleMu.Lock()
	unlock := session.lifecycleMu.Unlock
	root, err := resolveProjectEntryRoot(session)
	if err != nil {
		unlock()
		return nil, projectEntryResolvedRoot{}, nil, err
	}
	if a.hasAnotherOpenSessionForResolvedRoot(session, root.Resolved) {
		unlock()
		return nil, projectEntryResolvedRoot{}, nil, fmt.Errorf("undoable Explorer actions are disabled while the same project is open in another window")
	}
	return session, root, unlock, nil
}

func (a *App) projectEntrySession(ctx context.Context) (*ProjectRuntimeSession, projectEntryResolvedRoot, error) {
	var session *ProjectRuntimeSession
	if window := bindingContextWindow(ctx); window != nil {
		session = a.ensureProjectSessions().getByWindow(window)
		if session == nil {
			return nil, projectEntryResolvedRoot{}, fmt.Errorf("project session is not bound to the current window")
		}
	} else if a != nil && a.wailsApp != nil {
		return nil, projectEntryResolvedRoot{}, fmt.Errorf("project entry methods require a Wails window context")
	} else {
		session = a.activeProjectSession()
	}
	if session == nil {
		return nil, projectEntryResolvedRoot{}, fmt.Errorf("no project session")
	}
	root, err := resolveProjectEntryRoot(session)
	if err != nil {
		return nil, projectEntryResolvedRoot{}, err
	}
	return session, root, nil
}

func resolveProjectEntryRoot(session *ProjectRuntimeSession) (projectEntryResolvedRoot, error) {
	rawRoot := strings.TrimSpace(session.currentProjectPath())
	if rawRoot == "" {
		return projectEntryResolvedRoot{}, fmt.Errorf("no project opened")
	}
	rootAbs, err := filepath.Abs(filepath.Clean(rawRoot))
	if err != nil {
		return projectEntryResolvedRoot{}, err
	}
	rootResolved, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return projectEntryResolvedRoot{}, fmt.Errorf("cannot resolve project root: %w", err)
	}
	return projectEntryResolvedRoot{Abs: rootAbs, Resolved: filepath.Clean(rootResolved)}, nil
}

func resolveProjectEntryPathInRoot(root projectEntryResolvedRoot, rawPath string, mustExist bool) (projectEntryResolvedPath, error) {
	targetPath := strings.TrimSpace(rawPath)
	if targetPath == "" {
		return projectEntryResolvedPath{}, fmt.Errorf("path is required")
	}
	if !filepath.IsAbs(targetPath) {
		targetPath = filepath.Join(root.Abs, targetPath)
	}
	targetAbs, err := filepath.Abs(filepath.Clean(targetPath))
	if err != nil {
		return projectEntryResolvedPath{}, err
	}

	walkBase := root.Abs
	withinRootAbs, _ := isPathWithinRoot(root.Abs, targetAbs)
	if !withinRootAbs {
		withinRootResolved, _ := isPathWithinRoot(root.Resolved, targetAbs)
		if !withinRootResolved {
			return projectEntryResolvedPath{}, fmt.Errorf("path is outside current project: %s", targetAbs)
		}
		walkBase = root.Resolved
	}

	if err := ensureProjectEntryNoSymlinkComponents(walkBase, targetAbs, !mustExist); err != nil {
		return projectEntryResolvedPath{}, err
	}

	resolved, err := resolveProjectEntrySymlinkAwareTarget(targetAbs)
	if err != nil {
		return projectEntryResolvedPath{}, err
	}
	withinResolved, err := isPathWithinRoot(root.Resolved, resolved)
	if err != nil {
		return projectEntryResolvedPath{}, err
	}
	if !withinResolved {
		return projectEntryResolvedPath{}, fmt.Errorf("path escapes project root")
	}

	info, statErr := os.Lstat(targetAbs)
	if mustExist {
		if statErr != nil {
			return projectEntryResolvedPath{}, statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return projectEntryResolvedPath{}, fmt.Errorf("symlink entries are not supported: %s", targetAbs)
		}
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return projectEntryResolvedPath{}, statErr
	}

	rel, err := filepath.Rel(root.Resolved, resolved)
	if err != nil {
		rel = filepath.Base(targetAbs)
	}
	return projectEntryResolvedPath{
		Path:        targetAbs,
		Resolved:    resolved,
		Relative:    filepath.ToSlash(rel),
		Info:        info,
		IsDirectory: info != nil && info.IsDir(),
	}, nil
}

func ensureProjectEntryNoSymlinkComponents(root, target string, allowMissingFinal bool) error {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return err
	}
	if rel == "." {
		return nil
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("path escapes project root")
	}
	current := root
	parts := strings.Split(rel, string(os.PathSeparator))
	for index, part := range parts {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			if allowMissingFinal && index == len(parts)-1 && os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink path components are not supported: %s", current)
		}
	}
	return nil
}

func resolveProjectEntrySymlinkAwareTarget(targetAbs string) (string, error) {
	if resolved, err := filepath.EvalSymlinks(targetAbs); err == nil {
		return filepath.Clean(resolved), nil
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("cannot resolve path: %w", err)
	}

	current := targetAbs
	missingParts := make([]string, 0, 4)
	for {
		_, statErr := os.Lstat(current)
		if statErr == nil {
			resolvedCurrent, resolveErr := filepath.EvalSymlinks(current)
			if resolveErr != nil {
				return "", fmt.Errorf("cannot resolve path: %w", resolveErr)
			}
			for index := len(missingParts) - 1; index >= 0; index-- {
				resolvedCurrent = filepath.Join(resolvedCurrent, missingParts[index])
			}
			return filepath.Clean(resolvedCurrent), nil
		}
		if !os.IsNotExist(statErr) {
			return "", statErr
		}
		parent := filepath.Dir(current)
		if parent == current {
			return filepath.Clean(targetAbs), nil
		}
		missingParts = append(missingParts, filepath.Base(current))
		current = parent
	}
}

func prepareGuardedTrashCandidates(root projectEntryResolvedRoot, sessionID string, targets []ProjectEntryTrashTarget) ([]guardedTrashCandidate, error) {
	resolvedTargets := make([]projectEntryResolvedPath, 0, len(targets))
	seen := make(map[string]struct{})
	for _, target := range targets {
		resolved, err := resolveProjectEntryPathInRoot(root, target.Path, true)
		if err != nil {
			return nil, err
		}
		if resolved.Path == root.Abs || resolved.Resolved == root.Resolved {
			return nil, fmt.Errorf("cannot move project root to trash")
		}
		if _, ok := seen[resolved.Path]; ok {
			continue
		}
		seen[resolved.Path] = struct{}{}
		resolvedTargets = append(resolvedTargets, resolved)
	}

	sort.Slice(resolvedTargets, func(i, j int) bool {
		return resolvedTargets[i].Path < resolvedTargets[j].Path
	})
	deduped := make([]projectEntryResolvedPath, 0, len(resolvedTargets))
	for _, target := range resolvedTargets {
		nested := false
		for _, existing := range deduped {
			if pathWithinRoot(target.Path, existing.Path) {
				nested = true
				break
			}
		}
		if !nested {
			deduped = append(deduped, target)
		}
	}

	stashRoot, err := selectProjectEntryUndoStashRoot(root, sessionID)
	if err != nil {
		return nil, err
	}
	opID := newProjectEntryOperationID()
	candidates := make([]guardedTrashCandidate, 0, len(deduped))
	for index, target := range deduped {
		if err := validateUndoableTrashTarget(target); err != nil {
			return nil, err
		}
		stashName := fmt.Sprintf("%03d-%s", index, filepath.Base(target.Path))
		candidates = append(candidates, guardedTrashCandidate{
			Path:        target.Path,
			Relative:    target.Relative,
			IsDirectory: target.IsDirectory,
			StashPath:   filepath.Join(stashRoot, opID, stashName),
		})
	}
	return candidates, nil
}

func validateUndoableTrashTarget(target projectEntryResolvedPath) error {
	if isSensitiveProjectEntryPath(target.Relative) {
		return fmt.Errorf("sensitive paths cannot be retained for undo: %s", target.Relative)
	}
	if shouldSkipProjectEntryUndoPath(target.Path) {
		return fmt.Errorf("cache or dependency directories cannot be retained for undo: %s", target.Path)
	}
	if target.IsDirectory && isMacOSPackageDirectory(target.Path) {
		return fmt.Errorf("macOS package directories cannot be retained for undo: %s", target.Path)
	}
	if target.Info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("symlink entries cannot be retained for undo: %s", target.Path)
	}
	if hasMultipleHardlinks(target.Info) {
		return fmt.Errorf("hardlinked files cannot be retained for undo: %s", target.Path)
	}

	budget := projectEntryUndoBudget{}
	if err := budget.scan(target.Path); err != nil {
		return err
	}
	return nil
}

type projectEntryUndoBudget struct {
	items int
	bytes int64
}

func (b *projectEntryUndoBudget) scan(path string) error {
	return filepath.WalkDir(path, func(current string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink entries cannot be retained for undo: %s", current)
		}
		if entry.IsDir() {
			if shouldSkipProjectWatchDir(entry.Name()) {
				return fmt.Errorf("cache or dependency directories cannot be retained for undo: %s", current)
			}
			if current != path && isMacOSPackageDirectory(current) {
				return fmt.Errorf("macOS package directories cannot be retained for undo: %s", current)
			}
		}
		if hasMultipleHardlinks(info) {
			return fmt.Errorf("hardlinked files cannot be retained for undo: %s", current)
		}
		b.items++
		if !entry.IsDir() {
			b.bytes += info.Size()
		}
		if b.items > projectEntryUndoMaxDeleteItems {
			return fmt.Errorf("entry tree is too large to retain for undo")
		}
		if b.bytes > projectEntryUndoMaxDeleteBytes {
			return fmt.Errorf("entry tree is too large to retain for undo")
		}
		return nil
	})
}

func selectProjectEntryUndoStashRoot(root projectEntryResolvedRoot, sessionID string) (string, error) {
	projectHash := projectEntryProjectHash(root.Resolved)
	if configDir, err := os.UserConfigDir(); err == nil && strings.TrimSpace(configDir) != "" {
		candidate := filepath.Join(configDir, projectEntryUndoApplicationName, "project-entry-undo", projectHash, sessionID)
		if err := os.MkdirAll(candidate, 0o700); err == nil {
			if sameDevice(root.Resolved, candidate) && projectEntryStashPathIsSafe(configDir, candidate) {
				registerProjectEntryUndoStashRoot(candidate)
				return candidate, nil
			}
		}
	}

	parent := filepath.Dir(root.Resolved)
	candidate := filepath.Join(parent, projectEntryUndoStashDirName, projectHash, sessionID)
	if err := os.MkdirAll(candidate, 0o700); err != nil {
		return "", fmt.Errorf("cannot create undo stash on project volume: %w", err)
	}
	if !sameDevice(root.Resolved, candidate) {
		return "", fmt.Errorf("cannot create undo stash on the same filesystem as the project")
	}
	if !projectEntryStashPathIsSafe(parent, candidate) {
		return "", fmt.Errorf("cannot create undo stash through symlink path: %s", candidate)
	}
	registerProjectEntryUndoStashRoot(candidate)
	return candidate, nil
}

func registerProjectEntryUndoStashRoot(path string) {
	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return
	}
	root := filepath.Join(configDir, projectEntryUndoApplicationName, "project-entry-undo")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return
	}
	registryPath := filepath.Join(root, projectEntryUndoRegistryFile)
	existing, _ := os.ReadFile(registryPath)
	line := filepath.Clean(path)
	for _, current := range strings.Split(string(existing), "\n") {
		if strings.TrimSpace(current) == line {
			return
		}
	}
	_ = os.WriteFile(registryPath, append(existing, []byte(line+"\n")...), 0o600)
}

func (a *App) cleanupStaleProjectEntryUndoStashes() {
	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return
	}
	root := filepath.Join(configDir, projectEntryUndoApplicationName, "project-entry-undo")
	registryPath := filepath.Join(root, projectEntryUndoRegistryFile)
	data, err := os.ReadFile(registryPath)
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			path := strings.TrimSpace(line)
			if path != "" && projectEntryRegisteredStashRootIsSafe(root, path) {
				a.finalizeStaleProjectEntryStashRoot(path, time.Now().Add(-projectEntryUndoStartupCleanupAge))
			}
		}
	}
	a.finalizeStaleProjectEntryStashRoot(root, time.Now().Add(-projectEntryUndoStartupCleanupAge))
}

func (a *App) finalizeProjectEntryHistory(session *ProjectRuntimeSession) {
	if session == nil {
		return
	}
	ops := session.projectEntryHistory.clear()
	for _, op := range ops {
		if op.Trash == nil {
			continue
		}
		for _, entry := range op.Trash.Entries {
			if _, err := os.Lstat(entry.StashPath); err == nil {
				_ = trashProjectEntry(entry.StashPath, entry.IsDirectory)
			}
		}
	}
}

func (a *App) finalizeProjectEntryStashRoot(root string) {
	if !projectEntryStashRootCanBeFinalized(root) {
		return
	}
	a.finalizeProjectEntryStashRootContents(root)
}

func (a *App) finalizeProjectEntryStashRootContents(root string) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.Name() == projectEntryUndoRegistryFile {
			continue
		}
		path := filepath.Join(root, entry.Name())
		if entry.IsDir() {
			a.finalizeProjectEntryStashRootContents(path)
		}
		if _, err := os.Lstat(path); err == nil {
			_ = trashProjectEntry(path, entry.IsDir())
		}
	}
	_ = os.Remove(root)
}

func (a *App) finalizeStaleProjectEntryStashRoot(root string, staleBefore time.Time) {
	if !projectEntryStashRootCanBeFinalized(root) {
		return
	}
	a.finalizeStaleProjectEntryStashRootContents(root, staleBefore)
}

func (a *App) finalizeStaleProjectEntryStashRootContents(root string, staleBefore time.Time) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.Name() == projectEntryUndoRegistryFile {
			continue
		}
		path := filepath.Join(root, entry.Name())
		info, err := os.Lstat(path)
		if err != nil {
			continue
		}
		if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			if !info.ModTime().Before(staleBefore) {
				continue
			}
			a.finalizeStaleProjectEntryStashRootContents(path, staleBefore)
			if remaining, err := os.ReadDir(path); err == nil && len(remaining) == 0 {
				_ = os.Remove(path)
			}
			continue
		}
		if info.ModTime().Before(staleBefore) {
			if info.Mode()&os.ModeSymlink != 0 {
				_ = os.Remove(path)
			} else {
				_ = trashProjectEntry(path, info.IsDir())
			}
		}
	}
	if remaining, err := os.ReadDir(root); err == nil && len(remaining) == 0 {
		_ = os.Remove(root)
	}
}

func projectEntryRegisteredStashRootIsSafe(appUndoRoot string, registeredPath string) bool {
	if strings.TrimSpace(registeredPath) == "" {
		return false
	}
	registeredAbs, err := filepath.Abs(filepath.Clean(registeredPath))
	if err != nil {
		return false
	}
	appUndoAbs, err := filepath.Abs(filepath.Clean(appUndoRoot))
	if err != nil {
		return false
	}
	within, err := isPathWithinRoot(appUndoAbs, registeredAbs)
	if err != nil || !within {
		return false
	}
	return projectEntryStashPathIsSafe(appUndoAbs, registeredAbs)
}

func projectEntryStashRootCanBeFinalized(root string) bool {
	if strings.TrimSpace(root) == "" {
		return false
	}
	info, err := os.Lstat(filepath.Clean(root))
	if err != nil {
		return false
	}
	return info.IsDir() && info.Mode()&os.ModeSymlink == 0
}

func projectEntryStashPathIsSafe(base string, path string) bool {
	return projectEntryStashPathCanBeUsed(base, path, false)
}

func projectEntryStashPathCanBeUsed(base string, path string, allowMissingFinal bool) bool {
	baseAbs, err := filepath.Abs(filepath.Clean(base))
	if err != nil {
		return false
	}
	pathAbs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return false
	}
	within, err := isPathWithinRoot(baseAbs, pathAbs)
	if err != nil || !within {
		return false
	}
	return ensureProjectEntryNoSymlinkComponents(baseAbs, pathAbs, allowMissingFinal) == nil
}

func (h *projectEntryHistory) push(op projectEntryOperation) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.undo = append(h.undo, op)
	h.redo = nil
}

func (h *projectEntryHistory) peekUndo() (projectEntryOperation, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.undo) == 0 {
		return projectEntryOperation{}, false
	}
	return h.undo[len(h.undo)-1], true
}

func (h *projectEntryHistory) peekRedo() (projectEntryOperation, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.redo) == 0 {
		return projectEntryOperation{}, false
	}
	return h.redo[len(h.redo)-1], true
}

func (h *projectEntryHistory) commitUndoToRedo() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.undo) == 0 {
		return
	}
	op := h.undo[len(h.undo)-1]
	h.undo = h.undo[:len(h.undo)-1]
	h.redo = append(h.redo, op)
}

func (h *projectEntryHistory) commitRedoToUndo(op projectEntryOperation) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.redo) == 0 {
		return
	}
	h.redo = h.redo[:len(h.redo)-1]
	h.undo = append(h.undo, op)
}

func (h *projectEntryHistory) state() ProjectEntryUndoState {
	h.mu.Lock()
	defer h.mu.Unlock()
	state := ProjectEntryUndoState{
		CanUndo: len(h.undo) > 0,
		CanRedo: len(h.redo) > 0,
	}
	if len(h.undo) > 0 {
		state.UndoLabel = h.undo[len(h.undo)-1].Label
	}
	if len(h.redo) > 0 {
		state.RedoLabel = h.redo[len(h.redo)-1].Label
	}
	return state
}

func (h *projectEntryHistory) clear() []projectEntryOperation {
	h.mu.Lock()
	defer h.mu.Unlock()
	ops := append([]projectEntryOperation(nil), h.undo...)
	h.undo = nil
	h.redo = nil
	return ops
}

func ensureCreatedEntryUnchanged(op projectEntryCreateOperation) error {
	info, err := os.Lstat(op.Path)
	if err != nil {
		return err
	}
	if !projectEntryFingerprintMatches(projectEntryFingerprintFromInfo(info), op.Fingerprint) {
		return fmt.Errorf("created entry changed and cannot be safely undone: %s", op.Path)
	}
	if op.IsDirectory {
		entries, err := os.ReadDir(op.Path)
		if err != nil {
			return err
		}
		if len(entries) > 0 {
			return fmt.Errorf("created folder is not empty: %s", op.Path)
		}
	}
	return nil
}

func renameWithoutCollision(fromPath, toPath string) error {
	if _, err := os.Lstat(fromPath); err != nil {
		return err
	}
	if _, err := os.Lstat(toPath); err == nil {
		return fmt.Errorf("entry already exists: %s", toPath)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(toPath), 0o755); err != nil {
		return err
	}
	if err := os.Rename(fromPath, toPath); err != nil {
		return err
	}
	return nil
}

func validateProjectEntryRenameReplay(root projectEntryResolvedRoot, fromPath string, toPath string) error {
	if _, err := resolveProjectEntryPathInRoot(root, fromPath, true); err != nil {
		return err
	}
	if _, err := resolveProjectEntryPathInRoot(root, toPath, false); err != nil {
		return err
	}
	return nil
}

type projectEntryRenamePair struct {
	from string
	to   string
}

func renameTrashOperationEntries(root projectEntryResolvedRoot, op projectEntryTrashOperation, restoreFromStash bool) error {
	if strings.TrimSpace(op.StashRoot) == "" {
		return fmt.Errorf("trash operation is missing stash root")
	}
	if !projectEntryStashRootCanBeFinalized(op.StashRoot) {
		return fmt.Errorf("undo stash root is unsafe: %s", op.StashRoot)
	}
	pairs := make([]projectEntryRenamePair, 0, len(op.Entries))
	for _, entry := range op.Entries {
		fromPath := entry.OriginalPath
		toPath := entry.StashPath
		if restoreFromStash {
			fromPath = entry.StashPath
			toPath = entry.OriginalPath
		}
		if !projectEntryStashPathCanBeUsed(op.StashRoot, entry.StashPath, !restoreFromStash) {
			return fmt.Errorf("undo stash path is unsafe: %s", entry.StashPath)
		}
		if restoreFromStash {
			if _, err := resolveProjectEntryPathInRoot(root, entry.OriginalPath, false); err != nil {
				return err
			}
		} else {
			resolvedEntry, err := resolveProjectEntryPathInRoot(root, entry.OriginalPath, true)
			if err != nil {
				return err
			}
			if err := validateUndoableTrashTarget(resolvedEntry); err != nil {
				return err
			}
		}
		pairs = append(pairs, projectEntryRenamePair{from: fromPath, to: toPath})
	}

	for _, pair := range pairs {
		if _, err := os.Lstat(pair.from); err != nil {
			return err
		}
		if _, err := os.Lstat(pair.to); err == nil {
			return fmt.Errorf("entry already exists: %s", pair.to)
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(pair.to), 0o755); err != nil {
			return err
		}
	}

	moved := make([]projectEntryRenamePair, 0, len(pairs))
	for _, pair := range pairs {
		if err := os.Rename(pair.from, pair.to); err != nil {
			for index := len(moved) - 1; index >= 0; index-- {
				_ = os.Rename(moved[index].to, moved[index].from)
			}
			return err
		}
		moved = append(moved, pair)
	}
	return nil
}

func rollbackGuardedTrashMoves(moved []guardedTrashCandidate) {
	for index := len(moved) - 1; index >= 0; index-- {
		_ = os.Rename(moved[index].StashPath, moved[index].Path)
	}
}

func projectEntryStashRootFromPath(stashPath string) string {
	return filepath.Dir(filepath.Dir(stashPath))
}

func projectEntryFingerprintFromInfo(info os.FileInfo) projectEntryFingerprint {
	return projectEntryFingerprint{
		IsDirectory: info.IsDir(),
		Size:        info.Size(),
		Mode:        info.Mode().Perm(),
		ModUnixNano: info.ModTime().UnixNano(),
	}
}

func projectEntryFingerprintMatches(current, expected projectEntryFingerprint) bool {
	return current.IsDirectory == expected.IsDirectory &&
		current.Size == expected.Size &&
		current.Mode == expected.Mode &&
		current.ModUnixNano == expected.ModUnixNano
}

func trashOperationLabel(entries []guardedTrashCandidate) string {
	if len(entries) == 1 {
		return "Move " + filepath.Base(entries[0].Path) + " to Trash"
	}
	return fmt.Sprintf("Move %d items to Trash", len(entries))
}

func isSensitiveProjectEntryPath(relPath string) bool {
	normalizedPath := strings.ToLower(strings.TrimSpace(filepath.ToSlash(relPath)))
	if normalizedPath == "" {
		return false
	}
	baseName := filepath.Base(normalizedPath)
	for _, pattern := range projectEntrySensitivePathPatterns {
		normalizedPattern := strings.ToLower(strings.TrimSpace(pattern))
		if normalizedPattern == "" {
			continue
		}
		if strings.Contains(normalizedPattern, "/") {
			if matched, err := filepath.Match(normalizedPattern, normalizedPath); err == nil && matched {
				return true
			}
			continue
		}
		if matched, err := filepath.Match(normalizedPattern, baseName); err == nil && matched {
			return true
		}
	}
	return false
}

func shouldSkipProjectEntryUndoPath(path string) bool {
	for _, part := range strings.Split(filepath.Clean(path), string(os.PathSeparator)) {
		if shouldSkipProjectWatchDir(part) {
			return true
		}
	}
	return false
}

func isMacOSPackageDirectory(path string) bool {
	if goruntime.GOOS != "darwin" {
		return false
	}
	_, ok := macOSPackageDirectoryExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func hasMultipleHardlinks(info os.FileInfo) bool {
	if info == nil || info.IsDir() {
		return false
	}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return false
	}
	field := value.FieldByName("Nlink")
	if !field.IsValid() {
		return false
	}
	switch field.Kind() {
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return field.Uint() > 1
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return field.Int() > 1
	default:
		return false
	}
}

func sameDevice(pathA, pathB string) bool {
	infoA, errA := os.Stat(pathA)
	infoB, errB := os.Stat(pathB)
	if errA != nil || errB != nil {
		return false
	}
	devA, okA := fileDeviceID(infoA)
	devB, okB := fileDeviceID(infoB)
	return okA && okB && devA == devB
}

func fileDeviceID(info os.FileInfo) (uint64, bool) {
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		value = value.Elem()
	}
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return 0, false
	}
	field := value.FieldByName("Dev")
	if !field.IsValid() {
		return 0, false
	}
	switch field.Kind() {
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return field.Uint(), true
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		value := field.Int()
		if value < 0 {
			return 0, false
		}
		return uint64(value), true
	default:
		return 0, false
	}
}

func projectEntryProjectHash(projectRoot string) string {
	sum := sha256.Sum256([]byte(filepath.Clean(projectRoot)))
	return hex.EncodeToString(sum[:])[:16]
}

func newProjectEntryOperationID() string {
	var randomBytes [8]byte
	if _, err := rand.Read(randomBytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), hex.EncodeToString(randomBytes[:]))
}

func (a *App) hasAnotherOpenSessionForResolvedRoot(session *ProjectRuntimeSession, resolvedRoot string) bool {
	if a == nil || session == nil || strings.TrimSpace(resolvedRoot) == "" {
		return false
	}
	registry := a.ensureProjectSessions()
	registry.mu.RLock()
	defer registry.mu.RUnlock()
	for _, current := range registry.sessions {
		if current == nil || current == session {
			continue
		}
		currentRoot := strings.TrimSpace(current.currentProjectPath())
		if currentRoot == "" {
			continue
		}
		currentResolved, err := filepath.EvalSymlinks(currentRoot)
		if err != nil {
			continue
		}
		if filepath.Clean(currentResolved) == filepath.Clean(resolvedRoot) {
			return true
		}
	}
	return false
}
