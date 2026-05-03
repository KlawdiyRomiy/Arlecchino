package main

import (
	"strings"

	"arlecchino/internal/autocomplete"
	lspregistry "arlecchino/internal/lsp"
)

type AutocompleteLanguageCapability = autocomplete.LanguageCapability
type AutocompleteCapabilitySources = autocomplete.CapabilitySources

// GetAutocompleteLanguageCapabilities returns language-level autocomplete support details.
func (a *App) GetAutocompleteLanguageCapabilities() []AutocompleteLanguageCapability {
	manager := a.activeLSPManager()
	projectPath := a.currentProjectPath()
	hasLSP := func(language string) bool {
		if manager == nil || a.lspInstaller == nil || !manager.HasConfig(language) {
			return false
		}
		serverID := lspServerIDForLanguage(language)
		return serverID != "" && a.lspInstaller.GetBinaryPathForRoot(serverID, projectPath) != ""
	}
	capabilities := autocomplete.BuildLanguageCapabilities(hasLSP)

	healthByLanguage := map[string]struct {
		running   bool
		lastError string
	}{}
	if manager != nil {
		for _, status := range manager.HealthCheck() {
			healthByLanguage[strings.ToLower(strings.TrimSpace(status.Language))] = struct {
				running   bool
				lastError string
			}{
				running:   status.Running && status.ProcessAlive,
				lastError: status.LastError,
			}
		}
	}

	for i := range capabilities {
		serverID := capabilities[i].LSPServerID
		resolution := autocomplete.Resolve(capabilities[i].ID, "")
		lspID := resolution.LSPID
		if lspID == "" {
			lspID = capabilities[i].CanonicalID
		}
		if manager != nil {
			capabilities[i].LSPConfigured = manager.HasConfig(lspID)
			if health, ok := healthByLanguage[strings.ToLower(strings.TrimSpace(lspID))]; ok {
				capabilities[i].LSPRunning = health.running
				capabilities[i].LSPLastError = health.lastError
			}
		}
		if serverID == "" {
			continue
		}

		if a.lspInstaller == nil {
			continue
		}
		server := a.lspInstaller.GetServerByID(serverID)
		if server != nil {
			capabilities[i].LSPCanInstall = server.CanInstall
		}
		binaryPath := a.lspInstaller.GetBinaryPathForRoot(serverID, projectPath)
		capabilities[i].LSPBinaryPath = binaryPath
		capabilities[i].LSPInstalled = binaryPath != ""
		capabilities[i].Sources.LSPAvailable = capabilities[i].LSPConfigured && binaryPath != ""

		installState := a.lspInstaller.GetInstallState(serverID)
		capabilities[i].LSPInstalling = installState.Running || a.lspInstaller.IsInstalling(serverID)
		capabilities[i].LSPInstallStage = installState.Stage
		capabilities[i].LSPInstallPercent = installState.Percent
		capabilities[i].LSPInstallMessage = installState.Message
		capabilities[i].LSPInstallError = installState.Error
	}
	return capabilities
}

func lspServerIDForLanguage(language string) string {
	resolution := autocomplete.Resolve(language, "")
	lspID := resolution.LSPID
	if lspID == "" {
		lspID = resolution.CanonicalID
	}
	info := lspregistry.GetLanguageByID(lspID)
	if info == nil {
		info = lspregistry.GetLanguageByID(resolution.CanonicalID)
	}
	if info == nil {
		return ""
	}
	return info.LSPServerID
}
