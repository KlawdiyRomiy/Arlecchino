package terminal

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	ArlecchinoStateCategoryStaleGenerated   = "stale-generated"
	ArlecchinoStateCategoryLegacyArtifact   = "legacy-artifact"
	ArlecchinoStateCategoryCleanupCandidate = "cleanup-candidate"
	ArlecchinoStateCategoryRuntimeOwned     = "runtime-owned"
	ArlecchinoStateCategoryDoNotMove        = "do-not-move"
)

type ArlecchinoStateReport struct {
	ProjectRoot string                      `json:"projectRoot"`
	Items       []ArlecchinoStateReportItem `json:"items"`
}

type ArlecchinoStateReportItem struct {
	Path            string `json:"path"`
	Category        string `json:"category"`
	Reason          string `json:"reason"`
	SuggestedAction string `json:"suggestedAction"`
	Destructive     bool   `json:"destructive"`
}

func BuildArlecchinoStateReport(projectRoot string) (ArlecchinoStateReport, error) {
	root := strings.TrimSpace(projectRoot)
	if root == "" {
		return ArlecchinoStateReport{}, fmt.Errorf("project root is empty")
	}
	root = filepath.Clean(root)

	report := ArlecchinoStateReport{
		ProjectRoot: root,
		Items:       []ArlecchinoStateReportItem{},
	}
	stateDir := filepath.Join(root, agentGuideDirectoryName)

	addItem := func(path, category, reason, suggestedAction string, destructive bool) {
		report.Items = append(report.Items, ArlecchinoStateReportItem{
			Path:            reportRelativePath(root, path),
			Category:        category,
			Reason:          reason,
			SuggestedAction: suggestedAction,
			Destructive:     destructive,
		})
	}

	guidePath := AgentGuidePath(root)
	if content, ok := readExistingTextFile(guidePath); ok && shouldRefreshManagedAgentGuide(content) {
		addItem(
			guidePath,
			ArlecchinoStateCategoryStaleGenerated,
			"terminal agent guide does not match the current tool-first routing contract",
			"Regenerate through EnsureAgentGuideFile during project warmup.",
			false,
		)
	}

	projectMemorySkillPath := agentSkillPath(root, filepath.FromSlash(projectMemorySkillRelativePath))
	if content, ok := readExistingTextFile(projectMemorySkillPath); ok {
		if shouldRefreshManagedAgentSkill(filepath.FromSlash(projectMemorySkillRelativePath), content) {
			addItem(
				projectMemorySkillPath,
				ArlecchinoStateCategoryStaleGenerated,
				"project memory skill matches the legacy managed JSONL stub",
				"Regenerate automatically through EnsureAgentGuideFile.",
				false,
			)
		} else if reason := staleProjectMemorySkillReason(content); reason != "" {
			addItem(
				projectMemorySkillPath,
				ArlecchinoStateCategoryStaleGenerated,
				reason,
				"Review manually; local skill content will not be overwritten automatically.",
				false,
			)
		}
	}

	memoryContextPath := filepath.Join(stateDir, "memory", "CONTEXT.md")
	if content, ok := readExistingTextFile(memoryContextPath); ok {
		normalized := normalizeManagedAgentContent(content)
		if strings.Contains(normalized, "session-memory.jsonl") ||
			!strings.Contains(normalized, ".arlecchino/ai/mnemonic.db") {
			addItem(
				memoryContextPath,
				ArlecchinoStateCategoryStaleGenerated,
				"memory recall file predates the Mnemonic-backed context document",
				"Refresh through EnsureAgentContextFile or the Mnemonic memory sync path.",
				false,
			)
		}
	}

	legacyAgentContextPath := filepath.Join(stateDir, "AGENT_CONTEXT.md")
	if pathExists(legacyAgentContextPath) {
		addItem(
			legacyAgentContextPath,
			ArlecchinoStateCategoryLegacyArtifact,
			"legacy agent context file is retained for compatibility but is not part of new bootstrap routing",
			"Keep for compatibility; do not reference from new guide/bootstrap instructions.",
			false,
		)
	}

	brainPath := filepath.Join(stateDir, "brain.db")
	if info, ok := statExistingPath(brainPath); ok {
		reason := "core indexer database is owned by project startup and recovery logic"
		if !info.IsDir() && info.Size() == 0 {
			reason = "core indexer database path exists but is empty; startup recovery/rebuild logic owns this path"
		}
		addItem(
			brainPath,
			ArlecchinoStateCategoryRuntimeOwned,
			reason,
			"Do not clean automatically; use the existing core indexer recovery/rebuild path.",
			false,
		)
	}

	aiStatePath := filepath.Join(stateDir, "ai")
	if pathExists(aiStatePath) {
		addItem(
			aiStatePath,
			ArlecchinoStateCategoryRuntimeOwned,
			"AI runtime state and evidence ledgers are backend-owned",
			"Do not move or read directly from terminal agents; use runtime/MCP/API surfaces.",
			false,
		)
	}

	cleanupCandidates := []struct {
		path   string
		reason string
	}{
		{
			path:   filepath.Join(stateDir, ".DS_Store"),
			reason: "Finder metadata is not part of Arlecchino runtime state",
		},
		{
			path:   filepath.Join(stateDir, "pre-root-layout-data"),
			reason: "pre-root layout data has no current runtime owner",
		},
		{
			path:   filepath.Join(stateDir, "mcp-audit.pre-root-layout.log"),
			reason: "pre-root audit snapshot is historical local data",
		},
	}
	for _, candidate := range cleanupCandidates {
		if pathExists(candidate.path) {
			addItem(
				candidate.path,
				ArlecchinoStateCategoryCleanupCandidate,
				candidate.reason,
				"Report only; archive or remove only after explicit user approval.",
				true,
			)
		}
	}

	quarantinePaths, _ := filepath.Glob(filepath.Join(stateDir, "finder-duplicate-quarantine-*"))
	for _, path := range quarantinePaths {
		if pathExists(path) {
			addItem(
				path,
				ArlecchinoStateCategoryCleanupCandidate,
				"Finder duplicate quarantine bundle is historical local data",
				"Report only; archive or remove only after explicit user approval.",
				true,
			)
		}
	}

	if pathExists(stateDir) {
		addItem(
			stateDir,
			ArlecchinoStateCategoryDoNotMove,
			"project-local Arlecchino state root is referenced by runtime, terminal, MCP, indexer, and AI contracts",
			"Do not rename or move this directory.",
			false,
		)
	}

	return report, nil
}

func reportRelativePath(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(rel)
}

func readExistingTextFile(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return string(data), true
}

func pathExists(path string) bool {
	_, ok := statExistingPath(path)
	return ok
}

func statExistingPath(path string) (os.FileInfo, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, false
	}
	return info, true
}
