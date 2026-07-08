package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"arlecchino/internal/workspace"
)

const (
	gitFieldSeparator             = "\x1f"
	gitRecordSeparator            = "\x1e"
	maxEditorFileBytes            = int64(20 * 1024 * 1024)
	maxInteractiveEditorFileBytes = int64(2 * 1024 * 1024)
	maxInteractiveEditorLines     = 20_000
	maxInteractiveEditorLineBytes = 20_000
	defaultEditorFilePreviewBytes = int64(64 * 1024)
	maxEditorFilePreviewBytes     = int64(256 * 1024)
	maxEditorVisualFileBytes      = int64(20 * 1024 * 1024)
	fileSniffBytes                = int64(64 * 1024)
)

var nonTextEditorExtensions = map[string]struct{}{
	".7z":      {},
	".a":       {},
	".accdb":   {},
	".app":     {},
	".avi":     {},
	".avif":    {},
	".bin":     {},
	".bmp":     {},
	".bz2":     {},
	".class":   {},
	".db":      {},
	".db3":     {},
	".dib":     {},
	".dll":     {},
	".dmb":     {},
	".dmp":     {},
	".doc":     {},
	".docx":    {},
	".dylib":   {},
	".exe":     {},
	".gif":     {},
	".gz":      {},
	".heic":    {},
	".heif":    {},
	".icns":    {},
	".ico":     {},
	".jar":     {},
	".jpeg":    {},
	".jpg":     {},
	".jpe":     {},
	".jfif":    {},
	".mdb":     {},
	".mov":     {},
	".mp3":     {},
	".mp4":     {},
	".o":       {},
	".otf":     {},
	".pdf":     {},
	".png":     {},
	".ppt":     {},
	".pptx":    {},
	".rar":     {},
	".sqlite":  {},
	".sqlite3": {},
	".so":      {},
	".svg":     {},
	".tar":     {},
	".tif":     {},
	".tiff":    {},
	".ttf":     {},
	".wasm":    {},
	".wav":     {},
	".webm":    {},
	".webp":    {},
	".woff":    {},
	".woff2":   {},
	".xls":     {},
	".xlsx":    {},
	".xz":      {},
	".zip":     {},
}

var binaryMagicPrefixes = [][]byte{
	{0x00, 0x61, 0x73, 0x6d},       // WebAssembly
	{0x1f, 0x8b},                   // gzip
	{0x25, 0x50, 0x44, 0x46, 0x2d}, // PDF
	{0x42, 0x4d},                   // BMP
	{0x49, 0x44, 0x33},             // MP3
	{0x4d, 0x5a},                   // PE executable
	{0x50, 0x4b, 0x03, 0x04},       // ZIP/OpenXML/JAR
	{0x50, 0x4b, 0x05, 0x06},
	{0x50, 0x4b, 0x07, 0x08},
	{0x52, 0x61, 0x72, 0x21},                         // RAR
	{0x7f, 0x45, 0x4c, 0x46},                         // ELF
	{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, // PNG
	{0xff, 0xd8, 0xff},                               // JPEG
	[]byte("GIF87a"),
	[]byte("GIF89a"),
	[]byte("SQLite format 3"),
}

var editorVisualFileExtensions = map[string]string{
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".gif":  "image/gif",
	".ico":  "image/x-icon",
	".jpeg": "image/jpeg",
	".jpe":  "image/jpeg",
	".jfif": "image/jpeg",
	".jpg":  "image/jpeg",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".webp": "image/webp",
}

var gitAllowedSubcommands = map[string]struct{}{
	"add":          {},
	"blame":        {},
	"branch":       {},
	"checkout":     {},
	"commit":       {},
	"diff":         {},
	"fetch":        {},
	"init":         {},
	"log":          {},
	"pull":         {},
	"push":         {},
	"remote":       {},
	"reset":        {},
	"show":         {},
	"stash":        {},
	"status":       {},
	"symbolic-ref": {},
}

var (
	trashProjectEntry  = moveProjectEntryToTrash
	revealProjectEntry = revealProjectEntryInFileManager
)

func gitCommandTimeout(args []string) time.Duration {
	if len(args) == 0 {
		return 10 * time.Second
	}

	switch args[0] {
	case "fetch", "pull", "push":
		return 90 * time.Second
	case "blame", "log", "show", "diff":
		return 20 * time.Second
	default:
		return 15 * time.Second
	}
}

type gitStatusCall struct {
	done   chan struct{}
	output string
	err    error
}

func isGitStatusCommand(args []string) bool {
	return len(args) > 0 && args[0] == "status"
}

func gitStatusCallKey(projectPath string, args []string) string {
	return projectPath + "\x00" + strings.Join(args, "\x00")
}

func projectGitMetadataExists(projectPath string) bool {
	if projectPath == "" {
		return false
	}
	if _, err := os.Stat(filepath.Join(projectPath, ".git")); err == nil {
		return true
	}
	return false
}

func projectIsInsideGitWorkTree(projectPath string) bool {
	if projectPath == "" {
		return false
	}
	cmd := exec.Command("git", "-C", projectPath, "rev-parse", "--is-inside-work-tree")
	output, err := cmd.Output()
	return err == nil && strings.TrimSpace(string(output)) == "true"
}

func validateGitInitAllowed(projectPath string, args []string) error {
	if len(args) != 1 {
		return fmt.Errorf("git init only supports default initialization")
	}
	if projectGitMetadataExists(projectPath) {
		return fmt.Errorf("git metadata already exists")
	}
	if projectIsInsideGitWorkTree(projectPath) {
		return fmt.Errorf("project is already inside a git repository")
	}
	return nil
}

type FileEntry struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

type ProjectEntryRenameResult struct {
	NewPath     string `json:"newPath"`
	IsDirectory bool   `json:"isDirectory"`
}

type EditorFileInspection struct {
	Path               string `json:"path"`
	Name               string `json:"name"`
	SizeBytes          int64  `json:"sizeBytes"`
	FormattedSize      string `json:"formattedSize"`
	IsText             bool   `json:"isText"`
	SafeForEditor      bool   `json:"safeForEditor"`
	LargeDocument      bool   `json:"largeDocument"`
	Reason             string `json:"reason"`
	LineCount          int    `json:"lineCount"`
	MaxLineLength      int    `json:"maxLineLength"`
	LimitBytes         int64  `json:"limitBytes"`
	LineLimit          int    `json:"lineLimit"`
	MaxLineLengthLimit int    `json:"maxLineLengthLimit"`
}

type EditorFilePreview struct {
	Inspection   EditorFileInspection `json:"inspection"`
	Content      string               `json:"content"`
	Truncated    bool                 `json:"truncated"`
	PreviewBytes int64                `json:"previewBytes"`
}

type EditorVisualFile struct {
	Path          string `json:"path"`
	Name          string `json:"name"`
	SizeBytes     int64  `json:"sizeBytes"`
	FormattedSize string `json:"formattedSize"`
	MimeType      string `json:"mimeType"`
	DataURL       string `json:"dataUrl"`
}

type projectEntryRenamedEvent struct {
	OldPath     string `json:"oldPath"`
	NewPath     string `json:"newPath"`
	IsDirectory bool   `json:"isDirectory"`
}

type projectEntryDeletedEvent struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
}

func (a *App) ReadDirectory(dirPath string) ([]FileEntry, error) {
	return a.readDirectoryForSession(a.activeProjectSession(), dirPath)
}

func (a *App) ReadDirectoryForProjectSession(sessionID string, dirPath string) ([]FileEntry, error) {
	session, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return nil, err
	}
	return a.readDirectoryForSession(session, dirPath)
}

func (a *App) readDirectoryForSession(session *ProjectRuntimeSession, dirPath string) ([]FileEntry, error) {
	var err error
	dirPath, err = a.resolveRendererProjectPathForSession(session, dirPath, "directory path", true)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}

	result := make([]FileEntry, 0, len(entries))
	for _, entry := range entries {
		if shouldHideProjectExplorerEntry(entry.Name()) {
			continue
		}
		fullPath := filepath.Join(dirPath, entry.Name())
		result = append(result, FileEntry{
			Name:        entry.Name(),
			Path:        fullPath,
			IsDirectory: entry.IsDir(),
		})
	}

	return result, nil
}

func shouldHideProjectExplorerEntry(name string) bool {
	return name == ".arlecchino"
}

func (a *App) InspectEditorFile(filePath string) (EditorFileInspection, error) {
	return a.inspectEditorFileForSession(a.activeProjectSession(), filePath)
}

func (a *App) InspectEditorFileForProjectSession(sessionID string, filePath string) (EditorFileInspection, error) {
	session, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return EditorFileInspection{}, err
	}
	return a.inspectEditorFileForSession(session, filePath)
}

func (a *App) inspectEditorFileForSession(session *ProjectRuntimeSession, filePath string) (EditorFileInspection, error) {
	var err error
	filePath, err = a.resolveRendererProjectPathForSession(session, filePath, "file path", true)
	if err != nil {
		return EditorFileInspection{}, err
	}
	return inspectEditorFile(filePath)
}

func (a *App) ReadEditorFilePreview(filePath string, maxBytes int) (EditorFilePreview, error) {
	return a.readEditorFilePreviewForSession(a.activeProjectSession(), filePath, maxBytes)
}

func (a *App) ReadEditorFilePreviewForProjectSession(sessionID string, filePath string, maxBytes int) (EditorFilePreview, error) {
	session, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return EditorFilePreview{}, err
	}
	return a.readEditorFilePreviewForSession(session, filePath, maxBytes)
}

func (a *App) readEditorFilePreviewForSession(session *ProjectRuntimeSession, filePath string, maxBytes int) (EditorFilePreview, error) {
	var err error
	filePath, err = a.resolveRendererProjectPathForSession(session, filePath, "file path", true)
	if err != nil {
		return EditorFilePreview{}, err
	}
	inspection, err := inspectEditorFile(filePath)
	if err != nil {
		return EditorFilePreview{}, err
	}
	if !inspection.IsText {
		return EditorFilePreview{}, fmt.Errorf("%s", inspection.Reason)
	}

	previewLimit := defaultEditorFilePreviewBytes
	if maxBytes > 0 {
		previewLimit = int64(maxBytes)
	}
	if previewLimit > maxEditorFilePreviewBytes {
		previewLimit = maxEditorFilePreviewBytes
	}
	if previewLimit < 1 {
		previewLimit = defaultEditorFilePreviewBytes
	}

	content, truncated, err := readEditorFilePreviewContent(filePath, previewLimit)
	if err != nil {
		return EditorFilePreview{}, err
	}

	return EditorFilePreview{
		Inspection:   inspection,
		Content:      content,
		Truncated:    truncated,
		PreviewBytes: int64(len([]byte(content))),
	}, nil
}

func (a *App) ReadEditorVisualFile(filePath string) (EditorVisualFile, error) {
	return a.readEditorVisualFileForSession(a.activeProjectSession(), filePath)
}

func (a *App) ReadEditorVisualFileForProjectSession(sessionID string, filePath string) (EditorVisualFile, error) {
	session, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return EditorVisualFile{}, err
	}
	return a.readEditorVisualFileForSession(session, filePath)
}

func (a *App) readEditorVisualFileForSession(session *ProjectRuntimeSession, filePath string) (EditorVisualFile, error) {
	var err error
	filePath, err = a.resolveRendererProjectPathForSession(session, filePath, "file path", true)
	if err != nil {
		return EditorVisualFile{}, err
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return EditorVisualFile{}, err
	}
	if info.IsDir() {
		return EditorVisualFile{}, fmt.Errorf("cannot open directory as a visual file: %s", filePath)
	}
	if info.Size() > maxEditorVisualFileBytes {
		return EditorVisualFile{}, fmt.Errorf("visual file is too large to preview (%s, limit %s): %s", formatFileSize(info.Size()), formatFileSize(maxEditorVisualFileBytes), filePath)
	}

	expectedMime, ok := editorVisualFileExtensions[strings.ToLower(filepath.Ext(filePath))]
	if !ok {
		return EditorVisualFile{}, fmt.Errorf("file is not a supported visual format: %s", filePath)
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		return EditorVisualFile{}, err
	}
	mimeType, ok := detectEditorVisualMime(filePath, content)
	if !ok || mimeType != expectedMime {
		return EditorVisualFile{}, fmt.Errorf("file content does not match supported visual format %s: %s", expectedMime, filePath)
	}

	return EditorVisualFile{
		Path:          filePath,
		Name:          filepath.Base(filePath),
		SizeBytes:     info.Size(),
		FormattedSize: formatFileSize(info.Size()),
		MimeType:      mimeType,
		DataURL:       "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(content),
	}, nil
}

func (a *App) ReadFile(filePath string) (string, error) {
	return a.readFileForSession(a.activeProjectSession(), filePath)
}

func (a *App) ReadFileForProjectSession(sessionID string, filePath string) (string, error) {
	session, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return "", err
	}
	return a.readFileForSession(session, filePath)
}

func (a *App) readFileForSession(session *ProjectRuntimeSession, filePath string) (string, error) {
	var err error
	filePath, err = a.resolveRendererProjectPathForSession(session, filePath, "file path", true)
	if err != nil {
		return "", err
	}
	inspection, err := inspectEditorFile(filePath)
	if err != nil {
		return "", err
	}
	if !inspection.IsText || !inspection.SafeForEditor {
		return "", fmt.Errorf("%s", inspection.Reason)
	}

	content, err := readEditorFileContent(filePath, inspection.SizeBytes)
	if err != nil {
		return "", err
	}
	content = bytes.TrimPrefix(content, []byte{0xef, 0xbb, 0xbf})
	if !utf8.Valid(content) {
		return "", fmt.Errorf("file is not valid UTF-8 text and cannot be opened in the editor: %s", filePath)
	}
	return string(content), nil
}

func inspectEditorFile(filePath string) (EditorFileInspection, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return EditorFileInspection{}, err
	}

	inspection := EditorFileInspection{
		Path:               filePath,
		Name:               filepath.Base(filePath),
		SizeBytes:          info.Size(),
		FormattedSize:      formatFileSize(info.Size()),
		IsText:             true,
		SafeForEditor:      true,
		LimitBytes:         maxInteractiveEditorFileBytes,
		LineLimit:          maxInteractiveEditorLines,
		MaxLineLengthLimit: maxInteractiveEditorLineBytes,
		LineCount:          1,
	}

	if info.IsDir() {
		inspection.IsText = false
		inspection.SafeForEditor = false
		inspection.Reason = fmt.Sprintf("cannot open directory as a file: %s", filePath)
		return inspection, nil
	}
	if isKnownNonTextEditorPath(filePath) {
		inspection.IsText = false
		inspection.SafeForEditor = false
		inspection.Reason = fmt.Sprintf("file is not a text document and cannot be opened in the editor: %s", filePath)
		return inspection, nil
	}
	if info.Size() > maxEditorFileBytes {
		inspection.SafeForEditor = false
		inspection.LargeDocument = true
		inspection.Reason = fmt.Sprintf("file is too large to open in the editor (%s, limit %s): %s", formatFileSize(info.Size()), formatFileSize(maxEditorFileBytes), filePath)
		return inspection, nil
	}

	scanLimit := info.Size()
	if scanLimit > maxInteractiveEditorFileBytes {
		scanLimit = fileSniffBytes
		if scanLimit > info.Size() {
			scanLimit = info.Size()
		}
	}

	content, truncated, err := readEditorFilePrefix(filePath, scanLimit)
	if err != nil {
		return EditorFileInspection{}, err
	}
	content = bytes.TrimPrefix(content, []byte{0xef, 0xbb, 0xbf})
	if looksLikeBinary(content) {
		inspection.IsText = false
		inspection.SafeForEditor = false
		inspection.Reason = fmt.Sprintf("file appears to be binary and cannot be opened in the editor: %s", filePath)
		return inspection, nil
	}
	if !truncated && !utf8.Valid(content) {
		inspection.IsText = false
		inspection.SafeForEditor = false
		inspection.Reason = fmt.Sprintf("file is not valid UTF-8 text and cannot be opened in the editor: %s", filePath)
		return inspection, nil
	}

	lineCount, maxLineLength := measureEditorTextShape(content)
	inspection.LineCount = lineCount
	inspection.MaxLineLength = maxLineLength

	switch {
	case info.Size() > maxInteractiveEditorFileBytes:
		inspection.SafeForEditor = false
		inspection.LargeDocument = true
		inspection.Reason = fmt.Sprintf("file opens in guarded preview by default (%s, interactive limit %s): %s", formatFileSize(info.Size()), formatFileSize(maxInteractiveEditorFileBytes), filePath)
	case lineCount > maxInteractiveEditorLines:
		inspection.SafeForEditor = false
		inspection.LargeDocument = true
		inspection.Reason = fmt.Sprintf("file has too many lines for interactive editing (%d, limit %d): %s", lineCount, maxInteractiveEditorLines, filePath)
	case maxLineLength > maxInteractiveEditorLineBytes:
		inspection.SafeForEditor = false
		inspection.LargeDocument = true
		inspection.Reason = fmt.Sprintf("file has a line that is too long for interactive editing (%d bytes, limit %d): %s", maxLineLength, maxInteractiveEditorLineBytes, filePath)
	default:
		inspection.Reason = "safe for interactive editing"
	}

	return inspection, nil
}

func isKnownNonTextEditorPath(filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == "" {
		return false
	}
	_, ok := nonTextEditorExtensions[ext]
	return ok
}

func isEditorVisualFilePath(filePath string) bool {
	_, ok := editorVisualFileExtensions[strings.ToLower(filepath.Ext(filePath))]
	return ok
}

func detectEditorVisualMime(filePath string, content []byte) (string, bool) {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".png":
		return "image/png", bytes.HasPrefix(content, []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a})
	case ".jpg", ".jpeg", ".jpe", ".jfif":
		return "image/jpeg", len(content) >= 3 && content[0] == 0xff && content[1] == 0xd8 && content[2] == 0xff
	case ".gif":
		return "image/gif", bytes.HasPrefix(content, []byte("GIF87a")) || bytes.HasPrefix(content, []byte("GIF89a"))
	case ".webp":
		return "image/webp", len(content) >= 12 && bytes.HasPrefix(content, []byte("RIFF")) && string(content[8:12]) == "WEBP"
	case ".bmp":
		return "image/bmp", bytes.HasPrefix(content, []byte{0x42, 0x4d})
	case ".ico":
		return "image/x-icon", bytes.HasPrefix(content, []byte{0x00, 0x00, 0x01, 0x00}) || bytes.HasPrefix(content, []byte{0x00, 0x00, 0x02, 0x00})
	case ".avif":
		return "image/avif", len(content) >= 12 && string(content[4:8]) == "ftyp" && (string(content[8:12]) == "avif" || string(content[8:12]) == "avis")
	case ".svg":
		trimmed := bytes.TrimSpace(bytes.TrimPrefix(content, []byte{0xef, 0xbb, 0xbf}))
		if !utf8.Valid(trimmed) {
			return "image/svg+xml", false
		}
		prefix := strings.ToLower(string(trimmed))
		if strings.HasPrefix(prefix, "<?xml") {
			if end := strings.Index(prefix, "?>"); end >= 0 {
				prefix = strings.TrimSpace(prefix[end+2:])
			}
		}
		return "image/svg+xml", strings.HasPrefix(prefix, "<svg") || strings.HasPrefix(prefix, "<!doctype svg")
	default:
		return "", false
	}
}

func readEditorFilePrefix(filePath string, limit int64) ([]byte, bool, error) {
	if limit <= 0 {
		return nil, false, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()

	content := make([]byte, int(limit))
	n, err := io.ReadFull(file, content)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, false, err
	}

	return content[:n], int64(n) == limit, nil
}

func readEditorFilePreviewContent(filePath string, limit int64) (string, bool, error) {
	readLimit := limit + int64(utf8.UTFMax)
	content, hitLimit, err := readEditorFilePrefix(filePath, readLimit)
	if err != nil {
		return "", false, err
	}
	content = bytes.TrimPrefix(content, []byte{0xef, 0xbb, 0xbf})
	if looksLikeBinary(content) {
		return "", false, fmt.Errorf("file appears to be binary and cannot be opened in the editor: %s", filePath)
	}

	if int64(len(content)) > limit {
		content = content[:limit]
		hitLimit = true
	}
	content = trimValidUTF8Prefix(content)

	info, err := os.Stat(filePath)
	if err != nil {
		return "", false, err
	}
	truncated := hitLimit || int64(len(content)) < info.Size()
	return string(content), truncated, nil
}

func readEditorFileContent(filePath string, size int64) ([]byte, error) {
	if size <= 0 {
		return nil, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	content := make([]byte, int(size))
	sampleLimit := fileSniffBytes
	if size < sampleLimit {
		sampleLimit = size
	}

	sampleSize := int(sampleLimit)
	sampleN, err := io.ReadFull(file, content[:sampleSize])
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	if looksLikeBinary(content[:sampleN]) {
		return nil, fmt.Errorf("file appears to be binary and cannot be opened in the editor: %s", filePath)
	}
	if sampleN < sampleSize {
		return content[:sampleN], nil
	}

	restN, err := io.ReadFull(file, content[sampleN:])
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return nil, err
	}
	return content[:sampleN+restN], nil
}

func measureEditorTextShape(content []byte) (int, int) {
	if len(content) == 0 {
		return 1, 0
	}

	lineCount := 1
	currentLineLength := 0
	maxLineLength := 0
	for _, b := range content {
		if b == '\n' {
			lineCount++
			if currentLineLength > maxLineLength {
				maxLineLength = currentLineLength
			}
			currentLineLength = 0
			continue
		}
		currentLineLength++
	}
	if currentLineLength > maxLineLength {
		maxLineLength = currentLineLength
	}
	return lineCount, maxLineLength
}

func trimValidUTF8Prefix(content []byte) []byte {
	for len(content) > 0 && !utf8.Valid(content) {
		_, size := utf8.DecodeLastRune(content)
		if size <= 0 {
			return nil
		}
		content = content[:len(content)-size]
	}
	return content
}

func looksLikeBinary(sample []byte) bool {
	if len(sample) == 0 {
		return false
	}

	for _, prefix := range binaryMagicPrefixes {
		if bytes.HasPrefix(sample, prefix) {
			return true
		}
	}

	if bytes.Contains(sample, []byte{0x00}) {
		return true
	}

	controlBytes := 0
	for _, b := range sample {
		if b < 0x20 && b != '\n' && b != '\r' && b != '\t' && b != '\f' {
			controlBytes++
		}
	}
	return controlBytes > 0 && controlBytes*100/len(sample) > 5
}

func formatFileSize(bytes int64) string {
	const unit = int64(1024)
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}

	value := float64(bytes)
	for _, suffix := range []string{"KB", "MB", "GB", "TB"} {
		value /= float64(unit)
		if value < float64(unit) {
			return fmt.Sprintf("%.1f %s", value, suffix)
		}
	}
	return fmt.Sprintf("%.1f PB", value/float64(unit))
}

func (a *App) WriteFile(filePath string, content string) error {
	return a.writeFileForSession(a.activeProjectSession(), filePath, content)
}

func (a *App) WriteFileForProjectSession(sessionID string, filePath string, content string) error {
	session, err := a.projectSessionByExplicitID(sessionID)
	if err != nil {
		return err
	}
	return a.writeFileForSession(session, filePath, content)
}

func (a *App) writeFileForSession(session *ProjectRuntimeSession, filePath string, content string) error {
	var err error
	filePath, err = a.resolveRendererProjectPathForSession(session, filePath, "file path", false)
	if err != nil {
		return err
	}
	_, statErr := os.Stat(filePath)
	created := os.IsNotExist(statErr)
	if statErr != nil && !created {
		return statErr
	}

	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return err
	}

	if engine := a.activeCoreEngineForPath(filePath); engine != nil {
		if created {
			engine.OnFileCreated(filePath, []byte(content))
		} else {
			engine.OnFileSaved(filePath)
		}
	}

	eventName := "file:changed"
	if created {
		eventName = "file:created"
	}
	a.emitEvent(eventName, filePath)

	return nil
}

func (a *App) CreateDirectory(dirPath string) error {
	dirPath, err := a.resolveRendererProjectPath(dirPath, "directory path", false)
	if err != nil {
		return err
	}

	if _, err := os.Stat(dirPath); err == nil {
		return fmt.Errorf("directory already exists: %s", dirPath)
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		return err
	}

	a.emitEvent("project:entry:created", projectEntryCreatedEvent{
		Path:        dirPath,
		IsDirectory: true,
	})

	return nil
}

func (a *App) RenameProjectEntry(path string, newName string) (ProjectEntryRenameResult, error) {
	entryPath, projectPath, err := a.resolveProjectEntryPath(path)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}

	info, err := os.Stat(entryPath)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}

	sanitizedName, err := sanitizeProjectEntryName(newName)
	if err != nil {
		return ProjectEntryRenameResult{}, err
	}

	targetPath := filepath.Clean(filepath.Join(filepath.Dir(entryPath), sanitizedName))
	if targetPath != entryPath {
		if err := ensurePathWithinProject(projectPath, targetPath); err != nil {
			return ProjectEntryRenameResult{}, err
		}
		if _, err := os.Stat(targetPath); err == nil {
			return ProjectEntryRenameResult{}, fmt.Errorf("entry already exists: %s", targetPath)
		} else if !os.IsNotExist(err) {
			return ProjectEntryRenameResult{}, err
		}
	}

	if err := os.Rename(entryPath, targetPath); err != nil {
		return ProjectEntryRenameResult{}, fmt.Errorf("rename project entry: %w", err)
	}

	a.remapLSPDiagnosticsForProjectEntry(entryPath, targetPath)
	result := ProjectEntryRenameResult{
		NewPath:     targetPath,
		IsDirectory: info.IsDir(),
	}
	a.emitEvent("project:entry:renamed", projectEntryRenamedEvent{
		OldPath:     entryPath,
		NewPath:     targetPath,
		IsDirectory: info.IsDir(),
	})
	return result, nil
}

func (a *App) TrashProjectEntry(path string) error {
	session := a.activeProjectSession()
	root, err := resolveProjectEntryRoot(session)
	if err != nil {
		return err
	}
	entry, err := resolveProjectEntryPathInRoot(root, path, true)
	if err != nil {
		return err
	}
	if entry.Path == root.Abs || entry.Resolved == root.Resolved {
		return fmt.Errorf("cannot move project root to trash")
	}

	if err := trashProjectEntry(entry.Path, entry.IsDirectory); err != nil {
		return err
	}

	a.pruneLSPDiagnosticsForProjectEntry(entry.Path)
	a.emitEvent("project:entry:deleted", projectEntryDeletedEvent{
		Path:        entry.Path,
		IsDirectory: entry.IsDirectory,
	})
	return nil
}

func (a *App) RevealProjectEntry(path string) error {
	entryPath, _, err := a.resolveProjectEntryPath(path)
	if err != nil {
		return err
	}

	return revealProjectEntry(entryPath)
}

func (a *App) RevealPathInFileManager(path string) error {
	entryPath, err := normalizeRequiredPath(path, "path")
	if err != nil {
		return err
	}

	return revealProjectEntry(entryPath)
}

func normalizeRequiredPath(rawPath string, fieldName string) (string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", fmt.Errorf("%s is required", fieldName)
	}

	absolutePath, err := filepath.Abs(trimmed)
	if err != nil {
		return "", err
	}

	return filepath.Clean(absolutePath), nil
}

func (a *App) resolveRendererProjectPath(rawPath string, fieldName string, mustExist bool) (string, error) {
	return a.resolveRendererProjectPathForSession(a.activeProjectSession(), rawPath, fieldName, mustExist)
}

func (a *App) resolveRendererProjectPathForSession(session *ProjectRuntimeSession, rawPath string, fieldName string, mustExist bool) (string, error) {
	projectPath := ""
	if session != nil {
		projectPath = strings.TrimSpace(session.currentProjectPath())
	}
	if projectPath == "" {
		path, err := normalizeRequiredPath(rawPath, fieldName)
		if err != nil {
			return "", err
		}
		if mustExist {
			if _, err := os.Stat(path); err != nil {
				return "", err
			}
		}
		return path, nil
	}
	root, err := resolveProjectEntryRootFromPath(projectPath)
	if err != nil {
		return "", err
	}
	resolved, err := resolveProjectEntryPathInRoot(root, rawPath, mustExist)
	if err != nil {
		return "", err
	}
	return resolved.Path, nil
}

func (a *App) projectSessionByExplicitID(sessionID string) (*ProjectRuntimeSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		sessionID = defaultProjectSessionID
	}
	session := a.projectSessionByID(sessionID)
	if session == nil {
		return nil, fmt.Errorf("project session not found: %s", sessionID)
	}
	return session, nil
}

func sanitizeProjectEntryName(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("new name is required")
	}
	if trimmed == "." || trimmed == ".." {
		return "", fmt.Errorf("new name is invalid: %s", trimmed)
	}
	if strings.ContainsRune(trimmed, '/') || strings.ContainsRune(trimmed, '\\') {
		return "", fmt.Errorf("new name must not contain path separators")
	}

	return trimmed, nil
}

func ensurePathWithinProject(projectPath string, entryPath string) error {
	cleanProject := filepath.Clean(projectPath)
	cleanEntry := filepath.Clean(entryPath)
	if cleanProject == "" || cleanProject == "." {
		return fmt.Errorf("project path is required")
	}
	if cleanEntry == cleanProject {
		return nil
	}

	prefix := cleanProject + string(os.PathSeparator)
	if strings.HasPrefix(cleanEntry, prefix) {
		return nil
	}

	return fmt.Errorf("path is outside current project: %s", cleanEntry)
}

func (a *App) resolveProjectEntryPath(path string) (entryPath string, projectPath string, err error) {
	entryPath, err = normalizeRequiredPath(path, "path")
	if err != nil {
		return "", "", err
	}

	projectPath, err = normalizeRequiredPath(a.currentProjectPath(), "project path")
	if err != nil {
		return "", "", fmt.Errorf("no project opened")
	}

	if err := ensurePathWithinProject(projectPath, entryPath); err != nil {
		return "", "", err
	}

	return entryPath, projectPath, nil
}

func moveProjectEntryToTrash(path string, isDirectory bool) error {
	switch goruntime.GOOS {
	case "darwin":
		script := fmt.Sprintf(`tell application "Finder" to delete POSIX file %q`, path)
		output, err := exec.Command("osascript", "-e", script).CombinedOutput()
		if err != nil {
			return fmt.Errorf("move to Trash failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	case "windows":
		command := buildWindowsTrashCommand(path, isDirectory)
		output, err := exec.Command(
			"powershell",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			command,
		).CombinedOutput()
		if err != nil {
			return fmt.Errorf("move to Recycle Bin failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	default:
		output, err := exec.Command("gio", "trash", path).CombinedOutput()
		if err != nil {
			return fmt.Errorf("move to trash failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	}
}

func revealProjectEntryInFileManager(path string) error {
	pathToReveal := filepath.Clean(path)
	if _, err := os.Stat(pathToReveal); err != nil {
		if os.IsNotExist(err) {
			pathToReveal = filepath.Dir(pathToReveal)
		} else {
			return err
		}
	}

	switch goruntime.GOOS {
	case "darwin":
		output, err := exec.Command("open", "-R", pathToReveal).CombinedOutput()
		if err != nil {
			return fmt.Errorf("reveal in Finder failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	case "windows":
		output, err := exec.Command("explorer", "/select,"+pathToReveal).CombinedOutput()
		if err != nil {
			return fmt.Errorf("reveal in Explorer failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	default:
		output, err := exec.Command("xdg-open", filepath.Dir(pathToReveal)).CombinedOutput()
		if err != nil {
			return fmt.Errorf("reveal in file manager failed: %w (%s)", err, strings.TrimSpace(string(output)))
		}
		return nil
	}
}

func buildWindowsTrashCommand(path string, isDirectory bool) string {
	quotedPath := strings.ReplaceAll(path, "'", "''")
	if isDirectory {
		return fmt.Sprintf(
			`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('%s', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
			quotedPath,
		)
	}

	return fmt.Sprintf(
		`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('%s', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
		quotedPath,
	)
}

// FindFileByName searches for a file by name in a directory recursively
// Returns all matching file paths
func (a *App) FindFileByName(searchDir string, fileName string) ([]string, error) {
	var results []string
	resolvedSearchDir, err := a.resolveRendererProjectPath(searchDir, "search directory", true)
	if err != nil {
		return nil, err
	}

	err = filepath.Walk(resolvedSearchDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors (permission denied, etc.)
		}

		// Skip vendor, node_modules, .git directories
		if info.IsDir() {
			name := info.Name()
			if name == "vendor" || name == "node_modules" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}

		if info.Name() == fileName {
			results = append(results, path)
		}
		return nil
	})

	return results, err
}

// FormatCode formats a file using code formatter (Prettier for JS/TS/HTML/CSS)
func (a *App) FormatCode(filePath string, content string) (string, error) {
	// Get project root to find prettier
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return "", fmt.Errorf("no project opened")
	}

	// Check if file type is supported by Prettier
	ext := strings.ToLower(filepath.Ext(filePath))
	supportedExts := map[string]bool{
		".js":    true,
		".jsx":   true,
		".ts":    true,
		".tsx":   true,
		".json":  true,
		".html":  true,
		".css":   true,
		".scss":  true,
		".md":    true,
		".vue":   true,
		".php":   true,
		".blade": true, // Blade templates
	}

	if !supportedExts[ext] {
		// Return original content for unsupported files
		return content, nil
	}

	// Path to prettier in frontend directory
	prettierPath := filepath.Join(projectPath, "frontend", "node_modules", ".bin", "prettier")

	// Check if prettier exists
	if _, err := os.Stat(prettierPath); os.IsNotExist(err) {
		return "", fmt.Errorf("prettier not found at %s", prettierPath)
	}

	// Create temp file for formatting
	tmpFile, err := os.CreateTemp("", "prettier-*"+ext)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpFile.Name())

	// Write content to temp file
	if err := os.WriteFile(tmpFile.Name(), []byte(content), 0644); err != nil {
		return "", err
	}

	// Run prettier
	cmd := exec.Command(prettierPath, "--write", tmpFile.Name())
	cmd.Dir = filepath.Join(projectPath, "frontend")

	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("prettier error: %s, output: %s", err, string(output))
	}

	// Read formatted content
	formatted, err := os.ReadFile(tmpFile.Name())
	if err != nil {
		return "", err
	}

	return string(formatted), nil
}

// SearchResult represents a single search match
type SearchResult struct {
	File       string `json:"file"`
	Line       int    `json:"line"`
	Column     int    `json:"column"`
	Preview    string `json:"preview"`
	MatchStart int    `json:"matchStart"`
	MatchEnd   int    `json:"matchEnd"`
	Priority   int    `json:"priority"`
}

// isWordChar checks if a character is a word character (alphanumeric or underscore)
func isWordChar(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_'
}

// SearchInProject searches for a query string in all project files
func (a *App) SearchInProject(query string, caseSensitive bool, useRegex bool, wholeWord bool) ([]SearchResult, error) {
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return nil, fmt.Errorf("no project opened")
	}

	var results []SearchResult
	maxResults := 500 // Limit results to prevent performance issues

	// Priority mapping for files (higher = more important)
	getFilePriority := func(path string) int {
		lowerPath := strings.ToLower(path)

		// Highest priority: routes
		if strings.Contains(lowerPath, "routes/web.php") {
			return 100
		}
		if strings.Contains(lowerPath, "routes/api.php") {
			return 95
		}
		if strings.HasPrefix(lowerPath, "routes/") {
			return 90
		}

		// High priority: controllers, models
		if strings.HasPrefix(lowerPath, "app/http/controllers/") {
			return 85
		}
		if strings.HasPrefix(lowerPath, "app/models/") {
			return 80
		}

		// Medium-high: views, services
		if strings.Contains(lowerPath, "resources/views/") {
			return 70
		}
		if strings.HasPrefix(lowerPath, "app/services/") {
			return 65
		}

		// Medium: migrations, tests
		if strings.Contains(lowerPath, "database/migrations/") {
			return 50
		}
		if strings.Contains(lowerPath, "tests/") {
			return 45
		}

		// Low priority: config, vendor files, IDE files
		if strings.HasPrefix(lowerPath, ".idea/") {
			return 5
		}
		if strings.HasPrefix(lowerPath, "vendor/") {
			return 3
		}
		if strings.Contains(lowerPath, ".xml") {
			return 2
		}

		// Default priority
		return 40
	}

	// Extensions to search in
	searchableExts := map[string]bool{
		".php": true, ".js": true, ".ts": true, ".tsx": true, ".jsx": true,
		".vue": true, ".html": true, ".blade.php": true, ".css": true,
		".scss": true, ".json": true, ".md": true, ".env": true,
		".sql": true, ".xml": true, ".yaml": true, ".yml": true,
	}

	// Directories to exclude
	excludeDirs := map[string]bool{
		"node_modules": true, "vendor": true, ".git": true,
		"storage": true, "bootstrap/cache": true, "public/build": true,
	}

	scanner, scannerErr := workspace.NewScanner(projectPath, workspace.ScannerOptions{
		UseGitIgnore: true,
		SkipDirs:     boolMapToSet(excludeDirs),
	})
	if scannerErr != nil {
		return nil, scannerErr
	}
	entries, _, err := scanner.Scan(context.Background())
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDirectory {
			continue
		}
		path := entry.Path
		// Check if file extension is searchable
		ext := filepath.Ext(path)
		if ext == "" {
			// Check for .blade.php
			if strings.HasSuffix(path, ".blade.php") {
				ext = ".blade.php"
			} else {
				continue
			}
		}

		if !searchableExts[ext] {
			continue
		}

		// Read file
		content, err := os.ReadFile(path)
		if err != nil {
			continue // Skip unreadable files
		}

		lines := strings.Split(string(content), "\n")
		relPath := entry.RelPath

		for lineNum, line := range lines {
			if len(results) >= maxResults {
				break
			}

			// Find all matches in the line
			searchLine := line
			if !caseSensitive {
				searchLine = strings.ToLower(line)
				query = strings.ToLower(query)
			}

			matchIndex := strings.Index(searchLine, query)

			for matchIndex >= 0 {
				// Check for whole word match if required
				isWholeWord := true
				if wholeWord {
					// Check character before match
					if matchIndex > 0 {
						prevChar := rune(searchLine[matchIndex-1])
						if isWordChar(prevChar) {
							isWholeWord = false
						}
					}
					// Check character after match
					if matchIndex+len(query) < len(searchLine) {
						nextChar := rune(searchLine[matchIndex+len(query)])
						if isWordChar(nextChar) {
							isWholeWord = false
						}
					}
				}

				if isWholeWord {
					// Create preview (max 100 chars)
					preview := strings.TrimSpace(line)
					previewMatchIndex := matchIndex
					if len(preview) > 100 {
						start := matchIndex - 20
						if start < 0 {
							start = 0
						}
						end := matchIndex + len(query) + 30
						if end > len(preview) {
							end = len(preview)
						}
						preview = preview[start:end]
						previewMatchIndex = matchIndex - start
					}

					results = append(results, SearchResult{
						File:       path,
						Line:       lineNum + 1,
						Column:     matchIndex + 1,
						Preview:    preview,
						MatchStart: previewMatchIndex,
						MatchEnd:   previewMatchIndex + len(query),
						Priority:   getFilePriority(relPath),
					})

					// Only find first match per line to avoid duplicates
					break
				}

				// Find next match in the same line
				nextIndex := strings.Index(searchLine[matchIndex+1:], query)
				if nextIndex >= 0 {
					matchIndex = matchIndex + 1 + nextIndex
				} else {
					break
				}
			}
		}
		if len(results) >= maxResults {
			break
		}
	}

	// Sort results by priority (higher first)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Priority > results[j].Priority
	})

	return results, nil
}

func boolMapToSet(values map[string]bool) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for value, enabled := range values {
		if enabled {
			result[value] = struct{}{}
		}
	}
	return result
}

// RunGitCommand executes a git command in the project directory
func (a *App) RunGitCommand(args []string) (string, error) {
	projectPath := a.GetCurrentProjectPath()
	if projectPath == "" {
		return "", fmt.Errorf("no project open")
	}
	if len(args) == 0 {
		return "", fmt.Errorf("git command is required")
	}
	if _, ok := gitAllowedSubcommands[args[0]]; !ok {
		return "", fmt.Errorf("git command not allowed: %s", args[0])
	}
	if args[0] == "init" {
		if err := validateGitInitAllowed(projectPath, args); err != nil {
			return "", err
		}
	}
	a.logInfof("[Activation] subsystem=git reason=%s project=%s command=%s", activationGitRefresh, filepath.Base(projectPath), strings.Join(args, " "))

	if isGitStatusCommand(args) {
		return a.runGitStatusCommand(projectPath, args)
	}

	return runGitCommandInProject(projectPath, args)
}

func (a *App) runGitStatusCommand(projectPath string, args []string) (string, error) {
	key := gitStatusCallKey(projectPath, args)

	a.gitStatusMu.Lock()
	if a.gitStatusCalls == nil {
		a.gitStatusCalls = make(map[string]*gitStatusCall)
	}
	if call, ok := a.gitStatusCalls[key]; ok {
		a.gitStatusMu.Unlock()
		<-call.done
		return call.output, call.err
	}
	call := &gitStatusCall{done: make(chan struct{})}
	a.gitStatusCalls[key] = call
	a.gitStatusMu.Unlock()

	call.output, call.err = runGitCommandInProject(projectPath, args)
	close(call.done)

	a.gitStatusMu.Lock()
	delete(a.gitStatusCalls, key)
	a.gitStatusMu.Unlock()

	return call.output, call.err
}

func runGitCommandInProject(projectPath string, args []string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitCommandTimeout(args))
	defer cancel()

	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = projectPath
	if isGitStatusCommand(args) {
		cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	}
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("git command timed out")
		}
		errText := strings.TrimSpace(stderr.String())
		if errText == "" {
			errText = strings.TrimSpace(stdout.String())
		}

		normalized := strings.ToLower(errText)
		if strings.Contains(normalized, "not a git repository") {
			if projectGitMetadataExists(projectPath) {
				return "", fmt.Errorf("invalid git repository")
			}
			return "", fmt.Errorf("not a git repository")
		}

		if errText == "" {
			return "", fmt.Errorf("git command failed: %w", err)
		}

		return "", fmt.Errorf("git error: %s", errText)
	}

	return stdout.String(), nil
}

// GetGitBranch returns the current git branch name
func (a *App) GetGitBranch() (string, error) {
	// Use branch --show-current which works even in empty repos
	output, err := a.RunGitCommand([]string{"branch", "--show-current"})
	if err != nil {
		// Fallback to symbolic-ref for detached HEAD
		output, err = a.RunGitCommand([]string{"symbolic-ref", "--short", "HEAD"})
		if err != nil {
			return "", err
		}
	}
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return "HEAD (detached)", nil
	}
	return trimmed, nil
}

// GetGitStatus returns git status in porcelain format
func (a *App) GetGitStatus() (string, error) {
	return a.RunGitCommand([]string{"status", "--porcelain"})
}

// GetGitBranches returns list of all local branches
func (a *App) GetGitBranches() ([]string, error) {
	output, err := a.RunGitCommand([]string{"branch", "--list", "--sort=-committerdate", "--format=%(refname:short)"})
	if err != nil {
		return nil, err
	}

	branches := []string{}
	for _, line := range strings.Split(output, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			branches = append(branches, trimmed)
		}
	}
	return branches, nil
}

// GetGitDiff returns diff for a specific file or all changes
func (a *App) GetGitDiff(filePath string, staged bool) (string, error) {
	args := []string{"diff", "--no-color", "--diff-algorithm=histogram"}
	if staged {
		args = append(args, "--cached")
	}
	if filePath != "" {
		args = append(args, "--", filePath)
	}
	return a.RunGitCommand(args)
}

// GitCommitInfo represents a single commit
type GitCommitInfo struct {
	Hash        string `json:"hash"`
	ShortHash   string `json:"shortHash"`
	Author      string `json:"author"`
	AuthorEmail string `json:"authorEmail"`
	Date        string `json:"date"`
	Subject     string `json:"subject"`
	Body        string `json:"body"`
	Parents     string `json:"parents"`
}

// GetGitLog returns commit history
func (a *App) GetGitLog(limit int, filePath string) ([]GitCommitInfo, error) {
	if limit <= 0 {
		limit = 50
	}

	format := strings.Join([]string{
		"%H",
		"%h",
		"%an",
		"%ae",
		"%ai",
		"%s",
		"%b",
		"%P",
	}, gitFieldSeparator) + gitRecordSeparator
	args := []string{"log", fmt.Sprintf("-n%d", limit), fmt.Sprintf("--format=%s", format)}

	if filePath != "" {
		args = append(args, "--", filePath)
	}

	output, err := a.RunGitCommand(args)
	if err != nil {
		errText := strings.ToLower(err.Error())
		if strings.Contains(errText, "does not have any commits yet") ||
			strings.Contains(errText, "bad default revision") {
			return []GitCommitInfo{}, nil
		}
		return nil, err
	}

	var commits []GitCommitInfo
	for _, record := range strings.Split(output, gitRecordSeparator) {
		record = strings.Trim(record, "\r\n")
		if record == "" {
			continue
		}
		parts := strings.Split(record, gitFieldSeparator)
		if len(parts) < 8 {
			continue
		}
		commit := GitCommitInfo{
			Hash:        strings.TrimSpace(parts[0]),
			ShortHash:   strings.TrimSpace(parts[1]),
			Author:      strings.TrimSpace(parts[2]),
			AuthorEmail: strings.TrimSpace(parts[3]),
			Date:        strings.TrimSpace(parts[4]),
			Subject:     strings.TrimSpace(parts[5]),
		}
		if commit.Hash == "" {
			continue
		}
		commit.Body = strings.TrimSpace(parts[6])
		commit.Parents = strings.TrimSpace(parts[7])
		commits = append(commits, commit)
	}
	return commits, nil
}

// GetGitShow returns details of a specific commit
func (a *App) GetGitShow(commitHash string) (string, error) {
	return a.RunGitCommand([]string{"show", "--no-color", "--stat=240,180,10000", commitHash})
}

// GetGitCommitDiff returns the diff for a specific commit
func (a *App) GetGitCommitDiff(commitHash string) (string, error) {
	return a.RunGitCommand([]string{"show", "--no-color", "-p", commitHash})
}

// GetGitFileDiffBetweenCommits returns diff of a file between two commits
func (a *App) GetGitFileDiffBetweenCommits(filePath, fromCommit, toCommit string) (string, error) {
	args := []string{"diff", "--no-color", fromCommit, toCommit}
	if filePath != "" {
		args = append(args, "--", filePath)
	}
	return a.RunGitCommand(args)
}

// GetGitFileAtCommit returns file content at specific commit
func (a *App) GetGitFileAtCommit(filePath, commitHash string) (string, error) {
	return a.RunGitCommand([]string{"show", fmt.Sprintf("%s:%s", commitHash, filePath)})
}

// GetGitBlame returns blame info for a file
func (a *App) GetGitBlame(filePath string) (string, error) {
	return a.RunGitCommand([]string{"blame", "--no-progress", "--line-porcelain", filePath})
}
