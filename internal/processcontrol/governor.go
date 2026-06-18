package processcontrol

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Kind string

const (
	KindLSPServer        Kind = "lsp-server"
	KindDiagnosticsScan  Kind = "diagnostics-scan"
	KindIndexing         Kind = "indexing"
	KindSearch           Kind = "search"
	KindGitRefresh       Kind = "git-refresh"
	KindDependencyHelper Kind = "dependency-helper"
	KindTerminalHelper   Kind = "terminal-helper"
	KindAIRuntime        Kind = "ai-runtime"
)

type Request struct {
	Kind        Kind
	SessionID   string
	Generation  uint64
	Project     string
	Root        string
	Language    string
	Group       string
	Reason      string
	Command     string
	Args        []string
	ObserveOnly bool
}

type Policy struct {
	Nice                    int
	MaxConcurrentGlobal     int
	MaxConcurrentPerProject int
	WorkerCount             int
	ObserveOnly             bool
}

type PressureSnapshot struct {
	ActiveStarts int
	QueuedStarts int
	UpdatedAt    time.Time
}

type Controller interface {
	Acquire(ctx context.Context, req Request) (*Lease, error)
	PolicyFor(kind Kind, projectFileCount int, queueDepth int) Policy
	Snapshot() PressureSnapshot
}

type Governor struct {
	mu              sync.Mutex
	nextID          atomic.Uint64
	activeByKind    map[Kind]int
	activeByProject map[string]int
	queued          int
}

func NewGovernor() *Governor {
	return &Governor{
		activeByKind:    make(map[Kind]int),
		activeByProject: make(map[string]int),
	}
}

func (g *Governor) PolicyFor(kind Kind, projectFileCount int, queueDepth int) Policy {
	switch kind {
	case KindLSPServer:
		return Policy{Nice: 10, MaxConcurrentGlobal: 2, MaxConcurrentPerProject: 1}
	case KindDiagnosticsScan:
		return Policy{Nice: 10, MaxConcurrentGlobal: 1, MaxConcurrentPerProject: 1}
	case KindIndexing:
		return Policy{Nice: 10, WorkerCount: recommendedIndexerWorkers(projectFileCount, queueDepth)}
	case KindTerminalHelper:
		return Policy{ObserveOnly: true}
	default:
		return Policy{Nice: 10, MaxConcurrentGlobal: 2, MaxConcurrentPerProject: 1}
	}
}

func (g *Governor) Acquire(ctx context.Context, req Request) (*Lease, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if g == nil || req.ObserveOnly {
		return newDetachedLease(req, Policy{ObserveOnly: true}), nil
	}

	req.Kind = normalizeKind(req.Kind)
	policy := g.PolicyFor(req.Kind, 0, 0)
	if policy.ObserveOnly {
		return newDetachedLease(req, policy), nil
	}

	projectKey := projectKey(req)
	id := g.nextID.Add(1)
	lease := &Lease{
		id:        fmt.Sprintf("%s:%d", req.Kind, id),
		governor:  g,
		req:       req,
		policy:    policy,
		startedAt: time.Now(),
	}

	g.mu.Lock()
	g.queued++
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		if g.queued > 0 {
			g.queued--
		}
		g.mu.Unlock()
	}()

	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		g.mu.Lock()
		if g.canAcquireLocked(req.Kind, projectKey, policy) {
			g.activeByKind[req.Kind]++
			if projectKey != "" {
				g.activeByProject[projectKindKey(projectKey, req.Kind)]++
			}
			g.mu.Unlock()
			log.Printf("[ProcessGovernor] acquired id=%s kind=%s language=%s group=%s command=%s root=%s reason=%s session=%s generation=%d policyNice=%d",
				lease.id, req.Kind, req.Language, req.Group, req.Command, req.Root, req.Reason, req.SessionID, req.Generation, policy.Nice)
			return lease, nil
		}
		g.mu.Unlock()

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (g *Governor) Snapshot() PressureSnapshot {
	if g == nil {
		return PressureSnapshot{UpdatedAt: time.Now()}
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	active := 0
	for _, count := range g.activeByKind {
		active += count
	}
	return PressureSnapshot{
		ActiveStarts: active,
		QueuedStarts: g.queued,
		UpdatedAt:    time.Now(),
	}
}

func (g *Governor) canAcquireLocked(kind Kind, project string, policy Policy) bool {
	if policy.MaxConcurrentGlobal > 0 && g.activeByKind[kind] >= policy.MaxConcurrentGlobal {
		return false
	}
	if policy.MaxConcurrentPerProject > 0 && project != "" &&
		g.activeByProject[projectKindKey(project, kind)] >= policy.MaxConcurrentPerProject {
		return false
	}
	return true
}

type Lease struct {
	id        string
	governor  *Governor
	req       Request
	policy    Policy
	startedAt time.Time
	processID int
	released  atomic.Bool
}

func newDetachedLease(req Request, policy Policy) *Lease {
	return &Lease{
		id:        fmt.Sprintf("%s:detached:%d", normalizeKind(req.Kind), time.Now().UnixNano()),
		req:       req,
		policy:    policy,
		startedAt: time.Now(),
	}
}

func (l *Lease) ID() string {
	if l == nil {
		return ""
	}
	return l.id
}

func (l *Lease) Policy() Policy {
	if l == nil {
		return Policy{}
	}
	return l.policy
}

func (l *Lease) RegisterStarted(pid int) {
	if l == nil {
		return
	}
	l.processID = pid
	log.Printf("[ProcessGovernor] process started id=%s kind=%s pid=%d language=%s group=%s command=%s args=%v root=%s reason=%s session=%s generation=%d",
		l.id, l.req.Kind, pid, l.req.Language, l.req.Group, l.req.Command, l.req.Args, l.req.Root, l.req.Reason, l.req.SessionID, l.req.Generation)
}

func (l *Lease) Release(status string) {
	if l == nil || !l.released.CompareAndSwap(false, true) {
		return
	}
	status = strings.TrimSpace(status)
	if status == "" {
		status = "released"
	}
	duration := time.Since(l.startedAt)
	log.Printf("[ProcessGovernor] released id=%s kind=%s status=%s pid=%d durationMs=%d language=%s group=%s command=%s reason=%s",
		l.id, l.req.Kind, status, l.processID, duration.Milliseconds(), l.req.Language, l.req.Group, l.req.Command, l.req.Reason)
	if l.governor == nil || l.policy.ObserveOnly {
		return
	}
	projectKey := projectKey(l.req)
	l.governor.mu.Lock()
	if l.governor.activeByKind[l.req.Kind] > 0 {
		l.governor.activeByKind[l.req.Kind]--
	}
	if projectKey != "" {
		key := projectKindKey(projectKey, l.req.Kind)
		if l.governor.activeByProject[key] > 0 {
			l.governor.activeByProject[key]--
		}
	}
	l.governor.mu.Unlock()
}

func normalizeKind(kind Kind) Kind {
	if strings.TrimSpace(string(kind)) == "" {
		return KindDependencyHelper
	}
	return kind
}

func projectKey(req Request) string {
	project := strings.TrimSpace(req.Project)
	if project == "" {
		project = strings.TrimSpace(req.Root)
	}
	if project == "" {
		return ""
	}
	return filepath.Clean(project)
}

func projectKindKey(project string, kind Kind) string {
	return string(kind) + "\x00" + filepath.Clean(project)
}

func recommendedIndexerWorkers(projectFileCount int, queueDepth int) int {
	workers := runtime.GOMAXPROCS(0)
	if workers < 2 {
		workers = 2
	}
	if workers > 6 {
		workers = 6
	}
	switch {
	case projectFileCount >= 15000 || queueDepth >= 500:
		return 2
	case projectFileCount >= 5000 || queueDepth >= 160:
		if workers > 3 {
			return 3
		}
	}
	return workers
}
