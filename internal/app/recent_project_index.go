package app

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/indexer/adapters"
	"arlecchino/internal/indexer/core"
	"arlecchino/internal/processcontrol"
)

const (
	recentProjectIndexEvent = "recent-project:index"

	recentProjectIndexPhaseIdle     = "idle"
	recentProjectIndexPhaseIndexing = "indexing"
	recentProjectIndexPhaseComplete = "complete"
	recentProjectIndexPhaseError    = "error"
)

type RecentProjectIndexStatus struct {
	ProjectPath string    `json:"projectPath"`
	Phase       string    `json:"phase"`
	Current     int       `json:"current"`
	Total       int       `json:"total"`
	Percent     float64   `json:"percent"`
	Error       string    `json:"error,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type recentProjectIndexJob struct {
	mu          sync.RWMutex
	projectPath string
	engine      *core.Engine
	cancel      context.CancelFunc
	done        chan struct{}
	status      RecentProjectIndexStatus
	adopted     bool
	sessionID   string
	generation  uint64
}

func (a *App) StartRecentProjectIndex(path string) (RecentProjectIndexStatus, error) {
	if a == nil {
		return RecentProjectIndexStatus{}, fmt.Errorf("app is not initialized")
	}

	projectPath := normalizeRecentProjectIndexPath(path)
	if projectPath == "" {
		return RecentProjectIndexStatus{}, fmt.Errorf("project path is required")
	}
	if err := validateProjectOpenAccess(projectPath); err != nil {
		return RecentProjectIndexStatus{}, err
	}

	a.recentProjectIndexMu.Lock()
	if a.recentProjectIndexJobs == nil {
		a.recentProjectIndexJobs = make(map[string]*recentProjectIndexJob)
	}
	if existing := a.recentProjectIndexJobs[projectPath]; existing != nil {
		status := existing.snapshot()
		if status.Phase == recentProjectIndexPhaseIndexing || status.Phase == recentProjectIndexPhaseComplete {
			a.recentProjectIndexMu.Unlock()
			return status, nil
		}
		delete(a.recentProjectIndexJobs, projectPath)
	}
	a.recentProjectIndexMu.Unlock()

	engine, err := newCoreEngine(core.EngineConfig{
		ProjectID:   projectPath,
		ProjectRoot: projectPath,
		DBPath:      filepath.Join(projectPath, ".arlecchino", "brain.db"),
		Workers:     a.indexerWorkerCount(),
	})
	if err != nil {
		return RecentProjectIndexStatus{}, err
	}

	registerCoreEngineAdapters(engine, a.detectProjectFramework(projectPath))
	engine.Start()

	ctx, cancel := context.WithCancel(context.Background())
	job := &recentProjectIndexJob{
		projectPath: projectPath,
		engine:      engine,
		cancel:      cancel,
		done:        make(chan struct{}),
		status: RecentProjectIndexStatus{
			ProjectPath: projectPath,
			Phase:       recentProjectIndexPhaseIndexing,
			UpdatedAt:   time.Now(),
		},
	}

	engine.OnIndexing(func(evt core.IndexingEvent) {
		status := job.applyIndexingEvent(evt)
		a.emitEvent(recentProjectIndexEvent, status)
	})

	a.recentProjectIndexMu.Lock()
	if existing := a.recentProjectIndexJobs[projectPath]; existing != nil {
		status := existing.snapshot()
		a.recentProjectIndexMu.Unlock()
		cancel()
		engine.Stop()
		return status, nil
	}
	a.recentProjectIndexJobs[projectPath] = job
	a.recentProjectIndexMu.Unlock()

	a.emitEvent(recentProjectIndexEvent, job.snapshot())
	go a.runRecentProjectIndexJob(ctx, job)

	return job.snapshot(), nil
}

func (a *App) GetRecentProjectIndexStatuses(paths []string) []RecentProjectIndexStatus {
	if a == nil {
		return nil
	}

	statuses := make([]RecentProjectIndexStatus, 0, len(paths))
	for _, path := range paths {
		statuses = append(statuses, a.recentProjectIndexStatusForPath(path))
	}
	return statuses
}

func (a *App) runRecentProjectIndexJob(ctx context.Context, job *recentProjectIndexJob) {
	defer close(job.done)
	defer func() {
		if !job.isAdopted() {
			job.engine.Stop()
		}
	}()

	if err := job.engine.IndexProjectContext(ctx); err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		status := job.markFailed(err)
		a.emitEvent(recentProjectIndexEvent, status)
	}
}

func (a *App) claimRecentProjectIndexForOpen(session *ProjectRuntimeSession, path string, generation uint64) (*core.Engine, bool, bool) {
	if a == nil || session == nil {
		return nil, false, false
	}

	projectPath := normalizeRecentProjectIndexPath(path)
	if projectPath == "" {
		return nil, false, false
	}

	a.recentProjectIndexMu.Lock()
	job := a.recentProjectIndexJobs[projectPath]
	a.recentProjectIndexMu.Unlock()
	if job == nil {
		return nil, false, false
	}

	job.mu.Lock()
	status := job.status
	if status.Phase == recentProjectIndexPhaseIndexing && job.engine != nil {
		job.adopted = true
		job.sessionID = session.ID
		job.generation = generation
		engine := job.engine
		job.mu.Unlock()
		a.bindAdoptedRecentProjectIndexJob(session, job)
		a.logInfof("[Indexer] adopted recent-project index session=%s project=%s generation=%d",
			session.ID,
			filepath.Base(projectPath),
			generation,
		)
		return engine, true, false
	}
	if status.Phase == recentProjectIndexPhaseComplete {
		job.mu.Unlock()
		return nil, false, true
	}
	job.mu.Unlock()
	return nil, false, false
}

func (a *App) replayRecentProjectIndexForSession(path string, sessionID string, generation uint64) {
	projectPath := normalizeRecentProjectIndexPath(path)
	if projectPath == "" {
		return
	}

	a.recentProjectIndexMu.Lock()
	job := a.recentProjectIndexJobs[projectPath]
	a.recentProjectIndexMu.Unlock()
	if job == nil {
		return
	}

	status := job.snapshot()
	a.emitIndexerStatusFromRecentProjectIndex(job, status, sessionID, generation)
}

func (a *App) bindAdoptedRecentProjectIndexJob(session *ProjectRuntimeSession, job *recentProjectIndexJob) {
	if session == nil || job == nil || session.projectCtx == nil {
		return
	}

	session.wg.Add(1)
	go func() {
		defer session.wg.Done()
		select {
		case <-session.projectCtx.Done():
			job.cancel()
			<-job.done
		case <-job.done:
		}
	}()
}

func (a *App) emitIndexerStatusFromRecentProjectIndex(job *recentProjectIndexJob, status RecentProjectIndexStatus, sessionID string, generation uint64) {
	if a == nil || status.ProjectPath == "" {
		return
	}

	evt := core.IndexingEvent{
		Current: status.Current,
		Total:   status.Total,
	}
	eventName := "indexer:progress"
	switch status.Phase {
	case recentProjectIndexPhaseIndexing:
		if status.Current <= 0 {
			evt.Type = core.IndexingStarted
			eventName = "indexer:started"
		} else {
			evt.Type = core.IndexingProgress
		}
	case recentProjectIndexPhaseComplete:
		evt.Type = core.IndexingCompleted
		eventName = "indexer:completed"
	case recentProjectIndexPhaseError:
		evt.Type = core.IndexingFailed
		evt.Error = status.Error
		evt.Terminal = true
		eventName = "indexer:error"
	default:
		return
	}

	queueDepth := 0
	workerCount := a.indexerWorkerCount()
	projectFileCount := status.Total
	if job != nil && job.engine != nil {
		schedulerStats := job.engine.SchedulerStats()
		engineStats := job.engine.Stats()
		queueDepth = schedulerStats.Pending
		workerCount = schedulerStats.Workers
		projectFileCount = engineStats.TotalFiles
	}

	a.recordBackgroundIndexerEvent(evt, status.ProjectPath, sessionID, generation, queueDepth, workerCount)
	payload := map[string]any{
		"current":               status.Current,
		"total":                 status.Total,
		"queueDepth":            queueDepth,
		"projectFileCount":      projectFileCount,
		"configuredWorkerCount": workerCount,
		"projectPath":           status.ProjectPath,
		"sessionId":             sessionID,
		"terminal":              evt.Terminal,
	}
	if status.Error != "" {
		payload["error"] = status.Error
	}
	a.emitEvent(eventName, payload)
}

func (a *App) recentProjectIndexStatusForPath(path string) RecentProjectIndexStatus {
	projectPath := normalizeRecentProjectIndexPath(path)
	if projectPath == "" {
		return RecentProjectIndexStatus{Phase: recentProjectIndexPhaseIdle, UpdatedAt: time.Now()}
	}

	a.recentProjectIndexMu.Lock()
	job := a.recentProjectIndexJobs[projectPath]
	a.recentProjectIndexMu.Unlock()
	if job == nil {
		return RecentProjectIndexStatus{
			ProjectPath: projectPath,
			Phase:       recentProjectIndexPhaseIdle,
			UpdatedAt:   time.Now(),
		}
	}
	return job.snapshot()
}

func (a *App) cancelRecentProjectIndexes() {
	if a == nil {
		return
	}

	a.recentProjectIndexMu.Lock()
	jobs := make([]*recentProjectIndexJob, 0, len(a.recentProjectIndexJobs))
	for _, job := range a.recentProjectIndexJobs {
		if job != nil {
			jobs = append(jobs, job)
		}
	}
	a.recentProjectIndexMu.Unlock()

	for _, job := range jobs {
		job.cancel()
	}
	for _, job := range jobs {
		<-job.done
	}
}

func (a *App) indexerWorkerCount() int {
	workers := core.RecommendedWorkerCount()
	if a != nil && a.processGovernor != nil {
		policyWorkers := a.processGovernor.PolicyFor(processcontrol.KindIndexing, 0, 0).WorkerCount
		if policyWorkers > 0 {
			workers = policyWorkers
		}
	}
	return workers
}

func (a *App) detectProjectFramework(projectPath string) string {
	if a != nil && a.plugins != nil {
		return a.plugins.DetectFramework(projectPath)
	}
	return newProjectPluginRegistry().DetectFramework(projectPath)
}

func registerCoreEngineAdapters(engine *core.Engine, framework string) {
	if engine == nil {
		return
	}
	for _, adapter := range adapters.AllAdapters(framework) {
		engine.RegisterAdapter(adapter)
	}
}

func normalizeRecentProjectIndexPath(path string) string {
	clean := filepath.Clean(strings.TrimSpace(path))
	if clean == "" || clean == "." {
		return ""
	}
	return clean
}

func (job *recentProjectIndexJob) snapshot() RecentProjectIndexStatus {
	if job == nil {
		return RecentProjectIndexStatus{Phase: recentProjectIndexPhaseIdle, UpdatedAt: time.Now()}
	}
	job.mu.RLock()
	defer job.mu.RUnlock()
	return job.status
}

func (job *recentProjectIndexJob) isAdopted() bool {
	if job == nil {
		return false
	}
	job.mu.RLock()
	defer job.mu.RUnlock()
	return job.adopted
}

func (job *recentProjectIndexJob) applyIndexingEvent(evt core.IndexingEvent) RecentProjectIndexStatus {
	job.mu.Lock()
	defer job.mu.Unlock()

	status := job.status
	status.ProjectPath = job.projectPath
	status.Current = evt.Current
	status.Total = evt.Total
	status.Percent = percentFromCounts(evt.Current, evt.Total)
	status.Error = ""
	status.UpdatedAt = time.Now()

	switch evt.Type {
	case core.IndexingStarted:
		status.Phase = recentProjectIndexPhaseIndexing
		status.Current = 0
	case core.IndexingProgress:
		status.Phase = recentProjectIndexPhaseIndexing
	case core.IndexingCompleted:
		status.Phase = recentProjectIndexPhaseComplete
		status.Percent = 100
	case core.IndexingFailed:
		status.Phase = recentProjectIndexPhaseError
		status.Error = strings.TrimSpace(evt.Error)
	}
	job.status = status
	return status
}

func (job *recentProjectIndexJob) markFailed(err error) RecentProjectIndexStatus {
	job.mu.Lock()
	defer job.mu.Unlock()

	if job.status.Phase == recentProjectIndexPhaseError {
		return job.status
	}
	job.status.Phase = recentProjectIndexPhaseError
	job.status.Error = err.Error()
	job.status.UpdatedAt = time.Now()
	return job.status
}
