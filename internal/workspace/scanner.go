package workspace

import (
	"bufio"
	"context"
	"errors"
	"hash"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/charlievieth/fastwalk"
	enry "github.com/go-enry/go-enry/v2"
	"github.com/go-git/go-git/v5/plumbing/format/gitignore"
)

const (
	defaultEntryBuffer       = 256
	defaultContentSniffBytes = int64(64 * 1024)
)

var (
	ErrScanBudgetExceeded = errors.New("workspace scan budget exceeded")
	defaultSkipDirs       = map[string]struct{}{
		".arlecchino":  {},
		".cache":       {},
		".git":         {},
		".idea":        {},
		".next":        {},
		".turbo":       {},
		".vscode":      {},
		"__pycache__":  {},
		"build":        {},
		"coverage":     {},
		"dist":         {},
		"node_modules": {},
		"storage":      {},
		"tmp":          {},
		"vendor":       {},
	}
)

type Entry struct {
	Path        string
	RelPath     string
	Name        string
	IsDirectory bool
	Size        int64
	ModifiedAt  time.Time
	Language    string
	Binary      bool
	Vendor      bool
	Generated   bool
	Fingerprint string
	ContentHash string
}

type Summary struct {
	Entries       int
	Files         int
	Dirs          int
	Bounded       bool
	Backend       string
	SkippedErrors int
}

type ScannerOptions struct {
	MaxEntries        int
	IncludeDirs       bool
	ContentSniffBytes int64
	Workers           int
	UseGitIgnore      bool
	SkipDirs          map[string]struct{}
}

type Scanner struct {
	root    string
	options ScannerOptions
	matcher gitignore.Matcher
}

func NewScanner(root string, options ScannerOptions) (*Scanner, error) {
	absRoot, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil {
		return nil, err
	}
	if absRoot == "" {
		return nil, errors.New("workspace root is empty")
	}

	options.SkipDirs = mergeSkipDirs(options.SkipDirs)
	if options.ContentSniffBytes < 0 {
		options.ContentSniffBytes = 0
	}

	var matcher gitignore.Matcher
	if options.UseGitIgnore {
		matcher = loadRootGitIgnoreMatcher(absRoot)
	}

	return &Scanner{root: absRoot, options: options, matcher: matcher}, nil
}

func (s *Scanner) Root() string {
	return s.root
}

func (s *Scanner) Scan(ctx context.Context) ([]Entry, Summary, error) {
	var entries []Entry
	summary, err := s.Walk(ctx, func(entry Entry) error {
		entries = append(entries, entry)
		return nil
	})
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].RelPath < entries[j].RelPath
	})
	return entries, summary, err
}

func (s *Scanner) Walk(ctx context.Context, visit func(Entry) error) (Summary, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if visit == nil {
		visit = func(Entry) error { return nil }
	}

	entries := make(chan Entry, defaultEntryBuffer)
	errs := make(chan error, 1)
	skippedErrors := make(chan int, 1)
	conf := fastwalk.DefaultConfig.Copy()
	conf.Follow = false
	conf.Sort = fastwalk.SortLexical
	if s.options.Workers > 0 {
		conf.NumWorkers = s.options.Workers
	}

	go func() {
		defer close(entries)
		degraded := 0
		err := fastwalk.Walk(conf, s.root, func(path string, d fs.DirEntry, walkErr error) error {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return ctxErr
			}
			if walkErr != nil {
				degraded++
				if d != nil && d.IsDir() {
					return fastwalk.SkipDir
				}
				return nil
			}
			if path == s.root {
				return nil
			}

			entry, skip, err := s.entryFromDirEntry(path, d)
			if err != nil {
				degraded++
				return nil
			}
			if skip {
				if d.IsDir() {
					return fastwalk.SkipDir
				}
				return nil
			}
			if entry.IsDirectory && !s.options.IncludeDirs {
				return nil
			}

			select {
			case <-ctx.Done():
				return ctx.Err()
			case entries <- entry:
				return nil
			}
		})
		skippedErrors <- degraded
		errs <- err
	}()

	summary := Summary{Backend: "fastwalk"}
	for entry := range entries {
		summary.Entries++
		if entry.IsDirectory {
			summary.Dirs++
		} else {
			summary.Files++
		}
		if s.options.MaxEntries > 0 && summary.Entries > s.options.MaxEntries {
			summary.Bounded = true
			cancel()
			return summary, ErrScanBudgetExceeded
		}
		if err := visit(entry); err != nil {
			cancel()
			return summary, err
		}
	}

	err := <-errs
	summary.SkippedErrors = <-skippedErrors
	if errors.Is(err, ErrScanBudgetExceeded) {
		summary.Bounded = true
		return summary, nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return summary, err
	}
	return summary, err
}

func (s *Scanner) entryFromDirEntry(path string, d fs.DirEntry) (Entry, bool, error) {
	rel, err := filepath.Rel(s.root, path)
	if err != nil {
		return Entry{}, false, err
	}
	if rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return Entry{}, true, nil
	}
	name := d.Name()
	isDir := d.IsDir()
	if isDir && s.shouldSkipDir(name, rel) {
		return Entry{}, true, nil
	}
	if s.matcher != nil && s.matcher.Match(splitRelPath(rel), isDir) {
		return Entry{}, true, nil
	}

	info, err := d.Info()
	if err != nil {
		return Entry{}, true, err
	}
	entry := Entry{
		Path:        path,
		RelPath:     rel,
		Name:        name,
		IsDirectory: isDir,
		Size:        info.Size(),
		ModifiedAt:  info.ModTime(),
		Vendor:      enry.IsVendor(path),
		Fingerprint: MetadataFingerprint(info.ModTime(), info.Size()),
	}
	if isDir {
		return entry, false, nil
	}

	entry.Language = detectLanguageByPath(path)
	if entry.Language == "" && s.options.ContentSniffBytes > 0 && info.Size() <= s.options.ContentSniffBytes {
		content, readErr := readPrefix(path, s.options.ContentSniffBytes)
		if readErr == nil {
			entry.Binary = enry.IsBinary(content)
			if !entry.Binary {
				if lang, safe := enry.GetLanguageByContent(path, content); safe {
					entry.Language = lang
				}
				if enry.IsGenerated(path, content) {
					entry.Generated = true
				}
				entry.ContentHash = ContentHash(content)
			}
		}
	}
	return entry, false, nil
}

func (s *Scanner) shouldSkipDir(name string, rel string) bool {
	if _, ok := s.options.SkipDirs[name]; ok {
		return true
	}
	_, ok := s.options.SkipDirs[filepath.ToSlash(rel)]
	return ok
}

func detectLanguageByPath(path string) string {
	if lang, safe := enry.GetLanguageByFilename(path); safe {
		return lang
	}
	if lang, safe := enry.GetLanguageByExtension(path); safe {
		return lang
	}
	return ""
}

func MetadataFingerprint(modTime time.Time, size int64) string {
	var b strings.Builder
	b.Grow(40)
	b.WriteString(formatInt(modTime.UnixNano()))
	b.WriteByte(':')
	b.WriteString(formatInt(size))
	return b.String()
}

func ContentHash(content []byte) string {
	h := xxhash.New()
	_, _ = h.Write(content)
	return formatUint64(h)
}

func readPrefix(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	if limit <= 0 {
		limit = defaultContentSniffBytes
	}
	data, err := io.ReadAll(io.LimitReader(f, limit))
	if err != nil {
		return nil, err
	}
	return data, nil
}

func loadRootGitIgnoreMatcher(root string) gitignore.Matcher {
	file, err := os.Open(filepath.Join(root, ".gitignore"))
	if err != nil {
		return nil
	}
	defer file.Close()

	var patterns []gitignore.Pattern
	reader := bufio.NewReader(file)
	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			line = strings.TrimRight(line, "\r\n")
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
				patterns = append(patterns, gitignore.ParsePattern(line, nil))
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			break
		}
	}
	if len(patterns) == 0 {
		return nil
	}
	return gitignore.NewMatcher(patterns)
}

func mergeSkipDirs(extra map[string]struct{}) map[string]struct{} {
	merged := make(map[string]struct{}, len(defaultSkipDirs)+len(extra))
	for name := range defaultSkipDirs {
		merged[name] = struct{}{}
	}
	for name := range extra {
		merged[name] = struct{}{}
	}
	return merged
}

func splitRelPath(rel string) []string {
	rel = filepath.ToSlash(rel)
	if rel == "." || rel == "" {
		return nil
	}
	return strings.Split(rel, "/")
}

func formatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}

func formatUint64(h hash.Hash64) string {
	return strconv.FormatUint(h.Sum64(), 16)
}
