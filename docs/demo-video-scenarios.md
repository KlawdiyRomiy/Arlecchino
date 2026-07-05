# Demo Video Scenarios

Status: working storyboard for the macOS beta.

Use this file as the recording plan. Keep the clips honest: show the build that
is actually running, keep private paths out of frame, and do not imply that a
gated or private updater path is already public.

## Recording Rules

- Record on macOS.
- Use a clean fixture project. No customer code, private tokens, `.env` files,
  browser cookies, Keychain details, or private release URLs on screen.
- Current builds are not Developer ID signed or notarized. Say that plainly.
  Developer ID and notarization will be added soon, with no date committed.
- Keep private GitHub updater footage internal unless the narration calls it
  private tester evidence.
- For the main public video, prefer one continuous workflow over a feature
  montage.

## Pre-Record Checks

Run only the checks needed for the build in the video:

```bash
./scripts/wails3-installed-app-smoke-macos.sh --app-bundle /Applications/Arlecchino.app --report /tmp/arlecchino-installed-smoke.json
go test -run 'Test.*AutoUpdate' ./internal/app
```

For a release-candidate clip:

```bash
./scripts/wails3-release-smoke-macos.sh --report /tmp/arlecchino-release-smoke.json
```

Before public recording, scan for visible local/private data:

```bash
rg -n '/Users/klawdiy|/tmp/Arlecchino-wails-build|github-release-token|ARLECCHINO_GITHUB_TOKEN|KlawdiyKlowerson@gmail.com' README.md FEATURES.md PRIVACY.md release-notes docs scripts build internal wails.json
```

Keep reports outside the repo.

## Primary Public Demo

Target length: 4 to 6 minutes.

### DV-01 Launch And Beta Status

Open `/Applications/Arlecchino.app`. If macOS shows a Gatekeeper warning, leave
it in the recording instead of cutting around it. The narration should be short:

Arlecchino is a macOS open beta. This build is not Developer ID signed or
notarized yet. Developer ID and notarization will be added soon, but there is
no date to announce.

### DV-02 Workbench Shell

Start from the empty shell or a small fixture project. Open Explorer, Terminal,
Git, Problems, and Markdown Preview. Float a panel, snap it, fullscreen it, and
bring it back. If the build has stable topbar actions, status bar indexing, or
zen chrome reveal, show them in the same flow.

Point to the workbench, not to decoration: the useful thing here is that project
surfaces stay close to the editor.

### DV-03 Project Flow

Open a local demo folder. Show the recent-project entry, reopen the project, and
switch to a second clean fixture if one is prepared. Let indexing finish or show
the progress state. Use Explorer breadcrumbs, quick relations, or the dependency
tree only on files where relation data is already present.

Say that project scanning is local and respects ignore rules. Do not claim every
file in the tree is indexed.

### DV-04 Editor Intelligence

Open a real source file. Show diagnostics, hover, signature help,
go-to-definition, split editor, completion, minimap, git gutter, and
large-document budget indicators where they are visible.

Keep the wording tied to the active language server. This is code intelligence
for configured languages, not universal refactoring.

### DV-05 Command Dispatcher

Open the dispatcher with `Cmd+Shift+F`. Run one normal search, one `>` command,
one `>>` file search, one quoted grep search, one `#` symbol search, one safe
`@t ` terminal command, and one `@ai ` prompt if AI is configured.

The dispatcher is worth showing because it routes work without making the user
switch tools.

### DV-06 Terminal

Create a terminal tab, run a safe command, show streaming output, search inside
the terminal, and show command prediction. If TUI handling is stable in the
build, enter a TUI command and show that dispatcher behavior changes. Add split
panes only if that path is clean on the recording build.

Do not frame this as a managed job system. It is terminal assistance.

### DV-07 Daily IDE Tools

Move quickly through Problems, Git status, Git diff, Browser Preview, Markdown
Preview, Settings search, keybinding recording/reset, Browser Preview link
mode, and the autocomplete capability matrix.

This section should feel like normal IDE work. Avoid dashboard-style narration.

### DV-08 MCP Approval Boundary

Show MCP settings or status, let an external agent request IDE state, then
trigger one bridge-control action that requires approval. Approve a temporary
session and show the resulting UI action. If the video needs proof, show the
acknowledgement after the frontend handles the request.

The message is simple: MCP gives agents a way into the IDE, but approval stays
visible.

### DV-09 AI Chat

Open AI Chat, choose a provider/model, show consent if needed, preview context,
and run Chat or Plan. Show the run envelope, context or egress indicators,
runtime status, artifacts, or pending approvals if they are available in the
fixture.

Do not sell it as magic. AI output depends on provider setup, model capability,
runtime status, and consent.

### DV-10 Tool Review And Patch Artifact

Use a safe fixture. Start a Build run, show a proposed tool call or patch,
preview it, and apply only after approval. Show rollback or checkpoint behavior
if that path exists for the fixture. If the Code panel patch flow is cleaner for
the clip, use preview/apply/reject/rollback there.

The important moment is the write boundary: the app shows what would change
before it changes files.

### DV-11 Autocomplete And Ranker

Trigger normal completion, then show ranking in a small source file. Show
passive prediction only when provider readiness is visible.

The bundled model ranks candidates. It is not a generative code model.

## Internal-Only Demo

### DV-12 Update Evidence

Record this only for internal release checks. Show the installed-app smoke
report, private updater status if needed, manifest verification, and
install-and-relaunch on a disposable tester build.

This is not public no-auth updater copy while the repo and release path still
need private GitHub access.

## Short Demo Cut

Target length: 60 to 90 seconds.

Sequence:

1. Launch shell.
2. Open project.
3. Show editor diagnostics and completion.
4. Use Command Dispatcher.
5. Run terminal command.
6. Show Git diff.
7. Open AI Chat provider/model picker.
8. Show MCP approval dialog.

End card copy:

macOS open beta. Local-first workbench. AI and MCP with visible approval.
Developer ID signing and notarization will be added soon.
