package main

import (
	"strings"

	"arlecchino/internal/execution"
)

type ExecutionProfilesRequest struct {
	ProjectPath        string `json:"projectPath"`
	ActiveFilePath     string `json:"activeFilePath"`
	ActiveFileName     string `json:"activeFileName"`
	ActiveFileContent  string `json:"activeFileContent"`
	ActiveFileLanguage string `json:"activeFileLanguage"`
}

func (a *App) GetExecutionProfiles(request ExecutionProfilesRequest) execution.ProfileSet {
	if a.executionService == nil {
		a.executionService = execution.NewService(a.plugins)
	}

	projectPath := strings.TrimSpace(request.ProjectPath)
	if projectPath == "" {
		projectPath = a.currentProjectPath()
	}

	return a.executionService.ResolveProfiles(execution.ResolveRequest{
		ProjectPath:        projectPath,
		ActiveFilePath:     strings.TrimSpace(request.ActiveFilePath),
		ActiveFileName:     strings.TrimSpace(request.ActiveFileName),
		ActiveFileContent:  request.ActiveFileContent,
		ActiveFileLanguage: strings.TrimSpace(request.ActiveFileLanguage),
	})
}
