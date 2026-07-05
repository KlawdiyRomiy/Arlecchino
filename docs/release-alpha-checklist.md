# Beta Release Checklist

Status: practical release gate for the macOS-first Arlecchino Beta, source
checkout path, and local macOS beta bundle. Current artifacts do not have Apple
Developer ID signing or notarization yet. Both will be added soon, with no date
committed.

The filename is retained for link compatibility with existing release scripts
and docs; the release track described here is beta.

The public beta message is: local-first desktop IDE with integrated AI
assistance, MCP control, and approval-gated agent surfaces. Do not position the
current release as GA/stable or as a complete autonomous AI IDE. AI Chat,
provider configuration, context preview, consent gates, tool review, patch
artifacts, Codex CLI runtime integration, and optional editor predictions are
part of the beta surface. Provider setup, model capability, approval policy, and
runtime coverage still vary; local ARLE autocomplete/ranking remains
experimental.

## Release Formats

- Primary path: source checkout through `git clone`, then run
  `./scripts/bootstrap-dev-macos.sh` once and `./scripts/wails3-dev-macos.sh` for
  development launches.
- Convenience path: `./scripts/wails3-local-release-macos.sh` creates a signed universal
  `arm64+x86_64` `Arlecchino.app` for macOS Big Sur 11.0 through Tahoe 26.x,
  `arlecchino-macos-universal.zip`, JSON evidence report, and optional
  `arlecchino-macos-universal.dmg` through `sindresorhus/create-dmg`
  (`create-dmg`/`npx create-dmg`). Default signing is ad-hoc.
- GitHub Releases should use split assets by platform/architecture. For macOS,
  the primary asset is `arlecchino-macos-universal.dmg`; the fallback/manual
  asset is `arlecchino-macos-universal.zip`. Version belongs to the GitHub tag
  and release metadata, not the artifact filename.
- Public product/release names must not include `v3`. Keep `wails3` only in
  internal migration script names.
- Gatekeeper rejection for no-Developer-ID artifacts is expected. Do not present
  the ad-hoc or local-certificate `.app`, ZIP, or DMG as notarized, hardened, or
  equivalent to an Apple Developer ID release.
- Signing modes have separate meanings:
  - `adhoc`: simplest local/tester mode; macOS folder permissions may reset
    after each update because the code identity changes with the app content.
  - `local-identity`: owner/local-tester mode that signs with an explicitly
    created local code-signing certificate named by
    `ARLE_WAILS3_LOCAL_CODESIGN_IDENTITY` (default:
    `Arlecchino Local Code Signing`). This can make permissions more stable on
    that Mac, but it is not public Gatekeeper trust.
  - `developer-id`: script support exists, but current artifacts do not use it
    yet. Treat this as a soon-later release track with no committed date until
    the trusted distribution plan is approved and documented.
- Intel Mac support must be checked through the release report `target.binaryArchs`
  containing `x86_64`; Apple Silicon support through `arm64`.

## Local Identity Setup

Use this only for owner/local-tester builds where the goal is stable macOS code
identity on the same Mac, not public trust:

1. Open **Keychain Access**.
2. Use **Certificate Assistant -> Create a Certificate**.
3. Name it `Arlecchino Local Code Signing`.
4. Choose a self-signed identity with certificate type **Code Signing**. If the
   macOS UI asks whether to override defaults, use the defaults unless you need
   to set trust explicitly.
5. Trust the certificate for code signing only if you accept the local machine
   risk. Do not export or commit the private key.
6. Verify it exists with
   `security find-identity -p codesigning -v | grep -F "Arlecchino Local Code Signing"`.
7. Build with
   `ARLE_WAILS3_SIGN_MODE=local-identity ./scripts/wails3-local-release-macos.sh`.

## GitHub Release Draft Flow

- Use one GitHub release tag per beta build.
- Upload macOS assets as separate files:
  - `arlecchino-macos-universal.dmg`
  - `arlecchino-macos-universal.zip`
  - checksum file, signed update manifest, and public verifier key when the
    updater channel is enabled.
- Keep the app bundle inside the DMG named `Arlecchino.app`.
- Do not put the version in the macOS asset filename; the version belongs to
  the GitHub tag, release title, release notes, and manifest metadata.
- Updater manifests must include both `version` and `build`. Installed apps
  compare `version` first and `build` second, so build-only beta patches are
  detectable after this gate.
- Release notes used for updater manifests must be curated user-facing notes,
  not raw `git log` digests. Use short sections such as `Improved`, `Fixed`,
  `Changed`, and `Security`; start from `docs/release-notes-template.md`.
  `scripts/wails3-update-manifest.mjs` rejects notes that look like commit
  hash lists.
- Do not publish a trusted macOS distribution claim for the current artifacts.
  Developer ID signing and notarization will be added soon, with no date
  committed. Until then, ad-hoc and local certificate assets are for
  local/tester workflows only.
- Future platform assets should follow the same split-asset model by platform
  and architecture, rather than mixing installers into one catch-all artifact.

## Must Be Included In Release Artifacts

- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- `docs/privacy-policy.md`
- `docs/model-provenance.md`
- `docs/lsp-supply-chain.md`
- `docs/trademark-clearance.md`
- clear release notes stating that telemetry and accounts are not enabled by
  default, and cloud AI providers/external agent runtimes require explicit
  provider configuration, consent, and runtime gates.
- README feature sections and release notes with demo-video placeholders or
  links for every public feature being claimed.

## Manual Gates Before Public Beta

- Confirm the gated Hugging Face terms state for
  `https://huggingface.co/datasets/bigcode/the-stack-dedup` using the
  responsible project account. If the terms were already accepted during
  training and no receipt was retained, record a current owner attestation
  instead of inventing an exact old date.
- Record the accepting account, attestation date, dataset name, training
  revision, and current access evidence in `docs/model-provenance.md`.
- Run and record a small model memorization/regurgitation check for the bundled
  ARLE model.
- Run current Go, npm, and Composer license scans and update
  `THIRD_PARTY_NOTICES.md` if any licenses changed.
- Resolve packages with missing local license metadata, including
  `codemirror-extension-inline-suggestion`.
- Review `docs/trademark-clearance.md` before broader public launch.
- Confirm README and public release notes describe this as a Beta with
  integrated AI assistance, not as GA/stable and not as a finished autonomous AI
  IDE.
- Confirm every public feature claim has either a demo video link or a visible
  `TBD` placeholder that makes the missing demo explicit.
- Do a release dogfood pass: startup, project open, editor interaction,
  terminal command, autocomplete/ranking path, and one MCP approval flow.
- Run the narrow release checks for the current tree and do not publish with
  known red checks unless the release notes explicitly classify the issue as an
  accepted beta limitation.
- Verify in-app notifications through the neutral notification stack: save
  progress, save success/error, dispatcher result, and terminal/git errors.
  Native macOS notifications remain separate and default-off.
- Run `./scripts/wails3-release-smoke-macos.sh --report <path>` and attach the
  report to the release notes or internal release evidence.
- If the machine has been used for Wails v3 dev runs, run
  `./scripts/wails3-clean-dev-orphans-macos.sh --dry-run` first, then without
  `--dry-run` if it finds stale `/tmp/Arlecchino-wails-build/bin/Arlecchino-v3 mcp-server`
  processes.
- Run `./scripts/wails3-installed-app-smoke-macos.sh --app-bundle /Applications/Arlecchino.app --report <path>`
  after installing the DMG. This verifies the installed bundle name, codesign,
  signing identity kind, permission-stability classification, Gatekeeper status,
  stable local-beta bundle identifier, absence of real Arlecchino/Wails TCP
  listeners, process snapshot, MCP bridge socket presence, and stale dev-binary
  orphan leakage. For local certificate verification, pass
  `--expected-identity-kind local-certificate`.
- Run `./scripts/wails3-window-lease-manual-smoke-macos.sh --launch --report <path>`
  and record Terminal detached PTY/focus/session behavior before enabling any
  detached helper by default.
- If using update manifests, generate them with
  `./scripts/wails3-update-manifest.mjs`; keep the Ed25519 private key outside
  the repository and publish only the manifest/artifacts/public verifier key.
- For updater-enabled local/tester builds, generate release candidates with
  `./scripts/wails3-local-release-macos.sh --update-private-key <external-ed25519.pem>`.
  This produces the public DMG, the updater ZIP, signed manifest, public key
  output, and release evidence. The ZIP must contain only `Arlecchino.app`.
- For GitHub beta updates, use `./scripts/wails3-github-release-macos.sh` first
  without `--publish` to inspect the plan. Live publish requires `--publish`,
  GitHub CLI authentication, a clean tracked worktree, `HEAD == origin/main`, a
  remote tag pointing at `HEAD`, an external Ed25519 private key, and explicit
  `--tag`, `--version`, `--build`, `--channel`, and `--notes-file` values. The
  script uploads `arlecchino-macos-universal.zip` first, regenerates the primary
  beta manifest with the GitHub release asset API URL, generates the legacy
  alpha-channel compatibility manifest for installed alpha clients, then
  uploads both manifests, public verifier key, checksums, optional DMG, and
  release evidence.
- Installed beta apps should embed
  `github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-beta-update-manifest.json`
  as the manifest source. Users configure private release access in Settings;
  Arlecchino stores the fine-grained GitHub token in macOS Keychain under
  service `io.arlecchino.ide.updater` and account `github-release-token`.
  `ARLECCHINO_GITHUB_TOKEN` is only a dev/smoke override.
- Auto-update UX is user-confirmed: the app checks the manifest, downloads the
  ZIP to the user cache, verifies SHA256 + Ed25519, stages `Arlecchino.app`, then
  shows an in-app notification with `Install and relaunch`. If the installed
  bundle is not writable, the notification falls back to GitHub Releases/manual
  DMG replacement.
- Auto-update notifications must stay compact: show the target version, a short
  curated summary, and an expandable details section for longer curated notes.
  They must never display raw commit hash lists in the foreground card.
- `Download update` and `Install and relaunch` must immediately switch the
  foreground card to progress states and block repeated clicks while the current
  updater operation is running.
- Startup/background update checks must be quiet unless an update is present or
  already staged. They must not show foreground cards for `checking`,
  `not-available`, missing private token/manual-required, or failed background
  checks. Manual checks stay explicit and must show visible feedback for every
  result.
- Installed updater smoke must verify both trigger paths: a packaged app with
  an embedded manifest URL runs one quiet startup check per session, and
  `Settings -> Diagnostics -> Build identity -> Check for Updates` plus
  `TopBar -> Actions -> Check for Updates` route through the same runtime
  `CheckForAutoUpdate()` path. Repeat one trigger after an unchanged result and
  confirm the bottom-right foreground notification visibly refreshes instead of
  appearing inert.
- Private updater smoke evidence for `0.1.3-alpha.103` passed through:
  signed updater ZIP -> SHA256/Ed25519 verify -> stage `Arlecchino.app` ->
  user-confirmed `Install and relaunch` -> new BuildInfo. Releases/builds
  `0.1.1-alpha.101` and `0.1.2-alpha.102` are superseded and should not be used
  as updater evidence.
- Use `./scripts/wails3-private-updater-live-smoke-macos.sh --report <path>`
  before and after the in-app update flow to record private release asset,
  updater ZIP, installed-app, and post-relaunch BuildInfo evidence. Reports stay
  outside git.
- The private Keychain-token updater path is temporary while the repository is
  private. When the repo becomes public, replace it with a public GitHub
  release/no-auth updater flow.

## Security Gates

- MCP mutating tools must require explicit approval by default.
- Public beta approval path should use the in-app UI prompt when the live IDE
  is available.
- `ARLECCHINO_MCP_APPROVAL_CODE` is acceptable for developer or scripted flows,
  but should not be the only public beta approval mechanism.
- In-app direct binary downloads for LSP servers must be pinned and verified, or
  kept out of the public in-app install path until a manifest with checksums is
  added.
- For the macOS beta, `zls`, `marksman`, and `lua-language-server` should
  install through Homebrew instead of Arlecchino-managed direct binary
  downloads.
- Auto-update install/apply is enabled only for signed updater ZIPs verified by
  the pinned Ed25519 public key. It does not use `sudo`, does not write inside
  the current `.app` during download/staging, and writes apply reports under the
  user cache.
- DMG users can still update manually by downloading the next
  `arlecchino-macos-universal.dmg` and replacing `/Applications/Arlecchino.app`;
  source users update with `git pull` and the dev scripts.
- No Apple Developer ID means this is not a notarized public-trust updater.
  Trust for the updater channel is HTTPS + SHA256 + pinned Ed25519 signature.
- `local-identity` signing is only a local machine identity-stability aid. It
  must not be described as notarization, public signing, or a clean Gatekeeper
  release channel.
