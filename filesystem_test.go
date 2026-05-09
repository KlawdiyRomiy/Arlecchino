package main

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"
)

func TestReadDirectory_EmptyDirectoryReturnsEmptySlice(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	app := &App{}

	entries, err := app.ReadDirectory(dir)
	if err != nil {
		t.Fatalf("ReadDirectory returned error: %v", err)
	}
	if entries == nil {
		t.Fatal("ReadDirectory returned nil slice for empty directory")
	}
	if len(entries) != 0 {
		t.Fatalf("expected empty directory to return zero entries, got %d", len(entries))
	}
}

func TestReadFile_ReturnsUTF8Text(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(path, []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if got != "hello\n" {
		t.Fatalf("ReadFile() = %q, want %q", got, "hello\n")
	}
}

func TestReadFile_TrimsUTF8BOM(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "bom.txt")
	if err := os.WriteFile(path, []byte{0xef, 0xbb, 0xbf, 'h', 'i', '\n'}, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if got != "hi\n" {
		t.Fatalf("ReadFile() = %q, want %q", got, "hi\n")
	}
}

func TestReadFile_ReturnsTextPastSniffBoundary(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "long.txt")
	content := strings.Repeat(strings.Repeat("a", 120)+"\n", int(fileSniffBytes/121)+2) + "end"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	if got != content {
		t.Fatalf("ReadFile() length = %d, want %d", len(got), len(content))
	}
}

func TestReadFile_RejectsKnownBinaryExtensionBeforeReading(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "game.dmb")
	if err := os.WriteFile(path, []byte("not actually text"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	_, err := (&App{}).ReadFile(path)
	if err == nil {
		t.Fatal("ReadFile() error = nil, want binary extension rejection")
	}
	if !strings.Contains(err.Error(), "not a text document") {
		t.Fatalf("ReadFile() error = %v, want non-text rejection", err)
	}
}

func TestReadFile_RejectsImageExtensionBeforeReading(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "logo.png")
	if err := os.WriteFile(path, []byte("not actually an image"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	_, err := (&App{}).ReadFile(path)
	if err == nil {
		t.Fatal("ReadFile() error = nil, want image extension rejection")
	}
	if !strings.Contains(err.Error(), "not a text document") {
		t.Fatalf("ReadFile() error = %v, want non-text rejection", err)
	}
}

func TestReadFile_RejectsBinaryContent(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "payload.dat")
	if err := os.WriteFile(path, []byte{'h', 'i', 0x00, 'x'}, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	_, err := (&App{}).ReadFile(path)
	if err == nil {
		t.Fatal("ReadFile() error = nil, want binary content rejection")
	}
	if !strings.Contains(err.Error(), "appears to be binary") {
		t.Fatalf("ReadFile() error = %v, want binary sniff rejection", err)
	}
}

func TestReadFile_RejectsInvalidUTF8(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "invalid.txt")
	if err := os.WriteFile(path, []byte{0xff, 0xfe, 'x'}, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	_, err := (&App{}).ReadFile(path)
	if err == nil {
		t.Fatal("ReadFile() error = nil, want invalid UTF-8 rejection")
	}
	if !strings.Contains(err.Error(), "not valid UTF-8") {
		t.Fatalf("ReadFile() error = %v, want invalid UTF-8 rejection", err)
	}
}

func TestReadFile_RejectsOversizedFileBeforeReading(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "huge.sql")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := file.Truncate(maxEditorFileBytes + 1); err != nil {
		_ = file.Close()
		t.Fatalf("Truncate() error = %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	_, err = (&App{}).ReadFile(path)
	if err == nil {
		t.Fatal("ReadFile() error = nil, want oversized rejection")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Fatalf("ReadFile() error = %v, want size rejection", err)
	}
}

func TestInspectEditorFile_MarksLargeTextUnsafeForInteractiveEditor(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "generated.cs")
	content := strings.Repeat("a", int(maxInteractiveEditorFileBytes)+1)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	inspection, err := (&App{}).InspectEditorFile(path)
	if err != nil {
		t.Fatalf("InspectEditorFile() error = %v", err)
	}
	if !inspection.IsText {
		t.Fatalf("InspectEditorFile() IsText = false, want true")
	}
	if inspection.SafeForEditor {
		t.Fatal("InspectEditorFile() SafeForEditor = true, want false")
	}
	if !inspection.LargeDocument {
		t.Fatal("InspectEditorFile() LargeDocument = false, want true")
	}
	if !strings.Contains(inspection.Reason, "guarded preview") {
		t.Fatalf("InspectEditorFile() Reason = %q, want guarded preview", inspection.Reason)
	}

	_, err = (&App{}).ReadFile(path)
	if err == nil {
		t.Fatal("ReadFile() error = nil, want guarded preview rejection")
	}
	if !strings.Contains(err.Error(), "guarded preview") {
		t.Fatalf("ReadFile() error = %v, want guarded preview rejection", err)
	}
}

func TestInspectEditorFile_MarksManyLinesUnsafeForInteractiveEditor(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "many-lines.txt")
	content := strings.Repeat("x\n", maxInteractiveEditorLines+1)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	inspection, err := (&App{}).InspectEditorFile(path)
	if err != nil {
		t.Fatalf("InspectEditorFile() error = %v", err)
	}
	if inspection.SafeForEditor {
		t.Fatal("InspectEditorFile() SafeForEditor = true, want false")
	}
	if inspection.LineCount <= maxInteractiveEditorLines {
		t.Fatalf("InspectEditorFile() LineCount = %d, want > %d", inspection.LineCount, maxInteractiveEditorLines)
	}
	if !strings.Contains(inspection.Reason, "too many lines") {
		t.Fatalf("InspectEditorFile() Reason = %q, want too many lines", inspection.Reason)
	}
}

func TestInspectEditorFile_MarksLongLineUnsafeForInteractiveEditor(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "long-line.txt")
	content := strings.Repeat("x", maxInteractiveEditorLineBytes+1)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	inspection, err := (&App{}).InspectEditorFile(path)
	if err != nil {
		t.Fatalf("InspectEditorFile() error = %v", err)
	}
	if inspection.SafeForEditor {
		t.Fatal("InspectEditorFile() SafeForEditor = true, want false")
	}
	if inspection.MaxLineLength <= maxInteractiveEditorLineBytes {
		t.Fatalf("InspectEditorFile() MaxLineLength = %d, want > %d", inspection.MaxLineLength, maxInteractiveEditorLineBytes)
	}
	if !strings.Contains(inspection.Reason, "line that is too long") {
		t.Fatalf("InspectEditorFile() Reason = %q, want long-line reason", inspection.Reason)
	}
}

func TestReadEditorVisualFile_ReturnsDataURLForPNG(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "logo.png")
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	}
	if err := os.WriteFile(path, png, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadEditorVisualFile(path)
	if err != nil {
		t.Fatalf("ReadEditorVisualFile() error = %v", err)
	}
	if got.MimeType != "image/png" {
		t.Fatalf("ReadEditorVisualFile() MimeType = %q, want image/png", got.MimeType)
	}
	if !strings.HasPrefix(got.DataURL, "data:image/png;base64,") {
		t.Fatalf("ReadEditorVisualFile() DataURL = %q, want png data URL", got.DataURL)
	}
	if got.SizeBytes != int64(len(png)) {
		t.Fatalf("ReadEditorVisualFile() SizeBytes = %d, want %d", got.SizeBytes, len(png))
	}
}

func TestReadEditorVisualFile_RejectsUnsupportedExtension(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	_, err := (&App{}).ReadEditorVisualFile(path)
	if err == nil {
		t.Fatal("ReadEditorVisualFile() error = nil, want unsupported extension rejection")
	}
	if !strings.Contains(err.Error(), "not a supported visual format") {
		t.Fatalf("ReadEditorVisualFile() error = %v, want unsupported visual rejection", err)
	}
}

func TestReadEditorVisualFile_RejectsOversizedImageBeforeReading(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "huge.png")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := file.Truncate(maxEditorVisualFileBytes + 1); err != nil {
		_ = file.Close()
		t.Fatalf("Truncate() error = %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	_, err = (&App{}).ReadEditorVisualFile(path)
	if err == nil {
		t.Fatal("ReadEditorVisualFile() error = nil, want oversized rejection")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Fatalf("ReadEditorVisualFile() error = %v, want size rejection", err)
	}
}

func TestReadEditorFilePreview_TrimsUTF8Boundary(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "unicode.txt")
	content := "123456789éafter"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	preview, err := (&App{}).ReadEditorFilePreview(path, 10)
	if err != nil {
		t.Fatalf("ReadEditorFilePreview() error = %v", err)
	}
	if !preview.Truncated {
		t.Fatal("ReadEditorFilePreview() Truncated = false, want true")
	}
	if !utf8.ValidString(preview.Content) {
		t.Fatalf("ReadEditorFilePreview() returned invalid UTF-8: %q", preview.Content)
	}
	if len([]byte(preview.Content)) > 10 {
		t.Fatalf("ReadEditorFilePreview() byte length = %d, want <= 10", len([]byte(preview.Content)))
	}
	if preview.Content != "123456789" {
		t.Fatalf("ReadEditorFilePreview() Content = %q, want %q", preview.Content, "123456789")
	}
}

func TestReadEditorBinaryFile_ReturnsGenericPreviewForBin(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "payload.bin")
	content := []byte{0x00, 0x01, 0x02, 'A', 'r', 'l', 'e', 'c', 'c', 'h', 'i', 'n', 'o', 0x00}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadEditorBinaryFile(path)
	if err != nil {
		t.Fatalf("ReadEditorBinaryFile() error = %v", err)
	}
	if got.Format != "Binary file" {
		t.Fatalf("ReadEditorBinaryFile() Format = %q, want Binary file", got.Format)
	}
	if got.MimeType != "application/octet-stream" {
		t.Fatalf("ReadEditorBinaryFile() MimeType = %q, want application/octet-stream", got.MimeType)
	}
	if !strings.Contains(got.HexPreview, "00 01 02") {
		t.Fatalf("ReadEditorBinaryFile() HexPreview = %q, want byte preview", got.HexPreview)
	}
	if !containsStringPreview(got.StringsPreview, "Arlecchino") {
		t.Fatalf("ReadEditorBinaryFile() StringsPreview = %#v, want printable payload", got.StringsPreview)
	}
}

func TestReadEditorBinaryFile_ReturnsSQLiteMetadata(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "notes.sqlite")
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	if _, err := db.Exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)"); err != nil {
		_ = db.Close()
		t.Fatalf("Create table error = %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	got, err := (&App{}).ReadEditorBinaryFile(path)
	if err != nil {
		t.Fatalf("ReadEditorBinaryFile() error = %v", err)
	}
	if got.Format != "SQLite database" {
		t.Fatalf("ReadEditorBinaryFile() Format = %q, want SQLite database", got.Format)
	}
	if !binarySectionsContain(got.Sections, "table notes") {
		t.Fatalf("ReadEditorBinaryFile() Sections = %#v, want notes table", got.Sections)
	}
}

func TestReadEditorBinaryFile_ReturnsZIPDirectory(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "archive.zip")
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	entry, err := writer.Create("docs/readme.txt")
	if err != nil {
		t.Fatalf("Create zip entry error = %v", err)
	}
	if _, err := entry.Write([]byte("hello")); err != nil {
		t.Fatalf("Write zip entry error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("Close zip writer error = %v", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadEditorBinaryFile(path)
	if err != nil {
		t.Fatalf("ReadEditorBinaryFile() error = %v", err)
	}
	if got.Format != "ZIP archive" {
		t.Fatalf("ReadEditorBinaryFile() Format = %q, want ZIP archive", got.Format)
	}
	if !binarySectionsContain(got.Sections, "docs/readme.txt") {
		t.Fatalf("ReadEditorBinaryFile() Sections = %#v, want zip entry", got.Sections)
	}
}

func TestReadEditorBinaryFile_ReturnsPDFStructure(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "sample.pdf")
	content := []byte("%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nstream\nHello PDF\nendstream\n%%EOF\n")
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadEditorBinaryFile(path)
	if err != nil {
		t.Fatalf("ReadEditorBinaryFile() error = %v", err)
	}
	if got.Format != "PDF document" {
		t.Fatalf("ReadEditorBinaryFile() Format = %q, want PDF document", got.Format)
	}
	if !binarySectionsContain(got.Sections, "%PDF-1.7") {
		t.Fatalf("ReadEditorBinaryFile() Sections = %#v, want PDF header", got.Sections)
	}
}

func TestReadEditorBinaryFile_ReturnsWASMSections(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "module.wasm")
	content := []byte{
		0x00, 0x61, 0x73, 0x6d,
		0x01, 0x00, 0x00, 0x00,
		0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	got, err := (&App{}).ReadEditorBinaryFile(path)
	if err != nil {
		t.Fatalf("ReadEditorBinaryFile() error = %v", err)
	}
	if got.Format != "WebAssembly module" {
		t.Fatalf("ReadEditorBinaryFile() Format = %q, want WebAssembly module", got.Format)
	}
	if !binarySectionsContain(got.Sections, "Type section") {
		t.Fatalf("ReadEditorBinaryFile() Sections = %#v, want WASM type section", got.Sections)
	}
}

func TestReadEditorBinaryFile_ReturnsTruncatedPreviewForOversizedBinary(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "payload.bin")
	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := file.Truncate(maxEditorFileBytes + 1); err != nil {
		_ = file.Close()
		t.Fatalf("Truncate() error = %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	inspection, err := (&App{}).InspectEditorFile(path)
	if err != nil {
		t.Fatalf("InspectEditorFile() error = %v", err)
	}
	if inspection.IsText {
		t.Fatal("InspectEditorFile() IsText = true, want binary classification")
	}

	got, err := (&App{}).ReadEditorBinaryFile(path)
	if err != nil {
		t.Fatalf("ReadEditorBinaryFile() error = %v", err)
	}
	if !got.Truncated {
		t.Fatal("ReadEditorBinaryFile() Truncated = false, want true")
	}
	if got.PreviewBytes != maxEditorBinaryPreviewBytes {
		t.Fatalf("ReadEditorBinaryFile() PreviewBytes = %d, want %d", got.PreviewBytes, maxEditorBinaryPreviewBytes)
	}
}

func containsStringPreview(values []string, want string) bool {
	for _, value := range values {
		if strings.Contains(value, want) {
			return true
		}
	}
	return false
}

func binarySectionsContain(sections []EditorBinarySection, want string) bool {
	for _, section := range sections {
		if strings.Contains(section.Title, want) {
			return true
		}
		for _, row := range section.Rows {
			if strings.Contains(row.Label, want) || strings.Contains(row.Value, want) {
				return true
			}
		}
	}
	return false
}

type capturedRuntimeEvent struct {
	Name string
	Data []any
}

func captureRuntimeEvents(t *testing.T) (*[]capturedRuntimeEvent, func()) {
	t.Helper()

	events := make([]capturedRuntimeEvent, 0)
	var mu sync.Mutex
	previous := runtimeEventsEmit
	runtimeEventsEmit = func(_ context.Context, name string, data ...interface{}) {
		mu.Lock()
		defer mu.Unlock()
		copied := append([]any(nil), data...)
		events = append(events, capturedRuntimeEvent{Name: name, Data: copied})
	}

	return &events, func() {
		runtimeEventsEmit = previous
	}
}

func TestRenameProjectEntry_EmitsRenameEvent(t *testing.T) {
	projectDir := t.TempDir()
	originalPath := filepath.Join(projectDir, "notes.txt")
	if err := os.WriteFile(originalPath, []byte("hello"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{ctx: context.Background()}
	app.setProjectPath(projectDir)
	events, restore := captureRuntimeEvents(t)
	defer restore()

	result, err := app.RenameProjectEntry(originalPath, "renamed.txt")
	if err != nil {
		t.Fatalf("RenameProjectEntry() error = %v", err)
	}

	expectedPath := filepath.Join(projectDir, "renamed.txt")
	if result.NewPath != expectedPath {
		t.Fatalf("RenameProjectEntry() new path = %q, want %q", result.NewPath, expectedPath)
	}
	if result.IsDirectory {
		t.Fatal("RenameProjectEntry() reported file as directory")
	}
	if _, err := os.Stat(expectedPath); err != nil {
		t.Fatalf("renamed file missing: %v", err)
	}
	if _, err := os.Stat(originalPath); !os.IsNotExist(err) {
		t.Fatalf("original path still exists or unexpected error: %v", err)
	}

	if len(*events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(*events))
	}
	if (*events)[0].Name != "project:entry:renamed" {
		t.Fatalf("event name = %q, want %q", (*events)[0].Name, "project:entry:renamed")
	}

	payload, ok := (*events)[0].Data[0].(projectEntryRenamedEvent)
	if !ok {
		t.Fatalf("event payload type = %T, want projectEntryRenamedEvent", (*events)[0].Data[0])
	}
	if payload.OldPath != originalPath || payload.NewPath != expectedPath || payload.IsDirectory {
		t.Fatalf("unexpected rename payload: %#v", payload)
	}
}

func TestRenameProjectEntry_RejectsCollision(t *testing.T) {
	projectDir := t.TempDir()
	sourcePath := filepath.Join(projectDir, "source.txt")
	targetPath := filepath.Join(projectDir, "target.txt")
	for _, path := range []string{sourcePath, targetPath} {
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatalf("WriteFile(%q) error = %v", path, err)
		}
	}

	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.RenameProjectEntry(sourcePath, "target.txt")
	if err == nil {
		t.Fatal("RenameProjectEntry() error = nil, want collision error")
	}
	if !strings.Contains(err.Error(), "entry already exists") {
		t.Fatalf("RenameProjectEntry() error = %v, want collision error", err)
	}
}

func TestRenameProjectEntry_RejectsPathOutsideProject(t *testing.T) {
	projectDir := t.TempDir()
	outsideDir := t.TempDir()
	outsidePath := filepath.Join(outsideDir, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("x"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.RenameProjectEntry(outsidePath, "renamed.txt")
	if err == nil {
		t.Fatal("RenameProjectEntry() error = nil, want project guard error")
	}
	if !strings.Contains(err.Error(), "outside current project") {
		t.Fatalf("RenameProjectEntry() error = %v, want outside current project", err)
	}
}

func TestTrashProjectEntry_EmitsDeletedEvent(t *testing.T) {
	projectDir := t.TempDir()
	filePath := filepath.Join(projectDir, "trash-me.txt")
	if err := os.WriteFile(filePath, []byte("bye"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	app := &App{ctx: context.Background()}
	app.setProjectPath(projectDir)
	events, restoreEvents := captureRuntimeEvents(t)
	defer restoreEvents()

	var trashedPath string
	previousTrash := trashProjectEntry
	trashProjectEntry = func(path string, isDirectory bool) error {
		trashedPath = path
		if isDirectory {
			t.Fatal("trash stub received directory for file path")
		}
		return nil
	}
	defer func() {
		trashProjectEntry = previousTrash
	}()

	if err := app.TrashProjectEntry(filePath); err != nil {
		t.Fatalf("TrashProjectEntry() error = %v", err)
	}
	if trashedPath != filePath {
		t.Fatalf("trash path = %q, want %q", trashedPath, filePath)
	}
	if len(*events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(*events))
	}
	if (*events)[0].Name != "project:entry:deleted" {
		t.Fatalf("event name = %q, want %q", (*events)[0].Name, "project:entry:deleted")
	}

	payload, ok := (*events)[0].Data[0].(projectEntryDeletedEvent)
	if !ok {
		t.Fatalf("event payload type = %T, want projectEntryDeletedEvent", (*events)[0].Data[0])
	}
	if payload.Path != filePath || payload.IsDirectory {
		t.Fatalf("unexpected delete payload: %#v", payload)
	}
}

func runGitForFilesystemTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git is unavailable: %v", err)
	}

	fullArgs := append([]string{"-C", dir}, args...)
	cmd := exec.Command("git", fullArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v error = %v\n%s", args, err, output)
	}
	return string(output)
}

func createGitRepoForFilesystemTest(t *testing.T) string {
	t.Helper()

	repo := t.TempDir()
	runGitForFilesystemTest(t, repo, "init")
	runGitForFilesystemTest(t, repo, "config", "user.email", "test@example.com")
	runGitForFilesystemTest(t, repo, "config", "user.name", "Test User")
	runGitForFilesystemTest(t, repo, "config", "commit.gpgsign", "false")

	readmePath := filepath.Join(repo, "README.md")
	if err := os.WriteFile(readmePath, []byte("# Test\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(README.md) error = %v", err)
	}
	runGitForFilesystemTest(t, repo, "add", "README.md")
	runGitForFilesystemTest(t, repo, "commit", "-m", "initial commit")

	return repo
}

func TestRunGitCommandStatus(t *testing.T) {
	repo := createGitRepoForFilesystemTest(t)
	app := &App{}
	app.setProjectPath(repo)

	output, err := app.RunGitCommand([]string{"status", "--short"})
	if err != nil {
		t.Fatalf("RunGitCommand(status --short) error = %v", err)
	}
	if strings.TrimSpace(output) != "" {
		t.Fatalf("RunGitCommand(status --short) = %q, want clean output", output)
	}
}

func TestRunGitCommandStagesAndCommitsFile(t *testing.T) {
	repo := createGitRepoForFilesystemTest(t)
	app := &App{}
	app.setProjectPath(repo)

	featurePath := filepath.Join(repo, "feature.txt")
	if err := os.WriteFile(featurePath, []byte("ready\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(feature.txt) error = %v", err)
	}

	if _, err := app.RunGitCommand([]string{"add", "--", "feature.txt"}); err != nil {
		t.Fatalf("RunGitCommand(add feature.txt) error = %v", err)
	}
	status, err := app.RunGitCommand([]string{"status", "--short"})
	if err != nil {
		t.Fatalf("RunGitCommand(status --short) error = %v", err)
	}
	if !strings.Contains(status, "A  feature.txt") {
		t.Fatalf("RunGitCommand(status --short) = %q, want staged feature.txt", status)
	}

	if _, err := app.RunGitCommand([]string{"commit", "-m", "add feature"}); err != nil {
		t.Fatalf("RunGitCommand(commit) error = %v", err)
	}
	commits, err := app.GetGitLog(1, "")
	if err != nil {
		t.Fatalf("GetGitLog() error = %v", err)
	}
	if len(commits) != 1 || commits[0].Subject != "add feature" {
		t.Fatalf("GetGitLog() latest commit = %#v, want add feature", commits)
	}
}

func TestRunGitCommandInitInitializesEmptyProject(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git is unavailable: %v", err)
	}

	projectDir := t.TempDir()
	app := &App{}
	app.setProjectPath(projectDir)

	if _, err := app.RunGitCommand([]string{"init"}); err != nil {
		t.Fatalf("RunGitCommand(init) error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(projectDir, ".git")); err != nil {
		t.Fatalf(".git metadata missing after init: %v", err)
	}
}

func TestRunGitCommandInitRejectsExistingRepository(t *testing.T) {
	repo := createGitRepoForFilesystemTest(t)
	app := &App{}
	app.setProjectPath(repo)

	_, err := app.RunGitCommand([]string{"init"})
	if err == nil {
		t.Fatal("RunGitCommand(init) error = nil, want existing repository error")
	}
	if !strings.Contains(err.Error(), "git metadata already exists") {
		t.Fatalf("RunGitCommand(init) error = %v, want git metadata already exists", err)
	}
}

func TestRunGitCommandStatusDistinguishesInvalidGitMetadata(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skipf("git is unavailable: %v", err)
	}

	projectDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(projectDir, ".git"), 0o755); err != nil {
		t.Fatalf("Mkdir(.git) error = %v", err)
	}
	app := &App{}
	app.setProjectPath(projectDir)

	_, err := app.RunGitCommand([]string{"status", "--short"})
	if err == nil {
		t.Fatal("RunGitCommand(status) error = nil, want invalid git repository")
	}
	if !strings.Contains(err.Error(), "invalid git repository") {
		t.Fatalf("RunGitCommand(status) error = %v, want invalid git repository", err)
	}
}

func TestGetGitLogParsesCommits(t *testing.T) {
	repo := createGitRepoForFilesystemTest(t)
	app := &App{}
	app.setProjectPath(repo)

	commits, err := app.GetGitLog(5, "")
	if err != nil {
		t.Fatalf("GetGitLog() error = %v", err)
	}
	if len(commits) != 1 {
		t.Fatalf("GetGitLog() len = %d, want 1", len(commits))
	}
	commit := commits[0]
	if commit.Hash == "" || commit.ShortHash == "" {
		t.Fatalf("GetGitLog() missing hashes: %#v", commit)
	}
	if commit.Author != "Test User" || commit.AuthorEmail != "test@example.com" {
		t.Fatalf("GetGitLog() author = %q <%s>, want Test User <test@example.com>", commit.Author, commit.AuthorEmail)
	}
	if commit.Subject != "initial commit" {
		t.Fatalf("GetGitLog() subject = %q, want initial commit", commit.Subject)
	}
}
