# Arlecchino Release Notes Template

Use this for GitHub release notes and updater manifest `releaseNotes`.
Do not paste raw `git log` output or commit hash lists into user-facing notes.

## Beta Positioning

- Arlecchino is a macOS-first IDE beta with local project defaults, AI Chat,
  MCP-based IDE control, and reviewable write paths.
- Mention provider/model selection, context preview, consent, tool review,
  patch artifacts, Codex CLI runtime integration, and optional editor
  predictions when they changed in this release.
- Do not call the release GA, stable, fully autonomous, or finished. Provider
  setup, model capability, consent, approvals, and runtime coverage still vary.
- macOS artifacts are not Developer ID signed or notarized yet. Developer ID
  signing and notarization will be added soon, with no date committed yet. If a
  local certificate build is used, describe it as local identity stability only,
  not public Gatekeeper trust.

## Demo Videos

- Install and beta status: `docs/demo-video-scenarios.md#dv-01-launch-and-beta-status`.
- Shell and workspace navigation: `docs/demo-video-scenarios.md#dv-02-workbench-shell`.
- Project sessions and startup restore: `docs/demo-video-scenarios.md#dv-03-project-flow`.
- Editor intelligence: `docs/demo-video-scenarios.md#dv-04-editor-intelligence`.
- Command dispatcher: `docs/demo-video-scenarios.md#dv-05-command-dispatcher`.
- Terminal: `docs/demo-video-scenarios.md#dv-06-terminal`.
- Daily IDE tools: `docs/demo-video-scenarios.md#dv-07-daily-ide-tools`.
- MCP approval flow: `docs/demo-video-scenarios.md#dv-08-mcp-approval-boundary`.
- AI runtime: `docs/demo-video-scenarios.md#dv-09-ai-chat`.
- Tool review and patches: `docs/demo-video-scenarios.md#dv-10-tool-review-and-patch-artifact`.
- Autocomplete and ranker: `docs/demo-video-scenarios.md#dv-11-autocomplete-and-ranker`.
- Internal update evidence: `docs/demo-video-scenarios.md#dv-12-update-evidence`.

## Improved

- Short user-facing improvement.

## Fixed

- Short user-facing fix.

## Changed

- Wails v3 runtime remains pinned to `v3.0.0-alpha.95`; this is upstream
  dependency status, not Arlecchino product status.

## Security

- Short trust, verification, or privacy note when relevant.
