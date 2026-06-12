package app

import indexerlsp "arlecchino/internal/indexer/lsp"

func (a *App) remapLSPDiagnosticsForProjectEntry(oldPath, newPath string) {
	manager := a.activeLSPManager()
	if manager == nil {
		return
	}
	manager.DidRenameFiles([]indexerlsp.FileRename{{
		OldURI: indexerlsp.FilePathToURI(oldPath),
		NewURI: indexerlsp.FilePathToURI(newPath),
	}})
}

func (a *App) pruneLSPDiagnosticsForProjectEntry(path string) {
	manager := a.activeLSPManager()
	if manager == nil {
		return
	}
	manager.PruneDiagnosticsForPath(path)
}
