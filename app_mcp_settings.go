package main

import (
	"os"
	"strings"

	"arlecchino/internal/mcp"
)

type MCPSettingsStatus struct {
	Settings                    mcp.Settings            `json:"settings"`
	Tools                       []mcp.ToolSettingsEntry `json:"tools"`
	DiskPath                    string                  `json:"diskPath"`
	BridgeRunning               bool                    `json:"bridgeRunning"`
	ApprovalCodeConfigured      bool                    `json:"approvalCodeConfigured"`
	ApprovalRequiredEnvOverride bool                    `json:"approvalRequiredEnvOverride"`
}

func (a *App) GetMCPSettings() (MCPSettingsStatus, error) {
	return a.mcpSettingsStatus()
}

func (a *App) SaveMCPSettings(settings mcp.Settings) (MCPSettingsStatus, error) {
	normalized, _, err := mcp.SaveSettings("", settings)
	if err != nil {
		return MCPSettingsStatus{}, err
	}

	if normalized.Enabled {
		if _, err := mcp.SetOpenCodeMCPEnabled("", a.currentProjectPath(), true); err != nil {
			return MCPSettingsStatus{}, err
		}
		a.startMCPBridge()
		a.ensureMCPConfigs()
	} else {
		a.stopMCPBridge()
		a.recordBackgroundMCPBridgeStatus(BackgroundShellJobCanceled, "MCP disabled in settings.")
		if _, err := mcp.DisableUniversalUserMCPBootstrap("", a.currentProjectPath()); err != nil {
			return MCPSettingsStatus{}, err
		}
	}

	return a.mcpSettingsStatus()
}

func (a *App) mcpSettingsStatus() (MCPSettingsStatus, error) {
	settings, diskPath, err := mcp.LoadSettings("")
	if err != nil {
		return MCPSettingsStatus{}, err
	}

	bridgeRunning := false
	if a != nil {
		a.mcpBridgeMu.Lock()
		bridgeRunning = a.mcpBridgeServer != nil
		a.mcpBridgeMu.Unlock()
	}

	return MCPSettingsStatus{
		Settings:                    settings,
		Tools:                       mcp.BuildToolSettingsEntries(settings),
		DiskPath:                    diskPath,
		BridgeRunning:               bridgeRunning,
		ApprovalCodeConfigured:      strings.TrimSpace(os.Getenv("ARLECCHINO_MCP_APPROVAL_CODE")) != "",
		ApprovalRequiredEnvOverride: strings.TrimSpace(os.Getenv("ARLECCHINO_MCP_REQUIRE_APPROVAL")) != "",
	}, nil
}
