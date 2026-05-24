# Arlecchino Features And Demos

Status: public feature map for the macOS open beta.

This file tracks what Arlecchino currently claims publicly and where demo
videos should be attached. `TBD` means the feature is part of the beta surface
but does not yet have a public demo clip.

## Shell, Panels, And macOS App Behavior

Current beta status: available.

Arlecchino uses a dense desktop IDE shell with floating and snapped panels for
common project work. The goal is a workbench that keeps project context visible
without turning the first screen into a marketing dashboard.

The packaged macOS app also includes native bridge work for menu, fullscreen,
window controls, credential storage, single-instance routing, open intents, and
Dock reopen behavior. This is macOS beta behavior, not a cross-platform release
claim.

Show in demo:

- Open, snap, float, move, and restore a panel.
- Switch between Explorer, Terminal, Git, and Problems.
- Reopen a project and show that panel layout is preserved.
- Open a project/file intent into the existing packaged app instance.
- Reopen windows from the Dock after closing the visible window set.

Demo video: TBD.

## Command Dispatcher And Action Routing

Current beta status: available, with terminal prediction and TUI behavior still
being hardened.

The Command Dispatcher routes search, IDE commands, file search, grep, symbol
search, terminal dispatch, and AI dispatch through a single keyboard-centered
workflow. It opens with `Cmd+Shift+F`.

Show in demo:

- Open the Command Dispatcher with `Cmd+Shift+F`.
- Use default search.
- Run an IDE command with `>`.
- Search files with `>>`.
- Search text with a quoted query.
- Search symbols with `#`.
- Send a terminal command through `@t ` and show terminal prediction.
- Ask AI with `@ai `.
- Start AI modes with `@ai /chat`, `@ai /plan`, `@ai /debug`, `@ai /build`,
  and `@ai /review`.
- Show a TUI-aware terminal flow with a command such as `vim`, `htop`, or
  `less`.

Demo video: TBD.

## Editor, Navigation, And Code Intelligence

Current beta status: available.

The editor surface is built on CodeMirror 6 and connects to language tooling,
diagnostics, hover, signature help, split views, dependency views, and
navigation flows. The indexer and dependency graph cover more supported
language families through generic adapters and resolver-based target matching.

Show in demo:

- Edit a source file.
- Show diagnostics, hover, signature help, minimap, and split views.
- Navigate between related files, symbols, and dependency views.
- Show dependency graph coverage in more than one language family.

Demo video: TBD.

## Built-In IDE Tools

Current beta status: available.

The beta includes the everyday IDE surfaces needed to work inside a project:
Explorer, Problems, Git, Browser Preview, Markdown Preview, terminal, Code
panel, settings, status, and multi-project switching.

The terminal surface includes tabs, panes/splits, search, command prediction,
TUI-aware handling, and preview detection from terminal output. Git includes
status, history, diffs, branch controls, stash actions, and commit flows.
Browser Preview supports navigation, refresh, external opening, terminal-driven
preview opening, and file-save auto-refresh for preview workflows.

Show in demo:

- Open Explorer and switch files.
- Inspect Problems.
- Review Git status, history, branch controls, stash actions, and diffs.
- Split a terminal pane, search terminal output, and show command prediction.
- Open Browser Preview, Markdown Preview, Code panel, and Settings.
- Switch projects.

Demo video: TBD.

## MCP Integration

Current beta status: available, guarded by approval and audit boundaries.

Arlecchino ships with a built-in MCP server so external coding agents can
interact with the IDE through controlled tools instead of blind terminal or
screen scraping.

Show in demo:

- Have an external agent read IDE state.
- Open a file or panel through the IDE control surface.
- Trigger a mutating or sensitive action and show the approval boundary.
- Show that accepted bridge events are separate from confirmed frontend
  handling where relevant.

Demo video: TBD.

## AI Chat And Tool Review

Current beta status: available, gated by provider/model/runtime configuration
and user consent.

AI Chat is the default AI workflow. It is wired to backend chat runs,
provider/model selection, context preview, egress metadata, runtime status,
session-scoped continuity capsules, approval-gated tool proposals, pending
approvals, patch artifacts, Mnemonic memory, and external agent runtime paths.
It is not marketed as a complete autonomous IDE.

The dispatcher `@ai` command supports bare prompts and the visible modes
`/chat`, `/plan`, `/debug`, `/build`, and `/review`. Parser aliases `/ask` and
`/general` map to chat behavior.

Show in demo:

- Select a provider and model.
- Preview context before a run.
- Start Chat, Plan, Debug, Build, or Review from AI Chat.
- Start the same flow from `@ai`.
- Review a tool proposal or pending approval.
- Accept a plan into a Build run.
- Trigger linked Review after a Build run when the review surface is large
  enough.
- Preview and apply or reject a patch artifact.
- Show runtime/provider truth rather than only assistant prose.

Demo video: TBD.

## Predictive Autocomplete And Internal Ranking

Current beta status: experimental.

The autocomplete pipeline includes deterministic editor sources and the bundled
internal autocomplete model for ranking. Optional passive editor prediction is
additive to the existing completion path and is guarded by provider, consent,
budget, idle, and stale-response boundaries. Accepting a suggestion remains the
write boundary.

Show in demo:

- Trigger normal editor completion.
- Show ranking behavior in a representative project.
- Show optional passive prediction only when provider/runtime gates are
  configured.

Demo video: TBD.
