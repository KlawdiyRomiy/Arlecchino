# AGENTS.md

## Purpose

- This file defines repository-local instructions for agents working in Arlecchino.
- Keep it short, executable, and specific to this repo. Put long architecture notes in `docs/`.
- Direct user instructions override this file. More specific nested `AGENTS.md` files override this file for their subtree.

## Project Map

- Arlecchino is a desktop IDE with a Go/Wails backend and a React/TypeScript frontend.
- Go application and Wails bindings live mostly in root `*.go` files and `internal/**`.
- Frontend source lives in `frontend/src/**`; frontend specs and test helpers live in `frontend/tests/**` and `frontend/test-scripts/**`.
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

For non-trivial Arlecchino changes, especially in high-sensitivity areas, identify the affected contract or event path and the closest verification path before editing.

## Capability Routing

- Prefer project-native commands and checked-in scripts before generic workflows.
- Use tool discovery, skills, plugins, MCP servers, or configured connectors only when they are available in the current agent environment.
- For unfamiliar or fast-moving external APIs, use an available documentation/context lookup before coding from memory.
- For visible UI regressions, use an available browser/app automation, screenshot-based check, or direct app smoke check when feasible.
- For issue, PR, review, CI, deployment, or observability work, use the relevant configured connector when available; otherwise fall back to local commands and clearly report the fallback.
- For Arlecchino runtime behavior, prefer live IDE/runtime capability discovery when available, and distinguish accepted bridge events from confirmed frontend handling.
- Do not require a specific Codex plugin, MCP server, browser runner, or third-party integration for contributors who do not have that tool installed.

## Verification And Commands

- Discover project commands from checked-in scripts, package manifests, and nearby docs.
- Use the package manager implied by the checked-in lockfile; do not switch package managers without explicit approval.
- Prefer focused package, file, or surface checks over broad suites.
- Use broad installs, builds, full test suites, or long-running dev servers only when explicitly requested or genuinely required.
- Keep personal or tool-specific command playbooks out of this tracked file; agents may keep those in their own private instruction layer.

## Ask First

- Add, remove, or upgrade dependencies.
- Change schemas, persistence contracts, public APIs, generated binding contracts, or MCP protocol contracts.
- Modify build config, release config, CI config, signing/notarization config, or environment contracts.
- Regenerate generated artifacts when a regeneration flow exists.
- Delete or move files.
- Run full builds, full test suites, bootstrap/install flows, or long-running dev servers.
- Perform git write operations: `git add`, `commit`, `push`, `pull`, `merge`, `rebase`, branch creation, or tag creation.

## Precise Commit Policy

- Commit only when the user explicitly asks for a git write operation or approves it.
- Before staging, inspect `git status` and the relevant diff; identify unrelated or user-owned changes and keep them out of the commit.
- Stage the smallest coherent change. Prefer file-specific or hunk-specific staging over blanket staging, especially in a dirty worktree.
- If the requested scope is thematic, such as "only panel fixes", stage by behavior and ownership, not just by filename.
- Do not include generated artifacts, dependency lockfiles, formatting churn, or broad rewrites unless they are required for the requested change and were inspected.
- Use a concise, imperative commit subject that names the behavior changed, for example `fix terminal focus shortcut routing`; avoid vague names such as `updates`, `fixes`, or `wip` unless the user requests them.
- Run the narrowest relevant verification before committing when practical. If verification is skipped or blocked, say so in the commit report.
- After committing, report the commit hash, files included, checks run, and any remaining unstaged or untracked work.

## Generated Artifacts

- Do not hand-edit `frontend/bindings/**` or `frontend/wailsjs/**` when a regeneration flow exists.
- Regenerate generated bindings only through the checked-in generation flow after explicit user approval.
- Treat generated binding diffs as separate review surface; inspect churn before mixing them with hand-written code changes.

## Workspace Cleanliness

- Keep scratch files, investigation output, screenshots, and generated experiments out of the repo unless they are explicit deliverables.
- Use temporary locations outside the repo for disposable artifacts and remove them when finished.
- Do not leave dead code, unused files, unnecessary folders, or cleanup-only churn behind after a task.

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
- For visible UI changes, verify with the closest available browser/app automation, screenshots, or a direct app smoke check when feasible.

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
