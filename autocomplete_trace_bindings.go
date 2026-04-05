package main

import "arlecchino/internal/indexer/brain"

type AutocompleteTrace = brain.CompletionTrace

func (a *App) GetLastAutocompleteTrace() brain.CompletionTrace {
	if a.brain == nil {
		return brain.CompletionTrace{}
	}
	return a.brain.LastCompletionTrace()
}
