# Arlecchino Features And Demos

Status: public feature map for the current beta.

This page describes the public feature set and links to recorded demos.

Current release: macOS open beta, not GA, not stable, not Developer ID signed,
and not notarized. Windows and Linux are planned targets, but they are not
current release platforms.

## Desktop Workbench

Arlecchino opens as a desktop workbench, not a landing page. The app keeps the
project visible while panels move around it: Explorer, Terminal, Git, Problems,
Preview, and Settings can be opened, snapped, floated, restored, and reused
across a project session.

The current public build also includes macOS integrations for menus,
fullscreen, window controls, credential storage, single-instance routing, open
intents, and Dock reopen behavior. Cross-platform support remains in
development.

Recorded demos:

- [Panel shortcuts](demo-videos/desktop-workbench-panel-shortcuts.mp4) — open
  and switch the main workbench panels from the top bar.
- [Project switching and windows](demo-videos/desktop-workbench-project-switching.mp4)
  — create, switch, and reopen project workspaces.

## Perspective Mode And Quick Navigation

Perspective Mode is the project-navigation layer around files and definitions.
From Explorer, `Cmd+Click` on a file opens the full Dependency Tree. `Option+Click`
on a file opens the mini Quick Relations menu for a faster local view. In the
editor, `Cmd+Click` / `Ctrl+Click` opens a definition, while `Option+Click`
opens a Quick Look Definition preview without leaving the current file.

Recorded demo:

- [Dependency Tree](demo-videos/perspective-dependency-tree.mp4) — inspect
  project references and jump between related files.

## Command Dispatcher

`Cmd+Shift+F` opens the main dispatcher. From one input you can run ordinary
search, IDE commands, file search, grep, symbol search, terminal dispatch, and
AI dispatch.

Recorded demo:

- [Global search and command dispatcher](demo-videos/command-dispatcher.mp4)
  — find code, then switch to the command namespace with `>`.

## Editor And Code Intelligence

The editor is CodeMirror 6 with language tooling around it: diagnostics, hover,
signature help, split views, dependency views, navigation, deterministic
completion, guarded apply/resolve paths, and ghost text where available.

Recorded demos:

- [Split views and code panels](demo-videos/editor-split-views.mp4) — keep
  several files visible while navigating source code.
- [Go to Definition and Quick Look](demo-videos/editor-go-to-definition-and-quick-look.mp4)
  — jump to a definition or inspect it without replacing the current editor.

## Built-In IDE Tools

The beta includes the daily project tools: Explorer, Problems, Git, Browser
Preview, Markdown Preview, terminal, Code panel, Settings, status, and
multi-project switching. Markdown links open in the system browser by default.

Git PR behavior is currently a compare-URL/browser handoff, not a built-in PR
review client.

Recorded demos:

- [Git and Problems](demo-videos/ide-tools-git-and-problems.mp4) — inspect
  source-control state, diffs, and project diagnostics.
- [Markdown and Browser Preview](demo-videos/ide-tools-markdown-and-browser-preview.mp4)
  — preview a Markdown document and a web page inside the workbench.
- [Settings](demo-videos/ide-tools-settings.mp4) — adjust appearance and
  inspect the available configuration surfaces.

## MCP Integration

Arlecchino includes an MCP server so external coding agents can request IDE
state and ask the app to open files or panels. Mutating and sensitive actions
remain approval-based.

## AI Chat And Tool Review

AI Chat is available when a provider, model, runtime, and consent path are
configured. It supports provider/model selection, context preview, run metadata,
tool proposals, pending approvals, patch artifacts, Mnemonic memory, and the
external agent runtime path.

The dispatcher also accepts `@ai` prompts and the visible modes `/chat`,
`/plan`, `/debug`, `/build`, and `/review`.

Recorded demo:

- [@t and @ai dispatcher prefixes](demo-videos/ai-chat-and-terminal-prefixes.mp4)
  — route a command to the terminal or start an AI Chat request.

## Deterministic Completion And Local Ranking

Completion combines deterministic editor sources, LSP, local/indexed symbols,
guarded apply/resolve behavior, and the bundled local ranker. Optional passive
prediction is separate from normal completion and is guarded by provider,
consent, budget, idle, and stale-response checks.

The bundled model ranks candidates. It is not a generative code model.
