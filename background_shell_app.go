package main

import (
	"fmt"
	"strings"

	"arlecchino/internal/indexer/core"
	lspinstaller "arlecchino/internal/lsp"
)

func (a *App) GetBackgroundShellStatus() BackgroundShellStatusSnapshot {
	if a == nil || a.backgroundShell == nil {
		return emptyBackgroundShellStatusSnapshot()
	}
	return a.backgroundShell.Snapshot()
}

func (a *App) emitBackgroundShellStatusSnapshot(snapshot BackgroundShellStatusSnapshot) {
	if a == nil {
		return
	}
	a.emitEvent(backgroundShellStatusEvent, snapshot)
}

func (a *App) recordBackgroundShellJob(job BackgroundShellJob) {
	if a == nil || a.backgroundShell == nil {
		return
	}
	a.emitBackgroundShellStatusSnapshot(a.backgroundShell.UpsertJob(job))
}

func (a *App) recordBackgroundIndexerEvent(evt core.IndexingEvent, projectPath string, generation uint64) {
	if a == nil {
		return
	}

	job := BackgroundShellJob{
		ID:              fmt.Sprintf("indexer:%d", generation),
		Kind:            "indexing",
		Category:        BackgroundShellCategoryJob,
		Title:           "Project indexing",
		ProjectPath:     projectPath,
		NotifyOnFailure: true,
	}

	switch evt.Type {
	case core.IndexingStarted:
		job.Status = BackgroundShellJobRunning
		job.Detail = fmt.Sprintf("Indexing %d project files.", evt.Total)
		job.Progress = &BackgroundShellProgress{Total: int64(evt.Total)}
	case core.IndexingProgress:
		job.Status = BackgroundShellJobRunning
		job.Detail = fmt.Sprintf("Indexed %d of %d project files.", evt.Current, evt.Total)
		job.Progress = &BackgroundShellProgress{
			Percent: percentFromCounts(evt.Current, evt.Total),
			Current: int64(evt.Current),
			Total:   int64(evt.Total),
		}
	case core.IndexingCompleted:
		job.Status = BackgroundShellJobSucceeded
		job.Detail = "Project indexing completed."
		job.Progress = &BackgroundShellProgress{Percent: 100}
	default:
		return
	}

	a.recordBackgroundShellJob(job)
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
