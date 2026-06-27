package app

import (
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	maxSystemFontFiles      = 6000
	maxReadableFontFileSize = 128 * 1024 * 1024
	maxNameTableSize        = 2 * 1024 * 1024
	maxFontTables           = 512
	maxTTCFonts             = 512
	maxFontFamilyRunes      = 120
)

var errUnsupportedFontContainer = errors.New("unsupported font container")

type SystemFontFamily struct {
	Family string `json:"family"`
}

func (a *App) ListSystemFontFamilies() ([]SystemFontFamily, error) {
	families := listSystemFontFamilyNames()
	result := make([]SystemFontFamily, 0, len(families))
	for _, family := range families {
		result = append(result, SystemFontFamily{Family: family})
	}
	return result, nil
}

func listSystemFontFamilyNames() []string {
	dirs := existingSystemFontDirectories(systemFontDirectoryCandidates())
	seen := make(map[string]string)
	visitedFiles := 0

	for _, dir := range dirs {
		if visitedFiles >= maxSystemFontFiles {
			break
		}

		_ = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
			if visitedFiles >= maxSystemFontFiles {
				return filepath.SkipDir
			}
			if walkErr != nil {
				if entry != nil && entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.IsDir() || !isSupportedSystemFontFile(path) {
				return nil
			}

			visitedFiles++
			info, err := entry.Info()
			if err != nil || info.Size() <= 0 || info.Size() > maxReadableFontFileSize {
				return nil
			}

			families, err := readFontFamilyNames(path)
			if err != nil {
				return nil
			}
			for _, family := range families {
				key := strings.ToLower(family)
				if _, ok := seen[key]; !ok {
					seen[key] = family
				}
			}
			return nil
		})
	}

	families := make([]string, 0, len(seen))
	for _, family := range seen {
		families = append(families, family)
	}
	sort.Slice(families, func(i, j int) bool {
		return strings.ToLower(families[i]) < strings.ToLower(families[j])
	})
	return families
}

func systemFontDirectoryCandidates() []string {
	home, _ := os.UserHomeDir()
	getenv := os.Getenv

	addHome := func(parts ...string) string {
		if home == "" {
			return ""
		}
		segments := append([]string{home}, parts...)
		return filepath.Join(segments...)
	}

	switch runtime.GOOS {
	case "darwin":
		return []string{
			"/System/Library/Fonts",
			"/Library/Fonts",
			"/Network/Library/Fonts",
			addHome("Library", "Fonts"),
		}
	case "windows":
		windir := getenv("WINDIR")
		if windir == "" {
			windir = `C:\Windows`
		}
		dirs := []string{
			filepath.Join(windir, "Fonts"),
		}
		if localAppData := getenv("LOCALAPPDATA"); localAppData != "" {
			dirs = append(dirs, filepath.Join(localAppData, "Microsoft", "Windows", "Fonts"))
		}
		return dirs
	case "linux":
		dirs := []string{
			"/usr/share/fonts",
			"/usr/local/share/fonts",
			addHome(".local", "share", "fonts"),
			addHome(".fonts"),
		}
		if xdgDataHome := getenv("XDG_DATA_HOME"); xdgDataHome != "" {
			dirs = append(dirs, filepath.Join(xdgDataHome, "fonts"))
		}
		xdgDataDirs := getenv("XDG_DATA_DIRS")
		if xdgDataDirs == "" {
			xdgDataDirs = "/usr/local/share:/usr/share"
		}
		for _, dir := range filepath.SplitList(xdgDataDirs) {
			dirs = append(dirs, filepath.Join(dir, "fonts"))
		}
		return dirs
	default:
		return []string{
			"/usr/share/fonts",
			"/usr/local/share/fonts",
			addHome(".local", "share", "fonts"),
			addHome(".fonts"),
		}
	}
}

func existingSystemFontDirectories(candidates []string) []string {
	seen := make(map[string]struct{})
	dirs := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		cleaned := filepath.Clean(candidate)
		if _, ok := seen[cleaned]; ok {
			continue
		}
		info, err := os.Stat(cleaned)
		if err != nil || !info.IsDir() {
			continue
		}
		seen[cleaned] = struct{}{}
		dirs = append(dirs, cleaned)
	}
	return dirs
}

func isSupportedSystemFontFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".ttf", ".otf", ".ttc", ".otc":
		return true
	default:
		return false
	}
}

func readFontFamilyNames(path string) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	return parseFontFamilyNames(file, info.Size())
}

func parseFontFamilyNames(reader io.ReaderAt, size int64) ([]string, error) {
	header, err := readFontBytes(reader, size, 0, 12)
	if err != nil {
		return nil, err
	}

	if string(header[:4]) == "ttcf" {
		return parseTTCFontFamilyNames(reader, size)
	}
	return parseSFNTFontFamilyNames(reader, size, 0)
}

func parseTTCFontFamilyNames(reader io.ReaderAt, size int64) ([]string, error) {
	header, err := readFontBytes(reader, size, 0, 12)
	if err != nil {
		return nil, err
	}
	if string(header[:4]) != "ttcf" {
		return nil, errUnsupportedFontContainer
	}

	fontCount := int(binary.BigEndian.Uint32(header[8:12]))
	if fontCount <= 0 || fontCount > maxTTCFonts {
		return nil, errUnsupportedFontContainer
	}

	offsetBytes, err := readFontBytes(reader, size, 12, int64(fontCount*4))
	if err != nil {
		return nil, err
	}

	var families []string
	for i := 0; i < fontCount; i++ {
		offset := int64(binary.BigEndian.Uint32(offsetBytes[i*4 : i*4+4]))
		fontFamilies, err := parseSFNTFontFamilyNames(reader, size, offset)
		if err != nil {
			continue
		}
		families = append(families, fontFamilies...)
	}
	return uniqueFontFamilies(families), nil
}

func parseSFNTFontFamilyNames(reader io.ReaderAt, size int64, baseOffset int64) ([]string, error) {
	header, err := readFontBytes(reader, size, baseOffset, 12)
	if err != nil {
		return nil, err
	}
	if !isSupportedSFNTVersion(header[:4]) {
		return nil, errUnsupportedFontContainer
	}

	tableCount := int(binary.BigEndian.Uint16(header[4:6]))
	if tableCount <= 0 || tableCount > maxFontTables {
		return nil, errUnsupportedFontContainer
	}

	tableDir, err := readFontBytes(reader, size, baseOffset+12, int64(tableCount*16))
	if err != nil {
		return nil, err
	}

	for i := 0; i < tableCount; i++ {
		record := tableDir[i*16 : i*16+16]
		if string(record[:4]) != "name" {
			continue
		}

		tableOffset := int64(binary.BigEndian.Uint32(record[8:12]))
		tableLength := int64(binary.BigEndian.Uint32(record[12:16]))
		if tableLength <= 0 || tableLength > maxNameTableSize {
			return nil, errUnsupportedFontContainer
		}

		nameTable, err := readFontBytes(reader, size, tableOffset, tableLength)
		if err != nil {
			return nil, err
		}
		return parseNameTableFontFamilies(nameTable), nil
	}

	return nil, errUnsupportedFontContainer
}

func readFontBytes(reader io.ReaderAt, size int64, offset int64, length int64) ([]byte, error) {
	if offset < 0 || length < 0 || offset > size || length > size-offset {
		return nil, io.ErrUnexpectedEOF
	}
	buf := make([]byte, length)
	_, err := reader.ReadAt(buf, offset)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil, err
	}
	return buf, nil
}

func isSupportedSFNTVersion(version []byte) bool {
	if len(version) < 4 {
		return false
	}
	switch string(version) {
	case "OTTO", "true", "typ1":
		return true
	}
	return binary.BigEndian.Uint32(version) == 0x00010000
}

func parseNameTableFontFamilies(table []byte) []string {
	if len(table) < 6 {
		return nil
	}

	recordCount := int(binary.BigEndian.Uint16(table[2:4]))
	stringOffset := int(binary.BigEndian.Uint16(table[4:6]))
	recordsEnd := 6 + recordCount*12
	if recordCount <= 0 || recordsEnd > len(table) || stringOffset > len(table) {
		return nil
	}

	var families []string
	for _, preferredNameID := range []uint16{16, 1, 21} {
		for i := 0; i < recordCount; i++ {
			record := table[6+i*12 : 18+i*12]
			platformID := binary.BigEndian.Uint16(record[0:2])
			encodingID := binary.BigEndian.Uint16(record[2:4])
			nameID := binary.BigEndian.Uint16(record[6:8])
			if nameID != preferredNameID {
				continue
			}

			length := int(binary.BigEndian.Uint16(record[8:10]))
			offset := int(binary.BigEndian.Uint16(record[10:12]))
			start := stringOffset + offset
			end := start + length
			if length <= 0 || start < stringOffset || end > len(table) {
				continue
			}

			name := decodeFontName(platformID, encodingID, table[start:end])
			name = sanitizeFontFamilyName(name)
			if name != "" {
				families = append(families, name)
			}
		}
	}

	return uniqueFontFamilies(families)
}

func decodeFontName(platformID uint16, _ uint16, data []byte) string {
	switch platformID {
	case 0, 3:
		if len(data)%2 != 0 {
			return ""
		}
		codeUnits := make([]uint16, 0, len(data)/2)
		for i := 0; i < len(data); i += 2 {
			codeUnits = append(codeUnits, binary.BigEndian.Uint16(data[i:i+2]))
		}
		return string(utf16.Decode(codeUnits))
	case 1:
		if !utf8.Valid(data) {
			return ""
		}
		return string(data)
	default:
		if !utf8.Valid(data) {
			return ""
		}
		return string(data)
	}
}

func sanitizeFontFamilyName(name string) string {
	name = strings.ReplaceAll(name, "\x00", " ")
	name = strings.Join(strings.FieldsFunc(name, func(r rune) bool {
		return r < 0x20 || r == 0x7f || r == '\u200e' || r == '\u200f'
	}), " ")
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		return ""
	}
	if strings.HasPrefix(name, ".") {
		return ""
	}

	runes := []rune(name)
	if len(runes) > maxFontFamilyRunes {
		name = string(runes[:maxFontFamilyRunes])
	}
	return strings.TrimSpace(name)
}

func uniqueFontFamilies(families []string) []string {
	seen := make(map[string]struct{})
	unique := make([]string, 0, len(families))
	for _, family := range families {
		family = sanitizeFontFamilyName(family)
		if family == "" {
			continue
		}
		key := strings.ToLower(family)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, family)
	}
	return unique
}
