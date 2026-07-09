# Arlecchino Features And Demos

Status: public feature map for the current beta.

This page is the public feature and future demo-video map. Keep video links,
recording status, scenario IDs, and short caveats here so GitHub visitors can
see what each feature is meant to demonstrate without reading internal notes.

Current release: macOS open beta, not GA, not stable, not Developer ID signed,
and not notarized. Windows and Linux are planned targets, but they are not
current release platforms. Developer ID signing and notarization will be added
soon; no date is committed yet.

## Desktop Workbench

Arlecchino opens as a desktop workbench, not a landing page. The app keeps the
project visible while panels move around it: Explorer, Terminal, Git, Problems,
Preview, and Settings can be opened, snapped, floated, restored, and reused
across a project session.

The current public build also has macOS bridge work for menus, fullscreen,
window controls, credential storage, single-instance routing, open intents, and
Dock reopen behavior. Treat that as current macOS beta behavior, not as a
finished cross-platform claim or a macOS-only product identity.

Good demo material:

- Install and launch the app from the DMG.
- Show the Gatekeeper warning if it appears.
- Move a panel from snapped to floating and back.
- Switch between Explorer, Terminal, Git, and Problems.
- Reopen a project and show that the workbench state comes back.
- Use a project/file open intent only on a packaged build where that path has
  passed smoke.

Demo scenarios: `DV-01`, `DV-02`, `DV-03`.

## Perspective Mode And Quick Navigation

Perspective Mode is the project-navigation layer around files and definitions.
From Explorer, `Cmd+Click` on a file opens the full Dependency Tree. `Option+Click`
on a file opens the mini Quick Relations menu for a faster local view. In the
editor, `Cmd+Click` / `Ctrl+Click` opens a definition, while `Option+Click`
opens a Quick Look Definition preview without leaving the current file.

Good demo material:

- `Cmd+Click` a source file in Explorer and show the Dependency Tree.
- Click a file or symbol inside the Dependency Tree and jump back into code.
- `Option+Click` a source file in Explorer and show the compact Quick Relations
  menu.
- Filter or choose a relation from the mini menu.
- In the editor, `Option+Click` a definition candidate and show the Quick Look
  preview.
- Expand the Quick Look preview into a real editor tab only if the recording
  build handles that path cleanly.

Demo scenarios: `DV-03`, `DV-04`.

## Command Dispatcher

`Cmd+Shift+F` opens the main dispatcher. From one input you can run ordinary
search, IDE commands, file search, grep, symbol search, terminal dispatch, and
AI dispatch.

Good demo material:

- Search normally.
- Run an IDE command with `>`.
- Search files with `>>`.
- Search text with a quoted query.
- Search symbols with `#`.
- Send a terminal command with `@t `.
- Send an AI prompt with `@ai ` if AI is configured.
- Show a TUI-aware terminal case only on a build where the pause behavior is
  stable.

Demo scenarios: `DV-05`, `DV-06`.

## Editor And Code Intelligence

The editor is CodeMirror 6 with language tooling around it: diagnostics, hover,
signature help, split views, dependency views, navigation, deterministic
completion, guarded apply/resolve paths, and ghost text where available.

Good demo material:

- Open a real source file.
- Trigger diagnostics, hover, signature help, and completion.
- Navigate to a definition on a language server that is already installed.
- Use `Option+Click` on a definition candidate to show Quick Look Definition
  without replacing the current editor tab.
- Show Explorer relations or a dependency tree on a fixture that actually has
  relation data.
- If you show several languages, verify those adapters in the demo project
  first.

Avoid calling this Monaco-based. Avoid implying JetBrains parity, universal
refactoring, or universal code actions; those depend on the language server and
project state.

Demo scenarios: `DV-04`, `DV-11`.

## Built-In IDE Tools

The beta includes the daily project tools: Explorer, Problems, Git, Browser
Preview, Markdown Preview, terminal, Code panel, Settings, status, and
multi-project switching.

Good demo material:

- Inspect Problems.
- Review Git status, history, branches, stash actions, and diffs.
- Split a terminal pane, search output, and accept a command prediction.
- Open Browser Preview, Markdown Preview, Code panel, and Settings.
- Search settings, record/reset a keybinding, and show Browser Preview link
  mode.

Git PR behavior is currently a compare-URL/browser handoff, not a built-in PR
review client.

Demo scenarios: `DV-03`, `DV-06`, `DV-07`.

## MCP Integration

Arlecchino includes an MCP server so external coding agents can request IDE
state and ask the app to open files or panels. Mutating and sensitive actions
remain approval-based.

Good demo material:

- Let an external agent read IDE state.
- Open a file or panel through the bridge.
- Trigger a sensitive action and show the approval dialog.
- If the clip needs proof, show the frontend ack after the event is accepted.

Do not market MCP as frictionless automation. The point is approved access, not
bypassing the user.

Demo scenario: `DV-08`.

## AI Chat And Tool Review

AI Chat is available when a provider, model, runtime, and consent path are
configured. It supports provider/model selection, context preview, run metadata,
tool proposals, pending approvals, patch artifacts, Mnemonic memory, and the
external agent runtime path.

The dispatcher also accepts `@ai` prompts and the visible modes `/chat`,
`/plan`, `/debug`, `/build`, and `/review`.

Good demo material:

- Pick a provider and model.
- Preview context before a run.
- Run Chat, Plan, Debug, Build, or Review.
- Review a tool proposal.
- Turn an accepted plan into a Build run.
- Preview, apply, or reject a patch artifact on a safe fixture.
- Show runtime/provider state instead of relying only on assistant prose.

Do not imply every provider/model supports every mode. Remote BYOK is not a
generic setup path for every AI task.

Demo scenarios: `DV-09`, `DV-10`.

## Deterministic Completion And Local Ranking

Completion combines deterministic editor sources, LSP, local/indexed symbols,
guarded apply/resolve behavior, and the bundled local ranker. Optional passive
prediction is separate from normal completion and is guarded by provider,
consent, budget, idle, and stale-response checks.

Good demo material:

- Trigger normal completion.
- Type an access operator on a known object or module and show member
  completion, typed narrowing, and safe acceptance on a small fixture.
- Show ranking only where the source and language-server behavior are stable.
- Show passive prediction only when the provider/runtime gates are visible.

The bundled model ranks candidates. It is not a generative code model.

Demo scenario: `DV-11`.
