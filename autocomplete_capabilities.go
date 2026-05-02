package main

import "arlecchino/internal/autocomplete"

type AutocompleteLanguageCapability = autocomplete.LanguageCapability
type AutocompleteCapabilitySources = autocomplete.CapabilitySources

// GetAutocompleteLanguageCapabilities returns language-level autocomplete support details.
func (a *App) GetAutocompleteLanguageCapabilities() []AutocompleteLanguageCapability {
	manager := a.activeLSPManager()
	var hasLSP autocomplete.LSPAvailabilityFunc
	if manager != nil {
		hasLSP = manager.HasConfig
	}
	return autocomplete.BuildLanguageCapabilities(hasLSP)
}
