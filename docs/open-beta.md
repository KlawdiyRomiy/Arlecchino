# Arlecchino Open Beta

Status: public beta status document for the current macOS beta line.

Arlecchino is a macOS-first desktop IDE beta for AI-assisted project work. It
is not GA, not a stable autonomous AI IDE, and not a cross-platform release.

The public story should stay narrow: editor, terminal, Git, previews,
diagnostics, MCP, and AI Chat live in one desktop workbench while the project
stays visible.

## Current Beta Position

- Platform: macOS open beta.
- Windows and Linux: future targets, not current release platforms.
- Runtime: Go backend, React frontend, Wails v3 alpha desktop shell.
- Latest checked-in release notes in this tree: `v0.2.20-beta.141`.
- Distribution: DMG tester artifact or source checkout.
- Signing now: no Apple Developer ID signing.
- Notarization now: no Apple notarization.

Developer ID signing and notarization will be added soon. There is no date yet,
so current builds should still be described as unsigned and not notarized.

## What Ships In The Beta

- Dense IDE shell with floating, snapped, fullscreen, and detachable-capable
  panels.
- Explorer, editor, Problems, Git, terminal, Browser Preview, Markdown Preview,
  Code panel, Settings, status, and multi-project views.
- CodeMirror editing with LSP-backed diagnostics, hover, signature help,
  navigation, completion, and split editor flows.
- Project indexing and workspace state for opened projects, with scan limits and
  ignored heavy directories.
- Command Dispatcher for search, commands, files, text search, symbols,
  terminal dispatch, and AI dispatch.
- PTY terminal tabs, terminal search, command prediction, TUI-aware dispatcher
  pause, and terminal-output preview detection.
- Built-in MCP bridge for approval-based IDE access by external coding agents.
- AI Chat with provider/model selection, context preview, consent gates, run
  envelopes, approval-gated tool review, patch artifacts, Mnemonic memory, and
  external agent runtime paths.
- Bundled autocomplete ranker used as part of completion candidate ranking.

## Current Limits

- Wails v3 is still an upstream alpha dependency.
- Gatekeeper warnings are expected on first launch because builds are not
  Developer ID signed or notarized.
- Auto-update is beta/internal evidence, not a GA or no-auth public updater
  promise. Current release notes and runtime still include private GitHub
  release access paths while the repository remains private.
- Search has file/content/symbol paths, but the current backend search status
  can still be a linear fallback. Do not claim a full indexed search backend.
- LSP and code actions are language- and server-dependent. Workspace edits are
  constrained and should not be described as universal refactoring support.
- The project scanner respects `.gitignore` and skips heavy service directories
  such as `node_modules`, `vendor`, `.git`, and `.arlecchino`.
- Multi-window and packaged OS integration work is present, but some paths
  are still marked experimental or require packaged-build conditions.
- Background agents are preview-only.
- Embeddings/RAG are disabled in the current beta.
- The bundled autocomplete model is a local ranker, not a generative code model.

## Phrases To Avoid In Public Copy

- "GA", "stable", "trusted by Apple", or "notarized".
- "AI works everywhere".
- "Autonomous file changes".
- "MCP without approval".
- "Public no-auth auto-update", until the private GitHub updater path is gone
  and verified.
- "Public video available", unless the clip has actually been recorded.

## Demo Readiness

Use [features-and-demos.md](features-and-demos.md) as the feature matrix and
[demo-video-scenarios.md](demo-video-scenarios.md) as the recording storyboard.
Record demo clips only after the exact runtime or packaged build used for the
recording has passed the relevant smoke checks.
