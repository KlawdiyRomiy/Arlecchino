# Open Beta Release Preparation Plan

Status: internal execution plan for the public open beta.
Date: 2026-05-22.

This document captures the release-prep plan for opening Arlecchino as a public
beta. It is not public-facing release copy and not a substitute for release
notes. Treat it as the execution map for the next implementation pass.

## Objective

Prepare Arlecchino for an open beta release by removing private GitHub update
coupling, making the documentation truthful and navigable, preventing local
machine/path leakage in installed builds, and producing a promotion and demo
plan grounded in the product that actually ships.

## Release Contract

- Keep the beta honest: macOS-first, local-first desktop IDE beta with integrated
  AI assistance, MCP control, and approval-gated agent surfaces.
- Do not describe the beta as GA/stable, notarized, or a finished autonomous AI
  IDE.
- Keep the update trust model: HTTPS plus SHA256 plus pinned Ed25519 signature.
- Remove the public requirement for private GitHub tokens and Keychain release
  access.
- Do not publish artifacts that expose `/Users/klawdiy`, local host paths,
  personal build metadata, private release URLs, or private repo assumptions.
- Keep Apple Developer ID and notarization explicitly absent; they are not
  planned for this beta line yet.

## Current High-Risk Anchors

### Private GitHub / Updater Coupling

- `auto_update_private_github.go` hardcodes the GitHub owner/repo and private
  release-token model.
- `auto_update_runtime.go` still points manual release fallback at the current
  GitHub release URL and supports `github-release://` manifest sources.
- `scripts/wails3-github-release-macos.sh` builds GitHub release artifacts,
  uses `gh` auth for publishing, and records token-backed GitHub asset API URLs
  for update manifests.
- `scripts/wails3-private-updater-live-smoke-macos.sh` proves the private update
  path, not the public no-auth path.
- `frontend/src/shell/autoUpdate.ts`,
  `frontend/src/shell/manualUpdateNotifications.ts`, and
  `frontend/src/components/SettingsModal.tsx` expose private update defaults or
  private release access UI.
- Release checklist docs must keep the beta release path and legacy updater
  manifest bridge explicit.

### Local Path / Host Leakage

- `build_info.go` serializes `bundlePath`, absolute `executablePath`, and
  update manifest URL through `GetBuildInfo()`.
- `auto_update_runtime.go` can expose `manifestSource`, `downloadPath`,
  `stagingDir`, `stagedAppPath`, and `reportPath` in frontend-visible status.
- `frontend/src/components/SettingsModal.tsx` displays build/update diagnostic
  data that can include local paths.
- `app.go` and `internal/mcp/bootstrap.go` can persist an absolute executable
  path into external MCP configuration.
- `internal/ai/agents/codex.go`, `internal/indexer/lsp/manager.go`,
  `internal/terminal/carapace_provider.go`, and
  `internal/ai/provider_runtime.go` should be reviewed for environment and tool
  path exposure.
- `wails.json`, `build/darwin/Info*.plist`, and `build/windows/info.json` are
  packaged metadata sinks for personal author/company/copyright fields.
- `docs/themes.md` and some tests contain machine-specific `/Users/...`
  examples that should be neutralized before a public source release.

### Documentation Drift

- `README.md` is the strongest public story anchor, but it currently carries too
  much release/install/demo burden.
- `docs/privacy-policy.md`, `docs/model-provenance.md`,
  `docs/lsp-supply-chain.md`, and release checklist docs contain the
  important truth, but users must chase it across several files.
- `docs/model-provenance.md` still has a release-time memorization/regurgitation
  check as an open gate.
- `scripts/bootstrap-dev-macos.sh` prints the older next step
  `./scripts/wails-dev-macos.sh`, while public docs point to
  `./scripts/wails3-dev-macos.sh`.
- Internal planning docs and public docs are mixed in one flat `docs/` layer.

## Subagent Work Split

### Subagent A: Release / Updater Backend

Ownership:

- `auto_update_private_github.go`
- `auto_update_runtime.go`
- `auto_update_verifier.go`
- `build_info.go`
- focused updater tests in the repo root

Tasks:

- Decide and implement the public manifest transport. Preferred default:
  `https://github.com/<owner>/<repo>/releases/latest/download/arlecchino-update-manifest.json`.
- Stop requiring private GitHub tokens for public release checks.
- Keep private `github-release://` handling only as an internal legacy path, or
  remove it after the public flow is verified.
- Keep manifest validation, channel matching, version/build comparison, SHA256,
  and Ed25519 verification intact.
- Make runtime update status safe for frontend consumption by removing or
  redacting path-bearing fields from normal UI status.

Verification:

```bash
go test -run 'Test.*AutoUpdate' .
```

### Subagent B: Release Pipeline

Ownership:

- `scripts/wails3-local-release-macos.sh`
- `scripts/wails3-github-release-macos.sh`
- `scripts/wails3-private-updater-live-smoke-macos.sh`
- `scripts/wails3-update-manifest.mjs`
- `scripts/wails3-release-notes-policy.mjs`

Tasks:

- Keep the release scripts parameterized around the beta GitHub release path.
- Generate and upload:
  - `arlecchino-macos-universal.dmg`
  - `arlecchino-macos-universal.zip`
  - `arlecchino-beta-update-manifest.json`
  - `arlecchino-update-manifest.json` as the legacy compatibility manifest
  - `arlecchino-update-public-key.txt`
  - `checksums.sha256`
  - release evidence JSON
- Embed `github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-beta-update-manifest.json`
  into packaged beta builds.
- Keep the Ed25519 private key outside the repository.
- Replace private updater smoke with public no-auth updater smoke.

Verification:

```bash
./scripts/wails3-release-smoke-macos.sh --report /tmp/arlecchino-release-smoke.json
```

### Subagent C: Path / Host Leakage And Installed App Cleanliness

Ownership:

- `build_info.go`
- `auto_update_runtime.go`
- `frontend/src/shell/autoUpdate.ts`
- `frontend/src/components/SettingsModal.tsx`
- `app.go`
- `internal/mcp/bootstrap.go`
- `internal/ai/agents/codex.go`
- `internal/indexer/lsp/manager.go`
- `internal/terminal/carapace_provider.go`
- packaged metadata templates under `build/`
- path-bearing docs/tests

Tasks:

- Replace public `BuildInfo.bundlePath` / `BuildInfo.executablePath` exposure
  with safe metadata such as `bundleLocation: system | user | custom`.
- Keep absolute paths backend-only unless the user explicitly exports
  diagnostics.
- Redact path-bearing fields in installed-app smoke/evidence reports, or add a
  separate cleanliness report mode.
- Avoid persisting the current app bundle executable as the default MCP command.
  Prefer a stable launcher/shim such as `/usr/bin/env arlecchino` once such a
  launcher exists.
- Normalize command paths to system locations where appropriate, for example
  `/usr/bin/security`, `/usr/bin/plutil`, `/usr/bin/codesign`, `/bin/zsh`.
- Remove personal author/email/company values from packaged metadata.
- Replace real `/Users/klawdiy/...` examples in docs/tests with
  `/Users/tester/...`, `${HOME}`, or neutral fixture paths.

Verification:

```bash
APP="/Applications/Arlecchino.app"

plutil -p "$APP/Contents/Info.plist" \
  | rg -n '/Users/|/var/folders/|/tmp/|Klawdiy|Klowerson|gmail|BuildMachineOSBuild|DTXcode|DTSDK'

codesign -dvvv "$APP" 2>&1 \
  | rg -n '/Users/|BuildMachineOSBuild|DTXcode|DTSDK|Klawdiy|gmail'

find "$APP/Contents" -type f \( -name '*.plist' -o -name '*.json' -o -perm -111 \) -print0 \
  | xargs -0 strings -a \
  | rg -n '/Users/|/var/folders/|/private/tmp|/tmp/|Klawdiy|Klowerson|gmail|Library/Caches/arlecchino|mcp-bridge-[0-9]+-[0-9]+\.sock'
```

### Subagent D: Public Documentation Truth And Structure

Ownership:

- `README.md`
- `docs/open-beta.md`
- `docs/install-update-macos.md`
- `docs/privacy-ai.md`
- `docs/features-and-demos.md`
- `docs/developer/architecture.md`
- existing release/privacy/model docs

Tasks:

- Keep `README.md` short: what Arlecchino is, what ships now, quick install,
  links to details, and demo links.
- Add `docs/open-beta.md` for current beta status, audience, known limitations,
  and unsigned macOS distribution truth.
- Add `docs/install-update-macos.md` for source checkout, DMG/ZIP tester path,
  manual update, and public auto-update behavior.
- Add or reshape `docs/privacy-ai.md` around local data, network activity,
  provider disclosure, external runtime disclosure, data clearing, and provider
  policy links.
- Keep `docs/model-provenance.md` public, but clearly state that the bundled
  model supports local autocomplete/ranking and that the release-time
  memorization check is a gate.
- Add `docs/features-and-demos.md` with one section per public feature and a
  demo link or explicit `TBD`.
- Move internal release engineering, legal prep, and long planning docs out of
  the primary public docs path or keep them unlinked from public entrypoints.

Verification:

```bash
rg -n 'Private GitHub|github-release://|KlawdiyRomiy|/Users/klawdiy|Coming Soon|GA|notarized' README.md docs
```

### Subagent E: Promotion, Demo, And Developer Docs

Ownership:

- `docs/features-and-demos.md`
- `docs/developer/architecture.md`
- demo script / shot list outside source code
- release notes draft

Tasks:

- Position the beta as a local-first desktop IDE with controlled AI/MCP
  surfaces, not as a finished autonomous AI IDE.
- Demo the strongest stable flow first:
  1. launch and workspace open;
  2. bubble shell and panels;
  3. editor/navigation/diagnostics;
  4. command palette and terminal dispatcher;
  5. Git, Problems, Browser Preview, settings;
  6. MCP read/control proof and approval boundary;
  7. AI Chat/provider/tool review only if the path is stable on the release
     machine.
- Explain the IDE internals in developer docs:
  - Go/Wails runtime and bridge;
  - React shell and floating panels;
  - editor/LSP/indexer pipeline;
  - terminal orchestration;
  - MCP approval and audit model;
  - AI provider/runtime envelope;
  - packaging and updater trust model.

Pre-record dogfood:

```bash
./scripts/wails3-clean-dev-orphans-macos.sh --dry-run
./scripts/wails3-release-smoke-macos.sh --report /tmp/arlecchino-release-smoke.json
./scripts/wails3-installed-app-smoke-macos.sh --app-bundle /Applications/Arlecchino.app --report /tmp/arlecchino-installed-smoke.json
```

### Subagent F: Release QA / Integration

Ownership:

- release checklist
- smoke reports
- final release evidence
- final public docs and release notes consistency

Tasks:

- Re-audit `git status` before implementation and keep user-owned changes out of
  release-prep commits.
- Run focused backend/frontend checks after each lane.
- Run packaged app smoke and cleanliness scans before any public upload.
- Confirm release notes do not contain raw commit digest dumps.
- Confirm the public artifact names do not contain `v3`.
- Confirm the public docs do not link users to internal private-release or
  planning-only docs.

Final verification:

```bash
go test -run 'Test.*AutoUpdate' .
cd frontend && npm run typecheck
./scripts/wails3-release-smoke-macos.sh --report /tmp/arlecchino-release-smoke.json
```

## Promotion Story

The public story should be:

> Arlecchino is a macOS-first, local-first desktop IDE beta for keeping a real
> project in view: editor, terminal, Git, preview, diagnostics, MCP control, and
> approval-gated AI surfaces in one desktop workbench.

Avoid:

- "finished autonomous AI IDE";
- "stable GA";
- "notarized/trusted installer";
- "private beta updater";
- "AI works for every provider/model/runtime".

Prefer:

- "open beta";
- "controlled AI/MCP surfaces";
- "local-first by default";
- "explicit provider configuration and consent";
- "source checkout plus unsigned tester builds";
- "signed update manifests, but no Apple Developer ID and no notarization for
  this beta line yet".

## Open Decisions

Resolved:

- The public beta uses the same `KlawdiyRomiy/Arlecchino` repository after it
  becomes public.
- The beta release uses one GitHub release with a primary beta manifest and a
  legacy alpha-channel manifest for already-installed alpha updater clients.

Still open:

- What is the final supported public launcher path for MCP bootstrap?

Recommended launcher policy:

- Use absolute `/usr/bin/...` paths for macOS system tools such as
  `/usr/bin/security`, `/usr/bin/plutil`, `/usr/bin/codesign`, and
  `/usr/bin/env`.
- Do not attempt to install Arlecchino itself into `/usr/bin`; macOS protects
  that location.
- Public beta fallback: only persist
  `/Applications/Arlecchino.app/Contents/MacOS/Arlecchino` when the installed app
  really lives under `/Applications`. Do not auto-register global MCP from a
  user-home, Downloads, build, or temp bundle path.
- Longer-term preferred path: provide a stable `arlecchino` CLI shim through an
  installer/Homebrew-style flow, then persist `/usr/bin/env arlecchino` in MCP
  config. That avoids user-specific paths while allowing the launcher location
  to be managed outside Arlecchino's config.

## First Implementation Order

1. Re-audit current worktree and protect unrelated/user-owned changes.
2. Use the same `KlawdiyRomiy/Arlecchino` repository after it becomes public and
   choose the final manifest URL policy.
3. Implement public updater/runtime path.
4. Implement public release script and public updater smoke.
5. Sanitize runtime diagnostics, external config, metadata, docs, and test
   fixtures.
6. Split public docs from internal release/planning docs.
7. Run release smoke, installed app smoke, and cleanliness scans.
8. Record demo clips only after the dogfood pass is green enough for public
   viewing.
9. Draft release notes from `docs/release-notes-template.md` with curated user
   sections and demo links.
