# AGENTS.md

## Purpose

- This file defines repository-local instructions for agents working in Arlecchino.
- Keep it short, executable, and specific to this repo. Put long architecture notes in `docs/`.
- Direct user instructions override this file. More specific nested `AGENTS.md` files override this file for their subtree.

## Project Map

- Arlecchino is a desktop IDE with a Go/Wails backend and a React/TypeScript frontend.
- Go application and Wails bindings live mostly in root `*.go` files and `internal/**`.
- Frontend source lives in `frontend/src/**`; Playwright tests live in `frontend/tests/**`.
- Generated client artifacts live in `frontend/bindings/**` and `frontend/wailsjs/**`.
- High-sensitivity areas: editor surfaces, Wails/runtime bridges, terminal PTY/TUI flows, LSP/DAP, Tree-sitter, indexer, autocomplete/ARLE brain, MCP, workspace state, and release packaging.

## Priority Order

1. Safety, secrets, sandboxing, and user-owned worktree changes.
2. Direct user instructions.
3. Repo-local generated-artifact and API/persistence contracts.
4. Smallest complete implementation.
5. Narrow verification before claiming success.
6. Style and local conventions.

If rules conflict:

- prefer available tools over unavailable tools;
- prefer the closest repo-local instruction file;
- prefer narrow checks over broad suites;
- ask one short question only when ambiguity changes the outcome.

## Default Workflow

1. Read relevant files and nearby patterns before editing.
2. Search with `rg` / `rg --files` before broad file reads.
3. Check whether the work falls under `Ask First`.
4. Make the smallest complete change that solves the request end-to-end.
5. Run the narrowest relevant checks.
6. Report files changed, checks run, and any unverified risk.

Do not stop at scaffolding, TODO-only patches, placeholders, or half-wired behavior when the remaining implementation is obvious and feasible.

## Commands

### Setup And App Run

Use these only when needed for the task. Ask first before broad install/build/dev-server flows unless the user explicitly requested them.

```bash
./scripts/bootstrap-dev-macos.sh
./scripts/wails-dev-macos.sh
./scripts/wails-build-macos.sh
```

### Go: Prefer Narrow Package Checks

```bash
gofmt -w path/to/file.go
go test -run TestName ./path/to/package
go test ./path/to/package
go vet ./path/to/package
```

Examples:

```bash
go test -run TestName .
go test ./internal/indexer/brain
go test ./internal/indexer/lsp
go test ./internal/terminal
```

### Frontend: Run From `frontend/`

The frontend uses `npm` and `package-lock.json`. Do not switch package managers without explicit approval.

```bash
cd frontend && npm run typecheck
cd frontend && npx prettier --check src/path/to/file.tsx
cd frontend && npx prettier --write src/path/to/file.tsx
cd frontend && npx playwright test tests/path/to/test.spec.ts
cd frontend && node test-scripts/surface-runtime-contracts.test.mjs
```

### Broad Checks: Ask First

```bash
go test ./...
go vet ./...
go fmt ./...
cd frontend && npm run build
cd frontend && npm run test:smoke
cd frontend && npx prettier --check "**/*.{js,ts,tsx,md}"
```

## Ask First

- Add, remove, or upgrade dependencies.
- Change schemas, persistence contracts, public APIs, generated binding contracts, or MCP protocol contracts.
- Modify build config, release config, CI config, signing/notarization config, or environment contracts.
- Regenerate generated artifacts when a regeneration flow exists.
- Delete or move files.
- Run full builds, full test suites, bootstrap/install flows, or long-running dev servers.
- Perform git write operations: `git add`, `commit`, `push`, `pull`, `merge`, `rebase`, branch creation, or tag creation.

## Generated Artifacts

- Do not hand-edit `frontend/bindings/**` or `frontend/wailsjs/**` when a regeneration flow exists.
- For Wails v3 generated bindings, use `./scripts/wails3-generate-bindings.sh`.
- Only write Wails v3 bindings with `./scripts/wails3-generate-bindings.sh --write` after user approval.
- Treat generated binding diffs as separate review surface; inspect churn before mixing them with hand-written code changes.

## Never Do

- Touch dependency directories, vendor directories, build output, caches, or `.git/` unless explicitly requested.
- Add secrets, credentials, API keys, OAuth tokens, cookies, or local credentials to files, logs, screenshots, prompts, or final responses.
- Use `as any`, `@ts-ignore`, or `@ts-expect-error` without unavoidable, documented cause.
- Delete or weaken failing tests just to make a suite pass.
- Invent external API signatures when docs or source are available.
- Ignore validation, cancellation, cleanup, or error propagation on protocol/runtime boundaries.
- Revert, overwrite, or clean up user changes you did not make.
- Claim completion without relevant verification.

## High-Sensitivity Contracts

When touching LSP, DAP, Tree-sitter, terminal PTY/TUI, preview/runtime bridges, indexing, autocomplete, MCP, or workspace state:

- identify the contract being changed;
- preserve failure paths, cancellation, cleanup, and stale-state handling;
- add or update the closest focused test when practical;
- run the closest package/test-script verification.

## Bug Fix Rule

- Reproduce or characterize the bug with the narrowest practical check when possible.
- Fix the root cause, not only the symptom.
- Prove the fix with the closest passing test or focused verification.

## UI Defaults

- Preserve the existing desktop IDE style unless the user explicitly asks for redesign.
- Prefer dense, clear, work-focused UI over marketing-style layouts.
- Use visible loading/empty/error states, large enough hit targets, and honest cancel paths.
- For visible UI changes, verify with focused Playwright, screenshots, or a direct browser/app smoke check when feasible.

## Code Style Defaults

- Keep diffs minimal and localized.
- Prefer existing repository patterns before introducing new abstractions.
- Keep TypeScript strict and Go idiomatic.
- Prefer deterministic behavior over hidden state or timing assumptions.
- Add comments only when they reduce real ambiguity.

## Communication

- Respond in the user's language unless asked otherwise.
- Be direct, concise, and factual.
- Explain more only when the task is risky, subtle, or the user asks for detail.
- Final responses should include files changed, checks run, and remaining risks or unverified areas.
