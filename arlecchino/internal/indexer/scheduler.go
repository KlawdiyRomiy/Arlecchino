package indexer

import (
	"container/heap"
	"context"
	"sync"
	"time"
)

type JobKind string

const (
	JobKindRoutes       JobKind = "routes"
	JobKindControllers  JobKind = "controllers"
	JobKindModels       JobKind = "models"
	JobKindMigrations   JobKind = "migrations"
	JobKindViews        JobKind = "views"
	JobKindBlade        JobKind = "blade"
	JobKindLivewire     JobKind = "livewire"
	JobKindConfig       JobKind = "config"
	JobKindEnv          JobKind = "env"
	JobKindPolicies     JobKind = "policies"
	JobKindFormRequests JobKind = "form_requests"
	JobKindEvents       JobKind = "events"
	JobKindListeners    JobKind = "listeners"
	JobKindEnums        JobKind = "enums"
	JobKindJsComponents JobKind = "js_components"
	JobKindTailwind     JobKind = "tailwind"
	JobKindComposer     JobKind = "composer"
	JobKindFull         JobKind = "full"
)

type Job struct {
	ProjectID   string
	ProjectRoot string
	Kind        JobKind
	Priority    int // higher first
	EnqueuedAt  time.Time
}

type JobHandler func(ctx context.Context, job Job) error

type Scheduler struct {
	handler JobHandler
	workers int

	mu      sync.Mutex
	cond    *sync.Cond
	queue   jobQueue
	dedupe  map[string]struct{}
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	stopped bool
}

func NewScheduler(handler JobHandler, workers int) *Scheduler {
	if workers < 1 {
		workers = 1
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Scheduler{
		handler: handler,
		workers: workers,
		queue:   jobQueue{},
		dedupe:  make(map[string]struct{}),
		ctx:     ctx,
		cancel:  cancel,
	}
	heap.Init(&s.queue)
	s.cond = sync.NewCond(&s.mu)
	return s
}

func (s *Scheduler) Start() {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	for i := 0; i < s.workers; i++ {
		s.wg.Add(1)
		go s.worker()
	}
}

func (s *Scheduler) Stop() {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	s.stopped = true
	s.cancel()
	s.cond.Broadcast()
	s.mu.Unlock()
	s.wg.Wait()
}

func (s *Scheduler) Enqueue(job Job) {
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		return
	}
	if job.EnqueuedAt.IsZero() {
		job.EnqueuedAt = time.Now()
	}
	key := s.key(job)
	if _, exists := s.dedupe[key]; exists {
		s.mu.Unlock()
		return
	}
	heap.Push(&s.queue, job)
	s.dedupe[key] = struct{}{}
	s.cond.Signal()
	s.mu.Unlock()
}

func (s *Scheduler) key(job Job) string {
	return job.ProjectID + "|" + string(job.Kind)
}

func (s *Scheduler) worker() {
	defer s.wg.Done()
	for {
		s.mu.Lock()
		for len(s.queue) == 0 && !s.stopped {
			s.cond.Wait()
		}
		if s.stopped {
			s.mu.Unlock()
			return
		}
		job := heap.Pop(&s.queue).(Job)
		delete(s.dedupe, s.key(job))
		s.mu.Unlock()

		_ = s.handler(s.ctx, job)
	}
}

type jobQueue []Job

func (q jobQueue) Len() int { return len(q) }

func (q jobQueue) Less(i, j int) bool {
	if q[i].Priority == q[j].Priority {
		return q[i].EnqueuedAt.Before(q[j].EnqueuedAt)
	}
	return q[i].Priority > q[j].Priority
}

func (q jobQueue) Swap(i, j int) { q[i], q[j] = q[j], q[i] }

func (q *jobQueue) Push(x interface{}) {
	*q = append(*q, x.(Job))
}

func (q *jobQueue) Pop() interface{} {
	old := *q
	n := len(old)
	item := old[n-1]
	*q = old[0 : n-1]
	return item
}
