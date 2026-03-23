package core

import (
	"container/heap"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Scheduler struct {
	mu                sync.Mutex
	cond              *sync.Cond
	queue             *jobQueue
	workers           int
	adapters          map[string]LanguageAdapter
	store             *Store
	stopCh            chan struct{}
	running           bool
	listeners         []func(Job, error)
	progressListeners []func(Progress)
}

type Progress struct {
	ProjectID string
	Message   string
	Current   int
	Total     int // 0 if unknown
}

func NewScheduler(workers int, store *Store) *Scheduler {
	s := &Scheduler{
		queue:    &jobQueue{},
		workers:  workers,
		adapters: make(map[string]LanguageAdapter),
		store:    store,
		stopCh:   make(chan struct{}),
	}
	s.cond = sync.NewCond(&s.mu)
	return s
}

func (s *Scheduler) RegisterAdapter(language string, adapter LanguageAdapter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.adapters[language] = adapter
}

func (s *Scheduler) Enqueue(job Job) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if job.EnqueuedAt.IsZero() {
		job.EnqueuedAt = time.Now()
	}
	heap.Push(s.queue, job)
	s.cond.Signal()
}

func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.stopCh = make(chan struct{})
	s.mu.Unlock()

	for i := 0; i < s.workers; i++ {
		go s.worker()
	}
}

func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	close(s.stopCh)
	s.cond.Broadcast()
	s.mu.Unlock()
}

func (s *Scheduler) OnJobComplete(fn func(Job, error)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listeners = append(s.listeners, fn)
}

func (s *Scheduler) OnProgress(fn func(Progress)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.progressListeners = append(s.progressListeners, fn)
}

func (s *Scheduler) PendingCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.queue.Len()
}

func (s *Scheduler) worker() {
	for {
		s.mu.Lock()
		for s.queue.Len() == 0 {
			select {
			case <-s.stopCh:
				s.mu.Unlock()
				return
			default:
			}
			s.cond.Wait()
		}
		select {
		case <-s.stopCh:
			s.mu.Unlock()
			return
		default:
		}
		job := heap.Pop(s.queue).(Job)
		s.mu.Unlock()

		err := s.process(job)
		s.notify(job, err)
	}
}

func (s *Scheduler) dequeue() (Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.queue.Len() == 0 {
		return Job{}, false
	}
	return heap.Pop(s.queue).(Job), true
}

func (s *Scheduler) process(job Job) error {
	switch job.Kind {
	case JobKindSingleFile:
		return s.processFile(job)
	case JobKindFull:
		return s.processFull(job)
	case JobKindLanguage:
		return s.processLanguage(job)
	default:
		return s.processFile(job)
	}
}

func (s *Scheduler) processFile(job Job) error {
	adapter := s.getAdapter(job.Language)
	if adapter == nil {
		return nil
	}

	symbols, edges, err := adapter.ParseFile(job.FilePath)
	if err != nil {
		return err
	}

	if err := s.store.DeleteFileSymbols(job.FilePath); err != nil {
		return err
	}
	if err := s.store.DeleteFileEdges(job.FilePath); err != nil {
		return err
	}

	if err := s.store.SaveSymbols(symbols); err != nil {
		return err
	}
	if err := s.store.SaveEdges(edges); err != nil {
		return err
	}

	return s.saveFileMeta(job.FilePath, job.Language, len(symbols) > 0)
}

func (s *Scheduler) processFull(job Job) error {
	// Walk the entire project and index all files with registered adapters
	s.mu.Lock()
	adapters := make(map[string]LanguageAdapter)
	for k, v := range s.adapters {
		adapters[k] = v
	}
	s.mu.Unlock()

	// Build extension/name -> adapter mapping
	extToAdapter := make(map[string]LanguageAdapter)
	nameToAdapter := make(map[string]LanguageAdapter)
	for _, adapter := range adapters {
		for _, ext := range adapter.Extensions() {
			if strings.HasPrefix(ext, ".") {
				extToAdapter[ext] = adapter
			} else if ext != "" {
				nameToAdapter[strings.ToLower(ext)] = adapter
			}
		}
	}

	count := 0
	return filepath.Walk(job.ProjectRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors, continue walking
		}
		if info.IsDir() {
			// Skip hidden directories and common non-code directories
			name := info.Name()
			if name == ".git" || name == "node_modules" || name == "vendor" || name == ".idea" || name == ".vscode" {
				return filepath.SkipDir
			}
			return nil
		}

		ext := filepath.Ext(path)
		adapter, ok := extToAdapter[ext]
		if !ok {
			base := strings.ToLower(filepath.Base(path))
			adapter, ok = nameToAdapter[base]
			if !ok {
				return nil // No adapter for this extension
			}
		}

		// Notify progress
		count++
		if count%10 == 0 { // Notify every 10 files to reduce noise
			s.notifyProgress(Progress{
				ProjectID: job.ProjectID,
				Message:   "Indexing " + filepath.Base(path),
				Current:   count,
			})
		}

		// Process the file
		symbols, edges, parseErr := adapter.ParseFile(path)
		if parseErr != nil {
			return nil // Skip files that fail to parse
		}

		// Save to store
		_ = s.store.DeleteFileSymbols(path)
		_ = s.store.DeleteFileEdges(path)
		_ = s.store.SaveSymbols(symbols)
		_ = s.store.SaveEdges(edges)
		_ = s.saveFileMeta(path, adapter.Language(), len(symbols) > 0)

		return nil
	})
}

func (s *Scheduler) processLanguage(job Job) error {
	// Index all files of a specific language
	s.mu.Lock()
	adapter, ok := s.adapters[job.Language]
	s.mu.Unlock()

	if !ok {
		return nil
	}

	// Build extension/name set for this language
	extSet := make(map[string]bool)
	nameSet := make(map[string]bool)
	for _, ext := range adapter.Extensions() {
		if strings.HasPrefix(ext, ".") {
			extSet[ext] = true
		} else if ext != "" {
			nameSet[strings.ToLower(ext)] = true
		}
	}

	count := 0
	return filepath.Walk(job.ProjectRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			if name == ".git" || name == "node_modules" || name == "vendor" || name == ".idea" || name == ".vscode" {
				return filepath.SkipDir
			}
			return nil
		}

		ext := filepath.Ext(path)
		if !extSet[ext] {
			base := strings.ToLower(filepath.Base(path))
			if !nameSet[base] {
				return nil
			}
		}

		// Notify progress
		count++
		if count%10 == 0 {
			s.notifyProgress(Progress{
				ProjectID: job.ProjectID,
				Message:   "Indexing " + filepath.Base(path),
				Current:   count,
			})
		}

		symbols, edges, parseErr := adapter.ParseFile(path)
		if parseErr != nil {
			return nil
		}

		_ = s.store.DeleteFileSymbols(path)
		_ = s.store.DeleteFileEdges(path)
		_ = s.store.SaveSymbols(symbols)
		_ = s.store.SaveEdges(edges)
		_ = s.saveFileMeta(path, adapter.Language(), len(symbols) > 0)

		return nil
	})
}

func (s *Scheduler) saveFileMeta(path string, language string, hasSymbols bool) error {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}

	return s.store.SaveFile(File{
		Path:       path,
		Language:   language,
		Kind:       classifyFileKind(path, language),
		Hash:       fileFingerprint(info),
		Size:       info.Size(),
		HasSymbols: hasSymbols,
	})
}

func (s *Scheduler) getAdapter(language string) LanguageAdapter {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.adapters[language]
}

func (s *Scheduler) notify(job Job, err error) {
	s.mu.Lock()
	listeners := make([]func(Job, error), len(s.listeners))
	copy(listeners, s.listeners)
	s.mu.Unlock()

	for _, fn := range listeners {
		fn(job, err)
	}
}

func (s *Scheduler) notifyProgress(p Progress) {
	s.mu.Lock()
	listeners := make([]func(Progress), len(s.progressListeners))
	copy(listeners, s.progressListeners)
	s.mu.Unlock()

	for _, fn := range listeners {
		fn(p)
	}
}

type jobQueue []Job

func (q jobQueue) Len() int           { return len(q) }
func (q jobQueue) Less(i, j int) bool { return q[i].Priority > q[j].Priority }
func (q jobQueue) Swap(i, j int)      { q[i], q[j] = q[j], q[i] }

func (q *jobQueue) Push(x any) {
	*q = append(*q, x.(Job))
}

func (q *jobQueue) Pop() any {
	old := *q
	n := len(old)
	item := old[n-1]
	*q = old[0 : n-1]
	return item
}

type LanguageAdapter interface {
	Language() string
	Extensions() []string
	ParseFile(path string) ([]Symbol, []Edge, error)
	ParseContent(path string, content []byte) ([]Symbol, []Edge, error)
}
