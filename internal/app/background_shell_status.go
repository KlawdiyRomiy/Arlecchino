package app

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	backgroundShellStatusVersion = 1
	backgroundShellStatusEvent   = "shell:background:status"
)

type BackgroundShellJobStatus string

const (
	BackgroundShellJobQueued    BackgroundShellJobStatus = "queued"
	BackgroundShellJobRunning   BackgroundShellJobStatus = "running"
	BackgroundShellJobSucceeded BackgroundShellJobStatus = "succeeded"
	BackgroundShellJobFailed    BackgroundShellJobStatus = "failed"
	BackgroundShellJobCanceled  BackgroundShellJobStatus = "canceled"
)

type BackgroundShellJobCategory string

const (
	BackgroundShellCategoryJob     BackgroundShellJobCategory = "job"
	BackgroundShellCategoryService BackgroundShellJobCategory = "service"
)

type BackgroundShellSeverity string

const (
	BackgroundShellSeverityInfo    BackgroundShellSeverity = "info"
	BackgroundShellSeveritySuccess BackgroundShellSeverity = "success"
	BackgroundShellSeverityWarning BackgroundShellSeverity = "warning"
	BackgroundShellSeverityError   BackgroundShellSeverity = "error"
)

type BackgroundShellProgress struct {
	Percent float64 `json:"percent"`
	Current int64   `json:"current,omitempty"`
	Total   int64   `json:"total,omitempty"`
}

type BackgroundShellAction struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	Intent         string `json:"intent"`
	JobID          string `json:"jobId,omitempty"`
	OwnerSurfaceID string `json:"ownerSurfaceId,omitempty"`
	Enabled        bool   `json:"enabled"`
}

type BackgroundShellJob struct {
	ID              string                     `json:"id"`
	Kind            string                     `json:"kind"`
	Category        BackgroundShellJobCategory `json:"category"`
	Title           string                     `json:"title"`
	Detail          string                     `json:"detail,omitempty"`
	ProjectPath     string                     `json:"projectPath,omitempty"`
	SessionID       string                     `json:"sessionId,omitempty"`
	Generation      uint64                     `json:"generation,omitempty"`
	Reason          string                     `json:"reason,omitempty"`
	ProcessID       int                        `json:"processId,omitempty"`
	Command         string                     `json:"command,omitempty"`
	QueueDepth      int                        `json:"queueDepth,omitempty"`
	WorkerCount     int                        `json:"workerCount,omitempty"`
	OwnerSurfaceID  string                     `json:"ownerSurfaceId,omitempty"`
	Status          BackgroundShellJobStatus   `json:"status"`
	Severity        BackgroundShellSeverity    `json:"severity"`
	Progress        *BackgroundShellProgress   `json:"progress,omitempty"`
	Cancelable      bool                       `json:"cancelable"`
	StartedAt       int64                      `json:"startedAt"`
	UpdatedAt       int64                      `json:"updatedAt"`
	CompletedAt     int64                      `json:"completedAt,omitempty"`
	NotifyOnSuccess bool                       `json:"notifyOnSuccess,omitempty"`
	NotifyOnFailure bool                       `json:"notifyOnFailure,omitempty"`
}

type BackgroundShellEvent struct {
	ID       string                  `json:"id"`
	Type     string                  `json:"type"`
	JobID    string                  `json:"jobId"`
	Kind     string                  `json:"kind"`
	Severity BackgroundShellSeverity `json:"severity"`
	Message  string                  `json:"message"`
	At       int64                   `json:"at"`
}

type BackgroundShellNotificationCandidate struct {
	ID        string                  `json:"id"`
	JobID     string                  `json:"jobId"`
	Severity  BackgroundShellSeverity `json:"severity"`
	Title     string                  `json:"title"`
	Body      string                  `json:"body"`
	DedupeKey string                  `json:"dedupeKey"`
	CreatedAt int64                   `json:"createdAt"`
	Action    *BackgroundShellAction  `json:"action,omitempty"`
}

type BackgroundShellStatusSnapshot struct {
	Version                 int                                    `json:"version"`
	Revision                uint64                                 `json:"revision"`
	Source                  string                                 `json:"source"`
	UpdatedAt               int64                                  `json:"updatedAt"`
	ActiveCount             int                                    `json:"activeCount"`
	ServiceCount            int                                    `json:"serviceCount"`
	AttentionCount          int                                    `json:"attentionCount"`
	Jobs                    []BackgroundShellJob                   `json:"jobs"`
	Events                  []BackgroundShellEvent                 `json:"events"`
	NotificationCandidates  []BackgroundShellNotificationCandidate `json:"notificationCandidates"`
	Actions                 []BackgroundShellAction                `json:"actions"`
	NativeTrayEnabled       bool                                   `json:"nativeTrayEnabled"`
	NativeNotificationsSent bool                                   `json:"nativeNotificationsSent"`
}

type BackgroundShellActionResult struct {
	Handled  bool                          `json:"handled"`
	Action   BackgroundShellAction         `json:"action"`
	Snapshot BackgroundShellStatusSnapshot `json:"snapshot"`
	Message  string                        `json:"message,omitempty"`
}

type BackgroundShellStatusService struct {
	mu                          sync.RWMutex
	jobs                        map[string]BackgroundShellJob
	jobOrder                    []string
	events                      []BackgroundShellEvent
	notificationCandidates      []BackgroundShellNotificationCandidate
	lastNotificationByDedupeKey map[string]int64
	revision                    uint64
	updatedAt                   int64
	clock                       func() time.Time
	maxJobs                     int
	maxEvents                   int
	maxNotifications            int
	notificationCooldownMs      int64
}

func NewBackgroundShellStatusService() *BackgroundShellStatusService {
	return &BackgroundShellStatusService{
		jobs:                        make(map[string]BackgroundShellJob),
		events:                      make([]BackgroundShellEvent, 0),
		notificationCandidates:      make([]BackgroundShellNotificationCandidate, 0),
		lastNotificationByDedupeKey: make(map[string]int64),
		clock:                       time.Now,
		maxJobs:                     64,
		maxEvents:                   128,
		maxNotifications:            64,
		notificationCooldownMs:      int64((30 * time.Second) / time.Millisecond),
	}
}

func (s *BackgroundShellStatusService) Snapshot() BackgroundShellStatusSnapshot {
	if s == nil {
		return emptyBackgroundShellStatusSnapshot()
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}

func (s *BackgroundShellStatusService) UpsertJob(job BackgroundShellJob) BackgroundShellStatusSnapshot {
	if s == nil {
		return emptyBackgroundShellStatusSnapshot()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.upsertJobLocked(job)
	return s.snapshotLocked()
}

func (s *BackgroundShellStatusService) CancelJobsForProject(projectPath, reason string) (BackgroundShellStatusSnapshot, bool) {
	if s == nil || strings.TrimSpace(projectPath) == "" {
		return emptyBackgroundShellStatusSnapshot(), false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	changed := false
	for _, id := range append([]string(nil), s.jobOrder...) {
		job, ok := s.jobs[id]
		if !ok || job.ProjectPath != projectPath || job.Category != BackgroundShellCategoryJob || !isActiveBackgroundShellJob(job.Status) {
			continue
		}
		job.Status = BackgroundShellJobCanceled
		job.Severity = BackgroundShellSeverityWarning
		job.Detail = strings.TrimSpace(reason)
		now := s.nowMsLocked()
		job.UpdatedAt = now
		job.CompletedAt = now
		s.upsertJobLocked(job)
		changed = true
	}

	return s.snapshotLocked(), changed
}

func (s *BackgroundShellStatusService) RunAction(actionID string) (BackgroundShellAction, BackgroundShellStatusSnapshot, bool, error) {
	if s == nil {
		return BackgroundShellAction{}, emptyBackgroundShellStatusSnapshot(), false, fmt.Errorf("background shell status is unavailable")
	}

	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		return BackgroundShellAction{}, s.Snapshot(), false, fmt.Errorf("background shell action id is empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	action, ok := s.resolveActionLocked(actionID)
	if !ok {
		return BackgroundShellAction{}, s.snapshotLocked(), false, fmt.Errorf("background shell action not found: %s", actionID)
	}
	if !action.Enabled {
		return action, s.snapshotLocked(), false, fmt.Errorf("background shell action is disabled: %s", actionID)
	}

	switch action.Intent {
	case "cancel-job":
		if strings.TrimSpace(action.JobID) == "" {
			return action, s.snapshotLocked(), false, fmt.Errorf("background shell cancel action has no job id")
		}
		job, ok := s.jobs[action.JobID]
		if !ok {
			return action, s.snapshotLocked(), false, fmt.Errorf("background shell job not found: %s", action.JobID)
		}
		if !job.Cancelable || !isActiveBackgroundShellJob(job.Status) {
			return action, s.snapshotLocked(), false, fmt.Errorf("background shell job is not cancelable: %s", action.JobID)
		}
		job.Status = BackgroundShellJobCanceled
		job.Severity = BackgroundShellSeverityWarning
		job.Detail = "Canceled from background shell action."
		job.Cancelable = false
		now := s.nowMsLocked()
		job.UpdatedAt = now
		job.CompletedAt = now
		s.upsertJobLocked(job)
		return action, s.snapshotLocked(), true, nil
	case "focus-surface":
		if strings.TrimSpace(action.OwnerSurfaceID) == "" {
			return action, s.snapshotLocked(), false, fmt.Errorf("background shell focus action has no surface id")
		}
		return action, s.snapshotLocked(), true, nil
	default:
		return action, s.snapshotLocked(), false, fmt.Errorf("unsupported background shell action intent: %s", action.Intent)
	}
}

func (s *BackgroundShellStatusService) setClockForTest(clock func() time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.clock = clock
}

func emptyBackgroundShellStatusSnapshot() BackgroundShellStatusSnapshot {
	return BackgroundShellStatusSnapshot{
		Version:                 backgroundShellStatusVersion,
		Source:                  "backend",
		Jobs:                    []BackgroundShellJob{},
		Events:                  []BackgroundShellEvent{},
		NotificationCandidates:  []BackgroundShellNotificationCandidate{},
		Actions:                 []BackgroundShellAction{},
		NativeTrayEnabled:       false,
		NativeNotificationsSent: false,
	}
}

func (s *BackgroundShellStatusService) upsertJobLocked(job BackgroundShellJob) {
	job.ID = strings.TrimSpace(job.ID)
	if job.ID == "" {
		return
	}

	now := s.nowMsLocked()
	previous, existed := s.jobs[job.ID]
	job = normalizeBackgroundShellJob(job, previous, existed, now)
	if existed && backgroundShellJobsEquivalent(previous, job) {
		return
	}

	if !existed {
		s.jobOrder = append(s.jobOrder, job.ID)
	}

	s.jobs[job.ID] = job
	s.revision++
	s.updatedAt = now
	s.appendEventLocked(backgroundShellEventForJob(previous, job, existed, now))
	s.maybeAddNotificationCandidateLocked(previous, job, existed, now)
	s.pruneLocked()
}

func normalizeBackgroundShellJob(job, previous BackgroundShellJob, existed bool, now int64) BackgroundShellJob {
	if job.Kind = strings.TrimSpace(job.Kind); job.Kind == "" && existed {
		job.Kind = previous.Kind
	}
	if job.Kind == "" {
		job.Kind = "unknown"
	}

	if job.Category == "" && existed {
		job.Category = previous.Category
	}
	if job.Category == "" {
		job.Category = BackgroundShellCategoryJob
	}

	if job.Title = strings.TrimSpace(job.Title); job.Title == "" && existed {
		job.Title = previous.Title
	}
	if job.Title == "" {
		job.Title = job.ID
	}

	if job.Status == "" && existed {
		job.Status = previous.Status
	}
	if job.Status == "" {
		job.Status = BackgroundShellJobRunning
	}

	if job.Severity == "" {
		job.Severity = backgroundShellSeverityForStatus(job.Status)
	}

	if job.Progress == nil && existed {
		job.Progress = cloneBackgroundShellProgress(previous.Progress)
	}
	if job.Progress != nil {
		job.Progress = normalizeBackgroundShellProgress(job.Progress)
	}

	if job.StartedAt == 0 {
		if existed && !isTerminalBackgroundShellJob(previous.Status) {
			job.StartedAt = previous.StartedAt
		} else {
			job.StartedAt = now
		}
	}
	if job.UpdatedAt == 0 {
		job.UpdatedAt = now
	}
	if isTerminalBackgroundShellJob(job.Status) && job.CompletedAt == 0 {
		job.CompletedAt = now
	}
	if isActiveBackgroundShellJob(job.Status) {
		job.CompletedAt = 0
	}

	if existed {
		if !job.NotifyOnSuccess {
			job.NotifyOnSuccess = previous.NotifyOnSuccess
		}
		if !job.NotifyOnFailure {
			job.NotifyOnFailure = previous.NotifyOnFailure
		}
	}
	if !existed && !job.NotifyOnFailure {
		job.NotifyOnFailure = true
	}

	job.Detail = strings.TrimSpace(job.Detail)
	job.ProjectPath = strings.TrimSpace(job.ProjectPath)
	job.SessionID = strings.TrimSpace(job.SessionID)
	job.Reason = strings.TrimSpace(job.Reason)
	job.Command = strings.TrimSpace(job.Command)
	job.OwnerSurfaceID = strings.TrimSpace(job.OwnerSurfaceID)
	return job
}

func (s *BackgroundShellStatusService) resolveActionLocked(actionID string) (BackgroundShellAction, bool) {
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		return BackgroundShellAction{}, false
	}

	for _, job := range s.jobs {
		if action, ok := backgroundShellCancelActionForJob(job); ok && action.ID == actionID {
			return action, true
		}
	}

	for _, candidate := range s.notificationCandidates {
		if candidate.Action == nil {
			continue
		}
		action := *candidate.Action
		if action.ID == actionID {
			return action, true
		}
	}

	return BackgroundShellAction{}, false
}

func normalizeBackgroundShellProgress(progress *BackgroundShellProgress) *BackgroundShellProgress {
	if progress == nil {
		return nil
	}
	next := *progress
	if next.Percent < 0 {
		next.Percent = 0
	}
	if next.Percent > 100 {
		next.Percent = 100
	}
	if next.Current < 0 {
		next.Current = 0
	}
	if next.Total < 0 {
		next.Total = 0
	}
	return &next
}

func backgroundShellSeverityForStatus(status BackgroundShellJobStatus) BackgroundShellSeverity {
	switch status {
	case BackgroundShellJobSucceeded:
		return BackgroundShellSeveritySuccess
	case BackgroundShellJobFailed:
		return BackgroundShellSeverityError
	case BackgroundShellJobCanceled:
		return BackgroundShellSeverityWarning
	default:
		return BackgroundShellSeverityInfo
	}
}

func backgroundShellEventForJob(previous, job BackgroundShellJob, existed bool, at int64) BackgroundShellEvent {
	eventType := "job:updated"
	if !existed {
		eventType = "job:started"
	}
	if job.Category == BackgroundShellCategoryService {
		eventType = "service:updated"
		if !existed {
			eventType = "service:started"
		}
	}
	if existed && previous.Status != job.Status {
		switch job.Status {
		case BackgroundShellJobSucceeded:
			eventType = "job:completed"
		case BackgroundShellJobFailed:
			eventType = "job:failed"
		case BackgroundShellJobCanceled:
			eventType = "job:canceled"
		case BackgroundShellJobRunning, BackgroundShellJobQueued:
			eventType = "job:started"
		}
		if job.Category == BackgroundShellCategoryService {
			eventType = "service:updated"
		}
	}

	return BackgroundShellEvent{
		ID:       fmt.Sprintf("%s:%d", job.ID, at),
		Type:     eventType,
		JobID:    job.ID,
		Kind:     job.Kind,
		Severity: job.Severity,
		Message:  backgroundShellJobMessage(job),
		At:       at,
	}
}

func backgroundShellJobMessage(job BackgroundShellJob) string {
	if job.Detail != "" {
		return job.Detail
	}
	switch job.Status {
	case BackgroundShellJobQueued:
		return job.Title + " is queued."
	case BackgroundShellJobRunning:
		return job.Title + " is running."
	case BackgroundShellJobSucceeded:
		return job.Title + " completed."
	case BackgroundShellJobFailed:
		return job.Title + " failed."
	case BackgroundShellJobCanceled:
		return job.Title + " was canceled."
	default:
		return job.Title
	}
}

func (s *BackgroundShellStatusService) maybeAddNotificationCandidateLocked(previous, job BackgroundShellJob, existed bool, now int64) {
	if !isTerminalBackgroundShellJob(job.Status) {
		return
	}
	if existed && previous.Status == job.Status {
		return
	}
	if job.Status == BackgroundShellJobSucceeded && !job.NotifyOnSuccess {
		return
	}
	if job.Status == BackgroundShellJobFailed && !job.NotifyOnFailure {
		return
	}
	if job.Status == BackgroundShellJobCanceled {
		return
	}

	dedupeKey := fmt.Sprintf("%s:%s", job.ID, job.Status)
	if lastAt, ok := s.lastNotificationByDedupeKey[dedupeKey]; ok && now-lastAt < s.notificationCooldownMs {
		return
	}

	s.lastNotificationByDedupeKey[dedupeKey] = now
	candidate := BackgroundShellNotificationCandidate{
		ID:        fmt.Sprintf("notification:%s:%d", job.ID, now),
		JobID:     job.ID,
		Severity:  job.Severity,
		Title:     job.Title,
		Body:      backgroundShellJobMessage(job),
		DedupeKey: dedupeKey,
		CreatedAt: now,
	}
	if job.OwnerSurfaceID != "" {
		candidate.Action = &BackgroundShellAction{
			ID:             "focus:" + job.OwnerSurfaceID,
			Label:          "Focus",
			Intent:         "focus-surface",
			JobID:          job.ID,
			OwnerSurfaceID: job.OwnerSurfaceID,
			Enabled:        true,
		}
	}

	s.notificationCandidates = append(s.notificationCandidates, candidate)
}

func (s *BackgroundShellStatusService) appendEventLocked(event BackgroundShellEvent) {
	s.events = append(s.events, event)
}

func (s *BackgroundShellStatusService) pruneLocked() {
	for len(s.jobOrder) > s.maxJobs {
		id := s.jobOrder[0]
		s.jobOrder = s.jobOrder[1:]
		delete(s.jobs, id)
	}
	if len(s.events) > s.maxEvents {
		s.events = append([]BackgroundShellEvent(nil), s.events[len(s.events)-s.maxEvents:]...)
	}
	if len(s.notificationCandidates) > s.maxNotifications {
		s.notificationCandidates = append(
			[]BackgroundShellNotificationCandidate(nil),
			s.notificationCandidates[len(s.notificationCandidates)-s.maxNotifications:]...,
		)
	}
}

func (s *BackgroundShellStatusService) snapshotLocked() BackgroundShellStatusSnapshot {
	jobs := make([]BackgroundShellJob, 0, len(s.jobs))
	for _, job := range s.jobs {
		jobs = append(jobs, cloneBackgroundShellJob(job))
	}
	sort.SliceStable(jobs, func(i, j int) bool {
		if jobs[i].UpdatedAt == jobs[j].UpdatedAt {
			return jobs[i].ID < jobs[j].ID
		}
		return jobs[i].UpdatedAt > jobs[j].UpdatedAt
	})

	events := append([]BackgroundShellEvent(nil), s.events...)
	notifications := make([]BackgroundShellNotificationCandidate, len(s.notificationCandidates))
	for i, candidate := range s.notificationCandidates {
		notifications[i] = cloneBackgroundShellNotificationCandidate(candidate)
	}

	actions := make([]BackgroundShellAction, 0)
	activeCount := 0
	serviceCount := 0
	attentionCount := 0
	for _, job := range jobs {
		if job.Status == BackgroundShellJobFailed {
			attentionCount++
		}
		if job.Category == BackgroundShellCategoryService {
			if isActiveBackgroundShellJob(job.Status) {
				serviceCount++
			}
			continue
		}
		if isActiveBackgroundShellJob(job.Status) {
			activeCount++
			if action, ok := backgroundShellCancelActionForJob(job); ok {
				actions = appendUniqueBackgroundShellAction(actions, action)
			}
		}
	}
	for _, candidate := range notifications {
		if candidate.Action != nil {
			actions = appendUniqueBackgroundShellAction(actions, *candidate.Action)
		}
	}

	return BackgroundShellStatusSnapshot{
		Version:                 backgroundShellStatusVersion,
		Revision:                s.revision,
		Source:                  "backend",
		UpdatedAt:               s.updatedAt,
		ActiveCount:             activeCount,
		ServiceCount:            serviceCount,
		AttentionCount:          attentionCount,
		Jobs:                    jobs,
		Events:                  events,
		NotificationCandidates:  notifications,
		Actions:                 actions,
		NativeTrayEnabled:       false,
		NativeNotificationsSent: false,
	}
}

func backgroundShellCancelActionForJob(job BackgroundShellJob) (BackgroundShellAction, bool) {
	if !job.Cancelable || !isActiveBackgroundShellJob(job.Status) || strings.TrimSpace(job.ID) == "" {
		return BackgroundShellAction{}, false
	}
	return BackgroundShellAction{
		ID:      "cancel:" + job.ID,
		Label:   "Cancel",
		Intent:  "cancel-job",
		JobID:   job.ID,
		Enabled: true,
	}, true
}

func appendUniqueBackgroundShellAction(actions []BackgroundShellAction, action BackgroundShellAction) []BackgroundShellAction {
	if strings.TrimSpace(action.ID) == "" {
		return actions
	}
	for _, existing := range actions {
		if existing.ID == action.ID {
			return actions
		}
	}
	return append(actions, action)
}

func cloneBackgroundShellJob(job BackgroundShellJob) BackgroundShellJob {
	job.Progress = cloneBackgroundShellProgress(job.Progress)
	return job
}

func cloneBackgroundShellProgress(progress *BackgroundShellProgress) *BackgroundShellProgress {
	if progress == nil {
		return nil
	}
	next := *progress
	return &next
}

func cloneBackgroundShellNotificationCandidate(candidate BackgroundShellNotificationCandidate) BackgroundShellNotificationCandidate {
	if candidate.Action != nil {
		action := *candidate.Action
		candidate.Action = &action
	}
	return candidate
}

func backgroundShellJobsEquivalent(left, right BackgroundShellJob) bool {
	if left.ID != right.ID ||
		left.Kind != right.Kind ||
		left.Category != right.Category ||
		left.Title != right.Title ||
		left.Detail != right.Detail ||
		left.ProjectPath != right.ProjectPath ||
		left.SessionID != right.SessionID ||
		left.Generation != right.Generation ||
		left.Reason != right.Reason ||
		left.ProcessID != right.ProcessID ||
		left.Command != right.Command ||
		left.QueueDepth != right.QueueDepth ||
		left.WorkerCount != right.WorkerCount ||
		left.OwnerSurfaceID != right.OwnerSurfaceID ||
		left.Status != right.Status ||
		left.Severity != right.Severity ||
		left.Cancelable != right.Cancelable ||
		left.StartedAt != right.StartedAt ||
		left.CompletedAt != right.CompletedAt ||
		left.NotifyOnSuccess != right.NotifyOnSuccess ||
		left.NotifyOnFailure != right.NotifyOnFailure {
		return false
	}
	return backgroundShellProgressEquivalent(left.Progress, right.Progress)
}

func backgroundShellProgressEquivalent(left, right *BackgroundShellProgress) bool {
	if left == nil || right == nil {
		return left == right
	}
	return left.Percent == right.Percent && left.Current == right.Current && left.Total == right.Total
}

func isActiveBackgroundShellJob(status BackgroundShellJobStatus) bool {
	return status == BackgroundShellJobQueued || status == BackgroundShellJobRunning
}

func isTerminalBackgroundShellJob(status BackgroundShellJobStatus) bool {
	return status == BackgroundShellJobSucceeded ||
		status == BackgroundShellJobFailed ||
		status == BackgroundShellJobCanceled
}

func (s *BackgroundShellStatusService) nowMsLocked() int64 {
	if s.clock == nil {
		return time.Now().UnixMilli()
	}
	return s.clock().UnixMilli()
}
