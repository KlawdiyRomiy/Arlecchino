# Features And Demos

Status: detailed feature and demo map for the macOS beta.

Use this with the short public map in `FEATURES.md` and the shot list in
`demo-video-scenarios.md`. The rule for recording is simple: show what the
build can actually do, and put the limitation in the same clip when it matters.

## Demo Matrix

| Area | Beta status | Demo use | Scenario |
| --- | --- | --- | --- |
| macOS app launch and install status | Available | Public | `DV-01` |
| Shell, panels, fullscreen, layout | Available | Public | `DV-02` |
| Project open, recent projects, project switching | Available | Public | `DV-03` |
| Editor, diagnostics, hover, signature help, navigation | Available | Public | `DV-04` |
| Command Dispatcher search and routing | Available | Public | `DV-05` |
| Terminal tabs, PTY output, TUI pause, prediction | Available | Public with caveat | `DV-06` |
| Git, Problems, Browser Preview, Markdown Preview, Settings | Available | Public | `DV-07` |
| MCP bridge and approval dialog | Available | Public | `DV-08` |
| AI Chat, provider/model state, consent, tool review | Configured builds only | Public with caveat | `DV-09` |
| Patch artifacts, plan-to-build handoff, linked review | Runtime-dependent | Public with caveat | `DV-10` |
| Predictive autocomplete and local ranker | Experimental | Public with caveat | `DV-11` |
| Auto-update and private release evidence | Internal beta evidence | Internal only | `DV-12` |

## Shell And Project Flow

Show the shell as a workbench: Explorer, Terminal, Git, Problems, Code, Markdown
Preview, and AI Chat around the editor. A good clip opens a project, moves a
panel from snapped to floating, restores it, and returns to the same project
state.

The macOS bridge work is worth showing when the packaged build proves it:
topbar actions, status bar, indexing bubble, native controls, Dock reopen,
single-instance routing, and open intents. If a feature is behind a packaged
smoke path or an env flag, say that in the shot notes instead of presenting it
as default-on.

Project clips should use a clean fixture. Show recent projects, indexing state,
Explorer breadcrumbs, file actions, quick relations, and dependency tree only
where relation data exists. The scanner respects ignore rules and skips heavy
directories; do not claim it scans every file.

## Editor And Search

The editor is CodeMirror 6. Good clips show diagnostics, hover, signature help,
go-to-definition, split editor, completion, minimap, git gutter, and
large-document budget indicators in a real source file.

Keep language-server limits visible. Code actions, auto-import, and workspace
edits are not universal. Workspace edits are constrained; create/rename/delete
resource operations should not be advertised as broadly supported. Search can
fall back to a linear backend, so avoid "full indexed search" unless that
runtime status is proven in the recorded build.

## Dispatcher And Terminal

The dispatcher clip should move quickly through one normal search, one `>`
command, one `>>` file search, one quoted grep query, one `#` symbol search,
one `@t ` terminal command, and one `@ai ` prompt when AI is configured.

For terminal, show a PTY tab, streaming output, terminal search, command
prediction, and TUI pause behavior if the build is stable there. Splits are
fine to show on a clean build. Do not frame terminal close or prediction as a
managed job orchestration system.

## Daily IDE Tools

Good public material here is ordinary IDE work: Git status/history/diff,
Problems filters and scans, Browser Preview navigation and refresh, Markdown
Preview, Settings search, keybinding recording/reset, project opening mode,
Browser Preview link mode, and autocomplete capability matrix.

Git PR behavior is currently compare-URL generation plus browser handoff. Do
not call it an in-app PR review client.

## MCP Bridge

MCP is useful because agents can request IDE state and ask the IDE to open files
or panels. The demo should also show the guardrail: mutating or sensitive bridge
actions go through approval, and a frontend acknowledgement is stronger evidence
than an emitted event.

Do not market MCP as frictionless automation. The product story is approval
based IDE access.

## AI Chat And Tool Review

Record AI only on a build with real provider/runtime status. Show the provider
and model picker, consent where needed, context preview, run metadata, a tool
proposal, pending approval, and a patch artifact on a safe fixture.

Useful flows:

- Chat or Plan from the AI panel.
- `@ai` from the dispatcher.
- Accept Plan into Build.
- Preview, apply, reject, or roll back a patch artifact.
- Run linked Review only when the Build run produced a reviewable artifact.

Keep the caveat close to the demo. Provider setup, model capability, consent,
and runtime status decide which modes work. Remote BYOK is not a generic setup
path for every AI task. Background agents remain preview-only. Do not show
secrets, real credentials, private tokens, private project data, or sensitive
terminal output.

## Autocomplete And Ranker

Completion combines deterministic editor sources, language tooling, and the
bundled local ranker. Passive prediction is separate and gated by AI settings,
provider readiness, consent, idle budget, and stale-response checks.

Show normal completion first. Then show ranking on a small fixture. Show
passive prediction only when provider readiness is visible.

The bundled model ranks candidates. It is not a generative code model.

## Release And Update Evidence

Current release tooling can produce macOS tester artifacts and internal update
evidence. Public clips should stop at the DMG install path and the current
unsigned/not-notarized state. Developer ID signing and notarization will be
added soon, with no date committed.

Keep private updater footage internal while releases still depend on private
GitHub access. Useful internal evidence: installed-app smoke report, release
smoke report, private updater smoke, and manifest verification tests.
