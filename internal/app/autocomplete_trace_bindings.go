package app

import "arlecchino/internal/indexer/brain"

type AutocompleteTrace = brain.CompletionTrace

func (a *App) GetLastAutocompleteTrace() brain.CompletionTrace {
	completionBrain := a.activeCompletionBrain()
	if completionBrain == nil {
		return brain.CompletionTrace{}
	}
	return completionBrain.LastCompletionTrace()
}
