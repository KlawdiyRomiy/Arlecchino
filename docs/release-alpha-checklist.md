# Alpha Release Checklist

Status: practical release gate for the source alpha and local macOS alpha
bundle. There is still no Apple Developer ID, so this is not a trusted
notarized distribution path.

## Release Formats

- Primary path: source checkout through `git clone`, then run
  `./scripts/bootstrap-dev-macos.sh` once and `./scripts/wails-dev-macos.sh` for
  development launches.
- Convenience path: `./scripts/wails3-local-alpha-release-macos.sh` creates an
  ad-hoc signed universal `arm64+x86_64` `Arlecchino.app` for macOS Big Sur
  11.0 through Tahoe 26.x, `arlecchino-macos-universal.zip`, JSON evidence
  report, and optional `arlecchino-macos-universal.dmg` through
  `sindresorhus/create-dmg` (`create-dmg`/`npx create-dmg`).
- GitHub Releases should use split assets by platform/architecture. For macOS,
  the primary asset is `arlecchino-macos-universal.dmg`; the fallback/manual
  asset is `arlecchino-macos-universal.zip`. Version belongs to the GitHub tag
  and release metadata, not the artifact filename.
- Public product/release names must not include `v3`. Keep `wails3` only in
  internal migration script names.
- Gatekeeper rejection for ad-hoc artifacts is expected. Do not present the
  ad-hoc `.app`, ZIP, or DMG as notarized, hardened, or equivalent to an Apple
  Developer ID release.
- Intel Mac support must be checked through the release report `target.binaryArchs`
  containing `x86_64`; Apple Silicon support through `arm64`.

## GitHub Release Draft Flow

- Use one GitHub release tag per alpha build.
- Upload macOS assets as separate files:
  - `arlecchino-macos-universal.dmg`
  - `arlecchino-macos-universal.zip`
  - checksum file, signed update manifest, and public verifier key when the
    updater channel is enabled.
- Keep the app bundle inside the DMG named `Arlecchino.app`.
- Do not put the version in the macOS asset filename; the version belongs to
  the GitHub tag, release title, release notes, and manifest metadata.
- Release notes used for updater manifests must be curated user-facing notes,
  not raw `git log` digests. Use short sections such as `Improved`, `Fixed`,
  `Changed`, and `Security`; start from `docs/release-notes-template.md`.
  `scripts/wails3-update-manifest.mjs` rejects notes that look like commit
  hash lists.
- Do not publish a trusted macOS distribution claim until Developer ID signing
  and notarization are available. Local-alpha ad-hoc assets are for local/tester
  workflows only.
- Future platform assets should follow the same split-asset model by platform
  and architecture, rather than mixing installers into one catch-all artifact.

## Must Be Included In Release Artifacts

- `LICENSE`
- `THIRD_PARTY_NOTICES.md`
- `docs/privacy-policy.md`
- `docs/model-provenance.md`
- `docs/lsp-supply-chain.md`
- `docs/trademark-clearance.md`
- clear release notes stating that telemetry, accounts, and cloud AI providers
  are disabled by default in the current alpha.

## Manual Gates Before Public Alpha

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
- Do a release dogfood pass: startup, project open, editor interaction,
  terminal command, autocomplete/ranking path, and one MCP approval flow.
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
  Gatekeeper status, absence of real Arlecchino/Wails TCP listeners, process
  snapshot, MCP bridge socket presence, and stale dev-binary orphan leakage.
- Run `./scripts/wails3-window-lease-manual-smoke-macos.sh --launch --report <path>`
  and record Terminal detached PTY/focus/session behavior before enabling any
  detached helper by default.
- If using update manifests, generate them with
  `./scripts/wails3-update-manifest.mjs`; keep the Ed25519 private key outside
  the repository and publish only the manifest/artifacts/public verifier key.
- For updater-enabled local-alpha builds, generate release candidates with
  `./scripts/wails3-local-alpha-release-macos.sh --update-private-key <external-ed25519.pem>`.
  This produces the public DMG, the updater ZIP, signed manifest, public key
  output, and release evidence. The ZIP must contain only `Arlecchino.app`.
- For private GitHub alpha updates, use
  `./scripts/wails3-private-github-alpha-release-macos.sh` first without
  `--publish` to inspect the plan. Live publish requires `--publish`, `gh auth
  status`, a clean tracked worktree, and an external Ed25519 private key. The
  script uploads `arlecchino-macos-universal.zip` first, regenerates the update
  manifest with the private GitHub release asset API URL, then uploads the
  manifest, public verifier key, checksums, optional DMG and release evidence.
- Installed private-alpha apps should embed
  `github-release://KlawdiyRomiy/Arlecchino/latest/arlecchino-update-manifest.json`
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
- Public alpha approval path should use the in-app UI prompt when the live IDE
  is available.
- `ARLECCHINO_MCP_APPROVAL_CODE` is acceptable for developer or scripted flows,
  but should not be the only public alpha approval mechanism.
- In-app direct binary downloads for LSP servers must be pinned and verified, or
  kept out of the public in-app install path until a manifest with checksums is
  added.
- For the macOS alpha, `zls`, `marksman`, and `lua-language-server` should
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
