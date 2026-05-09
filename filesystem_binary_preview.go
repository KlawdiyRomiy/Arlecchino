package main

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/binary"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	_ "github.com/mattn/go-sqlite3"
)

const (
	maxEditorBinaryPreviewBytes = int64(64 * 1024)
	maxEditorBinaryStrings      = 80
	maxEditorBinaryStringBytes  = 160
	maxEditorBinarySectionRows  = 50
)

type EditorBinaryFile struct {
	Path           string                `json:"path"`
	Name           string                `json:"name"`
	SizeBytes      int64                 `json:"sizeBytes"`
	FormattedSize  string                `json:"formattedSize"`
	Format         string                `json:"format"`
	MimeType       string                `json:"mimeType"`
	Reason         string                `json:"reason"`
	HexPreview     string                `json:"hexPreview"`
	StringsPreview []string              `json:"stringsPreview"`
	Sections       []EditorBinarySection `json:"sections"`
	PreviewBytes   int64                 `json:"previewBytes"`
	Truncated      bool                  `json:"truncated"`
}

type EditorBinarySection struct {
	Title string                  `json:"title"`
	Rows  []EditorBinaryFieldPair `json:"rows"`
}

type EditorBinaryFieldPair struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type editorBinaryKind string

const (
	editorBinaryKindGeneric editorBinaryKind = "generic"
	editorBinaryKindPDF     editorBinaryKind = "pdf"
	editorBinaryKindSQLite  editorBinaryKind = "sqlite"
	editorBinaryKindWASM    editorBinaryKind = "wasm"
	editorBinaryKindZIP     editorBinaryKind = "zip"
)

type editorBinaryClassification struct {
	Kind     editorBinaryKind
	Format   string
	MimeType string
	Reason   string
}

func (a *App) ReadEditorBinaryFile(filePath string) (EditorBinaryFile, error) {
	return readEditorBinaryFile(filePath)
}

func readEditorBinaryFile(filePath string) (EditorBinaryFile, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return EditorBinaryFile{}, err
	}
	if info.IsDir() {
		return EditorBinaryFile{}, fmt.Errorf("cannot open directory as a binary file: %s", filePath)
	}

	prefix, hitLimit, err := readEditorFilePrefix(filePath, maxEditorBinaryPreviewBytes)
	if err != nil {
		return EditorBinaryFile{}, err
	}
	if !isKnownNonTextEditorPath(filePath) && !looksLikeBinary(prefix) {
		if utf8.Valid(prefix) {
			return EditorBinaryFile{}, fmt.Errorf("file appears to be text and should be opened in the editor: %s", filePath)
		}
	}

	classification := classifyEditorBinaryFile(filePath, prefix)
	sections := []EditorBinarySection{
		buildEditorBinaryMetadataSection(filePath, info, prefix, hitLimit, classification),
	}
	switch classification.Kind {
	case editorBinaryKindSQLite:
		sections = append(sections, inspectSQLiteBinary(filePath)...)
	case editorBinaryKindZIP:
		sections = append(sections, inspectZIPBinary(filePath)...)
	case editorBinaryKindPDF:
		sections = append(sections, inspectPDFBinary(prefix))
	case editorBinaryKindWASM:
		sections = append(sections, inspectWASMBinary(prefix, info.Size()))
	}

	return EditorBinaryFile{
		Path:           filePath,
		Name:           filepath.Base(filePath),
		SizeBytes:      info.Size(),
		FormattedSize:  formatFileSize(info.Size()),
		Format:         classification.Format,
		MimeType:       classification.MimeType,
		Reason:         classification.Reason,
		HexPreview:     formatEditorBinaryHexPreview(prefix),
		StringsPreview: extractEditorBinaryStrings(prefix),
		Sections:       sections,
		PreviewBytes:   int64(len(prefix)),
		Truncated:      hitLimit || int64(len(prefix)) < info.Size(),
	}, nil
}

func classifyEditorBinaryFile(filePath string, prefix []byte) editorBinaryClassification {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch {
	case bytes.HasPrefix(prefix, []byte("SQLite format 3")):
		return editorBinaryClassification{
			Kind:     editorBinaryKindSQLite,
			Format:   "SQLite database",
			MimeType: "application/vnd.sqlite3",
			Reason:   "SQLite binary database opened as a read-only metadata preview.",
		}
	case bytes.HasPrefix(prefix, []byte{0x00, 0x61, 0x73, 0x6d}):
		return editorBinaryClassification{
			Kind:     editorBinaryKindWASM,
			Format:   "WebAssembly module",
			MimeType: "application/wasm",
			Reason:   "WebAssembly binary opened as a read-only section preview.",
		}
	case bytes.HasPrefix(prefix, []byte("%PDF-")):
		return editorBinaryClassification{
			Kind:     editorBinaryKindPDF,
			Format:   "PDF document",
			MimeType: "application/pdf",
			Reason:   "PDF binary opened as a read-only structural preview.",
		}
	case isZIPLikeBinary(ext, prefix):
		return editorBinaryClassification{
			Kind:     editorBinaryKindZIP,
			Format:   zipLikeFormatName(ext),
			MimeType: zipLikeMimeType(ext),
			Reason:   "Archive binary opened as a read-only directory preview.",
		}
	case bytes.HasPrefix(prefix, []byte{0x1f, 0x8b}):
		return genericBinaryClassification("GZIP archive", "application/gzip")
	case bytes.HasPrefix(prefix, []byte{0x52, 0x61, 0x72, 0x21}):
		return genericBinaryClassification("RAR archive", "application/vnd.rar")
	case bytes.HasPrefix(prefix, []byte{0x7f, 0x45, 0x4c, 0x46}):
		return genericBinaryClassification("ELF executable", "application/x-elf")
	case bytes.HasPrefix(prefix, []byte{0x4d, 0x5a}):
		return genericBinaryClassification("PE executable", "application/vnd.microsoft.portable-executable")
	case hasMachOMagic(prefix):
		return genericBinaryClassification("Mach-O binary", "application/x-mach-binary")
	case editorVisualFileExtensions[ext] != "":
		return genericBinaryClassification("Image file", editorVisualFileExtensions[ext])
	default:
		return genericBinaryClassification("Binary file", "application/octet-stream")
	}
}

func genericBinaryClassification(format, mimeType string) editorBinaryClassification {
	return editorBinaryClassification{
		Kind:     editorBinaryKindGeneric,
		Format:   format,
		MimeType: mimeType,
		Reason:   "Binary file opened as a read-only byte preview.",
	}
}

func isZIPLikeBinary(ext string, prefix []byte) bool {
	if !bytes.HasPrefix(prefix, []byte{0x50, 0x4b}) {
		return false
	}
	switch ext {
	case ".zip", ".jar", ".docx", ".xlsx", ".pptx":
		return true
	default:
		return len(prefix) >= 4 && (bytes.HasPrefix(prefix, []byte{0x50, 0x4b, 0x03, 0x04}) ||
			bytes.HasPrefix(prefix, []byte{0x50, 0x4b, 0x05, 0x06}) ||
			bytes.HasPrefix(prefix, []byte{0x50, 0x4b, 0x07, 0x08}))
	}
}

func zipLikeFormatName(ext string) string {
	switch ext {
	case ".jar":
		return "JAR archive"
	case ".docx":
		return "OpenXML Word document"
	case ".xlsx":
		return "OpenXML Excel workbook"
	case ".pptx":
		return "OpenXML PowerPoint presentation"
	default:
		return "ZIP archive"
	}
}

func zipLikeMimeType(ext string) string {
	switch ext {
	case ".jar":
		return "application/java-archive"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	default:
		return "application/zip"
	}
}

func hasMachOMagic(prefix []byte) bool {
	if len(prefix) < 4 {
		return false
	}
	magic := binary.BigEndian.Uint32(prefix[:4])
	switch magic {
	case 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe:
		return true
	default:
		return false
	}
}

func buildEditorBinaryMetadataSection(filePath string, info os.FileInfo, prefix []byte, hitLimit bool, classification editorBinaryClassification) EditorBinarySection {
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext == "" {
		ext = "(none)"
	}
	return EditorBinarySection{
		Title: "File metadata",
		Rows: []EditorBinaryFieldPair{
			{Label: "Format", Value: classification.Format},
			{Label: "MIME", Value: classification.MimeType},
			{Label: "Extension", Value: ext},
			{Label: "Size", Value: formatFileSize(info.Size())},
			{Label: "Preview bytes", Value: fmt.Sprintf("%s%s", formatFileSize(int64(len(prefix))), truncatedSuffix(hitLimit || int64(len(prefix)) < info.Size()))},
			{Label: "Magic bytes", Value: formatEditorBinaryMagic(prefix)},
		},
	}
}

func truncatedSuffix(truncated bool) string {
	if truncated {
		return " (truncated)"
	}
	return ""
}

func inspectSQLiteBinary(filePath string) []EditorBinarySection {
	dsn := sqliteReadOnlyDSN(filePath)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return []EditorBinarySection{binaryWarningSection("SQLite", err)}
	}
	defer db.Close()

	rows := []EditorBinaryFieldPair{{Label: "Open mode", Value: "read-only immutable"}}
	var pageSize, pageCount int
	if err := db.QueryRow("PRAGMA page_size").Scan(&pageSize); err == nil {
		rows = append(rows, EditorBinaryFieldPair{Label: "Page size", Value: fmt.Sprintf("%d bytes", pageSize)})
	}
	if err := db.QueryRow("PRAGMA page_count").Scan(&pageCount); err == nil {
		rows = append(rows, EditorBinaryFieldPair{Label: "Page count", Value: fmt.Sprintf("%d", pageCount)})
	}
	var objectCount int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").Scan(&objectCount); err == nil {
		rows = append(rows, EditorBinaryFieldPair{Label: "Schema objects", Value: fmt.Sprintf("%d", objectCount)})
	}

	schemaRows, err := db.Query("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name LIMIT 20")
	if err != nil {
		rows = append(rows, EditorBinaryFieldPair{Label: "Schema preview", Value: err.Error()})
		return []EditorBinarySection{{Title: "SQLite metadata", Rows: rows}}
	}
	defer schemaRows.Close()

	for schemaRows.Next() && len(rows) < maxEditorBinarySectionRows {
		var objectType, name, tableName string
		var sqlText sql.NullString
		if err := schemaRows.Scan(&objectType, &name, &tableName, &sqlText); err != nil {
			rows = append(rows, EditorBinaryFieldPair{Label: "Schema row", Value: err.Error()})
			break
		}
		value := fmt.Sprintf("table %s", tableName)
		if sqlText.Valid && strings.TrimSpace(sqlText.String) != "" {
			value = trimEditorBinaryValue(sqlText.String)
		}
		rows = append(rows, EditorBinaryFieldPair{Label: objectType + " " + name, Value: value})
	}
	if err := schemaRows.Err(); err != nil {
		rows = append(rows, EditorBinaryFieldPair{Label: "Schema rows", Value: err.Error()})
	}
	if objectCount > 20 {
		rows = append(rows, EditorBinaryFieldPair{Label: "Schema preview", Value: fmt.Sprintf("showing 20 of %d objects", objectCount)})
	}

	return []EditorBinarySection{{Title: "SQLite metadata", Rows: rows}}
}

func sqliteReadOnlyDSN(filePath string) string {
	u := url.URL{
		Scheme:   "file",
		Path:     filePath,
		RawQuery: "mode=ro&immutable=1",
	}
	return u.String()
}

func inspectZIPBinary(filePath string) []EditorBinarySection {
	reader, err := zip.OpenReader(filePath)
	if err != nil {
		return []EditorBinarySection{binaryWarningSection("Archive", err)}
	}
	defer reader.Close()

	var compressedTotal, uncompressedTotal uint64
	for _, file := range reader.File {
		compressedTotal += uint64(file.CompressedSize64)
		uncompressedTotal += file.UncompressedSize64
	}

	rows := []EditorBinaryFieldPair{
		{Label: "Entries", Value: fmt.Sprintf("%d", len(reader.File))},
		{Label: "Compressed total", Value: formatFileSize(saturatingInt64(compressedTotal))},
		{Label: "Uncompressed total", Value: formatFileSize(saturatingInt64(uncompressedTotal))},
	}

	limit := len(reader.File)
	if limit > maxEditorBinarySectionRows-3 {
		limit = maxEditorBinarySectionRows - 3
	}
	for i := 0; i < limit; i++ {
		file := reader.File[i]
		name := file.Name
		if file.FileInfo().IsDir() {
			name += "/"
		}
		rows = append(rows, EditorBinaryFieldPair{
			Label: trimEditorBinaryLabel(name),
			Value: fmt.Sprintf("%s compressed, %s uncompressed", formatFileSize(int64(file.CompressedSize64)), formatFileSize(saturatingInt64(file.UncompressedSize64))),
		})
	}
	if len(reader.File) > limit {
		rows = append(rows, EditorBinaryFieldPair{Label: "Entry preview", Value: fmt.Sprintf("showing %d of %d entries", limit, len(reader.File))})
	}

	return []EditorBinarySection{{Title: "Archive directory", Rows: rows}}
}

func inspectPDFBinary(prefix []byte) EditorBinarySection {
	header := "(missing)"
	if lineEnd := bytes.IndexAny(prefix, "\r\n"); lineEnd >= 0 {
		header = string(prefix[:lineEnd])
	} else if len(prefix) > 0 {
		header = string(prefix)
	}

	return EditorBinarySection{
		Title: "PDF structure",
		Rows: []EditorBinaryFieldPair{
			{Label: "Header", Value: trimEditorBinaryValue(header)},
			{Label: "Object markers in preview", Value: fmt.Sprintf("%d", bytes.Count(prefix, []byte(" obj")))},
			{Label: "Page markers in preview", Value: fmt.Sprintf("%d", bytes.Count(prefix, []byte("/Page")))},
			{Label: "Stream markers in preview", Value: fmt.Sprintf("%d", bytes.Count(prefix, []byte("stream")))},
			{Label: "xref marker in preview", Value: yesNo(bytes.Contains(prefix, []byte("xref")))},
			{Label: "EOF marker in preview", Value: yesNo(bytes.Contains(prefix, []byte("%%EOF")))},
		},
	}
}

func inspectWASMBinary(prefix []byte, size int64) EditorBinarySection {
	rows := []EditorBinaryFieldPair{}
	if len(prefix) < 8 {
		return EditorBinarySection{
			Title: "WebAssembly sections",
			Rows:  []EditorBinaryFieldPair{{Label: "Header", Value: "file is too small to contain a complete WebAssembly header"}},
		}
	}

	version := binary.LittleEndian.Uint32(prefix[4:8])
	rows = append(rows, EditorBinaryFieldPair{Label: "Version", Value: fmt.Sprintf("%d", version)})

	offset := 8
	for offset < len(prefix) && len(rows) < maxEditorBinarySectionRows {
		sectionOffset := offset
		sectionID := prefix[offset]
		offset++
		payloadSize, width, ok := readWASMVarUint(prefix[offset:])
		if !ok {
			rows = append(rows, EditorBinaryFieldPair{Label: "Section header", Value: fmt.Sprintf("truncated at byte %d", sectionOffset)})
			break
		}
		offset += width

		value := fmt.Sprintf("id %d, offset 0x%X, payload %s", sectionID, sectionOffset, formatFileSize(saturatingInt64(payloadSize)))
		nextOffset := offset + int(payloadSize)
		if payloadSize > uint64(len(prefix)-offset) {
			value += " (payload extends beyond preview)"
			rows = append(rows, EditorBinaryFieldPair{Label: wasmSectionName(sectionID), Value: value})
			break
		}
		rows = append(rows, EditorBinaryFieldPair{Label: wasmSectionName(sectionID), Value: value})
		offset = nextOffset
	}
	if int64(len(prefix)) < size {
		rows = append(rows, EditorBinaryFieldPair{Label: "Section preview", Value: "truncated to prefix bytes"})
	}

	return EditorBinarySection{Title: "WebAssembly sections", Rows: rows}
}

func readWASMVarUint(content []byte) (uint64, int, bool) {
	var value uint64
	for i, b := range content {
		if i >= 10 {
			return 0, 0, false
		}
		value |= uint64(b&0x7f) << (7 * i)
		if b&0x80 == 0 {
			return value, i + 1, true
		}
	}
	return 0, 0, false
}

func wasmSectionName(id byte) string {
	switch id {
	case 0:
		return "Custom section"
	case 1:
		return "Type section"
	case 2:
		return "Import section"
	case 3:
		return "Function section"
	case 4:
		return "Table section"
	case 5:
		return "Memory section"
	case 6:
		return "Global section"
	case 7:
		return "Export section"
	case 8:
		return "Start section"
	case 9:
		return "Element section"
	case 10:
		return "Code section"
	case 11:
		return "Data section"
	case 12:
		return "Data count section"
	default:
		return fmt.Sprintf("Section %d", id)
	}
}

func binaryWarningSection(title string, err error) EditorBinarySection {
	return EditorBinarySection{
		Title: title + " preview",
		Rows:  []EditorBinaryFieldPair{{Label: "Preview warning", Value: err.Error()}},
	}
}

func formatEditorBinaryMagic(content []byte) string {
	if len(content) == 0 {
		return "(empty)"
	}
	limit := len(content)
	if limit > 16 {
		limit = 16
	}
	parts := make([]string, 0, limit)
	for _, b := range content[:limit] {
		parts = append(parts, fmt.Sprintf("%02X", b))
	}
	return strings.Join(parts, " ")
}

func formatEditorBinaryHexPreview(content []byte) string {
	if len(content) == 0 {
		return ""
	}

	var builder strings.Builder
	for offset := 0; offset < len(content); offset += 16 {
		end := offset + 16
		if end > len(content) {
			end = len(content)
		}
		line := content[offset:end]
		fmt.Fprintf(&builder, "%08x  ", offset)
		for i := 0; i < 16; i++ {
			if i < len(line) {
				fmt.Fprintf(&builder, "%02x ", line[i])
			} else {
				builder.WriteString("   ")
			}
			if i == 7 {
				builder.WriteByte(' ')
			}
		}
		builder.WriteString(" |")
		for _, b := range line {
			if b >= 32 && b <= 126 {
				builder.WriteByte(b)
			} else {
				builder.WriteByte('.')
			}
		}
		builder.WriteString("|\n")
	}
	return strings.TrimRight(builder.String(), "\n")
}

func extractEditorBinaryStrings(content []byte) []string {
	stringsPreview := make([]string, 0)
	var current strings.Builder
	flush := func() bool {
		if current.Len() >= 4 {
			stringsPreview = append(stringsPreview, trimEditorBinaryValue(current.String()))
			current.Reset()
			return len(stringsPreview) >= maxEditorBinaryStrings
		}
		current.Reset()
		return false
	}

	for len(content) > 0 {
		r, width := utf8.DecodeRune(content)
		if r == utf8.RuneError && width == 1 {
			if flush() {
				return stringsPreview
			}
			content = content[1:]
			continue
		}
		if isEditorBinaryPrintableRune(r) {
			if current.Len() < maxEditorBinaryStringBytes {
				current.WriteRune(r)
			}
		} else if flush() {
			return stringsPreview
		}
		content = content[width:]
	}
	flush()
	return stringsPreview
}

func isEditorBinaryPrintableRune(r rune) bool {
	if r == '\t' || r == ' ' {
		return true
	}
	if r < 32 {
		return false
	}
	return unicode.IsPrint(r)
}

func trimEditorBinaryLabel(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 80 {
		return value
	}
	return trimUTF8StringBytes(value, 80)
}

func trimEditorBinaryValue(value string) string {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if len(value) <= maxEditorBinaryStringBytes {
		return value
	}
	return trimUTF8StringBytes(value, maxEditorBinaryStringBytes)
}

func trimUTF8StringBytes(value string, limit int) string {
	if limit <= 3 || len(value) <= limit {
		return value
	}
	trimmed := trimValidUTF8Prefix([]byte(value[:limit-3]))
	return string(trimmed) + "..."
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func saturatingInt64(value uint64) int64 {
	if value > uint64(^uint64(0)>>1) {
		return int64(^uint64(0) >> 1)
	}
	return int64(value)
}
