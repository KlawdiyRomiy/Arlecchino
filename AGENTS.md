# AGENTS.md — Arlecchino

## What this is

Arlecchino is a macOS desktop IDE: a Go/Wails backend and a React/TypeScript frontend in one repository. Direct user instructions override this file; a nested `AGENTS.md` overrides it for its subtree. Long architecture notes belong in `docs/`, not here.

The Arle terminal agent and the Arlecchino MCP server are the other two sides of the shared `.arlecchino/bootstrap.json` contract. When a change crosses that boundary they are integration evidence: read them, and do not edit them without an explicit cross-repository request.

## Invariants

1. **Generated artifacts are generated.** `frontend/bindings/**` and `frontend/wailsjs/**` are never hand-edited while a regeneration flow exists, and regeneration happens only through the checked-in flow after explicit approval. Review generated diffs as their own surface — do not mix that churn into a hand-written change.
2. **The worktree is user-owned.** It is routinely dirty with the user's work. Never revert, clean, or blanket-stage. Staging is file- or hunk-specific, after explicit commit approval, proven with `git diff --cached --name-only` and `git diff --cached --check`.
3. **Contract boundaries preserve their failure paths.** On LSP/DAP, Tree-sitter, terminal PTY/TUI, Wails/runtime bridge, indexer, autocomplete/ARLE brain, MCP, workspace state, and window/panel hosting: identify the contract being changed, then preserve cancellation, cleanup, error propagation, and stale-state handling. An accepted bridge event is not confirmed frontend handling — do not report it as one.
4. **AI-run history separates by origin.** `user_request`, `user_follow_up`, `workflow_instruction`, `steer`, and `tool_continuation` differ in visibility, storage, and model serialization. Hiding a synthetic bubble in the UI is not enough — the same text still pollutes model history as role `user`.
5. **No silent type escapes.** `as any`, `@ts-ignore`, and `@ts-expect-error` need an unavoidable, documented cause. A failing test is fixed, never deleted or weakened to make a suite pass.
6. **Secrets never land.** No credentials, API keys, OAuth tokens, or cookies in files, logs, screenshots, prompts, or answers.
7. **The package manager is the one in the lockfile.** Do not switch it.

## Code map

| Path | Owns |
|---|---|
| root `*.go`, `internal/**` | Go application, Wails bindings, backend services |
| `frontend/src/**` | React/TypeScript source |
| `frontend/tests/**`, `frontend/test-scripts/**` | specs and test helpers |
| `frontend/bindings/**`, `frontend/wailsjs/**` | generated — regeneration-owned |
| `scripts/` | checked-in build, dev, release, and signing flows |
| `docs/` | architecture notes — **gitignored**, so an artifact written here will not appear in `git status` |

High-sensitivity: editor surfaces, Wails/runtime bridge, terminal PTY/TUI, LSP/DAP, Tree-sitter, indexer, autocomplete/ARLE brain, MCP, workspace state, release packaging and signing.

## Checks

Focused by default. Broad installs, full suites, bootstrap flows, and long-running dev servers need an explicit reason or approval.

| Change area | Command |
|---|---|
| Go | `gofmt -w <file>`, `go test ./<package>`, `go vet ./<package>` |
| Frontend types (from `frontend/`) | `npm run typecheck` |
| Frontend surface | the closest contract spec under `frontend/tests/**` |
| Wails v3 dev launch | `./scripts/wails3-dev-macos.sh` — `--build-only` for a narrow build confirmation |

Discover other commands from checked-in scripts and package manifests rather than a copied list. For a visible UI regression, get runtime or browser evidence when feasible instead of guessing repeatedly from static code — and do not claim screenshot/DOM QA that no available tool performed. For packaged-app performance, separate installed `.app` behavior from dev churn in `frontend/dist` and from FileProvider/iCloud activity.

## Bug fixes

Characterize the bug with the narrowest practical check, fix the root cause rather than the symptom, and prove it with the closest passing test.

## UI defaults

Preserve the existing desktop IDE language unless redesign is explicitly requested: dense and work-focused, not marketing layout. Visible loading, empty, and error states; adequate hit targets; honest cancel paths.

## Ask first

Dependencies; schema, persistence, public API, generated binding, or MCP contract changes; build, release, CI, signing, or notarization config; regenerating generated artifacts; deleting or moving files; full builds, full suites, bootstrap flows, long-running dev servers; any git write operation.
