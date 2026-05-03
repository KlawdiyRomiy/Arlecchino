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
	capabilities := autocomplete.BuildLanguageCapabilities(hasLSP)
	if a.lspInstaller == nil {
		return capabilities
	}
	for i := range capabilities {
		serverID := capabilities[i].LSPServerID
		if serverID == "" {
			continue
		}
		server := a.lspInstaller.GetServerByID(serverID)
		if server == nil {
			continue
		}
		capabilities[i].LSPInstalled = server.Installed
		capabilities[i].LSPCanInstall = server.CanInstall
		capabilities[i].LSPInstalling = a.lspInstaller.IsInstalling(serverID)
	}
	return capabilities
}
