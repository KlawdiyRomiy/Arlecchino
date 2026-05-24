package app

import (
	"path/filepath"
	"strings"

	"arlecchino/internal/terminal"
)

type TerminalPredictionRequest struct {
	Input     string `json:"input"`
	WorkDir   string `json:"workDir"`
	ProjectID string `json:"projectID"`
}

type TerminalPredictionResponse struct {
	Predictions []terminal.PredictionResult `json:"predictions"`
}

func (a *App) PredictTerminalCommand(req TerminalPredictionRequest) (TerminalPredictionResponse, error) {
	input := strings.TrimSpace(req.Input)
	if input == "" {
		return TerminalPredictionResponse{Predictions: []terminal.PredictionResult{}}, nil
	}

	var predictions []terminal.PredictionResult
	projectPath := a.GetCurrentProjectPath()
	workDir := req.WorkDir
	if workDir == "" {
		workDir = projectPath
	}

	parts := strings.Fields(input)
	lastToken := ""
	if len(parts) > 1 {
		lastToken = parts[len(parts)-1]
	}
	engine := a.activeCoreEngine()
	pluginRegistry := a.activePluginRegistry()

	if len(parts) == 1 && a.carapaceProvider != nil {
		cmdPredictions := a.carapaceProvider.GetCommandCompletions(parts[0])
		predictions = append(predictions, cmdPredictions...)

		historyPreds := a.carapaceProvider.GetHistoryCompletions(input, 3)
		predictions = append(predictions, historyPreds...)
	}

	if a.carapaceProvider != nil && a.carapaceProvider.IsAvailable() {
		carapacePredictions := a.carapaceProvider.GetPredictions(input, workDir)
		predictions = append(predictions, carapacePredictions...)
	}

	if engine != nil && len(parts) > 1 && !strings.HasPrefix(lastToken, "-") {
		store := engine.Store()
		if store != nil {
			files, err := store.SearchFiles(lastToken, 10)
			if err == nil && len(files) > 0 {
				prefix := strings.Join(parts[:len(parts)-1], " ") + " "
				for _, f := range files {
					relPath := f.Path
					if projectPath != "" && strings.HasPrefix(f.Path, projectPath) {
						relPath = strings.TrimPrefix(f.Path, projectPath)
						relPath = strings.TrimPrefix(relPath, "/")
					}

					baseName := filepath.Base(relPath)

					completion := ""
					if strings.HasPrefix(strings.ToLower(baseName), strings.ToLower(lastToken)) {
						completion = baseName[len(lastToken):]
					} else if strings.HasPrefix(strings.ToLower(relPath), strings.ToLower(lastToken)) {
						completion = relPath[len(lastToken):]
					}

					if completion != "" {
						predictions = append(predictions, terminal.PredictionResult{
							Text:       prefix + relPath,
							Completion: completion,
							Source:     "indexer",
							Confidence: 0.95,
						})
					}
				}
			}
		}
	}

	if pluginRegistry != nil && projectPath != "" {
		pluginSuggestions := pluginRegistry.SuggestCommand(projectPath, input)
		for _, s := range pluginSuggestions {
			lastToken := input
			if idx := strings.LastIndex(input, " "); idx >= 0 {
				lastToken = input[idx+1:]
			}

			completion := s.Text
			if strings.HasPrefix(strings.ToLower(s.Text), strings.ToLower(lastToken)) {
				completion = s.Text[len(lastToken):]
			} else if strings.HasPrefix(strings.ToLower(s.Text), strings.ToLower(input)) {
				completion = s.Text[len(input):]
			}

			predictions = append(predictions, terminal.PredictionResult{
				Text:       s.Text,
				Completion: completion,
				Source:     "plugin",
				Confidence: 0.9,
			})
		}
	}

	if len(predictions) == 0 && a.carapaceProvider != nil {
		historyPreds := a.carapaceProvider.GetHistoryCompletions(input, 5)
		predictions = append(predictions, historyPreds...)
	}

	predictions = deduplicatePredictions(predictions)

	if len(predictions) > 10 {
		predictions = predictions[:10]
	}

	return TerminalPredictionResponse{Predictions: predictions}, nil
}

func deduplicatePredictions(preds []terminal.PredictionResult) []terminal.PredictionResult {
	seen := make(map[string]bool)
	result := make([]terminal.PredictionResult, 0, len(preds))
	for _, p := range preds {
		if !seen[p.Text] {
			seen[p.Text] = true
			result = append(result, p)
		}
	}
	return result
}

func (a *App) RecordCommandExecution(projectID, command, workDir string) error {
	engine := a.activeCoreEngine()
	if engine == nil {
		return nil
	}

	store := engine.Store()
	if store == nil {
		return nil
	}

	return store.RecordCommandUsage(projectID, command, workDir)
}

func (a *App) ImportShellHistory(projectID, historyPath, workDir string) error {
	engine := a.activeCoreEngine()
	if engine == nil {
		return nil
	}

	store := engine.Store()
	if store == nil {
		return nil
	}

	return store.ImportHistoryFromFile(historyPath, workDir)
}

func (a *App) GetTerminalHistory(limit int) []string {
	if a.carapaceProvider == nil {
		return nil
	}
	if limit <= 0 {
		limit = 100
	}
	return a.carapaceProvider.GetHistory(limit)
}
