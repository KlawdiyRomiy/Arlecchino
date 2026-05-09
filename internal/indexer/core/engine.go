package core

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

type IndexingEventType int

const (
	IndexingStarted IndexingEventType = iota
	IndexingProgress
	IndexingCompleted
)

type IndexingEvent struct {
	Type    IndexingEventType
	Current int
	Total   int
}

type Engine struct {
	projectID   string
	projectRoot string
	store       *Store
	scheduler   *Scheduler
	speculative *SpeculativeStore
	adapters    map[string]LanguageAdapter
	extMap      map[string]string
	mu          sync.RWMutex
	stats       EngineStats

	indexingMu        sync.Mutex
	indexingListeners []func(IndexingEvent)
	batchSeq          atomic.Int64
	activeBatchID     atomic.Int64
	batchTotal        atomic.Int64
	batchDone         atomic.Int64
	batchProgressAt   atomic.Int64
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
		extMap:      make(map[string]string),
	}

	scheduler.OnJobComplete(func(job Job, _ error) {
		bid := e.activeBatchID.Load()
		if job.BatchID == 0 || job.BatchID != bid {
			return
		}
		done := e.batchDone.Add(1)
		total := e.batchTotal.Load()
		if e.shouldEmitIndexingProgress(done, total) {
			e.notifyIndexing(IndexingEvent{
				Type:    IndexingProgress,
				Current: int(done),
				Total:   int(total),
			})
		}
		if done == total {
			e.notifyIndexing(IndexingEvent{Type: IndexingCompleted})
		}
	})

	return e, nil
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
	e.adapters[lang] = adapter
	e.scheduler.RegisterAdapter(lang, adapter)

	for _, ext := range adapter.Extensions() {
		e.extMap[ext] = lang
	}
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
	start := time.Now()
	count := 0

	knownFiles, _ := e.store.GetAllFiles()
	inventoryBatch := make([]File, 0, indexProjectInventoryBatchSize)
	flushInventory := func() {
		if len(inventoryBatch) == 0 {
			return
		}
		_ = e.store.SaveFiles(inventoryBatch)
		inventoryBatch = inventoryBatch[:0]
	}

	type pendingFile struct {
		path string
		lang string
	}
	changed := make([]pendingFile, 0, 512)

	filepath.Walk(e.projectRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if e.shouldSkip(path) {
				return filepath.SkipDir
			}
			return nil
		}
		if e.shouldSkip(path) {
			return nil
		}

		lang := e.detectLanguage(path)
		inventoryBatch = append(inventoryBatch, e.inventoryFileFromInfo(path, info, lang, false))
		if len(inventoryBatch) >= indexProjectInventoryBatchSize {
			flushInventory()
		}
		count++
		if count%indexProjectScanYieldEvery == 0 {
			runtime.Gosched()
		}
		if lang == "" {
			return nil
		}

		if meta, ok := knownFiles[path]; ok &&
			meta.Language == lang &&
			meta.Size == info.Size() &&
			meta.Hash != "" {
			if meta.Hash == fileFingerprint(info) {
				return nil
			}
		}

		changed = append(changed, pendingFile{path: path, lang: lang})
		return nil
	})
	flushInventory()
	e.applyProjectSizePolicy(count)

	total := len(changed)
	batchID := e.batchSeq.Add(1)
	e.activeBatchID.Store(batchID)
	e.batchTotal.Store(int64(total))
	e.batchDone.Store(0)
	e.batchProgressAt.Store(0)

	e.mu.Lock()
	e.stats.TotalFiles = count
	e.stats.LastIndexedAt = time.Now()
	e.stats.LastIndexTime = time.Since(start)
	e.mu.Unlock()

	e.notifyIndexing(IndexingEvent{Type: IndexingStarted, Total: total})

	if total == 0 {
		e.notifyIndexing(IndexingEvent{Type: IndexingCompleted})
	} else {
		for _, f := range changed {
			e.scheduler.Enqueue(Job{
				ProjectID:   e.projectID,
				ProjectRoot: e.projectRoot,
				Kind:        JobKindSingleFile,
				FilePath:    f.path,
				Language:    f.lang,
				Priority:    5,
				BatchID:     batchID,
			})
		}
	}

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
		return
	}
	e.updateSpeculative(path, content)
	e.IndexFile(path, 10)
}

func (e *Engine) OnFileSaved(path string) {
	e.speculative.Remove(path)
	e.recordInventory(path)
	if !e.shouldIndexForeground(path) {
		return
	}
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

func (e *Engine) shouldIndexForeground(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.Size() <= foregroundIndexMaxBytes
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
	ext := filepath.Ext(path)
	if lang, ok := e.extMap[ext]; ok {
		return lang
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
	return string(b)
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
