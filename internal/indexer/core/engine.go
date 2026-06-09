package core

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"arlecchino/internal/workspace"
)

type IndexingEventType int

const (
	IndexingStarted IndexingEventType = iota
	IndexingProgress
	IndexingCompleted
	IndexingFailed
)

type IndexingEvent struct {
	Type     IndexingEventType
	Current  int
	Total    int
	Error    string
	Terminal bool
}

type Engine struct {
	projectID   string
	projectRoot string
	store       *Store
	scheduler   *Scheduler
	speculative *SpeculativeStore
	adapters    map[string]LanguageAdapter
	nameMap     map[string]string
	suffixMap   map[string]string
	suffixes    []string
	mu          sync.RWMutex
	stats       EngineStats

	indexingMu        sync.Mutex
	indexingListeners []func(IndexingEvent)
	batchSeq          atomic.Int64
	activeBatchID     atomic.Int64
	batchTotal        atomic.Int64
	batchDone         atomic.Int64
	batchProgressAt   atomic.Int64
	batchScanDone     atomic.Bool
	batchCompleted    atomic.Bool
	batchFailed       atomic.Bool
}

type EngineConfig struct {
	ProjectID   string
	ProjectRoot string
	DBPath      string
	Workers     int
}

type EngineStats struct {
	TotalFiles    int
	TotalSymbols  int
	LastIndexTime time.Duration
	LastIndexedAt time.Time
}

const (
	indexProjectInventoryBatchSize  = 128
	indexProjectScanYieldEvery      = 256
	indexProjectProgressMinInterval = 80 * time.Millisecond
	indexProjectSmallProgressBatch  = 64
	indexProjectWorkerCap           = 12
	largeProjectFileCount           = 5000
	criticalProjectFileCount        = 15000
	speculativeChangeMaxBytes       = 256 << 10
	foregroundIndexMaxBytes         = 1 << 20
	dependencyIndexFingerprint      = "depgraph-v2"
	dependencyIndexPendingMarker    = ":pending:"
)

func RecommendedWorkerCount() int {
	workers := runtime.GOMAXPROCS(0)
	if workers < 2 {
		return 2
	}
	if workers > indexProjectWorkerCap {
		return indexProjectWorkerCap
	}
	return workers
}

func NewEngine(cfg EngineConfig) (*Engine, error) {
	store, err := NewStore(cfg.DBPath, cfg.ProjectID)
	if err != nil {
		return nil, err
	}

	workers := cfg.Workers
	if workers <= 0 {
		workers = RecommendedWorkerCount()
	}
	scheduler := NewScheduler(workers, store)

	e := &Engine{
		projectID:   cfg.ProjectID,
		projectRoot: cfg.ProjectRoot,
		store:       store,
		scheduler:   scheduler,
		speculative: NewSpeculativeStore(),
		adapters:    make(map[string]LanguageAdapter),
		nameMap:     make(map[string]string),
		suffixMap:   make(map[string]string),
	}

	scheduler.OnJobComplete(func(job Job, err error) {
		bid := e.activeBatchID.Load()
		if job.BatchID == 0 || job.BatchID != bid {
			return
		}
		done := e.batchDone.Add(1)
		total := e.batchTotal.Load()
		if err != nil {
			e.batchFailed.Store(true)
			e.notifyIndexing(IndexingEvent{
				Type:     IndexingFailed,
				Current:  int(done),
				Total:    int(total),
				Error:    err.Error(),
				Terminal: true,
			})
			e.completeActiveBatchIfReady(bid)
			return
		}
		if e.shouldEmitIndexingProgress(done, total) {
			e.notifyIndexing(IndexingEvent{
				Type:    IndexingProgress,
				Current: int(done),
				Total:   int(total),
			})
		}
		e.completeActiveBatchIfReady(bid)
	})

	return e, nil
}

func (e *Engine) completeActiveBatchIfReady(batchID int64) {
	if batchID == 0 || batchID != e.activeBatchID.Load() {
		return
	}
	if !e.batchScanDone.Load() {
		return
	}
	total := e.batchTotal.Load()
	done := e.batchDone.Load()
	if done < total {
		return
	}
	if e.batchCompleted.CompareAndSwap(false, true) {
		e.notifyIndexing(IndexingEvent{
			Type:    IndexingCompleted,
			Current: int(done),
			Total:   int(total),
		})
	}
}

func (e *Engine) shouldEmitIndexingProgress(done int64, total int64) bool {
	if total <= 0 {
		return false
	}
	if done >= total || total <= indexProjectSmallProgressBatch {
		return true
	}

	now := time.Now().UnixNano()
	last := e.batchProgressAt.Load()
	if last != 0 && time.Duration(now-last) < indexProjectProgressMinInterval {
		return false
	}
	return e.batchProgressAt.CompareAndSwap(last, now)
}

func (e *Engine) Scheduler() *Scheduler {
	return e.scheduler
}

func (e *Engine) SchedulerStats() SchedulerStats {
	return e.scheduler.Stats()
}

func (e *Engine) ApplySchedulerPolicy(policy SchedulerPolicy) {
	e.scheduler.SetPolicy(policy)
}

func (e *Engine) Store() *Store {
	return e.store
}

func (e *Engine) ProjectRoot() string {
	return e.projectRoot
}

func (e *Engine) RegisterAdapter(adapter LanguageAdapter) {
	e.mu.Lock()
	defer e.mu.Unlock()

	lang := adapter.Language()
	if _, exists := e.adapters[lang]; !exists {
		e.adapters[lang] = adapter
	}
	e.scheduler.RegisterAdapter(lang, adapter)

	for _, ext := range adapter.Extensions() {
		normalized := strings.ToLower(strings.TrimSpace(ext))
		if normalized == "" {
			continue
		}
		if strings.HasPrefix(normalized, ".") {
			if _, exists := e.suffixMap[normalized]; !exists {
				e.suffixMap[normalized] = lang
				e.suffixes = append(e.suffixes, normalized)
			}
			continue
		}
		if _, exists := e.nameMap[normalized]; !exists {
			e.nameMap[normalized] = lang
		}
	}
	sort.Slice(e.suffixes, func(i, j int) bool {
		if len(e.suffixes[i]) == len(e.suffixes[j]) {
			return e.suffixes[i] < e.suffixes[j]
		}
		return len(e.suffixes[i]) > len(e.suffixes[j])
	})
}

func (e *Engine) Start() {
	e.scheduler.Start()
}

func (e *Engine) Stop() {
	e.scheduler.Stop()
	e.store.Close()
}

func (e *Engine) OnIndexing(fn func(IndexingEvent)) {
	e.indexingMu.Lock()
	e.indexingListeners = append(e.indexingListeners, fn)
	e.indexingMu.Unlock()
}

func (e *Engine) notifyIndexing(evt IndexingEvent) {
	e.indexingMu.Lock()
	listeners := make([]func(IndexingEvent), len(e.indexingListeners))
	copy(listeners, e.indexingListeners)
	e.indexingMu.Unlock()

	for _, fn := range listeners {
		fn(evt)
	}
}

func (e *Engine) IndexFile(path string, priority int) {
	lang := e.detectLanguage(path)
	if lang == "" {
		return
	}

	e.scheduler.Enqueue(Job{
		ProjectID:   e.projectID,
		ProjectRoot: e.projectRoot,
		Kind:        JobKindSingleFile,
		FilePath:    path,
		Language:    lang,
		Priority:    priority,
	})
}

func (e *Engine) IndexProject() {
	_ = e.IndexProjectContext(context.Background())
}

func (e *Engine) IndexProjectContext(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	start := time.Now()
	count := 0
	batchID := e.batchSeq.Add(1)
	e.activeBatchID.Store(batchID)
	e.batchTotal.Store(0)
	e.batchDone.Store(0)
	e.batchProgressAt.Store(0)
	e.batchScanDone.Store(false)
	e.batchCompleted.Store(false)
	e.batchFailed.Store(false)

	e.notifyIndexing(IndexingEvent{Type: IndexingStarted})

	knownFiles, _ := e.store.GetAllFiles()
	inventoryBatch := make([]File, 0, indexProjectInventoryBatchSize)
	flushInventory := func() {
		if len(inventoryBatch) == 0 {
			return
		}
		_ = e.store.SaveFiles(inventoryBatch)
		inventoryBatch = inventoryBatch[:0]
	}

	scanner, err := workspace.NewScanner(e.projectRoot, workspace.ScannerOptions{UseGitIgnore: true})
	if err != nil {
		e.batchFailed.Store(true)
		e.notifyIndexing(IndexingEvent{Type: IndexingFailed, Error: err.Error(), Terminal: true})
		return err
	}
	walkSummary, walkErr := scanner.Walk(ctx, func(entry workspace.Entry) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if entry.IsDirectory {
			return nil
		}

		lang := e.detectLanguage(entry.Path)
		versionedFingerprint := versionFileFingerprint(entry.Fingerprint)
		count++
		switch count {
		case largeProjectFileCount, criticalProjectFileCount:
			e.applyProjectSizePolicy(count)
		}
		if count%indexProjectScanYieldEvery == 0 {
			runtime.Gosched()
		}
		if lang == "" {
			inventoryBatch = append(inventoryBatch, e.inventoryFileFromWorkspaceEntry(entry, lang, false))
			if len(inventoryBatch) >= indexProjectInventoryBatchSize {
				flushInventory()
			}
			return nil
		}

		if meta, ok := knownFiles[entry.Path]; ok &&
			meta.Language == lang &&
			meta.Size == entry.Size &&
			meta.Hash != "" {
			if meta.Hash == versionedFingerprint {
				return nil
			}
		}

		inventory := e.inventoryFileFromWorkspaceEntry(entry, lang, false)
		inventory.Hash = pendingFileFingerprint(entry.Fingerprint)
		inventoryBatch = append(inventoryBatch, inventory)
		flushInventory()
		e.batchTotal.Add(1)
		e.scheduler.Enqueue(Job{
			ProjectID:   e.projectID,
			ProjectRoot: e.projectRoot,
			Kind:        JobKindSingleFile,
			FilePath:    entry.Path,
			Language:    lang,
			Priority:    5,
			BatchID:     batchID,
		})
		return nil
	})
	flushInventory()
	if walkErr != nil {
		e.batchFailed.Store(true)
		e.notifyIndexing(IndexingEvent{Type: IndexingFailed, Error: walkErr.Error(), Terminal: true})
		return walkErr
	}
	if walkSummary.Files > count {
		count = walkSummary.Files
	}
	e.applyProjectSizePolicy(count)

	e.mu.Lock()
	e.stats.TotalFiles = count
	e.stats.LastIndexedAt = time.Now()
	e.stats.LastIndexTime = time.Since(start)
	e.mu.Unlock()

	e.batchScanDone.Store(true)
	e.completeActiveBatchIfReady(batchID)

	return nil
}

func (e *Engine) applyProjectSizePolicy(fileCount int) {
	switch {
	case fileCount >= criticalProjectFileCount:
		e.scheduler.SetPolicy(CriticalSchedulerPolicy())
	case fileCount >= largeProjectFileCount:
		e.scheduler.SetPolicy(ConstrainedSchedulerPolicy())
	default:
		e.scheduler.SetPolicy(DefaultSchedulerPolicy())
	}
}

func (e *Engine) OnFileCreated(path string, content []byte) {
	e.recordInventoryFromContent(path, content)
	if len(content) > foregroundIndexMaxBytes {
		e.speculative.Remove(path)
	} else {
		e.updateSpeculative(path, content)
	}
	e.IndexFile(path, 10)
}

func (e *Engine) OnFileSaved(path string) {
	e.speculative.Remove(path)
	e.recordInventory(path)
	e.IndexFile(path, 10)
}

func (e *Engine) OnFileDeleted(path string) {
	e.speculative.Remove(path)
	e.store.DeleteFileSymbols(path)
	e.store.DeleteFileEdges(path)
	e.store.DeleteFileMeta(path)
}

func (e *Engine) OnFileChanged(path string, content []byte) {
	if len(content) > speculativeChangeMaxBytes {
		e.speculative.Remove(path)
		return
	}
	e.updateSpeculative(path, content)
	if _, err := os.Stat(path); err != nil {
		e.recordInventoryFromContent(path, content)
	}
}

// updateSpeculative parses content and adds symbols to speculative store
func (e *Engine) updateSpeculative(path string, content []byte) {
	lang := e.detectLanguage(path)
	if lang != "" {
		if adapter, ok := e.adapters[lang]; ok {
			symbols, _, _ := adapter.ParseContent(path, content)
			if len(symbols) > 0 {
				e.speculative.AddWithSymbols(path, content, symbols)
				return
			}
		}
	}
	e.speculative.Add(path, content)
}

func (e *Engine) Query(q SymbolQuery) ([]Symbol, error) {
	symbols, err := e.store.QuerySymbols(q)
	if err != nil {
		return nil, err
	}

	specSymbols := e.speculative.GetSymbols(q)
	symbols = append(symbols, specSymbols...)

	return symbols, nil
}

func (e *Engine) QueryEdges(q EdgeQuery) ([]Edge, error) {
	return e.store.QueryEdges(q)
}

func (e *Engine) FindDependants(basename string, limit int) ([]Edge, error) {
	return e.store.FindDependants(basename, limit)
}

func (e *Engine) ResolveImportFiles(toSymbols []string) (map[string]string, error) {
	return e.store.ResolveImportFiles(toSymbols)
}

func (e *Engine) QuerySymbolsByFiles(paths []string) (map[string][]Symbol, error) {
	return e.store.QuerySymbolsByFiles(paths)
}

func (e *Engine) Stats() EngineStats {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.stats
}

func (e *Engine) detectLanguage(path string) string {
	e.mu.RLock()
	defer e.mu.RUnlock()

	base := strings.ToLower(filepath.Base(path))
	if lang, ok := e.nameMap[base]; ok {
		return lang
	}

	normalized := strings.ToLower(filepath.ToSlash(path))
	for _, suffix := range e.suffixes {
		if strings.HasSuffix(normalized, suffix) {
			return e.suffixMap[suffix]
		}
	}
	return ""
}

func (e *Engine) recordInventory(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	return e.recordInventoryFromInfo(path, info, e.detectLanguage(path), false)
}

func (e *Engine) recordInventoryFromContent(path string, content []byte) error {
	lang := e.detectLanguage(path)
	if info, err := os.Stat(path); err == nil {
		return e.recordInventoryFromInfo(path, info, lang, false)
	}

	if e.store == nil {
		return nil
	}

	return e.store.SaveFile(File{
		Path:       path,
		Language:   lang,
		Kind:       classifyFileKind(path, lang),
		Size:       int64(len(content)),
		HasSymbols: false,
	})
}

func (e *Engine) recordInventoryFromInfo(path string, info os.FileInfo, language string, hasSymbols bool) error {
	if e.store == nil {
		return nil
	}

	return e.store.SaveFile(e.inventoryFileFromInfo(path, info, language, hasSymbols))
}

func (e *Engine) inventoryFileFromInfo(path string, info os.FileInfo, language string, hasSymbols bool) File {
	return File{
		Path:       path,
		Language:   language,
		Kind:       classifyFileKind(path, language),
		Hash:       fileFingerprint(info),
		Size:       info.Size(),
		HasSymbols: hasSymbols,
	}
}

func (e *Engine) inventoryFileFromWorkspaceEntry(entry workspace.Entry, language string, hasSymbols bool) File {
	return File{
		Path:       entry.Path,
		Language:   language,
		Kind:       classifyFileKind(entry.Path, language),
		Hash:       versionFileFingerprint(entry.Fingerprint),
		Size:       entry.Size,
		HasSymbols: hasSymbols,
	}
}

var skipDirNames = [...]string{
	".arlecchino",
	".cache",
	".git",
	".idea",
	".next",
	".turbo",
	".vscode",
	"__pycache__",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"storage",
	"tmp",
	"vendor",
}

func fileFingerprint(info os.FileInfo) string {
	var buf [40]byte
	b := buf[:0]
	b = strconv.AppendInt(b, info.ModTime().UnixNano(), 10)
	b = append(b, ':')
	b = strconv.AppendInt(b, info.Size(), 10)
	return versionFileFingerprint(string(b))
}

func versionFileFingerprint(raw string) string {
	if raw == "" {
		return dependencyIndexFingerprint
	}
	return dependencyIndexFingerprint + ":" + raw
}

func pendingFileFingerprint(raw string) string {
	if raw == "" {
		return dependencyIndexFingerprint + dependencyIndexPendingMarker
	}
	return dependencyIndexFingerprint + dependencyIndexPendingMarker + raw
}

func (e *Engine) shouldSkip(path string) bool {
	base := filepath.Base(path)
	return shouldSkipDirName(base)
}

func shouldSkipDirName(base string) bool {
	for _, skip := range skipDirNames {
		if base == skip {
			return true
		}
	}
	return false
}
