# AGENTS.md

## Purpose

- This file defines a short, executable policy for agents working in this repository.
- Keep it practical. Prefer rules that change behavior over long background explanations.

## Priority Order

1. Safety, tool reality, and ask-first boundaries.
2. Direct user instructions.
3. Default mode: one-shot complete implementation.
4. Verification before claiming success.
5. Style and local conventions.

If rules conflict:

- prefer available tools over unavailable tools;
- prefer narrow checks over heavy full-suite runs;
- ask one short question only when ambiguity changes the outcome.

## Commands

### Prefer narrow, file-scoped commands

```bash
# Go
go fmt ./path/to/file.go
go test ./path/to/package/...
go test -run TestName ./path/to/package/...
go vet ./path/to/package/...

# Frontend
npx prettier --check "path/to/file.tsx"
npx prettier --write "path/to/file.tsx"
npx playwright test path/to/test.spec.ts
```

### Full project commands (ask first or use only when clearly necessary)

```bash
# Go
go test ./...
go vet ./...
go fmt ./...

# Frontend
npm run dev
npm run build
npm test
npx prettier --check "**/*.{js,ts,tsx,md}"
```

Rule: prefer fast, scoped commands. Use broad builds or full suites only when explicitly requested or when broad verification is genuinely needed.

## Default Mode: One-Shot

- If the task is clear and local, complete it in one implementation pass.
- Read the relevant files and existing patterns first.
- Make the smallest complete change that solves the task end-to-end.
- Do not stop at scaffolding when the remaining work is obvious and feasible now.
- Do not leave TODO-only patches, placeholders, or half-wired behavior.
- Do not report success without relevant verification.

### One-shot means

- one finished diff, not a chain of partial edits;
- functional completeness, not setup-only work;
- minimal scope, not speculative architecture;
- verification before the final answer.

## Execution Flow

1. Read the relevant files and inspect nearby existing patterns.
2. Check whether the task falls under `Ask First`.
3. If the task is clear, implement it directly.
4. If the task is non-trivial, make a short plan and proceed.
5. Run the narrowest relevant checks.
6. Report briefly: what changed, what was verified, what risks remain.

## Ask First

- Add, remove, or upgrade dependencies.
- Change schemas, persistence contracts, or public APIs.
- Modify build config, release config, CI config, or environment contracts.
- Regenerate generated artifacts when a regeneration flow exists.
- Delete or move files.
- Run full build or full test suites.
- Perform git write operations (`git add`, `commit`, `push`, `pull`, `merge`, `rebase`).

## Never Do

- Edit generated artifacts manually if a regeneration path exists.
- Touch dependency directories, vendor directories, or `.git/`.
- Add secrets, credentials, API keys, or tokens to the repo.
- Use `as any`, `@ts-ignore`, or `@ts-expect-error` without unavoidable, documented cause.
- Delete failing tests just to make the suite pass.
- Invent APIs or guess external signatures when docs or source are available.
- Ignore error handling where validation or propagation is needed.
- Leave partial implementation when the task can be finished now.
- Claim completion without relevant verification.

## Bug Fix Rule

- When a user reports a bug, reproduce it with the narrowest practical check when possible.
- Fix the root cause, not just the symptom.
- Prove the fix with the closest passing test or focused verification.

## Tool Preferences

- Prefer dedicated file and search tools over ad-hoc shell pipelines.
- Prefer file-scoped and package-scoped commands over repo-wide commands.
- Use documentation tools for unfamiliar or fast-moving external APIs.
- Use browser or UI automation tools for visible regressions when available.
- Use subagents only for self-contained side investigations, not by default.

## Verification

- Always run the narrowest relevant checks for the touched files or packages.
- For frontend changes, run formatting or type checks on changed files when practical.
- For visible UI changes, verify with screenshots, automation, or a direct smoke check when feasible.
- For backend or protocol changes, verify the closest affected package or user-facing path.
- In the final response include:
  - files changed;
  - what was verified;
  - any remaining risks or unverified areas.

## Communication Style

- Respond in the user's language unless they ask otherwise.
- Be direct, concise, and factual by default.
- Explain more only when the task is risky, subtle, or the user asks for detail.
- Avoid filler and ceremony.
- Prefer self-documenting code; add comments only when they genuinely reduce ambiguity.

## Code Style Defaults

- Keep diffs minimal and localized to the task.
- Prefer existing repository patterns before introducing new abstractions.
- Write deterministic code and avoid speculative architecture.
- Think about edge cases, performance, and security, but do not expand scope without need.
- Preserve strict typing where the project uses it.

## UI Defaults

- Prefer clear interactions, visible loading states, large enough hit targets, and honest cancel paths.
- Preserve the existing product style unless the user explicitly asks for redesign.

## Permissions And Integrations

- Prefer official OAuth-backed integrations over copied bearer tokens when supported.
- Treat external services and MCP servers as privileged integrations.
- Do not lower sandbox or approval discipline just to make something work.
- Keep secrets out of repo files, logs, screenshots, and final reports.
