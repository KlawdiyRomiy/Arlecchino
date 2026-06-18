package app

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"arlecchino/internal/indexer/core"
	lspinstaller "arlecchino/internal/lsp"
)

const (
	indexerProgressMinInterval    = 250 * time.Millisecond
	indexerProgressMaxInterval    = 2 * time.Second
	indexerProgressMinPercentStep = 1.0
	indexerProgressSmallBatch     = 64
)

type indexerProgressState struct {
	lastEmittedAt time.Time
	lastPercent   float64
}

func (a *App) GetBackgroundShellStatus() BackgroundShellStatusSnapshot {
	if a == nil || a.backgroundShell == nil {
		return emptyBackgroundShellStatusSnapshot()
	}
	return a.decorateBackgroundShellStatusSnapshot(a.backgroundShell.Snapshot())
}

func (a *App) emitBackgroundShellStatusSnapshot(snapshot BackgroundShellStatusSnapshot) {
	if a == nil {
		return
	}
	snapshot = a.applyPackagedOSNativeDelivery(snapshot)
	a.emitEvent(backgroundShellStatusEvent, snapshot)
}

func (a *App) recordBackgroundShellJob(job BackgroundShellJob) {
	if a == nil || a.backgroundShell == nil {
		return
	}
	a.emitBackgroundShellStatusSnapshot(a.backgroundShell.UpsertJob(job))
}

func (a *App) RunBackgroundShellAction(actionID string) (BackgroundShellActionResult, error) {
	if a == nil || a.backgroundShell == nil {
		return BackgroundShellActionResult{}, fmt.Errorf("background shell status is unavailable")
	}

	action, snapshot, handled, err := a.backgroundShell.RunAction(actionID)
	result := BackgroundShellActionResult{
		Handled:  handled,
		Action:   action,
		Snapshot: snapshot,
	}
	if err != nil {
		return result, err
	}

	switch action.Intent {
	case "focus-surface":
		a.focusMainWindow()
		a.emitEvent("ide:intent:open", map[string]any{
			"id":        "background-shell:" + action.ID,
			"kind":      "focusSurface",
			"source":    "background-shell",
			"surfaceId": action.OwnerSurfaceID,
			"jobId":     action.JobID,
		})
		result.Message = "Surface focus requested."
	case "cancel-job":
		if a.cancelBackgroundJob(action.JobID) {
			result.Message = "Background job cancellation requested."
		} else {
			result.Message = "Background job canceled."
		}
	default:
		result.Message = "Background shell action applied."
	}

	a.emitBackgroundShellStatusSnapshot(snapshot)
	return result, nil
}

func (a *App) registerBackgroundJobCancel(jobID string, cancel context.CancelFunc) {
	if a == nil || strings.TrimSpace(jobID) == "" || cancel == nil {
		return
	}
	a.backgroundCancelMu.Lock()
	if a.backgroundCancelers == nil {
		a.backgroundCancelers = make(map[string]context.CancelFunc)
	}
	a.backgroundCancelers[jobID] = cancel
	a.backgroundCancelMu.Unlock()
}

func (a *App) unregisterBackgroundJobCancel(jobID string) {
	if a == nil || strings.TrimSpace(jobID) == "" {
		return
	}
	a.backgroundCancelMu.Lock()
	delete(a.backgroundCancelers, jobID)
	a.backgroundCancelMu.Unlock()
}

func (a *App) cancelBackgroundJob(jobID string) bool {
	if a == nil || strings.TrimSpace(jobID) == "" {
		return false
	}
	a.backgroundCancelMu.Lock()
	cancel := a.backgroundCancelers[jobID]
	if cancel != nil {
		delete(a.backgroundCancelers, jobID)
	}
	a.backgroundCancelMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	a.logInfof("[BackgroundTask] cancel requested job=%s", jobID)
	return true
}

func backgroundIndexerJobID(sessionID string, generation uint64) string {
	if strings.TrimSpace(sessionID) == "" {
		sessionID = defaultProjectSessionID
	}
	return fmt.Sprintf("indexer:%s:%d", sessionID, generation)
}

func backgroundDiagnosticsJobID(sessionID string, generation uint64) string {
	if strings.TrimSpace(sessionID) == "" {
		sessionID = defaultProjectSessionID
	}
	return fmt.Sprintf("diagnostics-scan:%s:%d", sessionID, generation)
}

func (a *App) recordBackgroundIndexerEvent(evt core.IndexingEvent, projectPath string, sessionID string, generation uint64, queueDepth int, workerCount int) {
	if a == nil {
		return
	}

	jobID := backgroundIndexerJobID(sessionID, generation)
	job := BackgroundShellJob{
		ID:              jobID,
		Kind:            "indexing",
		Category:        BackgroundShellCategoryJob,
		Title:           "Project indexing",
		ProjectPath:     projectPath,
		SessionID:       sessionID,
		Generation:      generation,
		Reason:          activationWorkspaceOpen,
		QueueDepth:      queueDepth,
		WorkerCount:     workerCount,
		NotifyOnFailure: true,
	}

	switch evt.Type {
	case core.IndexingStarted:
		a.clearBackgroundIndexerProgress(jobID)
		job.Status = BackgroundShellJobRunning
		job.Detail = fmt.Sprintf("Indexing %d project files.", evt.Total)
		job.Progress = &BackgroundShellProgress{Total: int64(evt.Total)}
		job.Cancelable = true
	case core.IndexingProgress:
		if !a.shouldRecordBackgroundIndexerProgress(jobID, evt) {
			return
		}
		job.Status = BackgroundShellJobRunning
		job.Detail = fmt.Sprintf("Indexed %d of %d project files.", evt.Current, evt.Total)
		job.Progress = &BackgroundShellProgress{
			Percent: percentFromCounts(evt.Current, evt.Total),
			Current: int64(evt.Current),
			Total:   int64(evt.Total),
		}
		job.Cancelable = true
	case core.IndexingCompleted:
		job.Status = BackgroundShellJobSucceeded
		job.Detail = "Project indexing completed."
		job.Progress = &BackgroundShellProgress{Percent: 100}
	case core.IndexingFailed:
		if !evt.Terminal {
			return
		}
		job.Status = BackgroundShellJobFailed
		job.Detail = strings.TrimSpace(evt.Error)
		if job.Detail == "" {
			job.Detail = "Project indexing failed."
		}
		job.Progress = &BackgroundShellProgress{
			Percent: percentFromCounts(evt.Current, evt.Total),
			Current: int64(evt.Current),
			Total:   int64(evt.Total),
		}
	default:
		return
	}

	a.recordBackgroundShellJob(job)
	if evt.Type == core.IndexingCompleted || evt.Type == core.IndexingFailed {
		a.clearBackgroundIndexerProgress(jobID)
		a.unregisterBackgroundJobCancel(jobID)
	}
}

func (a *App) shouldRecordBackgroundIndexerProgress(jobID string, evt core.IndexingEvent) bool {
	if a == nil {
		return false
	}
	if evt.Total <= indexerProgressSmallBatch || (evt.Total > 0 && evt.Current >= evt.Total) {
		return true
	}

	percent := percentFromCounts(evt.Current, evt.Total)
	now := time.Now()

	a.indexerProgressMu.Lock()
	defer a.indexerProgressMu.Unlock()

	if a.indexerProgress == nil {
		a.indexerProgress = make(map[string]indexerProgressState)
	}

	previous, ok := a.indexerProgress[jobID]
	if !ok || previous.lastEmittedAt.IsZero() {
		a.indexerProgress[jobID] = indexerProgressState{
			lastEmittedAt: now,
			lastPercent:   percent,
		}
		return true
	}

	elapsed := now.Sub(previous.lastEmittedAt)
	if elapsed < indexerProgressMinInterval {
		return false
	}
	if elapsed < indexerProgressMaxInterval &&
		math.Abs(percent-previous.lastPercent) < indexerProgressMinPercentStep {
		return false
	}

	a.indexerProgress[jobID] = indexerProgressState{
		lastEmittedAt: now,
		lastPercent:   percent,
	}
	return true
}

func (a *App) clearBackgroundIndexerProgress(jobID string) {
	if a == nil {
		return
	}
	a.indexerProgressMu.Lock()
	defer a.indexerProgressMu.Unlock()
	delete(a.indexerProgress, jobID)
}

func (a *App) recordBackgroundDiagnosticsScan(
	sessionID string,
	projectPath string,
	generation uint64,
	plan diagnosticsPreloadPlan,
	checked int,
	failed int,
	status BackgroundShellJobStatus,
	detail string,
) {
	if a == nil {
		return
	}
	jobID := backgroundDiagnosticsJobID(sessionID, generation)
	total := plan.SelectedCandidates
	if total <= 0 {
		total = plan.TotalCandidates
	}
	if detail == "" {
		switch status {
		case BackgroundShellJobRunning:
			detail = fmt.Sprintf("Checked %d of %d project files.", checked, total)
		case BackgroundShellJobSucceeded:
			detail = "Project diagnostics scan completed."
		case BackgroundShellJobFailed:
			detail = "Project diagnostics scan failed."
		case BackgroundShellJobCanceled:
			detail = "Project diagnostics scan canceled."
		}
	}
	job := BackgroundShellJob{
		ID:              jobID,
		Kind:            "diagnostics-scan",
		Category:        BackgroundShellCategoryJob,
		Title:           "Project diagnostics scan",
		Detail:          detail,
		ProjectPath:     projectPath,
		SessionID:       sessionID,
		Generation:      generation,
		Reason:          activationManualProjectScan,
		Status:          status,
		Cancelable:      status == BackgroundShellJobRunning || status == BackgroundShellJobQueued,
		NotifyOnFailure: true,
	}
	if plan.CoverageState == diagnosticsPreloadCoverageIncomplete {
		job.Severity = BackgroundShellSeverityWarning
	}
	if total > 0 || checked > 0 || status == BackgroundShellJobRunning {
		job.Progress = &BackgroundShellProgress{
			Percent: percentFromCounts(checked, total),
			Current: int64(maxInt(0, checked)),
			Total:   int64(maxInt(0, total)),
		}
	}
	if failed > 0 && status == BackgroundShellJobRunning {
		job.Detail = fmt.Sprintf("Checked %d of %d project files; %d failed.", checked, total, failed)
	}
	a.recordBackgroundShellJob(job)
	if isTerminalBackgroundShellJob(status) {
		a.unregisterBackgroundJobCancel(jobID)
	}
}

func (a *App) recordBackgroundLSPInstallProgress(progress lspinstaller.InstallProgress) {
	if a == nil {
		return
	}

	lspID := strings.TrimSpace(progress.LSPID)
	if lspID == "" {
		lspID = "language-server"
	}

	stage := strings.ToLower(strings.TrimSpace(progress.Stage))
	detail := strings.TrimSpace(progress.Message)
	if strings.TrimSpace(progress.Error) != "" {
		detail = strings.TrimSpace(progress.Error)
	}
	if detail == "" {
		detail = strings.TrimSpace(progress.Stage)
	}

	status := BackgroundShellJobRunning
	switch stage {
	case "error", "failed", "failure":
		status = BackgroundShellJobFailed
	case "done", "complete", "completed":
		status = BackgroundShellJobSucceeded
	case "queued":
		status = BackgroundShellJobQueued
	}

	a.recordBackgroundShellJob(BackgroundShellJob{
		ID:              "lsp-install:" + lspID,
		Kind:            "lsp-install",
		Category:        BackgroundShellCategoryJob,
		Title:           fmt.Sprintf("Install %s language server", lspID),
		Detail:          detail,
		Status:          status,
		Progress:        backgroundShellProgressFromLSP(progress),
		NotifyOnSuccess: true,
		NotifyOnFailure: true,
	})
}

func (a *App) recordBackgroundMCPBridgeStatus(status BackgroundShellJobStatus, detail string) {
	if a == nil {
		return
	}

	a.recordBackgroundShellJob(BackgroundShellJob{
		ID:              "mcp-bridge",
		Kind:            "mcp-bridge",
		Category:        BackgroundShellCategoryService,
		Title:           "MCP bridge",
		Detail:          detail,
		Status:          status,
		NotifyOnFailure: true,
	})
}

func backgroundShellProgressFromLSP(progress lspinstaller.InstallProgress) *BackgroundShellProgress {
	shellProgress := &BackgroundShellProgress{Percent: progress.Percent}
	if progress.BytesTotal > 0 {
		shellProgress.Current = progress.BytesDone
		shellProgress.Total = progress.BytesTotal
		if shellProgress.Percent == 0 {
			shellProgress.Percent = percentFromCounts(int(progress.BytesDone), int(progress.BytesTotal))
		}
	}
	return shellProgress
}

func percentFromCounts(current, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(current) / float64(total) * 100
}
